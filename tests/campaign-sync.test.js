const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create } = require('../app/campaign-sync.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function memory() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) };
}
function setup(write, storage = memory()) {
  const state = { owner: 'a' };
  return { state, storage, queue: create({ storage, activeOwner: () => state.owner, write }) };
}
function extract(name) {
  const start = source.search(new RegExp('^    (?:async )?function ' + name + '\\(', 'm'));
  assert.ok(start >= 0, name + ' exists');
  const tail = source.slice(start + 1);
  const next = tail.search(/^    (?:async )?function /m);
  return source.slice(start, next < 0 ? source.length : start + 1 + next);
}
function context(names, values) {
  const ctx = vm.createContext({ console: {error() {}, warn() {}}, activeCampaignImportOwner: null, updateEditState(){}, restoreCampaignView:async()=>{}, loadCurrentView:async()=>{}, cacheVerifiedCampaignRows:async()=>{}, eachDateInRange:(start,end)=>start===end?[start]:[start,end], ...values });
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return ctx;
}
test('failed save survives reload, then reconnect sends and acknowledges it', async () => {
  const calls = [];
  const h = setup(async () => { throw Error('offline'); });
  h.queue.enqueue('a','2026-10-28',[{name:'SUP',adCost:45}]);
  await assert.rejects(h.queue.flush('a'), /offline/);
  const reloaded = create({storage:h.storage,activeOwner:()=> 'a',write:async (...args)=>calls.push(args)});
  assert.equal(reloaded.pending('a','2026-10-28').rows[0].adCost,45);
  await reloaded.flush('a');
  assert.equal(calls.length,1);
  assert.equal(reloaded.list('a').length,0);
});
test('two dates are both retained and uploaded', async () => {
  const calls=[]; const h=setup(async date=>calls.push(date));
  h.queue.enqueue('a','2026-10-28',[{name:'one'}]);
  h.queue.enqueue('a','2026-10-29',[{name:'two'}]);
  await h.queue.flush('a');
  assert.deepEqual(calls,['2026-10-28','2026-10-29']);
});
test('acknowledging an older write cannot remove a newer edit', async () => {
  const values=[]; let q;
  const h=setup(async (date,rows)=>{values.push(rows[0].adCost);if(values.length===1)q.enqueue('a',date,[{adCost:90}]);});
  q=h.queue;q.enqueue('a','2026-10-28',[{adCost:45}]); await q.flush('a');
  assert.deepEqual(values,[45,90]);assert.equal(q.list('a').length,0);
});
test('an inactive account cannot be flushed or read through another namespace', async () => {
  let calls=0;const h=setup(async ()=>{calls++;});
  h.queue.enqueue('a','2026-10-28',[{secret:'a'}]);h.state.owner='b';
  await h.queue.flush('a');
  assert.equal(calls,0);assert.equal(h.queue.pending('b','2026-10-28'),null);
  assert.equal(h.queue.list('a').length,1);
});
test('account switch during upload leaves subsequent dates queued for their owner', async () => {
  const calls=[];let h;
  h=setup(async date=>{calls.push(date);h.state.owner='b';});
  h.queue.enqueue('a','2026-10-28',[{v:1}]);h.queue.enqueue('a','2026-10-29',[{v:2}]);
  await h.queue.flush('a');
  assert.deepEqual(calls,['2026-10-28']);assert.equal(h.queue.list('a')[0].date,'2026-10-29');
});
test('a queued deletion replaces a failed edit, preventing resurrection', async () => {
  const calls=[];const h=setup(async (date,rows)=>calls.push(rows));
  h.queue.enqueue('a','2026-10-28',[{v:1}]);h.queue.enqueue('a','2026-10-28',[]);
  await h.queue.flush('a');assert.deepEqual(calls,[[]]);
});
test('storage failure is not silently acknowledged as a durable save', () => {
  const h=setup(async ()=>{}, {getItem:()=>null,setItem:()=>{throw Error('quota');}});
  assert.throws(()=>h.queue.enqueue('a','2026-10-28',[{v:1}]),/quota/);
});
test('pending snapshot is isolated from callers mutating rows', () => {
  const h=setup(async()=>{});const rows=[{v:1}];h.queue.enqueue('a','2026-10-28',rows);
  rows[0].v=2;const pending=h.queue.pending('a','2026-10-28');pending.rows[0].v=3;
  assert.equal(h.queue.pending('a','2026-10-28').rows[0].v,1);
});
test('current pending data wins over a stale server read', async () => {
  const h=setup(async()=>{});h.queue.enqueue('a','2026-10-28',[{v:2}]);
  let reads=0;const ctx=context(['fetchCampaignRows'],{currentUser:{id:'a'},campaignSync:h.queue,findCampaignRecord:async()=>{reads++;return{data:[{v:1}]};}});
  const result=await ctx.fetchCampaignRows('2026-10-28');
  assert.equal(result[0].v,2);assert.equal(reads,0);
});
test('range loads overlay pending edits and pending deletions', async () => {
  const h=setup(async()=>{});h.queue.enqueue('a','2026-10-28',[{v:2}]);h.queue.enqueue('a','2026-10-29',[]);
  const query={select(){return this;},eq(){return this;},gte(){return this;},lte(){return this;},order(){return this;},then(resolve){return Promise.resolve({data:[{record_date:'2026-10-28',data:[{v:1}]},{record_date:'2026-10-29',data:[{v:3}]}]}).then(resolve);}};
  const ctx=context(['fetchCampaignRecordsRange'],{currentUser:{id:'a'},campaignSync:h.queue,supabaseClient:{from:()=>query},assertCampaignOwner(){}});
  const result=await ctx.fetchCampaignRecordsRange('2026-10-28','2026-10-29');
  assert.equal(result[0].data[0].v,2);assert.equal(result[1].data.length,0);
});
test('failed import remains queued and reports that cloud sync is pending', async () => {
  const h=setup(async()=>{throw Error('offline');});
  const ctx=context(['saveRowsForImportDate'],{currentUser:{id:'a'},campaignSync:h.queue,normalizeCampaignRow:x=>x,flushCampaignOutbox:async()=>false});
  await assert.rejects(ctx.saveRowsForImportDate('2026-10-28',[{v:2}]),/ยังไม่ขึ้นคลาวด์/);
  assert.equal(h.queue.pending('a','2026-10-28').rows[0].v,2);
});
test('migration uploads a missing date and preserves a conflicting guest date', async () => {
  const store={'2026-10-27':[{v:7}],'2026-10-28':[{v:8}]};
  const remote={'2026-10-27':{data:[{v:1}]}};const h=setup(async(date,rows)=>{remote[date]={data:rows};});
  const ctx=context(['campaignDataFingerprint','migrateLocalRowsToSupabase'],{currentUser:{id:'a'},campaignSync:h.queue,assertCampaignOwner(){},readDailyStore:()=>JSON.parse(JSON.stringify(store)),findCampaignRecord:async date=>remote[date]||null,normalizeCampaignRow:x=>x,writeDailyStore:value=>{for(const key of Object.keys(store))delete store[key];Object.assign(store,value);},safeRemoveLocalStorage(){},storageKey:'old'});
  await ctx.migrateLocalRowsToSupabase();
  assert.equal(remote['2026-10-28'].data[0].v,8);
  assert.equal(store['2026-10-27'][0].v,7);
  assert.equal(store['2026-10-28'],undefined);
});
test('readback fingerprint ignores JSON object key order', () => {
  const ctx=context(['campaignDataFingerprint'],{});
  assert.equal(ctx.campaignDataFingerprint([{name:'SUP',adCost:45}]),ctx.campaignDataFingerprint([{adCost:45,name:'SUP'}]));
});
test('auth callback schedules database work after returning to Supabase', () => {
  const start=source.indexOf('supabaseClient.auth.onAuthStateChange((event, session) => {');
  assert.ok(start>0);
  const callbackSource=source.slice(start,source.indexOf('\n      });',start)+10);
  let callback;const scheduled=[];
  const ctx=vm.createContext({supabaseClient:{auth:{onAuthStateChange:fn=>{callback=fn;}}},currentUser:{id:'a'},setAuthUi(){},setTimeout:fn=>scheduled.push(fn)});
  vm.runInContext(callbackSource,ctx);
  assert.equal(callback('TOKEN_REFRESHED',{user:{id:'a'}}),undefined);
  assert.equal(scheduled.length,1);
});

function uploadContext(overrides = {}) {
  const file = { name: 'report-28.xlsx' };
  const record = { id: 'a:Shopee', ownerId: 'a', revision: 'r1', file };
  const marker = { file, ownerId: 'a', record, promise: Promise.resolve(record) };
  const elements = {};
  const retained = new Map([[record.id, record]]);
  const values = {
    currentUser: {id:'a'}, pendingShopeeFile: file, pendingLazadaFile:null, pendingFacebookAdsFile:null,
    campaignUploadActive:false, activeCampaignImportOwner:null,
    campaignUploadControls: {Shopee:{input:'shopeeFile',button:'confirmShopeeUpload'}},
    rememberedCampaignUploads:new Map([['Shopee',marker]]),
    document:{getElementById:id=>elements[id]||(elements[id]={disabled:false,value:'selected'})},
    campaignImportStore:{remove:async id=>retained.delete(id)},
    requireCampaignCloudSession:async()=> 'a',
    assertCampaignOwner:id=>assert.equal(id,'a'),
    ensureSelectedSingleDateLoaded:async()=>{}, flushCampaignOutbox:async()=>true,
    ...overrides
  };
  const ctx=context(['pendingCampaignFile','setPendingCampaignFile','runRememberedCampaignImport'],values);
  return {ctx,file,record,retained,elements};
}
test('failed cloud upload keeps the selected file and durable file record', async () => {
  const h=uploadContext();const status={};const result=await h.ctx.runRememberedCampaignImport('Shopee',h.file,status,async()=>{throw Error('offline');});
  assert.equal(result,false);assert.equal(h.ctx.pendingShopeeFile,h.file);
  assert.equal(h.retained.size,1);assert.match(status.textContent,/ไม่ต้องเลือกใหม่/);
});
test('verified upload clears the retained file only after cloud confirmation', async () => {
  const h=uploadContext();const status={};
  const result=await h.ctx.runRememberedCampaignImport('Shopee',h.file,status,async()=>({dates:['2026-10-28']}));
  assert.equal(result,true);assert.equal(h.ctx.pendingShopeeFile,null);assert.equal(h.retained.size,0);
});
test('selecting a new file while uploading does not clear the new selection', async () => {
  const h=uploadContext();const next={name:'next.xlsx'};const status={};
  const result=await h.ctx.runRememberedCampaignImport('Shopee',h.file,status,async()=>{h.ctx.pendingShopeeFile=next;return{dates:['2026-10-28']};});
  assert.equal(result,true);assert.equal(h.ctx.pendingShopeeFile,next);
});
test('a remembered file bound to another account cannot be imported', async () => {
  const h=uploadContext({requireCampaignCloudSession:async()=> 'b'});const status={};let calls=0;
  const result=await h.ctx.runRememberedCampaignImport('Shopee',h.file,status,async()=>{calls++;return{};});
  assert.equal(result,false);assert.equal(calls,0);assert.equal(h.retained.size,1);assert.match(status.textContent,/บัญชีเดิม/);
});
test('an import does not claim success when its verified save remains queued', async () => {
  const h=uploadContext({flushCampaignOutbox:async()=>false});const status={};
  assert.equal(await h.ctx.runRememberedCampaignImport('Shopee',h.file,status,async()=>({dates:['2026-10-28']})),false);
  assert.equal(h.retained.size,1);assert.equal(h.ctx.pendingShopeeFile,h.file);
});
test('signed-out imports retain guest rows but explicitly reject cloud success', async () => {
  let retained;const ctx=context(['saveRowsForImportDate'],{
    currentUser:null,normalizeCampaignRow:x=>x,readDailyStore:()=>({}),storeCampaignBackup(){},
    setLocalRowsForDate:(date,rows)=>{retained=rows;},showCampaignSyncStatus(){}
  });
  await assert.rejects(ctx.saveRowsForImportDate('2026-10-28',[{v:28}]),/ยังไม่ขึ้นคลาวด์/);
  assert.equal(retained[0].v,28);
});
test('session is resolved immediately before import, even before initialization finishes', async () => {
  let user;const ctx=context(['requireCampaignCloudSession'],{
    currentUser:null,supabaseClient:{auth:{getSession:async()=>({data:{session:{user:{id:'a'}}},error:null})}},
    setAuthUi:value=>{user=value;},showCampaignSyncStatus(){}
  });
  assert.equal(await ctx.requireCampaignCloudSession(),'a');assert.equal(user.id,'a');
});
test('invalid files propagate failure so the upload handler retains the file', async () => {
  const ctx=context(['importAffiliateFile'],{readUploadRows:async()=>[]});
  await assert.rejects(ctx.importAffiliateFile('Shopee',{name:'bad.xlsx'},{}),/ไม่พบข้อมูล/);
});
test('retrying the same Facebook daily report replaces spend rather than doubling it', async () => {
  let saved=[{name:'SUP',adCost:40,shopeeIncome:100}];
  const ctx=context(['saveFacebookAdsGroupsByDate'],{
    loadRowsForImportDate:async()=>saved.map(x=>({...x})),
    normalizeSupName:s=>s.toLowerCase(),facebookAdsRowFromGroup:g=>({name:g.supName,adCost:g.adCost}),
    saveRowsForImportDate:async(date,rows)=>{saved=rows;},showImportedDateView(){},loadCurrentView:async()=>{}
  });
  const groups=new Map([['2026-10-28',[{supName:'SUP',adCost:50}]]]);
  await ctx.saveFacebookAdsGroupsByDate(groups);await ctx.saveFacebookAdsGroupsByDate(groups);
  assert.equal(saved[0].adCost,50);assert.equal(saved[0].shopeeIncome,100);
});

test('a save acknowledged during a read cannot render or cache the old server snapshot', async () => {
  let remote = [{name:'SUP',shopeeIncome:100}];
  const h=setup(async(date,rows)=>{remote=rows;});
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  let reads=0;const cached=[];
  const ctx=context(['fetchCampaignRows'],{
    currentUser:{id:'a'},campaignSync:h.queue,assertCampaignOwner(){},
    cacheVerifiedCampaignRows:async(owner,date,rows)=>cached.push(rows[0].shopeeIncome),
    findCampaignRecord:async()=>{const snapshot=JSON.parse(JSON.stringify(remote));if(++reads===1)await gate;return{data:snapshot};}
  });
  const read=ctx.fetchCampaignRows('2026-10-28');
  h.queue.enqueue('a','2026-10-28',[{name:'SUP',shopeeIncome:200}]);
  await h.queue.flush('a');release();
  assert.equal((await read)[0].shopeeIncome,200);
  assert.equal(reads,2);assert.deepEqual(cached,[200]);
});

test('retrying Shopee report replaces matching SUP income and keeps Lazada and ads', () => {
  const ctx=context(['replaceAffiliatePlatformRows'],{
    normalizeSupName:s=>s.toLowerCase(),platformFromRow:()=> 'Shopee + Lazada',
    addOrMergeRowIntoList:(rows,row)=>rows.push(row),affiliateRowFromGroup:(platform,g)=>({name:g.supName,orders:g.orders,shopeeIncome:g.total,lazadaIncome:0,adCost:0})
  });
  let rows=[{name:'SUP',orders:3,shopeeIncome:50,lazadaIncome:20,adCost:45}];
  const groups=[{supName:'sup',total:60,orders:2}];
  rows=ctx.replaceAffiliatePlatformRows(rows,'Shopee',groups);
  rows=ctx.replaceAffiliatePlatformRows(rows,'Shopee',groups);
  assert.equal(rows.length,1);assert.equal(rows[0].shopeeIncome,60);assert.equal(rows[0].lazadaIncome,20);assert.equal(rows[0].adCost,45);
});

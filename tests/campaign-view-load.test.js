const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

function extract(name) {
  const start=source.search(new RegExp('^    (?:async )?function '+name+'\\(', 'm'));
  assert.ok(start>=0,name+' exists');
  const tail=source.slice(start+1);
  const next=tail.search(/^    (?:async )?function /m);
  return source.slice(start,next<0?source.length:start+1+next);
}
function context(names,values={}) {
  const ctx=vm.createContext({console:{warn(){},error(){}},...values});
  vm.runInContext(names.map(extract).join('\n'),ctx);
  return ctx;
}
function deferred() {let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function loadHarness(overrides={}) {
  const state={rendered:[],locks:[],saved:[]};
  const rowsEl={};
  Object.defineProperty(rowsEl,'innerHTML',{set(){state.rendered=[];}});
  let ctx;
  const values={
    currentUser:{id:'a'},latestLoadToken:0,loadedCampaignView:null,currentChartRowsByDate:[],
    selectedDate:'2026-10-27',isRangeView:false,isLoadingRows:false,campaignViewReadFailed:false,
    dateInput:{value:'2026-10-28'},rangeEndInput:{value:'2026-10-28'},saveStatusEl:{textContent:''},
    campaignSync:{pending:()=>null},campaignViewStore:{get:async()=>null},readDailyStore:()=>({}),
    fetchCampaignRows:async()=>[{name:'SUP',shopeeIncome:53068.79,lazadaIncome:20467.59,adCost:89788.63}],
    fetchCampaignRecordsRange:async()=>[],rowsEl,
    updateEditState:()=>{state.locks.push(ctx.isLoadingRows||ctx.campaignViewReadFailed);},
    saveCurrentView:(start,end)=>state.saved.push([start,end]),
    addRow:row=>state.rendered.push({...row}),updateAll(){},keepLiveFirst(){},applySearchFilter(){},renderCurrentChart(){},
    mergeRowsForRange:rows=>rows,
    ...overrides
  };
  ctx=context(['eachDateInRange','campaignDataFingerprint','loadCampaignView','loadRowsForDate','loadRowsForDateRange'],values);
  return {ctx,state};
}

test('a reopened page renders the same saved cloud amounts and date without a new import',async()=>{
  const first=loadHarness();
  assert.equal(await first.ctx.loadRowsForDate('2026-10-28'),true);
  const reopened=loadHarness();
  assert.equal(await reopened.ctx.loadRowsForDate('2026-10-28'),true);
  assert.deepEqual(reopened.state.rendered,first.state.rendered);
  assert.equal(reopened.state.rendered[0].shopeeIncome,53068.79);
  assert.equal(reopened.state.rendered[0].lazadaIncome,20467.59);
  assert.equal(reopened.ctx.dateInput.value,'2026-10-28');
  assert.match(reopened.ctx.saveStatusEl.textContent,/Supabase.*2026-10-28/);
  assert.equal(reopened.ctx.isLoadingRows,false);
});

test('an offline reload shows the account cache with the read error and read-only state',async()=>{
  const h=loadHarness({fetchCampaignRows:async()=>{throw Error('offline');},campaignViewStore:{get:async(owner,date)=>{
    assert.equal(owner,'a');assert.equal(date,'2026-10-28');return {rows:[{name:'SUP',shopeeIncome:53068.79}],cachedAt:100};
  }}});
  assert.equal(await h.ctx.loadRowsForDate('2026-10-28'),false);
  assert.equal(h.state.rendered[0].shopeeIncome,53068.79);
  assert.equal(h.ctx.campaignViewReadFailed,true);
  assert.equal(h.ctx.isLoadingRows,false);
  assert.equal(h.state.locks.at(-1),true);
  assert.match(h.ctx.saveStatusEl.textContent,/offline/);
  assert.doesNotMatch(h.ctx.saveStatusEl.textContent,/ยังไม่มีข้อมูล/);
});

test('a read error without a cache keeps the known prior view instead of displaying an empty new day',async()=>{
  const prior=[{date:'2026-10-27',rows:[{name:'prior',shopeeIncome:55907}]}];
  const h=loadHarness({loadedCampaignView:{ownerId:'a',startDate:'2026-10-27',endDate:'2026-10-27'},currentChartRowsByDate:prior,
    fetchCampaignRows:async()=>{throw Error('server unavailable');}});
  h.state.rendered=[{name:'prior',shopeeIncome:55907}];
  assert.equal(await h.ctx.loadRowsForDate('2026-10-28'),false);
  assert.equal(h.ctx.selectedDate,'2026-10-27');
  assert.equal(h.ctx.dateInput.value,'2026-10-27');
  assert.equal(h.state.rendered[0].shopeeIncome,55907);
  assert.match(h.ctx.saveStatusEl.textContent,/server unavailable/);
  assert.equal(h.ctx.campaignViewReadFailed,true);
});

test('an offline pending edit wins over an older confirmed cache',async()=>{
  const h=loadHarness({fetchCampaignRows:async()=>{throw Error('offline');},
    campaignSync:{pending:()=>({rows:[{name:'SUP',shopeeIncome:99}]})},
    campaignViewStore:{get:async()=>{throw Error('pending data should be used first');}}});
  await h.ctx.loadRowsForDate('2026-10-28');
  assert.equal(h.state.rendered[0].shopeeIncome,99);
});

test('a slow date change locks edits before reading and retains the old selected date until it completes',async()=>{
  const read=deferred();const h=loadHarness({fetchCampaignRows:()=>read.promise});
  const load=h.ctx.loadRowsForDate('2026-10-28');
  assert.equal(h.ctx.isLoadingRows,true);
  assert.equal(h.state.locks[0],true);
  assert.equal(h.ctx.selectedDate,'2026-10-27');
  read.resolve([{name:'new',shopeeIncome:28}]);
  assert.equal(await load,true);
  assert.equal(h.ctx.selectedDate,'2026-10-28');
  assert.equal(h.ctx.isLoadingRows,false);
});

test('a superseded slow date response cannot replace the newer chosen date',async()=>{
  const slow=deferred();const h=loadHarness({fetchCampaignRows:date=>date==='2026-10-27'?slow.promise:Promise.resolve([{name:'latest',shopeeIncome:28}])});
  const first=h.ctx.loadRowsForDate('2026-10-27');
  assert.equal(await h.ctx.loadRowsForDate('2026-10-28'),true);
  slow.resolve([{name:'stale',shopeeIncome:27}]);
  assert.equal(await first,false);
  assert.equal(h.ctx.selectedDate,'2026-10-28');
  assert.equal(h.state.rendered[0].name,'latest');
  assert.equal(h.ctx.isLoadingRows,false);
});

test('an old account response cannot render after switching to another account',async()=>{
  const read=deferred();const h=loadHarness({fetchCampaignRows:()=>read.promise});
  const load=h.ctx.loadRowsForDate('2026-10-28');
  h.ctx.currentUser={id:'b'};h.ctx.latestLoadToken+=1;
  read.resolve([{name:'account a private row',shopeeIncome:123}]);
  assert.equal(await load,false);
  assert.equal(h.state.rendered.length,0);
  assert.equal(h.ctx.loadedCampaignView,null);
});

test('an empty cloud day is a confirmed empty day, while a read failure is not',async()=>{
  const h=loadHarness({fetchCampaignRows:async()=>[]});
  assert.equal(await h.ctx.loadRowsForDate('2026-10-28'),true);
  assert.equal(h.ctx.campaignViewReadFailed,false);
  assert.match(h.ctx.saveStatusEl.textContent,/ยังไม่มีข้อมูล/);
  assert.equal(h.ctx.loadedCampaignView.startDate,'2026-10-28');
});

function viewHarness(records=[],overrides={}) {
  const values=new Map();const filters=[];
  const query={select(){return this;},eq(...args){filters.push(['eq',...args]);return this;},gte(...args){filters.push(['gte',...args]);return this;},lte(...args){filters.push(['lte',...args]);return this;},order(){return this;},limit(){return Promise.resolve({data:records,error:null});}};
  const ctx=context(['readSavedView','saveCurrentView','restoreCampaignView'],{
    currentUser:{id:'a'},viewStorageKey:'view',campaignViewChoiceRevision:0,
    localStorage:{getItem:key=>values.get(key)||null},safeSetLocalStorage:(key,value)=>{values.set(key,value);return true;},
    dateInput:{value:'2026-10-29'},rangeEndInput:{value:'2026-10-29'},selectedDate:'2026-10-29',
    todayDate:()=> '2026-10-29',supabaseClient:{from:()=>query},campaignSync:{list:()=>[]},...overrides
  });
  return {ctx,values,filters};
}

test('a clean second device opens the latest nonempty real campaign date',async()=>{
  const h=viewHarness([{record_date:'2026-10-29',data:{appModule:'office'}},{record_date:'2026-10-29',data:[]},{record_date:'2026-10-28',data:[{name:'SUP'}]}]);
  await h.ctx.restoreCampaignView();
  assert.equal(h.ctx.dateInput.value,'2026-10-28');
  assert.equal(h.ctx.rangeEndInput.value,'2026-10-28');
  assert.ok(h.filters.some(filter=>filter[0]==='eq'&&filter[1]==='user_id'&&filter[2]==='a'));
  assert.ok(h.filters.some(filter=>filter[0]==='gte'&&filter[2]==='2000-01-01'));
});

test('saved date ranges are restored per account and do not leak to another account',async()=>{
  const h=viewHarness();h.ctx.saveCurrentView('2026-10-20','2026-10-28');
  h.ctx.currentUser={id:'b'};assert.equal(h.ctx.readSavedView(),null);
  h.ctx.saveCurrentView('2026-10-26','2026-10-26');
  h.ctx.currentUser={id:'a'};await h.ctx.restoreCampaignView();
  assert.equal(h.ctx.dateInput.value,'2026-10-20');assert.equal(h.ctx.rangeEndInput.value,'2026-10-28');
  h.ctx.currentUser={id:'b'};await h.ctx.restoreCampaignView();
  assert.equal(h.ctx.dateInput.value,'2026-10-26');
});

test('a signed-in import reads fresh cloud data instead of stale current-date DOM',async()=>{
  let reads=0;
  const ctx=context(['loadRowsForImportDate'],{activeCampaignImportOwner:'a',assertCampaignOwner:owner=>assert.equal(owner,'a'),
    currentUser:{id:'a'},isRangeView:false,selectedDate:'2026-10-28',readDailyStore:()=>({}),
    getRowsFromDom:()=>[{name:'SUP',shopeeIncome:0,lazadaIncome:0}],
    fetchCampaignRows:async()=>{reads+=1;return [{name:'SUP',shopeeIncome:50,lazadaIncome:20,adCost:45}];},
    setLocalRowsForDate(){},normalizeCampaignRow:row=>({...row})});
  const rows=await ctx.loadRowsForImportDate('2026-10-28');
  assert.equal(reads,1);assert.equal(rows[0].lazadaIncome,20);assert.equal(rows[0].adCost,45);
});

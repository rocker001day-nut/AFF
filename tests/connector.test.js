const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function setup(){
 const values={}, windows=[], notices=[];let listener,reads=0,granted=true;
 const chrome={runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onMessage:{addListener:f=>listener=f}},
 storage:{session:{setAccessLevel:async()=>{},get:async k=>({[k]:values[k]}),set:async r=>Object.assign(values,r),remove:async k=>delete values[k]}},
 windows:{create:async p=>windows.push(p)},tabs:{create:async()=>{},sendMessage:async(...p)=>notices.push(p)},
 permissions:{contains:async()=>granted},cookies:{getAllCookieStores:async()=>[{id:'0',tabIds:[7]}],getAll:async({domain})=>{reads++;return [{domain:'.'+domain,name:'session',value:'fixture-secret',httpOnly:true},{domain:'evil.example',name:'bad',value:'other'},{domain,name:'expired',value:'old',expirationDate:1}];}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../connector-extension/worker.js'),'utf8'),{chrome,crypto,URL,Date,Error});
 return {values,windows,notices,reads:()=>reads,deny:()=>granted=false,send:(msg,sender)=>new Promise(resolve=>listener(msg,sender,resolve))};
}
const account={id:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',platform:'shopee',label:'Test',external_account_id:'test-affiliate'};
const web={id:'test-extension',url:'https://aff-lyart.vercel.app/',frameId:0,tab:{id:7,incognito:false}};
const popup={id:'test-extension',url:'chrome-extension://test-extension/popup.html?request=x',tab:{id:8}};
async function begin(s,a=account){const r=await s.send({type:'BEGIN',account:a},web);assert.equal(r.ok,true);return new URL(s.windows.at(-1).url).searchParams.get('request');}
test('website request only opens consent window; cannot capture cookies',async()=>{
 const s=setup();const request=await begin(s);assert.equal(s.reads(),0);
 assert.equal((await s.send({type:'CAPTURE',request,confirmed:true,account},web)).ok,false);assert.equal(s.reads(),0);
});
test('foreign origins, frames, incognito and spoofed extension sender are rejected',async()=>{
 const s=setup();for(const sender of [{...web,url:'https://aff-lyart.vercel.app.evil.test/'},{...web,frameId:1},{...web,tab:{id:7,incognito:true}},{...popup,id:'evil-extension'}])assert.equal((await s.send({type:'BEGIN',account},sender)).ok,false);
 assert.equal(s.reads(),0);
});
test('capture needs permission and explicit confirmation',async()=>{
 const s=setup(),request=await begin(s);
 assert.equal((await s.send({type:'CAPTURE',request,confirmed:false},popup)).ok,false);
 s.deny();assert.equal((await s.send({type:'CAPTURE',request,confirmed:true},popup)).ok,false);assert.equal(s.reads(),0);
});
test('raw cookies stay in trusted memory; page only receives metadata; replay denied',async()=>{
 const s=setup(),request=await begin(s);const r=await s.send({type:'CAPTURE',request,confirmed:true},popup);
 assert.equal(r.ok,true);assert.equal(r.session.cookieCount,1);assert.equal(JSON.stringify(r).includes('fixture-secret'),false);
 assert.equal(JSON.stringify(s.notices).includes('fixture-secret'),false);
 const status=await s.send({type:'STATUS',account},web);assert.equal(status.session.status,'captured_unverified');assert.equal(JSON.stringify(status).includes('fixture-secret'),false);
 assert.equal((await s.send({type:'CAPTURE',request,confirmed:true},popup)).ok,false);
 assert.equal(s.values['session:'+account.userId+':'+account.id].cookies[0].value,'fixture-secret');
});
test('multiple accounts remain separate and reconnect replaces only selected account',async()=>{
 const s=setup(),second={...account,id:'33333333-3333-4333-8333-333333333333',platform:'lazada'};
 for(const a of [account,second,account]){const request=await begin(s,a);assert.equal((await s.send({type:'CAPTURE',request,confirmed:true},popup)).ok,true);}
 const records=Object.entries(s.values).filter(([k])=>k.startsWith('session:'));assert.equal(records.length,2);
 assert.equal(records.find(([k])=>k.endsWith(second.id))[1].cookies[0].domain,'.lazada.co.th');
});

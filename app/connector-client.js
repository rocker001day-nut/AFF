(() => {
 const channel='AFF_CONNECTOR_V1',requests=new Map(),accounts=new Map();
 let checking=false;
 function call(type,account){return new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID();const timer=setTimeout(()=>{requests.delete(requestId);reject(Error('ไม่พบ AFF Connector ในเบราว์เซอร์นี้ · เปิด AFF ในเบราว์เซอร์ที่ติดตั้งส่วนขยาย แล้วรีโหลดหน้า'));},5000);
  requests.set(requestId,{resolve,reject,timer});window.postMessage({channel,direction:'request',requestId,type,account},location.origin);
 });}
 function status(id,text){const node=document.querySelector(`[data-session-status="${id}"]`);if(node){node.textContent=text;node.style.whiteSpace='pre-line';}}
 function show(account,session){
  const who=`${account.label} · ${account.platform} · รหัส ${account.external_account_id}`;
  if(!session||session.accountId!==account.id||session.platform!==account.platform||!(session.cookieCount>0)){
   status(account.id,`ยังไม่มีเซสชันในเบราว์เซอร์นี้\n${who}\nกดเชื่อม / รับเซสชันใหม่ แล้วล็อกอินบัญชีนี้`);return;
  }
  const time=new Date(session.capturedAt);
  status(account.id,`รับคุกกี้แล้วในเครื่อง · ${session.cookieCount} รายการ\nบัญชีที่ผูกไว้: ${who}\nรับล่าสุด: ${Number.isNaN(time.getTime())?'ไม่ทราบเวลา':time.toLocaleString('th-TH')}\nยังไม่ยืนยันตัวตนบัญชีจากรายงานหรือการดึงยอดสำเร็จ\nเซสชันหายเมื่อปิดเบราว์เซอร์ทั้งหมด และอาจหมดอายุก่อนนั้น`);
 }
 async function loadAccounts(){
  const client=window.__affSupabaseClient;if(!client)throw Error('กรุณาเข้าสู่ระบบ AFF ก่อน');
  const {data}=await client.auth.getSession();if(!data.session)throw Error('กรุณาเข้าสู่ระบบ AFF ก่อน');
  const res=await fetch('/api/accounts',{headers:{Authorization:`Bearer ${data.session.access_token}`}});const body=await res.json();if(!res.ok)throw Error(body.message||'โหลดบัญชีไม่สำเร็จ');
  accounts.clear();for(const a of body.accounts||[])accounts.set(a.id,{...a,userId:data.session.user.id});return [...accounts.values()];
 }
 async function refresh(){
  if(checking||document.hidden||document.getElementById('autoSyncPage')?.hidden||!document.querySelector('[data-session-status]'))return;
  checking=true;
  try{
   const list=await loadAccounts();await call('PING');
   await Promise.all(list.map(async account=>{try{show(account,(await call('STATUS',account)).session);}catch(e){status(account.id,e.message);}}));
  }catch(e){for(const node of document.querySelectorAll('[data-session-status]'))status(node.dataset.sessionStatus,e.message);}
  finally{checking=false;}
 }
 window.addEventListener('message',async e=>{
  if(e.source!==window||e.origin!==location.origin||e.data?.channel!==channel)return;const m=e.data;
  if(m.direction==='response'){const r=requests.get(m.requestId);if(!r)return;clearTimeout(r.timer);requests.delete(m.requestId);m.result?.ok?r.resolve(m.result):r.reject(Error(m.result?.message||'เชื่อมไม่สำเร็จ'));}
  if(m.direction==='event'&&m.session){
   const {data}=await window.__affSupabaseClient.auth.getSession();if(data.session?.user.id!==m.userId)return;
   const account=accounts.get(m.session.accountId);if(account&&account.userId===m.userId)show(account,m.session);else refresh();
  }
 });
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-connect-account]');if(!button)return;const id=button.dataset.connectAccount;button.disabled=true;
  try{
   const account=(await loadAccounts()).find(a=>a.id===id);if(!account)throw Error('ไม่พบบัญชี');
   await call('BEGIN',account);status(id,`กำลังรอรับเซสชันใหม่\n${account.label} · ${account.platform} · รหัส ${account.external_account_id}\nล็อกอินและยืนยันบัญชีในหน้าต่างส่วนขยาย`);
  }catch(err){status(id,err.message);}finally{button.disabled=false;}
 });
 const container=document.getElementById('multiAccounts');
 if(container)new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('[data-session-status]')||n.querySelector?.('[data-session-status]')))))refresh();}).observe(container,{childList:true,subtree:true});
 document.addEventListener('aff:auto-sync:open',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);setInterval(refresh,20000);refresh();
})();

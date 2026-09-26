(() => {
 const channel='AFF_CONNECTOR_V1', requests=new Map();
 function call(type,account){return new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID();const timer=setTimeout(()=>{requests.delete(requestId);reject(Error('ยังไม่พบส่วนขยาย AFF Connector ในเบราว์เซอร์นี้ ติดตั้งแล้วรีโหลดหน้าเว็บก่อน'));},5000);
  requests.set(requestId,{resolve,reject,timer});window.postMessage({channel,direction:'request',requestId,type,account},location.origin);
 });}
 function status(id,text){const node=document.querySelector(`[data-session-status="${id}"]`);if(node)node.textContent=text;}
 window.addEventListener('message',async e=>{
  if(e.source!==window||e.origin!==location.origin||e.data?.channel!==channel)return;
  const m=e.data;
  if(m.direction==='response'){
   const r=requests.get(m.requestId);if(!r)return;clearTimeout(r.timer);requests.delete(m.requestId);m.result?.ok?r.resolve(m.result):r.reject(Error(m.result?.message||'เชื่อมไม่สำเร็จ'));
  }
  if(m.direction==='event'&&m.session?.status==='captured_unverified'){
   const {data}=await window.__affSupabaseClient.auth.getSession();if(data.session?.user.id!==m.userId)return;
   status(m.session.accountId,'รับเซสชันใหม่แล้วในเครื่อง · ยังไม่ยืนยันการดึงรายงาน');
  }
 });
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-connect-account]');if(!button)return;
  const id=button.dataset.connectAccount;button.disabled=true;
  try{
   const {data}=await window.__affSupabaseClient.auth.getSession();if(!data.session)throw Error('กรุณาเข้าสู่ระบบ AFF ก่อน');
   const res=await fetch('/api/accounts',{headers:{Authorization:`Bearer ${data.session.access_token}`}});const body=await res.json();if(!res.ok)throw Error(body.message||'โหลดบัญชีไม่สำเร็จ');
   const account=body.accounts.find(a=>a.id===id);if(!account)throw Error('ไม่พบบัญชี');
   await call('BEGIN',{...account,userId:data.session.user.id});status(id,'เปิดหน้าต่างเชื่อมแล้ว · ล็อกอินและยืนยันบัญชีในส่วนขยาย');
  }catch(err){status(id,err.message);}finally{button.disabled=false;}
 });
})();

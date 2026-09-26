(() => {
 const channel='AFF_CONNECTOR_V1';
 window.addEventListener('message',async e=>{
  if(e.source!==window||e.origin!=='https://aff-lyart.vercel.app'||e.data?.channel!==channel||e.data.direction!=='request')return;
  const m=e.data;if(!['PING','BEGIN','STATUS'].includes(m.type)||typeof m.requestId!=='string')return;
  try{const result=await chrome.runtime.sendMessage({type:m.type,account:m.account});window.postMessage({channel,direction:'response',requestId:m.requestId,result},e.origin);}
  catch{window.postMessage({channel,direction:'response',requestId:m.requestId,result:{ok:false,message:'กรุณารีโหลดหน้า AFF หลังติดตั้งส่วนขยาย'}},e.origin);}
 });
 chrome.runtime.onMessage.addListener(m=>{if(m.type==='SESSION_UPDATED')window.postMessage({channel,direction:'event',session:m.session,userId:m.userId},'https://aff-lyart.vercel.app');});
})();

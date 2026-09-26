const AFF='https://aff-lyart.vercel.app';
const platforms={shopee:{domain:'shopee.co.th',url:'https://affiliate.shopee.co.th/dashboard'},lazada:{domain:'lazada.co.th',url:'https://adsense.lazada.co.th/'}};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key=a=>`session:${a.userId}:${a.id}`;
const metadata=r=>({accountId:r.account.id,platform:r.account.platform,capturedAt:r.capturedAt,cookieCount:r.cookies.length,status:'captured_unverified'});
function validAccount(a){return a&&uuid.test(a.id)&&uuid.test(a.userId)&&Object.hasOwn(platforms,a.platform)&&typeof a.label==='string'&&a.label.length<=80&&typeof a.external_account_id==='string'&&a.external_account_id.length<=120;}
function origin(url){try{return new URL(url).origin;}catch{return '';}}
async function trustedStorage(){await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});}
async function pending(id){const r=(await chrome.storage.session.get('pending:'+id))['pending:'+id];if(!r||Date.now()-r.createdAt>600000)throw Error('หมดเวลารอ กดเชื่อมใน AFF ใหม่');return r;}
async function handle(msg,sender){
 await trustedStorage();
 const web=sender.tab&&!sender.tab.incognito&&origin(sender.url)===AFF&&sender.frameId===0;
 const popup=sender.id===chrome.runtime.id&&sender.url?.split('?')[0]===chrome.runtime.getURL('popup.html');
 if(web){
  if(msg.type==='PING')return {ok:true,version:'0.1.0'};
  if(!validAccount(msg.account))throw Error('ข้อมูลบัญชีไม่ถูกต้อง');
  if(msg.type==='STATUS'){const r=(await chrome.storage.session.get(key(msg.account)))[key(msg.account)];return {ok:true,session:r?metadata(r):null};}
  if(msg.type!=='BEGIN')throw Error('คำสั่งไม่รองรับ');
  const id=crypto.randomUUID();await chrome.storage.session.set({['pending:'+id]:{account:msg.account,tabId:sender.tab.id,createdAt:Date.now()}});
  await chrome.windows.create({url:chrome.runtime.getURL('popup.html')+'?request='+id,type:'popup',width:480,height:650});
  return {ok:true,pending:true};
 }
 if(!popup)throw Error('ไม่อนุญาต');
 const r=await pending(msg.request);
 if(msg.type==='DETAILS')return {ok:true,account:r.account,url:platforms[r.account.platform].url};
 if(msg.type==='OPEN'){await chrome.tabs.create({url:platforms[r.account.platform].url});return {ok:true};}
 if(msg.type!=='CAPTURE'||msg.confirmed!==true)throw Error('กรุณายืนยันบัญชีที่เปิดอยู่');
 const config=platforms[r.account.platform];
 if(!await chrome.permissions.contains({permissions:['cookies'],origins:[`https://*.${config.domain}/*`]}))throw Error('ยังไม่ได้อนุญาตสิทธิ์คุกกี้');
 // Never send raw cookie values to the AFF page or any server.
 const stores=await chrome.cookies.getAllCookieStores();
 const mainStore=stores.find(s=>s.tabIds.includes(r.tabId));
 if(!mainStore)throw Error('ไม่พบโปรไฟล์เบราว์เซอร์ปกติ');
 const cookies=(await chrome.cookies.getAll({domain:config.domain,storeId:mainStore.id})).filter(c=>{
  const d=c.domain.replace(/^\./,'');return (d===config.domain||d.endsWith('.'+config.domain))&&(!c.expirationDate||c.expirationDate>Date.now()/1000);
 });
 if(!cookies.length)throw Error('ไม่พบคุกกี้ กรุณาล็อกอินแพลตฟอร์มในเบราว์เซอร์นี้ก่อน');
 const record={account:r.account,capturedAt:new Date().toISOString(),cookies};
 await chrome.storage.session.set({[key(r.account)]:record});await chrome.storage.session.remove('pending:'+msg.request);
 const session=metadata(record);
 try{await chrome.tabs.sendMessage(r.tabId,{type:'SESSION_UPDATED',session,userId:r.account.userId},{frameId:0});}catch{}
 return {ok:true,session};
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{handle(msg,sender).then(reply).catch(e=>reply({ok:false,message:e.message}));return true;});

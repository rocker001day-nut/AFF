const request=new URLSearchParams(location.search).get('request');
const $=id=>document.getElementById(id);let account;
const send=async type=>{const r=await chrome.runtime.sendMessage({type,request,confirmed:$('confirmed').checked});if(!r.ok)throw Error(r.message);return r;};
if(request)send('DETAILS').then(r=>{account=r.account;$('account').textContent=`${account.platform} · ${account.label} · ${account.external_account_id}`;$('open').disabled=false;}).catch(e=>$('status').textContent=e.message);
else $('status').textContent='เปิดหน้า AFF → Auto Sync → กดเชื่อมเซสชันที่บัญชีที่ต้องการ';
$('open').onclick=()=>send('OPEN').catch(e=>$('status').textContent=e.message);
$('confirmed').onchange=()=>{$('capture').disabled=!account||!$('confirmed').checked;};
$('capture').onclick=async()=>{
 $('capture').disabled=true;
 try{
  const domain=account.platform==='shopee'?'shopee.co.th':'lazada.co.th';
  const granted=await chrome.permissions.request({permissions:['cookies'],origins:[`https://*.${domain}/*`]});
  if(!granted)throw Error('ยังไม่ได้อนุญาตสิทธิ์');
  const r=await send('CAPTURE');$('status').textContent=`รับเซสชันใหม่แล้ว (${r.session.cookieCount} คุกกี้) กลับหน้า AFF ได้ · ยังไม่ทดสอบดึงรายงาน`;
 }catch(e){$('status').textContent=e.message;$('capture').disabled=false;}
};

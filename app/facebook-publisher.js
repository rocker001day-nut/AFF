(function(root){
  'use strict';
  const KEY='aff-facebook-publisher-draft-v2';
  const ENDPOINT='https://txbsrtunejnqaheuohck.supabase.co/functions/v1/facebook-publisher';
  const $=id=>root.document&&root.document.getElementById(id);
  let imageUrl='',connectedPages=[],busy=false;
  function validUrl(value){try{const u=new URL(String(value||'').trim());return u.protocol==='https:'&&u.hostname?u:null}catch{return null}}
  function planTimes(start,delaySeconds,pages){
    const base=Number(start),delay=Number(delaySeconds);
    if(!Number.isFinite(base)||!Number.isInteger(delay)||delay<5||delay>3600)throw Error('ดีเลย์ต้องอยู่ระหว่าง 5 ถึง 3,600 วินาที');
    const unique=[...new Set(pages.map(String).map(x=>x.trim()).filter(Boolean))];
    return unique.map((page,index)=>({page,at:new Date(base+index*delay*1000).toISOString()}));
  }
  root.AffPublisherDraft={planTimes,validUrl};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.AffPublisherDraft;
  if(!$('facebookPublisherPage'))return;
  function status(message,error=false){$('fpStatus').textContent=message;$('fpStatus').dataset.error=String(error)}
  function cardStatus(message,error=false){$('fpCardStatus').textContent=message;$('fpCardStatus').dataset.error=String(error)}
  function selectedPages(){return [...$('fpPages').querySelectorAll('input:checked')].map(el=>el.value)}
  async function api(action,method='GET',body,contentType){
    const client=root.__affSupabaseClient||root.supabaseClient;
    if(!client)throw Error('ระบบล็อกอินยังไม่พร้อม');
    const session=await client.auth.getSession();
    const token=session.data?.session?.access_token;
    if(!token)throw Error('กรุณาเข้าสู่ระบบ Google บนเว็บ AFF ก่อน');
    const response=await fetch(ENDPOINT+'?action='+encodeURIComponent(action),{
      method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':contentType||'application/json'}:{})},
      body:body?(contentType?body:JSON.stringify(body)):undefined,cache:'no-store'
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok===false)throw Error(data.message||'API ขัดข้อง ('+response.status+')');
    return data;
  }
  function render(){
    const caption=$('fpCaption').value.trim(),destination=validUrl($('fpDestination').value),delay=Number($('fpDelay').value);
    $('fpPreviewText').textContent=caption||'ข้อความโพสต์จะแสดงตรงนี้';
    $('fpPreviewImage').src=imageUrl||'';
    $('fpPreviewImage').hidden=!imageUrl;$('fpImageEmpty').hidden=!!imageUrl;
    $('fpPreviewDomain').textContent=destination?destination.hostname.toUpperCase():'URL ปลายทาง';
    $('fpPreviewLink').href=destination?destination.href:'#';
    $('fpPreviewLink').setAttribute('aria-disabled',String(!destination));
    const host=$('fpQueue');host.replaceChildren();
    const pages=selectedPages();let planned=[];
    try{
      const start=new Date($('fpStart').value).getTime();
      if(!Number.isFinite(start))throw Error('เลือกเวลาเริ่มโพสต์');
      planned=planTimes(start,delay,pages);
    }catch(error){
      const item=root.document.createElement('li');item.textContent=error.message;host.appendChild(item);
      $('fpQueueCount').textContent='ตรวจเวลาและดีเลย์';return;
    }
    $('fpQueueCount').textContent=pages.length+' เพจ · ห่างกัน '+delay+' วินาที';
    if(!planned.length){const item=root.document.createElement('li');item.textContent='เชื่อม Facebook แล้วเลือกเพจ';host.appendChild(item);return}
    planned.forEach((job,index)=>{
      const item=root.document.createElement('li'),number=root.document.createElement('strong'),body=root.document.createElement('span'),time=root.document.createElement('time');
      number.textContent=String(index+1).padStart(2,'0');
      body.textContent=connectedPages.find(page=>page.id===job.page)?.name||job.page;
      time.dateTime=job.at;
      time.textContent=new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(job.at));
      item.append(number,body,time);host.appendChild(item);
    });
  }
  function saveDraft(){
    const draft={caption:$('fpCaption').value,destination:$('fpDestination').value,start:$('fpStart').value,delay:$('fpDelay').value,selectedPageIds:selectedPages()};
    try{root.localStorage.setItem(KEY,JSON.stringify(draft));status('บันทึกร่างแล้ว · เลือกรูปใหม่เมื่อกลับมา')}
    catch{status('บันทึกร่างไม่สำเร็จ',true)}
  }
  function restoreDraft(){
    try{
      const draft=JSON.parse(root.localStorage.getItem(KEY)||'{}');
      $('fpCaption').value=draft.caption||'';$('fpDestination').value=draft.destination||'';
      $('fpStart').value=draft.start||'';$('fpDelay').value=draft.delay||'30';
      return draft.selectedPageIds||[];
    }catch{return []}
  }
  const saved=restoreDraft();
  async function loadPages(){
    try{
      const data=await api('status');
      connectedPages=data.pages||[];
      $('fpProviderSetup').hidden=!data.canConfigure||data.oauthReady;
      $('fpProviderSetup').open=!!data.canConfigure&&!data.oauthReady;
      $('fpAppSetup').hidden=!data.canConfigure||data.oauthReady;
      $('fpConnectionMode').textContent=!data.oauthReady?'ยังไม่เปิดการเชื่อม · เจ้าของเว็บตั้งค่าหนึ่งครั้งด้านล่าง':data.provider==='upload-post'?'เชื่อมผ่าน Upload-Post · เลือกเพจใน Facebook ได้':'เชื่อมผ่าน Meta App ของ AFF';
      $('fpConnect').disabled=!data.oauthReady;
      $('fpConnect').title=data.oauthReady?'เชื่อมด้วยบัญชี Facebook ที่ล็อกอินในเบราว์เซอร์':'เจ้าของเว็บตั้งค่าการเชื่อม Facebook หนึ่งครั้งก่อน';
      $('fpPages').replaceChildren();
      for(const page of connectedPages){
        const label=root.document.createElement('label'),check=root.document.createElement('input');
        check.type='checkbox';check.value=page.id;check.checked=saved.includes(page.id);
        check.addEventListener('change',render);
        label.append(check,root.document.createTextNode(page.name||page.id));
        $('fpPages').appendChild(label);
      }
      if(!connectedPages.length)$('fpPages').textContent='ยังไม่พบเพจ กด “เชื่อม Facebook และดึงเพจ”';
      status(data.syncError||(
        connectedPages.length?'เลือกเพจที่ต้องการโพสต์ ('+connectedPages.length+' เพจ)':
        data.oauthReady?'กดเชื่อม Facebook เพื่อดึงเพจที่จัดการได้':data.canConfigure?'ขั้นตอนแรก: ตั้งค่าระบบเชื่อมเพจในช่องที่เปิดอยู่ด้านล่าง':'ยังเชื่อม Facebook ไม่ได้ · แจ้งเจ้าของเว็บเปิดการเชื่อมเพจก่อน'),!!data.syncError||!connectedPages.length);
    }catch(error){$('fpPages').textContent='ยังโหลดเพจไม่ได้';status(error.message,true)}
    render();
  }
  async function connect(){
    try{
      $('fpConnect').disabled=true;
      const data=await api('login','POST',{});
      const connectUrl=new URL(data.url||'');
      if(connectUrl.protocol!=='https:'||!['www.facebook.com','app.upload-post.com'].includes(connectUrl.hostname))throw Error('ลิงก์เชื่อม Facebook ไม่ถูกต้อง');
      root.location.assign(data.url);
    }catch(error){status(error.message,true);$('fpConnect').disabled=false}
  }
  async function saveProvider(){
    const apiKey=$('fpProviderKey').value.trim(),button=$('fpSaveProvider');
    if(apiKey.length<12)return status('ใส่ API key ของ Upload-Post เพื่อเปิดการเชื่อมเพจ',true);
    button.disabled=true;
    try{
      status('กำลังตรวจ API key ของ Upload-Post…');
      await api('configure-upload-post','POST',{apiKey});
      $('fpProviderKey').value='';
      await loadPages();
      status('เชื่อมระบบแล้ว กด “เชื่อม Facebook และดึงเพจ”');
    }catch(error){status(error.message,true)}
    finally{button.disabled=false}
  }
  async function saveApp(){
    const appId=$('fpAppId').value.trim(),appSecret=$('fpAppSecret').value.trim();
    if(!/^[0-9]{5,30}$/.test(appId)||appSecret.length<20)return status('ตรวจ App ID และ App Secret จาก Meta for Developers',true);
    const button=$('fpSaveApp');
    button.disabled=true;
    try{
      status('กำลังตรวจ App ID กับ Meta…');
      await api('configure','POST',{appId,appSecret});
      $('fpAppSecret').value='';
      status('ตั้งค่าแอปแล้ว กดเชื่อม Facebook เพื่อดึงเพจ');
      await loadPages();
    }catch(error){status(error.message,true)}
    finally{button.disabled=false}
  }
  async function loadJobs(){
    try{
      const data=await api('jobs'),list=$('fpResults');
      list.replaceChildren();
      const latest=data.jobs||[];
      if(!latest.length){const li=root.document.createElement('li');li.textContent='ยังไม่มีโพสต์ที่ส่ง';list.appendChild(li);return}
      for(const job of latest.slice(-40).reverse()){
        const li=root.document.createElement('li'),name=root.document.createElement('strong'),detail=root.document.createElement('span'),time=root.document.createElement('time');
        name.textContent=connectedPages.find(p=>p.id===job.page_id)?.name||job.page_id;
        detail.textContent=({'queued':'รอส่ง','processing':'กำลังส่ง','posted':'โพสต์สำเร็จ','failed':'ไม่สำเร็จ','uncertain':'รอตรวจผล'}[job.status]||job.status)+(job.facebook_post_id?' · '+job.facebook_post_id:'')+(job.error?' · '+job.error:'');
        time.textContent=new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(job.scheduled_at));
        li.append(name,detail,time);
        if(job.status==='posted'&&job.permalink){const link=root.document.createElement('a');link.href=job.permalink;link.target='_blank';link.rel='noopener noreferrer';link.textContent='ดูโพสต์บน Facebook';li.appendChild(link)}
        list.appendChild(li);
      }
    }catch(error){status(error.message,true)}
  }
  async function createCard(){
    if(busy)return;
    const file=$('fpImage').files?.[0],destination=validUrl($('fpDestination').value);
    if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>8*1024*1024)return cardStatus('เลือกภาพ JPG, PNG หรือ WebP ไม่เกิน 8 MB',true);
    if(!destination)return cardStatus('กรุณาใส่ลิงก์ปลายทาง HTTPS',true);
    busy=true;$('fpCreateCard').disabled=true;
    try{
      cardStatus('กำลังอัปโหลดภาพเพื่อสร้างลิงก์การ์ด…');
      const image=await api('image','POST',file,file.type);
      const result=await api('create-card','POST',{imagePath:image.path,caption:$('fpCaption').value,destination:destination.href});
      $('fpCardLink').href=result.cardUrl;$('fpCardLink').textContent=result.cardUrl;
      $('fpCardReady').hidden=false;
      cardStatus('สร้างลิงก์แล้ว · คัดลอกไปวางในโพสต์ของเพจ Facebook เพื่อทดสอบ');
    }catch(error){cardStatus(error.message,true)}
    finally{busy=false;$('fpCreateCard').disabled=false}
  }
  async function publish(now){
    if(busy)return;
    const file=$('fpImage').files?.[0],destination=validUrl($('fpDestination').value),pages=selectedPages(),delay=Number($('fpDelay').value);
    if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024||!file.size)return status('เลือกภาพ JPG, PNG หรือ WebP ไม่เกิน 8 MB',true);
    if(!destination)return status('กรุณาใส่ลิงก์ปลายทาง HTTPS',true);
    if(!pages.length)return status('เลือกเพจอย่างน้อยหนึ่งเพจ',true);
    if(!Number.isInteger(delay)||delay<5||delay>3600)return status('ดีเลย์ต้องอยู่ระหว่าง 5 ถึง 3,600 วินาที',true);
    const start=now?new Date(Date.now()+20000):new Date($('fpStart').value);
    if(!Number.isFinite(start.getTime())||start.getTime()<Date.now()+10000)return status('เวลาเริ่มต้องห่างอย่างน้อย 10 วินาที',true);
    busy=true;$('fpPublishNow').disabled=true;$('fpSchedule').disabled=true;
    try{
      status('กำลังอัปโหลดภาพ…');
      const image=await api('image','POST',file,file.type);
      status('กำลังสร้างคิวโพสต์…');
      const startAt=now?new Date(Date.now()+20000):start;
      const result=await api('enqueue','POST',{imagePath:image.path,caption:$('fpCaption').value,destination:destination.href,pages,delay,start:startAt.toISOString()});
      status('เข้าคิว '+result.jobs.length+' เพจแล้ว · รอ Facebook ตอบรับและรีเฟรชผล');
      await loadJobs();
    }catch(error){status(error.message,true)}
    finally{busy=false;$('fpPublishNow').disabled=false;$('fpSchedule').disabled=false}
  }
  $('fpImage').addEventListener('change',event=>{
    const file=event.target.files?.[0];
    if(imageUrl)URL.revokeObjectURL(imageUrl);
    imageUrl='';$('fpCardReady').hidden=true;
    if(file){
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024){event.target.value='';cardStatus('ใช้ JPG, PNG หรือ WebP ไม่เกิน 8 MB',true)}
      else{imageUrl=URL.createObjectURL(file);$('fpImageName').textContent=file.name}
    }
    render();
  });
  $('fpPreviewLink').addEventListener('click',event=>{if(!validUrl($('fpDestination').value))event.preventDefault()});
  ['fpCaption','fpDestination','fpStart','fpDelay'].forEach(id=>$(id).addEventListener('input',render));
  ['fpCaption','fpDestination'].forEach(id=>$(id).addEventListener('input',()=>{$('fpCardReady').hidden=true}));
  $('fpSaveDraft').addEventListener('click',saveDraft);
  $('fpCreateCard').addEventListener('click',createCard);
  $('fpCopyCard').addEventListener('click',async()=>{
    try{await root.navigator.clipboard.writeText($('fpCardLink').href);cardStatus('คัดลอกลิงก์การ์ดแล้ว · วางในโพสต์ของเพจ Facebook ได้เลย')}
    catch{cardStatus('คัดลอกอัตโนมัติไม่ได้ กดลิงก์ค้างไว้เพื่อคัดลอก',true)}
  });
  $('fpConnect').addEventListener('click',connect);
  $('fpSaveApp').addEventListener('click',saveApp);
  $('fpSaveProvider').addEventListener('click',saveProvider);
  $('fpPublishNow').addEventListener('click',()=>publish(true));
  $('fpSchedule').addEventListener('click',()=>publish(false));
  $('fpRefreshResults').addEventListener('click',loadJobs);
  if(!$('fpStart').value){const soon=new Date(Date.now()+120000),local=new Date(soon.getTime()-soon.getTimezoneOffset()*60000);$('fpStart').value=local.toISOString().slice(0,16)}
  render();
  root.document.addEventListener('aff:publisher:open',()=>{loadPages();loadJobs()});
  if(root.location.hash==='#publisher')root.document.querySelector('[data-page-target="publisher"]')?.click();
  if(!$('facebookPublisherPage').hidden){loadPages();loadJobs()}
  root.setInterval(()=>{if(!$('facebookPublisherPage').hidden&&connectedPages.length)loadJobs()},10000);
  root.addEventListener('beforeunload',()=>{if(imageUrl)URL.revokeObjectURL(imageUrl)});
})(typeof window!=='undefined'?window:globalThis);

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
      $('fpPages').replaceChildren();
      for(const page of connectedPages){
        const label=root.document.createElement('label'),check=root.document.createElement('input');
        check.type='checkbox';check.value=page.id;check.checked=saved.includes(page.id);
        check.addEventListener('change',render);
        label.append(check,root.document.createTextNode(page.name||page.id));
        $('fpPages').appendChild(label);
      }
      if(!connectedPages.length)$('fpPages').textContent='ยังไม่พบเพจ กด “เชื่อม Facebook และดึงเพจ”';
      status(connectedPages.length?'เลือกเพจที่ต้องการโพสต์ ('+connectedPages.length+' เพจ)':
        data.oauthReady?'กดเชื่อม Facebook เพื่อดึงเพจที่จัดการได้':'ยังต้องตั้งค่า Meta App ของระบบก่อนเชื่อม Facebook',!connectedPages.length);
    }catch(error){$('fpPages').textContent='ยังโหลดเพจไม่ได้';status(error.message,true)}
    render();
  }
  async function connect(){
    try{
      $('fpConnect').disabled=true;
      const data=await api('login','POST',{});
      if(!data.url||!data.url.startsWith('https://www.facebook.com/'))throw Error('ลิงก์ Facebook Login ไม่ถูกต้อง');
      root.location.assign(data.url);
    }catch(error){status(error.message,true);$('fpConnect').disabled=false}
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
        li.append(name,detail,time);list.appendChild(li);
      }
    }catch(error){status(error.message,true)}
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
      const result=await api('enqueue','POST',{imagePath:image.path,caption:$('fpCaption').value,destination:destination.href,pages,delay,start:start.toISOString()});
      status('เข้าคิว '+result.jobs.length+' เพจแล้ว · รอ Facebook ตอบรับและรีเฟรชผล');
      await loadJobs();
    }catch(error){status(error.message,true)}
    finally{busy=false;$('fpPublishNow').disabled=false;$('fpSchedule').disabled=false}
  }
  $('fpImage').addEventListener('change',event=>{
    const file=event.target.files?.[0];
    if(imageUrl)URL.revokeObjectURL(imageUrl);
    imageUrl='';
    if(file){
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024){event.target.value='';status('ใช้ JPG, PNG หรือ WebP ไม่เกิน 8 MB',true)}
      else{imageUrl=URL.createObjectURL(file);$('fpImageName').textContent=file.name}
    }
    render();
  });
  $('fpPreviewLink').addEventListener('click',event=>{if(!validUrl($('fpDestination').value))event.preventDefault()});
  ['fpCaption','fpDestination','fpStart','fpDelay'].forEach(id=>$(id).addEventListener('input',render));
  $('fpSaveDraft').addEventListener('click',saveDraft);
  $('fpConnect').addEventListener('click',connect);
  $('fpPublishNow').addEventListener('click',()=>publish(true));
  $('fpSchedule').addEventListener('click',()=>publish(false));
  $('fpRefreshResults').addEventListener('click',loadJobs);
  if(!$('fpStart').value){const soon=new Date(Date.now()+120000),local=new Date(soon.getTime()-soon.getTimezoneOffset()*60000);$('fpStart').value=local.toISOString().slice(0,16)}
  render();
  root.document.addEventListener('aff:publisher:open',()=>{loadPages();loadJobs()});
  if(root.location.hash==='#publisher')root.document.querySelector('[data-page-target="publisher"]')?.click();
  if(!$('facebookPublisherPage').hidden){loadPages();loadJobs()}
  root.addEventListener('beforeunload',()=>{if(imageUrl)URL.revokeObjectURL(imageUrl)});
})(typeof window!=='undefined'?window:globalThis);

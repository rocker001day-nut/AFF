import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const BASE = Deno.env.get('SUPABASE_URL');
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(BASE, SERVICE, {auth:{persistSession:false,autoRefreshToken:false}});
const BUCKET = 'aff-facebook-cards';
const GRAPH = 'https://graph.facebook.com/v26.0';
const UPLOAD_POST = 'https://api.upload-post.com';
const CARD_ORIGIN = 'https://aff-lyart.vercel.app';
const cardUrl = id => CARD_ORIGIN+'/card/'+id;
const originAllowed = origin => !origin || origin === 'https://aff-lyart.vercel.app' || /^https:\/\/aff-[a-z0-9-]+\.vercel\.app$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin);
function headers(req, type='application/json; charset=utf-8') {
  const origin=req.headers.get('origin')||'';
  return {'Content-Type':type,'Cache-Control':'no-store','Vary':'Origin',...(origin && originAllowed(origin)?{'Access-Control-Allow-Origin':origin}:{}) ,'Access-Control-Allow-Headers':'authorization, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
}
function send(req,data,status=200){return new Response(JSON.stringify(data),{status,headers:headers(req)})}
function problem(message,status=400){return Object.assign(new Error(message),{status})}
function check(error){if(error)throw problem(error.message,500)}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function validDestination(s){try{const u=new URL(String(s));if(u.protocol!=='https:'||u.username||u.password||u.hostname==='localhost'||/^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/.test(u.hostname))return null;return u.href}catch{return null}}
async function encrypt(value){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('aff-facebook-card-v1:'+SERVICE));
  const key=await crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt']);
  const nonce=crypto.getRandomValues(new Uint8Array(12));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...nonce,...cipher));
}
async function decrypt(value){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('aff-facebook-card-v1:'+SERVICE));
  const key=await crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['decrypt']);
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12)));
}
async function metaConfig(){
  const appId=Deno.env.get('META_APP_ID'),appSecret=Deno.env.get('META_APP_SECRET');
  if(appId&&appSecret)return {appId,appSecret};
  const row=await admin.from('facebook_publisher_internal').select('meta_app_id,meta_app_secret_enc').eq('id',1).single();check(row.error);
  if(!row.data.meta_app_id||!row.data.meta_app_secret_enc)return null;
  return {appId:row.data.meta_app_id,appSecret:await decrypt(row.data.meta_app_secret_enc)};
}
async function uploadPostConfig(){
  const row=await admin.from('facebook_publisher_internal').select('upload_post_api_key_enc').eq('id',1).single();check(row.error);
  return row.data.upload_post_api_key_enc?await decrypt(row.data.upload_post_api_key_enc):null;
}
function uploadPostProfile(userId){return 'aff_'+userId.replace(/-/g,'')}
async function uploadPost(path,key,options={}){
  const response=await fetch(UPLOAD_POST+path,{method:options.method||'GET',headers:{Authorization:'Apikey '+key,...(options.json?{'Content-Type':'application/json'}:{}),...(options.idempotencyKey?{'Idempotency-Key':options.idempotencyKey}:{})},body:options.json?JSON.stringify(options.json):options.body,signal:AbortSignal.timeout(25000)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result.success===false){
    const reason=typeof result.error==='string'?result.error:typeof result.message==='string'?result.message:'Upload-Post ไม่ตอบรับ';
    throw Object.assign(problem(reason.slice(0,400),response.status>=500?502:422),{upstreamStatus:response.status});
  }
  return result;
}
async function syncUploadPostPages(user,key){
  const profile=uploadPostProfile(user.id),incoming=await uploadPost('/api/uploadposts/facebook/pages?profile='+encodeURIComponent(profile),key);
  const pages=Array.isArray(incoming.pages)?incoming.pages:[];
  const activeIds=[];
  for(const page of pages){
    const id=String(page.page_id||page.id||''),name=String(page.page_name||page.name||id);
    if(!/^[0-9]{5,30}$/.test(id)||page.profile&&page.profile!==profile)continue;
    const existing=await admin.from('facebook_publisher_pages').select('connected_by').eq('id',id).maybeSingle();check(existing.error);
    if(existing.data&&existing.data.connected_by!==user.id)continue;
    const saved=await admin.from('facebook_publisher_pages').upsert({id,name,connected_by:user.id,access_token_enc:'',provider:'upload-post',profile_username:profile,updated_at:new Date().toISOString()},{onConflict:'id'});check(saved.error);
    activeIds.push(id);
  }
  return activeIds;
}
async function member(req){
  const token=(req.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)throw problem('กรุณาเข้าสู่ระบบ Google ก่อน',401);
  const {data:{user},error}=await admin.auth.getUser(token);
  if(error||!user)throw problem('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่',401);
  const result=await admin.from('team_members').select('user_id,role').eq('user_id',user.id).eq('active',true).maybeSingle();
  check(result.error);
  if(!result.data)throw problem('บัญชีนี้ไม่มีสิทธิ์ทีม AFF',403);
  return {...user,teamRole:result.data.role};
}
async function graph(path,token,form){
  const endpoint=GRAPH+'/'+path.replace(/^\//,'');
  const response=await fetch(endpoint,{method:form?'POST':'GET',headers:{Authorization:'Bearer '+token,...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:form?new URLSearchParams(form):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error)throw problem(data.error?.message||'Facebook API ไม่ตอบรับ',response.status>=500?502:422);
  return data;
}
async function card(req,id){
  if(!/^[0-9a-f-]{36}$/i.test(id||''))throw problem('ไม่พบการ์ด',404);
  const {data:batch,error}=await admin.from('facebook_publisher_batches').select('id,caption,destination,image_path,status').eq('id',id).maybeSingle();
  check(error);
  if(!batch||batch.status==='cancelled')throw problem('ไม่พบการ์ด',404);
  const image=admin.storage.from(BUCKET).getPublicUrl(batch.image_path).data.publicUrl;
  const destination=validDestination(batch.destination);
  if(!destination)throw problem('URL ปลายทางไม่ถูกต้อง',404);
  const title=batch.caption.trim().slice(0,100)||'ดูรายละเอียด';
  const html='<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta property="og:type" content="website"><meta property="og:title" content="'+escapeHtml(title)+'">'+
    '<meta property="og:description" content="กดภาพเพื่อดูรายละเอียดที่ '+escapeHtml(new URL(destination).hostname)+'"><meta property="og:site_name" content="AFF">'+
    '<meta property="og:image" content="'+escapeHtml(image)+'"><meta property="og:image:secure_url" content="'+escapeHtml(image)+'">'+
    '<meta property="og:image:alt" content="'+escapeHtml(title)+'"><meta property="og:url" content="'+cardUrl(id)+'">'+
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="'+escapeHtml(image)+'">'+
    '<link rel="canonical" href="'+cardUrl(id)+'"><title>'+escapeHtml(title)+'</title></head>'+
    '<body style="font:16px system-ui;margin:3rem auto;max-width:35rem;padding:1rem"><img src="'+escapeHtml(image)+'" alt="" style="width:100%;height:auto"><p>กำลังเปิด '+escapeHtml(new URL(destination).hostname)+'…</p><p><a href="'+escapeHtml(destination)+'">เปิดลิงก์ปลายทาง</a></p>'+
    '<script>location.replace('+JSON.stringify(destination).replace(/</g,'\\u003c')+')</script></body></html>';
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public,max-age=300'}});
}
async function callback(req){
  const url=new URL(req.url),state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
  if(!/^[0-9a-f-]{72}$/.test(state)||!code)throw problem('Facebook Login ไม่สำเร็จ',400);
  const record=await admin.from('facebook_publisher_oauth_states').delete().eq('state',state).gte('expires_at',new Date().toISOString()).select('user_id').maybeSingle();
  check(record.error);
  if(!record.data)throw problem('ลิงก์เชื่อมต่อหมดอายุ กรุณาลองใหม่',400);
  const config=await metaConfig();
  if(!config)throw problem('ยังไม่ตั้งค่า Meta App',503);
  const {appId,appSecret}=config;
  const redirect=BASE+'/functions/v1/facebook-publisher?action=callback';
  const query=new URLSearchParams({client_id:appId,client_secret:appSecret,redirect_uri:redirect,code});
  const tokenResponse=await fetch(GRAPH+'/oauth/access_token?'+query);
  const short=await tokenResponse.json();
  if(!tokenResponse.ok||!short.access_token)throw problem(short.error?.message||'แลก Facebook token ไม่สำเร็จ',422);
  const longQuery=new URLSearchParams({grant_type:'fb_exchange_token',client_id:appId,client_secret:appSecret,fb_exchange_token:short.access_token});
  const longResponse=await fetch(GRAPH+'/oauth/access_token?'+longQuery);
  const long=await longResponse.json();
  const userToken=longResponse.ok&&long.access_token?long.access_token:short.access_token;
  let next=GRAPH+'/me/accounts?fields=id,name,access_token,tasks&limit=100',pages=[],count=0;
  while(next&&count++<5){
    const response=await fetch(next,{headers:{Authorization:'Bearer '+userToken}});
    const data=await response.json();
    if(!response.ok)throw problem(data.error?.message||'ดึงเพจไม่สำเร็จ',422);
    pages.push(...(data.data||[]));
    next=data.paging?.next||'';
  }
  for(const page of pages){
    if(!/^[0-9]{5,30}$/.test(String(page.id))||!page.access_token)continue;
    const existing=await admin.from('facebook_publisher_pages').select('connected_by').eq('id',page.id).maybeSingle();check(existing.error);
    if(existing.data&&existing.data.connected_by!==record.data.user_id)continue;
    const saved=await admin.from('facebook_publisher_pages').upsert({id:page.id,name:page.name||page.id,connected_by:record.data.user_id,access_token_enc:await encrypt(page.access_token),provider:'meta',profile_username:null,updated_at:new Date().toISOString()},{onConflict:'id'});check(saved.error);
  }
  return new Response(null,{status:302,headers:{Location:'https://aff-lyart.vercel.app/?facebook_connected=1#publisher','Cache-Control':'no-store'}});
}
async function reconcileUploadJob(req){
  const before=new Date(Date.now()-30000).toISOString();
  const pending=await admin.from('facebook_publisher_jobs').select('id,page_id').eq('status','uncertain').lte('finished_at',before).order('finished_at',{ascending:true}).limit(1);
  check(pending.error);
  const job=pending.data?.[0];
  if(!job)return send(req,{ok:true,processed:0});
  const page=await admin.from('facebook_publisher_pages').select('provider').eq('id',job.page_id).maybeSingle();check(page.error);
  if(page.data?.provider!=='upload-post')return send(req,{ok:true,processed:0});
  try{
    const key=await uploadPostConfig();
    if(!key)throw problem('ยังไม่ได้ตั้งค่าผู้ให้บริการ',422);
    const progress=await uploadPost('/api/uploadposts/status?request_id='+encodeURIComponent(job.id),key);
    const entries=Array.isArray(progress.results)?progress.results:[progress.results?.facebook].filter(Boolean);
    const facebook=entries.find(entry=>entry?.platform==='facebook'||entry?.platform===undefined);
    let finalStatus=null,postId=null,permalink=null,message=null;
    if(facebook?.success===true){
      finalStatus='posted';
      postId=String(facebook.post_id||facebook.id||'')||null;
      permalink=facebook.post_url||facebook.url||facebook.permalink||null;
    }else if(facebook?.success===false||facebook?.skipped||progress.status==='failed'){
      finalStatus='failed';
      message=String(facebook?.error||facebook?.message||progress.message||'ผู้ให้บริการโพสต์ไม่สำเร็จ').slice(0,500);
    }
    const changes={finished_at:new Date().toISOString(),error:finalStatus==='posted'?null:message||'รอผู้ให้บริการยืนยันสถานะโพสต์'};
    if(finalStatus){changes.status=finalStatus;changes.facebook_post_id=postId;changes.permalink=permalink}
    const saved=await admin.from('facebook_publisher_jobs').update(changes).eq('id',job.id).eq('status','uncertain');check(saved.error);
    return send(req,{ok:true,processed:1,status:finalStatus||'uncertain'});
  }catch(error){
    const saved=await admin.from('facebook_publisher_jobs').update({finished_at:new Date().toISOString(),error:'กำลังตรวจผลกับผู้ให้บริการ: '+String(error.message).slice(0,440)}).eq('id',job.id).eq('status','uncertain');
    if(saved.error)console.error('Reconcile failed',saved.error.message);
    return send(req,{ok:false,processed:1,status:'uncertain'});
  }
}
async function worker(req){
  const result=await admin.from('facebook_publisher_internal').select('worker_token').eq('id',1).single();check(result.error);
  const provided=req.headers.get('x-aff-worker-token')||'', expected=result.data.worker_token;
  if(provided.length!==expected.length||[...provided].reduce((diff,c,i)=>diff|(c.charCodeAt(0)^expected.charCodeAt(i)),0)!==0)throw problem('Forbidden',403);
  const claimed=await admin.rpc('facebook_claim_due_job');check(claimed.error);
  const job=claimed.data?.[0];if(!job)return await reconcileUploadJob(req);
  let accepted=false;
  try {
    const [pages,batches]=await Promise.all([
      admin.from('facebook_publisher_pages').select('access_token_enc,provider,profile_username').eq('id',job.page_id).single(),
      admin.from('facebook_publisher_batches').select('id,caption,destination,image_path').eq('id',job.batch_id).single()
    ]);
    check(pages.error);check(batches.error);
    const linkCard=cardUrl(job.batch_id);
    let postId=null,permalink=null;
    if(pages.data.provider==='upload-post'){
      const key=await uploadPostConfig();
      if(!key||!pages.data.profile_username)throw problem('ยังไม่ได้เชื่อมบริการโพสต์ของเพจนี้',422);
      const form=new FormData();
      form.set('user',pages.data.profile_username);
      form.set('platform[]','facebook');
      form.set('title',batches.data.caption||'ดูรายละเอียด');
      form.set('facebook_page_id',job.page_id);
      form.set('facebook_link_url',linkCard);
      form.set('request_id',job.id);
      form.set('external_id',job.id);
      const post=await uploadPost('/api/upload_text',key,{method:'POST',body:form,idempotencyKey:job.id});
      const facebook=post.results?.facebook;
      if(facebook?.success===false||facebook?.skipped)throw problem(facebook.error||'Facebook ไม่รับโพสต์',422);
      if(!facebook?.success){
        accepted=!!(post.request_id||post.job_id);
        throw problem(accepted?'ผู้ให้บริการกำลังตรวจโพสต์ เลขงาน '+(post.request_id||post.job_id):'ยังไม่ได้รับผลโพสต์จาก Facebook',accepted?502:422);
      }
      accepted=true;
      permalink=facebook.url||facebook.permalink||null;
      postId=String(facebook.id||facebook.post_id||post.request_id||'')||null;
    }else{
      const token=await decrypt(pages.data.access_token_enc);
      const post=await graph(job.page_id+'/feed',token,{message:batches.data.caption,link:linkCard,published:'true'});
      if(!post.id)throw problem('Facebook ไม่ส่งรหัสโพสต์กลับมา',502);
      accepted=true;
      postId=post.id;
      try { permalink=(await graph(encodeURIComponent(post.id)+'?fields=permalink_url',token)).permalink_url||null; } catch {}
    }
    const update=await admin.from('facebook_publisher_jobs').update({status:'posted',facebook_post_id:postId,permalink,finished_at:new Date().toISOString(),error:null}).eq('id',job.id).eq('status','processing');
    check(update.error);
    return send(req,{ok:true,processed:1,postId});
  } catch(error){
    const status=accepted||error.status!==422?'uncertain':'failed';
    const update=await admin.from('facebook_publisher_jobs').update({status,error:String(error.message).slice(0,500),finished_at:new Date().toISOString()}).eq('id',job.id).eq('status','processing');
    if(update.error)console.error('Failed to persist job failure',update.error.message);
    return send(req,{ok:false,processed:1,status,error:String(error.message)},200);
  }
}
Deno.serve(async req=>{
  try{
    if(!BASE||!SERVICE)throw problem('Supabase environment not configured',500);
    const url=new URL(req.url),action=url.searchParams.get('action')||'status';
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
    if(!originAllowed(req.headers.get('origin')))throw problem('Origin not allowed',403);
    if(action==='card'&&req.method==='GET')return await card(req,url.searchParams.get('id'));
    if(action==='callback'&&req.method==='GET')return await callback(req);
    if(action==='worker'&&req.method==='POST')return await worker(req);
    if(action==='setup'&&req.method==='GET')return send(req,{ok:true,oauthReady:!!(await metaConfig())||!!(await uploadPostConfig())});
    const user=await member(req);
    if(action==='login'&&req.method==='POST'){
      const uploadKey=await uploadPostConfig();
      if(uploadKey){
        const profile=uploadPostProfile(user.id);
        try{await uploadPost('/api/uploadposts/users',uploadKey,{method:'POST',json:{username:profile,display_name:'AFF Facebook '+user.id.slice(0,8)}})}
        catch(error){if(error.upstreamStatus!==409)throw error}
        const linked=await uploadPost('/api/uploadposts/users/generate-jwt',uploadKey,{method:'POST',json:{username:profile,platforms:['facebook'],show_calendar:false,connect_title:'เชื่อมเพจ Facebook กับ AFF',redirect_url:'https://aff-lyart.vercel.app/?facebook_connected=1#publisher'}});
        const url=new URL(linked.access_url||'');
        if(url.protocol!=='https:'||url.hostname!=='app.upload-post.com')throw problem('ลิงก์เชื่อม Facebook ไม่ถูกต้อง',502);
        return send(req,{ok:true,url:url.href,provider:'upload-post'});
      }
      const config=await metaConfig();
      if(!config)throw problem('ยังไม่ตั้งค่า Meta App ของเว็บ AFF',503);
      const {appId}=config;
      const random=crypto.getRandomValues(new Uint8Array(36));
      const state=Array.from(random,b=>b.toString(16).padStart(2,'0')).join('');
      const added=await admin.from('facebook_publisher_oauth_states').insert({state,user_id:user.id});check(added.error);
      const redirect=BASE+'/functions/v1/facebook-publisher?action=callback';
      const query=new URLSearchParams({client_id:appId,redirect_uri:redirect,state,response_type:'code',scope:'pages_show_list,pages_read_engagement,pages_manage_posts'});
      return send(req,{ok:true,url:'https://www.facebook.com/v26.0/dialog/oauth?'+query});
    }
    if(action==='configure-upload-post'&&req.method==='POST'){
      if(user.teamRole!=='owner')throw problem('เฉพาะเจ้าของเว็บตั้งค่าผู้ให้บริการได้',403);
      const body=await req.json(),key=String(body.apiKey||'').trim();
      if(!/^[^\s]{12,512}$/.test(key))throw problem('ตรวจ API key ของ Upload-Post');
      await uploadPost('/api/uploadposts/users',key);
      const saved=await admin.from('facebook_publisher_internal').update({upload_post_api_key_enc:await encrypt(key)}).eq('id',1);check(saved.error);
      return send(req,{ok:true,configured:true});
    }
    if(action==='configure'&&req.method==='POST'){
      if(user.teamRole!=='owner')throw problem('เฉพาะเจ้าของเว็บตั้งค่า Meta App ได้',403);
      const body=await req.json(),appId=String(body.appId||'').trim(),appSecret=String(body.appSecret||'').trim();
      if(!/^[0-9]{5,30}$/.test(appId)||appSecret.length<20||appSecret.length>256)throw problem('App ID หรือ App Secret ไม่ถูกต้อง');
      const validation=await fetch(GRAPH+'/oauth/access_token?'+new URLSearchParams({client_id:appId,client_secret:appSecret,grant_type:'client_credentials'}));
      const checked=await validation.json().catch(()=>({}));
      if(!validation.ok||!checked.access_token)throw problem(checked.error?.message||'Meta ไม่ยืนยัน App ID/Secret',422);
      const saved=await admin.from('facebook_publisher_internal').update({meta_app_id:appId,meta_app_secret_enc:await encrypt(appSecret)}).eq('id',1);check(saved.error);
      return send(req,{ok:true,configured:true});
    }
    if(action==='status'&&req.method==='GET'){
      const uploadKey=await uploadPostConfig(),provider=uploadKey?'upload-post':'meta';
      let syncError=null,activeUploadIds=null;
      if(uploadKey){
        try{activeUploadIds=await syncUploadPostPages(user,uploadKey)}
        catch(error){if(error.upstreamStatus!==404){console.error('Failed to refresh Upload-Post pages',error);syncError='ดึงรายชื่อเพจล่าสุดไม่ได้ กดรีเฟรชอีกครั้ง'}}
      }
      const result=await admin.from('facebook_publisher_pages').select('id,name,updated_at').eq('connected_by',user.id).eq('provider',provider).order('name');check(result.error);
      const pages=uploadKey?result.data.filter(page=>activeUploadIds?.includes(page.id)):result.data;
      return send(req,{ok:true,connected:!!pages.length,oauthReady:!!uploadKey||!!(await metaConfig()),provider,canConfigure:user.teamRole==='owner',pages,syncError});
    }
    if(action==='image'&&req.method==='POST'){
      const type=(req.headers.get('content-type')||'').split(';')[0].trim();
      const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[type];
      if(!ext)throw problem('รองรับ JPG, PNG หรือ WebP');
      if(Number(req.headers.get('content-length')||0)>8388608)throw problem('ภาพต้องไม่เกิน 8 MB',413);
      const bytes=await req.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>8388608)throw problem('ภาพต้องไม่เกิน 8 MB',413);
      const path=user.id+'/'+crypto.randomUUID()+'.'+ext;
      const upload=await admin.storage.from(BUCKET).upload(path,bytes,{contentType:type,upsert:false});check(upload.error);
      return send(req,{ok:true,path,publicUrl:admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl});
    }
    if(action==='create-card'&&req.method==='POST'){
      const b=await req.json(),destination=validDestination(b.destination),caption=String(b.caption||'').trim();
      const path=String(b.imagePath||'');
      if(!destination||caption.length>5000)throw problem('ตรวจลิงก์ปลายทางและข้อความก่อนสร้างการ์ด');
      if(!path.startsWith(user.id+'/')||!/^[0-9a-f-]{36}\/[-0-9a-f]+\.(jpg|png|webp)$/i.test(path))throw problem('กรุณาอัปโหลดภาพใหม่');
      const imageUrl=admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const imageResponse=await fetch(imageUrl,{method:'HEAD'});
      if(!imageResponse.ok)throw problem('ไม่พบภาพที่อัปโหลด');
      const batch=await admin.from('facebook_publisher_batches').insert({created_by:user.id,caption,destination,image_path:path,delay_seconds:30,status:'draft'}).select('id').single();
      check(batch.error);
      return send(req,{ok:true,cardUrl:cardUrl(batch.data.id)},201);
    }
    if(action==='enqueue'&&req.method==='POST'){
      const b=await req.json(),dest=validDestination(b.destination),caption=String(b.caption||'').trim();
      const delay=Number(b.delay),start=new Date(b.start),pageIds=[...new Set(Array.isArray(b.pages)?b.pages.map(String):[])];
      if(!dest||caption.length>5000||!Number.isInteger(delay)||delay<5||delay>3600||!pageIds.length||pageIds.length>30||!/^https?:/.test(dest))throw problem('ตรวจ URL ข้อความ เพจ และดีเลย์ก่อนส่ง');
      if(!Number.isFinite(start.getTime())||start.getTime()<Date.now()+10000||start.getTime()>Date.now()+30*86400000)throw problem('เวลาเริ่มต้องห่างอย่างน้อย 10 วินาที และไม่เกิน 30 วัน');
      const path=String(b.imagePath||'');
      if(!path.startsWith(user.id+'/')||!/^[0-9a-f-]{36}\/[-0-9a-f]+\.(jpg|png|webp)$/i.test(path))throw problem('กรุณาอัปภาพใหม่');
      const imageUrl=admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const checkImage=await fetch(imageUrl,{method:'HEAD'});
      if(!checkImage.ok)throw problem('ไม่พบภาพที่อัปโหลด');
      const uploadKey=await uploadPostConfig(),provider=uploadKey?'upload-post':'meta';
      if(uploadKey){
        const activeIds=await syncUploadPostPages(user,uploadKey);
        if(pageIds.some(id=>!activeIds.includes(id)))throw problem('บางเพจไม่ได้เชื่อมกับ Facebook แล้ว กรุณาเชื่อมใหม่',422);
      }
      const selected=await admin.from('facebook_publisher_pages').select('id').in('id',pageIds).eq('connected_by',user.id).eq('provider',provider);check(selected.error);
      if(selected.data.length!==pageIds.length)throw problem('มีเพจที่ยังไม่ได้เชื่อม');
      const batch=await admin.from('facebook_publisher_batches').insert({created_by:user.id,caption,destination:dest,image_path:path,delay_seconds:delay,status:'draft'}).select('id').single();check(batch.error);
      const jobs=pageIds.map((page_id,index)=>({batch_id:batch.data.id,page_id,scheduled_at:new Date(start.getTime()+index*delay*1000).toISOString()}));
      const inserted=await admin.from('facebook_publisher_jobs').insert(jobs);check(inserted.error);
      const queued=await admin.from('facebook_publisher_batches').update({status:'queued'}).eq('id',batch.data.id);check(queued.error);
      return send(req,{ok:true,batchId:batch.data.id,jobs:jobs.map(j=>({pageId:j.page_id,at:j.scheduled_at}))},201);
    }
    if(action==='jobs'&&req.method==='GET'){
      const batches=await admin.from('facebook_publisher_batches').select('id,caption,destination,status,created_at').eq('created_by',user.id).order('created_at',{ascending:false}).limit(15);check(batches.error);
      if(!batches.data.length)return send(req,{ok:true,batches:[],jobs:[]});
      const jobs=await admin.from('facebook_publisher_jobs').select('batch_id,page_id,scheduled_at,status,facebook_post_id,permalink,error').in('batch_id',batches.data.map(b=>b.id)).order('scheduled_at');check(jobs.error);
      return send(req,{ok:true,batches:batches.data,jobs:jobs.data});
    }
    throw problem('ไม่พบคำสั่งนี้',404);
  }catch(error){console.error(error);return send(req,{ok:false,error:'facebook_publisher_error',message:error.message||'ผิดพลาด'},error.status||500)}
});
(() => {
 const page=document.getElementById('autoSyncPage');
 const $=id=>document.getElementById(id);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(Number(v||0));
 let accounts=[],version=0;
 page.insertAdjacentHTML('afterbegin',`<section class="panel multi-dashboard">
 <span class="auto-sync-badge">AFF · ภาพรวมหลายบัญชี</span><h2>ทุกบัญชี ในภาพเดียว</h2>
 <p>รวมค่าคอมมิชชัน Shopee และ Lazada · ดูยอดรวม หรือเลือกเจาะรายบัญชี</p>
 <form id="multiFilters" class="multi-filters">
 <label>เริ่มวันที่<input type="date" id="multiFrom"></label><label>ถึงวันที่<input type="date" id="multiTo"></label>
 <label>แพลตฟอร์ม<select id="multiPlatform"><option value="">ทั้งหมด</option><option value="shopee">Shopee</option><option value="lazada">Lazada</option></select></label>
 <label>บัญชี<select id="multiAccount"><option value="">ทุกบัญชี</option></select></label><button class="btn upload">ดูยอด</button></form>
 <p id="multiStatus" role="status"></p><div class="multi-kpis" id="multiKpis"></div><p id="multiSummary" class="auto-sync-note"></p>
 <h3>ค่าคอมมิชชันรายวัน</h3><div id="multiDaily" class="multi-daily"></div>
 <h3>ยอดรวมตาม SUP</h3><div class="table-wrap"><table><thead><tr><th>SUP</th><th>ออเดอร์</th><th>Shopee</th><th>Lazada</th><th>ค่าคอมมิชชันรวม</th></tr></thead><tbody id="multiRows"></tbody></table></div>
 </section><section class="panel"><h2>บัญชีของทีม</h2><p>เพิ่มบัญชีต้นทางเพื่อแยกรายงาน การเพิ่มบัญชียังไม่ใช่การเชื่อมดึงยอดอัตโนมัติ</p>
 <form id="multiAdd" class="multi-filters"><label>แพลตฟอร์ม<select id="newPlatform"><option value="shopee">Shopee</option><option value="lazada">Lazada</option></select></label>
 <label>ชื่อเรียก<input id="newLabel" required maxlength="80" placeholder="เช่น Shopee นัท"></label><label>รหัสบัญชี Affiliate<input id="newExternal" required maxlength="120" placeholder="รหัสบัญชีจากแพลตฟอร์ม"></label><button class="btn upload">เพิ่มบัญชี</button></form>
 <p id="multiAccountStatus" role="status"></p><div id="multiAccounts" class="auto-sync-grid"></div></section>`);
 async function api(path,options={}) {
  const client=window.__affSupabaseClient;
  if(!client)throw Error('กรุณาเข้าสู่ระบบ Google ก่อน');
  const {data}=await client.auth.getSession();
  if(!data.session)throw Error('กรุณาเข้าสู่ระบบ Google ก่อน');
  const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`}});
  const result=await res.json();if(!res.ok||!result.ok)throw Error(result.message||'โหลดข้อมูลไม่สำเร็จ');return result;
 }
 function options() {
  const platform=$('multiPlatform').value,old=$('multiAccount').value;
  $('multiAccount').innerHTML='<option value="">ทุกบัญชี</option>'+accounts.filter(a=>!platform||a.platform===platform).map(a=>`<option value="${a.id}">${esc(a.label)} · ${esc(a.platform)}</option>`).join('');
  if(accounts.some(a=>a.id===old&&(!platform||a.platform===platform)))$('multiAccount').value=old;
  for(const platform of ['shopee','lazada']){
   const select=$('importAccount_'+platform),prior=select.value;
   select.innerHTML='<option value="">เลือกบัญชีต้นทาง</option>'+accounts.filter(a=>a.platform===platform).map(a=>`<option value="${a.id}">${esc(a.label)}</option>`).join('');
   if(accounts.some(a=>a.id===prior&&a.platform===platform))select.value=prior;
  }
 }
 async function refresh(){
  const current=++version;
  $('multiStatus').textContent='กำลังโหลด…';
  for(const id of ['multiKpis','multiDaily','multiRows','multiSummary'])$(id).textContent='';
  try{
   const q=new URLSearchParams();
   for(const [key,id] of [['from','multiFrom'],['to','multiTo'],['platform','multiPlatform'],['account','multiAccount']])if($(id).value)q.set(key,$(id).value);
   const r=await api('/api/dashboard?'+q);if(current!==version)return;
   accounts=r.accounts||[];options();const t=r.totals;
   $('multiKpis').innerHTML=[['ค่าคอมมิชชันรวม',money(Number(t.shopee)+Number(t.lazada))],['Shopee',money(t.shopee)],['Lazada',money(t.lazada)],['ออเดอร์',Number(t.orders).toLocaleString('th-TH')]].map(([label,value])=>`<article><span>${label}</span><strong>${value}</strong></article>`).join('');
   $('multiSummary').textContent=`รวมรอตรวจสอบ/ไม่ทราบสถานะ ${t.provisional_items} รายการ · ไม่รวมยกเลิก/ไม่จ่าย ${r.excluded_items} รายการ · ยังไม่ระบุบัญชี ${r.unassigned_items} รายการ`;
   $('multiAccounts').innerHTML=accounts.length?accounts.map(a=>`<article class="auto-sync-card"><span class="auto-sync-badge">${esc(a.platform)}</span><h3>${esc(a.label)}</h3><p>รหัสบัญชี: ${esc(a.external_account_id)}</p><p>นำเข้าล่าสุด: ${a.last_import_at?new Date(a.last_import_at).toLocaleString('th-TH'):'ยังไม่มีข้อมูล'}</p><p class="auto-sync-note">นำเข้าด้วยไฟล์ · ยังไม่เชื่อมซิงก์อัตโนมัติ</p></article>`).join(''):'ยังไม่มีบัญชี เพิ่มบัญชีด้านบนเพื่อเริ่มนำเข้า';
   const max=Math.max(1,...r.daily.map(d=>Math.abs(Number(d.revenue))));
   $('multiDaily').innerHTML=r.daily.length?r.daily.map(d=>`<div class="multi-day"><span>${esc(d.day||'ไม่ระบุวัน')}</span><meter min="0" max="${max}" value="${Math.abs(Number(d.revenue))}"></meter><strong>${money(d.revenue)}</strong></div>`).join(''):'ยังไม่มีข้อมูลในช่วงที่เลือก';
   $('multiRows').innerHTML=r.rows.map(s=>`<tr><td>${esc(s.sub_id2||'ไม่มี SUP')}</td><td>${Number(s.orders)}</td><td>${money(s.shopee_commission)}</td><td>${money(s.lazada_commission)}</td><td>${money(s.revenue)}</td></tr>`).join('');
   $('multiStatus').textContent='เชื่อมฐานข้อมูลแล้ว · ยอดจากรายงานที่นำเข้า ตามตัวกรองที่เลือก';
  }catch(e){if(current===version)$('multiStatus').textContent=e.message;}
 }
 $('multiFilters').addEventListener('submit',e=>{e.preventDefault();refresh();});
 $('multiPlatform').addEventListener('change',()=>{options();refresh();});
 $('multiAccount').addEventListener('change',refresh);
 $('multiAdd').addEventListener('submit',async e=>{
  e.preventDefault();const button=e.submitter;button.disabled=true;
  try{await api('/api/accounts',{method:'POST',body:JSON.stringify({platform:$('newPlatform').value,label:$('newLabel').value,external_account_id:$('newExternal').value})});
   $('multiAccountStatus').textContent='เพิ่มบัญชีแล้ว เลือกบัญชีนี้ตอนนำเข้าไฟล์ได้';$('newLabel').value='';$('newExternal').value='';await refresh();
  }catch(e){$('multiAccountStatus').textContent=e.message;}finally{button.disabled=false;}
 });
 document.addEventListener('aff:auto-sync:open',refresh);
 document.addEventListener('aff:import:complete',refresh);
 $('autoSyncRefresh').addEventListener('click',refresh);
 if(!page.hidden)refresh();
})();

(function (root) {
  'use strict';
  const STORAGE_KEY = 'aff-edit-post-queue-v1';
  const POST_URL = /https?:\/\/(?:www\.)?facebook\.com\/[^\s<>"']+\/posts\/[^\s<>"']+/i;
  const SHOPEE_URL = /https?:\/\/(?:s\.shopee\.co\.th|(?:www\.)?shopee\.co\.th)\/[^\s<>"']+/i;
  const trimUrl = value => String(value || '').replace(/[),.;]+$/, '');
  const cell = (rows, row, column) => String(rows[row]?.[column] ?? '').trim();
  const extract = (text, expression) => trimUrl(String(text || '').match(expression)?.[0] || '');

  function parseRows(rows) {
    if (!Array.isArray(rows)) throw new Error('อ่านชีต Excel ไม่สำเร็จ');
    const records = [];
    for (let row = 0; row < rows.length; row += 1) {
      const postUrl = extract(cell(rows, row, 1), POST_URL);
      if (!postUrl) continue;
      const oldLink = extract(cell(rows, row, 3) || cell(rows, row + 1, 1), SHOPEE_URL);
      records.push({
        id: String(row + 1), row: row + 1,
        sequence: cell(rows, row, 0) || String(records.length + 1),
        postUrl, oldLink,
        sub1: cell(rows, row, 2),
        sub2: cell(rows, row + 1, 2),
        sub5: cell(rows, row + 2, 2),
        adsCurrentSub1: cell(rows, row, 2),
        newSub1: cell(rows, row, 2),
        newLink: extract(cell(rows, row, 4), SHOPEE_URL),
        note: cell(rows, row, 5),
        productChecked: false, facebookChecked: false, commentChecked: false
      });
    }
    if (!records.length) throw new Error('ไม่พบลิงก์โพสต์รูปแบบ facebook.com/…/posts/… ในคอลัมน์ B');
    return records;
  }

  function validShopee(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['s.shopee.co.th', 'shopee.co.th', 'www.shopee.co.th'].includes(url.hostname) && url.pathname.length > 1;
    } catch { return false; }
  }

  const api = { parseRows, validShopee, parseBackup, validFacebookPost };
  root.AffEditPost = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document?.getElementById('editPostPage')) return;

  const $ = id => document.getElementById(id);
  const state = { name: '', records: [], selectedId: '' };
  let activeUserId = '', cloudTimer = 0, cloudChain = Promise.resolve();

  function cloudStatus(value) { $('epCloudStatus').textContent = value; }
  function queueKey() { return STORAGE_KEY + ':' + activeUserId; }
  function refreshControls() {
    $('epFile').disabled = !activeUserId;
    $('epCloudSave').disabled = !activeUserId || !state.records.length;
    $('epCloudLoad').disabled = !activeUserId;
    $('epRecover').hidden = !activeUserId || !localStorage.getItem(STORAGE_KEY);
  }
  async function persistCloud() {
    if (!activeUserId || !state.records.length) return;
    const userId = activeUserId;
    const snapshot = JSON.parse(JSON.stringify(state));
    const client = root.__affSupabaseClient;
    if (!client) throw new Error('ยังเชื่อมพื้นที่เก็บข้อมูลไม่ได้');
    const { error } = await client.from('edit_post_queues').upsert({
      user_id: userId, file_name: snapshot.name, records: snapshot.records, selected_id: snapshot.selectedId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) throw error;
    if (activeUserId === userId) cloudStatus('บันทึกคิวในบัญชีแล้ว · เปิดต่ออีกเครื่องได้');
  }
  function scheduleCloud() {
    if (!activeUserId || !state.records.length) return;
    clearTimeout(cloudTimer);
    cloudStatus('คิวในเครื่องบันทึกแล้ว · กำลังซิงก์…');
    cloudTimer = setTimeout(() => {
      cloudChain = cloudChain.then(() => persistCloud()).catch(error => cloudStatus('บันทึกบนคลาวด์ไม่สำเร็จ: ' + (error.message || error)));
    }, 650);
  }
  async function loadCloud(force = false) {
    if (!activeUserId) return;
    if (force && state.records.length && !confirm('โหลดคิวจากบัญชีแทนคิวในเครื่องนี้? กรุณาสำรองคิวก่อนถ้ามีงานที่ยังไม่ซิงก์')) return;
    const userId = activeUserId, client = root.__affSupabaseClient;
    if (!client) return cloudStatus('ยังเชื่อมพื้นที่เก็บข้อมูลไม่ได้');
    cloudStatus('กำลังโหลดคิวจากบัญชี…');
    const { data, error } = await client.from('edit_post_queues').select('file_name,records,selected_id,updated_at').eq('user_id', userId).maybeSingle();
    if (activeUserId !== userId) return;
    if (error) return cloudStatus('โหลดคิวไม่สำเร็จ: ' + error.message);
    if (!Array.isArray(data?.records) || !data.records.length) return cloudStatus('ยังไม่มีคิวในบัญชีนี้ · เปิดไฟล์ Excel เพื่อเริ่ม');
    if (!force && state.records.length) return cloudStatus('มีคิวในเครื่องนี้แล้ว · กด “โหลดจากบัญชี” หากต้องการเปลี่ยนคิว');
    clearTimeout(cloudTimer);
    state.name = String(data.file_name || 'คิวจากบัญชี');
    state.records = data.records.filter(item => validFacebookPost(item?.postUrl)).map(item => ({ ...item,
      productChecked: Boolean(item.productChecked), facebookChecked: Boolean(item.facebookChecked),
      commentChecked: Boolean(item.commentChecked) }));
    state.selectedId = state.records.some(item => item.id === data.selected_id) ? data.selected_id : state.records[0]?.id || '';
    try { localStorage.setItem(queueKey(), JSON.stringify(state)); } catch { /* Cloud copy remains available. */ }
    renderList(); renderDetail(); refreshControls();
    cloudStatus('โหลดคิวจากบัญชีแล้ว · ' + state.records.length + ' รายการ');
  }
  async function activateUser(id) {
    if (activeUserId === id) return;
    clearTimeout(cloudTimer);
    activeUserId = id || '';
    state.name = ''; state.records = []; state.selectedId = '';
    renderList(); renderDetail(); refreshControls();
    if (!activeUserId) { cloudStatus('เข้าสู่ระบบ AFF ก่อนเปิดคิวแก้ลิงก์'); return; }
    restore();
    await loadCloud();
  }
  function recoverLegacy() {
    if (!activeUserId) return;
    let data;
    try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* Legacy data may be invalid. */ }
    if (!Array.isArray(data?.records) || !data.records.length) return message('ไม่พบคิวเก่าที่กู้คืนได้', true);
    if (!confirm('นำคิวเก่าในเบราว์เซอร์นี้เข้าบัญชีที่ล็อกอินอยู่? คิวปัจจุบันจะถูกแทนที่')) return;
    state.name = String(data.name || 'คิวเก่าในเครื่องนี้');
    state.records = data.records.filter(item => validFacebookPost(item?.postUrl));
    state.selectedId = state.records.some(item => item.id === data.selectedId) ? data.selectedId : state.records[0]?.id || '';
    save(); renderList(); renderDetail(); refreshControls();
    message('กู้คิวเก่าเข้าบัญชีแล้ว · ' + state.records.length + ' รายการ');
  }

  function message(value, error = false) {
    $('epMessage').textContent = value;
    $('epMessage').dataset.error = String(error);
  }
  function save() {
    try {
      if (!activeUserId) return;
      localStorage.setItem(queueKey(), JSON.stringify(state));
      scheduleCloud();
    } catch {
      message('พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม กรุณาดาวน์โหลดสรุปงานก่อนปิดหน้านี้', true);
    }
  }
  function selected() { return state.records.find(item => item.id === state.selectedId); }
  function addText(parent, tag, text, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }
  function renderList() {
    $('epWorkspace').hidden = !state.records.length;
    $('epExport').disabled = !state.records.length;
    $('epBackup').disabled = !state.records.length;
    refreshControls();
    $('epFileName').textContent = state.name || 'ยังไม่มีไฟล์งาน';
    $('epCount').textContent = `${state.records.length} รายการ`;
    const query = $('epSearch').value.trim().toLowerCase();
    const list = $('epList');
    list.replaceChildren();
    const matches = state.records.filter(item => [item.sequence, item.sub1, item.sub2, item.postUrl].some(value => value.toLowerCase().includes(query)));
    for (const item of matches) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ep-item';
      button.classList.toggle('active', item.id === state.selectedId);
      button.setAttribute('aria-pressed', String(item.id === state.selectedId));
      addText(button, 'strong', `รายการ ${item.sequence} · ${item.sub2 || 'ยังไม่มี Sub_id2'}`);
      addText(button, 'small', item.facebookChecked && item.commentChecked ? 'ตรวจโพสต์และคอมเมนต์ด้วยตนเองแล้ว' : item.newLink ? 'มีลิงก์ใหม่ · รอตรวจโพสต์' : 'รอลิงก์ใหม่');
      button.addEventListener('click', () => { state.selectedId = item.id; save(); renderList(); renderDetail(); });
      list.appendChild(button);
    }
    if (!matches.length) addText(list, 'div', 'ไม่พบรายการที่ค้นหา', 'ep-empty');
  }
  function detailLabel(parent, text, value) {
    const label = addText(parent, 'label', text, 'ep-full');
    addText(label, 'span', value || '—', 'ep-url');
  }
  function copy(value) {
    if (!value) return message('ยังไม่มีลิงก์ใหม่ให้คัดลอก', true);
    navigator.clipboard.writeText(value).then(() => message('คัดลอกลิงก์ใหม่แล้ว')).catch(() => message('คัดลอกไม่ได้ กรุณาเลือกลิงก์ในช่องแล้วคัดลอกเอง', true));
  }
  function renderDetail() {
    const host = $('epDetail');
    host.replaceChildren();
    const record = selected();
    if (!record) return addText(host, 'div', 'เลือกรายการทางซ้ายเพื่อดูรายละเอียด', 'ep-empty');
    const top = addText(host, 'div', '', 'ep-detail-top');
    const title = addText(top, 'div', '');
    addText(title, 'span', '03 · ตรวจรายการก่อนแก้ไข', 'ep-eyebrow');
    addText(title, 'h3', `รายการ ${record.sequence} · แถว ${record.row}`);
    addText(top, 'span', record.facebookChecked && record.commentChecked ? 'ตรวจครบด้วยตนเอง' : 'รอตรวจโพสต์/คอมเมนต์', `ep-pill${record.facebookChecked && record.commentChecked ? ' ready' : ''}`);

    const source = addText(host, 'div', '', 'ep-section');
    addText(source, 'h4', 'ข้อมูลจากไฟล์');
    const link = addText(source, 'a', record.postUrl, 'ep-url');
    link.href = record.postUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
    detailLabel(source, 'ลิงก์สินค้าเดิม', record.oldLink);
    addText(source, 'p', `Sub_id1: ${record.sub1 || '—'}  ·  Sub_id2: ${record.sub2 || '—'}  ·  Sub_id5: ${record.sub5 || '—'}`, 'ep-inline-note');
    if (!record.oldLink || !record.sub2) addText(source, 'p', 'ข้อมูลเดิมไม่ครบ ตรวจ Excel ก่อนใช้ลิงก์หรือจับคู่ Ads', 'ep-warning');

    const editor = addText(host, 'div', '', 'ep-section');
    addText(editor, 'h4', 'เตรียมลิงก์ใหม่');
    const form = addText(editor, 'div', '', 'ep-form');
    let copyButton, productBox, fbBox, commentBox;
    function field(name, value, key, wide = false) {
      const label = addText(form, 'label', name, wide ? 'ep-wide' : '');
      const input = document.createElement('input');
      input.type = key === 'newLink' ? 'url' : 'text'; input.value = value; input.dataset.field = key;
      label.appendChild(input);
      input.addEventListener('input', () => {
        const changed = record[key] !== input.value.trim();
        record[key] = input.value.trim();
        if (changed) { record.facebookChecked = false; record.commentChecked = false; if (key === 'newLink') record.productChecked = false; }
        save(); renderList();
        const linkReady = validShopee(record.newLink) && record.newLink !== record.oldLink;
        if (copyButton) copyButton.disabled = !linkReady;
        if (productBox) { productBox.disabled = !linkReady; productBox.checked = record.productChecked; }
        if (fbBox) { fbBox.disabled = !record.productChecked; fbBox.checked = record.facebookChecked; }
        if (commentBox) { commentBox.disabled = !record.productChecked; commentBox.checked = record.commentChecked; }
      });
    }
    field('Sub_id1 ใหม่', record.newSub1, 'newSub1');
    field('Sub_id1 ที่ Ads ใช้อยู่', record.adsCurrentSub1, 'adsCurrentSub1');
    field('ลิงก์ Shopee Affiliate ใหม่', record.newLink, 'newLink', true);
    const actions = addText(editor, 'div', '', 'ep-actions');
    const shopee = addText(actions, 'a', 'สร้างลิงก์ที่ Shopee ↗', 'btn');
    shopee.href = 'https://affiliate.shopee.co.th/offer/custom_link'; shopee.target = '_blank'; shopee.rel = 'noopener noreferrer';
    copyButton = addText(actions, 'button', 'คัดลอกลิงก์ใหม่', 'btn');
    copyButton.type = 'button'; copyButton.disabled = !validShopee(record.newLink) || record.newLink === record.oldLink; copyButton.addEventListener('click', () => copy(record.newLink));
    if (record.newLink && (!validShopee(record.newLink) || record.newLink === record.oldLink)) addText(editor, 'p', 'ลิงก์ใหม่ต้องเป็น Shopee HTTPS และต่างจากลิงก์เดิม', 'ep-warning');
    const productCheck = addText(editor, 'label', '', 'ep-check');
    productBox = document.createElement('input'); productBox.type = 'checkbox'; productBox.checked = record.productChecked;
    productBox.disabled = !validShopee(record.newLink) || record.newLink === record.oldLink;
    productCheck.appendChild(productBox);
    addText(productCheck, 'span', 'ฉันเปิดลิงก์ใหม่และตรวจแล้วว่าเป็นสินค้าเดิม');
    productBox.addEventListener('change', () => { record.productChecked = productBox.checked; if (!productBox.checked) { record.facebookChecked = false; record.commentChecked = false; } save(); renderList(); renderDetail(); });

    const facebook = addText(host, 'div', '', 'ep-section');
    addText(facebook, 'h4', 'ตรวจโพสต์ Facebook');
    addText(facebook, 'p', 'เปิดโพสต์และแก้ลิงก์ในคำอธิบายกับคอมเมนต์ของเพจบน Facebook แล้วตรวจทั้งสองจุดด้วยตนเอง', 'ep-inline-note');
    const fbActions = addText(facebook, 'div', '', 'ep-actions');
    const openPost = addText(fbActions, 'a', 'เปิดโพสต์ ↗', 'btn upload');
    openPost.href = record.postUrl; openPost.target = '_blank'; openPost.rel = 'noopener noreferrer';
    const openManager = addText(fbActions, 'button', 'ไปหน้าจัดการแฟนเพจ', 'btn');
    openManager.type = 'button'; openManager.addEventListener('click', () => document.querySelector('[data-page-target="facebook"]')?.click());
    const fbCheck = addText(facebook, 'label', '', 'ep-check');
    fbBox = document.createElement('input'); fbBox.type = 'checkbox'; fbBox.checked = record.facebookChecked; fbBox.disabled = !record.productChecked;
    fbCheck.appendChild(fbBox);
    addText(fbCheck, 'span', 'ฉันตรวจว่าข้อความโพสต์มีลิงก์ใหม่แล้ว (ยืนยันด้วยตนเอง)');
    fbBox.addEventListener('change', () => { record.facebookChecked = fbBox.checked; save(); renderList(); renderDetail(); });
    const commentCheck = addText(facebook, 'label', '', 'ep-check');
    commentBox = document.createElement('input'); commentBox.type = 'checkbox'; commentBox.checked = Boolean(record.commentChecked); commentBox.disabled = !record.productChecked;
    commentCheck.appendChild(commentBox);
    addText(commentCheck, 'span', 'ฉันตรวจว่าคอมเมนต์ของเพจมีลิงก์ใหม่แล้ว (ยืนยันด้วยตนเอง)');
    commentBox.addEventListener('change', () => { record.commentChecked = commentBox.checked; save(); renderList(); renderDetail(); });

    const ads = addText(host, 'div', '', 'ep-section');
    addText(ads, 'h4', '04 · แผน Ads');
    addText(ads, 'p', 'ข้อมูลสำหรับจับคู่: Sub_id1 ใน Ads → Sub_id1 ใหม่ และลิงก์เดิม → ลิงก์ใหม่', 'ep-inline-note');
    detailLabel(ads, 'ชื่อ Campaign ที่คาดว่าต้องเปลี่ยน', record.adsCurrentSub1 && record.newSub1 ? `${record.adsCurrentSub1} → ${record.newSub1}` : 'ยังไม่มี Sub_id1 ครบ');
    addText(ads, 'p', 'ยังไม่มี Meta Ads Bridge บนเว็บ จึงยังไม่พบ Campaign/Ad ID และยังไม่สั่งเปลี่ยนชื่อ ลิงก์ หรืองบ Ads', 'ep-warning');
    const note = addText(host, 'div', '', 'ep-section');
    addText(note, 'h4', 'หมายเหตุของรายการ');
    const noteInput = document.createElement('textarea'); noteInput.className = 'ep-url'; noteInput.placeholder = 'เช่น โพสต์ติด Boost, ลิงก์ยังไม่ตรง, รอ Ads'; noteInput.value = record.note || '';
    noteInput.setAttribute('aria-label', 'หมายเหตุของรายการ');
    noteInput.addEventListener('change', () => { record.note = noteInput.value.trim(); save(); });
    note.appendChild(noteInput);
  }


  function validFacebookPost(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && ['facebook.com','www.facebook.com'].includes(url.hostname) && url.pathname.includes('/posts/'); }
    catch { return false; }
  }
  function exportBackup() {
    if (!state.records.length) return;
    const blob = new Blob([JSON.stringify({ format: 'aff-edit-post-queue', version: 1, name: state.name, records: state.records }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'AFF-edit-post-backup.affedit'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    message('ดาวน์โหลดไฟล์สำรองคิวงานแล้ว');
  }
  function parseBackup(value) {
    const data = JSON.parse(value);
    if (data?.format !== 'aff-edit-post-queue' || data.version !== 1 || !Array.isArray(data.records) || !data.records.length || data.records.length > 10000) throw new Error('รูปแบบไฟล์สำรองไม่ถูกต้อง');
    const ids = new Set();
    const records = data.records.map((item, index) => {
      if (!validFacebookPost(item?.postUrl) || typeof item.newLink !== 'string') throw new Error('ลิงก์โพสต์หรือรายการในไฟล์ไม่ถูกต้อง');
      const id = String(item.id || index + 1);
      if (ids.has(id)) throw new Error('พบรหัสรายการซ้ำในไฟล์');
      ids.add(id);
      const result = { id, row: Number(item.row) || index + 1 };
      for (const key of ['sequence','postUrl','oldLink','sub1','sub2','sub5','adsCurrentSub1','newSub1','newLink','note']) result[key] = String(item[key] || '').slice(0, 4000);
      result.productChecked = Boolean(item.productChecked);
      result.facebookChecked = Boolean(item.facebookChecked);
      result.commentChecked = Boolean(item.commentChecked);
      return result;
    });
    return { name: String(data.name || 'คิวจากไฟล์สำรอง').slice(0, 200), records };
  }
  async function importBackup(file) {
    try {
      const data = parseBackup(await file.text());
      if (state.records.length && !confirm('เปิดไฟล์สำรองแทนคิวปัจจุบัน? ดาวน์โหลดไฟล์สำรองของคิวปัจจุบันก่อน หากยังไม่ได้บันทึก')) return;
      state.name = data.name; state.records = data.records; state.selectedId = data.records[0].id;
      $('epSearch').value = ''; save(); renderList(); renderDetail();
      message('เปิดไฟล์สำรองแล้ว · ' + data.records.length + ' รายการ');
    } catch (error) { message('เปิดไฟล์สำรองไม่สำเร็จ: ' + (error.message || error), true); }
  }

  async function importFile(file) {
    if (!file) return;
    if (!activeUserId) return message('เข้าสู่ระบบ AFF ก่อนเปิดคิวงาน', true);
    if (/\.affedit$/i.test(file.name)) return importBackup(file);
    if (!/\.xlsx?$/i.test(file.name)) return message('เลือกไฟล์ .xlsx, .xls หรือ .affedit', true);
    if (!root.XLSX) return message('ตัวอ่าน Excel ยังโหลดไม่สำเร็จ กรุณารีเฟรชเว็บแล้วลองอีกครั้ง', true);
    try {
      const workbook = root.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = root.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
      const records = parseRows(rows);
      if (state.records.length && !confirm('เปิด Excel นี้แทนคิวปัจจุบัน? ดาวน์โหลดไฟล์สำรองก่อน หากยังไม่ได้บันทึก')) return;
      const previous = new Map(state.records.map(item => [item.postUrl, item]));
      for (const item of records) {
        const saved = previous.get(item.postUrl);
        if (saved) for (const key of ['newLink','newSub1','adsCurrentSub1','note','productChecked','facebookChecked','commentChecked']) item[key] = saved[key] ?? item[key];
      }
      state.name = file.name; state.records = records; state.selectedId = records[0].id;
      $('epSearch').value = '';
      save(); renderList(); renderDetail();
      const duplicateCount = records.length - new Set(records.map(item => item.postUrl)).size;
      message(`เปิด ${file.name} แล้ว พบ ${records.length} รายการ${duplicateCount ? ` · โพสต์ซ้ำ ${duplicateCount} รายการ กรุณาตรวจ` : ''} · เลือกรายการเพื่อตรวจต่อ`);
    } catch (error) { message(`เปิดไฟล์ไม่สำเร็จ: ${error.message || error}`, true); }
  }
  function exportSummary() {
    if (!root.XLSX || !state.records.length) return message('ตัวส่งออก Excel ยังไม่พร้อม', true);
    const rows = [['รายการ', 'แถวในไฟล์', 'โพสต์ Facebook', 'ลิงก์เดิม', 'ลิงก์ใหม่', 'Sub_id1 เดิม', 'Sub_id1 ใน Ads', 'Sub_id1 ใหม่', 'Sub_id2', 'Sub_id5', 'ตรวจสินค้าเอง', 'ตรวจข้อความโพสต์เอง', 'ตรวจคอมเมนต์เอง', 'หมายเหตุ']];
    for (const r of state.records) rows.push([r.sequence, r.row, r.postUrl, r.oldLink, r.newLink, r.sub1, r.adsCurrentSub1, r.newSub1, r.sub2, r.sub5, r.productChecked ? 'ตรวจเองแล้ว' : 'ยังไม่ตรวจ', r.facebookChecked ? 'ตรวจเองแล้ว' : 'ยังไม่ตรวจ', r.commentChecked ? 'ตรวจเองแล้ว' : 'ยังไม่ตรวจ', r.note]);
    const workbook = root.XLSX.utils.book_new();
    root.XLSX.utils.book_append_sheet(workbook, root.XLSX.utils.aoa_to_sheet(rows), 'สรุปงาน');
    root.XLSX.writeFile(workbook, 'AFF-edit-post-progress.xlsx');
    message('ดาวน์โหลดสรุปงานแล้ว · ช่องตรวจด้วยตนเองไม่ใช่ผลยืนยันจาก Meta');
  }
  function restore() {
    try {
      const data = JSON.parse(localStorage.getItem(queueKey()) || 'null');
      if (Array.isArray(data?.records) && data.records.length) {
        state.name = String(data.name || 'คิวในเครื่อง');
        state.records = data.records;
        state.selectedId = data.records.some(item => item.id === data.selectedId) ? data.selectedId : data.records[0].id;
        message(`เปิดคิวเดิม ${state.name} · ${state.records.length} รายการ`);
      }
    } catch { message('คิวเดิมอ่านไม่ได้ เลือก Excel เพื่อเริ่มใหม่', true); }
    renderList(); renderDetail();
  }
  $('epFile').addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    importFile(file);
  });
  $('epSearch').addEventListener('input', renderList);
  $('epExport').addEventListener('click', exportSummary);
  $('epBackup').addEventListener('click', exportBackup);
  $('epCloudSave').addEventListener('click', () => { clearTimeout(cloudTimer); cloudChain = cloudChain.then(() => persistCloud()).catch(error => cloudStatus('บันทึกบนคลาวด์ไม่สำเร็จ: ' + (error.message || error))); });
  $('epCloudLoad').addEventListener('click', () => loadCloud(true));
  $('epRecover').addEventListener('click', recoverLegacy);
  refreshControls();
  root.__affSupabaseClient?.auth.onAuthStateChange((_event, session) => setTimeout(() => activateUser(session?.user?.id || ''), 0));
  root.__affSupabaseClient?.auth.getUser().then(({ data, error }) => {
    if (error) return cloudStatus('ตรวจบัญชีไม่สำเร็จ: ' + error.message);
    activateUser(data.user?.id || '');
  });
  document.querySelectorAll('[data-page-target]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.pageTarget === 'editpost') {
      history.replaceState(null, '', location.pathname + location.search + '#editpost');
    } else if (location.hash === '#editpost') {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }));
  if (location.hash === '#editpost') document.querySelector('[data-page-target="editpost"]')?.click();
})(typeof window !== 'undefined' ? window : globalThis);

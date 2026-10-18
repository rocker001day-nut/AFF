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
        productChecked: false, facebookChecked: false
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

  const api = { parseRows, validShopee };
  root.AffEditPost = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document?.getElementById('editPostPage')) return;

  const $ = id => document.getElementById(id);
  const state = { name: '', records: [], selectedId: '' };
  function message(value, error = false) {
    $('epMessage').textContent = value;
    $('epMessage').dataset.error = String(error);
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
      addText(button, 'small', item.facebookChecked ? 'ตรวจโพสต์ด้วยตนเองแล้ว' : item.newLink ? 'มีลิงก์ใหม่ · รอตรวจโพสต์' : 'รอลิงก์ใหม่');
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
    addText(top, 'span', record.facebookChecked ? 'ตรวจโพสต์เองแล้ว' : 'ยังไม่ตรวจโพสต์', `ep-pill${record.facebookChecked ? ' ready' : ''}`);

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
    let copyButton, productBox, fbBox;
    function field(name, value, key, wide = false) {
      const label = addText(form, 'label', name, wide ? 'ep-wide' : '');
      const input = document.createElement('input');
      input.type = key === 'newLink' ? 'url' : 'text'; input.value = value; input.dataset.field = key;
      label.appendChild(input);
      input.addEventListener('input', () => {
        const changed = record[key] !== input.value.trim();
        record[key] = input.value.trim();
        if (changed) { record.facebookChecked = false; if (key === 'newLink') record.productChecked = false; }
        save(); renderList();
        const linkReady = validShopee(record.newLink) && record.newLink !== record.oldLink;
        if (copyButton) copyButton.disabled = !linkReady;
        if (productBox) { productBox.disabled = !linkReady; productBox.checked = record.productChecked; }
        if (fbBox) { fbBox.disabled = !record.productChecked; fbBox.checked = record.facebookChecked; }
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
    productBox.addEventListener('change', () => { record.productChecked = productBox.checked; if (!productBox.checked) record.facebookChecked = false; save(); renderList(); renderDetail(); });

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
    addText(fbCheck, 'span', 'ฉันตรวจว่าคำอธิบายและคอมเมนต์มีลิงก์ใหม่แล้ว (ยืนยันด้วยตนเอง)');
    fbBox.addEventListener('change', () => { record.facebookChecked = fbBox.checked; save(); renderList(); renderDetail(); });

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

  async function importFile(file) {
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) return message('เลือกไฟล์ .xlsx หรือ .xls', true);
    if (!root.XLSX) return message('ตัวอ่าน Excel ยังโหลดไม่สำเร็จ กรุณารีเฟรชเว็บแล้วลองอีกครั้ง', true);
    try {
      const workbook = root.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = root.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
      const records = parseRows(rows);
      state.name = file.name; state.records = records; state.selectedId = records[0].id;
      $('epSearch').value = '';
      save(); renderList(); renderDetail();
      message(`เปิด ${file.name} แล้ว พบ ${records.length} รายการ · เลือกรายการเพื่อตรวจต่อ`);
    } catch (error) { message(`เปิดไฟล์ไม่สำเร็จ: ${error.message || error}`, true); }
  }
  function exportSummary() {
    if (!root.XLSX || !state.records.length) return message('ตัวส่งออก Excel ยังไม่พร้อม', true);
    const rows = [['รายการ', 'แถวในไฟล์', 'โพสต์ Facebook', 'ลิงก์เดิม', 'ลิงก์ใหม่', 'Sub_id1 เดิม', 'Sub_id1 ใน Ads', 'Sub_id1 ใหม่', 'Sub_id2', 'Sub_id5', 'ตรวจสินค้าเอง', 'ตรวจโพสต์เอง', 'หมายเหตุ']];
    for (const r of state.records) rows.push([r.sequence, r.row, r.postUrl, r.oldLink, r.newLink, r.sub1, r.adsCurrentSub1, r.newSub1, r.sub2, r.sub5, r.productChecked ? 'ตรวจเองแล้ว' : 'ยังไม่ตรวจ', r.facebookChecked ? 'ตรวจเองแล้ว' : 'ยังไม่ตรวจ', r.note]);
    const workbook = root.XLSX.utils.book_new();
    root.XLSX.utils.book_append_sheet(workbook, root.XLSX.utils.aoa_to_sheet(rows), 'สรุปงาน');
    root.XLSX.writeFile(workbook, 'AFF-edit-post-progress.xlsx');
    message('ดาวน์โหลดสรุปงานแล้ว · ช่องตรวจด้วยตนเองไม่ใช่ผลยืนยันจาก Meta');
  }
  function restore() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
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
  restore();
  document.querySelectorAll('[data-page-target]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.pageTarget === 'editpost') {
      history.replaceState(null, '', location.pathname + location.search + '#editpost');
    } else if (location.hash === '#editpost') {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }));
  if (location.hash === '#editpost') document.querySelector('[data-page-target="editpost"]')?.click();
})(typeof window !== 'undefined' ? window : globalThis);

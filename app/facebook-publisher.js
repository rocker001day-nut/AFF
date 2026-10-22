(function (root) {
  'use strict';
  const KEY = 'aff-facebook-publisher-draft-v1';
  const $ = id => root.document && root.document.getElementById(id);
  let imageUrl = '';
  let connectedPages = [];

  function validUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      return url.protocol === 'https:' && !!url.hostname ? url : null;
    } catch { return null; }
  }

  function planTimes(start, delaySeconds, pages) {
    const base = Number(start);
    const delay = Number(delaySeconds);
    if (!Number.isFinite(base) || !Number.isInteger(delay) || delay < 5 || delay > 3600) {
      throw new Error('ดีเลย์ต้องอยู่ระหว่าง 5 ถึง 3,600 วินาที');
    }
    const unique = [...new Set(pages.map(String).map(x => x.trim()).filter(Boolean))];
    return unique.map((page, index) => ({ page, at: new Date(base + index * delay * 1000).toISOString() }));
  }

  root.AffPublisherDraft = { planTimes, validUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AffPublisherDraft;
  if (!$('facebookPublisherPage')) return;

  function setStatus(message, error) {
    $('fpStatus').textContent = message;
    $('fpStatus').dataset.error = String(!!error);
  }

  function selectedPages() {
    const checked = [...$('fpPages').querySelectorAll('input:checked')].map(el => el.value);
    if (checked.length) return checked;
    return $('fpPreviewPages').value.split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);
  }

  function render() {
    const caption = $('fpCaption').value.trim();
    const destination = validUrl($('fpDestination').value);
    const delay = Number($('fpDelay').value);
    $('fpPreviewText').textContent = caption || 'ข้อความโพสต์จะแสดงตรงนี้';
    $('fpPreviewImage').src = imageUrl || '';
    $('fpPreviewImage').hidden = !imageUrl;
    $('fpImageEmpty').hidden = !!imageUrl;
    $('fpPreviewDomain').textContent = destination ? destination.hostname.toUpperCase() : 'URL ปลายทาง';
    $('fpPreviewLink').href = destination ? destination.href : '#';
    $('fpPreviewLink').setAttribute('aria-disabled', String(!destination));
    const host = $('fpQueue'); host.replaceChildren();
    const pages = selectedPages();
    let planned = [];
    try {
      const start = new Date($('fpStart').value).getTime();
      if (!Number.isFinite(start)) throw new Error('เลือกเวลาเริ่มโพสต์');
      planned = planTimes(start, delay, pages);
    } catch (error) {
      const item = root.document.createElement('li'); item.textContent = error.message; host.appendChild(item);
      $('fpQueueCount').textContent = 'ตรวจเวลาและดีเลย์';
      return;
    }
    $('fpQueueCount').textContent = pages.length + ' เพจ · ห่างกัน ' + delay + ' วินาที';
    if (!planned.length) {
      const item = root.document.createElement('li');
      item.textContent = 'เชื่อม Facebook หรือใส่ชื่อเพจสำหรับดูตัวอย่างคิว';
      host.appendChild(item);
      return;
    }
    planned.forEach((job, index) => {
      const item = root.document.createElement('li');
      const number = root.document.createElement('strong');
      number.textContent = String(index + 1).padStart(2, '0');
      const body = root.document.createElement('span');
      body.textContent = connectedPages.find(page => page.id === job.page)?.name || job.page;
      const time = root.document.createElement('time');
      time.dateTime = job.at;
      time.textContent = new Intl.DateTimeFormat('th-TH', {
        dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Bangkok'
      }).format(new Date(job.at));
      item.append(number, body, time); host.appendChild(item);
    });
  }

  function saveDraft() {
    const draft = {
      caption: $('fpCaption').value, destination: $('fpDestination').value,
      start: $('fpStart').value, delay: $('fpDelay').value,
      previewPages: $('fpPreviewPages').value,
      selectedPageIds: [...$('fpPages').querySelectorAll('input:checked')].map(el => el.dataset.pageId)
    };
    try { root.localStorage.setItem(KEY, JSON.stringify(draft)); setStatus('บันทึกร่างในเบราว์เซอร์แล้ว · เลือกรูปใหม่เมื่อกลับมา'); }
    catch { setStatus('บันทึกร่างไม่สำเร็จ กรุณาตรวจพื้นที่เก็บข้อมูลในเบราว์เซอร์', true); }
  }

  function restoreDraft() {
    try {
      const draft = JSON.parse(root.localStorage.getItem(KEY) || '{}');
      $('fpCaption').value = draft.caption || '';
      $('fpDestination').value = draft.destination || '';
      $('fpStart').value = draft.start || '';
      $('fpDelay').value = draft.delay || '30';
      $('fpPreviewPages').value = draft.previewPages || '';
      return draft.selectedPageIds || [];
    } catch { return []; }
  }

  async function loadPages(saved) {
    try {
      const statusResponse = await fetch('/api/facebook?action=status', { credentials: 'same-origin', cache: 'no-store' });
      if (!statusResponse.ok) throw new Error('ยังไม่มีบริการเชื่อม Facebook บนเว็บ');
      const status = await statusResponse.json();
      if (!status.connected) throw new Error('เชื่อม Facebook ในหน้า “จัดการแฟนเพจ” ก่อน');
      const response = await fetch('/api/facebook?action=pages', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('ดึงรายชื่อเพจไม่ได้');
      const data = await response.json();
      connectedPages = Array.isArray(data.pages) ? data.pages : [];
      $('fpPages').replaceChildren();
      connectedPages.forEach(page => {
        const label = root.document.createElement('label');
        const check = root.document.createElement('input');
        check.type = 'checkbox'; check.value = page.id;
        check.dataset.pageId = page.id;
        check.checked = saved.includes(page.id);
        check.addEventListener('change', render);
        label.append(check, root.document.createTextNode(page.name || page.id));
        $('fpPages').appendChild(label);
      });
      setStatus(connectedPages.length ? 'พบ ' + connectedPages.length + ' เพจ · เลือกเพจเพื่อดูคิว' : 'ไม่พบเพจที่บัญชีนี้จัดการได้');
    } catch (error) {
      $('fpPages').textContent = 'ยังไม่มีเพจที่เชื่อมต่อ';
      setStatus((error instanceof SyntaxError ? 'บริการ Facebook ยังไม่พร้อม' : error.message) + ' · ตอนนี้ดูตัวอย่างและบันทึกร่างได้', true);
    }
    render();
  }

  $('fpImage').addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = '';
    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
        event.target.value = '';
        setStatus('ใช้ JPG, PNG หรือ WebP ขนาดไม่เกิน 10 MB', true);
      } else {
        imageUrl = URL.createObjectURL(file);
        $('fpImageName').textContent = file.name;
      }
    }
    render();
  });
  $('fpPreviewLink').addEventListener('click', event => {
    if (!validUrl($('fpDestination').value)) event.preventDefault();
  });
  ['fpCaption', 'fpDestination', 'fpStart', 'fpDelay', 'fpPreviewPages'].forEach(id => {
    $(id).addEventListener('input', render);
  });
  $('fpSaveDraft').addEventListener('click', saveDraft);
  const saved = restoreDraft();
  if (!$('fpStart').value) {
    const soon = new Date(Date.now() + 120000);
    const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000);
    $('fpStart').value = local.toISOString().slice(0, 16);
  }
  render();
  document.addEventListener('aff:publisher:open', () => loadPages(saved));
  if (!$('facebookPublisherPage').hidden) loadPages(saved);
  root.addEventListener('beforeunload', () => { if (imageUrl) URL.revokeObjectURL(imageUrl); });
})(typeof window !== 'undefined' ? window : globalThis);

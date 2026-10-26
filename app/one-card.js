(() => {
  const $ = id => document.getElementById(id);
  const endpoint = 'https://txbsrtunejnqaheuohck.supabase.co/functions/v1/facebook-publisher';
  const fields = ['ocTitle','ocDescription','ocLink','ocDisplay','ocMessage','ocCta','ocSchedule'];
  let imageUrl = '', busy = false, cardUrl = '';
  let page = null;
  try { page = JSON.parse(sessionStorage.getItem('affSelectedFacebookPage') || 'null'); } catch {}
  if (page?.name) $('ocPage').value = page.name;
  try {
    const draft = JSON.parse(localStorage.getItem('affOneCardDraft') || '{}');
    for (const id of fields) if (typeof draft[id] === 'string') $(id).value = draft[id];
  } catch {}
  function setStatus(message, error = false) {
    $('ocStatus').textContent = message;
    $('ocStatus').style.color = error ? '#a02721' : '#286047';
  }
  function render() {
    $('previewMessage').textContent = $('ocMessage').value.trim() || 'ข้อความโพสต์';
    $('previewTitle').textContent = $('ocTitle').value.trim() || 'ชื่อการ์ด';
    $('previewDescription').textContent = $('ocDescription').value.trim() || 'คำอธิบาย';
    $('previewDisplay').textContent = $('ocDisplay').value.trim() || (() => { try { return new URL($('ocLink').value).hostname; } catch { return 'URL ที่แสดง'; } })();
    $('previewCta').textContent = $('ocCta').selectedOptions[0].textContent;
  }
  function clearCard() {
    cardUrl = '';
    $('ocCardReady').hidden = true;
  }
  fields.forEach(id => {
    $(id).addEventListener('input', render);
    $(id).addEventListener('input', clearCard);
  });
  $('ocImage').addEventListener('change', () => {
    clearCard();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    const file = $('ocImage').files[0];
    imageUrl = file && ['image/jpeg','image/png','image/webp'].includes(file.type) && file.size <= 8 * 1024 * 1024 ? URL.createObjectURL(file) : '';
    $('previewImage').src = imageUrl;
    setStatus(file && !imageUrl ? 'เลือกภาพ JPG, PNG หรือ WebP ไม่เกิน 8 MB' : 'ภาพพร้อมสำหรับสร้างลิงก์', !!file && !imageUrl);
  });
  function destination() {
    try {
      const url = new URL($('ocLink').value.trim());
      if (url.protocol !== 'https:' || url.username || url.password) throw Error();
      return url.href;
    } catch { return null; }
  }
  function saveDraft() {
    if ($('ocLink').value.trim() && !destination()) return setStatus('ลิงก์ปลายทางต้องเริ่มด้วย https://', true);
    localStorage.setItem('affOneCardDraft', JSON.stringify(Object.fromEntries(fields.map(id => [id, $(id).value]))));
    setStatus('บันทึกร่างใน Chrome เครื่องนี้แล้ว · เลือกภาพใหม่เมื่อกลับมา');
  }
  async function api(action, body, type) {
    const client = window.__affOneCardClient;
    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session) throw Error('กรุณาเข้าสู่ระบบ AFF ก่อนสร้างลิงก์การ์ด');
    const response = await fetch(endpoint + '?action=' + encodeURIComponent(action), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': type || 'application/json' },
      body: type ? body : JSON.stringify(body),
      cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw Error(result.message || 'สร้างการ์ดไม่สำเร็จ (' + response.status + ')');
    return result;
  }
  $('ocCreate').addEventListener('click', async () => {
    if (busy) return;
    const file = $('ocImage').files[0], link = destination();
    if (!file || !imageUrl) return setStatus('เลือกภาพ JPG, PNG หรือ WebP ไม่เกิน 8 MB', true);
    if (!link) return setStatus('กรุณาใส่ลิงก์ปลายทาง HTTPS', true);
    busy = true;
    $('ocCreate').disabled = true;
    clearCard();
    try {
      setStatus('กำลังอัปโหลดภาพ…');
      const image = await api('image', file, file.type);
      setStatus('กำลังสร้างลิงก์ภาพ…');
      const card = await api('create-card', {
        imagePath: image.path,
        caption: $('ocTitle').value.trim() || $('ocMessage').value.trim(),
        destination: link
      });
      cardUrl = card.cardUrl;
      const cardLink = $('ocCardLink');
      cardLink.href = cardUrl;
      cardLink.textContent = cardUrl;
      $('ocCardReady').hidden = false;
      setStatus('สร้างลิงก์แล้ว · คัดลอกและวางเป็นโพสต์ของเพจ Facebook เพื่อตรวจภาพก่อนเผยแพร่');
    } catch (error) { setStatus(error.message, true); }
    finally { busy = false; $('ocCreate').disabled = false; }
  });
  $('ocCopy').addEventListener('click', async () => {
    if (!cardUrl) return;
    try {
      await navigator.clipboard.writeText([$('ocMessage').value.trim(), cardUrl].filter(Boolean).join('\n\n'));
      setStatus('คัดลอกแล้ว · วางในช่องสร้างโพสต์ของเพจ Facebook');
    } catch { setStatus('คัดลอกอัตโนมัติไม่ได้ ให้คัดลอกลิงก์ที่แสดงด้านบน', true); }
  });
  $('ocSave').addEventListener('click', saveDraft);
  $('ocGoAuto').addEventListener('click', () => {
    const draft = {
      caption: $('ocMessage').value,
      destination: $('ocLink').value,
      start: $('ocSchedule').value,
      delay: '30',
      selectedPageIds: page?.source === 'oauth' && page.id ? [page.id] : []
    };
    localStorage.setItem('aff-facebook-publisher-draft-v2', JSON.stringify(draft));
  });
  window.addEventListener('beforeunload', () => { if (imageUrl) URL.revokeObjectURL(imageUrl); });
  render();
})();
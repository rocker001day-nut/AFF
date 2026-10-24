(() => {
  const $ = id => document.getElementById(id);
  const fields = ['ocTitle','ocDescription','ocLink','ocDisplay','ocMessage','ocCta','ocSchedule'];
  let imageUrl = '';
  const page = JSON.parse(sessionStorage.getItem('affSelectedFacebookPage') || 'null');
  if (page?.name) $('ocPage').value = page.name;
  try {
    const draft = JSON.parse(localStorage.getItem('affOneCardDraft') || '{}');
    for (const id of fields) if (typeof draft[id] === 'string') $(id).value = draft[id];
  } catch { /* A previous draft may be incomplete. */ }
  function render() {
    $('previewMessage').textContent = $('ocMessage').value.trim() || 'ข้อความโพสต์';
    $('previewTitle').textContent = $('ocTitle').value.trim() || 'ชื่อการ์ด';
    $('previewDescription').textContent = $('ocDescription').value.trim() || 'คำอธิบาย';
    $('previewDisplay').textContent = $('ocDisplay').value.trim() || (() => { try { return new URL($('ocLink').value).hostname; } catch { return 'URL ที่แสดง'; } })();
    $('previewCta').textContent = $('ocCta').selectedOptions[0].textContent;
  }
  fields.forEach(id => $(id).addEventListener('input', render));
  $('ocImage').addEventListener('change', () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    const file = $('ocImage').files[0];
    imageUrl = file && ['image/jpeg','image/png','image/webp'].includes(file.type) && file.size <= 8 * 1024 * 1024 ? URL.createObjectURL(file) : '';
    $('previewImage').src = imageUrl;
    $('ocStatus').textContent = file && !imageUrl ? 'เลือกภาพ JPG, PNG หรือ WebP ไม่เกิน 8 MB' : 'ภาพนี้แสดงตัวอย่างในเครื่อง ยังไม่ได้อัปโหลด';
  });
  $('ocSave').addEventListener('click', () => {
    const link = $('ocLink').value.trim();
    try { if (link && new URL(link).protocol !== 'https:') throw Error(); }
    catch { $('ocStatus').textContent = 'ลิงก์ปลายทางต้องเริ่มด้วย https://'; return; }
    localStorage.setItem('affOneCardDraft', JSON.stringify(Object.fromEntries(fields.map(id => [id, $(id).value]))));
    $('ocStatus').textContent = 'บันทึกร่างใน Chrome เครื่องนี้แล้ว · เลือกภาพใหม่เมื่อกลับมา';
  });
  window.addEventListener('beforeunload', () => { if (imageUrl) URL.revokeObjectURL(imageUrl); });
  render();
})();

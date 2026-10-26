(() => {
  const BASE = 'https://txbsrtunejnqaheuohck.supabase.co/functions/v1/facebook-publisher';
  const client = window.__affSupabaseClient;
  const list = document.getElementById('pageList');
  const count = document.getElementById('pageCount');
  const status = document.getElementById('pageStatus');
  const notice = document.getElementById('pageSetupNotice');
  const localStatus = document.getElementById('fpLocalStatus');
  const localButton = document.getElementById('fpDiscoverLocal');
  let requestId = 0, localPages = null, pendingRequest = null, extensionSeen = false;

  function renderPages(pages, source) {
    count.textContent = pages.length + ' เพจ';
    list.replaceChildren();
    for (const page of pages) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'page';
      button.setAttribute('aria-pressed', 'false');
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = (page.name || 'P').slice(0, 1);
      const name = document.createElement('strong');
      name.textContent = page.name || page.id;
      button.append(avatar, name);
      button.addEventListener('click', () => {
        list.querySelectorAll('.page').forEach(item => item.setAttribute('aria-pressed', 'false'));
        button.setAttribute('aria-pressed', 'true');
        sessionStorage.setItem('affSelectedFacebookPage', JSON.stringify({ id: page.id, name: page.name, source }));
        document.getElementById('goOneCard').hidden = false;
      });
      list.append(button);
    }
    if (!pages.length) list.textContent = 'ยังไม่พบเพจ';
    status.textContent = pages.length ? (source === 'chrome' ? 'พบจาก Chrome · ใช้ดูตัวอย่างเท่านั้น ต้องเชื่อม Facebook ด้านบนเพื่อโพสต์' : 'เพจที่ Facebook อนุญาตให้ AFF จัดการ') : '';
  }

  async function refreshPages() {
    const current = ++requestId;
    const { data, error } = await client.auth.getSession();
    if (current !== requestId || localPages) return;
    if (error || !data.session) {
      renderPages([], 'oauth');
      list.textContent = 'เข้าสู่ระบบ AFF ก่อน แล้วกด “เชื่อม Facebook และดึงเพจ”';
      return;
    }
    list.textContent = 'กำลังดึงรายชื่อเพจ…';
    try {
      const response = await fetch(BASE + '?action=status', {
        headers: { Authorization: 'Bearer ' + data.session.access_token }, cache: 'no-store'
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.message || 'ดึงข้อมูลเพจไม่สำเร็จ');
      if (current !== requestId || localPages) return;
      notice.hidden = !!result.oauthReady;
      renderPages(result.pages || [], 'oauth');
      if (!result.pages?.length) list.textContent = result.oauthReady ? 'ยังไม่พบเพจที่อนุญาต ลองเชื่อม Facebook อีกครั้ง' : 'เจ้าของเว็บต้องเปิดการเชื่อม Facebook ก่อนจึงจะโพสต์ได้';
      if (result.syncError) status.textContent = result.syncError;
    } catch (error) {
      if (current === requestId && !localPages) { list.textContent = 'ยังดึงเพจไม่ได้'; status.textContent = error.message; }
    }
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'aff-facebook-extension') return;
    if (event.data.type === 'FACEBOOK_STATUS') {
      extensionSeen = true;
      localStatus.textContent = event.data.loggedIn ? 'พบ Facebook ที่ล็อกอินใน Chrome · กดค้นหาเพจ' : 'พบส่วนขยาย AFF แล้ว · กรุณาล็อกอิน Facebook ใน Chrome';
    }
    if (event.data.type === 'FACEBOOK_PAGES' && pendingRequest === event.data.requestId) {
      pendingRequest = null;
      localButton.disabled = false;
      extensionSeen = true;
      if (event.data.error) return localStatus.textContent = event.data.error;
      if (!event.data.loggedIn) return localStatus.textContent = 'กรุณาล็อกอิน Facebook ใน Chrome ก่อน';
      const pages = Array.isArray(event.data.pages) ? event.data.pages.filter(page => /^\d{5,30}$/.test(String(page.id)) && typeof page.name === 'string').slice(0, 100) : [];
      localPages = pages;
      renderPages(pages, 'chrome');
      localStatus.textContent = pages.length ? 'ค้นหาเสร็จแล้ว · พบ ' + pages.length + ' เพจ' : 'ไม่พบเพจบนหน้า Facebook Pages ใน Chrome · ตรวจว่า Facebook แสดงเพจที่ดูแลอยู่';
    }
  });
  localButton.addEventListener('click', () => {
    if (pendingRequest) return;
    const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    pendingRequest = id;
    localButton.disabled = true;
    localStatus.textContent = 'กำลังเปิดหน้าเพจใน Chrome เพื่อตรวจรายชื่อ…';
    window.postMessage({ source: 'aff-publisher', type: 'DISCOVER_PAGES', requestId: id }, location.origin);
    setTimeout(() => {
      if (pendingRequest !== id) return;
      pendingRequest = null;
      localButton.disabled = false;
      localStatus.textContent = extensionSeen ? 'ตรวจเพจหมดเวลา ลองใหม่อีกครั้ง' : 'ยังไม่พบส่วนขยาย AFF ใน Chrome เครื่องนี้';
    }, 27000);
  });
  client.auth.onAuthStateChange(() => setTimeout(refreshPages, 0));
  document.addEventListener('aff:publisher:open', refreshPages);
  refreshPages();
  window.postMessage({ source: 'aff-publisher', type: 'CHECK_FACEBOOK' }, location.origin);
  setTimeout(() => { if (!extensionSeen) localStatus.textContent = 'ยังไม่พบส่วนขยาย AFF ใน Chrome เครื่องนี้'; }, 1800);
  fetch(BASE + '?action=setup').then(r => r.json()).then(data => { if (!data.oauthReady) notice.hidden = false; }).catch(() => {});
})();

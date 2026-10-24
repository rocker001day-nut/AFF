(() => {
  const BASE = 'https://txbsrtunejnqaheuohck.supabase.co/functions/v1/facebook-publisher';
  const client = window.__affSupabaseClient;
  const list = document.getElementById('pageList');
  const count = document.getElementById('pageCount');
  const status = document.getElementById('pageStatus');
  const notice = document.getElementById('pageSetupNotice');
  let requestId = 0;
  async function refreshPages() {
    const current = ++requestId;
    const { data, error } = await client.auth.getSession();
    if (current !== requestId) return;
    if (error || !data.session) {
      list.textContent = 'เชื่อม Facebook เพื่อแสดงรายชื่อเพจ';
      count.textContent = '0 เพจ';
      status.textContent = '';
      return;
    }
    list.textContent = 'กำลังดึงรายชื่อเพจ…';
    try {
      const response = await fetch(BASE + '?action=status', {
        headers: { Authorization: 'Bearer ' + data.session.access_token }, cache: 'no-store'
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.message || 'ดึงข้อมูลเพจไม่สำเร็จ');
      if (current !== requestId) return;
      notice.hidden = !!result.oauthReady;
      const pages = result.pages || [];
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
        button.addEventListener('click', () => button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')));
        list.append(button);
      }
      if (!pages.length) list.textContent = result.oauthReady ? 'ยังไม่พบเพจที่อนุญาต ลองกดเชื่อม Facebook อีกครั้งและเลือกเพจ' : 'เจ้าของเว็บยังไม่ได้เปิดระบบเชื่อมเพจ';
      status.textContent = result.syncError || (pages.length ? 'เลือกเพจที่ต้องการได้จากรายการด้านบน' : '');
    } catch (e) {
      if (current === requestId) { list.textContent = 'ยังดึงเพจไม่ได้'; status.textContent = e.message; }
    }
  }
  client.auth.onAuthStateChange(() => setTimeout(refreshPages, 0));
  document.addEventListener('aff:publisher:open', refreshPages);
  refreshPages();
  fetch(BASE + '?action=setup').then(r => r.json()).then(data => { if (!data.oauthReady) notice.hidden = false; }).catch(() => {});
})();

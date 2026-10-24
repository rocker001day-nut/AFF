(() => {
  const BASE = 'https://txbsrtunejnqaheuohck.supabase.co';
  const KEY = 'sb_publishable_sEfsAWiZU83ZWgFviwzskg_Nyj4eUR2';
  const client = window.supabase.createClient(BASE, KEY);
  const endpoint = BASE + '/functions/v1/facebook-publisher';
  window.__affSupabaseClient = client;
  const label = document.getElementById('publicAuthStatus');
  const login = document.getElementById('publicLogin');
  const logout = document.getElementById('publicLogout');
  let ready = false, lastImportedToken = '', importing = false;
  const isFacebook = user => (user?.identities || []).some(item => item.provider === 'facebook');
  function update(user) {
    label.textContent = user ? (isFacebook(user) ? 'เชื่อมบัญชี Facebook แล้ว' : 'เข้าสู่ระบบอยู่ · เชื่อม Facebook เพื่อดึงเพจ') : 'เชื่อม Facebook เพื่อดึงเพจที่คุณดูแล';
    login.hidden = !!user && isFacebook(user);
    logout.hidden = !user;
    if (user) document.dispatchEvent(new Event('aff:publisher:open'));
  }
  async function checkSetup() {
    try {
      const [auth, publisher] = await Promise.all([
        fetch(BASE + '/auth/v1/settings', { headers: { apikey: KEY } }).then(r => r.json()),
        fetch(endpoint + '?action=setup').then(r => r.json())
      ]);
      ready = auth.external?.facebook === true && publisher.oauthReady === true;
      if (!ready) {
        login.disabled = true;
        label.textContent = 'เว็บยังไม่เปิด Facebook Login และแอปเชื่อมเพจกลาง';
      } else login.disabled = false;
      const connect = document.getElementById('fpConnect');
      if (connect && !ready) connect.disabled = true;
    } catch {
      ready = false;
      login.disabled = true;
      label.textContent = 'ตรวจการเชื่อม Facebook ไม่ได้ กรุณารีเฟรชหน้า';
    }
  }
  async function loginWithFacebook() {
    if (!ready) return label.textContent = 'เว็บยังไม่เปิด Facebook Login สำหรับผู้ใช้ทั่วไป';
    label.textContent = 'กำลังเปิด Facebook เพื่อให้อนุญาตเพจ…';
    const { error } = await client.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        redirectTo: location.origin + '/post-a-card',
        scopes: 'email,pages_show_list,pages_read_engagement,pages_manage_posts'
      }
    });
    if (error) label.textContent = 'เชื่อม Facebook ไม่สำเร็จ: ' + error.message;
  }
  window.__affFacebookLogin = loginWithFacebook;
  login.addEventListener('click', loginWithFacebook);
  logout.addEventListener('click', async () => {
    const { error } = await client.auth.signOut();
    if (error) label.textContent = error.message;
  });
  async function importPages(session) {
    if (importing || !session?.provider_token || !isFacebook(session.user) || session.user.app_metadata?.provider !== 'facebook' || session.provider_token === lastImportedToken) return;
    importing = true;
    lastImportedToken = session.provider_token;
    label.textContent = 'กำลังดึงเพจที่ Facebook อนุญาต…';
    try {
      const response = await fetch(endpoint + '?action=connect-facebook-token', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerToken: session.provider_token })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.message || 'ดึงเพจไม่สำเร็จ');
      label.textContent = result.pageCount ? 'เชื่อมแล้ว ' + result.pageCount + ' เพจ · เลือกเพจเพื่อโพสต์ได้' : 'Facebook ยังไม่ส่งเพจที่คุณดูแลกลับมา';
      document.dispatchEvent(new Event('aff:publisher:open'));
    } catch (error) {
      label.textContent = error.message;
      login.hidden = false;
    } finally { importing = false; }
  }
  client.auth.onAuthStateChange((_event, session) => {
    update(session?.user || null);
    if (session?.provider_token) setTimeout(() => importPages(session), 0);
  });
  client.auth.getUser().then(({ data }) => update(data.user || null)).catch(() => update(null));
  checkSetup();
})();

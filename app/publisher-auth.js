(() => {
  const BASE = 'https://txbsrtunejnqaheuohck.supabase.co';
  const KEY = 'sb_publishable_sEfsAWiZU83ZWgFviwzskg_Nyj4eUR2';
  const client = window.supabase.createClient(BASE, KEY);
  const endpoint = BASE + '/functions/v1/facebook-publisher';
  window.__affSupabaseClient = client;
  const label = document.getElementById('publicAuthStatus');
  const login = document.getElementById('publicLogin');
  const logout = document.getElementById('publicLogout');
  const google = document.getElementById('publicGoogleLogin');
  let ready = false, currentUser = null, connecting = false;

  function update(user) {
    currentUser = user;
    login.hidden = false;
    login.disabled = !ready || !user || connecting;
    logout.hidden = !user;
    if (google) google.hidden = !!user;
    label.textContent = !user ? 'เข้าสู่ระบบ AFF ก่อนเชื่อม Facebook' :
      ready ? 'เข้าสู่ระบบ AFF แล้ว · กดเชื่อม Facebook เพื่อดึงเพจ' :
      'เจ้าของเว็บยังไม่ได้เปิดการเชื่อม Facebook';
    if (user) document.dispatchEvent(new Event('aff:publisher:open'));
  }
  async function checkSetup() {
    try {
      const response = await fetch(endpoint + '?action=setup', {cache:'no-store'});
      const result = await response.json();
      ready = response.ok && result.oauthReady === true;
      update(currentUser);
      const connect = document.getElementById('fpConnect');
      if (connect) connect.disabled = !ready || !currentUser;
    } catch {
      ready = false;
      update(currentUser);
      label.textContent = 'ตรวจระบบเชื่อม Facebook ไม่ได้ กรุณารีเฟรชหน้า';
    }
  }
  async function loginWithFacebook() {
    if (connecting) return;
    if (!ready) return label.textContent = 'เจ้าของเว็บต้องตั้งค่า Meta App หรือผู้ให้บริการโพสต์ก่อน';
    connecting = true;
    login.disabled = true;
    try {
      const {data, error} = await client.auth.getSession();
      if (error || !data.session) throw Error('กรุณาเข้าสู่ระบบ AFF ที่หน้าแรกก่อน');
      label.textContent = 'กำลังเปิด Facebook เพื่อให้อนุญาตเพจ…';
      const response = await fetch(endpoint + '?action=login', {
        method: 'POST',
        headers: {Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json'},
        body: '{}',
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw Error(result.message || 'เริ่มเชื่อม Facebook ไม่สำเร็จ');
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || !['www.facebook.com', 'app.upload-post.com'].includes(url.hostname))
        throw Error('ปลายทางเชื่อม Facebook ไม่ถูกต้อง');
      location.assign(url.href);
    } catch (error) {
      label.textContent = error.message;
      connecting = false;
      login.disabled = !ready || !currentUser;
    }
  }
  window.__affFacebookLogin = loginWithFacebook;
  if (google) google.addEventListener('click', async () => {
    google.disabled = true;
    label.textContent = 'กำลังเปิด Google Login…';
    try {
      const {error} = await client.auth.signInWithOAuth({
        provider: 'google', options: {redirectTo: location.origin + location.pathname}
      });
      if (error) throw error;
    } catch (error) {
      label.textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + error.message;
      google.disabled = false;
    }
  });
  login.addEventListener('click', loginWithFacebook);
  logout.addEventListener('click', async () => {
    const {error} = await client.auth.signOut();
    if (error) label.textContent = error.message;
    else sessionStorage.removeItem('affSelectedFacebookPage');
  });
  client.auth.onAuthStateChange((_event, session) => update(session?.user || null));
  client.auth.getUser().then(({data}) => update(data.user || null)).catch(() => update(null));
  checkSetup();
})();
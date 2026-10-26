(() => {
  const status = document.getElementById('ocAuthStatus');
  const create = document.getElementById('ocCreate');
  const google = document.getElementById('ocGoogleLogin');
  if (!window.supabase?.createClient) {
    status.textContent = 'ระบบล็อกอินยังไม่พร้อม กรุณารีเฟรชหน้า';
    return;
  }
  const client = window.supabase.createClient(
    'https://txbsrtunejnqaheuohck.supabase.co',
    'sb_publishable_sEfsAWiZU83ZWgFviwzskg_Nyj4eUR2'
  );
  window.__affOneCardClient = client;
  function update(session) {
    create.disabled = !session;
    google.hidden = !!session;
    status.textContent = session ? 'เข้าสู่ระบบ AFF แล้ว พร้อมสร้างลิงก์' : 'ยังไม่ได้เข้าสู่ระบบ AFF';
  }
  google.addEventListener('click', async () => {
    google.disabled = true;
    status.textContent = 'กำลังเปิด Google Login…';
    try {
      const {error} = await client.auth.signInWithOAuth({
        provider: 'google', options: {redirectTo: location.origin + location.pathname}
      });
      if (error) throw error;
    } catch (error) {
      status.textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + error.message;
      google.disabled = false;
    }
  });
  client.auth.getSession().then(({data,error}) => update(error ? null : data.session)).catch(() => update(null));
  client.auth.onAuthStateChange((_event,session) => update(session));
})();
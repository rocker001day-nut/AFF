(() => {
  const status = document.getElementById('ocAuthStatus');
  const create = document.getElementById('ocCreate');
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
    status.textContent = session ? 'เข้าสู่ระบบ AFF แล้ว พร้อมสร้างลิงก์' : 'ยังไม่ได้เข้าสู่ระบบ AFF';
  }
  client.auth.getSession().then(({data,error}) => update(error ? null : data.session)).catch(() => update(null));
  client.auth.onAuthStateChange((_event,session) => update(session));
})();
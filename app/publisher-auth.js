(() => {
  const client = window.supabase.createClient(
    'https://txbsrtunejnqaheuohck.supabase.co',
    'sb_publishable_sEfsAWiZU83ZWgFviwzskg_Nyj4eUR2'
  );
  window.__affSupabaseClient = client;
  const label = document.getElementById('publicAuthStatus');
  const login = document.getElementById('publicLogin');
  const logout = document.getElementById('publicLogout');
  function update(user) {
    label.textContent = user ? 'เข้าสู่ระบบ: ' + (user.email || 'บัญชีของคุณ') : 'เข้าสู่ระบบ Google เพื่อสร้างการ์ดและเชื่อมเพจของคุณ';
    login.hidden = !!user;
    logout.hidden = !user;
    if (user) document.dispatchEvent(new Event('aff:publisher:open'));
  }
  login.addEventListener('click', async () => {
    label.textContent = 'กำลังเปิด Google Login…';
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + '/post-a-card' }
    });
    if (error) label.textContent = error.message;
  });
  logout.addEventListener('click', async () => {
    const { error } = await client.auth.signOut();
    if (error) label.textContent = error.message;
  });
  client.auth.onAuthStateChange((_event, session) => update(session?.user || null));
  client.auth.getUser().then(({ data }) => update(data.user || null)).catch(() => update(null));
})();

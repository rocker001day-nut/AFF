const status = document.getElementById('status');

async function check() {
  status.textContent = 'กำลังตรวจสถานะ…';
  status.dataset.state = '';
  try {
    const cookie = await chrome.cookies.get({ url: 'https://www.facebook.com/', name: 'c_user' });
    const loggedIn = Boolean(cookie);
    status.textContent = loggedIn ? 'พบว่าล็อกอิน Facebook ใน Chrome นี้' : 'ยังไม่พบการล็อกอิน Facebook ใน Chrome นี้';
    status.dataset.state = loggedIn ? 'on' : 'off';
  } catch {
    status.textContent = 'ตรวจไม่ได้ กรุณาตรวจสิทธิ์ของส่วนขยาย';
    status.dataset.state = 'off';
  }
}

document.getElementById('refresh').addEventListener('click', check);
document.getElementById('openAFF').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://aff-lyart.vercel.app/post-a-card?affConnect=1' });
});
document.getElementById('openFacebook').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.facebook.com/' });
});
check();

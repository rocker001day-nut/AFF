document.getElementById('openAFF').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://aff-lyart.vercel.app/#editpost' });
});
document.getElementById('openFacebook').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.facebook.com/' });
});

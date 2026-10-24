(() => {
  const origin = 'https://aff-lyart.vercel.app';
  if (window.top !== window || location.origin !== origin) return;

  async function report() {
    let loggedIn = false;
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'AFF_CHECK_FACEBOOK' });
      loggedIn = reply?.loggedIn === true;
    } catch {
      // The extension may have been reloaded while this tab was open.
    }
    window.postMessage({ source: 'aff-facebook-extension', type: 'FACEBOOK_STATUS', loggedIn }, origin);
  }

  window.addEventListener('message', event => {
    if (event.source === window && event.origin === origin &&
        event.data?.source === 'aff-publisher' && event.data?.type === 'CHECK_FACEBOOK') report();
    if (event.source === window && event.origin === origin &&
        event.data?.source === 'aff-publisher' && event.data?.type === 'DISCOVER_PAGES') {
      chrome.runtime.sendMessage({ type: 'AFF_DISCOVER_PAGES' }).then(reply => {
        window.postMessage({ source: 'aff-facebook-extension', type: 'FACEBOOK_PAGES',
          requestId: event.data.requestId, loggedIn: reply?.loggedIn === true,
          pages: Array.isArray(reply?.pages) ? reply.pages : [], error: reply?.error || '' }, origin);
      }).catch(() => {
        window.postMessage({ source: 'aff-facebook-extension', type: 'FACEBOOK_PAGES',
          requestId: event.data.requestId, loggedIn: false, pages: [], error: 'ส่วนขยายไม่ตอบสนอง' }, origin);
      });
    }
  });
  report();
})();

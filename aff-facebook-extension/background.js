const AFF_ORIGIN = 'https://aff-lyart.vercel.app';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['AFF_CHECK_FACEBOOK', 'AFF_DISCOVER_PAGES'].includes(message?.type)) return;
  let authorized = false;
  try {
    authorized = new URL(sender.url).origin === AFF_ORIGIN && sender.frameId === 0;
  } catch {
    // The request must come from the AFF page's top frame.
  }
  if (!authorized) {
    sendResponse({ loggedIn: false });
    return;
  }

  chrome.cookies.get({ url: 'https://www.facebook.com/', name: 'c_user' })
    .then(async cookie => {
      if (!cookie) return sendResponse({ loggedIn: false, pages: [] });
      if (message.type === 'AFF_CHECK_FACEBOOK') return sendResponse({ loggedIn: true });
      try { sendResponse({ loggedIn: true, pages: await discoverPages() }); }
      catch (error) { sendResponse({ loggedIn: true, pages: [], error: error.message }); }
    })
    .catch(() => sendResponse({ loggedIn: false, pages: [], error: 'ตรวจ Facebook ใน Chrome ไม่สำเร็จ' }));
  return true;
});

async function discoverPages() {
  // Let Facebook render its own Pages screen in the user's browser session.
  // No cookie value, Facebook response body, or request headers leave Chrome.
  const tab = await chrome.tabs.create({ url: 'https://www.facebook.com/pages/?category=your_pages', active: false });
  try {
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      const current = await chrome.tabs.get(tab.id);
      if (!current.url?.startsWith('https://www.facebook.com/pages/')) {
        if (current.url?.includes('/login')) throw Error('กรุณาล็อกอิน Facebook ใน Chrome ก่อน');
        continue;
      }
      let result;
      try { [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const found = new Map();
          for (const anchor of document.querySelectorAll('a[href]')) {
            const raw = anchor.getAttribute('href') || '';
            let url;
            try { url = new URL(raw, location.origin); } catch { continue; }
            if (!['www.facebook.com', 'web.facebook.com'].includes(url.hostname)) continue;
            const match = url.pathname.match(/^\/pages\/[^/]+\/(\d{5,30})\/?$/) ||
              (url.pathname === '/profile.php' && /^\d{5,30}$/.test(url.searchParams.get('id') || '') ? [null, url.searchParams.get('id')] : null);
            if (!match) continue;
            const name = (anchor.getAttribute('aria-label') || anchor.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
            if (!name || /^\d+$/.test(name)) continue;
            found.set(match[1], { id: match[1], name });
          }
          return [...found.values()].slice(0, 100);
        }
      }); } catch { continue; }
      if (result?.length) return result;
    }
    throw Error('ไม่พบลิงก์เพจในหน้า Facebook Pages · อาจต้องเปิดหน้านั้นและตรวจสิทธิ์เพจ');
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

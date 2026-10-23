const AFF_ORIGIN = 'https://aff-lyart.vercel.app';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'AFF_CHECK_FACEBOOK') return;
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
    .then(cookie => sendResponse({ loggedIn: Boolean(cookie) }))
    .catch(() => sendResponse({ loggedIn: false }));
  return true;
});

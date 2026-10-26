(() => {
  'use strict';
  const origin = 'https://aff-lyart.vercel.app';
  if (window.top !== window || location.origin !== origin) return;
  window.postMessage({ source: 'aff-edit-post-extension', type: 'EXTENSION_READY' }, origin);
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== origin || event.data?.source !== 'aff-edit-post') return;
    if (event.data?.type === 'PING_EXTENSION') {
      window.postMessage({ source: 'aff-edit-post-extension', type: 'EXTENSION_READY' }, origin);
      return;
    }
    if (event.data?.type !== 'START_EXTENSION_EDIT') return;
    const requestId = String(event.data.requestId || '').slice(0, 90);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'AFF_EDIT_START', task: event.data.task });
      window.postMessage({ source: 'aff-edit-post-extension', type: 'EDIT_STARTED', requestId,
        opened: result?.opened === true, error: String(result?.error || '') }, origin);
    } catch {
      window.postMessage({ source: 'aff-edit-post-extension', type: 'EDIT_STARTED', requestId,
        opened: false, error: 'ส่วนขยายไม่ตอบสนอง กรุณารีเฟรชหน้า AFF' }, origin);
    }
  });
})();

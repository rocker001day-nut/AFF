importScripts('editor-core.js');

const AFF_ORIGIN = 'https://aff-lyart.vercel.app';
const FB_HOSTS = new Set(['www.facebook.com', 'web.facebook.com']);
const taskKey = tabId => 'editTask:' + tabId;

function isAffSender(sender) {
  try { return sender.frameId === 0 && new URL(sender.url).origin === AFF_ORIGIN; }
  catch { return false; }
}
function isFacebookSender(sender) {
  try { return sender.frameId === 0 && FB_HOSTS.has(new URL(sender.url).hostname) && Boolean(sender.tab?.id); }
  catch { return false; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'AFF_EDIT_START') {
    (async () => {
      if (!isAffSender(sender)) throw new Error('คำสั่งต้องมาจากหน้า AFF');
      const task = AFFEditCore.validateTask(message.task);
      const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
      try {
        await chrome.storage.session.set({ [taskKey(tab.id)]: task });
        await chrome.tabs.update(tab.id, { url: task.postUrl });
        return { opened: true };
      } catch (error) {
        await chrome.storage.session.remove(taskKey(tab.id));
        await chrome.tabs.remove(tab.id).catch(() => {});
        throw error;
      }
    })().then(respond).catch(error => respond({ opened: false, error: error.message || 'เปิดโพสต์ไม่ได้' }));
    return true;
  }
  if (message?.type === 'AFF_EDIT_GET_TASK') {
    (async () => {
      if (!isFacebookSender(sender)) return { task: null };
      const saved = await chrome.storage.session.get(taskKey(sender.tab.id));
      const task = saved[taskKey(sender.tab.id)];
      if (!task || new URL(sender.url).pathname !== new URL(task.postUrl).pathname) return { task: null };
      return { task };
    })().then(respond).catch(() => respond({ task: null }));
    return true;
  }
  if (message?.type === 'AFF_EDIT_CLEAR') {
    (async () => {
      if (!isFacebookSender(sender)) return { cleared: false };
      await chrome.storage.session.remove(taskKey(sender.tab.id));
      return { cleared: true };
    })().then(respond).catch(() => respond({ cleared: false }));
    return true;
  }
});
chrome.tabs.onRemoved.addListener(tabId => { chrome.storage.session.remove(taskKey(tabId)).catch(() => {}); });

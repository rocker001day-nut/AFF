(function (root) {
  'use strict';
  function parseUrl(value, kind) {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('ลิงก์ยาวเกินไป');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('ใช้ลิงก์ HTTPS เท่านั้น');
    if (kind === 'facebook') {
      if (!['www.facebook.com', 'web.facebook.com'].includes(url.hostname) || !url.pathname.includes('/posts/'))
        throw new Error('ลิงก์โพสต์ Facebook ไม่ถูกต้อง');
    } else if (!['s.shopee.co.th', 'shopee.co.th', 'www.shopee.co.th'].includes(url.hostname) || url.pathname.length < 2) {
      throw new Error('ลิงก์ Shopee ไม่ถูกต้อง');
    }
    return url.href;
  }
  function validateTask(task) {
    if (!task || typeof task !== 'object') throw new Error('ไม่พบข้อมูลรายการ');
    const postUrl = parseUrl(task.postUrl, 'facebook');
    const oldLink = parseUrl(task.oldLink, 'shopee');
    const newLink = parseUrl(task.newLink, 'shopee');
    if (oldLink === newLink) throw new Error('ลิงก์ใหม่ต้องต่างจากลิงก์เดิม');
    return { postUrl, oldLink, newLink, sequence: String(task.sequence || '').slice(0, 60) };
  }
  function replaceOne(text, oldLink, newLink) {
    const input = String(text);
    const index = input.indexOf(oldLink);
    if (index < 0) throw new Error('ไม่พบลิงก์เดิมในช่องแก้ไขที่เปิดอยู่');
    if (input.indexOf(oldLink, index + oldLink.length) !== -1) throw new Error('พบลิงก์เดิมหลายจุด กรุณาแก้ด้วยตนเอง');
    const next = input.charAt(index + oldLink.length);
    if (next && /[a-zA-Z0-9/?#&=%_.-]/.test(next)) throw new Error('ลิงก์เดิมไม่ครบ กรุณาคัดลอกให้ครบ');
    return input.slice(0, index) + newLink + input.slice(index + oldLink.length);
  }
  const api = { parseUrl, validateTask, replaceOne };
  root.AFFEditCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

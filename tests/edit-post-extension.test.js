const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../aff-edit-post-extension/editor-core.js');

const task = {
  postUrl: 'https://www.facebook.com/page/posts/12345',
  oldLink: 'https://s.shopee.co.th/old',
  newLink: 'https://s.shopee.co.th/new'
};

test('accepts a Page post and Shopee link, rejects lookalike hosts', () => {
  assert.equal(core.validateTask(task).postUrl, task.postUrl);
  assert.throws(() => core.validateTask({ ...task, postUrl: 'https://www.facebook.com.evil.test/page/posts/12345' }), /Facebook/);
  assert.throws(() => core.validateTask({ ...task, newLink: 'https://s.shopee.co.th.evil.test/new' }), /Shopee/);
});

test('replaces exactly one complete old link in editable text', () => {
  assert.equal(core.replaceOne('ซื้อที่ ' + task.oldLink + ' วันนี้', task.oldLink, task.newLink), 'ซื้อที่ ' + task.newLink + ' วันนี้');
  assert.throws(() => core.replaceOne(task.oldLink + ' ' + task.oldLink, task.oldLink, task.newLink), /หลายจุด/);
  assert.throws(() => core.replaceOne(task.oldLink + 'suffix', task.oldLink, task.newLink), /ไม่ครบ/);
});

test('background only accepts start requests from the AFF top frame', async () => {
  let listener, created = 0, opened = '';
  const session = new Map();
  const chrome = {
    runtime: { onMessage: { addListener: fn => { listener = fn; } } },
    tabs: {
      create: async () => { created++; return { id: 99 }; },
      update: async (_id, value) => { opened = value.url; },
      remove: async () => {},
      onRemoved: { addListener: () => {} }
    },
    storage: { session: {
      set: async value => { Object.entries(value).forEach(([key, val]) => session.set(key, val)); },
      get: async key => ({ [key]: session.get(key) }),
      remove: async key => { session.delete(key); }
    } }
  };
  const script = fs.readFileSync(path.join(__dirname, '../aff-edit-post-extension/background.js'), 'utf8');
  vm.runInNewContext(script, { chrome, URL, Set, importScripts: () => {}, AFFEditCore: core });
  const send = (sender, message) => new Promise(resolve => listener(message, sender, resolve));
  const unauthorized = await send({ url: 'https://evil.test/', frameId: 0 }, { type: 'AFF_EDIT_START', task });
  assert.equal(unauthorized.opened, false);
  assert.equal(created, 0);
  const approved = await send({ url: 'https://aff-lyart.vercel.app/#editpost', frameId: 0 }, { type: 'AFF_EDIT_START', task });
  assert.equal(approved.opened, true);
  assert.equal(created, 1);
  assert.equal(opened, task.postUrl);
  const get = await send({ url: task.postUrl, frameId: 0, tab: { id: 99 } }, { type: 'AFF_EDIT_GET_TASK' });
  assert.equal(get.task.oldLink, task.oldLink);
});

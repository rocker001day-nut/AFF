const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRows, validShopee, parseBackup } = require('../app/edit-post.js');
const { replaceAffiliateLink } = require('../server/facebook-core.cjs');

test('reads the AFF three-row post, product and Sub ID layout', () => {
  const records = parseRows([
    ['ลำดับ', 'โพสต์', 'Sub_id', 'สินค้า'],
    ['7', 'https://www.facebook.com/example/posts/12345', 'OLD1', 'https://s.shopee.co.th/1234567890'],
    ['', 'https://s.shopee.co.th/1234567890', 'SUP2'],
    ['', '', 'SUB5'],
    ['8', 'https://www.facebook.com/example/posts/67890', 'OLD2'],
    ['', 'https://shopee.co.th/item/123', 'SUP3']
  ]);
  assert.equal(records.length, 2);
  assert.deepEqual([records[0].sequence, records[0].sub1, records[0].sub2, records[0].sub5], ['7', 'OLD1', 'SUP2', 'SUB5']);
  assert.equal(records[1].oldLink, 'https://shopee.co.th/item/123');
  assert.equal(records[0].facebookChecked, false);
});

test('rejects a file without AFF post URLs and non-Shopee links', () => {
  assert.throws(() => parseRows([['header', 'ordinary text']]), /ไม่พบลิงก์โพสต์/);
  assert.equal(validShopee('https://s.shopee.co.th/1234567890'), true);
  assert.equal(validShopee('http://s.shopee.co.th/1234567890'), false);
  assert.equal(validShopee('https://s.shopee.co.th.evil.test/link'), false);
});

test('restores a queue backup and rejects an unsafe post URL', () => {
  const record = parseRows([['1', 'https://www.facebook.com/page/posts/123', 'S1', 'https://s.shopee.co.th/old']])[0];
  record.newLink = 'https://s.shopee.co.th/new';
  const backup = parseBackup(JSON.stringify({ format: 'aff-edit-post-queue', version: 1, name: 'work', records: [record] }));
  assert.equal(backup.records[0].newLink, record.newLink);
  assert.equal(backup.records[0].commentChecked, false);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'aff-edit-post-queue', version: 1,
    records: [{ ...record, postUrl: 'javascript:alert(1)' }] })), /ลิงก์โพสต์/);
});

test('replaces one exact Shopee link and refuses ambiguous or partial matches', () => {
  const oldLink = 'https://s.shopee.co.th/old';
  const newLink = 'https://s.shopee.co.th/new';
  assert.equal(replaceAffiliateLink('สินค้า ' + oldLink + ' ดี', oldLink, newLink), 'สินค้า ' + newLink + ' ดี');
  assert.throws(() => replaceAffiliateLink(oldLink + ' ' + oldLink, oldLink, newLink), error => error.code === 'MULTIPLE_LINK_MATCHES');
  assert.throws(() => replaceAffiliateLink(oldLink + 'suffix', oldLink, newLink), error => error.code === 'OLD_LINK_PARTIAL');
  assert.throws(() => replaceAffiliateLink('ไม่มีลิงก์', oldLink, newLink), error => error.code === 'OLD_LINK_NOT_FOUND');
});

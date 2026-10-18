const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRows, validShopee } = require('../app/edit-post.js');

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

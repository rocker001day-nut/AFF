const test = require('node:test');
const assert = require('node:assert/strict');
const { detectMapping, parseSubId2, mapRow, normalizeStatus } = require('../api/_lib/import-mapping');

test('detects common affiliate headers without relying on Excel letters', () => {
  const mapping = detectMapping(['Order ID', 'Purchase Time', 'Total Commission', 'sub_id2', 'sub_id5']);
  assert.equal(mapping.orderId, 'Order ID');
  assert.equal(mapping.purchaseTime, 'Purchase Time');
  assert.equal(mapping.commission, 'Total Commission');
  assert.equal(mapping.subId2, 'sub_id2');
  assert.equal(mapping.subId5, 'sub_id5');
});

test('parses variable-length product prefix in subid2', () => {
  const parsed = parseSubId2('AulaS98Pronut240926a01');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.product, 'AulaS98Pro');
  assert.equal(parsed.person.toLowerCase(), 'nut');
  assert.equal(parsed.ddmmyy, '240926');
});

test('maps conversion and creates stable order/item dedup key', () => {
  const headers = ['Order ID', 'Item ID', 'Purchase Time', 'Commission', 'subid2', 'subid5', 'Status'];
  const mapping = detectMapping(headers);
  const row = {
    'Order ID': 'O-100', 'Item ID': 'SKU-1', 'Purchase Time': '2026-09-26T10:00:00+07:00',
    'Commission': '฿42.50', subid2: 'Deskbank260926a01', subid5: 'bank', Status: 'COMPLETED'
  };
  const mapped = mapRow('shopee', row, mapping, 2);
  assert.equal(mapped.dedup_key, 'shopee:O-100:SKU-1');
  assert.equal(mapped.commission, 42.5);
  assert.equal(mapped.status_normalized, 'completed');
  assert.equal(mapped.person_code, 'bank');
});

test('preserves validated status as validated', () => {
  assert.equal(normalizeStatus('VALIDATED'), 'validated');
});

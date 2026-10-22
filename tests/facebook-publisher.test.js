const test = require('node:test');
const assert = require('node:assert/strict');
const { planTimes, validUrl } = require('../app/facebook-publisher.js');

test('one shared post across Pages follows exact second spacing and avoids duplicate Pages', () => {
  const jobs = planTimes(Date.UTC(2026, 9, 22, 3, 0), 30, ['A', 'B', 'B', 'C']);
  assert.deepEqual(jobs.map(job => job.page), ['A', 'B', 'C']);
  assert.deepEqual(jobs.map(job => job.at), [
    '2026-10-22T03:00:00.000Z',
    '2026-10-22T03:00:30.000Z',
    '2026-10-22T03:01:00.000Z'
  ]);
});

test('rejects invalid spacing and unsafe destination links', () => {
  assert.throws(() => planTimes(Date.now(), 0, ['A']));
  assert.throws(() => planTimes(Date.now(), 3601, ['A']));
  assert.throws(() => planTimes(Date.now(), 3.5, ['A']));
  assert.equal(validUrl('javascript:alert(1)'), null);
  assert.equal(validUrl('http://example.com'), null);
  assert.equal(validUrl('https://s.shopee.co.th/example').hostname, 's.shopee.co.th');
});

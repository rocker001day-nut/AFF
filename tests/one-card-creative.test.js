const test = require('node:test');
const assert = require('node:assert/strict');
const { creativeSpec, graphClient, uploadAdImage, createUnpublishedCard } = require('../server/one-card-creative.cjs');

test('builds an image link creative with the same outbound URL for card and CTA', () => {
  const spec = creativeSpec({ pageId: '123456789', imageHash: 'a'.repeat(32), destination: 'https://shop.example/item?aff=1', message: 'รีวิวสินค้า', headline: 'ดูสินค้า' });
  assert.equal(spec.object_story_spec.link_data.link, 'https://shop.example/item?aff=1');
  assert.equal(spec.object_story_spec.link_data.call_to_action.value.link, spec.object_story_spec.link_data.link);
  assert.equal(spec.object_story_spec.link_data.image_hash, 'a'.repeat(32));
  assert.throws(() => creativeSpec({ pageId: '123456789', imageHash: 'a'.repeat(32), destination: 'http://shop.example' }), /HTTPS/);
});

test('uploads image and creates only an unpublished creative', async () => {
  const requests = [];
  const request = async (path, options) => {
    requests.push([path, options]);
    if (path.endsWith('/adimages')) return { images: { card: { hash: 'b'.repeat(32) } } };
    if (path.endsWith('/adcreatives')) return { id: '987654321' };
    return { id: '987654321', effective_object_story_id: '123456789_987654321' };
  };
  const hash = await uploadAdImage(request, { adAccountId: '456789123', imageBytes: Buffer.from('image') });
  const card = await createUnpublishedCard(request, { adAccountId: '456789123', pageId: '123456789', imageHash: hash, destination: 'https://shop.example/item' });
  assert.deepEqual(card, { creativeId: '987654321', postId: '123456789_987654321', status: 'UNPUBLISHED' });
  assert.deepEqual(requests.map(([path]) => path), ['act_456789123/adimages', 'act_456789123/adcreatives', '987654321']);
  assert.equal(requests[1][1].params.object_story_spec.link_data.image_hash, hash);
});

test('sends credentials as a header and surfaces Meta rejection', async () => {
  const client = graphClient({ accessToken: 'test-only', fetchImpl: async (url, options) => {
    assert.equal(url.searchParams.get('access_token'), null);
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    return { ok: false, status: 403, json: async () => ({ error: { message: 'Missing ads_management' } }) };
  } });
  await assert.rejects(client('act_456789123/adcreatives', { method: 'POST', params: {} }), /ads_management/);
});

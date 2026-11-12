'use strict';

// An isolated Marketing API probe. Creating a creative produces an unpublished
// Page post; this module deliberately does not create an ad or publish a post.
const GRAPH_VERSION = 'v26.0';

function numericId(value, label) {
  const id = String(value ?? '').replace(/^act_/, '');
  if (!/^\d{5,30}$/.test(id)) throw new TypeError(`${label} must be a numeric Meta ID`);
  return id;
}

function destinationUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError('Destination must be a public HTTPS URL');
  }
  return url.href;
}

function creativeSpec({ pageId, imageHash, destination, message = '', headline = '', name = 'AFF One Card test' }) {
  const link = destinationUrl(destination);
  if (!/^[a-f0-9]{20,64}$/i.test(String(imageHash))) throw new TypeError('Invalid ad image hash');
  if (String(message).length > 5000 || String(headline).length > 255) throw new TypeError('Creative text is too long');
  return {
    name: String(name).slice(0, 255),
    object_story_spec: {
      page_id: numericId(pageId, 'Page ID'),
      link_data: {
        link,
        image_hash: String(imageHash),
        message: String(message),
        name: String(headline || new URL(link).hostname),
        call_to_action: { type: 'LEARN_MORE', value: { link } },
      },
    },
  };
}

function graphClient({ accessToken, fetchImpl = fetch, version = GRAPH_VERSION }) {
  if (!accessToken || typeof accessToken !== 'string') throw new TypeError('Meta access token required');
  return async function request(path, { method = 'GET', params = {} } = {}) {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const encoded = typeof value === 'object' ? JSON.stringify(value) : String(value);
      (method === 'GET' ? url.searchParams : form).set(key, encoded);
    }
    const response = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(method === 'POST' ? { body: form } : {}),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error?.message || `Meta API returned ${response.status}`);
    return data;
  };
}

async function uploadAdImage(request, { adAccountId, imageBytes }) {
  const bytes = Buffer.from(imageBytes);
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new TypeError('Image must be between 1 byte and 8 MB');
  const result = await request(`act_${numericId(adAccountId, 'Ad account ID')}/adimages`, {
    method: 'POST', params: { bytes: bytes.toString('base64') },
  });
  const hash = Object.values(result.images || {})[0]?.hash;
  if (!hash) throw new Error('Meta did not return an ad image hash');
  return hash;
}

async function createUnpublishedCard(request, { adAccountId, ...creative }) {
  const spec = creativeSpec(creative);
  const created = await request(`act_${numericId(adAccountId, 'Ad account ID')}/adcreatives`, {
    method: 'POST', params: spec,
  });
  if (!/^\d+$/.test(String(created.id || ''))) throw new Error('Meta did not return a creative ID');
  const details = await request(created.id, { params: { fields: 'id,effective_object_story_id' } });
  return {
    creativeId: created.id,
    postId: details.effective_object_story_id || null,
    status: 'UNPUBLISHED',
  };
}

module.exports = { creativeSpec, graphClient, uploadAdImage, createUnpublishedCard };

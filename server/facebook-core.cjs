const crypto = require('node:crypto');

const REQUIRED = ['FB_APP_ID', 'FB_APP_SECRET', 'FB_LOGIN_CONFIG_ID', 'FB_SESSION_SECRET', 'APP_BASE_URL'];
const SESSION_COOKIE = '__Host-aff_fb_session';
const FLOW_COOKIE = '__Host-aff_fb_oauth';
const ID = /^\d+(?:_\d+)?$/;
class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function createHandler({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  function settings() {
    const missing = REQUIRED.filter(key => !env[key]);
    let origin;
    try {
      const url = new URL(env.APP_BASE_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
      origin = url.origin;
    } catch { if (!missing.includes('APP_BASE_URL')) missing.push('APP_BASE_URL'); }
    if (env.FB_SESSION_SECRET && env.FB_SESSION_SECRET.length < 32) missing.push('FB_SESSION_SECRET');
    if (env.FB_GRAPH_VERSION && !/^v\d+\.\d+$/.test(env.FB_GRAPH_VERSION)) missing.push('FB_GRAPH_VERSION');
    return { missing, origin, version: env.FB_GRAPH_VERSION || 'v26.0' };
  }
  function seal(value, purpose) {
    const key = crypto.createHash('sha256').update(env.FB_SESSION_SECRET).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }
  function open(value, purpose) {
    try {
      if (!value || value.length > 8000) return null;
      const raw = Buffer.from(value, 'base64url');
      const key = crypto.createHash('sha256').update(env.FB_SESSION_SECRET).digest();
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      cipher.setAAD(Buffer.from(purpose));
      cipher.setAuthTag(raw.subarray(12, 28));
      const result = JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString());
      return result.exp > now() ? result : null;
    } catch { return null; }
  }
  function cookies(req) {
    return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => {
      const index = part.indexOf('=');
      return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }));
  }
  function cookie(res, name, value, age) {
    const existing = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`]);
  }
  function json(res, status, value) { res.statusCode = status; res.end(JSON.stringify(value)); }
  function redirect(res, target) { res.statusCode = 302; res.setHeader('Location', target); res.end(); }
  function session(req) {
    const value = open(cookies(req)[SESSION_COOKIE], 'session');
    if (!value || !value.token || !value.csrf) throw new ApiError(401, 'RECONNECT_FACEBOOK');
    return value;
  }
  function mutation(req, value, config) {
    if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
    if (req.headers.origin !== config.origin || req.headers['x-aff-csrf'] !== value.csrf) throw new ApiError(403, 'INVALID_REQUEST');
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED');
  }
  function body(req) {
    try {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      if (Buffer.byteLength(raw) > 16000) throw new Error();
      return JSON.parse(raw);
    } catch { throw new ApiError(400, 'INVALID_BODY'); }
  }
  function requireId(value) {
    if (typeof value !== 'string' || value.length > 100 || !ID.test(value)) throw new ApiError(400, 'INVALID_ID');
    return value;
  }
  async function graph(path, token, query = {}, method = 'GET') {
    const config = settings();
    const url = new URL(`https://graph.facebook.com/${config.version}/${path}`);
    const params = new URLSearchParams(query);
    const headers = {};
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      params.set('appsecret_proof', crypto.createHmac('sha256', env.FB_APP_SECRET).update(token).digest('hex'));
    }
    url.search = params.toString();
    let response, data;
    try {
      response = await fetchImpl(url, { method, headers, signal: AbortSignal.timeout(12000) });
      data = await response.json();
    } catch { throw new ApiError(502, 'FACEBOOK_UNAVAILABLE'); }
    if (!response.ok || data.error) {
      const code = data.error?.code;
      throw new ApiError(code === 190 ? 401 : 502, code === 190 ? 'RECONNECT_FACEBOOK' : code === 10 || code === 200 ? 'FACEBOOK_PERMISSION_REQUIRED' : 'FACEBOOK_ACTION_FAILED');
    }
    return data;
  }
  async function pages(value) {
    const result = [];
    let after;
    for (let count = 0; count < 20; count++) {
      const data = await graph('me/accounts', value.token, { fields: 'id,name,access_token,tasks', limit: '100', ...(after ? { after } : {}) });
      result.push(...(data.data || []));
      if (!data.paging?.next || !data.paging?.cursors?.after) return result;
      after = data.paging.cursors.after;
    }
    throw new ApiError(502, 'FACEBOOK_PAGE_LIMIT');
  }
  async function pageFor(value, id) {
    const found = (await pages(value)).find(item => item.id === requireId(id));
    if (!found?.access_token) throw new ApiError(403, 'PAGE_ACCESS_DENIED');
    return found;
  }
  function ticket(value, pageId, itemId, kind, parentId) {
    return seal({ pageId, itemId, kind, parentId, owner: value.csrf, exp: now() + 15 * 60 * 1000 }, 'item');
  }
  function verifyTicket(value, text, pageId, itemId, kind) {
    const found = open(text, 'item');
    if (!found || found.owner !== value.csrf || found.pageId !== pageId || found.itemId !== itemId || found.kind !== kind) throw new ApiError(403, 'RELOAD_ITEMS');
    return found;
  }
  function listed(data, value, pageId, kind, parentId) {
    return { items: (data.data || []).map(item => ({ id: item.id, message: item.message || '', createdTime: item.created_time || '',
      ...(kind === 'post' ? { url: item.permalink_url || '', picture: item.full_picture || '' } : {}),
      ticket: ticket(value, pageId, item.id, kind, parentId) })),
      after: data.paging?.next ? data.paging?.cursors?.after || null : null };
  }
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const config = settings();
    const url = new URL(req.url, 'https://local.invalid');
    const action = url.searchParams.get('action') || 'status';
    try {
      if (!['GET', 'POST'].includes(req.method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED');
      if (action === 'status') {
        if (req.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
        const value = config.missing.length ? null : open(cookies(req)[SESSION_COOKIE], 'session');
        return json(res, 200, { configured: !config.missing.length, missing: [...new Set(config.missing)], connected: Boolean(value),
          ...(value ? { userName: value.name, csrf: value.csrf, expiresAt: value.exp } : {}) });
      }
      if (config.missing.length) throw new ApiError(503, 'SETUP_REQUIRED');
      const callback = config.origin + '/api/facebook?action=callback';
      if (action === 'login') {
        if (req.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
        const state = crypto.randomBytes(24).toString('base64url');
        cookie(res, FLOW_COOKIE, seal({ state, exp: now() + 600000 }, 'oauth'), 600);
        const login = new URL(`https://www.facebook.com/${config.version}/dialog/oauth`);
        login.search = new URLSearchParams({ client_id: env.FB_APP_ID, redirect_uri: callback, state, response_type: 'code', config_id: env.FB_LOGIN_CONFIG_ID }).toString();
        return redirect(res, login.toString());
      }
      if (action === 'callback') {
        if (req.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
        const flow = open(cookies(req)[FLOW_COOKIE], 'oauth');
        cookie(res, FLOW_COOKIE, '', 0);
        if (!flow || flow.state !== url.searchParams.get('state')) throw new ApiError(403, 'INVALID_LOGIN_STATE');
        if (url.searchParams.get('error')) return redirect(res, config.origin + '/?fb_error=cancelled#facebook');
        const code = url.searchParams.get('code');
        if (!code || code.length > 4000) throw new ApiError(400, 'INVALID_LOGIN_CODE');
        let access = await graph('oauth/access_token', null, { client_id: env.FB_APP_ID, client_secret: env.FB_APP_SECRET, redirect_uri: callback, code });
        if (!access.access_token) throw new ApiError(502, 'FACEBOOK_ACTION_FAILED');
        try {
          const extended = await graph('oauth/access_token', null, { grant_type: 'fb_exchange_token', client_id: env.FB_APP_ID, client_secret: env.FB_APP_SECRET, fb_exchange_token: access.access_token });
          if (extended.access_token) access = extended;
        } catch { /* The original short-lived token remains usable until its actual expiry. */ }
        const profile = await graph('me', access.access_token, { fields: 'id,name' });
        const seconds = Math.max(1, Math.min(28800, Number(access.expires_in) || 3600));
        const value = { token: access.access_token, name: String(profile.name || '').slice(0, 100), csrf: crypto.randomBytes(24).toString('base64url'), exp: now() + seconds * 1000 };
        const encrypted = seal(value, 'session');
        if (encrypted.length > 3500) throw new ApiError(502, 'FACEBOOK_SESSION_TOO_LARGE');
        cookie(res, SESSION_COOKIE, encrypted, seconds);
        return redirect(res, config.origin + '/?fb_connected=1#facebook');
      }
      const value = session(req);
      if (action === 'disconnect') {
        mutation(req, value, config);
        cookie(res, SESSION_COOKIE, '', 0);
        return json(res, 200, { disconnected: true });
      }
      if (action === 'pages') {
        if (req.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
        return json(res, 200, { pages: (await pages(value)).map(item => ({ id: item.id, name: item.name, tasks: item.tasks || [] })) });
      }
      if (action === 'posts' || action === 'comments') {
        if (req.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
        const page = await pageFor(value, url.searchParams.get('pageId'));
        const after = url.searchParams.get('after');
        if (after && after.length > 2000) throw new ApiError(400, 'INVALID_CURSOR');
        let data, parent;
        const query = { limit: '25', ...(after ? { after } : {}) };
        if (action === 'posts') {
          const start = url.searchParams.get('start');
          const end = url.searchParams.get('end');
          for (const date of [start, end]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) throw new ApiError(400, 'INVALID_DATE');
          if (start && end && start > end) throw new ApiError(400, 'INVALID_DATE');
          if (start) query.since = String(Date.parse(start + 'T00:00:00+07:00') / 1000);
          if (end) query.until = String(Date.parse(end + 'T00:00:00+07:00') / 1000 + 86400);
          data = await graph(page.id + '/published_posts', page.access_token, { ...query, fields: 'id,message,created_time,permalink_url,full_picture' });
        } else {
          parent = requireId(url.searchParams.get('postId'));
          verifyTicket(value, url.searchParams.get('postTicket'), page.id, parent, 'post');
          data = await graph(parent + '/comments', page.access_token, { ...query, fields: 'id,message,created_time', filter: 'stream' });
        }
        return json(res, 200, listed(data, value, page.id, action === 'posts' ? 'post' : 'comment', parent));
      }
      if (action === 'delete') {
        mutation(req, value, config);
        const input = body(req);
        if (input.confirm !== true || !['post', 'comment'].includes(input.kind)) throw new ApiError(400, 'CONFIRM_DELETE_REQUIRED');
        const pageId = requireId(input.pageId), itemId = requireId(input.id);
        verifyTicket(value, input.ticket, pageId, itemId, input.kind);
        const page = await pageFor(value, pageId);
        const result = await graph(itemId, page.access_token, {}, 'DELETE');
        if (result !== true && result.success !== true) throw new ApiError(502, 'FACEBOOK_ACTION_FAILED');
        return json(res, 200, { deleted: true, id: itemId });
      }
      throw new ApiError(404, 'ACTION_NOT_FOUND');
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const code = error instanceof ApiError ? error.code : 'SERVER_ERROR';
      if (status === 401) cookie(res, SESSION_COOKIE, '', 0);
      if (action === 'callback' && config.origin) return redirect(res, config.origin + '/?fb_error=' + encodeURIComponent(code) + '#facebook');
      return json(res, status, { error: { code } });
    }
  };
}
module.exports = { createHandler };

const { json, methodNotAllowed } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  return json(res, 200, {
    ok: true,
    service: 'aff-auto-sync',
    phase: '01-foundation',
    time: new Date().toISOString()
  });
};

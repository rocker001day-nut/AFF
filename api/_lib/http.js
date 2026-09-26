function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return json(res, 405, { ok: false, error: 'method_not_allowed', allowed });
}

function fail(res, status, code, message, details) {
  return json(res, status, {
    ok: false,
    error: code,
    message,
    ...(details ? { details } : {})
  });
}

module.exports = { json, methodNotAllowed, fail };

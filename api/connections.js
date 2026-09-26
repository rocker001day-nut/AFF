const { requireTeamMember } = require('./_lib/auth');
const { json, methodNotAllowed, fail } = require('./_lib/http');

const PLATFORMS = ['facebook', 'lazada', 'shopee'];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { supabase } = await requireTeamMember(req);
    const { data, error } = await supabase
      .from('platform_connections')
      .select('platform,account_label,external_account_id,status,connected_at,last_sync_at,last_error,meta')
      .order('platform');
    if (error) throw error;

    const byPlatform = new Map((data || []).map((row) => [row.platform, row]));
    return json(res, 200, {
      ok: true,
      connections: PLATFORMS.map((platform) => byPlatform.get(platform) || {
        platform,
        status: 'not_configured',
        account_label: null,
        external_account_id: null,
        connected_at: null,
        last_sync_at: null,
        last_error: null,
        meta: {}
      })
    });
  } catch (error) {
    console.error(error);
    return fail(res, error.statusCode || 500, error.code || 'connections_failed', error.message || 'โหลดสถานะการเชื่อมต่อไม่สำเร็จ');
  }
};

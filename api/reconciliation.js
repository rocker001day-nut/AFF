const { requireTeamMember } = require('./_lib/auth');
const { json, methodNotAllowed, fail } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { supabase } = await requireTeamMember(req);
    const { data, error } = await supabase
      .from('reconciliation_sup')
      .select('*')
      .order('profit', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return json(res, 200, { ok: true, rows: data || [] });
  } catch (error) {
    console.error(error);
    return fail(res, error.statusCode || 500, error.code || 'reconciliation_failed', error.message || 'โหลดข้อมูลกระทบยอดไม่สำเร็จ');
  }
};

const { requireTeamMember } = require('../_lib/auth');
const { json, methodNotAllowed, fail } = require('../_lib/http');
const { detectMapping, hashObject, mapRow } = require('../_lib/import-mapping');

const SUPPORTED = new Set(['shopee', 'lazada']);
const MAX_ROWS = 5000;

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (!req.body) return {};
  try { return JSON.parse(req.body); } catch { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { supabase, user } = await requireTeamMember(req);
    const body = bodyOf(req);
    const platform = String(body.platform || '').toLowerCase();
    const headers = Array.isArray(body.headers) ? body.headers.map(String) : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const fileName = String(body.fileName || 'affiliate-export');

    if (!SUPPORTED.has(platform)) return fail(res, 400, 'unsupported_platform', 'รองรับเฉพาะ Shopee และ Lazada ในเฟสนี้');
    if (!headers.length || !rows.length) return fail(res, 400, 'empty_file', 'ไฟล์ไม่มี header หรือไม่มีข้อมูล');
    if (rows.length > MAX_ROWS) return fail(res, 413, 'too_many_rows', `เฟสแรกจำกัด ${MAX_ROWS.toLocaleString()} แถวต่อครั้ง กรุณาแบ่งไฟล์ก่อน`);

    const mapping = detectMapping(headers);
    if (!mapping.purchaseTime || !mapping.commission) {
      return fail(res, 422, 'mapping_required', 'ยังยืนยัน header วันที่ซื้อหรือค่าคอมมิชชันไม่ได้', {
        detected: mapping,
        headers,
        required: ['purchaseTime', 'commission']
      });
    }

    const contentSha256 = hashObject({ platform, headers, rows });
    const { data: existing, error: existingError } = await supabase
      .from('import_batches')
      .select('id,status,row_count,inserted_count,updated_count,created_at')
      .eq('platform', platform)
      .eq('content_sha256', contentSha256)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === 'complete') {
      return json(res, 200, { ok: true, duplicate: true, batch: existing, mapping });
    }

    let batchId = existing?.id;
    if (!batchId) {
      const { data: batch, error: batchError } = await supabase
        .from('import_batches')
        .insert({
          platform,
          source_file_name: fileName,
          content_sha256: contentSha256,
          status: 'processing',
          row_count: rows.length,
          imported_by: user.id,
          detected_mapping: mapping
        })
        .select('id')
        .single();
      if (batchError) throw batchError;
      batchId = batch.id;
    } else {
      await supabase.from('import_batches').update({ status: 'processing', error_message: null }).eq('id', batchId);
    }

    const mappedRows = rows.map((row, index) => ({
      ...mapRow(platform, row, mapping, index + 2),
      import_batch_id: batchId
    }));

    const { data: upserted, error: upsertError } = await supabase
      .from('affiliate_conversions')
      .upsert(mappedRows, { onConflict: 'platform,dedup_key', ignoreDuplicates: false })
      .select('id,sub_id2');
    if (upsertError) {
      await supabase.from('import_batches').update({ status: 'error', error_message: upsertError.message }).eq('id', batchId);
      throw upsertError;
    }

    const unmatched = mappedRows.filter((row) => !row.sub_id2).length;
    const parseFailed = mappedRows.filter((row) => row.sub_id2 && !row.subid2_parse_ok).length;
    await supabase.from('import_batches').update({
      status: 'complete',
      inserted_count: upserted?.length || mappedRows.length,
      updated_count: 0,
      unmatched_count: unmatched,
      parse_failed_count: parseFailed,
      completed_at: new Date().toISOString()
    }).eq('id', batchId);

    return json(res, 200, {
      ok: true,
      duplicate: false,
      batchId,
      platform,
      rowCount: mappedRows.length,
      unmatched,
      parseFailed,
      mapping
    });
  } catch (error) {
    console.error(error);
    return fail(res, error.statusCode || 500, error.code || 'import_failed', error.message || 'นำเข้าไฟล์ไม่สำเร็จ');
  }
};

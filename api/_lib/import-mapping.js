const crypto = require('crypto');

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s._\-\/\\()[\]{}]+/g, '')
    .replace(/[#:]+/g, '');
}

const ALIASES = {
  orderId: [
    'orderid','orderno','ordernumber','checkoutid','transactionid',
    'หมายเลขคำสั่งซื้อ','เลขคำสั่งซื้อ','รหัสคำสั่งซื้อ','คำสั่งซื้อ'
  ],
  itemId: ['itemid','productid','sku','skuid','รหัสสินค้า','สินค้าid'],
  purchaseTime: [
    'purchasetime','ordertime','createdtime','ordercreationtime','checkouttime','conversiontime',
    'เวลาสั่งซื้อ','วันที่สั่งซื้อ','วันเวลาสั่งซื้อ','วันที่ทำรายการ','วันที่'
  ],
  commission: [
    'commission','totalcommission','estimatedcommission','netcommission','affiliatecommission',
    'ค่าคอม','ค่าคอมมิชชัน','ค่าคอมมิชชั่น','คอมมิชชัน','คอมมิชชั่น','รายได้'
  ],
  gmv: ['gmv','sales','orderamount','itemprice','revenue','ยอดขาย','มูลค่าคำสั่งซื้อ'],
  status: ['status','orderstatus','conversionstatus','purchasestatus','สถานะ','สถานะคำสั่งซื้อ'],
  subId1: ['subid1','sub_id1','sub1','affsub1'],
  subId2: ['subid2','sub_id2','sub2','affsub2','utmcontent','utm_content','sup'],
  subId3: ['subid3','sub_id3','sub3','affsub3'],
  subId4: ['subid4','sub_id4','sub4','affsub4'],
  subId5: ['subid5','sub_id5','sub5','affsub5','personcode','person'],
  conversionId: ['conversionid','conversion_id','transactionid','clickid']
};

function findHeader(headers, aliases) {
  const wanted = new Set(aliases.map(normalizeHeader));
  return headers.find((header) => wanted.has(normalizeHeader(header))) || null;
}

function detectMapping(headers) {
  const list = Array.isArray(headers) ? headers.filter(Boolean).map(String) : [];
  const mapping = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    mapping[field] = findHeader(list, aliases);
  }
  return mapping;
}

function valueByHeader(row, header) {
  if (!header || !row || typeof row !== 'object') return '';
  return row[header] ?? '';
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value ?? '').replace(/[^0-9.\-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 86400000).toISOString();
  }
  const parsed = new Date(String(value).trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeStatus(value) {
  const raw = String(value ?? '').trim();
  const key = raw.toLowerCase();
  if (/cancel|ยกเลิก|refund|คืนเงิน/.test(key)) return 'cancelled';
  if (/unpaid|ยังไม่ชำระ|ไม่ชำระ/.test(key)) return 'unpaid';
  if (/validat|validated/.test(key)) return 'validated';
  if (/complete|completed|สำเร็จ|เสร็จสิ้น|approved/.test(key)) return 'completed';
  if (/pending|รอดำเนินการ|กำลังดำเนินการ|processing/.test(key)) return 'pending';
  return raw ? 'unknown' : 'unknown';
}

function normalizeSup(value) {
  return String(value ?? '').trim();
}

function parseSubId2(value) {
  const raw = normalizeSup(value);
  const match = raw.match(/^(.*?)(nut|wi|bank|noon|daa)(\d{6})a(\d{2})$/i);
  if (!match) return { ok: false, raw };
  return {
    ok: true,
    raw,
    product: match[1],
    person: match[2],
    ddmmyy: match[3],
    seq: match[4]
  };
}

function hashObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function mapRow(platform, row, mapping, rowNumber) {
  const purchaseTime = isoDate(valueByHeader(row, mapping.purchaseTime));
  const externalOrderId = normalizeSup(valueByHeader(row, mapping.orderId));
  const externalItemId = normalizeSup(valueByHeader(row, mapping.itemId));
  const conversionId = normalizeSup(valueByHeader(row, mapping.conversionId));
  const subId2 = normalizeSup(valueByHeader(row, mapping.subId2));
  const parsedSup = parseSubId2(subId2);
  const subId5Raw = normalizeSup(valueByHeader(row, mapping.subId5));
  const personCode = subId5Raw || (parsedSup.ok ? parsedSup.person : '');
  const commission = numberValue(valueByHeader(row, mapping.commission));
  const gmv = numberValue(valueByHeader(row, mapping.gmv));
  const statusRaw = String(valueByHeader(row, mapping.status) ?? '').trim();
  const fallbackIdentity = hashObject({ platform, row });
  const lineIdentity = externalItemId || conversionId || fallbackIdentity.slice(0, 24);
  const dedupKey = externalOrderId
    ? `${platform}:${externalOrderId}:${lineIdentity}`
    : `${platform}:row:${fallbackIdentity}`;

  return {
    platform,
    source: 'file',
    external_order_id: externalOrderId || null,
    external_item_id: externalItemId || null,
    conversion_id: conversionId || null,
    purchase_time: purchaseTime,
    purchase_date_bkk: purchaseTime
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(purchaseTime))
      : null,
    status_raw: statusRaw || null,
    status_normalized: normalizeStatus(statusRaw),
    sub_id1: normalizeSup(valueByHeader(row, mapping.subId1)) || null,
    sub_id2: subId2 || null,
    sub_id3: normalizeSup(valueByHeader(row, mapping.subId3)) || null,
    sub_id4: normalizeSup(valueByHeader(row, mapping.subId4)) || null,
    sub_id5: subId5Raw || null,
    person_code: personCode || null,
    subid2_parse_ok: parsedSup.ok,
    commission,
    gmv,
    dedup_key: dedupKey,
    raw_payload: row,
    source_row_number: rowNumber
  };
}

module.exports = {
  ALIASES,
  normalizeHeader,
  detectMapping,
  numberValue,
  isoDate,
  normalizeStatus,
  parseSubId2,
  hashObject,
  mapRow
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const part = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const context = vm.createContext({});
vm.runInContext([
  part('    function columnLettersToIndex(', '    function findLiveRow('),
  part('    function affiliateRowFromGroup(', '    async function saveAffiliateGroupsByDate('),
  part('    async function importAffiliateFile(', '    function rowForViewMode(')
].join('\n'), context);

function reportRow(sup, payout, date = '2026-10-27 10:00:00') {
  const row = Array(50).fill('');
  row[1] = date; row[22] = payout; row[43] = 'N'; row[44] = sup;
  return row;
}

test('Lazada upload calls the importer with B date, AS SUP and W payout', async () => {
  context.readUploadRows = async () => [reportRow('SUP-A', 12.5), reportRow('SUP-B', 20), reportRow('SUP-A', 7.5)];
  let saved;
  context.saveAffiliateGroupsByDate = async (platform, groups) => {
    saved = groups.get('2026-10-27');
    return { dates: ['2026-10-27'], totalSupGroups: saved.length, totalIncome: 40 };
  };
  context.dateRangeLabel = dates => dates.join(',');
  context.money = String;
  const status = {};
  await context.importAffiliateFile('Lazada', {}, status);
  assert.equal(saved.length, 2);
  assert.equal(saved.find(group => group.supName === 'SUP-A').total, 20);
  assert.equal(saved.find(group => group.supName === 'SUP-B').total, 20);
  assert.equal(saved.some(group => group.supName === 'N'), false);
});

test('groups payouts by SUP and day, with a separate bucket for blank AS', () => {
  const { groupsByDate, fallbackDateRows } = context.groupRowsByDateAndSup([
    reportRow('A', 10), reportRow('A', 5), reportRow('B', 20), reportRow('', 3),
    reportRow('A', 7, '2026-10-28'), reportRow('A', 100, 'invalid')
  ], 'B', 'AS', 'W');
  assert.equal(groupsByDate.get('2026-10-27').find(g => g.supName === 'A').total, 15);
  assert.equal(groupsByDate.get('2026-10-27').find(g => g.supName === 'ไม่ระบุ SUP').total, 3);
  assert.equal(groupsByDate.get('2026-10-28')[0].total, 7);
  assert.equal(fallbackDateRows, 1);
});

test('case variants of a SUP merge before saving and corrected payouts replace old amounts', () => {
  const result = context.groupLazadaRows([reportRow('Stanley', 300.12), reportRow('STANLEY', 20.34)]);
  const groups = result.groupsByDate.get('2026-10-27');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].total, 320.46);
  const rows = [{ name: 'stanley', lazadaIncome: 640, shopeeIncome: 0, orders: 8, adCost: 20 }];
  const saved = context.mergeLazadaImportRows(rows, groups);
  assert.equal(saved[0].lazadaIncome, 320.46);
  assert.equal(saved[0].orders, 2);
  assert.equal(saved[0].adCost, 20);
  assert.equal(context.mergeLazadaImportRows(saved, groups)[0].lazadaIncome, 320.46);
});

test('Lazada input values retain cents instead of rounding each SUP before aggregation', () => {
  const displaySource = part('    function decimalNumberDisplay(', '    async function copyTextToClipboard(');
  vm.runInContext(displaySource, context);
  assert.equal(context.decimalNumberDisplay(2175.78), '2175.78');
  assert.equal(context.decimalNumberDisplay(2160.86), '2160.86');
  assert.match(html, /name="lazadaIncome"[^>]+step="0.01"[^>]+decimalNumberDisplay\(row.lazadaIncome\)/);
});

test('repairs the exact old N bucket, keeps ads and Shopee, and re-upload is idempotent', () => {
  const groups = [{ supName: 'A', total: 15, orders: 2 }, { supName: 'B', total: 20, orders: 1 }];
  const legacy = [{ supName: 'N', total: 35, orders: 3 }];
  const existing = [
    { name: 'N', orders: 3, lazadaIncome: 35, shopeeIncome: 0, adCost: 9 },
    { name: 'A', orders: 4, lazadaIncome: 0, shopeeIncome: 80, adCost: 50 }
  ];
  const once = context.mergeLazadaImportRows(existing, groups, legacy);
  assert.equal(once.find(r => r.name === 'N').lazadaIncome, 0);
  assert.equal(once.find(r => r.name === 'N').adCost, 9);
  assert.equal(once.find(r => r.name === 'A').shopeeIncome, 80);
  assert.equal(once.find(r => r.name === 'A').adCost, 50);
  assert.equal(once.find(r => r.name === 'A').orders, 6);
  assert.equal(once.reduce((sum, r) => sum + r.lazadaIncome, 0), 35);
  const snapshot = JSON.stringify(once);
  assert.equal(JSON.stringify(context.mergeLazadaImportRows(once, groups, legacy)), snapshot);
});

test('does not clear unrelated N, real N SUP, or a mixed Shopee row', () => {
  const row = { name: 'N', orders: 1, lazadaIncome: 50, shopeeIncome: 0, adCost: 0 };
  const legacy = [{ supName: 'N', total: 35, orders: 3 }];
  const result = context.mergeLazadaImportRows([row], [{ supName: 'A', total: 35, orders: 3 }], legacy);
  assert.equal(result.find(r => r.name === 'N').lazadaIncome, 50);
  const mixed = { name: 'N', orders: 3, lazadaIncome: 35, shopeeIncome: 10 };
  assert.equal(context.mergeLazadaImportRows([mixed], [], legacy)[0].lazadaIncome, 35);
  const real = { name: 'N', orders: 3, lazadaIncome: 35, shopeeIncome: 0 };
  assert.equal(context.mergeLazadaImportRows([real], legacy, legacy)[0].lazadaIncome, 35);
});

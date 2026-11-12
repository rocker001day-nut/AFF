const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const imports = require('../app/affiliate-imports');
const { create: createSync } = require('../app/campaign-sync');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const ids = ['a', 'b', 'c', 'd'].map(letter => letter.repeat(64));
const group = (total, orders = 1, supName = 'SUP-A') => ({ supName, total, orders });
const apply = (rows, platform, groups, id = ids[0], mode = 'add') =>
  imports.merge(rows, platform, groups, { id, mode });
const plain = value => JSON.parse(JSON.stringify(value));

function extract(name) {
  const start = new RegExp('^ {0,4}(?:async )?function ' + name + '\\(', 'm').exec(html);
  assert.ok(start, name);
  const rest = html.slice(start.index);
  const next = /\n {0,4}(?:async )?function /.exec(rest);
  assert.ok(next, 'boundary after ' + name);
  return rest.slice(0, next.index);
}
function context(names, values = {}) {
  const ctx = vm.createContext(values);
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return ctx;
}

for (const platform of ['Shopee', 'Lazada']) {
  test(platform + ': distinct reports with the same SUP add; retry of either report is a no-op', () => {
    const field = platform === 'Shopee' ? 'shopeeIncome' : 'lazadaIncome';
    let rows = apply([], platform, [group(100.11, 2)]).rows;
    rows = apply(rows, platform, [group(40.22, 1, ' sup-a ')], ids[1]).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0][field], 140.33);
    assert.equal(rows[0].orders, 3);
    const before = plain(rows);
    for (const [id, total, orders] of [[ids[0], 100.11, 2], [ids[1], 40.22, 1]]) {
      const result = apply(rows, platform, [group(total, orders)], id);
      assert.equal(result.skippedGroups, 1);
      assert.equal(result.incomeChange, 0);
      assert.deepEqual(result.rows, before);
    }
  });
}

test('fingerprints full report content, preserving Date cells and ignoring row order / filename', async () => {
  const a = [['order-1', new Date('2026-11-12T01:00:00Z'), 'SUP-A', 10], ['order-2', 'SUP-B', 4]];
  const hash = await imports.fingerprint(a, webcrypto);
  assert.equal(hash, await imports.fingerprint([...a].reverse(), webcrypto));
  assert.equal(hash, await imports.fingerprint(a.map(row => [...row, '']), webcrypto));
  const differentOrder = a.map(row => [...row]);
  differentOrder[0][0] = 'order-from-another-account';
  assert.notEqual(hash, await imports.fingerprint(differentOrder, webcrypto));
  const differentDate = a.map(row => [...row]);
  differentDate[0][1] = new Date('2026-11-13T01:00:00Z');
  assert.notEqual(hash, await imports.fingerprint(differentDate, webcrypto));
});

test('different order data with identical SUP amounts adds even when reports use the same filename', async () => {
  const reports = [
    { name: 'report.xlsx', data: [['order-1', 'SUP-A', 25]] },
    { name: 'report.xlsx', data: [['order-2', 'SUP-A', 25]] }
  ];
  let rows = [];
  for (const report of reports) rows = apply(rows, 'Lazada', [group(25)],
    await imports.fingerprint(report.data, webcrypto)).rows;
  assert.equal(rows[0].lazadaIncome, 50);
  const renamed = { ...reports[0], name: 'renamed.xlsx' };
  rows = apply(rows, 'Lazada', [group(25)], await imports.fingerprint(renamed.data, webcrypto)).rows;
  assert.equal(rows[0].lazadaIncome, 50);
});

test('preserves legacy baseline, ad spend, the other platform and later manual edits', () => {
  const baseline = [{ name: 'SUP-A', orders: 4, shopeeIncome: 80.25, lazadaIncome: 30.5, adCost: 50 }];
  let rows = apply(baseline, 'Lazada', [group(10.25, 2)]).rows;
  assert.equal(rows[0].lazadaIncome, 40.75);
  assert.equal(rows[0].shopeeIncome, 80.25);
  assert.equal(rows[0].adCost, 50);
  assert.equal(rows[0].orders, 6);
  assert.equal(baseline[0].lazadaIncome, 30.5, 'input snapshot remains unchanged');
  rows[0].lazadaIncome = 60;
  rows = apply(rows, 'Lazada', [group(10)], ids[1]).rows;
  assert.equal(rows[0].lazadaIncome, 70);
});

test('same content ID is scoped by platform and both platform order counts accumulate', () => {
  let rows = apply([], 'Shopee', [group(10.25, 2)]).rows;
  rows = apply(rows, 'Lazada', [group(40.75, 3)]).rows;
  assert.equal(rows[0].shopeeIncome, 10.25);
  assert.equal(rows[0].lazadaIncome, 40.75);
  assert.equal(rows[0].orders, 5);
});

test('duplicate protection survives a SUP rename and zero or negative income', () => {
  let rows = apply([], 'Lazada', [group(10)]).rows;
  rows[0].name = 'RENAMED';
  assert.equal(apply(rows, 'Lazada', [group(10)]).rows.length, 1);
  rows = apply(rows, 'Lazada', [group(-10, 1, 'RENAMED')], ids[1]).rows;
  assert.equal(rows[0].lazadaIncome, 0);
  rows[0].orders = 0;
  const result = apply(rows, 'Lazada', [group(-10, 1, 'RENAMED')], ids[1]);
  assert.equal(result.rows.length, 1, 'zero row retains import history');
  assert.equal(result.skippedGroups, 1);
});

test('explicit replacement updates only named SUP/platform and retains old-file duplicate protection', () => {
  let rows = apply([], 'Lazada', [group(100, 2), group(20, 1, 'SUP-B')]).rows;
  rows = apply(rows, 'Lazada', [group(40, 1)], ids[1]).rows;
  rows = apply(rows, 'Shopee', [group(15, 4)], ids[2]).rows;
  rows[0].adCost = 30;
  rows = apply(rows, 'Lazada', [group(120, 5)], ids[3], 'replace').rows;
  assert.equal(rows[0].lazadaIncome, 120);
  assert.equal(rows[0].orders, 9);
  assert.equal(rows[0].shopeeIncome, 15);
  assert.equal(rows[0].adCost, 30);
  assert.equal(rows.find(row => row.name === 'SUP-B').lazadaIncome, 20);
  const snapshot = plain(rows);
  rows = apply(rows, 'Lazada', [group(100, 2), group(20, 1, 'SUP-B')]).rows;
  rows = apply(rows, 'Lazada', [group(40, 1)], ids[1]).rows;
  assert.deepEqual(rows, snapshot);
  assert.deepEqual(apply(rows, 'Lazada', [group(120, 5)], ids[3], 'replace').rows, snapshot);
});

test('add mode never guesses that an existing N/Y amount belongs to the new report', () => {
  const baseline = [{ name: 'N', orders: 1, lazadaIncome: 10, shopeeIncome: 0, adCost: 0 }];
  const result = imports.merge(baseline, 'Lazada', [group(10)], {
    id: ids[0], legacyGroups: [group(10, 1, 'N')]
  });
  assert.equal(result.rows.find(row => row.name === 'N').lazadaIncome, 10);
  assert.equal(result.rows.find(row => row.name === 'SUP-A').lazadaIncome, 10);
});

test('DOM load/edit/save and normalization preserve history, Shopee cents and independent snapshots', () => {
  let rows = apply([], 'Shopee', [group(100.11, 2)]).rows;
  const nodes = [];
  const control = value => ({ value: String(value ?? ''), addEventListener() {} });
  const ctx = context(['cellText', 'numberValue', 'wholeNumberDisplay', 'decimalNumberDisplay',
    'normalizeCampaignRow', 'getRowsFromDom', 'addRow'], {
    isLoadingRows: true, isRangeView: false,
    AffDashboardVisuals: { splitSupName: name => ({ supId: name, productName: '' }) },
    escapeAttr: value => String(value ?? ''),
    rowsEl: { appendChild: node => nodes.push(node), querySelectorAll: () => nodes },
    document: { createElement() {
      const fields = {};
      const node = {
        set innerHTML(value) {
          // Use the actual generated input values, including number formatting.
          for (const match of value.matchAll(/<input\b[^>]*\bname="([^"]+)"[^>]*value="([^"]*)"/g)) fields[match[1]] = control(match[2]);
          fields.platform = control('Shopee');
        },
        querySelector(selector) {
          const match = /^\[name="([^"]+)"\]$/.exec(selector);
          return match ? fields[match[1]] : control('');
        },
        querySelectorAll() { return []; },
        fields
      };
      return node;
    } }
  });
  ctx.addRow(rows[0]);
  nodes[0].fields.adCost.value = '27';
  let saved = plain(ctx.getRowsFromDom().map(ctx.normalizeCampaignRow));
  assert.equal(saved[0].shopeeIncome, 100.11);
  assert.equal(saved[0].adCost, 27);
  assert.equal(saved[0]._affiliateImports[0].id, ids[0]);
  rows[0]._affiliateImports[0].id = ids[2];
  assert.equal(saved[0]._affiliateImports[0].id, ids[0], 'DOM owns an independent snapshot');
  saved = apply(saved, 'Shopee', [group(40.22)], ids[1]).rows;
  saved = apply(saved, 'Shopee', [group(100.11, 2)]).rows;
  assert.equal(saved[0].shopeeIncome, 140.33);
  assert.equal(saved[0].adCost, 27);
});

test('queued JSON survives reload/second client and does not re-add a completed report', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  let remote;
  const first = createSync({ storage, activeOwner: () => 'owner-a',
    write: async (_date, rows) => { remote = plain(rows); } });
  first.enqueue('owner-a', '2026-11-12', apply([], 'Lazada', [group(100.11, 2)]).rows);
  await first.flush('owner-a');
  const secondRows = apply(remote, 'Lazada', [group(40.22)], ids[1]).rows;
  const second = createSync({ storage, activeOwner: () => 'owner-a',
    write: async (_date, rows) => { remote = plain(rows); } });
  second.enqueue('owner-a', '2026-11-12', secondRows);
  await second.flush('owner-a');
  assert.equal(apply(remote, 'Lazada', [group(100.11, 2)]).rows[0].lazadaIncome, 140.33);
  assert.equal(second.pending('owner-b', '2026-11-12'), null);
});

test('real date-saving path retries a partly completed multi-day import without duplicating the first day', async () => {
  const saved = new Map();
  let fail = true;
  let writes = 0;
  const ctx = context(['platformFromRow', 'saveAffiliateGroupsByDate'], {
    AffAffiliateImports: imports,
    loadRowsForImportDate: async date => plain(saved.get(date) || []),
    saveRowsForImportDate: async (date, rows) => {
      if (date === '2026-11-13' && fail) { fail = false; throw Error('connection interrupted'); }
      saved.set(date, plain(rows)); writes++;
    },
    showImportedDateView() {}, loadCurrentView: async () => {}
  });
  const days = new Map([['2026-11-12', [group(10.11)]], ['2026-11-13', [group(20.22)]]]);
  await assert.rejects(ctx.saveAffiliateGroupsByDate('Lazada', days, new Map(), { id: ids[0], mode: 'add' }), /interrupted/);
  const result = await ctx.saveAffiliateGroupsByDate('Lazada', days, new Map(), { id: ids[0], mode: 'add' });
  assert.equal(saved.get('2026-11-12')[0].lazadaIncome, 10.11);
  assert.equal(saved.get('2026-11-13')[0].lazadaIncome, 20.22);
  assert.equal(result.skippedGroups, 1);
  assert.equal(writes, 2);
});

for (const platform of ['Shopee', 'Lazada']) {
  test(platform + ': replacing complete totals after a legacy baseline resets single-platform orders', () => {
    const field = platform === 'Shopee' ? 'shopeeIncome' : 'lazadaIncome';
    const baseline = [{ name: 'SUP-A', orders: 5, shopeeIncome: 0, lazadaIncome: 0, adCost: 8, [field]: 100 }];
    let rows = apply(baseline, platform, [group(20, 2)]).rows;
    rows = apply(rows, platform, [group(50, 3)], ids[1], 'replace').rows;
    assert.equal(rows[0][field], 50);
    assert.equal(rows[0].orders, 3);
    assert.equal(rows[0].adCost, 8);
  });
}
test('replacement follows a unique original SUP after the display name was edited', () => {
  let rows = apply([], 'Lazada', [group(100.11, 2)]).rows;
  rows[0].name = 'RENAMED';
  rows = apply(rows, 'Lazada', [group(150, 3)], ids[1], 'replace').rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lazadaIncome, 150);
  assert.equal(rows[0].orders, 3);
});

for (const platform of ['Shopee', 'Lazada']) {
  test(platform + ': two actual CSV imports add, duplicate is skipped, and explicit zero replacement clears only that SUP', async () => {
    const saved = new Map();
    const mode = { value: 'add' };
    const names = ['csvToRows', 'readUploadRows', 'columnLettersToIndex', 'parseMoneyCell',
      'normalizeYear', 'formatDateParts', 'excelSerialDateToIso', 'parseOrderDateCell',
      'cellText', 'groupRowsByDateAndSup', 'normalizeSupName', 'groupLazadaRows', 'platformFromRow',
      'normalizeCampaignRow', 'saveAffiliateGroupsByDate', 'importAffiliateFile'];
    const ctx = context(names, {
      AffAffiliateImports: imports, document: { getElementById: () => mode },
      loadRowsForImportDate: async date => plain(saved.get(date) || []),
      saveRowsForImportDate: async (date, rows) => saved.set(date, plain(rows.map(ctx.normalizeCampaignRow))),
      showImportedDateView() {}, loadCurrentView: async () => {},
      money: String, dateRangeLabel: dates => dates.join(',')
    });
    const csvFile = (order, amount) => {
      const cells = Array(50).fill('');
      cells[0] = order;
      cells[platform === 'Shopee' ? 3 : 1] = '2026-11-12';
      cells[platform === 'Shopee' ? 42 : 44] = 'SUP-A';
      cells[platform === 'Shopee' ? 30 : 22] = amount;
      return { name: 'report.csv', text: async () => cells.join(',') };
    };
    const status = {};
    const first = csvFile('order-1', 100.11);
    await ctx.importAffiliateFile(platform, first, status, mode.value);
    await ctx.importAffiliateFile(platform, csvFile('order-2', 40.22), status, mode.value);
    const field = platform === 'Shopee' ? 'shopeeIncome' : 'lazadaIncome';
    assert.equal(saved.get('2026-11-12')[0][field], 140.33);
    await ctx.importAffiliateFile(platform, { ...first, name: 'renamed.csv' }, status, mode.value);
    assert.equal(saved.get('2026-11-12')[0][field], 140.33);
    assert.match(status.textContent, /ไม่บวกยอดซ้ำ/);
    mode.value = 'replace';
    await ctx.importAffiliateFile(platform, csvFile('corrected', 0), status, mode.value);
    assert.equal(saved.get('2026-11-12')[0][field], 0);
    assert.equal(saved.get('2026-11-12')[0].orders, 0);
    mode.value = 'add';
    await ctx.importAffiliateFile(platform, first, status, mode.value);
    assert.equal(saved.get('2026-11-12')[0][field], 0, 'superseded report remains remembered');
  });
}

test('failed replacement keeps the selected mode with its remembered file and restores it after reload', async () => {
  const file = { name: 'report.csv' };
  const controls = { file: { value: 'report.csv' }, button: {}, status: {}, mode: { value: 'replace' } };
  let record = { id: 'owner-file', revision: '1', file, platform: 'Lazada', ownerId: 'owner-a', importMode: 'add' };
  const uploads = new Map([['Lazada', { file, ownerId: 'owner-a', importMode: 'add', record, promise: Promise.resolve(record) }]]);
  let selectedFile = file;
  const ctx = context(['runRememberedCampaignImport', 'restoreRememberedCampaignFiles'], {
    currentUser: { id: 'owner-a' }, campaignUploadActive: false, activeCampaignImportOwner: null,
    campaignUploadControls: { Lazada: { input: 'file', button: 'button', status: 'status', mode: 'mode' } },
    rememberedCampaignUploads: uploads,
    document: { getElementById: key => controls[key] },
    updateEditState() {}, ensureSelectedSingleDateLoaded: async () => {},
    requireCampaignCloudSession: async () => 'owner-a',
    pendingCampaignFile: () => selectedFile,
    setPendingCampaignFile: (_platform, value) => { selectedFile = value; },
    setCampaignSyncStatus: message => { throw Error(message); },
    campaignImportStore: {
      async put(platform, file, ownerId, importMode) {
        record = { id: 'owner-file', revision: '2', platform, file, ownerId, importMode };
        return record;
      },
      async list() { return [record]; }
    }
  });
  let selectedMode;
  assert.equal(await ctx.runRememberedCampaignImport('Lazada', file, controls.status, async mode => {
    selectedMode = mode;
    throw Error('connection interrupted');
  }), false);
  assert.equal(selectedMode, 'replace');
  assert.equal(record.importMode, 'replace');
  assert.equal(controls.mode.disabled, false);
  uploads.clear(); selectedFile = null; controls.mode.value = 'add';
  await ctx.restoreRememberedCampaignFiles();
  assert.equal(controls.mode.value, 'replace');
  assert.equal(selectedFile, file);
});

test('replacement rejects two source SUPs resolving to the same renamed row without altering saved input', () => {
  const rows = apply([], 'Lazada', [group(100)]).rows;
  rows[0].name = 'RENAMED';
  const before = plain(rows);
  assert.throws(() => apply(rows, 'Lazada', [group(180), group(20, 1, 'RENAMED')], ids[1], 'replace'), /หลายกลุ่ม/);
  assert.deepEqual(rows, before);
});
test('replacement preserves other-platform orders even when its positive and negative amounts net to zero', () => {
  let rows = apply([], 'Shopee', [group(10, 2)]).rows;
  rows = apply(rows, 'Shopee', [group(-10, 1)], ids[1]).rows;
  rows = apply(rows, 'Lazada', [group(40, 1)], ids[2]).rows;
  rows = apply(rows, 'Lazada', [group(50, 2)], ids[3], 'replace').rows;
  assert.equal(rows[0].orders, 5);
});

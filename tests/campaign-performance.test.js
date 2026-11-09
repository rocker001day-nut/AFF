const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function extract(name) {
  const start = source.search(new RegExp('^ {0,4}(?:async )?function ' + name + '\\(', 'm'));
  assert.ok(start >= 0, name + ' exists');
  const rest = source.slice(start);
  const next = /\n {0,4}(?:async )?function /.exec(rest);
  assert.ok(next, 'Boundary after ' + name);
  return rest.slice(0, next.index);
}
function context(names, values) {
  const ctx = vm.createContext(values);
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return ctx;
}

function sortHarness() {
  const fields = ['platform', 'name', 'orders', 'shopeeIncome', 'lazadaIncome', 'adCost'];
  const state = { inputReads: 0, tableReads: 0 };
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    name: i === 999 ? 'Live สด' : 'SUP-' + String(i).padStart(4, '0'),
    platform: i === 999 ? 'Live สด' : 'Lazada',
    orders: 1, shopeeIncome: 0, lazadaIncome: Math.floor(i / 2), adCost: 0
  }));
  const nodes = rows.map(row => ({
    row,
    querySelector(selector) {
      const match = /^\[name="([^"]+)"\]$/.exec(selector);
      assert.ok(match && fields.includes(match[1]));
      state.inputReads++;
      return { value: String(row[match[1]]) };
    }
  }));
  const ctx = context(['numberValue', 'getRowsFromDom', 'liveFirstRank', 'sortableRowValue',
    'applyTableSort', 'keepLiveFirst'], {
    tableSort: { key: 'lazadaIncome', direction: 'desc' },
    rowsEl: {
      querySelectorAll(selector) { assert.equal(selector, 'tr'); state.tableReads++; return [...nodes]; },
      appendChild(node) { nodes.splice(nodes.indexOf(node), 1); nodes.push(node); }
    },
    rowForViewMode: row => row,
    platformFromRow: row => row.platform,
    calculate: row => row
  });
  return { ctx, state, rows, nodes };
}

for (const direction of ['asc', 'desc']) {
  test('sorting 1000 rows ' + direction + ' reads one data snapshot and keeps Live first and SUP tie order', () => {
    const h = sortHarness();
    h.ctx.tableSort.direction = direction;
    const expected = [...h.rows].sort((a, b) => {
      const live = Number(b.platform === 'Live สด') - Number(a.platform === 'Live สด');
      const amount = direction === 'desc' ? b.lazadaIncome - a.lazadaIncome : a.lazadaIncome - b.lazadaIncome;
      return live || amount || a.name.localeCompare(b.name, 'th');
    }).map(row => row.name);
    h.ctx.applyTableSort();
    assert.deepEqual(h.nodes.map(node => node.row.name), expected);
    assert.equal(h.state.inputReads, 6000);
    assert.equal(h.state.tableReads, 2);
  });
}

test('pinning Live first reads one snapshot and keeps the other 999 rows in their existing order', () => {
  const h = sortHarness();
  h.ctx.keepLiveFirst();
  assert.deepEqual(h.nodes.map(node => node.row.name),
    ['Live สด', ...h.rows.slice(0, -1).map(row => row.name)]);
  assert.equal(h.state.inputReads, 6000);
  assert.equal(h.state.tableReads, 2);
});

function appendHarness() {
  const state = { nodes: [], updates: [], editStates: 0, reorders: 0, filters: 0, charts: 0 };
  const control = () => ({ value: '', addEventListener() {} });
  const rowsEl = {
    appendChild(node) { state.nodes.push(node); },
    set innerHTML(value) { assert.equal(value, ''); state.nodes.length = 0; }
  };
  const date = '2026-11-09';
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    name: 'SUP-' + i, platform: 'Lazada', lazadaIncome: i + 0.25,
    shopeeIncome: 0, adCost: 0, orders: 1
  }));
  const ctx = context(['wholeNumberDisplay', 'decimalNumberDisplay', 'addRow', 'loadCampaignView'], {
    currentUser: null, latestLoadToken: 0, loadedCampaignView: null, currentChartRowsByDate: [],
    selectedDate: date, isRangeView: false, isLoadingRows: false, campaignViewReadFailed: false,
    dateInput: { value: date }, rangeEndInput: { value: date }, saveStatusEl: { textContent: '' },
    rowsEl, document: { createElement(tag) {
      assert.equal(tag, 'tr');
      return { querySelector: control, querySelectorAll: () => [control()] };
    } },
    AffDashboardVisuals: { splitSupName: name => ({ supId: name, productName: '' }) },
    escapeAttr: value => String(value || ''),
    eachDateInRange: (start, end) => start === end ? [start] : [start, end],
    readDailyStore: () => ({ [date]: rows }),
    campaignDataFingerprint: value => JSON.stringify(value),
    saveCurrentView() {},
    mergeRowsForRange: values => values,
    updateAll: options => state.updates.push({ ...options }),
    updateEditState: () => { state.editStates++; },
    reorderTableRows: () => { state.reorders++; },
    applySearchFilter: () => { state.filters++; },
    renderCurrentChart: () => { state.charts++; }
  });
  return { ctx, state, date };
}

test('loading 1000 rows renders totals once and sets edit state only at the load boundaries', async () => {
  const h = appendHarness();
  assert.equal(await h.ctx.loadCampaignView(h.date, h.date), true);
  assert.equal(h.state.nodes.length, 1000);
  assert.equal(h.state.updates.length, 1);
  assert.equal(h.state.editStates, 2);
  assert.equal(h.state.reorders, 1);
  assert.equal(h.state.filters, 0, 'updateAll owns filtering');
  assert.equal(h.state.charts, 0, 'updateAll owns the single-day chart');
  assert.equal(h.state.updates.some(options => options.persist), false);
});

test('a manual row addition still recalculates, sorts, persists and sets edit state', () => {
  const h = appendHarness();
  h.ctx.addRow({ name: 'NEW-SUP', platform: 'Lazada', lazadaIncome: 12.34 });
  assert.equal(h.state.nodes.length, 1);
  assert.equal(h.state.updates.length, 1);
  assert.equal(h.state.updates[0].reorder, true);
  assert.equal(h.state.updates[0].persist, true);
  assert.equal(h.state.editStates, 1);
});

test('a date range renders its chart once after all rows are ready', async () => {
  const h = appendHarness();
  assert.equal(await h.ctx.loadCampaignView(h.date, '2026-11-10'), true);
  assert.equal(h.state.nodes.length, 1000);
  assert.equal(h.state.updates.length, 1);
  assert.equal(h.state.editStates, 2);
  assert.equal(h.state.charts, 1);
});

test('currency formatters are reused while preserving cents and whole-baht rounding', () => {
  const start = source.indexOf('    const moneyFormatter =');
  const end = source.indexOf('    function money(', start);
  assert.ok(start >= 0 && end > start);
  let constructors = 0;
  const ctx = vm.createContext({
    Intl: { NumberFormat: function (...args) { constructors++; return new Intl.NumberFormat(...args); } }
  });
  vm.runInContext(source.slice(start, end) + extract('money') + '\n' + extract('moneyWhole'), ctx);
  const expectedMoney = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' });
  const expectedWhole = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 });
  for (let i = 0; i < 1000; i++) {
    const value = [-1234.567, -0.5, 0, 12.34, 1234.567, null, undefined][i % 7];
    assert.equal(ctx.money(value), expectedMoney.format(value || 0));
    assert.equal(ctx.moneyWhole(value), expectedWhole.format(Math.round(Number(value || 0))));
  }
  assert.equal(constructors, 2);
});

test('hidden Office and Dorm pages do not build their interface', () => {
  const ctx = context(['renderOfficeTasks', 'renderDormPage'], {
    aiOfficePageEl: { hidden: true }, dormPageEl: { hidden: true },
    readOfficeTasks: () => assert.fail('hidden Office must not read and rebuild tasks'),
    readDormState: () => assert.fail('hidden Dorm must not initialize its UI')
  });
  ctx.renderOfficeTasks();
  ctx.renderDormPage();
});

test('opening an app page renders that page and refreshes an already-loaded dashboard', () => {
  const ids = ['dashboardPage', 'autoSyncPage', 'aiOfficePage', 'dormPage',
    'facebookPage', 'editPostPage', 'facebookPublisherPage'];
  const pages = Object.fromEntries(ids.map(id => [id, { hidden: true }]));
  const calls = { office: 0, dorm: 0, refresh: 0 };
  const ctx = context(['setActivePage'], {
    dashboardPageEl: pages.dashboardPage, autoSyncPageEl: pages.autoSyncPage,
    aiOfficePageEl: pages.aiOfficePage, dormPageEl: pages.dormPage,
    loadedCampaignView: null, activePageStorageKey: 'page', safeSetLocalStorage() {},
    document: { getElementById: id => pages[id], querySelectorAll: () => [], dispatchEvent() {} },
    renderOfficeTasks() { assert.equal(pages.aiOfficePage.hidden, false); calls.office++; },
    renderDormPage() { assert.equal(pages.dormPage.hidden, false); calls.dorm++; },
    refreshCampaignView() { assert.equal(pages.dashboardPage.hidden, false); calls.refresh++; }
  });
  ctx.setActivePage('dashboard');
  assert.equal(calls.refresh, 0, 'initial dashboard is loaded by initApp once');
  ctx.setActivePage('office');
  ctx.setActivePage('dorm');
  ctx.loadedCampaignView = { ownerId: 'user' };
  ctx.setActivePage('dashboard');
  assert.deepEqual(calls, { office: 1, dorm: 1, refresh: 1 });
  assert.equal(pages.aiOfficePage.hidden, true);
  assert.equal(pages.dormPage.hidden, true);
});

function refreshHarness(hidden) {
  const calls = { flush: 0, load: 0 };
  const ctx = context(['refreshCampaignView'], {
    currentUser: { id: 'user' }, campaignRefreshActive: false, isLoadingRows: false,
    campaignUploadActive: false, campaignViewReadFailed: false, campaignViewChoiceRevision: 0,
    document: { hidden: false, activeElement: null }, dashboardPageEl: { hidden },
    loadedCampaignView: null, rowsEl: { contains: () => false },
    flushCampaignOutbox: async () => { calls.flush++; return true; },
    loadCurrentView: async () => { calls.load++; }, console
  });
  return { ctx, calls };
}

test('background refresh skips other app pages and resumes on the dashboard', async () => {
  const h = refreshHarness(true);
  await h.ctx.refreshCampaignView();
  assert.deepEqual(h.calls, { flush: 0, load: 0 });
  h.ctx.dashboardPageEl.hidden = false;
  await h.ctx.refreshCampaignView();
  assert.deepEqual(h.calls, { flush: 1, load: 1 });
  assert.equal(h.ctx.campaignRefreshActive, false);
});

test('navigating away during sync does not start a hidden dashboard reload', async () => {
  const h = refreshHarness(false);
  let resolve;
  h.ctx.flushCampaignOutbox = () => new Promise(done => { resolve = done; });
  const refreshing = h.ctx.refreshCampaignView();
  h.ctx.dashboardPageEl.hidden = true;
  resolve(true);
  await refreshing;
  assert.equal(h.calls.load, 0);
  assert.equal(h.ctx.campaignRefreshActive, false);
});

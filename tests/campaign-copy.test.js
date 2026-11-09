const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(name) {
  const start = new RegExp('^ {0,4}(?:async )?function ' + name + '\\(', 'm').exec(html);
  assert.ok(start, 'Missing function: ' + name);
  const rest = html.slice(start.index);
  const next = /\n {0,4}(?:async )?function /.exec(rest);
  assert.ok(next, 'Missing next function after: ' + name);
  return rest.slice(0, next.index);
}
const code = ['wholeNumberDisplay', 'decimalNumberDisplay', 'copyTextToClipboard',
  'copyCampaignNameFromRow', 'addRow'].map(extractFunction).join('\n');

function control(value = '') {
  const listeners = {};
  return {
    value: String(value), checked: true, title: '', style: {},
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
    async emit(type) {
      for (const handler of listeners[type] || []) await handler({ target: this });
    },
    setAttribute() {}, select() {}, setSelectionRange() {}, remove() {}
  };
}

function harness(field, clipboardMode) {
  const rows = [];
  const writes = [];
  const updates = [];
  let pendingRow;
  let textarea;
  const context = {
    console,
    isLoadingRows: true,
    isRangeView: false,
    saveStatusEl: { textContent: '' },
    escapeAttr: value => String(value || ''),
    AffDashboardVisuals: {
      splitSupName(name) {
        const [supId, productName = ''] = String(name || '').split(' | ');
        return { supId, productName };
      },
      updateSupName(_name, supId, productName) { return supId + ' | ' + productName; }
    },
    updateEditState() {},
    updateAll(options = {}) {
      updates.push({ ...options });
      if (options.reorder) {
        rows.sort((a, b) => Number(b.fields[field].value) - Number(a.fields[field].value));
      }
    },
    rowsEl: { appendChild(tr) { rows.push(tr); } },
    window: { isSecureContext: clipboardMode === 'modern' },
    navigator: clipboardMode === 'modern' ? {
      clipboard: { async writeText(value) { writes.push(value); } }
    } : {},
    document: {
      body: { appendChild(node) { textarea = node; } },
      execCommand(command) {
        assert.equal(command, 'copy');
        writes.push(textarea.value);
        return true;
      },
      createElement(tag) {
        if (tag === 'textarea') return control();
        assert.equal(tag, 'tr');
        const row = pendingRow;
        const fields = Object.fromEntries(
          ['name', 'orders', 'shopeeIncome', 'lazadaIncome', 'adCost', 'platform']
            .map(key => [key, control(row[key] || '')])
        );
        const sup = control(row.name.split(' | ')[0]);
        const copy = control();
        const checkbox = control();
        const deletion = control();
        const tr = {
          fields, sup, copy, checkbox,
          querySelector(selector) {
            const match = /^\[name="([^"]+)"\]$/.exec(selector);
            if (match) return fields[match[1]];
            return {
              '[data-sup-id]': sup,
              '[data-copy-campaign-name]': copy,
              '[data-aff-select]': checkbox,
              '[data-delete]': deletion
            }[selector];
          },
          querySelectorAll(selector) {
            if (selector === 'select') return [fields.platform];
            assert.equal(selector, 'input:not([data-aff-select]):not([data-sup-id])');
            return ['name', 'orders', 'shopeeIncome', 'lazadaIncome', 'adCost'].map(key => fields[key]);
          }
        };
        return tr;
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'campaign-copy-functions.js' });
  for (const [supId, value] of [['SUP-A', 20], ['SUP-B', 10]]) {
    pendingRow = {
      name: supId + ' | Product ' + supId,
      platform: 'Shopee + Lazada', orders: 1,
      shopeeIncome: value, lazadaIncome: value, adCost: value
    };
    context.addRow(pendingRow);
  }
  context.isLoadingRows = false;
  updates.length = 0;
  return { rows, writes, updates, context };
}

for (const clipboardMode of ['modern', 'fallback']) {
  for (const field of ['shopeeIncome', 'lazadaIncome', 'adCost']) {
    for (const edited of [false, true]) {
      test(clipboardMode + ' Copy after ' + (edited ? 'editing ' : 'focusing ') + field + ' preserves row order', async () => {
        const h = harness(field, clipboardMode);
        const clickedRow = h.rows[1];
        const beforeOrder = h.rows.map(tr => tr.sup.value);
        if (edited) {
          clickedRow.fields[field].value = '99.75';
          await clickedRow.fields[field].emit('input');
        }
        // A real click changes focus before dispatching click on Copy.
        await clickedRow.fields[field].emit('blur');
        await clickedRow.copy.emit('click');
        assert.deepEqual(h.rows.map(tr => tr.sup.value), beforeOrder);
        assert.deepEqual(h.writes, ['SUP-B']);
        assert.equal(h.updates.some(options => options.reorder), false);
        assert.ok(h.updates.some(options => options.persist));
        assert.equal(clickedRow.fields[field].value,
          field === 'lazadaIncome' ? (edited ? '99.75' : '10.00') : (edited ? '100' : '10'));
        assert.equal(h.context.saveStatusEl.textContent, 'Copied SUP ID: SUP-B');
      });
    }
  }
}

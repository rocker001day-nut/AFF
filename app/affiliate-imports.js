/* Affiliate file history is saved with each daily row, including zero totals. */
(function (root) {
  "use strict";
  const fields = { Shopee: "shopeeIncome", Lazada: "lazadaIncome" };
  const supKey = value => String(value || "").trim().toLowerCase();
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  // Remove floating point noise without rounding each source to whole baht or cents.
  const add = (left, right) => Number((number(left) + number(right)).toFixed(10));

  function history(row) {
    return (Array.isArray(row._affiliateImports) ? row._affiliateImports : [])
      .filter(item => item && /^[a-f0-9]{64}$/.test(item.id) && fields[item.platform] &&
        typeof item.sup === "string" && Number.isFinite(item.income) && Number.isFinite(item.orders))
      .map(item => ({ id: item.id, platform: item.platform, sup: item.sup,
        income: item.income, orders: item.orders, active: item.active !== false }));
  }

  async function fingerprint(rows, cryptoProvider = root.crypto) {
    if (!cryptoProvider?.subtle) throw Error("ระบบตรวจไฟล์ซ้ำยังไม่พร้อม กรุณารีเฟรชหน้าเว็บ");
    // Complete parsed rows include order/account data. Names or SUP totals cannot identify a file.
    // Row order, renamed files and Excel container metadata do not change its identity.
    const canonical = rows.map(row => {
      const cells = Array.from(row, value => value == null ? "" : value);
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      return JSON.stringify(cells);
    }).sort().join("\n");
    const digest = await cryptoProvider.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function merge(inputRows, platform, inputGroups, options = {}) {
    if (!Object.hasOwn(fields, platform)) throw Error("แพลตฟอร์มนำเข้าไม่ถูกต้อง");
    const { id, mode = "add", legacyGroups = [] } = options;
    if (mode !== "add" && mode !== "replace") throw Error("วิธีรวมยอดไม่ถูกต้อง");
    if ((mode === "add" || id) && !/^[a-f0-9]{64}$/.test(id || "")) throw Error("ยังตรวจสอบไฟล์นำเข้าไม่สำเร็จ");
    const field = fields[platform];
    const other = fields[platform === "Shopee" ? "Lazada" : "Shopee"];
    const rows = inputRows.map(row => {
      const entries = history(row);
      const copy = { ...row };
      if (entries.length) copy._affiliateImports = entries;
      else delete copy._affiliateImports;
      return copy;
    });
    const groups = new Map();
    for (const input of inputGroups) {
      const key = supKey(input.supName);
      if (!groups.has(key)) groups.set(key, { supName: input.supName, total: 0, orders: 0 });
      const group = groups.get(key);
      group.total = add(group.total, input.total);
      group.orders += number(input.orders);
    }
    // This repair belongs only to explicit replacement of old pre-history reports.
    if (mode === "replace" && platform === "Lazada") {
      for (const legacy of legacyGroups) {
        const key = supKey(legacy.supName);
        if (!["n", "y"].includes(key) || groups.has(key)) continue;
        const row = rows.find(item => supKey(item.name) === key);
        if (!row || row._affiliateImports?.length || number(row.shopeeIncome) !== 0 ||
            Math.abs(number(row.lazadaIncome) - legacy.total) > 0.000001 ||
            number(row.orders) !== legacy.orders) continue;
        row.lazadaIncome = 0;
        row.orders = 0;
      }
    }
    const byName = new Map(rows.map(row => [supKey(row.name), row]));
    const seen = new Set();
    for (const row of rows) for (const entry of row._affiliateImports || []) {
      if (entry.platform === platform && entry.id === id) seen.add(entry.sup);
    }
    const replaced = new Set();
    let appliedGroups = 0;
    let skippedGroups = 0;
    let incomeChange = 0;
    for (const [key, group] of groups) {
      // Check original SUP history across the day, even when its display name was edited.
      if (mode === "add" && seen.has(key)) {
        skippedGroups += 1;
        continue;
      }
      let row = byName.get(key);
      if (!row && mode === "replace") {
        const originals = rows.filter(item => (item._affiliateImports || [])
          .some(entry => entry.platform === platform && entry.sup === key));
        if (originals.length > 1) throw Error("พบ SUP เดิมในหลายแถว กรุณาตรวจชื่อ SUP ก่อนแทนยอด: " + group.supName);
        row = originals[0];
      }
      if (!row) {
        row = { platform: group.supName === "Live สด" ? "Live สด" : platform,
          name: group.supName, orders: 0, shopeeIncome: 0, lazadaIncome: 0, adCost: 0 };
        rows.push(row);
        byName.set(key, row);
      }
      if (mode === "replace") {
        if (replaced.has(row)) throw Error("ชื่อ SUP ที่แก้ไว้ตรงกับหลายกลุ่มในไฟล์ กรุณาตรวจชื่อก่อนแทนยอด: " + group.supName);
        replaced.add(row);
      }
      const previous = number(row[field]);
      const entries = row._affiliateImports || [];
      if (mode === "replace") {
        const active = entries.filter(entry => entry.platform === platform && entry.active !== false);
        const hasOtherOrders = entries.some(entry => entry.platform !== platform && entry.active !== false && entry.orders !== 0);
        if (!number(row[other]) && !hasOtherOrders) {
          row.orders = group.orders;
        } else if (active.length) {
          row.orders = Math.max(0, number(row.orders) - active.reduce((sum, entry) => sum + entry.orders, 0) + group.orders);
        } else if (!previous) {
          row.orders = number(row.orders) + group.orders;
        }
        row[field] = group.total;
        // Keep history of superseded files so an old file cannot accidentally be added again.
        for (const entry of entries) if (entry.platform === platform) entry.active = false;
      } else {
        row[field] = add(previous, group.total);
        row.orders = number(row.orders) + group.orders;
      }
      if (id) {
        const record = { id, platform, sup: key, income: group.total, orders: group.orders, active: true };
        const index = entries.findIndex(entry => entry.id === id && entry.platform === platform && entry.sup === key);
        if (index < 0) entries.push(record);
        else entries[index] = record;
        row._affiliateImports = entries;
      }
      seen.add(key);
      appliedGroups += 1;
      incomeChange = add(incomeChange, number(row[field]) - previous);
    }
    return { rows: rows.filter(row => number(row.shopeeIncome) !== 0 || number(row.lazadaIncome) !== 0 ||
      number(row.adCost) !== 0 || number(row.orders) !== 0 || row._affiliateImports?.length),
      appliedGroups, skippedGroups, incomeChange };
  }
  const api = { fingerprint, merge };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AffAffiliateImports = api;
})(typeof globalThis === "object" ? globalThis : this);

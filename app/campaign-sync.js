/* Durable, account-scoped campaign outbox. No credentials are stored here. */
(function (root) {
  "use strict";
  function create(options) {
    const { storage, activeOwner, write } = options;
    const prefix = options.prefix || "affiliate-campaign-outbox-v1:";
    const flights = new Map();
    let sequence = 0;
    function read(owner) {
      const raw = storage.getItem(prefix + owner);
      if (!raw) return {};
      const entries = JSON.parse(raw);
      if (!entries || Array.isArray(entries) || typeof entries !== "object") throw Error("คิวบันทึกเสียหาย กรุณาดาวน์โหลด Excel สำรอง");
      return entries;
    }
    function persist(owner, entries) {
      // Do not acknowledge a local save if the browser could not retain it.
      storage.setItem(prefix + owner, JSON.stringify(entries));
    }
    function enqueue(owner, date, rows) {
      if (!owner || !date || !Array.isArray(rows)) throw Error("ข้อมูลสำหรับบันทึกไม่ครบ");
      const entries = read(owner);
      const entry = { date, rows: JSON.parse(JSON.stringify(rows)), revision: Date.now() + "-" + (++sequence) + "-" + Math.random().toString(36).slice(2) };
      entries[date] = entry;
      persist(owner, entries);
      return entry;
    }
    function pending(owner, date) {
      const entry = owner ? read(owner)[date] : null;
      return entry && Array.isArray(entry.rows) ? JSON.parse(JSON.stringify(entry)) : null;
    }
    function list(owner) {
      return owner ? Object.values(read(owner)).filter(entry => entry && entry.date && Array.isArray(entry.rows)).sort((a,b) => a.date.localeCompare(b.date)) : [];
    }
    function flush(owner) {
      if (!owner || activeOwner() !== owner) return Promise.resolve();
      if (flights.has(owner)) return flights.get(owner);
      const flight = (async () => {
        while (activeOwner() === owner) {
          const entry = list(owner)[0];
          if (!entry) return;
          await write(entry.date, entry.rows, owner);
          const entries = read(owner);
          // An older request must never remove a newer edit or another tab's edit.
          if (entries[entry.date]?.revision === entry.revision) {
            delete entries[entry.date];
            persist(owner, entries);
          }
        }
      })();
      flights.set(owner, flight);
      return flight.finally(() => { if (flights.get(owner) === flight) flights.delete(owner); });
    }
    return { enqueue, pending, list, flush };
  }
  if (typeof module === "object" && module.exports) module.exports = { create };
  else root.AffCampaignSync = { create };
})(typeof globalThis === "object" ? globalThis : this);

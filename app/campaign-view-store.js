/* Verified campaign read cache. Pending writes remain in campaign-sync.js. */
(function (root) {
  "use strict";
  function create({ indexedDB } = {}) {
    const memory = new Map();
    let databasePromise;
    function identity(owner, date) {
      if (typeof owner !== "string" || !owner.trim() || typeof date !== "string" || !date.trim()) {
        throw Error("บัญชีและวันที่สำหรับเก็บยอดไม่ครบ");
      }
      return JSON.stringify([owner, date]);
    }
    function copyRows(rows) {
      if (!Array.isArray(rows)) throw Error("ข้อมูลยอดที่เก็บต้องเป็นรายการ");
      return JSON.parse(JSON.stringify(rows));
    }
    function result(record, owner, date) {
      if (!record) return null;
      if (record.owner !== owner || record.date !== date || !Array.isArray(record.rows)) {
        throw Error("ข้อมูลยอดสำรองไม่ตรงกับบัญชีหรือวันที่");
      }
      return { rows: copyRows(record.rows), cachedAt: record.cachedAt };
    }
    function database() {
      if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
          let failed = false;
          const request = indexedDB.open("aff-campaign-view-cache-v1", 1);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains("views")) {
              request.result.createObjectStore("views", { keyPath: "id" });
            }
          };
          request.onsuccess = () => {
            const db = request.result;
            if (failed) { db.close(); return; }
            db.onversionchange = () => { db.close(); databasePromise = null; };
            resolve(db);
          };
          request.onerror = () => {
            failed = true;
            reject(request.error || Error("เปิดที่เก็บยอดสำรองไม่สำเร็จ"));
          };
          request.onblocked = () => {
            failed = true;
            reject(Error("เปิดที่เก็บยอดสำรองไม่ได้ กรุณาปิดแท็บเก่าของเว็บนี้"));
          };
        }).catch(error => { databasePromise = null; throw error; });
      }
      return databasePromise;
    }
    async function transaction(mode, action) {
      const db = await database();
      return new Promise((resolve, reject) => {
        let tx;
        try { tx = db.transaction("views", mode); }
        catch (error) { databasePromise = null; reject(error); return; }
        let value;
        tx.oncomplete = () => resolve(value);
        tx.onabort = tx.onerror = () => reject(tx.error || Error("เก็บยอดสำรองไม่สำเร็จ"));
        try { action(tx.objectStore("views"), next => { value = next; }); }
        catch (error) { try { tx.abort(); } catch (_) {} reject(error); }
      });
    }
    async function put(owner, date, rows) {
      const id = identity(owner, date);
      // Copy before awaiting the database so subsequent edits cannot change this snapshot.
      const record = { id, owner, date, rows: copyRows(rows), cachedAt: Date.now() };
      if (!indexedDB) {
        // This fallback lasts only for this page instance; it never claims disk durability.
        memory.set(id, record);
      } else {
        await transaction("readwrite", (store, done) => {
          const request = store.put(record);
          request.onsuccess = () => done(true);
        });
      }
      return result(record, owner, date);
    }
    async function get(owner, date) {
      const id = identity(owner, date);
      const record = !indexedDB ? memory.get(id) : await transaction("readonly", (store, done) => {
        const request = store.get(id);
        request.onsuccess = () => done(request.result);
      });
      return result(record, owner, date);
    }
    return { put, get };
  }
  if (typeof module === "object" && module.exports) module.exports = { create };
  else root.AffCampaignViewStore = { create };
})(typeof globalThis === "object" ? globalThis : this);


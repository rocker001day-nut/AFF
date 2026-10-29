(function(root) {
  "use strict";
  function create({indexedDB}) {
    let databasePromise;
    function database() {
      if (!databasePromise) {
        databasePromise = new Promise((resolve,reject) => {
          if (!indexedDB) { reject(Error("เบราว์เซอร์นี้ยังเก็บไฟล์อัปโหลดไม่ได้")); return; }
          const request = indexedDB.open("aff-campaign-upload-files-v1", 1);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains("uploads")) request.result.createObjectStore("uploads", {keyPath:"id"});
          };
          request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => { db.close(); databasePromise = null; };
            resolve(db);
          };
          request.onerror = () => reject(request.error || Error("เปิดที่เก็บไฟล์ไม่สำเร็จ"));
          request.onblocked = () => reject(Error("เปิดที่เก็บไฟล์ไม่ได้ กรุณาปิดแท็บเก่าของเว็บนี้"));
        }).catch(error => { databasePromise = null; throw error; });
      }
      return databasePromise;
    }
    async function transaction(mode, action) {
      const db = await database();
      return new Promise((resolve,reject) => {
        const tx = db.transaction("uploads", mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error || Error("เก็บไฟล์อัปโหลดไม่สำเร็จ"));
        try { action(tx.objectStore("uploads"), value => { result = value; }); }
        catch (error) { try { tx.abort(); } catch (_) {} reject(error); }
      });
    }
    async function put(platform,file,ownerId = null) {
      if (!platform || !file) throw Error("ไม่พบไฟล์สำหรับจดจำ");
      const record = {id:JSON.stringify([ownerId || null, platform]),platform,file,ownerId:ownerId || null,
        revision:Date.now() + "-" + Math.random().toString(36).slice(2),updatedAt:Date.now()};
      return transaction("readwrite", (store,done) => {
        const request = store.put(record);
        request.onsuccess = () => done(record);
      });
    }
    async function list(ownerId = null) {
      const records = await transaction("readonly", (store,done) => {
        const request = store.getAll();
        request.onsuccess = () => done(request.result || []);
      });
      return records.filter(record => record.file && (record.ownerId === (ownerId || null) || !record.ownerId))
        .sort((a,b) => Number(!a.ownerId) - Number(!b.ownerId) || b.updatedAt - a.updatedAt);
    }
    async function remove(id,revision) {
      return transaction("readwrite", (store,done) => {
        const request = store.get(id);
        request.onsuccess = () => {
          if (!request.result || request.result.revision !== revision) { done(false); return; }
          const deletion = store.delete(id);
          deletion.onsuccess = () => done(true);
        };
      });
    }
    return {put,list,remove};
  }
  if (typeof module === "object" && module.exports) module.exports = {create};
  else root.AffCampaignImportStore = {create};
})(typeof globalThis === "object" ? globalThis : this);

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {File}=require('node:buffer');
const {create}=require('../app/campaign-import-store.js');
function fakeIndexedDB() {
  const backend={records:new Map(),failCommit:false};
  const db={
    objectStoreNames:{contains:()=>true},close(){},
    transaction(name,mode) {
      const tx={error:null,oncomplete:null,onerror:null,onabort:null};
      const staged=new Map(backend.records);let pending=0,finished=false,timer;
      function schedule() {
        clearTimeout(timer);
        timer=setTimeout(()=>{
          if(pending||finished)return;
          finished=true;
          if(backend.failCommit){tx.error=Error('disk full');tx.onabort?.();return;}
          if(mode==='readwrite')backend.records=staged;
          tx.oncomplete?.();
        },0);
      }
      function request(operation) {
        const req={result:undefined,error:null};pending++;
        queueMicrotask(()=>{
          try{req.result=operation();req.onsuccess?.();}
          catch(error){req.error=error;tx.error=error;req.onerror?.();finished=true;tx.onabort?.();}
          pending--;schedule();
        });
        return req;
      }
      tx.objectStore=()=>({
        put:record=>request(()=>{staged.set(record.id,{...record});return record.id;}),
        get:id=>request(()=>staged.get(id)),
        getAll:()=>request(()=>[...staged.values()]),
        delete:id=>request(()=>staged.delete(id))
      });
      tx.abort=()=>{finished=true;tx.error=Error('aborted');queueMicrotask(()=>tx.onabort?.());};
      schedule();return tx;
    }
  };
  return {backend,open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}};
}
test('raw file survives creating a fresh store after reload',async()=>{
  const indexedDB=fakeIndexedDB();const first=create({indexedDB});
  await first.put('Shopee',new File(['date28,123'],'report28.csv'),'a');
  const restored=await create({indexedDB}).list('a');
  assert.equal(restored.length,1);assert.equal(restored[0].file.name,'report28.csv');
  assert.equal(await restored[0].file.text(),'date28,123');
});
test('owned files stay in their account while an unclaimed file remains available',async()=>{
  const indexedDB=fakeIndexedDB();const store=create({indexedDB});
  await store.put('Shopee',new File(['a'],'a.csv'),'a');
  await store.put('Lazada',new File(['guest'],'guest.csv'));
  const b=await store.list('b');assert.equal(b.length,1);assert.equal(b[0].ownerId,null);
  const a=await store.list('a');assert.equal(a.length,2);assert.equal(a[0].ownerId,'a');
});
test('an older cloud acknowledgement cannot delete a newly selected file',async()=>{
  const store=create({indexedDB:fakeIndexedDB()});
  const old=await store.put('Shopee',new File(['old'],'old.csv'),'a');
  const latest=await store.put('Shopee',new File(['new'],'new.csv'),'a');
  assert.equal(await store.remove(old.id,old.revision),false);
  assert.equal((await store.list('a'))[0].file.name,'new.csv');
  assert.equal(await store.remove(latest.id,latest.revision),true);
  assert.equal((await store.list('a')).length,0);
});
test('a transaction failure after the put request is not acknowledged as saved',async()=>{
  const indexedDB=fakeIndexedDB();indexedDB.backend.failCommit=true;
  const store=create({indexedDB});
  await assert.rejects(store.put('Shopee',new File(['x'],'x.csv'),'a'),/disk full/);
  indexedDB.backend.failCommit=false;
  assert.equal((await store.list('a')).length,0);
});
test('missing IndexedDB reports an error instead of pretending to remember files',async()=>{
  const store=create({indexedDB:null});
  await assert.rejects(store.put('Shopee',new File(['x'],'x.csv')),/เก็บไฟล์/);
});

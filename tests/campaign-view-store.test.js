const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../app/campaign-view-store.js');

// Request success precedes commit, matching the IndexedDB transaction boundary.
function fakeIndexedDB() {
  const backend = { databases: new Map(), failOpen: false, failCommit: false, failRead: false, opens: 0, connections: [] };
  function connection(stores) {
    const db = {
      closed: false,
      objectStoreNames: { contains: name => stores.has(name) },
      createObjectStore(name) { stores.set(name, new Map()); },
      close() { this.closed = true; },
      transaction(name, mode) {
        if (db.closed) throw Error('database closed');
        const initial = stores.get(name);
        if (!initial) throw Error('missing object store');
        const staged = new Map([...initial].map(([key, value]) => [key, structuredClone(value)]));
        const tx = { error: null };
        let pending = 0;
        let finished = false;
        let timer;
        function schedule() {
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (pending || finished) return;
            finished = true;
            if (backend.failCommit) {
              tx.error = Error('disk full');
              tx.onabort?.();
              return;
            }
            if (mode === 'readwrite') stores.set(name, staged);
            tx.oncomplete?.();
          }, 0);
        }
        function request(operation) {
          const req = {};
          pending++;
          queueMicrotask(() => {
            try {
              req.result = operation();
              req.onsuccess?.();
            } catch (error) {
              req.error = error;
              tx.error = error;
              req.onerror?.();
              finished = true;
              tx.onabort?.();
            }
            pending--;
            schedule();
          });
          return req;
        }
        tx.objectStore = () => ({
          put: record => request(() => { staged.set(record.id, structuredClone(record)); return record.id; }),
          get: id => request(() => {
            if (backend.failRead) throw Error('read failed');
            const value = staged.get(id);
            return value === undefined ? undefined : structuredClone(value);
          })
        });
        tx.abort = () => {
          finished = true;
          tx.error = Error('aborted');
          queueMicrotask(() => tx.onabort?.());
        };
        schedule();
        return tx;
      }
    };
    backend.connections.push(db);
    return db;
  }
  return {
    backend,
    open(name) {
      backend.opens++;
      const req = {};
      queueMicrotask(() => {
        if (backend.failOpen) {
          req.error = Error('open failed');
          req.onerror?.();
          return;
        }
        const isNew = !backend.databases.has(name);
        if (isNew) backend.databases.set(name, new Map());
        req.result = connection(backend.databases.get(name));
        if (isNew) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    }
  };
}

const day = '2026-10-28';
const example = () => [{ name: 'SUP', shopeeIncome: 123, nested: { source: 'verified' } }];

test('verified rows survive a fresh cache instance after reload', async () => {
  const indexedDB = fakeIndexedDB();
  const record = await create({ indexedDB }).put('account-a', day, example());
  const restored = await create({ indexedDB }).get('account-a', day);
  assert.deepEqual(restored.rows, example());
  assert.equal(restored.cachedAt, record.cachedAt);
  assert.equal(typeof restored.cachedAt, 'number');
});

test('accounts and dates have separate keys, including delimiter characters', async () => {
  const store = create({ indexedDB: fakeIndexedDB() });
  await store.put('a:b', 'c', [{ value: 1 }]);
  await store.put('a', 'b:c', [{ value: 2 }]);
  await store.put('account-a', day, [{ value: 3 }]);
  assert.deepEqual((await store.get('a:b', 'c')).rows, [{ value: 1 }]);
  assert.deepEqual((await store.get('a', 'b:c')).rows, [{ value: 2 }]);
  assert.equal(await store.get('account-b', day), null);
  assert.equal(await store.get('account-a', '2026-10-27'), null);
});

test('a verified empty day is retained distinctly from a missing day', async () => {
  const indexedDB = fakeIndexedDB();
  const first = create({ indexedDB });
  assert.equal(await first.get('a', day), null);
  await first.put('a', day, []);
  assert.deepEqual((await create({ indexedDB }).get('a', day)).rows, []);
});

test('input, returned write result and read results cannot mutate the stored snapshot', async () => {
  const store = create({ indexedDB: fakeIndexedDB() });
  const input = example();
  const writing = store.put('a', day, input);
  input[0].nested.source = 'input edited while opening';
  const saved = await writing;
  saved.rows[0].nested.source = 'returned result edited';
  const read = await store.get('a', day);
  assert.equal(read.rows[0].nested.source, 'verified');
  read.rows[0].nested.source = 'read result edited';
  assert.equal((await store.get('a', day)).rows[0].nested.source, 'verified');
});

test('a failed commit rejects the write and preserves the previous committed snapshot', async () => {
  const indexedDB = fakeIndexedDB();
  const store = create({ indexedDB });
  await store.put('a', day, [{ value: 'old' }]);
  indexedDB.backend.failCommit = true;
  await assert.rejects(store.put('a', day, [{ value: 'new' }]), /disk full/);
  indexedDB.backend.failCommit = false;
  assert.deepEqual((await create({ indexedDB }).get('a', day)).rows, [{ value: 'old' }]);
});

test('an IndexedDB open failure is reported and the next operation can retry', async () => {
  const indexedDB = fakeIndexedDB();
  indexedDB.backend.failOpen = true;
  const store = create({ indexedDB });
  await assert.rejects(store.put('a', day, example()), /open failed/);
  indexedDB.backend.failOpen = false;
  assert.equal(await store.get('a', day), null);
  await store.put('a', day, example());
  assert.deepEqual((await store.get('a', day)).rows, example());
});

test('read failures propagate instead of appearing to be missing or empty days', async () => {
  const indexedDB = fakeIndexedDB();
  const store = create({ indexedDB });
  await store.put('a', day, example());
  indexedDB.backend.failRead = true;
  await assert.rejects(store.get('a', day), /read failed/);
  indexedDB.backend.failRead = false;
  assert.deepEqual((await store.get('a', day)).rows, example());
});

test('version changes close the old connection and reopen without losing committed rows', async () => {
  const indexedDB = fakeIndexedDB();
  const store = create({ indexedDB });
  await store.put('a', day, example());
  const db = indexedDB.backend.connections[0];
  db.onversionchange();
  assert.equal(db.closed, true);
  assert.deepEqual((await store.get('a', day)).rows, example());
  assert.equal(indexedDB.backend.opens, 2);
});

test('missing IndexedDB uses isolated memory with copy and explicit empty semantics', async () => {
  const store = create({ indexedDB: null });
  const rows = example();
  await store.put('a', day, rows);
  rows[0].nested.source = 'changed';
  const cached = await store.get('a', day);
  cached.rows[0].nested.source = 'changed again';
  assert.equal((await store.get('a', day)).rows[0].nested.source, 'verified');
  assert.equal(await store.get('b', day), null);
  await store.put('a', day, []);
  assert.deepEqual((await store.get('a', day)).rows, []);
  assert.equal(await create({ indexedDB: null }).get('a', day), null);
});

test('owner identity and row shape must be explicit', async () => {
  const store = create({ indexedDB: fakeIndexedDB() });
  await assert.rejects(store.put(null, day, []), /บัญชี/);
  await assert.rejects(store.get('', day), /บัญชี/);
  await assert.rejects(store.put('a', '', []), /วันที่/);
  await assert.rejects(store.put('a', day, { value: 1 }), /รายการ/);
});


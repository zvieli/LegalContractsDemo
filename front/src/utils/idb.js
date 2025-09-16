// Minimal IndexedDB helper for storing small binary blobs for the MVP
const DB_NAME = 'legalcontracts_demo_db';
const STORE_FILES = 'files';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

export async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_FILES], 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    const req = store.put(value, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('idb put failed'));
  });
}

export async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_FILES], 'readonly');
    const store = tx.objectStore(STORE_FILES);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb get failed'));
  });
}

export async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_FILES], 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    const req = store.delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('idb delete failed'));
  });
}

export default { idbPut, idbGet, idbDelete };

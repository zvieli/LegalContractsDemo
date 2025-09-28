// Minimal IndexedDB helper with localStorage fallback for test environments.
// Exports `idbPut(key, value)` and `idbGet(key)` used by the UI to persist small files.
export async function idbPut(key, value) {
  if (typeof indexedDB !== 'undefined') {
    return new Promise((resolve, reject) => {
      try {
  const req = indexedDB.open('arbitrust-idb', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('store');
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('store', 'readwrite');
          const s = tx.objectStore('store');
          s.put(value, key);
          tx.oncomplete = () => { db.close(); resolve(true); };
          tx.onerror = (e) => { db.close(); reject(e); };
        };
        req.onerror = (e) => reject(e);
      } catch (e) {
        reject(e);
      }
    });
  }
  // Fallback to localStorage for Node/test environments
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    throw e;
  }
}

export async function idbGet(key) {
  if (typeof indexedDB !== 'undefined') {
    return new Promise((resolve, reject) => {
      try {
  const req = indexedDB.open('arbitrust-idb', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('store');
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('store', 'readonly');
          const s = tx.objectStore('store');
          const getReq = s.get(key);
          getReq.onsuccess = () => { db.close(); resolve(getReq.result); };
          getReq.onerror = (e) => { db.close(); reject(e); };
        };
        req.onerror = (e) => reject(e);
      } catch (e) {
        reject(e);
      }
    });
  }
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    throw e;
  }
}

export default { idbPut, idbGet };

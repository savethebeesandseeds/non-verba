// SPDX-License-Identifier: AGPL-3.0-only
// The deployed origin database is shared by capture records and the browser vault.
// Keep its legacy name, version and stores so existing profiles retain their data.
let opened;
export function database() {
  return opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('nonverba-camera-v1', 2);
    request.onupgradeneeded = () => {
      for (const name of ['vault', 'requests', 'accepted', 'captures']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function read(store, key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function write(store, key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Storage transaction aborted'));
  });
}

export async function values(store) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

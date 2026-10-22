// SPDX-License-Identifier: AGPL-3.0-only
// Separate receipt database so audio records cannot enter the camera history.
const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('nonverba-audio-receipts-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('receipts');
  request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  request.onerror = () => reject(request.error);
});
export async function retainReceipt(receipt) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('receipts', 'readwrite');
    tx.objectStore('receipts').add(receipt, receipt.request.session_id);
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error('The original requester receipt could not be retained.'));
  });
}
export async function latestReceipt() {
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction('receipts').objectStore('receipts').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.transcript.completed_at - a.transcript.completed_at)[0] || null);
    request.onerror = () => reject(request.error);
  });
}

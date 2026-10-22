// SPDX-License-Identifier: AGPL-3.0-only
// Deliberate device-local retention, separate from transient camera images.
// Origin access remains the trust boundary; this is not a server account vault.
const DATABASE = 'nonverba-operator-face-references-v1';
const STORE = 'references';
const encoder = new TextEncoder(), decoder = new TextDecoder();
const binding = context => {
  if (!context?.account_id || !context?.principal_id) throw new Error('An Operator account and principal binding are required.');
  return JSON.stringify(['operator', context.account_id, context.principal_id]);
};
function validateReference(reference, context) {
  if (reference?.account_id !== context.account_id || reference?.principal_id !== context.principal_id
      || typeof reference.reference_id !== 'string' || !reference.reference_id
      || !reference.model || !Array.isArray(reference.embedding) || reference.embedding.length !== 128
      || !reference.embedding.every(value => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('The retained face reference is malformed or belongs to another account.');
  }
  return reference;
}
function summary(reference) {
  if (!reference) return null;
  const {reference_id, account_id, principal_id, enrolled_device_id, enrollment_operation_id,
    enrolled_at, model, simulation} = reference;
  return {reference_id, account_id, principal_id, enrolled_device_id, enrollment_operation_id,
    enrolled_at, model: structuredClone(model), simulation, storage: 'encrypted-device-local',
    identity_verified: false, enrollment_continuity_only: true};
}
export {summary as faceReferenceSummary};

export function createLocalFaceReferenceStore({indexedDB = globalThis.indexedDB,
  crypto = globalThis.crypto, nativeContext = () => !!globalThis.NativeVault} = {}) {
  let pendingDatabase;
  async function database() {
    if (nativeContext()) throw new Error('Local browser face retention is unavailable in the native developer app.');
    if (!indexedDB || !crypto?.subtle) throw new Error('Encrypted local face retention is unavailable in this browser.');
    pendingDatabase ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => reject(new Error('Local face reference storage could not open.'));
      request.onblocked = () => reject(new Error('Close another registration tab before upgrading the local face store.'));
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); pendingDatabase = null; };
        resolve(request.result);
      };
    });
    try { return await pendingDatabase; } catch (error) { pendingDatabase = null; throw error; }
  }
  async function row(context) {
    const key = binding(context), db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly'), request = transaction.objectStore(STORE).get(key);
      let value;
      request.onsuccess = () => { value = request.result ?? null; };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = transaction.onabort = () => reject(new Error('The local face reference could not be read.'));
    });
  }
  async function read(context) {
    const item = await row(context);
    if (!item) return null;
    try {
      const plaintext = await crypto.subtle.decrypt({name: 'AES-GCM', iv: item.iv,
        additionalData: encoder.encode(binding(context))}, item.key, item.ciphertext);
      try { return validateReference(JSON.parse(decoder.decode(plaintext)), context); }
      finally { new Uint8Array(plaintext).fill(0); }
    } catch { throw new Error('The retained reference is unreadable; deliberate replacement or deletion is required.'); }
  }
  async function mutate(context, update, {current = () => true, signal} = {}) {
    const key = binding(context), db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite'), store = transaction.objectStore(STORE);
      const request = store.get(key); let failure;
      const abort = () => { try { transaction.abort(); } catch {} };
      signal?.addEventListener('abort', abort, {once: true});
      request.onsuccess = () => {
        try {
          if (signal?.aborted || !current()) throw new Error('Reference retention was cancelled before completion.');
          update(store, key, request.result ?? null);
        }
        catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => { signal?.removeEventListener('abort', abort); resolve(true); };
      transaction.onerror = transaction.onabort = () => {
        signal?.removeEventListener('abort', abort);
        reject(failure || new Error('Local face reference storage failed or was cancelled.'));
      };
    });
  }
  async function write(reference, {replace = false, expectedReferenceId = null, consent = false,
    current = () => true, signal} = {}) {
    if (!consent) throw new Error('Deliberate consent to retaining this face reference is required.');
    const context = reference;
    validateReference(reference, context);
    await database();
    if (signal?.aborted || !current()) throw new Error('Reference retention was cancelled.');
    const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(JSON.stringify(reference));
    let ciphertext;
    try { ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv,
      additionalData: encoder.encode(binding(context))}, key, plaintext); }
    finally { plaintext.fill(0); }
    await mutate(context, (store, id, existing) => {
      if (existing && !replace) throw new Error('A reference is already enrolled; choose deliberate replacement.');
      if ((existing?.reference_id ?? null) !== expectedReferenceId) throw new Error('The enrolled reference changed. Review the current reference before replacing it.');
      store.put({reference_id: reference.reference_id, key, iv, ciphertext}, id);
    }, {current, signal});
    return summary(reference);
  }
  async function remove(context, {deliberate = false, expectedReferenceId = null} = {}) {
    if (!deliberate) throw new Error('Deliberate face reference deletion is required.');
    await mutate(context, (store, key, current) => {
      if ((current?.reference_id ?? null) !== expectedReferenceId)
        throw new Error('The enrolled reference changed; review it before deleting.');
      store.delete(key);
    });
    return true;
  }
  return {read, write, delete: remove, referenceId: async context => (await row(context))?.reference_id ?? null,
    summary: async context => summary(await read(context)),
    async close() { const db = await pendingDatabase?.catch(() => null); db?.close(); pendingDatabase = null; }};
}

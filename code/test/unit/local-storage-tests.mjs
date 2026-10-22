// SPDX-License-Identifier: AGPL-3.0-only
// Legacy origin records and real WebCrypto cross the new ownership boundaries.
// A transaction double keeps this independent of WASM and browser setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';

globalThis.crypto ??= webcrypto;
globalThis.window = {};
const identity = '{"fingerprint":"existing-browser-identity"}';
const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(identity));
const stores = new Map([
  ['vault', new Map([['wrapping-key', key], ['identity', {iv, ciphertext}]])],
  ['requests', new Map([['legacy-request', {id: 'legacy-request'}]])],
  ['accepted', new Map([['legacy-acceptance', {accepted_at: 100}]])],
]);
const opened = [], created = [];
const db = {
  objectStoreNames: {contains: name => stores.has(name)},
  createObjectStore(name) { created.push(name); stores.set(name, new Map()); },
  transaction(name, mode = 'readonly') {
    const working = structuredClone(stores.get(name));
    const transaction = {
      pending: 0, ended: false,
      abort() {
        if (this.ended) return;
        this.ended = true;
        setImmediate(() => this.onabort?.());
      },
      objectStore() {
        return {
          get: id => operation(() => structuredClone(working.get(id))),
          getAll: () => operation(() => [...working.values()].map(value => structuredClone(value))),
          put: (value, id) => operation(() => working.set(id, structuredClone(value))),
          add: (value, id) => operation(() => {
            if (working.has(id)) throw new Error('ConstraintError');
            working.set(id, structuredClone(value));
          }),
        };
      },
    };
    function operation(action) {
      const request = {};
      transaction.pending++;
      setImmediate(() => {
        if (transaction.ended) return;
        try { request.result = action(); request.onsuccess?.(); }
        catch (error) { transaction.error = error; request.error = error; request.onerror?.(); transaction.abort(); }
        finally {
          transaction.pending--;
          if (!transaction.pending && !transaction.ended) {
            transaction.ended = true;
            if (mode === 'readwrite') stores.set(name, working);
            transaction.oncomplete?.();
          }
        }
      });
      return request;
    }
    return transaction;
  },
};
globalThis.indexedDB = {open(name, version) {
  opened.push({name, version});
  const request = {result: db};
  setImmediate(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
  return request;
}};
const {read, write, values} = await import('../../../web/shared/runtime/database.js');
const {loadIdentity, saveIdentity} = await import('../../../web/shared/identity/identity-vault.js');
const {reserveCapture, acceptOnce, AcceptanceClockChanged} = await import('../../../web/shared/evidence/capture-storage.js');

test('the native identity vault does not open browser storage and propagates bridge failures', async () => {
  let failure = '', saved;
  window.NativeVault = {
    loadIdentity: () => identity,
    lastError: () => failure,
    saveIdentity: value => { saved = value; return !failure; },
  };
  try {
    assert.equal(await loadIdentity(), identity);
    await saveIdentity('native-update');
    assert.equal(saved, 'native-update');
    failure = 'Native vault locked';
    await assert.rejects(loadIdentity(), /Native vault locked/);
    await assert.rejects(saveIdentity('rejected'), /could not securely save/);
    assert.deepEqual(opened, []);
  } finally { delete window.NativeVault; }
});

test('the existing origin database upgrades only its missing store and preserves records and encrypted identity', async () => {
  assert.equal(await loadIdentity(), identity);
  assert.deepEqual(opened, [{name: 'nonverba-camera-v1', version: 2}]);
  assert.deepEqual(created, ['captures']);
  assert.deepEqual(await read('requests', 'legacy-request'), {id: 'legacy-request'});
  assert.deepEqual(await read('accepted', 'legacy-acceptance'), {accepted_at: 100});
  assert.equal(stores.get('vault').get('wrapping-key').extractable, false);
});

test('saving a browser identity reuses the existing wrapping key and request records', async () => {
  const before = await read('vault', 'wrapping-key');
  await saveIdentity('updated-browser-identity');
  assert.equal(await loadIdentity(), 'updated-browser-identity');
  const after = await read('vault', 'wrapping-key');
  const envelope = await read('vault', 'identity');
  assert.equal(new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: envelope.iv}, before, envelope.ciphertext)), 'updated-browser-identity');
  assert.equal(after.extractable, false);
  assert.deepEqual(await values('requests'), [{id: 'legacy-request'}]);
  await write('requests', 'new-request', {id: 'new-request'});
  assert.equal((await values('requests')).length, 2);
});

test('capture replay rejection retains the original reservation', async () => {
  await reserveCapture('capture-id', {source: 'original'});
  await assert.rejects(reserveCapture('capture-id', {source: 'replacement'}), /already used for a capture/);
  assert.deepEqual(await read('captures', 'capture-id'), {source: 'original'});
});

test('acceptance retains the verification clock, original window and current-input guards', async t => {
  const originalNow = Date.now;
  Date.now = () => 1800000000000;
  t.after(() => { Date.now = originalNow; });
  const original = {issuedAt: 1799999999, expiresAt: 1800000001, verifiedAt: 1800000000, isCurrent: () => true};
  const cases = [
    ['changed-input', {isCurrent: () => false}, /verification inputs changed/],
    ['expired', {expiresAt: 1800000000}, /request window closed/],
    ['not-yet-issued', {issuedAt: 1800000001, expiresAt: 1800000002}, /request window closed/],
    ['clock-changed', {verifiedAt: 1799999999}, AcceptanceClockChanged],
  ];
  for (const [id, patch, error] of cases) {
    await assert.rejects(acceptOnce(id, {source: 'synthetic'}, {...original, ...patch}), error);
    assert.equal(await read('accepted', id), undefined);
  }
  const accepted = await acceptOnce('accepted-id', {source: 'original'}, original);
  assert.deepEqual(accepted, {source: 'original', accepted_at: 1800000000});
  await assert.rejects(acceptOnce('accepted-id', {source: 'replacement'}, original), /already accepted/);
  assert.deepEqual(await read('accepted', 'accepted-id'), accepted);
});

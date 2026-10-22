// SPDX-License-Identifier: AGPL-3.0-only
// Origin-local possession keys. Browser storage is not hardware attestation.
const DATABASE = 'nonverba-device-attestation-v1', STORE = 'keys';
const PURPOSE = 'signin-device', LIMIT = 32, WAIT = 2000;
const CHECK = new TextEncoder().encode('NONVERBA:SIGNIN_DEVICE:KEY_PAIR:v1\n');
function failure(code = 'attestation_unavailable') {
  const error = new Error('The browser attestation key is unavailable.');
  error.code = code;
  if (code === 'attestation_cancelled') error.name = 'AbortError';
  return error;
}

export function createBrowserAttestationKeys(scope) {
  const crypto = scope.crypto, cache = new Map(), pending = new Set();
  const later = callback => (scope.setTimeout || globalThis.setTimeout).call(scope, callback, WAIT);
  const clear = timer => (scope.clearTimeout || globalThis.clearTimeout).call(scope, timer);
  let database = null, opening = null, memory = false, closed = false;
  function ensure(operation) {
    if (closed) throw failure('attestation_closed');
    operation.ensure();
  }
  function fallback() {
    memory = true;
    database?.close(); database = null;
  }
  function open(operation) {
    return new Promise((resolve, reject) => {
      let request, finished = false, unregister = () => {}, timer;
      function finish(error, value) {
        if (finished) return;
        finished = true; clear(timer); unregister(); pending.delete(stop);
        if (error) reject(error); else resolve(value);
      }
      function stop(error = failure('attestation_cancelled')) {
        try { request?.transaction?.abort(); } catch {}
        finish(error);
      }
      pending.add(stop);
      timer = later(() => finish(null, null));
      try {
        ensure(operation);
        unregister = operation.onCancel(() => stop());
        ensure(operation);
        if (finished) return;
        if (!scope.indexedDB?.open) { finish(null, null); return; }
        request = scope.indexedDB.open(DATABASE, 1);
        request.onblocked = () => finish(null, null);
        request.onerror = () => finish(null, null);
        request.onupgradeneeded = event => {
          try {
            ensure(operation);
            if (finished || memory || event.oldVersion !== 0) { request.transaction.abort(); return; }
            request.result.createObjectStore(STORE);
          } catch { try { request.transaction.abort(); } catch {} }
        };
        request.onsuccess = () => {
          const connection = request.result;
          if (finished || closed || memory) { connection.close(); finish(null, null); return; }
          try {
            ensure(operation);
            if (connection.objectStoreNames.length !== 1 || !connection.objectStoreNames.contains(STORE)) {
              throw failure('attestation_record_invalid');
            }
            connection.onversionchange = () => { connection.close(); fallback(); };
            finish(null, connection);
          } catch (error) { connection.close(); finish(error); }
        };
      } catch (error) {
        try { ensure(operation); } catch (cancelled) { finish(cancelled); return; }
        finish(null, null);
      }
    });
  }
  function transaction(connection, mode, operation, start) {
    return new Promise((resolve, reject) => {
      let tx, result, finished = false, unregister = () => {}, timer;
      function finish(error) {
        if (finished) return;
        finished = true; clear(timer); unregister(); pending.delete(stop);
        if (error) reject(error); else resolve(result);
      }
      function stop(error = failure('attestation_cancelled')) {
        try { tx?.abort(); } catch {}
        finish(error);
      }
      const guard = callback => () => {
        if (finished) return;
        try { ensure(operation); callback(); }
        catch (error) {
          try { ensure(operation); } catch (cancelled) { stop(cancelled); return; }
          stop(error?.code === 'attestation_record_invalid' ? error : failure());
        }
      };
      pending.add(stop); timer = later(() => stop(failure()));
      try {
        ensure(operation); unregister = operation.onCancel(() => stop()); ensure(operation);
        if (finished) return;
        tx = connection.transaction(STORE, mode);
        tx.oncomplete = guard(() => finish());
        tx.onerror = tx.onabort = () => finish(failure());
        const store = tx.objectStore(STORE);
        if (store.keyPath !== null || store.autoIncrement !== false) throw failure('attestation_record_invalid');
        start(store, value => { result = value; }, stop, guard);
      } catch (error) {
        try { ensure(operation); } catch (cancelled) { stop(cancelled); return; }
        stop(error?.code === 'attestation_record_invalid' ? error : failure());
      }
    });
  }
  async function ready(operation) {
    ensure(operation);
    if (memory) return null;
    if (database) return database;
    if (!opening) {
      const lease = {};
      const detach = () => { if (opening === lease) opening = null; };
      const unregister = operation.onCancel(detach);
      opening = lease;
      lease.promise = (async () => {
        const connection = await open(operation);
        try {
          ensure(operation);
          if (!connection || memory) { connection?.close(); fallback(); return null; }
          await transaction(connection, 'readonly', operation, (store, result, stop, guard) => {
            const count = store.count();
            count.onsuccess = guard(() => {
              if (!Number.isSafeInteger(count.result) || count.result < 0 || count.result > LIMIT) {
                stop(failure('attestation_record_invalid'));
              } else result(count.result);
            });
          });
          ensure(operation);
          if (memory) { connection.close(); return null; }
          database = connection; return connection;
        } catch (error) { connection?.close(); throw error; }
      })().finally(() => { unregister(); detach(); });
    }
    try { const result = await opening.promise; ensure(operation); return result; }
    catch (error) {
      ensure(operation);
      if (error?.code !== 'attestation_unavailable') throw error;
      fallback(); return null;
    }
  }
  function keyValid(key, type, usage, extractable) {
    return key?.type === type && key.extractable === extractable && key.algorithm?.name === 'ECDSA'
      && key.algorithm.namedCurve === 'P-256' && key.usages?.length === 1 && key.usages[0] === usage;
  }
  async function validate(row, account, operation) {
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 5
          || !['version', 'purpose', 'account_id', 'private_key', 'public_key'].every(key => Object.hasOwn(row, key))
          || row.version !== 1 || row.purpose !== PURPOSE || row.account_id !== account
          || !keyValid(row.private_key, 'private', 'sign', false)
          || !keyValid(row.public_key, 'public', 'verify', true)) throw failure('attestation_record_invalid');
      ensure(operation);
      const signature = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, row.private_key, CHECK);
      ensure(operation);
      const valid = await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, row.public_key, signature, CHECK);
      ensure(operation);
      if (!valid) throw failure('attestation_record_invalid');
      return {privateKey: row.private_key, publicKey: row.public_key};
    } catch { ensure(operation); throw failure('attestation_record_invalid'); }
  }
  async function generate(operation) {
    try {
      const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify']);
      ensure(operation); return pair;
    } catch { ensure(operation); throw failure(); }
  }
  function remember(account, pair, operation) {
    ensure(operation);
    if (!cache.has(account) && cache.size >= LIMIT) throw failure('attestation_store_full');
    if (!cache.has(account)) cache.set(account, pair);
    return cache.get(account);
  }
  return Object.freeze({
    async capabilities(operation) {
      return await ready(operation) ? 'origin-indexeddb' : 'document-memory';
    },
    async get(challenge, operation) {
      ensure(operation);
      const account = challenge?.account_id;
      if (typeof account !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(account)) throw failure('attestation_invalid');
      if (cache.has(account)) return cache.get(account);
      if (cache.size >= LIMIT) throw failure('attestation_store_full');
      const key = PURPOSE + ':' + account, connection = await ready(operation);
      let candidate;
      if (connection) {
        try {
          let row = await transaction(connection, 'readonly', operation, (store, result, stop, guard) => {
            const request = store.get(key); request.onsuccess = guard(() => result(request.result));
          });
          if (row === undefined) {
            candidate = await generate(operation);
            const fresh = {version: 1, purpose: PURPOSE, account_id: account,
              private_key: candidate.privateKey, public_key: candidate.publicKey};
            row = await transaction(connection, 'readwrite', operation, (store, result, stop, guard) => {
              const request = store.get(key);
              request.onsuccess = guard(() => {
                if (request.result !== undefined) { result(request.result); return; }
                const count = store.count();
                count.onsuccess = guard(() => {
                  if (count.result >= LIMIT) { stop(failure('attestation_store_full')); return; }
                  const added = store.add(fresh, key); added.onsuccess = guard(() => result(fresh));
                });
              });
            });
          }
          return remember(account, await validate(row, account, operation), operation);
        } catch (error) {
          ensure(operation);
          if (error?.code !== 'attestation_unavailable') throw error;
          fallback();
        }
      }
      return remember(account, candidate || await generate(operation), operation);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const stop of [...pending]) stop(failure('attestation_closed'));
      database?.close(); database = null; cache.clear();
    }
  });
}

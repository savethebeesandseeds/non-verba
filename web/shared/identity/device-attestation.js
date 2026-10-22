// SPDX-License-Identifier: AGPL-3.0-only
// Reusable platform tool. Account transport and verifier policy belong to callers.
// The first supported profile signs only NONVERBA:SIGNIN_DEVICE:v1 challenges.
import {createBrowserAttestationKeys} from './browser-attestation-keys.js';

const PURPOSE = 'signin-device';
const FIELDS = ['challenge_id', 'account_id', 'current_session_id', 'recovery_generation',
  'platform', 'issued_at', 'expires_at', 'challenge_b64'];
const MAX_RESPONSE = 192 * 1024;
const owners = new WeakMap();
const messages = Object.freeze({
  attestation_invalid: 'The attestation request is invalid.',
  attestation_invalid_response: 'The attestation tool returned an invalid result.',
  attestation_busy: 'An attestation operation is already running.',
  attestation_unavailable: 'The attestation tool is unavailable.',
  attestation_cancelled: 'The attestation operation was cancelled.',
  attestation_timeout: 'The attestation operation exceeded its time limit.',
  attestation_closed: 'The attestation tool is closed.',
  attestation_store_full: 'The attestation key store is full.',
  attestation_record_invalid: 'The retained attestation key record is unavailable or inconsistent.'
});
const legacyCodes = Object.freeze({login_device_invalid: 'attestation_invalid',
  login_device_busy: 'attestation_busy', login_device_unavailable: 'attestation_unavailable'});

function failure(code) {
  const error = new Error(messages[code] || messages.attestation_unavailable);
  error.code = Object.hasOwn(messages, code) ? code : 'attestation_unavailable';
  if (code === 'attestation_cancelled') error.name = 'AbortError';
  return error;
}
function only(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every(key => fields.includes(key));
}
function encode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
function decode(value, maximum, exact) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maximum / 3) * 4
      || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw failure('attestation_invalid');
  let bytes;
  try { bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
  catch { throw failure('attestation_invalid'); }
  if (!bytes.length || bytes.length > maximum || (exact !== undefined && bytes.length !== exact)
      || encode(bytes) !== value) throw failure('attestation_invalid');
  return bytes;
}
function label(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 80
    && value.trim() === value && !/[\p{Cc}\p{Cf}]/u.test(value);
}
function challengeSnapshot(value, platform, now) {
  if (!only(value, FIELDS)) throw failure('attestation_invalid');
  const result = Object.fromEntries(FIELDS.map(key => [key, value[key]]));
  const identifier = /^[A-Za-z0-9._:-]{1,128}$/;
  if (typeof result.account_id !== 'string' || !identifier.test(result.account_id)
      || typeof result.current_session_id !== 'string' || !identifier.test(result.current_session_id)
      || result.platform !== platform || !Number.isSafeInteger(result.recovery_generation) || result.recovery_generation < 0
      || !Number.isSafeInteger(result.issued_at) || result.issued_at < 0
      || !Number.isSafeInteger(result.expires_at) || result.expires_at <= result.issued_at
      || result.expires_at - result.issued_at > 120 || result.issued_at > now + 30
      || result.expires_at <= now || now - result.issued_at > 120
      || typeof result.challenge_id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.challenge_id)) {
    throw failure('attestation_invalid');
  }
  const id = decode(result.challenge_id.replaceAll('-', '+').replaceAll('_', '/') + '=', 32, 32);
  if (encode(id).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') !== result.challenge_id) throw failure('attestation_invalid');
  decode(result.challenge_b64, 32, 32);
  return Object.freeze(result);
}
function transcript(challenge) {
  return new TextEncoder().encode('NONVERBA:SIGNIN_DEVICE:v1\n' + FIELDS.map(key => challenge[key]).join('\n') + '\n');
}
function proofSnapshot(value, platform) {
  try {
    if (!only(value, ['public_spki_der_b64', 'signature_b64', 'attestation_chain', 'platform', 'name'])
        || value.platform !== platform || !label(value.name)) throw failure('attestation_invalid');
    decode(value.public_spki_der_b64, 128);
    decode(value.signature_b64, 64, 64);
    let chain = null;
    if (value.attestation_chain !== null) {
      const input = value.attestation_chain;
      if (platform !== 'android' || !only(input, ['version', 'certificates_der_b64']) || input.version !== 1
          || !Array.isArray(input.certificates_der_b64) || input.certificates_der_b64.length < 2
          || input.certificates_der_b64.length > 8
          || new Set(input.certificates_der_b64).size !== input.certificates_der_b64.length) throw failure('attestation_invalid');
      let total = 0;
      const certificates = input.certificates_der_b64.map(encoded => {
        total += decode(encoded, 32 * 1024).length;
        return encoded;
      });
      if (total > 96 * 1024) throw failure('attestation_invalid');
      chain = Object.freeze({version: 1, certificates_der_b64: Object.freeze(certificates)});
    }
    return Object.freeze({public_spki_der_b64: value.public_spki_der_b64, signature_b64: value.signature_b64,
      attestation_chain: chain, platform, name: value.name});
  } catch { throw failure('attestation_invalid_response'); }
}

export function createDeviceAttestationTool({scope = globalThis} = {}) {
  const bridge = scope.NonverbaLoginDevice;
  const native = bridge && typeof bridge.postMessage === 'function' ? bridge : null;
  const platform = native ? 'android' : 'browser';
  const name = native ? 'Android device' : 'Browser session';
  const browserKeys = native ? null : createBrowserAttestationKeys(scope);
  const crypto = scope.crypto;
  const later = (callback, delay) => (scope.setTimeout || globalThis.setTimeout).call(scope, callback, delay);
  const clear = timer => (scope.clearTimeout || globalThis.clearTimeout).call(scope, timer);
  const now = () => Math.floor((scope.Date || Date).now() / 1000);
  let active = null, closed = false;
  const previous = native?.onmessage;
  if (native && owners.has(native)) throw failure('attestation_busy');

  function requireOpen() {
    if (closed) throw failure('attestation_closed');
    if (!crypto?.randomUUID || !crypto?.subtle) throw failure('attestation_unavailable');
  }
  function cancelNative(operation) {
    if (native && operation.sent && !operation.cancellationSent) {
      operation.cancellationSent = true;
      try { native.postMessage(JSON.stringify({id: crypto.randomUUID(), cancel: operation.id})); } catch {}
    }
  }
  function revoke(operation, code) {
    if (operation.finished) return;
    operation.finish(failure(code));
  }
  function run(kind, signal, task) {
    try {
      requireOpen();
      if (signal && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function'
          || typeof signal.removeEventListener !== 'function')) throw failure('attestation_invalid');
      if (signal?.aborted) throw failure('attestation_cancelled');
      if (active) throw failure('attestation_busy');
    } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const operation = {id: crypto.randomUUID(), kind, sent: false, finished: false};
      const cancellations = new Set();
      active = operation;
      const abort = () => revoke(operation, 'attestation_cancelled');
      const timer = later(() => revoke(operation, 'attestation_timeout'), 30000);
      operation.ensure = () => {
        if (operation.finished || active !== operation || closed || signal?.aborted) throw failure('attestation_cancelled');
      };
      operation.onCancel = callback => {
        operation.ensure();
        cancellations.add(callback);
        return () => cancellations.delete(callback);
      };
      operation.finish = (error, value) => {
        if (operation.finished) return;
        operation.finished = true;
        clear(timer); signal?.removeEventListener('abort', abort);
        if (active === operation) active = null;
        if (error) {
          for (const cancel of cancellations) { try { cancel(); } catch {} }
          cancelNative(operation); operation.rejectNative?.(error); reject(error);
        } else resolve(value);
        cancellations.clear();
      };
      signal?.addEventListener('abort', abort, {once: true});
      Promise.resolve().then(() => { operation.ensure(); return task(operation); })
        .then(value => operation.finish(null, value), error => operation.finish(
          error?.code && Object.hasOwn(messages, error.code) ? error : failure('attestation_unavailable')));
    });
  }
  function send(operation, value) {
    return new Promise((resolve, reject) => {
      operation.resolveNative = resolve; operation.rejectNative = reject;
      operation.ensure();
      operation.sent = true;
      try { native.postMessage(JSON.stringify({id: operation.id, ...value})); }
      catch { reject(failure('attestation_unavailable')); }
    });
  }
  const receive = event => {
    if (!active || active.finished || !active.sent) return;
    if (typeof event?.data !== 'string' || event.data.length > MAX_RESPONSE
        || new TextEncoder().encode(event.data).length > MAX_RESPONSE) {
      active.rejectNative?.(failure('attestation_invalid_response')); return;
    }
    let value;
    try { value = JSON.parse(event.data); } catch { active.rejectNative?.(failure('attestation_invalid_response')); return; }
    if (!value || value.id !== active.id) return;
    if (Object.hasOwn(value, 'error')) {
      if (!only(value, ['id', 'error']) || typeof value.error !== 'string') {
        active.rejectNative?.(failure('attestation_invalid_response')); return;
      }
      const code = Object.hasOwn(legacyCodes, value.error) ? legacyCodes[value.error] : value.error;
      active.rejectNative?.(failure(Object.hasOwn(messages, code) ? code : 'attestation_unavailable'));
    } else if (!only(value, ['id', active.kind === 'capabilities' ? 'capabilities' : 'proof'])) {
      active.rejectNative?.(failure('attestation_invalid_response'));
    } else active.resolveNative?.(value);
  };
  if (native) { owners.set(native, receive); native.onmessage = receive; }

  function close() {
    if (closed) return;
    closed = true;
    if (active) revoke(active, 'attestation_cancelled');
    browserKeys?.close();
    scope.removeEventListener?.('pagehide', close);
    if (native && owners.get(native) === receive) {
      owners.delete(native);
      if (native.onmessage === receive) native.onmessage = previous;
    }
  }
  scope.addEventListener?.('pagehide', close, {once: true});
  function capabilities({signal} = {}) {
    return run('capabilities', signal, async operation => {
      let actualName = name;
      if (native) {
        const result = (await send(operation, {config: true})).capabilities;
        operation.ensure();
        if (!only(result, ['available', 'platform', 'version', 'name']) || result.available !== true
            || result.platform !== 'android' || result.version !== 1 || !label(result.name)) throw failure('attestation_invalid_response');
        actualName = result.name;
      }
      const storage = native ? 'android-keystore' : await browserKeys.capabilities(operation);
      operation.ensure();
      return Object.freeze({version: 1, purpose: PURPOSE, available: true, platform, name: actualName,
        key_storage: storage,
        hardware_attestation: native ? 'unverified' : 'unsupported'});
    });
  }
  return Object.freeze({
    version: 1, purpose: PURPOSE, platform, name, capabilities,
    async describe(options) {
      const result = await capabilities(options);
      return Object.freeze({platform: result.platform, name: result.name});
    },
    prove(challenge, {signal} = {}) {
      // Freeze caller-controlled fields before yielding to WebCrypto or transport.
      let original;
      try { requireOpen(); original = challengeSnapshot(challenge, platform, now()); }
      catch (error) { return Promise.reject(error); }
      return run('prove', signal, async operation => {
        if (native) {
          const result = (await send(operation, {challenge: original})).proof;
          operation.ensure(); challengeSnapshot(original, platform, now());
          return proofSnapshot(result, platform);
        }
        const pair = await browserKeys.get(original, {
          ensure() { operation.ensure(); challengeSnapshot(original, platform, now()); },
          onCancel: operation.onCancel
        });
        operation.ensure(); challengeSnapshot(original, platform, now());
        const signature = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, pair.privateKey, transcript(original));
        operation.ensure(); challengeSnapshot(original, platform, now());
        const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
        operation.ensure(); challengeSnapshot(original, platform, now());
        return proofSnapshot({public_spki_der_b64: encode(spki), signature_b64: encode(signature),
          attestation_chain: null, platform: 'browser', name}, platform);
      });
    },
    // Cancellation fences this operation's result; it is not observed Keystore shutdown.
    cancel() { if (active) revoke(active, 'attestation_cancelled'); },
    close,
    status() { return Object.freeze({version: 1, purpose: PURPOSE, state: closed ? 'closed' : active ? 'running' : 'idle'}); }
  });
}

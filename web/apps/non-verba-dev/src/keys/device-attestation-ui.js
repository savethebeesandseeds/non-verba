// SPDX-License-Identifier: AGPL-3.0-only
import {createDeviceAttestationTool} from '../../../../shared/identity/device-attestation.js';

const json = value => JSON.stringify(value, null, 2);
const now = () => Math.floor(Date.now() / 1000);
function issue(message) { return new Error(message); }
function nonce(value) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw issue('The request token contains an invalid random value.');
  let binary;
  try { binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='); }
  catch { throw issue('The request token contains an invalid random value.'); }
  const encoded = btoa(binary);
  if (binary.length !== 32 || encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') !== value)
    throw issue('The request token contains a noncanonical random value.');
  return encoded;
}

export function parseDeveloperAttestationToken(token, {platform, nowSeconds = now()} = {}) {
  if (typeof token !== 'string' || token.length > 200 || !['android', 'browser'].includes(platform)
      || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw issue('Enter a complete host-issued NVAT1 request token.');
  const parts = /^NVAT1\.([0-9a-f]{32})\.([1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!parts) throw issue('Enter a complete host-issued NVAT1 request token.');
  const [, scope, time, id, random] = parts, issued = Number(time);
  if (!Number.isSafeInteger(issued) || issued > Number.MAX_SAFE_INTEGER - 120
      || issued > nowSeconds + 30 || issued + 120 <= nowSeconds || nowSeconds - issued > 120)
    throw issue('The host request has expired or its time does not match this device. Obtain a fresh host request.');
  nonce(id);
  const challengeB64 = nonce(random);
  return Object.freeze({challenge_id: id, account_id: 'dev-tool:attestation:' + scope,
    current_session_id: 'dev-tool-session:' + id, recovery_generation: 0, platform,
    issued_at: issued, expires_at: issued + 120, challenge_b64: challengeB64});
}

export function createDeveloperAttestationSession(tool, {clock = now, onChange = () => {}} = {}) {
  let request = null, proof = null, busy = false, controller = null, epoch = 0;
  let message = 'Load a host-issued request. No key has been requested.';
  const snapshot = () => Object.freeze({request, proof, busy, message, platform: tool.platform});
  const publish = () => onChange(snapshot());
  function cancel() {
    if (!busy) return;
    epoch++; controller?.abort(); tool.cancel(); controller = null; busy = false; proof = null;
    message = 'Proof cancelled. Any generated key remains preserved; hardware shutdown is unconfirmed.'; publish();
  }
  function reset() {
    cancel(); epoch++; request = null; proof = null;
    message = 'Load a host-issued request. No proof is selected.'; publish();
  }
  return Object.freeze({
    snapshot, cancel, reset,
    load(token) {
      if (busy) throw issue('Cancel the current operation before loading another request.');
      epoch++; request = null; proof = null;
      try {
        request = parseDeveloperAttestationToken(token, {platform: tool.platform, nowSeconds: clock()});
        message = 'Request loaded. Save the original before requesting a proof.'; publish(); return request;
      } catch (error) { message = error.message; publish(); throw error; }
    },
    async prove() {
      if (tool.platform !== 'android') throw issue('Native proof collection requires the developer Android app.');
      if (!request) throw issue('Load a host-issued request first.');
      if (busy) throw issue('A proof operation is already running.');
      const original = request, revision = ++epoch, operation = new AbortController();
      controller = operation; busy = true; proof = null;
      message = 'Proving the separate test key. Keep this page in the foreground.'; publish();
      try {
        const result = await tool.prove(original, {signal: operation.signal});
        if (revision !== epoch || operation.signal.aborted) return null;
        proof = Object.freeze({type: 'nonverba-device-attestation-proof', version: 1, purpose: 'signin-device',
          request: original, proof: result, hardware_attested: false});
        message = 'Public proof ready. Hardware attestation remains unverified; save the proof for independent verification.';
        return proof;
      } catch (error) {
        if (revision === epoch) message = error.name === 'AbortError'
          ? 'Proof cancelled. Any generated key remains preserved.'
          : 'Proof unavailable (' + (typeof error.code === 'string' && /^attestation_[a-z_]{1,40}$/.test(error.code) ? error.code : 'attestation_unavailable') + '). Existing keys are preserved.';
        if (revision === epoch) throw error;
        return null;
      } finally {
        if (revision === epoch) { controller = null; busy = false; publish(); }
      }
    }
  });
}

export function createDeveloperAttestationLifecycle({createTool = createDeviceAttestationTool} = {}) {
  let current = createTool();
  const tool = Object.freeze({
    get platform() { return current.platform; },
    capabilities: options => current.capabilities(options),
    prove: (request, options) => current.prove(request, options),
    cancel: () => current.cancel(),
    status: () => current.status()
  });
  return Object.freeze({tool, close: () => current.close(), restore() {
    if (current.status().state !== 'closed') return false;
    current = createTool(); return true;
  }});
}

function encode(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(binary);
}
export async function saveDeveloperAttestationRecord(kind, value, scope = globalThis) {
  if (!['request', 'proof'].includes(kind)) throw issue('Choose a request or proof export.');
  const name = 'nonverba-device-attestation-' + kind + '-' + scope.crypto.randomUUID() + '.json';
  const text = json(value), bytes = new TextEncoder().encode(text);
  if (bytes.length > (kind === 'request' ? 4096 : 192 * 1024)) throw issue('This public record exceeds its export limit.');
  if (scope.NativeVault) {
    if (!scope.NativeVault.saveArtifact(name, 'application/json', encode(bytes))) throw issue('Android could not save this public record.');
  } else {
    const url = URL.createObjectURL(new Blob([text], {type: 'application/json'})), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

export function mountDeveloperAttestation(document = globalThis.document) {
  const $ = id => document.getElementById(id), lifecycle = createDeveloperAttestationLifecycle(), tool = lifecycle.tool;
  let nativeReady = false, summaryEpoch = 0, capabilityEpoch = 0;
  const session = createDeveloperAttestationSession(tool, {onChange: render});
  function render(state = session.snapshot()) {
    const revision = ++summaryEpoch;
    $('attestation-status').textContent = state.message;
    $('attestation-load-request').disabled = state.busy;
    $('attestation-prove').disabled = !nativeReady || !state.request || state.busy;
    $('attestation-cancel').disabled = !state.busy;
    $('attestation-save-request').disabled = !state.request || state.busy;
    $('attestation-save-proof').disabled = !state.proof || state.busy;
    $('attestation-request-record').textContent = state.request ? json(state.request) : 'No request loaded.';
    $('attestation-public-pin').textContent = state.proof ? 'Computing public key pin…' : 'No proof collected.';
    $('attestation-chain-count').textContent = state.proof
      ? 'Certificate chain: ' + (state.proof.proof.attestation_chain?.certificates_der_b64.length || 0) + ' certificates (unverified).'
      : 'Certificate chain: no proof collected.';
    if (state.proof) {
      const bytes = Uint8Array.from(atob(state.proof.proof.public_spki_der_b64), value => value.charCodeAt(0));
      crypto.subtle.digest('SHA-256', bytes).then(hash => {
        if (revision === summaryEpoch) $('attestation-public-pin').textContent = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
      }, () => { if (revision === summaryEpoch) $('attestation-public-pin').textContent = 'Public key pin unavailable. Preserve the exact exported proof.'; });
    }
  }
  function action(id, callback) {
    $(id).addEventListener('click', async () => {
      if ($(id).disabled) return;
      try { await callback(); }
      catch (error) { $('attestation-status').textContent = error?.message || 'The tool operation failed.'; }
    });
  }
  action('attestation-load-request', () => session.load($('attestation-request-token').value));
  action('attestation-prove', () => session.prove());
  action('attestation-cancel', () => session.cancel());
  action('attestation-save-request', async () => {
    const request = session.snapshot().request;
    if (!request) return;
    await saveDeveloperAttestationRecord('request', request); $('attestation-status').textContent = 'Original request saved. Keep the independently retained host original.';
  });
  action('attestation-save-proof', async () => {
    const proof = session.snapshot().proof;
    if (!proof) return;
    await saveDeveloperAttestationRecord('proof', proof); $('attestation-status').textContent = 'Public proof saved. Independent verification is still required.';
  });
  $('attestation-request-token').addEventListener('input', () => session.reset());
  document.addEventListener('visibilitychange', () => { if (document.hidden) session.cancel(); });
  globalThis.addEventListener('nonverba:pause', () => session.cancel());
  globalThis.addEventListener('pagehide', () => {
    capabilityEpoch++; nativeReady = false; session.cancel(); lifecycle.close(); render();
  });
  globalThis.addEventListener('pageshow', () => { if (lifecycle.restore()) discoverCapabilities(); });
  function discoverCapabilities() {
    const revision = ++capabilityEpoch;
    nativeReady = false;
    tool.capabilities().then(capabilities => {
      if (revision !== capabilityEpoch) return;
      nativeReady = capabilities.platform === 'android' && capabilities.available === true;
      $('attestation-platform').textContent = nativeReady ? 'ANDROID TOOL · UNVERIFIED' : 'BROWSER · NATIVE PROOF UNAVAILABLE';
      render();
    }, () => {
      if (revision !== capabilityEpoch) return;
      $('attestation-platform').textContent = 'NATIVE TOOL UNAVAILABLE'; render();
      $('attestation-status').textContent = 'Native tool unavailable. Loading a request creates no key; native proving requires the developer Android app.';
    });
  }
  discoverCapabilities();
  render();
  return session;
}

if (globalThis.document?.getElementById('attestation-request-token')) mountDeveloperAttestation();

// SPDX-License-Identifier: AGPL-3.0-only
import {bytesToBase64, base64ToBytes} from '../runtime/base64.js';
import {nativeLocationProgress} from './location-diagnostics.js';

// Platform transport only. NativeLocation owns native observations and signing;
// JavaScript never converts a browser trace into a native trace.
// Matches the Rust bounded COSE envelope (2 MiB payload + framing allowance).
export const MAX_LOCATION_PROOF = 2 * 1024 * 1024 + 16 * 1024;
export const MAX_LOCATION_MEDIA = 32 * 1024 * 1024;
const PIN = /^[0-9a-f]{64}$/;

export function checkLocationActive(signal) {
  if (signal?.aborted) throw new DOMException('Location collection cancelled.', 'AbortError');
}

export function locationPlatform() {
  const bridge = globalThis.NativeLocation;
  if (!bridge) return {profile: 'software-browser', native: false};
  // A present but failed bridge must never silently downgrade to browser GPS.
  const capabilities = nativeJson(bridge.capabilities());
  if (capabilities.available !== true || capabilities.version !== 1 || !PIN.test(capabilities.key_fingerprint)) {
    throw new Error('Native location collection is unavailable. Restart the Android app and retry.');
  }
  return {profile: 'native-android', native: true, bridge, capabilities};
}

export async function getLocationIdentity({engine, identity}) {
  const platform = locationPlatform();
  if (platform.native) {
    const publicKey = platform.capabilities.public_spki_der_b64 ?? platform.capabilities.public_key_spki_b64;
    if (typeof publicKey !== 'string' || !publicKey) throw new Error('The native location public key is unavailable.');
    return {fingerprint: platform.capabilities.key_fingerprint, public_spki_der_b64: publicKey, profile: platform.profile};
  }
  if (typeof identity !== 'string' || !identity) throw new Error('The browser location identity is unavailable.');
  return engine.json('location_identity', identity);
}

function nativeJson(text) {
  if (typeof text !== 'string' || text.length > MAX_LOCATION_PROOF * 2) throw new Error('Invalid native location response.');
  const result = JSON.parse(text);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid native location response.');
  return result;
}

function nativeCall(platform, method, ...args) {
  if (typeof platform.bridge[method] !== 'function') throw new Error('The native location bridge is incomplete.');
  return nativeJson(platform.bridge[method](...args));
}

export function cancelNativeCollection(collection) {
  if (!collection?.platform?.native || !collection.sessionId) return;
  try { nativeCall(collection.platform, 'cancel', collection.sessionId); } catch { /* Preserve the original failure. */ }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(new DOMException('Location collection cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) cancel();
  });
}

async function poll(collection, desired, {signal, onProgress}, limit) {
  const start = performance.now();
  while (true) {
    checkLocationActive(signal);
    const result = nativeCall(collection.platform, 'status', collection.sessionId);
    if (result.session_id !== collection.sessionId) throw new Error('The native location session changed.');
    // Preserve the terminal snapshot before propagating its failure to callers.
    onProgress?.(nativeLocationProgress(result));
    if (result.ok === false || ['error', 'cancelled'].includes(result.state)) {
      throw new Error(result.error || 'Native location collection stopped. Retry with a fresh request.');
    }
    if (result.state === desired) return result;
    if (!['requesting-permission', 'collecting', 'ready', 'finalizing'].includes(result.state)) throw new Error('Unexpected native location session state.');
    if (performance.now() - start > limit) throw new Error('Native location collection timed out.');
    await delay(250, signal);
  }
}

export async function beginNativeCollection({platform, request, signal, onProgress, cameraSelection}) {
  checkLocationActive(signal);
  const result = nativeCall(platform, 'begin', JSON.stringify(request));
  if (typeof result.session_id !== 'string' || !result.session_id) throw new Error(result.error || 'Native location collection could not start.');
  const collection = {platform, request, sessionId: result.session_id};
  const abort = () => cancelNativeCollection(collection);
  signal?.addEventListener('abort', abort, {once: true});
  try {
    checkLocationActive(signal);
    onProgress?.(nativeLocationProgress(result));
    if (result.ok === false) throw new Error(result.error || 'Native location collection could not start.');
    if(cameraSelection){
      if(typeof platform.bridge.selectForCamera!=='function') throw new Error('This Android build does not support concurrent camera location.');
      cameraSelection.select=async()=>{
        const started=performance.now();
        while(true){
          checkLocationActive(signal);
          const selected=nativeCall(platform,'selectForCamera',collection.sessionId);
          if(selected.session_id!==collection.sessionId) throw new Error('The native location session changed.');
          if(selected.ok===true && selected.selected){
            if(!Number.isFinite(selected.selected.latitude)||!Number.isFinite(selected.selected.longitude)||!Number.isSafeInteger(selected.selected.timestamp_ms)) throw new Error('Native camera selection is invalid.');
            cameraSelection.selected=Object.freeze({...selected.selected});return cameraSelection.selected;
          }
          if(selected.retryable!==true) throw new Error(selected.error||'Native camera location selection failed.');
          if(performance.now()-started>65000) throw new Error('No fresh location fix became available.');
          await delay(250,signal);
        }
      };
      cameraSelection.onStart();
    }
    const ready = await poll(collection, 'ready', {signal, onProgress}, 65000);
    checkLocationActive(signal);
    if (!ready.selected || !Number.isFinite(ready.selected.latitude) || !Number.isFinite(ready.selected.longitude)) throw new Error('Native collection returned no selected location.');
    return {...collection, selected: Object.freeze({...ready.selected})};
  } catch (error) { cancelNativeCollection(collection); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}

export async function finalizeNativeCollection(collection, {mediaBytes, signal, onProgress}) {
  checkLocationActive(signal);
  const abort = () => cancelNativeCollection(collection);
  signal?.addEventListener('abort', abort, {once: true});
  try {
    const media = mediaBytes == null ? '' : bytesToBase64(mediaBytes, MAX_LOCATION_MEDIA);
    checkLocationActive(signal);
    const starting = nativeCall(collection.platform, 'finalize', collection.sessionId, media);
    if (starting.session_id === collection.sessionId) onProgress?.(nativeLocationProgress(starting));
    if (starting.ok === false) throw new Error(starting.error || 'Native location signing failed.');
    const completed = await poll(collection, 'complete', {signal, onProgress}, 15000);
    checkLocationActive(signal);
    return base64ToBytes(completed.result?.proof_base64, MAX_LOCATION_PROOF);
  } catch (error) { cancelNativeCollection(collection); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}

export function locationProofEnvelope(bytes) {
  return {version: 1, type: 'nonverba-location-proof', proof_base64: bytesToBase64(bytes, MAX_LOCATION_PROOF)};
}

export function readLocationProofEnvelope(text) {
  if (typeof text !== 'string' || text.length > MAX_LOCATION_PROOF * 2) throw new Error('The location proof is too large.');
  const envelope = JSON.parse(text);
  if (envelope?.version !== 1 || envelope.type !== 'nonverba-location-proof') throw new Error('Choose a signed Non-verba location proof.');
  return base64ToBytes(envelope.proof_base64, MAX_LOCATION_PROOF);
}


// SPDX-License-Identifier: AGPL-3.0-only
// One manual-shutter handoff. The session retains the signed requester wrapper;
// this adapter retains the exact challenge/request and independently selected keys.
import {MAX_LOCATION_MEDIA, MAX_LOCATION_PROOF} from './location-platform.js';

// JSON object ordering is not authority; every field and array element is.
export function sameCaptureRequest(left, right) {
  const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
  return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
}
const validBytes = (bytes, maximum) => bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= maximum;
export class CameraCaptureHandoff {
  #pending;
  constructor({prepare, stop, lock}) { Object.assign(this, {prepare, stop, lock}); }
  get pending() { return !!this.#pending; }
  collect(spec) {
    if (this.#pending) return Promise.reject(new Error('A live camera capture is already pending.'));
    if (spec.signal.aborted) return Promise.reject(new Error('Live camera capture cancelled.'));
    const locationRequest = spec.locationRequest ?? null, operatorLocationPin = spec.operatorLocationPin ?? null;
    if (locationRequest ? locationRequest.context?.purpose !== 'camera'
        || !sameCaptureRequest(locationRequest.challenge, spec.challenge) || !/^[a-f0-9]{64}$/.test(operatorLocationPin ?? '')
        : operatorLocationPin !== null) return Promise.reject(new Error('The live camera location request or signing identity is incomplete.'));
    const retained = structuredClone({challenge:spec.challenge, policy:spec.policy, operatorPin:spec.operatorPin,
      locationRequest, operatorLocationPin});
    return new Promise((resolve, reject) => {
      const state = {retained, signal:spec.signal, resolve, reject, ready:false};
      state.abort = () => this.fail(new Error('Live camera capture cancelled.'));
      this.#pending = state; spec.signal.addEventListener('abort', state.abort, {once:true}); this.lock(true);
      Promise.resolve().then(() => {
        if (this.#pending !== state || spec.signal.aborted) throw new Error('Live camera capture cancelled.');
        return this.prepare({...structuredClone(retained), signal:spec.signal});
      }).then(() => { if (this.#pending === state && !spec.signal.aborted) state.ready = true; })
        .catch(error => { if (this.#pending === state) this.fail(error); });
    });
  }
  complete({bytes, challenge, fingerprint, locationProof, locationFingerprint, locationRequest}) {
    const state = this.#pending;
    if (!state) return false;
    const composed = state.retained.locationRequest !== null;
    const locationMatches = composed
      ? validBytes(locationProof, MAX_LOCATION_PROOF) && locationFingerprint === state.retained.operatorLocationPin
        && sameCaptureRequest(locationRequest, state.retained.locationRequest)
      : locationProof == null && locationFingerprint == null && locationRequest == null;
    if (!state.ready || state.signal.aborted || !locationMatches || fingerprint !== state.retained.operatorPin
        || !sameCaptureRequest(challenge, state.retained.challenge) || !validBytes(bytes, MAX_LOCATION_MEDIA)) {
      this.fail(new Error('The live camera challenge or signing identity changed.')); return false;
    }
    const result = {bytes:new Uint8Array(bytes), fingerprint};
    if (composed) Object.assign(result, {locationProof:new Uint8Array(locationProof), locationFingerprint,
      locationRequest:structuredClone(state.retained.locationRequest)});
    this.#clear(state); state.resolve(result); return true;
  }
  #clear(state) { this.#pending = null; state.signal.removeEventListener('abort', state.abort); this.lock(false); }
  fail(error) {
    const state = this.#pending; if (!state) return;
    this.#clear(state); this.stop(); state.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

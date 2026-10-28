// SPDX-License-Identifier: AGPL-3.0-only
// Identity-only capture. No evidence/location workflow or arbitrary native signer.
import {createEnrollmentCamera,prepareEnrollmentImage,ENROLLMENT_PHOTO_MAX_BYTES} from './enrollment-camera.js';
import {inspectIdentityImage} from './identity-capture.js';
import {identityCaptureBase64,identityCaptureBytes,identityCaptureKey,
  snapshotIdentityCaptureRequest,canonicalIdentityCapturePayload,verifyIdentityCaptureProof,
  IDENTITY_CAPTURE_PROOF_MAX_BYTES} from './identity-capture-proof.js';
const owners = new WeakMap(), MAX_KEYS = 32;
const MAX_REPLY = Math.ceil(ENROLLMENT_PHOTO_MAX_BYTES/3)*4+IDENTITY_CAPTURE_PROOF_MAX_BYTES+4096;
const exact = (value,fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field=>Object.hasOwn(value,field));
const failure = (code = 'identity_capture_unavailable') => Object.assign(
  new Error(code === 'capture_cancelled' ? 'The camera operation was cancelled.' : 'The identity camera is unavailable. Stop and try again.'),{code});

export function createIdentityCameraTool({video,issueChallenge,scope = globalThis,
  mediaDevices = scope.navigator?.mediaDevices,canvasFactory,events = scope.window || scope,
  document = scope.document,onInterrupted = () => {},inspectPhoto = inspectIdentityImage} = {}) {
  if (typeof issueChallenge !== 'function' || typeof inspectPhoto !== 'function') throw failure();
  const bridge = scope.NativeIdentityCamera, native = bridge && typeof bridge.postMessage === 'function' ? bridge : null;
  if (bridge && !native) throw failure();
  if (native && owners.has(native)) throw failure();
  const crypto = scope.crypto, keys = new Map(), pending = new Map();
  const now = () => (scope.Date || Date).now();
  const later = (callback,delay) => (scope.setTimeout || globalThis.setTimeout).call(scope,callback,delay);
  const clear = timer => (scope.clearTimeout || globalThis.clearTimeout).call(scope,timer);
  let epoch = 0, state = null, closed = false;
  const previous = native?.onmessage;
  const browser = native ? null : createEnrollmentCamera({video,mediaDevices,canvasFactory,events,document,
    onInterrupted:reason => { stop(); onInterrupted(reason); }});
  function ensure(value) {
    if (closed || state !== value || value.epoch !== epoch || value.controller.signal.aborted || document?.hidden) {
      throw failure('capture_cancelled');
    }
  }
  function post(value) { try { native.postMessage(JSON.stringify(value)); } catch { throw failure(); } }
  function cancelState(value) {
    if (value?.nativeSession) {
      try { post({id:crypto.randomUUID(),op:'cancel',session_id:value.nativeSession}); } catch {}
    }
  }
  function stop() {
    epoch++; const prior = state; state = null; prior?.controller.abort();
    for (const item of [...pending.values()]) item.finish(failure('capture_cancelled'));
    cancelState(prior);
    const stopped = browser ? browser.stop() : !prior;
    return stopped;
  }
  function rpc(value,body,timeout = 15000) {
    ensure(value);
    const id = crypto.randomUUID();
    return new Promise((resolve,reject) => {
      const timer = later(()=>finish(failure()),timeout);
      const abort = () => finish(failure('capture_cancelled'));
      function finish(error,result) {
        if (!pending.delete(id)) return;
        clear(timer); value.controller.signal.removeEventListener('abort',abort);
        if (error) {
          try { post({id:crypto.randomUUID(),cancel:id}); } catch {}
          reject(error);
        } else resolve(result);
      }
      pending.set(id,{finish}); value.controller.signal.addEventListener('abort',abort,{once:true});
      try { post({id,...body}); } catch (error) { finish(error); }
    });
  }
  const receive = event => {
    if (typeof event?.data !== 'string' || event.data.length > MAX_REPLY || new TextEncoder().encode(event.data).length > MAX_REPLY) {
      for (const item of [...pending.values()]) item.finish(failure('identity_capture_proof_invalid'));
      return;
    }
    let reply;
    try { reply = JSON.parse(event.data); }
    catch { for (const item of [...pending.values()]) item.finish(failure('identity_capture_proof_invalid')); return; }
    const item = pending.get(reply?.id); if (!item) return;
    if (Object.hasOwn(reply,'error')) {
      item.finish(failure(['capture_cancelled','identity_camera_cancelled'].includes(reply.error) ? 'capture_cancelled' : 'identity_capture_unavailable'));
    } else item.finish(null,reply);
  };
  if (native) { owners.set(native,receive); native.onmessage = receive; }
  async function publicKey(value) {
    if (native) {
      const reply = await rpc(value,{op:'key',context:value.context}); ensure(value);
      if (!exact(reply,['id','key']) || !exact(reply.key,['public_spki_der_b64','public_spki_sha256'])) throw failure();
      const key = await identityCaptureKey(reply.key.public_spki_der_b64,crypto); ensure(value);
      if (key.hash !== reply.key.public_spki_sha256) throw failure('identity_capture_key_mismatch');
      return {spki:reply.key.public_spki_der_b64,hash:key.hash};
    }
    let pair = keys.get(value.context.account_id);
    if (!pair) {
      if (keys.size >= MAX_KEYS) throw failure();
      pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
      ensure(value); keys.set(value.context.account_id,pair);
    }
    value.pair = pair;
    const spki = identityCaptureBase64(new Uint8Array(await crypto.subtle.exportKey('spki',pair.publicKey))); ensure(value);
    const key = await identityCaptureKey(spki,crypto); ensure(value);
    return {spki,hash:key.hash};
  }
  const leave = () => { stop(); keys.clear(); };
  const hidden = () => { if (document?.hidden) leave(); };
  events?.addEventListener?.('pagehide',leave);
  events?.addEventListener?.('nonverba:camera-stop',leave);
  document?.addEventListener?.('visibilitychange',hidden);
  return Object.freeze({
    isNative:!!native,
    active:() => !closed && !!state && (native ? false : browser.active()),
    async start(kind,{context} = {}) {
      stop();
      if (closed || document?.hidden || !['document_front','face_front'].includes(kind) || !crypto?.subtle || !crypto?.randomUUID) throw failure();
      if (!exact(context,['account_id','principal_id','current_session_id','recovery_generation'])) throw failure('identity_capture_request_invalid');
      const value = {epoch,kind,context:structuredClone(context),controller:new AbortController(),nativeSession:null}; state = value;
      try {
        const key = await publicKey(value); ensure(value);
        const expected = {account_id:value.context.account_id,principal_id:value.context.principal_id,
          session_id:value.context.current_session_id,recovery_generation:value.context.recovery_generation};
        const source = native ? 'native-camera2' : 'browser-camera';
        const request = await issueChallenge({expected,kind,source,public_spki_der_b64:key.spki},
          {signal:value.controller.signal,expected:value.context}); ensure(value);
        value.request = snapshotIdentityCaptureRequest(request,{context:value.context,kind,source,keyHash:key.hash,now:now()});
        value.spki = key.spki;
        if (native) {
          const reply = await rpc(value,{op:'start',request:value.request});
          if (!exact(reply,['id','session_id']) || typeof reply.session_id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(reply.session_id)) throw failure();
          value.nativeSession = reply.session_id; ensure(value);
        } else { await browser.start(kind); ensure(value); }
      } catch (error) {
        cancelState(value); if (state === value) stop(); throw error;
      }
    },
    async capture() {
      const value = state; if (!value) throw failure('capture_cancelled'); ensure(value);
      if (!value.request || value.capturing) throw failure();
      value.capturing = true;
      try {
        let blob,proof,descriptor;
        if (native) {
          const reply = await rpc(value,{op:'result',session_id:value.nativeSession},Math.min(135000,value.request.submit_expires_at_ms-now())); ensure(value);
          if (!exact(reply,['id','result']) || !exact(reply.result,['image_base64','proof','cleanup']) || reply.result.cleanup !== 'confirmed') throw failure('camera_not_stopped');
          blob = new Blob([identityCaptureBytes(reply.result.image_base64,ENROLLMENT_PHOTO_MAX_BYTES)],{type:'image/jpeg'});
          proof = reply.result.proof;
          const original = proof?.payload?.request;
          if (!original || Object.keys(original).length !== Object.keys(value.request).length
              || Object.keys(value.request).some(field=>original[field] !== value.request[field])) throw failure('identity_capture_original_required');
          if (proof.public_spki_der_b64 !== value.spki) throw failure('identity_capture_key_mismatch');
        } else {
          snapshotIdentityCaptureRequest(value.request,{context:value.context,kind:value.kind,now:now()});
          const capturedAt = now();
          let facing;
          try { facing = video.srcObject?.getVideoTracks?.()[0]?.getSettings?.().facingMode; } catch { /* Observation unavailable. */ }
          const captured = await browser.capture(); ensure(value);
          blob = await prepareEnrollmentImage(captured,{kind:value.kind,signal:value.controller.signal,canvasFactory}); ensure(value);
          descriptor = await inspectPhoto(blob,{signal:value.controller.signal}); ensure(value);
          const payload = {request:value.request,image_sha256:descriptor.sha256,image_bytes:descriptor.byte_length,
            width:descriptor.width,height:descriptor.height,captured_at_ms:capturedAt,
            lens_facing:facing === 'user' ? 'front' : facing === 'environment' ? 'back' : 'unknown',acquisition:null};
          const signature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},value.pair.privateKey,canonicalIdentityCapturePayload(payload)); ensure(value);
          proof = {payload,public_spki_der_b64:value.spki,signature_b64:identityCaptureBase64(new Uint8Array(signature))};
        }
        if (!descriptor) descriptor = await inspectPhoto(blob,{signal:value.controller.signal});
        ensure(value);
        proof = await verifyIdentityCaptureProof(proof,{context:value.context,kind:value.kind,descriptor,now:now(),crypto}); ensure(value);
        state = null; value.nativeSession = null;
        return Object.freeze({blob,captureProof:proof,cleanup:'stopped'});
      } catch (error) { if (state === value) stop(); throw error; }
    },
    stop,
    dispose() {
      if (closed) return true;
      const stopped = stop(); closed = true; keys.clear(); browser?.dispose();
      events?.removeEventListener?.('pagehide',leave); events?.removeEventListener?.('nonverba:camera-stop',leave);
      document?.removeEventListener?.('visibilitychange',hidden);
      if (native && owners.get(native) === receive) { owners.delete(native); if (native.onmessage === receive) native.onmessage = previous; }
      return stopped;
    }
  });
}

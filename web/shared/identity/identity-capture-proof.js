// SPDX-License-Identifier: AGPL-3.0-only
// A verified application signature binds bytes and context, not scene truth.
import {ENROLLMENT_PHOTO_MAX_BYTES} from './enrollment-camera.js';
export const IDENTITY_CAPTURE_PROOF_MAX_BYTES = 16 * 1024;
const requestFields = ['version','purpose','challenge_id','nonce','account_id','principal_id',
  'current_session_id','recovery_generation','kind','source','public_spki_sha256',
  'issued_at_ms','capture_expires_at_ms','submit_expires_at_ms'];
const acquisitionFields = ['version','timestamp_source','request_elapsed_realtime_ns',
  'image_received_elapsed_realtime_ns','result_received_elapsed_realtime_ns','sensor_timestamp_ns',
  'image_timestamp_ns','zsl_requested_disabled','test_pattern_requested_disabled',
  'zsl_result_enabled','test_pattern_result_mode'];
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value,key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(code = 'identity_capture_proof_invalid') {
  throw Object.assign(new Error('The camera proof is invalid or expired. Take the photo again.'),{code});
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function identityCaptureBase64(bytes) {
  let text = '';
  for (let i=0;i<bytes.length;i+=16384) text += String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(text);
}
export function identityCaptureBytes(value, maximum, length) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maximum/3)*4
      || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('identity_capture_encoding_invalid');
  let bytes;
  try { bytes = Uint8Array.from(atob(value),character=>character.charCodeAt(0)); }
  catch { fail('identity_capture_encoding_invalid'); }
  if (!bytes.length || bytes.length > maximum || length !== undefined && bytes.length !== length
      || identityCaptureBase64(bytes) !== value) fail('identity_capture_encoding_invalid');
  return bytes;
}
function token(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  try { identityCaptureBytes(value.replaceAll('-','+').replaceAll('_','/')+'=',32,32); return true; }
  catch { return false; }
}
export function canonicalIdentityCapturePayload(value) {
  const sorted = item => item === null || typeof item !== 'object' ? item
    : Object.fromEntries(Object.keys(item).sort().map(key=>[key,sorted(item[key])]));
  return new TextEncoder().encode('NONVERBA:IDENTITY_CAPTURE:v1\n'+JSON.stringify(sorted(value)));
}
export async function identityCaptureKey(publicSpki, crypto = globalThis.crypto) {
  const bytes = identityCaptureBytes(publicSpki,128);
  try {
    const key = await crypto.subtle.importKey('spki',bytes,{name:'ECDSA',namedCurve:'P-256'},true,['verify']);
    const canonical = new Uint8Array(await crypto.subtle.exportKey('spki',key));
    if (identityCaptureBase64(canonical) !== publicSpki) fail('identity_capture_key_invalid');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    return {key,hash:[...digest].map(value=>value.toString(16).padStart(2,'0')).join('')};
  } catch { fail('identity_capture_key_invalid'); }
}
export function snapshotIdentityCaptureRequest(value,{context,kind,source,keyHash,now = Date.now(),capture = true} = {}) {
  if (!exact(value,requestFields)) fail('identity_capture_request_invalid');
  const request = structuredClone(value);
  if (request.version !== 1 || request.purpose !== 'identity-capture'
      || !token(request.challenge_id) || !token(request.nonce)
      || !['account_id','principal_id','current_session_id'].every(field=>identifier(request[field]))
      || !integer(request.recovery_generation) || !['document_front','face_front'].includes(request.kind)
      || !['native-camera2','browser-camera'].includes(request.source) || !hash(request.public_spki_sha256)
      || !['issued_at_ms','capture_expires_at_ms','submit_expires_at_ms'].every(field=>integer(request[field]))
      || request.capture_expires_at_ms-request.issued_at_ms !== 120000
      || request.submit_expires_at_ms-request.issued_at_ms !== 900000
      || request.issued_at_ms > now+5000 || !context
      || ['account_id','principal_id','current_session_id','recovery_generation'].some(field=>request[field] !== context[field])
      || request.kind !== kind || source !== undefined && request.source !== source
      || keyHash !== undefined && request.public_spki_sha256 !== keyHash) fail('identity_capture_request_invalid');
  if ((capture ? request.capture_expires_at_ms : request.submit_expires_at_ms) <= now) fail('identity_capture_expired');
  return freeze(request);
}
function nativeAcquisition(value) {
  const ns = text => typeof text === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(text)
    && BigInt(text) <= 9223372036854775807n;
  if (!exact(value,acquisitionFields) || value.version !== 1 || !['realtime','unknown'].includes(value.timestamp_source)
      || !acquisitionFields.filter(key=>key.endsWith('_ns')).every(key=>ns(value[key]))
      || value.zsl_requested_disabled !== true || value.test_pattern_requested_disabled !== true
      || ![null,false].includes(value.zsl_result_enabled) || ![null,0].includes(value.test_pattern_result_mode)
      || value.sensor_timestamp_ns !== value.image_timestamp_ns) fail('identity_capture_acquisition_invalid');
  const submitted = BigInt(value.request_elapsed_realtime_ns), image = BigInt(value.image_received_elapsed_realtime_ns);
  const result = BigInt(value.result_received_elapsed_realtime_ns), sensor = BigInt(value.sensor_timestamp_ns);
  if (image < submitted || result < submitted || image-submitted > 15000000000n || result-submitted > 15000000000n
      || value.timestamp_source === 'realtime' && (sensor < submitted || sensor > image || sensor > result)) {
    fail('identity_capture_acquisition_invalid');
  }
}
export async function verifyIdentityCaptureProof(value,{context,kind,descriptor,now = Date.now(),crypto = globalThis.crypto} = {}) {
  let length;
  try { length = new TextEncoder().encode(JSON.stringify(value)).length; } catch { fail(); }
  if (!exact(value,['payload','public_spki_der_b64','signature_b64']) || length > IDENTITY_CAPTURE_PROOF_MAX_BYTES) fail();
  const proof = structuredClone(value), payload = proof.payload;
  if (!exact(payload,['request','image_sha256','image_bytes','width','height','captured_at_ms','lens_facing','acquisition'])) fail();
  const request = snapshotIdentityCaptureRequest(payload.request,{context,kind,now,capture:false});
  if (!hash(payload.image_sha256) || !integer(payload.image_bytes) || payload.image_bytes < 1
      || payload.image_bytes > ENROLLMENT_PHOTO_MAX_BYTES || !integer(payload.width) || payload.width < 1
      || !integer(payload.height) || payload.height < 1 || payload.width*payload.height > 16_000_000
      || payload.width > (kind === 'document_front' ? 2400 : 1280)
      || payload.height > (kind === 'document_front' ? 2400 : 1280) || !integer(payload.captured_at_ms)
      || payload.captured_at_ms < request.issued_at_ms || payload.captured_at_ms >= request.capture_expires_at_ms
      || payload.captured_at_ms > now+5000 || !['front','back','external','unknown'].includes(payload.lens_facing)) fail();
  if (request.source === 'browser-camera') { if (payload.acquisition !== null) fail('identity_capture_acquisition_invalid'); }
  else {
    if (payload.lens_facing !== (kind === 'document_front' ? 'back' : 'front')) fail('identity_capture_acquisition_invalid');
    nativeAcquisition(payload.acquisition);
  }
  if (!descriptor || descriptor.media_type !== 'image/jpeg' || descriptor.sha256 !== payload.image_sha256
      || descriptor.byte_length !== payload.image_bytes || descriptor.width !== payload.width || descriptor.height !== payload.height) {
    fail('identity_capture_image_mismatch');
  }
  const publicKey = await identityCaptureKey(proof.public_spki_der_b64,crypto);
  if (publicKey.hash !== request.public_spki_sha256) fail('identity_capture_key_mismatch');
  const signature = identityCaptureBytes(proof.signature_b64,64,64);
  let valid = false;
  try { valid = await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey.key,signature,canonicalIdentityCapturePayload(payload)); }
  catch { fail('identity_capture_signature_invalid'); }
  if (!valid) fail('identity_capture_signature_invalid');
  return freeze(proof);
}

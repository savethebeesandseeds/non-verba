// SPDX-License-Identifier: AGPL-3.0-only
// Frozen live camera agreement. Rust remains responsible for evidence appraisal.
import {locationPolicy} from './location-policy.js';
export const CAMERA_CONTEXT = '{"version":1}';
export const MAX_CAMERA_CONTEXT = 4 * 1024 * 1024;
export const CAMERA_DELIVERY = Object.freeze({max_response_ms:180000,max_receipt_age_ms:60000});
export const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function requireCameraPin(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('An independently known 64-character public key ID is required.');
}
export function cameraContext(text = CAMERA_CONTEXT) {
  if (typeof text !== 'string' || !text.length || new TextEncoder().encode(text).length > MAX_CAMERA_CONTEXT) throw new Error('Camera verifier context exceeds its 4 MiB limit.');
  const value=JSON.parse(text);
  if (!object(value) || value.version !== 1 || Object.keys(value).some(key => !['version','key_attestation','location_key_attestation','position'].includes(key))) throw new Error('Unsupported camera verifier context.');
  for (const key of ['key_attestation','location_key_attestation']) if (value[key] != null && (!exact(value[key],['chain','expected','trust'])
      || !object(value[key].chain) || !object(value[key].expected) || !object(value[key].trust))) throw new Error('Provide explicit attestation chain, expectations and trust inputs.');
  if (value.position != null && (!exact(value.position,['navigation_json','policy'])
      || typeof value.position.navigation_json !== 'string' || !value.position.navigation_json.length || !object(value.position.policy))) throw new Error('Provide exact navigation JSON and independently retained position policy.');
  return text; // Exact bytes, including whitespace, are bound by the receipt.
}
export async function cameraContextHash(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cameraContext(text))))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function cameraHints(value) {
  const composed=Object.hasOwn(value||{},'location_profile');
  const duration=composed && Object.hasOwn(value||{},'duration_ms');
  if(duration && !Number.isSafeInteger(value.duration_ms))throw new Error('Invalid agreed location duration.');
  const keys=['requester','task','assurance',...(composed?['location_profile','hardware_attestation_required','independent_position_required','context_sha256']:[]),...(duration?['duration_ms']:[])];
  if (!exact(value,keys) || typeof value.requester !== 'string' || typeof value.task !== 'string' || !value.requester.trim() || !value.task.trim()
      || value.requester.length>120 || value.task.length>1000 || !['native-correlated','browser-or-android'].includes(value.assurance)) throw new Error('Invalid agreed camera task or assurance.');
  const hints={requester:value.requester.trim(),task:value.task.trim(),assurance:value.assurance};
  if (composed) {
    locationPolicy(value.location_profile,duration?value.duration_ms:10000); requireCameraPin(value.context_sha256);
    if (typeof value.hardware_attestation_required !== 'boolean' || typeof value.independent_position_required !== 'boolean') throw new Error('Explicit camera/location evidence requirements are required.');
    if (value.independent_position_required && value.location_profile !== 'raw-gnss') throw new Error('Independent position requires the raw satellite profile.');
    Object.assign(hints,{location_profile:value.location_profile,hardware_attestation_required:value.hardware_attestation_required,
      independent_position_required:value.independent_position_required,context_sha256:value.context_sha256});
    if(duration)hints.duration_ms=value.duration_ms;
  }
  return Object.freeze(hints);
}
export function cameraPolicy(value) {
  const hints=cameraHints(value),native=hints.assurance==='native-correlated';
  return {version:1,native_acquisition_required:native,raw_gnss_required:hints.location_profile==='raw-gnss',
    correlated_camera_clock_required:native,hardware_attestation_required:hints.hardware_attestation_required??false,
    independent_position_required:hints.independent_position_required??false};
}
export function requireCameraContext(text,hints,locationPin) {
  const value=JSON.parse(cameraContext(text));cameraHints(hints);
  if (!hints.location_profile) {
    if (text!==CAMERA_CONTEXT || locationPin!=null) throw new Error('Image-only version 1 requires its original minimal context and one operator pin.');
    return;
  }
  requireCameraPin(locationPin);
  if (hints.hardware_attestation_required && (!value.key_attestation || !value.location_key_attestation)) throw new Error('Camera and location hardware attestation require both explicit signer contexts before pairing.');
  if (hints.independent_position_required && !value.position) throw new Error('Independent position requires explicit navigation and policy context before pairing.');
  if (value.location_key_attestation && value.location_key_attestation.expected.expected_spki_sha256!==locationPin) throw new Error('The location attestation expectation must pin this exact operator location key.');
  // The media pin is a certificate digest, not an SPKI digest. Rust compares its verified signer to the media attestation.
}
export function sameCameraValue(left,right) {
  const sort=value=>Array.isArray(value)?value.map(sort):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;
  return JSON.stringify(sort(left))===JSON.stringify(sort(right));
}

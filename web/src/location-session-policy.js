// SPDX-License-Identifier: AGPL-3.0-only
// Live-location agreement and verifier inputs. Sensor/crypto verdicts remain in Rust.
import {locationPolicy} from './location-policy.js';
export const LOCATION_CONTEXT = '{"version":1}';
export const MAX_LOCATION_CONTEXT = 4 * 1024 * 1024;
export const LOCATION_DELIVERY = Object.freeze({max_response_ms:90000, max_receipt_age_ms:60000});
export const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function requireLocationPin(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('An independently known 64-character public key ID is required.');
}
export function locationContext(text = LOCATION_CONTEXT) {
  if (typeof text !== 'string' || !text.length || new TextEncoder().encode(text).length > MAX_LOCATION_CONTEXT) throw new Error('Location verifier context exceeds its 4 MiB limit.');
  const value = JSON.parse(text);
  if (!object(value) || value.version !== 1 || Object.keys(value).some(key => !['version','key_attestation','position'].includes(key))) throw new Error('Unsupported standalone location verifier context.');
  if (value.key_attestation != null && (!exact(value.key_attestation, ['chain','expected','trust'])
      || !object(value.key_attestation.chain) || !object(value.key_attestation.expected) || !object(value.key_attestation.trust))) throw new Error('Provide explicit attestation chain, expectations and trust inputs.');
  if (value.position != null && (!exact(value.position, ['navigation_json','policy'])
      || typeof value.position.navigation_json !== 'string' || !value.position.navigation_json.length || !object(value.position.policy))) throw new Error('Provide exact navigation JSON and independently retained position policy.');
  return text; // Preserve exact bytes; whitespace is part of the receipt context binding.
}
export async function locationContextHash(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(locationContext(text))))].map(n => n.toString(16).padStart(2,'0')).join('');
}
export function locationSessionHints(value) {
  const duration = Object.hasOwn(value || {}, 'duration_ms');
  if (duration && !Number.isSafeInteger(value.duration_ms)) throw new Error('Invalid agreed location duration.');
  if (!exact(value, ['requester','task','profile','hardware_attestation_required','independent_position_required','demo','context_sha256',...(duration ? ['duration_ms'] : [])])
      || typeof value.requester !== 'string' || typeof value.task !== 'string' || !value.requester.trim() || !value.task.trim()
      || value.requester.length > 120 || value.task.length > 1000
      || ['hardware_attestation_required','independent_position_required','demo'].some(key => typeof value[key] !== 'boolean')) throw new Error('Invalid agreed live-location task or policy.');
  locationPolicy(value.profile, duration ? value.duration_ms : 10000); requireLocationPin(value.context_sha256);
  if (value.independent_position_required && value.profile !== 'raw-gnss') throw new Error('Independent position recomputation requires the raw satellite profile.');
  return Object.freeze({...value, requester:value.requester.trim(), task:value.task.trim()});
}
export function locationEvidencePolicy(value) {
  const hints = locationSessionHints(value);
  return {version:1, native_acquisition_required:hints.profile !== 'browser-or-native',
    raw_gnss_required:hints.profile === 'raw-gnss', correlated_camera_clock_required:false,
    hardware_attestation_required:hints.hardware_attestation_required, independent_position_required:hints.independent_position_required};
}
export function requireLocationContext(text, hints, operatorPin) {
  const value = JSON.parse(locationContext(text)); locationSessionHints(hints);
  if (hints.hardware_attestation_required && !value.key_attestation) throw new Error('Hardware attestation requires explicit retained attestation context before pairing.');
  if (hints.independent_position_required && !value.position) throw new Error('Independent position requires explicit navigation and policy context before pairing.');
  if (value.key_attestation && value.key_attestation.expected.expected_spki_sha256 !== operatorPin) throw new Error('The attestation expectation must pin this exact operator location key.');
}
export function sameLocationValue(left, right) {
  const sort = value => Array.isArray(value) ? value.map(sort) : object(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key,sort(value[key])])) : value;
  return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
}

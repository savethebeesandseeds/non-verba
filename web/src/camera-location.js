// SPDX-License-Identifier: AGPL-3.0-only
// Camera composition uses the independent location module. The location proof
// binds the final signed JPEG; it is never embedded back into that same JPEG.
import {locationProofEnvelope,readLocationProofEnvelope,MAX_LOCATION_PROOF} from './location-platform.js';
import {locationPolicy} from './location-policy.js';
export const CAMERA_LOCATION_REQUEST = 'nonverba-camera-location-request';

export function splitCameraRequest(text) {
  if (typeof text !== 'string' || text.length > 64 * 1024) throw new Error('The camera request is missing or too large.');
  const input = JSON.parse(text);
  if (input?.type !== CAMERA_LOCATION_REQUEST) return {challenge: input, locationRequest: null};
  if (input.version !== 1 || Object.keys(input).some(key => !['version', 'type', 'location_request'].includes(key))
      || input.location_request?.context?.purpose !== 'camera' || !input.location_request.challenge) {
    throw new Error('Malformed camera and location request.');
  }
  return {challenge: input.location_request.challenge, locationRequest: input.location_request};
}

export async function createCameraRequest(engine, requester, task, now, lifetime, mode, durationMs = 10000) {
  if (mode === 'metadata') return engine.json('create_challenge', requester, task, now, lifetime);
  const profile = {trace: 'browser-or-native', native: 'native-gnss', raw: 'raw-gnss'}[mode];
  if (!profile) throw new Error('Unknown location requirement.');
  const policy = locationPolicy(profile, durationMs);
  const request = await engine.json('create_location_request', requester, task, now, lifetime, JSON.stringify(policy), 'null');
  request.context = {session_id: request.challenge.id, purpose: 'camera', camera_timing: 'concurrent'};
  const validated = await engine.json('validate_location_request', JSON.stringify(request), now);
  return {version: 1, type: CAMERA_LOCATION_REQUEST, location_request: validated};
}

export function encodeLocationProof(bytes) {
  return JSON.stringify(locationProofEnvelope(bytes), null, 2);
}

export async function readLocationProof(file) {
  if (!file) throw new Error('This request also requires the matching location proof file.');
  if (file.size > MAX_LOCATION_PROOF * 2) throw new Error('Location proof exceeds the size limit.');
  return readLocationProofEnvelope(await file.text());
}

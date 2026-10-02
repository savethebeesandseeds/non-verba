// SPDX-License-Identifier: AGPL-3.0-only
// Offline camera acceptance: retained bytes and original authority are inputs;
// a displayed verification report is never authority for committing an action.
import {splitCameraRequest} from './camera-location.js';
import {MAX_LOCATION_PROOF} from './location-platform.js';
import {acceptOnce, AcceptanceClockChanged} from './storage.js';

const now = () => Math.floor(Date.now() / 1000);
const PIN = /^[0-9a-f]{64}$/;
async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function retainCameraEvidence(engine, {jpeg, proof = null, originalJson, mediaPin, locationPin = null, name}) {
  if (!(jpeg instanceof Uint8Array) || !jpeg.length || jpeg.length > 32 * 1024 * 1024 || !PIN.test(mediaPin)) throw new Error('Invalid camera evidence or independently known media key.');
  const original = splitCameraRequest(originalJson), challenge = original.challenge;
  const challengeJson = JSON.stringify(challenge);
  const locationJson = original.locationRequest ? JSON.stringify(original.locationRequest) : null;
  if (locationJson && (!(proof instanceof Uint8Array) || !proof.length || proof.length > MAX_LOCATION_PROOF || !PIN.test(locationPin))) throw new Error('The composed request requires its matching proof and independently known location key.');
  if (!locationJson && proof !== null) throw new Error('An ordinary camera request cannot accept an unrelated location proof.');
  // Copies are private to this closure; caller mutation after verification cannot
  // change the bytes later accepted. Their hashes are computed from these copies.
  const imageBytes = jpeg.slice(), proofBytes = proof?.slice();
  const file = {name, sha256: await digest(imageBytes), ...(proofBytes ? {
    location_proof_sha256: await digest(proofBytes), location_fingerprint: locationPin,
  } : {})};
  const verify = async (at = now()) => locationJson
    ? engine.json('verify_image_with_location_proof', imageBytes, proofBytes, locationJson, mediaPin, locationPin, at)
    : engine.json('verify_image', imageBytes, challengeJson, mediaPin, at);
  return {
    file: Object.freeze({...file}),
    verify,
    async accept(isCurrent) {
      if (typeof isCurrent !== 'function' || !isCurrent()) throw new Error('The verification inputs changed before acceptance.');
      for (let attempt = 0; attempt < 3; attempt++) {
        const verifiedAt = now(), report = await verify(verifiedAt);
        if (!isCurrent()) throw new Error('The verification inputs changed while acceptance was being checked.');
        if (!report.verified || report.capture?.version < 2 || report.checks?.location_metadata_valid !== true) throw new Error('Fresh acceptance requires independently verified intact evidence and signed GPS metadata.');
        try {
          return await acceptOnce(challenge.id, {...file, device_fingerprint: report.device_fingerprint}, {
            issuedAt: challenge.issued_at, expiresAt: challenge.expires_at, verifiedAt, isCurrent,
          });
        } catch (error) { if (!(error instanceof AcceptanceClockChanged) || attempt === 2) throw error; }
      }
    },
  };
}

// SPDX-License-Identifier: AGPL-3.0-only
// Local capture reservation and acceptance policy; the shared database owns I/O.
import {database} from '../runtime/database.js';

export class AcceptanceClockChanged extends Error {}

export async function acceptOnce(challengeId, record, {issuedAt, expiresAt, verifiedAt, isCurrent}) {
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)
      || !Number.isSafeInteger(verifiedAt) || issuedAt < 0 || expiresAt <= issuedAt
      || typeof isCurrent !== 'function') {
    throw new Error('A bounded original request, verification time and current-input guard are required for acceptance.');
  }
  const db = await database();
  return new Promise((resolve, reject) => {
    let accepted, failure;
    const transaction = db.transaction('accepted', 'readwrite');
    const store = transaction.objectStore('accepted');
    // add(), rather than put(), makes simultaneous accepts across tabs atomic.
    // Check time and UI authority after any previously queued writer releases
    // the store, not before queuing this transaction.
    const ready = store.get(challengeId);
    ready.onsuccess = () => {
      try {
        const at = Math.floor(Date.now() / 1000);
        if (!isCurrent()) throw new Error('The verification inputs changed before the acceptance transaction.');
        if (at < issuedAt || at >= expiresAt) throw new Error('The request window closed before acceptance could be saved.');
        if (at !== verifiedAt) throw new AcceptanceClockChanged('The verification clock changed before acceptance; verify again.');
        accepted = {...record, accepted_at: at};
        store.add(accepted, challengeId);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(accepted);
    transaction.onerror = () => reject(new Error('This challenge was already accepted on this device.'));
    transaction.onabort = () => reject(failure || new Error('Acceptance could not be saved, or this challenge was already accepted.'));
  });
}

export async function reserveCapture(challengeId, record) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('captures', 'readwrite');
    transaction.objectStore('captures').add(record, challengeId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(new Error('This challenge was already used for a capture on this device. Request a fresh challenge.'));
  });
}

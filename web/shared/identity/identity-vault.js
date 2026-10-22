// SPDX-License-Identifier: AGPL-3.0-only
// Browser identity encryption and the Android vault bridge share one interface.
import {read, write} from '../runtime/database.js';

export async function loadIdentity() {
  if (window.NativeVault) {
    const identity = window.NativeVault.loadIdentity();
    const failure = window.NativeVault.lastError();
    if (failure) throw new Error(failure);
    return identity || null;
  }
  const envelope = await read('vault', 'identity');
  if (!envelope) return null;
  const key = await read('vault', 'wrapping-key');
  if (!key) throw new Error('The stored identity cannot be unlocked. Use a different browser profile to create a new identity.');
  const plaintext = await crypto.subtle.decrypt({name: 'AES-GCM', iv: envelope.iv}, key, envelope.ciphertext);
  return new TextDecoder().decode(plaintext);
}

export async function saveIdentity(identity) {
  if (window.NativeVault) {
    if (!window.NativeVault.saveIdentity(identity)) throw new Error('Android could not securely save this signing identity.');
    return;
  }
  let key = await read('vault', 'wrapping-key');
  if (!key) {
    key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    await write('vault', 'wrapping-key', key);
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(identity));
  await write('vault', 'identity', {iv, ciphertext});
}

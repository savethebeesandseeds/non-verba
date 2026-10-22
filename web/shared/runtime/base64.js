// SPDX-License-Identifier: AGPL-3.0-only
// Canonical binary transport encoding. Each caller supplies its artifact bound.
function byteLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('A positive byte limit is required.');
}

export function bytesToBase64(bytes, limit) {
  byteLimit(limit);
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > limit) throw new Error('Invalid artifact size.');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}

export function base64ToBytes(encoded, limit) {
  byteLimit(limit);
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > Math.ceil(limit / 3) * 4
      || encoded.length % 4 !== 0) throw new Error('Invalid base64 encoding.');
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  // A repeated-group regex can exhaust the stack on otherwise bounded large files.
  if (/[^A-Za-z0-9+/]/.test(encoded.slice(0, encoded.length - padding))) throw new Error('Invalid base64 encoding.');
  const binary = atob(encoded);
  if (binary.length === 0 || binary.length > limit) throw new Error('The decoded artifact is too large.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytesToBase64(bytes, limit) !== encoded) throw new Error('Noncanonical base64 encoding.');
  return bytes;
}

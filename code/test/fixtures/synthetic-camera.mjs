// SPDX-License-Identifier: AGPL-3.0-only
// Reviewed source fixture, independent of ignored JNI output and physical captures.
import {readFile} from 'node:fs/promises';
export async function syntheticCameraJpeg() {
  const hex = (await readFile(new URL('./camera-session.hex.txt', import.meta.url), 'utf8')).trim();
  if (!/^ffd8(?:[0-9a-f]{2})+ffd9$/.test(hex)) throw new Error('Invalid synthetic camera source fixture.');
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

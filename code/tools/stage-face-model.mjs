// SPDX-License-Identifier: AGPL-3.0-only
// Stage only reviewed model/runtime files from the managed dependency volume.
// No download, inference, biometric storage or container lifecycle operation.
import {readFile, copyFile, mkdir, stat, realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname, basename, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FACE_MODEL_CACHE, MOBILE_FACE_SPEC, MOBILE_FACE_LOCK_SHA256} from '../../web/src/face-model-spec.js';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const code = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function stageFaceModel({dist = resolve(code, '../web/dist')} = {}) {
  if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Stage face assets only in the managed Debian container.');
  try { await stat(FACE_MODEL_CACHE); } catch (error) {
    if (error.code === 'ENOENT') { console.log('Face model cache unavailable; Operator face inference will report unavailable.'); return false; }
    throw error;
  }
  if (await realpath(FACE_MODEL_CACHE) !== FACE_MODEL_CACHE) throw new Error('The face model cache must be an unlinked managed path.');
  const lockBytes = await readFile(resolve(code, 'models/mobilefacenet/model-lock.json'));
  if (digest(lockBytes) !== MOBILE_FACE_LOCK_SHA256) throw new Error('The face model source lock is not pinned.');
  const lock = JSON.parse(lockBytes);
  if (Object.keys(MOBILE_FACE_SPEC).some(key => lock.profile[key] !== MOBILE_FACE_SPEC[key])) throw new Error('Face model policy and asset profile differ.');
  const destination = join(dist, 'face-model'); await mkdir(destination, {recursive: true});
  for (const asset of [...Object.values(lock.browser_assets), ...(lock.browser_notices ?? [])]) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(asset.file) || !asset.cache_file || asset.cache_file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid face asset path.');
    const source = resolve(FACE_MODEL_CACHE, asset.cache_file);
    if (!source.startsWith(FACE_MODEL_CACHE + '/') || await realpath(source) !== source) throw new Error('A face asset escaped its unlinked managed cache.');
    const bytes = await readFile(source);
    if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256) throw new Error(`Face asset digest mismatch: ${basename(source)}`);
    await copyFile(source, join(destination, asset.file));
  }
  await import('node:fs/promises').then(({writeFile}) => writeFile(join(destination, 'model-lock.json'), lockBytes));
  console.log('Staged pinned MobileFaceNet, separate YuNet detector and CPU runtime for browser inspection.');
  return true;
}

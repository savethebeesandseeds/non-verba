// SPDX-License-Identifier: AGPL-3.0-only
// Closed asset set for shared onboarding and the selected local account client.
import {constants} from 'node:fs';
import {lstat, open, readdir} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectReleaseNotices} from './release-notices.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const insist = (condition, message) => { if (!condition) throw new Error(message); };
// Explicit feature bounds: initial shell 64 KiB; synthetic onboarding 128 KiB;
// service client 192 KiB; static key dashboard 196 KiB; editable demo 200 KiB.
// Sign-in/reuse: 204 KiB; email routing: 208 KiB; segmented code UI: 212 KiB.
// Device proof and account session inventory: 240 KiB, same closed asset set.
// Centered signup, password guidance and bundled versioned account terms: 272 KiB.
// Terms review gate and fixed username prefix: 280 KiB, same fourteen sources.
// Eight-code recovery grid and deliberate browser/native text export: 296 KiB.
// Compact identity levels and three bounded stamp images: 320 KiB.
// Identity details, bounded phone-image preparation and private intake client: 384 KiB.
// Account-bound identity state and explicit saved-password enhancement: 400 KiB.
// Separate bounded synthetic reviewer client/view and current notice: 448 KiB.
// Restored 23 October identity seals: 456 KiB.
// Requester and operator home figures: 465 KiB.
// One current figure plus the header and dashboard mode switch: 467 KiB.
// The dashboard names the current mode: 468 KiB.
// Confirming a change to the other mode: 471 KiB.
// Account-closure retention in the draft terms and deletion review: 476 KiB.
// Opening the home feed from the swipe hint: 480 KiB.
// Sentences and sampled charts in the home feed: 487 KiB.
// A five-second sign-in recheck while the server is unreachable: 488 KiB.
// One page for each feed post, then a stop page: 489 KiB.
// One queue for the visit, walked down and back up: 491 KiB.
// Phone vault password commit on the sign-in form: 493 KiB.
// The Operator choice stays for the visit when storage is unavailable: 494 KiB.
// A landing-page swipe and skipping the mode confirmation: 497 KiB.
// The landing figure follows that swipe: 499 KiB.
export const PARTICIPANT_SHELL_BUDGET = 499 * 1024;
export const PARTICIPANT_IMAGE_BUDGET = 8 * 1024;
// The real-capture closure intentionally uses a new generation. Keep the older
// illustration stage intact instead of deleting unknown or retained outputs.
export const PARTICIPANT_STAGE = '/opt/nonverba-build/android/participant/build/generated/participant-capture-assets-v1';
export const PARTICIPANT_SHELL_SOURCES = Object.freeze({
  'participant/index.html': 'web/apps/non-verba/src/index.html',
  'participant/participant.css': 'web/apps/non-verba/src/participant.css',
  'participant/participant.js': 'web/apps/non-verba/src/participant.js',
  'participant/onboarding-ui.js': 'web/apps/non-verba/src/onboarding-ui.js',
  'participant/identity-state.js': 'web/apps/non-verba/src/identity-state.js',
  'participant/identity-review-client.js': 'web/apps/non-verba/src/identity-review-client.js',
  'participant/identity-review-ui.js': 'web/apps/non-verba/src/identity-review-ui.js',
  'participant/password-manager-sign-in.js': 'web/apps/non-verba/src/password-manager-sign-in.js',
  'participant/onboarding-account.js': 'web/apps/non-verba/src/onboarding-account.js',
  'participant/account-terms.js': 'web/apps/non-verba/src/account-terms.js',
  'participant/identity-intake-notice.js': 'web/apps/non-verba/src/identity-intake-notice.js',
  'participant/account-transport.js': 'web/apps/non-verba/src/account-transport.js',
  'participant/recovery-export.js': 'web/apps/non-verba/src/recovery-export.js',
  'participant/identity/enrollment-camera.js': 'web/shared/identity/enrollment-camera.js',
  'participant/identity/identity-capture.js': 'web/shared/identity/identity-capture.js',
  'participant/identity/identity-camera-tool.js': 'web/shared/identity/identity-camera-tool.js',
  'participant/identity/identity-capture-proof.js': 'web/shared/identity/identity-capture-proof.js',
  'participant/identity/device-attestation.js': 'web/shared/identity/device-attestation.js',
  'participant/identity/browser-attestation-keys.js': 'web/shared/identity/browser-attestation-keys.js',
  'participant/branding/sprout.svg': 'web/site/branding/sprout.svg',
  'participant/branding/home-sprout.webp': 'web/apps/non-verba/assets/branding/home-sprout.webp',
  'participant/branding/home-succulent.webp': 'web/apps/non-verba/assets/branding/home-succulent.webp',
  'participant/branding/waajacu.webp': 'web/apps/non-verba/assets/branding/waajacu.webp',
  'participant/identity/level-1.webp': 'web/apps/non-verba/assets/identity/level-1.webp',
  'participant/identity/level-2.webp': 'web/apps/non-verba/assets/identity/level-2.webp',
  'participant/identity/unverified.webp': 'web/apps/non-verba/assets/identity/unverified.webp',
});

export async function assertUnlinkedDirectory(path) {
  const info = await lstat(path);
  insist(info.isDirectory() && !info.isSymbolicLink(), 'Expected unlinked directory: ' + path);
}

// Check every path component, including parents of the supplied root. Opening
// the final file without following a link also closes the final-component race.
export async function assertUnlinkedParents(path) {
  const parents = [];
  let current = dirname(resolve(path));
  while (true) {
    parents.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const parent of parents.reverse()) await assertUnlinkedDirectory(parent);
}

export async function readBoundedParticipantFile(path, maximum = PARTICIPANT_SHELL_BUDGET) {
  await assertUnlinkedParents(path);
  const before = await lstat(path, {bigint:true});
  insist(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= BigInt(maximum),
    'Expected bounded unlinked regular participant file: ' + path);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat({bigint:true});
    insist(opened.dev === before.dev && opened.ino === before.ino && opened.isFile() && opened.nlink === 1n,
      'Participant input changed while opening: ' + path);
    // Read at most the observed size plus one byte, even if an input grows
    // concurrently. readFile() alone would allocate before enforcing the cap.
    const bounded = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bounded.length) {
      const result = await handle.read(bounded, length, bounded.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const bytes = bounded.subarray(0, length);
    const after = await lstat(path, {bigint:true});
    insist(after.isFile() && !after.isSymbolicLink() && after.nlink === 1n && after.dev === before.dev
      && after.ino === before.ino && after.size === before.size && after.mtimeNs === before.mtimeNs
      && after.ctimeNs === before.ctimeNs && BigInt(bytes.length) === before.size,
    'Participant input changed while reading: ' + path);
    return bytes;
  } finally { await handle.close(); }
}

export function assertParticipantAssetNames(assets) {
  insist(assets instanceof Map, 'Participant assets must be a Map.');
  for (const [name, bytes] of assets) {
    insist(typeof name === 'string' && !name.includes('\\') && !name.startsWith('/') && !/[\x00-\x1f\x7f]/.test(name)
      && !name.split('/').some(part => !part || part === '.' || part === '..') && !name.includes(':'),
    'Unsafe participant asset name: ' + name);
    insist(Object.hasOwn(PARTICIPANT_SHELL_SOURCES, name) || name.startsWith('nonverba-license/'),
      'Unexpected participant asset: ' + name);
    insist(Buffer.isBuffer(bytes) && bytes.length <= 16 * 1024 * 1024, 'Invalid participant asset bytes: ' + name);
    if (/\.(?:webp|svg)$/.test(name)) insist(bytes.length <= PARTICIPANT_IMAGE_BUDGET,
      'Participant image exceeds 8KiB budget: ' + name);
  }
  for (const name of Object.keys(PARTICIPANT_SHELL_SOURCES)) insist(assets.has(name), 'Missing participant shell asset: ' + name);
  for (const name of ['LICENSE.txt', 'SOURCE.txt']) insist(assets.has('nonverba-license/' + name), 'Missing participant notice: ' + name);
  const shellBytes = Object.keys(PARTICIPANT_SHELL_SOURCES).reduce((total, name) => total + assets.get(name).length, 0);
  insist(shellBytes <= PARTICIPANT_SHELL_BUDGET, 'Participant runtime exceeds reviewed 499KiB account-client budget.');
  return shellBytes;
}

export async function collectParticipantAssets(root = repositoryRoot, environment = process.env) {
  root = resolve(root);
  await assertUnlinkedParents(join(root, 'input'));
  const sourceRoot = join(root, 'web/apps/non-verba/src');
  await assertUnlinkedParents(join(sourceRoot, 'input'));
  const sourceEntries = await readdir(sourceRoot, {withFileTypes:true});
  const expectedSourceNames = Object.values(PARTICIPANT_SHELL_SOURCES)
    .filter(source => source.startsWith('web/apps/non-verba/src/'))
    .map(source => source.slice('web/apps/non-verba/src/'.length));
  insist(sourceEntries.length === expectedSourceNames.length && sourceEntries.every(item => item.isFile()
    && !item.isSymbolicLink() && expectedSourceNames.includes(item.name)), 'Participant source file set differs from the reviewed UI/client files.');
  const assets = new Map();
  for (const [name, source] of Object.entries(PARTICIPANT_SHELL_SOURCES)) {
    assets.set(name, await readBoundedParticipantFile(join(root, source), /\.(?:webp|svg)$/.test(name)
      ? PARTICIPANT_IMAGE_BUDGET : PARTICIPANT_SHELL_BUDGET));
  }
  for (const [name, bytes] of await collectReleaseNotices(root, environment)) assets.set('nonverba-license/' + name, bytes);
  assertParticipantAssetNames(assets);
  return assets;
}

function expectedDirectories(assets) {
  const directories = new Set();
  for (const name of assets.keys()) {
    let parent = dirname(name);
    while (parent !== '.') { directories.add(parent.split(sep).join('/')); parent = dirname(parent); }
  }
  return directories;
}

// Read-only closure check shared by staging and package inspection. Unexpected
// outputs are preserved and reported; nothing is recursively removed.
export async function inspectParticipantStage(root, assets, {allowMissing = false, compareBytes = true} = {}) {
  assertParticipantAssetNames(assets);
  await assertUnlinkedParents(root);
  try { await assertUnlinkedDirectory(root); }
  catch (error) { if (allowMissing && error.code === 'ENOENT') return new Map(); throw error; }
  const directories = expectedDirectories(assets), actual = new Map();
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, {withFileTypes:true})) {
      const name = prefix + entry.name, file = join(directory, entry.name);
      insist(!entry.isSymbolicLink(), 'Linked participant stage output: ' + name);
      if (entry.isDirectory()) {
        insist(directories.has(name), 'Unexpected participant stage directory: ' + name);
        await assertUnlinkedDirectory(file);
        await visit(file, name + '/');
      } else {
        insist(entry.isFile() && assets.has(name), 'Unexpected participant stage output: ' + name);
        const bytes = await readBoundedParticipantFile(file, 16 * 1024 * 1024);
        insist(!compareBytes || bytes.equals(assets.get(name)), 'Participant staged bytes differ from source: ' + name);
        actual.set(name, bytes);
      }
    }
  }
  await visit(root);
  if (!allowMissing) for (const name of assets.keys()) insist(actual.has(name), 'Missing participant staged asset: ' + name);
  return actual;
}

export function assertSameParticipantAssets(expected, actual) {
  insist(expected.size === actual.size && [...expected].every(([name, bytes]) => actual.has(name) && bytes.equals(actual.get(name))),
    'Participant source or notice bytes changed during packaging.');
}

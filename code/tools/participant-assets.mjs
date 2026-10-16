// SPDX-License-Identifier: AGPL-3.0-only
// Closed, source-only asset set for the initial participant shell.
import {constants} from 'node:fs';
import {lstat, open, readdir} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectReleaseNotices} from './release-notices.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const insist = (condition, message) => { if (!condition) throw new Error(message); };
export const PARTICIPANT_SHELL_BUDGET = 64 * 1024;
export const PARTICIPANT_STAGE = '/opt/nonverba-build/android/participant/build/generated/participant-assets';
export const PARTICIPANT_SHELL_SOURCES = Object.freeze({
  'participant/index.html': 'web/participant/src/index.html',
  'participant/participant.css': 'web/participant/src/participant.css',
  'participant/participant.js': 'web/participant/src/participant.js',
  'participant/branding/sprout.svg': 'web/site/branding/sprout.svg',
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
  }
  for (const name of Object.keys(PARTICIPANT_SHELL_SOURCES)) insist(assets.has(name), 'Missing participant shell asset: ' + name);
  for (const name of ['LICENSE.txt', 'SOURCE.txt']) insist(assets.has('nonverba-license/' + name), 'Missing participant notice: ' + name);
  const shellBytes = Object.keys(PARTICIPANT_SHELL_SOURCES).reduce((total, name) => total + assets.get(name).length, 0);
  insist(shellBytes <= PARTICIPANT_SHELL_BUDGET, 'Participant shell exceeds 64KiB budget.');
  return shellBytes;
}

export async function collectParticipantAssets(root = repositoryRoot, environment = process.env) {
  root = resolve(root);
  await assertUnlinkedParents(join(root, 'input'));
  const sourceRoot = join(root, 'web/participant/src');
  await assertUnlinkedParents(join(sourceRoot, 'input'));
  const sourceEntries = await readdir(sourceRoot, {withFileTypes:true});
  const expectedSourceNames = ['index.html', 'participant.css', 'participant.js'];
  insist(sourceEntries.length === expectedSourceNames.length && sourceEntries.every(item => item.isFile()
    && !item.isSymbolicLink() && expectedSourceNames.includes(item.name)), 'Participant source file set differs from the three reviewed shell files.');
  const assets = new Map();
  for (const [name, source] of Object.entries(PARTICIPANT_SHELL_SOURCES)) {
    assets.set(name, await readBoundedParticipantFile(join(root, source)));
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

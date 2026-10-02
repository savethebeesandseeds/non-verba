// SPDX-License-Identifier: AGPL-3.0-only
// Notices for binary releases. These do not certify a build or sensor behavior.
import {lstat, readdir, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repository = 'https://github.com/savethebeesandseeds/non-verba';
const insist = (condition, message) => { if (!condition) throw new Error(message); };

export function sourceNotice(environment = process.env) {
  const revision = environment.NONVERBA_SOURCE_REVISION || '';
  const snapshot = environment.NONVERBA_SOURCE_SNAPSHOT_SHA256 || '';
  const state = environment.NONVERBA_SOURCE_DIRTY;
  insist(!revision || /^[a-f0-9]{40}$/.test(revision), 'Invalid source revision.');
  insist(!snapshot || /^[a-f0-9]{64}$/.test(snapshot), 'Invalid source snapshot digest.');
  insist(state === undefined || state === '0' || state === '1', 'Invalid source worktree state.');
  const exact = Boolean(revision) && state === '0';
  return Buffer.from([
    'Non-verba source and license',
    'Project-owned code: AGPL-3.0-only. See LICENSE.txt and third-party notices.',
    `Source repository: ${repository}`,
    `Base revision: ${revision || 'unspecified'}`,
    `Working tree: ${state === '0' ? 'clean' : state === '1' ? 'modified development snapshot' : 'unspecified development build'}`,
    ...(snapshot ? [`Source snapshot archive SHA-256: ${snapshot}`] : []),
    ...(exact ? [`Corresponding source revision: ${repository}/tree/${revision}`] : [
      'This is a development build; the base repository revision alone may not contain its complete matching source.',
      'Before distributing this binary, provide its complete corresponding source under AGPL-3.0-only.',
    ]),
    'This release does not include release signing keys, deployment credentials or personal evidence.',
    'A source notice does not establish reproducibility, authentic sensor input or conformance.',
    '',
  ].join('\n'));
}

export async function collectReleaseNotices(repositoryRoot = root, environment = process.env) {
  const notices = new Map();
  async function bytes(file) {
    const item = await lstat(file);
    insist(item.isFile() && !item.isSymbolicLink() && item.size <= 16 * 1024 * 1024,
      'Expected bounded regular license/notice file: ' + file);
    return readFile(file);
  }
  notices.set('LICENSE.txt', await bytes(join(repositoryRoot, 'LICENSE')));
  notices.set('SOURCE.txt', sourceNotice(environment));
  const licenses = join(repositoryRoot, 'LICENSES');
  async function visit(directory, prefix = '') {
    const item = await lstat(directory);
    insist(item.isDirectory() && !item.isSymbolicLink(), 'Linked license directory is unsupported.');
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const name = prefix + entry.name, path = join(directory, entry.name);
      insist(!entry.isSymbolicLink(), 'Linked license notice is unsupported.');
      if (entry.isDirectory()) await visit(path, name + '/');
      else notices.set('LICENSES/' + name, await bytes(path));
    }
  }
  await visit(licenses);
  const inventory = join(repositoryRoot, 'THIRD_PARTY_NOTICES.md');
  try { notices.set('THIRD_PARTY_NOTICES.md', await bytes(inventory)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return notices;
}

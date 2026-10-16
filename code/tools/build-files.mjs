// SPDX-License-Identifier: AGPL-3.0-only
// Generated-file staging: preserve unchanged mtimes; refuse stale outputs.
import {lstat, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

export async function collectBuildFiles(root, {ignore = () => false, allowMissing = false} = {}) {
  const files = new Map();
  async function visit(directory, prefix = '') {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Expected build directory: ' + directory);
    for (const entry of await readdir(directory, {withFileTypes:true})) {
      const name = prefix + entry.name, file = join(directory, entry.name);
      if (ignore(name)) continue;
      if (entry.isSymbolicLink()) throw new Error('Linked build output: ' + file);
      if (entry.isDirectory()) await visit(file, name + '/');
      else {
        if (!entry.isFile()) throw new Error('Expected regular build file: ' + file);
        files.set(name, await readFile(file));
      }
    }
  }
  try { await visit(root); }
  catch (error) { if (!allowMissing || error.code !== 'ENOENT') throw error; }
  return files;
}

export async function stageBuildFiles(root, expected, {ignore = () => false} = {}) {
  for (const [name, bytes] of expected) {
    if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')
        || !Buffer.isBuffer(bytes)) throw new Error('Invalid generated build file: ' + name);
  }
  const current = await collectBuildFiles(root, {ignore, allowMissing:true});
  const stale = [...current.keys()].filter(name => !expected.has(name));
  if (stale.length) throw new Error('Unexpected generated files; preserve and review before retrying: ' + stale.map(name => join(root, name)).join(', '));
  let changed = 0;
  for (const [name, bytes] of expected) {
    if (current.get(name)?.equals(bytes)) continue;
    const destination = join(root, name);
    await mkdir(dirname(destination), {recursive:true});
    await writeFile(destination, bytes);
    changed++;
  }
  return {files:expected.size, changed};
}

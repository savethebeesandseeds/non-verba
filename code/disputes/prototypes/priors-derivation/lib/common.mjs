// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';

export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error('Only finite JSON values can enter a research manifest');
}
export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function digest(value) { return sha256(canonical(value)); }
export function stableId(prefix, value) { return `${prefix}-${digest(value).slice(0, 20)}`; }
export function within(root, name) {
  const path = resolve(root, name); const rel = relative(resolve(root), path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Artifact path must be a child of its run directory');
  return path;
}
export async function writeJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  return { path, sha256: sha256(await readFile(path)), canonical_sha256: digest(value) };
}
export async function readJSON(path) { return JSON.parse(await readFile(path, 'utf8')); }
export function requireContainer() {
  if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run this prototype only in the documented managed Debian container');
}
export async function regularFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular unlinked artifact: ${path}`);
  return stat;
}
export function args(argv) {
  const values = {};
  for (const arg of argv) {
    const match = /^--([a-z][a-z-]*)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(values, match[1])) throw new Error(`Expected unique --name=value arguments: ${arg}`);
    values[match[1]] = match[2];
  }
  return values;
}

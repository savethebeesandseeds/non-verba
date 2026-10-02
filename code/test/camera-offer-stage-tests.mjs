// SPDX-License-Identifier: AGPL-3.0-only
// Execute the exact fixed Android staging shell under Linux against isolated
// scratch cache directories. This does not replace an actual USB/run-as check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, mkdtemp, rm, writeFile, symlink, stat, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run inside non-verba-dev.');
const source = (await readFile(new URL('../tools/camera-offer-stage.sh', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const token = 'a'.repeat(32), relative = `cache/camera-pairing/${token}.json`;
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nonverba-camera-offer-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  await mkdir(join(root, 'cache'));
  return {root, file:join(root, relative), stage:(bytes, id=token) => {
    assert.match(id, /^[a-f0-9]{32}$/);
    return spawnSync('/bin/sh', ['-c', source.replaceAll('@TOKEN@', id)], {cwd:root, input:bytes, encoding:'utf8', timeout:5000});
  }};
}
test('exact binary stdin is retained readonly with its hash; shell text stays data', async t => {
  const f = await fixture(t), bytes = Buffer.from('{"label":"Unicode café 🐝; $(touch escaped); `touch escaped`; \'quotes\'"}\r\n');
  const result = f.stage(bytes);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(f.file), bytes);
  assert.equal(result.stdout.trim(), `${createHash('sha256').update(bytes).digest('hex')}  ${relative}`);
  assert.equal((await stat(f.file)).mode & 0o777, 0o400);
  assert.deepEqual(await readdir(f.root), ['cache']);
  const again = f.stage(Buffer.from('replacement'));
  assert.notEqual(again.status, 0); assert.deepEqual(await readFile(f.file), bytes);
});
test('120000-byte limit is inclusive and oversize/empty partials stay unaccepted', async t => {
  const f = await fixture(t);
  assert.equal(f.stage(Buffer.alloc(120000, 65)).status, 0);
  const large = f.stage(Buffer.alloc(140000, 66), 'b'.repeat(32));
  assert.notEqual(large.status, 0); assert.equal(large.stdout, '');
  assert.equal((await stat(join(f.root, `cache/camera-pairing/${'b'.repeat(32)}.json`))).size, 120001);
  assert.notEqual(f.stage(Buffer.alloc(0), 'c'.repeat(32)).status, 0);
});
for (const link of ['cache', 'cache/camera-pairing', relative]) test(`rejects symlink at ${link} without touching target`, async t => {
  const f = await fixture(t), elsewhere = join(f.root, 'elsewhere');
  await mkdir(elsewhere); await writeFile(join(elsewhere, 'original'), 'keep');
  if (link === 'cache') await rm(join(f.root, 'cache'), {recursive:true});
  if (link === relative) await mkdir(join(f.root, 'cache/camera-pairing'));
  await symlink(elsewhere, join(f.root, link));
  assert.notEqual(f.stage(Buffer.from('replacement')).status, 0);
  assert.deepEqual(await readdir(elsewhere), ['original']);
  assert.equal(await readFile(join(elsewhere, 'original'), 'utf8'), 'keep');
});
test('32-slot bound counts partials and refuses a 33rd file without deleting any', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'cache/camera-pairing'));
  for (let n = 0; n < 32; n++) await writeFile(join(f.root, `cache/camera-pairing/${n}.partial`), 'keep');
  assert.notEqual(f.stage(Buffer.from('new')).status, 0);
  assert.equal((await readdir(join(f.root, 'cache/camera-pairing'))).length, 32);
});

// SPDX-License-Identifier: AGPL-3.0-only
// Execute the actual USB helper's fixed remote shell templates against tiny
// invocation-owned Linux fixtures. This does not execute PowerShell, ADB or
// Android toybox, nor grant acoustic, signature or acceptance verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, mkdtemp, rm, rmdir, writeFile, symlink, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run inside non-verba-dev.');
if (process.argv.length !== 3) throw new Error('Supply the explicit reviewed usb-device.ps1 source path.');
const sourcePath = resolve(process.argv[2]);
const source = (await readFile(sourcePath, 'utf8')).replaceAll('\r\n', '\n');
function extract(pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `Actual helper ${label} template missing or changed; inspect source before adapting this check.`);
  return match[1];
}
const rootGuard = extract(/\$rootGuard = '([^'\n]+)'/, 'root guard');
const fileGuard = extract(/\$guard = "([^"\n]+test -f \$remotePath[^"\n]+)"/, 'regular-file guard');
const inventory = extract(/\$command = "(\$rootGuard && find cache\/exports[^"\n]+head -n \$inventoryLimit)"/, 'inventory');
const size = extract(/\$command = "(\$guard && stat -c %s \$remotePath)"/, 'stat');
const bytes = extract(/\$command = "(\$guard && head -c \$\(\$maximum \+ 1\) \$remotePath \| base64)"/, 'bounded bytes');
const digest = extract(/"(\$guard && head -c \$\(\$maximum \+ 1\) \$remotePath \| sha256sum)"/, 'bounded hash');
assert.equal([...source.matchAll(/"\$guard && head -c \$\(\$maximum \+ 1\) \$remotePath \| sha256sum"/g)].length, 2,
  'Both actual before/after audio hashes must use bounded reads.');
const downloads = extract(/\$command = '([^'\n]+UNSAFE_LINK[^'\n]+)' -f \$remoteFile,\$expectedFile.maximum,\(\$expectedFile.maximum \+ 1\)/, 'exact Downloads');
const uuid = '11111111-1111-4111-8111-111111111111';
const name = 'nonverba-demo-audio-aaaaaaaaaaaa.wav';
const folder = `cache/exports/${uuid}`, remotePath = `${folder}/${name}`;
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nonverba-audio-export-guard-'));
  assert.match(root, /^\/[A-Za-z0-9/_-]+$/);
  t.after(() => rm(root, {recursive:true, force:true}));
  await mkdir(join(root, folder), {recursive:true});
  const expand = (template, maximum=64) => {
    let result = template.replaceAll('$guard', fileGuard).replaceAll('$rootGuard', rootGuard)
      .replaceAll('$($maximum + 1)', String(maximum + 1)).replaceAll('$remotePath', remotePath)
      .replaceAll('$folder', folder).replaceAll('$inventoryLimit', '17')
      .replaceAll('$findName', 'nonverba-demo-audio-????????????.wav'.replaceAll('?', '\\?'));
    assert.ok(!result.includes('$'), 'Unexpanded helper variable in fixture shell.');
    return result;
  };
  const run = command => {
    const result = spawnSync('/bin/sh', ['-c', command], {cwd:root, encoding:'utf8', timeout:5000, maxBuffer:65536});
    assert.equal(result.error, undefined);
    return result;
  };
  return {root, file:join(root, remotePath), read:(template, maximum) => run(expand(template, maximum)),
    downloads:(maximum=64) => {
      const publicPath = `${root}/storage/emulated/0/Download/Non-verba/${name}`;
      const command = downloads.replaceAll('/storage', `${root}/storage`).replaceAll('{0}', publicPath)
        .replaceAll('{1}', String(maximum)).replaceAll('{2}', String(maximum + 1));
      return run(command);
    }, publicDirectory:join(root,'storage/emulated/0/Download/Non-verba')};
}
test('actual stat, bounded bytes and both hash reads retain exact binary bytes', async t => {
  const f = await fixture(t), original = Buffer.from([0,255,195,169,10,0,92,39]);
  await writeFile(f.file, original);
  assert.equal(f.read(size).stdout.trim(), String(original.length));
  const encoded = f.read(bytes); assert.equal(encoded.status, 0);
  assert.deepEqual(Buffer.from(encoded.stdout.replaceAll('\n',''), 'base64'), original);
  assert.equal(f.read(digest).stdout.trim(), `${hash(original)}  -`);
  assert.deepEqual(await readFile(f.file), original);
});
test('actual maximum+1 byte and hash reads remain bounded after file growth', async t => {
  const f = await fixture(t); await writeFile(f.file, Buffer.alloc(64, 65));
  const before = f.read(digest).stdout.trim();
  assert.equal(f.read(size).stdout.trim(), '64');
  await writeFile(f.file, Buffer.alloc(1024, 66));
  const encoded = f.read(bytes), bounded = Buffer.from(encoded.stdout.replaceAll('\n',''), 'base64');
  assert.equal(encoded.status, 0); assert.equal(bounded.length, 65);
  assert.deepEqual(bounded, Buffer.alloc(65, 66));
  assert.equal(f.read(digest).stdout.trim(), `${hash(bounded)}  -`);
  assert.notEqual(f.read(digest).stdout.trim(), before);
});
test('actual digest catches same-size replacement between reads', async t => {
  const f = await fixture(t); await writeFile(f.file, Buffer.from('original'));
  const before = f.read(digest).stdout.trim();
  await writeFile(f.file, Buffer.from('replaced'));
  assert.equal(f.read(size).stdout.trim(), '8');
  assert.notEqual(f.read(digest).stdout.trim(), before);
});
for (const link of ['cache','cache/exports',folder,remotePath]) test(`actual file/root guards reject symlink ${link}`, async t => {
  const f = await fixture(t), target = join(f.root,'elsewhere');
  await mkdir(target); await writeFile(join(target,'keep'), 'unchanged');
  await rm(join(f.root,link), {recursive:true, force:true});
  await symlink(target,join(f.root,link));
  for (const command of [size,bytes,digest]) {
    const result = f.read(command);
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  }
  assert.deepEqual(await readdir(target), ['keep']);
  assert.equal(await readFile(join(target,'keep'),'utf8'), 'unchanged');
});
test('actual find does not follow linked files/directories and caps overflow at 17 entries', async t => {
  const f = await fixture(t), elsewhere = join(f.root,'elsewhere');
  await mkdir(elsewhere); await writeFile(join(elsewhere,name), 'unrelated');
  await symlink(elsewhere,join(f.root,'cache/exports/22222222-2222-4222-8222-222222222222'));
  await symlink(join(elsewhere,name),f.file);
  assert.equal(f.read(inventory).stdout, '');
  await rm(f.file);
  for (let index = 0; index < 18; index++) await writeFile(join(f.root,folder,`nonverba-demo-audio-${index.toString(16).padStart(12,'0')}.wav`), 'saved');
  const lines = f.read(inventory).stdout.trim().split('\n');
  assert.equal(lines.length, 17); assert.equal(new Set(lines).size, 17);
  assert.equal((await readdir(join(f.root,folder))).length, 18);
  assert.equal(await readFile(join(elsewhere,name),'utf8'), 'unrelated');
});
test('actual exact Downloads command checks unchanged bytes and refuses oversize/missing/link paths', async t => {
  const f = await fixture(t), original = Buffer.from('saved bytes');
  await mkdir(f.publicDirectory, {recursive:true}); const file = join(f.publicDirectory,name);
  await writeFile(file,original);
  assert.deepEqual(f.downloads().stdout.trim().split('\n'), ['FILE',String(original.length),`${hash(original)}  -`,String(original.length)]);
  await writeFile(file, Buffer.alloc(65,65)); assert.equal(f.downloads().stdout.trim(), 'OVERSIZED');
  await rm(file); assert.equal(f.downloads().stdout.trim(), 'MISSING_OR_INACCESSIBLE_FILE');
  await symlink(f.file,file); assert.equal(f.downloads().stdout.trim(), 'UNSAFE_LINK');
  await rm(file); await rmdir(f.publicDirectory);
  assert.equal(f.downloads().stdout.trim(), 'MISSING_OR_INACCESSIBLE_DIRECTORY');
  await mkdir(join(f.root,'elsewhere')); await symlink(join(f.root,'elsewhere'),f.publicDirectory);
  assert.equal(f.downloads().stdout.trim(), 'UNSAFE_LINK');
});

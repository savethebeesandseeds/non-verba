// SPDX-License-Identifier: AGPL-3.0-only
// Execute the real orchestration with tiny synthetic tool outputs. These tests
// never invoke a compiler, Gradle, an APK inspector, or an Android device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

assert.equal(process.platform, 'linux', 'Run only inside non-verba-dev.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Run only inside non-verba-dev.');
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const absent = async path => access(path).then(() => false, error => {
  if (error.code === 'ENOENT') return true;
  throw error;
});

// A separate process records external effects. The record helper itself runs
// unchanged under the real Node executable; every build tool is substituted.
const fakeTool = String.raw`
import {spawnSync} from 'node:child_process';
import {appendFile, cp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
const [command, ...args] = process.argv.slice(2);
const root = process.env.FIXTURE_ROOT, code = join(root, 'repo/code');
const build = join(root, 'cache'), ledger = join(root, 'events.jsonl');
const exists = async path => stat(path).then(() => true, e => {
  if (e.code === 'ENOENT') return false;
  throw e;
});
async function put(path, bytes) {
  await mkdir(dirname(path), {recursive:true});
  if (await exists(path) && (await readFile(path)).equals(Buffer.from(bytes))) return;
  await writeFile(path, bytes);
}
if (command === 'node' && basename(args[0] || '') === 'android-build-record.mjs') {
  const result = spawnSync(process.env.REAL_NODE, args, {stdio:'inherit', env:process.env});
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
await appendFile(ledger, JSON.stringify({command, args, cwd:process.cwd()}) + '\n');
const fail = process.env.FIXTURE_FAIL;
const script = command === 'node' ? basename(args[0] || '') : command;
if (fail === script || (fail === 'inspector' && script.startsWith('verify-'))) process.exit(42);
if (process.env.FIXTURE_HOLD_MARKER && command === (process.env.FIXTURE_HOLD_COMMAND || 'gradle')) {
  await put(process.env.FIXTURE_HOLD_MARKER, 'entered\n');
  const until = Date.now() + 8000;
  while (!(await exists(process.env.FIXTURE_RELEASE))) {
    if (Date.now() > until) throw new Error('Timed out waiting for fixture release.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
if (command === 'node') {
  if (process.env.FIXTURE_REAL_WEB === '1' && ['build-web.mjs', 'stage-android.mjs'].includes(script)) {
    const stdio = ['inherit', 'inherit', 'inherit'];
    if (await exists('/proc/self/fd/9')) {
      while (stdio.length < 9) stdio.push('ignore');
      stdio[9] = 9;
    }
    const result = spawnSync(process.env.REAL_NODE, args, {stdio, env:process.env});
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
  if (script === 'build-web.mjs') {
    await put(join(root, 'repo/web/dist/index.html'), 'synthetic developer page\n');
    await put(join(root, 'repo/web/dist/pkg/nonverba_core_bg.wasm'), 'synthetic WASM\n');
  } else if (script === 'stage-android.mjs') {
    await cp(join(root, 'repo/web/dist'), join(code, 'android/app/src/main/assets/web'), {recursive:true, preserveTimestamps:true});
  } else if (script === 'stage-participant.mjs') {
    await put(join(build, 'android/participant/build/generated/participant-assets/participant/index.html'), 'synthetic participant page\n');
  } else if (script.startsWith('verify-')) {
    const apk = args[args.indexOf('--apk') + 1];
    if (!apk || !(await exists(apk))) throw new Error('Inspector was not given an existing exact APK path.');
    console.log(JSON.stringify({passed:true, apk_path:apk}));
  } else throw new Error('Unexpected Node build prerequisite: ' + args.join(' '));
} else if (command === 'cargo') {
  const target = args[args.indexOf('--target') + 1];
  const pkg = args[args.indexOf('-p') + 1];
  if (pkg === 'nonverba-cooperation') throw new Error('Cooperation must not be an Android prerequisite.');
  if (pkg === 'nonverba-android') await put(join(build, 'target', target, 'release/libnonverba_android.so'), process.env.FIXTURE_NATIVE_BYTES || 'synthetic native library\n');
  else if (pkg === 'nonverba-core') await put(join(build, 'target', target, 'release/nonverba_core.wasm'), 'synthetic core WASM\n');
  else throw new Error('Unexpected Cargo package: ' + pkg);
} else if (command === 'wasm-bindgen') {
  if (args.length === 1 && args[0] === '--version') {
    console.log('wasm-bindgen ' + (process.env.FIXTURE_BINDGEN_VERSION || '0.2.122'));
    process.exit(0);
  }
  const destination = resolve(code, args[args.indexOf('--out-dir') + 1]);
  const name = args[args.indexOf('--out-name') + 1];
  await put(join(destination, name + '.js'), 'export const synthetic = true;\n');
  await put(join(destination, name + '_bg.wasm'), 'synthetic bound WASM\n');
} else if (command === 'rsync') {
  const patterns = [], operands = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exclude') patterns.push(args[++i]);
    else if (args[i].startsWith('--exclude=')) patterns.push(args[i].slice('--exclude='.length));
    else if (!args[i].startsWith('-')) operands.push(args[i]);
  }
  const destination = resolve(operands.pop());
  if (!destination.startsWith(root + '/')) throw new Error('rsync escaped fixture.');
  const excluded = name => patterns.some(p => p.replace(/^['"]|['"]$/g, '').replace(/\/$/, '') === name);
  async function sync(from, to) {
    await mkdir(to, {recursive:true});
    const entries = await readdir(from, {withFileTypes:true}), names = new Set(entries.map(e => e.name));
    if (args.includes('--delete')) {
      for (const item of await readdir(to)) {
        if (!names.has(item) && !excluded(item)) await rm(join(to, item), {recursive:true, force:true});
      }
    }
    for (const entry of entries) {
      if (excluded(entry.name)) continue;
      if (entry.isDirectory()) await sync(join(from, entry.name), join(to, entry.name));
      else await cp(join(from, entry.name), join(to, entry.name), {preserveTimestamps:true});
    }
  }
  for (const operand of operands) {
    const source = resolve(operand);
    if (!source.startsWith(root + '/')) throw new Error('rsync escaped fixture.');
    if ((await stat(source)).isDirectory()) await sync(source, destination);
    else {
      await mkdir(destination, {recursive:true});
      await cp(source, join(destination, basename(source)), {preserveTimestamps:true});
    }
  }
} else if (command === 'gradle') {
  const android = args[args.indexOf('-p') + 1];
  if (!android || !android.startsWith(root + '/')) throw new Error('Gradle escaped fixture.');
  for (const module of ['app', 'participant']) {
    if (!args.includes(':' + module + ':assembleDebug')) continue;
    const apk = join(android, module, 'build/outputs/apk/debug/' + module + '-debug.apk');
    const upToDate = await exists(apk);
    await put(apk, 'synthetic non-installable ' + module + ' package\n');
    await put(join(android, module, 'build/reports/lint-results-debug.html'), '<p>synthetic lint result</p>\n');
    for (const task of ['assembleDebug', 'lintDebug']) console.log('> Task :' + module + ':' + task + (upToDate ? ' UP-TO-DATE' : ''));
  }
  console.log('BUILD SUCCESSFUL');
} else if (command === 'apksigner') {
  console.log('Number of signers: 1\nSigner #1 certificate DN: CN=Android Debug, O=Android, C=US\nSigner #1 certificate SHA-256 digest: ' + 'a'.repeat(64));
} else throw new Error('Unexpected fixture tool: ' + command);
`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nonverba-android-build-'));
  // This unique, synthetic fixture is the only directory these tests remove.
  t.after(() => rm(root, {recursive:true, force:true}));
  const code = join(root, 'repo/code'), cache = join(root, 'cache');
  const put = async (path, bytes) => { await mkdir(dirname(path), {recursive:true}); await writeFile(path, bytes); };
  for (const name of ['dev.sh', 'tools/build-android.sh', 'tools/build-android-native.sh', 'tools/android-build-record.mjs', 'tools/android-build-metrics.mjs', 'tools/android-build-lock.sh', 'tools/android-build-lock.mjs']) {
    await mkdir(dirname(join(code, name)), {recursive:true});
    await copyFile(join(sourceRoot, name), join(code, name));
  }
  for (const name of ['settings.gradle.kts', 'build.gradle.kts', 'gradle.properties', 'app/build.gradle.kts', 'participant/build.gradle.kts']) {
    await put(join(code, 'android', name), '// synthetic source ' + name + '\n');
  }
  for (const module of ['app', 'participant']) {
    await put(join(code, 'android', module, 'src/main/owned-source.txt'), 'source ' + module + '\n');
  }
  await put(join(code, 'Cargo.lock'), '# synthetic lockfile\n');
  await put(join(code, 'android/.toolchain/android-user/debug.keystore'), 'synthetic retained signer\n');
  const signer = join(cache, 'signer/debug.keystore');
  await put(signer, 'synthetic retained signer\n');
  const sdk = join(root, 'sdk'), ndk = join(sdk, 'ndk/30.0.16248370');
  await put(join(ndk, 'source.properties'), 'Pkg.Revision = 30.0.16248370\n');
  await put(join(root, 'baseline.json'), JSON.stringify({signing_certificate_sha256:'a'.repeat(64)}));
  await put(join(root, 'fake-tool.mjs'), fakeTool);
  const bin = join(root, 'bin');
  const wrapper = name => '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(join(root, 'fake-tool.mjs')) + ' ' + quote(name) + ' "$@"\n';
  for (const name of ['node', 'cargo', 'wasm-bindgen', 'gradle', 'rsync']) {
    await put(join(bin, name), wrapper(name));
    await chmod(join(bin, name), 0o755);
  }
  await put(join(sdk, 'build-tools/36.0.0/apksigner'), wrapper('apksigner'));
  await chmod(join(sdk, 'build-tools/36.0.0/apksigner'), 0o755);
  const environment = {
    NONVERBA_CONTAINER:'1', NONVERBA_BUILD_ROOT:cache,
    NONVERBA_ANDROID_DEBUG_KEYSTORE:signer,
    CARGO_TARGET_DIR:join(cache, 'target'), ANDROID_HOME:sdk,
    ANDROID_NDK_HOME:ndk, CMAKE_HOME:join(root, 'cmake'),
    FIXTURE_ROOT:root, REAL_NODE:process.execPath,
  };
  await put(join(code, 'container/env.sh'), Object.entries(environment).map(([key, value]) => 'export ' + key + '=' + quote(value)).join('\n')
    + '\nexport PATH=' + quote(bin) + ':"$PATH"\n');
  const env = {...process.env, ...environment, PATH:bin + ':' + process.env.PATH};
  async function events() {
    if (await absent(join(root, 'events.jsonl'))) return [];
    return (await readFile(join(root, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  async function records() {
    const qa = join(code, 'artifacts/qa');
    if (await absent(qa)) return [];
    const names = (await readdir(qa)).filter(name => /^android-build-.*\.json$/.test(name)).sort();
    return Promise.all(names.map(async name => JSON.parse(await readFile(join(qa, name), 'utf8'))));
  }
  function execute(command, args, extraEnv = {}) {
    return new Promise((resolveResult, reject) => {
      const child = spawn(command, args, {cwd:code, env:{...env, ...extraEnv}, stdio:['ignore', 'pipe', 'pipe']});
      let stdout = '', stderr = '';
      child.stdout.on('data', bytes => { stdout += bytes; });
      child.stderr.on('data', bytes => { stderr += bytes; });
      child.on('error', reject);
      const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Fixture build timed out.\n' + stdout + stderr)); }, 20000);
      child.on('close', (status, signal) => { clearTimeout(timeout); resolveResult({status, signal, stdout, stderr}); });
    });
  }
  const run = (args, extraEnv = {}) => execute('bash', ['dev.sh', 'build', ...args], extraEnv);
  const runNode = (args, extraEnv = {}) => execute(process.execPath, args, extraEnv);
  const runBash = (args, extraEnv = {}) => execute('bash', args, extraEnv);
  return {root, code, cache, put, run, runNode, runBash, events, records};
}

function succeeded(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function gradleTasks(event) { return event.args.filter(arg => /^:(?:app|participant):/.test(arg)); }
const tasksFor = target => [
  ...(target === 'participant' ? [] : [':app:assembleDebug', ':app:lintDebug']),
  ...(target === 'developer' ? [] : [':participant:assembleDebug', ':participant:lintDebug']),
];
async function exportsFor(f) {
  const root = join(f.code, 'artifacts/container-builds');
  return await absent(root) ? [] : (await readdir(root)).map(name => join(root, name));
}
async function waitFor(path) {
  const until = Date.now() + 10000;
  while (await absent(path)) {
    assert.ok(Date.now() < until, 'Timed out waiting for fixture handshake: ' + path);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('build requires an explicit target and valid export flags before any work', async t => {
  const f = await fixture(t);
  for (const args of [[], ['unknown'], ['participant', 'extra'], ['participant', '--unknown'],
    ['participant', '--export'], ['participant', '--export', '--baseline-report'],
    ['participant', '--baseline-report', join(f.root, 'baseline.json')],
    ['participant', '--export', '--export', '--baseline-report', join(f.root, 'baseline.json')],
    ['participant', '--export', '--baseline-report', join(f.root, 'absent-baseline.json')]]) {
    const result = await f.run(args);
    assert.equal(result.status, 2, JSON.stringify(args) + '\n' + result.stdout + result.stderr);
    assert.deepEqual(await f.events(), []);
    assert.deepEqual(await f.records(), []);
    assert.deepEqual(await exportsFor(f), []);
    assert.ok(await absent(join(f.cache, 'locks')));
    assert.ok(await absent(join(f.cache, 'android')));
  }
});

for (const target of ['participant', 'developer', 'all']) {
  test(target + ' invokes only its declared prerequisite and Gradle graph', async t => {
    const f = await fixture(t);
    succeeded(await f.run([target]));
    const events = await f.events(), nodeScripts = events.filter(e => e.command === 'node').map(e => basename(e.args[0]));
    assert.deepEqual(nodeScripts, [
      ...(target === 'participant' ? [] : ['build-web.mjs', 'stage-android.mjs']),
      ...(target === 'developer' ? [] : ['stage-participant.mjs']),
    ]);
    const cargo = events.filter(e => e.command === 'cargo');
    assert.equal(cargo.length, target === 'participant' ? 0 : 2);
    assert.ok(cargo.every(e => e.args[e.args.indexOf('-p') + 1] === 'nonverba-android'));
    for (const event of events.filter(e => e.command === 'node' && basename(e.args[0]) === 'build-web.mjs')) {
      assert.deepEqual(event.args.slice(1), ['--android']);
    }
    const gradle = events.filter(e => e.command === 'gradle');
    assert.equal(gradle.length, 1);
    assert.ok(gradle[0].args.includes('-Pnonverba.target=' + target));
    assert.deepEqual(gradleTasks(gradle[0]), tasksFor(target));
    assert.deepEqual(await exportsFor(f), []);
    const records = await f.records();
    assert.equal(records.length, 1);
    assert.equal(records[0].target, target);
    assert.equal(records[0].state, 'completed');
    assert.ok(records[0].stages.length > 0);
    assert.ok(records[0].stages.every(s => s.status === 'passed' && s.duration_ms >= 0));
    assert.equal(records[0].packages.length, target === 'all' ? 2 : 1);
    assert.ok(records[0].packages.every(p => p.path.startsWith(join(f.cache, 'android') + '/') && p.bytes > 0 && /^[a-f0-9]{64}$/.test(p.sha256)));
  });
}

test('selected builds preserve the unselected module source and cached outputs', async t => {
  for (const target of ['developer', 'participant']) {
    const f = await fixture(t), unselected = target === 'developer' ? 'participant' : 'app';
    const path = join(f.cache, 'android', unselected, 'src/main/owned-source.txt');
    const cached = join(f.cache, 'android', unselected, 'build/retained-output.txt');
    await f.put(path, 'retained unselected source\n');
    await f.put(cached, 'retained unselected output\n');
    const before = await stat(cached, {bigint:true});
    succeeded(await f.run([target]));
    assert.equal(await readFile(path, 'utf8'), 'retained unselected source\n');
    assert.equal(await readFile(cached, 'utf8'), 'retained unselected output\n');
    assert.equal((await stat(cached, {bigint:true})).mtimeNs, before.mtimeNs);
  }
});

test('missing retained signer fails before preparation without using the legacy source key', async t => {
  const f = await fixture(t), retained = join(f.cache, 'signer/debug.keystore');
  const legacy = join(f.code, 'android/.toolchain/android-user/debug.keystore');
  const originalLegacy = await readFile(legacy);
  await rm(retained);
  const result = await f.run(['developer']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(await f.events(), []);
  assert.deepEqual(await exportsFor(f), []);
  assert.ok(await absent(retained), 'The missing retained signer must not be recreated.');
  assert.deepEqual(await readFile(legacy), originalLegacy);
  const records = await f.records();
  assert.equal(records.length, 1);
  assert.equal(records[0].state, 'failed');
  assert.deepEqual(records[0].stages.map(stage => [stage.name, stage.status, stage.exit_code]), [['signer', 'failed', 1]]);
  assert.deepEqual(records[0].packages, []);
});

test('shared build lock rejects a second build before staging and releases afterward', async t => {
  const f = await fixture(t), entered = join(f.root, 'entered'), release = join(f.root, 'release');
  const first = f.run(['participant'], {FIXTURE_HOLD_MARKER:entered, FIXTURE_RELEASE:release});
  t.after(() => f.put(release, 'released\n'));
  await waitFor(entered);
  const before = await f.events(), beforeRecords = await f.records();
  assert.equal(beforeRecords.length, 1);
  const contender = await f.run(['developer']);
  assert.equal(contender.status, 75, contender.stdout + contender.stderr);
  assert.deepEqual(await f.events(), before);
  assert.equal((await f.records()).length, 1);
  await f.put(release, 'released\n');
  succeeded(await first);
  succeeded(await f.run(['participant']));
  assert.equal((await f.records()).filter(record => record.state === 'completed').length, 2);
});

for (const failure of ['stage-participant.mjs', 'gradle']) {
  test(failure + ' failure records failure and creates no handoff export', async t => {
    const f = await fixture(t), result = await f.run(['participant'], {FIXTURE_FAIL:failure});
    assert.equal(result.status, 42, result.stdout + result.stderr);
    assert.deepEqual(await exportsFor(f), []);
    const records = await f.records();
    assert.equal(records.length, 1);
    assert.equal(records[0].state, 'failed');
    assert.ok(records[0].stages.some(stage => stage.status === 'failed' && stage.exit_code === 42));
    if (failure !== 'gradle') assert.ok(!(await f.events()).some(event => event.command === 'gradle'));
  });
}

test('failed exact-package inspection leaves an incomplete export without a success manifest', async t => {
  const f = await fixture(t);
  const result = await f.run(['participant', '--export', '--baseline-report', join(f.root, 'baseline.json')], {FIXTURE_FAIL:'inspector'});
  assert.equal(result.status, 42, result.stdout + result.stderr);
  const outputs = await exportsFor(f);
  assert.equal(outputs.length, 1);
  assert.ok(!(await absent(join(outputs[0], 'INCOMPLETE.txt'))));
  assert.ok(await absent(join(outputs[0], 'build-manifest.json')));
  const inspector = (await f.events()).find(event => event.command === 'node' && basename(event.args[0]) === 'verify-participant-package.mjs');
  assert.ok(inspector);
  assert.equal(inspector.args[inspector.args.indexOf('--apk') + 1], join(outputs[0], 'nonverba-participant-debug.apk'));
  assert.equal((await f.records()).at(-1).state, 'failed');
});

test('synthetic export finalizes only after both exact-package inspections pass', async t => {
  const f = await fixture(t), baseline = join(f.root, 'baseline.json');
  succeeded(await f.run(['all', '--baseline-report', baseline, '--export']));
  const outputs = await exportsFor(f);
  assert.equal(outputs.length, 1);
  const manifest = JSON.parse(await readFile(join(outputs[0], 'build-manifest.json'), 'utf8'));
  assert.equal(manifest.state, 'completed');
  assert.equal(manifest.export.state, 'verified');
  assert.equal(manifest.export.directory, outputs[0]);
  assert.ok(await absent(join(outputs[0], 'INCOMPLETE.txt')));
  assert.deepEqual(manifest.packages.map(pkg => pkg.path), [
    join(outputs[0], 'nonverba-debug.apk'), join(outputs[0], 'nonverba-participant-debug.apk'),
  ]);
  const inspections = (await f.events()).filter(event => event.command === 'node' && basename(event.args[0]).startsWith('verify-'));
  assert.equal(inspections.length, 2);
  assert.deepEqual(inspections.map(event => event.args[event.args.indexOf('--apk') + 1]), manifest.packages.map(pkg => pkg.path));
  assert.ok(inspections.every(event => event.args[event.args.indexOf('--baseline-report') + 1] === baseline));
  assert.ok((await readFile(join(outputs[0], 'SHA256SUMS.txt'), 'utf8')).includes(manifest.packages[0].sha256));
});

test('repeat routine builds retain incremental outputs and report observed up-to-date tasks without exports', async t => {
  const f = await fixture(t);
  succeeded(await f.run(['participant']));
  const apk = join(f.cache, 'android/participant/build/outputs/apk/debug/participant-debug.apk');
  const staged = join(f.cache, 'android/participant/build/generated/participant-assets/participant/index.html');
  const before = await Promise.all([apk, staged].map(path => stat(path, {bigint:true})));
  succeeded(await f.run(['participant']));
  for (const [i, path] of [apk, staged].entries()) assert.equal((await stat(path, {bigint:true})).mtimeNs, before[i].mtimeNs);
  assert.deepEqual(await exportsFor(f), []);
  const records = await f.records();
  assert.equal(records.length, 2);
  assert.equal(records[0].state, 'completed');
  assert.equal(records[1].state, 'completed');
  assert.equal(records[0].gradle.up_to_date_count, 0);
  assert.equal(records[1].gradle.up_to_date_count, 2);
});

async function webFixture(t) {
  const f = await fixture(t);
  for (const name of ['build-web.mjs', 'stage-android.mjs', 'stage-participant.mjs', 'participant-assets.mjs', 'build-files.mjs', 'android-web-assets.mjs']) {
    await copyFile(join(sourceRoot, 'tools', name), join(f.code, 'tools', name));
  }
  await f.put(join(f.code, 'tools/stage-face-model.mjs'),
    "export async function stageFaceModel() { throw new Error('Android must not prepare face models.'); }\n");
  await f.put(join(f.code, 'tools/release-notices.mjs'),
    "export async function collectReleaseNotices() { return new Map([['LICENSE.txt', Buffer.from('synthetic license\\n')], ['SOURCE.txt', Buffer.from('synthetic source notice\\n')]]); }\n");
  for (const [name, bytes] of Object.entries({
    'index.html':"<meta http-equiv=\"Content-Security-Policy\" content=\"style-src 'self';\"><title>Fixture</title>\n",
    'sensor.js':'export const fixture = true;\n', 'sensor.css':'body { color: green; }\n',
    'map.html':'<title>Browser-only fixture</title>\n',
  })) await f.put(join(f.root, 'repo/web/src', name), bytes);
  return f;
}

test('Android web preparation checks the bindgen pin before Cargo or output mutation', async t => {
  const f = await webFixture(t);
  const result = await f.runNode(['tools/build-web.mjs', '--android'], {FIXTURE_BINDGEN_VERSION:'9.9.9'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected wasm-bindgen 0\.2\.122/);
  assert.deepEqual((await f.events()).map(event => event.command), ['wasm-bindgen']);
  assert.ok(await absent(join(f.root, 'repo/web/dist')));
});

test('actual Android web and asset staging omit browser/model work and preserve unchanged mtimes', async t => {
  const f = await webFixture(t), dist = join(f.root, 'repo/web/dist');
  succeeded(await f.runNode(['tools/build-web.mjs', '--android']));
  succeeded(await f.runNode(['tools/stage-android.mjs']));
  const paths = ['index.html', 'sensor.js', 'sensor.css', 'pkg/nonverba_core.js', 'pkg/nonverba_core_bg.wasm'];
  const observed = [
    ...paths.map(name => join(dist, name)),
    ...paths.map(name => join(f.code, 'android/app/src/main/assets/web', name)),
    join(f.code, 'android/app/src/main/assets/nonverba-license/LICENSE.txt'),
    join(f.code, 'android/app/src/main/assets/nonverba-license/SOURCE.txt'),
  ];
  const before = await Promise.all(observed.map(path => stat(path, {bigint:true})));
  for (const name of ['map.html', 'review.html', 'face-model']) {
    assert.ok(await absent(join(dist, name)));
    assert.ok(await absent(join(f.code, 'android/app/src/main/assets/web', name)));
  }
  const cargo = (await f.events()).filter(event => event.command === 'cargo');
  assert.equal(cargo.length, 1);
  assert.equal(cargo[0].args[cargo[0].args.indexOf('-p') + 1], 'nonverba-core');
  assert.ok(!(await f.events()).some(event => event.command === 'node'));
  const repeatedWeb = await f.runNode(['tools/build-web.mjs', '--android']);
  succeeded(repeatedWeb);
  assert.match(repeatedWeb.stdout, /0 changed/);
  const repeatedStage = await f.runNode(['tools/stage-android.mjs']);
  succeeded(repeatedStage);
  assert.match(repeatedStage.stdout, /0 changed/);
  for (const [i, path] of observed.entries()) assert.equal((await stat(path, {bigint:true})).mtimeNs, before[i].mtimeNs);
  assert.ok(!(await readdir(dist)).some(name => name.startsWith('.bindgen-')));
});

test('a CSS edit restages that input without rewriting WASM, other assets or participant outputs', async t => {
  const f = await webFixture(t), dist = join(f.root, 'repo/web/dist');
  succeeded(await f.runNode(['tools/build-web.mjs', '--android']));
  succeeded(await f.runNode(['tools/stage-android.mjs']));
  const participant = join(f.cache, 'android/participant/build/outputs/apk/debug/participant-debug.apk');
  await f.put(participant, 'retained unrelated participant package\n');
  const unchanged = [
    ...['index.html', 'sensor.js', 'pkg/nonverba_core.js', 'pkg/nonverba_core_bg.wasm'].map(name => join(dist, name)),
    ...['index.html', 'sensor.js', 'pkg/nonverba_core.js', 'pkg/nonverba_core_bg.wasm'].map(name => join(f.code, 'android/app/src/main/assets/web', name)),
    join(f.code, 'android/app/src/main/assets/nonverba-license/LICENSE.txt'),
    join(f.code, 'android/app/src/main/assets/nonverba-license/SOURCE.txt'), participant,
  ];
  const before = await Promise.all(unchanged.map(async path => ({bytes:await readFile(path), info:await stat(path, {bigint:true})})));
  const changed = 'body { color: purple; }\n';
  await f.put(join(f.root, 'repo/web/src/sensor.css'), changed);
  const built = await f.runNode(['tools/build-web.mjs', '--android']);
  succeeded(built);
  assert.match(built.stdout, /1 changed/);
  const staged = await f.runNode(['tools/stage-android.mjs']);
  succeeded(staged);
  assert.match(staged.stdout, /1 changed/);
  for (const path of [join(dist, 'sensor.css'), join(f.code, 'android/app/src/main/assets/web/sensor.css')]) {
    assert.equal(await readFile(path, 'utf8'), changed);
  }
  for (const [i, path] of unchanged.entries()) {
    assert.deepEqual(await readFile(path), before[i].bytes);
    assert.equal((await stat(path, {bigint:true})).mtimeNs, before[i].info.mtimeNs, path);
  }
});

test('native staging preserves unchanged library mtimes and replaces changed library bytes', async t => {
  const f = await fixture(t);
  const paths = ['arm64-v8a', 'x86_64'].map(abi => join(f.code, 'android/app/src/main/jniLibs', abi, 'libnonverba_android.so'));
  succeeded(await f.runBash(['tools/build-android-native.sh']));
  const before = await Promise.all(paths.map(path => stat(path, {bigint:true})));
  succeeded(await f.runBash(['tools/build-android-native.sh']));
  for (const [i, path] of paths.entries()) assert.equal((await stat(path, {bigint:true})).mtimeNs, before[i].mtimeNs);
  succeeded(await f.runBash(['tools/build-android-native.sh', 'arm64-v8a'], {FIXTURE_NATIVE_BYTES:'changed synthetic native library\n'}));
  assert.equal(await readFile(paths[0], 'utf8'), 'changed synthetic native library\n');
  assert.equal(await readFile(paths[1], 'utf8'), 'synthetic native library\n');
  assert.equal((await stat(paths[1], {bigint:true})).mtimeNs, before[1].mtimeNs);
  assert.deepEqual(await exportsFor(f), []);
});

test('canonical lock rejects standalone producers and asset stagers before tools despite spoofed lock environment', async t => {
  const f = await webFixture(t), entered = join(f.root, 'entered'), release = join(f.root, 'release');
  const first = f.run(['participant'], {FIXTURE_HOLD_MARKER:entered, FIXTURE_RELEASE:release});
  try {
    await waitFor(entered);
    const before = await f.events(), records = await f.records();
    const spoofed = {NONVERBA_ANDROID_BUILD_LOCK_HELD:'1', NONVERBA_ANDROID_BUILD_LOCK_FD:'9', NONVERBA_ANDROID_BUILD_LOCK_PATH:join(f.root, 'unrelated.lock')};
    for (const result of [
      await f.runBash(['tools/build-android-native.sh'], spoofed),
      await f.runNode(['tools/build-web.mjs', '--android'], spoofed),
      await f.runNode(['tools/stage-android.mjs'], spoofed),
      await f.runNode(['tools/stage-participant.mjs'], spoofed),
    ]) assert.equal(result.status, 75, result.stdout + result.stderr);
    assert.deepEqual(await f.events(), before);
    assert.deepEqual(await f.records(), records);
    assert.ok(await absent(join(f.root, 'repo/web/dist')));
    assert.ok(await absent(join(f.code, 'android/app/src/main/jniLibs')));
  } finally {
    await f.put(release, 'released\n');
    succeeded(await first);
  }
});

for (const producer of ['web', 'native']) {
  test('standalone ' + producer + ' producer excludes canonical builds until it releases the shared lock', async t => {
    const f = await webFixture(t), entered = join(f.root, 'entered'), release = join(f.root, 'release');
    const held = {FIXTURE_HOLD_COMMAND:'cargo', FIXTURE_HOLD_MARKER:entered, FIXTURE_RELEASE:release};
    const first = producer === 'web' ? f.runNode(['tools/build-web.mjs', '--android'], held) : f.runBash(['tools/build-android-native.sh'], held);
    try {
      await waitFor(entered);
      const before = await f.events();
      const result = await f.run(['participant']);
      assert.equal(result.status, 75, result.stdout + result.stderr);
      assert.deepEqual(await f.events(), before);
      assert.deepEqual(await f.records(), []);
      assert.ok(await absent(join(f.cache, 'android')));
    } finally {
      await f.put(release, 'released\n');
      succeeded(await first);
    }
    succeeded(await f.run(['participant']));
    assert.equal((await f.records()).at(-1).state, 'completed');
  });
}

test('canonical developer preparation reuses its owned lock through actual web, staging and native scripts', async t => {
  const f = await webFixture(t);
  succeeded(await f.run(['developer'], {FIXTURE_REAL_WEB:'1'}));
  const cargo = (await f.events()).filter(event => event.command === 'cargo');
  assert.deepEqual(cargo.map(event => event.args[event.args.indexOf('-p') + 1]), ['nonverba-core', 'nonverba-android', 'nonverba-android']);
  assert.equal((await f.records()).at(-1).state, 'completed');
  assert.equal(await readFile(join(f.root, 'repo/web/dist/sensor.css'), 'utf8'), 'body { color: green; }\n');
  assert.ok(!(await absent(join(f.code, 'android/app/src/main/jniLibs/arm64-v8a/libnonverba_android.so'))));
  assert.deepEqual(await exportsFor(f), []);
});

test('actual web and Android asset staging preserve and reject unexpected generated files', async t => {
  const f = await webFixture(t), dist = join(f.root, 'repo/web/dist');
  succeeded(await f.runNode(['tools/build-web.mjs', '--android']));
  const staleWeb = join(dist, 'unreviewed-output.js');
  await f.put(staleWeb, 'preserve unexpected generated web output\n');
  const refusedWeb = await f.runNode(['tools/build-web.mjs', '--android']);
  assert.notEqual(refusedWeb.status, 0);
  assert.match(refusedWeb.stderr, /Unexpected generated files/);
  assert.equal(await readFile(staleWeb, 'utf8'), 'preserve unexpected generated web output\n');
  // The web file is now an actual input to Android staging, so independently
  // put an unknown destination file there to exercise its closure check.
  const staleAsset = join(f.code, 'android/app/src/main/assets/unreviewed-asset.txt');
  await f.put(staleAsset, 'preserve unexpected generated Android output\n');
  const refusedStage = await f.runNode(['tools/stage-android.mjs']);
  assert.notEqual(refusedStage.status, 0);
  assert.match(refusedStage.stderr, /Unexpected generated files/);
  assert.equal(await readFile(staleAsset, 'utf8'), 'preserve unexpected generated Android output\n');
});

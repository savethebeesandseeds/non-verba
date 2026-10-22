#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Bounded warm workloads in one disposable, launcher-verified source snapshot.
import {createHash, randomBytes} from 'node:crypto';
import {access, lstat, mkdir, open, readFile, realpath, stat, utimes, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {enterAndroidBuildLock} from './android-build-lock.mjs';
import {collectBuildFiles} from './build-files.mjs';
import {measurementErrors, summarizeBuildSamples, compareBuildBudget, compareBuildContexts} from './android-build-metrics.mjs';
import {parseZip, entryBytes} from './verify-android-package.mjs';

const code = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), repository = dirname(code);
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const targets = {
  participant:{css:'web/apps/non-verba/src/participant.css', entry:'assets/participant/participant.css', module:'participant'},
  developer:{css:'web/apps/non-verba-dev/src/common/style.css', entry:'assets/web/style.css', module:'app'},
};

function apkPayload(apk, entries) {
  const files = {};
  for (const [name, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    if (name.endsWith('/') || /^META-INF\/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))$/i.test(name)) continue;
    const bytes = entryBytes(apk, entry);
    files[name] = {bytes:bytes.length, sha256:hash(bytes)};
  }
  // JSON length/string framing preserves unambiguous names and byte digests.
  return {files, sha256:hash(Buffer.from(JSON.stringify(files))), entries:Object.keys(files).length};
}

async function runtimeInputs(target) {
  const android = join(process.env.NONVERBA_BUILD_ROOT, 'android'), manifest = {};
  const roots = [['main', join(android, targets[target].module, 'src/main')]];
  if (target === 'participant') roots.push(['generated', join(android, 'participant/build/generated/participant-capture-assets-v1')]);
  for (const [prefix, root] of roots) for (const [name, bytes] of await collectBuildFiles(root, {allowMissing:true})) {
    const info = await stat(join(root, name), {bigint:true});
    manifest[prefix + '/' + name] = {bytes:bytes.length, sha256:hash(bytes), mtime_ns:String(info.mtimeNs)};
  }
  return Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
}

async function cachedApk(target) {
  const module = targets[target].module;
  const file = join(process.env.NONVERBA_BUILD_ROOT, 'android', module, 'build/outputs/apk/debug', module + '-debug.apk');
  try { const bytes = await readFile(file); return {path:file, bytes:bytes.length, sha256:hash(bytes)}; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node tools/build/benchmark-android-builds.mjs [--baseline RETAINED_REPORT] (managed source snapshot only)'); return;
  }
  insist(args.length === 0 || args.length === 2 && args[0] === '--baseline', 'Supply only an optional --baseline PATH.');
  insist(process.platform === 'linux' && process.env.NONVERBA_CONTAINER === '1'
    && /^\/tmp\/nonverba-unified-source\/[a-f0-9]{32}\/code$/.test(code) && await realpath(code) === code,
  'Run through code/dev.ps1 -Snapshot; benchmark mutations are forbidden in a host bind or other checkout.');
  const origin = (await readFile(join(repository, '.snapshot-archive-sha256'), 'utf8')).trim();
  insist(/^[a-f0-9]{64}$/.test(origin) && origin === process.env.NONVERBA_SOURCE_SNAPSHOT_SHA256,
    'The benchmark needs the original launcher snapshot metadata.');
  const retained = args.length ? JSON.parse(await readFile(args[1], 'utf8')) : null;
  insist(!retained || retained.schema_version === 1 && retained.kind === 'android-build-benchmark' && retained.state === 'completed'
    && Object.keys(targets).every(target => retained.results?.[target]?.summary?.review_above_ms > 0), 'Invalid retained benchmark baseline.');
  enterAndroidBuildLock();
  const id = 'android-build-benchmark-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(6).toString('hex');
  const qa = join(code, 'artifacts/qa'), reportPath = join(qa, id + '.json'), files = join(qa, id + '-files');
  await mkdir(files, {recursive:true});
  const report = {schema_version:1, kind:'android-build-benchmark', state:'running', started_at_utc:new Date().toISOString(),
    source:{base_revision:process.env.NONVERBA_SOURCE_REVISION, original_snapshot_sha256:origin,
      measured_snapshot_sha256:null, dirty:true,
      reason:'CSS workloads derive new inputs. Every child omits the original archive digest; exact variant and restoration hashes are retained here.'},
    context:{node:process.version, platform:process.platform, arch:process.arch, tools:{},
      cache:'Existing managed warm caches; no reset, deletion, replacement container or toolchain installation.',
      build_root:process.env.NONVERBA_BUILD_ROOT, samples_per_target:2},
    retained_baseline:args[1] || null, comparison:null, runs:[], results:{}, errors:[],
    limits:{hard:'Target graph, stable unchanged inputs/APK, selected CSS byte propagation, exact source/unsigned APK payload restoration and unchanged other-app runtime/APK.',
      advisory:'Review above max(2 × measured maximum, measured maximum + 10 seconds); review any APK size growth against a retained baseline.',
      exclusions:'No cold-cache, Kotlin/Rust-edit, physical-device, reproducibility, release-signing or distribution benchmark.'}};
  const save = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {flag:'wx'});
  console.log('Android build workload report: ' + reportPath);
  const environment = {...process.env, NONVERBA_SOURCE_DIRTY:'1'};
  delete environment.NONVERBA_SOURCE_SNAPSHOT_SHA256;
  try {
    for (const [tool, args] of [['rustc', ['--version']], ['cargo', ['--version']], ['wasm-bindgen', ['--version']], ['java', ['-version']], ['gradle', ['--version']]]) {
      const result = spawnSync(tool, args, {cwd:code, encoding:'utf8', env:environment, shell:false});
      insist(!result.error && result.status === 0, 'Cannot observe toolchain: ' + tool);
      report.context.tools[tool] = (result.stdout + result.stderr).trim();
    }
    report.context.cargo_lock_sha256 = hash(await readFile(join(code, 'Cargo.lock')));
    if (retained) {
      const differences = compareBuildContexts(report.context, retained.context || {});
      report.comparison = {comparable:differences.length === 0, context_differences:differences};
    }
    const exportsRoot = join(code, 'artifacts/container-builds');
    const hadExports = await access(exportsRoot).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    insist(!hadExports, 'Use a fresh snapshot without handoff exports for the measurement suite.');
    async function build(target, scenario, baseline, unchanged = false) {
      const label = target + '-' + scenario, log = join(files, label + '.log');
      console.log('Measuring ' + label);
      const output = await open(log, 'wx');
      let child;
      try {
        child = spawnSync('bash', ['dev.sh', 'build', target], {cwd:code, env:environment, shell:false,
          stdio:Array.from({length:10}, (_, fd) => fd === 1 || fd === 2 ? output.fd : fd === 9 ? 9 : 'ignore')});
      } finally { await output.close(); }
      if (child.error) throw child.error;
      const text = await readFile(log, 'utf8');
      const paths = [...text.matchAll(/^Android (?:developer|participant) build record: (.+)$/gm)];
      insist(paths.length === 1 && paths[0][1].startsWith(qa + '/android-build-'), 'Missing exact build record; inspect ' + log);
      const recordPath = paths[0][1].trim(), record = JSON.parse(await readFile(recordPath, 'utf8'));
      const run = {target, scenario, log, record:recordPath, duration_ms:record.duration_ms,
        package:record.packages[0], gradle:record.gradle, checks:[]};
      report.runs.push(run); await save();
      insist(child.status === 0, 'Build failed (' + child.status + '); inspect ' + log);
      const errors = measurementErrors(record, baseline, {unchanged, cssOnly:['css-change', 'restore'].includes(scenario)});
      insist(errors.length === 0, label + ': ' + errors.join(' '));
      insist(record.source.snapshot_sha256 === null && record.source.dirty === true, 'Workload build claimed an unchanged archive digest.');
      const apk = await readFile(record.packages[0].path);
      insist(hash(apk) === record.packages[0].sha256, 'Cached APK changed after its build record.');
      const entries = parseZip(apk), entry = entries.get(targets[target].entry), payload = apkPayload(apk, entries);
      insist(entry && entryBytes(apk, entry).equals(await readFile(join(repository, targets[target].css))), 'Selected CSS bytes did not reach the selected APK.');
      run.payload = {sha256:payload.sha256, entries:payload.entries};
      run.checks.push('target-graph', 'no-export', 'truthful-input-provenance', 'exact-apk-hash', 'packaged-css');
      return {record, run, payload};
    }
    for (const [target, contract] of Object.entries(targets)) {
      const other = target === 'participant' ? 'developer' : 'participant', source = join(repository, contract.css);
      const original = await readFile(source), info = await lstat(source);
      insist(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'Expected unlinked CSS source.');
      const backup = join(files, target + '-original.css');
      await writeFile(backup, original, {flag:'wx'});
      const otherInputs = JSON.stringify(await runtimeInputs(other)), otherApk = JSON.stringify(await cachedApk(other));
      const unchangedOther = async () => {
        insist(JSON.stringify(await runtimeInputs(other)) === otherInputs && JSON.stringify(await cachedApk(other)) === otherApk,
          'A ' + target + ' build changed the other app runtime or APK.');
      };
      let modified = false;
      try {
        const prepared = await build(target, 'warmup');
        const inputs = JSON.stringify(await runtimeInputs(target)), samples = [];
        await unchangedOther();
        for (let index = 1; index <= 2; index++) {
          const sample = await build(target, 'unchanged-' + index, prepared.record, true);
          insist(JSON.stringify(await runtimeInputs(target)) === inputs, 'Unchanged build rewrote runtime bytes or timestamps.');
          await unchangedOther();
          sample.run.checks.push('unchanged-runtime-bytes-and-mtimes', 'unchanged-other-app'); samples.push(sample.record);
        }
        const append = '\n/* Non-verba build workload ' + id + ': CSS input propagation. */\n';
        const changed = Buffer.concat([original, Buffer.from(append)]);
        report.results[target] = {summary:summarizeBuildSamples(samples), baseline_payload:{sha256:prepared.payload.sha256, entries:prepared.payload.entries}, change:{path:contract.css, backup,
          original_sha256:hash(original), changed_sha256:hash(changed), appended_comment:append, restored:false}};
        await save();
        insist((await readFile(source)).equals(original), 'CSS source changed before the workload.');
        modified = true; await writeFile(source, changed);
        const change = await build(target, 'css-change');
        insist(change.record.packages[0].sha256 !== prepared.record.packages[0].sha256, 'CSS change did not change its APK.');
        await unchangedOther(); change.run.checks.push('changed-selected-apk', 'unchanged-other-app');
        await writeFile(source, original); await utimes(source, info.atime, info.mtime); modified = false;
        const restored = await build(target, 'restore');
        const differences = [...new Set([...Object.keys(prepared.payload.files), ...Object.keys(restored.payload.files)])]
          .filter(name => JSON.stringify(prepared.payload.files[name]) !== JSON.stringify(restored.payload.files[name]));
        insist(differences.length === 0, 'Restored CSS left changed APK payloads: ' + differences.join(', '));
        await unchangedOther(); restored.run.checks.push('restored-source-and-unsigned-payload', 'unchanged-other-app');
        report.results[target].change.restored = true;
        report.results[target].change.full_apk_bytes_restored = restored.record.packages[0].sha256 === prepared.record.packages[0].sha256;
        report.results[target].review = !retained ? [] : report.comparison.comparable
          ? compareBuildBudget(report.results[target].summary, retained.results[target].summary)
          : ['Retained baseline context differs (' + report.comparison.context_differences.join(', ') + '); establish a comparable baseline before interpreting timing or size changes.'];
        await save();
      } finally {
        if (modified) { await writeFile(source, original); await utimes(source, info.atime, info.mtime); }
        insist((await readFile(source)).equals(original), 'CSS restoration failed; original retained at ' + backup);
      }
    }
    insist(await access(exportsRoot).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; }), 'Measurement unexpectedly created handoff exports.');
    report.state = 'completed';
  } catch (error) { report.state = 'failed'; report.errors.push(error.message); process.exitCode = 1; }
  report.finished_at_utc = new Date().toISOString(); await save();
  console.log(JSON.stringify({state:report.state, report:reportPath, results:report.results, errors:report.errors}, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

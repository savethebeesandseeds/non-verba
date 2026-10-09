// SPDX-License-Identifier: AGPL-3.0-only
// Real signed synthetic WAVs from the Rust assertion regressions, no audio I/O.
// Run inside dev.sh: node test/audio-assertion-wasm.mjs CORE_JS FIXTURES OUTPUT [--observe-baseline]
import assert from 'node:assert/strict';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Use the managed Debian container.');
const [corePath, fixturesPath, outputPath, mode] = process.argv.slice(2);
assert(corePath && fixturesPath && outputPath && (!mode || mode === '--observe-baseline'));
const baseline = mode === '--observe-baseline';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const modulePath = resolve(corePath), wasm = await readFile(modulePath.replace(/\.js$/, '_bg.wasm'));
const core = await import(pathToFileURL(modulePath).href);
await core.default({module_or_path: wasm});
const names = (await readdir(fixturesPath)).filter(name => name.endsWith('.json')).sort();
assert.equal(names.length, 8, 'Expected the eight deliberately signed assertion cases.');
const results = [];
for (const name of names) {
  const fixture = JSON.parse(await readFile(join(fixturesPath, name), 'utf8'));
  assert.equal(fixture.type, 'nonverba-synthetic-audio-assertion-fixture');
  const bytes = await readFile(join(fixturesPath, fixture.wav));
  assert.equal(sha256(bytes), fixture.wav_sha256);
  const report = JSON.parse(await core.verify_audio(bytes, fixture.request_json, fixture.transcript_json,
    fixture.operator_pin, fixture.now_secs));
  const actual = {verified: report.verified, demo: report.demo, capture_present: report.capture != null,
    native_audio_present: report.native_audio != null, checks: {}};
  for (const key of Object.keys(fixture.expected.checks)) actual.checks[key] = report.checks[key] ?? null;
  assert.equal(report.checks.c2pa_integrity, true, 'Each case must retain authentic C2PA integrity.');
  if (!baseline) assert.deepEqual(actual, fixture.expected, name);
  results.push({case: name, wav_sha256: fixture.wav_sha256, expected: fixture.expected,
    actual, differs_from_hardened_expectation: !isDeepStrictEqual(actual, fixture.expected), report});
}
await writeFile(outputPath, JSON.stringify({version: 1, type: 'nonverba-audio-assertion-wasm-check',
  mode: baseline ? 'observe-retained-baseline' : 'assert-hardened-verifier', passed: !baseline,
  synthetic_audio: true, crypto_mocked: false, physical_device_tested: false,
  wasm_sha256: sha256(wasm), tests: results.length, results}, null, 2) + '\n', {flag: 'wx'});
console.log(`${baseline ? 'OBSERVED' : 'PASS'} ${results.length} signed synthetic audio assertion cases; no audio I/O`);

// SPDX-License-Identifier: AGPL-3.0-only
// Diagnose a phone-created enrollment using the production WASM verifier.
// A challenge exported by the operator is NOT an independently retained request.
// This tool therefore never produces an acceptance or trusted-enrollment decision.
import {readFile, stat, writeFile} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') {
  throw new Error('Run this diagnostic inside non-verba-dev.');
}
const code = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {};
while (args.length) {
  const name = args.shift();
  if (!['--request', '--response', '--trust', '--policy', '--received-at'].includes(name)
      || !args.length || options[name]) throw new Error('Supply request, response, trust, policy and actual received-at Unix seconds.');
  options[name] = args.shift();
}
for (const name of ['--request', '--response', '--trust', '--policy', '--received-at']) {
  if (!options[name]) throw new Error('Missing ' + name);
}
const received = Number(options['--received-at']);
if (!Number.isSafeInteger(received) || received <= 0) throw new Error('Invalid actual USB retrieval time.');
const inputs = {}, hashes = {}, paths = {};
for (const [name, max] of [['request', 4096], ['response', 256 * 1024], ['trust', 2 * 1024 * 1024], ['policy', 16 * 1024]]) {
  const path = resolve(options['--' + name]), info = await stat(path);
  if (!info.isFile() || info.size <= 0 || info.size > max) throw new Error('Invalid bounded ' + name + ' file.');
  const bytes = await readFile(path);
  if (bytes.length > max) throw new Error(name + ' changed beyond its size bound.');
  inputs[name] = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  JSON.parse(inputs[name]);
  hashes[name] = createHash('sha256').update(bytes).digest('hex');
  paths[name] = path;
}
const now = Math.floor(Date.now() / 1000);
if (received > now) throw new Error('Retrieval time is in the future.');
const modulePath = resolve(code, '../web/dist/pkg/nonverba_core.js');
const wasm = await readFile(resolve(code, '../web/dist/pkg/nonverba_core_bg.wasm'));
const core = await import(pathToFileURL(modulePath).href);
await core.default({module_or_path: wasm});
const report = {
  type: 'nonverba-operator-local-enrollment-diagnostic', version: 1,
  checked_at: now, response_retrieved_at: received, input_paths: paths, input_sha256: hashes,
  wasm_sha256: createHash('sha256').update(wasm).digest('hex'),
  requester_original_independently_retained: false,
  independent_requester_freshness_established: false,
  trusted_enrollment_accepted: false, sensor_authenticity_proven: false,
  policy: JSON.parse(inputs.policy), verifier_result: null, verifier_error: null,
};
try {
  report.verifier_result = JSON.parse(core.verify_key_enrollment(
    inputs.response, inputs.request, inputs.policy, inputs.trust, received, now));
} catch (error) { report.verifier_error = String(error); }
const output = resolve(code, 'artifacts/device-acceptance',
  `local-enrollment-diagnostic-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.json`);
await writeFile(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({report: output, trusted_enrollment_accepted: false,
  verifier_verified: report.verifier_result?.verified ?? false,
  attestation: report.verifier_result?.attestation ?? null,
  verifier_error: report.verifier_error}, null, 2));
// A policy rejection is a diagnostic outcome; local I/O/configuration failures throw.

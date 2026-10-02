// SPDX-License-Identifier: AGPL-3.0-only
// Cross-runtime test of the actual Rust verifier export. No server/provider is
// contacted; fixtures contain public test identities and synthetic receipts.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1' || !process.env.CARGO_TARGET_DIR) {
  throw new Error('Run parity checks through the managed Linux container launcher.');
}
const target = resolve(process.env.CARGO_TARGET_DIR);
const modulePath = resolve(process.argv[2] ?? join(target, 'requests-wasm-pkg/nonverba_requests.js'));
const binary = resolve(process.argv[3] ?? join(target, 'debug/nonverba-assignment'));
const wasm = await import(pathToFileURL(modulePath));
await wasm.default({ module_or_path: readFileSync(modulePath.replace(/\.js$/, '_bg.wasm')) });
const fixtures = join(root, 'tests', 'fixtures');
const trust = readFileSync(join(fixtures, 'trust.json'), 'utf8');
const bundle = JSON.parse(readFileSync(join(fixtures, 'lifecycle-bundle.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(fixtures, 'lifecycle-report.json'), 'utf8'));
mkdirSync(target, { recursive: true });
const temporary = mkdtempSync(join(target, 'requests-wasm-parity-'));
const trustPath = join(temporary, 'trust.json');
writeFileSync(trustPath, trust);
const cases = [
  ['signed lifecycle', value => value],
  ['duplicate delivery', value => { value.actions.push(structuredClone(value.actions[0])); value.events.push(structuredClone(value.events[0])); return value; }],
  ['missing mediator endorsement', value => { value.agreement.signatures = value.agreement.signatures.filter(s => s.claims.role !== 'M'); return value; }],
  ['tampered exact terms', value => { value.agreement.agreement.legal.artifacts[0].text += ' altered'; return value; }],
  ['changed attachment', value => { value.attachments[0].bytes_b64 = Buffer.from('changed bytes').toString('base64url'); return value; }],
  ['policy replay', value => { value.actions[0].proposal.policy_hash = '00'.repeat(32); return value; }],
  ['wrong deployment', value => { value.deployment_domain = 'another.deployment'; return value; }],
  ['unsupported authority field', value => { value.admin_override = true; return value; }],
  ['noncanonical money', value => { value.agreement.agreement.quote.quote.compensation.minor_units = '010000'; return value; }],
  ['duplicate JSON member', value => '{"protocol_version":"2",' + JSON.stringify(value).slice(1)],
];
const vectors = cases.map(([label, change], index) => ({label, value:change(structuredClone(bundle)), trust, expected:index === 0 ? expected : undefined}));
vectors.push({label:'historical v1 inspection',value:JSON.parse(readFileSync(join(fixtures,'legacy-v1/bundle.json'),'utf8')),trust:readFileSync(join(fixtures,'legacy-v1/trust.json'),'utf8')});
// Additional immutable vector directories may use the original per-case trust
// convention or the three NV2-01 inputs sharing one independently supplied trust.
const additionalDirectories = process.argv.length > 4
  ? process.argv.slice(4)
  : [join(fixtures, 'nv2-01'), join(fixtures, 'integration')];
for (const argument of additionalDirectories) {
  const directory = resolve(argument);
  const names = readdirSync(directory);
  let added = 0;
  for (const name of names.filter(name => name.endsWith('-bundle.json')).sort()) {
    const prefix = name.slice(0, -'-bundle.json'.length);
    vectors.push({label:prefix,value:JSON.parse(readFileSync(join(directory,name),'utf8')),trust:readFileSync(join(directory,`${prefix}-trust.json`),'utf8'),expected:JSON.parse(readFileSync(join(directory,`${prefix}-report.json`),'utf8'))});
    added++;
  }
  for (const prefix of ['late-context-prefix', 'partial-authorization-prefix', 'late-context-extension']) {
    if (!names.includes(`${prefix}.json`)) continue;
    vectors.push({label:`NV2-01 ${prefix}`,value:JSON.parse(readFileSync(join(directory,`${prefix}.json`),'utf8')),trust:readFileSync(join(directory,'trust.json'),'utf8'),expected:JSON.parse(readFileSync(join(directory,`${prefix}-native-report.json`),'utf8'))});
    added++;
  }
  assert.ok(added > 0, `${directory}: no recognized parity vectors found`);
}
for (let index = 0; index < vectors.length; index++) {
  const {label, value, trust: caseTrust, expected: caseExpected} = vectors[index];
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  const path = join(temporary, `case-${index}.json`);
  writeFileSync(path, json);
  writeFileSync(trustPath, caseTrust);
  const native = spawnSync(binary, ['verify', path, trustPath], { encoding: 'utf8', windowsHide: true });
  if (native.error) throw native.error;
  let wasmReport, wasmError;
  try { wasmReport = JSON.parse(wasm.verify_assignment_bundle_json(json, caseTrust)); }
  catch (error) { wasmError = String(error); }
  if (native.status === 0) {
    assert.equal(wasmError, undefined, label);
    assert.deepEqual(wasmReport, JSON.parse(native.stdout), label);
    if (caseExpected) assert.deepEqual(wasmReport, caseExpected, `${label}: captured native report vector`);
  } else {
    assert.ok(wasmError, `${label}: both runtimes must reject`);
    const nativeCode = native.stderr.match(/[A-Z][A-Z_]+:/)?.[0];
    assert.ok(nativeCode, `${label}: stable native error code`);
    assert.ok(wasmError.includes(nativeCode), `${label}: matching error code`);
  }
}
console.log(`${vectors.length} native/WASM verifier parity cases passed, including signed lifecycle, legacy inspection, and adversarial inputs.`);

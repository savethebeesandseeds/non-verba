// SPDX-License-Identifier: AGPL-3.0-only
// Exercise the actual shipped WASM JSON boundary with synthetic receiver data.
// Rust signed-proof tests cover cryptography; this file never uses real sensors.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {loadShippedCore} from '../tools/image-requester-session.mjs';

const {core, wasmSha256, moduleSha256} = await loadShippedCore();
const legacy = JSON.parse(await readFile(new URL('../crates/nonverba-core/src/location_proof/raw_gnss_fixture.json', import.meta.url), 'utf8'));
const validate = trace => JSON.parse(core.validate_location_trace(JSON.stringify(trace), Math.ceil(trace.ended_at_ms / 1000)));
const checks = [];
function check(name, run) { run(); checks.push({name, passed:true}); }

check('legacy JSON survives the WASM boundary without a new policy field', () => {
  assert.deepEqual(validate(legacy), legacy);
});

const explicit = structuredClone(legacy);
explicit.request.policy.raw_gnss.max_elapsed_realtime_uncertainty_ns = 10000000;
for (const epoch of explicit.raw_gnss.epochs) epoch.clock.elapsed_realtime_uncertainty_ns = 5000000;
// Add real synthetic time to the last epoch and fix, rather than counting its
// uncertainty as observed duration. All signed timestamps remain mutually aligned.
const last = explicit.raw_gnss.epochs.at(-1), fix = explicit.samples.at(-1);
for (const field of ['time_ns', 'elapsed_realtime_ns']) last.clock[field] = String(BigInt(last.clock[field]) + 20000000n);
for (const measurement of last.measurements) measurement.received_sv_time_ns = String(BigInt(measurement.received_sv_time_ns) + 20000000n);
last.observed_elapsed_ms += 20;
fix.observed_elapsed_ms += 20; fix.fix_elapsed_ms += 20; fix.fix_timestamp_ms += 20;
explicit.elapsed_ms += 20; explicit.ended_at_ms += 20;
check('explicit 5 ms alignment observations pass after a sufficient observation span', () => {
  assert.deepEqual(validate(explicit), explicit);
});
check('removing the explicit cap restores the old rejection through WASM', () => {
  const changed = structuredClone(explicit); delete changed.request.policy.raw_gnss.max_elapsed_realtime_uncertainty_ns;
  assert.throws(() => validate(changed), /RAW_GNSS_CLOCK_FIELDS/);
});
check('separate alignment cap cannot relax receiver-clock precision', () => {
  const changed = structuredClone(explicit); changed.raw_gnss.epochs[1].clock.bias_uncertainty_ns = 100001;
  assert.throws(() => validate(changed), /RAW_GNSS_CLOCK_FIELDS/);
});
check('nominal ten-second span cannot count uncertain edges as observation time', () => {
  const changed = structuredClone(legacy);
  changed.request.policy.raw_gnss.max_elapsed_realtime_uncertainty_ns = 10000000;
  for (const epoch of changed.raw_gnss.epochs) epoch.clock.elapsed_realtime_uncertainty_ns = 5000000;
  assert.throws(() => validate(changed), /RAW_GNSS_COVERAGE/);
});
check('invalid explicit caps remain rejected at the JavaScript/Rust boundary', () => {
  for (const value of [0, -1, 100000001, '10000000']) {
    const changed = structuredClone(explicit); changed.request.policy.raw_gnss.max_elapsed_realtime_uncertainty_ns = value;
    assert.throws(() => validate(changed));
  }
});

// Synthetic device-variability matrix. These are capability cases, not claims
// that five physical phones have been tested. The strict request stays explicit.
for (const uncertaintyMs of [0, 5, 25, 50, 100]) {
  const trace = structuredClone(legacy);
  trace.request.policy.raw_gnss.max_elapsed_realtime_uncertainty_ns = 100000000;
  for (const epoch of trace.raw_gnss.epochs) {
    epoch.clock.elapsed_realtime_uncertainty_ns = uncertaintyMs * 1000000;
  }
  // Extend the measured span by both endpoint uncertainties. Do not shorten
  // the requested observation or manufacture time by widening a confidence band.
  const extensionMs = uncertaintyMs * 2;
  const epoch = trace.raw_gnss.epochs.at(-1), sample = trace.samples.at(-1);
  for (const field of ['time_ns', 'elapsed_realtime_ns']) {
    epoch.clock[field] = String(BigInt(epoch.clock[field]) + BigInt(extensionMs) * 1000000n);
  }
  for (const measurement of epoch.measurements) {
    measurement.received_sv_time_ns = String(BigInt(measurement.received_sv_time_ns) + BigInt(extensionMs) * 1000000n);
  }
  epoch.observed_elapsed_ms += extensionMs;
  for (const field of ['observed_elapsed_ms', 'fix_elapsed_ms', 'fix_timestamp_ms']) sample[field] += extensionMs;
  trace.elapsed_ms += extensionMs; trace.ended_at_ms += extensionMs;
  check(`${uncertaintyMs} ms synthetic alignment remains usable with sufficient measured span`, () => {
    assert.deepEqual(validate(trace), trace);
  });
  check(`${uncertaintyMs} ms synthetic alignment cannot excuse a receiver reset`, () => {
    const reset = structuredClone(trace);
    reset.raw_gnss.epochs[1].clock.hardware_clock_discontinuity_count++;
    assert.throws(() => validate(reset), /RAW_GNSS_CLOCK_CONTINUITY/);
  });
}
const checkedAt = new Date().toISOString();
const report = {passed:true, checked_at:checkedAt, synthetic:true, physical_sensors_used:false, wasm_sha256:wasmSha256, module_sha256:moduleSha256, checks};
const output = new URL('../artifacts/qa/raw-alignment-wasm-' + checkedAt.replace(/[-:.]/g, '') + '.json', import.meta.url);
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({passed:true, checks:checks.length, report:output.pathname}));

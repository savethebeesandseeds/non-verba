// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {locationReportPresentation, rawGnssTimingQualitySummary} from '../../web/src/location-platform.js';

const intact = {signature_integrity: true, device_match: true, request_match: true, asset_binding: true};
const limited = {verified: false, checks: {...intact, accuracy_valid: false}, errors: ['Reported accuracy exceeds the requested limit.']};
const quality = {
  reported_max_elapsed_uncertainty_ns: 5000000,
  requested_max_elapsed_uncertainty_ns: 10000000,
  confidence_percent: 68,
  continuity_semantics: 'compatible-with-reported-uncertainty',
  precise_clock_stability_proven: false,
  physical_error_bound_proven: false
};

test('intact proof missing requested quality is distinguished from integrity failure', () => {
  const before = structuredClone(limited);
  const result = locationReportPresentation(limited);
  assert.equal(result.headline, 'Signature verified; collection requirements not met');
  assert.match(result.note, /accuracy exceeds/);
  assert.doesNotMatch(result.headline + result.note, /forged|tamper/i);
  assert.deepEqual(limited, before);
  assert.equal(limited.verified, false);
});

for (const check of Object.keys(intact)) {
  test(`failed ${check} cannot be presented as verified signature and collection-policy miss`, () => {
    const value = {...limited, checks: {...limited.checks, [check]: false}};
    assert.equal(locationReportPresentation(value).headline, 'Location evidence did not pass');
  });
  test(`missing ${check} cannot be inferred from the other successful checks`, () => {
    const checks = {...limited.checks};
    delete checks[check];
    assert.equal(locationReportPresentation({...limited, checks}).headline, 'Location evidence did not pass');
  });
}

test('unknown status, truthy check strings, and contradictory aggregate result fail closed in presentation', () => {
  for (const value of [
    null, {},
    {...limited, verified: undefined},
    {...limited, checks: {...intact, signature_integrity: 'true'}},
    {...limited, verified: true, checks: {...intact, request_match: false}}
  ]) assert.equal(locationReportPresentation(value).headline, 'Location evidence did not pass');
});

test('ordinary and demo successful proofs retain their established meaning', () => {
  const value = {verified: true, checks: intact, errors: []};
  assert.equal(locationReportPresentation(value).headline, 'Signature & collection verified');
  assert.match(locationReportPresentation(value).note, /not independently attested/);
  const demo = locationReportPresentation({...value, demo: true});
  assert.equal(demo.headline, 'Demo signature & collection verified');
  assert.match(demo.note, /acted as requester and operator/);
});

test('error details remain visible without treating non-string data as verdict text', () => {
  const value = {verified: false, checks: {...intact, asset_binding: false}, errors: ['Different media asset.', {message: 'Signature verified'}, null]};
  const result = locationReportPresentation(value);
  assert.equal(result.headline, 'Location evidence did not pass');
  assert.equal(result.note, 'Different media asset.');
});

test('explicit clock quality distinguishes requested limit from observed uncertainty', () => {
  const summary = rawGnssTimingQualitySummary(quality);
  assert.match(summary, /maximum reported uncertainty 5 ms \(68% confidence\)/);
  assert.match(summary, /requested limit 10 ms — within the requested alignment limit/);
  assert.match(summary, /Continuity checks compatibility with reported uncertainty/);
  assert.match(summary, /Precise clock stability and a physical error bound are not proven/);
});

test('above-limit reported quality stays above-limit without clipping or changing proof acceptance', () => {
  const value = {...quality, reported_max_elapsed_uncertainty_ns: 20000000};
  const before = structuredClone(value);
  const summary = rawGnssTimingQualitySummary(value);
  assert.match(summary, /20 ms/);
  assert.match(summary, /exceeds the requested alignment limit/);
  assert.deepEqual(value, before);
});

test('comparison uses actual fractional uncertainty without rounding down at the limit', () => {
  assert.match(rawGnssTimingQualitySummary({...quality, reported_max_elapsed_uncertainty_ns: 10000000}), /within the requested alignment limit/);
  const summary = rawGnssTimingQualitySummary({...quality, reported_max_elapsed_uncertainty_ns: 10000000.25});
  assert.match(summary, /10.00000025 ms/);
  assert.match(summary, /exceeds the requested alignment limit/);
});

test('missing or invalid observed quality is unknown, never zero or within-limit', () => {
  for (const observed of [null, undefined, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1, '5000000']) {
    const summary = rawGnssTimingQualitySummary({...quality, reported_max_elapsed_uncertainty_ns: observed});
    assert.match(summary, /maximum reported uncertainty unavailable/);
    assert.match(summary, /requested limit 10 ms/);
    assert.doesNotMatch(summary, /within the requested alignment limit|exceeds the requested alignment limit/);
  }
});

test('legacy reports with no timing-quality object gain no invented quality claim', () => {
  for (const value of [undefined, null, {}, []]) assert.equal(rawGnssTimingQualitySummary(value), '');
});

test('unknown semantics or unsupported trust claims are not relabeled as current clock quality', () => {
  for (const override of [
    {confidence_percent: 95},
    {continuity_semantics: 'physically-proven'},
    {precise_clock_stability_proven: true},
    {physical_error_bound_proven: true},
    {requested_max_elapsed_uncertainty_ns: 0},
    {requested_max_elapsed_uncertainty_ns: 100000001},
    {requested_max_elapsed_uncertainty_ns: Infinity},
    {requested_max_elapsed_uncertainty_ns: '10000000'}
  ]) assert.equal(rawGnssTimingQualitySummary({...quality, ...override}), '');
});

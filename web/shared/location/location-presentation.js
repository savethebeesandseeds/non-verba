// SPDX-License-Identifier: AGPL-3.0-only
// Presentation only: verification and acceptance remain the core report's decision.
const LOCATION_BINDING_CHECKS = ['signature_integrity', 'device_match', 'request_match', 'asset_binding'];
export function locationReportPresentation(value) {
  const bindingsMatch = LOCATION_BINDING_CHECKS.every(name => value?.checks?.[name] === true);
  const details = Array.isArray(value?.errors) ? value.errors.filter(error => typeof error === 'string').join(' ') : '';
  if (value?.verified === true && bindingsMatch) {
    return {
      headline: value.demo ? 'Demo signature & collection verified' : 'Signature & collection verified',
      note: `${value.demo ? 'Local demo: this device acted as requester and operator. ' : ''}The record matches the expected key, request, and sampling policy. Physical location and collection hardware are not independently attested.`
    };
  }
  if (value?.verified === false && bindingsMatch) {
    return {
      headline: 'Signature verified; collection requirements not met',
      note: 'The signature, expected key, original request, and file binding match. A collection or measurement consistency requirement failed; see the individual checks.' + (details ? ' ' + details : '')
    };
  }
  return {headline: 'Location evidence did not pass', note: details || 'One or more required integrity, binding, or collection checks failed.'};
}

export function rawGnssTimingQualitySummary(quality) {
  if (!quality || typeof quality !== 'object' || Array.isArray(quality)
      || quality.confidence_percent !== 68
      || quality.continuity_semantics !== 'compatible-with-reported-uncertainty'
      || quality.precise_clock_stability_proven !== false
      || quality.physical_error_bound_proven !== false) return '';
  const cap = quality.requested_max_elapsed_uncertainty_ns;
  if (!Number.isFinite(cap) || cap < 1 || cap > 100000000) return '';
  const observed = quality.reported_max_elapsed_uncertainty_ns;
  const known = Number.isFinite(observed) && observed >= 0 && observed <= Number.MAX_SAFE_INTEGER;
  const duration = ns => ns >= 1000000 ? `${ns / 1000000} ms` : `${ns} ns`;
  const maximum = known ? `${duration(observed)} (68% confidence)` : 'unavailable';
  const comparison = known ? (observed <= cap ? ' — within the requested alignment limit' : ' — exceeds the requested alignment limit') : '';
  return `Android clock alignment: maximum reported uncertainty ${maximum}; requested limit ${duration(cap)}${comparison}. Continuity checks compatibility with reported uncertainty. Precise clock stability and a physical error bound are not proven.`;
}

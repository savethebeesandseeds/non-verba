// SPDX-License-Identifier: AGPL-3.0-only
// UI-only diagnostics: never forward coordinates, keys, traces or signed artifacts.
// Missing fields from older bridges remain unknown; wall/session time is not coverage.
const NATIVE_STATES = new Set(['requesting-permission', 'collecting', 'ready', 'finalizing', 'complete', 'error', 'cancelled']);
const RAW_ERROR_CODES = new Set(['RAW_GNSS_UNREQUESTED', 'RAW_GNSS_REQUIRED', 'RAW_GNSS_POLICY',
  'RAW_GNSS_SOURCE', 'RAW_GNSS_BOUNDS', 'RAW_GNSS_EPOCH_COUNT', 'RAW_GNSS_SEQUENCE',
  'RAW_GNSS_CLOCK_FIELDS', 'RAW_GNSS_CLOCK_CONTINUITY', 'RAW_GNSS_ALIGNMENT',
  'RAW_GNSS_MEASUREMENT_FIELDS', 'RAW_GNSS_SATELLITE_COUNT', 'RAW_GNSS_COVERAGE', 'RAW_GNSS_FRESHNESS']);
function diagnosticCount(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}
const RAW_REGISTRATION = new Set(['not-attempted', 'attempting', 'registered', 'refused', 'exception']);
const RAW_REGISTRATION_API = new Set(['androidx-compat-handler', 'api31-full-tracking']);
const RAW_RECEIVER_STATUS = new Set(['ready', 'not-supported', 'location-disabled', 'not-allowed', 'unknown']);
const RAW_WARMUP_REASONS = ['missing-elapsed-realtime', 'missing-elapsed-uncertainty', 'missing-full-bias',
  'empty-signals', 'insufficient-qualifying-satellites'];
function rawDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.unsigned !== true) return null;
  const reasons = {};
  if (value.warmup_reasons && typeof value.warmup_reasons === 'object' && !Array.isArray(value.warmup_reasons)) {
    for (const reason of RAW_WARMUP_REASONS) {
      const count = diagnosticCount(value.warmup_reasons[reason], 1000000);
      if (count != null && count > 0) reasons[reason] = count;
    }
  }
  return {unsigned: true,
    registration: RAW_REGISTRATION.has(value.registration) ? value.registration : null,
    registration_api: RAW_REGISTRATION_API.has(value.registration_api) ? value.registration_api : null,
    receiver_status: RAW_RECEIVER_STATUS.has(value.receiver_status) ? value.receiver_status : null,
    receiver_status_code: Number.isSafeInteger(value.receiver_status_code) && value.receiver_status_code >= -2147483648
      && value.receiver_status_code <= 2147483647 ? value.receiver_status_code : null,
    callback_count: diagnosticCount(value.callback_count, 1000000),
    last_callback_elapsed_ms: diagnosticCount(value.last_callback_elapsed_ms),
    cadence_skipped: diagnosticCount(value.cadence_skipped, 1000000), warmup_reasons: reasons,
    os_has_measurements: typeof value.os_has_measurements === 'boolean' ? value.os_has_measurements : null,
    os_hardware_year: Number.isInteger(value.os_hardware_year) && (value.os_hardware_year === 0
      || (value.os_hardware_year >= 2016 && value.os_hardware_year <= 9999)) ? value.os_hardware_year : null,
    os_hardware_model: typeof value.os_hardware_model === 'string' && /^[ -~]{1,120}$/.test(value.os_hardware_model)
      ? value.os_hardware_model : null};
}

// The UI consumes only sanitized diagnostics; this text never participates in verification.
export function rawGnssDiagnosticSummary(value) {
  const diagnostic = rawDiagnostics(value);
  if (!diagnostic) return '';
  const reasonLabels = {'missing-elapsed-realtime': 'missing elapsed clock', 'missing-elapsed-uncertainty': 'missing clock uncertainty',
    'missing-full-bias': 'missing full bias', 'empty-signals': 'empty signals', 'insufficient-qualifying-satellites': 'too few qualifying satellites'};
  const reasons = Object.entries(diagnostic.warmup_reasons).map(([reason, count]) => `${reasonLabels[reason]} ${count}`);
  const last = diagnostic.last_callback_elapsed_ms == null ? 'unknown' : `${(diagnostic.last_callback_elapsed_ms / 1000).toFixed(1)} s after start`;
  const receiver = diagnostic.receiver_status == null ? 'unobserved' : `${diagnostic.receiver_status} (${diagnostic.receiver_status_code ?? 'unknown code'})`;
  const capability = diagnostic.os_has_measurements == null ? 'unknown' : diagnostic.os_has_measurements ? 'reported yes' : 'reported no';
  const year = diagnostic.os_hardware_year === 0 ? 'pre-2016/unspecified' : diagnostic.os_hardware_year ?? 'unknown';
  return ` Registration ${diagnostic.registration ?? 'unknown'} via ${diagnostic.registration_api ?? 'unknown API'}; receiver status ${receiver}; raw callbacks ${diagnostic.callback_count ?? 'unknown'}, last ${last}; cadence skips ${diagnostic.cadence_skipped ?? 'unknown'}.`
    + (reasons.length ? ` Warmup reasons (may overlap): ${reasons.join(', ')}.` : '')
    + ` Unverified OS reports: measurement capability ${capability}; hardware year ${year}; model ${diagnostic.os_hardware_model ?? 'unknown'}.`;
}

const GNSS_CONSTELLATIONS = ['gps', 'sbas', 'glonass', 'qzss', 'beidou', 'galileo', 'irnss', 'unknown'];
function gnssStatusDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.unsigned !== true) return null;
  const callbacks = diagnosticCount(value.callback_count, 1000000);
  const seen = callbacks != null && callbacks > 0 ? diagnosticCount(value.satellite_count, 256) : null;
  const used = diagnosticCount(value.used_in_fix_count, seen ?? -1);
  const valid = diagnosticCount(value.cn0_sample_count, seen ?? -1);
  const invalid = diagnosticCount(value.invalid_cn0_count, seen ?? -1);
  const cn0CountsValid = valid != null && invalid != null && valid + invalid === seen;
  const cn0 = number => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 63 ? number : null;
  const minimum = cn0(value.cn0_min_dbhz), mean = cn0(value.cn0_mean_dbhz), maximum = cn0(value.cn0_max_dbhz);
  const cn0Valid = cn0CountsValid && valid > 0 && minimum != null && mean != null && maximum != null
    && minimum <= mean && mean <= maximum;
  const constellations = {};
  if (seen != null && value.constellation_counts && typeof value.constellation_counts === 'object' && !Array.isArray(value.constellation_counts)) {
    for (const name of GNSS_CONSTELLATIONS) {
      const count = diagnosticCount(value.constellation_counts[name], seen);
      if (count != null && count > 0) constellations[name] = count;
    }
  }
  const constellationTotal = Object.values(constellations).reduce((sum, count) => sum + count, 0);
  return {unsigned: true,
    registration: RAW_REGISTRATION.has(value.registration) ? value.registration : null,
    registration_api: value.registration_api === 'androidx-compat-handler' ? value.registration_api : null,
    active: typeof value.active === 'boolean' ? value.active : null,
    callback_count: callbacks,
    last_callback_elapsed_ms: callbacks != null && callbacks > 0 ? diagnosticCount(value.last_callback_elapsed_ms) : null,
    unreadable_callbacks: diagnosticCount(value.unreadable_callbacks, callbacks ?? -1),
    cleanup_failed: typeof value.cleanup_failed === 'boolean' ? value.cleanup_failed : null,
    satellite_count: seen, used_in_fix_count: used,
    cn0_sample_count: cn0CountsValid ? valid : null, invalid_cn0_count: cn0CountsValid ? invalid : null,
    cn0_min_dbhz: cn0Valid ? minimum : null, cn0_mean_dbhz: cn0Valid ? mean : null, cn0_max_dbhz: cn0Valid ? maximum : null,
    constellation_counts: constellationTotal === seen ? constellations : {}};
}

export function satelliteStatusDiagnosticSummary(value, elapsedMs) {
  const diagnostic = gnssStatusDiagnostics(value);
  if (!diagnostic) return '';
  const elapsed = diagnosticCount(elapsedMs), last = diagnostic.last_callback_elapsed_ms;
  const age = elapsed != null && last != null && last <= elapsed ? `${((elapsed - last) / 1000).toFixed(1)} s before snapshot` : 'unknown age';
  const cn0 = diagnostic.cn0_mean_dbhz == null ? 'unavailable'
    : `${diagnostic.cn0_min_dbhz.toFixed(1)}/${diagnostic.cn0_mean_dbhz.toFixed(1)}/${diagnostic.cn0_max_dbhz.toFixed(1)} dB-Hz min/mean/max`;
  const constellations = Object.entries(diagnostic.constellation_counts).map(([name, count]) => `${name} ${count}`).join(', ');
  return `Unsigned satellite status: ${diagnostic.registration ?? 'unknown registration'}; callbacks ${diagnostic.callback_count ?? 'unknown'}; seen ${diagnostic.satellite_count ?? 'unknown'}, used in latest fix ${diagnostic.used_in_fix_count ?? 'unknown'}; C/N0 ${cn0} (${diagnostic.cn0_sample_count ?? 'unknown'} valid, ${diagnostic.invalid_cn0_count ?? 'unknown'} invalid).`
    + (constellations ? ` ${constellations}.` : '')
    + ` Received ${age}; ${diagnostic.active === false ? 'collection stopped' : diagnostic.active === true ? 'collecting' : 'collection state unknown'}; unreadable ${diagnostic.unreadable_callbacks ?? 'unknown'}.`
    + (diagnostic.cleanup_failed === true ? ' Status callback cleanup failed.' : '');
}

// Fixed Rust field/reason vocabulary. Only bounded, allowlisted uncertainty
// magnitudes may accompany counts; arbitrary native properties never reach this view.
const RAW_FIELD_REASONS = Object.freeze({
  'clock.anchor_elapsed_realtime_ns': 'invalid-integer', 'clock.time_ns': 'invalid-integer',
  'clock.full_bias_ns': 'invalid-integer', 'clock.elapsed_realtime_ns': 'invalid-integer',
  'clock.bias_ns': 'out-of-range', 'clock.bias_uncertainty_ns': ['policy-range', 'negative', 'nonfinite', 'above-policy'],
  'clock.time_uncertainty_ns': ['policy-range', 'negative', 'nonfinite', 'above-policy'], 'clock.drift_ns_per_second': 'out-of-range',
  'clock.drift_uncertainty_ns_per_second': 'out-of-range', 'clock.elapsed_realtime_uncertainty_ns': ['policy-range', 'negative', 'nonfinite', 'above-policy'],
  'measurement.satellite_id': 'out-of-range', 'measurement.state': 'unsupported-bits',
  'measurement.received_sv_time_ns': 'out-of-range', 'measurement.received_sv_time_uncertainty_ns': 'out-of-range',
  'measurement.time_offset_ns': 'out-of-range', 'measurement.cn0_dbhz': 'out-of-range',
  'measurement.pseudorange_rate_mps': 'out-of-range', 'measurement.pseudorange_rate_uncertainty_mps': 'out-of-range',
  'measurement.carrier_frequency_hz': 'out-of-range', 'measurement.code_type': ['invalid-code', 'empty', 'overlong', 'invalid-characters'],
  'measurement.accumulated_delta_range_state': 'unsupported-bits', 'measurement.accumulated_delta_range_m': 'out-of-range',
  'measurement.accumulated_delta_range_uncertainty_m': 'out-of-range',
  'measurement.accumulated_delta_range_pair': 'inconsistent-presence',
  'measurement.automatic_gain_control_db': 'out-of-range', 'measurement.signal_identity': 'duplicate-signal'
});
const RAW_CLOCK_UNCERTAINTIES = new Set(['clock.bias_uncertainty_ns', 'clock.time_uncertainty_ns', 'clock.elapsed_realtime_uncertainty_ns']);
function uncertaintyMagnitude(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}
function compactMagnitude(value) {
  // Preserve every value near a permitted policy limit; rounding must not make
  // a rejected observation look equal to its maximum.
  return value < 1e9 ? String(value) : value.toExponential(3);
}
function rawFieldDiagnostics(value) {
  if (!Array.isArray(value) || value.length > 48) return [];
  const seen = new Set(), result = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.field !== 'string' || typeof entry.reason !== 'string'
      || !Object.hasOwn(RAW_FIELD_REASONS, entry.field)) continue;
    const reasons = RAW_FIELD_REASONS[entry.field];
    if (Array.isArray(reasons) ? !reasons.includes(entry.reason) : reasons !== entry.reason) continue;
    const count = diagnosticCount(entry.count, entry.field === 'clock.anchor_elapsed_realtime_ns' ? 1
      : entry.field.startsWith('clock.') ? 64 : 8192);
    const key = `${entry.field}:${entry.reason}`;
    if (!count || seen.has(key)) continue;
    const projected = {field: entry.field, reason: entry.reason, count};
    if (RAW_CLOCK_UNCERTAINTIES.has(entry.field) && entry.reason === 'above-policy') {
      const observed = uncertaintyMagnitude(entry.reported_max, 0, Number.MAX_SAFE_INTEGER);
      const requested = uncertaintyMagnitude(entry.requested_max, 1,
        entry.field === 'clock.elapsed_realtime_uncertainty_ns' ? 1e8 : 1e6);
      if (observed != null && requested != null && observed > requested) {
        projected.reported_max = observed; projected.requested_max = requested;
      }
    }
    seen.add(key); result.push(projected);
  }
  return result;
}
export function rawGnssFieldDiagnosticSummary(value, group) {
  if (!['clock', 'measurement'].includes(group)) return '';
  const fields = rawFieldDiagnostics(value).filter(entry => entry.field.startsWith(`${group}.`));
  if (!fields.length) return '';
  let summary = `Unsigned raw ${group} field notes: `, shown = 0;
  for (const entry of fields) {
    const reason = entry.field === 'measurement.code_type' && entry.reason === 'empty' ? 'empty; signal identity unknown' : entry.reason;
    const values = entry.reported_max == null ? '' : '; max ' + compactMagnitude(entry.reported_max) + ' ns, requested ≤' + compactMagnitude(entry.requested_max) + ' ns';
    const part = `${shown ? '; ' : ''}${entry.field.slice(group.length + 1)} (${reason}) ×${entry.count}${values}`;
    // Keep each accessibility paragraph below the USB helper's 512-character
    // ceiling and report omissions explicitly instead of silently truncating.
    if (summary.length + part.length + 24 > 480) break;
    summary += part; shown++;
  }
  if (shown < fields.length) summary += `; +${fields.length - shown} more fields`;
  return summary;
}

export function nativeLocationProgress(result) {
  const value = {source: 'native-android', unsigned: true,
    state: NATIVE_STATES.has(result.state) ? result.state : 'unknown',
    elapsed_ms: diagnosticCount(result.elapsed_ms), span_ms: diagnosticCount(result.span_ms),
    sample_count: diagnosticCount(result.eligible_samples, 128),
    rejected_samples: diagnosticCount(result.rejected_samples, 2147483647),
    selected_provider: ['gps', 'fused', 'network'].includes(result.selected_provider) ? result.selected_provider : null,
    failure_stage: NATIVE_STATES.has(result.failure_stage) ? result.failure_stage : null};
  if ('raw_gnss_epochs' in result || 'raw_gnss_rejected_epochs' in result || 'raw_gnss_checks' in result || 'raw_gnss_diagnostics' in result) {
    const checks = result.raw_gnss_checks;
    value.raw_gnss = {epoch_count: diagnosticCount(result.raw_gnss_epochs, 64),
      rejected_epoch_count: diagnosticCount(result.raw_gnss_rejected_epochs, 2147483647),
      evaluated_epoch_count: diagnosticCount(checks?.epoch_count, 64),
      min_qualifying_satellites: diagnosticCount(checks?.min_qualifying_satellites, 128),
      collection_action: ['retain', 'discard-startup', 'reject'].includes(checks?.collection_action) ? checks.collection_action : null,
      ready: typeof checks?.ready === 'boolean' ? checks.ready : null,
      error_codes: Array.isArray(checks?.error_codes)
        ? [...new Set(checks.error_codes.slice(0, 64).filter(code => RAW_ERROR_CODES.has(code)))] : []};
    if (checks && typeof checks === 'object' && !Array.isArray(checks) && 'field_diagnostics' in checks) value.raw_gnss.field_diagnostics = rawFieldDiagnostics(checks.field_diagnostics);
    if ('raw_gnss_diagnostics' in result) value.raw_gnss.diagnostics = rawDiagnostics(result.raw_gnss_diagnostics);
  }
  if ('gnss_status_diagnostics' in result) value.gnss_status = gnssStatusDiagnostics(result.gnss_status_diagnostics);
  if (['not-covered','pending','signed','unsigned-signing-failed','storage-failed','snapshot-failed'].includes(result.attempt_report_status)) {
    value.attempt_report_status = result.attempt_report_status;
  }
  return value;
}


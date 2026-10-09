// SPDX-License-Identifier: AGPL-3.0-only
// Platform transport only. NativeLocation owns native observations and signing;
// JavaScript never converts a browser trace into a native trace.
// Matches the Rust bounded COSE envelope (2 MiB payload + framing allowance).
export const MAX_LOCATION_PROOF = 2 * 1024 * 1024 + 16 * 1024;
export const MAX_LOCATION_MEDIA = 32 * 1024 * 1024;
const PIN = /^[0-9a-f]{64}$/;

export function checkLocationActive(signal) {
  if (signal?.aborted) throw new DOMException('Location collection cancelled.', 'AbortError');
}

export function locationPlatform() {
  const bridge = globalThis.NativeLocation;
  if (!bridge) return {profile: 'software-browser', native: false};
  // A present but failed bridge must never silently downgrade to browser GPS.
  const capabilities = nativeJson(bridge.capabilities());
  if (capabilities.available !== true || capabilities.version !== 1 || !PIN.test(capabilities.key_fingerprint)) {
    throw new Error('Native location collection is unavailable. Restart the Android app and retry.');
  }
  return {profile: 'native-android', native: true, bridge, capabilities};
}

export async function getLocationIdentity({engine, identity}) {
  const platform = locationPlatform();
  if (platform.native) {
    const publicKey = platform.capabilities.public_spki_der_b64 ?? platform.capabilities.public_key_spki_b64;
    if (typeof publicKey !== 'string' || !publicKey) throw new Error('The native location public key is unavailable.');
    return {fingerprint: platform.capabilities.key_fingerprint, public_spki_der_b64: publicKey, profile: platform.profile};
  }
  if (typeof identity !== 'string' || !identity) throw new Error('The browser location identity is unavailable.');
  return engine.json('location_identity', identity);
}

function nativeJson(text) {
  if (typeof text !== 'string' || text.length > MAX_LOCATION_PROOF * 2) throw new Error('Invalid native location response.');
  const result = JSON.parse(text);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid native location response.');
  return result;
}

function nativeCall(platform, method, ...args) {
  if (typeof platform.bridge[method] !== 'function') throw new Error('The native location bridge is incomplete.');
  return nativeJson(platform.bridge[method](...args));
}

export function cancelNativeCollection(collection) {
  if (!collection?.platform?.native || !collection.sessionId) return;
  try { nativeCall(collection.platform, 'cancel', collection.sessionId); } catch { /* Preserve the original failure. */ }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(new DOMException('Location collection cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) cancel();
  });
}

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

function nativeProgress(result) {
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

async function poll(collection, desired, {signal, onProgress}, limit) {
  const start = performance.now();
  while (true) {
    checkLocationActive(signal);
    const result = nativeCall(collection.platform, 'status', collection.sessionId);
    if (result.session_id !== collection.sessionId) throw new Error('The native location session changed.');
    // Preserve the terminal snapshot before propagating its failure to callers.
    onProgress?.(nativeProgress(result));
    if (result.ok === false || ['error', 'cancelled'].includes(result.state)) {
      throw new Error(result.error || 'Native location collection stopped. Retry with a fresh request.');
    }
    if (result.state === desired) return result;
    if (!['requesting-permission', 'collecting', 'ready', 'finalizing'].includes(result.state)) throw new Error('Unexpected native location session state.');
    if (performance.now() - start > limit) throw new Error('Native location collection timed out.');
    await delay(250, signal);
  }
}

export async function beginNativeCollection({platform, request, signal, onProgress, cameraSelection}) {
  checkLocationActive(signal);
  const result = nativeCall(platform, 'begin', JSON.stringify(request));
  if (typeof result.session_id !== 'string' || !result.session_id) throw new Error(result.error || 'Native location collection could not start.');
  const collection = {platform, request, sessionId: result.session_id};
  const abort = () => cancelNativeCollection(collection);
  signal?.addEventListener('abort', abort, {once: true});
  try {
    checkLocationActive(signal);
    onProgress?.(nativeProgress(result));
    if (result.ok === false) throw new Error(result.error || 'Native location collection could not start.');
    if(cameraSelection){
      if(typeof platform.bridge.selectForCamera!=='function') throw new Error('This Android build does not support concurrent camera location.');
      cameraSelection.select=async()=>{
        const started=performance.now();
        while(true){
          checkLocationActive(signal);
          const selected=nativeCall(platform,'selectForCamera',collection.sessionId);
          if(selected.session_id!==collection.sessionId) throw new Error('The native location session changed.');
          if(selected.ok===true && selected.selected){
            if(!Number.isFinite(selected.selected.latitude)||!Number.isFinite(selected.selected.longitude)||!Number.isSafeInteger(selected.selected.timestamp_ms)) throw new Error('Native camera selection is invalid.');
            cameraSelection.selected=Object.freeze({...selected.selected});return cameraSelection.selected;
          }
          if(selected.retryable!==true) throw new Error(selected.error||'Native camera location selection failed.');
          if(performance.now()-started>65000) throw new Error('No fresh location fix became available.');
          await delay(250,signal);
        }
      };
      cameraSelection.onStart();
    }
    const ready = await poll(collection, 'ready', {signal, onProgress}, 65000);
    checkLocationActive(signal);
    if (!ready.selected || !Number.isFinite(ready.selected.latitude) || !Number.isFinite(ready.selected.longitude)) throw new Error('Native collection returned no selected location.');
    return {...collection, selected: Object.freeze({...ready.selected})};
  } catch (error) { cancelNativeCollection(collection); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}

export async function finalizeNativeCollection(collection, {mediaBytes, signal, onProgress}) {
  checkLocationActive(signal);
  const abort = () => cancelNativeCollection(collection);
  signal?.addEventListener('abort', abort, {once: true});
  try {
    const media = mediaBytes == null ? '' : bytesToBase64(mediaBytes, MAX_LOCATION_MEDIA);
    checkLocationActive(signal);
    const starting = nativeCall(collection.platform, 'finalize', collection.sessionId, media);
    if (starting.session_id === collection.sessionId) onProgress?.(nativeProgress(starting));
    if (starting.ok === false) throw new Error(starting.error || 'Native location signing failed.');
    const completed = await poll(collection, 'complete', {signal, onProgress}, 15000);
    checkLocationActive(signal);
    return base64ToBytes(completed.result?.proof_base64, MAX_LOCATION_PROOF);
  } catch (error) { cancelNativeCollection(collection); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}

export function bytesToBase64(bytes, limit = MAX_LOCATION_PROOF) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > limit) throw new Error('Invalid location artifact size.');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}

export function base64ToBytes(encoded, limit = MAX_LOCATION_PROOF) {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > Math.ceil(limit / 3) * 4
      || encoded.length % 4 !== 0) throw new Error('Invalid location proof encoding.');
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  // A repeated-group regex can exhaust the stack on otherwise bounded large files.
  if (/[^A-Za-z0-9+/]/.test(encoded.slice(0, encoded.length - padding))) throw new Error('Invalid location proof encoding.');
  const binary = atob(encoded);
  if (binary.length === 0 || binary.length > limit) throw new Error('The location proof is too large.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytesToBase64(bytes, limit) !== encoded) throw new Error('Noncanonical location proof encoding.');
  return bytes;
}

export function locationProofEnvelope(bytes) {
  return {version: 1, type: 'nonverba-location-proof', proof_base64: bytesToBase64(bytes)};
}

export function readLocationProofEnvelope(text) {
  if (typeof text !== 'string' || text.length > MAX_LOCATION_PROOF * 2) throw new Error('The location proof is too large.');
  const envelope = JSON.parse(text);
  if (envelope?.version !== 1 || envelope.type !== 'nonverba-location-proof') throw new Error('Choose a signed Non-verba location proof.');
  return base64ToBytes(envelope.proof_base64);
}

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

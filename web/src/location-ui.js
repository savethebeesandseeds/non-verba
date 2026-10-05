// SPDX-License-Identifier: AGPL-3.0-only
import {createCoreClient} from './core-client.js';
import {loadIdentity, saveIdentity, read, reserveCapture} from './storage.js';
import {beginLocationCollection, finalizeLocationProof} from './location-capture.js';
import {locationPolicy, locationTimingSummary, locationSealingSummary} from './location-policy.js';
import {newRequestPreset, installRequestPresetSummary} from './request-presets.js';
import {installGpsAttemptUi, gpsAttemptValidationAvailable} from './gps-attempt.js';
import {locationPlatform, getLocationIdentity, locationProofEnvelope, readLocationProofEnvelope,
  bytesToBase64, MAX_LOCATION_PROOF, MAX_LOCATION_MEDIA, rawGnssDiagnosticSummary, satelliteStatusDiagnosticSummary, rawGnssFieldDiagnosticSummary,
  locationReportPresentation, rawGnssTimingQualitySummary} from './location-platform.js';

const $ = id => document.getElementById(id), engine = createCoreClient();
const now = () => Math.floor(Date.now() / 1000), json = value => JSON.stringify(value, null, 2);
const PIN = /^[0-9a-f]{64}$/;
let ready = false, identity = null, key = null, issued = null, loaded = null, artifact = null;
let active = null, collectionRevision = 0, requestIntent = 0, verifyRevision = 0, proofInput = null, report = null;
let acquisitionDiagnostics = null;
const busy = new Set();
const RAW_REQUEST_HELP = 'This request requires raw satellite measurements. Unsupported collection stops; a reduced profile requires the requester to explicitly issue a fresh request.';
const validationAvailable = gpsAttemptValidationAvailable(window.NativeLocation);
$('location-rejection-validation').hidden = !validationAvailable;

function notice(message, error = false) { $('location-notice').hidden = false; $('location-notice').className = `notice ${error ? 'error' : ''}`; $('location-notice').textContent = message; }
function status(message) { $('location-status').textContent = message; }
function updateButtons() {
  for (const id of ['location-demo', 'location-create-request', 'location-load-request']) $(id).disabled = !ready || !!active;
  $('location-create-rejection-request').disabled = !ready || !!active || !validationAvailable;
  $('location-collect').disabled = !ready || !loaded || !!active || !!artifact;
  $('location-cancel').disabled = !active;
  $('location-save-request').disabled = !issued; $('location-use-request').disabled = !issued || !!active;
  $('location-save-key').disabled = !key; $('location-save-proof').disabled = !artifact;
  $('location-save-proof-request').disabled = !artifact; $('location-inspect-proof').disabled = !artifact; $('location-save-report').disabled = !report;
  $('location-verify-button').disabled = !ready;
  for (const id of busy) $(id).disabled = true;
}
function action(id, callback) {
  $(id).addEventListener('click', async () => {
    if ($(id).disabled) return;
    busy.add(id); $(id).setAttribute('aria-busy', 'true'); $('location-notice').hidden = true; updateButtons();
    try { await callback(); } catch (error) {
      if (error?.name === 'AbortError') notice('Location collection cancelled. No new proof was produced.');
      else notice(String(error?.message || error), true);
    } finally { busy.delete(id); $(id).removeAttribute('aria-busy'); updateButtons(); }
  });
}
function cancelCollection() {
  collectionRevision++;
  active?.abort(); active = null;
  $('location-progress-panel').hidden = !acquisitionDiagnostics;
  status('Collection stopped. Start a new collection when ready.'); updateButtons();
}
function showView(name) {
  if (name !== 'operator' && active) cancelCollection();
  for (const view of document.querySelectorAll('.location-view')) view.hidden = view.id !== `location-${name}`;
  for (const button of document.querySelectorAll('[data-location-view]')) {
    button.dataset.locationView === name ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current');
  }
}
for (const button of document.querySelectorAll('[data-location-view]')) button.addEventListener('click', () => {
  requestIntent++; if (!active) collectionRevision++; showView(button.dataset.locationView);
});
$('location-cancel').addEventListener('click', cancelCollection);
document.addEventListener('visibilitychange', () => { if (document.hidden && active) cancelCollection(); });
window.addEventListener('pagehide', () => { if (active) cancelCollection(); });
window.addEventListener('nonverba:pause', () => { if (active) cancelCollection(); });

async function localIdentity() {
  if (locationPlatform().native) return null;
  if (identity) return identity;
  const provision = async () => { let value = await loadIdentity(); if (!value) { value = await engine.call('create_identity'); await saveIdentity(value); } return value; };
  identity = navigator.locks ? await navigator.locks.request('nonverba-signing-identity', provision) : await provision();
  return identity;
}
async function save(name, mime, bytes) {
  if (typeof bytes === 'string') bytes = new TextEncoder().encode(bytes);
  if (window.NativeVault) {
    if (!window.NativeVault.saveArtifact(name, mime, bytesToBase64(bytes, MAX_LOCATION_PROOF * 2))) throw new Error('Android could not export the location artifact.');
  } else {
    const url = URL.createObjectURL(new Blob([bytes], {type: mime})), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
function parseRequest(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 65536) throw new Error('Choose a location request under 64 KiB.');
  return JSON.parse(text);
}
async function loadRequest(value) {
  requestIntent++;
  cancelCollection(); acquisitionDiagnostics = null; $('location-progress-panel').hidden = true;
  artifact = null; loaded = null; $('location-result').hidden = true;
  const revision = collectionRevision;
  const validated = await engine.json('validate_location_request', json(value), now());
  const consumed = await read('captures', `location:${validated.challenge.id}`);
  if (revision !== collectionRevision) throw new DOMException('Location request loading cancelled.', 'AbortError');
  if (consumed) throw new Error('This location request was already used on this device. Ask for a fresh request.');
  loaded = validated; $('location-request-input').value = json(validated);
  $('location-loaded-task').textContent = validated.challenge.task;
  $('location-demo-active').hidden = !validated.demo;
  $('location-policy-summary').textContent = `${validated.policy.duration_ms / 1000} seconds minimum observation span · at least ${validated.policy.min_samples} samples · reported accuracy ${validated.policy.max_accuracy_m} m or better. Startup can take longer.${validated.policy.raw_gnss ? ' ' + RAW_REQUEST_HELP : ''}`;
  $('location-policy-summary').textContent += ' ' + locationTimingSummary(validated.policy);
  $('location-platform-label').textContent = key?.profile === 'native-android' ? 'ANDROID NATIVE LOCATION · OS MOCK SIGNAL' : 'BROWSER LOCATION · MOCK STATUS UNKNOWN';
  status('Request ready. Allow location access and keep this screen open.'); updateButtons(); return validated;
}
function progress(value) {
  if (value.source === 'native-android' && value.unsigned === true) {
    acquisitionDiagnostics = value;
    const satelliteSummary = satelliteStatusDiagnosticSummary(value.gnss_status, value.elapsed_ms);
    $('location-satellite-status').textContent = satelliteSummary;
    $('location-satellite-status').hidden = !satelliteSummary;
    // A minute waiting for GPS callbacks must never look like a sampled window.
    $('location-progress').value = Math.min(loaded?.policy.duration_ms || 10000, value.span_ms ?? 0);
    const span = value.span_ms == null ? 'unknown observation span' : `${(value.span_ms / 1000).toFixed(1)} s observation span`;
    const stage = value.failure_stage ? `${value.state} (from ${value.failure_stage})` : value.state;
    const raw = value.raw_gnss;
    const evaluation = raw?.evaluated_epoch_count == null ? ''
      : `Unsigned last raw evaluation: ${raw.evaluated_epoch_count} epochs evaluated; minimum ${raw.min_qualifying_satellites ?? 'unknown'} qualifying satellites per epoch; decision ${raw.collection_action ?? 'unavailable'}. Evaluated candidates may be rejected; retained epochs are reported separately.`;
    $('location-raw-evaluation').textContent = evaluation;
    $('location-raw-evaluation').hidden = !evaluation;
    for (const group of ['clock', 'measurement']) {
      const text = rawGnssFieldDiagnosticSummary(raw?.field_diagnostics, group);
      $(`location-raw-${group}-diagnostics`).textContent = text;
      $(`location-raw-${group}-diagnostics`).hidden = !text;
    }
    const rawSummary = raw ? ` Raw GNSS: ${raw.epoch_count ?? 'unknown'} epochs, ${raw.rejected_epoch_count ?? 'unknown'} rejected; checks ${raw.ready == null ? 'unavailable' : raw.ready ? 'ready' : 'not ready'}${raw.error_codes.length ? ` (${raw.error_codes.join(', ')})` : ''}.` : '';
    $('location-progress-details').textContent = `Unsigned acquisition diagnostics (last native snapshot): ${stage}; provider ${value.selected_provider ?? 'not selected or unavailable'}; ${value.sample_count ?? 'unknown'} eligible samples, ${value.rejected_samples ?? 'unknown'} rejected; ${span}.${rawSummary}${rawGnssDiagnosticSummary(raw?.diagnostics)}`;
    if (['error','cancelled'].includes(value.state)) {
      $('gps-attempt-status').textContent = value.attempt_report_status === 'pending'
        ? 'GPS attempt report is being finalized separately. Refresh retained attempts to inspect or export its outcome.'
        : `GPS attempt reporting state: ${value.attempt_report_status || 'not available'}. Refresh retained attempts to inspect any available record.`;
    }
    return;
  }
  $('location-raw-evaluation').hidden = true; $('location-raw-evaluation').textContent = '';
  for (const group of ['clock', 'measurement']) {
    $(`location-raw-${group}-diagnostics`).hidden = true; $(`location-raw-${group}-diagnostics`).textContent = '';
  }
  $('location-satellite-status').hidden = true;
  $('location-satellite-status').textContent = '';
  $('location-progress').value = Math.min(loaded?.policy.duration_ms || 10000, value.span_ms ?? value.elapsed_ms ?? 0);
  $('location-progress-details').textContent = `${value.sample_count || 0} eligible samples. ${value.message || (value.state === 'requesting-permission' ? 'Waiting for Android location permission.' : 'Collecting fresh measurements…')}`;
  if (value.last_sample) {
    const p = value.last_sample; $('location-current-fix').textContent = `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)} · ±${Math.ceil(p.accuracy_m)} m`;
  }
}
async function collect(request) {
  if (!request) throw new Error('Load a fresh requester challenge first.');
  const revision = ++collectionRevision, controller = new AbortController(); active = controller;
  artifact = null; acquisitionDiagnostics = null; $('location-result').hidden = true; $('location-progress-panel').hidden = false;
  $('location-progress').max = request.policy.duration_ms; $('location-progress').value = 0;
  $('location-current-fix').textContent = ''; $('location-progress-details').textContent = 'Waiting for the first fresh location measurement…';
  $('location-raw-evaluation').hidden = true; $('location-raw-evaluation').textContent = '';
  for (const group of ['clock', 'measurement']) {
    $(`location-raw-${group}-diagnostics`).hidden = true; $(`location-raw-${group}-diagnostics`).textContent = '';
  }
  $('location-satellite-status').hidden = true; $('location-satellite-status').textContent = '';
  status('Collecting device location. Keep this screen open.'); updateButtons();
  let collection, complete = false;
  const current = () => { if (controller.signal.aborted || revision !== collectionRevision) throw new DOMException('Location collection cancelled.', 'AbortError'); };
  const onProgress = value => { if (active === controller && revision === collectionRevision) progress(value); };
  try {
    collection = await beginLocationCollection({engine, request, signal: controller.signal, onProgress}); current();
    // The valid window is committed once. A failed signing attempt requires a
    // fresh request; permission and measurement failures do not consume it.
    await reserveCapture(`location:${request.challenge.id}`, {kind: 'location', captured_at: now()}); current();
    status('Checking the collected observations and signing the location proof…');
    const bytes = await finalizeLocationProof({engine, collection, identity, signal: controller.signal, onProgress}); current();
    const checked = await engine.json('verify_location_proof', bytes, json(request), key.fingerprint, 'null', now()); current();
    if (!checked.verified) throw new Error(`The location proof failed its local verification: ${(checked.errors || []).join('; ')}`);
    artifact = {bytes, request, key: key.fingerprint, report: checked}; complete = true;
    $('location-result').hidden = false; $('location-result-title').textContent = request.demo ? 'Demo location record ready.' : 'Signed location record ready.';
    const trace = checked.evidence.trace;
    const last = checked.selected_location;
    $('location-result-description').textContent = `${last.latitude.toFixed(6)}, ${last.longitude.toFixed(6)} · reported accuracy ±${Math.ceil(last.accuracy_m)} m. ${trace.samples.length} samples · ${trace.request.policy.duration_ms / 1000} second window · ${checked.profile === 'native-android' ? 'native Android observations' : 'browser observations; mock status unknown'}. ${request.demo ? 'Requester and operator are this same device.' : 'Save this proof with the original request.'}`;
    status('Location proof signed and locally verified.'); notice('Your location proof is ready. The signature protects the record; physical location remains device-reported.');
  } finally {
    if (!complete) collection?.cancel();
    if (active === controller) { active = null; $('location-progress-panel').hidden = complete || !acquisitionDiagnostics; if (!complete) status('No completed location proof was produced.'); }
    updateButtons();
  }
}

action('location-create-request', async () => {
  const preset = newRequestPreset('location',{profile:$('location-profile').value});
  const policy = locationPolicy(preset.profile, preset.duration_ms);
  issued = await engine.json('create_location_request', $('location-requester-name').value.trim(), $('location-task').value.trim(), now(), 900, json(policy), 'null');
  $('location-created-request').value = json(issued); notice('Fresh request created. Keep the original and send a copy to the operator.' + (policy.raw_gnss ? ' ' + RAW_REQUEST_HELP : ''));
});
action('location-create-rejection-request', async () => {
  if (!validationAvailable) throw new Error('Strict validation requests require the debug Android app.');
  const policy = locationPolicy('raw-gnss', 2000);
  // A new, explicitly tighter request; actual native observations remain untouched.
  policy.raw_gnss.max_elapsed_realtime_uncertainty_ns = 1;
  policy.max_delivery_delay_ms = 1;
  issued = await engine.json('create_location_request', $('location-requester-name').value.trim(), $('location-task').value.trim(), now(), 900, json(policy), 'null');
  $('location-created-request').value = json(issued);
  notice('Fresh strict GPS validation request created: Android clock alignment uncertainty at most 1 ns and delivery at most 1 ms. Save the original before collection. This deliberately tests policy refusal using actual observations.');
});
installRequestPresetSummary(document,'location','location-request-preset-summary',['location-profile'],()=>({profile:$('location-profile').value}));
action('location-save-request', async () => { if (!issued) return; await save(`nonverba-location-request-${issued.challenge.id.slice(0, 12)}.json`, 'application/json', json(issued)); });
action('location-use-request', async () => { await loadRequest(issued); showView('operator'); });
action('location-load-request', async () => loadRequest(parseRequest($('location-request-input').value)));
action('location-collect', async () => collect(loaded));
action('location-demo', async () => {
  const intent = ++requestIntent;
  const request = await engine.json('create_location_demo_request', now());
  if (intent !== requestIntent) throw new DOMException('Location demo setup cancelled.', 'AbortError');
  issued = request; $('location-created-request').value = json(request);
  const selected = await loadRequest(request); showView('operator'); await collect(selected);
});
action('location-save-key', async () => save('nonverba-public-location-key.json', 'application/json', json({version: 1, type: 'nonverba-public-location-key', ...key})));
action('location-save-proof', async () => { if (artifact) await save(`nonverba-location-${artifact.request.challenge.id.slice(0, 12)}.json`, 'application/json', json(locationProofEnvelope(artifact.bytes))); });
action('location-save-proof-request', async () => { if (artifact) await save(`nonverba-location-request-${artifact.request.challenge.id.slice(0, 12)}.json`, 'application/json', json(artifact.request)); });
$('location-request-input').addEventListener('input', () => { requestIntent++; cancelCollection(); acquisitionDiagnostics = null; $('location-progress-panel').hidden = true; loaded = null; artifact = null; $('location-result').hidden = true; updateButtons(); });
$('location-request-file').addEventListener('change', async () => {
  const intent = ++requestIntent; cancelCollection();
  try { const file = $('location-request-file').files?.[0]; if (!file) return; if (file.size > 65536) throw new Error('Location requests must be under 64 KiB.'); const text = await file.text(); if (intent !== requestIntent) return; await loadRequest(parseRequest(text)); }
  catch (error) { notice(String(error?.message || error), true); }
});

function invalidateVerification() {
  verifyRevision++; report = null; $('location-verdict').textContent = 'No record checked.';
  $('location-checks').replaceChildren(); $('location-verification-dimensions').replaceChildren();
  $('location-verification-note').textContent = ''; $('location-report-json').textContent = ''; updateButtons();
}
for (const id of ['location-verify-request', 'location-verify-key']) $(id).addEventListener('input', invalidateVerification);
$('location-bound-media').addEventListener('change', invalidateVerification);
$('location-proof-file').addEventListener('change', () => { proofInput = null; invalidateVerification(); $('location-proof-filename').textContent = $('location-proof-file').files?.[0]?.name || 'COSE proof in a JSON envelope'; });
$('location-verify-request-file').addEventListener('change', async () => {
  invalidateVerification(); const revision = verifyRevision;
  try { const file = $('location-verify-request-file').files?.[0]; if (!file) return; if (file.size > 65536) throw new Error('Location requests must be under 64 KiB.'); const text = await file.text(); parseRequest(text); if (revision === verifyRevision) $('location-verify-request').value = text; }
  catch (error) { if (revision === verifyRevision) notice(String(error?.message || error), true); }
});
const checks = {
  signature_integrity: 'COSE signature integrity', device_match: 'Expected location signing key', request_match: 'Exact requester challenge',
  policy_valid: 'Requested collection policy', source_claim_matches_policy: 'Reported source matches policy', sample_count_valid: 'Enough eligible measurements',
  sequence_valid: 'Distinct ordered measurements', collection_duration_valid: 'Required measurement window', clock_consistent: 'Reported clocks agree',
  fix_freshness_valid: 'Fix freshness, delivery and signing limits', accuracy_valid: 'Requested accuracy threshold', motion_consistent: 'Motion consistency',
  mock_locations_rejected: 'Mock-location policy', uncertainty_semantics_valid: 'Uncertainty semantics declared',
  capture_time_in_window: 'Reported time within request window', capture_not_in_future: 'Reported time not in future', asset_binding: 'Optional file binding'
};
function renderReport(value) {
  report = value;
  const presentation = locationReportPresentation(value);
  $('location-verdict').textContent = presentation.headline;
  $('location-verification-note').textContent = presentation.note;
  const root = $('location-checks'); root.replaceChildren();
  for (const [name, label] of Object.entries(checks)) {
    const row = document.createElement('div'); row.className = 'check-row';
    const title = document.createElement('span'); title.textContent = label;
    const state = document.createElement('span'); state.textContent = value.checks?.[name] === true ? 'PASS' : 'FAIL'; state.className = value.checks?.[name] === true ? 'pass' : 'fail';
    row.append(title, state); root.append(row);
  }
  const dimensions = $('location-verification-dimensions'); dimensions.replaceChildren(); dimensions.className = 'location-dimensions';
  const trace = value.evidence?.trace;
  const raw = value.raw_gnss;
  if (raw) {
    const rawChecks = {
      policy_valid: 'Raw satellite collection policy', source_valid: 'Native GPS source requirement',
      bounds_valid: 'Bounded satellite record', epoch_count_valid: 'Enough receiver observations',
      epoch_sequence_valid: 'Receiver observation ordering', clock_fields_valid: 'Receiver clock fields',
      clock_continuity_valid: 'Receiver clock continuity', collection_alignment_valid: 'Native callback timing',
      measurement_fields_valid: 'Satellite measurement fields', satellite_count_valid: 'Distinct qualifying satellites',
      coverage_valid: 'Satellite observations cover the location window', freshness_valid: 'Receiver observations fresh at sealing'
    };
    for (const [name, label] of Object.entries(rawChecks)) {
      const row = document.createElement('div'); row.className = 'check-row';
      const title = document.createElement('span'); title.textContent = label;
      const state = document.createElement('span'); state.textContent = raw[name] === true ? 'PASS' : 'FAIL';
      state.className = raw[name] === true ? 'pass' : 'fail'; row.append(title, state); root.append(row);
    }
  }
  for (const text of [
    locationTimingSummary(trace?.request?.policy),
    locationSealingSummary(value.evidence),
    rawGnssTimingQualitySummary(raw?.timing_quality),
    `Collection profile: ${value.profile || 'unknown'}.`,
    `Signing-key protection: ${value.key_protection || 'unknown'}.`,
    `Mock-location signal: ${value.profile === 'software-browser' ? 'unknown — unavailable through browser geolocation' : 'reported by the native operating-system provider; not remote attestation'}.`,
    `Clock trusted: ${value.clock_trusted ? 'yes' : 'no'}. Hardware attested: ${value.hardware_attested ? 'yes' : 'no'}.`,
    raw ? `Raw satellite evidence: ${raw.epoch_count} receiver observations; at least ${raw.min_qualifying_satellites} qualifying satellites per observation. Satellite authentication: ${raw.satellite_authentication_verified ? 'verified' : 'not verified'}. Independent position recomputation: ${raw.independent_position_recomputed ? 'performed' : 'not performed'}.` : 'Raw satellite measurements: not requested or supplied.',
    trace ? `${trace.samples.length} measurements; requested window ${trace.request.policy.duration_ms / 1000} seconds; uncertainty ${trace.uncertainty_semantics}; permission precision ${trace.permission_precision}.` : 'No valid measurement trace available.',
    value.verified && value.selected_location ? `Selected device report: ${value.selected_location.latitude.toFixed(6)}, ${value.selected_location.longitude.toFixed(6)} · ±${Math.ceil(value.selected_location.accuracy_m)} m.` : 'Selected coordinates are not verified against the expected request and key.',
    value.evidence?.asset ? `Bound asset: ${value.evidence.asset.kind} · ${value.evidence.asset.sha256}` : 'Standalone record: no media file bound.'
  ].filter(Boolean)) { const p = document.createElement('p'); p.textContent = text; dimensions.append(p); }
  $('location-report-json').textContent = json(value); updateButtons();
}
async function verify() {
  invalidateVerification(); const revision = verifyRevision;
  const request = parseRequest($('location-verify-request').value), pin = $('location-verify-key').value.trim().toLowerCase();
  if (!PIN.test(pin)) throw new Error('Supply the 64-character location key ID received through a trusted channel.');
  let bytes = proofInput;
  if (!bytes) {
    const file = $('location-proof-file').files?.[0]; if (!file) throw new Error('Choose a signed location proof.');
    if (file.size > MAX_LOCATION_PROOF * 2) throw new Error('The location proof is too large.');
    bytes = file.name.toLowerCase().endsWith('.cose') ? new Uint8Array(await file.arrayBuffer()) : readLocationProofEnvelope(await file.text());
    if (bytes.length > MAX_LOCATION_PROOF) throw new Error('The COSE proof is too large.');
  }
  const file = $('location-bound-media').files?.[0]; let asset = null;
  if (file) { if (file.size > MAX_LOCATION_MEDIA) throw new Error('The bound JPEG exceeds 32 MiB.'); asset = await engine.json('location_asset', new Uint8Array(await file.arrayBuffer())); }
  const value = await engine.json('verify_location_proof', bytes, json(request), pin, json(asset), now());
  if (revision === verifyRevision) renderReport(value);
}
action('location-verify-button', verify);
action('location-inspect-proof', async () => {
  if (!artifact) return;
  proofInput = artifact.bytes; $('location-proof-filename').textContent = 'Current locally signed location proof'; $('location-proof-file').value = '';
  $('location-verify-request').value = json(artifact.request); $('location-verify-key').value = artifact.key; $('location-bound-media').value = '';
  showView('verify'); await verify();
});
action('location-save-report', async () => { if (report) await save('nonverba-location-verification.json', 'application/json', json(report)); });

engine.ready.then(async () => {
  await localIdentity(); key = await getLocationIdentity({engine, identity});
  $('location-key-id').textContent = key.fingerprint; ready = true;
  $('location-runtime').textContent = key.profile === 'native-android' ? 'NATIVE LOCATION + LOCAL RUST' : 'LOCAL RUST ENGINE READY'; updateButtons();
}).catch(error => { $('location-runtime').textContent = 'LOCATION ENGINE UNAVAILABLE'; notice(String(error?.message || error), true); });
installGpsAttemptUi({document, native: window.NativeLocation, engine, save});
updateButtons();

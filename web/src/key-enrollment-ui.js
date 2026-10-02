// SPDX-License-Identifier: AGPL-3.0-only
import {createCoreClient} from './core-client.js';
import {bytesToBase64} from './location-platform.js';
import {enrollmentPlatform, enrollmentCapabilities, exportEnrollment, selectEnrollmentProfile, NativeEnrollmentSession} from './key-enrollment-platform.js';
const $ = id => document.getElementById(id), engine = createCoreClient(), bridge = enrollmentPlatform();
const json = value => JSON.stringify(value, null, 2), now = () => Math.floor(Date.now() / 1000);
let ready = false, issued = null, response = null, report = null, capabilities = null, active = null;
let verificationRevision = 0;
const busy = new Set();
const initialPolicy = {version:1,max_enrollment_age_secs:86400,package_name:'org.nonverba.camera',min_version_code:7,
  signing_certificate_sha256:['7ed35bc9854def89ea0e3130865941b408c2a54d62b28e6ece7f01300bdc8649'],
  minimum_security_level:'trusted-environment',minimum_os_version:120000,
  minimum_os_patch_level:202601,minimum_vendor_patch_level:20260101,minimum_boot_patch_level:20260101};
$('enrollment-policy').value = json(initialPolicy);
function notice(message, error = false) { $('enrollment-notice').hidden = false; $('enrollment-notice').className = `notice ${error ? 'error' : ''}`; $('enrollment-notice').textContent = message; }
function profile() {
  const purpose = $('enrollment-select-purpose').value, selected = capabilities?.purposes?.[purpose];
  const pin = $('enrollment-profile').value === 'legacy' ? selected?.legacy_fingerprint : $('enrollment-key').value;
  return {purpose, selected, pin};
}
function controls() {
  $('enrollment-create').disabled = !ready || !!active;
  $('enrollment-save-request').disabled = !issued;
  $('enrollment-use-request').disabled = !issued || !!active;
  $('enrollment-begin').disabled = !ready || !bridge || !!active;
  $('enrollment-cancel').disabled = !active;
  $('enrollment-export').disabled = !response || !!active;
  $('enrollment-verify-button').disabled = !ready || !!active;
  $('enrollment-save-report').disabled = !report;
  const {pin} = profile();
  $('enrollment-select').disabled = !ready || !bridge || !pin || !!active;
  $('enrollment-export-existing').disabled = !bridge || !$('enrollment-key').value || !!active;
  $('enrollment-key').disabled = !!active || !$('enrollment-key').options.length;
  for (const id of busy) $(id).disabled = true;
}
function renderProfiles() {
  const purpose = $('enrollment-select-purpose').value, current = capabilities?.purposes?.[purpose];
  const previous = $('enrollment-key').dataset.purpose === purpose ? $('enrollment-key').value : '';
  $('enrollment-key').replaceChildren();
  $('enrollment-key').dataset.purpose = purpose;
  for (const enrollment of current?.enrollments || []) {
    if (!/^[0-9a-f]{64}$/.test(enrollment.fingerprint)) continue;
    const option = document.createElement('option');
    option.value = enrollment.fingerprint;
    option.textContent = `${enrollment.fingerprint.slice(0, 16)}…${enrollment.fingerprint.slice(-8)}`;
    $('enrollment-key').append(option);
  }
  const available = [...$('enrollment-key').options].map(option => option.value);
  const preferred = available.includes(previous) ? previous : current?.fingerprint;
  if (available.includes(preferred)) $('enrollment-key').value = preferred;
  renderSelection();
}
function renderSelection() {
  const {selected, pin} = profile();
  const selectedPin = selected?.fingerprint || (selected?.key_profile === 'legacy' ? selected?.legacy_fingerprint : '');
  $('enrollment-selected').textContent = selected ? `Selected: ${selected.key_profile}\n${selectedPin || ''}` : 'No native key profiles available.';
  $('enrollment-profile-pin').textContent = pin || 'This identity has not been enrolled.';
  controls();
}
function refreshProfiles() { capabilities = enrollmentCapabilities(bridge); renderProfiles(); }
function invalidateVerification(message = 'Inputs changed. Verify again.') {
  verificationRevision++; report = null;
  $('enrollment-verdict').textContent = message;
  for (const id of ['enrollment-verification-note', 'enrollment-verified-pin', 'enrollment-report']) $(id).textContent = '';
  controls();
}
function view(name) {
  for (const section of document.querySelectorAll('.enrollment-view')) section.hidden = section.id !== `enrollment-${name}`;
  for (const button of document.querySelectorAll('[data-enrollment-view]')) button.dataset.enrollmentView === name ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current');
}
function cancel() { active?.cancel(); active = null; $('enrollment-progress').textContent = 'Enrollment stopped. Any generated key remains preserved.'; controls(); }
for (const button of document.querySelectorAll('[data-enrollment-view]')) button.addEventListener('click', () => { if (active) cancel(); view(button.dataset.enrollmentView); });
function action(id, fn) { $(id).addEventListener('click', async () => {
  if ($(id).disabled) return; busy.add(id); controls(); $('enrollment-notice').hidden = true;
  try { await fn(); } catch (error) { notice(String(error?.message || error), true); }
  finally { busy.delete(id); controls(); }
}); }
async function save(name, value) {
  const text = typeof value === 'string' ? value : json(value);
  if (window.NativeVault) {
    if (!window.NativeVault.saveArtifact(name, 'application/json', bytesToBase64(new TextEncoder().encode(text), 4 * 1024 * 1024))) throw new Error('Android could not export this record.');
  } else {
    const url = URL.createObjectURL(new Blob([text], {type:'application/json'})), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
function importFile(id, target, limit, arrival = false) { $(id).addEventListener('change', async () => {
  const file = $(id).files?.[0]; if (!file) return;
  try {
    if (file.size > limit) throw new Error('This enrollment file exceeds its size limit.');
    const text = await file.text();
    // Capture local complete arrival before asynchronous cryptographic verification.
    if (arrival) $('enrollment-arrival').value = String(now());
    JSON.parse(text); $(target).value = text;
    invalidateVerification();
  } catch (error) { notice(String(error?.message || error), true); }
}); }
importFile('enrollment-request-file','enrollment-operator-request',4096);
importFile('enrollment-original-file','enrollment-verify-request',4096);
importFile('enrollment-response-file','enrollment-response',256*1024,true);
importFile('enrollment-trust-file','enrollment-trust',2*1024*1024);
action('enrollment-create', async () => {
  issued = await engine.json('create_key_enrollment_request', $('enrollment-purpose').value, now());
  invalidateVerification('New challenge created. No enrollment checked.');
  $('enrollment-created').value = json(issued); $('enrollment-verify-request').value = json(issued);
});
action('enrollment-save-request', () => save('nonverba-key-enrollment-request.json', issued));
action('enrollment-use-request', () => { $('enrollment-operator-request').value = json(issued); view('operator'); });
action('enrollment-begin', async () => {
  const request = await engine.json('validate_key_enrollment_request', $('enrollment-operator-request').value, now());
  if (active || document.hidden) throw new Error('Keep the enrollment page in the foreground.');
  response = null; const session = new NativeEnrollmentSession(bridge); active = session; controls();
  try {
    const result = await session.run(request, message => { $('enrollment-progress').textContent = message; });
    if (active !== session || document.hidden) throw new Error('Enrollment delivery was cancelled.');
    response = result; $('enrollment-progress').textContent = 'Enrollment response ready. Send it to the requester for independent verification.';
    refreshProfiles();
  } catch (error) {
    if (active === session) $('enrollment-progress').textContent = 'Enrollment stopped without a usable response. Any generated key remains preserved.';
    throw error;
  } finally { if (active === session) active = null; }
});
$('enrollment-cancel').addEventListener('click', cancel);
action('enrollment-export', () => save('nonverba-key-enrollment-response.json', response));
action('enrollment-export-existing', async () => { response = exportEnrollment(bridge, profile().purpose, $('enrollment-key').value); await save('nonverba-key-enrollment-response.json', response); });
for (const id of ['enrollment-select-purpose','enrollment-profile']) $(id).addEventListener('change', renderProfiles);
$('enrollment-key').addEventListener('change', renderSelection);
action('enrollment-select', () => {
  const {purpose, pin} = profile(); selectEnrollmentProfile(bridge, purpose, $('enrollment-profile').value, pin);
  refreshProfiles(); notice('Signing identity selected for future captures. Share its key ID with your requester.');
});
$('enrollment-mark-arrival').addEventListener('click', () => { $('enrollment-arrival').value = String(now()); invalidateVerification(); });
action('enrollment-verify-button', async () => {
  invalidateVerification('Checking enrollment…');
  const revision = verificationRevision;
  try {
    const arrival = Number($('enrollment-arrival').value);
    if (!$('enrollment-arrival').value || !Number.isSafeInteger(arrival)) throw new Error('Record when the requester received this response.');
    const verified = await engine.json('verify_key_enrollment', $('enrollment-response').value, $('enrollment-verify-request').value,
      $('enrollment-policy').value, $('enrollment-trust').value, arrival, now());
    if (revision !== verificationRevision) return;
    report = verified;
    $('enrollment-verdict').textContent = report.key_enrollment_attested ? 'Hardware key enrollment verified.' : 'Test chain checked. Hardware trust not established.';
    $('enrollment-verification-note').textContent = 'State applies at key generation. Verify future sensor evidence under this exact identity; no capture or signing-key possession was proven by this certificate check.';
    $('enrollment-verified-pin').textContent = `${report.purpose} key ID: ${report.fingerprint}`;
    $('enrollment-report').textContent = json(report);
  } catch (error) { if (revision === verificationRevision) $('enrollment-verdict').textContent = 'Enrollment verification failed.'; throw error; }
});
action('enrollment-save-report', () => save('nonverba-key-enrollment-verification.json', report));
for (const id of ['enrollment-verify-request','enrollment-response','enrollment-policy','enrollment-trust','enrollment-arrival']) $(id).addEventListener('input', () => {
  invalidateVerification();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && active) cancel(); });
window.addEventListener('pagehide', () => { if (active) cancel(); });
window.addEventListener('nonverba:pause', () => { if (active) cancel(); });
engine.ready.then(() => {
  ready = true; $('enrollment-runtime').textContent = bridge ? 'ANDROID KEY ENROLLMENT' : 'REQUESTER VERIFICATION';
  $('enrollment-native-note').textContent = bridge ? 'Create a separate key from the requester’s original challenge. Keep the app open.' : 'Create and verify requests here. Creating a phone key requires the Android app.';
  try { refreshProfiles(); } catch (error) { notice(String(error?.message || error), true); } controls();
}, error => notice(String(error?.message || error), true));

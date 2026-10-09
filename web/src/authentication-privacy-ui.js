// SPDX-License-Identifier: AGPL-3.0-only
import {createCoreClient} from './core-client.js';
import {WorkPrivacyController} from './work-privacy-controller.js';
import {AuthenticationWorkflow} from './authentication-workflow.js';
import {SyntheticAuthenticationCapture, BrowserAuthenticationCamera} from './authentication-camera.js';
import {createOperatorFaceWorkflow} from './operator-face-workflow.js';
import {createMobileFaceModel} from './mobile-face-model.js';
import {createLocalFaceReferenceStore} from './face-reference-store.js';

const $ = id => document.getElementById(id);
const storageKey = 'nonverba-auth-privacy-inspection-v1';
const stateNames = {available: 'Clocked in / available', hold: 'On hold', clocked_out: 'Clocked out', signed_out: 'Signed out', unknown: 'Unknown — access blocked'};
let offset = 0, flow, privacy, previewUrl = null, previewBlob = null, summaryToken = 0, notificationCount = 0;
let callerPresentedAt = Math.floor(Date.now() / 1000), lastRevision = null;
let face, faceEngine, faceEpoch = 0;
const clock = {seconds: () => Math.floor(Date.now() / 1000) + offset,
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay), clearTimeout: id => globalThis.clearTimeout(id)};
function notice(error) { $('inspection-notice').hidden = false; $('inspection-notice').textContent = String(error?.message || error); }
function savedState() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    const state = typeof stored?.state === 'object' ? stored.state : stored;
    if (state?.account_id === 'synthetic-account' && Object.hasOwn(stateNames, state.state)
      && Number.isSafeInteger(state.revision) && state.revision >= 0 && Number.isSafeInteger(state.updated_at)) {
      // Preserve the illustrative clock domain with its decision. Otherwise a
      // reload after advancing time would make that decision appear future-dated.
      if (Number.isSafeInteger(stored?.offset) && stored.offset >= 0) offset = stored.offset;
      return state;
    }
  } catch {}
  return undefined;
}
function context() {
  const caller = $('auth-context').value;
  return {account_id: 'synthetic-account', principal_id: 'synthetic-person', device_id: 'this-device',
    session_id: 'synthetic-session', task_id: caller.startsWith('task-') ? caller : null};
}
function requirement() {
  return {mode: $('auth-mode').value, policy_id: `inspection-${$('auth-mode').value}-v1`, reuse_scope: 'account',
    max_age_secs: 300, fresh_after_secs: $('auth-context').value === 'task-fresh' ? callerPresentedAt : null,
    allow_simulated: $('auth-allow-simulation').checked, face_required: $('auth-mode').value === 'operator', face_reference_id: null};
}
function ensureFace() {
  if (flow.result?.mode !== 'operator' || $('auth-mode').value !== 'operator') throw new Error('Requester mode has no face workflow.');
  if (!face) face = createOperatorFaceWorkflow({engine: faceEngine, authentication: flow,
    model: createMobileFaceModel(), referenceStore: createLocalFaceReferenceStore(), context: context(), onChange: renderAuthentication});
  return face;
}
async function disposeFace() {
  faceEpoch++;
  const previous = face; face = null;
  if (previous) await previous.close();
}
function renderFace() {
  const operator = $('auth-mode').value === 'operator', snapshot = operator ? face?.snapshot() : null;
  $('auth-face-panel').hidden = !operator;
  $('auth-face-compare').disabled = !operator || !snapshot?.has_features || $('auth-face-compare').hasAttribute('aria-busy') || !!flow?.capture;
  const comparison = snapshot?.comparison;
  if (comparison) {
    const outcome = comparison.embedding_match === true ? 'Face embedding match' : comparison.embedding_match === false ? 'Face embedding non-match' : 'Embedding match decision unresolved';
    $('auth-face-status').textContent = `${outcome} · ${comparison.status} · cosine ${comparison.cosine_similarity ?? 'unavailable'} · evaluation threshold ${comparison.threshold ?? 'not selected'}, uncalibrated. Liveness and trusted capture unresolved. No genuine authentication or work authority granted.`;
  } else $('auth-face-status').textContent = snapshot?.error ?? `${snapshot?.status?.replaceAll('_', ' ') ?? 'No face comparison performed'} · Liveness and trusted capture unresolved. No genuine authentication.`;
  $('auth-face-reference').textContent = snapshot?.reference_summary
    ? `Private local reference: ${snapshot.reference_summary.reference_id} · ${snapshot.reference_summary.account_id}.`
    : 'No bound reference selected. Enroll the Operator separately in registration.';
}
function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  previewBlob = null;
  $('auth-photo-preview').removeAttribute('src');
  $('auth-photo-preview').hidden = true;
}
function renderAuthentication() {
  const result = flow?.result, status = result?.status;
  $('auth-result').textContent = result ? JSON.stringify(result, null, 2) : 'No authentication operation.';
  const labels = {requirement_presented: 'Requirement presented. No sensor has started.',
    capture_active: 'Temporary authentication capture active. Work remains stopped unless separately resumed.',
    capture_complete_validation_unimplemented: 'Capture completed. Operator face comparison is separate; liveness and trusted capture unresolved.',
    validation_pending: 'Requester step pending. Authentication method and validator are not implemented.',
    simulated_success: 'Simulated success only. No person has been authenticated.',
    cancelled: 'Authentication cancelled. Camera authority revoked.', expired: 'Authentication operation expired.',
    failed: 'Authentication failed. Work has not resumed.', denied: 'Authentication denied.', revoked: 'Authentication result revoked.'};
  $('auth-status').textContent = flow?.error ?? labels[status] ?? 'Present a requirement. No sensor starts automatically.';
  $('auth-start').disabled = status !== 'requirement_presented' || result?.mode !== $('auth-mode').value || $('auth-start').hasAttribute('aria-busy');
  $('auth-capture').disabled = status !== 'capture_active' || !flow?.capture || $('auth-capture').hasAttribute('aria-busy');
  $('auth-cancel').disabled = !result || $('auth-cancel').hasAttribute('aria-busy');
  $('auth-simulate').disabled = !!flow?.capture || !['capture_complete_validation_unimplemented', 'validation_pending'].includes(status) || $('auth-simulate').hasAttribute('aria-busy');
  const activeCapture = status === 'capture_active';
  const realCamera = (activeCapture ? flow?.capture?.kind ?? $('auth-capture-kind').value : $('auth-capture-kind').value) === 'browser-photo'
    && (activeCapture ? result.mode : $('auth-mode').value) === 'operator';
  $('auth-camera-disclosure').hidden = !realCamera;
  $('auth-capture-kind').disabled = activeCapture || $('auth-start').hasAttribute('aria-busy') || $('auth-mode').value === 'requester';
  $('auth-mode').disabled = activeCapture || $('auth-start').hasAttribute('aria-busy');
  $('auth-camera-video').hidden = status !== 'capture_active' || !realCamera;
  const blob = flow?.media?.blob;
  if (blob !== previewBlob) {
    clearPreview();
    if (blob) { previewBlob = blob; previewUrl = URL.createObjectURL(blob); $('auth-photo-preview').src = previewUrl; }
  }
  $('auth-photo-preview').hidden = !blob;
  $('auth-synthetic-preview').hidden = flow?.media?.kind !== 'synthetic';
  $('auth-camera-area').hidden = $('auth-camera-video').hidden && $('auth-photo-preview').hidden && $('auth-synthetic-preview').hidden;
  renderFace();
}
async function renderPrivacy() {
  const token = ++summaryToken, snapshot = privacy.snapshot();
  $('privacy-state').textContent = `${stateNames[snapshot.state.state]} · revision ${snapshot.state.revision}`;
  $('privacy-devices').replaceChildren(...snapshot.devices.map(device => {
    const item = document.createElement('li'), name = document.createElement('strong');
    name.textContent = `${device.device_id} · ${device.status}`;
    item.append(name, document.createTextNode(`Local state: ${stateNames[device.local_state]}. Acknowledged revision: ${device.revision}. Registered resources: ${device.operation_count}.`));
    for (const operation of device.operations) {
      const line = document.createElement('p');
      line.textContent = `${operation.purpose} / ${operation.sensor} / ${operation.active ? 'active' : 'revoked'}${operation.cleanup_error ? ` · ${operation.cleanup_error}` : ''}`;
      item.append(line);
    }
    return item;
  }));
  if (lastRevision !== null && lastRevision !== snapshot.state.revision && flow?.media) flow.clearMedia();
  lastRevision = snapshot.state.revision;
  try {
    const summary = await privacy.summary();
    if (token !== summaryToken) return;
    const stopped = snapshot.state.state !== 'available';
    $('privacy-status').textContent = stopped
      ? summary.shutdown_confirmed_for_simulation
        ? 'Shutdown confirmed for the simulated devices. This is not deployed account-wide protection.'
        : `Shutdown unconfirmed for: ${summary.unconfirmed_devices.join(', ') || 'pending cleanup'}. This is a simulation.`
      : 'Available does not authorize sensing. Only deliberately consented, bounded simulated operations can start.';
  } catch (error) { if (token === summaryToken) notice(error); }
}
function run(id, callback) {
  $(id).addEventListener('click', async () => {
    if ($(id).disabled) return;
    $(id).disabled = true;
    $(id).setAttribute('aria-busy', 'true');
    try { await callback(); }
    catch (error) { notice(error); }
    finally { $(id).removeAttribute('aria-busy'); $(id).disabled = false; renderAuthentication(); }
  });
}
function collector() {
  let stopped = false;
  return {async close() {
    if ($('privacy-cleanup-failure').checked) throw new Error('Synthetic cleanup failure: shutdown is unconfirmed.');
    stopped = true;
    return true;
  }, stopped: () => stopped};
}
async function lifecycleStop() {
  clearPreview();
  if (face) void disposeFace().catch(notice);
  if (flow) void flow.cancel('page lifecycle loss').catch(notice);
  if (privacy) await Promise.all([...privacy.devices.keys()].map(id => privacy.stopDevice(id, 'page lifecycle loss')));
}

if (globalThis.NativeVault) {
  $('runtime').textContent = 'Browser-only inspection';
  notice('Open this isolated inspection in a desktop browser. Native developer sensor paths are not integrated with this controller.');
  for (const button of document.querySelectorAll('button')) button.disabled = true;
} else {
  const engine = createCoreClient();
  faceEngine = engine;
  privacy = new WorkPrivacyController({engine, clock, state: savedState(),
    persist: state => { try { localStorage.setItem(storageKey, JSON.stringify({state, offset})); } catch {} },
    onChange: () => { void renderPrivacy(); renderAuthentication(); }});
  flow = new AuthenticationWorkflow({engine, privacy, clock, onChange: renderAuthentication,
    faceReferenceIdProvider: async () => (await ensureFace().getReference())?.reference_id ?? null,
    captureFactory: ({kind}) => kind === 'browser-photo'
      ? new BrowserAuthenticationCamera({video: $('auth-camera-video')}) : new SyntheticAuthenticationCapture()});
  for (const [id, action] of [['privacy-hold', 'hold'], ['privacy-clock-out', 'clock_out'], ['privacy-sign-out', 'sign_out'], ['privacy-clock-in', 'clock_in']]) {
    run(id, async () => {
      if (action !== 'clock_in') { if (face) void face.cancel('work privacy stop').catch(notice); flow.clearMedia(); clearPreview(); }
      const decision = await privacy.transition(action);
      if (!decision.accepted) throw new Error(decision.reason);
    });
  }
  run('privacy-stale-resume', async () => {
    const decision = await privacy.transition('clock_in', {expectedRevision: Math.max(0, privacy.state.revision - 1)});
    notice(decision.accepted ? 'Revision zero had no older revision to reject. Stop work first, then retry.' : `Stale resume rejected: ${decision.reason}`);
  });
  for (const [id, deviceId] of [['privacy-start-local', 'this-device'], ['privacy-start-remote', 'second-device']]) {
    run(id, () => privacy.startSensor({deviceId, sensor: 'camera', purpose: 'work', explicitConsent: true, leaseSecs: 30}, collector));
  }
  run('privacy-disconnect', () => privacy.connect('second-device', false));
  run('privacy-reconnect', () => privacy.connect('second-device', true));
  run('privacy-expire', async () => { offset += 31; await privacy.expireAuthorities(); void renderPrivacy(); });
  run('privacy-retry', () => privacy.stopDevice('this-device', 'retry cleanup'));
  run('privacy-notify', async () => {
    const disposition = (await privacy.summary()).notification_disposition;
    $('privacy-notifications').textContent = `Notification ${++notificationCount} delivered to the synthetic inbox · ${disposition}. No sound or vibration is generated by this inspection.`;
  });
  run('auth-present', async () => {
    callerPresentedAt = clock.seconds();
    await disposeFace();
    await flow.present({context: context(), mode: $('auth-mode').value, policyId: requirement().policy_id});
    clearPreview();
    $('auth-assessment').textContent = 'Requirement presented. Work state is unchanged.';
  });
  run('auth-start', () => flow.result.mode === 'operator'
    ? ensureFace().start({deliberate: true, captureKind: $('auth-capture-kind').value, leaseSecs: 30})
    : flow.start({deliberate: true}));
  run('auth-capture', () => ensureFace().completeCapture());
  run('auth-cancel', async () => { clearPreview(); if (face) await face.cancel(); else await flow.cancel(); });
  run('auth-face-compare', async () => {
    const selected = ensureFace(), token = faceEpoch, thresholdValue = $('auth-face-threshold').value;
    await selected.compare({threshold: thresholdValue === '' ? null : Number(thresholdValue)});
    if (token === faceEpoch) renderFace();
  });
  run('auth-simulate', () => flow.simulateSuccess());
  run('auth-check', async () => {
    $('auth-assessment').textContent = 'Checking the current requirement and enrollment.';
    const policy = requirement(), token = faceEpoch;
    if (policy.face_required && flow.result?.mode === 'operator') policy.face_reference_id = (await ensureFace().getReference())?.reference_id ?? null;
    if (token !== faceEpoch) return;
    const assessment = await flow.assess({context: context(), requirement: policy});
    if (token !== faceEpoch) return;
    $('auth-assessment').textContent = `${assessment.satisfied_for_simulation ? 'Requirement satisfied for simulation only' : 'Requirement not satisfied'} · ${assessment.reason}. Authenticated person: ${assessment.authenticated}. Work state is unchanged.`;
  });
  for (const id of ['auth-mode', 'auth-context', 'auth-capture-kind']) {
    $(id).addEventListener('change', () => {
      callerPresentedAt = clock.seconds();
      if (id === 'auth-mode' && $('auth-mode').value === 'requester' && face) void disposeFace().catch(notice);
      renderAuthentication();
    });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) void lifecycleStop().catch(notice); });
  globalThis.addEventListener('pagehide', () => { void lifecycleStop().catch(() => {}); });
  globalThis.addEventListener('nonverba:pause', () => { void lifecycleStop().catch(notice); });
  engine.ready.then(() => { $('runtime').textContent = 'Rust policy ready · simulation'; void renderPrivacy(); renderAuthentication(); }, error => {
    $('runtime').textContent = 'Local policy unavailable'; notice(error);
    for (const button of document.querySelectorAll('button')) button.disabled = true;
  });
}

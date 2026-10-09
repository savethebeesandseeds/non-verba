// SPDX-License-Identifier: AGPL-3.0-only
import {createCoreClient} from './core-client.js';
import {RegistrationWorkflow} from './registration-workflow.js';
import {AuthenticationWorkflow} from './authentication-workflow.js';
import {WorkPrivacyController} from './work-privacy-controller.js';
import {SyntheticAuthenticationCapture, BrowserAuthenticationCamera} from './authentication-camera.js';
import {createOperatorFaceWorkflow} from './operator-face-workflow.js';
import {createMobileFaceModel} from './mobile-face-model.js';
import {createLocalFaceReferenceStore} from './face-reference-store.js';

const $ = id => document.getElementById(id);
const allSteps = ['personal', 'access', 'certifications', 'privacy', 'face', 'review'];
const steps = () => workflow?.draft.role === 'requester' ? allSteps.filter(name => name !== 'face') : allSteps;
const fields = {
  'personal.display_name': 'registration-display-name', 'personal.contact_email': 'registration-contact-email',
  'personal.legal_name': 'registration-legal-name', 'personal.organization': 'registration-organization',
  'personal.country': 'registration-country', 'personal.preferred_language': 'registration-preferred-language',
  'accommodations.note': 'registration-access-note', 'accommodations.share_with_task_counterparty': 'registration-access-share',
  'acknowledgments.private_data_handling': 'registration-private-ack',
  'acknowledgments.self_reported_certifications': 'registration-certifications-ack',
  'sharing.publish_display_name': 'registration-publish-name', 'sharing.publish_organization': 'registration-publish-organization',
};
let engine, workflow, step = 0, ready = false, runtimeEpoch = 0, actionEpoch = 0, busy = 0, lastReviewedRevision = null;
let certificateIds = [], certificateSequence = 0, visibleErrors = [];
let face, faceAuthentication, facePrivacy, faceModel, faceSetupEpoch = 0;
const faceContext = () => ({account_id: $('registration-face-account').value, principal_id: 'synthetic-person',
  device_id: 'this-device', session_id: 'synthetic-registration-session', task_id: null});

function renderFace() {
  const snapshot = face?.snapshot(), captureActive = faceAuthentication?.result?.status === 'capture_active';
  const message = snapshot?.error ?? (snapshot?.status ? snapshot.status.replaceAll('_', ' ') : 'Operator face enrollment has not started. No sensor is open.');
  $('registration-face-status').textContent = `${message}${snapshot ? ' · Legal identity, liveness and trusted capture remain unverified.' : ''}`;
  const reference = snapshot?.reference_summary;
  $('registration-face-reference').textContent = reference
    ? `Private local reference: ${reference.reference_id} · ${reference.account_id} · retained separately from form details.`
    : 'No reference selected for this local account binding.';
  const consent = $('registration-face-consent').checked, reviewed = $('registration-face-review-consent').checked;
  $('registration-face-start').disabled = !ready || !!busy || !faceModel?.spec || !consent || captureActive;
  $('registration-face-capture').disabled = !ready || !!busy || !captureActive || !faceAuthentication?.capture;
  $('registration-face-enroll').disabled = !ready || !!busy || !snapshot?.has_features || !consent || !reviewed || !!reference;
  $('registration-face-replace').disabled = !ready || !!busy || !snapshot?.has_features || !consent || !reviewed || !reference;
  $('registration-face-delete').disabled = !ready || !!busy || !reference;
  $('registration-face-cancel').disabled = !face;
  $('registration-face-capture-kind').disabled = captureActive || !!busy;
  $('registration-face-consent').disabled = captureActive || !!busy;
  $('registration-face-review-consent').disabled = captureActive || !!busy;
  const real = captureActive && (faceAuthentication?.capture?.kind ?? $('registration-face-capture-kind').value) === 'browser-photo';
  $('registration-face-video').hidden = !real;
  $('registration-face-camera-area').hidden = !real;
  $('registration-face-preview').hidden = true;
  $('registration-face-preview').removeAttribute('src');
}
async function ensureFace() {
  if (workflow?.draft.role !== 'operator') throw new Error('Requester registration has no face workflow.');
  if (face) return face;
  const token = ++faceSetupEpoch, active = workflow;
  faceModel = createMobileFaceModel();
  facePrivacy = new WorkPrivacyController({engine, accountId: 'synthetic-account', devices: ['this-device']});
  faceAuthentication = new AuthenticationWorkflow({engine, privacy: facePrivacy, onChange: renderFace,
    captureFactory: ({kind}) => kind === 'browser-photo'
      ? new BrowserAuthenticationCamera({video: $('registration-face-video')}) : new SyntheticAuthenticationCapture()});
  face = createOperatorFaceWorkflow({engine, authentication: faceAuthentication, model: faceModel,
    referenceStore: createLocalFaceReferenceStore(), context: faceContext(), onChange: renderFace});
  const selected = face;
  if (!faceModel.spec) {
    $('registration-face-status').textContent = 'Selected model descriptor unavailable. Enrollment remains pending.';
    return selected;
  }
  active.setFacePolicy({required: true, account_id: faceContext().account_id,
    principal_id: faceContext().principal_id, model: faceModel.spec});
  let reference;
  try {
    await selected.refreshReference();
    reference = await selected.getReference();
  } catch (error) {
    if (token !== faceSetupEpoch || active !== workflow || workflow.draft.role !== 'operator') return null;
    throw error;
  }
  if (token !== faceSetupEpoch || active !== workflow || workflow.draft.role !== 'operator') return null;
  if (reference) active.setFaceReference(reference);
  renderFace();
  return selected;
}
async function disposeFace() {
  faceSetupEpoch++;
  const previous = face, privacy = facePrivacy, model = faceModel;
  face = null; facePrivacy = null; faceAuthentication = null; faceModel = null;
  try { if (previous) await previous.close(); }
  finally { if (privacy) await privacy.close('registration discarded'); if (!previous) await model?.close?.(); }
}

function status(message) { $('registration-status').textContent = message; }
function errorInput(field) {
  if (field === 'role') return $('registration-role');
  if (fields[field]) return $(fields[field]);
  const match = /^certifications\.(\d+)\.(.+)$/.exec(field);
  if (match) return $(`certification-${certificateIds[Number(match[1])]}-${{issued_on: 'issued', expires_on: 'expires', share_with_task_counterparty: 'share'}[match[2]] ?? match[2]}`);
  return null;
}
function fieldStep(field) {
  if (field.startsWith('face_')) return steps().indexOf('face');
  if (field.startsWith('accommodations.')) return 1;
  if (field.startsWith('certifications')) return 2;
  if (field.startsWith('acknowledgments.') || field.startsWith('sharing.')) return 3;
  return 0;
}
function renderErrors(errors = []) {
  visibleErrors = errors;
  for (const input of $('registration-form').querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
  for (const node of document.querySelectorAll('.field-error')) { node.hidden = true; node.textContent = ''; }
  $('registration-errors').replaceChildren(...errors.map(error => {
    const item = document.createElement('li'), input = errorInput(error.field);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      const message = $(`${input.id}-error`);
      if (message) { message.hidden = false; message.textContent = error.message; }
      const link = document.createElement('a');
      link.href = `#${input.id}`; link.textContent = error.message;
      link.addEventListener('click', event => { event.preventDefault(); setStep(fieldStep(error.field)); input.focus(); });
      item.append(link);
    } else item.textContent = error.message;
    return item;
  }));
  $('registration-errors-panel').hidden = !errors.length;
  const generalCertificationError = errors.find(error => error.field === 'certifications');
  if (generalCertificationError) {
    $('registration-certifications-error').hidden = false;
    $('registration-certifications-error').textContent = generalCertificationError.message;
  }
}
function card(title, values, {tag = null} = {}) {
  const section = document.createElement('section'); section.className = 'review-card';
  if (tag) { const badge = document.createElement('span'); badge.className = 'pill'; badge.textContent = tag; section.append(badge); }
  const heading = document.createElement('h3'); heading.textContent = title;
  const list = document.createElement('dl');
  for (const [label, value] of values) {
    const term = document.createElement('dt'), description = document.createElement('dd');
    term.textContent = label; description.textContent = value || 'Not provided'; list.append(term, description);
  }
  section.append(heading, list); return section;
}
function choice(selected) { return selected ? 'Chosen as a future preference; nothing is shared now' : 'Off — keep private'; }
function renderReview(snapshot) {
  const {draft} = snapshot;
  const contents = [card('Your private registration details', [
    ['Role', draft.role === 'requester' ? 'Requester' : 'Operator'], ['Display name', draft.personal.display_name],
    ['Contact email', draft.personal.contact_email], ['Legal name', draft.personal.legal_name],
    ['Organization', draft.personal.organization], ['Country or region', draft.personal.country],
    ['Preferred language', draft.personal.preferred_language],
  ], {tag: 'PRIVATE LOCAL DRAFT'}), card('Optional access & support', [
    ['Private support note', draft.accommodations.note],
    ['Future task-counterparty preference', choice(draft.accommodations.share_with_task_counterparty)],
  ], {tag: 'NEVER PUBLIC PROFILE CONTENT'})];
  if (!draft.certifications.length) contents.push(card('Certifications', [['Entries', 'None provided — optional']]));
  for (const [index, certificate] of draft.certifications.entries()) {
    contents.push(card(`Certification ${index + 1}`, [['Title', certificate.title], ['Issuer', certificate.issuer],
      ['Reference', certificate.reference], ['Issued on', certificate.issued_on], ['Expires on', certificate.expires_on],
      ['Future task-counterparty preference', choice(certificate.share_with_task_counterparty)]], {tag: 'SELF-REPORTED · UNVERIFIED'}));
  }
  contents.push(card('Purpose acknowledgments', [
    ['Private information purpose', draft.acknowledgments.private_data_handling ? 'Acknowledged' : 'Not yet acknowledged'],
    ['Self-reported certifications', draft.acknowledgments.self_reported_certifications ? 'Acknowledged' : draft.certifications.length ? 'Not yet acknowledged' : 'Not required — no certifications entered'],
  ]), card('Optional public profile preferences', [['Display name', choice(draft.sharing.publish_display_name)],
    ['Organization', choice(draft.sharing.publish_organization)], ['All other details', 'Private; unavailable to public profile choices']], {tag: 'NO PUBLICATION PERFORMED'}));
  const candidate = snapshot.preparation?.record?.public_candidate;
  if (draft.role === 'operator') contents.push(card('Private Operator face enrollment', [
    ['Local account binding', snapshot.face_enrollment?.account_id ?? 'No bound enrollment selected'],
    ['Reference', snapshot.face_enrollment?.reference_id ?? 'Pending'],
    ['Selected model', snapshot.face_enrollment?.model?.version ?? 'Qualcomm / foamliu MobileFaceNet 128D'],
    ['Meaning', 'Face continuity reference only. Legal identity, liveness and trusted capture are not verified.'],
    ['Retention', 'Separately retained reference; resetting this form does not delete it.'],
  ], {tag: 'PRIVATE BIOMETRIC REFERENCE · NEVER PUBLIC'}));
  if (candidate) contents.push(card('Public candidate prepared by the local policy', [['Display name', candidate.display_name ?? 'Not included'],
    ['Organization', candidate.organization ?? 'Not included']], {tag: 'IN MEMORY ONLY · NOT PUBLISHED'}));
  $('registration-review-content').replaceChildren(...contents);
}
function render(snapshot = workflow?.snapshot()) {
  if (!snapshot) return;
  if (lastReviewedRevision !== null && snapshot.reviewed_revision === null) status('Draft changed. Review it again before preparation.');
  lastReviewedRevision = snapshot.reviewed_revision;
  if (!snapshot.assessment) renderErrors();
  renderReview(snapshot);
  const prepared = snapshot.preparation?.prepared;
  $('registration-result').hidden = !prepared;
  $('registration-result').textContent = prepared
    ? 'Local registration prepared. No account created; identity and certifications remain unverified. Nothing was transmitted or published. Reset or leave this page to discard the record.' : '';
  $('registration-prepare').disabled = !ready || !!busy || !snapshot.assessment?.ready_for_local_prepare
    || snapshot.reviewed_revision !== snapshot.draft.revision || prepared;
  $('registration-review').disabled = !ready || !!busy;
  $('registration-next').disabled = !ready || !!busy;
  $('registration-back').disabled = !!busy || step === 0;
  $('registration-add-certification').disabled = snapshot.draft.certifications.length >= 16;
  $('registration-certifications-ack').disabled = !snapshot.draft.certifications.length;
  renderFace();
}
function setStep(next, focus = true) {
  const sequence = steps();
  step = Math.min(next, sequence.length - 1);
  for (const name of allSteps) $(`registration-${name}-step`).hidden = name !== sequence[step];
  $('registration-face-progress').hidden = workflow?.draft.role === 'requester';
  [...$('registration-progress').children].filter(item => !item.hidden).forEach((item, index) => {
    if (index === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
  });
  $('registration-step').textContent = `STEP ${step + 1} OF ${sequence.length}`;
  $('registration-next').hidden = sequence[step] === 'review';
  $('registration-next').textContent = sequence[step + 1] === 'review' ? 'Review details' : 'Continue';
  render();
  if (sequence[step] === 'face' && !face) void ensureFace().catch(error => status(String(error?.message || error)));
  if (focus) $(`registration-${sequence[step]}-heading`).focus();
}
function certificationRows() {
  $('registration-certifications').replaceChildren(...workflow.draft.certifications.map((certificate, index) => {
    const key = certificateIds[index], container = document.createElement('fieldset'); container.className = 'certification-card';
    const legend = document.createElement('legend'); legend.textContent = `Certification ${index + 1}`;
    const top = document.createElement('div'); top.className = 'certification-top';
    const badge = document.createElement('span'); badge.className = 'pill'; badge.textContent = 'SELF-REPORTED · UNVERIFIED';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary';
    remove.id = `certification-${key}-remove`; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove certification ${index + 1}`);
    remove.addEventListener('click', () => {
      workflow.removeCertification(index); certificateIds.splice(index, 1); certificationRows(); renderErrors(); render();
      $('registration-add-certification').focus();
    });
    top.append(badge, remove); container.append(legend, top);
    const controls = document.createElement('div'); controls.className = 'certification-fields';
    for (const [field, label, type, limit, suffix] of [['title', 'Certification title — required for this entry', 'text', 160, 'title'],
      ['issuer', 'Issuer — optional', 'text', 200, 'issuer'], ['reference', 'Reference — optional', 'text', 200, 'reference'],
      ['issued_on', 'Issue date — optional', 'date', null, 'issued'], ['expires_on', 'Expiry date — optional', 'date', null, 'expires']]) {
      const input = document.createElement('input'), name = document.createElement('label'), error = document.createElement('p');
      input.id = `certification-${key}-${suffix}`; input.type = type; input.value = certificate[field]; input.autocomplete = 'off';
      if (limit) input.maxLength = limit;
      if (field === 'title') input.setAttribute('aria-required', 'true');
      error.id = `${input.id}-error`; error.className = 'field-error'; error.hidden = true;
      name.htmlFor = input.id; name.textContent = label; input.setAttribute('aria-describedby', error.id);
      input.addEventListener('input', () => workflow.setCertification(index, field, input.value));
      controls.append(name, input, error);
    }
    const sharingLabel = document.createElement('label'), sharing = document.createElement('input'), sharingText = document.createElement('span');
    sharingLabel.className = 'registration-checkbox'; sharing.type = 'checkbox'; sharing.id = `certification-${key}-share`;
    sharing.checked = certificate.share_with_task_counterparty;
    sharingText.textContent = 'Record a future preference to share this entry with a task counterparty. No sharing occurs here.';
    sharing.addEventListener('change', () => workflow.setCertification(index, 'share_with_task_counterparty', sharing.checked));
    const sharingError = document.createElement('p'); sharingError.id = `${sharing.id}-error`; sharingError.className = 'field-error'; sharingError.hidden = true;
    sharing.setAttribute('aria-describedby', sharingError.id); sharingLabel.append(sharing, sharingText);
    controls.append(sharingLabel, sharingError); container.append(controls); return container;
  }));
}
function discard(message = 'Draft discarded. Intentionally retained face references need their separate deletion action.') {
  actionEpoch++;
  void disposeFace().catch(() => {});
  workflow?.reset();
  certificateIds = []; certificateSequence = 0; visibleErrors = []; busy = 0;
  $('registration-form').reset(); $('registration-certifications').replaceChildren();
  for (const node of document.querySelectorAll('[aria-busy]')) node.removeAttribute('aria-busy');
  renderErrors(); setStep(0, false); status(message);
}
function run(id, callback) {
  $(id).addEventListener('click', async () => {
    if ($(id).disabled || !workflow) return;
    const active = workflow, epoch = runtimeEpoch, action = actionEpoch;
    busy++; $(id).setAttribute('aria-busy', 'true'); render();
    try { await callback(active); }
    catch (error) { if (epoch === runtimeEpoch && action === actionEpoch) status(String(error?.message || error)); }
    finally {
      if (epoch === runtimeEpoch && action === actionEpoch) { busy = Math.max(0, busy - 1); $(id).removeAttribute('aria-busy'); render(); }
    }
  });
}
function startRuntime() {
  const epoch = ++runtimeEpoch; ready = false;
  engine = createCoreClient();
  workflow = new RegistrationWorkflow({engine, onChange: render,
    faceReferenceProvider: () => face ? face.getReference() : null});
  discard('Draft is local and has not been prepared. Choose your role and continue.');
  $('runtime').textContent = 'Starting local Rust policy';
  engine.ready.then(() => {
    if (epoch !== runtimeEpoch) return;
    ready = true; $('runtime').textContent = 'Rust registration policy ready'; render();
  }, error => {
    if (epoch !== runtimeEpoch) return;
    ready = false; $('runtime').textContent = 'Local policy unavailable'; status(String(error?.message || error)); render();
  });
}

if (globalThis.NativeVault) {
  $('runtime').textContent = 'Browser-only registration inspection';
  status('Open this independent registration inspection in a desktop browser. No native account or sensor integration is included.');
  for (const control of document.querySelectorAll('input,select,textarea,button')) control.disabled = true;
} else {
  $('registration-form').addEventListener('submit', event => event.preventDefault());
  $('registration-role').addEventListener('change', () => {
    void disposeFace().catch(error => status(String(error?.message || error)));
    workflow.setRole($('registration-role').value); setStep(0, false);
  });
  for (const [path, id] of Object.entries(fields)) {
    const [section, field] = path.split('.'), input = $(id);
    if (path === 'personal.display_name' || path === 'personal.contact_email') input.setAttribute('aria-required', 'true');
    input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', () => {
      const previouslyReviewed = workflow.reviewedRevision !== null;
      workflow.setField(section, field, input.type === 'checkbox' ? input.checked : input.value);
      if (previouslyReviewed) status('Draft changed. Review it again before preparation.');
    });
  }
  $('registration-add-certification').addEventListener('click', () => {
    const index = workflow.addCertification(); certificateIds.push(certificateSequence++); certificationRows();
    $(`certification-${certificateIds[index]}-title`).focus();
  });
  $('registration-back').addEventListener('click', () => { renderErrors(); setStep(Math.max(0, step - 1)); });
  $('registration-reset').addEventListener('click', () => discard());
  run('registration-next', async active => {
    const currentStep = step, sequence = steps();
    if (sequence[currentStep] === 'face') {
      const selected = await ensureFace();
      if (!selected || active !== workflow) return;
      if (!faceModel?.spec) { status('Selected face model unavailable. Operator enrollment cannot be completed.'); return; }
    }
    const result = await active.assess();
    if (result.stale || active !== workflow) { if (result.reference_changed && active === workflow) status('Face reference changed. Review the current enrollment before continuing.'); return; }
    const beforeReview = sequence[currentStep + 1] === 'review';
    const errors = result.errors.filter(error => beforeReview || fieldStep(error.field) === currentStep);
    renderErrors(errors);
    if (errors.length) { status(`Review ${errors.length} field${errors.length === 1 ? '' : 's'} before continuing.`); errorInput(errors[0].field)?.focus(); return; }
    setStep(Math.min(sequence.length - 1, currentStep + 1));
    status(steps()[step] === 'review' ? 'Review your private details and sharing preferences, then confirm the review.' : 'Draft stays in memory. Optional details can be left empty.');
  });
  for (const id of ['registration-face-consent', 'registration-face-review-consent', 'registration-face-capture-kind']) $(id).addEventListener('change', renderFace);
  run('registration-face-start', async () => {
    if (!$('registration-face-consent').checked) throw new Error('Review and consent to local face processing first.');
    const selected = await ensureFace();
    await selected.start({deliberate: true, captureKind: $('registration-face-capture-kind').value});
  });
  run('registration-face-capture', async () => { await face.completeCapture(); });
  for (const [id, replace] of [['registration-face-enroll', false], ['registration-face-replace', true]]) run(id, async active => {
    const selected = face, token = faceSetupEpoch;
    await selected.enroll({deliberate: true, replace, retentionConsent: $('registration-face-consent').checked && $('registration-face-review-consent').checked,
      reviewed: $('registration-face-review-consent').checked});
    const reference = await selected.getReference();
    if (token !== faceSetupEpoch || active !== workflow || active.draft.role !== 'operator') return;
    if (reference) active.setFaceReference(reference);
  });
  run('registration-face-delete', async active => {
    const selected = face, token = faceSetupEpoch;
    await selected.deleteReference({deliberate: true});
    if (token === faceSetupEpoch && active === workflow) active.setFaceReference(null);
  });
  // Cancellation must remain available while permission acquisition or model
  // inference is pending, so it does not share the generic busy action wrapper.
  $('registration-face-cancel').addEventListener('click', () => {
    if (face) void face.cancel().catch(error => status(String(error?.message || error)));
  });
  run('registration-review', async active => {
    const result = await active.review();
    if (result.stale || active !== workflow) { if (result.reference_changed && active === workflow) status('Face reference changed. Review the current enrollment again.'); return; }
    renderErrors(result.errors);
    status(result.ready_for_local_prepare ? 'Review confirmed for this draft. You can prepare it locally.' : 'Resolve the indicated fields before confirming review.');
  });
  run('registration-prepare', async active => {
    const result = await active.prepare({deliberate: true});
    if (result.stale || active !== workflow) { if (result.reference_changed && active === workflow) status('Face reference changed. Preparation was discarded; review the current enrollment again.'); return; }
    renderErrors(result.errors);
    status(result.prepared ? 'Local registration prepared. No account created; identity and certifications remain unverified.' : 'Review the current draft before preparing it locally.');
  });
  globalThis.addEventListener('pagehide', () => {
    runtimeEpoch++; ready = false; discard(); engine?.close();
    for (const node of document.querySelectorAll('[aria-busy]')) node.removeAttribute('aria-busy');
  });
  const pauseFace = () => { if (face) void face.cancel('page lifecycle loss').catch(error => status(String(error?.message || error))); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseFace(); });
  globalThis.addEventListener('nonverba:pause', pauseFace);
  globalThis.addEventListener('pageshow', event => { if (event.persisted) startRuntime(); });
  startRuntime();
}

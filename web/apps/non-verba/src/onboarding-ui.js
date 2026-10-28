// SPDX-License-Identifier: AGPL-3.0-only
import {createServiceAccountAdapter, loginIdentifier, passwordStrength} from './onboarding-account.js';
import {createPasswordManagerSignIn} from './password-manager-sign-in.js';
import {createAccountTransport} from './account-transport.js';
import {createRecoveryExport} from './recovery-export.js';
import {createDeviceAttestationTool} from './identity/device-attestation.js';
import {IdentityCaptureWorkflow} from './identity/identity-capture.js';
import {prepareEnrollmentImage} from './identity/enrollment-camera.js';
import {createIdentityCameraTool} from './identity/identity-camera-tool.js';
import {IDENTITY_INTAKE_NOTICE} from './identity-intake-notice.js';
import {ACCOUNT_TERMS} from './account-terms.js';
import {createIdentityReviewClient} from './identity-review-client.js';
import {createIdentityReviewView} from './identity-review-ui.js';

export const ONBOARDING_VIEWS = Object.freeze({
  'identity/setup': ['', 'Identity', ''],
  'account/create': ['', 'Create account', ''],
  'account/terms': ['', 'Account Terms', ''],
  'account/sign-in': ['', 'Sign in', ''],
  'account/confirm': ['', 'Confirm email', ''],
  'account/ready': ['', 'Recovery codes', ''],
  'account/recover': ['', 'Account recovery', 'Use a recovery code and an email confirmation code.'],
  'account/delete': ['', 'Delete account', ''],
  'account/delete-retention': ['', 'Retention', ''],
  'account/devices': ['', 'Devices', ''],
  'identity/document': ['', 'Identity document', 'Photograph the front of your document.'],
  'identity/face': ['', 'Face photo', 'Look straight at the camera.'],
  'identity/review': ['', 'Submit Level 1 identity', ''],
  'identity/notice': ['', 'Level 1 identity', ''],
  'identity/status': ['', 'Level 1 identity', ''],
  'reviewer/cases': ['', 'Test photo review', '']
});

export function startOnboarding(root, {navigate, closeTerms = () => navigate('account/create',true), closeIdentityNotice = () => navigate('identity/review',true), closeRetention = () => navigate('account/delete',true), setHeading = () => {}, enterEmailStep = () => {}, setStatusSources = () => {}, setRoleSetup = () => {}, workflowAccess, onAccountState = () => {}}) {
  if (typeof workflowAccess !== 'function') throw new Error('The participant workflow access policy is required.');
  const $ = selector => root.querySelector(selector);
  const screen = $('#onboarding-screen');
  let route = 'home', busy = false, viewEpoch = 0, actionNavigation = false, connecting = true, cameraKind = null;
  let signupMode = false, captureRole = 'requester';
  let cameraFocusPending = false;
  let identityNotice = null, identityEntryEpoch = -1;
  let account, workflow, reviewer, reviewerView;
  let reviewActor = '', reviewPermissionStarted = false, reviewSelectedKey = null;
  let statusCheckPromise = null, checkingStatus = false, settingsOpen = false, statusTimer, statusEpoch = 0;
  let deviceEpoch = 0, devicesBusy = false;
  let termsDocument = null, termsBusy = false, termsAttempted = false, termsFailure = false;
  let copyEpoch = 0, copyBusy = false;
  let recoveryExportEpoch = 0, recoveryExportController = null;
  const recoveryExport = createRecoveryExport({document:root.ownerDocument || root});
  const recoveryCells = Array.from({length:8},(_,index) => {
    const document = root.ownerDocument || root, label = document.createElement('label'), input = document.createElement('textarea');
    label.textContent = `Recovery code ${index+1}`;
    input.className = 'recovery-code-cell'; input.readOnly = true; input.rows = 3;
    input.setAttribute('data-secret',''); input.autocomplete = 'off'; input.spellcheck = false;
    label.append(input); $('#recovery-code-grid').append(label); return input;
  });
  const codeInput = $('#sign-in-email-code'), codeSlots = [...$('#sign-in-code-entry .code-slots').children];
  function renderCode() {
    const value = codeInput.value.toUpperCase();
    codeSlots.forEach((slot,index) => {
      if (slot.textContent !== (value[index] || '')) slot.textContent = value[index] || '';
      slot.toggleAttribute('data-active',index === Math.min(codeInput.selectionStart || 0,7));
    });
  }
  const transport = createAccountTransport();
  let attestationTool = createDeviceAttestationTool();
  const device = Object.freeze({
    get platform() { return attestationTool.platform; },
    describe: options => attestationTool.describe(options),
    prove: (challenge, options) => attestationTool.prove(challenge, options)
  });
  account = createServiceAccountAdapter({request: options => transport.request(options), device, onChange: () => update()});
  reviewer = createIdentityReviewClient({gateway:{request:options=>account.reviewRequest(options),owner:()=>account.reviewOwner()},
    onChange:() => { drawReview(); update(); }});
  const reviewAction = {approve:'approved',correction:'needs_correction',reject:'rejected'};
  $('#account-setup-link').addEventListener('click',() => {
    if (route === 'account/sign-in' && account.reviewOwner()) { void reviewer.subjectStatus(); void reviewer.permission(); }
  });
  reviewerView = createIdentityReviewView({container:$('#reviewer-screen'),
    onReload:()=>reviewSelectedKey ? reviewer.selectCase(reviewSelectedKey) : reviewer.loadCases(),
    onOpen:key=>{ reviewSelectedKey = key; return reviewer.selectCase(key); },
    onBack:()=>{ if (!reviewSelectedKey) return navigate('account/sign-in'); reviewSelectedKey = null; return reviewer.loadCases(); },
    onDecision:({action,reason})=>reviewer.decide({action:reviewAction[action],reason,deliberate:true}),
    onCheckOriginal:()=>reviewer.checkOriginal()});
  function drawReview() {
    if (route !== 'reviewer/cases' || !reviewerView || document.hidden) return;
    const model = reviewer.snapshot();
    const label = {approved:'Approved for test',needs_correction:'Correction requested',rejected:'Rejected for test'}[model.lastDecision?.action];
    reviewerView.render({...model,...(model.phase === 'saved' && label ? {message:`Recorded: ${label}. Reload cases for their current status.`} : {}),
      actions:model.actions?.map(action=>Object.keys(reviewAction).find(key=>reviewAction[key]===action))});
  }
  function updateReviewActor() {
    const owner = account.reviewOwner(), key = owner ? JSON.stringify(owner) : '';
    if (key !== reviewActor) {
      reviewActor = key; reviewPermissionStarted = false;
      reviewSelectedKey = null;
      reviewer.clear({preserveOperation:false}); reviewerView.clear();
      drawReview();
    }
    if (key && !reviewPermissionStarted && !document.hidden) {
      reviewPermissionStarted = true;
      queueMicrotask(() => {
        if (key !== reviewActor || document.hidden) return;
        void reviewer.permission(); void reviewer.subjectStatus();
      });
    }
    $('#account-reviewer-link').hidden = !key || reviewer.snapshot().permission !== 'granted';
    const status = reviewer.snapshot().subject;
    const label = {approved:'Approved for test',needs_correction:'Correction requested',rejected:'Rejected for test'}[status?.level_1?.status];
    const text = label ? `${label}. These are test details. The Level 1 identity is not confirmed with an issuer, and work access remains unavailable.`
      : status === null && key ? 'Test review status unavailable.' : '';
    for (const id of ['account-synthetic-review-status','enrollment-test-review-status']) {
      const note = $('#'+id); note.hidden = !text; if (note.textContent !== text) note.textContent = text;
    }
    const replacement = $('#enrollment-new-test');
    replacement.hidden = !key || !['approved','needs_correction','rejected','not_eligible'].includes(status?.level_1?.status);
    replacement.disabled = busy;
    replacement.textContent = status?.level_1?.status === 'needs_correction' ? 'Submit corrected test details' : 'Submit new test details';
  }
  const canonicalIdentifier = value => { const selector = loginIdentifier(value); return selector.email ?? `@${selector.username}`; };
  const passwordManager = createPasswordManagerSignIn({normalizeIdentifier:canonicalIdentifier,signIn:values => account.signIn(values)});
  workflow = new IdentityCaptureWorkflow({getAccount: options => account.getAccount(options),
    prepareImage: prepareEnrollmentImage,
    noticeVersion: IDENTITY_INTAKE_NOTICE.version,
    submitIdentity: (body,options) => account.submitIdentity(body,options),
    identitySubmissionStatus: (id,options) => account.identitySubmissionStatus(id,options),
    onChange: () => update()});
  const camera = createIdentityCameraTool({video:$('#enrollment-video'),
    issueChallenge:(body,options) => account.issueIdentityCaptureChallenge(body,options), onInterrupted: reason => {
    cameraKind = null; cameraFocusPending = false; message(reason); update();
  }});
  const stage = $('#camera-stage');
  const stopCamera = () => { cameraKind = null; cameraFocusPending = false; const stopped = camera.stop(); stage.hidden = true; return stopped; };
  const has = kind => workflow.snapshot().items.some(item => item.kind === kind);
  function levelOneVerified(state) {
    return state.state === 'signed_in' && workflowAccess('requester',state).allowed === true;
  }
  function resetCopy() {
    copyEpoch++; copyBusy = false;
    $('#sign-in-copy-status').hidden = true; $('#sign-in-copy-status').textContent = '';
    $('#sign-in-copy-fallback').hidden = true; $('#sign-in-copy-fallback').value = '';
  }
  function clearSecrets({preserveTerms = false} = {}) {
    passwordManager.cancel();
    recoveryExportEpoch++; recoveryExportController?.abort(); recoveryExportController = null; recoveryExport.cancel();
    for (const input of screen.querySelectorAll('input[type="password"], [data-secret]')) input.value = '';
    $('#sign-in-preview-code').textContent = ''; $('#sign-in-email-preview').open = false; renderCode();
    resetCopy();
    $('#recovery-code-display').hidden = true;
    $('#mock-mailbox').hidden = true;
    $('#recovery-download-status').textContent = ''; $('#recovery-download-status').hidden = true;
    $('#delete-deliberate').checked = false;
    $('#delete-retention-accept').checked = false;
    if (!preserveTerms) {
      $('#account-create-reviewed').checked = false;
      $('#account-terms-accept').checked = false;
    }
  }
  function message(text, error = false) {
    const box = $('#onboarding-message');
    box.textContent = text; box.hidden = !text;
    box.classList.toggle('errors', error);
    box.classList.toggle('example-notice', !error);
    if (text) box.focus({preventScroll:false});
  }
  async function run(action) {
    if (busy) return;
    let actionEpoch = viewEpoch;
    const current = () => actionEpoch === viewEpoch;
    const go = async (next, replace = false) => {
      if (current()) {
        actionNavigation = true;
        try { await navigate(next, replace); } finally { actionNavigation = false; actionEpoch = viewEpoch; }
      }
    };
    const announce = text => { if (current()) message(text); };
    busy = true; update();
    try { await action(go, announce); }
    catch (error) { if (current()) message(error.message || 'The action could not complete.', true); }
    finally { busy = false; update(); }
  }
  function guard(candidate) {
    const state = account.snapshot(), value = workflow.snapshot();
    const access = workflowAccess(candidate,state);
    if (!access.allowed) return access.redirect;
    if (candidate === 'reviewer/cases') return state.state === 'signed_in' && reviewer.snapshot().permission === 'granted' ? candidate : 'account/sign-in';
    if (candidate === 'account/devices' && state.state !== 'signed_in') return 'account/sign-in';
    if (candidate === 'account/confirm' && !['pending_confirmation','outcome_unknown'].includes(state.state)) return 'identity/setup';
    if (candidate === 'account/ready' && state.state !== 'confirmed' && !state.recovery_code_available) return 'identity/setup';
    if (candidate === 'account/delete' && state.state !== 'signed_in' && state.operation !== 'deletion') return 'identity/setup';
    if (candidate === 'account/delete-retention' && (state.state !== 'signed_in' || state.deletion_pending)) return state.deletion_pending ? 'account/delete' : 'identity/setup';
    if (state.deletion_pending && ['account/create','account/sign-in','account/recover'].includes(candidate)) return 'account/delete';
    if (candidate === 'identity/status' && !value.submission && state.state === 'signed_in' && state.identity_status?.status === 'awaiting_approval') return candidate;
    if (candidate === 'account/create' && state.state === 'signed_in') return 'identity/setup';
    if (['account/create','account/terms'].includes(candidate) && state.entry?.step !== 'enrollment') return 'account/sign-in';
    if (!candidate.startsWith('identity/') || candidate === 'identity/setup') return candidate;
    if (state.state !== 'signed_in' || !value.binding) return 'identity/setup';
    if (value.status === 'cancelled') return 'identity/setup';
    if (value.submitted && candidate !== 'identity/status') return 'identity/status';
    if (value.submission && !['identity/review','identity/status'].includes(candidate)) return 'identity/review';
    if (['identity/face','identity/review','identity/notice'].includes(candidate) && (!has('document_front') || !value.details_complete)) return 'identity/document';
    if (['identity/review','identity/notice'].includes(candidate) && (!has('document_front') || !has('face_front'))) return has('document_front') ? 'identity/face' : 'identity/document';
    if (candidate === 'identity/review' && !value.submission && value.status !== 'reviewed') return 'identity/face';
    if (candidate === 'identity/notice' && value.status !== 'reviewed') return 'identity/review';
    if (candidate === 'identity/status' && !value.submitted) return !has('document_front') || !value.details_complete ? 'identity/document'
      : !has('face_front') || !value.submission && value.status !== 'reviewed' ? 'identity/face' : 'identity/review';
    return candidate;
  }
  function update() {
    if (!account || !workflow) return;
    updateReviewActor();
    const state = account.snapshot(), value = workflow.snapshot();
    const signedIn = state.state === 'signed_in', pending = state.state === 'pending_confirmation' || state.state === 'outcome_unknown' && state.operation === 'enrollment';
    const homeSignIn = $('#home-sign-in');
    if (signedIn && document.activeElement === homeSignIn) $('#home-screen').focus({preventScroll:true});
    let resume = false; try { resume = connecting && !!localStorage.getItem('nonverba-session'); } catch {}
    homeSignIn.hidden = signedIn || resume;
    const apiLink = $('#configure-api-access');
    if (!signedIn && document.activeElement === apiLink) $('#account-setup-link').focus();
    apiLink.hidden = !signedIn;
    const devicesLink = $('#account-devices-link');
    if (!signedIn && document.activeElement === devicesLink) $('#view-title').focus({preventScroll:true});
    devicesLink.hidden = !signedIn;
    devicesLink.disabled = busy || !signedIn;
    $('#account-devices-refresh').disabled = busy || devicesBusy || !signedIn;
    $('[data-onboarding-view="account/devices"]').setAttribute('aria-busy',String(devicesBusy));
    for (const button of $('#account-device-list').querySelectorAll('button')) button.disabled = busy || devicesBusy || !signedIn;
    $('#account-devices-sign-in').hidden = signedIn;
    if (!signedIn) {
      deviceEpoch++; devicesBusy = false;
      $('#account-device-list').replaceChildren(); $('#account-devices-more').hidden = true;
      $('#account-devices-message').textContent = route === 'account/devices' ? 'Sign in to view your devices.' : '';
    }
    $('#settings-budgets').hidden = !signedIn;
    if (!signedIn && value.binding) { stopCamera(); workflow.cancel(); return; }
    $('#account-summary').hidden = !signedIn && state.session_outcome !== 'unknown';
    $('#account-summary').textContent = signedIn ? state.email || '' : state.session_outcome === 'unknown' ? 'Sign-out unconfirmed.' : '';
    $('#account-link-label').textContent = signedIn ? 'Account' : 'Sign in';
    $('#account-session-entry').hidden = !signedIn;
    $('#account-detail-email').textContent = signedIn ? state.email || '' : '';
    $('#account-detail-username').textContent = signedIn ? state.username ? `@${state.username}` : 'Not set' : '';
    const earned = [false,levelOneVerified(state),levelOneVerified(state) && workflowAccess('operations/new',state).allowed === true];
    const identityStatus = signedIn ? state.identity_status?.status || 'unknown' : 'signed_out';
    const awaitingApproval = identityStatus === 'awaiting_approval';
    const received = value.submitted || awaitingApproval && !value.submission;
    {
      const strip = $('#account-earned-stamps'); strip.hidden = !signedIn || route !== 'account/sign-in';
      strip.dataset.identityState = identityStatus;
      const statusLabel = {awaiting_approval:'Awaiting review',checking:'Checking status',unknown:'Status unavailable'}[identityStatus] || '';
      $('#account-identity-status').hidden = !statusLabel;
      if ($('#account-identity-status').textContent !== statusLabel) $('#account-identity-status').textContent = statusLabel;
      for (const image of strip.querySelectorAll('[data-identity-earned]')) image.hidden = earned[Number(image.dataset.identityEarned)] !== true;
      for (const badge of strip.querySelectorAll('[data-identity-unverified],[data-identity-unverified-text]')) badge.hidden = !signedIn || earned.some(Boolean);
    }
    $('#identity-step-level').hidden = !['identity/document','identity/face','identity/review','identity/notice','identity/status'].includes(route);
    const level = value.binding?.role === 'operator' ? 2 : 1;
    const levelName = `Level ${level} identity`;
    const stamp = `identity/level-${level}.webp`;
    if ($('#identity-step-stamp').getAttribute('src') !== stamp) $('#identity-step-stamp').src = stamp;
    $('#identity-step-label').textContent = `${levelName} · ${route === 'identity/status' && received ? 'Awaiting review' : 'Not started'}`;
    $('#identity-level-1 .identity-level-state').textContent = earned[1] ? 'On record' : awaitingApproval ? 'Awaiting review' : 'Not started';
    $('#identity-level-2 .identity-level-state').textContent = earned[2] ? 'On record' : earned[1] ? 'Not open yet' : 'Start Level 1 identity first';
    const identityWarning = signedIn && state.identity_verification !== 'verified';
    $('#account-identity-warning').hidden = !identityWarning;
    const identityIcon = $('#account-identity-warning .status-icon');
    const identityKind = awaitingApproval ? 'pending' : ['unknown','checking'].includes(identityStatus) ? 'unknown' : 'warning';
    identityIcon.dataset.statusKind = identityKind;
    identityIcon.querySelector('use').setAttribute('href',`#${identityKind === 'pending' ? 'status-pending' : identityKind === 'unknown' ? 'status-unknown' : 'warning'}`);
    $('#account-identity-needed').textContent = state.identity_status?.prerequisites?.requests?.reason || 'Start Level 1 identity. It is not confirmed with the issuer.';
    $('#account-identity-needed').hidden = !identityWarning;
    if (identityWarning) $('#account-session-continue').setAttribute('aria-describedby','account-identity-needed');
    else $('#account-session-continue').removeAttribute('aria-describedby');
    $('#account-page-actions').hidden = !(signedIn || state.deletion_pending || state.session_outcome === 'unknown');
    const entry = state.entry;
    if (signedIn) signupMode = false;
    $('#account-email-form').hidden = signedIn || !!entry && (entry.step!=='missing' || !signupMode);
    $('#sign-in-identifier-label').textContent = signupMode ? 'Email' : 'Email or username';
    $('#sign-in-email').type = signupMode ? 'email' : 'text';
    $('#sign-in-email').inputMode = signupMode ? 'email' : 'text';
    $('#sign-in-email').autocomplete = signupMode ? 'email' : 'username';
    const missingAccount = !signedIn && !signupMode && entry?.step === 'missing', missingStatus = $('#sign-in-missing-status');
    missingStatus.hidden = !missingAccount;
    if (missingAccount) {
      const missingText = entry.email ? 'This account does not exist.' : 'This account does not exist. You can create one with an email.';
      const missingLabel = missingStatus.querySelector('span');
      if (missingLabel.textContent !== missingText) missingLabel.textContent = missingText;
    }
    $('#sign-in-create-account').hidden = signedIn || signupMode || (!!entry && !missingAccount);
    $('#sign-in-create-account').className = missingAccount ? 'primary' : 'text-link';
    $('#sign-in-create-account').disabled = busy;
    $('#sign-in-email-context').hidden = signedIn || signupMode || !entry;
    $('#sign-in-selected-email').textContent = entry?.identifier || entry?.email || (entry?.username ? `@${entry.username}` : '');
    $('#account-email-confirm-form').hidden = signedIn || entry?.step !== 'code';
    $('#account-sign-in-form').hidden = signedIn || entry?.step !== 'password';
    $('#sign-in-recover').hidden = signedIn || entry?.step !== 'password';
    $('#sign-in-recover').disabled = busy;
    $('#sign-in-email-preview').hidden = signedIn || entry?.step !== 'code' || state.email_delivery !== 'mock';
    $('#sign-in-preview-use').hidden = !$('#sign-in-preview-code').textContent;
    $('#sign-in-preview-use').disabled = busy;
    $('#sign-in-preview-copy').hidden = !$('#sign-in-preview-code').textContent;
    $('#sign-in-preview-copy').disabled = busy || copyBusy;
    if (route === 'account/sign-in') {
      const title = signedIn ? 'Account' : entry?.step === 'code' ? 'Confirm email' : signupMode ? 'Create account' : 'Sign in';
      setHeading(title,!signedIn && entry?.step === 'code' ? 'Confirm your email to continue.'
        : !signedIn && entry?.step === 'password' ? 'Enter your password.' : '',route);
      screen.setAttribute('aria-label',title);
    }
    $('#account-email').readOnly = true;
    $('#account-email').value = entry?.step === 'enrollment' ? entry.email : '';
    $('#account-session-continue').hidden = !signedIn;
    $('#account-session-continue').disabled = busy || !signedIn;
    const reach = (element, kind, text) => {
      element.dataset.statusKind = kind;
      element.querySelector('use').setAttribute('href','#'+(kind==='pending'?'status-pending':kind==='success'?'status-success':kind==='info'?'status-info':'status-error'));
      const label = element.querySelector('span');
      if (label.textContent !== text) label.textContent = text;
    };
    const describe = (id, noticeId, on) => {
      const button = $('#'+id), parts = (button.getAttribute('aria-describedby')||'').split(/\s+/).filter(part=>part&&part!==noticeId);
      if (on) parts.push(noticeId);
      if (parts.length) button.setAttribute('aria-describedby',parts.join(' '));
      else button.removeAttribute('aria-describedby');
    };
    const serverDown = !signedIn && !state.configured;
    const signInNotice = $('#sign-in-service-status');
    signInNotice.hidden = !serverDown;
    if (serverDown) reach(signInNotice, connecting ? 'pending' : 'error', connecting ? 'Connecting…' : 'Server unreachable');
    describe('account-email-submit', 'sign-in-service-status', serverDown);
    describe('account-sign-in-submit', 'sign-in-service-status', serverDown);
    describe('sign-in-create-account', 'sign-in-missing-status', missingAccount);
    $('#onboarding-notice').hidden = !route.startsWith('identity/') || route === 'identity/status';
    $('#identity-demo-notes').hidden = !route.startsWith('identity/') || route === 'identity/status';
    setRoleSetup(signedIn,state.identity_status?.prerequisites);
    $('#account-sign-out').hidden = !signedIn;
    $('#account-sign-out').disabled = busy || !signedIn;
    $('#account-delete-link').hidden = !state.deletion_pending && !(signedIn && state.email_delivery === 'mock');
    $('#account-delete-label').textContent = state.deletion_pending ? 'Check account deletion' : 'Delete account';
    $('#account-delete-link').disabled = busy;
    $('#account-discard-session').hidden = state.session_outcome !== 'unknown';
    $('#account-discard-session').disabled = busy;
    $('#account-entry-actions').hidden = signedIn || pending;
    $('#onboarding-confirm').hidden = !pending;
    $('#onboarding-account-title').textContent = pending ? 'Confirm email' : state.state === 'confirmed' ? 'Email confirmed' : 'Account';
    $('#onboarding-account-summary').textContent = signedIn ? state.email || '' : pending
      ? `${state.email} · Awaiting confirmation` : state.state === 'confirmed' ? 'Sign in to continue.' : 'Sign in or create an account.';
    const feedback = state.feedback || {api:'unknown',service:'unknown',keys:'signin_required'};
    const serviceNotice = connecting || feedback.api === 'checking' || feedback.service === 'checking'
      ? ['pending', 'Connecting…'] : feedback.api === 'unavailable' || feedback.service === 'unavailable' || !state.configured
      ? ['error', 'Server unreachable'] : feedback.api === 'available' && feedback.service === 'ready'
      ? ['success', 'Connected'] : ['info', 'Check service status in Settings.'];
    reach($('#account-service-status'), serviceNotice[0], serviceNotice[1]);
    describe('onboarding-sign-in', 'account-service-status', serverDown);
    describe('create-account', 'account-service-status', serverDown);
    $('#account-connect').hidden = state.configured;
    const api = {
      unknown:['unknown','Account API not checked'], checking:['pending','Checking the account API…'],
      available:['success','Account API responding'], unavailable:['error','Account API unavailable']
    }[feedback.api] || ['unknown','Account API not checked'];
    const service = {
      unknown:['unknown','Services not checked'], checking:['pending','Checking services…'],
      ready:['success','Services ready'], unavailable:['error','Services unavailable']
    }[feedback.service] || ['unknown','Services not checked'];
    const online = navigator.onLine;
    const network = online === true ? ['success','Network available'] : online === false ? ['warning','Offline'] : ['unknown','Unconfirmed'];
    for (const [id,text] of [['account-api-label',api[1]],['account-connection-label',service[1]],['network-label',network[1]]]) {
      const label = $('#'+id); if (label.textContent !== text) label.textContent = text;
    }
    $('.service-status-list').setAttribute('aria-busy', String(checkingStatus));
    const accountStatus = state.deletion_pending ? [busy ? 'pending' : 'unknown',busy ? 'Deleting account' : 'Account deletion is unconfirmed']
      : state.session_outcome === 'unknown' ? ['warning','Account session result is unconfirmed']
      : signedIn ? ['success','Signed in'] : ['warning',pending ? 'Confirm your email' : 'Sign in to start Level 1 identity'];
    setStatusSources('settings', [
      {id:'settings-account',owner:'account',kind:accountStatus[0],message:accountStatus[1]},
      {id:'settings-api',owner:'api',kind:api[0],message:api[1]},
      {id:'settings-service',owner:'services',kind:service[0],message:service[1]},
      {id:'settings-network',owner:'network',kind:network[0],message:online === false ? 'Device reports no network connection' : 'Device network status does not confirm internet access'}
    ]);
    const realEmail = state.real_email_enabled === true, mockEmail = state.email_delivery === 'mock';
    $('#onboarding-notice').textContent = `${mockEmail ? 'Test email: nothing is sent. ' : realEmail ? '' : 'Email is unavailable. '}Unsubmitted details and photos are cleared when you leave this page. Submission does not verify identity.`;
    $('#mock-email-controls').hidden = !mockEmail || !(route === 'account/confirm' && pending || route === 'account/recover' && state.operation === 'recovery');
    $('#account-mock-email').disabled = busy;
    $('#mock-use-code').disabled = busy || !$('#mock-confirmation-code').value;
    $('#confirmation-delivery').textContent = realEmail && !state.email?.endsWith('.invalid') && !state.email?.endsWith('.test')
      ? 'Check your email for the confirmation code.'
      : mockEmail ? 'Use the email preview below. No email is sent.' : 'Use the test confirmation code. No email is sent.';
    $('#recovery-delivery').textContent = mockEmail ? 'Use the email preview for the confirmation code. No email is sent.' : realEmail ? 'Check your email for the recovery confirmation code.' : 'Email is unavailable. Use the test confirmation code.';
    $('#account-email').placeholder = realEmail ? 'you@example.com' : 'you@example.invalid';
    $('#account-connect').disabled = busy || connecting;
    $('#create-account').disabled = busy || !state.configured;
    $('#onboarding-sign-in').disabled = busy || !state.configured;
    $('#confirmation-email').textContent = state.email || '';
    $('#account-operation-state').textContent = state.operation_state === 'unknown' ? 'Account creation is unconfirmed. Check its status before trying again.' : 'Awaiting email confirmation.';
    const recovering = state.operation === 'recovery' && ['recovery_pending','outcome_unknown'].includes(state.state);
    $('#account-recovery-form').hidden = recovering;
    $('#account-recovery-pending').hidden = !recovering;
    const deleted = state.state === 'deleted' && state.operation === 'deletion';
    $('#account-delete-form').hidden = state.deletion_pending || deleted || !signedIn;
    $('#account-deletion-pending').hidden = !state.deletion_pending;
    $('#account-deletion-title').textContent = busy ? 'Deleting account…' : 'Deletion unconfirmed';
    $('#account-deletion-state').textContent = busy ? 'Waiting for confirmation.' : 'Check deletion status before trying again. Leaving this page does not cancel the request.';
    $('#account-deleted').hidden = !deleted;
    $('#delete-account-email').textContent = state.email || '';
    $('#account-delete-status').disabled = busy;
    $('#show-recovery-code').disabled = busy || !state.recovery_code_available;
    $('#download-recovery-codes').disabled = busy || !!recoveryExportController || !state.recovery_code_available;
    $('#enrollment-begin').disabled = busy || !signedIn || !state.roles.includes('R');
    $('#enrollment-level-2').disabled = busy || !signedIn || !state.roles.includes('O');
    const submissionLocked = !!value.submission;
    for (const id of ['identity-document-type','identity-full-name','identity-birth-city','identity-nationality','identity-age']) {
      $('#'+id).disabled = busy || submissionLocked;
      if (!value.binding || value.submitted) $('#'+id).value = '';
    }
    const capturing = camera.active();
    const video = $('#enrollment-video'), frameReady = video.readyState >= 2 && video.videoWidth >= 160 && video.videoHeight >= 160;
    const faceLive = capturing && cameraKind === 'face_front', faceSelected = has('face_front');
    stage.hidden = !capturing;
    stage.dataset.kind = cameraKind || '';
    $('#camera-shutter').disabled = busy || !capturing || !frameReady;
    $('#camera-shutter').textContent = cameraKind === 'document_front' ? 'Take document photo' : 'Take photo';
    $('#camera-status').textContent = !frameReady ? 'Waiting for the camera…' : cameraKind === 'document_front' ? 'Keep all document corners in view.' : 'Center your face in the oval.';
    $('#camera-stop').className = faceLive ? 'text-link' : 'secondary';
    $('#document-camera-start').disabled = busy || capturing || submissionLocked;
    $('#document-file').disabled = busy || capturing || submissionLocked;
    $('#document-file-choice').hidden = !!window.NonverbaAccount?.postMessage;
    $('#face-camera-start').disabled = busy || capturing || submissionLocked;
    $('#face-camera-start').hidden = faceLive || faceSelected;
    $('#face-camera-start').textContent = busy && cameraKind === 'face_front' ? 'Opening camera…' : 'Start camera';
    $('#face-placeholder').hidden = faceLive || faceSelected;
    $('#face-capture').dataset.captureState = faceLive ? 'live' : faceSelected ? 'selected' : 'idle';
    $('#document-remove').disabled = busy || submissionLocked;
    $('#face-remove').disabled = busy || submissionLocked;
    $('#document-next').disabled = busy || !has('document_front') || !value.details_complete;
    $('#face-next').hidden = !faceSelected || faceLive;
    $('#face-next').disabled = busy || submissionLocked || !faceSelected || !value.details_complete;
    const reviewDetails = workflow.reviewDetails(), detailList = $('#identity-review-details');
    detailList.replaceChildren();
    if (reviewDetails) {
      const document = root.ownerDocument || root;
      const documentType = {passport:'Passport',national_id:'National ID',driving_licence:'Driver’s licence',residence_permit:'Residence permit'}[reviewDetails.document_type];
      for (const [label,text] of [['Document type',documentType],['Full name',reviewDetails.full_name],['City of birth',reviewDetails.birth_city],['Nationality',reviewDetails.nationality],['Age',String(reviewDetails.age)]]) {
        const row = document.createElement('div'), term = document.createElement('dt'), description = document.createElement('dd');
        term.textContent = label; description.textContent = text; row.append(term,description); detailList.append(row);
      }
    }
    const outcomeUnknown = value.status === 'outcome_unknown', intakeAvailable = identityNotice?.available === true;
    $('#enrollment-finish').hidden = !outcomeUnknown && (!intakeAvailable || value.status === 'submitting');
    $('#enrollment-finish').disabled = busy || (!outcomeUnknown && (value.status !== 'reviewed' || !intakeAvailable));
    $('#enrollment-finish').textContent = value.status === 'outcome_unknown' ? 'Check submission' : `Submit ${levelName}`;
    const reviewStatus = outcomeUnknown ? 'Submission unconfirmed. Check its status before trying again.'
      : value.status === 'submitting' ? 'Submitting…' : !intakeAvailable ? 'Submission is not available yet.' : '';
    $('#review-state').textContent = reviewStatus; $('#review-state').hidden = !reviewStatus;
    $('#identity-review-edit').hidden = submissionLocked;
    $('#identity-details-edit').disabled = busy || submissionLocked;
    $('#identity-notice-text').textContent = identityNotice?.text || 'The storage notice is unavailable.';
    $('#identity-notice-version').textContent = identityNotice ? `Draft · Version ${identityNotice.version}` : '';
    $('#identity-notice-choice').hidden = !identityNotice || submissionLocked;
    $('#identity-notice-reviewed').checked = value.notice_accepted;
    $('#identity-notice-reviewed').disabled = busy || !identityNotice || submissionLocked || value.status !== 'reviewed';
    $('#identity-notice-link').disabled = busy || !identityNotice || submissionLocked || value.status !== 'reviewed';
    $('#identity-notice-accept').checked = value.notice_accepted;
    $('#identity-notice-accept').disabled = busy || !identityNotice || submissionLocked || value.status !== 'reviewed';
    if (route === 'identity/review') {
      const title = `Submit ${levelName}`;
      setHeading(title,'',route); screen.setAttribute('aria-label',title);
    } else if (route === 'identity/notice') {
      setHeading(levelName,'',route); screen.setAttribute('aria-label',levelName);
    } else if (route === 'identity/status') {
      const title = received ? 'Awaiting review' : levelName;
      setHeading(title,'',route); screen.setAttribute('aria-label',title);
    }
    $('#enrollment-status-description').textContent = received
      ? `Your ${levelName} has been received. Review is pending. It is not confirmed with the issuer.` : 'Submission unconfirmed.';
    $('#enrollment-reopen').hidden = received;
    $('#enrollment-delete').textContent = received ? 'Done' : 'Discard local photos';
    $('#enrollment-delete').classList.toggle('primary',received);
    $('#enrollment-delete').classList.toggle('text-link',!received);
    for (const kind of ['document_front','face_front']) {
      const url = workflow.preview(kind);
      const image = $(kind === 'document_front' ? '#review-document' : '#review-face');
      const selected = $(kind === 'document_front' ? '#selected-document' : '#selected-face');
      $(kind === 'document_front' ? '#document-selection' : '#face-selection').hidden = !url;
      if (url) { if (image.getAttribute('src') !== url) image.src = url; if (selected.getAttribute('src') !== url) selected.src = url; }
      else { image.removeAttribute('src'); selected.removeAttribute('src'); }
    }
    $('#enrollment-delete').disabled = busy;
    for (const button of screen.querySelectorAll('form button')) button.disabled = busy || !state.configured;
    $('#account-email-submit').disabled = busy || signupMode && !state.configured;
    $('#account-email-confirm-submit').disabled = busy || !state.configured || !/^[0-9A-F]{8}$/.test(codeInput.value);
    const username = $('#account-username').value.trim().toLowerCase();
    const usernameValid = /^[a-z][a-z0-9_]{2,29}$/.test(username);
    $('#account-username-hint').hidden = !username || usernameValid;
    $('#account-username-hint').textContent = usernameValid ? '' : username.includes('-')
      ? 'Use underscores (_) instead of hyphens (-).'
      : 'After @, start with a letter; use 3–30 letters, numbers or _.';
    $('#account-username').setAttribute('aria-invalid',String(!!username && !usernameValid));
    const strength = passwordStrength($('#account-password').value,{username,email:entry?.email || ''});
    const strengthName = ['','Weak','Fair','Good','Strong','Very strong'][strength.level];
    const meter = $('#account-password-meter');
    meter.dataset.level = String(strength.level); meter.setAttribute('aria-valuenow',String(strength.level));
    meter.setAttribute('aria-valuetext',strength.level ? `${strengthName}, level ${strength.level} of 5` : 'No password entered');
    [...meter.children].forEach((segment,index) => segment.toggleAttribute('data-filled',index < strength.level));
    $('#account-password-hint').textContent = strength.message;
    $('#account-password-hint').hidden = !strength.message;
    $('#account-password').setAttribute('aria-invalid',String(strength.level > 0 && !strength.acceptable));
    $('#account-create-reviewed').disabled = busy || termsBusy || !termsDocument;
    $('#account-terms-accept').disabled = busy || termsBusy || !termsDocument || entry?.step !== 'enrollment';
    $('#account-terms-accept').checked = $('#account-create-reviewed').checked;
    $('#account-terms-status').textContent = termsBusy ? 'Loading terms…' : 'Account terms unavailable.';
    $('#account-terms-status').hidden = !termsBusy && !!termsDocument;
    $('#account-terms-retry').hidden = !termsFailure;
    $('#account-terms-retry').disabled = busy || termsBusy;
    $('#account-create-submit').disabled = busy || !state.configured || entry?.step !== 'enrollment' || termsBusy || !termsDocument;
    $('#account-confirm-submit').disabled = busy || !state.configured || !$('#account-confirm-deliberate').checked;
    $('#recovery-finish-submit').disabled = busy || !state.configured || !$('#recovery-finish-deliberate').checked;
    $('#account-ready-sign-in').disabled = busy;
    $('#delete-deliberate').disabled = busy || !signedIn;
    $('#delete-retention-accept').disabled = busy || !signedIn;
    $('#delete-retention-accept').checked = $('#delete-deliberate').checked;
    $('#account-delete-submit').disabled = busy || !signedIn || !$('#delete-deliberate').checked;
    screen.setAttribute('aria-busy', String(busy));
    renderCode();
    onAccountState(state);
    if (['account/create','account/terms'].includes(route) && state.configured && !termsAttempted) void loadTerms();
    if (route === 'identity/setup' && signedIn && !earned[1] && !busy && !document.hidden && identityEntryEpoch !== viewEpoch) {
      identityEntryEpoch = viewEpoch;
      queueMicrotask(() => { if (route === 'identity/setup' && !document.hidden && account.snapshot().state === 'signed_in') void beginCapture('requester'); });
    }
  }
  function render(next) {
    if (route !== next) {
      if (route === 'reviewer/cases') { reviewSelectedKey = null; reviewer.clear({preserveOperation:true}); reviewerView.clear(); }
      signupMode = false;
      if (route === 'account/ready') account.clearRecoveryCodes();
      viewEpoch++;
      $('#identity-review-edit').open = false;
      deviceEpoch++; devicesBusy = false;
      stopCamera();
      if (route.startsWith('identity/') && route !== 'identity/setup' && !next.startsWith('identity/')) workflow.cancel();
      if (busy && !actionNavigation && route.startsWith('account/')) account.cancel();
      const reviewingTerms = route === 'account/create' && next === 'account/terms'
        || route === 'account/terms' && next === 'account/create';
      const reviewingRetention = route === 'account/delete' && next === 'account/delete-retention'
        || route === 'account/delete-retention' && next === 'account/delete';
      if (!reviewingTerms && !reviewingRetention) {
        if (route === 'account/sign-in' && !(actionNavigation && next === 'account/create' && account.snapshot().entry?.step === 'enrollment')
          || route === 'account/create' || route === 'account/terms') account.resetEntry();
        clearSecrets();
      }
      message('');
    }
    route = next;
    const active = next !== 'reviewer/cases' && Object.hasOwn(ONBOARDING_VIEWS, next);
    screen.hidden = !active; screen.dataset.view = next;
    screen.setAttribute('aria-label', ONBOARDING_VIEWS[next]?.[1] || 'Account');
    for (const panel of screen.querySelectorAll('[data-onboarding-view]')) panel.hidden = panel.dataset.onboardingView !== next;
    update();
    if (next === 'reviewer/cases') { drawReview(); void reviewer.loadCases(); }
    if (['identity/status','account/sign-in'].includes(next) && account.reviewOwner()) void reviewer.subjectStatus();
    if (next === 'account/sign-in' && account.reviewOwner()) void reviewer.permission();
    if (next === 'account/devices' && account.snapshot().state === 'signed_in') void loadDevices();
  }
  async function loadTerms() {
    if (termsBusy) return;
    $('#account-terms-document-status').textContent = 'Loading terms…';
    termsBusy = true; termsAttempted = true; termsFailure = false; update();
    try {
      const value = await account.terms();
      const prior = termsDocument && `${termsDocument.id}:${termsDocument.version}:${termsDocument.content_sha256}`;
      const current = `${value.id}:${value.version}:${value.content_sha256}`;
      if (prior !== current) $('#account-create-reviewed').checked = false;
      termsDocument = value;
      const document = root.ownerDocument || root, content = $('#account-terms-document');
      content.replaceChildren();
      for (const section of value.sections) {
        const block = document.createElement('section'), title = document.createElement('h2');
        title.textContent = section.title; block.append(title);
        for (const text of section.paragraphs) { const paragraph = document.createElement('p'); paragraph.textContent = text; block.append(paragraph); }
        content.append(block);
      }
      $('#account-terms-document-version').textContent = `${value.status === 'draft' ? 'Draft · ' : ''}Version ${value.version}`;
      $('#account-terms-document-status').textContent = '';
    } catch {
      termsDocument = null; termsFailure = true; $('#account-create-reviewed').checked = false;
      $('#account-terms-document').replaceChildren(); $('#account-terms-document-version').textContent = '';
      $('#account-terms-document-status').textContent = 'Account terms unavailable. Go Back and retry.';
    } finally { termsBusy = false; update(); }
  }
  $('#account-terms-retry').addEventListener('click',() => loadTerms());
  $('#account-create-reviewed').addEventListener('click',event => {
    event.preventDefault();
    $('#account-create-reviewed').checked = $('#account-terms-accept').checked;
    if (route !== 'account/create' || busy || termsBusy || !termsDocument) { update(); return; }
    navigate('account/terms');
  });
  $('#account-terms-accept').addEventListener('change',event => {
    if (route !== 'account/terms' || busy || termsBusy || !termsDocument || account.snapshot().entry?.step !== 'enrollment') { update(); return; }
    const agreed = event.target.checked;
    $('#account-create-reviewed').checked = agreed;
    update();
    if (agreed) closeTerms();
  });
  const deviceDocument = root.ownerDocument || root;
  function deviceText(tag, text, className = '') {
    const element = deviceDocument.createElement(tag);
    element.textContent = text; if (className) element.className = className;
    return element;
  }
  function deviceTime(value) {
    const date = new Date(Number(value) * 1000);
    return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'Unknown';
  }
  function deviceSessions(row, sessions, name) {
    sessions.forEach((session,index) => {
      const line = deviceText('div','','device-session');
      line.append(deviceText('span',`${session.current ? 'Current session' : sessions.length > 1 ? `Session ${index + 1}` : 'Session'} · Expires ${deviceTime(session.expires_at)}`));
      const button = deviceText('button',session.current ? 'Sign out this session' : 'Sign out','text-link');
      button.type = 'button'; button.setAttribute('aria-label',`${button.textContent} · ${name}${sessions.length > 1 ? ` · Session ${index + 1}` : ''}`);
      button.addEventListener('click',() => session.current ? signOut() : revokeDeviceSession(session.session_id));
      line.append(button); row.append(line);
    });
  }
  function showDevices(value) {
    const list = $('#account-device-list');
    list.replaceChildren();
    for (const device of value.devices) {
      const row = deviceText('li',''), heading = deviceText('div','','device-heading');
      const name = device.name || (device.platform === 'android' ? 'Android device' : 'Browser');
      heading.append(deviceText('h2',name));
      if (device.current) heading.append(deviceText('span','This device','tag'));
      row.append(heading);
      row.append(deviceText('p',`${device.platform === 'android' ? 'Android' : 'Browser'} · ${device.active_sessions ? 'Signed in' : 'Signed out'} · Last active ${deviceTime(device.last_seen)}`,'small-note'));
      row.append(deviceText('p',device.attestation.status === 'verified' ? 'Hardware verified at key creation'
        : device.platform === 'browser' ? 'No hardware attestation' : 'Hardware attestation unverified','device-attestation'));
      deviceSessions(row,device.sessions,name);
      if (device.sessions_has_more) row.append(deviceText('p','Some sessions are not shown.','small-note'));
      list.append(row);
    }
    if (value.unregistered_sessions.length) {
      const row = deviceText('li',''); row.append(deviceText('h2','Other sessions'));
      row.append(deviceText('p','Device details unavailable','device-attestation'));
      deviceSessions(row,value.unregistered_sessions,'Other sessions'); list.append(row);
    }
    $('#account-devices-more').hidden = !value.has_more && !value.unregistered_sessions_has_more;
    $('#account-devices-message').textContent = value.devices.length || value.unregistered_sessions.length ? '' : 'No devices yet.';
  }
  async function loadDevices() {
    if (devicesBusy || route !== 'account/devices' || account.snapshot().state !== 'signed_in') return;
    const captured = ++deviceEpoch;
    const current = () => captured === deviceEpoch && route === 'account/devices' && account.snapshot().state === 'signed_in';
    devicesBusy = true; update();
    $('#account-devices-message').textContent = 'Loading…';
    try {
      const value = await account.devices();
      if (value?.ok === false) throw new Error(value.message || 'Devices unavailable.');
      if (current()) showDevices(value);
    } catch (error) {
      if (current()) $('#account-devices-message').textContent = error.message || 'Devices unavailable. Try again.';
    } finally {
      if (captured === deviceEpoch) { devicesBusy = false; update(); }
    }
  }
  async function revokeDeviceSession(sessionId) {
    if (devicesBusy || route !== 'account/devices' || account.snapshot().state !== 'signed_in') return;
    const captured = ++deviceEpoch;
    devicesBusy = true; update();
    for (const button of $('#account-device-list').querySelectorAll('button')) button.disabled = true;
    $('#account-devices-message').textContent = 'Signing out…';
    try {
      const result = await account.revokeSession(sessionId);
      if (result?.ok === false) throw new Error(result.message || 'Sign-out could not be confirmed.');
      if (captured !== deviceEpoch || route !== 'account/devices') return;
      devicesBusy = false;
      if (result.current) await navigate('account/sign-in');
      else await loadDevices();
    } catch (error) {
      if (captured === deviceEpoch && route === 'account/devices') $('#account-devices-message').textContent = error.message || 'Sign-out could not be confirmed. Refresh to check.';
    } finally {
      if (captured === deviceEpoch) {
        devicesBusy = false; update();
        for (const button of $('#account-device-list').querySelectorAll('button')) button.disabled = false;
      }
    }
  }
  $('#account-devices-refresh').addEventListener('click',() => loadDevices());
  function validateSignup() {
    const username = $('#account-username'), password = $('#account-password');
    const name = username.value.trim().toLowerCase();
    const strength = passwordStrength(password.value,{username:name,email:account.snapshot().entry?.email || ''});
    const reject = (input,hint,text) => {
      hint.textContent = text; hint.hidden = false; input.setAttribute('aria-invalid','true');
      message(''); input.focus(); return false;
    };
    if (!/^[a-z][a-z0-9_]{2,29}$/.test(name)) return reject(username,$('#account-username-hint'),
      name ? $('#account-username-hint').textContent : 'Enter a username.');
    if (!strength.acceptable) return reject(password,$('#account-password-hint'),
      strength.message);
    if (!$('#account-create-reviewed').checked) { navigate('account/terms'); return false; }
    return true;
  }
  function form(id, action, validate = () => true) {
    $(id).addEventListener('submit', event => { event.preventDefault();
      if (busy || !validate()) return;
      // Copy only for the duration of this action; clear all secret controls even on errors.
      const values = Object.fromEntries([...$(id).querySelectorAll('input')].map(input => [input.id,input.type === 'checkbox' ? input.checked : input.value]));
      clearSecrets({preserveTerms:id === '#account-create-form'});
      for (const input of $(id).querySelectorAll('input[type="checkbox"]')) if (input.id !== 'account-create-reviewed') input.checked = false;
      run((go, announce) => action(values, go, announce));
    });
  }
  form('#account-create-form', async (values, go) => {
    workflow.cancel();
    const entry = account.snapshot().entry;
    if (entry?.step !== 'enrollment' || values['account-email'] !== entry.email) throw new Error('Confirm your email before creating an account.');
    if (!termsDocument) throw new Error('Read the Account Terms before continuing.');
    try {
      await account.create({username:values['account-username'].trim().toLowerCase(),email:entry.email,password:values['account-password'],
        roles:['R','O'],terms:{id:termsDocument.id,version:termsDocument.version,content_sha256:termsDocument.content_sha256},
        deliberate:values['account-create-reviewed']});
    } catch (error) {
      if (error.code === 'account_terms_changed') await loadTerms();
      if (account.snapshot().state === 'outcome_unknown' && account.snapshot().operation === 'enrollment') await go('account/confirm');
      throw error;
    }
    await go(account.snapshot().state === 'confirmed' ? 'account/ready' : 'account/confirm');
  },validateSignup);
  const entryError = error => new Error(['email_invalid','username_invalid','identifier_invalid'].includes(error.code) ? 'Enter a valid email or username.'
    : error.code === 'confirmation_invalid' ? 'Enter all 8 code characters.' : 'Could not continue. Try again or go Back.');
  const signInError = error => new Error(['email_invalid','username_invalid','identifier_invalid'].includes(error.code) ? 'Enter a valid email or username.'
    : error.code === 'password_invalid' ? 'Enter your password.' : error.code === 'invalid_authorization'
    ? 'Check your email or username and password.' : 'Sign-in unavailable. Try again.');
  form('#account-email-form', async (values,go) => {
    workflow.cancel();
    if (!signupMode) {
      const identifier = values['sign-in-email'], captured = viewEpoch;
      let expected;
      try { expected = canonicalIdentifier(identifier); } catch (error) { throw entryError(error); }
      const current = () => captured === viewEpoch && route === 'account/sign-in' && !signupMode && !document.hidden
        && $('#sign-in-email').value === identifier;
      try {
        if (account.snapshot().configured && await passwordManager.trySignIn(expected,{isCurrent:current})) {
          if (current()) await go('home');
          return;
        }
      } catch (error) { throw signInError(error); }
      if (!current()) return;
    }
    try {
      if (signupMode) await account.startEntry({email:values['sign-in-email']});
      else await account.beginSignIn({identifier:values['sign-in-email']});
    }
    catch (error) {
      if (error.code === 'contact_preview_only') { message(error.message); return; }
      throw entryError(error);
    }
    if (route !== 'account/sign-in') return;
    const step = account.snapshot().entry?.step;
    enterEmailStep(step === 'code' ? 'code' : step === 'missing' ? 'missing' : 'password'); message('');
    (step === 'missing' ? $('#sign-in-create-account') : step === 'code' ? codeInput : $('#sign-in-password')).focus();
  });
  $('#sign-in-create-account').addEventListener('click',() => {
    if (busy || route !== 'account/sign-in' || account.snapshot().state === 'signed_in') return;
    const identifier = $('#sign-in-email').value.trim();
    if (account.snapshot().entry?.step !== 'missing') account.resetEntry();
    signupMode = true; clearSecrets();
    $('#sign-in-email').value = identifier.includes('@') && !identifier.startsWith('@') ? identifier : '';
    enterEmailStep('signup'); message(''); update(); $('#sign-in-email').focus();
  });
  form('#account-email-confirm-form', async (values, go) => {
    try { await account.confirmEntry({code:values['sign-in-email-code']}); }
    catch (error) { throw entryError(error); }
    message('');
    if (account.snapshot().entry?.step === 'enrollment') await go('account/create',true);
    else { signupMode = false; update(); $('#sign-in-password').focus(); }
  });
  for (const event of ['input','focus','blur','keyup','select']) codeInput.addEventListener(event, () => {
    if (event === 'input') codeInput.value = codeInput.value.replace(/[^0-9a-f]/gi,'').slice(0,8).toUpperCase();
    renderCode(); update();
  });
  codeInput.addEventListener('paste', event => {
    const value = event.clipboardData?.getData('text');
    if (value === undefined) return;
    event.preventDefault(); codeInput.value = value.replace(/[^0-9a-f]/gi,'').slice(0,8).toUpperCase(); update();
  });
  codeInput.addEventListener('click', event => {
    const bounds = codeInput.getBoundingClientRect(), index = Math.max(0,Math.min(7,Math.floor((event.clientX-bounds.left)/bounds.width*8)));
    codeInput.setSelectionRange(index,Math.min(index+1,codeInput.value.length)); renderCode();
  });
  $('#sign-in-email-preview').addEventListener('toggle', () => {
    if (!$('#sign-in-email-preview').open) { resetCopy(); return; }
    if (busy) { $('#sign-in-email-preview').open = false; return; }
    resetCopy();
    run(async () => {
      try { $('#sign-in-preview-code').textContent = await account.mockMail(); }
      catch (error) { throw entryError(error); }
    });
  });
  $('#sign-in-preview-use').addEventListener('click', () => {
    if (busy) return;
    codeInput.value = $('#sign-in-preview-code').textContent; $('#sign-in-preview-code').textContent = '';
    $('#sign-in-email-preview').open = false; message(''); codeInput.focus(); update();
  });
  $('#sign-in-preview-copy').addEventListener('click',async () => {
    const code = $('#sign-in-preview-code').textContent;
    if (busy || copyBusy || route !== 'account/sign-in' || account.snapshot().entry?.step !== 'code' || !/^[0-9A-F]{8}$/.test(code)) return;
    resetCopy(); const captured = copyEpoch; copyBusy = true; update();
    const current = () => captured === copyEpoch && route === 'account/sign-in'
      && account.snapshot().entry?.step === 'code' && $('#sign-in-preview-code').textContent === code && $('#sign-in-email-preview').open;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(code);
      if (current()) { $('#sign-in-copy-status').textContent = 'Copied.'; $('#sign-in-copy-status').hidden = false; }
    } catch {
      if (current()) {
        $('#sign-in-copy-status').textContent = 'Copy unavailable. Select and copy the code.'; $('#sign-in-copy-status').hidden = false;
        const fallback = $('#sign-in-copy-fallback'); fallback.value = code; fallback.hidden = false; fallback.focus(); fallback.select();
      }
    } finally { if (captured === copyEpoch) { copyBusy = false; update(); } }
  });
  function restoreEmailStep(active) {
    if (route !== 'account/sign-in' || account.snapshot().state === 'signed_in') return;
    const entry = account.snapshot().entry;
    const step = active === true ? entry?.step === 'code' ? 'code' : entry?.step === 'missing' ? 'missing' : 'password' : active;
    if (entry?.step==='missing' && (step==='missing' || step==='signup')) { signupMode=step==='signup'; update(); return; }
    if (step === 'password' && entry?.step === 'password' || step === 'code' && entry?.step === 'code'
      || step === 'signup' && signupMode && !entry || !step && !signupMode && !entry) return;
    viewEpoch++;
    if (busy) account.cancel(); else account.resetEntry();
    signupMode = step === 'signup' || step === 'code';
    clearSecrets(); message(''); update(); $('#sign-in-email').focus();
  }
  $('#sign-in-recover').addEventListener('click', () => run(async go => {
    const entry = account.snapshot().entry;
    if (entry?.step !== 'password') return;
    $('#recovery-email').value = entry.email || '';
    await go('account/recover');
    if (route === 'account/recover' && !entry.email) $('#recovery-email').focus();
  }));
  form('#account-sign-in-form', async (values, go) => {
    workflow.cancel();
    const entry = account.snapshot().entry;
    if (entry?.step !== 'password') return;
    try { await account.signIn({identifier:entry.identifier || entry.email,password:values['sign-in-password']}); }
    catch (error) { throw signInError(error); }
    await go('home');
  });
  $('#account-session-continue').addEventListener('click', () => account.snapshot().identity_status?.status === 'awaiting_approval'
    ? navigate('identity/status') : beginCapture(levelOneVerified(account.snapshot()) ? 'operator' : 'requester'));
  form('#account-confirm-form', async (values, go) => { await account.confirm({code:values['account-confirm-code'],deliberate:values['account-confirm-deliberate']}); await go('account/ready'); });
  form('#account-recovery-form', async (values, go, announce) => {
    workflow.cancel(); await account.startRecovery({email:values['recovery-email'],recoveryCode:values['recovery-code']});
    announce(account.snapshot().email_delivery === 'mock' ? 'Use the email preview for your confirmation code. No email is sent.' : account.snapshot().real_email_enabled ? 'Check your email for the confirmation code.' : 'Email is unavailable. Use the test confirmation code.');
  });
  form('#account-recovery-finish-form', async (values, go) => {
    workflow.cancel(); await account.recover({code:values['recovery-contact-code'],newPassword:values['recovery-new-password'],deliberate:values['recovery-finish-deliberate']}); await go('account/ready');
  });
  form('#account-delete-form', async values => {
    stopCamera(); workflow.cancel();
    await account.deleteAccount({password:values['delete-password'],confirmEmail:values['delete-confirm-email'],deliberate:values['delete-deliberate']});
  });
  $('#account-delete-form').addEventListener('input', event => {
    if (event.target.id !== 'delete-deliberate') {
      $('#delete-deliberate').checked = false;
      $('#delete-retention-accept').checked = false;
    }
    update();
  });
  function showRetentionTerms() {
    const section = ACCOUNT_TERMS.sections.find(item => item.title === 'Leaving, closure and restrictions');
    if (!section) throw new Error('The account terms are missing the closure section.');
    const document = root.ownerDocument || root, content = $('#delete-retention-document');
    content.replaceChildren();
    const block = document.createElement('section'), title = document.createElement('h2');
    title.textContent = section.title; block.append(title);
    for (const text of section.paragraphs) {
      const paragraph = document.createElement('p'); paragraph.textContent = text; block.append(paragraph);
    }
    content.append(block);
    $('#delete-retention-version').textContent = `Draft · Version ${ACCOUNT_TERMS.version}`;
  }
  showRetentionTerms();
  $('#delete-deliberate').addEventListener('click', event => {
    event.preventDefault();
    $('#delete-deliberate').checked = $('#delete-retention-accept').checked;
    if (route !== 'account/delete' || busy || account.snapshot().state !== 'signed_in') { update(); return; }
    navigate('account/delete-retention');
  });
  $('#delete-retention-accept').addEventListener('change', event => {
    if (route !== 'account/delete-retention' || busy || account.snapshot().state !== 'signed_in') { update(); return; }
    const agreed = event.target.checked;
    $('#delete-deliberate').checked = agreed;
    update();
    if (agreed) closeRetention();
  });
  $('#account-delete-status').addEventListener('click', () => run(() => account.deletionStatus()));
  for (const id of ['account-create-reviewed','account-confirm-deliberate','recovery-finish-deliberate']) $('#'+id).addEventListener('change', update);
  $('#account-create-form').addEventListener('input', event => {
    if (event.target.id === 'account-username') {
      const input = event.target, bare = input.value.replace(/^@+/,''), removed = input.value.length - bare.length;
      const value = bare.slice(0,30);
      if (value !== input.value) {
        const start = Math.max(0,Math.min(value.length,input.selectionStart - removed));
        const end = Math.max(start,Math.min(value.length,input.selectionEnd - removed));
        input.value = value; input.setSelectionRange(start,end);
      }
    }
    message(''); update();
  });
  $('#account-confirm-form').addEventListener('input', event => { if (event.target.id !== 'account-confirm-deliberate') $('#account-confirm-deliberate').checked = false; update(); });
  $('#account-recovery-finish-form').addEventListener('input', event => { if (event.target.id !== 'recovery-finish-deliberate') $('#recovery-finish-deliberate').checked = false; update(); });
  $('#show-recovery-code').addEventListener('click', () => {
    const codes = account.recoveryCodes();
    if (codes.length !== 8) return message('Recovery codes are no longer available in this page.', true);
    recoveryCells.forEach((input,index) => { input.value = codes[index]; });
    $('#recovery-code-display').hidden = false; update();
  });
  $('#download-recovery-codes').addEventListener('click',async () => {
    if (busy || recoveryExportController || route !== 'account/ready') return;
    const captured = recoveryExportEpoch, controller = new AbortController(); recoveryExportController = controller;
    const status = $('#recovery-download-status'); status.textContent = ''; status.hidden = true; update();
    const current = () => captured === recoveryExportEpoch && route === 'account/ready' && !controller.signal.aborted;
    try {
      const outcome = await recoveryExport.save(account.recoveryCodes(),{signal:controller.signal});
      if (current()) { status.textContent = outcome === 'saved' ? 'File saved.' : outcome === 'started' ? 'Download started.' : 'Download cancelled.'; status.hidden = false; }
    } catch {
      if (current()) { status.textContent = 'Download could not start. Try again.'; status.hidden = false; }
    } finally { if (captured === recoveryExportEpoch) { recoveryExportController = null; update(); } }
  });
  $('#account-enrollment-status').addEventListener('click', () => run(async go => { const state = await account.enrollmentStatus(); if (state.state === 'confirmed' || state.recovery_code_available) await go('account/ready'); }));
  $('#account-recovery-status').addEventListener('click', () => run(async go => { const state = await account.recoveryStatus(); if (state.state === 'confirmed' || state.recovery_code_available) await go('account/ready'); }));
  $('#account-mock-email').addEventListener('click', () => run(async () => {
    const code = await account.mockMail(); $('#mock-confirmation-code').value = code;
    $('#mock-mailbox').hidden = false; $('#mock-confirmation-code').focus();
  }));
  $('#mock-use-code').addEventListener('click', () => {
    const input = $(route === 'account/recover' ? '#recovery-contact-code' : '#account-confirm-code');
    input.value = $('#mock-confirmation-code').value; $('#mock-confirmation-code').value = '';
    $('#mock-mailbox').hidden = true; input.focus(); update();
  });
  const signOut = () => run(async go => {
    stopCamera(); workflow.cancel(); clearSecrets();
    try { await account.signOut(); } catch (error) { await go('account/sign-in'); throw error; }
    await go('account/sign-in');
    if (account.snapshot().session_outcome === 'revoked') {
      $('#sign-in-email').value = '';
      if (route === 'account/sign-in') $('#sign-in-email').focus();
    }
  });
  $('#account-sign-out').addEventListener('click', signOut);
  $('#account-discard-session').addEventListener('click', async () => {
    stopCamera(); workflow.cancel(); clearSecrets(); account.discardSession(); await navigate('account/sign-in'); message('Local session removed. Server sign-out and stopped work remain unconfirmed.');
  });
  async function connect() {
    connecting = true; update();
    try { if (!await transport.available()) throw new Error('Local account service unavailable.'); await account.configure(); await account.restore(); }
    finally { connecting = false; update(); }
  }
  function checkStatus(quiet = false) {
    if (statusCheckPromise) return statusCheckPromise;
    checkingStatus = true; update();
    statusCheckPromise = (async () => {
      try { await account.checkStatus({quiet}); }
      catch { /* The adapter retains unavailable or unknown feedback. */ }
      finally { checkingStatus = false; statusCheckPromise = null; update(); }
    })();
    return statusCheckPromise;
  }
  function setSettingsOpen(open) {
    settingsOpen = open;
    const epoch = ++statusEpoch;
    clearTimeout(statusTimer);
    if (!open || document.hidden) return;
    const tick = async (quiet = false) => {
      if (!busy) await checkStatus(quiet);
      if (epoch === statusEpoch && !document.hidden) statusTimer = setTimeout(() => tick(true), 10000);
    };
    void tick();
  }
  $('#account-connect').addEventListener('click', () => run(() => connect()));
  function beginCapture(role,{fresh = false} = {}) {
    return run(async go => {
      await account.getAccount();
      const state = account.snapshot();
      if (state.state !== 'signed_in') throw new Error('Sign in before starting Level 1 identity.');
      if (!state.roles.includes(role === 'requester' ? 'R' : 'O')) throw new Error('This account cannot start this identity level.');
      if (fresh) {
        await reviewer.subjectStatus();
        if (!['approved','needs_correction','rejected','not_eligible'].includes(reviewer.snapshot().subject?.level_1?.status))
          throw new Error('Check the current test review status before preparing a replacement.');
      }
      if (!fresh && state.identity_status?.status === 'awaiting_approval') { await go('identity/status'); return; }
      captureRole = role; stopCamera(); await workflow.begin(role);
      identityNotice = null;
      try { identityNotice = await account.getIdentityNotice(); } catch { /* Capture remains available; submission stays disabled. */ }
      await go('identity/document');
    });
  }
  $('#enrollment-begin').addEventListener('click', () => beginCapture('requester'));
  $('#enrollment-new-test').addEventListener('click', () => beginCapture('requester',{fresh:true}));
  $('#enrollment-level-2').addEventListener('click', () => beginCapture('operator'));
  const syncIdentityDetails = () => {
    if (!workflow.snapshot().binding || busy) return;
    workflow.setDetails({document_type:$('#identity-document-type').value,full_name:$('#identity-full-name').value,
      birth_city:$('#identity-birth-city').value,nationality:$('#identity-nationality').value,age:Number($('#identity-age').value)});
  };
  for (const id of ['identity-document-type','identity-full-name','identity-birth-city','identity-nationality','identity-age']) {
    $('#'+id).addEventListener('input',syncIdentityDetails);
    $('#'+id).addEventListener('change',syncIdentityDetails);
  }
  function focusCamera() {
    if (cameraFocusPending && !busy && !document.hidden && camera.active() && !$('#camera-shutter').disabled) {
      cameraFocusPending = false; $('#camera-shutter').focus({preventScroll:false});
    }
  }
  async function acquireCamera(kind) {
    if (route !== (kind === 'face_front' ? 'identity/face' : 'identity/document') || document.hidden) return;
    const capturedEpoch = viewEpoch;
    const authority = await workflow.captureContext();
    if (capturedEpoch !== viewEpoch || document.hidden) return;
    // This screen captures one frontal still; it does not run the optional movement exercise.
    if (kind === 'face_front' && !workflow.snapshot().guidance.skipped) await workflow.setGuidance('skipped');
    if (capturedEpoch !== viewEpoch || document.hidden) return;
    cameraKind = kind; cameraFocusPending = true;
    $(kind === 'document_front' ? '#document-camera-slot' : '#face-camera-slot').append(stage);
    update();
    const context = {account_id:authority.account_id,principal_id:authority.principal_id,
      current_session_id:authority.current_session_id,recovery_generation:authority.recovery_generation};
    try {
      await camera.start(kind,{context});
      if (camera.isNative) {
        const result = await camera.capture(); cameraKind = null;
        if (capturedEpoch !== viewEpoch || document.hidden) return;
        await workflow.select(kind,result.blob,{source:'camera',deliberate:true,
          cleanup:result.cleanup,captureProof:result.captureProof});
      }
    }
    catch (error) { stopCamera(); throw error; }
    if (capturedEpoch !== viewEpoch) { stopCamera(); return; }
    update();
  }
  function startCamera(kind) {
    return run(() => acquireCamera(kind)).then(focusCamera);
  }
  $('#document-camera-start').addEventListener('click', () => startCamera('document_front'));
  $('#face-camera-start').addEventListener('click', () => startCamera('face_front'));
  $('#camera-stop').addEventListener('click', () => {
    const kind = cameraKind; stopCamera(); update();
    $(kind === 'face_front' ? '#face-camera-start' : '#document-camera-start').focus();
  });
  for (const event of ['loadeddata','resize']) $('#enrollment-video').addEventListener(event, () => {
    if (camera.active()) { update(); focusCamera(); }
  });
  $('#camera-shutter').addEventListener('click', () => {
    const kind = cameraKind, capturedEpoch = viewEpoch;
    void run(async () => {
      if (!kind) return;
      const result = await camera.capture(); cameraKind = null;
      if (capturedEpoch !== viewEpoch) return;
      await workflow.select(kind,result.blob,{source:'camera',deliberate:true,
        cleanup:result.cleanup,captureProof:result.captureProof});
    }).then(() => {
      if (kind && capturedEpoch === viewEpoch && has(kind)) $(kind === 'document_front' ? '#document-next' : '#face-next').focus();
    });
  });
  $('#document-file').addEventListener('change', event => {
    const blob = event.target.files?.[0]; event.target.value = '';
    if (blob) run(() => workflow.select('document_front', blob, {source:'file',deliberate:true}));
  });
  $('#document-remove').addEventListener('click', () => {
    const capturedEpoch = viewEpoch;
    run(() => workflow.remove('document_front')).then(() => {
      if (capturedEpoch === viewEpoch && route === 'identity/document' && !has('document_front') && !$('#document-camera-start').disabled) {
        $('#document-camera-start').focus({preventScroll:false});
      }
    });
  });
  $('#face-remove').addEventListener('click', () => run(async () => {
    stopCamera(); workflow.resetGuidance(); await acquireCamera('face_front');
  }).then(focusCamera));
  for (const id of ['retake-document','retake-face']) $('#'+id).addEventListener('click', () => {
    const capturedEpoch = viewEpoch;
    run(async go => {
      stopCamera();
      if (id === 'retake-face') workflow.resetGuidance();
      await workflow.remove(id === 'retake-face' ? 'face_front' : 'document_front');
      if (capturedEpoch !== viewEpoch || document.hidden) return;
      await go(id === 'retake-face' ? 'identity/face' : 'identity/document');
      if (id === 'retake-face') await acquireCamera('face_front');
    }).then(focusCamera);
  });
  $('#face-next').addEventListener('click', () => run(async go => {
    await workflow.review({deliberate:true}); await go('identity/review');
  }));
  const openIdentityNotice = () => {
    const value = workflow.snapshot();
    if (route === 'identity/review' && !busy && identityNotice && !value.submission && value.status === 'reviewed') navigate('identity/notice');
  };
  $('#identity-notice-link').addEventListener('click',openIdentityNotice);
  $('#identity-notice-reviewed').addEventListener('click',event => {
    event.preventDefault();
    $('#identity-notice-reviewed').checked = workflow.snapshot().notice_accepted;
    openIdentityNotice();
  });
  $('#identity-notice-accept').addEventListener('change',event => {
    if (route !== 'identity/notice' || busy || !identityNotice) { update(); return; }
    if (!event.target.checked) { workflow.clearNoticeAcceptance(); return; }
    const capturedEpoch = viewEpoch;
    run(async () => {
      await workflow.acceptNotice(identityNotice,{deliberate:true});
      if (capturedEpoch === viewEpoch && !document.hidden) closeIdentityNotice();
    });
  });
  $('#enrollment-finish').addEventListener('click', () => run(async (go,announce) => {
    if (workflow.snapshot().status === 'outcome_unknown') {
      await workflow.checkSubmission();
      if (!workflow.snapshot().submitted) { announce('Submission is still unconfirmed. No new submission was sent.'); return; }
    } else {
      if (identityNotice?.available !== true) return;
      if (!workflow.snapshot().notice_accepted) { await go('identity/notice'); return; }
      try { await workflow.submit(identityNotice,{deliberate:true}); }
      catch (error) {
        if (error.definitely_not_submitted) {
          try { identityNotice = await account.getIdentityNotice(); } catch { identityNotice = null; }
        }
        throw error;
      }
    }
    await go('identity/status');
  }));
  const discard = () => { stopCamera(); workflow.cancel(); clearSecrets(); identityNotice = null; navigate('account/sign-in'); };
  $('#enrollment-delete').addEventListener('click', discard);
  const background = () => {
    reviewer.clear({preserveOperation:true}); reviewerView.clear();
    reviewPermissionStarted = false;
    if (route === 'reviewer/cases') void navigate('account/sign-in',true);
    passwordManager.cancel();
    stopCamera();
    if (route.startsWith('identity/') && route !== 'identity/setup') {
      workflow.cancel(); clearSecrets(); identityNotice = null; navigate('account/sign-in');
    }
  };
  document.addEventListener('visibilitychange', () => { setSettingsOpen(settingsOpen); if (document.hidden) background(); else update(); });
  for (const event of ['online','offline']) window.addEventListener(event, update);
  window.addEventListener('pageshow', () => {
    if (attestationTool.status().state === 'closed') attestationTool = createDeviceAttestationTool();
    setSettingsOpen($('#options-panel').open);
  });
  window.addEventListener('nonverba:camera-stop', background);
  window.addEventListener('pagehide', () => { reviewer.clear({preserveOperation:false}); reviewerView.clear(); setSettingsOpen(false); stopCamera(); workflow.cancel(); clearSecrets(); account.cancel(); account.discardSession(true); });
  update();
  connect().catch(() => {});
  return Object.freeze({guard,render,setSettingsOpen,restoreEmailStep});
}

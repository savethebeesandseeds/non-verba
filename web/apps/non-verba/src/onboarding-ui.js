// SPDX-License-Identifier: AGPL-3.0-only
import {createServiceAccountAdapter, passwordStrength} from './onboarding-account.js';
import {createAccountTransport} from './account-transport.js';
import {createRecoveryExport} from './recovery-export.js';
import {createDeviceAttestationTool} from './identity/device-attestation.js';
import {IdentityCaptureWorkflow, IDENTITY_CAPTURE_GUIDANCE} from './identity/identity-capture.js';
import {createEnrollmentCamera} from './identity/enrollment-camera.js';

export const ONBOARDING_VIEWS = Object.freeze({
  'identity/setup': ['Setup', 'Account and identity', 'An account first. Then your document and frontal photo.'],
  'account/create': ['', 'Create account', ''],
  'account/terms': ['', 'Account Terms', ''],
  'account/sign-in': ['', 'Sign in', ''],
  'account/confirm': ['Account · Local development', 'Confirm your email', 'One step before signing in.'],
  'account/ready': ['', 'Recovery codes', ''],
  'account/recover': ['Account · Local development', 'Recover your account', 'A recovery code and contact confirmation are both required.'],
  'account/delete': ['Account · Local development', 'Delete test account', 'Restart setup with a new account using the same email.'],
  'account/devices': ['', 'Devices', ''],
  'identity/document': ['Identity · Capture', 'Your document', 'Start with the front of your identity document.'],
  'identity/face': ['Identity · Capture', 'Your frontal photo', 'Follow the guidance at your own pace.'],
  'identity/review': ['Identity · Capture', 'Does this look right?', 'Check your document and photo before finishing.'],
  'identity/status': ['Identity · Capture', 'Capture complete', 'Your photos have not been submitted or verified.']
});

export function startOnboarding(root, {navigate, closeTerms = () => navigate('account/create',true), setHeading = () => {}, enterEmailStep = () => {}, setStatusSources = () => {}, setRoleSetup = () => {}, workflowAccess, onAccountState = () => {}}) {
  if (typeof workflowAccess !== 'function') throw new Error('The participant workflow access policy is required.');
  const $ = selector => root.querySelector(selector);
  const screen = $('#onboarding-screen');
  let route = 'home', busy = false, viewEpoch = 0, actionNavigation = false, connecting = true, cameraKind = null;
  let signupMode = false;
  let account, workflow;
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
  workflow = new IdentityCaptureWorkflow({getAccount: options => account.getAccount(options),
    onChange: () => update()});
  const camera = createEnrollmentCamera({video:$('#enrollment-video'), onInterrupted: reason => {
    cameraKind = null; message(reason); update();
  }});
  const stage = $('#camera-stage');
  const stopCamera = () => { cameraKind = null; const stopped = camera.stop(); stage.hidden = true; return stopped; };
  const has = kind => workflow.snapshot().items.some(item => item.kind === kind);
  function resetCopy() {
    copyEpoch++; copyBusy = false;
    $('#sign-in-copy-status').hidden = true; $('#sign-in-copy-status').textContent = '';
    $('#sign-in-copy-fallback').hidden = true; $('#sign-in-copy-fallback').value = '';
  }
  function clearSecrets({preserveTerms = false} = {}) {
    recoveryExportEpoch++; recoveryExportController?.abort(); recoveryExportController = null; recoveryExport.cancel();
    for (const input of screen.querySelectorAll('input[type="password"], [data-secret]')) input.value = '';
    $('#sign-in-preview-code').textContent = ''; $('#sign-in-email-preview').open = false; renderCode();
    resetCopy();
    $('#recovery-code-display').hidden = true;
    $('#mock-mailbox').hidden = true;
    $('#recovery-download-status').textContent = ''; $('#recovery-download-status').hidden = true;
    $('#delete-deliberate').checked = false;
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
    if (candidate === 'account/devices' && state.state !== 'signed_in') return 'account/sign-in';
    if (candidate === 'account/confirm' && !['pending_confirmation','outcome_unknown'].includes(state.state)) return 'identity/setup';
    if (candidate === 'account/ready' && state.state !== 'confirmed' && !state.recovery_code_available) return 'identity/setup';
    if (candidate === 'account/delete' && state.state !== 'signed_in' && state.operation !== 'deletion') return 'identity/setup';
    if (state.deletion_pending && ['account/create','account/sign-in','account/recover'].includes(candidate)) return 'account/delete';
    if (candidate === 'account/create' && state.state === 'signed_in') return 'identity/setup';
    if (['account/create','account/terms'].includes(candidate) && state.entry?.step !== 'enrollment') return 'account/sign-in';
    if (!candidate.startsWith('identity/') || candidate === 'identity/setup') return candidate;
    if (state.state !== 'signed_in' || !value.binding) return 'identity/setup';
    if (value.status === 'cancelled') return 'identity/setup';
    if (candidate === 'identity/face' && !has('document_front')) return 'identity/document';
    if (candidate === 'identity/review' && (!has('document_front') || !has('face_front'))) return has('document_front') ? 'identity/face' : 'identity/document';
    if (candidate === 'identity/status' && value.status !== 'reviewed') return !has('document_front') ? 'identity/document' : !has('face_front') ? 'identity/face' : 'identity/review';
    return candidate;
  }
  function update() {
    if (!account || !workflow) return;
    const state = account.snapshot(), value = workflow.snapshot();
    const signedIn = state.state === 'signed_in', pending = state.state === 'pending_confirmation' || state.state === 'outcome_unknown' && state.operation === 'enrollment';
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
    $('#account-summary').textContent = signedIn ? `${state.email} · Local account` : state.session_outcome === 'unknown' ? 'Server sign-out or session result unconfirmed.' : '';
    $('#account-link-label').textContent = signedIn ? 'Account' : 'Sign in';
    $('#account-session-entry').hidden = !signedIn;
    $('#account-detail-email').textContent = signedIn ? state.email || '' : '';
    $('#account-detail-username').textContent = signedIn ? state.username ? `@${state.username}` : 'Not set' : '';
    const identityWarning = signedIn && state.identity_verification !== 'verified';
    $('#account-identity-warning').hidden = !identityWarning;
    $('#account-identity-needed').hidden = !identityWarning;
    if (identityWarning) $('#account-session-continue').setAttribute('aria-describedby','account-identity-needed');
    else $('#account-session-continue').removeAttribute('aria-describedby');
    $('#account-page-actions').hidden = !(signedIn || state.deletion_pending || state.session_outcome === 'unknown');
    const entry = state.entry;
    if (signedIn) signupMode = false;
    $('#account-email-form').hidden = signedIn || !!entry;
    $('#sign-in-identifier-label').textContent = signupMode ? 'Email' : 'Email or username';
    $('#sign-in-email').type = signupMode ? 'email' : 'text';
    $('#sign-in-email').inputMode = signupMode ? 'email' : 'text';
    $('#sign-in-email').autocomplete = signupMode ? 'email' : 'username';
    $('#sign-in-create-account').hidden = signedIn || signupMode || !!entry;
    $('#sign-in-create-account').disabled = busy;
    $('#sign-in-email-context').hidden = signedIn || !entry;
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
      const title = signedIn ? 'Account' : entry?.step === 'code' ? 'Confirm email' : signupMode && !entry ? 'Create account' : 'Sign in';
      setHeading(title,!signedIn && entry?.step === 'code' ? 'Confirm your email to continue.'
        : !signedIn && entry?.step === 'password' ? 'Enter your password.' : '',route);
      screen.setAttribute('aria-label',title);
    }
    $('#account-email').readOnly = true;
    $('#account-email').value = entry?.step === 'enrollment' ? entry.email : '';
    $('#account-session-continue').hidden = !signedIn;
    $('#account-session-continue').disabled = busy || !signedIn;
    $('#sign-in-service-status').hidden = signedIn || state.configured;
    $('#sign-in-service-status').textContent = connecting ? 'Connecting…' : 'Sign-in unavailable';
    $('#onboarding-notice').hidden = !route.startsWith('identity/');
    setRoleSetup(signedIn);
    $('#account-sign-out').hidden = !signedIn;
    $('#account-sign-out').disabled = busy || !signedIn;
    $('#account-delete-link').hidden = !state.deletion_pending && !(signedIn && state.email_delivery === 'mock');
    $('#account-delete-label').textContent = state.deletion_pending ? 'Check account deletion' : 'Delete account';
    $('#account-delete-link').disabled = busy;
    $('#account-discard-session').hidden = state.session_outcome !== 'unknown';
    $('#account-discard-session').disabled = busy;
    $('#account-entry-actions').hidden = signedIn || pending;
    $('#onboarding-confirm').hidden = !pending;
    $('#onboarding-account-title').textContent = signedIn ? 'Account signed in' : pending ? 'Confirm your email' : state.state === 'confirmed' ? 'Account confirmed' : 'Start with an account';
    $('#onboarding-account-summary').textContent = signedIn ? `${state.email} · Identity verification pending` : pending
      ? `${state.email} · Confirmation pending` : state.state === 'confirmed' ? 'Sign in with your confirmed email and password.' : 'An email and password account on the local development service.';
    const feedback = state.feedback || {api:'unknown',service:'unknown',keys:'signin_required'};
    $('#account-service-status').textContent = connecting || feedback.api === 'checking' || feedback.service === 'checking'
      ? 'Checking the local account service…' : feedback.api === 'unavailable' || feedback.service === 'unavailable'
      ? 'The local account service is unavailable. Open Settings to check its status.' : feedback.api === 'available' && feedback.service === 'ready'
      ? 'Local account service connected. Identity verification remains pending.' : state.configured
      ? 'Account service configuration loaded. Open Settings to check its current status. Identity verification remains pending.'
      : 'Local account service unavailable. Connect it before continuing.';
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
    const accountStatus = state.deletion_pending ? [busy ? 'pending' : 'unknown',busy ? 'Deleting the original test account' : 'Account deletion is unconfirmed']
      : state.session_outcome === 'unknown' ? ['warning','Account session result is unconfirmed']
      : signedIn ? ['success','Signed in to the local account'] : ['warning',pending ? 'Confirm your account' : 'Sign in before identity setup'];
    setStatusSources('settings', [
      {id:'settings-account',owner:'account',kind:accountStatus[0],message:accountStatus[1]},
      {id:'settings-api',owner:'api',kind:api[0],message:api[1]},
      {id:'settings-service',owner:'services',kind:service[0],message:service[1]},
      {id:'settings-network',owner:'network',kind:network[0],message:online === false ? 'Device reports no network connection' : 'Device network status does not confirm internet access'}
    ]);
    const realEmail = state.real_email_enabled === true, mockEmail = state.email_delivery === 'mock';
    $('#onboarding-notice').textContent = `Local development · ${mockEmail ? 'Email is mocked; use an example.invalid test contact. Nothing is sent.' : realEmail ? 'Email confirmation is configured.' : 'Email delivery is not configured; use an example.invalid test contact.'} Document and face photos stay only in this open page. Nothing is uploaded or verified.`;
    $('#mock-email-controls').hidden = !mockEmail || !(route === 'account/confirm' && pending || route === 'account/recover' && state.operation === 'recovery');
    $('#account-mock-email').disabled = busy;
    $('#mock-use-code').disabled = busy || !$('#mock-confirmation-code').value;
    $('#confirmation-delivery').textContent = realEmail && !state.email?.endsWith('.invalid') && !state.email?.endsWith('.test')
      ? 'Check your email for the confirmation code. Delivery may take a few minutes. The app cannot retrieve it.'
      : mockEmail ? 'Open the mock email below to get the code for this test enrollment. No real email is sent.' : 'This contact uses the private test inbox. No email is delivered to a real mailbox. The app cannot retrieve your code.';
    $('#recovery-delivery').textContent = mockEmail ? 'Open the mock email to get the recovery confirmation code. No real email is sent.' : realEmail ? 'Check your email for the recovery confirmation code. The app cannot retrieve it.' : 'Email delivery is not configured. Use the private test confirmation code for this operation.';
    $('#account-email').placeholder = realEmail ? 'you@example.com' : 'you@example.invalid';
    $('#account-connect').disabled = busy || connecting;
    $('#create-account').disabled = busy || !state.configured;
    $('#onboarding-sign-in').disabled = busy || !state.configured;
    $('#confirmation-email').textContent = state.email || 'Local enrollment';
    $('#account-operation-state').textContent = state.operation_state === 'unknown' ? 'The last result is unknown. Check this same operation before retrying.' : `Enrollment: ${state.operation_state || 'pending'}.`;
    const recovering = state.operation === 'recovery' && ['recovery_pending','outcome_unknown'].includes(state.state);
    $('#account-recovery-form').hidden = recovering;
    $('#account-recovery-pending').hidden = !recovering;
    const deleted = state.state === 'deleted' && state.operation === 'deletion';
    $('#account-delete-form').hidden = state.deletion_pending || deleted || !signedIn;
    $('#account-deletion-pending').hidden = !state.deletion_pending;
    $('#account-deletion-title').textContent = busy ? 'Deleting test account…' : 'Deletion not yet confirmed';
    $('#account-deletion-state').textContent = busy ? 'Waiting for the original deletion result.' : 'The last result is unknown. Check the original deletion before creating another account. Leaving this screen does not undo the request.';
    $('#account-deleted').hidden = !deleted;
    $('#delete-account-email').textContent = state.email || '';
    $('#account-delete-status').disabled = busy;
    $('#show-recovery-code').disabled = busy || !state.recovery_code_available;
    $('#download-recovery-codes').disabled = busy || !!recoveryExportController || !state.recovery_code_available;
    $('#enrollment-begin').disabled = busy || !signedIn;
    $('#enrollment-role').disabled = busy;
    for (const option of $('#enrollment-role').options) option.disabled = signedIn && !state.roles.includes(option.value === 'requester' ? 'R' : 'O');
    if (signedIn && $('#enrollment-role').selectedOptions[0]?.disabled) $('#enrollment-role').value = state.roles.includes('R') ? 'requester' : 'operator';
    if (!busy) $('#enrollment-processing').checked = value.consent.processing;
    const guided = value.guidance.complete || value.guidance.skipped;
    const capturing = camera.active();
    stage.hidden = !capturing;
    stage.dataset.kind = cameraKind || '';
    $('#camera-shutter').disabled = busy || !capturing || cameraKind === 'face_front' && !guided;
    $('#camera-shutter').textContent = cameraKind === 'document_front' ? 'Take document photo' : 'Take frontal photo';
    $('#camera-status').textContent = cameraKind === 'document_front' ? 'Rear camera · keep all document corners in view' : 'Front camera · only the final still will be taken';
    $('#document-camera-start').disabled = busy || capturing || !value.consent.processing;
    $('#document-file').disabled = busy || capturing || !value.consent.processing;
    $('#document-file-choice').hidden = !!window.NonverbaAccount?.postMessage;
    $('#face-camera-start').disabled = busy || capturing || !value.consent.processing;
    $('#document-remove').disabled = busy;
    $('#face-remove').disabled = busy;
    $('#document-next').disabled = busy || !has('document_front') || !value.consent.processing;
    $('#face-next').disabled = busy || !has('face_front') || !guided;
    $('#enrollment-processing').disabled = busy || capturing;
    $('#enrollment-review').disabled = busy || !has('document_front') || !has('face_front');
    $('#enrollment-review').textContent = value.status === 'reviewed' ? 'Photos confirmed' : 'Confirm these photos';
    $('#enrollment-finish').disabled = busy || value.status !== 'reviewed';
    $('#review-state').textContent = value.status === 'reviewed' ? 'These photos are confirmed in this page. They have not been saved or submitted.' : 'Changing either photo or consent requires a new confirmation.';
    for (const kind of ['document_front','face_front']) {
      const url = workflow.preview(kind);
      const image = $(kind === 'document_front' ? '#review-document' : '#review-face');
      const selected = $(kind === 'document_front' ? '#selected-document' : '#selected-face');
      $(kind === 'document_front' ? '#document-selection' : '#face-selection').hidden = !url;
      if (url) { if (image.getAttribute('src') !== url) image.src = url; if (selected.getAttribute('src') !== url) selected.src = url; }
      else { image.removeAttribute('src'); selected.removeAttribute('src'); }
    }
    const guidance = Math.min(value.guidance.index, 4), direction = IDENTITY_CAPTURE_GUIDANCE[guidance];
    $('#face-guide').dataset.direction = direction;
    $('#guidance-prompt').textContent = guided ? 'Face forward. Ready for a frontal photo.' : ({up:'Look up',down:'Look down',left:'Look to your left',right:'Look to your right',front:'Look straight ahead'})[direction];
    $('#guidance-position').textContent = guided ? `${value.guidance.skipped ? 'Guidance skipped' : 'Guidance complete'} · movement and liveness not checked` : `Guidance ${guidance + 1} of ${IDENTITY_CAPTURE_GUIDANCE.length} · no movement recording`;
    $('#guidance-next').disabled = busy || guided || !capturing;
    $('#guidance-skip').disabled = busy || guided || !capturing;
    $('#guidance-next').textContent = guidance === 4 ? 'Ready for frontal photo' : 'Next guidance step';
    $('#enrollment-delete').disabled = busy;
    $('#enrollment-cancel').hidden = !route.startsWith('identity/') || route === 'identity/setup' || value.status === 'cancelled';
    $('#enrollment-cancel').disabled = false;
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
    $('#account-delete-submit').disabled = busy || !signedIn || !$('#delete-deliberate').checked;
    screen.setAttribute('aria-busy', String(busy));
    renderCode();
    onAccountState(state);
    if (['account/create','account/terms'].includes(route) && state.configured && !termsAttempted) void loadTerms();
  }
  function render(next) {
    if (route !== next) {
      signupMode = false;
      if (route === 'account/ready') account.clearRecoveryCodes();
      viewEpoch++;
      deviceEpoch++; devicesBusy = false;
      stopCamera();
      if (route.startsWith('identity/') && route !== 'identity/setup' && !next.startsWith('identity/')) workflow.cancel();
      if (busy && !actionNavigation && route.startsWith('account/')) account.cancel();
      const reviewingTerms = route === 'account/create' && next === 'account/terms'
        || route === 'account/terms' && next === 'account/create';
      if (!reviewingTerms) {
        if (route === 'account/sign-in' && !(actionNavigation && next === 'account/create' && account.snapshot().entry?.step === 'enrollment')
          || route === 'account/create' || route === 'account/terms') account.resetEntry();
        clearSecrets();
      }
      message('');
    }
    route = next;
    const active = Object.hasOwn(ONBOARDING_VIEWS, next);
    screen.hidden = !active; screen.dataset.view = next;
    screen.setAttribute('aria-label', ONBOARDING_VIEWS[next]?.[1] || 'Account');
    for (const panel of screen.querySelectorAll('[data-onboarding-view]')) panel.hidden = panel.dataset.onboardingView !== next;
    update();
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
    await go('account/confirm');
  },validateSignup);
  const entryError = error => new Error(['email_invalid','username_invalid','identifier_invalid'].includes(error.code) ? 'Enter a valid email or username.'
    : error.code === 'confirmation_invalid' ? 'Enter all 8 code characters.' : 'Could not continue. Try again or go Back.');
  form('#account-email-form', async values => {
    workflow.cancel();
    try {
      if (signupMode) await account.startEntry({email:values['sign-in-email']});
      else await account.beginSignIn({identifier:values['sign-in-email']});
    }
    catch (error) { throw entryError(error); }
    if (route !== 'account/sign-in') return;
    const code = account.snapshot().entry?.step === 'code';
    enterEmailStep(code ? 'code' : 'password'); message('');
    (code ? codeInput : $('#sign-in-password')).focus();
  });
  $('#sign-in-create-account').addEventListener('click',() => {
    if (busy || route !== 'account/sign-in' || account.snapshot().state === 'signed_in') return;
    const identifier = $('#sign-in-email').value.trim();
    account.resetEntry(); signupMode = true; clearSecrets();
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
    const step = active === true ? entry?.step === 'code' ? 'code' : 'password' : active;
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
    catch (error) { throw new Error(['email_invalid','username_invalid','identifier_invalid'].includes(error.code) ? 'Enter a valid email or username.'
      : error.code === 'password_invalid' ? 'Enter your password.' : error.code === 'invalid_authorization'
      ? 'Check your email or username and password.' : 'Sign-in unavailable. Try again.'); }
    await go('home');
  });
  $('#account-session-continue').addEventListener('click', () => run(async go => {
    try { await account.getAccount(); }
    catch { throw new Error('Please sign in again.'); }
    await go('identity/setup');
  }));
  form('#account-confirm-form', async (values, go) => { await account.confirm({code:values['account-confirm-code'],deliberate:values['account-confirm-deliberate']}); await go('account/ready'); });
  form('#account-recovery-form', async (values, go, announce) => {
    workflow.cancel(); await account.startRecovery({email:values['recovery-email'],recoveryCode:values['recovery-code']});
    announce(account.snapshot().email_delivery === 'mock' ? 'Recovery confirmation is pending. Open the mock email for your test code.' : account.snapshot().real_email_enabled ? 'Recovery confirmation is pending. Check your email for the code.' : 'Recovery confirmation is pending in the private test inbox. Email delivery is not configured.');
  });
  form('#account-recovery-finish-form', async (values, go) => {
    workflow.cancel(); await account.recover({code:values['recovery-contact-code'],newPassword:values['recovery-new-password'],deliberate:values['recovery-finish-deliberate']}); await go('account/ready');
  });
  form('#account-delete-form', async values => {
    stopCamera(); workflow.cancel();
    await account.deleteAccount({password:values['delete-password'],confirmEmail:values['delete-confirm-email'],deliberate:values['delete-deliberate']});
  });
  $('#account-delete-form').addEventListener('input', event => { if (event.target.id !== 'delete-deliberate') $('#delete-deliberate').checked = false; update(); });
  $('#delete-deliberate').addEventListener('change', update);
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
    stopCamera(); workflow.cancel(); clearSecrets(); account.discardSession(); await navigate('account/sign-in'); message('The local session was forgotten. Server revocation and stopped work could not be confirmed.');
  });
  async function connect() {
    connecting = true; update();
    try { if (!await transport.available()) throw new Error('Local account service unavailable.'); await account.configure(); }
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
  $('#enrollment-begin').addEventListener('click', () => run(async go => {
    stopCamera(); await workflow.begin($('#enrollment-role').value);
    await go('identity/document');
  }));
  $('#enrollment-processing').addEventListener('change', event => {
    const processing = event.target.checked;
    if (!processing) stopCamera();
    run(() => workflow.setProcessingConsent(processing));
  });
  function startCamera(kind) {
    run(async () => {
      const capturedEpoch = viewEpoch;
      await workflow.validate();
      if (capturedEpoch !== viewEpoch || document.hidden) return;
      cameraKind = kind;
      $(kind === 'document_front' ? '#document-camera-slot' : '#face-camera-slot').append(stage);
      stage.hidden = false;
      try { await camera.start(kind); }
      catch (error) { stopCamera(); throw error; }
      if (capturedEpoch !== viewEpoch) { stopCamera(); return; }
      update(); $('#camera-shutter').focus({preventScroll:false});
    });
  }
  $('#document-camera-start').addEventListener('click', () => startCamera('document_front'));
  $('#face-camera-start').addEventListener('click', () => startCamera('face_front'));
  $('#camera-stop').addEventListener('click', () => { stopCamera(); update(); });
  $('#camera-shutter').addEventListener('click', () => run(async () => {
    const kind = cameraKind, capturedEpoch = viewEpoch;
    if (!kind || kind === 'face_front' && !workflow.snapshot().guidance.complete && !workflow.snapshot().guidance.skipped) return;
    const blob = await camera.capture(); cameraKind = null;
    if (capturedEpoch !== viewEpoch) return;
    await workflow.select(kind, blob, {source:'camera',deliberate:true,cleanup:'stopped'});
    if (capturedEpoch === viewEpoch) { update(); $(kind === 'document_front' ? '#document-next' : '#face-next').focus(); }
  }));
  $('#document-file').addEventListener('change', event => {
    const blob = event.target.files?.[0]; event.target.value = '';
    if (blob) run(() => workflow.select('document_front', blob, {source:'file',deliberate:true}));
  });
  $('#guidance-next').addEventListener('click', () => run(() => {
    const value = workflow.snapshot();
    return workflow.setGuidance(IDENTITY_CAPTURE_GUIDANCE[value.guidance.index]);
  }));
  $('#guidance-skip').addEventListener('click', () => run(() => workflow.setGuidance('skipped')));
  for (const [id,kind] of [['document-remove','document_front'],['face-remove','face_front']]) $('#'+id).addEventListener('click', () => run(() => workflow.remove(kind)));
  for (const id of ['retake-document','retake-face']) $('#'+id).addEventListener('click', () => {
    run(async go => {
      stopCamera();
      if (id === 'retake-face') workflow.resetGuidance();
      await workflow.remove(id === 'retake-face' ? 'face_front' : 'document_front');
      await go(id === 'retake-face' ? 'identity/face' : 'identity/document');
    });
  });
  $('#enrollment-review').addEventListener('click', () => run(() => workflow.review({deliberate:true})));
  $('#enrollment-finish').addEventListener('click', () => run(async go => { await workflow.validate(); await go('identity/status'); }));
  const discard = () => { stopCamera(); workflow.cancel(); clearSecrets(); navigate('identity/setup'); };
  $('#enrollment-delete').addEventListener('click', discard);
  $('#enrollment-cancel').addEventListener('click', discard);
  const background = () => {
    stopCamera();
    if (route.startsWith('identity/') && route !== 'identity/setup') {
      workflow.cancel(); clearSecrets(); navigate('identity/setup');
    }
  };
  document.addEventListener('visibilitychange', () => { setSettingsOpen(settingsOpen); if (document.hidden) background(); });
  for (const event of ['online','offline']) window.addEventListener(event, update);
  window.addEventListener('pageshow', () => {
    if (attestationTool.status().state === 'closed') attestationTool = createDeviceAttestationTool();
    setSettingsOpen($('#options-panel').open);
  });
  window.addEventListener('nonverba:camera-stop', background);
  window.addEventListener('pagehide', () => { setSettingsOpen(false); stopCamera(); workflow.cancel(); clearSecrets(); account.cancel(); account.discardSession(); });
  update();
  connect().catch(() => {});
  return Object.freeze({guard,render,setSettingsOpen,restoreEmailStep});
}

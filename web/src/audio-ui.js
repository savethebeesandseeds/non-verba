// SPDX-License-Identifier: AGPL-3.0-only
import {createCoreClient} from './core-client.js';
import {AudioCapture} from './audio-capture.js';
import {AudioSession} from './audio-controller.js';
import {NativeAudioCapture, nativeAudioPlatform, nativeAudioDiagnosticRows} from './audio-platform.js';
import {AudioPeer} from './audio-peer.js';
import {PairingFileImport} from './pairing-import.js';
import {AudioDemoRequester} from './audio-demo.js';
import {AudioEvidenceSession, audioHints, audioPairingId, authenticateAudioSession, verifyFinalAudioReceipt, verifyExportedAudioSession} from './audio-session.js';
import {loadIdentity, saveIdentity, reserveCapture, read} from './storage.js';
import {retainReceipt, latestReceipt} from './audio-receipts.js';
import {newRequestPreset, installRequestPresetSummary} from './request-presets.js';

const $ = id => document.getElementById(id);
const engine = createCoreClient();
const now = () => Math.floor(Date.now() / 1000);
const json = value => JSON.stringify(value, null, 2);
const PIN = /^[0-9a-f]{64}$/;
let identity, session = null, receipt = null, wav = null, report = null, playback = null, verificationRevision = 0;
let offerExport = null, answerExport = null;
let lastNativeDiagnostics = null;
let pairingIntent = 0, pairingBusy = false, acceptanceRevision = 0;
const busyButtons = new Set();
const answerPicker = new PairingFileImport({current:()=>session?.answerImport, cancel:reason=>{pairingIntent++;pairingBusy=false;if(session)fail(session,new Error(reason));updateButtons();}});
function intentCurrent(token) { if (token !== pairingIntent) throw new Error('Pairing operation cancelled.'); }

function notice(message, error = false) { $('audio-notice').hidden = false; $('audio-notice').textContent = message; $('audio-notice').className = `notice ${error ? 'error' : ''}`; }
function status(message) { $('audio-status').textContent = message; }
function current(s) { if (session !== s || s.cancelled) throw new Error('This audio session was cancelled.'); }
function run(id, callback) {
  $(id).addEventListener('click', async () => {
    if ($(id).disabled) return;
    const pairing = ['audio-create', 'audio-join', 'audio-demo'].includes(id), token = pairing ? ++pairingIntent : null;
    if (pairing) pairingBusy = true;
    busyButtons.add(id); $(id).setAttribute('aria-busy', 'true'); $('audio-notice').hidden = true; updateButtons();
    try { await callback(token); } catch (error) { if (!pairing || token === pairingIntent) notice(String(error?.message || error), true); }
    finally { if (pairing && token === pairingIntent) pairingBusy = false; busyButtons.delete(id); $(id).removeAttribute('aria-busy'); updateButtons(); }
  });
}
function updateButtons() {
  const s = session;
  $('audio-create').disabled = pairingBusy || !!s && !['done', 'failed'].includes(s.phase);
  $('audio-join').disabled = pairingBusy || !!s && !['done', 'failed'].includes(s.phase);
  $('audio-demo').disabled = pairingBusy || !!s && !['done', 'failed'].includes(s.phase);
  $('audio-connect').disabled = s?.role !== 'requester' || s.phase !== 'pairing';
  $('audio-answer-file').disabled = pairingBusy || s?.role !== 'requester' || s.phase !== 'pairing';
  $('audio-start').disabled = s?.role !== 'requester' || s.phase !== 'ready';
  $('audio-arm').disabled = s?.role !== 'operator' || s.phase !== 'connected';
  $('audio-cancel').disabled = !busyButtons.has('audio-accept') && !pairingBusy && (!s || ['done', 'failed'].includes(s.phase));
  $('audio-save-offer').disabled = !offerExport;
  $('audio-save-answer').disabled = !answerExport;
  $('audio-save-transcript').disabled = !receipt;
  $('audio-save-report').disabled = !report;
  $('audio-save-diagnostics').disabled = !lastNativeDiagnostics;
  $('audio-save-device').disabled = !identity;
  $('audio-save-wav').disabled = s?.role !== 'operator' || s.phase !== 'done' || !wav;
  $('audio-save-demo-receipt').disabled = !s?.demoReceipt || !wav;
  const witnessed = s?.role === 'requester' && s.phase === 'done' && !!s.finalBundle;
  $('audio-save-session').disabled = !witnessed;
  $('audio-save-received-wav').disabled = !witnessed || !wav;
  $('audio-accept').disabled = !witnessed || !!s?.accepted;
  $('audio-verify-button').disabled = false;
  for (const id of busyButtons) $(id).disabled = true;
}
function clearSession() {
  answerPicker.clear();acceptanceRevision++;
  if (session) { session.close(); retainNativeDiagnostics(session); }
  session = null; updateButtons();
}
function retainNativeDiagnostics(s) {
  if (!s.nativeCapture) return;
  const diagnostic = s.capture?.diagnostics();
  const error = s.capture?.diagnosticsError();
  if (error) {
    $('audio-native-diagnostic-error').textContent = `Diagnostics unavailable for native attempt ${s.capture.id}: ${error}`;
    $('audio-native-diagnostic-error').hidden = false; $('audio-native-diagnostics').hidden = false; $('audio-native-diagnostics').open = true;
  }
  if (!diagnostic) return;
  $('audio-native-diagnostic-error').hidden = true;
  lastNativeDiagnostics = diagnostic;
  $('audio-native-diagnostic-rows').replaceChildren();
  for (const [index, text] of nativeAudioDiagnosticRows(diagnostic).entries()) {
    const row = document.createElement('p'); row.id = `audio-native-diagnostic-row-${index}`; row.className = 'fineprint'; row.textContent = text;
    $('audio-native-diagnostic-rows').append(row);
  }
  $('audio-native-diagnostics').hidden = false; $('audio-native-diagnostics').open = true;
}
function fail(s, error, inform = true) { if (session === s) s.fail(error, inform); }
function renderFailure(s, error) {
  if (session !== s) return;
  answerPicker.clear(); retainNativeDiagnostics(s); wav = null; receipt = null;
  $('audio-result').hidden = true; $('audio-session-result').hidden = true; $('audio-session-report').textContent = '';
  $('audio-playback').pause();
  if (playback) URL.revokeObjectURL(playback); playback = null; $('audio-playback').removeAttribute('src'); $('audio-playback').load();
  notice(String(error?.message || error), true); updateButtons();
}
function renderCompletion(s, result) {
  if (session !== s || s.cancelled) return;
  if (result.role === 'requester') {
    wav = result.bytes;
    $('audio-session-result').hidden = false;
    $('audio-session-verdict').textContent = 'Final WAV received and verified. Ready for local acceptance.';
    $('audio-session-report').textContent = json(result.report);
  } else {
    $('audio-result').hidden = !!result.awaitingReceipt;
    if (wav !== result.bytes) {
      wav = result.bytes;
      $('audio-result-description').textContent = s.demo ? '4 seconds · 2 acoustic challenges · local signature verified. Requester and operator are this same device; this is demo evidence.' : s.request.duration_secs + ' seconds · ' + s.challenges.length + ' acoustic challenges · original PCM audio';
      $('audio-save-demo-receipt').hidden = !s.demo;
      playback = URL.createObjectURL(new Blob([wav], {type: 'audio/wav'})); $('audio-playback').src = playback;
    }
  }
  updateButtons();
}
function newSession(role, request, demo = false, config = {}) {
  clearSession();
  wav = null; receipt = null; $('audio-result').hidden = true;
  $('audio-session-result').hidden = true; $('audio-session-report').textContent = '';
  $('audio-playback').pause();
  if (playback) URL.revokeObjectURL(playback); playback = null; $('audio-playback').removeAttribute('src'); $('audio-playback').load();
  let s;
  s = new AudioSession({role, request, demo, ...config, engine, identity: () => identity,
    nativePlatform: () => nativeAudioPlatform(), captureFactory: onFailure => new AudioCapture(onFailure),
    nativeCaptureFactory: (native, request, onFailure) => new NativeAudioCapture(native, request, onFailure),
    peerFactory: callbacks => new AudioPeer(callbacks.onMessage, callbacks.onChunk, callbacks.onFailure,
      callbacks.onConnected, callbacks.authorizeChunk, callbacks.onArtifact, callbacks.authorizeArtifact),
    demoPeerFactory: options => new AudioDemoRequester(options),
    evidenceFactory: (engine, pin, hints) => new AudioEvidenceSession(engine, pin, hints),
    persistence: {readCapture: key => read('captures', key), reserveCapture, retainReceipt},
    authenticate: authenticateAudioSession, verifyFinalReceipt: verifyFinalAudioReceipt,
    lifecycle: {hidden: () => document.hidden, current: () => session === s},
    onState: ({detail}) => { if (session !== s) return; if (detail) status(detail); updateButtons(); },
    onReceipt: value => { current(s); receipt = value; }, onComplete: result => renderCompletion(s, result),
    onFailure: error => renderFailure(s, error), onVerification: renderVerification,
    onNotice: message => notice(message), onConnected: () => answerPicker.clear()});
  session = s;
  $('audio-demo-active').hidden = !demo;
  $('audio-operator-pairing').hidden = demo;
  $('audio-operator').classList.toggle('local-demo', demo);
  $('audio-arm').textContent = demo ? 'Start demo recording' : 'Enable microphone & test speaker';
  $('audio-result-title').textContent = demo ? 'Demo recording ready.' : 'Signed recording ready.';
  $('audio-save-demo-receipt').hidden = true;
  updateButtons(); return s;
}
function showView(name) {
  for (const view of document.querySelectorAll('.audio-view')) view.hidden = view.id !== `audio-${name}`;
  for (const item of document.querySelectorAll('[data-audio-view]')) item.dataset.audioView === name ? item.setAttribute('aria-current', 'page') : item.removeAttribute('aria-current');
}
async function localIdentity() {
  const native = nativeAudioPlatform(false);
  if (native) {
    identity = json({fingerprint: native.fingerprint, native: true});
    $('audio-device-id').textContent = native.fingerprint; updateButtons(); return identity;
  }
  if (identity) return identity;
  const provision = async () => { let value = await loadIdentity(); if (!value) { value = await engine.call('create_identity'); await saveIdentity(value); } return value; };
  identity = navigator.locks ? await navigator.locks.request('nonverba-signing-identity', provision) : await provision();
  $('audio-device-id').textContent = JSON.parse(identity).fingerprint; updateButtons(); return identity;
}
async function save(name, mime, bytes) {
  if (typeof bytes === 'string') bytes = new TextEncoder().encode(bytes);
  if (window.NativeVault) {
    let binary = ''; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    if (!window.NativeVault.saveArtifact(name, mime, btoa(binary))) throw new Error('Android could not export this artifact.');
  } else {
    const url = URL.createObjectURL(new Blob([bytes], {type: mime})), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
function parsed(text, limit = 160000) { if (!text || text.length > limit) throw new Error('JSON is missing or too large.'); return JSON.parse(text); }
function expectPin(value) { const pin = value.trim().toLowerCase(); if (!PIN.test(pin)) throw new Error('Supply the operator’s 64-character device ID from a trusted channel.'); return pin; }

run('audio-demo', async token => {
  const request = await engine.json('create_audio_demo_request', now()); intentCurrent(token);
  await localIdentity(); intentCurrent(token);
  newSession('operator', request, true);
  $('audio-operator-task').textContent = 'Local demo · 4 seconds · microphone and speaker';
  showView('operator');
  status('Demo ready. Start the recording below; no operator ID or pairing is needed.');
  notice('This device acts as both requester and operator. The microphone, acoustic checks, and signature are real; the recording is labelled as a local demo.');
});

run('audio-create', async token => {
  const pin = expectPin($('audio-operator-pin').value);
  const hints = audioHints({requester:$('audio-requester-name').value, task:$('audio-task').value,
    ...newRequestPreset('audio',{duration_secs:Number($('audio-duration').value),assurance:$('audio-assurance').value})});
  const s = newSession('requester', null, false, {pin, hints, pairingId: audioPairingId()});
  receipt = null; offerExport = null; answerExport = null;
  status('Preparing a local-network pairing offer…');
  try {
    offerExport = await s.offer(); intentCurrent(token); current(s);
    $('audio-requester-id').textContent = s.requesterPin;
    $('audio-offer').value = json(offerExport); status('Offer ready. Send it to the operator and import their answer.');
  } catch (error) { fail(s, error); }
});
run('audio-join', async token => {
  const input = parsed($('audio-offer-input').value);
  if (input.version !== 2 || input.type !== 'nonverba-audio-offer' || !PIN.test(input.pairing_id)) throw new Error('Choose a current Non-verba audio pairing offer.');
  const requesterPin = $('audio-requester-pin').value.trim().toLowerCase();
  if (!PIN.test(requesterPin) || requesterPin !== input.requester_pin) throw new Error('The requester SPKI ID must match the ID received through your trusted channel.');
  const hints = audioHints(input.hints);
  if(hints.assurance==='android-monitored'&&!nativeAudioPlatform())throw new Error('This offer requires Android monitored recording; this operator cannot provide it.');
  intentCurrent(token); await localIdentity(); intentCurrent(token);
  const operatorPin = JSON.parse(identity).fingerprint;
  if (input.operator_pin !== operatorPin) throw new Error('This offer is addressed to a different operator signing identity.');
  const s = newSession('operator', null, false, {requesterPin, pin: operatorPin, hints, pairingId: input.pairing_id}); answerExport = null;
  $('audio-operator-task').textContent = `${hints.task} · ${hints.duration_secs} seconds · ${hints.assurance === 'android-monitored' ? 'Android monitored recording required' : 'Browser or Android'}`;
  status('Preparing the pairing answer…');
  try {
    answerExport = await s.join(input); current(s);
    $('audio-answer').value = json(answerExport); status('Answer ready. Return it to the requester.');
  } catch (error) { fail(s, error); }
});
run('audio-connect', async () => {
  const s = session, answer = parsed($('audio-answer-input').value);
  answerPicker.clear(); await s.answer(answer);
});
run('audio-arm', () => session.arm());
run('audio-start', () => session.start());
function pause() {
  if (answerPicker.permitsPause()) return;
  answerPicker.clear();acceptanceRevision++;
  if (pairingBusy) { pairingIntent++; pairingBusy = false; if (session) fail(session, new Error('Pairing stopped because the app left the foreground.')); updateButtons(); }
  const s = session;
  if (s) s.suspend();
}
document.addEventListener('visibilitychange', () => {
  // The native controller starts no audio until its own initial OS permission
  // returns. Activity.onStop still cancels if the app actually goes background.
  if (document.hidden && !(session?.nativeCapture && session.phase === 'testing' && session.capture?.permissionPending())) pause();
});
window.addEventListener('nonverba:pause', pause); window.addEventListener('pagehide', () => { pause(); clearSession(); });
run('audio-cancel', () => { acceptanceRevision++; pairingIntent++; pairingBusy = false; if (session?.phase === 'done') { clearSession(); $('audio-session-result').hidden = true; status('Acceptance cancelled. Retained evidence remains in the local ledger.'); } else if (session) fail(session, new Error('Session stopped. Create a fresh request to retry.')); else status('Pairing cancelled.'); });
for (const tab of document.querySelectorAll('[data-audio-view]')) tab.addEventListener('click', () => {
  if (pairingBusy) { pairingIntent++; pairingBusy = false; if (session) fail(session, new Error('Pairing cancelled after changing workspace.')); }
  pause();
  showView(tab.dataset.audioView);
});
run('audio-save-device', () => save('nonverba-device-id.json', 'application/json', json({fingerprint: JSON.parse(identity).fingerprint})));
run('audio-save-offer', () => save('nonverba-audio-offer.json', 'application/json', json(offerExport)));
run('audio-save-answer', () => save('nonverba-audio-answer.json', 'application/json', json(answerExport)));
run('audio-save-transcript', () => save(`nonverba-audio-receipt-${receipt.request.session_id.slice(0, 12)}.json`, 'application/json', json(receipt)));
run('audio-save-session', () => save(`nonverba-audio-session-${session.request.session_id.slice(0, 12)}.json`, 'application/json', json(session.finalBundle)));
run('audio-save-received-wav', () => save(`nonverba-audio-${session.request.session_id.slice(0, 12)}.wav`, 'audio/wav', wav));
run('audio-accept', async () => {
  const s = session, revision = acceptanceRevision; current(s);
  const isCurrent = () => session === s && !s.cancelled && revision === acceptanceRevision && !document.hidden;
  await s.accept(isCurrent);
  if (!isCurrent()) throw new Error('Audio acceptance was cancelled.');
  $('audio-session-verdict').textContent = 'Accepted once in this requester’s local ledger.';
  $('audio-session-report').textContent = json({...s.evidence.result.report, acceptance:s.accepted}); updateButtons();
});
run('audio-save-wav', () => save(`nonverba-${session.demo ? 'demo-' : ''}audio-${session.request.session_id.slice(0, 12)}.wav`, 'audio/wav', wav));
run('audio-save-demo-receipt', () => save(`nonverba-demo-receipt-${session.request.session_id.slice(0, 12)}.json`, 'application/json', json(session.demoReceipt)));
run('audio-save-report', () => save(`nonverba-${report.demo ? 'demo-' : ''}audio-verification.json`, 'application/json', json(report)));
run('audio-save-diagnostics', () => save(`nonverba-audio-diagnostics-${lastNativeDiagnostics.session_id}.json`, 'application/json', json(lastNativeDiagnostics)));

function invalidate() { verificationRevision++; report = null; $('audio-verdict').textContent = 'Inputs changed. Verify this recording.'; $('audio-checks').replaceChildren(); $('audio-report-json').textContent = ''; $('audio-verification-note').textContent = ''; updateButtons(); }
$('audio-answer-file').addEventListener('click',()=>{try{answerPicker.begin();}catch(error){notice(error.message,true);}});
$('audio-answer-file').addEventListener('cancel',()=>answerPicker.clear());
window.addEventListener('nonverba:file-picker',event=>answerPicker.nativeEvent(event.detail?.active));
for (const [fileId, textId] of [['audio-offer-file', 'audio-offer-input'], ['audio-answer-file', 'audio-answer-input'], ['audio-original-file', 'audio-original']]) {
  $(fileId).addEventListener('change', async () => {
    const owner=session,token=pairingIntent;
    try { const file = $(fileId).files?.[0]; if (!file) return; if (file.size > 160000) throw new Error('JSON file is too large.');
      const value=await file.text();
      if(fileId==='audio-answer-file'){await answerPicker.foreground();intentCurrent(token);current(owner);answerPicker.clear();}
      $(textId).value=value;if(textId==='audio-original')invalidate();
    } catch (error) { if(fileId==='audio-answer-file')answerPicker.clear();notice(error.message,true); }
  });
}
for (const id of ['audio-original', 'audio-verify-pin', 'audio-verify-requester-pin']) $(id).addEventListener('input', invalidate);
$('audio-verify-file').addEventListener('change', () => { invalidate(); $('audio-verify-filename').textContent = $('audio-verify-file').files?.[0]?.name || 'Maximum 8 MiB'; });
run('audio-verify-button', async () => {
  invalidate(); const generation = verificationRevision;
  const original = parsed($('audio-original').value, 64000), file = $('audio-verify-file').files?.[0];
  const finalReceipt = original.type === 'nonverba-audio-session-evidence';
  const demoReceipt = original.type === 'nonverba-audio-demo-receipt';
  if (!finalReceipt && (original.version !== 1 || !['nonverba-audio-receipt', 'nonverba-audio-demo-receipt'].includes(original.type) || !!original.request?.demo !== demoReceipt)) throw new Error('Use the original requester receipt, or a clearly labelled local demo receipt.');
  if (!file || file.size > 8 * 1024 * 1024) throw new Error('Select a signed WAV under 8 MiB.');
  const pin = expectPin($('audio-verify-pin').value);
  $('audio-verdict').textContent = 'Checking signed audio and every acoustic challenge…';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = finalReceipt
    ? await verifyExportedAudioSession(engine, original, bytes, $('audio-verify-requester-pin').value.trim().toLowerCase(), pin)
    : await engine.json('verify_audio', bytes, json(original.request), json(original.transcript), pin, now());
  if (generation !== verificationRevision) return;
  renderVerification(result);
});
function renderVerification(result) {
  report = result; $('audio-checks').replaceChildren();
  const finalReceipt = result.type === 'nonverba-evidence-session-verification';
  $('audio-verdict').textContent = result.demo ? (result.verified ? 'Local demo checks passed.' : 'Local demo verification did not pass.') : (result.verified ? (finalReceipt ? 'Final WAV and requester receipt verified.' : 'Integrity and acoustic challenges verified.') : 'Verification did not pass.');
  const labels = {c2pa_integrity: 'C2PA signature and file integrity', request_match: 'Original requester request', transcript_match: 'Original live receipt', device_match: 'Expected operator device', recording_binding: 'Received audio segments', protocol_valid: 'Challenge sequence and deadlines', signal_detected: 'Acoustic challenge coverage', signing_time_valid: 'Signing time within request window'};
  for (const [key, passed] of Object.entries(result.checks)) {
    const row = document.createElement('div'); row.className = 'check-row'; const label = document.createElement('span'), value = document.createElement('strong');
    label.textContent = labels[key] || key; value.textContent = passed ? 'Pass' : 'Fail'; value.className = passed ? 'pass' : 'fail'; row.append(label, value); $('audio-checks').append(row);
  }
  $('audio-verification-note').textContent = result.demo ? 'DEMO: the requester and operator are this same device. The recording has no independent requester; these are local acoustic and integrity checks.' : result.verified ? (finalReceipt ? 'The requester signed receipt of these exact WAV bytes and their retained transcript. Imported verification does not record acceptance; physical sound freshness and requester independence remain unproven.' : 'The recording matches the requester’s received segments. Physical sound freshness and sensor origin remain unproven.') : result.errors.join(' ');
  $('audio-report-json').textContent = json(result); updateButtons();
}
engine.ready.then(async () => {
  $('audio-runtime').textContent = 'LOCAL ENGINE READY';
  try { await localIdentity(); } catch (error) { notice(`Operator signing identity unavailable: ${error.message}. Requester and verification tools remain available.`, true); }
  const saved = await latestReceipt();
  if (saved && !session && !receipt) { receipt = saved; $('audio-original').value = json(receipt); updateButtons(); }
}).catch(error => { $('audio-runtime').textContent = 'ENGINE UNAVAILABLE'; notice(error.message, true); });
installRequestPresetSummary(document,'audio','audio-request-preset-summary',['audio-duration','audio-assurance'],
  ()=>({duration_secs:Number($('audio-duration').value),assurance:$('audio-assurance').value}));
updateButtons();

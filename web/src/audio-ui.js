// SPDX-License-Identifier: AGPL-3.0-only
import {createCoreClient} from './core-client.js';
import {AudioCapture} from './audio-capture.js';
import {NativeAudioCapture, nativeAudioPlatform} from './audio-platform.js';
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
  if (session) { session.cancelled = true; clearTimeout(session.deadline); clearTimeout(session.watchdog); session.capture?.close(); session.peer?.close(); session.evidence?.close(); }
  session = null; updateButtons();
}
function fail(s, error, inform = true) {
  if (session !== s || s.cancelled || s.phase === 'failed') return;
  if (s.phase === 'done') { s.peer?.close(); return; }
  answerPicker.clear();
  if (inform) { try { s.peer.send({type: 'abort'}); } catch {} }
  clearTimeout(s.deadline); clearTimeout(s.watchdog); s.phase = 'failed'; s.cancelled = true;
  s.capture?.close(); s.peer?.close(); s.evidence?.close(); s.chunks = [];
  wav = null; receipt = null; s.finalBundle = null; s.operatorTranscript = null;
  $('audio-result').hidden = true; $('audio-session-result').hidden = true; $('audio-session-report').textContent = '';
  $('audio-playback').pause();
  if (playback) URL.revokeObjectURL(playback); playback = null; $('audio-playback').removeAttribute('src'); $('audio-playback').load();
  status('Session stopped. No requester-verified evidence was completed.'); notice(String(error?.message || error), true); updateButtons();
}
function queued(s, work) {
  s.queue = s.queue.then(async () => { current(s); await work(); }).catch(error => fail(s, error));
}
function newSession(role, request, demo = false) {
  clearSession();
  wav = null; receipt = null; $('audio-result').hidden = true;
  $('audio-session-result').hidden = true; $('audio-session-report').textContent = '';
  $('audio-playback').pause();
  if (playback) URL.revokeObjectURL(playback); playback = null; $('audio-playback').removeAttribute('src'); $('audio-playback').load();
  const s = {role, request, demo, phase: 'pairing', cancelled: false, queue: Promise.resolve(), rounds: [], challenges: [], chunks: [], expected: 0, messagePending: 0, chunkPending: false};
  session = s;
  $('audio-demo-active').hidden = !demo;
  $('audio-operator-pairing').hidden = demo;
  $('audio-operator').classList.toggle('local-demo', demo);
  $('audio-arm').textContent = demo ? 'Start demo recording' : 'Enable microphone & test speaker';
  $('audio-result-title').textContent = demo ? 'Demo recording ready.' : 'Signed recording ready.';
  $('audio-save-demo-receipt').hidden = true;
  const onMessage = message => {
      if (s.phase === 'done') { s.peer.close(); return; }
      if (++s.messagePending > 2) return fail(s, new Error('Too many pending live messages.'));
      queued(s, async () => { try { await handleMessage(s, message); } finally { s.messagePending--; } });
  };
  const onFailure = error => fail(s, error);
  s.peer = demo ? new AudioDemoRequester({engine, request, onMessage, onFailure, onReceipt: value => { current(s); s.demoReceipt = value; }}) : new AudioPeer(
    onMessage,
    (index, bytes) => { const arrived = performance.now(); queued(s, async () => { try { await receiveChunk(s, index, bytes, arrived); } finally { s.chunkPending = false; } }); },
    onFailure,
    () => {
      if (session !== s || s.cancelled) return;
      answerPicker.clear();clearTimeout(s.watchdog);
      s.phase = 'authenticating'; status(role === 'operator' ? 'Connected. Waiting for a fresh authenticated request.' : 'Connected. Creating and signing a fresh request.'); updateButtons();
      if (role === 'requester') queued(s, async () => {
        await s.evidence.start(message => {
          current(s); s.request = message.request.request; s.sessionEnvelope = message.envelope;
          s.peer.send({type:'session-request', pairing_id:s.pairingId, envelope:message.envelope});
        }); current(s); s.phase = 'connected';
        status('Fresh signed request sent. Waiting for the operator’s microphone test.'); updateButtons();
        s.watchdog = setTimeout(() => fail(s, new Error('The complete signed recording missed its three-minute response deadline.')), 180000);
      });
    },
    index => {
      if (session !== s || s.cancelled || s.role !== 'requester' || s.phase !== 'recording' || s.chunkPending || index !== s.expected || index !== s.pendingRound?.index) return false;
      s.chunkPending = true; return true;
    },
    bytes => receiveFinalWav(s, bytes),
    () => {
      if (session !== s || s.cancelled || s.role !== 'requester' || s.phase !== 'awaiting-wav' || s.artifactPending) return false;
      s.artifactPending = true; return true;
    }
  );
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
function elapsed(s, at = performance.now()) { return Math.max(0, Math.round(at - s.baseTime)); }
function checkLive(s) { current(s); if (document.hidden || !s.request || now() >= s.request.expires_at) throw new Error('The capture window expired or the screen was closed.'); }

run('audio-demo', async token => {
  const request = await engine.json('create_audio_demo_request', now()); intentCurrent(token);
  await localIdentity(); intentCurrent(token);
  const s = newSession('operator', request, true); s.phase = 'connected';
  $('audio-operator-task').textContent = 'Local demo · 4 seconds · microphone and speaker';
  showView('operator');
  status('Demo ready. Start the recording below; no operator ID or pairing is needed.');
  notice('This device acts as both requester and operator. The microphone, acoustic checks, and signature are real; the recording is labelled as a local demo.');
});

run('audio-create', async token => {
  const pin = expectPin($('audio-operator-pin').value);
  const hints = audioHints({requester:$('audio-requester-name').value, task:$('audio-task').value,
    ...newRequestPreset('audio',{duration_secs:Number($('audio-duration').value),assurance:$('audio-assurance').value})});
  const s = newSession('requester', null); s.pin = pin; s.hints = hints; s.pairingId = audioPairingId();
  s.evidence = new AudioEvidenceSession(engine, pin, hints);
  s.answerImport = {role:'requester',get phase(){return s.phase;},get connected(){return s.phase!=='pairing';},prepareAnswerImport:()=>s.evidence.prepareAnswerImport()};
  receipt = null; offerExport = null; answerExport = null;
  status('Preparing a local-network pairing offer…');
  try {
    const requesterPin = await s.evidence.identity(); intentCurrent(token); current(s);
    s.requesterPin = requesterPin; $('audio-requester-id').textContent = requesterPin;
    const description = await s.peer.description('offer'); current(s);
    offerExport = {version:2, type:'nonverba-audio-offer', pairing_id:s.pairingId, requester_pin:requesterPin,
      operator_pin:pin, hints, description};
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
  const s = newSession('operator', null); answerExport = null;
  Object.assign(s, {requesterPin, pin:operatorPin, hints, pairingId:input.pairing_id});
  $('audio-operator-task').textContent = `${hints.task} · ${hints.duration_secs} seconds · ${hints.assurance === 'android-monitored' ? 'Android monitored recording required' : 'Browser or Android'}`;
  status('Preparing the pairing answer…');
  try {
    const description = await s.peer.description('answer', input.description); current(s);
    answerExport = {version:2, type:'nonverba-audio-answer', pairing_id:s.pairingId, requester_pin:requesterPin, operator_pin:operatorPin, description};
    $('audio-answer').value = json(answerExport); status('Answer ready. Return it to the requester.');
  } catch (error) { fail(s, error); }
});
run('audio-connect', async () => {
  const s = session, answer = parsed($('audio-answer-input').value);
  if (answer.version !== 2 || answer.type !== 'nonverba-audio-answer' || answer.pairing_id !== s.pairingId
      || answer.requester_pin !== s.requesterPin || answer.operator_pin !== s.pin) throw new Error('The answer belongs to a different pairing or identity.');
  answerPicker.clear();await s.peer.answer(answer.description); current(s); status('Connecting. Both devices must be reachable on the same local network.');
  s.watchdog = setTimeout(() => { if (s.phase === 'pairing') fail(s, new Error('No direct route was found. Check local-network isolation; this preview has no relay service.')); }, 20000);
});
run('audio-arm', async () => {
  const s = session; current(s); s.phase = 'testing'; updateButtons(); status('Testing the microphone and high-frequency speaker path…');
  try {
    const native = nativeAudioPlatform();
    if (s.policy?.native_acquisition_required && !native) throw new Error('This requester requires Android monitored recording; browser capture is insufficient.');
    if (!s.demo && (native?.fingerprint || JSON.parse(identity).fingerprint) !== s.pin) throw new Error('The operator signing identity changed after pairing.');
    s.nativeCapture = !!native;
    if (native) {
      s.capture = new NativeAudioCapture(native, s.request, error => fail(s, error));
      await s.capture.open(); checkLive(s);
    } else {
    s.capture = new AudioCapture(error => fail(s, error));
    await s.capture.open(); checkLive(s);
    const pilot = await engine.json('create_audio_round', json(s.request), 0, now());
    const signal = await engine.call('audio_probe', pilot.session_id, pilot.index, pilot.nonce); checkLive(s);
    let samples;
    await s.capture.record(1, (_index, chunk) => { samples = chunk; }); checkLive(s); s.capture.play(signal);
    await Promise.race([s.capture.finished, new Promise((_, reject) => { s.deadline = setTimeout(() => reject(new Error('Microphone test timed out.')), 5000); })]);
    clearTimeout(s.deadline); checkLive(s);
    const detection = await engine.json('detect_audio_probe', samples, pilot.session_id, 0, pilot.nonce); checkLive(s);
    if (!detection.detected || detection.offset_samples > 38400) throw new Error('The high-frequency test was not recovered. Check the built-in speaker, media volume, and microphone. This device may not support the required band.');
    }
    await reserveCapture(`audio:${s.request.session_id}`, {kind: 'audio', at: now()}); checkLive(s);
    s.phase = 'ready'; s.peer.send({type: 'ready', fingerprint: JSON.parse(identity).fingerprint});
    status(s.demo ? 'Speaker test passed. Starting the local demo…' : 'Speaker test passed. Waiting for the requester to start. Microphone access is active.');
    clearTimeout(s.watchdog); s.watchdog = setTimeout(() => fail(s, new Error('Recording was not started within one minute. Request a fresh session.')), 60000);
  } catch (error) { fail(s, error); }
});

run('audio-start', async () => {
  const s = session; checkLive(s); s.phase = 'recording'; s.startedAt = now(); s.baseTime = performance.now(); updateButtons();
  try { await issueRound(s, 0); } catch (error) { fail(s, error); }
});
async function issueRound(s, index) {
  checkLive(s);
  // This is the only round generation site during a real session. A successor is
  // generated only from receiveChunk after the preceding microphone bytes arrived.
  const round = await engine.json('create_audio_round', json(s.request), index, now()); checkLive(s);
  if (index === 0) { s.startedAt = now(); s.baseTime = performance.now(); }
  s.pendingRound = {...round, issued_elapsed_ms: index === 0 ? 0 : elapsed(s)};
  s.peer.send({type: 'round', ...round});
  clearTimeout(s.deadline);
  s.deadline = setTimeout(() => fail(s, new Error('An audio segment missed its live receipt deadline. Request a new recording.')), s.request.round_deadline_ms + 50);
  status(`Recording ${s.request.duration_secs} seconds · challenge ${index + 1}/${s.request.duration_secs / 2} sent.`);
}
async function receiveChunk(s, index, bytes, arrived) {
  checkLive(s);
  if (s.role !== 'requester' || s.phase !== 'recording' || !s.pendingRound || index !== s.expected || index !== s.pendingRound.index) throw new Error('Unexpected, repeated, or out-of-order audio segment.');
  const received = elapsed(s, arrived), issued = s.pendingRound.issued_elapsed_ms;
  if (received < issued || received - issued > s.request.round_deadline_ms) throw new Error('The audio segment arrived after its deadline.');
  if (received < (index + 1) * 2000 - 100) throw new Error('Audio arrived too quickly to satisfy the requested continuous recording duration.');
  clearTimeout(s.deadline);
  const pcm = await engine.call('decode_audio_pcm', bytes);
  const hash = await engine.call('hash_audio_pcm', pcm); checkLive(s);
  s.rounds.push({index, nonce: s.pendingRound.nonce, issued_elapsed_ms: issued, received_elapsed_ms: received, pcm_sha256: hash, start_sample: index * 96000, sample_count: 96000});
  s.expected++; s.pendingRound = null;
  if (s.expected < s.request.duration_secs / 2) { await issueRound(s, s.expected); return; }
  s.phase = 'retaining';
  const transcript = {version: 1, session_id: s.request.session_id, started_at: s.startedAt, completed_at: now(), total_samples: s.request.duration_secs * 48000, rounds: s.rounds};
  const retained = {version: 1, type: 'nonverba-audio-receipt', request: s.request, transcript};
  await retainReceipt(retained); current(s); receipt = retained;
  // The independently retained requester record is the verifier's authority.
  s.evidence.retainTranscript(retained); current(s); s.phase = 'awaiting-wav';
  s.peer.send({type:'receipt', receipt});
  status('All audio segments retained. Waiting for the complete signed WAV before final verification.'); updateButtons();
}
function receiveFinalWav(s, bytes) {
  try {
    checkLive(s);
    if (s.role !== 'requester' || s.phase !== 'awaiting-wav' || !s.artifactPending) throw new Error('Unexpected final WAV.');
    s.phase = 'verifying-wav';
    const pending = s.evidence.receive(bytes); // Arrival is recorded here, before other asynchronous work.
    status('Final signed WAV received. Checking the file, retained audio transcript and requester policy…');
    pending.then(result => {
      current(s); clearTimeout(s.watchdog);
      wav = bytes; s.finalBundle = s.evidence.bundle(); s.phase = 'done';
      $('audio-session-result').hidden = false;
      $('audio-session-verdict').textContent = 'Final WAV received and verified. Ready for local acceptance.';
      $('audio-session-report').textContent = json(result.report);
      updateButtons();
      try { s.peer.send({type:'final-receipt', receipt:result.receipt}); }
      catch { notice('The WAV and requester receipt are verified and retained locally. The operator connection closed before the receipt could be returned.'); }
      s.watchdog = setTimeout(() => s.peer.close(), 30000);
      status('Complete signed WAV verified against the original request and retained microphone segments.'); updateButtons();
    }).catch(error => fail(s, error));
  } catch (error) { fail(s, error); }
}
async function handleMessage(s, message) {
  current(s);
  if (message.type === 'abort') { fail(s, new Error('The other participant stopped the session.'), false); return; }
  if (s.role === 'requester') {
    if (message.type === 'receipt-ack' && ['awaiting-wav', 'verifying-wav'].includes(s.phase) && !s.receiptAcknowledged) { s.receiptAcknowledged = true; return; }
    if (message.type !== 'ready' || s.phase !== 'connected' || message.fingerprint !== s.pin) throw new Error('Operator identity mismatch or unexpected ready message.');
    s.phase = 'ready'; status('Operator connected and speaker test passed. Ready to start.'); updateButtons(); return;
  }
  if (message.type === 'session-request') {
    if (s.demo || s.phase !== 'authenticating' || message.pairing_id !== s.pairingId) throw new Error('Unexpected or replayed signed audio request.');
    const payload = await authenticateAudioSession(engine, message.envelope, s.requesterPin, s.pin, s.hints); current(s);
    const consumed = await read('captures', `audio:${payload.spec.evidence.request.session_id}`); current(s);
    if (consumed) throw new Error('This request was already used on this device. Ask for a fresh request.');
    s.request = payload.spec.evidence.request; s.policy = payload.spec.policy; s.sessionEnvelope = message.envelope;
    if (s.policy.native_acquisition_required && !nativeAudioPlatform()) throw new Error('This request requires Android monitored recording. Browser capture cannot satisfy it.');
    s.phase = 'connected'; status('Fresh requester signature and task verified. Enable the microphone and test the speaker.'); updateButtons();
    s.watchdog = setTimeout(() => fail(s, new Error('The operator did not begin within the fresh request window.')), 60000); return;
  }
  if (message.type === 'final-receipt') {
    if (s.demo || s.phase !== 'awaiting-final-receipt' || !wav || !s.operatorTranscript) throw new Error('Unexpected final requester receipt.');
    await verifyFinalAudioReceipt(engine, message.receipt, s.sessionEnvelope, wav, s.operatorTranscript, s.requesterPin); checkLive(s);
    clearTimeout(s.watchdog); s.phase = 'done';
    $('audio-result').hidden = false;
    status('The requester received and verified this exact signed WAV.'); updateButtons();
    // The authenticated receipt already establishes completion. Its optional
    // transport acknowledgement cannot undo a verified result if the peer left.
    try { s.peer.send({type:'final-receipt-ack'}); } catch {}
    s.peer.close(); return;
  }
  if (message.type === 'round') {
    checkLive(s);
    const index = s.challenges.length;
    if (!['ready', 'recording'].includes(s.phase) || message.session_id !== s.request.session_id || message.index !== index || index >= s.request.duration_secs / 2 || !PIN.test(message.nonce) || s.challenges.some(round => round.nonce === message.nonce)) throw new Error('Invalid, repeated, or out-of-order requester challenge.');
    if (s.nativeCapture) {
      if (index === 0) {
        clearTimeout(s.watchdog); s.phase = 'recording';
        s.watchdog = setTimeout(() => fail(s, new Error('The requester did not complete the live session.')), s.request.duration_secs * 1000 + 7000);
      }
      s.challenges.push({index, nonce: message.nonce});
      s.capture.round(message, async (chunkIndex, bytes) => {
        checkLive(s);
        if (chunkIndex !== s.chunks.length || chunkIndex >= s.challenges.length) throw new Error('Native microphone segment has no matching live challenge.');
        // Retain only the completion count in JS. Native samples remain owned by AAudio.
        s.chunks.push(null);
        await s.peer.sendChunk(chunkIndex, bytes); checkLive(s);
      });
      status(`Recording continuously · challenge ${index + 1}/${s.request.duration_secs / 2} sent to the native speaker.`); updateButtons(); return;
    }
    const signal = await engine.call('audio_probe', message.session_id, index, message.nonce); checkLive(s);
    if (index === 0) {
      clearTimeout(s.watchdog); s.phase = 'recording';
      s.sendQueue = Promise.resolve();
      await s.capture.record(s.request.duration_secs / 2, (chunkIndex, samples) => {
        if (s.cancelled) return;
        s.chunks.push(samples);
        s.sendQueue = s.sendQueue.then(async () => {
          checkLive(s);
          if (chunkIndex >= s.challenges.length) throw new Error('No fresh challenge arrived for this audio segment.');
          const encoded = await engine.call('encode_audio_pcm', samples); checkLive(s); await s.peer.sendChunk(chunkIndex, encoded);
        }).catch(error => fail(s, error));
      });
      s.watchdog = setTimeout(() => fail(s, new Error('The requester did not complete the live session.')), s.request.duration_secs * 1000 + 7000);
    }
    const offset = s.capture.position() - index * 96000;
    if (offset < 0 || offset > 36000) throw new Error('The next challenge arrived too late for its continuous recording segment.');
    s.challenges.push({index, nonce: message.nonce}); s.capture.play(signal);
    status(`Recording continuously · challenge ${index + 1}/${s.request.duration_secs / 2} played.`); updateButtons(); return;
  }
  if (message.type === 'receipt') {
    checkLive(s);
    if (s.phase !== 'recording' || s.chunks.length !== s.request.duration_secs / 2 || s.challenges.length !== s.chunks.length) throw new Error('Recording is incomplete.');
    const received = message.receipt;
    const receiptType = s.demo ? 'nonverba-audio-demo-receipt' : 'nonverba-audio-receipt';
    if (received?.version !== 1 || received.type !== receiptType || json(received.request) !== json(s.request) || received.transcript?.rounds?.length !== s.challenges.length || received.transcript.rounds.some((round, i) => round.index !== i || round.nonce !== s.challenges[i].nonce)) throw new Error('The receipt does not match the live challenges.');
    s.peer.send({type:'receipt-ack'}); if (s.demo) s.peer.close();
    s.operatorTranscript = structuredClone(received.transcript);
    clearTimeout(s.watchdog); s.phase = 'signing'; status('Checking all challenge responses and signing the original WAV…');
    let bytes;
    if (s.nativeCapture) {
      bytes = await s.capture.finalize(received); checkLive(s); s.capture.close();
    } else {
      s.capture.close();
      const pcm = new Float32Array(s.request.duration_secs * 48000); s.chunks.forEach((chunk, i) => pcm.set(chunk, i * 96000));
      bytes = await engine.call('seal_audio', pcm, identity, json(s.request), json(received.transcript), now()); checkLive(s);
    }
    if (s.demo || s.nativeCapture) {
      const checked = await engine.json('verify_audio', bytes, json(s.request), json(received.transcript), JSON.parse(identity).fingerprint, now()); checkLive(s);
      if (!checked.verified || !!checked.demo !== s.demo || (s.nativeCapture && checked.checks.native_audio_metadata_valid !== true)) throw new Error('The recording did not pass local verification.');
      renderVerification(checked);
    }
    wav = bytes; s.phase = s.demo ? 'done' : 'awaiting-final-receipt'; s.chunks = []; $('audio-result').hidden = !s.demo;
    $('audio-result-description').textContent = s.demo ? '4 seconds · 2 acoustic challenges · local signature verified. Requester and operator are this same device; this is demo evidence.' : `${s.request.duration_secs} seconds · ${s.challenges.length} acoustic challenges · original PCM audio`;
    $('audio-save-demo-receipt').hidden = !s.demo;
    playback = URL.createObjectURL(new Blob([wav], {type: 'audio/wav'})); $('audio-playback').src = playback;
    if (!s.demo) {
      s.watchdog = setTimeout(() => fail(s, new Error('The requester did not verify the complete signed WAV before the delivery deadline.')), 30000);
      status('Delivering the final signed WAV and waiting for its verified requester receipt…');
      await s.peer.sendArtifact(bytes); checkLive(s);
    } else status('Demo complete. Acoustic challenges and signed WAV verified locally.');
    updateButtons(); return;
  }
  throw new Error('Unexpected live audio message.');
}

function pause() {
  if (answerPicker.permitsPause()) return;
  answerPicker.clear();acceptanceRevision++;
  if (pairingBusy) { pairingIntent++; pairingBusy = false; if (session) fail(session, new Error('Pairing stopped because the app left the foreground.')); updateButtons(); }
  const s = session;
  if (s && !['done', 'failed'].includes(s.phase)) fail(s, new Error('Session stopped because the app left the foreground.'));
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
  const accepted = await s.evidence.accept(isCurrent);
  if (!isCurrent()) throw new Error('Audio acceptance was cancelled.');
  s.accepted = accepted;
  $('audio-session-verdict').textContent = 'Accepted once in this requester’s local ledger.';
  $('audio-session-report').textContent = json({...s.evidence.result.report, acceptance:s.accepted}); updateButtons();
});
run('audio-save-wav', () => save(`nonverba-${session.demo ? 'demo-' : ''}audio-${session.request.session_id.slice(0, 12)}.wav`, 'audio/wav', wav));
run('audio-save-demo-receipt', () => save(`nonverba-demo-receipt-${session.request.session_id.slice(0, 12)}.json`, 'application/json', json(session.demoReceipt)));
run('audio-save-report', () => save(`nonverba-${report.demo ? 'demo-' : ''}audio-verification.json`, 'application/json', json(report)));

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

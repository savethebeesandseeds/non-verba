// SPDX-License-Identifier: AGPL-3.0-only
// Audio's transport/controller adapter. Rust owns request authentication,
// artifact verification and receipt signatures; AgentRequester owns arrival and
// atomic local acceptance. The demo deliberately does not enter this path.
import {AgentRequester} from './agent-requester.js';
const PIN = /^[0-9a-f]{64}$/;
export const AUDIO_CONTEXT = '{"version":1}';
export function audioHints(value) {
  if (!value || typeof value.requester !== 'string' || typeof value.task !== 'string'
      || !value.requester.trim() || value.requester.trim().length > 120 || !value.task.trim() || value.task.trim().length > 1000
      || ![4, 10, 20, 30].includes(value.duration_secs)
      || !['browser-or-android', 'android-monitored'].includes(value.assurance)) throw new Error('Provide a requester, task, supported duration and assurance policy.');
  return {requester:value.requester.trim(), task:value.task.trim(), duration_secs:value.duration_secs, assurance:value.assurance};
}
function audioPolicy(hints) {
  const monitored = hints.assurance === 'android-monitored';
  return {version:2, native_acquisition_required:monitored, audio_recording_monitoring_required:monitored,
    raw_gnss_required:false, correlated_camera_clock_required:false, hardware_attestation_required:false, independent_position_required:false};
}
function sameHints(request, hints) {
  return request.requester === hints.requester && request.task === hints.task && request.duration_secs === hints.duration_secs;
}
export function audioPairingId() { return [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join(''); }
export class AudioEvidenceSession {
  constructor(engine, operatorPin, hints) {
    if (!PIN.test(operatorPin)) throw new Error('An independently pinned operator identity is required.');
    this.engine = engine; this.operatorPin = operatorPin; this.hints = audioHints(hints);
    this.requester = new AgentRequester(engine); this.phase = 'paired';
  }
  async identity() {
    if (this.phase === 'cancelled' || document.hidden) throw new Error('The audio requester is no longer active.');
    this.requester ??= new AgentRequester(this.engine);
    const requester = this.requester, pin = await requester.identity();
    if (requester !== this.requester || this.phase === 'cancelled' || document.hidden) throw new Error('Audio pairing was cancelled during requester initialization.');
    if (this.requesterPin && this.requesterPin !== pin) throw new Error('The retained audio requester identity changed during pairing.');
    this.requesterPin = pin; return pin;
  }
  prepareAnswerImport() {
    if (this.phase !== 'paired' || this.request || !this.requesterPin || document.hidden) throw new Error('Only pre-challenge audio pairing can import an answer.');
    this.requester?.close(); this.requester = null;
  }
  async start(send) {
    if (this.phase !== 'paired') throw new Error('This audio evidence session has already started.');
    this.phase = 'starting';
    await this.identity();
    if (this.phase !== 'starting') throw new Error('Audio pairing changed before challenge creation.');
    const result = await this.requester.start(async (engine, at) => {
      const request = await engine.json('create_audio_request', this.hints.requester, this.hints.task, at, 900, this.hints.duration_secs);
      return {version:1, evidence:{type:'audio', request},
        operator_pins:{media_certificate_sha256:this.operatorPin, location_spki_sha256:null},
        policy:audioPolicy(this.hints),
        delivery:{max_response_ms:180000, max_receipt_age_ms:60000}};
    }, {contextJson:AUDIO_CONTEXT, send:message => {
      this.id = message.sessionId; this.originalRequest = message.envelope; this.request = message.request.request;
      this.phase = 'awaiting-transcript'; return send(message);
    }});
    this.requesterPin = result.requesterPin;
    return this.request;
  }
  retainTranscript(receipt) {
    if (this.phase !== 'awaiting-transcript' || receipt?.type !== 'nonverba-audio-receipt'
        || receipt.request.session_id !== this.request.session_id) throw new Error('Unexpected requester audio transcript.');
    this.audioReceipt = structuredClone(receipt);
    this.requester.retainAudioTranscript(this.id, JSON.stringify(this.audioReceipt.transcript));
    this.phase = 'awaiting-wav';
  }
  receive(bytes) {
    if (this.phase !== 'awaiting-wav') throw new Error('Unexpected or repeated final audio evidence.');
    this.phase = 'verifying';
    // Call immediately on completed transport delivery. Never queue this behind
    // decoding, hashing, UI work or an operator-provided verification report.
    return this.requester.receive(this.id, {primary:bytes}).then(result => {
      this.result = result; this.phase = 'complete'; return result;
    });
  }
  bundle() {
    if (this.phase !== 'complete') throw new Error('The final WAV has not been witnessed and verified.');
    return {version:1, type:'nonverba-audio-session-evidence', requester_pin:this.requesterPin, operator_pin:this.operatorPin,
      original_request:this.originalRequest, receipt:this.result.receipt, context_json:AUDIO_CONTEXT, audio_receipt:this.audioReceipt};
  }
  accept(stillCurrent = () => true) {
    if (typeof stillCurrent !== 'function') throw new Error('An audio acceptance lifecycle guard is required.');
    if (this.phase !== 'complete') throw new Error('The final WAV must verify before acceptance.');
    return this.requester.accept(this.id, () => this.phase === 'complete' && stillCurrent());
  }
  close() { this.requester?.close(); if (this.phase !== 'complete') this.phase = 'cancelled'; }
}
export async function authenticateAudioSession(engine, envelope, requesterPin, operatorPin, hints) {
  if (!PIN.test(requesterPin) || !PIN.test(operatorPin) || typeof envelope !== 'string' || envelope.length > 16000) throw new Error('Invalid authenticated audio request.');
  const payload = await engine.json('validate_evidence_session_request', envelope, requesterPin,
    JSON.stringify({media_certificate_sha256:operatorPin, location_spki_sha256:null}), Math.floor(Date.now() / 1000));
  const evidence = payload.spec.evidence;
  if (evidence.type !== 'audio' || evidence.request.demo || !sameHints(evidence.request, audioHints(hints))) throw new Error('The signed audio request differs from the agreed pairing task.');
  const policy = audioPolicy(hints);
  if (Object.keys(payload.spec.policy).length !== Object.keys(policy).length || Object.entries(policy).some(([key, value]) => payload.spec.policy[key] !== value)) throw new Error('The signed audio assurance policy differs from the agreed pairing task.');
  return payload;
}
export async function verifyFinalAudioReceipt(engine, receipt, originalRequest, bytes, transcript, requesterPin) {
  if (typeof receipt !== 'string' || receipt.length > 22000) throw new Error('Invalid final requester receipt.');
  const report = await engine.json('verify_evidence_session_receipt', receipt, originalRequest, bytes, new Uint8Array(),
    JSON.stringify(transcript), requesterPin, AUDIO_CONTEXT, Math.floor(Date.now() / 1000));
  if (!report.verified || report.demo) throw new Error('The final requester receipt did not verify against this exact WAV.');
  return report;
}
export async function verifyExportedAudioSession(engine, bundle, bytes, requesterPin, operatorPin) {
  if (bundle?.version !== 1 || bundle.type !== 'nonverba-audio-session-evidence' || bundle.context_json !== AUDIO_CONTEXT
      || !PIN.test(requesterPin) || !PIN.test(operatorPin) || typeof bundle.receipt !== 'string'
      || typeof bundle.original_request !== 'string' || bundle.audio_receipt?.type !== 'nonverba-audio-receipt') {
    throw new Error('A final audio receipt and independently known requester and operator IDs are required.');
  }
  const result = await engine.json('verify_evidence_session_receipt', bundle.receipt, bundle.original_request, bytes, new Uint8Array(),
    JSON.stringify(bundle.audio_receipt.transcript), requesterPin, AUDIO_CONTEXT, Math.floor(Date.now() / 1000));
  const matched = result.request?.spec?.evidence?.type === 'audio'
    && result.request.spec.operator_pins.media_certificate_sha256 === operatorPin;
  result.checks.expected_operator_match = matched;
  if (!matched) { result.verified = false; result.fresh_action_eligible = false; result.errors.push('Expected operator identity does not match the original requester authority.'); }
  return result;
}

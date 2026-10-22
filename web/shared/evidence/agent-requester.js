// SPDX-License-Identifier: AGPL-3.0-only
import {loadRequesterIdentity} from './live-session-storage.js';
import {reserveEvidenceSession, retainEvidenceOutcome, abandonEvidenceSession,
  acceptEvidenceSession, verifyRetainedEvidence, inspectRetainedEvidence} from './agent-evidence-storage.js';

const now = () => Math.floor(Date.now() / 1000);
const json = JSON.stringify;
const LOCATION_LIMIT = 2 * 1024 * 1024 + 16 * 1024;
function bytes(value, maximum, label) {
  if (!(value instanceof Uint8Array) || value.length > maximum) throw new Error(`Invalid or oversized ${label}.`);
  return new Uint8Array(value);
}

/** Transport-independent requester. Sensor and cryptographic decisions stay in
 * Rust. A transport calls receive only after the complete raw artifacts arrive.
 * Live sessions never resume across page suspension or process reload. */
export class AgentRequester {
  #engine; #identity; #pin; #pending = new Map(); #closed = false;
  #suspend = () => { if (document.hidden) this.close(); };
  #pagehide = () => this.close();
  constructor(engine) {
    this.#engine = engine;
    document.addEventListener('visibilitychange', this.#suspend);
    window.addEventListener('pagehide', this.#pagehide);
  }
  async identity() {
    this.#identity ??= loadRequesterIdentity(this.#engine);
    const identity = await this.#identity;
    this.#pin ??= (await this.#engine.json('live_requester_identity', identity)).pin.sha256;
    return this.#pin;
  }
  #active() { if (this.#closed || document.hidden) throw new Error('The requester is no longer active.'); }
  async start(createSpec, {contextJson = '{"version":1}', send} = {}) {
    this.#active();
    if (typeof send !== 'function' || typeof createSpec !== 'function') throw new Error('A fresh request factory and transport sender are required.');
    if (typeof contextJson !== 'string' || new TextEncoder().encode(contextJson).length > 4 * 1024 * 1024) throw new Error('Invalid verification context.');
    const pin = await this.identity(), identity = await this.#identity;
    this.#active();
    // Key creation and operator pairing precede challenge creation.
    const spec = JSON.parse(json(await createSpec(this.#engine, now())));
    const request = await this.#engine.call('create_evidence_session_request', json(spec), identity, now());
    const payload = await this.#engine.json('validate_evidence_session_request', request, pin, json(spec.operator_pins), now());
    this.#active();
    await reserveEvidenceSession({session_id: payload.session_id, sensor_nonce: payload.sensor_nonce,
      original_request: request, requester_pin: pin, context_json: contextJson});
    const state = {request, payload, contextJson, identity, pin, phase: 'awaiting'};
    this.#pending.set(payload.session_id, state);
    try {
      this.#active();
      state.sentAt = Date.now(); state.sentMono = performance.now();
      if (state.sentAt - payload.created_at_ms > 5000) throw new Error('Request preparation took too long; create a new challenge.');
      state.timer = setTimeout(() => this.cancel(payload.session_id).catch(() => {}), payload.spec.delivery.max_response_ms);
      await send({sessionId: payload.session_id, envelope: request, request: structuredClone(payload.spec.evidence)});
      this.#active();
      if (state.phase === 'cancelled') throw new Error('The evidence session was cancelled while dispatching.');
      return {sessionId: payload.session_id, requesterPin: pin, sensorNonce: payload.sensor_nonce};
    } catch (error) { await this.cancel(payload.session_id); throw error; }
  }
  retainAudioTranscript(sessionId, transcriptJson) {
    const state = this.#pending.get(sessionId);
    this.#active();
    if (!state || state.phase !== 'awaiting' || state.payload.spec.evidence.type !== 'audio'
        || state.audioTranscript !== undefined || typeof transcriptJson !== 'string'
        || new TextEncoder().encode(transcriptJson).length > 65536) throw new Error('A requester transcript can be retained once, before the final WAV arrives.');
    state.audioTranscript = transcriptJson;
  }
  async receive(sessionId, {primary, secondary = new Uint8Array()}) {
    // Timestamp before any copying, hashing or asynchronous verification.
    const receivedAt = Date.now(), receivedMono = performance.now();
    this.#active();
    const state = this.#pending.get(sessionId);
    if (!state || state.phase !== 'awaiting') throw new Error('Unexpected or repeated evidence delivery.');
    state.phase = 'verifying'; clearTimeout(state.timer);
    try {
      const kind = state.payload.spec.evidence.type;
      if (kind === 'audio' && state.audioTranscript === undefined) throw new Error('Retain the requester-generated round transcript before receiving the final WAV.');
      const audioTranscriptJson = state.audioTranscript ?? '';
      primary = bytes(primary, kind === 'audio' ? 8 * 1024 * 1024 : kind === 'location' ? LOCATION_LIMIT : 32 * 1024 * 1024, 'primary evidence');
      secondary = bytes(secondary, kind === 'camera-location' ? LOCATION_LIMIT : 0, 'secondary evidence');
      if (typeof audioTranscriptJson !== 'string' || new TextEncoder().encode(audioTranscriptJson).length > 65536
          || (kind !== 'audio' && audioTranscriptJson !== '')) throw new Error('Unexpected or oversized audio transcript.');
      const timing = {sent_at_ms: state.sentAt, received_at_ms: receivedAt, elapsed_ms: Math.round(receivedMono - state.sentMono)};
      if (timing.elapsed_ms < 0 || timing.elapsed_ms > state.payload.spec.delivery.max_response_ms) throw new Error('Evidence missed its response deadline.');
      const receipt = await this.#engine.call('seal_evidence_session_receipt', state.request, primary, secondary,
        audioTranscriptJson, json(timing), state.identity, state.pin, state.contextJson, now());
      this.#active();
      if (state.phase !== 'verifying') throw new Error('The evidence session was cancelled.');
      const report = await this.#engine.json('verify_evidence_session_receipt', receipt, state.request, primary, secondary,
        audioTranscriptJson, state.pin, state.contextJson, now());
      this.#active();
      if (state.phase !== 'verifying' || !report.verified) throw new Error(`Evidence session failed: ${(report.errors || []).join('; ')}`);
      await retainEvidenceOutcome(sessionId, state.request, {primary, secondary, audio_transcript_json: audioTranscriptJson, receipt});
      this.#active();
      if (state.phase !== 'verifying') throw new Error('The evidence session was cancelled.');
      state.phase = 'complete'; this.#pending.delete(sessionId);
      return {receipt, report};
    } catch (error) { await this.cancel(sessionId); throw error; }
  }
  async verify(sessionId) { return (await verifyRetainedEvidence(this.#engine, sessionId, await this.identity())).report; }
  async inspectRetained(sessionId) {
    this.#active();
    const pin = await this.identity();
    this.#active();
    const result = await inspectRetainedEvidence(this.#engine, sessionId, pin);
    this.#active();
    return result;
  }
  async accept(sessionId, stillCurrent = () => true) {
    if (typeof stillCurrent !== 'function' || !stillCurrent()) throw new Error('The evidence acceptance context changed.');
    return acceptEvidenceSession(this.#engine, sessionId, await this.identity(), stillCurrent);
  }
  async cancel(sessionId) {
    const state = this.#pending.get(sessionId);
    if (state) { state.phase = 'cancelled'; clearTimeout(state.timer); this.#pending.delete(sessionId); }
    await abandonEvidenceSession(sessionId);
  }
  close() {
    this.#closed = true;
    document.removeEventListener('visibilitychange', this.#suspend);
    window.removeEventListener('pagehide', this.#pagehide);
    for (const id of this.#pending.keys()) this.cancel(id).catch(() => {});
  }
}

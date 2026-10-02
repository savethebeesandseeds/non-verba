// SPDX-License-Identifier: AGPL-3.0-only
// Location-only coordination using the shared requester evidence-session protocol.
import {LivePeer} from './live-peer.js';
import {collectLocationProof} from './location-capture.js';
import {reserveCapture} from './storage.js';
import {MAX_LOCATION_PROOF} from './location-platform.js';
import {locationPolicy} from './location-policy.js';
import {LOCATION_CONTEXT, LOCATION_DELIVERY, exact, requireLocationPin, locationContext, locationContextHash,
  locationSessionHints, locationEvidencePolicy, requireLocationContext, sameLocationValue} from './location-session-policy.js';
const now = () => Math.floor(Date.now()/1000), json = JSON.stringify;
export function locationPairingId() { return [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2,'0')).join(''); }
export function readLiveOffer(text) {
  if (typeof text !== 'string' || text.length > 120000) throw new Error('Location pairing offer exceeds its limit.');
  const offer = JSON.parse(text);
  if (!exact(offer, ['version','type','pairing_id','requester_pin','operator_pin','hints','description'])
      || offer.version !== 2 || offer.type !== 'nonverba-live-location-offer') throw new Error('Use a new version-2 live-location pairing offer.');
  [offer.pairing_id,offer.requester_pin,offer.operator_pin].forEach(requireLocationPin);
  locationSessionHints(offer.hints); return offer;
}
export async function authenticateLocationSession(engine, original, requesterPin, operatorPin, hints) {
  [requesterPin,operatorPin].forEach(requireLocationPin);
  if (typeof original !== 'string' || original.length > 16000) throw new Error('Invalid signed location session request.');
  const payload = await engine.json('validate_evidence_session_request', original, requesterPin,
    json({media_certificate_sha256:null, location_spki_sha256:operatorPin}), now());
  const expected=locationSessionHints(hints), evidence=payload.spec.evidence, request=evidence.request;
  if (evidence.type !== 'location' || request.challenge.requester !== expected.requester || request.challenge.task !== expected.task
      || (request.demo === true) !== expected.demo || request.context != null
      || !sameLocationValue(request.policy, locationPolicy(expected.profile, expected.duration_ms))
      || !sameLocationValue(payload.spec.policy, locationEvidencePolicy(expected))
      || !sameLocationValue(payload.spec.delivery, LOCATION_DELIVERY)) throw new Error('The signed location request differs from the task, exact sensor policy or timing the operator allowed.');
  return payload;
}
export async function verifyLocationSessionBundle(engine, bundle, bytes, requesterPin, operatorPin, expectedContext = LOCATION_CONTEXT) {
  [requesterPin,operatorPin].forEach(requireLocationPin); locationContext(expectedContext);
  if (!exact(bundle, ['version','type','requester_pin','operator_pin','original_request','receipt','context_json'])
      || bundle.version !== 1 || bundle.type !== 'nonverba-location-session-evidence'
      || bundle.context_json !== expectedContext || typeof bundle.original_request !== 'string' || bundle.original_request.length > 16000
      || typeof bundle.receipt !== 'string' || bundle.receipt.length > 32000
      || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_LOCATION_PROOF) throw new Error('Invalid location bundle or differing independently retained verifier context.');
  const report = await engine.json('verify_evidence_session_receipt', bundle.receipt, bundle.original_request, bytes,
    new Uint8Array(), '', requesterPin, expectedContext, now());
  const matched = bundle.requester_pin === requesterPin && bundle.operator_pin === operatorPin
    && report.request?.spec?.evidence?.type === 'location' && report.request.spec.operator_pins.location_spki_sha256 === operatorPin
    && report.request.spec.operator_pins.media_certificate_sha256 === null;
  report.checks.expected_operator_match = matched;
  if (!matched) { report.verified=false; report.fresh_action_eligible=false; report.errors.push('Location identities do not match the independently supplied IDs.'); }
  return report;
}
// Historical verification is deliberately separate: never retry a failed shared receipt as legacy.
export async function verifyHistoricalLocationReceipt(engine, receipt, original, proof, requesterPin, operatorPin) {
  [requesterPin,operatorPin].forEach(requireLocationPin);
  if (typeof original !== 'string' || original.length > 16000 || typeof receipt !== 'string' || receipt.length > 32000
      || !(proof instanceof Uint8Array) || !proof.length || proof.length > MAX_LOCATION_PROOF
      || JSON.parse(original)?.type !== 'nonverba-live-session-request') throw new Error('Choose an original legacy v1 live-location request.');
  return engine.json('verify_live_session_receipt', receipt, original, proof, requesterPin, json({type:'operator-location-spki-sha256',sha256:operatorPin}), now());
}
async function defaultRequester(engine) {
  const {AgentRequester} = await import('./agent-requester.js'); return new AgentRequester(engine);
}
/** One connection, one authenticated location request. Local demo status is signed;
 * requester independence and physical truth remain unproven. */
export class LiveLocationSession {
  #original; #request; #id; #bytes; #receipt; #report; #requester; #requesterPromise;
  #artifactPending = false; #retained = false; #queue = Promise.resolve(); #pending = 0; #timer; #closing;
  constructor({role, engine, requesterPin, operatorPin, hints, contextJson = LOCATION_CONTEXT, identity, pairingId = locationPairingId(), collect,
    getOperatorPin, onState = () => {}, onComplete = () => {}, onFailure = () => {},
    peerFactory = options => new LivePeer(options), requesterFactory = defaultRequester, reserve = reserveCapture}) {
    if (!['requester','operator'].includes(role)) throw new Error('Unsupported location session role.');
    requireLocationPin(operatorPin); requireLocationPin(pairingId); if (role === 'operator') requireLocationPin(requesterPin);
    Object.defineProperties(this, {role:{value:role}, engine:{value:engine}, operatorPin:{value:operatorPin},
      hints:{value:locationSessionHints(hints)}, pairingId:{value:pairingId}, contextJson:{value:locationContext(contextJson)}});
    requireLocationContext(this.contextJson, this.hints, operatorPin);
    Object.assign(this, {requesterPin, getOperatorPin, onState, onComplete, onFailure, requesterFactory, reserve});
    this.collect = collect || (options => collectLocationProof({engine, identity, ...options}));
    this.phase = 'pairing'; this.connected = false; this.remoteArmed = false; this.closed = false;
    this.controller = new AbortController();
    this.peer = peerFactory({onMessage:value => this.enqueue(() => this.message(value)),
      onArtifact:bytes => this.artifact(bytes), onFailure:error => this.fail(error),
      onConnected:() => { if (!this.closed && !this.connected && ['pairing','connecting'].includes(this.phase)) { this.connected = true; this.state('connected'); } },
      authorizeArtifact:() => {
        if (this.closed || this.role !== 'requester' || this.phase !== 'awaiting-proof' || this.#artifactPending) return false;
        this.#artifactPending = true; return true;
      }});
  }
  active() { if (this.closed || this.controller.signal.aborted || globalThis.document?.hidden) throw new Error('Location session is no longer active.'); }
  state(phase, detail = '') { if (this.closed) return; this.phase = phase; this.onState({phase, detail, role:this.role,
    ready:this.role === 'requester' && this.connected && this.remoteArmed}); }
  async identity() {
    this.active(); if (this.role !== 'requester') return this.requesterPin;
    this.#requesterPromise ??= this.requesterFactory(this.engine);
    const requester = await this.#requesterPromise;
    if (this.closed || this.controller.signal.aborted) { requester.close(); this.active(); }
    this.#requester = requester; this.active();
    const pin = await requester.identity(); this.active(); requireLocationPin(pin);
    if (this.requesterPin && this.requesterPin !== pin) throw new Error('The retained requester identity changed during pairing.');
    this.requesterPin = pin; return pin;
  }
  async offer() {
    this.active(); if (this.role !== 'requester' || this.phase !== 'pairing') throw new Error('Only an unpaired requester can create an offer.');
    await this.identity(); await this.checkContext(); const description = await this.peer.description('offer'); this.active();
    return {version:2, type:'nonverba-live-location-offer', pairing_id:this.pairingId, requester_pin:this.requesterPin,
      operator_pin:this.operatorPin, hints:this.hints, description};
  }
  async join(offer) {
    this.active(); offer = readLiveOffer(json(offer));
    if (this.role !== 'operator' || this.phase !== 'pairing' || offer.pairing_id !== this.pairingId
        || offer.requester_pin !== this.requesterPin || offer.operator_pin !== this.operatorPin
        || json(locationSessionHints(offer.hints)) !== json(this.hints)) throw new Error('Pairing offer does not match the independently known identities or task.');
    if (typeof this.collect !== 'function' || typeof this.getOperatorPin !== 'function'
        || await this.getOperatorPin() !== this.operatorPin) throw new Error('The selected location identity changed.');
    this.active(); await this.checkContext(); const description = await this.peer.description('answer', offer.description); this.active();
    return {version:2, type:'nonverba-live-location-answer', pairing_id:this.pairingId,
      requester_pin:this.requesterPin, operator_pin:this.operatorPin, description};
  }
  async answer(value) {
    this.active();
    if (this.role !== 'requester' || this.phase !== 'pairing'
        || !exact(value, ['version','type','pairing_id','requester_pin','operator_pin','description'])
        || value.version !== 2 || value.type !== 'nonverba-live-location-answer' || value.pairing_id !== this.pairingId
        || value.requester_pin !== this.requesterPin || value.operator_pin !== this.operatorPin) throw new Error('Location answer belongs to a different pairing.');
    this.state('connecting'); await this.peer.answer(value.description); this.active();
    this.#timer = setTimeout(() => { if (!this.connected) this.fail(new Error('No direct route was found; this session has no relay.')); }, 20000);
  }
  async checkContext() {
    if (await locationContextHash(this.contextJson) !== this.hints.context_sha256) throw new Error('The explicit verifier context differs from the frozen pairing commitment.');
    this.active();
  }
  async arm() {
    this.active(); if (this.role !== 'operator' || this.phase !== 'connected') throw new Error('Connect before allowing the location session.');
    if (await this.getOperatorPin() !== this.operatorPin) throw new Error('The selected location identity changed.');
    this.active(); if (this.phase !== 'connected') throw new Error('Location consent changed while checking the key.');
    this.state('armed'); this.peer.send({type:'armed', pairing_id:this.pairingId});
  }
  prepareAnswerImport() {
    this.active();
    if (this.role !== 'requester' || this.phase !== 'pairing' || this.connected || this.#original) throw new Error('Only pre-challenge pairing can import an answer.');
    this.#requester?.close(); this.#requester = undefined; this.#requesterPromise = undefined;
  }
  async start() {
    this.active();
    if (this.role !== 'requester' || this.phase !== 'connected' || !this.remoteArmed) throw new Error('Wait for the connected operator to allow this location task.');
    await this.identity(); this.active();
    if (this.phase !== 'connected' || !this.remoteArmed) throw new Error('Location consent changed before challenge creation.');
    this.state('preparing'); clearTimeout(this.#timer);
    try {
      await this.#requester.start(async (engine, at) => {
        const request = await engine.json('create_location_request', this.hints.requester, this.hints.task, at, 300, json(locationPolicy(this.hints.profile, this.hints.duration_ms)), 'null');
        request.demo = this.hints.demo;
        return {version:1, evidence:{type:'location', request},
          operator_pins:{media_certificate_sha256:null, location_spki_sha256:this.operatorPin},
          policy:locationEvidencePolicy(this.hints), delivery:{...LOCATION_DELIVERY}};
      },
      {contextJson:this.contextJson, send:message => {
        this.active(); this.#id = message.sessionId; this.#original = message.envelope; this.#request = structuredClone(message.request.request);
        this.state('awaiting-proof');
        this.#timer = setTimeout(() => this.fail(new Error('The complete COSE proof missed the requester response deadline.')), 90000);
        this.peer.send({type:'request', pairing_id:this.pairingId, envelope:message.envelope});
      }});
      this.active();
    } catch (error) { this.fail(error); throw error; }
  }
  enqueue(work) {
    if (this.closed) return;
    if (++this.#pending > 8) { this.fail(new Error('Too many pending location control messages.')); return; }
    this.#queue = this.#queue.then(async () => { this.active(); await work(); }).catch(error => this.fail(error)).finally(() => this.#pending--);
  }
  async message(value) {
    const fields = {armed:['type','pairing_id'], request:['type','pairing_id','envelope'],
      receipt:['type','pairing_id','receipt'], 'receipt-ack':['type','pairing_id'], abort:['type','pairing_id']}[value?.type];
    if (!fields || !exact(value, fields) || value.pairing_id !== this.pairingId) throw new Error('Malformed or foreign location session message.');
    if (value.type === 'abort') throw new Error('The other participant stopped the location session.');
    if (value.type === 'armed') {
      if (this.role !== 'requester' || this.phase !== 'connected' || this.remoteArmed) throw new Error('Unexpected location consent signal.');
      this.remoteArmed = true; this.state('connected', 'Operator allowed the agreed task.'); return;
    }
    if (value.type === 'request') {
      if (this.role !== 'operator' || this.phase !== 'armed') throw new Error('Unexpected or repeated location request.');
      this.state('authenticating');
      const original = value.envelope;
      const payload = await authenticateLocationSession(this.engine, original, this.requesterPin, this.operatorPin, this.hints);
      this.active();
      if (await this.getOperatorPin() !== this.operatorPin) throw new Error('The selected location identity changed after pairing.');
      this.active(); this.#original = original; this.#request = structuredClone(payload.spec.evidence.request); this.#id = payload.session_id;
      await this.reserve('location:' + this.#request.challenge.id, {kind:'shared-live-location', at:Date.now(), session_id:this.#id});
      this.active(); this.state('collecting', 'Authenticated location request; collecting the agreed measurements.');
      this.#timer = setTimeout(() => this.fail(new Error('Location acquisition or final requester receipt timed out.')), 120000);
      // Capture waits outside the control queue so abort/disconnect remains immediate.
      this.capture(payload.spec.policy).catch(error => this.fail(error)); return;
    }
    if (value.type === 'receipt') {
      if (this.role !== 'operator' || this.phase !== 'awaiting-receipt') throw new Error('Unexpected final location receipt.');
      const bundle = this.makeBundle(value.receipt);
      const report = await verifyLocationSessionBundle(this.engine, bundle, this.#bytes, this.requesterPin, this.operatorPin, this.contextJson);
      this.active(); if (!report.verified || report.demo !== this.hints.demo) throw new Error('The final requester receipt did not verify against this exact COSE proof.');
      this.#receipt = value.receipt; this.#report = report; clearTimeout(this.#timer);
      this.state('complete'); this.active(); this.onComplete(this.result());
      try { this.peer.send({type:'receipt-ack', pairing_id:this.pairingId}); } catch { /* Verified receipt remains retained. */ }
      this.finish(); return;
    }
    if (value.type === 'receipt-ack') {
      if (this.role !== 'requester' || this.phase !== 'complete' || !this.#retained) throw new Error('Unexpected receipt acknowledgement.');
      this.finish(); return;
    }
  }
  async capture(policy) {
    const proof = await this.collect({request:structuredClone(this.#request), signal:this.controller.signal,
      onProgress:progress => { if (!this.closed && this.phase === 'collecting') this.onState({phase:'collecting', role:this.role, progress}); }});
    this.active();
    if (this.phase !== 'collecting' || !(proof instanceof Uint8Array) || !proof.length || proof.length > MAX_LOCATION_PROOF
        || await this.getOperatorPin() !== this.operatorPin) throw new Error('Location returned unexpected bytes or a changed signing identity.');
    this.active(); this.#bytes = proof.slice();
    // Wrapper freshness was checked at admission, not again after the measurement window.
    const appraisal = await this.engine.json('appraise_location_with_context', this.#bytes, json(this.#request),
      this.operatorPin, 'null', json(policy), this.contextJson, now());
    this.active(); if (!appraisal.evidence_verified || !appraisal.policy_satisfied || appraisal.demo !== this.hints.demo) throw new Error('The location proof does not satisfy the retained location policy.');
    this.state('awaiting-receipt'); await this.peer.sendArtifact(this.#bytes); this.active();
  }
  artifact(bytes) {
    if (this.closed) return;
    if (this.role !== 'requester' || this.phase !== 'awaiting-proof' || !this.#artifactPending
        || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_LOCATION_PROOF) { this.fail(new Error('Unexpected final location artifact.')); return; }
    clearTimeout(this.#timer);
    // First operation after complete transport delivery: requester records arrival.
    const receiving = this.#requester.receive(this.#id, {primary:bytes});
    this.#bytes = bytes.slice(); this.state('verifying');
    if (!this.closed) this.#timer = setTimeout(() => this.fail(new Error('Location receipt verification exceeded its finalization budget.')), 30000);
    receiving.then(result => {
      this.active(); clearTimeout(this.#timer); this.#receipt = result.receipt; this.#report = result.report; this.#retained = true;
      this.state('complete'); this.active(); this.onComplete(this.result());
      try { this.peer.send({type:'receipt', pairing_id:this.pairingId, receipt:this.#receipt}); }
      catch { this.finish(); return; }
      this.#closing = setTimeout(() => this.finish(), 10000);
    }).catch(error => this.fail(error));
  }
  makeBundle(receipt = this.#receipt) { return {version:1, type:'nonverba-location-session-evidence',
    requester_pin:this.requesterPin, operator_pin:this.operatorPin, original_request:this.#original, receipt, context_json:this.contextJson}; }
  result() { return {role:this.role, sessionId:this.#id, bytes:this.#bytes.slice(), bundle:this.makeBundle(), report:structuredClone(this.#report)}; }
  async accept(stillCurrent = () => true) {
    if (this.role !== 'requester' || this.phase !== 'complete' || !this.#retained || this.#report?.demo || !this.#report?.fresh_action_eligible) throw new Error('Only retained eligible live requester evidence can be accepted.');
    if (typeof stillCurrent !== 'function') throw new Error('An acceptance lifecycle guard is required.');
    return this.#requester.accept(this.#id, () => !this.controller.signal.aborted && !globalThis.document?.hidden && stillCurrent());
  }
  cancel(reason = 'Location session cancelled.') { this.controller.abort(); this.fail(new Error(reason)); }
  finish() { if (this.phase !== 'complete') this.controller.abort(); clearTimeout(this.#timer); clearTimeout(this.#closing); this.closed = true; this.peer.close(); this.#requester?.close(); }
  fail(error) {
    if (this.closed) return;
    if (this.phase === 'complete' && this.#retained) { this.finish(); return; }
    this.state('failed', String(error?.message || error));
    try { this.peer.send({type:'abort', pairing_id:this.pairingId}); } catch {}
    this.controller.abort(); this.finish(); this.onFailure(error);
  }
}

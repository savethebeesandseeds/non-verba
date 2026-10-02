// SPDX-License-Identifier: AGPL-3.0-only
// Camera-specific coordination. Existing Rust/WASM verifies every request and receipt.
import {CameraPeer} from './camera-peer.js';
import {MAX_LOCATION_PROOF} from './location-platform.js';
import {locationPolicy} from './location-policy.js';
import {CAMERA_CONTEXT, CAMERA_DELIVERY, exact, requireCameraPin as requirePin, cameraContext, cameraContextHash,
  cameraHints, cameraPolicy, requireCameraContext, sameCameraValue} from './camera-session-policy.js';
export {CAMERA_CONTEXT, MAX_CAMERA_CONTEXT, cameraContext, cameraContextHash, cameraHints, cameraPolicy} from './camera-session-policy.js';
export const MAX_CAMERA_IMAGE = 32 * 1024 * 1024;
const now = () => Math.floor(Date.now() / 1000), json = JSON.stringify;
export function cameraPairingId() { return [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2,'0')).join(''); }
export function readCameraOffer(text) {
  if (typeof text !== 'string' || text.length > 120000) throw new Error('Camera pairing offer exceeds its limit.');
  const offer=JSON.parse(text),composed=offer?.version===2;
  if (!exact(offer,['version','type','pairing_id','requester_pin','operator_pin','hints','description',...(composed?['operator_location_pin']:[])])
      || ![1,2].includes(offer.version) || offer.type!=='nonverba-camera-offer') throw new Error('Invalid camera pairing offer.');
  [offer.pairing_id,offer.requester_pin,offer.operator_pin,...(composed?[offer.operator_location_pin]:[])].forEach(requirePin);
  const hints=cameraHints(offer.hints);
  if (composed!==!!hints.location_profile) throw new Error('Camera pairing version does not match its evidence mode.');
  return offer;
}
export async function authenticateCameraSession(engine,original,requesterPin,operatorPin,hints,{operatorLocationPin=null,contextJson=CAMERA_CONTEXT}={}) {
  [requesterPin,operatorPin].forEach(requirePin);
  const expected=cameraHints(hints),composed=!!expected.location_profile;
  requireCameraContext(contextJson,expected,operatorLocationPin);
  if (composed && await cameraContextHash(contextJson)!==expected.context_sha256) throw new Error('Camera verifier context differs from the pairing commitment.');
  if (typeof original!=='string' || original.length>16000) throw new Error('Invalid camera session request.');
  const payload=await engine.json('validate_evidence_session_request',original,requesterPin,
    json({media_certificate_sha256:operatorPin,location_spki_sha256:operatorLocationPin}),now());
  const evidence=payload.spec.evidence,request=evidence.request,challenge=composed?request.challenge:request;
  if (evidence.type!==(composed?'camera-location':'image') || challenge?.requester!==expected.requester || challenge?.task!==expected.task
      || !sameCameraValue(payload.spec.policy,cameraPolicy(expected)) || !sameCameraValue(payload.spec.delivery,CAMERA_DELIVERY)
      || (composed && (request.demo===true || !sameCameraValue(request.policy,locationPolicy(expected.location_profile,expected.duration_ms))
        || (!sameCameraValue(request.context,{session_id:request.challenge.id,purpose:'camera'})&&!sameCameraValue(request.context,{session_id:request.challenge.id,purpose:'camera',camera_timing:'concurrent'}))))) {
    throw new Error('The signed camera request differs from the task, policy or timing the operator allowed.');
  }
  return payload;
}
export async function verifyCameraSessionBundle(engine,bundle,bytes,requesterPin,operatorPin,{locationProof,operatorLocationPin=null,contextJson=CAMERA_CONTEXT}={}) {
  [requesterPin,operatorPin].forEach(requirePin);cameraContext(contextJson);
  const composed=bundle?.version===2;
  if (composed) requirePin(operatorLocationPin);
  if (!exact(bundle,['version','type','requester_pin','operator_pin','original_request','receipt','context_json',...(composed?['operator_location_pin']:[])])
      || ![1,2].includes(bundle.version) || bundle.type!=='nonverba-camera-session-evidence'
      || bundle.context_json!==contextJson || (!composed && (contextJson!==CAMERA_CONTEXT || operatorLocationPin!==null || locationProof!==undefined))
      || typeof bundle.original_request!=='string' || bundle.original_request.length>16000 || typeof bundle.receipt!=='string' || bundle.receipt.length>32000
      || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length>MAX_CAMERA_IMAGE
      || (composed && (!(locationProof instanceof Uint8Array) || !locationProof.length || locationProof.length>MAX_LOCATION_PROOF))) throw new Error('Invalid final camera session bundle or differing independently retained verifier context.');
  const report=await engine.json('verify_evidence_session_receipt',bundle.receipt,bundle.original_request,bytes,
    composed?locationProof:new Uint8Array(),'',requesterPin,contextJson,now());
  const matched=bundle.requester_pin===requesterPin && bundle.operator_pin===operatorPin
    && report.request?.spec?.evidence?.type===(composed?'camera-location':'image')
    && report.request.spec.operator_pins.media_certificate_sha256===operatorPin
    && report.request.spec.operator_pins.location_spki_sha256===operatorLocationPin
    && (!composed || bundle.operator_location_pin===operatorLocationPin);
  report.checks.expected_operator_match=matched;
  if (!matched) {report.verified=false;report.fresh_action_eligible=false;report.errors.push('Camera session identities do not match the independently supplied IDs.');}
  return report;
}
async function defaultRequester(engine) {
  const {AgentRequester} = await import('./agent-requester.js'); return new AgentRequester(engine);
}
/** One connection, one authenticated image request. No same-device/demo assurance
 * is inferred: requester independence and physical truth remain unproven. */
export class CameraSession {
  #original; #request; #locationRequest; #id; #bytes; #locationProof; #receipt; #report; #requester; #requesterPromise;
  #artifactPending = false; #retained = false; #queue = Promise.resolve(); #pending = 0; #timer; #closing;
  constructor({role, engine, requesterPin, operatorPin, operatorLocationPin = null, contextJson = CAMERA_CONTEXT, hints, pairingId = cameraPairingId(), collect,
    getOperatorPin, getLocationPin, onState = () => {}, onComplete = () => {}, onFailure = () => {},
    peerFactory = options => new CameraPeer(options), requesterFactory = defaultRequester}) {
    if (!['requester','operator'].includes(role)) throw new Error('Unsupported camera session role.');
    requirePin(operatorPin); requirePin(pairingId); if (role === 'operator') requirePin(requesterPin);
    Object.defineProperties(this, {role:{value:role}, engine:{value:engine}, operatorPin:{value:operatorPin},
      hints:{value:cameraHints(hints)}, pairingId:{value:pairingId}, operatorLocationPin:{value:operatorLocationPin},
      contextJson:{value:cameraContext(contextJson)}, composed:{value:!!cameraHints(hints).location_profile}});
    requireCameraContext(this.contextJson,this.hints,operatorLocationPin);
    Object.assign(this, {requesterPin, collect, getOperatorPin, getLocationPin, onState, onComplete, onFailure, requesterFactory});
    this.phase = 'pairing'; this.connected = false; this.remoteArmed = false; this.closed = false;
    this.controller = new AbortController();
    this.peer = peerFactory({mode:this.composed?'camera-location-v2':'image-v1', onMessage:value => this.enqueue(() => this.message(value)),
      onArtifact:bytes => this.artifact(bytes), onArtifacts:({primary,secondary}) => this.artifact(primary,secondary), onFailure:error => this.fail(error),
      onConnected:() => { if (!this.closed && !this.connected && ['pairing','connecting'].includes(this.phase)) { this.connected = true; this.state('connected'); } },
      authorizeArtifacts:({primaryBytes,secondaryBytes}) => {
        if (!this.composed || !Number.isSafeInteger(primaryBytes) || primaryBytes<1 || primaryBytes>MAX_CAMERA_IMAGE
            || !Number.isSafeInteger(secondaryBytes) || secondaryBytes<1 || secondaryBytes>MAX_LOCATION_PROOF) return false;
        return this.authorize();
      },
      authorizeArtifact:() => !this.composed && this.authorize()});
  }
  authorize() {
        if (this.closed || this.role !== 'requester' || this.phase !== 'awaiting-image' || this.#artifactPending) return false;
        this.#artifactPending = true; return true;
  }
  active() { if (this.closed || this.controller.signal.aborted || globalThis.document?.hidden) throw new Error('Camera session is no longer active.'); }
  state(phase, detail = '') { if (this.closed) return; this.phase = phase; this.onState({phase, detail, role:this.role,
    ready:this.role === 'requester' && this.connected && this.remoteArmed}); }
  async identity() {
    this.active(); if (this.role !== 'requester') return this.requesterPin;
    this.#requesterPromise ??= this.requesterFactory(this.engine);
    const requester = await this.#requesterPromise;
    if (this.closed || this.controller.signal.aborted) { requester.close(); this.active(); }
    this.#requester = requester; this.active();
    const pin = await requester.identity(); this.active(); requirePin(pin);
    if (this.requesterPin && this.requesterPin !== pin) throw new Error('The retained requester identity changed during pairing.');
    this.requesterPin = pin; return pin;
  }
  async offer() {
    this.active(); if (this.role !== 'requester' || this.phase !== 'pairing') throw new Error('Only an unpaired requester can create an offer.');
    await this.identity(); await this.checkContext(); const description = await this.peer.description('offer'); this.active();
    return {version:this.composed?2:1, type:'nonverba-camera-offer', pairing_id:this.pairingId, requester_pin:this.requesterPin,
      operator_pin:this.operatorPin, ...(this.composed?{operator_location_pin:this.operatorLocationPin}:{}), hints:this.hints, description};
  }
  async join(offer) {
    this.active(); offer = readCameraOffer(json(offer));
    if (this.role !== 'operator' || this.phase !== 'pairing' || offer.pairing_id !== this.pairingId
        || offer.requester_pin !== this.requesterPin || offer.operator_pin !== this.operatorPin
        || offer.version!==(this.composed?2:1) || (this.composed && offer.operator_location_pin!==this.operatorLocationPin)
        || json(cameraHints(offer.hints)) !== json(this.hints)) throw new Error('Pairing offer does not match the independently known identities or task.');
    if (typeof this.collect !== 'function') throw new Error('A camera collector is required.');
    await this.checkKeys(); await this.checkContext();
    this.active(); const description = await this.peer.description('answer', offer.description); this.active();
    return {version:this.composed?2:1, type:'nonverba-camera-answer', pairing_id:this.pairingId,
      requester_pin:this.requesterPin, operator_pin:this.operatorPin, ...(this.composed?{operator_location_pin:this.operatorLocationPin}:{}), description};
  }
  async answer(value) {
    this.active();
    if (this.role !== 'requester' || this.phase !== 'pairing'
        || !exact(value, ['version','type','pairing_id','requester_pin','operator_pin','description',...(this.composed?['operator_location_pin']:[])])
        || value.version !== (this.composed?2:1) || (this.composed && value.operator_location_pin!==this.operatorLocationPin) || value.type !== 'nonverba-camera-answer' || value.pairing_id !== this.pairingId
        || value.requester_pin !== this.requesterPin || value.operator_pin !== this.operatorPin) throw new Error('Camera answer belongs to a different pairing.');
    this.state('connecting'); await this.peer.answer(value.description); this.active();
    this.#timer = setTimeout(() => { if (!this.connected) this.fail(new Error('No direct route was found; this session has no relay.')); }, 20000);
  }
  async checkContext() {
    if (this.composed && await cameraContextHash(this.contextJson)!==this.hints.context_sha256) throw new Error('The explicit verifier context differs from the frozen pairing commitment.');
    this.active();
  }
  async checkKeys() {
    if (typeof this.getOperatorPin!=='function' || await this.getOperatorPin()!==this.operatorPin) throw new Error('The selected camera identity changed.');
    this.active();
    if (this.composed && (typeof this.getLocationPin!=='function' || await this.getLocationPin()!==this.operatorLocationPin)) throw new Error('The selected location identity changed.');
    this.active();
  }
  async arm() {
    this.active(); if (this.role !== 'operator' || this.phase !== 'connected') throw new Error('Connect before allowing the camera session.');
    await this.checkKeys();
    this.active(); if (this.phase !== 'connected') throw new Error('Camera consent changed while checking the key.');
    this.state('armed'); this.active(); this.peer.send({type:'armed', pairing_id:this.pairingId});
  }
  prepareAnswerImport() {
    this.active();
    if (this.role !== 'requester' || this.phase !== 'pairing' || this.connected || this.#original) throw new Error('Only pre-challenge pairing can import an answer.');
    this.#requester?.close(); this.#requester = undefined; this.#requesterPromise = undefined;
  }
  async start() {
    this.active();
    if (this.role !== 'requester' || this.phase !== 'connected' || !this.remoteArmed) throw new Error('Wait for the connected operator to allow this camera task.');
    await this.identity(); this.active();
    if (this.phase !== 'connected' || !this.remoteArmed) throw new Error('Camera consent changed before challenge creation.');
    this.state('preparing'); clearTimeout(this.#timer);
    try {
      await this.checkContext();
      await this.#requester.start(async (engine,at) => {
        let request;
        if (this.composed) {
          request=await engine.json('create_location_request',this.hints.requester,this.hints.task,at,300,json(locationPolicy(this.hints.location_profile,this.hints.duration_ms)),'null');
          request.context={session_id:request.challenge.id,purpose:'camera',camera_timing:'concurrent'};
        } else request=await engine.json('create_challenge',this.hints.requester,this.hints.task,at,300);
        return {version:1,evidence:{type:this.composed?'camera-location':'image',request},
          operator_pins:{media_certificate_sha256:this.operatorPin,location_spki_sha256:this.operatorLocationPin},
          policy:cameraPolicy(this.hints),delivery:{...CAMERA_DELIVERY}};
      },
      {contextJson:this.contextJson, send:message => {
        this.active(); this.#id = message.sessionId; this.#original = message.envelope; this.retainRequest(message.request.request);
        this.state('awaiting-image'); this.active();
        this.#timer = setTimeout(() => this.fail(new Error('The complete camera evidence missed the requester response deadline.')), 180000);
        this.peer.send({type:'request', pairing_id:this.pairingId, envelope:message.envelope});
      }});
      this.active();
    } catch (error) { this.fail(error); throw error; }
  }
  enqueue(work) {
    if (this.closed) return;
    if (++this.#pending > 8) { this.fail(new Error('Too many pending camera control messages.')); return; }
    this.#queue = this.#queue.then(async () => { this.active(); await work(); }).catch(error => this.fail(error)).finally(() => this.#pending--);
  }
  async message(value) {
    const fields = {armed:['type','pairing_id'], request:['type','pairing_id','envelope'],
      receipt:['type','pairing_id','receipt'], 'receipt-ack':['type','pairing_id'], abort:['type','pairing_id']}[value?.type];
    if (!fields || !exact(value, fields) || value.pairing_id !== this.pairingId) throw new Error('Malformed or foreign camera session message.');
    if (value.type === 'abort') throw new Error('The other participant stopped the camera session.');
    if (value.type === 'armed') {
      if (this.role !== 'requester' || this.phase !== 'connected' || this.remoteArmed) throw new Error('Unexpected camera consent signal.');
      this.remoteArmed = true; this.state('connected', 'Operator allowed the agreed task.'); return;
    }
    if (value.type === 'request') {
      if (this.role !== 'operator' || this.phase !== 'armed') throw new Error('Unexpected or repeated camera request.');
      this.state('authenticating');
      const original = value.envelope;
      const payload = await authenticateCameraSession(this.engine, original, this.requesterPin, this.operatorPin, this.hints,{operatorLocationPin:this.operatorLocationPin,contextJson:this.contextJson});
      this.active();
      await this.checkKeys();
      this.active(); this.#original = original; this.retainRequest(payload.spec.evidence.request); this.#id = payload.session_id;
      this.state('capturing', 'Authenticated request loaded. Open the camera and use its shutter.'); this.active();
      this.#timer = setTimeout(() => this.fail(new Error('Camera acquisition or final requester receipt timed out.')), 210000);
      // Capture waits outside the control queue so abort/disconnect remains immediate.
      this.capture(payload.spec.policy).catch(error => this.fail(error)); return;
    }
    if (value.type === 'receipt') {
      if (this.role !== 'operator' || this.phase !== 'awaiting-receipt') throw new Error('Unexpected final camera receipt.');
      const bundle = this.makeBundle(value.receipt);
      const report = await verifyCameraSessionBundle(this.engine, bundle, this.#bytes, this.requesterPin, this.operatorPin,this.verifyOptions());
      this.active(); if (!report.verified || !report.fresh_action_eligible || report.demo) throw new Error('The final requester receipt did not verify against this exact JPEG.');
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
  retainRequest(request) {
    this.#locationRequest=this.composed?structuredClone(request):null;
    this.#request=structuredClone(this.composed?request.challenge:request);
  }
  verifyOptions() { return this.composed?{locationProof:this.#locationProof,operatorLocationPin:this.operatorLocationPin,contextJson:this.contextJson}:{}; }
  async capture(policy) {
    await this.checkKeys();
    const result=await this.collect({challenge:structuredClone(this.#request),locationRequest:structuredClone(this.#locationRequest),policy:structuredClone(policy),
      operatorPin:this.operatorPin,operatorLocationPin:this.operatorLocationPin,signal:this.controller.signal});
    this.active();
    if (this.phase!=='capturing' || !(result?.bytes instanceof Uint8Array) || !result.bytes.length || result.bytes.length>MAX_CAMERA_IMAGE
        || result.fingerprint!==this.operatorPin || (this.composed && (!(result.locationProof instanceof Uint8Array) || !result.locationProof.length
          || result.locationProof.length>MAX_LOCATION_PROOF || result.locationFingerprint!==this.operatorLocationPin
          || !sameCameraValue(result.locationRequest,this.#locationRequest)))
        || (!this.composed && (result.locationProof!=null || result.locationRequest!=null))) throw new Error('Camera returned unexpected artifacts, request or signing identities.');
    // Snapshot before awaiting key retrieval so caller-owned buffers cannot race appraisal.
    this.#bytes=new Uint8Array(result.bytes);this.#locationProof=this.composed?new Uint8Array(result.locationProof):undefined;
    await this.checkKeys();
    // Authenticate once at dispatch; shutter-time checks use retained challenge expiry.
    const appraisal=this.composed
      ? await this.engine.json('appraise_camera_location_with_context',this.#bytes,this.#locationProof,json(this.#locationRequest),this.operatorPin,this.operatorLocationPin,json(policy),this.contextJson,now())
      : await this.engine.json('appraise_image_with_context',this.#bytes,json(this.#request),this.operatorPin,json(policy),this.contextJson,now());
    this.active();if (!appraisal.evidence_verified || !appraisal.policy_satisfied) throw new Error('The captured camera evidence does not satisfy the retained camera policy.');
    this.state('awaiting-receipt');this.active();
    if (this.composed) await this.peer.sendArtifacts({primary:this.#bytes,secondary:this.#locationProof});
    else await this.peer.sendArtifact(this.#bytes);
    this.active();
  }
  artifact(bytes,locationProof) {
    if (this.closed) return;
    if (this.role!=='requester' || this.phase!=='awaiting-image' || !this.#artifactPending || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length>MAX_CAMERA_IMAGE
        || (this.composed && (!(locationProof instanceof Uint8Array) || !locationProof.length || locationProof.length>MAX_LOCATION_PROOF))
        || (!this.composed && locationProof!==undefined)) {this.fail(new Error('Unexpected final camera artifacts.'));return;}
    // First operation after complete transport delivery: observe BOTH artifacts before copying or UI work.
    const receiving=this.#requester.receive(this.#id,{primary:bytes,...(this.composed?{secondary:locationProof}:{})});
    clearTimeout(this.#timer);this.#bytes=new Uint8Array(bytes);this.#locationProof=this.composed?new Uint8Array(locationProof):undefined;this.state('verifying');
    if (!this.closed) this.#timer=setTimeout(()=>this.fail(new Error('Camera receipt verification exceeded its finalization budget.')),30000);
    receiving.then(result=>{
      this.active();clearTimeout(this.#timer);this.#receipt=result.receipt;this.#report=result.report;this.#retained=true;
      this.state('complete');this.active();this.onComplete(this.result());
      try {this.peer.send({type:'receipt',pairing_id:this.pairingId,receipt:this.#receipt});}
      catch {this.finish();return;}
      this.#closing=setTimeout(()=>this.finish(),10000);
    }).catch(error=>this.fail(error));
  }
  makeBundle(receipt=this.#receipt) {return {version:this.composed?2:1,type:'nonverba-camera-session-evidence',
    requester_pin:this.requesterPin,operator_pin:this.operatorPin,...(this.composed?{operator_location_pin:this.operatorLocationPin}:{}),
    original_request:this.#original,receipt,context_json:this.contextJson};}
  result() {return {role:this.role,sessionId:this.#id,bytes:new Uint8Array(this.#bytes),...(this.composed?{locationProof:new Uint8Array(this.#locationProof)}:{}),bundle:this.makeBundle(),report:structuredClone(this.#report)};}
  async accept(stillCurrent = () => true) {
    if (this.role !== 'requester' || this.phase !== 'complete' || !this.#retained || !this.#report?.fresh_action_eligible || this.#report?.demo) throw new Error('Only retained live requester evidence can be accepted.');
    if (typeof stillCurrent !== 'function') throw new Error('An acceptance lifecycle guard is required.');
    return this.#requester.accept(this.#id, () => !this.controller.signal.aborted && !globalThis.document?.hidden && stillCurrent());
  }
  cancel(reason = 'Camera session cancelled.') { this.controller.abort(); this.fail(new Error(reason)); }
  finish() { if (this.phase !== 'complete') this.controller.abort(); clearTimeout(this.#timer); clearTimeout(this.#closing); this.closed = true; this.peer.close(); this.#requester?.close(); }
  fail(error) {
    if (this.closed) return;
    if (this.phase === 'complete' && this.#retained) { this.finish(); return; }
    this.state('failed', String(error?.message || error));
    try { this.peer.send({type:'abort', pairing_id:this.pairingId}); } catch {}
    this.controller.abort(); this.finish(); this.onFailure(error);
  }
}

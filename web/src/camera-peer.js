// SPDX-License-Identifier: AGPL-3.0-only
// Bounded camera data transport only. No signaling service, STUN/TURN, media
// tracks or acquisition logic. Session code authenticates application controls.
import {MAX_LOCATION_PROOF} from './location-platform.js';
const LABELS = Object.freeze({'image-v1':'nonverba-camera-v1', 'camera-location-v2':'nonverba-camera-location-v2'});
const MAX_IMAGE = 32 * 1024 * 1024, CONTROL_LIMIT = 64 * 1024, CONTROL_COUNT = 64;
const FRAGMENT = 16000, HIGH_WATER = 256000, LOW_WATER = 64000;
const STALL_MS = 5000, TRANSFER_MS = 180000, PAIR_MS = 10000;
const utf8 = new TextEncoder();
function insist(value, reason) { if (!value) throw new Error(reason); }
function control(value) {
  insist(value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.type === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.type), 'Malformed camera control.');
}
function boundedText(value, maximum, reason) {
  insist(typeof value === 'string' && value.length <= maximum && utf8.encode(value).length <= maximum, reason);
}

export class CameraPeer {
  #waiters = new Set(); #incomingTimer; #fragmentTimer; #receivedArtifact = false;
  #sentArtifact = false; #sentControls = 0; #role; #answered = false; #mode;
  constructor({mode = 'image-v1', onMessage, onArtifact, onArtifacts, onFailure, onConnected, authorizeArtifact, authorizeArtifacts}) {
    insist(Object.hasOwn(LABELS, mode), 'Unsupported camera transport mode.');
    for (const callback of [onMessage, onFailure, onConnected,
      ...(mode === 'image-v1' ? [onArtifact, authorizeArtifact] : [onArtifacts, authorizeArtifacts])]) {
      insist(typeof callback === 'function', 'Camera peer callbacks are required.');
    }
    this.#mode = mode;
    Object.assign(this, {onMessage, onArtifact, onArtifacts, onFailure, onConnected, authorizeArtifact, authorizeArtifacts});
    this.closed = false; this.incoming = null; this.controlCount = 0; this.sending = false;
    this.pc = new RTCPeerConnection({iceServers:[], bundlePolicy:'max-bundle'});
    this.pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(this.pc.connectionState)) this.#fail(new Error('The camera connection was interrupted.'));
    };
    this.pc.ondatachannel = ({channel}) => {
      if (this.closed) { channel.close(); return; }
      try { this.#attach(channel); } catch (error) { channel.close(); this.#fail(error); }
    };
  }
  #fail(error) {
    if (this.closed) return;
    this.close();
    try { this.onFailure(error instanceof Error ? error : new Error(String(error))); } catch { /* The transport is already closed. */ }
  }
  #callback(callback, ...args) {
    // Invoke synchronously: AgentRequester must observe final-byte arrival now.
    const pending = callback(...args);
    if (pending && typeof pending.then === 'function') Promise.resolve(pending).catch(error => this.#fail(error));
  }
  #open() { insist(!this.closed && this.channel?.readyState === 'open', 'The camera peer is not connected.'); }
  #attach(channel) {
    insist(!this.closed && !this.channel, 'Unexpected additional camera channel.');
    insist(channel.label === LABELS[this.#mode] && channel.ordered === true && channel.maxRetransmits === null
      && channel.maxPacketLifeTime === null, 'Unsupported camera channel.');
    this.channel = channel; channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = LOW_WATER;
    channel.onopen = () => { if (!this.closed) { try { this.#callback(this.onConnected); } catch (error) { this.#fail(error); } } };
    channel.onclose = channel.onerror = () => this.#fail(new Error('The camera data channel closed.'));
    channel.onmessage = ({data}) => {
      if (this.closed) return;
      try { this.#receive(data); } catch (error) { this.#fail(error); }
    };
  }
  #receive(data) {
    if (typeof data === 'string') {
      boundedText(data, CONTROL_LIMIT, 'Camera control exceeds its byte limit.');
      insist(!this.incoming && ++this.controlCount <= CONTROL_COUNT, 'Unexpected or excessive camera control.');
      const value = JSON.parse(data); control(value);
      if (value.type !== 'artifact' && value.type !== 'artifact-set') { this.#callback(this.onMessage, value); return; }
      insist(!this.#receivedArtifact, 'Unexpected repeated camera artifact.');
      if (this.#mode === 'image-v1') {
        insist(value.type === 'artifact' && Object.keys(value).length === 2 && Object.hasOwn(value, 'bytes')
          && Number.isSafeInteger(value.bytes) && value.bytes >= 1 && value.bytes <= MAX_IMAGE,
          'Unexpected or oversized camera artifact.');
        // No allocation until the application authorizes this phase synchronously.
        insist(this.authorizeArtifact() === true && !this.closed, 'Camera artifact was not authorized.');
        this.incoming = {bytes:new Uint8Array(value.bytes), used:0};
      } else {
        insist(value.type === 'artifact-set' && value.version === 2
          && Object.keys(value).sort().join(',') === 'primary_bytes,secondary_bytes,type,version'
          && Number.isSafeInteger(value.primary_bytes) && value.primary_bytes >= 1 && value.primary_bytes <= MAX_IMAGE
          && Number.isSafeInteger(value.secondary_bytes) && value.secondary_bytes >= 1 && value.secondary_bytes <= MAX_LOCATION_PROOF,
          'Unexpected or oversized camera artifact set.');
        insist(this.authorizeArtifacts({primaryBytes:value.primary_bytes, secondaryBytes:value.secondary_bytes}) === true
          && !this.closed, 'Camera artifact set was not authorized.');
        this.incoming = {primary:new Uint8Array(value.primary_bytes), secondary:new Uint8Array(value.secondary_bytes), used:0};
      }
      this.#receivedArtifact = true;
      this.#incomingTimer = setTimeout(() => this.#fail(new Error('Camera artifact transfer exceeded its deadline.')), TRANSFER_MS);
      this.#armFragmentTimer();
      return;
    }
    const active = this.incoming;
    insist(data instanceof ArrayBuffer && active && data.byteLength >= 5 && data.byteLength <= FRAGMENT + 4,
      'Unexpected camera artifact fragment.');
    const offset = new DataView(data).getUint32(0, true), part = new Uint8Array(data, 4);
    const composed = this.#mode === 'camera-location-v2';
    const secondary = composed && active.used >= active.primary.length;
    const target = composed ? (secondary ? active.secondary : active.primary) : active.bytes;
    const localOffset = active.used - (secondary ? active.primary.length : 0);
    insist(offset === active.used && part.length === Math.min(FRAGMENT, target.length - localOffset),
      'Camera fragment offset or length is invalid.');
    target.set(part, localOffset); active.used += part.length;
    const total = composed ? active.primary.length + active.secondary.length : active.bytes.length;
    if (active.used === total) {
      this.incoming = null; this.#clearIncomingTimers();
      if (composed) this.#callback(this.onArtifacts, {primary:active.primary, secondary:active.secondary});
      else this.#callback(this.onArtifact, active.bytes);
    } else this.#armFragmentTimer();
  }
  #armFragmentTimer() {
    clearTimeout(this.#fragmentTimer);
    this.#fragmentTimer = setTimeout(() => this.#fail(new Error('Camera artifact fragments stalled.')), STALL_MS);
  }
  #clearIncomingTimers() { clearTimeout(this.#incomingTimer); clearTimeout(this.#fragmentTimer); }
  #sendControl(value) {
    this.#open(); control(value);
    const encoded = JSON.stringify(value);
    boundedText(encoded, CONTROL_LIMIT, 'Camera control exceeds its byte limit.');
    insist(this.#sentControls < CONTROL_COUNT, 'Camera control budget exhausted.');
    this.channel.send(encoded); this.#sentControls++;
  }
  send(value) {
    this.#open();
    insist(!this.sending, 'A camera artifact transfer is already pending.');
    control(value); insist(value.type !== 'artifact' && value.type !== 'artifact-set', 'Use the artifact sender for camera artifact framing.');
    this.#sendControl(value);
  }
  async sendArtifact(bytes) {
    insist(this.#mode === 'image-v1', 'The camera transport mode requires an artifact set.');
    insist(bytes instanceof Uint8Array && bytes.length >= 1 && bytes.length <= MAX_IMAGE, 'Invalid camera artifact size.');
    return this.#sendArtifacts([bytes], {type:'artifact', bytes:bytes.length});
  }
  async sendArtifacts(value) {
    insist(this.#mode === 'camera-location-v2', 'The camera transport mode requires a single image.');
    insist(value && typeof value === 'object' && Object.keys(value).sort().join(',') === 'primary,secondary',
      'Invalid camera artifact set.');
    const {primary, secondary} = value;
    insist(primary instanceof Uint8Array && primary.length >= 1 && primary.length <= MAX_IMAGE
      && secondary instanceof Uint8Array && secondary.length >= 1 && secondary.length <= MAX_LOCATION_PROOF,
      'Invalid camera artifact set size.');
    return this.#sendArtifacts([primary, secondary], {type:'artifact-set', version:2, primary_bytes:primary.length, secondary_bytes:secondary.length});
  }
  async #sendArtifacts(sources, header) {
    this.#open();
    insist(!this.sending && !this.#sentArtifact, 'A camera artifact was already sent or is pending.');
    // Snapshot every artifact before yielding; mutation during backpressure must
    // not change either signed original. No extra combined buffer is allocated.
    const artifacts = sources.map(bytes => new Uint8Array(bytes));
    this.sending = true; this.#sentArtifact = true;
    const deadline = setTimeout(() => this.#fail(new Error('Camera artifact send exceeded its deadline.')), TRANSFER_MS);
    try {
      this.#sendControl(header);
      let base = 0;
      for (const bytes of artifacts) {
        for (let offset = 0; offset < bytes.length; offset += FRAGMENT) {
          this.#open();
          if (this.channel.bufferedAmount > HIGH_WATER) {
            await this.#wait(this.channel, 'bufferedamountlow', () => this.channel.bufferedAmount <= LOW_WATER,
              STALL_MS, 'Camera artifact transport stalled.');
          }
          this.#open();
          const part = bytes.subarray(offset, offset + FRAGMENT), packet = new Uint8Array(part.length + 4);
          new DataView(packet.buffer).setUint32(0, base + offset, true); packet.set(part, 4);
          this.channel.send(packet);
        }
        base += bytes.length;
      }
    } catch (error) { this.#fail(error); throw error; }
    finally { clearTimeout(deadline); this.sending = false; }
  }
  #wait(target, event, ready, timeout, reason) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return; settled = true;
        clearTimeout(timer); target.removeEventListener(event, check); this.#waiters.delete(cancel);
        error ? reject(error) : resolve();
      };
      const check = () => { if (this.closed) cancel(); else if (ready()) finish(); };
      const cancel = () => finish(new Error('Camera transport cancelled.'));
      const timer = setTimeout(() => finish(new Error(reason)), timeout);
      this.#waiters.add(cancel); target.addEventListener(event, check); check();
    });
  }
  #description(value, type) {
    insist(value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).sort().join(',') === 'sdp,type' && value.type === type, 'Invalid camera pairing description.');
    boundedText(value.sdp, 100000, 'Camera pairing description exceeds its limit.');
    const media = value.sdp.split(/\r?\n/).filter(line => line.startsWith('m='));
    insist(media.length === 1 && /^m=application\s/.test(media[0]), 'Only a single data-only camera connection is accepted.');
  }
  async description(type, remote) {
    try {
      insist(!this.closed && !this.#role && (type === 'offer' || type === 'answer'), 'Camera pairing already started or has an invalid role.');
      if (type === 'answer') this.#description(remote, 'offer');
      else insist(remote === undefined, 'A camera offer cannot include a remote description.');
      this.#role = type;
      if (remote) { await this.pc.setRemoteDescription(remote); insist(!this.closed, 'Camera pairing cancelled.'); }
      if (type === 'offer') this.#attach(this.pc.createDataChannel(LABELS[this.#mode], {ordered:true}));
      const local = type === 'offer' ? await this.pc.createOffer() : await this.pc.createAnswer();
      insist(!this.closed, 'Camera pairing cancelled.');
      await this.pc.setLocalDescription(local); insist(!this.closed, 'Camera pairing cancelled.');
      if (this.pc.iceGatheringState !== 'complete') {
        await this.#wait(this.pc, 'icegatheringstatechange', () => this.pc.iceGatheringState === 'complete', PAIR_MS, 'Camera pairing timed out.');
      }
      insist(!this.closed, 'Camera pairing cancelled.');
      const result = this.pc.localDescription.toJSON(); this.#description(result, type); return result;
    } catch (error) { this.#fail(error); throw error; }
  }
  async answer(remote) {
    try {
      insist(!this.closed && this.#role === 'offer' && !this.#answered, 'Unexpected or repeated camera answer.');
      this.#description(remote, 'answer'); this.#answered = true;
      await this.pc.setRemoteDescription(remote); insist(!this.closed, 'Camera pairing cancelled.');
    } catch (error) { this.#fail(error); throw error; }
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.incoming = null; this.#clearIncomingTimers();
    for (const cancel of [...this.#waiters]) cancel();
    this.channel?.close(); this.pc.close();
  }
}

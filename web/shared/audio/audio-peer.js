// SPDX-License-Identifier: AGPL-3.0-only
// Explicit manual signaling; no third-party signaling/STUN/TURN servers or uploads.
const CHUNK_BYTES = 192000;
const FRAGMENT_BYTES = 16000;
const MAX_WAV = 8 * 1024 * 1024, ARTIFACT_INDEX = 0xffffffff;
export class AudioPeer {
  constructor(onMessage, onChunk, onFailure, onConnected, authorizeChunk, onArtifact = () => {}, authorizeArtifact = () => false) {
    this.pc = new RTCPeerConnection({iceServers: [], bundlePolicy: 'max-bundle'});
    this.onMessage = onMessage; this.onChunk = onChunk; this.onFailure = onFailure; this.onConnected = onConnected; this.authorizeChunk = authorizeChunk;
    this.onArtifact = onArtifact; this.authorizeArtifact = authorizeArtifact;
    this.closed = false; this.incoming = null; this.controlCount = 0; this.sending = false;
    this.pc.onconnectionstatechange = () => {
      if (!this.closed && ['failed', 'disconnected', 'closed'].includes(this.pc.connectionState)) this.onFailure(new Error('The requester connection was interrupted.'));
    };
    this.pc.ondatachannel = ({channel}) => {
      if (this.channel) { channel.close(); return this.onFailure(new Error('Unexpected extra connection.')); }
      try { this.attach(channel); } catch (error) { channel.close(); this.onFailure(error); }
    };
  }
  attach(channel) {
    if (channel.label !== 'nonverba-audio-v1' || !channel.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null) throw new Error('Unsupported audio connection.');
    this.channel = channel; channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = 64000;
    channel.onopen = () => { if (!this.closed) this.onConnected(); };
    channel.onclose = () => { if (!this.closed) this.onFailure(new Error('The live connection closed.')); };
    channel.onerror = () => { if (!this.closed) this.onFailure(new Error('Audio transport failed.')); };
    channel.onmessage = ({data}) => {
      if (this.closed) return;
      try {
        if (typeof data === 'string') {
          if (data.length > 24000 || this.incoming || ++this.controlCount > 128) throw new Error('Unexpected or oversized live message.');
          const message = JSON.parse(data);
          if (!message || typeof message.type !== 'string') throw new Error('Invalid live message.');
          if (message.type === 'chunk') {
            if (Object.keys(message).length !== 3 || !Number.isInteger(message.index) || message.index < 0 || message.index >= 15 || message.bytes !== CHUNK_BYTES) throw new Error('Invalid audio chunk length.');
            if (!this.authorizeChunk(message.index)) throw new Error('Unexpected or excess audio chunk.');
            this.incoming = {index: message.index, bytes: new Uint8Array(CHUNK_BYTES), used: 0};
          } else if (message.type === 'artifact') {
            if (Object.keys(message).length !== 2 || !Number.isSafeInteger(message.bytes) || message.bytes < 1 || message.bytes > MAX_WAV || !this.authorizeArtifact()) throw new Error('Unexpected or oversized final WAV.');
            this.incoming = {index:ARTIFACT_INDEX, bytes:new Uint8Array(message.bytes), used:0};
          } else this.onMessage(message);
        } else {
          const active = this.incoming;
          if (!(data instanceof ArrayBuffer) || !active || data.byteLength < 9 || data.byteLength > FRAGMENT_BYTES + 8) throw new Error('Invalid audio fragment.');
          const view = new DataView(data), payload = new Uint8Array(data, 8);
          if (view.getUint32(0, true) !== active.index || view.getUint32(4, true) !== active.used || payload.length !== Math.min(FRAGMENT_BYTES, active.bytes.length - active.used)) throw new Error('Audio fragment order is invalid.');
          active.bytes.set(payload, active.used); active.used += payload.length;
          if (active.used === active.bytes.length) {
            this.incoming = null;
            if (active.index === ARTIFACT_INDEX) this.onArtifact(active.bytes);
            else this.onChunk(active.index, active.bytes);
          }
        }
      } catch (error) { this.onFailure(error); }
    };
  }
  send(value) {
    if (this.closed || this.channel?.readyState !== 'open') throw new Error('The live peer is not connected.');
    const text = JSON.stringify(value); if (text.length > 24000) throw new Error('Live message too large.'); this.channel.send(text);
  }
  async sendChunk(index, bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== CHUNK_BYTES || !Number.isInteger(index) || index < 0 || index >= 15) throw new Error('Incomplete microphone chunk.');
    return this.sendBytes(index, bytes, {type:'chunk', index, bytes:bytes.length});
  }
  async sendArtifact(bytes) {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_WAV) throw new Error('Invalid final WAV size.');
    return this.sendBytes(ARTIFACT_INDEX, bytes, {type:'artifact', bytes:bytes.length});
  }
  async sendBytes(index, bytes, header) {
    if (this.sending) throw new Error('An audio transfer is already pending.');
    this.sending = true;
    try {
      this.send(header);
      for (let offset = 0; offset < bytes.length; offset += FRAGMENT_BYTES) {
        if (this.closed) throw new Error('Audio transport cancelled.');
        if (this.channel.bufferedAmount > 256000) await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { cleanup(); reject(new Error('Audio connection is too slow.')); }, 1500);
          const done = () => { cleanup(); resolve(); };
          const cleanup = () => { clearTimeout(timeout); this.channel.removeEventListener('bufferedamountlow', done); };
          this.channel.addEventListener('bufferedamountlow', done, {once: true});
        });
        if (this.closed) throw new Error('Audio transport cancelled.');
        const payload = bytes.subarray(offset, offset + FRAGMENT_BYTES), packet = new Uint8Array(payload.length + 8);
        const frame = new DataView(packet.buffer); frame.setUint32(0, index, true); frame.setUint32(4, offset, true); packet.set(payload, 8);
        this.channel.send(packet);
      }
    } finally { this.sending = false; }
  }
  async description(type, remote) {
    if (remote) {
      if (!remote || remote.type !== 'offer' || typeof remote.sdp !== 'string' || remote.sdp.length > 100000 || /\r?\nm=(?:audio|video)\s/.test(remote.sdp)) throw new Error('Only a data connection offer is accepted.');
      await this.pc.setRemoteDescription(remote);
    }
    if (type === 'offer') this.attach(this.pc.createDataChannel('nonverba-audio-v1', {ordered: true}));
    await this.pc.setLocalDescription(type === 'offer' ? await this.pc.createOffer() : await this.pc.createAnswer());
    await this.gather();
    if (this.closed) throw new Error('Pairing cancelled.');
    return this.pc.localDescription.toJSON();
  }
  async answer(description) {
    if (!description || description.type !== 'answer' || typeof description.sdp !== 'string' || description.sdp.length > 100000 || /\r?\nm=(?:audio|video)\s/.test(description.sdp)) throw new Error('Invalid pairing answer.');
    await this.pc.setRemoteDescription(description);
  }
  async gather() {
    if (this.pc.iceGatheringState === 'complete') return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Connection discovery timed out.')); }, 10000);
      const check = () => { if (this.pc.iceGatheringState === 'complete') { cleanup(); resolve(); } };
      const cleanup = () => { clearTimeout(timeout); this.pc.removeEventListener('icegatheringstatechange', check); };
      this.pc.addEventListener('icegatheringstatechange', check); check();
    });
  }
  close() { this.closed = true; this.incoming = null; this.channel?.close(); this.pc.close(); }
}

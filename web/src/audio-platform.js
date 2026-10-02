// SPDX-License-Identifier: AGPL-3.0-only
// Native-owned PCM adapter. Only requests, random challenges and the requester's
// final receipt go into the bridge; recorded audio and probe samples never do.
import {base64ToBytes} from './location-platform.js';
const PIN = /^[0-9a-f]{64}$/;
const MAX_WAV = 8 * 1024 * 1024;
const CHUNK_SAMPLES = 96000;

function decode(text, max = 64 * 1024) {
  if (typeof text !== 'string' || text.length > max) throw new Error('Invalid native microphone response.');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native microphone response.');
  if (value.ok === false || ['error', 'cancelled'].includes(value.state)) throw new Error(value.error || 'Native microphone stopped.');
  return value;
}

export function nativeAudioPlatform(requireCapture = true) {
  const bridge = globalThis.NativeAudio;
  if (!bridge) return null;
  for (const method of ['capabilities', 'begin', 'status', 'round', 'chunk', 'finalize', 'cancel']) {
    if (typeof bridge[method] !== 'function') throw new Error('The native microphone bridge is incomplete.');
  }
  const capabilities = decode(bridge.capabilities());
  if ((requireCapture && capabilities.available !== true) || typeof capabilities.available !== 'boolean' || capabilities.version !== 1 || !PIN.test(capabilities.key_fingerprint)) {
    throw new Error('Native microphone capture requires a supported Android device and built-in audio route.');
  }
  return {bridge, capabilities, fingerprint: capabilities.key_fingerprint};
}

export class NativeAudioCapture {
  constructor(platform, request, onFailure) {
    this.platform = platform; this.request = request; this.onFailure = onFailure;
    this.closed = false; this.abort = new AbortController(); this.nextChunk = 0; this.nextRound = 0;
  }
  active() { if (this.closed) throw new DOMException('Native microphone capture cancelled.', 'AbortError'); }
  permissionPending() {
    try { return !!this.id && this.status().state === 'requesting-permission'; } catch { return false; }
  }
  wait() {
    return new Promise((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); this.abort.signal.removeEventListener('abort', cancel); reject(new DOMException('Native microphone capture cancelled.', 'AbortError')); };
      const timer = setTimeout(() => { this.abort.signal.removeEventListener('abort', cancel); resolve(); }, 25);
      this.abort.signal.addEventListener('abort', cancel, {once: true});
      if (this.closed) cancel();
    });
  }
  status(large = false) {
    this.active();
    const result = decode(this.platform.bridge.status(this.id), large ? Math.ceil(MAX_WAV / 3) * 4 + 64 * 1024 : 64 * 1024);
    if (result.session_id !== this.id || result.key_fingerprint !== this.platform.fingerprint) throw new Error('Native microphone session or signing identity changed.');
    return result;
  }
  async open() {
    this.active();
    const begun = decode(this.platform.bridge.begin(JSON.stringify(this.request)));
    if (typeof begun.session_id !== 'string' || !begun.session_id) throw new Error('Native microphone did not create a session.');
    this.id = begun.session_id;
    const deadline = performance.now() + 20000;
    try {
      while (true) {
        const status = this.status();
        if (status.state === 'ready') {
          if (status.pilot_verified !== true) throw new Error('Native speaker and microphone test did not pass.');
          return;
        }
        if (!['requesting-permission', 'preparing', 'pilot'].includes(status.state)) throw new Error('Unexpected native microphone setup state.');
        if (performance.now() > deadline) throw new Error('Native microphone setup timed out.');
        await this.wait();
      }
    } catch (error) { this.close(); throw error; }
  }
  round(round, onChunk) {
    this.active();
    if (round.index !== this.nextRound || round.session_id !== this.request.session_id || !PIN.test(round.nonce)) throw new Error('Native microphone received an unexpected challenge.');
    const accepted = decode(this.platform.bridge.round(this.id, JSON.stringify({session_id: round.session_id, index: round.index, nonce: round.nonce})));
    if (accepted.session_id !== this.id) throw new Error('Native microphone round session changed.');
    this.nextRound++;
    if (round.index === 0) {
      this.onChunk = onChunk;
      this.polling = this.pollChunks().catch(error => { if (!this.closed) { this.close(); this.onFailure(error); } });
    }
  }
  async pollChunks() {
    const total = this.request.duration_secs / 2, deadline = performance.now() + this.request.duration_secs * 1000 + 7000;
    while (this.nextChunk < total) {
      const status = this.status();
      if (!['recording', 'awaiting-receipt'].includes(status.state)) throw new Error('Native recording ended unexpectedly.');
      const chunk = decode(this.platform.bridge.chunk(this.id, this.nextChunk), 300000);
      if (chunk.session_id !== this.id || chunk.index !== this.nextChunk) throw new Error('Native audio segment belongs to another session or position.');
      if (chunk.pending === false) {
        if (this.nextChunk >= this.nextRound || chunk.sample_count !== CHUNK_SAMPLES || !PIN.test(chunk.pcm_sha256)) throw new Error('Native audio segment has no matching challenge or sample count.');
        const bytes = base64ToBytes(chunk.pcm_base64, CHUNK_SAMPLES * 2);
        if (bytes.length !== CHUNK_SAMPLES * 2) throw new Error('Incomplete native microphone segment.');
        const index = this.nextChunk++;
        await this.onChunk(index, bytes); this.active();
      } else if (chunk.pending !== true) throw new Error('Native microphone omitted segment availability.');
      if (performance.now() > deadline) throw new Error('Native microphone delivery timed out.');
      if (this.nextChunk < total) await this.wait();
    }
  }
  async finalize(receipt) {
    this.active();
    if (this.nextChunk !== this.request.duration_secs / 2 || this.nextRound !== this.nextChunk) throw new Error('Native recording is incomplete.');
    const accepted = decode(this.platform.bridge.finalize(this.id, JSON.stringify(receipt)));
    if (accepted.session_id !== this.id) throw new Error('Native microphone finalization session changed.');
    const deadline = performance.now() + 30000;
    while (true) {
      const status = this.status(true);
      if (status.state === 'complete') {
        if (status.result?.fingerprint !== this.platform.fingerprint || status.result?.media_origin !== 'native-aaudio-pcm') throw new Error('Unexpected native microphone evidence origin.');
        const bytes = base64ToBytes(status.result.wav_base64, MAX_WAV);
        this.active(); return bytes;
      }
      if (status.state !== 'sealing') throw new Error('Native microphone did not begin signing.');
      if (performance.now() > deadline) throw new Error('Native microphone signing timed out.');
      await this.wait();
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.abort.abort();
    if (this.id) { try { this.platform.bridge.cancel(this.id); } catch { /* Keep the original failure. */ } }
  }
}

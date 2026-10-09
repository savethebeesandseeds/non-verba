// SPDX-License-Identifier: AGPL-3.0-only
// Capture adapters only. No identity recognition, storage, upload or evidence
// transport. Synthetic capture is the default developer inspection path.
export class SyntheticAuthenticationCapture {
  constructor() { this.closed = false; this.opened = false; }
  async open({current, signal}) {
    if (!current() || signal.aborted || this.closed) throw new Error('Capture was cancelled.');
    this.opened = true;
  }
  async capture() {
    if (!this.opened || this.closed) throw new Error('Synthetic capture is closed.');
    return {kind: 'synthetic', simulation: true, blob: null};
  }
  async close() { this.closed = true; this.opened = false; return true; }
  stopped() { return this.closed; }
}

export class BrowserAuthenticationCamera {
  constructor({mediaDevices = globalThis.navigator?.mediaDevices, video,
    canvasFactory = () => globalThis.document.createElement('canvas'),
    nativeContext = () => !!globalThis.NativeVault} = {}) {
    this.mediaDevices = mediaDevices;
    this.video = video;
    this.canvasFactory = canvasFactory;
    this.nativeContext = nativeContext;
    this.closed = false;
    this.stream = null;
    this.pending = null;
  }

  async open({current, signal, onInterrupted = () => {}}) {
    if (this.nativeContext()) throw new Error('Browser authentication capture is unavailable in the native developer app.');
    if (!this.mediaDevices?.getUserMedia || !this.video) throw new Error('A secure browser camera context is required.');
    if (this.closed || !current() || signal.aborted) throw new Error('Camera operation was cancelled.');
    this.current = current;
    this.signal = signal;
    // Never borrow an evidence stream. In particular, no microphone or location
    // permission, evidence presets, GPS warm-up or native bridge is used here.
    this.pending = this.mediaDevices.getUserMedia({audio: false,
      video: {facingMode: {ideal: 'user'}, width: {ideal: 640}, height: {ideal: 480}}});
    try {
      const stream = await this.pending;
      this.stream = stream;
      if (this.closed || !current() || signal.aborted) {
        this.stopTracks();
        throw new Error('Camera operation was cancelled before permission completed.');
      }
      if (stream.getAudioTracks().length || !stream.getVideoTracks().length) {
        this.stopTracks();
        throw new Error('Authentication requires a camera-only stream.');
      }
      this.ended = () => { onInterrupted('camera track ended'); void this.close().catch(() => {}); };
      for (const track of stream.getVideoTracks()) track.addEventListener?.('ended', this.ended, {once: true});
      this.video.srcObject = stream;
      await this.video.play();
      if (this.closed || !current() || signal.aborted) {
        this.stopTracks();
        this.detach();
        throw new Error('Camera operation was cancelled while opening preview.');
      }
    } catch (error) {
      try { this.stopTracks(); } finally { this.detach(); }
      throw error;
    }
  }

  async capture() {
    if (this.closed || !this.current?.() || this.signal?.aborted || !this.stream)
      throw new Error('Authentication camera is closed.');
    if (!this.stream.getVideoTracks().every(track => track.readyState === 'live')) throw new Error('Authentication camera track ended.');
    if (!this.video.videoWidth || !this.video.videoHeight) throw new Error('Camera frame is not ready.');
    const canvas = this.canvasFactory();
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Local camera image encoding is unavailable.');
      context.drawImage(this.video, 0, 0);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value =>
        value ? resolve(value) : reject(new Error('Local camera image encoding failed.')), 'image/jpeg', 0.8));
      if (this.closed || !this.current() || this.signal.aborted) throw new Error('Capture was cancelled while encoding.');
      return {kind: 'browser-photo', simulation: true, blob};
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  stopTracks() {
    const errors = [];
    for (const track of this.stream?.getTracks() ?? []) {
      try { track.stop(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new Error('Camera track shutdown failed.');
  }
  detach() {
    if (!this.video) return;
    this.video.pause?.();
    this.video.srcObject = null;
  }
  async close() {
    this.closed = true;
    for (const track of this.stream?.getVideoTracks() ?? []) track.removeEventListener?.('ended', this.ended);
    this.detach();
    // getUserMedia itself cannot be cancelled. A late stream must be stopped;
    // until it arrives the controller truthfully shows cleanup as pending.
    try {
      if (this.pending) { try { this.stream = await this.pending; } catch {} }
      this.stopTracks();
    } finally {
      this.detach();
    }
    return this.stopped();
  }
  stopped() { return this.closed && (this.stream?.getTracks() ?? []).every(track => track.readyState === 'ended'); }
}

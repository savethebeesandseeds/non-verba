// SPDX-License-Identifier: AGPL-3.0-only
// Web Audio is the platform adapter. Rust generates and detects the acoustic code.
export class AudioCapture {
  constructor(onFailure) { this.onFailure = onFailure; this.closed = false; this.sources = new Set(); this.cancellation = new AbortController(); }
  async open() {
    if (this.closed) throw new Error('Microphone setup cancelled.');
    if (this.opening || this.ready) throw new Error('Microphone setup has already started.');
    this.opening = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioWorkletNode) throw new Error('This browser cannot capture the required audio path. Use HTTPS or localhost.');
      this.context = new AudioContext({sampleRate: 48000, latencyHint: 'interactive'});
      // Resume during the operator's click, before the permission prompt resolves.
      await this.wait(this.context.resume());
      if (this.closed) throw new Error('Microphone setup cancelled.');
      const stream = await this.wait(navigator.mediaDevices.getUserMedia({audio: {
        channelCount: {exact: 1}, sampleRate: {exact: 48000},
        echoCancellation: {exact: false}, noiseSuppression: {exact: false}, autoGainControl: {exact: false}
      }, video: false}), stream => this.stopTracks(stream));
      if (this.closed) { this.stopTracks(stream); throw new Error('Microphone setup cancelled.'); }
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      this.checkSettings();
      track.addEventListener('ended', () => { if (!this.closed) this.onFailure(new Error('Microphone access ended.')); });
      track.addEventListener('mute', () => { if (!this.closed) this.onFailure(new Error('Microphone input was muted.')); });
      this.context.addEventListener('statechange', () => {
        if (!this.closed && this.recording && this.context.state !== 'running') this.onFailure(new Error('Audio processing was suspended.'));
      });
      await this.wait(this.context.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url)));
      if (this.closed) throw new Error('Microphone setup cancelled.');
      this.node = new AudioWorkletNode(this.context, 'nonverba-recorder', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit'});
      this.microphone = this.context.createMediaStreamSource(stream);
      this.microphone.connect(this.node);
      this.node.connect(this.context.destination); // Worklet output is always zero.
      this.node.port.onmessage = ({data}) => {
        if (this.closed) return;
        if (data.type === 'ready') {
          const resolve = this.primeResolve; this.primeResolve = null; this.primeReject = null; resolve?.();
        }
        if (data.type === 'started') {
          this.startFrame = data.frame;
          const resolve = this.startResolve; this.startResolve = null; this.startReject = null; resolve?.();
        }
        if (data.type === 'chunk') {
          try { this.checkSettings(); this.onChunk?.(data.index, data.samples); }
          catch (error) { this.rejectPending(error); this.onFailure(error); }
        }
        if (data.type === 'done') {
          this.recording = false;
          const resolve = this.doneResolve; this.doneResolve = null; this.doneReject = null; resolve?.();
        }
        if (data.type === 'error') {
          const error = new Error(data.message); this.recording = false; this.rejectPending(error); this.onFailure(error);
        }
      };
      const primed = new Promise((resolve, reject) => { this.primeResolve = resolve; this.primeReject = reject; });
      this.node.port.postMessage({type: 'prime'});
      const timeout = setTimeout(() => {
        this.rejectPending(new Error('Microphone input did not stabilize before recording.')); this.close();
      }, 3000);
      try { await primed; this.checkSettings(); this.ready = true; }
      finally { clearTimeout(timeout); this.primeResolve = null; this.primeReject = null; }
    } catch (error) { this.close(); throw error; }
    finally { this.opening = false; }
  }
  wait(operation, onLateValue) {
    // Browser permission and module promises may stay pending after cancellation.
    // Settle our setup immediately, and dispose a microphone granted later.
    return new Promise((resolve, reject) => {
      const signal = this.cancellation.signal;
      const cleanup = () => signal.removeEventListener('abort', cancelled);
      const cancelled = () => { cleanup(); reject(new Error('Microphone setup cancelled.')); };
      signal.addEventListener('abort', cancelled, {once: true});
      Promise.resolve(operation).then(value => {
        cleanup();
        if (signal.aborted) { try { onLateValue?.(value); } catch { /* A late result cannot revive cancelled setup. */ } return; }
        resolve(value);
      }, error => { cleanup(); reject(error); });
      if (signal.aborted) cancelled();
    });
  }
  stopTracks(stream) {
    let tracks;
    try { tracks = stream?.getTracks() || []; } catch { return; }
    for (const track of tracks) { try { track.stop(); } catch { /* Finish closing the other resources. */ } }
  }
  async record(chunks, onChunk) {
    this.checkSettings();
    if (this.closed || !this.ready || this.recording || this.context.state !== 'running') throw new Error('Microphone is not ready.');
    this.recording = true; this.onChunk = onChunk; this.startFrame = null;
    this.finished = new Promise((resolve, reject) => { this.doneResolve = resolve; this.doneReject = reject; });
    // The pilot awaits completion explicitly. Real sessions use chunk callbacks;
    // still reject their completion promise on cancellation without an unhandled
    // rejection. The original promise remains rejecting for explicit awaiters.
    this.finished.catch(() => {});
    const started = new Promise((resolve, reject) => { this.startResolve = resolve; this.startReject = reject; });
    this.node.port.postMessage({type: 'start', chunks});
    const timeout = setTimeout(() => { this.rejectPending(new Error('Microphone did not begin delivering samples.')); this.close(); }, 3000);
    try { await started; } finally { clearTimeout(timeout); this.startReject = null; }
  }
  rejectPending(error) {
    const primeReject = this.primeReject, startReject = this.startReject, doneReject = this.doneReject;
    this.primeResolve = null; this.primeReject = null;
    this.startResolve = null; this.startReject = null; this.doneResolve = null; this.doneReject = null;
    primeReject?.(error); startReject?.(error); doneReject?.(error);
  }
  position() { return this.startFrame === null ? 0 : Math.max(0, Math.round(this.context.currentTime * 48000 - this.startFrame)); }
  checkSettings() {
    const track = this.stream?.getAudioTracks()[0], settings = track?.getSettings();
    if (this.closed || !track || track.readyState !== 'live' || track.muted || this.context.sampleRate !== 48000 || settings.sampleRate !== 48000 || settings.channelCount !== 1 ||
        ['echoCancellation', 'noiseSuppression', 'autoGainControl'].some(key => settings[key] !== false)) {
      throw new Error('The device cannot confirm an uninterrupted 48 kHz mono microphone with audio processing disabled.');
    }
    this.settings = settings;
  }
  play(samples) {
    this.checkSettings();
    if (this.closed || !this.ready || this.context.state !== 'running') throw new Error('Speaker is unavailable.');
    // One pilot plus at most fifteen rounds of the supported 768 ms profile.
    // Keep ended nodes attached until capture closes: disconnecting onended
    // mutates the render graph while the strict recorder is still running.
    if (samples?.length !== 36864 || this.sources.size >= 16) throw new Error('Speaker probe exceeds the supported audio session profile.');
    const buffer = this.context.createBuffer(1, samples.length, 48000); buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource(); source.buffer = buffer;
    source.connect(this.context.destination); // Physical speaker; never microphone/worklet input.
    this.sources.add(source);
    source.start(this.context.currentTime + 0.025);
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.ready = false; this.recording = false; this.rejectPending(new Error('Microphone capture cancelled.'));
    this.cancellation.abort();
    this.onChunk = null;
    try { this.node?.port.postMessage({type: 'stop'}); } catch { /* Continue teardown. */ }
    try { this.node?.disconnect(); } catch { /* Continue teardown. */ }
    try { this.microphone?.disconnect(); } catch { /* Continue teardown. */ }
    for (const source of this.sources) { try { source.stop(); } catch {} try { source.disconnect(); } catch {} }
    this.sources.clear(); this.stopTracks(this.stream);
    try { if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {}); } catch { /* Preserve the original setup or capture failure. */ }
  }
}

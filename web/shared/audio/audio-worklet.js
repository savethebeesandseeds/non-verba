// SPDX-License-Identifier: AGPL-3.0-only
// Capture only the microphone input. The reference signal never enters this node.
class EvidenceRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false; this.priming = false; this.primed = false;
    this.port.onmessage = ({data}) => {
      if (data.type === 'stop') { this.active = false; this.priming = false; this.primed = false; return; }
      if (data.type === 'prime' && !this.active) {
        this.priming = true; this.primed = false; this.primeSamples = 0; this.primeFrame = null; return;
      }
      if (data.type !== 'start' || !Number.isInteger(data.chunks) || data.chunks < 1 || data.chunks > 15 || sampleRate !== 48000) return;
      if (!this.primed || this.active) { this.port.postMessage({type: 'error', message: 'Microphone is not ready for a new recording.'}); return; }
      this.remaining = data.chunks; this.index = 0; this.used = 0; this.total = 0;
      this.buffer = new Float32Array(96000); this.previousFrame = null; this.active = true; this.first = true;
    };
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.priming) {
      const input = inputs[0]?.[0];
      // Graph startup is not evidence: retain no PCM until at least 250 ms of
      // consecutive, correctly shaped input quanta have actually arrived.
      // The adapter bounds this phase to three seconds. A later recording gap
      // still aborts; priming never selects or repairs recorded samples.
      if (!input?.length || inputs[0].length !== 1 || sampleRate !== 48000) {
        this.primeSamples = 0; this.primeFrame = null; return true;
      }
      if (this.primeFrame !== null && currentFrame !== this.primeFrame) this.primeSamples = 0;
      this.primeFrame = currentFrame + input.length; this.primeSamples += input.length;
      if (this.primeSamples >= 12000) {
        this.priming = false; this.primed = true; this.port.postMessage({type: 'ready'});
      }
      return true;
    }
    if (!this.active) return true;
    const input = inputs[0]?.[0];
    // A newly attached media source may need a few render quanta to become
    // available. The adapter bounds this startup wait; never skip a later gap.
    if (!input && this.first) return true;
    if (!input || inputs[0].length !== 1 || (this.previousFrame !== null && currentFrame !== this.previousFrame)) {
      this.active = false; this.port.postMessage({type: 'error', message: 'Microphone samples were interrupted.', frame: currentFrame, expected_frame: this.previousFrame, input_samples: input?.length ?? 0, channels: inputs[0]?.length ?? 0}); return true;
    }
    this.previousFrame = currentFrame + input.length;
    if (this.first) { this.first = false; this.port.postMessage({type: 'started', frame: currentFrame}); }
    let offset = 0;
    while (offset < input.length && this.active) {
      const count = Math.min(input.length - offset, this.buffer.length - this.used);
      this.buffer.set(input.subarray(offset, offset + count), this.used);
      this.used += count; this.total += count; offset += count;
      if (this.used === this.buffer.length) {
        this.port.postMessage({type: 'chunk', index: this.index++, samples: this.buffer}, [this.buffer.buffer]);
        this.used = 0;
        if (--this.remaining === 0) { this.active = false; this.port.postMessage({type: 'done', samples: this.total}); }
        else this.buffer = new Float32Array(96000);
      }
    }
    return true;
  }
}
registerProcessor('nonverba-recorder', EvidenceRecorder);

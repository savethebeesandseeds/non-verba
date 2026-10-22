// SPDX-License-Identifier: AGPL-3.0-only
// Same-device demonstration only. The signed request and exported receipt both
// retain their demo markers; this adapter provides no independent requester.
const HEX = /^[0-9a-f]{64}$/;
const CHUNK_SAMPLES = 96000;
const CHUNK_BYTES = CHUNK_SAMPLES * 2;
const now = () => Math.floor(Date.now() / 1000);

export class AudioDemoRequester {
  constructor({engine, request, onMessage, onFailure, onReceipt}) {
    if (!engine || typeof engine.call !== 'function' || typeof engine.json !== 'function'
        || [onMessage, onFailure, onReceipt].some(callback => typeof callback !== 'function')) {
      throw new Error('The local demo requires an engine and receipt callbacks.');
    }
    if (!request || request.version !== 1 || request.demo !== true || !HEX.test(request.session_id)
        || request.sample_rate !== 48000 || request.channels !== 1 || request.chunk_samples !== CHUNK_SAMPLES
        || request.round_deadline_ms !== 3000 || request.signal_algorithm !== 'org.nonverba.audio-fsk.v1'
        || !Number.isInteger(request.duration_secs) || request.duration_secs < 4 || request.duration_secs > 30
        || request.duration_secs % 2 || !Number.isSafeInteger(request.issued_at)
        || !Number.isSafeInteger(request.expires_at) || request.expires_at <= request.issued_at) {
      throw new Error('The local demo requires a valid, explicitly labelled audio demo request.');
    }
    this.engine = engine;
    this.request = Object.freeze(JSON.parse(JSON.stringify(request)));
    this.onMessage = onMessage; this.onFailure = onFailure; this.onReceipt = onReceipt;
    this.closed = false; this.phase = 'awaiting-ready'; this.pending = null;
    this.rounds = []; this.chunkBusy = false; this.deadline = null;
    this.cancellation = new AbortController();
    this._check();
  }

  send(message) {
    if (message?.type === 'abort') { this.close(); return; }
    if (message?.type === 'receipt-ack') return;
    try {
      this._check();
      if (message?.type !== 'ready' || this.phase !== 'awaiting-ready' || !HEX.test(message.fingerprint)) {
        throw new Error('Unexpected local demo message or invalid device ID.');
      }
      // The ID is checked for shape only. Same-device demonstration is not an
      // independently pinned or attested operator identity.
      this.phase = 'issuing';
      // send() callers do not await this operation. Handle its rejection here.
      return this._issueRound(0).catch(error => this._fail(error));
    } catch (error) { this._fail(error); throw error; }
  }

  async sendChunk(index, bytes) {
    try {
      this._check();
      if (this.phase !== 'awaiting-chunk' || this.chunkBusy || !this.pending
          || !Number.isInteger(index) || index !== this.rounds.length || index !== this.pending.index
          || !(bytes instanceof Uint8Array) || bytes.byteLength !== CHUNK_BYTES) {
        throw new Error('Unexpected, repeated, or incomplete local demo audio segment.');
      }
      const received = this._elapsed(), issued = this.pending.issued_elapsed_ms;
      if (received <= issued || received - issued > this.request.round_deadline_ms) {
        throw new Error('The local demo audio segment missed its receipt deadline.');
      }
      if (received < (index + 1) * 2000 - 100) {
        throw new Error('Audio arrived too quickly for the requested continuous demo recording.');
      }
      this.chunkBusy = true; this.phase = 'processing-chunk';
      const pending = this.pending;
      this._arm('Processing the local demo audio segment timed out.');
      // Snapshot bytes before crossing the asynchronous worker boundary.
      this._check();
      const pcm = await this._wait(this.engine.call('decode_audio_pcm', bytes.slice()));
      this._check();
      if (!(pcm instanceof Float32Array) || pcm.length !== CHUNK_SAMPLES) throw new Error('Incomplete decoded demo audio.');
      const hash = await this._wait(this.engine.call('hash_audio_pcm', pcm));
      this._check();
      if (typeof hash !== 'string' || !HEX.test(hash)) throw new Error('Invalid demo audio commitment.');
      this.rounds.push({index, nonce: pending.nonce, issued_elapsed_ms: issued, received_elapsed_ms: received,
        pcm_sha256: hash, start_sample: index * CHUNK_SAMPLES, sample_count: CHUNK_SAMPLES});
      this.pending = null;
      // No successor nonce exists until the preceding PCM has been received,
      // decoded, hashed, and committed to the monotonic transcript above.
      if (this.rounds.length < this.request.duration_secs / 2) {
        this.phase = 'issuing';
        await this._issueRound(this.rounds.length);
        this._check();
        return;
      }
      this.phase = 'retaining';
      const completed = now();
      if (completed < this.startedAt || received > (completed - this.startedAt + 1) * 1000) {
        throw new Error('The device clock changed during the local demo.');
      }
      const transcript = {version: 1, session_id: this.request.session_id, started_at: this.startedAt,
        completed_at: completed, total_samples: this.request.duration_secs * 48000,
        rounds: this.rounds.map(round => ({...round}))};
      const receipt = {version: 1, type: 'nonverba-audio-demo-receipt', request: {...this.request}, transcript};
      this._arm('Retaining the local demo receipt timed out.');
      this._check();
      await this._wait(this.onReceipt(receipt));
      this._check();
      this.phase = 'done'; clearTimeout(this.deadline); this.deadline = null;
      this._emit({type: 'receipt', receipt});
    } catch (error) { this._fail(error); throw error; }
    finally { this.chunkBusy = false; }
  }

  async _issueRound(index) {
    this._check();
    if (this.phase !== 'issuing' || this.pending || index !== this.rounds.length
        || index >= this.request.duration_secs / 2) throw new Error('Invalid demo challenge sequence.');
    this._arm('Creating the local demo challenge timed out.');
    const round = await this._wait(this.engine.json('create_audio_round', JSON.stringify(this.request), index, now()));
    this._check();
    if (!round || round.session_id !== this.request.session_id || round.index !== index
        || typeof round.nonce !== 'string' || !HEX.test(round.nonce)
        || this.rounds.some(previous => previous.nonce === round.nonce)) {
      throw new Error('Invalid or repeated local demo challenge.');
    }
    if (index === 0) { this.startedAt = now(); this.baseTime = performance.now(); }
    const issued = index === 0 ? 0 : this._elapsed();
    if (index > 0 && issued < this.rounds[index - 1].received_elapsed_ms) throw new Error('The demo clock moved backwards.');
    this.pending = {index, nonce: round.nonce, issued_elapsed_ms: issued};
    this.phase = 'awaiting-chunk';
    this._arm('A local demo audio segment missed its live receipt deadline.');
    this._emit({type: 'round', session_id: round.session_id, index, nonce: round.nonce});
  }

  _elapsed() {
    const elapsed = Math.round(performance.now() - this.baseTime);
    if (!Number.isSafeInteger(elapsed) || elapsed < 0) throw new Error('Invalid local demo clock.');
    return elapsed;
  }

  _check() {
    if (this.closed) throw new Error('The local audio demo was cancelled.');
    const time = now();
    if (time < this.request.issued_at || time >= this.request.expires_at) throw new Error('The local demo request expired or its clock changed.');
  }

  _arm(message) {
    clearTimeout(this.deadline);
    this.deadline = setTimeout(() => this._fail(new Error(message)), this.request.round_deadline_ms);
  }

  _emit(message) {
    // Keep the operator's ordered message queue out of sendChunk's call stack.
    queueMicrotask(() => {
      if (this.closed) return;
      try {
        this._check();
        Promise.resolve(this.onMessage(message)).catch(error => this._fail(error));
      } catch (error) { this._fail(error); }
    });
  }

  _wait(operation) {
    // Closing settles outstanding adapter work even if a worker or callback is
    // still pending. Late resolutions cannot issue a challenge or receipt.
    return new Promise((resolve, reject) => {
      const signal = this.cancellation.signal;
      const cancelled = () => { cleanup(); reject(new Error('The local audio demo was cancelled.')); };
      const cleanup = () => signal.removeEventListener('abort', cancelled);
      signal.addEventListener('abort', cancelled, {once: true});
      Promise.resolve(operation).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
      if (signal.aborted) cancelled();
    });
  }

  _fail(error) {
    if (this.closed) return;
    this.close(); this.phase = 'failed';
    this.onFailure(error instanceof Error ? error : new Error(String(error)));
  }

  close() {
    if (this.closed) return;
    this.closed = true; this.phase = 'closed'; this.pending = null;
    clearTimeout(this.deadline); this.deadline = null; this.cancellation.abort();
  }
}

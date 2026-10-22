// SPDX-License-Identifier: AGPL-3.0-only
// Live audio coordination only. The caller supplies platform, persistence and
// lifecycle adapters; this module can run without a DOM or browser globals.
const PIN = /^[0-9a-f]{64}$/;
const json = value => JSON.stringify(value, null, 2);

export class AudioSession {
  #closed = false;
  #cleanupErrors = [];
  constructor({role, request = null, demo = false, pin, hints, pairingId, requesterPin,
    engine, identity, nativePlatform, captureFactory, nativeCaptureFactory,
    peerFactory, demoPeerFactory, evidenceFactory, persistence, authenticate, verifyFinalReceipt,
    clock = {seconds: () => Math.floor(Date.now() / 1000), monotonic: () => performance.now(),
      setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id)},
    lifecycle = {hidden: () => false, current: () => true},
    onState = () => {}, onReceipt = () => {}, onComplete = () => {}, onFailure = () => {},
    onVerification = () => {}, onNotice = () => {}, onConnected = () => {}}) {
    if (!['requester', 'operator'].includes(role) || (demo && role !== 'operator')) throw new Error('Unsupported audio session role.');
    Object.assign(this, {role, request, demo, pin, hints, pairingId, requesterPin, engine, identity,
      nativePlatform, captureFactory, nativeCaptureFactory, persistence, authenticate, verifyFinalReceipt,
      clock, lifecycle, onState, onReceipt, onComplete, onFailure, onVerification, onNotice, onConnected});
    this.phase = demo ? 'connected' : 'pairing'; this.cancelled = false; this.queue = Promise.resolve();
    this.rounds = []; this.challenges = []; this.chunks = []; this.expected = 0; this.messagePending = 0; this.chunkPending = false;
    if (role === 'requester') this.evidence = evidenceFactory(engine, pin, hints);
    const callbacks = {
      onMessage: message => {
        if (this.phase === 'done') { this.peer.close(); return; }
        if (++this.messagePending > 2) return this.fail(new Error('Too many pending live messages.'));
        this.#enqueue(async () => { try { await this.#message(message); } finally { this.messagePending--; } });
      },
      onChunk: (index, bytes) => {
        const arrived = this.clock.monotonic();
        this.#enqueue(async () => { try { await this.#receiveChunk(index, bytes, arrived); } finally { this.chunkPending = false; } });
      },
      onFailure: error => this.fail(error), onConnected: () => this.#connected(),
      authorizeChunk: index => {
        if (!this.isCurrent() || this.role !== 'requester' || this.phase !== 'recording' || this.chunkPending
            || index !== this.expected || index !== this.pendingRound?.index) return false;
        this.chunkPending = true; return true;
      },
      onArtifact: bytes => this.#receiveFinalWav(bytes),
      authorizeArtifact: () => {
        if (!this.isCurrent() || this.role !== 'requester' || this.phase !== 'awaiting-wav' || this.artifactPending) return false;
        this.artifactPending = true; return true;
      },
    };
    this.peer = demo ? demoPeerFactory({engine, request, ...callbacks,
      onReceipt: receipt => { this.active(); this.demoReceipt = receipt; }}) : peerFactory(callbacks);
    if (this.evidence) {
      const owner = this;
      this.answerImport = {role: 'requester', get phase() { return owner.phase; },
        get connected() { return owner.phase !== 'pairing'; }, prepareAnswerImport: () => owner.evidence.prepareAnswerImport()};
    }
  }
  isCurrent() { return !this.cancelled && this.lifecycle.current(); }
  active() { if (!this.isCurrent()) throw new Error('This audio session was cancelled.'); }
  checkLive() { this.active(); if (this.lifecycle.hidden() || !this.request || this.clock.seconds() >= this.request.expires_at) throw new Error('The capture window expired or the screen was closed.'); }
  elapsed(at = this.clock.monotonic()) { return Math.max(0, Math.round(at - this.baseTime)); }
  state(detail = '') { this.onState({phase: this.phase, detail}); }
  #enqueue(work) { this.queue = this.queue.then(async () => { this.active(); await work(); }).catch(error => this.fail(error)); }
  async offer() {
    this.active();
    if (this.role !== 'requester' || this.phase !== 'pairing') throw new Error('Only pre-challenge requester pairing can create an offer.');
    this.requesterPin = await this.evidence.identity(); this.active();
    const description = await this.peer.description('offer'); this.active();
    return {version: 2, type: 'nonverba-audio-offer', pairing_id: this.pairingId, requester_pin: this.requesterPin,
      operator_pin: this.pin, hints: this.hints, description};
  }
  async join(offer) {
    this.active();
    if (this.role !== 'operator' || this.phase !== 'pairing' || offer.pairing_id !== this.pairingId
        || offer.requester_pin !== this.requesterPin || offer.operator_pin !== this.pin) throw new Error('The offer belongs to a different pairing or identity.');
    const description = await this.peer.description('answer', offer.description); this.active();
    return {version: 2, type: 'nonverba-audio-answer', pairing_id: this.pairingId, requester_pin: this.requesterPin,
      operator_pin: this.pin, description};
  }
  async answer(answer) {
    this.active();
    if (this.role !== 'requester' || this.phase !== 'pairing' || answer.version !== 2 || answer.type !== 'nonverba-audio-answer'
        || answer.pairing_id !== this.pairingId || answer.requester_pin !== this.requesterPin || answer.operator_pin !== this.pin) throw new Error('The answer belongs to a different pairing or identity.');
    await this.peer.answer(answer.description); this.active();
    this.state('Connecting. Both devices must be reachable on the same local network.');
    this.watchdog = this.clock.setTimeout(() => { if (this.phase === 'pairing') this.fail(new Error('No direct route was found. Check local-network isolation; this preview has no relay service.')); }, 20000);
  }
  #connected() {
    if (!this.isCurrent()) return;
    this.onConnected(); this.clock.clearTimeout(this.watchdog); this.phase = 'authenticating';
    this.state(this.role === 'operator' ? 'Connected. Waiting for a fresh authenticated request.' : 'Connected. Creating and signing a fresh request.');
    if (this.role === 'requester') this.#enqueue(async () => {
      await this.evidence.start(message => {
        this.active(); this.request = message.request.request; this.sessionEnvelope = message.envelope;
        this.peer.send({type: 'session-request', pairing_id: this.pairingId, envelope: message.envelope});
      }); this.active(); this.phase = 'connected';
      this.state('Fresh signed request sent. Waiting for the operator’s microphone test.');
      this.watchdog = this.clock.setTimeout(() => this.fail(new Error('The complete signed recording missed its three-minute response deadline.')), 180000);
    });
  }
  async arm() {
    this.active();
    if (this.role !== 'operator' || this.phase !== 'connected') throw new Error('Connect before enabling the audio operator.');
    this.phase = 'testing'; this.state('Testing the microphone and high-frequency speaker path…');
    try {
      const native = this.nativePlatform();
      if (this.policy?.native_acquisition_required && !native) throw new Error('This requester requires Android monitored recording; browser capture is insufficient.');
      if (!this.demo && (native?.fingerprint || JSON.parse(this.identity()).fingerprint) !== this.pin) throw new Error('The operator signing identity changed after pairing.');
      this.nativeCapture = !!native;
      this.capture = native ? this.nativeCaptureFactory(native, this.request, error => this.fail(error)) : this.captureFactory(error => this.fail(error));
      await this.capture.open(); this.checkLive();
      if (!native) {
        const pilot = await this.engine.json('create_audio_round', json(this.request), 0, this.clock.seconds());
        const signal = await this.engine.call('audio_probe', pilot.session_id, pilot.index, pilot.nonce); this.checkLive();
        let samples;
        await this.capture.record(1, (_index, chunk) => { samples = chunk; }); this.checkLive(); this.capture.play(signal);
        await Promise.race([this.capture.finished, new Promise((_, reject) => { this.deadline = this.clock.setTimeout(() => reject(new Error('Microphone test timed out.')), 5000); })]);
        this.clock.clearTimeout(this.deadline); this.checkLive();
        const detection = await this.engine.json('detect_audio_probe', samples, pilot.session_id, 0, pilot.nonce); this.checkLive();
        if (!detection.detected || detection.offset_samples > 38400) throw new Error('The high-frequency test was not recovered. Check the built-in speaker, media volume, and microphone. This device may not support the required band.');
      }
      await this.persistence.reserveCapture(`audio:${this.request.session_id}`, {kind: 'audio', at: this.clock.seconds()}); this.checkLive();
      this.phase = 'ready'; this.peer.send({type: 'ready', fingerprint: JSON.parse(this.identity()).fingerprint});
      this.state(this.demo ? 'Speaker test passed. Starting the local demo…' : 'Speaker test passed. Waiting for the requester to start. Microphone access is active.');
      this.clock.clearTimeout(this.watchdog); this.watchdog = this.clock.setTimeout(() => this.fail(new Error('Recording was not started within one minute. Request a fresh session.')), 60000);
    } catch (error) { this.fail(error); }
  }
  async start() {
    this.checkLive();
    if (this.role !== 'requester' || this.phase !== 'ready') throw new Error('Wait for the connected operator to allow recording.');
    this.phase = 'recording'; this.startedAt = this.clock.seconds(); this.baseTime = this.clock.monotonic(); this.state();
    try { await this.#issueRound(0); } catch (error) { this.fail(error); }
  }
  async #issueRound(index) {
    this.checkLive();
    // A successor exists only after the preceding microphone bytes arrived.
    const round = await this.engine.json('create_audio_round', json(this.request), index, this.clock.seconds()); this.checkLive();
    if (index === 0) { this.startedAt = this.clock.seconds(); this.baseTime = this.clock.monotonic(); }
    this.pendingRound = {...round, issued_elapsed_ms: index === 0 ? 0 : this.elapsed()};
    this.peer.send({type: 'round', ...round}); this.clock.clearTimeout(this.deadline);
    this.deadline = this.clock.setTimeout(() => this.fail(new Error('An audio segment missed its live receipt deadline. Request a new recording.')), this.request.round_deadline_ms + 50);
    this.state(`Recording ${this.request.duration_secs} seconds · challenge ${index + 1}/${this.request.duration_secs / 2} sent.`);
  }
  async #receiveChunk(index, bytes, arrived) {
    this.checkLive();
    if (this.role !== 'requester' || this.phase !== 'recording' || !this.pendingRound || index !== this.expected || index !== this.pendingRound.index) throw new Error('Unexpected, repeated, or out-of-order audio segment.');
    const received = this.elapsed(arrived), issued = this.pendingRound.issued_elapsed_ms;
    if (received < issued || received - issued > this.request.round_deadline_ms) throw new Error('The audio segment arrived after its deadline.');
    if (received < (index + 1) * 2000 - 100) throw new Error('Audio arrived too quickly to satisfy the requested continuous recording duration.');
    this.clock.clearTimeout(this.deadline);
    const pcm = await this.engine.call('decode_audio_pcm', bytes);
    const hash = await this.engine.call('hash_audio_pcm', pcm); this.checkLive();
    this.rounds.push({index, nonce: this.pendingRound.nonce, issued_elapsed_ms: issued, received_elapsed_ms: received, pcm_sha256: hash, start_sample: index * 96000, sample_count: 96000});
    this.expected++; this.pendingRound = null;
    if (this.expected < this.request.duration_secs / 2) { await this.#issueRound(this.expected); return; }
    this.phase = 'retaining';
    const transcript = {version: 1, session_id: this.request.session_id, started_at: this.startedAt, completed_at: this.clock.seconds(), total_samples: this.request.duration_secs * 48000, rounds: this.rounds};
    const receipt = {version: 1, type: 'nonverba-audio-receipt', request: this.request, transcript};
    await this.persistence.retainReceipt(receipt); this.active(); this.receipt = receipt; this.onReceipt(receipt);
    this.evidence.retainTranscript(receipt); this.active(); this.phase = 'awaiting-wav';
    this.peer.send({type: 'receipt', receipt});
    this.state('All audio segments retained. Waiting for the complete signed WAV before final verification.');
  }
  #receiveFinalWav(bytes) {
    try {
      this.checkLive();
      if (this.role !== 'requester' || this.phase !== 'awaiting-wav' || !this.artifactPending) throw new Error('Unexpected final WAV.');
      this.phase = 'verifying-wav';
      const pending = this.evidence.receive(bytes); // Arrival precedes callbacks or asynchronous UI work.
      this.state('Final signed WAV received. Checking the file, retained audio transcript and requester policy…');
      pending.then(result => {
        this.active(); this.clock.clearTimeout(this.watchdog); this.wav = bytes; this.finalBundle = this.evidence.bundle(); this.phase = 'done';
        this.onComplete({role: this.role, bytes, bundle: this.finalBundle, report: result.report}); this.state();
        try { this.peer.send({type: 'final-receipt', receipt: result.receipt}); }
        catch { this.onNotice('The WAV and requester receipt are verified and retained locally. The operator connection closed before the receipt could be returned.'); }
        this.watchdog = this.clock.setTimeout(() => this.peer.close(), 30000);
        this.state('Complete signed WAV verified against the original request and retained microphone segments.');
      }).catch(error => this.fail(error));
    } catch (error) { this.fail(error); }
  }
  async #message(message) {
    this.active();
    if (message.type === 'abort') { this.fail(new Error('The other participant stopped the session.'), false); return; }
    if (this.role === 'requester') {
      if (message.type === 'receipt-ack' && ['awaiting-wav', 'verifying-wav'].includes(this.phase) && !this.receiptAcknowledged) { this.receiptAcknowledged = true; return; }
      if (message.type !== 'ready' || this.phase !== 'connected' || message.fingerprint !== this.pin) throw new Error('Operator identity mismatch or unexpected ready message.');
      this.phase = 'ready'; this.state('Operator connected and speaker test passed. Ready to start.'); return;
    }
    if (message.type === 'session-request') {
      if (this.demo || this.phase !== 'authenticating' || message.pairing_id !== this.pairingId) throw new Error('Unexpected or replayed signed audio request.');
      const payload = await this.authenticate(this.engine, message.envelope, this.requesterPin, this.pin, this.hints); this.active();
      const consumed = await this.persistence.readCapture(`audio:${payload.spec.evidence.request.session_id}`); this.active();
      if (consumed) throw new Error('This request was already used on this device. Ask for a fresh request.');
      this.request = payload.spec.evidence.request; this.policy = payload.spec.policy; this.sessionEnvelope = message.envelope;
      if (this.policy.native_acquisition_required && !this.nativePlatform()) throw new Error('This request requires Android monitored recording. Browser capture cannot satisfy it.');
      this.phase = 'connected'; this.state('Fresh requester signature and task verified. Enable the microphone and test the speaker.');
      this.watchdog = this.clock.setTimeout(() => this.fail(new Error('The operator did not begin within the fresh request window.')), 60000); return;
    }
    if (message.type === 'final-receipt') {
      if (this.demo || this.phase !== 'awaiting-final-receipt' || !this.wav || !this.operatorTranscript) throw new Error('Unexpected final requester receipt.');
      await this.verifyFinalReceipt(this.engine, message.receipt, this.sessionEnvelope, this.wav, this.operatorTranscript, this.requesterPin); this.checkLive();
      this.clock.clearTimeout(this.watchdog); this.phase = 'done'; this.onComplete({role: this.role, bytes: this.wav});
      this.state('The requester received and verified this exact signed WAV.');
      try { this.peer.send({type: 'final-receipt-ack'}); } catch {}
      this.peer.close(); return;
    }
    if (message.type === 'round') {
      this.checkLive(); const index = this.challenges.length;
      if (!['ready', 'recording'].includes(this.phase) || message.session_id !== this.request.session_id || message.index !== index || index >= this.request.duration_secs / 2 || !PIN.test(message.nonce) || this.challenges.some(round => round.nonce === message.nonce)) throw new Error('Invalid, repeated, or out-of-order requester challenge.');
      if (this.nativeCapture) {
        if (index === 0) { this.clock.clearTimeout(this.watchdog); this.phase = 'recording'; this.watchdog = this.clock.setTimeout(() => this.fail(new Error('The requester did not complete the live session.')), this.request.duration_secs * 1000 + 7000); }
        this.challenges.push({index, nonce: message.nonce});
        this.capture.round(message, async (chunkIndex, bytes) => {
          this.checkLive();
          if (chunkIndex !== this.chunks.length || chunkIndex >= this.challenges.length) throw new Error('Native microphone segment has no matching live challenge.');
          this.chunks.push(null); await this.peer.sendChunk(chunkIndex, bytes); this.checkLive();
        });
        this.state(`Recording continuously · challenge ${index + 1}/${this.request.duration_secs / 2} sent to the native speaker.`); return;
      }
      const signal = await this.engine.call('audio_probe', message.session_id, index, message.nonce); this.checkLive();
      if (index === 0) {
        this.clock.clearTimeout(this.watchdog); this.phase = 'recording'; this.sendQueue = Promise.resolve();
        await this.capture.record(this.request.duration_secs / 2, (chunkIndex, samples) => {
          if (this.cancelled) return;
          this.chunks.push(samples);
          this.sendQueue = this.sendQueue.then(async () => { this.checkLive();
            if (chunkIndex >= this.challenges.length) throw new Error('No fresh challenge arrived for this audio segment.');
            const encoded = await this.engine.call('encode_audio_pcm', samples); this.checkLive(); await this.peer.sendChunk(chunkIndex, encoded);
          }).catch(error => this.fail(error));
        });
        this.watchdog = this.clock.setTimeout(() => this.fail(new Error('The requester did not complete the live session.')), this.request.duration_secs * 1000 + 7000);
      }
      const offset = this.capture.position() - index * 96000;
      if (offset < 0 || offset > 36000) throw new Error('The next challenge arrived too late for its continuous recording segment.');
      this.challenges.push({index, nonce: message.nonce}); this.capture.play(signal);
      this.state(`Recording continuously · challenge ${index + 1}/${this.request.duration_secs / 2} played.`); return;
    }
    if (message.type === 'receipt') {
      this.checkLive();
      if (this.phase !== 'recording' || this.chunks.length !== this.request.duration_secs / 2 || this.challenges.length !== this.chunks.length) throw new Error('Recording is incomplete.');
      const received = message.receipt, receiptType = this.demo ? 'nonverba-audio-demo-receipt' : 'nonverba-audio-receipt';
      if (received?.version !== 1 || received.type !== receiptType || json(received.request) !== json(this.request) || received.transcript?.rounds?.length !== this.challenges.length || received.transcript.rounds.some((round, i) => round.index !== i || round.nonce !== this.challenges[i].nonce)) throw new Error('The receipt does not match the live challenges.');
      this.peer.send({type: 'receipt-ack'}); if (this.demo) this.peer.close();
      this.operatorTranscript = structuredClone(received.transcript); this.clock.clearTimeout(this.watchdog);
      this.phase = 'signing'; this.state('Checking all challenge responses and signing the original WAV…');
      let bytes;
      if (this.nativeCapture) { bytes = await this.capture.finalize(received); this.checkLive(); this.capture.close(); }
      else {
        this.capture.close();
        const pcm = new Float32Array(this.request.duration_secs * 48000); this.chunks.forEach((chunk, i) => pcm.set(chunk, i * 96000));
        bytes = await this.engine.call('seal_audio', pcm, this.identity(), json(this.request), json(received.transcript), this.clock.seconds()); this.checkLive();
      }
      if (this.demo || this.nativeCapture) {
        const checked = await this.engine.json('verify_audio', bytes, json(this.request), json(received.transcript), JSON.parse(this.identity()).fingerprint, this.clock.seconds()); this.checkLive();
        if (!checked.verified || !!checked.demo !== this.demo || (this.nativeCapture && checked.checks.native_audio_metadata_valid !== true)) throw new Error('The recording did not pass local verification.');
        this.onVerification(checked);
      }
      this.wav = bytes; this.phase = this.demo ? 'done' : 'awaiting-final-receipt'; this.chunks = [];
      this.onComplete({role: this.role, bytes, demo: this.demo, awaitingReceipt: !this.demo});
      if (!this.demo) {
        this.watchdog = this.clock.setTimeout(() => this.fail(new Error('The requester did not verify the complete signed WAV before the delivery deadline.')), 30000);
        this.state('Delivering the final signed WAV and waiting for its verified requester receipt…');
        await this.peer.sendArtifact(bytes); this.checkLive();
      } else this.state('Demo complete. Acoustic challenges and signed WAV verified locally.');
      this.state(); return;
    }
    throw new Error('Unexpected live audio message.');
  }
  async accept(stillCurrent) {
    this.active();
    if (this.role !== 'requester' || this.demo || this.phase !== 'done' || !this.finalBundle || typeof stillCurrent !== 'function') throw new Error('Only completed requester evidence can be accepted.');
    const guard = () => this.isCurrent() && !this.lifecycle.hidden() && stillCurrent();
    const accepted = await this.evidence.accept(guard);
    if (!guard()) throw new Error('Audio acceptance was cancelled.');
    this.accepted = accepted; this.state(); return accepted;
  }
  suspend() {
    if (!['done', 'failed'].includes(this.phase)) this.fail(new Error('Session stopped because the app left the foreground.'));
  }
  /** Unsigned disposal diagnostics; never inputs to evidence verification. */
  get cleanupErrors() { return this.#cleanupErrors.map(value => ({...value})); }
  #release(resource, action) {
    try { action(); }
    catch (error) {
      if (this.#cleanupErrors.length < 8) this.#cleanupErrors.push({resource, error: String(error?.message || error).slice(0, 400)});
    }
  }
  close() {
    // Revoke authority before any platform release can throw or call back.
    this.cancelled = true;
    if (this.#closed) return;
    this.#closed = true;
    this.#release('segment deadline', () => this.clock.clearTimeout(this.deadline));
    this.#release('session watchdog', () => this.clock.clearTimeout(this.watchdog));
    this.#release('capture', () => this.capture?.close());
    this.#release('peer', () => this.peer?.close());
    this.#release('requester evidence', () => this.evidence?.close());
  }
  fail(error, inform = true) {
    if (!this.isCurrent() || this.phase === 'failed') return;
    if (this.phase === 'done') { this.#release('completed peer', () => this.peer?.close()); return; }
    if (inform) { try { this.peer.send({type: 'abort'}); } catch {} }
    this.phase = 'failed'; this.close(); this.chunks = []; this.wav = null; this.receipt = null; this.finalBundle = null; this.operatorTranscript = null;
    try { this.onFailure(error); }
    finally { this.state('Session stopped. No requester-verified evidence was completed.'); }
  }
}

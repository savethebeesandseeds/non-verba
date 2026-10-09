// SPDX-License-Identifier: AGPL-3.0-only
// Reusable, independent workflow. Every authentication lifecycle and reuse
// decision is made by Rust. Platform capture never validates a human identity.
export class AuthenticationWorkflow {
  constructor({engine, privacy, clock, captureFactory, faceReferenceIdProvider = null, onChange = () => {}} = {}) {
    if (!engine?.json || !privacy) throw new Error('Rust policy and privacy orchestration are required.');
    this.engine = engine;
    this.privacy = privacy;
    this.clock = clock ?? privacy.clock;
    this.captureFactory = captureFactory;
    this.faceReferenceIdProvider = faceReferenceIdProvider;
    this.onChange = onChange;
    this.result = null;
    this.capture = null;
    this.media = null;
    this.epoch = 0;
    this.sequence = 0;
    this.finishing = false;
    this.queue = Promise.resolve();
    this.faceReport = null;
  }
  policy(method, input) { return this.engine.json(method, JSON.stringify(input)); }
  snapshot() {
    return {result: this.result ? structuredClone(this.result) : null,
      has_local_media: !!this.media?.blob, media_kind: this.media?.kind ?? null,
      face_report: this.faceReport ? structuredClone(this.faceReport) : null,
      simulation: true, identity_validation_implemented: false};
  }
  notify() { this.onChange(this.snapshot()); }

  async present({context, mode, policyId, reuseScope = 'account', validitySecs = 300}) {
    const cleanup = this.cancel('replaced');
    const token = this.epoch;
    await cleanup;
    if (token !== this.epoch) throw new Error('Authentication requirement was replaced.');
    const now = this.clock.seconds();
    const response = await this.policy('authentication_create', {now_secs: now,
      operation_id: `authentication-${++this.sequence}`, context, mode, policy_id: policyId,
      reuse_scope: reuseScope, expires_at: now + validitySecs, simulation: true});
    if (token !== this.epoch) throw new Error('Authentication requirement was replaced.');
    if (!response.accepted) throw new Error(response.reason);
    this.error = null;
    this.result = response.result;
    this.media = null;
    this.faceReport = null;
    this.notify();
    return this.snapshot();
  }

  apply(action, {deliberate = false, token = this.epoch, rejectOnDenial = true} = {}) {
    const run = async () => {
      if (token !== this.epoch) throw new Error('Authentication action was replaced.');
      if (!this.result) throw new Error('Present an authentication requirement first.');
      const operationId = this.result.operation_id;
      const response = await this.policy('authentication_transition', {now_secs: this.clock.seconds(),
        result: this.result, action, deliberate});
      if (token !== this.epoch || operationId !== this.result?.operation_id)
        throw new Error('A newer privacy or authentication action replaced this result.');
      this.result = response.result;
      this.notify();
      if (!response.accepted && rejectOnDenial) throw new Error(response.reason);
      return response;
    };
    const response = this.queue.then(run);
    this.queue = response.catch(() => {});
    return response;
  }

  async start({deliberate = false, captureKind = 'synthetic', leaseSecs = 30} = {}) {
    const token = this.epoch;
    const response = await this.apply('start', {deliberate, token});
    if (response.result.mode === 'requester') return this.snapshot();
    const result = this.result;
    try {
      const adapter = this.captureFactory({kind: captureKind});
      const handle = await this.privacy.startSensor({deviceId: result.context.device_id,
        accountId: result.context.account_id,
        operationId: result.operation_id, sensor: 'camera', purpose: 'authentication', deliberate, leaseSecs},
      () => ({
        close: async reason => {
          if (!this.finishing && token === this.epoch) {
            this.epoch++;
            this.media = null;
            void this.setTerminal(reason === 'expired' ? 'expire' : 'cancel', result.operation_id).catch(error => this.recordError(error));
          }
          return adapter.close(reason);
        },
        stopped: () => adapter.stopped(),
      }));
      if (token !== this.epoch) { await handle.close('cancelled'); throw new Error('Authentication was cancelled.'); }
      this.capture = {handle, adapter, token, kind: captureKind};
      await adapter.open({current: () => token === this.epoch && handle.current(), signal: handle.signal,
        onInterrupted: reason => { void this.cancel(reason, 'fail').catch(error => this.recordError(error)); }});
      if (token !== this.epoch || !handle.current()) throw new Error('Authentication camera was cancelled.');
      this.notify();
      return this.snapshot();
    } catch (error) {
      if (token === this.epoch) await this.cancel('capture failure', 'fail');
      throw error;
    }
  }

  async completeCapture() {
    const capture = this.capture;
    if (!capture || capture.token !== this.epoch || !capture.handle.current()) throw new Error('No active authentication capture.');
    try {
      const media = await capture.adapter.capture();
      if (capture.token !== this.epoch || !capture.handle.current()) throw new Error('Authentication capture was cancelled.');
      await this.apply('capture_complete', {token: capture.token});
      this.finishing = true;
      const stopped = await capture.handle.close('capture completed');
      this.finishing = false;
      if (!stopped) throw new Error('Authentication capture completed, but camera shutdown is unconfirmed.');
      if (capture.token !== this.epoch) throw new Error('A newer privacy action cancelled this capture.');
      if (this.privacy.device(this.result.context.device_id).state.revision !== capture.handle.authorization.revision)
        throw new Error('A newer privacy decision cancelled this capture.');
      this.capture = null;
      this.media = media;
      this.notify();
      return this.snapshot();
    } catch (error) {
      this.finishing = false;
      if (capture.token === this.epoch) await this.cancel('capture failure', 'fail');
      throw error;
    }
  }

  async setTerminal(action, operationId = this.result?.operation_id) {
    if (!this.result || this.result.operation_id !== operationId) return;
    const token = this.epoch;
    try { await this.apply(action, {token, rejectOnDenial: false}); }
    catch (error) {
      if (token === this.epoch && this.result?.operation_id === operationId) throw error;
    }
  }

  async cancel(reason = 'cancelled', action = 'cancel') {
    this.epoch++;
    this.media = null;
    this.faceReport = null;
    const capture = this.capture;
    this.capture = null;
    // Changing the epoch invalidates capture callbacks before awaiting cleanup.
    const closing = capture?.handle.close(reason);
    await this.setTerminal(action);
    if (closing) await closing;
    this.notify();
  }

  async simulateSuccess() {
    if (this.capture) throw new Error('Confirm camera cleanup before simulating a validator verdict.');
    const response = await this.apply('simulate_success');
    // Core carries the immutable simulation interpretation to every caller;
    // there is no public method to manufacture validated_success here.
    return response.result;
  }

  async assess({context, requirement}) {
    const token = this.epoch, result = this.result, faceReport = this.faceReport;
    const selectedContext = structuredClone(context), selectedRequirement = structuredClone(requirement);
    const current = () => token === this.epoch && result === this.result && faceReport === this.faceReport;
    const checkReference = async () => {
      if (selectedRequirement.mode !== 'operator' || !selectedRequirement.face_required || !this.faceReferenceIdProvider) return;
      const id = await this.faceReferenceIdProvider(selectedContext);
      if (id !== (selectedRequirement.face_reference_id ?? null))
        throw new Error('The Operator face reference changed; repeat the comparison and requirement check.');
    };
    await checkReference();
    if (!current()) throw new Error('Authentication assessment was replaced.');
    const assessment = await this.policy('authentication_assess', {now_secs: this.clock.seconds(),
      context: selectedContext, requirement: selectedRequirement, result,
      ...(selectedRequirement.mode === 'operator' && faceReport ? {face_report: faceReport} : {})});
    await checkReference();
    if (!current()) throw new Error('Authentication assessment was replaced.');
    return assessment;
  }

  setFaceReport(report, {operationId, epoch} = {}) {
    if (this.result?.mode !== 'operator') throw new Error('Requester authentication has no face comparison.');
    if (operationId !== this.result.operation_id || epoch !== this.epoch) return {stale: true};
    this.faceReport = structuredClone(report);
    this.notify();
    return {attached: true};
  }

  clearFaceReport() { this.faceReport = null; this.notify(); }

  clearMedia() { this.media = null; this.notify(); }
  recordError(error) { this.error = String(error?.message || error); this.notify(); }
}

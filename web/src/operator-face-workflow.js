// SPDX-License-Identifier: AGPL-3.0-only
// Operator-only continuity checks. Camera authority belongs to the existing
// bounded authentication workflow; matching supplies no work or presence grant.
import {faceReferenceSummary} from './face-reference-store.js';

export function createOperatorFaceWorkflow(options) { return new OperatorFaceWorkflow(options); }
export class OperatorFaceWorkflow {
  constructor({engine, authentication, model, referenceStore, context, onChange = () => {}} = {}) {
    if (!engine?.json || !authentication || !model || !referenceStore) throw new Error('Face policy, capture, model and local reference adapters are required.');
    this.engine = engine; this.authentication = authentication; this.model = model;
    this.referenceStore = referenceStore; this.context = context; this.onChange = onChange;
    this.status = 'idle'; this.error = null; this.comparison = null; this.referenceSummary = null;
    this.features = null; this.captureBinding = null; this.epoch = 0; this.busy = false;
  }
  snapshot() {
    return {status: this.status, error: this.error, comparison: this.comparison ? structuredClone(this.comparison) : null,
      reference_summary: this.referenceSummary ? structuredClone(this.referenceSummary) : null,
      model_version: this.model.spec?.version ?? null, has_features: !!this.features,
      simulation: true, authenticated: false, identity_verified: false, operator_presence_verified: false,
      liveness: 'unresolved', trusted_capture: 'unresolved', work_authority_granted: false};
  }
  notify() { this.onChange(this.snapshot()); }
  stale(token) {
    if (token === this.epoch) { this.clearFeatures(); this.status = 'cancelled'; this.notify(); }
    return {stale: true};
  }
  getContext() {
    const result = this.authentication.result;
    if (result && result.mode !== 'operator') throw new Error('Requesters do not use a face workflow.');
    const context = result?.context ?? this.context;
    if (!context?.account_id || !context?.principal_id || !context?.device_id) throw new Error('An Operator account context is required.');
    return structuredClone(context);
  }
  clearFeatures() {
    this.features?.embedding?.fill?.(0); this.features = null; this.captureBinding = null;
    this.comparison = null; this.authentication.clearFaceReport?.();
  }
  fresh(token, captured = this.captureBinding) {
    const result = this.authentication.result;
    return token === this.epoch && !!captured && captured.authEpoch === this.authentication.epoch
      && captured.operationId === result?.operation_id && result?.mode === 'operator'
      && result.context.account_id === captured.context.account_id
      && result.context.principal_id === captured.context.principal_id
      && result.context.device_id === captured.context.device_id
      && this.authentication.clock.seconds() < result.expires_at
      && !['cancelled', 'expired', 'failed', 'denied', 'revoked'].includes(result.status)
      && this.authentication.privacy.device(captured.context.device_id).state.revision === captured.privacyRevision;
  }
  async refreshReference() {
    const token = this.epoch, context = this.getContext();
    let reference;
    try { reference = await this.referenceStore.read(context); }
    catch (error) {
      const id = await this.referenceStore.referenceId?.(context);
      if (token !== this.epoch) return {stale: true};
      if (id === undefined || id === null) throw error;
      this.referenceSummary = {...context, reference_id: id, unreadable: true, identity_verified: false};
      this.status = 'reference_unreadable'; this.error = String(error?.message || error); this.notify();
      return this.snapshot();
    }
    if (token !== this.epoch) return {stale: true};
    this.referenceSummary = faceReferenceSummary(reference); this.notify(); return this.snapshot();
  }
  async getReference() { return this.referenceStore.read(this.getContext()); }
  async start({deliberate = false, captureKind = 'browser-photo', leaseSecs = 30} = {}) {
    if (!deliberate) throw new Error('Deliberately start the Operator camera.');
    if (this.busy) throw new Error('Another face operation is still pending.');
    const token = ++this.epoch; this.clearFeatures(); this.error = null;
    this.status = 'capture_pending'; this.busy = true; this.notify();
    try {
      this.getContext();
      const result = this.authentication.result;
      if (!result || result.status !== 'requirement_presented') {
        await this.authentication.present({context: this.getContext(), mode: 'operator',
          policyId: 'operator-face-enrollment-inspection-v1', validitySecs: 300});
      }
      if (token !== this.epoch) return {stale: true};
      await this.authentication.start({deliberate, captureKind, leaseSecs});
      if (token !== this.epoch) return {stale: true};
      this.status = 'capture_active'; return this.snapshot();
    } catch (error) {
      if (token !== this.epoch) return {stale: true};
      this.status = 'capture_failure'; this.error = String(error?.message || error); throw error;
    } finally { if (token === this.epoch) { this.busy = false; this.notify(); } }
  }
  async completeCapture() {
    if (this.busy) throw new Error('Another face operation is still pending.');
    this.getContext();
    const token = ++this.epoch; this.clearFeatures(); this.busy = true; this.error = null;
    this.status = 'capture_pending'; this.notify();
    let media;
    try {
      const capture = this.authentication.capture;
      if (!capture) throw new Error('A fresh Operator camera capture is required.');
      const captured = {context: this.getContext(), operationId: this.authentication.result.operation_id,
        authEpoch: this.authentication.epoch, privacyRevision: capture.handle.authorization.revision};
      await this.authentication.completeCapture();
      media = this.authentication.media;
      if (!this.fresh(token, captured)) return this.stale(token);
      this.status = 'inference_pending'; this.notify();
      if (!media?.blob && !media?.pixels) throw Object.assign(new Error('Synthetic capture has no real face image; it cannot enroll or match.'), {code: 'capture_quality_failure'});
      const features = await this.model.extract(media, {current: () => this.fresh(token, captured)});
      if (!this.fresh(token, captured)) { features?.embedding?.fill?.(0); return this.stale(token); }
      if (features.quality !== 'accepted') throw Object.assign(new Error(features.reason || 'Face acquisition did not pass the capture quality checks.'), {code: 'capture_quality_failure'});
      this.features = features; this.captureBinding = captured;
      this.status = 'features_ready'; await this.refreshReference(); return this.snapshot();
    } catch (error) {
      if (token !== this.epoch) return {stale: true};
      this.clearFeatures(); this.status = error?.code === 'model_unavailable' ? 'model_unavailable' : 'capture_quality_failure';
      this.error = String(error?.message || error); throw error;
    } finally {
      if (media && this.authentication.media === media) this.authentication.clearMedia();
      if (token === this.epoch) { this.busy = false; this.notify(); }
    }
  }
  input() {
    if (!this.features || !this.fresh(this.epoch)) throw new Error('A current, quality-accepted face capture is required.');
    return {now_secs: this.authentication.clock.seconds(), mode: 'operator',
      context: this.captureBinding.context, operation_id: this.captureBinding.operationId,
      model: this.model.spec, embedding: Array.from(this.features.embedding), quality: 'accepted',
      model_available: true, simulation: true};
  }
  async enroll({deliberate = false, replace = false, retentionConsent = false, reviewed = false} = {}) {
    if (!deliberate || !retentionConsent || !reviewed) throw new Error('Review the capture and deliberately consent to retaining the local face reference.');
    if (this.busy) throw new Error('Another face operation is still pending.');
    const token = this.epoch, input = this.input(), reviewedId = this.referenceSummary?.reference_id ?? null;
    this.busy = true; this.error = null;
    const retention = new AbortController(); this.retention = retention; this.notify();
    try {
      const currentId = this.referenceStore.referenceId ? await this.referenceStore.referenceId(input.context)
        : (await this.referenceStore.read(input.context))?.reference_id ?? null;
      if (currentId !== reviewedId) {
        if (!this.fresh(token)) return this.stale(token);
        await this.refreshReference();
        if (!this.fresh(token)) return this.stale(token);
        this.clearFeatures(); this.status = 'reference_changed';
        throw new Error('The retained reference changed after capture review. Review it and capture again before enrollment or replacement.');
      }
      if (currentId !== null && !replace) throw new Error('A face reference is already retained; select Replace after reviewing the new capture.');
      if (!this.fresh(token)) return this.stale(token);
      const report = await this.engine.json('face_identity_enroll', JSON.stringify({...input,
        reference_id: globalThis.crypto.randomUUID(), deliberate, consent: retentionConsent}));
      if (!this.fresh(token)) return this.stale(token);
      if (!report.reference) { this.status = report.status; throw new Error(report.status); }
      await this.referenceStore.write(report.reference, {replace, expectedReferenceId: currentId,
        consent: retentionConsent, current: () => this.fresh(token), signal: retention.signal});
      // A completed retention operation persists by explicit choice, independently
      // of transient capture cancellation. Never silently roll it back or replace it.
      if (!this.fresh(token)) return this.stale(token);
      this.referenceSummary = faceReferenceSummary(report.reference); this.status = 'reference_enrolled';
      this.clearFeatures(); return this.snapshot();
    } catch (error) {
      if (token !== this.epoch) return {stale: true};
      this.error = String(error?.message || error); throw error;
    } finally {
      if (this.retention === retention) this.retention = null;
      if (token === this.epoch) { this.busy = false; this.notify(); }
    }
  }
  async compare({threshold = null} = {}) {
    if (this.busy) throw new Error('Another face operation is still pending.');
    this.comparison = null; this.authentication.clearFaceReport?.();
    const token = this.epoch; this.busy = true; this.error = null; this.status = 'comparison_pending'; this.notify();
    try {
      const input = this.input();
      const reference = await this.referenceStore.read(input.context);
      if (!this.fresh(token)) return this.stale(token);
      const report = await this.engine.json('face_identity_assess', JSON.stringify({...input, reference, threshold}));
      if (!this.fresh(token)) return this.stale(token);
      const latest = await this.referenceStore.read(input.context);
      if (!this.fresh(token)) return this.stale(token);
      if (latest?.reference_id !== reference?.reference_id) {
        this.authentication.clearFaceReport?.(); this.comparison = null; this.status = 'reference_changed';
        this.referenceSummary = faceReferenceSummary(latest); return this.snapshot();
      }
      this.referenceSummary = faceReferenceSummary(reference);
      const {reference: ignoredReference, embedding: ignoredEmbedding, ...safeReport} = report;
      this.comparison = safeReport; this.status = report.status;
      this.authentication.setFaceReport?.(safeReport, {operationId: this.captureBinding.operationId, epoch: this.captureBinding.authEpoch});
      return this.snapshot();
    } catch (error) {
      if (token !== this.epoch) return {stale: true};
      this.status = 'comparison_failure'; this.error = String(error?.message || error); throw error;
    } finally { if (token === this.epoch) { this.busy = false; this.notify(); } }
  }
  async deleteReference({deliberate = false} = {}) {
    if (!deliberate) throw new Error('Deliberately delete the retained reference.');
    const context = this.getContext(), reviewedId = this.referenceSummary?.reference_id ?? null, token = this.epoch + 1;
    await this.cancel();
    if (token !== this.epoch) return {stale: true};
    const currentId = this.referenceStore.referenceId ? await this.referenceStore.referenceId(context)
      : (await this.referenceStore.read(context))?.reference_id ?? null;
    if (token !== this.epoch) return {stale: true};
    if (currentId !== reviewedId) {
      await this.refreshReference();
      if (token !== this.epoch) return {stale: true};
      this.status = 'reference_changed';
      this.error = 'The retained reference changed after review. Review the current reference before deleting it.';
      this.notify(); throw new Error(this.error);
    }
    await this.referenceStore.delete(context, {deliberate, expectedReferenceId: currentId});
    if (token !== this.epoch) return {stale: true};
    this.referenceSummary = null; this.status = 'reference_deleted'; this.notify(); return this.snapshot();
  }
  async cancel(reason = 'cancelled') {
    const token = ++this.epoch; this.retention?.abort(); this.busy = false; this.clearFeatures(); this.error = null;
    await this.authentication.cancel(reason);
    if (token === this.epoch) { this.status = 'cancelled'; this.notify(); }
  }
  async close() {
    try { await this.cancel('page lifecycle loss'); }
    finally { try { await this.model.close?.(); } finally { await this.referenceStore.close?.(); } }
  }
}

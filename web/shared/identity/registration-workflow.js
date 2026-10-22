// SPDX-License-Identifier: AGPL-3.0-only
// Memory-only registration orchestration. Rust validates details, disclosures,
// sharing preferences and exact-review preparation. No account or identity is
// created here, and no platform sensor or persistence adapter is involved.
export function emptyRegistrationDraft(role = 'operator') {
  return {role, revision: 0,
    personal: {display_name: '', contact_email: '', legal_name: '', organization: '', country: '', preferred_language: ''},
    accommodations: {note: '', share_with_task_counterparty: false}, certifications: [],
    acknowledgments: {private_data_handling: false, self_reported_certifications: false},
    sharing: {publish_display_name: false, publish_organization: false}};
}
const emptyCertification = () => ({title: '', issuer: '', reference: '', issued_on: '', expires_on: '', share_with_task_counterparty: false});

export class RegistrationWorkflow {
  #draft;
  #facePolicy = null;
  #faceReference = null;
  constructor({engine, role = 'operator', faceReferenceProvider = null, onChange = () => {}} = {}) {
    if (!engine?.json) throw new Error('A Rust registration policy engine is required.');
    this.engine = engine;
    this.faceReferenceProvider = faceReferenceProvider;
    this.onChange = onChange;
    this.#draft = emptyRegistrationDraft(role);
    this.reviewedRevision = null;
    this.assessment = null;
    this.preparation = null;
    this.epoch = 0;
    this.request = 0;
  }
  get draft() { return structuredClone(this.#draft); }
  snapshot() {
    return {draft: this.draft, reviewed_revision: this.reviewedRevision,
      assessment: this.assessment ? structuredClone(this.assessment) : null,
      preparation: this.preparation ? structuredClone(this.preparation) : null,
      face_policy: this.#facePolicy ? structuredClone(this.#facePolicy) : null,
      face_enrollment: this.#faceReference ? {reference_id: this.#faceReference.reference_id,
        account_id: this.#faceReference.account_id, principal_id: this.#faceReference.principal_id,
        enrolled_device_id: this.#faceReference.enrolled_device_id, enrolled_at: this.#faceReference.enrolled_at,
        model: structuredClone(this.#faceReference.model), simulation: this.#faceReference.simulation,
        enrollment_continuity_only: true} : null,
      memory_only: true, simulation: true};
  }
  notify() { this.onChange(this.snapshot()); }
  edit(change) {
    if (this.#draft.revision >= 0xffffffff) throw new Error('Reset the draft before making more edits.');
    const draft = this.draft;
    change(draft);
    draft.revision++;
    this.epoch++;
    this.#draft = draft;
    this.reviewedRevision = null;
    this.assessment = null;
    this.preparation = null;
    this.notify();
  }
  setRole(role) {
    if (role === 'requester') { this.#facePolicy = null; this.#faceReference = null; }
    this.edit(draft => { draft.role = role; });
  }
  setFacePolicy(policy) {
    if (policy && this.#draft.role !== 'operator') throw new Error('Requester registration has no face policy.');
    this.#facePolicy = policy ? structuredClone(policy) : null;
    this.#faceReference = null;
    this.edit(() => {});
  }
  setFaceReference(reference) {
    if (reference && this.#draft.role !== 'operator') throw new Error('Requester registration has no face enrollment.');
    this.#faceReference = reference ? structuredClone(reference) : null;
    this.edit(() => {});
  }
  setField(section, field, value) {
    if (!['personal', 'accommodations', 'acknowledgments', 'sharing'].includes(section)
      || !Object.hasOwn(this.#draft[section], field)) throw new Error('Unknown registration field.');
    this.edit(draft => { draft[section][field] = value; });
  }
  addCertification() {
    const index = this.#draft.certifications.length;
    this.edit(draft => { draft.certifications.push(emptyCertification()); });
    return index;
  }
  setCertification(index, field, value) {
    if (!this.#draft.certifications[index] || !Object.hasOwn(emptyCertification(), field))
      throw new Error('Unknown certification field.');
    this.edit(draft => { draft.certifications[index][field] = value; });
  }
  removeCertification(index) {
    if (!this.#draft.certifications[index]) throw new Error('Unknown certification row.');
    this.edit(draft => { draft.certifications.splice(index, 1); });
  }

  async evaluate(method, {review = false, deliberate = false} = {}) {
    const epoch = this.epoch, request = ++this.request, revision = this.#draft.revision;
    const current = () => epoch === this.epoch && request === this.request && revision === this.#draft.revision;
    const refreshEnabled = this.#draft.role === 'operator' && this.#facePolicy && this.faceReferenceProvider;
    const refreshReference = async () => {
      let reference;
      try { reference = await this.faceReferenceProvider(structuredClone(this.#facePolicy)); }
      catch (error) {
        if (!current()) return 'stale';
        // An unreadable store cannot leave a previously prepared enrollment
        // accepted. Clearing the selection also invalidates its old review.
        this.setFaceReference(null);
        throw error;
      }
      if (!current()) return 'stale';
      if (JSON.stringify(reference ?? null) !== JSON.stringify(this.#faceReference)) {
        this.setFaceReference(reference ?? null);
        return 'changed';
      }
      return 'current';
    };
    if (refreshEnabled) {
      const refreshed = await refreshReference();
      if (refreshed !== 'current') return {stale: true, ...(refreshed === 'changed' ? {reference_changed: true} : {})};
      if (!current()) return {stale: true};
    }
    const input = {draft: this.draft,
      reviewed_revision: review ? revision : this.reviewedRevision, deliberate,
      ...(this.#draft.role === 'operator' && this.#facePolicy ? {face_policy: structuredClone(this.#facePolicy),
        face_reference: this.#faceReference ? structuredClone(this.#faceReference) : null} : {})};
    let result;
    try { result = await this.engine.json(method, JSON.stringify(input)); }
    catch (error) { if (!current()) return {stale: true}; throw error; }
    if (!current())
      return {stale: true};
    // A different tab may delete or replace the reference while Rust evaluates
    // this draft. The old reply must never accept that removed enrollment.
    if (refreshEnabled) {
      const refreshed = await refreshReference();
      if (refreshed !== 'current') return {stale: true, ...(refreshed === 'changed' ? {reference_changed: true} : {})};
      if (!current()) return {stale: true};
    }
    this.assessment = result;
    if (review && result.valid_draft && result.review_current) this.reviewedRevision = revision;
    if (method === 'registration_prepare') this.preparation = result.prepared ? result : null;
    this.notify();
    return result;
  }
  assess() { return this.evaluate('registration_assess'); }
  review() { return this.evaluate('registration_assess', {review: true}); }
  prepare({deliberate = false} = {}) { return this.evaluate('registration_prepare', {deliberate}); }
  reset(role = 'operator') {
    this.epoch++;
    this.request++;
    this.#draft = emptyRegistrationDraft(role);
    this.#facePolicy = null;
    this.#faceReference = null;
    this.reviewedRevision = null;
    this.assessment = null;
    this.preparation = null;
    this.notify();
  }
}

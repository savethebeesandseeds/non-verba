// SPDX-License-Identifier: AGPL-3.0-only
// Shared orchestration only. The injected account adapter owns authentication.
// Only fixed synthetic illustrations can enter this temporary persistence path.
export const ENROLLMENT_GUIDANCE = Object.freeze(['up', 'down', 'left', 'right', 'front']);
const SCOPE = 'synthetic_local_fixture';
const NOTICE = Object.freeze({id: 'synthetic-identity-enrollment', version: 1,
  text: 'Synthetic demonstration only. Retain the selected illustrated document and frontal face. No identity or liveness verification is performed.'});
export const SYNTHETIC_ENROLLMENT_NOTICE = NOTICE;
const artwork = {
  document_a: ['document_front', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#eee8d5"/><text x="16" y="50">SYNTHETIC DOCUMENT A</text><text x="16" y="90">NOT A VALID ID</text></svg>'],
  document_b: ['document_front', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#dfe8d5"/><text x="16" y="50">SYNTHETIC DOCUMENT B</text><text x="16" y="90">NOT A VALID ID</text></svg>'],
  face_a: ['face_front', '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#eee8d5"/><circle cx="90" cy="75" r="40" fill="#c4af8a"/><circle cx="76" cy="70" r="3"/><circle cx="104" cy="70" r="3"/><path d="M75 90 Q90 104 105 90" fill="none" stroke="#333"/><text x="15" y="150">SYNTHETIC FACE A</text></svg>'],
  face_b: ['face_front', '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#dfe8d5"/><circle cx="90" cy="75" r="38" fill="#c4af8a"/><circle cx="76" cy="70" r="3"/><circle cx="104" cy="70" r="3"/><path d="M75 90 Q90 100 105 90" fill="none" stroke="#333"/><text x="15" y="150">SYNTHETIC FACE B</text></svg>'],
};
const copy = value => structuredClone(value);
const fail = (message, code = 'enrollment_invalid') => { const error = new Error(message); error.code = code; throw error; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const aborted = signal => { if (signal?.aborted) throw new Error('Enrollment operation cancelled.'); };
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
function fixture(id) {
  if (typeof id !== 'string' || !Object.hasOwn(artwork, id)) fail('Only bundled synthetic fixture IDs are supported.');
  return {fixture_id: id, kind: artwork[id][0], media_type: 'image/svg+xml',
    data_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artwork[id][1])}`};
}
export const SYNTHETIC_ENROLLMENT_MEDIA = Object.freeze(Object.keys(artwork).map(id => Object.freeze(fixture(id))));
async function digest(text) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function accountBinding(account, role) {
  const shortRole = role === 'operator' ? 'O' : role === 'requester' ? 'R' : null;
  if (!shortRole || account?.confirmed !== true || !validId(account.account_id) || !validId(account.principal_id)
    || !Number.isSafeInteger(account.recovery_generation) || account.recovery_generation < 0
    || !Array.isArray(account.roles) || !account.roles.some(value => value === role || value === shortRole)) {
    fail('An existing confirmed account with the declared role is required.');
  }
  // Do not retain contact details, credentials, tokens or arbitrary adapter fields.
  return {account_id: account.account_id, principal_id: account.principal_id, role,
    recovery_generation: account.recovery_generation};
}
function validateEnvelope(json) {
  const data = JSON.parse(json);
  const binding = accountBinding({...data.binding, confirmed: true, roles: [data.binding?.role]}, data.binding?.role);
  if (!validId(data.operation_id) || !Number.isSafeInteger(data.revision) || data.revision < 1) fail('Invalid enrollment revision.');
  const items = ['document_front', 'face_front'].map(kind => {
    const item = data.items?.find(value => value.kind === kind);
    const expected = fixture(item?.fixture_id);
    if (expected.kind !== kind) fail('Wrong synthetic media kind.');
    return expected;
  });
  const expected = {schema_version: 1, synthetic: true, custody: SCOPE, binding,
    operation_id: data.operation_id, revision: data.revision, notice: NOTICE,
    consent: {processing: true, retention: true}, items};
  if (!same(data, expected)) fail('Unsupported or changed enrollment data/notice.');
  return expected;
}
const receiptFor = record => ({operation_id: record.operation_id, sha256: record.sha256,
  custody: SCOPE, submitted: true, verification: 'pending', decision: null});
function validateReceipt(receipt, record) {
  if (!same(receipt, receiptFor(record))) fail('Invalid synthetic receipt; no verification decision is supported.');
  return copy(receipt);
}
async function validateRecord(record, binding) {
  const envelope = validateEnvelope(record.envelope_json);
  if (!same(envelope.binding, binding) || record.operation_id !== envelope.operation_id
    || record.sha256 !== await digest(record.envelope_json)
    || !['retained', 'submission_unknown', 'submitted', 'pending'].includes(record.status)
    || !same(Object.keys(record).sort(), ['envelope_json', 'operation_id', 'receipt', 'sha256', 'status'].sort())) {
    fail('Stored enrollment does not match its account or reviewed bytes.');
  }
  if (record.receipt !== null) validateReceipt(record.receipt, record);
  if (['submitted', 'pending'].includes(record.status) && record.receipt === null) fail('Submission requires an exact receipt.');
  return copy(record);
}

// Inject browser key/value storage explicitly. No global database or real-media
// store is opened. Reusing the same storage supports a new workflow after reload.
export function createSyntheticEnrollmentStore(storage) {
  if (!storage?.getItem || !storage?.setItem || !storage?.removeItem) fail('Explicit synthetic key/value storage is required.');
  const key = (kind, binding, operation = '') => `nonverba.synthetic-enrollment.v1:${kind}:${encodeURIComponent(JSON.stringify(binding))}:${operation}`;
  const read = async name => { const text = await storage.getItem(name); return text === null ? null : JSON.parse(text); };
  return Object.freeze({scope: SCOPE,
    async save(record, {signal, expectedSha256 = null} = {}) {
      const binding = validateEnvelope(record.envelope_json).binding;
      await validateRecord(record, binding);
      const name = key('selected', binding), current = await read(name);
      if (current && current.sha256 !== record.sha256 && current.sha256 !== expectedSha256) fail('Retained selection changed; reopen before replacing it.');
      aborted(signal); await storage.setItem(name, JSON.stringify(record));
    },
    async load(binding) {
      const record = await read(key('selected', binding));
      return record === null ? null : validateRecord(record, binding);
    },
    async remove(binding, {expectedSha256, signal} = {}) {
      const name = key('selected', binding), current = await read(name);
      if (!current || current.sha256 !== expectedSha256) fail('Retained selection changed; reopen before deleting it.');
      aborted(signal); await storage.removeItem(name);
    },
    async submit(record, {signal} = {}) {
      const binding = validateEnvelope(record.envelope_json).binding;
      await validateRecord(record, binding); aborted(signal);
      const name = key('receipt', binding, record.operation_id), prior = await read(name);
      const receipt = receiptFor(record);
      if (prior !== null) return validateReceipt(prior, record);
      await storage.setItem(name, JSON.stringify(receipt));
      return receipt;
    },
    async lookup(record) {
      const binding = validateEnvelope(record.envelope_json).binding;
      await validateRecord(record, binding);
      const receipt = await read(key('receipt', binding, record.operation_id));
      return receipt === null ? null : validateReceipt(receipt, record);
    },
  });
}

export class SyntheticEnrollmentWorkflow {
  #binding = null;
  #role = null;
  #items = {};
  #consent = {processing: false, retention: false};
  #revision = 0;
  #record = null;
  #retainedSha = null;
  #status = 'incomplete';
  #epoch = 0;
  #abort = new AbortController();
  #sessionId = null;
  #blocker = null;
  constructor({getAccount, store, onChange = () => {}} = {}) {
    if (typeof getAccount !== 'function' || store?.scope !== SCOPE) fail('Account adapter and synthetic store required.');
    this.getAccount = getAccount; this.store = store; this.onChange = onChange;
  }
  snapshot() {
    return copy({synthetic: true, custody: SCOPE, binding: this.#binding, revision: this.#revision,
      status: this.#status, reviewed_revision: this.#record && this.#status !== 'cancelled' ? this.#revision : null,
      retained_sha256: this.#retainedSha,
      consent: this.#consent, notice: NOTICE, blocker: this.#blocker,
      items: Object.values(this.#items).map(id => { const {data_url, ...descriptor} = fixture(id); return descriptor; }),
      receipt: this.#record?.receipt ?? null,
      verification: {status: 'pending', reason: 'verification_not_configured', decision: null},
      movement_check: 'not_performed', liveness: 'not_evaluated', identity_verified: false,
      genuine_authentication: false, signing_authority: false, work_resumed: false, sensors_requested: false});
  }
  preview(kind) { return this.#items[kind] ? fixture(this.#items[kind]).data_url : null; }
  #notify() { const value = this.snapshot(); this.onChange(value); return value; }
  #fence() { this.#epoch++; this.#abort.abort(); this.#abort = new AbortController(); }
  async #current(epoch = this.#epoch, initial = false) {
    if (!initial && this.#binding === null) fail('Begin enrollment with a current account first.', 'account_required');
    let account, binding;
    try {
      // The trusted adapter performs current authenticated service requests.
      // These arguments are context to revalidate, never an authorization token.
      account = await this.getAccount({signal: this.#abort.signal,
        expected: this.#binding ? {...copy(this.#binding), current_session_id: this.#sessionId} : null});
      binding = accountBinding(account, this.#role);
      if (!validId(account.current_session_id) || account.session_active !== true) fail('Current active account session required.');
    } catch (error) {
      if (epoch === this.#epoch) this.#invalidate('account_unavailable', 'Current authenticated account/session unavailable.');
      throw error;
    }
    if (epoch !== this.#epoch) fail('Stale enrollment operation.', 'stale_operation');
    if (this.#binding && (!same(binding, this.#binding) || account.current_session_id !== this.#sessionId)) {
      this.#invalidate('account_changed', 'Account, session or recovery generation changed; reopen enrollment.');
      fail('Account, session or recovery generation changed; reopen enrollment.', 'account_changed');
    }
    this.#sessionId = account.current_session_id; this.#blocker = null;
    return binding;
  }
  #invalidate(code, message) {
    this.#fence(); this.#binding = null; this.#items = {}; this.#record = null; this.#retainedSha = null;
    this.#consent = {processing: false, retention: false}; this.#status = 'incomplete';
    this.#blocker = {code, message}; this.#notify();
  }
  #edit() {
    if (['submitting', 'submission_unknown'].includes(this.#status)) fail('Resolve the original submission before editing.');
    this.#fence(); this.#revision++; this.#record = null; this.#status = 'incomplete';
  }
  async begin(role) {
    this.#fence(); this.#role = role; this.#binding = null; this.#items = {};
    this.#consent = {processing: false, retention: false}; this.#revision = 0; this.#record = null; this.#status = 'incomplete';
    this.#sessionId = null; this.#blocker = null; this.#retainedSha = null;
    const epoch = this.#epoch, binding = await this.#current(epoch, true);
    if (epoch !== this.#epoch) fail('Stale enrollment operation.', 'stale_operation');
    this.#binding = binding; return this.#notify();
  }
  async setConsent({processing, retention}) {
    await this.#current();
    if (typeof processing !== 'boolean' || typeof retention !== 'boolean') fail('Separate explicit processing/retention choices required.');
    this.#edit(); this.#consent = {processing, retention};
    if (!processing) this.#items = {};
    return this.#notify();
  }
  async select(kind, fixtureId) {
    await this.#current();
    if (!this.#consent.processing) fail('Processing consent is required before selecting media.');
    if (!['document_front', 'face_front'].includes(kind) || fixture(fixtureId).kind !== kind) fail('Wrong synthetic media kind.');
    this.#edit(); this.#items[kind] = fixtureId; return this.#notify();
  }
  async review({deliberate = false} = {}) {
    const epoch = this.#epoch; await this.#current(epoch);
    if (!deliberate || !this.#consent.processing || !this.#consent.retention
      || !this.#items.document_front || !this.#items.face_front) fail('Review both selected items and consent choices deliberately.');
    if (['submitting', 'submission_unknown'].includes(this.#status)) fail('Resolve the original submission before review.');
    const envelope = {schema_version: 1, synthetic: true, custody: SCOPE, binding: copy(this.#binding),
      operation_id: globalThis.crypto.randomUUID(), revision: this.#revision, notice: NOTICE,
      consent: copy(this.#consent), items: ['document_front', 'face_front'].map(kind => fixture(this.#items[kind]))};
    const json = JSON.stringify(envelope), sha256 = await digest(json);
    await this.#current(epoch);
    this.#record = {envelope_json: json, operation_id: envelope.operation_id, sha256, status: 'retained', receipt: null};
    this.#status = 'reviewed'; return this.#notify();
  }
  async retain({deliberate = false} = {}) {
    const epoch = this.#epoch; await this.#current(epoch);
    if (!deliberate || this.#status !== 'reviewed') fail('Current review and deliberate retention required.');
    await this.store.save(copy(this.#record), {signal: this.#abort.signal, expectedSha256: this.#retainedSha});
    await this.#current(epoch); this.#retainedSha = this.#record.sha256; this.#status = 'retained'; return this.#notify();
  }
  async restore(role) {
    await this.begin(role); const epoch = this.#epoch;
    const record = await this.store.load(copy(this.#binding)); await this.#current(epoch);
    if (record === null) return this.#notify();
    await validateRecord(record, this.#binding); await this.#current(epoch);
    const envelope = validateEnvelope(record.envelope_json);
    this.#record = record; this.#retainedSha = record.sha256; this.#revision = envelope.revision; this.#consent = envelope.consent;
    this.#items = Object.fromEntries(envelope.items.map(item => [item.kind, item.fixture_id]));
    // An unsubmitted saved selection is re-reviewed under the current login.
    this.#status = record.status === 'retained' ? 'incomplete' : record.status;
    if (record.status === 'retained') this.#record = null;
    return this.#notify();
  }
  async submit({deliberate = false} = {}) {
    const epoch = this.#epoch; await this.#current(epoch);
    if (!deliberate || !['retained', 'submission_unknown'].includes(this.#status)) fail('Retain the reviewed items before deliberate submission.');
    const record = {...copy(this.#record), status: 'submission_unknown', receipt: null};
    this.#record = record; this.#status = 'submitting'; this.#notify();
    try {
      await this.store.save(copy(record), {signal: this.#abort.signal}); await this.#current(epoch);
      const receipt = validateReceipt(await this.store.submit(copy(record), {signal: this.#abort.signal}), record);
      await this.#current(epoch);
      const submitted = {...record, status: 'submitted', receipt};
      await this.store.save(copy(submitted), {signal: this.#abort.signal}); await this.#current(epoch);
      this.#record = submitted; this.#status = 'submitted'; return this.#notify();
    } catch (error) {
      if (epoch === this.#epoch) { this.#status = 'submission_unknown'; this.#notify(); }
      throw error;
    }
  }
  async refreshStatus() {
    const epoch = this.#epoch; await this.#current(epoch);
    if (!this.#record || !['submission_unknown', 'submitted', 'pending'].includes(this.#status)) fail('No original submission to inspect.');
    const record = copy(this.#record), result = await this.store.lookup(record); await this.#current(epoch);
    if (result === null) { this.#status = 'submission_unknown'; return this.#notify(); }
    const pending = {...record, status: 'pending', receipt: validateReceipt(result, record)};
    await this.store.save(copy(pending), {signal: this.#abort.signal}); await this.#current(epoch);
    this.#record = pending; this.#status = 'pending'; return this.#notify();
  }
  cancel() {
    const unresolved = this.#status === 'submitting' || this.#status === 'submission_unknown';
    this.#fence(); this.#items = {}; this.#consent = {processing: false, retention: false};
    this.#status = unresolved ? 'submission_unknown' : 'cancelled';
    return this.#notify(); // Retained media and historical receipts are not erased.
  }
  async deleteRetained({deliberate = false} = {}) {
    const epoch = this.#epoch; await this.#current(epoch);
    if (!deliberate || ['submitting', 'submission_unknown'].includes(this.#status)) fail('Resolve submission and deliberately delete retained fixtures.');
    await this.store.remove(copy(this.#binding), {expectedSha256: this.#retainedSha, signal: this.#abort.signal}); await this.#current(epoch);
    this.cancel(); this.#record = null; this.#retainedSha = null; return this.#notify();
    // The local submission receipt (no media) remains separately inspectable.
  }
}

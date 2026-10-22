// SPDX-License-Identifier: AGPL-3.0-only
// Actual selected images stay in this live workflow only. This is acquisition
// and review, not a document check, face comparison, liveness or submission.
export const IDENTITY_CAPTURE_GUIDANCE = Object.freeze(['up', 'down', 'left', 'right', 'front']);
export const IDENTITY_CAPTURE_LIMITS = Object.freeze({maxBytes: 8 * 1024 * 1024,
  maxPixels: 16_000_000, maxEdge: 8192});
const kinds = Object.freeze(['document_front', 'face_front']);
const clone = value => structuredClone(value);
const fail = (message, code = 'capture_invalid') => { const error = new Error(message); error.code = code; throw error; };
const aborted = signal => { if (signal?.aborted) fail('The image operation was cancelled.', 'capture_cancelled'); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > IDENTITY_CAPTURE_LIMITS.maxEdge || height > IDENTITY_CAPTURE_LIMITS.maxEdge
    || width * height > IDENTITY_CAPTURE_LIMITS.maxPixels) {
    fail('Choose an image no larger than 16 megapixels or 8192 pixels on either edge.', 'image_dimensions');
  }
  return {width, height};
}
function encodedDimensions(bytes, type) {
  if (type === 'image/png') {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
      || bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13
      || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') {
      fail('The selected file is not a supported PNG image.', 'image_format');
    }
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return dimensions(data.getUint32(16), data.getUint32(20));
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('The selected file is not a supported JPEG image.', 'image_format');
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) break;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || marker === undefined || marker === 0x00) break;
    if (marker === 0xd8 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const components = bytes[offset + 7];
      if (length < 8 || bytes[offset + 2] !== 8 || components < 1 || components > 4 || length !== 8 + 3 * components) break;
      return dimensions(bytes[offset + 5] * 256 + bytes[offset + 6], bytes[offset + 3] * 256 + bytes[offset + 4]);
    }
    offset += length;
  }
  fail('The selected file has no supported JPEG image dimensions.', 'image_format');
}
async function decodeImage(blob, {signal} = {}) {
  aborted(signal);
  if (typeof globalThis.createImageBitmap === 'function') {
    const image = await globalThis.createImageBitmap(blob);
    try { aborted(signal); return {width: image.width, height: image.height}; }
    finally { image.close(); }
  }
  if (typeof globalThis.Image !== 'function') fail('Image decoding is unavailable on this platform.', 'image_decoder_unavailable');
  const url = URL.createObjectURL(blob), image = new Image();
  try {
    return await new Promise((resolve, reject) => {
      const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', cancel); };
      const cancel = () => { cleanup(); image.src = ''; const error = new Error('The image operation was cancelled.'); error.code = 'capture_cancelled'; reject(error); };
      image.onload = () => { cleanup(); resolve({width: image.naturalWidth, height: image.naturalHeight}); };
      image.onerror = () => { cleanup(); const error = new Error('The selected image could not be decoded.'); error.code = 'image_decode_failed'; reject(error); };
      signal?.addEventListener('abort', cancel, {once: true});
      if (signal?.aborted) cancel(); else image.src = url;
    });
  } finally { image.src = ''; URL.revokeObjectURL(url); }
}

// Inspect encoded bounds before asking a platform decoder to allocate pixels.
// The decoder is injectable for platform adapters and isolated synthetic tests;
// it cannot bypass byte/header checks or disagree with encoded dimensions.
export async function inspectIdentityImage(blob, {signal, decodeImage: decoder = decodeImage} = {}) {
  aborted(signal);
  if (!(blob instanceof Blob) || !['image/jpeg', 'image/png'].includes(blob.type)) {
    fail('Choose a JPEG or PNG image.', 'image_format');
  }
  if (blob.size < 1 || blob.size > IDENTITY_CAPTURE_LIMITS.maxBytes) fail('Choose an image no larger than 8 MiB.', 'image_size');
  const bytes = new Uint8Array(await blob.arrayBuffer()); aborted(signal);
  const encoded = encodedDimensions(bytes, blob.type);
  let decoded;
  try { decoded = await decoder(blob, {signal}); }
  catch (error) { aborted(signal); if (error.code) throw error; fail('The selected image could not be decoded.', 'image_decode_failed'); }
  aborted(signal);
  const actual = dimensions(decoded?.width, decoded?.height);
  // JPEG EXIF orientation may rotate the decoded image by a quarter turn.
  if (!same(encoded, actual) && !(blob.type === 'image/jpeg' && encoded.width === actual.height && encoded.height === actual.width)) {
    fail('The decoded image dimensions do not match its header.', 'image_dimensions_mismatch');
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)); aborted(signal);
  return {media_type: blob.type, byte_length: blob.size, ...actual,
    sha256: Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')};
}
function bindingFor(account, role) {
  const short = role === 'requester' ? 'R' : role === 'operator' ? 'O' : null;
  if (!short || account?.confirmed !== true || account.session_active !== true
    || !validId(account.account_id) || !validId(account.principal_id) || !validId(account.current_session_id)
    || !Number.isSafeInteger(account.recovery_generation) || account.recovery_generation < 0
    || !Array.isArray(account.roles) || !account.roles.some(value => value === role || value === short)) {
    fail('Sign in with a confirmed account and declared role before selecting identity images.', 'account_required');
  }
  return {account_id: account.account_id, principal_id: account.principal_id, role,
    recovery_generation: account.recovery_generation};
}

export class IdentityCaptureWorkflow {
  #binding = null;
  #sessionId = null;
  #role = null;
  #revision = 0;
  #reviewed = null;
  #status = 'incomplete';
  #items = new Map();
  #processing = false;
  #guidance = 0;
  #skipped = false;
  #blocker = null;
  #epoch = 0;
  #abort = new AbortController();
  #getAccount;
  #onChange;
  #decoder;
  #createURL;
  #revokeURL;
  constructor({getAccount, onChange = () => {}, inspectImage = decodeImage,
    createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url)} = {}) {
    if (typeof getAccount !== 'function' || typeof inspectImage !== 'function'
      || typeof createObjectURL !== 'function' || typeof revokeObjectURL !== 'function') fail('Account and image platform adapters are required.');
    this.#getAccount = getAccount; this.#onChange = onChange; this.#decoder = inspectImage;
    this.#createURL = createObjectURL; this.#revokeURL = revokeObjectURL;
  }
  snapshot() {
    return clone({custody: 'transient_memory_only', binding: this.#binding, revision: this.#revision,
      status: this.#status, reviewed_revision: this.#reviewed, consent: {processing: this.#processing, retention: false},
      items: [...this.#items.values()].map(item => item.descriptor),
      guidance: {steps: IDENTITY_CAPTURE_GUIDANCE, index: this.#guidance,
        complete: this.#guidance === IDENTITY_CAPTURE_GUIDANCE.length, skipped: this.#skipped}, blocker: this.#blocker,
      verification: {status: 'pending', reason: 'verification_not_configured', decision: null},
      movement_check: 'not_performed', liveness: 'not_evaluated', identity_verified: false,
      submitted: false, retained: false});
  }
  preview(kind) { return this.#items.get(kind)?.url ?? null; }
  #notify() { const value = this.snapshot(); this.#onChange(value); return value; }
  #fence() { this.#epoch++; this.#abort.abort(); this.#abort = new AbortController(); return this.#epoch; }
  #assert(epoch) { if (epoch !== this.#epoch) fail('The image operation was cancelled or replaced.', 'capture_cancelled'); }
  #drop(kind) {
    const item = this.#items.get(kind);
    if (item) { this.#items.delete(kind); this.#revokeURL(item.url); }
  }
  #clear() { for (const kind of [...this.#items.keys()]) this.#drop(kind); }
  #edit() {
    if (!this.#binding) fail('Begin identity capture with a current account first.', 'account_required');
    const epoch = this.#fence(); this.#revision++; this.#reviewed = null; this.#status = 'incomplete';
    return epoch;
  }
  #settle() { this.#status = kinds.every(kind => this.#items.has(kind)) ? 'ready' : 'incomplete'; return this.#notify(); }
  async #current(epoch, initial = false) {
    this.#assert(epoch);
    if (!initial && !this.#binding) fail('Begin identity capture with a current account first.', 'account_required');
    let current, binding;
    try {
      current = await this.#getAccount({signal: this.#abort.signal,
        expected: this.#binding ? {...clone(this.#binding), current_session_id: this.#sessionId} : null});
      this.#assert(epoch); binding = bindingFor(current, this.#role);
      if (this.#binding && (!same(binding, this.#binding) || current.current_session_id !== this.#sessionId)) {
        fail('The account, session or recovery generation changed. Begin again.', 'account_changed');
      }
    } catch (error) {
      if (epoch === this.#epoch) {
        this.#fence(); this.#clear(); this.#binding = null; this.#sessionId = null;
        this.#processing = false; this.#reviewed = null; this.#status = 'incomplete'; this.#guidance = 0; this.#skipped = false;
        this.#blocker = {code: error.code === 'account_changed' ? 'account_changed' : 'account_unavailable',
          message: 'The current account session is unavailable or changed. Sign in and begin again.'}; this.#notify();
      }
      throw error;
    }
    this.#sessionId = current.current_session_id; this.#blocker = null;
    return binding;
  }
  async begin(role) {
    const epoch = this.#fence(); this.#clear(); this.#binding = null; this.#sessionId = null;
    this.#role = role; this.#revision = 0; this.#reviewed = null; this.#processing = false;
    this.#guidance = 0; this.#skipped = false; this.#blocker = null; this.#status = 'incomplete';
    this.#binding = await this.#current(epoch, true); this.#assert(epoch); return this.#notify();
  }
  async setProcessingConsent(value) {
    if (typeof value !== 'boolean') fail('Choose whether to process the selected images deliberately.');
    const epoch = this.#edit(); await this.#current(epoch); this.#processing = value;
    if (!value) { this.#clear(); this.#guidance = 0; this.#skipped = false; }
    return this.#settle();
  }
  async validate() {
    if (!this.#processing) fail('Processing consent is required before starting the camera.', 'processing_consent_required');
    const epoch = this.#epoch; await this.#current(epoch); this.#assert(epoch); return this.#notify();
  }
  async select(kind, blob, {source, deliberate = false, cleanup} = {}) {
    if (!kinds.includes(kind) || !['file', 'camera'].includes(source) || deliberate !== true) fail('Deliberately choose one document front or frontal face image.');
    if (source === 'camera' && cleanup !== 'stopped') fail('Stop the camera before selecting the captured image.', 'camera_not_stopped');
    if (!this.#processing) fail('Processing consent is required before selecting images.', 'processing_consent_required');
    if (kind === 'face_front' && this.#guidance !== IDENTITY_CAPTURE_GUIDANCE.length && !this.#skipped) {
      fail('Complete or explicitly skip the face guidance before selecting the frontal photo.', 'guidance_required');
    }
    const epoch = this.#edit(); await this.#current(epoch);
    const descriptor = await inspectIdentityImage(blob, {signal: this.#abort.signal, decodeImage: this.#decoder});
    this.#assert(epoch); await this.#current(epoch); this.#assert(epoch);
    const url = this.#createURL(blob);
    try {
      this.#drop(kind); this.#items.set(kind, {blob, url,
        descriptor: {...descriptor, kind, source, item_revision: this.#revision}});
    } catch (error) { this.#revokeURL(url); throw error; }
    return this.#settle();
  }
  async remove(kind) {
    if (!kinds.includes(kind)) fail('Choose a supported image item.');
    const epoch = this.#edit(); await this.#current(epoch); this.#drop(kind); return this.#settle();
  }
  async setGuidance(step) {
    if (!this.#processing) fail('Processing consent is required before starting face guidance.', 'processing_consent_required');
    if (step !== 'skipped' && (this.#skipped || step !== IDENTITY_CAPTURE_GUIDANCE[this.#guidance])) fail('Follow the current guidance position or explicitly skip it.', 'guidance_order');
    const epoch = this.#edit(); await this.#current(epoch);
    if (step === 'skipped') this.#skipped = true; else this.#guidance++;
    return this.#settle();
  }
  resetGuidance() {
    this.#edit(); this.#guidance = 0; this.#skipped = false; this.#drop('face_front'); return this.#settle();
  }
  async review({deliberate = false} = {}) {
    if (!this.#binding || !this.#processing || !kinds.every(kind => this.#items.has(kind)) || deliberate !== true) {
      fail('Review both selected images deliberately after choosing processing consent.', 'review_required');
    }
    const epoch = this.#fence(); await this.#current(epoch); this.#assert(epoch);
    this.#reviewed = this.#revision; this.#status = 'reviewed'; return this.#notify();
  }
  cancel() {
    this.#fence(); this.#clear(); this.#binding = null; this.#sessionId = null;
    this.#processing = false; this.#reviewed = null; this.#guidance = 0; this.#skipped = false;
    this.#status = 'cancelled'; this.#blocker = null; return this.#notify();
  }
  release() { return this.cancel(); }
}

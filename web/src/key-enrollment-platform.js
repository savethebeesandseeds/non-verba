// SPDX-License-Identifier: AGPL-3.0-only
// Platform coordination only. Rust validates enrollment and certificate evidence.
const PIN = /^[0-9a-f]{64}$/;
const PURPOSES = new Set(['location', 'media']);
function decode(value) {
  if (typeof value !== 'string' || value.length > 300 * 1024) throw new Error('Invalid native enrollment response.');
  const result = JSON.parse(value);
  if (!result || typeof result !== 'object' || result.ok === false) throw new Error(result?.error || 'Native enrollment failed.');
  return result;
}
export function enrollmentPlatform(scope = globalThis) {
  const bridge = scope.NativeKeyEnrollment;
  const methods = ['capabilities', 'begin', 'status', 'exportEnrollmentForKey', 'selectProfile', 'cancel'];
  return bridge && methods.every(method => typeof bridge[method] === 'function') ? bridge : null;
}
export function enrollmentCapabilities(bridge) {
  if (!bridge) return null;
  const result = decode(bridge.capabilities());
  if (result.version !== 1 || result.available !== true || !result.purposes) throw new Error('Unsupported native enrollment capabilities.');
  return result;
}
export function checkEnrollmentResult(result, purpose, challenge) {
  if (!result || result.version !== 1 || result.type !== 'nonverba-key-enrollment'
    || result.purpose !== purpose || !PURPOSES.has(purpose) || result.key_profile !== 'attested'
    || result.hardware_attested !== false || !PIN.test(result.fingerprint) || !PIN.test(result.spki_sha256)
    || (challenge !== undefined && result.challenge_b64 !== challenge)) throw new Error('Native enrollment does not match its original request.');
  return result;
}
export function exportEnrollment(bridge, purpose, pin) {
  if (!PIN.test(pin)) throw new Error('Choose the exact enrolled identity to export.');
  const result = checkEnrollmentResult(decode(bridge.exportEnrollmentForKey(purpose, pin)), purpose);
  if (result.fingerprint !== pin) throw new Error('Native enrollment export changed identity.');
  return result;
}
export function selectEnrollmentProfile(bridge, purpose, profile, pin) {
  if (!PURPOSES.has(purpose) || !['legacy', 'attested'].includes(profile) || !PIN.test(pin)) throw new Error('Choose an available signing identity.');
  const result = decode(bridge.selectProfile(purpose, profile, pin));
  if (result.ok !== true || result.purpose !== purpose || result.key_profile !== profile || result.fingerprint !== pin) throw new Error('Native identity selection did not match.');
  return result;
}
export class NativeEnrollmentSession {
  constructor(bridge, {clock = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
    this.bridge = bridge; this.clock = clock; this.wait = wait; this.id = null; this.closed = false;
  }
  cancel() {
    this.closed = true;
    if (this.id) { try { this.bridge.cancel(this.id); } catch {} }
  }
  async run(request, onProgress = () => {}) {
    if (this.closed || this.id || !PURPOSES.has(request?.purpose) || typeof request.challenge_b64 !== 'string') throw new Error('Invalid or already used enrollment session.');
    const original = {purpose: request.purpose, challenge_b64: request.challenge_b64};
    const start = this.clock();
    try {
      let state = decode(this.bridge.begin(original.purpose, original.challenge_b64));
      if (typeof state.session_id !== 'string' || !state.session_id || state.session_id.length > 128) throw new Error('Native enrollment session ID is missing.');
      this.id = state.session_id;
      for (;;) {
        if (this.closed) throw new Error('Key enrollment cancelled. Any generated key remains preserved.');
        if (this.clock() < start || this.clock() - start > 65_000) throw new Error('Key enrollment exceeded its time limit.');
        if (state.session_id !== this.id || state.purpose !== original.purpose) throw new Error('Native enrollment session changed.');
        if (state.state === 'ready') {
          const result = checkEnrollmentResult(state.result, original.purpose, original.challenge_b64);
          this.closed = true;
          return result;
        }
        if (state.state !== 'preparing') throw new Error(state.error || 'Native enrollment did not complete.');
        onProgress('Creating the separate Android key. Keep this page open…');
        await this.wait(200);
        if (this.closed) throw new Error('Key enrollment cancelled. Any generated key remains preserved.');
        state = decode(this.bridge.status(this.id));
      }
    } catch (error) { this.cancel(); throw error; }
  }
}

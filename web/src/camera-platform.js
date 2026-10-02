// SPDX-License-Identifier: AGPL-3.0-only
// Native acquisition transport. The bridge accepts requests and location metadata,
// never image bytes. Browser capture stays in its existing, separate adapter.
import {base64ToBytes} from './location-platform.js';

const MAX_IMAGE = 32 * 1024 * 1024;
const MAX_RESPONSE = Math.ceil(MAX_IMAGE / 3) * 4 + 64 * 1024;
const PIN = /^[0-9a-f]{64}$/;
// Native capture retains its bounded60-second session; transport adds5seconds.
const TRANSPORT_TIMEOUT_MS = 65000;

function decode(text, max = 64 * 1024) {
  if (typeof text !== 'string' || text.length > max) throw new Error('Invalid native camera response.');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native camera response.');
  if (value.ok === false || ['error', 'cancelled'].includes(value.state)) throw new Error(value.error || 'Native camera collection stopped.');
  return value;
}

export function nativeCameraPlatform() {
  const bridge = globalThis.NativeCamera;
  if (!bridge) return null;
  for (const method of ['capabilities', 'begin', 'status', 'capture', 'cancel']) {
    if (typeof bridge[method] !== 'function') throw new Error('The native camera bridge is incomplete.');
  }
  const capabilities = decode(bridge.capabilities());
  if (capabilities.available !== true || capabilities.version !== 1 || !PIN.test(capabilities.key_fingerprint)) {
    throw new Error('The native camera is unavailable. Restart the Android app and retry.');
  }
  return {bridge, capabilities, fingerprint: capabilities.key_fingerprint};
}

function active(signal) {
  if (signal?.aborted) throw new DOMException('Native camera capture cancelled.', 'AbortError');
}

function delay(signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(new DOMException('Native camera capture cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, 150);
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) cancel();
  });
}

/** Location is acquired only after the operator presses the native shutter. */
export async function collectNativeCamera({platform, challenge, locationRequest, signal, acquireLocation, onProgress}) {
  active(signal);
  const result = decode(platform.bridge.begin(JSON.stringify(challenge), locationRequest ? JSON.stringify(locationRequest) : ''));
  if (typeof result.session_id !== 'string' || !result.session_id) throw new Error('Native camera did not create a capture session.');
  const id = result.session_id;
  const cancel = () => { try { platform.bridge.cancel(id); } catch { /* Keep the original error. */ } };
  signal?.addEventListener('abort', cancel, {once: true});
  const started = performance.now();
  let submitted = false, complete = false;
  try {
    while (true) {
      active(signal);
      if (performance.now() - started > TRANSPORT_TIMEOUT_MS) throw new Error('Native camera session timed out.');
      const status = decode(platform.bridge.status(id), MAX_RESPONSE);
      if (status.session_id !== id || status.key_fingerprint !== platform.fingerprint) throw new Error('Native camera session or signing identity changed.');
      onProgress?.(status.state);
      if (status.state === 'complete') {
        if (!submitted || status.result?.fingerprint !== platform.fingerprint || status.result?.media_origin !== 'native-camera2-jpeg') {
          throw new Error('Native camera returned an unexpected capture result.');
        }
        const bytes = base64ToBytes(status.result.image_base64, MAX_IMAGE);
        active(signal); complete = true;
        return {bytes, fingerprint: platform.fingerprint};
      }
      if (!['requesting-permission', 'opening', 'preview', 'awaiting-location', 'capturing', 'sealing'].includes(status.state)) {
        throw new Error('Unexpected native camera session state.');
      }
      if (status.state === 'awaiting-location') {
        if (submitted) throw new Error('Native camera requested duplicate location submission.');
        const location = await acquireLocation(); active(signal);
        submitted = true;
        const capturing = decode(platform.bridge.capture(id, JSON.stringify(location)));
        if (capturing.session_id !== id) throw new Error('Native camera capture session changed.');
      }
      await delay(signal);
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!complete) cancel();
  }
}

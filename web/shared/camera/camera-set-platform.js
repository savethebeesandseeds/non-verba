// SPDX-License-Identifier: AGPL-3.0-only
// Native transport only. Verification is always rerun by the shared Rust core.
export const MAX_CAMERA_SET_JSON = 48 * 1024 * 1024;
const states = new Set(['requesting-permission','opening','preview','awaiting-location','capturing','sealing']);
function decode(text, max = 64 * 1024) {
  if (typeof text !== 'string' || text.length > max) throw new Error('Camera-set response exceeds its bound.');
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid camera-set response.');
  return value;
}
function requireOk(value) {
  if (value.ok === false) throw new Error(value.error || 'Camera-set operation stopped.');
  return value;
}
export function cameraSetPlatform(bridge = globalThis.NativeCameraSet) {
  if (!bridge) return null;
  for (const method of ['capabilities','begin','capture','status','cancel']) if (typeof bridge[method] !== 'function') throw new Error('Incomplete camera-set bridge.');
  const capabilities = requireOk(decode(bridge.capabilities()));
  if (capabilities.available !== true || capabilities.version !== 1 || !/^[0-9a-f]{64}$/.test(capabilities.key_fingerprint)) throw new Error('Native camera-set collection is unavailable.');
  return {bridge, capabilities};
}
function active(signal) { if (signal?.aborted) throw new DOMException('Camera-set capture cancelled.', 'AbortError'); }
function wait(signal) { return new Promise((resolve,reject) => {
  const cancel = () => {clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(new DOMException('Camera-set capture cancelled.','AbortError'));};
  const timer = setTimeout(() => {signal?.removeEventListener('abort',cancel);resolve();},150);
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
}); }
export async function collectCameraSet({platform,request,signal,acquireLocation,onStatus,now = () => performance.now()}) {
  active(signal);
  const initial = requireOk(decode(platform.bridge.begin(JSON.stringify(request))));
  const id = initial.session_id;
  if (typeof id !== 'string' || !id) throw new Error('Native camera-set attempt was not created.');
  let complete = false, submitted = false;
  const started = now();
  const cancel = () => {try {const status=decode(platform.bridge.cancel(id));onStatus?.(status);} catch { /* Preserve original failure. */ }};
  signal?.addEventListener('abort',cancel,{once:true});
  try {
    while (true) {
      active(signal);if(now()-started > 65000)throw new Error('Camera-set transport deadline exceeded.');
      const status = decode(platform.bridge.status(id),MAX_CAMERA_SET_JSON + 64*1024);
      onStatus?.(status);
      if(status.session_id !== id || status.key_fingerprint !== platform.capabilities.key_fingerprint)throw new Error('Camera-set attempt or signing identity changed.');
      requireOk(status);
      if(status.state === 'complete') {
        if(!submitted || status.result?.attempt_id !== id || status.result?.type !== 'nonverba-camera-set-bundle')throw new Error('Unexpected camera-set completion.');
        active(signal);complete=true;return status.result;
      }
      if(!states.has(status.state))throw new Error('Unknown camera-set state.');
      if(status.state === 'awaiting-location') {
        if(submitted)throw new Error('Duplicate camera-set location submission.');
        const location=await acquireLocation();active(signal);submitted=true;
        const reply=requireOk(decode(platform.bridge.capture(id,JSON.stringify(location))));
        if(reply.session_id !== id)throw new Error('Camera-set capture attempt changed.');
      }
      await wait(signal);
    }
  } finally {signal?.removeEventListener('abort',cancel);if(!complete)cancel();}
}

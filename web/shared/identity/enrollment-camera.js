// SPDX-License-Identifier: AGPL-3.0-only
// Deliberate enrollment stills only. No evidence signing, recognition, storage,
// upload, microphone, location or movement recording belongs to this adapter.
export const ENROLLMENT_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export function createEnrollmentCamera({video, mediaDevices = globalThis.navigator?.mediaDevices,
  canvasFactory = () => globalThis.document.createElement('canvas'),
  events = globalThis.window, document = globalThis.document,
  onInterrupted = () => {}, leaseMs = 90_000} = {}) {
  if (!video || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 90_000)
    throw new Error('An enrollment preview and bounded camera lease are required.');
  let epoch = 0, session = null, disposed = false;
  const unresolved = new Set(), unreleased = new Set();
  function stopTracks(stream) {
    let failed = false;
    for (const track of stream?.getTracks() || []) {
      try { track.stop(); } catch { failed = true; }
      if (track.readyState !== 'ended') failed = true;
    }
    return !failed;
  }
  function release(value) {
    if (!value) return true;
    clearTimeout(value.timer);
    for (const track of value.stream?.getVideoTracks() || []) track.removeEventListener?.('ended', value.ended);
    const stopped = stopTracks(value.stream);
    if (value.stream) {
      if (stopped) unreleased.delete(value.stream); else unreleased.add(value.stream);
    }
    if (video.srcObject === value.stream) { video.pause?.(); video.srcObject = null; }
    return stopped;
  }
  function stop() {
    epoch++;
    const value = session; session = null;
    value?.cancel?.();
    let stopped = release(value);
    for (const stream of unreleased) {
      if (stopTracks(stream)) unreleased.delete(stream); else stopped = false;
    }
    // An unresolved permission request cannot be revoked by JavaScript. Its
    // late stream is fenced below, and is never attached to the preview.
    return stopped && !unreleased.size && !unresolved.size;
  }
  function interrupt(reason) {
    const wasOpen = !!session;
    stop();
    if (wasOpen) onInterrupted(reason);
  }
  const hidden = () => { if (document?.hidden) interrupt('Camera stopped because the application is hidden.'); };
  const leaving = () => interrupt('Camera stopped because the application left the foreground.');
  document?.addEventListener('visibilitychange', hidden);
  events?.addEventListener('pagehide', leaving);
  events?.addEventListener('nonverba:camera-stop', leaving);
  function current(value) { return !disposed && session === value && value.epoch === epoch && !document?.hidden; }
  async function start(kind) {
    if (!['document_front', 'face_front'].includes(kind)) throw new Error('Unsupported enrollment photo kind.');
    if (disposed || document?.hidden) throw new Error('Enrollment camera is unavailable while hidden or closed.');
    if (!mediaDevices?.getUserMedia) throw new Error('Camera access requires a secure browser or the Android application.');
    if (!stop()) throw new Error('Previous camera shutdown could not be confirmed.');
    const value = {epoch, kind, stream:null, ended:null, timer:null, cancel:null}; session = value;
    const cancelled = new Promise((resolve, reject) => { value.cancel = () => reject(new Error('Camera request was cancelled.')); });
    // A synchronous platform error must not leave an unobserved cancellation.
    cancelled.catch(() => {});
    value.timer = setTimeout(() => { if (current(value)) interrupt('Camera time limit reached. Start it again to continue.'); }, leaseMs);
    try {
      unresolved.add(value);
      let permission;
      try {
        permission = mediaDevices.getUserMedia({audio:false, video:{
          facingMode:{ideal:kind === 'document_front' ? 'environment' : 'user'},
          width:{ideal:kind === 'document_front' ? 1600 : 960}, height:{ideal:kind === 'document_front' ? 1200 : 960}}});
      } catch (error) { unresolved.delete(value); throw error; }
      const acquiring = Promise.resolve(permission).then(stream => {
        unresolved.delete(value); value.stream = stream;
        if (!current(value)) { release(value); throw new Error('Camera request was cancelled.'); }
        return stream;
      }, error => { unresolved.delete(value); throw error; });
      const stream = await Promise.race([acquiring, cancelled]);
      if (stream.getAudioTracks().length || stream.getVideoTracks().length !== 1) throw new Error('Enrollment requires one camera-only stream.');
      value.ended = () => { if (current(value)) interrupt('Camera access ended. Start it again to continue.'); };
      for (const track of stream.getVideoTracks()) track.addEventListener?.('ended', value.ended, {once:true});
      video.srcObject = stream;
      await Promise.race([video.play(), cancelled]);
      if (!current(value)) throw new Error('Camera preview was cancelled.');
      value.cancel = null;
    } catch (error) {
      if (session === value) { session = null; epoch++; }
      release(value);
      throw error;
    }
  }
  async function capture() {
    const value = session;
    if (!value || !current(value) || !value.stream || !value.stream.getVideoTracks().every(track => track.readyState === 'live'))
      throw new Error('Start the camera before taking a photo.');
    const width = video.videoWidth, height = video.videoHeight;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 160 || height < 160 || width * height > 32_000_000)
      throw new Error('The camera frame is not ready or is outside the supported size.');
    const canvas = canvasFactory(), longest = value.kind === 'document_front' ? 1600 : 960;
    const scale = Math.min(1, longest / Math.max(width, height));
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Local photo encoding is unavailable.');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Release the sensor before encoding/review/transfer. An external stop or
      // new capture operation also fences this asynchronous encoder result.
      session = null; epoch++;
      const encodingEpoch = epoch;
      if (!release(value)) throw new Error('Camera shutdown could not be confirmed. Discard this photo.');
      const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result)
        : reject(new Error('Local photo encoding failed.')), 'image/jpeg', 0.86));
      if (disposed || encodingEpoch !== epoch || document?.hidden) throw new Error('Photo encoding was cancelled.');
      if (!(blob instanceof Blob) || blob.type !== 'image/jpeg' || blob.size < 1 || blob.size > ENROLLMENT_PHOTO_MAX_BYTES)
        throw new Error('The photo exceeds the supported JPEG size. Retake it.');
      return blob;
    } finally {
      canvas.width = 0; canvas.height = 0;
      if (session === value) stop();
    }
  }
  return Object.freeze({start, capture, stop,
    active: () => !!session?.stream && current(session) && session.stream.getVideoTracks().every(track => track.readyState === 'live'),
    dispose() {
      disposed = true; const stopped = stop();
      document?.removeEventListener('visibilitychange', hidden);
      events?.removeEventListener('pagehide', leaving);
      events?.removeEventListener('nonverba:camera-stop', leaving);
      return stopped;
    }});
}

// SPDX-License-Identifier: AGPL-3.0-only
// Deliberate enrollment stills only. No evidence signing, recognition, storage,
// upload, microphone, location or movement recording belongs to this adapter.
export const ENROLLMENT_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
// Inspect a bounded encoded header before allocating image pixels. Camera and
// imported photos share the same small JPEG transport; originals never leave
// this adapter. Large phone images use a resized bitmap decode, not a full-size
// HTML image/canvas allocation.
export const ENROLLMENT_IMAGE_INPUT_LIMITS = Object.freeze({maxBytes:32 * 1024 * 1024,
  maxPixels:64_000_000, maxEdge:16384, headerBytes:1024 * 1024});
const imageError = (message, code) => Object.assign(new Error(message), {code});
const imageCancelled = signal => {
  if (signal?.aborted) throw imageError('The image operation was cancelled.', 'capture_cancelled');
};
function imageHeader(bytes, type) {
  const invalid = () => { throw imageError('Choose a valid JPEG or PNG image.', 'image_format'); };
  let width, height, orientation = 1;
  if (type === 'image/png') {
    if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((value,i) => bytes[i] === value)
      || bytes[8] || bytes[9] || bytes[10] || bytes[11] !== 13
      || String.fromCharCode(...bytes.slice(12,16)) !== 'IHDR') invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    width = view.getUint32(16); height = view.getUint32(20);
  } else {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) invalid();
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) invalid();
      const length = bytes[offset] * 256 + bytes[offset + 1], end = offset + length;
      if (length < 2 || end > bytes.length) invalid();
      if ([0xc0,0xc1,0xc2].includes(marker)) {
        const components = bytes[offset + 7];
        if (length < 8 || bytes[offset + 2] !== 8 || components < 1 || components > 4 || length !== 8 + 3 * components) invalid();
        height = bytes[offset + 3] * 256 + bytes[offset + 4]; width = bytes[offset + 5] * 256 + bytes[offset + 6];
      }
      if (marker === 0xe1 && String.fromCharCode(...bytes.slice(offset + 2,offset + 8)) === 'Exif\0\0') {
        const base = offset + 8, view = new DataView(bytes.buffer, bytes.byteOffset, end);
        if (base + 8 > end) invalid();
        const order = view.getUint16(base), little = order === 0x4949;
        if ((!little && order !== 0x4d4d) || view.getUint16(base + 2,little) !== 42) invalid();
        const directory = base + view.getUint32(base + 4,little);
        if (directory < base + 8 || directory + 2 > end) invalid();
        const count = view.getUint16(directory,little);
        if (count > 256 || directory + 2 + count * 12 > end) invalid();
        for (let i = 0; i < count; i++) {
          const at = directory + 2 + i * 12;
          if (view.getUint16(at,little) !== 0x112) continue;
          if (view.getUint16(at + 2,little) !== 3 || view.getUint32(at + 4,little) !== 1) invalid();
          orientation = view.getUint16(at + 8,little);
          if (orientation < 1 || orientation > 8) invalid();
        }
      }
      offset = end;
    }
  }
  const limits = ENROLLMENT_IMAGE_INPUT_LIMITS;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > limits.maxEdge || height > limits.maxEdge || width * height > limits.maxPixels)
    throw imageError('This image is too large to process safely. Take a photo with the camera instead.', 'image_dimensions');
  return orientation >= 5 ? {width:height,height:width} : {width,height};
}
async function resizedImage(blob, {width,height,signal}) {
  if (typeof globalThis.createImageBitmap !== 'function')
    throw imageError('Photo preparation is unavailable. Take a photo with the camera instead.', 'image_decoder_unavailable');
  const image = await globalThis.createImageBitmap(blob, {resizeWidth:width,resizeHeight:height,
    resizeQuality:'high',imageOrientation:'from-image'});
  try { imageCancelled(signal); return image; }
  catch (error) { image.close(); throw error; }
}
async function stripEncodedMetadata(blob,signal) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); imageCancelled(signal);
  const invalid = () => { throw imageError('The photo encoder returned an invalid JPEG.', 'image_decode_failed'); };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  const parts = [bytes.subarray(0,2)];
  let offset = 2, scanned = false, keptJfif = false, keptAdobe = false;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 && scanned) { parts.push(bytes.subarray(start,offset)); return new Blob(parts,{type:'image/jpeg'}); }
    if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0xd9) invalid();
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) { parts.push(bytes.subarray(start,offset)); continue; }
    if (offset + 2 > bytes.length) invalid();
    const length = bytes[offset] * 256 + bytes[offset + 1], end = offset + length;
    if (length < 2 || end > bytes.length) invalid();
    // Default canvas pixels are sRGB. Drop the encoder's optional ICC profile
    // and all other APP/COM metadata; preserve only fixed rendering headers.
    const jfif = !keptJfif && !scanned && marker === 0xe0 && length === 16
      && [74,70,73,70,0,1,1,0,0,1,0,1,0,0].every((value,index) => bytes[offset + 2 + index] === value);
    const adobe = !keptAdobe && !scanned && marker === 0xee && length === 14
      && [65,100,111,98,101,0,100,0,0,0,0].every((value,index) => bytes[offset + 2 + index] === value)
      && bytes[end - 1] <= 2;
    if (jfif) keptJfif = true;
    if (adobe) keptAdobe = true;
    if (marker === 0xda) {
      parts.push(bytes.subarray(start,end)); scanned = true;
      const entropy = end; offset = end;
      while (offset < bytes.length) {
        if (bytes[offset++] !== 0xff) continue;
        const markerStart = offset - 1;
        while (bytes[offset] === 0xff) offset++;
        const next = bytes[offset++];
        if (next === 0 || next >= 0xd0 && next <= 0xd7) continue;
        offset = markerStart; break;
      }
      if (offset >= bytes.length) invalid();
      parts.push(bytes.subarray(entropy,offset)); continue;
    }
    if (marker < 0xe0 || marker > 0xef && marker !== 0xfe || jfif || adobe) parts.push(bytes.subarray(start,end));
    offset = end;
  }
  invalid();
}
export async function prepareEnrollmentImage(blob, {kind = 'document_front', signal,
  decodeImage = resizedImage, canvasFactory = () => globalThis.document.createElement('canvas')} = {}) {
  imageCancelled(signal);
  if (!['document_front','face_front'].includes(kind)) throw imageError('Choose a document or face photo.', 'image_format');
  if (!(blob instanceof Blob) || !['image/jpeg','image/png'].includes(blob.type))
    throw imageError('Choose a JPEG or PNG image.', 'image_format');
  if (blob.size < 1 || blob.size > ENROLLMENT_IMAGE_INPUT_LIMITS.maxBytes)
    throw imageError('This file is too large to process safely. Take a photo with the camera instead.', 'image_size');
  const bytes = new Uint8Array(await blob.slice(0,ENROLLMENT_IMAGE_INPUT_LIMITS.headerBytes).arrayBuffer());
  imageCancelled(signal);
  const original = imageHeader(bytes,blob.type), edge = kind === 'document_front' ? 2400 : 1280;
  const scale = Math.min(1,edge / Math.max(original.width,original.height));
  const width = Math.max(1,Math.round(original.width * scale)), height = Math.max(1,Math.round(original.height * scale));
  let image, canvas;
  try {
    image = await decodeImage(blob,{width,height,signal}); imageCancelled(signal);
    if (image?.width !== width || image?.height !== height)
      throw imageError('The photo decoder could not prepare a bounded image.', 'image_dimensions_mismatch');
    canvas = canvasFactory(); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw imageError('Photo preparation is unavailable.', 'image_decoder_unavailable');
    // JPEG has no alpha channel: use a neutral white background for transparent
    // PNGs rather than silently turning document regions black.
    const fallback = Math.min(1,(kind === 'document_front' ? 1600 : 960) / Math.max(width,height));
    for (const factor of fallback === 1 ? [1] : [1,fallback]) {
      canvas.width = Math.max(1,Math.round(width * factor)); canvas.height = Math.max(1,Math.round(height * factor));
      context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      for (const quality of [0.9,0.82,0.74]) {
        const result = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',quality));
        imageCancelled(signal);
        if (!(result instanceof Blob) || result.type !== 'image/jpeg' || result.size < 1)
          throw imageError('The photo could not be prepared.', 'image_decode_failed');
        if (result.size <= ENROLLMENT_PHOTO_MAX_BYTES) {
          const prepared = await stripEncodedMetadata(result,signal); imageCancelled(signal); return prepared;
        }
      }
    }
    throw imageError('The photo could not be prepared within the upload limit. Take another photo.', 'image_size');
  } catch (error) {
    imageCancelled(signal);
    if (error.code) throw error;
    throw imageError('The selected image could not be decoded.', 'image_decode_failed');
  } finally {
    image?.close?.();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
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

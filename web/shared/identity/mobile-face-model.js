// SPDX-License-Identifier: AGPL-3.0-only
import {MOBILE_FACE_SPEC, MOBILE_FACE_LOCK_SHA256} from './face-model-spec.js';
import {resizeDetectorInput, decodeYuNet, alignSingleFace, normalizeFaceFeature} from './face-alignment.js';

const unavailable = message => Object.assign(new Error(message), {code: 'model_unavailable'});
export function createMobileFaceModel(options) { return new MobileFaceModel(options); }
export class MobileFaceModel {
  constructor({baseUrl = new URL('./face-model/', import.meta.url), fetch = globalThis.fetch?.bind(globalThis),
    importRuntime = url => import(url), crypto = globalThis.crypto,
    decodeImage = decodeBrowserImage, nativeContext = () => !!globalThis.NativeVault} = {}) {
    this.spec = MOBILE_FACE_SPEC; this.baseUrl = new URL(baseUrl); this.fetch = fetch;
    this.importRuntime = importRuntime; this.crypto = crypto; this.decodeImage = decodeImage;
    this.nativeContext = nativeContext; this.epoch = 0; this.pending = null; this.runtime = null;
    this.encoder = null; this.detector = null;
  }
  async verified(asset) {
    const url = new URL(asset.file, this.baseUrl);
    if (url.origin !== this.baseUrl.origin || !url.href.startsWith(this.baseUrl.href)) throw unavailable('The local model asset path is invalid.');
    const response = await this.fetch(url, {cache: 'no-store', credentials: 'omit', redirect: 'error'});
    if (!response.ok) throw unavailable('The pinned local face model assets are not installed.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== asset.bytes) throw unavailable('A face model asset has an unexpected size.');
    const digest = Array.from(new Uint8Array(await this.crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
    if (digest !== asset.sha256) throw unavailable('A local face model asset failed its pinned digest check.');
    return bytes;
  }
  async ready() {
    if (this.nativeContext()) throw unavailable('The face inspection adapter is browser-only.');
    if (!this.crypto?.subtle || !this.fetch) throw unavailable('Local face inference requires a secure browser context.');
    if (this.encoder && this.detector) return;
    const pending = this.pending ??= this.load();
    try { await pending; } catch (error) {
      if (this.pending === pending) this.pending = null;
      throw error?.code ? error : unavailable(String(error?.message || error));
    }
  }
  async load() {
    const epoch = this.epoch;
    const response = await this.fetch(new URL('model-lock.json', this.baseUrl), {cache: 'no-store', credentials: 'omit', redirect: 'error'});
    if (!response.ok) throw unavailable('The pinned face model bundle is unavailable.');
    const lockBytes = await response.arrayBuffer();
    const lockDigest = Array.from(new Uint8Array(await this.crypto.subtle.digest('SHA-256', lockBytes)), value => value.toString(16).padStart(2, '0')).join('');
    if (lockDigest !== MOBILE_FACE_LOCK_SHA256) throw unavailable('The local face model manifest failed its pinned digest check.');
    const lock = JSON.parse(new TextDecoder().decode(lockBytes));
    if (Object.keys(lock.profile ?? {}).length !== Object.keys(this.spec).length
      || Object.keys(this.spec).some(key => lock.profile[key] !== this.spec[key])) throw unavailable('The local model profile does not match the selected enrollment profile.');
    const assets = lock.browser_assets;
    if (!assets?.encoder || !assets?.detector || !assets?.runtime_module || !assets?.runtime_wasm_module || !assets?.runtime_wasm) throw unavailable('The local model bundle is incomplete.');
    const results = await Promise.all([this.verified(assets.encoder), this.verified(assets.detector),
      this.verified(assets.runtime_module), this.verified(assets.runtime_wasm_module), this.verified(assets.runtime_wasm)]);
    if (epoch !== this.epoch) throw unavailable('Face model loading was cancelled.');
    // Build staging pins these scripts and the runtime reads only this local
    // directory. A compromised origin remains outside the inspection guarantee.
    const ort = await this.importRuntime(new URL(assets.runtime_module.file, this.baseUrl).href);
    if (epoch !== this.epoch) throw unavailable('Face model loading was cancelled.');
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.wasm.wasmPaths = this.baseUrl.href;
    const options = {executionProviders: ['wasm'], graphOptimizationLevel: 'all'};
    let encoder, detector;
    try {
      encoder = await ort.InferenceSession.create(results[0], options);
      if (epoch !== this.epoch) throw unavailable('Face model loading was cancelled.');
      if (encoder.inputNames.join(',') !== 'img1,img2' || !encoder.outputNames.includes('embeddings')) throw unavailable('The selected paired encoder interface is incompatible.');
      detector = await ort.InferenceSession.create(results[1], options);
      if (epoch !== this.epoch) throw unavailable('Face model loading was cancelled.');
      this.runtime = ort; this.encoder = encoder; this.detector = detector;
    } catch (error) { await encoder?.release?.(); await detector?.release?.(); throw error; }
  }
  async encodeAligned(tensor, {current = () => true} = {}) {
    await this.ready();
    if (!current()) throw unavailable('Face inference was cancelled.');
    if (!(tensor instanceof Float32Array) || tensor.length !== 3 * 112 * 112
      || !Array.from(tensor).every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw unavailable('The aligned RGB input is incompatible.');
    const input = new this.runtime.Tensor('float32', tensor, [1, 3, 112, 112]);
    // The published graph owns ImageNet normalization and original/flip summing.
    // Duplicating one crop defines a single-image encoder without mixing people.
    let outputs;
    try {
      outputs = await this.encoder.run({img1: input, img2: input});
      const output = outputs.embeddings;
      if (output?.dims?.join(',') !== '2,128') throw unavailable('The encoder returned an incompatible output.');
      if (!current()) throw unavailable('Face inference was cancelled.');
      return normalizeFaceFeature(output.data.slice(0, 128));
    } finally { input.dispose?.(); for (const value of Object.values(outputs ?? {})) value.dispose?.(); }
  }
  async extract(media, {current = () => true} = {}) {
    await this.ready();
    let pixels, detectorInput, aligned;
    try {
      pixels = media.pixels ?? await this.decodeImage(media.blob);
      if (!current()) throw unavailable('Face acquisition was cancelled.');
      detectorInput = resizeDetectorInput(pixels);
      const tensor = new this.runtime.Tensor('float32', detectorInput.tensor, [1, 3, 320, 320]);
      let detected;
      try { detected = await this.detector.run({[this.detector.inputNames[0]]: tensor}); }
      finally { tensor.dispose?.(); }
      let faces;
      try { faces = decodeYuNet(detected); }
      finally { for (const value of Object.values(detected)) value.dispose?.(); }
      if (!current()) throw unavailable('Face inference was cancelled.');
      aligned = alignSingleFace(pixels, faces, detectorInput);
      const embedding = await this.encodeAligned(aligned.tensor, {current});
      return {embedding, quality: 'accepted', simulation: !!media.simulation,
        alignment_residual: aligned.residual, detected_face_count: 1, liveness: 'unresolved', trusted_capture: 'unresolved'};
    } finally {
      pixels?.data?.fill?.(0); detectorInput?.tensor?.fill(0); aligned?.tensor?.fill(0);
    }
  }
  async close() {
    this.epoch++;
    const encoder = this.encoder, detector = this.detector;
    this.encoder = this.detector = this.runtime = null; this.pending = null;
    try { await encoder?.release?.(); } finally { await detector?.release?.(); }
  }
}
export async function decodeBrowserImage(blob) {
  if (!blob || blob.size > 16777216) throw Object.assign(new Error('A bounded fresh camera image is required.'), {code: 'capture_quality_failure'});
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  try {
    if (bitmap.width * bitmap.height > 16777216) throw new Error('The camera image is too large.');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) throw new Error('Local camera pixel decoding is unavailable.');
    context.drawImage(bitmap, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally { bitmap.close(); canvas.width = canvas.height = 0; }
}

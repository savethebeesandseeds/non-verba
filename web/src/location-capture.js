// SPDX-License-Identifier: AGPL-3.0-only
import {locationPlatform, checkLocationActive, beginNativeCollection, finalizeNativeCollection,
  cancelNativeCollection, MAX_LOCATION_MEDIA} from './location-platform.js';

const prepared = new WeakMap();
const now = () => Math.floor(Date.now() / 1000);

function awaitActive(operation, signal, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); reject(new DOMException('Location collection cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('The location operation timed out.')); }, timeout);
    signal?.addEventListener('abort', cancel, {once: true});
    Promise.resolve(operation).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal?.aborted) cancel();
  });
}

function lifecycle(external) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const hidden = () => { if (globalThis.document?.hidden) abort(); };
  external?.addEventListener('abort', abort, {once: true});
  globalThis.document?.addEventListener('visibilitychange', hidden);
  globalThis.addEventListener?.('pagehide', abort);
  globalThis.addEventListener?.('nonverba:pause', abort);
  if (external?.aborted || globalThis.document?.hidden) abort();
  return {controller, cleanup() {
    external?.removeEventListener('abort', abort);
    globalThis.document?.removeEventListener('visibilitychange', hidden);
    globalThis.removeEventListener?.('pagehide', abort);
    globalThis.removeEventListener?.('nonverba:pause', abort);
  }};
}

function browserTrace(request, signal, onProgress, cameraSelection) {
  return new Promise((resolve, reject) => {
    const geo = globalThis.navigator?.geolocation;
    if (!geo || typeof geo.watchPosition !== 'function') { reject(new Error('Location collection requires a location-capable browser over HTTPS or localhost.')); return; }
    if (request.policy.profile === 'native-required' || request.policy.required_provider === 'gnss' || request.policy.raw_gnss) {
      reject(new Error('This request requires native Android location collection. Browser geolocation cannot satisfy that policy.')); return;
    }
    let selectPending = null;
    let watch = null, settled = false, pollPending = false, poller = null, lastIssue = 'No location updates were received.';
    const startedWall = Date.now(), startedMono = performance.now(), samples = [];
    const elapsed = () => Math.round(performance.now() - startedMono);
    const progress = () => onProgress?.({state: 'collecting', elapsed_ms: elapsed(), sample_count: samples.length,
      span_ms: samples.length > 1 ? samples.at(-1).fix_timestamp_ms - samples[0].fix_timestamp_ms : 0,
      last_sample: samples.at(-1), message: lastIssue});
    const cleanup = () => {
      clearTimeout(deadline); clearInterval(ticker); clearInterval(poller); signal?.removeEventListener('abort', cancel);
      if (watch !== null) { geo.clearWatch(watch); watch = null; }
    };
    const finish = (error, trace) => { if (settled) return; settled = true; cleanup(); if(error && selectPending) selectPending.reject(error); error ? reject(error) : resolve(trace); };
    const finishIfReady = () => {
      if(settled || (cameraSelection && !cameraSelection.selected) || samples.length < request.policy.min_samples) return;
      const last=samples.at(-1), first=samples[0];
      if(last.fix_timestamp_ms-first.fix_timestamp_ms < request.policy.duration_ms || last.observed_elapsed_ms-first.observed_elapsed_ms < request.policy.duration_ms) return;
      finish(null,{version:1,type:'nonverba-location-trace',request,profile:'software-browser',permission_precision:'browser',uncertainty_semantics:'w3c-95-percent',capture_correlation:'none',started_at_ms:startedWall,ended_at_ms:Date.now(),elapsed_ms:elapsed(),samples});
    };
    const selectFresh = () => {
      if(!selectPending || settled) return;
      const last=samples.at(-1), wall=Date.now();
      if(!last || wall-last.fix_timestamp_ms > Math.min(request.policy.max_fix_age_ms,5000)) return;
      checkLocationActive(signal);
      if(wall>=request.challenge.expires_at*1000) throw new Error('The camera location request expired.');
      cameraSelection.selected=Object.freeze({latitude:last.latitude,longitude:last.longitude,accuracy_m:last.accuracy_m,altitude_m:last.altitude_m,altitude_accuracy_m:last.altitude_accuracy_m,timestamp_ms:last.fix_timestamp_ms,source:'device-geolocation'});
      selectPending.resolve(cameraSelection.selected);selectPending=null;finishIfReady();
    };
    if(cameraSelection) cameraSelection.select=()=>new Promise((resolve,reject)=>{selectPending={resolve,reject};try{selectFresh();}catch(error){finish(error);}});
    const cancel = () => finish(new DOMException('Location collection cancelled.', 'AbortError'));
    const deadline = setTimeout(() => finish(new Error(`A complete location window was not available. ${lastIssue} No proof was signed.`)), 60000);
    const ticker = setInterval(() => {
      try { if (Date.now() >= request.challenge.expires_at * 1000) throw new Error('The requester challenge expired during location collection.'); progress(); }
      catch (error) { finish(error); }
    }, 250);
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) { cancel(); return; }
    try {
      const observe = position => {
        if (settled) return;
        try {
          checkLocationActive(signal);
          const observed = elapsed(), wall = Date.now(), c = position.coords, fixTime = Math.floor(position.timestamp);
          if (Math.abs((wall - startedWall) - observed) > 1000) throw new Error('The device clock changed during location collection.');
          if (observed > 60000 || wall >= request.challenge.expires_at * 1000) throw new Error('The location collection window expired.');
          if (!Number.isSafeInteger(fixTime) || fixTime < startedWall || fixTime > wall + 1000
              || wall - fixTime > Math.min(request.policy.max_fix_age_ms, request.policy.max_delivery_delay_ms)) {
            lastIssue = 'The provider returned a stale or invalid measurement. Waiting for a fresh fix.'; progress(); return;
          }
          if (![c.latitude, c.longitude, c.accuracy].every(Number.isFinite)
              || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180 || c.accuracy < 0
              || (c.altitude != null && !Number.isFinite(c.altitude))
              || (c.altitudeAccuracy != null && (!Number.isFinite(c.altitudeAccuracy) || c.altitudeAccuracy < 0 || c.altitude == null))) {
            lastIssue = 'The provider returned invalid coordinates or uncertainty.'; progress(); return;
          }
          if (c.accuracy > request.policy.max_accuracy_m) {
            lastIssue = `Accuracy is ±${Math.ceil(c.accuracy)} m; this request requires ${request.policy.max_accuracy_m} m or better.`; progress(); return;
          }
          const previous = samples.at(-1);
          if (previous && (fixTime <= previous.fix_timestamp_ms || observed <= previous.observed_elapsed_ms)) {
            lastIssue = 'Waiting for a distinct new measurement; repeated fixes do not extend the window.'; progress(); return;
          }
          if (samples.length >= 128) throw new Error('The location provider exceeded the bounded sample limit.');
          samples.push({sequence: samples.length, observed_elapsed_ms: observed, fix_timestamp_ms: fixTime,
            fix_elapsed_ms: null, provider: 'browser-geolocation', latitude: c.latitude, longitude: c.longitude,
            accuracy_m: c.accuracy, altitude_m: c.altitude ?? null, altitude_accuracy_m: c.altitudeAccuracy ?? null, mock: null});
          lastIssue = 'Collecting fresh device-reported measurements.'; progress();
          selectFresh(); finishIfReady();
        } catch (error) { finish(error); }
      };
      watch = geo.watchPosition(observe, error => finish(new Error(error.code === 1 ? 'Location permission was denied. Allow access and retry; no proof was signed.'
        : error.code === 3 ? 'The location provider timed out before enough fresh measurements arrived.'
          : 'The location provider is unavailable. Enable location services and retry.')),
      {enableHighAccuracy: true, maximumAge: 0, timeout: 15000});
      // watchPosition need not emit when coordinates remain unchanged. Ask for
      // another provider measurement at most once per second, with only one
      // request pending. Repeated timestamps still never count as new fixes.
      if (!settled && typeof geo.getCurrentPosition === 'function') poller = setInterval(() => {
        if (settled || pollPending) return;
        pollPending = true;
        try {
          geo.getCurrentPosition(position => { pollPending = false; observe(position); }, error => {
            pollPending = false;
            if (settled) return;
            if (error.code === 1) finish(new Error('Location permission was denied. Allow access and retry; no proof was signed.'));
            else lastIssue = 'Waiting for another fresh provider measurement.';
          }, {enableHighAccuracy: true, maximumAge: 0, timeout: 15000});
        } catch (error) { pollPending = false; finish(error); }
      }, 1000);
      cameraSelection?.onStart();
      // Also handle a synchronous provider callback in test/platform adapters.
      if (settled && watch !== null) { geo.clearWatch(watch); watch = null; }
    } catch (error) { finish(error); }
  });
}

/** Freeze a real sampling window before the caller captures optional media. */
export async function beginLocationCollection({engine, request, signal, onProgress, cameraSelection}) {
  const life = lifecycle(signal), active = life.controller.signal;
  let native;
  const stopNative = () => cancelNativeCollection(native), cleanupLife = life.cleanup;
  active.addEventListener('abort', stopNative, {once: true});
  life.cleanup = () => { active.removeEventListener('abort', stopNative); cleanupLife(); };
  try {
    checkLocationActive(active);
    const validated = await awaitActive(engine.json('validate_location_request', JSON.stringify(request), now()), active);
    checkLocationActive(active);
    const platform = locationPlatform();
    let trace, selected;
    if (platform.native) {
      native = await beginNativeCollection({platform, request: validated, signal: active, onProgress, cameraSelection});
      selected = native.selected;
    } else {
      trace = await browserTrace(validated, active, onProgress, cameraSelection);
      checkLocationActive(active);
      trace = await awaitActive(engine.json('validate_location_trace', JSON.stringify(trace), now()), active);
      checkLocationActive(active);
      const last = trace.samples.at(-1);
      selected = {latitude: last.latitude, longitude: last.longitude, accuracy_m: last.accuracy_m,
        altitude_m: last.altitude_m, altitude_accuracy_m: last.altitude_accuracy_m,
        timestamp_ms: last.fix_timestamp_ms, source: 'device-geolocation'};
    }
    checkLocationActive(active);
    const collection = Object.freeze({selected: Object.freeze({...(cameraSelection?.selected ?? selected)}), profile: platform.profile,
      request: JSON.parse(JSON.stringify(validated)), key_fingerprint: platform.capabilities?.key_fingerprint,
      cancel() { life.controller.abort(); life.cleanup(); }});
    prepared.set(collection, {life, platform, native, trace, used: false});
    return collection;
  } catch (error) { life.controller.abort(); cancelNativeCollection(native); life.cleanup(); throw error; }
}

/** Bind a frozen collection to the exact optional JPEG bytes, then sign in Rust/native code. */
export async function finalizeLocationProof({engine, collection, identity, mediaBytes, signal, onProgress}) {
  const state = prepared.get(collection);
  if (!state || state.used) throw new Error('This location collection is unavailable or was already finalized.');
  state.used = true;
  const abort = () => state.life.controller.abort();
  signal?.addEventListener('abort', abort, {once: true});
  if (signal?.aborted) abort();
  const active = state.life.controller.signal;
  try {
    checkLocationActive(active);
    if (mediaBytes != null && (!(mediaBytes instanceof Uint8Array) || !mediaBytes.length || mediaBytes.length > MAX_LOCATION_MEDIA)) throw new Error('The bound JPEG is missing or exceeds 32 MiB.');
    if (state.platform.native) return await finalizeNativeCollection(state.native, {mediaBytes, signal: active, onProgress});
    if (typeof identity !== 'string' || !identity) throw new Error('The browser location signing identity is unavailable.');
    const asset = mediaBytes == null ? null : await awaitActive(engine.json('location_asset', mediaBytes), active);
    checkLocationActive(active);
    const proof = await awaitActive(engine.call('seal_location_proof', JSON.stringify(state.trace), identity, JSON.stringify(asset), now()), active);
    checkLocationActive(active);
    return proof;
  } catch (error) { cancelNativeCollection(state.native); throw error; }
  finally { signal?.removeEventListener('abort', abort); state.life.cleanup(); prepared.delete(collection); }
}

/** Standalone convenience API; callers may use begin/finalize around a camera frame. */
export async function collectLocationProof(options) {
  const collection = await beginLocationCollection(options);
  try { return await finalizeLocationProof({...options, collection}); }
  catch (error) { collection.cancel(); throw error; }
}

/** Camera-only overlapping collection; standalone begin/finalize remains unchanged. */
export async function startConcurrentLocationCollection(options) {
  if(options.request?.context?.purpose!=='camera' || options.request.context.camera_timing!=='concurrent') throw new Error('Concurrent collection requires an explicit camera request.');
  const controller=new AbortController();
  const stop=()=>controller.abort();options.signal?.addEventListener('abort',stop,{once:true});
  if(options.signal?.aborted) stop();
  let started;const start=new Promise(resolve=>{started=resolve;});
  const control={selected:null,onStart:started};
  const ready=beginLocationCollection({...options,signal:controller.signal,cameraSelection:control});
  ready.catch(()=>{controller.abort();options.signal?.removeEventListener('abort',stop);});
  let used=false;
  const cancel=()=>{controller.abort();options.signal?.removeEventListener('abort',stop);};
  try { await Promise.race([start,ready]); } catch(error) { cancel();throw error; }
  return Object.freeze({ready,cancel,async selectForCamera(){
    checkLocationActive(controller.signal);
    if(used) throw new Error('The camera location observation was already selected.');
    used=true;
    try { const selected=await control.select();checkLocationActive(controller.signal);return selected; }
    catch(error){cancel();throw error;}
  }});
}

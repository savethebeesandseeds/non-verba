// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnrollmentCamera, ENROLLMENT_PHOTO_MAX_BYTES, ENROLLMENT_IMAGE_INPUT_LIMITS,
  prepareEnrollmentImage} from '../../../web/shared/identity/enrollment-camera.js';

function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return {promise,resolve}; }
function fixture(t, options = {}) {
  const calls = [], events = new EventTarget(), document = new EventTarget(); document.hidden = false;
  const listeners = new Map();
  const track = {readyState:'live', stop() { calls.push('stop'); this.readyState = 'ended'; },
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); }};
  const stream = {getTracks:() => [track], getVideoTracks:() => [track], getAudioTracks:() => options.audio ? [{}] : []};
  const video = {videoWidth:3200,videoHeight:2400,srcObject:null,play:async () => { calls.push('play'); },pause:() => calls.push('pause')};
  const canvas = {width:0,height:0,getContext:() => ({drawImage(...args) { calls.push(['draw',args[3],args[4]]); }}),
    toBlob(callback, type) { calls.push(['encode',type]); if (options.encoding) options.encoding.resolve(callback); else callback(new Blob(['jpeg'],{type})); }};
  const camera = createEnrollmentCamera({video,document,events,canvasFactory:() => canvas,
    onInterrupted:reason => calls.push(['interrupted',reason]), leaseMs:options.leaseMs || 90_000,
    mediaDevices:{async getUserMedia(constraints) { calls.push(['request',constraints]); return options.permission ? options.permission.promise : stream; }}});
  t.after(() => camera.dispose());
  return {camera,video,canvas,track,stream,calls,events,document,listeners};
}

test('document camera starts deliberately, requests rear video only and stops before bounded JPEG encoding', async t => {
  const f = fixture(t);
  assert.equal(f.calls.length,0);
  await f.camera.start('document_front');
  const constraints = f.calls.find(value => value[0] === 'request')[1];
  assert.equal(constraints.audio,false); assert.equal(constraints.video.facingMode.ideal,'environment');
  assert.equal(f.camera.active(),true);
  const photo = await f.camera.capture();
  assert.ok(photo instanceof Blob); assert.equal(photo.type,'image/jpeg');
  assert.deepEqual(f.calls.find(value => value[0] === 'draw'),['draw',1600,1200]);
  assert.ok(f.calls.indexOf('stop') < f.calls.findIndex(value => value[0] === 'encode'));
  assert.equal(f.video.srcObject,null); assert.equal(f.camera.active(),false);
  assert.equal(f.canvas.width,0); assert.equal(f.canvas.height,0);
});

test('frontal still requests user camera and applies the smaller face dimension bound', async t => {
  const f = fixture(t); await f.camera.start('face_front'); await f.camera.capture();
  assert.equal(f.calls.find(value => value[0] === 'request')[1].video.facingMode.ideal,'user');
  assert.deepEqual(f.calls.find(value => value[0] === 'draw'),['draw',960,720]);
});

test('cancelled permission request stops a late stream without attaching it', async t => {
  const permission = deferred(), f = fixture(t,{permission});
  const opening = f.camera.start('document_front');
  const cancelled = assert.rejects(opening,/cancelled/);
  assert.equal(f.camera.stop(),false, 'Pending permission cleanup must not claim a known stopped sensor.');
  await cancelled;
  await assert.rejects(f.camera.start('face_front'),/shutdown could not be confirmed/);
  assert.equal(f.calls.filter(value => value[0] === 'request').length,1);
  permission.resolve(f.stream);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.track.readyState,'ended'); assert.equal(f.video.srcObject,null); assert.equal(f.calls.includes('play'),false);
});

test('cancellation while encoding rejects the late photo after the sensor has stopped', async t => {
  const encoding = deferred(), f = fixture(t,{encoding}); await f.camera.start('face_front');
  const capturing = f.camera.capture(), callback = await encoding.promise;
  assert.equal(f.track.readyState,'ended'); f.camera.stop(); callback(new Blob(['jpeg'],{type:'image/jpeg'}));
  await assert.rejects(capturing,/cancelled/); assert.equal(f.canvas.width,0);
});

test('lifecycle events stop the current stream and clear its preview', async t => {
  for (const reason of ['visibilitychange','pagehide','nonverba:camera-stop']) {
    const f = fixture(t); await f.camera.start('face_front');
    if (reason === 'visibilitychange') { f.document.hidden = true; f.document.dispatchEvent(new Event(reason)); }
    else f.events.dispatchEvent(new Event(reason));
    assert.equal(f.track.readyState,'ended'); assert.equal(f.video.srcObject,null);
    assert.equal(f.camera.active(),false); assert.equal(f.calls.filter(value => value[0] === 'interrupted').length,1);
  }
});

test('track loss interrupts capture and mixed audio/video is refused and stopped', async t => {
  const f = fixture(t); await f.camera.start('face_front'); f.track.readyState = 'ended'; f.listeners.get('ended')();
  await assert.rejects(f.camera.capture(),/Start the camera/); assert.equal(f.video.srcObject,null);
  const audio = fixture(t,{audio:true}); await assert.rejects(audio.camera.start('document_front'),/camera-only/);
  assert.equal(audio.track.readyState,'ended'); assert.equal(audio.video.srcObject,null);
});

test('oversized JPEG and unavailable frame fail without retaining camera or canvas buffers', async t => {
  const encoding = deferred(), f = fixture(t,{encoding}); await f.camera.start('document_front');
  const capturing = f.camera.capture(), callback = await encoding.promise;
  callback(new Blob([new Uint8Array(ENROLLMENT_PHOTO_MAX_BYTES + 1)],{type:'image/jpeg'}));
  await assert.rejects(capturing,/supported JPEG size/);
  assert.equal(f.track.readyState,'ended'); assert.equal(f.canvas.width,0);
  const frame = fixture(t); await frame.camera.start('face_front'); frame.video.videoWidth = 0;
  await assert.rejects(frame.camera.capture(),/not ready/); frame.camera.stop(); assert.equal(frame.track.readyState,'ended');
});

test('failure stopping one track attempts all shutdowns and refuses the photo', async t => {
  const f = fixture(t); await f.camera.start('face_front'); let secondStopped = false;
  f.stream.getTracks = () => [{readyState:'live',stop() { throw new Error('failed'); }},
    {get readyState() { return secondStopped ? 'ended' : 'live'; },stop() { secondStopped = true; }}];
  await assert.rejects(f.camera.capture(),/shutdown could not be confirmed/);
  assert.equal(secondStopped,true); assert.equal(f.video.srcObject,null); assert.equal(f.canvas.width,0);
  await assert.rejects(f.camera.start('document_front'),/shutdown could not be confirmed/);
});

test('the bounded camera lease expires and permanent disposal blocks later acquisition', async t => {
  const f = fixture(t,{leaseMs:10}); await f.camera.start('face_front');
  await new Promise(resolve => setTimeout(resolve,25));
  assert.equal(f.track.readyState,'ended'); assert.equal(f.camera.active(),false);
  f.camera.dispose(); await assert.rejects(f.camera.start('document_front'),/closed/);
  assert.equal(f.calls.filter(value => value[0] === 'request').length,1);
});

test('invalid photo kinds and hidden documents do not ask for camera access', async t => {
  const f = fixture(t); await assert.rejects(f.camera.start('video'),/Unsupported/);
  f.document.hidden = true; await assert.rejects(f.camera.start('face_front'),/hidden/);
  assert.equal(f.calls.length,0);
});

function jpegHeader(width,height,orientation = 1) {
  const exif = new Uint8Array(36), view = new DataView(exif.buffer);
  exif.set([0xff,0xe1,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0]);
  view.setUint16(20,0x112,true); view.setUint16(22,3,true); view.setUint32(24,1,true);
  view.setUint16(28,orientation,true);
  return new Blob([new Uint8Array([0xff,0xd8]),exif,
    new Uint8Array([0xff,0xc0,0,11,8,height >> 8,height & 255,width >> 8,width & 255,1,1,0x11,0,0xff,0xda,0,8,1,1,0,0,63,0,1,0xff,0xd9])],{type:'image/jpeg'});
}
function imageFixture(options = {}) {
  const calls = [], canvas = {width:0,height:0};
  let closed = 0, count = 0;
  canvas.getContext = () => ({fillRect() {},drawImage() { calls.push(['draw',canvas.width,canvas.height]); }});
  canvas.toBlob = (callback,type,quality) => {
    calls.push(['encode',canvas.width,canvas.height,quality]);
    if (options.encoding) options.encoding.resolve(callback);
    else {
      const size = options.sizes?.[count++] || 128;
      callback(new Blob([new Uint8Array([0xff,0xd8,0xff,0xda,0,8,1,1,0,0,63,0]),new Uint8Array(Math.max(0,size-14)),new Uint8Array([0xff,0xd9])],{type:options.type || type}));
    }
  };
  const decodeImage = async (blob,bounds) => {
    calls.push(['decode',bounds.width,bounds.height]);
    if (options.decoding) await options.decoding.promise;
    return {width:bounds.width,height:bounds.height,close() { closed++; }};
  };
  return {canvas,calls,get closed() { return closed; }, options:{decodeImage,canvasFactory:() => canvas}};
}

test('large phone images are decoded at transport dimensions and re-encoded even when source bytes are small', async () => {
  const f = imageFixture(), photo = await prepareEnrollmentImage(jpegHeader(8000,6000),f.options);
  assert.equal(photo.type,'image/jpeg'); assert.ok(photo.size <= ENROLLMENT_PHOTO_MAX_BYTES);
  assert.deepEqual(f.calls.find(value => value[0] === 'decode'),['decode',2400,1800]);
  assert.equal(f.closed,1); assert.equal(f.canvas.width,0); assert.equal(f.canvas.height,0);
  const face = imageFixture(); await prepareEnrollmentImage(jpegHeader(8000,6000),{...face.options,kind:'face_front'});
  assert.deepEqual(face.calls.find(value => value[0] === 'decode'),['decode',1280,960]);
});

test('phone EXIF orientation controls the bounded portrait dimensions before metadata is discarded', async () => {
  for (const orientation of [5,6,7,8]) {
    const f = imageFixture(); await prepareEnrollmentImage(jpegHeader(8000,6000,orientation),f.options);
    assert.deepEqual(f.calls.find(value => value[0] === 'decode'),['decode',1800,2400]);
  }
});

test('the production decoder requests a resized bitmap and closes its pixel buffer', async t => {
  const previous = globalThis.createImageBitmap, f = imageFixture(); let requested;
  globalThis.createImageBitmap = async (blob,options) => {
    requested = options;
    return {width:options.resizeWidth,height:options.resizeHeight,close() { f.calls.push(['closed']); }};
  };
  t.after(() => { if (previous === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = previous; });
  await prepareEnrollmentImage(jpegHeader(8000,6000),{canvasFactory:f.options.canvasFactory});
  assert.deepEqual(requested,{resizeWidth:2400,resizeHeight:1800,resizeQuality:'high',imageOrientation:'from-image'});
  assert.equal(f.calls.filter(value => value[0] === 'closed').length,1);
});

test('dimensions, type and compressed bytes are bounded before a decoder or canvas can allocate pixels', async () => {
  const unsupported = new Blob(['not a jpeg'],{type:'image/jpeg'});
  const tooLarge = new Blob([new Uint8Array(ENROLLMENT_IMAGE_INPUT_LIMITS.maxBytes + 1)],{type:'image/jpeg'});
  for (const [blob,code] of [[jpegHeader(10000,7000),'image_dimensions'],[jpegHeader(17000,10),'image_dimensions'],
    [unsupported,'image_format'],[new Blob(['svg'],{type:'image/svg+xml'}),'image_format'],[tooLarge,'image_size']]) {
    const f = imageFixture();
    await assert.rejects(prepareEnrollmentImage(blob,f.options),error => error.code === code);
    assert.equal(f.calls.length,0);
  }
});

test('truncated metadata, unsupported EXIF orientation and a decoder that ignores resize are rejected', async () => {
  for (const blob of [jpegHeader(8000,6000,9), new Blob([new Uint8Array([0xff,0xd8,0xff,0xe1,0xff,0xff])],{type:'image/jpeg'})]) {
    const f = imageFixture(); await assert.rejects(prepareEnrollmentImage(blob,f.options),error => error.code === 'image_format');
    assert.equal(f.calls.length,0);
  }
  const f = imageFixture(); let closed = false;
  await assert.rejects(prepareEnrollmentImage(jpegHeader(8000,6000),{...f.options,
    decodeImage:async () => ({width:8000,height:6000,close() { closed = true; }})}),error => error.code === 'image_dimensions_mismatch');
  assert.equal(closed,true); assert.equal(f.calls.length,0);
});

test('dense photos automatically lower quality and resolution while preserving a useful document size', async () => {
  const oversize = ENROLLMENT_PHOTO_MAX_BYTES + 1;
  const f = imageFixture({sizes:[oversize,oversize,oversize,512]});
  assert.equal((await prepareEnrollmentImage(jpegHeader(8000,6000),f.options)).size,512);
  assert.deepEqual(f.calls.filter(value => value[0] === 'draw'),[['draw',2400,1800],['draw',1600,1200]]);
  assert.equal(f.calls.filter(value => value[0] === 'encode').length,4);
  const small = imageFixture(); await prepareEnrollmentImage(jpegHeader(800,600),small.options);
  assert.deepEqual(small.calls.find(value => value[0] === 'draw'),['draw',800,600]);
});

test('cancelled decode and encode close resources and never return a late photo', async () => {
  const decoder = deferred(), controller = new AbortController(), f = imageFixture({decoding:decoder});
  const preparing = prepareEnrollmentImage(jpegHeader(8000,6000),{...f.options,signal:controller.signal});
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  controller.abort(); decoder.resolve();
  await assert.rejects(preparing,error => error.code === 'capture_cancelled');
  assert.equal(f.closed,1); assert.equal(f.calls.filter(value => value[0] === 'encode').length,0);
  const encoder = deferred(), second = new AbortController(), g = imageFixture({encoding:encoder});
  const pending = prepareEnrollmentImage(jpegHeader(8000,6000),{...g.options,signal:second.signal});
  const callback = await encoder.promise; second.abort(); callback(new Blob(['late'],{type:'image/jpeg'}));
  await assert.rejects(pending,error => error.code === 'capture_cancelled');
  assert.equal(g.closed,1); assert.equal(g.canvas.width,0); assert.equal(g.canvas.height,0);
});

test('invalid encoded output and exhausted quality attempts fail with cleanup', async () => {
  for (const options of [{type:'image/png'},{sizes:Array(6).fill(ENROLLMENT_PHOTO_MAX_BYTES + 1)}]) {
    const f = imageFixture(options);
    await assert.rejects(prepareEnrollmentImage(jpegHeader(8000,6000),f.options),error => ['image_decode_failed','image_size'].includes(error.code));
    assert.equal(f.closed,1); assert.equal(f.canvas.width,0); assert.equal(f.canvas.height,0);
  }
});

test('encoder ICC and arbitrary application/comment metadata are removed before and after image scans', async () => {
  const f=imageFixture(), jfif=new Uint8Array([255,224,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0]);
  const metadata=(marker,text)=>{const bytes=new TextEncoder().encode(text);return new Uint8Array([255,marker,(bytes.length+2)>>8,(bytes.length+2)&255,...bytes]);};
  const prefix=new Uint8Array([255,216]), scan=new Uint8Array([255,218,0,8,1,1,0,0,63,0,9,255,0,8,255,208,7]), end=new Uint8Array([255,217]);
  f.canvas.toBlob=callback=>callback(new Blob([prefix,jfif,metadata(226,'ICC_PROFILE private-canary'),metadata(225,'Exif private-canary'),
    scan,metadata(254,'private-canary'),metadata(237,'private-canary'),jfif,end,new TextEncoder().encode('private-canary')],{type:'image/jpeg'}));
  const result=await prepareEnrollmentImage(jpegHeader(8000,6000),f.options), bytes=new Uint8Array(await result.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes).includes('private-canary'),false);
  assert.deepEqual(bytes,new Uint8Array([...prefix,...jfif,...scan,...end]),'Only the fixed pre-scan JFIF header and original pixel stream remain.');
  assert.equal(f.closed,1);assert.equal(f.canvas.width,0);
});

// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnrollmentCamera, ENROLLMENT_PHOTO_MAX_BYTES} from '../../../web/shared/identity/enrollment-camera.js';

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

// SPDX-License-Identifier: AGPL-3.0-only
// Debian-only synthetic transport tests: no network, browser, camera or phone.
import assert from 'node:assert/strict';
import test from 'node:test';
import {CameraPeer} from '../../web/src/camera-peer.js';
import {MAX_LOCATION_PROOF} from '../../web/src/location-platform.js';
const COMPOSED_LABEL = 'nonverba-camera-location-v2';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run inside non-verba-dev.');
const MAX_IMAGE = 32 * 1024 * 1024, LABEL = 'nonverba-camera-v1';
const SDP = 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
function globals(values) {
  const old = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, {value, writable:true, configurable:true});
  return () => { for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } };
}
function setup(t, options = {}) {
  const state = {sent:[], messages:[], artifacts:[], artifactSets:[], failures:[], connected:0, pcs:[]};
  class Channel extends EventTarget {
    constructor(properties = {}) {
      super(); Object.assign(this, {label:options.mode === 'camera-location-v2' ? COMPOSED_LABEL : LABEL, ordered:true, maxRetransmits:null, maxPacketLifeTime:null,
        readyState:'open', bufferedAmount:0, closed:false}, properties);
    }
    send(value) { if (options.sendError) throw new Error('Injected send failure'); state.sent.push(value); }
    close() { if (this.closed) return; this.closed = true; this.readyState = 'closed'; this.onclose?.(); }
    receive(value) { this.onmessage?.({data:value}); }
  }
  class PC extends EventTarget {
    constructor(config) { super(); this.config = config; this.iceGatheringState = options.pendingIce ? 'gathering' : 'complete'; state.pcs.push(this); }
    createDataChannel(label, config) { state.localLabel = label; state.localConfig = config; return this.localChannel = new Channel({label}); }
    async createOffer() { return {type:'offer', sdp:SDP}; }
    async createAnswer() { return {type:'answer', sdp:SDP}; }
    async setLocalDescription(value) { this.localDescription = {...value, toJSON:() => value}; }
    async setRemoteDescription(value) { state.remote = value; }
    close() { this.closed = true; this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
  }
  const restore = globals({RTCPeerConnection:PC});
  const peer = new CameraPeer({mode:options.mode, onMessage:value => { state.messages.push(value); return options.onMessage?.(value); },
    onArtifact:value => { state.artifacts.push(value); return options.onArtifact?.(value); },
    onArtifacts:value => { state.artifactSets.push(value); return options.onArtifacts?.(value); },
    authorizeArtifacts:options.authorizeArtifacts || (() => true),
    onConnected:() => { state.connected++; }, onFailure:error => state.failures.push(error),
    authorizeArtifact:options.authorizeArtifact || (() => true)});
  const channel = new Channel(options.channel);
  if (options.attach !== false) peer.pc.ondatachannel({channel});
  t.after(() => { peer.close(); restore(); });
  return {peer, channel, state, Channel};
}
function timers(t) {
  const pending = new Map(); let id = 0;
  const restore = globals({setTimeout:(fn, ms) => { pending.set(++id, {fn, ms}); return id; }, clearTimeout:id => pending.delete(id)});
  t.after(restore);
  return {pending, fire(ms) { const entry = [...pending].find(([, timer]) => timer.ms === ms); assert.ok(entry, `Missing ${ms}ms timer`); pending.delete(entry[0]); entry[1].fn(); }};
}
const header = (channel, bytes, extra = {}) => channel.receive(JSON.stringify({type:'artifact', bytes, ...extra}));
function fragment(offset, length, value = 7) {
  const data = new ArrayBuffer(length + 4); new DataView(data).setUint32(0, offset, true); new Uint8Array(data, 4).fill(value); return data;
}
function rejected(h, delivered = 0) {
  assert.equal(h.peer.closed, true); assert.equal(h.channel.closed, true); assert.equal(h.peer.incoming, null);
  assert.equal(h.state.failures.length, 1); assert.equal(h.state.artifacts.length, delivered);
}

test('camera channels require their own label and reliable ordered delivery', async t => {
  for (const channel of [{label:'nonverba-live-location-v1'}, {label:'nonverba-audio-v1'}, {ordered:false},
    {maxRetransmits:0}, {maxPacketLifeTime:1000}]) await t.test(JSON.stringify(channel), sub => rejected(setup(sub, {channel})));
  const h = setup(t); assert.deepEqual(h.peer.pc.config, {iceServers:[], bundlePolicy:'max-bundle'});
  assert.equal(h.channel.binaryType, 'arraybuffer'); h.channel.onopen(); assert.equal(h.state.connected, 1);
  const extra = new h.Channel(); h.peer.pc.ondatachannel({channel:extra}); rejected(h); assert.equal(extra.closed, true);
  const late = new h.Channel(); h.peer.pc.ondatachannel({channel:late}); assert.equal(late.closed, true); assert.equal(h.state.failures.length, 1);
});

test('artifact allocation requires synchronous explicit authorization', t => {
  const allocated = [], Bytes = Uint8Array; let calls = 0;
  const h = setup(t, {authorizeArtifact:() => { calls++; assert.deepEqual(allocated, []); return false; }});
  const restore = globals({Uint8Array:new Proxy(Bytes, {construct(target, args, newTarget) { allocated.push(args[0]); return Reflect.construct(target, args, newTarget); }})});
  t.after(restore); header(h.channel, MAX_IMAGE);
  assert.equal(calls, 1); assert.deepEqual(allocated, []); rejected(h);
});

test('malformed and oversized artifact headers fail before authorizing', async t => {
  for (const value of [{type:'artifact'}, {type:'artifact', bytes:0}, {type:'artifact', bytes:-1},
    {type:'artifact', bytes:1.5}, {type:'artifact', bytes:'1'}, {type:'artifact', bytes:MAX_IMAGE + 1},
    {type:'artifact', bytes:Number.MAX_SAFE_INTEGER + 1}, {type:'artifact', bytes:1, unused:true}]) {
    await t.test(JSON.stringify(value), sub => {
      let calls = 0; const h = setup(sub, {authorizeArtifact:() => { calls++; return true; }});
      h.channel.receive(JSON.stringify(value)); assert.equal(calls, 0); rejected(h);
    });
  }
  await t.test('a promise is not permission', sub => {
    const h = setup(sub, {authorizeArtifact:() => Promise.resolve(true)}); header(h.channel, 1); rejected(h);
  });
});

test('permitted artifact boundaries allocate exactly once and close releases assembly', async t => {
  for (const size of [1, MAX_IMAGE]) await t.test(String(size), sub => {
    const h = setup(sub); header(h.channel, size); assert.equal(h.peer.incoming.bytes.length, size);
    assert.equal(h.state.failures.length, 0); h.peer.close(); assert.equal(h.peer.incoming, null);
  });
});

test('sender framing reconstructs exact JPEG bytes and calls the receiver synchronously', async t => {
  let callbackReached = false;
  const h = setup(t, {onArtifact:() => { callbackReached = true; }});
  const bytes = Uint8Array.from({length:32005}, (_, i) => i % 251);
  await h.peer.sendArtifact(bytes);
  assert.deepEqual(JSON.parse(h.state.sent[0]), {type:'artifact', bytes:bytes.length}); assert.equal(h.state.sent.length, 4);
  h.channel.receive(h.state.sent[0]);
  for (let i = 1; i < h.state.sent.length; i++) {
    const packet = h.state.sent[i], offset = (i - 1) * 16000;
    assert.equal(new DataView(packet.buffer).getUint32(0, true), offset);
    assert.equal(packet.length, Math.min(16000, bytes.length - offset) + 4);
    h.channel.receive(packet.buffer); assert.equal(callbackReached, i === 3);
  }
  assert.deepEqual(h.state.artifacts[0], bytes); assert.equal(h.peer.incoming, null);
  bytes.fill(0); assert.notDeepEqual(h.state.artifacts[0], bytes);
  header(h.channel, 1); rejected(h, 1);
});

test('fragments cannot skip, repeat, truncate, enlarge or change the negotiated representation', async t => {
  for (const [label, data] of [['offset', fragment(1, 16000)], ['short', fragment(0, 15999)],
    ['oversized', fragment(0, 16001)], ['empty', fragment(0, 0)], ['typed array', new Uint8Array(16004)],
    ['blob', new Blob(['bad'])]]) await t.test(label, sub => {
    const h = setup(sub); header(h.channel, 16001); h.channel.receive(data); rejected(h);
  });
  for (const [label, data] of [['repeat', fragment(0, 16000)], ['skip', fragment(16001, 1)], ['tail', fragment(16000, 2)]]) {
    await t.test(label, sub => { const h = setup(sub); header(h.channel, 16001); h.channel.receive(fragment(0, 16000)); h.channel.receive(data); rejected(h); });
  }
  await t.test('unsolicited binary', sub => { const h = setup(sub); h.channel.receive(fragment(0, 1)); rejected(h); });
});

test('controls and another artifact cannot enter an incomplete JPEG', async t => {
  for (const value of [{type:'abort'}, {type:'receipt', receipt:'test'}, {type:'artifact', bytes:1}]) await t.test(value.type, sub => {
    const h = setup(sub); header(h.channel, 16001); h.channel.receive(fragment(0, 16000)); h.channel.receive(JSON.stringify(value));
    assert.equal(h.state.messages.length, 0); rejected(h);
  });
});

test('malformed UTF-8-sized controls and floods close once without further callbacks', async t => {
  for (const data of ['{', 'null', '[]', '{"type":2}', '{"type":"Bad Type"}', ' '.repeat(65537),
    JSON.stringify({type:'status', payload:'é'.repeat(32768)})]) await t.test(data.slice(0, 24), sub => {
    const h = setup(sub); h.channel.receive(data); for (let i = 0; i < 80; i++) header(h.channel, MAX_IMAGE);
    assert.equal(h.state.messages.length, 0); rejected(h);
  });
  const h = setup(t); for (let i = 0; i < 64; i++) h.channel.receive('{"type":"status"}');
  assert.equal(h.state.messages.length, 64); header(h.channel, 1); rejected(h);
});

test('sender rejects invalid framing, bytes, repeated images and oversized controls before sending them', async t => {
  const h = setup(t);
  for (const value of [new Uint8Array(), new Uint8Array(MAX_IMAGE + 1), new ArrayBuffer(1), [1]]) await assert.rejects(h.peer.sendArtifact(value), /size/);
  for (const value of [null, [], {type:'artifact', bytes:1}, {type:'status', value:'é'.repeat(32768)}]) assert.throws(() => h.peer.send(value));
  assert.equal(h.state.sent.length, 0);
  await h.peer.sendArtifact(new Uint8Array([1]));
  await assert.rejects(h.peer.sendArtifact(new Uint8Array([2])), /already/);
  assert.equal(h.state.sent.length, 2);
  h.peer.send({type:'receipt'}); assert.equal(h.state.sent.length, 3);
});

test('backpressure blocks control/concurrent transfer and close promptly rejects the blocked sender', async t => {
  const h = setup(t), clock = timers(t); h.channel.bufferedAmount = 256001;
  const sending = h.peer.sendArtifact(new Uint8Array(16001));
  assert.equal(h.state.sent.length, 1); assert.equal(h.peer.sending, true);
  assert.throws(() => h.peer.send({type:'receipt'}), /pending/);
  await assert.rejects(h.peer.sendArtifact(new Uint8Array(1)), /pending/);
  const failed = assert.rejects(sending, /cancelled/); h.peer.close(); await failed;
  assert.equal(h.state.sent.length, 1); assert.equal(h.peer.sending, false); assert.equal(clock.pending.size, 0);
});

test('only a real low-water transition releases backpressure; deadline closes a stalled partial transfer', async t => {
  const h = setup(t), clock = timers(t); h.channel.bufferedAmount = 256001;
  const sending = h.peer.sendArtifact(new Uint8Array(1));
  h.channel.dispatchEvent(new Event('bufferedamountlow')); await Promise.resolve(); assert.equal(h.state.sent.length, 1);
  h.channel.bufferedAmount = 64000; h.channel.dispatchEvent(new Event('bufferedamountlow')); await sending;
  assert.equal(h.state.sent.length, 2); assert.equal(clock.pending.size, 0);
  await t.test('stalled', sub => {
    const s = setup(sub), time = timers(sub); s.channel.bufferedAmount = 256001;
    const pending = s.peer.sendArtifact(new Uint8Array(1)), failure = assert.rejects(pending, /stalled/);
    time.fire(5000); return failure.then(() => { rejected(s); assert.equal(time.pending.size, 0); });
  });
});

test('idle and total receiver deadlines discard incomplete bytes without delivering them', async t => {
  for (const delay of [5000, 180000]) await t.test(String(delay), sub => {
    const h = setup(sub), clock = timers(sub); header(h.channel, 16001); clock.fire(delay); rejected(h); assert.equal(clock.pending.size, 0);
  });
});

test('application callback failures and connection failures close all resources', async t => {
  for (const callback of [() => { throw new Error('Handler failed'); }, () => Promise.reject(new Error('Handler failed'))]) await t.test(String(callback), async sub => {
    const h = setup(sub, {onMessage:callback}); h.channel.receive('{"type":"status"}'); await Promise.resolve(); rejected(h);
  });
  const h = setup(t); h.peer.pc.connectionState = 'disconnected'; h.peer.pc.onconnectionstatechange(); rejected(h);
});

test('pairing accepts only a single data m-line and matching strict offer/answer objects', async t => {
  const h = setup(t, {attach:false});
  assert.deepEqual(await h.peer.description('offer'), {type:'offer', sdp:SDP});
  assert.equal(h.state.localLabel, LABEL); assert.deepEqual(h.state.localConfig, {ordered:true});
  await h.peer.answer({type:'answer', sdp:SDP}); assert.deepEqual(h.state.remote, {type:'answer', sdp:SDP});
  await assert.rejects(h.peer.answer({type:'answer', sdp:SDP}), /repeated/); assert.equal(h.peer.closed, true);
  for (const remote of [{type:'offer', sdp:SDP + 'm=audio 9 RTP/AVP 0\r\n'}, {type:'offer', sdp:'m=video 9 RTP/AVP 0\r\n'},
    {type:'answer', sdp:SDP}, {type:'offer', sdp:SDP, extra:true}, {type:'offer', sdp:'x'.repeat(100001)},
    {type:'offer', sdp:SDP + SDP}, {type:'offer', sdp:'v=0\r\n'}]) await t.test(JSON.stringify(remote).slice(0, 60), async sub => {
    const p = setup(sub, {attach:false}); await assert.rejects(p.peer.description('answer', remote)); assert.equal(p.peer.closed, true); assert.equal(p.state.remote, undefined);
  });
  await t.test('answerer', async sub => {
    const p = setup(sub, {attach:false}); assert.deepEqual(await p.peer.description('answer', {type:'offer', sdp:SDP}), {type:'answer', sdp:SDP});
  });
});

test('ICE gather can complete, time out, or be cancelled with no dangling wait', async t => {
  for (const outcome of ['complete','timeout','close']) await t.test(outcome, async sub => {
    const h = setup(sub, {attach:false, pendingIce:true}), clock = timers(sub);
    const pending = h.peer.description('offer');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(clock.pending.size, 1);
    if (outcome === 'complete') { h.peer.pc.iceGatheringState = 'complete'; h.peer.pc.dispatchEvent(new Event('icegatheringstatechange')); await pending; }
    else { const failed = assert.rejects(pending, outcome === 'timeout' ? /timed out/ : /cancelled/); if (outcome === 'timeout') clock.fire(10000); else h.peer.close(); await failed; }
    assert.equal(clock.pending.size, 0);
  });
});


test('a backpressured sender retains the original input and has a total transfer deadline', async t => {
  const h = setup(t), clock = timers(t); h.channel.bufferedAmount = 256001;
  const bytes = new Uint8Array([1, 2, 3]), sending = h.peer.sendArtifact(bytes);
  bytes.fill(9); h.channel.bufferedAmount = 0; h.channel.dispatchEvent(new Event('bufferedamountlow'));
  await sending; assert.deepEqual([...h.state.sent[1].subarray(4)], [1, 2, 3]); assert.equal(clock.pending.size, 0);
  await t.test('overall deadline', async sub => {
    const s = setup(sub), time = timers(sub); s.channel.bufferedAmount = 256001;
    const pending = s.peer.sendArtifact(new Uint8Array(1)), failure = assert.rejects(pending, /cancelled/);
    time.fire(180000); await failure; rejected(s); assert.match(s.state.failures[0].message, /deadline/);
    assert.equal(time.pending.size, 0);
  });
});

const setHeader = (channel, primary = 1, secondary = 1, extra = {}) => channel.receive(JSON.stringify({
  type:'artifact-set', version:2, primary_bytes:primary, secondary_bytes:secondary, ...extra,
}));
const composed = (t, options = {}) => setup(t, {mode:'camera-location-v2', ...options});

test('composed pairing requires its distinct reliable channel and mode', async t => {
  const h = composed(t, {attach:false}); await h.peer.description('offer');
  assert.equal(h.state.localLabel, COMPOSED_LABEL);
  await t.test('image channel rejected', sub => rejected(composed(sub, {channel:{label:LABEL}})));
  await t.test('composed channel rejected by image peer', sub => rejected(setup(sub, {channel:{label:COMPOSED_LABEL}})));
  await t.test('unknown mode rejected before connection creation', sub => {
    const p = setup(sub); const count = p.state.pcs.length;
    assert.throws(() => new CameraPeer({mode:'other'}), /mode/); assert.equal(p.state.pcs.length, count);
  });
});

test('both buffers require explicit synchronous authorization before allocation', async t => {
  for (const permission of [false, Promise.resolve(true), true]) await t.test(String(permission), sub => {
    const allocated = [], Bytes = Uint8Array; let calls = 0;
    const h = composed(sub, {authorizeArtifacts:sizes => {
      calls++; assert.deepEqual(sizes, {primaryBytes:MAX_IMAGE, secondaryBytes:MAX_LOCATION_PROOF});
      assert.deepEqual(allocated, []); return permission;
    }});
    const restore = globals({Uint8Array:new Proxy(Bytes, {construct(target, args, newTarget) {
      allocated.push(args[0]); return Reflect.construct(target, args, newTarget);
    }})});
    sub.after(restore); setHeader(h.channel, MAX_IMAGE, MAX_LOCATION_PROOF); assert.equal(calls, 1);
    if (permission === true) {
      assert.deepEqual(allocated, [MAX_IMAGE, MAX_LOCATION_PROOF]); assert.equal(h.state.artifactSets.length, 0);
      h.peer.close(); assert.equal(h.peer.incoming, null);
    } else { assert.deepEqual(allocated, []); rejected(h); }
  });
  await t.test('authorization closes session', sub => {
    const h = composed(sub, {authorizeArtifacts:() => { h.peer.close(); return true; }});
    setHeader(h.channel); assert.equal(h.peer.closed, true); assert.equal(h.peer.incoming, null);
  });
});

test('composed malformed lengths, fields and substituted image headers never authorize', async t => {
  const invalid = [
    {primary_bytes:0}, {secondary_bytes:0}, {primary_bytes:MAX_IMAGE+1}, {secondary_bytes:MAX_LOCATION_PROOF+1},
    {primary_bytes:Number.MAX_SAFE_INTEGER+1}, {secondary_bytes:-1}, {primary_bytes:1.2}, {secondary_bytes:'1'},
    {version:1}, {version:'2'}, {extra:true}, {secondary_bytes:undefined},
  ];
  for (const patch of invalid) await t.test(JSON.stringify(patch), sub => {
    let calls = 0; const h = composed(sub, {authorizeArtifacts:() => { calls++; return true; }});
    setHeader(h.channel, 1, 1, patch); assert.equal(calls, 0); rejected(h);
  });
  await t.test('image header in composed mode', sub => {
    const h = composed(sub, {authorizeArtifacts:() => { throw new Error('must not authorize'); }});
    header(h.channel, 1); rejected(h); assert.match(h.state.failures[0].message, /oversized/);
  });
  await t.test('set header in image mode', sub => {
    const h = setup(sub, {authorizeArtifact:() => { throw new Error('must not authorize'); }});
    setHeader(h.channel); rejected(h); assert.match(h.state.failures[0].message, /oversized/);
  });
});

test('composed sender frames both originals and only final proof byte invokes arrival synchronously', async t => {
  let called = false;
  const h = composed(t, {onArtifacts:() => { called = true; }}), clock = timers(t);
  const primary = Uint8Array.from({length:16003}, (_, i) => i%251);
  const secondary = Uint8Array.from({length:16002}, (_, i) => i%239);
  await h.peer.sendArtifacts({primary, secondary});
  assert.deepEqual(JSON.parse(h.state.sent[0]), {type:'artifact-set', version:2, primary_bytes:16003, secondary_bytes:16002});
  assert.equal(h.state.sent.length, 5); h.channel.receive(h.state.sent[0]);
  const offsets = [0,16000,16003,32003], lengths = [16000,3,16000,2];
  for (let i=0; i<offsets.length; i++) {
    const packet = h.state.sent[i+1];
    assert.equal(new DataView(packet.buffer).getUint32(0,true), offsets[i]); assert.equal(packet.length, lengths[i]+4);
    h.channel.receive(packet.buffer); assert.equal(called, i===3);
    if (i===1) { assert.equal(h.state.artifactSets.length,0); assert.notEqual(h.peer.incoming,null); assert.equal(clock.pending.size,2); }
  }
  assert.deepEqual(h.state.artifactSets,[{primary,secondary}]); assert.equal(h.state.artifacts.length,0);
  assert.equal(h.peer.incoming,null); assert.equal(clock.pending.size,0);
  h.channel.receive('{"type":"receipt"}'); assert.deepEqual(h.state.messages,[{type:'receipt'}]);
  setHeader(h.channel); rejected(h); assert.equal(h.state.artifactSets.length,1);
});

test('global offsets and artifact boundaries reject crossing, repeats, truncation and proof-first data', async t => {
  for (const [name, sequence] of [
    ['crossing',[fragment(0,4)]], ['proof first',[fragment(3,2)]], ['truncated JPEG',[fragment(0,2)]],
    ['proof resets offset',[fragment(0,3),fragment(0,2)]], ['proof skips',[fragment(0,3),fragment(4,2)]],
    ['truncated proof',[fragment(0,3),fragment(3,1)]], ['extra proof',[fragment(0,3),fragment(3,3)]],
    ['repeated JPEG',[fragment(0,3),fragment(0,3)]],
  ]) await t.test(name, sub => {
    const h = composed(sub); setHeader(h.channel,3,2); for (const packet of sequence) h.channel.receive(packet);
    rejected(h); assert.equal(h.state.artifactSets.length,0);
  });
});

test('interleaved controls and headers after JPEG completion cannot replace required proof', async t => {
  for (const control of [{type:'receipt'}, {type:'artifact',bytes:1},
    {type:'artifact-set',version:2,primary_bytes:1,secondary_bytes:1}]) await t.test(control.type, sub => {
    const h = composed(sub); setHeader(h.channel); h.channel.receive(fragment(0,1));
    h.channel.receive(JSON.stringify(control)); rejected(h);
    assert.equal(h.state.artifactSets.length,0); assert.equal(h.state.messages.length,0);
  });
});

test('missing or partial proof times out and disconnect discards the complete JPEG', async t => {
  for (const cause of ['stall','deadline','disconnect','cancel']) for (const partial of [false,true]) await t.test(cause+' '+partial, sub => {
    const h = composed(sub), clock = timers(sub); setHeader(h.channel,1,16001); h.channel.receive(fragment(0,1));
    if (partial) h.channel.receive(fragment(1,16000));
    if (cause==='stall') clock.fire(5000);
    else if (cause==='deadline') clock.fire(180000);
    else if (cause==='disconnect') { h.peer.pc.connectionState='disconnected'; h.peer.pc.onconnectionstatechange(); }
    else h.peer.close();
    assert.equal(h.peer.closed,true); assert.equal(h.peer.incoming,null); assert.equal(clock.pending.size,0);
    assert.equal(h.state.artifactSets.length,0); assert.equal(h.state.artifacts.length,0);
  });
});

test('sender snapshots both artifacts before backpressure and blocks concurrent controls/transfers', async t => {
  const h = composed(t), clock = timers(t); h.channel.bufferedAmount=256001;
  // Buffer.slice aliases memory; the transport must copy even this Uint8Array subclass.
  const primary=Buffer.from([1,2,3]), secondary=Buffer.from([4,5]);
  const sending=h.peer.sendArtifacts({primary,secondary}); primary.fill(8); secondary.fill(9);
  assert.throws(() => h.peer.send({type:'status'}), /pending/);
  await assert.rejects(h.peer.sendArtifacts({primary,secondary}), /already/);
  h.channel.bufferedAmount=0; h.channel.dispatchEvent(new Event('bufferedamountlow')); await sending;
  assert.deepEqual([...h.state.sent[1].subarray(4)],[1,2,3]); assert.deepEqual([...h.state.sent[2].subarray(4)],[4,5]);
  assert.equal(clock.pending.size,0);
  await assert.rejects(h.peer.sendArtifacts({primary,secondary}), /already/);
});

test('wrong sending API, reserved controls and invalid artifact sets fail before any bytes', async t => {
  const h=composed(t);
  await assert.rejects(h.peer.sendArtifact(new Uint8Array([1])), /mode/);
  for (const value of [null,{}, {primary:new Uint8Array(1)}, {primary:new Uint8Array(1),secondary:new Uint8Array(0)},
    {primary:new Uint8Array(MAX_IMAGE+1),secondary:new Uint8Array(1)},
    {primary:new Uint8Array(1),secondary:new Uint8Array(MAX_LOCATION_PROOF+1)},
    {primary:new Uint8Array(1),secondary:[1]}, {primary:new Uint8Array(1),secondary:new Uint8Array(1),extra:true}]) {
    await assert.rejects(h.peer.sendArtifacts(value));
  }
  for (const type of ['artifact','artifact-set']) assert.throws(() => h.peer.send({type}));
  assert.equal(h.state.sent.length,0);
  await t.test('image sender rejects composed API',async sub => {
    const p=setup(sub); await assert.rejects(p.peer.sendArtifacts({primary:new Uint8Array(1),secondary:new Uint8Array(1)}),/mode/);
    assert.equal(p.state.sent.length,0);
  });
});

test('composed callback failure and stalled sending close and clean up', async t => {
  for (const callback of [() => {throw new Error('consumer failed');}, () => Promise.reject(new Error('consumer failed'))]) await t.test(String(callback),async sub => {
    const h=composed(sub,{onArtifacts:callback}), clock=timers(sub); setHeader(h.channel);
    h.channel.receive(fragment(0,1)); h.channel.receive(fragment(1,1)); await Promise.resolve();
    rejected(h); assert.equal(h.state.artifactSets.length,1); assert.equal(clock.pending.size,0);
  });
  for (const cause of ['stall','deadline','cancel']) await t.test(cause,async sub => {
    const h=composed(sub), clock=timers(sub); h.channel.bufferedAmount=256001;
    const sending=h.peer.sendArtifacts({primary:new Uint8Array(1),secondary:new Uint8Array(1)});
    const failed=assert.rejects(sending);
    if(cause==='cancel') h.peer.close(); else clock.fire(cause==='stall'?5000:180000);
    await failed; assert.equal(h.peer.closed,true); assert.equal(clock.pending.size,0);
  });
});

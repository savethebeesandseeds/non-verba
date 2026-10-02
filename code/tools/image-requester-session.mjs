// SPDX-License-Identifier: AGPL-3.0-only
// One uninterrupted requester process, existing Rust/WASM protocol, no transport service.
import {constants} from 'node:fs';
import {open, mkdir, readFile, realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

export const LIMITS = Object.freeze({image:32 * 1024 * 1024, policy:4096, context:4 * 1024 * 1024,
  command:4096, dispatch:5000, response:180000, sealing:30000, receiptAge:60000, lifetime:300});
export const DEFAULT_POLICY = JSON.stringify({version:1, native_acquisition_required:true,
  raw_gnss_required:false, correlated_camera_clock_required:true, hardware_attestation_required:false,
  independent_position_required:false});
const EMPTY = new Uint8Array();
const codeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const message = error => String(error?.message || error).slice(0, 2048);
const systemClock = () => ({wall:Date.now(), mono:performance.now()});
function insist(value, error) { if (!value) throw new Error(error); }
function container() {
  insist(process.platform === 'linux' && process.env.NONVERBA_CONTAINER === '1', 'Run inside non-verba-dev.');
}
function observation(clock) {
  const time = clock();
  insist(Number.isSafeInteger(time.wall) && time.wall > 0 && Number.isFinite(time.mono) && time.mono >= 0, 'Invalid requester clock.');
  return time;
}
function elapsed(start, end, maximum) {
  const duration = end.mono - start.mono;
  insist(duration >= 0 && duration <= maximum && end.wall >= start.wall
    && Math.abs(end.wall - start.wall - duration) <= 1000, 'Requester deadline or wall/monotonic agreement failed.');
  return Math.round(duration);
}
export async function readBounded(path, maximum, clock) {
  insist(typeof path === 'string' && path.length > 0 && path.length <= 2048 && !path.includes('\0'), 'Invalid input file path.');
  const absolute = resolve(path);
  insist(await realpath(absolute) === absolute, 'Symlink input paths are not accepted.');
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({bigint:true});
    insist(before.isFile() && before.size > 0n && before.size <= BigInt(maximum), 'Input must be a nonempty bounded regular file.');
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let used = 0;
    while (used < bytes.length) {
      const result = await file.read(bytes, used, bytes.length - used, used);
      if (!result.bytesRead) break;
      used += result.bytesRead;
    }
    // This is reception by this process, not a claimed earlier USB/phone arrival.
    const received = clock ? observation(clock) : null;
    const after = await file.stat({bigint:true});
    insist(used === Number(before.size) && before.dev === after.dev && before.ino === after.ino
      && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs,
    'Input changed while its complete bytes were read.');
    insist(await realpath(absolute) === absolute, 'Input path changed during reading.');
    const current = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const present = await current.stat({bigint:true});
      insist(present.dev === before.dev && present.ino === before.ino, 'Input file was replaced during reading.');
    } finally { await current.close(); }
    return {bytes:bytes.subarray(0, used), received};
  } finally { await file.close(); }
}
async function newFile(path, bytes) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
function text(bytes) { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
export async function loadShippedCore() {
  container();
  const modulePath = resolve(codeRoot, '../web/dist/pkg/nonverba_core.js');
  const wasm = await readFile(resolve(codeRoot, '../web/dist/pkg/nonverba_core_bg.wasm'));
  const core = await import(pathToFileURL(modulePath).href);
  await core.default({module_or_path:new Uint8Array(wasm)});
  return {core, wasmSha256:hash(wasm), moduleSha256:hash(await readFile(modulePath))};
}
export function parseOptions(args) {
  const values = {}, allowed = ['--operator-pin','--requester','--task','--output-dir','--policy','--context'];
  while (args.length) {
    const name = args.shift();
    insist(allowed.includes(name) && !Object.hasOwn(values, name) && args.length, 'Unknown, repeated or incomplete option.');
    values[name] = args.shift();
  }
  for (const name of allowed.slice(0, 4)) insist(values[name], 'Missing ' + name);
  return {operatorPin:values['--operator-pin'], requester:values['--requester'], task:values['--task'],
    outputDir:values['--output-dir'], policyPath:values['--policy'], contextPath:values['--context']};
}
/** Test seams supply only the process clock/output; production uses real clocks and stdout.
 * Keys remain private fields in memory and are never persisted or emitted. */
export class ImageRequesterSession {
  #core; #clock; #emit; #identity; #phase = 'initializing'; #dir; #config; #files = new Map();
  #ownsDirectory = false; #pin; #original; #payload; #sent; #timer; #finish; #failure; #policyJson; #contextJson;
  constructor({core, clock = systemClock, emit, ...config}) {
    this.#core = core; this.#clock = clock; this.#emit = emit; this.#config = {...config};
    this.done = new Promise(resolve => { this.#finish = resolve; });
  }
  get phase() { return this.#phase; }
  #active(phase) { insist(this.#phase === phase, 'The requester session is unavailable or changed state.'); }
  async #retain(name, value) {
    const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
    await newFile(resolve(this.#dir, name), bytes);
    this.#files.set(name, {bytes:bytes.length, sha256:hash(bytes)});
  }
  async #unchanged() {
    for (const [name, expected] of this.#files) {
      const {bytes} = await readBounded(resolve(this.#dir, name), Math.max(expected.bytes, 1));
      insist(bytes.length === expected.bytes && hash(bytes) === expected.sha256, 'Retained authority or evidence changed: ' + name);
    }
  }
  async initialize() {
    container(); this.#active('initializing');
    const c = this.#config;
    insist(typeof this.#emit === 'function' && /^[a-f0-9]{64}$/.test(c.operatorPin), 'A trusted lowercase camera certificate pin is required.');
    insist(typeof c.requester === 'string' && c.requester.trim() && Buffer.byteLength(c.requester) <= 200
      && typeof c.task === 'string' && c.task.trim() && Buffer.byteLength(c.task) <= 2000, 'Invalid requester or task label.');
    this.#policyJson = c.policyJson ?? (c.policyPath ? text((await readBounded(c.policyPath, LIMITS.policy)).bytes) : DEFAULT_POLICY);
    this.#contextJson = c.contextJson ?? (c.contextPath ? text((await readBounded(c.contextPath, LIMITS.context)).bytes) : '{"version":1}');
    insist(typeof this.#policyJson === 'string' && Buffer.byteLength(this.#policyJson) <= LIMITS.policy
      && typeof this.#contextJson === 'string' && Buffer.byteLength(this.#contextJson) <= LIMITS.context, 'Oversized policy or context.');
    // Invoke the actual central Rust policy/context parsers before generating a fresh
    // challenge. This known-zero, non-dispatched schema probe can never be evidence.
    const at = Math.floor(observation(this.#clock).wall / 1000);
    const probe = JSON.stringify({version:1, id:'0'.repeat(64), requester:c.requester, task:c.task,
      nonce:Buffer.alloc(32).toString('base64url'), issued_at:at, expires_at:at + LIMITS.lifetime});
    const preflight = JSON.parse(await this.#core.appraise_image_with_context(EMPTY, probe, c.operatorPin,
      this.#policyJson, this.#contextJson, at));
    this.#active('initializing');
    insist(preflight.evidence_verified === false, 'Unexpected preflight result.');
    this.#identity = this.#core.create_identity();
    const publicIdentity = JSON.parse(this.#core.live_requester_identity(this.#identity));
    this.#pin = publicIdentity.pin.sha256;
    this.#dir = resolve(c.outputDir);
    insist(await realpath(dirname(this.#dir)) === dirname(this.#dir), 'Output parent must not contain symlinks.');
    this.#active('initializing');
    await mkdir(this.#dir, {mode:0o700}); // Existing directories fail; there is no resume.
    this.#ownsDirectory = true; this.#active('initializing');
    await this.#retain('policy.json', this.#policyJson);
    await this.#retain('context.json', this.#contextJson);
    await this.#retain('requester-public.json', json(publicIdentity));
    await this.#retain('configuration.json', json({version:1, type:'nonverba-image-requester-configuration',
      requester:c.requester, task:c.task, operator_pin:c.operatorPin, requester_pin:this.#pin,
      delivery:{max_response_ms:LIMITS.response, max_receipt_age_ms:LIMITS.receiptAge}, lifetime_seconds:LIMITS.lifetime,
      wasm_sha256:c.wasmSha256, module_sha256:c.moduleSha256, acceptance_recorded:false,
      resumable:false, private_identity_persisted:false}));
    this.#active('initializing'); this.#phase = 'ready';
    await this.#emit({type:'ready', version:1, directory:this.#dir, requester_pin:this.#pin,
      operator_pin:c.operatorPin, challenge_created:false, acceptance_recorded:false});
    this.#active('ready');
  }
  async command(value) {
    try {
      insist(value && typeof value === 'object' && !Array.isArray(value), 'Command must be an object.');
      const keys = value.command === 'receive' ? ['command','path'] : ['command'];
      insist(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'Unexpected command fields.');
      if (value.command === 'cancel') { await this.fail(new Error('Explicit requester cancellation.'), 'cancelled'); return; }
      if (value.command === 'dispatch') {
        this.#active('ready'); this.#phase = 'preparing'; await this.#dispatch(); return;
      }
      if (value.command === 'receive') {
        this.#active('awaiting'); this.#phase = 'receiving'; await this.#receive(value.path); return;
      }
      throw new Error('Unknown requester command.');
    } catch (error) { await this.fail(error); throw error; }
  }
  async #dispatch() {
    await this.#unchanged(); this.#active('preparing');
    const at = Math.floor(observation(this.#clock).wall / 1000), c = this.#config;
    const challenge = this.#core.create_challenge(c.requester, c.task, at, LIMITS.lifetime);
    const spec = {version:1, evidence:{type:'image', request:JSON.parse(challenge)},
      operator_pins:{media_certificate_sha256:c.operatorPin, location_spki_sha256:null},
      policy:JSON.parse(this.#policyJson), delivery:{max_response_ms:LIMITS.response, max_receipt_age_ms:LIMITS.receiptAge}};
    this.#original = this.#core.create_evidence_session_request(JSON.stringify(spec), this.#identity, at);
    this.#payload = JSON.parse(this.#core.validate_evidence_session_request(this.#original, this.#pin,
      JSON.stringify(spec.operator_pins), Math.floor(observation(this.#clock).wall / 1000)));
    await this.#retain('challenge.json', challenge);
    await this.#retain('request.json', this.#original);
    await this.#retain('request-payload.json', json(this.#payload));
    await this.#unchanged(); this.#active('preparing');
    this.#sent = observation(this.#clock);
    insist(this.#sent.wall >= this.#payload.created_at_ms && this.#sent.wall - this.#payload.created_at_ms <= LIMITS.dispatch,
      'Request preparation missed its dispatch deadline.');
    this.#phase = 'dispatching';
    this.#timer = setTimeout(() => { void this.fail(new Error('Request dispatch did not complete within five seconds.')).catch(() => {}); },
      Math.max(1, LIMITS.dispatch - (this.#sent.wall - this.#payload.created_at_ms)));
    // Explicit stdout transport handoff. Neither ready nor wrapper creation starts this interval.
    await this.#emit({type:'dispatch', version:1, session_id:this.#payload.session_id,
      sensor_nonce:this.#payload.sensor_nonce, challenge_json:challenge, request_envelope_json:this.#original,
      requester_pin:this.#pin, sent_at_ms:this.#sent.wall, handoff:'stdout-to-caller-transport', handset_delivery_observed:false});
    this.#active('dispatching');
    const completed = observation(this.#clock);
    elapsed(this.#sent, completed, LIMITS.dispatch);
    insist(completed.wall - this.#payload.created_at_ms <= LIMITS.dispatch, 'Completed stdout handoff missed the dispatch deadline.');
    clearTimeout(this.#timer);
    await this.#retain('dispatch.json', json({sent_at_ms:this.#sent.wall, stdout_completed_at_ms:completed.wall,
      stdout_elapsed_ms:Math.round(completed.mono - this.#sent.mono), handoff:'stdout-to-caller-transport',
      handset_delivery_observed:false}));
    this.#active('dispatching');
    this.#phase = 'awaiting';
    const remaining = LIMITS.response - elapsed(this.#sent, observation(this.#clock), LIMITS.response);
    this.#timer = setTimeout(() => { void this.fail(new Error('Final image missed the response deadline.')).catch(() => {}); }, Math.max(1, remaining));
    await this.#emit({type:'dispatched', version:1, session_id:this.#payload.session_id,
      response_deadline_ms:this.#sent.wall + LIMITS.response, handset_delivery_observed:false});
  }
  async #receive(path) {
    const {bytes, received} = await readBounded(path, LIMITS.image, this.#clock);
    this.#active('receiving');
    const duration = elapsed(this.#sent, received, LIMITS.response);
    insist(received.wall < this.#payload.expires_at_ms, 'Returned image arrived after challenge expiry.');
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { void this.fail(new Error('Receipt sealing exceeded thirty seconds after file reception.')).catch(() => {}); }, LIMITS.sealing);
    const timing = {sent_at_ms:this.#sent.wall, received_at_ms:received.wall, elapsed_ms:duration};
    await this.#retain('image.jpg', bytes);
    await this.#retain('arrival.json', json({timing, image_sha256:hash(bytes), bytes:bytes.length,
      source_path:resolve(path), observation:'complete bounded file read in the uninterrupted requester process',
      earlier_phone_or_usb_arrival_claimed:false}));
    await this.#unchanged(); this.#active('receiving');
    elapsed(received, observation(this.#clock), LIMITS.sealing);
    const receipt = await this.#core.seal_evidence_session_receipt(this.#original, new Uint8Array(bytes), EMPTY, '',
      JSON.stringify(timing), this.#identity, this.#pin, this.#contextJson, Math.floor(observation(this.#clock).wall / 1000));
    this.#active('receiving'); elapsed(received, observation(this.#clock), LIMITS.sealing);
    await this.#retain('receipt.json', receipt);
    const report = JSON.parse(await this.#core.verify_evidence_session_receipt(receipt, this.#original,
      new Uint8Array(bytes), EMPTY, '', this.#pin, this.#contextJson, Math.floor(observation(this.#clock).wall / 1000)));
    this.#active('receiving');
    await this.#retain('verification.json', json(report));
    insist(report.verified === true && report.fresh_action_eligible === true && report.demo === false,
      'Receipt did not reverify as eligible fresh evidence; inspect the retained verification report.');
    await this.#unchanged(); this.#active('receiving');
    const completed = observation(this.#clock);
    elapsed(received, completed, LIMITS.sealing);
    insist(completed.wall < this.#payload.expires_at_ms && completed.wall - received.wall <= LIMITS.receiptAge,
      'Evidence ceased to be fresh before completion.');
    const result = {type:'nonverba-image-requester-result', version:1, status:'verified', session_id:this.#payload.session_id,
      requester_pin:this.#pin, operator_pin:this.#config.operatorPin, timing, report:'verification.json',
      files:Object.fromEntries(this.#files), acceptance_recorded:false, local_replay_checked:false,
      global_replay_checked:false, requester_clock_trusted:false, independent_requester_proven:false,
      physical_measurement_authenticity_proven:false, private_identity_persisted:false, resumable:false};
    await this.#retain('result.json', json(result)); this.#active('receiving');
    clearTimeout(this.#timer); this.#identity = undefined; this.#phase = 'completing';
    await this.#emit({type:'complete', version:1, status:'verified', directory:this.#dir,
      session_id:this.#payload.session_id, acceptance_recorded:false, report:'verification.json'});
    this.#active('completing'); this.#phase = 'complete'; this.#finish(0);
  }
  async fail(error, status = 'failed') {
    if (this.#failure) return this.#failure;
    if (this.#phase === 'complete') return;
    this.#phase = status; this.#identity = undefined; clearTimeout(this.#timer);
    this.#failure = (async () => {
      let observed = null;
      try { observed = observation(this.#clock).wall; } catch { /* A failed clock cannot supply a timestamp. */ }
      const record = {version:1, type:'nonverba-image-requester-failure', status, error:message(error),
        observed_at_ms:observed, acceptance_recorded:false, resumable:false};
      try { if (this.#ownsDirectory) await newFile(resolve(this.#dir, 'failure.json'), json(record)); }
      finally { this.#finish(1); }
    })();
    return this.#failure;
  }
}
export function writeJsonLine(stream, value, timeout = LIMITS.dispatch) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = error => { if (settled) return; settled = true; clearTimeout(timer);
      if (error) setImmediate(() => stream.removeListener('error', fail)); else stream.removeListener('error', fail);
      error ? reject(error) : resolve(); };
    const fail = error => done(error);
    const timer = setTimeout(() => done(new Error('Stdout transport did not complete its bounded write.')), timeout);
    stream.once('error', fail);
    try { stream.write(JSON.stringify(value) + '\n', error => done(error)); } catch (error) { done(error); }
  });
}
export function attachCommands(stream, session) {
  let pending = Buffer.alloc(0), closed = false;
  const fail = error => { if (closed) return; closed = true; stream.pause(); void session.fail(error).catch(() => {}); };
  const data = chunk => {
    if (closed) return;
    // Bound before concatenation; many complete lines cannot queue unbounded work.
    if (pending.length + chunk.length > LIMITS.command) return fail(new Error('Requester command input exceeds 4096 bytes.'));
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    let end;
    while (!closed && (end = pending.indexOf(10)) >= 0) {
      const line = pending.subarray(0, end); pending = pending.subarray(end + 1);
      try {
        const command = JSON.parse(text(line));
        void session.command(command).catch(error => fail(error));
      } catch (error) { fail(error); }
    }
  };
  const end = () => fail(new Error('Requester stdin ended before completion; sessions never resume.'));
  stream.on('data', data); stream.once('end', end); stream.once('error', fail);
  return () => { closed = true; stream.pause(); stream.removeListener('data', data); stream.removeListener('end', end); stream.removeListener('error', fail); };
}
export async function main(args = process.argv.slice(2)) {
  container();
  const options = parseOptions([...args]), shipped = await loadShippedCore();
  const session = new ImageRequesterSession({...options, ...shipped, emit:event => writeJsonLine(process.stdout, event)});
  let detach;
  const stop = () => { void session.fail(new Error('Requester process interrupted.')).catch(() => {}); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await session.initialize(); detach = attachCommands(process.stdin, session);
    return await session.done;
  } catch (error) {
    await session.fail(error); console.error(message(error)); return 1;
  } finally {
    detach?.(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

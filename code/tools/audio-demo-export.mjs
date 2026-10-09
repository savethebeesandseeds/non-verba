// SPDX-License-Identifier: AGPL-3.0-only
// Prepare bounded local-demo exports for the existing Rust exact-file verifier.
// This importer neither verifies C2PA nor authenticates requester history.
import {constants} from 'node:fs';
import {open, mkdir, realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const AUDIO_DEMO_LIMITS = Object.freeze({wav:8 * 1024 * 1024, receipt:64 * 1024});
const HEX = /^[0-9a-f]{64}$/;
const RETRIEVAL_PREFIX = '(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-)?';
const utf8 = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function insist(condition, message) { if (!condition) throw new Error(message); }
function pathArgument(value) {
  insist(typeof value === 'string' && value.length > 0 && value.length <= 2048 && !value.includes('\0'), 'Invalid file path.');
  return resolve(value);
}
function fields(value, names) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
const count = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const label = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
const fingerprint = value => typeof value === 'string' && value.length === 64 && HEX.test(value);

/** JSON.parse alone silently overwrites repeated keys, including escaped aliases.
 * Scan its grammar first with depth/token bounds and compare decoded object keys. */
export function parseDemoJson(bytes) {
  insist(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= AUDIO_DEMO_LIMITS.receipt, 'Invalid receipt byte length.');
  const source = utf8.decode(bytes);
  let at = 0, tokens = 0;
  const space = () => { while (/[\x20\x09\x0a\x0d]/.test(source[at] || 'x')) at++; };
  function string() {
    insist(source[at] === '"', 'Invalid JSON string.');
    const start = at++;
    while (at < source.length) {
      const character = source[at++];
      if (character === '\\') { at++; continue; }
      if (character === '"') return JSON.parse(source.slice(start, at));
    }
    throw new Error('Unterminated JSON string.');
  }
  function value(depth) {
    insist(depth <= 8 && ++tokens <= 2048, 'Receipt JSON nesting or token limit exceeded.');
    space();
    if (source[at] === '{') {
      at++; space(); const keys = new Set();
      if (source[at] === '}') { at++; return; }
      for (;;) {
        space(); const key = string();
        insist(!keys.has(key), 'Duplicate receipt JSON key: ' + key); keys.add(key);
        space(); insist(source[at++] === ':', 'Invalid JSON object.'); value(depth + 1); space();
        const separator = source[at++]; if (separator === '}') return;
        insist(separator === ',', 'Invalid JSON object separator.');
      }
    }
    if (source[at] === '[') {
      at++; space(); if (source[at] === ']') { at++; return; }
      for (;;) {
        value(depth + 1); space(); const separator = source[at++]; if (separator === ']') return;
        insist(separator === ',', 'Invalid JSON array separator.');
      }
    }
    if (source[at] === '"') { string(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(at));
    insist(token, 'Invalid receipt JSON value.');
    if (!['true', 'false', 'null'].includes(token[0])) {
      insist(/^(?:0|[1-9][0-9]*)$/.test(token[0]) && Number.isSafeInteger(Number(token[0])),
        'Receipt numbers must be unsigned safe integer tokens.');
    }
    at += token[0].length;
  }
  value(0); space(); insist(at === source.length, 'Trailing receipt JSON content.');
  return JSON.parse(source);
}

export function validateDemoReceipt(receipt, wavName, receiptName) {
  // Each saved file has its own cache export UUID. The USB helper retains that
  // prefix locally; only the request's session prefix must match across files.
  const wavMatch = new RegExp('^' + RETRIEVAL_PREFIX + 'nonverba-demo-audio-([0-9a-f]{12})\\.wav$').exec(wavName);
  const receiptMatch = new RegExp('^' + RETRIEVAL_PREFIX + 'nonverba-demo-receipt-([0-9a-f]{12})\\.json$').exec(receiptName);
  insist(wavMatch && receiptMatch && wavMatch[0] === wavName && receiptMatch[0] === receiptName
    && wavMatch[1] === receiptMatch[1], 'Expected matching local-demo WAV and receipt filenames.');
  insist(fields(receipt, ['version', 'type', 'request', 'transcript'])
    && receipt.version === 1 && receipt.type === 'nonverba-audio-demo-receipt', 'Expected a version 1 unsigned local-demo receipt.');
  const request = receipt.request, transcript = receipt.transcript;
  insist(fields(request, ['version', 'demo', 'session_id', 'requester', 'task', 'issued_at', 'expires_at', 'duration_secs',
    'sample_rate', 'channels', 'chunk_samples', 'round_deadline_ms', 'signal_algorithm'])
    && request.version === 1 && request.demo === true && fingerprint(request.session_id)
    && request.session_id.slice(0, 12) === wavMatch[1] && label(request.requester, 200) && label(request.task, 2000)
    && count(request.issued_at) && count(request.expires_at) && request.expires_at > request.issued_at
    && request.expires_at - request.issued_at <= 86400
    && count(request.duration_secs, 30) && request.duration_secs >= 4 && request.duration_secs % 2 === 0
    && request.expires_at - request.issued_at > request.duration_secs
    && request.sample_rate === 48000 && request.channels === 1 && request.chunk_samples === 96000
    && request.round_deadline_ms === 3000 && request.signal_algorithm === 'org.nonverba.audio-fsk.v1', 'Invalid local-demo request schema or filename binding.');
  insist(fields(transcript, ['version', 'session_id', 'started_at', 'completed_at', 'total_samples', 'rounds'])
    && transcript.version === 1 && transcript.session_id === request.session_id
    && count(transcript.started_at) && count(transcript.completed_at)
    && transcript.total_samples === request.duration_secs * 48000
    && Array.isArray(transcript.rounds) && transcript.rounds.length === request.duration_secs / 2, 'Invalid local-demo transcript schema.');
  const nonces = new Set();
  for (const [index, round] of transcript.rounds.entries()) {
    insist(fields(round, ['index', 'nonce', 'issued_elapsed_ms', 'received_elapsed_ms', 'pcm_sha256', 'start_sample', 'sample_count'])
      && round.index === index && fingerprint(round.nonce) && !nonces.has(round.nonce) && fingerprint(round.pcm_sha256)
      && count(round.issued_elapsed_ms, 0xffffffff) && count(round.received_elapsed_ms, 0xffffffff)
      && round.start_sample === index * 96000 && round.sample_count === 96000, 'Invalid local-demo round schema.');
    nonces.add(round.nonce);
  }
  // Timing policy, sample commitments, signal detection and signatures belong to
  // Rust verification. Structural import is deliberately not a success verdict.
  return receipt;
}

async function readBounded(path, maximum) {
  const absolute = pathArgument(path);
  insist(await realpath(absolute) === absolute, 'Symlink input paths are not accepted.');
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({bigint:true});
    insist(before.isFile() && before.size > 0n && before.size <= BigInt(maximum), 'Input must be a nonempty bounded regular file.');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let used = 0;
    while (used < buffer.length) {
      const result = await file.read(buffer, used, buffer.length - used, used);
      if (!result.bytesRead) break; used += result.bytesRead;
    }
    const after = await file.stat({bigint:true});
    insist(used === Number(before.size) && before.dev === after.dev && before.ino === after.ino && before.size === after.size
      && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs, 'Input changed while reading.');
    insist(await realpath(absolute) === absolute, 'Input path changed during reading.');
    const current = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const present = await current.stat({bigint:true});
      insist(present.dev === before.dev && present.ino === before.ino, 'Input file was replaced during reading.');
    } finally { await current.close(); }
    return {path:absolute, bytes:buffer.subarray(0, used)};
  } finally { await file.close(); }
}
async function writeExclusive(path, bytes) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  return {path, bytes:bytes.length, sha256:hash(bytes)};
}

export async function prepareDemoInputs({wavPath, receiptPath, operatorPin, outputDir}) {
  insist(process.platform === 'linux' && process.env.NONVERBA_CONTAINER === '1', 'Run inside the managed non-verba-dev container.');
  insist(fingerprint(operatorPin), 'An explicit externally retained lowercase operator fingerprint is required.');
  const wav = await readBounded(wavPath, AUDIO_DEMO_LIMITS.wav);
  const original = await readBounded(receiptPath, AUDIO_DEMO_LIMITS.receipt);
  insist(wav.bytes.length >= 44 && wav.bytes.subarray(0, 4).equals(Buffer.from('RIFF'))
    && wav.bytes.subarray(8, 12).equals(Buffer.from('WAVE')) && wav.bytes.readUInt32LE(4) === wav.bytes.length - 8,
  'Expected a complete bounded RIFF/WAVE file.');
  const receipt = validateDemoReceipt(parseDemoJson(original.bytes), basename(wav.path), basename(original.path));
  const directory = pathArgument(outputDir), parent = dirname(directory);
  insist(await realpath(parent) === parent, 'Symlink output parent paths are not accepted.');
  await mkdir(directory, {mode:0o700}); // Refuse existing directories; preserve partial earlier runs.
  insist(await realpath(directory) === directory, 'Output path changed during creation.');
  const outputs = {};
  for (const [name, bytes] of [['original-receipt.json', original.bytes], ['request.json', json(receipt.request)], ['transcript.json', json(receipt.transcript)]]) {
    outputs[name] = await writeExclusive(resolve(directory, name), bytes);
  }
  const report = {
    version:1, type:'nonverba-audio-demo-export-inputs', prepared_at_utc:new Date().toISOString(),
    scope:'Local-demo input preparation only; run the existing Rust verifier separately.',
    session_id:receipt.request.session_id, session_prefix:receipt.request.session_id.slice(0, 12),
    receipt_provenance:'Unsigned operator-supplied receipt labelled as a same-device local-demo receipt; not independently retained requester history.',
    independently_retained_requester_history:false, c2pa_verification_performed:false, acceptance_recorded:false,
    operator_pin:operatorPin, operator_pin_source:'Explicit external argument; this importer does not establish its trust provenance.',
    inputs:{wav:{path:wav.path, original_name:`nonverba-demo-audio-${receipt.request.session_id.slice(0, 12)}.wav`, bytes:wav.bytes.length, sha256:hash(wav.bytes)},
      receipt:{path:original.path, original_name:`nonverba-demo-receipt-${receipt.request.session_id.slice(0, 12)}.json`, bytes:original.bytes.length, sha256:hash(original.bytes)}}, outputs,
  };
  await writeExclusive(resolve(directory, 'input-provenance.json'), json(report));
  return report;
}

export function parseOptions(args) {
  const options = {}, names = ['--wav', '--receipt', '--operator-pin', '--output-dir'];
  while (args.length) {
    const name = args.shift();
    insist(names.includes(name) && !Object.hasOwn(options, name) && args.length > 0, 'Unknown, repeated or incomplete option.');
    options[name] = args.shift();
  }
  insist(names.every(name => typeof options[name] === 'string' && options[name].length > 0),
    'Usage: audio-demo-export.mjs --wav AUDIO.wav --receipt RECEIPT.json --operator-pin EXTERNAL_FINGERPRINT --output-dir NEW_DIRECTORY');
  return {wavPath:options['--wav'], receiptPath:options['--receipt'], operatorPin:options['--operator-pin'], outputDir:options['--output-dir']};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareDemoInputs(parseOptions(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(String(error?.message || error)); process.exitCode = 1; }
}

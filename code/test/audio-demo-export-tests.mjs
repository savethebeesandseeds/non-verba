// SPDX-License-Identifier: AGPL-3.0-only
// Silent synthetic importer tests. They exercise no microphone, speaker or key.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, open, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AUDIO_DEMO_LIMITS, parseDemoJson, parseOptions, prepareDemoInputs, validateDemoReceipt} from '../tools/audio-demo-export.mjs';

assert.equal(process.platform, 'linux', 'Run importer tests inside the managed Debian container.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Use the documented development launcher.');
const PIN = 'd'.repeat(64), SESSION = 'a'.repeat(64);
const WAV_NAME = `nonverba-demo-audio-${SESSION.slice(0, 12)}.wav`;
const RECEIPT_NAME = `nonverba-demo-receipt-${SESSION.slice(0, 12)}.json`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  return {version:1, type:'nonverba-audio-demo-receipt', request:{version:1, demo:true, session_id:SESSION,
    requester:'Local demo — same device', task:'DEMO ONLY: synthetic importer fixture', issued_at:1800000000,
    expires_at:1800000900, duration_secs:4, sample_rate:48000, channels:1, chunk_samples:96000,
    round_deadline_ms:3000, signal_algorithm:'org.nonverba.audio-fsk.v1'},
  transcript:{version:1, session_id:SESSION, started_at:1800000001, completed_at:1800000005, total_samples:192000,
    rounds:[0, 1].map(index => ({index, nonce:(index ? 'c' : 'b').repeat(64), issued_elapsed_ms:index * 2000,
      received_elapsed_ms:(index + 1) * 2000, pcm_sha256:'e'.repeat(64), start_sample:index * 96000, sample_count:96000}))}};
}
function framingOnlyWav() {
  // A bounded framing fixture, deliberately not signed or claimed as evidence.
  const bytes = Buffer.alloc(44); bytes.write('RIFF', 0); bytes.writeUInt32LE(36, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); return bytes;
}
async function files(t, names = [WAV_NAME, RECEIPT_NAME]) {
  const directory = await mkdtemp(join(tmpdir(), 'nonverba-audio-demo-import-test-'));
  // Only this test's fresh temporary directory is removed, never prior evidence.
  t.after(() => rm(directory, {recursive:true, force:true}));
  const wavPath = join(directory, names[0]), receiptPath = join(directory, names[1]);
  const receiptBytes = Buffer.from(JSON.stringify(fixture(), null, 3) + '\n\n');
  await writeFile(wavPath, framingOnlyWav()); await writeFile(receiptPath, receiptBytes);
  return {directory, wavPath, receiptPath, operatorPin:PIN, outputDir:join(directory, 'inputs'), receiptBytes};
}

test('strict receipt parsing preserves object values without acquiring trust', () => {
  const original = fixture(), parsed = parseDemoJson(Buffer.from(JSON.stringify(original)));
  assert.deepEqual(validateDemoReceipt(parsed, WAV_NAME, RECEIPT_NAME), original);
});
test('separate retrieval UUIDs are allowed while session prefixes must agree', () => {
  const wav = '12345678-1234-4234-8234-1234567890ab-' + WAV_NAME;
  const receipt = '87654321-4321-4321-8321-ba0987654321-' + RECEIPT_NAME;
  assert.equal(validateDemoReceipt(fixture(), wav, receipt).request.session_id, SESSION);
  assert.throws(() => validateDemoReceipt(fixture(), wav, receipt.replace('aaaaaaaaaaaa', 'bbbbbbbbbbbb')), /filenames/);
});
for (const [name, source] of [
  ['duplicate root key', '{"version":1,"version":1}'],
  ['escaped duplicate root key', '{"version":1,"versi\\u006fn":1}'],
  ['duplicate nested key', '{"request":{"demo":true,"demo":false}}'],
  ['trailing JSON', '{}{}'], ['trailing object comma', '{"demo":true,}'],
  ['nonfinite numeric token', '{"version":1e999}'], ['fractional numeric token', '{"version":1.5}'],
  ['integer-normalizing exponent', '{"version":1e0}'], ['integer-normalizing fraction', '{"version":1.0}'],
  ['negative zero', '{"version":-0}'], ['unsafe integer', '{"version":9007199254740992}'],
  ['excessive nesting', '['.repeat(10) + '0' + ']'.repeat(10)],
  ['excessive tokens', '[' + Array(2048).fill('0').join(',') + ']'],
]) {
  test('JSON refuses ' + name, () => assert.throws(() => parseDemoJson(Buffer.from(source))));
}
test('JSON refuses invalid UTF-8, BOM, empty and oversized input', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')]),
    Buffer.alloc(0), Buffer.alloc(AUDIO_DEMO_LIMITS.receipt + 1, 32)]) assert.throws(() => parseDemoJson(bytes));
});
for (const [name, change] of [
  ['live receipt substitution', value => value.type = 'nonverba-audio-receipt'],
  ['failure artifact substitution', value => value.type = 'nonverba-native-audio-round-assessment'],
  ['missing demo marker', value => delete value.request.demo], ['false demo marker', value => value.request.demo = false],
  ['unknown root claim', value => value.verified = true], ['unknown request claim', value => value.request.signer = PIN],
  ['unknown transcript claim', value => value.transcript.signature = 'claim'], ['unknown round claim', value => value.transcript.rounds[0].passed = true],
  ['wrong complete session', value => value.transcript.session_id = 'a'.repeat(63) + 'b'],
  ['wrong filename session', value => value.request.session_id = 'b'.repeat(64)],
  ['newline in session hash', value => value.request.session_id += '\n'],
  ['nonfinite timestamp', value => value.request.issued_at = Infinity], ['unsafe timestamp', value => value.transcript.started_at = 2 ** 53],
  ['excessive UTF-8 requester', value => value.request.requester = 'é'.repeat(101)],
  ['unsupported carrier profile', value => value.request.signal_algorithm = 'other-profile'],
  ['wrong rate', value => value.request.sample_rate = 44100], ['excessive duration', value => value.request.duration_secs = 32],
  ['partial sample count', value => value.transcript.total_samples--], ['missing round', value => value.transcript.rounds.pop()],
  ['reordered round', value => value.transcript.rounds.reverse()], ['duplicate nonce', value => value.transcript.rounds[1].nonce = value.transcript.rounds[0].nonce],
  ['out-of-range elapsed', value => value.transcript.rounds[0].received_elapsed_ms = 0x100000000],
]) {
  test('schema refuses ' + name, () => {
    const receipt = fixture(); change(receipt);
    assert.throws(() => validateDemoReceipt(receipt, WAV_NAME, RECEIPT_NAME));
  });
}
test('structural import leaves timing policy and acoustic verdict to Rust', () => {
  const receipt = fixture(); receipt.transcript.rounds[0].received_elapsed_ms = 10;
  assert.equal(validateDemoReceipt(receipt, WAV_NAME, RECEIPT_NAME), receipt);
});
test('filename parsing refuses traversal, case changes, extra prefixes and extensions', () => {
  for (const name of ['../' + WAV_NAME, WAV_NAME.toUpperCase(), 'other-' + WAV_NAME, WAV_NAME + '.json', WAV_NAME + '\n']) {
    assert.throws(() => validateDemoReceipt(fixture(), name, RECEIPT_NAME));
  }
});
test('exclusive inputs preserve exact unsigned receipt and hashes without duplicating WAV', async t => {
  const input = await files(t, ['12345678-1234-4234-8234-1234567890ab-' + WAV_NAME,
    '87654321-4321-4321-8321-ba0987654321-' + RECEIPT_NAME]);
  const report = await prepareDemoInputs(input);
  assert.deepEqual(await readFile(join(input.outputDir, 'original-receipt.json')), input.receiptBytes);
  assert.equal(report.inputs.receipt.sha256, sha256(input.receiptBytes));
  assert.equal(report.outputs['original-receipt.json'].sha256, report.inputs.receipt.sha256);
  assert.equal(report.inputs.wav.sha256, sha256(framingOnlyWav()));
  assert.equal(report.inputs.wav.original_name, WAV_NAME); assert.equal(report.inputs.receipt.original_name, RECEIPT_NAME);
  assert.equal(report.operator_pin, PIN); assert.equal(report.independently_retained_requester_history, false);
  assert.equal(report.c2pa_verification_performed, false); assert.equal(report.acceptance_recorded, false);
  assert.match(report.receipt_provenance, /Unsigned.*local-demo/);
  assert.deepEqual(JSON.parse(await readFile(join(input.outputDir, 'request.json'))), fixture().request);
  assert.deepEqual(JSON.parse(await readFile(join(input.outputDir, 'transcript.json'))), fixture().transcript);
  assert.deepEqual((await readdir(input.outputDir)).sort(), ['input-provenance.json', 'original-receipt.json', 'request.json', 'transcript.json']);
});
test('missing external pin refuses before output; no fingerprint is inferred', async t => {
  const input = await files(t); delete input.operatorPin;
  await assert.rejects(prepareDemoInputs(input), /explicit externally retained/);
  assert.deepEqual((await readdir(input.directory)).sort(), [WAV_NAME, RECEIPT_NAME].sort());
});
test('external pin must be exactly lowercase 64 hex characters', async t => {
  const input = await files(t);
  for (const operatorPin of [PIN + '\n', PIN.toUpperCase(), 'not-a-pin']) {
    await assert.rejects(prepareDemoInputs({...input, operatorPin}), /explicit externally retained/);
  }
});
test('existing or partial output is preserved and never overwritten', async t => {
  const input = await files(t); await mkdir(input.outputDir);
  const marker = join(input.outputDir, 'request.json'); await writeFile(marker, 'prior evidence');
  await assert.rejects(prepareDemoInputs(input), /EEXIST/);
  assert.equal(await readFile(marker, 'utf8'), 'prior evidence');
});
test('symlink input and output parent paths refuse', async t => {
  const input = await files(t), alias = join(input.directory, 'alias'); await mkdir(alias);
  const link = join(alias, WAV_NAME); await symlink(input.wavPath, link);
  await assert.rejects(prepareDemoInputs({...input, wavPath:link}), /Symlink/);
  const parentLink = join(input.directory, 'parent-alias'); await symlink(alias, parentLink);
  await assert.rejects(prepareDemoInputs({...input, outputDir:join(parentLink, 'new-inputs')}), /Symlink output parent/);
});
test('directory input refuses as a non-regular file', async t => {
  const input = await files(t), directory = join(input.directory, 'directory-input'); await mkdir(directory);
  await assert.rejects(prepareDemoInputs({...input, wavPath:directory}), /regular file/);
});
test('oversized WAV and receipt refuse using file metadata bounds', async t => {
  const input = await files(t), largeWav = await open(input.wavPath, 'r+');
  try { await largeWav.truncate(AUDIO_DEMO_LIMITS.wav + 1); } finally { await largeWav.close(); }
  await assert.rejects(prepareDemoInputs(input), /bounded regular/);
  await writeFile(input.wavPath, framingOnlyWav()); await writeFile(input.receiptPath, Buffer.alloc(AUDIO_DEMO_LIMITS.receipt + 1, 32));
  await assert.rejects(prepareDemoInputs(input), /bounded regular/);
});
test('partial RIFF, wrong bytes and declared length mismatch refuse', async t => {
  const input = await files(t);
  for (const change of [bytes => bytes.subarray(0, 43), bytes => { bytes[0] |= 0x80; return bytes; },
    bytes => { bytes.writeUInt32LE(35, 4); return bytes; }]) {
    await writeFile(input.wavPath, change(framingOnlyWav()));
    await assert.rejects(prepareDemoInputs(input), /complete bounded RIFF/);
  }
});
test('CLI requires explicit paths and external pin, refuses repeated or unknown options', () => {
  const args = ['--wav', 'audio.wav', '--receipt', 'receipt.json', '--operator-pin', PIN, '--output-dir', 'new'];
  assert.deepEqual(parseOptions([...args]), {wavPath:'audio.wav', receiptPath:'receipt.json', operatorPin:PIN, outputDir:'new'});
  assert.throws(() => parseOptions(args.slice(0, 4)), /Usage/);
  assert.throws(() => parseOptions([...args, '--operator-pin', PIN]), /repeated/);
  assert.throws(() => parseOptions([...args, '--trust-receipt', 'yes']), /Unknown/);
});

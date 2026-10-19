// SPDX-License-Identifier: AGPL-3.0-only
// INACTIVE: importing this file performs no I/O. No CLI is enabled in this draft.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {check, natural, plus, CASE, MAX_ATTEMPTS, startPlan, nextRange, advance, coverage, nativeArgs, authenticatePacket, validateLeaf, validateFullFreshGuard, guardPacketRead, validateCacheReceipt, cacheLoaderCharge} from './plan.mjs';
export const R = '/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const S = '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2';
export const SOURCE = '82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601';
export const PACKET = Object.freeze({path: R + '/audits/049d0f4fe07080f7e7f0/coding.json', relative_path: 'audits/049d0f4fe07080f7e7f0/coding.json', sha256: '51143feeddcc5f35be66a62748642adb1af7442ffea7134e640816f68f2943e2', bytes: 1643742});
export const PRIOR = Object.freeze({path: R + '/coding/open-coding-a/current-v6/successor-v1/checkpoint-0106-overlay-projection-bound-v1.json', sha256: 'cc5a053e834bc79f2ff79dae1c0697047c23bb372c83e73e3b5464f86a240f9d', bytes: 33336});
const READER = {path: S + '/lib/audit-reader.mjs', sha256: 'a00d1a3203be40dbc5b6497dd938031c3461ad6954f98651da95275034c2b3c9', bytes: 13693};
const PROJECTOR = {path: S + '/lib/source-decoration.mjs', sha256: 'a857d39a2da390175a1f817b4d2704ed1adbacff84ba6a27fefff7aee70f77fd', bytes: 56630};
const STORE = {path: S + '/lib/store.mjs', sha256: '2a1ecd6da273cff3be44202958cb46e3e1b0c754bed485b54347adee4e49eee3', bytes: 24187};
const CACHE = {relative_path: 'extraction-cache/82a3dab1396336ed/contract-b0b2c524b83beb9babbd.json.gz', sha256: '995827be482f7f16d412500a9c954dcdec4f1b94735639a0186ad196dd546278', bytes: 89549, decoded_bytes: 665576, decoded_sha256: '348b043b1ba1eec24cae3b8749711ccaf7c01656f9e0e77f98eb078ec6a0f5bf', result_sha256: 'e3d488bcf3036cd06099fb6e149984aba90733f0eb15b446da29190d28e4844b'};
const CACHE_MANIFEST = {path: R + '/' + CACHE.relative_path + '.manifest.json', sha256: '598939fe1b7a63890b2c0e546f1f35fdb6f9a2893c027aa0a147a0c4c1bc314f', bytes: 760};
const REGISTRY = {path: R + '/qa/current-v6-combined-registry-verification-20261018-v1/verification.json', sha256: '4ca8e30f837c958a4c3e7a189b90e17cc890953ebc67ca55ca02b777fef7a3d5', bytes: 11877};
const OBSERVATION = {path: R + '/qa/current-v6-combined-registry-verification-20261018-v1/ROOT-native-process-observation.json', sha256: '83519cf0c7587953f4dbdca7534882b2503583e7289d4df41d0c53f0f34136d4', bytes: 1346};
const OUTPUT = R + '/coding/open-coding-a/current-v6/projection-bound-diagnostic-v1/run-v1';
const OLD_LOCK = R + '/coding/open-coding-a/current-v6/overlay-0106-v1/operation-lock';
const MAX_RESPONSE_BYTES = 2 * 1024 ** 2, RESERVE_METADATA = 65536;
const H = b => crypto.createHash('sha256').update(b).digest('hex');
const J = v => Buffer.from(JSON.stringify(v, null, 2) + '\n');
function regular(p, directory = false) {
  check(typeof p === 'string' && path.posix.isAbsolute(p) && !p.split('/').some(x => x === '..' || x === '.'), 'PATH');
  let at = '/'; for (const part of p.split('/').filter(Boolean)) { at = path.posix.join(at, part); const st = fs.lstatSync(at); check(!st.isSymbolicLink(), 'SYMLINK'); }
  const st = fs.lstatSync(p); check(directory ? st.isDirectory() : st.isFile() && st.nlink === 1, 'REGULAR'); return st;
}
function bound(ref, max = 4 * 1024 ** 2) {
  check(ref && typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(ref.sha256) && natural(ref.bytes) > 0 && ref.bytes <= max, 'REF');
  check(regular(ref.path).size === ref.bytes, 'REF_BYTES'); const b = fs.readFileSync(ref.path); check(H(b) === ref.sha256, 'REF_SHA'); return b;
}
function reference(p) { const b = fs.readFileSync(p); return {path: p, sha256: H(b), bytes: b.length}; }
function put(name, value) { const p = OUTPUT + '/' + name, b = J(value); check(b.length <= MAX_RESPONSE_BYTES, 'METADATA_BOUND'); fs.writeFileSync(p, b, {flag: 'wx', mode: 0o600}); return {path: p, sha256: H(b), bytes: b.length}; }
function treeBytes(p) { let files = 0, dirs = 0, entries = 0; function walk(f) { check(++entries <= 1024, 'TREE_BOUND'); const s = fs.lstatSync(f); check(!s.isSymbolicLink(), 'TREE_LINK'); if (s.isDirectory()) { dirs = plus(dirs, s.size); for (const n of fs.readdirSync(f)) walk(f + '/' + n); } else { check(s.isFile() && s.nlink === 1, 'TREE_FILE'); files = plus(files, s.size); } } walk(p); return {files, dirs}; }
export function validateAdmission(a) {
  check(a?.schema === 'root-fixed0106-projection-diagnostic-admission-v1' && a.active === true && a.source_sha256 === SOURCE && a.authority === 'ROOT_DIAGNOSTIC_ONLY', 'INACTIVE_WITHOUT_ROOT_ADMISSION');
  check(a.output === OUTPUT && a.max_attempts === MAX_ATTEMPTS && a.prior_phases_closed === true && a.old_locks_preserved === true && a.reading_phase === false && a.semantic_claim === false, 'ADMISSION_SCOPE');
  check(a.prior_checkpoint?.path === PRIOR.path && a.prior_checkpoint.sha256 === PRIOR.sha256 && a.prior_checkpoint.bytes === PRIOR.bytes && a.prior_failed_range?.length === 2 && a.prior_failed_range[0] === 28000 && a.prior_failed_range[1] === 29000, 'PRIOR_FAILURE');
  for (const [k, floor] of Object.entries({visible_bytes: 4144325, capture_bytes: 19321916, artifact_bytes: 27919155, source_copy_floor_bytes: 262144})) check(natural(a.carry[k]) >= floor, 'NO_CARRY_REFUND');
  check(a.clock && /^[1-9][0-9]{0,24}$/u.test(a.clock.origin_ns) && /^[1-9][0-9]{0,24}$/u.test(a.clock.deadline_ns) && BigInt(a.clock.deadline_ns) > BigInt(a.clock.origin_ns) && BigInt(a.clock.deadline_ns) - BigInt(a.clock.origin_ns) <= 900000000000n, 'CLOCK');
  for (const [k, ceiling] of Object.entries({visible: 1048576, capture: 268435456, artifact: 134217728})) check(natural(a.new_limits[k]) > 0 && a.new_limits[k] <= ceiling, 'NEW_PHASE_CAP');
  check(a.external_watchdog_ms === 60000 && a.external_capture_meter === true && a.max_heap_mib === 512 && a.max_rss_bytes === 1073741824 && a.engineering_source_copy_bytes <= 65536 && natural(a.engineering_source_copy_bytes) > 0, 'EXECUTION_GUARDS');
}
export function validateMeterReservation(usage, limits, reserve = {}) {
  const names = ['visible', 'capture', 'artifact'];
  check(reserve && typeof reserve === 'object' && !Array.isArray(reserve) && Object.keys(reserve).every(k => names.includes(k)), 'RESERVATION_KEYS');
  for (const k of names) { const n = Object.hasOwn(reserve, k) ? natural(reserve[k]) : 0; check(plus(natural(usage[k]), n) <= natural(limits[k]), 'DIAGNOSTIC_CAP_' + k); }
  return usage;
}
export function candidateReservation(perRead, decoded) {
  return {visible: 4096, capture: plus(plus(perRead, decoded), 2 * MAX_RESPONSE_BYTES + RESERVE_METADATA), artifact: MAX_RESPONSE_BYTES + RESERVE_METADATA};
}
// Only a separately issued, exact ROOT admission may call this export later.
// This draft does not provide a CLI or invoke it during controls.
export async function runDiagnostic(admissionRef) {
  check(process.platform === 'linux' && process.env.NONVERBA_CONTAINER === '1', 'MANAGED_CONTAINER');
  const a = JSON.parse(bound(admissionRef, 65536)); validateAdmission(a);
  const started = process.hrtime.bigint(); let namedReads = natural(admissionRef.bytes), decodedBytes = 0, attemptCharges = 0, visibleCharges = 0;
  function clock() { const n = process.hrtime.bigint(); check(n >= started && n >= BigInt(a.clock.origin_ns) && n + 60000000000n <= BigInt(a.clock.deadline_ns), 'CLOCK_RESERVE_60S'); check(process.memoryUsage().rss <= a.max_rss_bytes && process.resourceUsage().maxRSS * 1024 <= a.max_rss_bytes, 'RSS'); }
  function charge({read = 0, decoded = 0, response = 0, visible = 0} = {}) { namedReads = plus(namedReads, read); decodedBytes = plus(decodedBytes, decoded); attemptCharges = plus(attemptCharges, response); visibleCharges = plus(visibleCharges, visible); fs.appendFileSync(OUTPUT + '/charges.jsonl', JSON.stringify({read, decoded, response, visible, named_read_bytes: namedReads, decoded_processing_bytes: decodedBytes, nonrefunded_attempt_reservations: attemptCharges}) + '\n', {flag: 'a', mode: 0o600}); }
  function meter(reserve = {}) { clock(); const t = fs.existsSync(OUTPUT) ? treeBytes(OUTPUT) : {files: 0, dirs: 0}; const v = {visible: plus(65536, visibleCharges), capture: plus(plus(plus(namedReads, decodedBytes), attemptCharges), plus(t.files, 65536)), artifact: plus(plus(t.files, t.dirs), 65536)}; validateMeterReservation(v, a.new_limits, reserve); return {new_phase: v, preserved_carry: a.carry, cumulative: Object.fromEntries(Object.entries(v).map(([k, n]) => [k + '_bytes', plus(a.carry[k + '_bytes'], n)])), cumulative_source_copy_floor_bytes: plus(a.carry.source_copy_floor_bytes, 65536), named_read_bytes: namedReads, decoded_processing_bytes: decodedBytes, nonrefunded_attempt_reservations: attemptCharges}; }
  function read(ref, max) { charge({read: natural(ref.bytes)}); meter({capture: RESERVE_METADATA, artifact: RESERVE_METADATA}); return bound(ref, max); }
  // Metadata gates precede packet/body/cache/raw/native payload reads.
  function guard() {
    read(READER); read(PROJECTOR); read(STORE); read(REGISTRY); read(OBSERVATION); read(PRIOR, 65536); regular(OLD_LOCK, true);
    const g = JSON.parse(read(a.guard_ref, 262144)); check(g.schema === 'root-fixed0106-diagnostic-guard-v1' && g.source_sha256 === SOURCE && g.current_case === CASE.audit_id && g.prior_failure_code === 'NATIVE_DECORATION_PROJECTION_BOUND' && g.old_phase_closed === true && g.method_dependencies_unchanged === true && g.registry_source_issues === 6 && g.registry_representation_issues === 6 && g.registry_roster_names_verified === true, 'ROOT_GUARD');
    validateFullFreshGuard(g);
    check(Array.isArray(g.immutable_metadata_refs) && g.immutable_metadata_refs.length >= 24 && g.immutable_metadata_refs.length <= 64 && Array.isArray(g.rosters) && g.rosters.length >= 2 && g.rosters.length <= 8, 'REGISTRY_PIN_SET');
    for (const r of g.immutable_metadata_refs) { check(r.path.startsWith(R + '/source-issues/') || r.path.startsWith(R + '/representation-issues/'), 'REGISTRY_REF_PATH'); read(r, 16 * 1024 ** 2); }
    for (const r of g.rosters) { check(r.path.startsWith(R + '/source-issues/') || r.path.startsWith(R + '/representation-issues/'), 'REGISTRY_PATH'); regular(r.path, true); check(Array.isArray(r.entries) && JSON.stringify(fs.readdirSync(r.path).sort()) === JSON.stringify([...r.entries].sort()), 'REGISTRY_CHANGED'); }
    return g;
  }
  clock(); regular(path.posix.dirname(OUTPUT), true); fs.mkdirSync(OUTPUT); fs.mkdirSync(OUTPUT + '/operation-lock');
  try {
    put('started.json', {admission: admissionRef, prior_checkpoint: PRIOR, nonrefunded_source_copy_floor: 65536, preserved_carry: a.carry, actual_reading: false, authority: 'NONE'});
    const g = guard(), packet = JSON.parse(guardPacketRead(g, () => read(PACKET, PACKET.bytes))), row = authenticatePacket(packet, g);
    check(a.normalized_ref.path === R + '/' + (row.parent.normalized_path ?? row.lineage.normalized_path) && a.normalized_ref.sha256 === CASE.normalized_sha256 && a.normalized_ref.bytes === CASE.normalized_bytes, 'NAMED_BOUNDARY_WITNESS');
    check(a.raw_ref.path === R + '/' + row.lineage.raw_path && a.raw_ref.sha256 === CASE.raw_sha256 && a.cache_ref.path === R + '/' + row.lineage.cache_path && a.cache_ref.sha256 === row.lineage.cache_sha256, 'NAMED_READER_INPUTS');
    regular(a.raw_ref.path); check(fs.statSync(a.raw_ref.path).size === a.raw_ref.bytes, 'RAW_STAT_BOUND');
    const normalized = new TextDecoder('utf-8', {fatal: true}).decode(read(a.normalized_ref, CASE.normalized_bytes));
    check(normalized.length >= CASE.parent_end && H(Buffer.from(normalized.slice(CASE.parent_start, CASE.parent_end))) === row.parent.sha256, 'PARENT_EXACT_WITNESS');
    check(a.cache_ref.path === R + '/' + CACHE.relative_path && a.cache_ref.sha256 === CACHE.sha256 && a.cache_ref.bytes === CACHE.bytes && a.cache_manifest_ref?.path === CACHE_MANIFEST.path && a.cache_manifest_ref.sha256 === CACHE_MANIFEST.sha256 && a.cache_manifest_ref.bytes === CACHE_MANIFEST.bytes, 'PINNED_GZIP_CACHE');
    const receipt = JSON.parse(read(a.cache_manifest_ref, 65536)); validateCacheReceipt(receipt, CACHE);
    read(a.cache_ref, CACHE.bytes); // Authenticate encoded lineage; never JSON.parse gzip bytes.
    const store = await import(pathToFileURL(STORE.path).href);
    charge(cacheLoaderCharge(CACHE.bytes, CACHE_MANIFEST.bytes, CACHE.decoded_bytes)); meter({capture: RESERVE_METADATA, artifact: RESERVE_METADATA});
    const cache = await store.readJSON(R, CACHE.relative_path, {maxBytes: CACHE.decoded_bytes});
    check(typeof cache.normalized_text === 'string' && H(Buffer.from(cache.normalized_text)) === CASE.normalized_sha256, 'CACHE_NORMALIZED');
    const native = cache.native_source_decorations; check(native && native.raw_sha256 === CASE.raw_sha256 && native.normalized_sha256 === CASE.normalized_sha256 && native.schema === 'native-source-decoration-reference-v1', 'NATIVE_NAMED_REFERENCE');
    check(native.artifact.path && natural(native.artifact.bytes) > 0 && natural(native.uncompressed_bytes) > 0 && native.uncompressed_bytes <= 256 * 1024 ** 2, 'NATIVE_READ_BOUND');
    const sidecar = {path: R + '/' + native.artifact.path, sha256: native.artifact.sha256, bytes: native.artifact.bytes}; regular(sidecar.path); check(fs.statSync(sidecar.path).size === sidecar.bytes, 'SIDECAR_STAT');
    // Frozen read multiplicities: packet x1, normalized x1, cache encoded x2,
    // cache manifest x1, raw x1, native compressed x1; both decoded bodies x1.
    const perRead = [PACKET.bytes, CASE.normalized_bytes, CACHE.bytes, CACHE.bytes, CACHE_MANIFEST.bytes, a.raw_ref.bytes, sidecar.bytes].reduce(plus, 0), perDecoded = plus(CACHE.decoded_bytes, native.uncompressed_bytes);
    let plan = startPlan(normalized.slice(CASE.parent_start, CASE.parent_end), [28000, 29000], PRIOR);
    const reader = await import(pathToFileURL(READER.path).href);
    const setup = put('setup.json', {schema: 'fixed0106-diagnostic-setup-v1', admission: admissionRef, normalized_witness: a.normalized_ref, cache_loader: STORE, named_reader_inputs: [PACKET, a.normalized_ref, a.cache_ref, a.cache_manifest_ref, a.raw_ref, sidecar], named_read_bytes_per_attempt: perRead, decoded_cache_bytes_per_attempt: CACHE.decoded_bytes, decoded_native_bytes_per_attempt: native.uncompressed_bytes, decoded_processing_bytes_per_attempt: perDecoded, frozen_projection_caps: {maxRuns: 512, maxCharacters: 20000, maxOrigins: 4096}, prior_failure_ref: PRIOR, actual_reading: false, authority: 'NONE'});
    while (nextRange(plan)) {
      guard(); meter(candidateReservation(perRead, perDecoded));
      const range = nextRange(plan), n = String(plan.attempts + 1).padStart(3, '0');
      charge({read: perRead, decoded: perDecoded, response: MAX_RESPONSE_BYTES, visible: 4096});
      put('attempt-' + n + '-started.json', {range, named_read_charge: perRead, decoded_cache_charge: CACHE.decoded_bytes, decoded_native_charge: native.uncompressed_bytes, decoded_processing_charge: perDecoded, nonrefunded_response_reservation: MAX_RESPONSE_BYTES, prior_attempts: plan.attempts, actual_reading: false, authority: 'NONE'});
      let outcome, responseRef = null;
      try { const value = await reader.readAuditSource(R, PACKET.relative_path, CASE.audit_id, nativeArgs(range)); validateLeaf(value, range, normalized, PACKET, row.lineage.source_url); const b = J(value); check(b.length <= MAX_RESPONSE_BYTES, 'COMPLETE_RESPONSE_CAPTURE_BOUND'); const p = OUTPUT + '/attempt-' + n + '-response.json'; fs.writeFileSync(p, b, {flag: 'wx', mode: 0o600}); responseRef = {path: p, sha256: H(b), bytes: b.length}; outcome = 'COMPLETE_ALL_NATIVE'; }
      catch (error) { if (error.code !== 'NATIVE_DECORATION_PROJECTION_BOUND') throw error; outcome = error.code; }
      plan = advance(plan, normalized.slice(CASE.parent_start, CASE.parent_end), outcome);
      put('attempt-' + n + '-result.json', {range, outcome, response_ref: responseRef, plan, actual_reading: false, authority: 'NONE'});
      guard(); meter({capture: RESERVE_METADATA, artifact: RESERVE_METADATA});
    }
    const result = put('result.json', {schema: 'fixed0106-projection-diagnostic-result-v1', setup, plan, coverage: coverage(plan, normalized.slice(CASE.parent_start, CASE.parent_end)), accounting_before_result: meter({capture: RESERVE_METADATA, artifact: RESERVE_METADATA}), actual_reading: false, semantic_final: false, authority: 'NONE'});
    const accounting = meter(); fs.rmdirSync(OUTPUT + '/operation-lock'); return {result, attempts: plan.attempts, accounting, actual_reading: false, authority: 'NONE'};
  } catch (error) {
    // A failed write, interruption or unexpected rejection leaves a durable HOLD.
    // No retry, lock repair or expired-phase mutation is provided.
    try { put('failure.json', {schema: 'fixed0106-diagnostic-hold-v1', code: /^[A-Z0-9_]+$/u.test(error.code ?? '') ? error.code : 'UNEXPECTED_FAILURE', named_read_bytes: namedReads, decoded_processing_bytes: decodedBytes, nonrefunded_attempt_reservations: attemptCharges, actual_reading: false, authority: 'NONE'}); } catch { /* original lock is the durable failure witness */ }
    throw error;
  }
}

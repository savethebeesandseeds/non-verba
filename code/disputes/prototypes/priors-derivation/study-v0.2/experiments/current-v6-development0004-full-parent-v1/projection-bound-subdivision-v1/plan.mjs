// SPDX-License-Identifier: AGPL-3.0-only
// Pure, source-free planner. No I/O, source reader, labels or coding decisions.
export const MAX_ATTEMPTS = 32;
export function check(ok, code) { if (!ok) throw Object.assign(new Error(code), {code}); }
export function natural(n) { check(Number.isSafeInteger(n) && n >= 0, 'INTEGER'); return n; }
export function plus(a, b) { return natural(natural(a) + natural(b)); }
export function boundary(text, p) {
  return Number.isSafeInteger(p) && p >= 0 && p <= text.length &&
    !(p > 0 && p < text.length && /[\uD800-\uDBFF]/u.test(text[p - 1]) && /[\uDC00-\uDFFF]/u.test(text[p]));
}
export function split(text, [start, end]) {
  check(boundary(text, start) && boundary(text, end) && end > start, 'RANGE');
  let mid = Math.floor((start + end) / 2);
  if (!boundary(text, mid)) mid--;
  if (mid <= start) { mid = start + 1; if (!boundary(text, mid)) mid++; }
  return mid < end ? [[start, mid], [mid, end]] : null;
}
export function startPlan(text, range, priorFailureRef, ceiling = MAX_ATTEMPTS) {
  check(Number.isSafeInteger(ceiling) && ceiling > 0 && ceiling <= MAX_ATTEMPTS, 'ATTEMPT_CEILING');
  const children = split(text, range);
  return {range: [...range], ceiling, attempts: 0, prior_failure_ref: priorFailureRef,
    pending: children ?? [], accepted: [], unresolved: children ? [] : [{range: [...range], reason: 'PRIOR_BOUND_NO_INTERIOR_CODEPOINT_BOUNDARY'}], history: []};
}
export function nextRange(plan) { return plan.attempts < plan.ceiling && plan.pending.length ? [...plan.pending[0]] : null; }
export function advance(plan, text, outcome) {
  const range = nextRange(plan); check(range !== null, 'NO_NEXT_ATTEMPT');
  check(['COMPLETE_ALL_NATIVE', 'NATIVE_DECORATION_PROJECTION_BOUND'].includes(outcome), 'OUTCOME');
  const out = structuredClone(plan); out.pending.shift(); out.attempts++;
  out.history.push({attempt: out.attempts, range, outcome});
  if (outcome === 'COMPLETE_ALL_NATIVE') out.accepted.push(range);
  else { const children = split(text, range); if (children) out.pending.unshift(...children);
    else out.unresolved.push({range, reason: 'TESTED_BOUND_NO_INTERIOR_CODEPOINT_BOUNDARY_CAUSE_UNKNOWN'}); }
  return out;
}
export function coverage(plan, text) {
  const pieces = [...plan.accepted.map(range => ({range, status: 'COMPLETE_ALL_NATIVE'})),
    ...plan.unresolved.map(p => ({...p, status: 'UNRESOLVED_BOUND'})),
    ...plan.pending.map(range => ({range, status: 'UNATTEMPTED'}))].sort((a, b) => a.range[0] - b.range[0]);
  let at = plan.range[0]; for (const {range: [s, e]} of pieces) {
    check(s === at && e > s && boundary(text, s) && boundary(text, e), 'GAP_OVERLAP_OR_CODEPOINT'); at = e;
  }
  check(at === plan.range[1], 'INCOMPLETE_INTERVAL_UNION');
  return {pieces, exact_interval_union: true, all_leaves_complete: pieces.every(p => p.status === 'COMPLETE_ALL_NATIVE'),
    attempt_ceiling_reached: plan.attempts === plan.ceiling && plan.pending.length > 0,
    actual_reading: false, semantic_completeness: false, authority: 'NONE'};
}
export function nativeArgs([start, end]) {
  check(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 28000 && end <= 29000 && end > start, 'FIXED_INTERVAL');
  return {source: 'parent', offset: start, limit: end - start, showProposedHeading: false, nativeDecorations: 'all'};
}
export const CASE = Object.freeze({audit_id: 'coding-0106', contract_id: 'contract-b0b2c524b83beb9babbd',
  source_id: 'contract-b0b2c524b83beb9babbd:section:54-46469:e4736e595570:unit:44075-45267:17cae4b7874b',
  parent_start: 54, parent_end: 46469, parent_characters: 46415,
  normalized_sha256: '4888fbb6c46d880bc7b306dc1a5fa7d35674b1b3df5e33b5bf9a2d307acd5186', normalized_bytes: 46725,
  raw_sha256: 'f7037f6dd4cde960355903150ef0004db1c6ddc6e9d26efb43bb1992ab9cafeb'});
export function validateFullFreshGuard(guard) {
  check(guard.full_fresh100 === true && guard.fresh_sections === 100 && guard.fresh_contract_count === 29 &&
    Array.isArray(guard.fresh_contract_ids) && guard.fresh_contract_ids.length === 29 &&
    new Set(guard.fresh_contract_ids).size === 29 && guard.fresh_contract_ids.every(v => typeof v === 'string' && /^contract-[a-f0-9]{20}$/u.test(v)), 'FULL_FRESH_CID_GUARD');
  return new Set(guard.fresh_contract_ids);
}
export function guardPacketRead(guard, readPacket) { validateFullFreshGuard(guard); return readPacket(); }
export function validateCacheReceipt(receipt, expected) {
  const s = receipt.storage;
  check(receipt.path === expected.relative_path && receipt.sha256 === expected.sha256 && receipt.bytes === expected.bytes && receipt.result_sha256 === expected.result_sha256 &&
    s?.schema === 'lossless-gzip-extraction-cache-v1' && s.encoding === 'gzip' && s.serializer === 'UTF8_JSON_STRINGIFY_PRETTY_2_FINAL_LF_V1' &&
    s.decoded_bytes === expected.decoded_bytes && s.decoded_sha256 === expected.decoded_sha256, 'COMPRESSED_CACHE_MANIFEST');
  cacheLoaderCharge(receipt.bytes, 1, s.decoded_bytes);
  return s.decoded_bytes;
}
export function cacheLoaderCharge(encoded, manifest, decoded) {
  check(natural(encoded) > 0 && encoded <= 64 * 1024 ** 2 && natural(manifest) > 0 && manifest <= 65536 && natural(decoded) > 0 && decoded <= 64 * 1024 ** 2, 'CACHE_READ_CHARGE');
  return {read: plus(encoded, manifest), decoded};
}
export function authenticatePacket(packet, guard) {
  const fresh = validateFullFreshGuard(guard);
  check(packet.purpose === 'coding' && Array.isArray(packet.rows) && packet.rows.length === 500, 'PACKET_SCOPE');
  check(new Set(packet.rows.map(r => r.audit_id)).size === 500 && packet.rows.every((r, i) => r.audit_id === 'coding-' + String(i + 1).padStart(4, '0')), 'FIXED_ORDER');
  check(!packet.rows.some(r => fresh.has(r.contract_id)), 'FRESH_CONTRACT_OVERLAP');
  const row = packet.rows[105]; check(row.audit_id === CASE.audit_id && row.id === CASE.source_id && row.contract_id === CASE.contract_id &&
    row.parent.start === CASE.parent_start && row.parent.end === CASE.parent_end &&
    row.lineage.normalized_sha256 === CASE.normalized_sha256 && row.lineage.raw_sha256 === CASE.raw_sha256, 'CURRENT_CASE_LINEAGE');
  check(typeof row.parent.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(row.parent.sha256) && typeof row.lineage.source_url === 'string', 'PARENT_LINEAGE');
  return row;
}
export function validateLeaf(value, range, normalized, packetRef, sourceURL) {
  const [s, e] = range, n = value.native_source_decorations;
  check(value.audit_id === CASE.audit_id && value.source_id === CASE.source_id && value.contract_id === CASE.contract_id && value.purpose === 'coding' && value.source === 'parent', 'LEAF_IDENTITY');
  check(value.packet.path === packetRef.relative_path && value.packet.sha256 === packetRef.sha256 && value.packet.bytes === packetRef.bytes, 'LEAF_PACKET');
  check(value.binding.sha256 === CASE.normalized_sha256 && value.binding.bytes === CASE.normalized_bytes, 'LEAF_NORMALIZED');
  check(value.range.offset === s && value.range.end === e && value.range.total_characters === CASE.parent_characters &&
    value.range.absolute_normalized_start === CASE.parent_start + s && value.range.complete_source_in_this_slice === false && value.range.next_offset === e, 'LEAF_RANGE');
  check(value.text === normalized.slice(CASE.parent_start + s, CASE.parent_start + e) && value.source_url === sourceURL, 'LEAF_EXACT_TEXT_INVERSE');
  check(value.source_scope === 'EXTRACTED_FLAT_SPAN' && value.semantic_completeness === 'UNVERIFIED_REQUIRES_ORIGINAL_SOURCE_READING' && value.range.offset_basis === 'UTF16 decoded text; raw text slices are not raw byte offsets', 'LEAF_QUALIFIERS');
  check(!Object.hasOwn(value, 'proposed_heading') && !Object.hasOwn(value, 'source_navigation'), 'LEAF_PRIMING');
  check(n.schema === 'native-source-decoration-projection-v2' && n.projection_policy === 'ALL_NATIVE_STYLE_SOURCE_METADATA' &&
    n.range.start === CASE.parent_start + s && n.range.end === CASE.parent_start + e && n.range.include_end_zero_width === false &&
    n.normalized_sha256 === CASE.normalized_sha256 && n.raw_sha256 === CASE.raw_sha256 &&
    Array.isArray(n.annotations) && n.computed_style_verified === false && n.effectiveness_verified === false && n.authority === 'NONE', 'LEAF_ALL_NATIVE_SCOPE');
  return true;
}

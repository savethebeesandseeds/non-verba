// SPDX-License-Identifier: AGPL-3.0-only
// Study v0.2: scalable proposals, verified repetition and separate split blocking.
import { createHash } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const normalize = (value) => value.normalize('NFC').replace(/[\u200B\uFEFF]/gu, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '').replace(/\s+/gu, ' ').trim();
const tokens = (value) => value.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?|[<>≤≥±]/gu) ?? [];
const CRITICAL = new Set('no not never without unless except if provided however notwithstanding subject shall must may will can cannot should would and or include including exclude excluding permitted prohibited mandatory optional reasonable unreasonable valid invalid authorized unauthorized supported unsupported one two three four five six seven eight nine ten hundred thousand million billion day days month months year years hour hours percent'.split(' '));
const ROLES = ['service provider', 'party a', 'party b', 'party c', 'requester', 'operator', 'mediator', 'client', 'company', 'consultant', 'contractor', 'customer', 'lessor', 'lessee', 'landlord', 'tenant', 'seller', 'buyer', 'supplier', 'recipient', 'disclosing party', 'receiving party'];
const NUMBER = /[+\-]?\s*[$€£]?\s*\d[\d,]*(?:\.\d+)?\s*%?/gu;

function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${name} must be an integer in ${min}..${max}`);
  return value;
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function rolePattern(extra) {
  if (!Array.isArray(extra) || extra.some((role) => typeof role !== 'string' || !role.trim())) throw new TypeError('roleTerms must contain nonempty literal role names');
  const phrases = [...new Set([...ROLES, ...extra].map((role) => normalize(role).toLowerCase()))].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return new RegExp(`\\b(?:${phrases.map(escapeRegex).join('|')})\\b`, 'giu');
}

function protectedSignature(text, pattern) {
  return JSON.stringify({
    numbers: (text.match(NUMBER) ?? []).map((number) => number.replace(/[\s,]/gu, '')),
    roles: (text.toLowerCase().match(pattern) ?? []).map(normalize),
    critical: tokens(text).filter((token) => CRITICAL.has(token) || /^[<>≤≥±]$/u.test(token)),
  });
}

function templateText(text, pattern) {
  return normalize(text.toLowerCase().replace(pattern, ' <ROLE> ').replace(NUMBER, ' <NUMBER> '));
}

function shingleSet(text, size) {
  const values = tokens(text); const set = new Set();
  if (values.length < size) { if (values.length) set.add(values.join('\u001f')); return set; }
  for (let index = 0; index + size <= values.length; index += 1) set.add(values.slice(index, index + size).join('\u001f'));
  return set;
}

function fnv(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function mix(value) {
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return (value ^ value >>> 16) >>> 0;
}

function minhash(set, salts) {
  const result = new Uint32Array(salts.length).fill(0xffffffff);
  for (const shingle of set) {
    const hashed = fnv(shingle);
    for (let index = 0; index < salts.length; index += 1) {
      const value = mix(hashed ^ salts[index]);
      if (value < result[index]) result[index] = value;
    }
  }
  return result;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return left.size === right.size ? 1 : 0;
  const small = left.size <= right.size ? left : right;
  const big = left.size <= right.size ? right : left;
  let intersection = 0; for (const value of small) if (big.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

class Union {
  constructor(length) { this.parent = Array.from({ length }, (_, index) => index); }
  root(index) { while (this.parent[index] !== index) { this.parent[index] = this.parent[this.parent[index]]; index = this.parent[index]; } return index; }
  join(left, right) { const a = this.root(left); const b = this.root(right); if (a !== b) this.parent[Math.max(a, b)] = Math.min(a, b); }
}

/**
 * All input variants survive. MinHash/LSH proposes comparisons only: admitted
 * near duplicates need exact string-shingle Jaccard and equal protected tokens.
 * Broader template blocks are leakage controls, not equivalent legal meanings.
 */
export function deduplicateUnits(rows, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError('deduplicateUnits requires an array');
  const seed = String(options.seed ?? 'nonverba-repetition-v0.2');
  const threshold = options.threshold ?? options.nearThreshold ?? 0.94;
  const templateThreshold = options.templateThreshold ?? 0.8;
  if (!Number.isFinite(threshold) || threshold < 0.8 || threshold > 1 || !Number.isFinite(templateThreshold) || templateThreshold < 0.5 || templateThreshold > 1) throw new TypeError('near/template thresholds require 0.8..1 and 0.5..1 respectively');
  const signatureSize = integer(options.signatureSize ?? 32, 'signatureSize', 8, 256);
  const bands = integer(options.bands ?? 8, 'bands', 1, signatureSize);
  if (signatureSize % bands) throw new TypeError('signatureSize must be divisible by bands');
  const shingleSize = integer(options.shingleSize ?? 4, 'shingleSize', 2, 8);
  const minNearWords = integer(options.minNearWords ?? 30, 'minNearWords', 8, 10000);
  const maxBucketSize = integer(options.maxBucketSize ?? 64, 'maxBucketSize', 2, 4096);
  const hotBucketAnchors = integer(options.hotBucketAnchors ?? 8, 'hotBucketAnchors', 1, maxBucketSize);
  const maxCandidatePairs = integer(options.maxCandidatePairs ?? 1_000_000, 'maxCandidatePairs', 1, 20_000_000);
  const maxAuditPairs = integer(options.maxAuditPairs ?? 100_000, 'maxAuditPairs', 0, 2_000_000);
  const pattern = rolePattern(options.roleTerms ?? []);
  const canonical = new Map(); const ids = new Set();
  rows.forEach((row, index) => {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.text !== 'string' || !row.text.trim()) throw new TypeError('Rows require distinct nonempty ids and extracted text');
    ids.add(row.id);
    const text = normalize(row.text); const sha256 = digest(text);
    if (!canonical.has(sha256)) canonical.set(sha256, { sha256, text, indexes: [] });
    canonical.get(sha256).indexes.push(index);
  });
  const groups = [...canonical.values()].map((group) => {
    group.indexes.sort((left, right) => rows[left].id.localeCompare(rows[right].id));
    const id = rows[group.indexes[0]].id;
    const template = templateText(group.text, pattern);
    return { ...group, id, rank: digest(JSON.stringify([seed, id])), template, template_sha256: digest(template), guard: protectedSignature(group.text, pattern), word_count: tokens(group.text).length };
  }).sort((left, right) => left.rank.localeCompare(right.rank) || left.id.localeCompare(right.id));
  const templateUnion = new Union(groups.length);
  const sameTemplate = new Map();
  groups.forEach((group, index) => {
    if (sameTemplate.has(group.template_sha256)) templateUnion.join(index, sameTemplate.get(group.template_sha256));
    else sameTemplate.set(group.template_sha256, index);
  });
  const salts = Array.from({ length: signatureSize }, (_, index) => mix(fnv(`${seed}:${index}`)));
  const width = signatureSize / bands;
  const buckets = new Map(); const proposed = new Set(); const accepted = new Map();
  const auditPairs = []; let omittedAuditPairs = 0; let skippedProposals = 0; let capped = false;
  const hotBlocks = new Set(); const nearMatches = [];
  const cache = new Map();
  const getSet = (index, mode) => {
    const key = `${index}:${mode}`;
    if (cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); return value; }
    const value = shingleSet(mode === 'template' ? groups[index].template : groups[index].text, shingleSize);
    cache.set(key, value); if (cache.size > 256) cache.delete(cache.keys().next().value);
    return value;
  };
  const pairKey = (left, right) => `${Math.min(left, right)}:${Math.max(left, right)}`;
  function compare(left, right, proposal) {
    const key = pairKey(left, right);
    if (proposed.has(key)) return;
    if (proposed.size === maxCandidatePairs) { skippedProposals += 1; capped = true; return; }
    proposed.add(key);
    const originalScore = jaccard(getSet(left, 'original'), getSet(right, 'original'));
    const templateScore = jaccard(getSet(left, 'template'), getSet(right, 'template'));
    const sameGuard = groups[left].guard === groups[right].guard;
    const near = Math.min(groups[left].word_count, groups[right].word_count) >= minNearWords && originalScore >= threshold && sameGuard;
    const block = templateScore >= templateThreshold;
    if (block) templateUnion.join(left, right);
    const decision = { left_id: groups[left].id, right_id: groups[right].id, proposal, original_jaccard: originalScore, template_jaccard: templateScore, protected_tokens_equal: sameGuard, admitted_near_duplicate: near, template_blocked: block, reason: near ? 'exact_jaccard_and_protected_tokens_match' : originalScore >= threshold && !sameGuard ? 'numeric_modal_role_or_exception_difference_retained' : 'not_admitted_as_near_duplicate' };
    if (originalScore >= threshold) nearMatches.push(decision);
    if (near) accepted.set(key, { left, right, score: originalScore });
    if (near || block || originalScore >= threshold) { if (auditPairs.length < maxAuditPairs) auditPairs.push(decision); else omittedAuditPairs += 1; }
  }
  groups.forEach((group, index) => {
    if (group.word_count < minNearWords) return;
    const signature = minhash(getSet(index, 'template'), salts);
    for (let band = 0; band < bands; band += 1) {
      const key = `${band}:${Array.from(signature.subarray(band * width, (band + 1) * width)).join(',')}`;
      if (!buckets.has(key)) buckets.set(key, { count: 0, members: [], hot: false, anchor: index });
      const bucket = buckets.get(key); bucket.count += 1;
      if (!bucket.hot && bucket.members.length === maxBucketSize) {
        bucket.hot = true;
        for (const member of bucket.members) { templateUnion.join(bucket.anchor, member); hotBlocks.add(member); }
      }
      if (bucket.hot) { templateUnion.join(bucket.anchor, index); hotBlocks.add(index); }
      const candidates = bucket.hot ? bucket.members.slice(0, hotBucketAnchors) : bucket.members;
      for (const previous of candidates) compare(previous, index, bucket.hot ? 'bounded_hot_bucket_anchor' : 'minhash_lsh_band');
      if (bucket.members.length < maxBucketSize) bucket.members.push(index);
    }
  });
  // Complete-link joining prevents a chain of close variants becoming one
  // representative family when the endpoints were not independently verified.
  const duplicateClusters = groups.map((_, index) => [index]); const duplicateOf = groups.map((_, index) => index);
  const edges = [...accepted.values()].sort((left, right) => right.score - left.score || groups[left.left].id.localeCompare(groups[right.left].id) || groups[left.right].id.localeCompare(groups[right.right].id));
  for (const edge of edges) {
    const left = duplicateOf[edge.left]; const right = duplicateOf[edge.right];
    if (left === right) continue;
    if (!duplicateClusters[left].every((a) => duplicateClusters[right].every((b) => accepted.has(pairKey(a, b))))) continue;
    duplicateClusters[left].push(...duplicateClusters[right]);
    for (const member of duplicateClusters[right]) duplicateOf[member] = left;
    duplicateClusters[right] = [];
  }
  const groupIndexById = new Map(groups.map((group, index) => [group.id, index]));
  for (const decision of nearMatches) {
    const left = groupIndexById.get(decision.left_id); const right = groupIndexById.get(decision.right_id);
    decision.family_joined = decision.admitted_near_duplicate && duplicateOf[left] === duplicateOf[right];
  }
  const templateMembers = new Map();
  groups.forEach((_, index) => { const root = templateUnion.root(index); if (!templateMembers.has(root)) templateMembers.set(root, []); templateMembers.get(root).push(index); });
  const templateIdByGroup = new Map(); const templateCoarseByGroup = new Map(); const templateFamilies = [];
  for (const members of templateMembers.values()) {
    const id = `template-block-${digest(members.map((index) => groups[index].sha256).sort().join('\n')).slice(0, 24)}`;
    const memberRows = members.flatMap((index) => groups[index].indexes).sort((left, right) => rows[left].id.localeCompare(rows[right].id));
    const coarse = members.some((index) => hotBlocks.has(index));
    templateFamilies.push({ id, members: memberRows.map((index) => rows[index].id), representative_id: rows[memberRows[0]].id, coarse_hot_bucket_block: coarse, purpose: 'LEAKAGE_BLOCKING_ONLY_NOT_SEMANTIC_EQUIVALENCE' });
    for (const member of members) { templateIdByGroup.set(member, id); templateCoarseByGroup.set(member, coarse); }
  }
  const records = new Array(rows.length); const families = []; const representatives = [];
  for (const members of duplicateClusters.filter((cluster) => cluster.length)) {
    const memberRows = members.flatMap((index) => groups[index].indexes).sort((left, right) => rows[left].id.localeCompare(rows[right].id));
    const representative = rows[memberRows[0]]; const representativeDigest = digest(normalize(representative.text));
    const id = `repetition-${digest(members.map((index) => groups[index].sha256).sort().join('\n')).slice(0, 24)}`;
    families.push({ id, representative_id: representative.id, members: memberRows.map((index) => rows[index].id), kind: members.length > 1 ? 'guarded_near' : memberRows.length > 1 ? 'exact' : 'unique', sources: memberRows.map((index) => ({ id: rows[index].id, contract_id: rows[index].contract_id, source_url: rows[index].source_url ?? '' })) });
    for (const member of members) for (const index of groups[member].indexes) records[index] = { ...rows[index], family_id: id, duplicate_family: id, family_representative_id: representative.id, duplicate_kind: index === memberRows[0] ? 'unique' : groups[member].sha256 === representativeDigest ? 'exact' : 'near', template_blocking_id: templateIdByGroup.get(member), template_blocking_coarse: templateCoarseByGroup.get(member) };
    representatives.push(records[memberRows[0]]);
  }
  const hotBuckets = [...buckets.entries()].filter(([, bucket]) => bucket.hot).map(([key, bucket]) => ({ bucket_id: digest(key).slice(0, 20), count: bucket.count, stored_members: bucket.members.length, anchor_ids: bucket.members.slice(0, hotBucketAnchors).map((index) => groups[index].id), policy: 'all_bucket_members_blocked_together; bounded_anchor_pair_verification; source_variants_retained' }));
  const warnings = [];
  if (hotBuckets.length) warnings.push({ code: 'HOT_LSH_BUCKETS', message: `${hotBuckets.length} hot buckets use conservative coarse blocking and limited duplicate comparisons; audit their breadth.` });
  if (capped) warnings.push({ code: 'CANDIDATE_PAIR_LIMIT', message: 'The declared candidate-pair bound was reached. Duplicate detection and template coverage are incomplete; retain this attempt and revisit the operating bounds.' });
  if (omittedAuditPairs) warnings.push({ code: 'AUDIT_DIAGNOSTIC_LIMIT', message: `${omittedAuditPairs} additional threshold decisions exceed the diagnostic retention bound; deterministic replay and all source variants remain available.` });
  return { records, representatives, reps: representatives, families, template_families: templateFamilies, near_matches: nearMatches, stats: { input_count: rows.length, canonical_count: groups.length, family_count: families.length, exact_duplicate_count: rows.length - groups.length, near_duplicate_count: groups.length - families.length, template_block_count: templateFamilies.length, candidate_pairs_verified: proposed.size, hot_bucket_count: hotBuckets.length, candidate_limit_reached: capped, audit_pairs_omitted: omittedAuditPairs }, audit: { pairs: auditPairs, hot_buckets: hotBuckets, skipped_proposal_visits: skippedProposals, warnings, coverage_complete: !capped && !hotBuckets.length, method: 'deterministic_minhash_lsh_proposals_then_exact_string_jaccard_and_protected_token_guard', interpretation: 'LSH is a proposal mechanism with false negatives; coverage_complete reports whether declared bounds degraded it, not exhaustive comparison or recall.' }, parameters: { seed, threshold, templateThreshold, signatureSize, bands, shingleSize, minNearWords, maxBucketSize, hotBucketAnchors, maxCandidatePairs, maxAuditPairs, exact_normalization: 'NFC; whitespace collapsed; case and semantic tokens retained', roleTerms: options.roleTerms ?? [], duplicate_family_rule: 'complete_link_verified_pairs', template_rule: 'numeric/role-normalized templates; exact or verified template overlap; hot buckets coarse blocked' }, limitations: ['All original source variants remain retained, including changed numbers, roles, modal verbs and exceptions.', 'Near repetition is a conservative textual hypothesis, not equivalence of legal meaning.', 'Broader template blocks deliberately include materially different variants and confer no substitution authority.', 'Unrecognized named-party changes and unlisted semantic differences can escape the protected-token guard.', 'LSH can miss pairs; pair/bucket bounds and diagnostic omissions are explicit rather than a recall guarantee.'] };
}

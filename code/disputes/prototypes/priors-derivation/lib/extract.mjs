// SPDX-License-Identifier: AGPL-3.0-only
// Priors Derivation Lab prototype: source-preserving extraction, not legal analysis.
import { createHash } from 'node:crypto';
import { parse } from 'parse5';

const BLOCK_TAGS = new Set(['address', 'article', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'li', 'main', 'nav', 'ol', 'p', 'section', 'ul']);
const OMIT_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed', 'head']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const CRITICAL_WORDS = new Set(['not', 'no', 'never', 'without', 'unless', 'except', 'shall', 'must', 'may', 'will', 'should', 'can', 'cannot', 'non', 'greater', 'less', 'before', 'after', 'increase', 'decrease', 'exclusive', 'nonexclusive', 'including', 'excluding', 'and', 'or']);
const STATUS_PATTERN = /access denied|request rate threshold exceeded|too many requests|undeclared automated tool|temporarily unavailable|service unavailable|internal server error|page not found|security (?:block|check)|verify (?:that )?you are human|captcha/i;

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

function normalizeText(text) {
  return text.normalize('NFC').replace(/[\u200B\uFEFF]/gu, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '').replace(/\s+/gu, ' ').trim();
}

function wordMatches(text) {
  return [...text.matchAll(/\S+/gu)];
}

function words(text) {
  return wordMatches(text).length;
}

function tokenize(text) {
  return text.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?|[<>≤≥]/gu) ?? [];
}

function attrs(node) {
  return new Map((node.attrs ?? []).map(({ name, value }) => [name.toLowerCase(), value]));
}

function isHidden(node) {
  const attributes = attrs(node);
  return attributes.has('hidden') || attributes.get('aria-hidden') === 'true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(attributes.get('style') ?? '');
}

function headingLike(text) {
  if (text.length > 150 || words(text) > 14 || !/[\p{L}]/u.test(text)) return false;
  const assertion = /\b(?:shall|must|may|will|agrees?|is|are|has|have)\b/i.test(text);
  if (/^(?:article|section)\s+(?:[IVXLC\d]+)(?:\b|\.)/i.test(text) && words(text) <= 10 && !assertion) return true;
  if (/^\d+(?:\.\d+)*[.)]?\s+[\p{Lu}]/u.test(text) && words(text) <= 10 && !/[.;!?]$/.test(text) && !assertion) return true;
  // Short all-caps section labels recur in SEC exhibit HTML without heading tags.
  return !assertion && /^[\p{Lu}\p{N}\s.,:;()\-/&'’]+$/u.test(text) && /[\p{Lu}]{3}/u.test(text) && !/[;!?]$/.test(text);
}

function collectHtml(content) {
  // parse5 constructs an inert tree. No DOM, resource loading or script execution occurs.
  const tree = parse(content);
  const blocks = [];
  const excludedCounts = new Map();
  const warnings = [];
  let title = '';
  let body;
  const pending = [tree];
  while (pending.length) {
    const node = pending.pop();
    if (node.tagName === 'title') title = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
    if (node.tagName === 'body') body = node;
    for (const child of node.childNodes ?? []) pending.push(child);
  }
  const noteExcluded = (reason) => excludedCounts.set(reason, (excludedCounts.get(reason) ?? 0) + 1);
  function omit(node) {
    if (OMIT_TAGS.has(node.tagName)) { noteExcluded(`inert_${node.tagName}_excluded`); return true; }
    if (isHidden(node)) { noteExcluded('hidden_html_excluded'); return true; }
    return false;
  }
  function inline(node, depth = 0) {
    if (depth > 256) { noteExcluded('html_depth_limit'); return ''; }
    if (node.nodeName === '#text') return node.value ?? '';
    if (omit(node)) return '';
    if (node.tagName === 'br') return '\n';
    const value = (node.childNodes ?? []).map((child) => inline(child, depth + 1)).join('');
    return BLOCK_TAGS.has(node.tagName) || HEADING_TAGS.has(node.tagName) ? `\n${value}\n` : value;
  }
  function add(raw, kind = 'paragraph') {
    const text = normalizeText(raw);
    if (text) blocks.push({ text, kind, isHeading: kind === 'heading' || headingLike(text) });
  }
  let buffer = '';
  const flush = (kind = 'paragraph') => { add(buffer, kind); buffer = ''; };
  function tableRows(node, depth = 0) {
    if (depth > 256) { noteExcluded('html_depth_limit'); return; }
    if (omit(node)) return;
    if (node.tagName === 'tr') {
      const cells = (node.childNodes ?? []).filter((child) => child.tagName === 'td' || child.tagName === 'th');
      const values = cells.map((cell) => normalizeText(inline(cell, depth + 1))).filter(Boolean);
      if (values.length) add(values.join(' | '), cells.every((cell) => cell.tagName === 'th') ? 'heading' : 'table_row');
      return;
    }
    for (const child of node.childNodes ?? []) tableRows(child, depth + 1);
  }
  function walk(node, depth = 0) {
    if (depth > 256) { noteExcluded('html_depth_limit'); return; }
    if (node.nodeName === '#text') { buffer += node.value ?? ''; return; }
    if (omit(node)) return;
    if (node.tagName === 'br') { buffer += '\n'; return; }
    if (node.tagName === 'table') { flush(); tableRows(node, depth + 1); return; }
    if (HEADING_TAGS.has(node.tagName)) { flush(); add(inline(node, depth + 1), 'heading'); return; }
    if (node.tagName === 'pre') { flush(); for (const block of collectPlain(inline(node, depth + 1))) blocks.push(block); return; }
    const block = BLOCK_TAGS.has(node.tagName);
    if (block) flush();
    for (const child of node.childNodes ?? []) walk(child, depth + 1);
    if (block) flush(node.tagName === 'li' ? 'list_item' : 'paragraph');
  }
  walk(body ?? tree);
  flush();
  if (excludedCounts.has('html_depth_limit')) warnings.push({ code: 'HTML_DEPTH_LIMIT', message: 'HTML deeper than 256 elements was omitted; review the source before using this extraction.' });
  return { blocks, title: normalizeText(title), excluded: [...excludedCounts].map(([reason, count]) => ({ reason, count })), warnings };
}

function collectPlain(content) {
  const blocks = [];
  let buffer = [];
  const flush = () => {
    const text = normalizeText(buffer.join(' '));
    if (text) blocks.push({ text, kind: 'paragraph', isHeading: headingLike(text) });
    buffer = [];
  };
  for (const rawLine of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = normalizeText(rawLine);
    if (!line) { flush(); continue; }
    if (headingLike(line)) { flush(); blocks.push({ text: line, kind: 'heading', isHeading: true }); continue; }
    if (/^(?:\(?\d+(?:\.\d+)*[.)]|\([a-zA-Z]\))\s+/u.test(line)) flush();
    buffer.push(line);
  }
  flush();
  return blocks;
}

function requireInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

function sourceMetadata(document) {
  const { content, ...metadata } = document;
  return { ...metadata, id: String(document.id ?? `contract-${sha256(document.source_url ?? content).slice(0, 20)}`), source_url: String(document.source_url ?? ''), format: document.format };
}

/**
 * Return an inert, contextual extraction. start/end are UTF-16 string offsets in
 * normalized_text, not original-HTML byte positions. Short content is retained
 * with a segmentation reason, rather than disappearing behind minWords.
 */
export function extractContract(document, options = {}) {
  if (!document || typeof document.content !== 'string' || !['html', 'text'].includes(document.format)) throw new TypeError('document requires string content and format html or text');
  const maxWords = requireInteger(options.maxWords ?? 160, 'maxWords', 20, 2000);
  const minWords = requireInteger(options.minWords ?? 20, 'minWords', 1, maxWords);
  const contextWords = requireInteger(options.contextWords ?? 45, 'contextWords', 0, 500);
  const minDocumentWords = requireInteger(options.minDocumentWords ?? 30, 'minDocumentWords', 1, 10000);
  const maxContentChars = requireInteger(options.maxContentChars ?? 3_000_000, 'maxContentChars', 100, 20_000_000);
  const contract = sourceMetadata(document);
  const result = { contract, status: 'accepted', normalized_text: '', normalized_sha256: sha256(''), clauses: [], excluded: [], warnings: [] };
  const reject = (code, message) => {
    result.status = 'rejected';
    result.excluded.push({ reason: code.toLowerCase() });
    result.warnings.push({ code, message });
    return result;
  };
  const responseStatus = document.http_status ?? document.status_code;
  if (responseStatus !== undefined && (!Number.isInteger(responseStatus) || responseStatus < 200 || responseStatus >= 300)) return reject('HTTP_STATUS', `Source response status ${String(responseStatus)} is not a successful document response.`);
  if (document.content.length > maxContentChars) return reject('CONTENT_LIMIT', `Source exceeds the explicit ${maxContentChars} character extraction bound; no silent truncation was applied.`);
  if (!document.content.trim()) return reject('EMPTY_SOURCE', 'Source contained no text.');
  const replacementCount = (document.content.match(/\uFFFD/g) ?? []).length;
  const nulCount = (document.content.match(/\u0000/g) ?? []).length;
  if ((replacementCount >= 4 && replacementCount / document.content.length > 0.01) || nulCount / document.content.length > 0.002) return reject('ENCODING_FAILURE', 'Source contains substantial replacement or NUL characters; decoding needs review.');
  if (replacementCount) result.warnings.push({ code: 'ENCODING_REPLACEMENTS', message: `${replacementCount} Unicode replacement characters remain in the source; extraction does not repair unknown bytes.` });
  const collected = document.format === 'html' ? collectHtml(document.content) : { blocks: collectPlain(document.content), title: '', excluded: [], warnings: [] };
  result.excluded.push(...collected.excluded);
  result.warnings.push(...collected.warnings);
  let heading = '';
  let offset = 0;
  const blocks = collected.blocks.map((block) => {
    if (block.isHeading) heading = block.text;
    const indexed = { ...block, heading, start: offset, end: offset + block.text.length };
    offset = indexed.end + 2;
    return indexed;
  });
  result.normalized_text = blocks.map((block) => block.text).join('\n\n');
  result.normalized_sha256 = sha256(result.normalized_text);
  if (!result.normalized_text) return reject('EMPTY_EXTRACTION', 'Inert extraction produced no readable body text.');
  const totalWords = words(result.normalized_text);
  const openingStatus = /^(?:SEC(?:\.gov)?[ |:\-]*)?(?:access denied|request rate threshold exceeded|too many requests|temporarily unavailable|service unavailable|internal server error|page not found|security (?:block|check)|verify (?:that )?you are human|captcha)\b/i.test(result.normalized_text);
  const secStatus = /request rate threshold exceeded|your request originates from an undeclared automated tool|please declare your traffic by updating your user agent/i.test(result.normalized_text.slice(0, 1000));
  if (STATUS_PATTERN.test(collected.title) || (totalWords < 400 && (openingStatus || secStatus))) return reject('STATUS_PAGE', 'Source resembles an access, rate-limit, unavailable or verification page rather than a contract.');
  if (totalWords < minDocumentWords) return reject('INSUFFICIENT_CONTEXT', `Extracted ${totalWords} words; the minimum document context is ${minDocumentWords}.`);
  const contentBlocks = blocks.filter((block) => !block.isHeading);
  if (!contentBlocks.length) return reject('HEADINGS_ONLY', 'Extraction contains headings but no clause content.');
  const spans = [];
  for (let index = 0; index < contentBlocks.length; index += 1) {
    const block = contentBlocks[index];
    let end = block.end;
    let count = words(block.text);
    let combined = false;
    while (count < minWords && index + 1 < contentBlocks.length) {
      const next = contentBlocks[index + 1];
      const nextCount = words(next.text);
      if (next.heading !== block.heading || next.start - end !== 2 || count + nextCount > maxWords) break;
      end = next.end; count += nextCount; index += 1; combined = true;
    }
    spans.push({ start: block.start, end, heading: block.heading, reason: combined ? 'combined_short_blocks' : block.kind });
  }
  function contextBefore(start) {
    if (!contextWords) return '';
    const text = result.normalized_text.slice(0, start);
    const matches = wordMatches(text);
    return matches.length ? text.slice(matches[Math.max(0, matches.length - contextWords)].index).trim() : '';
  }
  function contextAfter(end) {
    if (!contextWords) return '';
    const text = result.normalized_text.slice(end);
    const matches = wordMatches(text);
    const last = matches[Math.min(matches.length, contextWords) - 1];
    return last ? text.slice(0, last.index + last[0].length).trim() : '';
  }
  for (const span of spans) {
    const text = result.normalized_text.slice(span.start, span.end);
    const matches = wordMatches(text);
    let cursor = 0;
    while (cursor < matches.length) {
      let limit = Math.min(cursor + maxWords, matches.length);
      const wasSplit = matches.length > maxWords;
      if (limit < matches.length) {
        // Prefer a sentence boundary within the latter half of the available span.
        for (let candidate = limit - 1; candidate >= cursor + Math.floor(maxWords * 0.55); candidate -= 1) {
          if (/[.;!?][”"')\]]?$/.test(matches[candidate][0])) { limit = candidate + 1; break; }
        }
      }
      const first = matches[cursor];
      const last = matches[limit - 1];
      const start = span.start + first.index;
      const end = span.start + last.index + last[0].length;
      const clauseText = result.normalized_text.slice(start, end);
      const digest = sha256(clauseText);
      result.clauses.push({
        id: `${contract.id}:clause:${start}-${end}:${digest.slice(0, 12)}`,
        contract_id: contract.id,
        source_url: contract.source_url,
        text: clauseText,
        heading: span.heading,
        context_before: contextBefore(start),
        context_after: contextAfter(end),
        start,
        end,
        sha256: digest,
        segmentation: { reason: wasSplit ? 'max_words_split' : limit - cursor < minWords ? 'below_minimum_retained' : span.reason, word_count: limit - cursor, source_block_reason: span.reason },
      });
      cursor = limit;
    }
  }
  const shortCount = result.clauses.filter((clause) => clause.segmentation.word_count < minWords).length;
  if (shortCount) result.warnings.push({ code: 'SHORT_CLAUSES_RETAINED', message: `${shortCount} clauses below the ${minWords}-word target were retained with context and segmentation reasons.` });
  const splitCount = result.clauses.filter((clause) => clause.segmentation.reason === 'max_words_split').length;
  if (splitCount) result.warnings.push({ code: 'LONG_BLOCKS_SPLIT', message: `${splitCount} bounded clause chunks were produced from long semantic blocks; use offsets and context to inspect their boundaries.` });
  return result;
}

function sourceReference(record) {
  return { id: record.id ?? record.contract?.id, contract_id: record.contract_id ?? record.contract?.id, source_url: record.source_url ?? record.contract?.source_url ?? '' };
}

function materialSignature(text) {
  return {
    numbers: (text.match(/(?:[$€£]\s*)?\d[\d,]*(?:\.\d+)?%?/gu) ?? []).map((value) => value.replace(/[\s,]/gu, '')),
    critical: tokenize(text).filter((value) => CRITICAL_WORDS.has(value) || /^[<>≤≥]$/u.test(value)),
  };
}

function shingles(tokens, size) {
  const result = new Set();
  for (let index = 0; index + size <= tokens.length; index += 1) result.add(tokens.slice(index, index + size).join('\u001F'));
  return result;
}

function differingTokens(left, right) {
  const leftSet = new Set(tokenize(left));
  const rightSet = new Set(tokenize(right));
  return { left_only: [...leftSet].filter((value) => !rightSet.has(value)).slice(0, 16), right_only: [...rightSet].filter((value) => !leftSet.has(value)).slice(0, 16) };
}

function deduplicate(records, textFor, options) {
  if (!Array.isArray(records)) throw new TypeError('deduplication requires an array of records');
  const threshold = options.threshold ?? 0.94;
  if (!Number.isFinite(threshold) || threshold < 0.8 || threshold > 1) throw new TypeError('threshold must be between 0.8 and 1');
  const shingleSize = requireInteger(options.shingleSize ?? 4, 'shingleSize', 2, 8);
  const minNearWords = requireInteger(options.minNearWords ?? 30, 'minNearWords', 12, 10000);
  const seenIds = new Set();
  const canonicalGroups = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const reference = sourceReference(record);
    const id = reference.id;
    if (typeof id !== 'string' || !id || seenIds.has(id)) throw new TypeError('deduplication record IDs must be distinct nonempty strings');
    seenIds.add(id);
    const raw = textFor(record);
    if (typeof raw !== 'string' || !raw.trim()) throw new TypeError(`Record ${id} has no nonempty extracted text`);
    const text = normalizeText(raw);
    const digest = sha256(text);
    if (!canonicalGroups.has(digest)) canonicalGroups.set(digest, { digest, text, indexes: [] });
    canonicalGroups.get(digest).indexes.push(index);
  }
  const groups = [...canonicalGroups.values()].map((group) => {
    group.indexes.sort((left, right) => sourceReference(records[left]).id.localeCompare(sourceReference(records[right]).id, 'en'));
    const representative = sourceReference(records[group.indexes[0]]);
    const tokens = tokenize(group.text);
    return { ...group, representative, tokens, shingles: tokens.length >= minNearWords ? shingles(tokens, shingleSize) : new Set(), signature: materialSignature(group.text) };
  }).sort((left, right) => left.representative.id.localeCompare(right.representative.id, 'en'));
  const exact_groups = groups.filter((group) => group.indexes.length > 1).map((group) => ({ id: `exact-${group.digest}`, normalized_sha256: group.digest, representative_id: group.representative.id, members: group.indexes.map((index) => sourceReference(records[index]).id), sources: group.indexes.map((index) => sourceReference(records[index])) }));
  // Inverted shingles avoid comparing every unrelated pair in larger pilot samples.
  const inverted = new Map();
  const near_matches = [];
  const acceptedScores = new Map();
  const pairKey = (left, right) => `${Math.min(left, right)}:${Math.max(left, right)}`;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const counts = new Map();
    for (const shingle of group.shingles) {
      for (const previous of inverted.get(shingle) ?? []) counts.set(previous, (counts.get(previous) ?? 0) + 1);
    }
    for (const [previous, overlap] of counts) {
      const other = groups[previous];
      const score = overlap / (group.shingles.size + other.shingles.size - overlap);
      if (score < threshold) continue;
      const numberMismatch = JSON.stringify(group.signature.numbers) !== JSON.stringify(other.signature.numbers);
      const criticalMismatch = JSON.stringify(group.signature.critical) !== JSON.stringify(other.signature.critical);
      const accepted = !numberMismatch && !criticalMismatch;
      const match = { left_id: other.representative.id, right_id: group.representative.id, score, metric: `${shingleSize}-token-shingle-jaccard`, accepted, reason: numberMismatch ? 'numeric_difference_retained' : criticalMismatch ? 'negation_or_modal_difference_retained' : 'conservative_similarity_candidate', left_sources: other.indexes.map((sourceIndex) => sourceReference(records[sourceIndex])), right_sources: group.indexes.map((sourceIndex) => sourceReference(records[sourceIndex])), differences: differingTokens(other.text, group.text), family_joined: false };
      near_matches.push(match);
      if (accepted) acceptedScores.set(pairKey(previous, index), { score, match });
    }
    for (const shingle of group.shingles) {
      if (!inverted.has(shingle)) inverted.set(shingle, []);
      inverted.get(shingle).push(index);
    }
  }
  const clusters = groups.map((_, index) => [index]);
  const clusterOf = groups.map((_, index) => index);
  const edges = [...acceptedScores.entries()].sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0], 'en'));
  for (const [key] of edges) {
    const [left, right] = key.split(':').map(Number);
    const leftCluster = clusterOf[left];
    const rightCluster = clusterOf[right];
    if (leftCluster === rightCluster) continue;
    // A-B and B-C similarity alone must not silently make A and C duplicates.
    if (!clusters[leftCluster].every((a) => clusters[rightCluster].every((b) => acceptedScores.has(pairKey(a, b))))) continue;
    clusters[leftCluster].push(...clusters[rightCluster]);
    for (const member of clusters[rightCluster]) clusterOf[member] = leftCluster;
    clusters[rightCluster] = [];
  }
  for (const [key, value] of acceptedScores) {
    const [left, right] = key.split(':').map(Number);
    value.match.family_joined = clusterOf[left] === clusterOf[right];
    if (!value.match.family_joined) value.match.reason = 'complete_link_guard_kept_separate';
  }
  const enriched = new Array(records.length);
  const families = [];
  const representatives = [];
  for (const cluster of clusters.filter((value) => value.length)) {
    const indexes = cluster.flatMap((index) => groups[index].indexes).sort((left, right) => sourceReference(records[left]).id.localeCompare(sourceReference(records[right]).id, 'en'));
    const representativeIndex = indexes[0];
    const representativeId = sourceReference(records[representativeIndex]).id;
    const representativeDigest = sha256(normalizeText(textFor(records[representativeIndex])));
    const familyId = `family-${sha256(cluster.map((index) => groups[index].digest).sort().join('\n')).slice(0, 24)}`;
    const kind = cluster.length > 1 ? 'near' : indexes.length > 1 ? 'exact' : 'unique';
    families.push({ id: familyId, kind, representative_id: representativeId, members: indexes.map((index) => sourceReference(records[index]).id), sources: indexes.map((index) => sourceReference(records[index])), normalized_digests: cluster.map((index) => groups[index].digest).sort() });
    for (const index of indexes) {
      enriched[index] = { ...records[index], family_id: familyId, family_representative_id: representativeId, duplicate_kind: index === representativeIndex ? 'unique' : sha256(normalizeText(textFor(records[index]))) === representativeDigest ? 'exact' : 'near' };
    }
    representatives.push(enriched[representativeIndex]);
  }
  return { records: enriched, representatives, families, exact_groups, near_matches, parameters: { threshold, shingleSize, minNearWords, exact_normalization: 'NFC; remove zero-width/control characters; collapse whitespace; preserve case', family_rule: 'complete-link similarity with identical numeric and critical-token signatures' }, stats: { input_count: records.length, family_count: families.length, exact_duplicate_count: groups.reduce((total, group) => total + group.indexes.length - 1, 0), near_duplicate_count: groups.length - families.length, rejected_near_match_count: near_matches.filter((match) => !match.accepted).length }, limitations: ['Similarity is an auditable repetition hypothesis, not equivalence of legal meaning.', 'All source records and near-match variants remain retained.', 'Near matches with changed amounts, dates, negations or listed legal modals stay in separate families; unlisted semantic differences can remain.', 'Source offsets refer to normalized JavaScript strings, not source bytes.'] };
}

export function deduplicateContracts(contracts, options = {}) {
  return deduplicate(contracts, (contract) => contract.normalized_text, options);
}

export function deduplicateClauses(clauses, options = {}) {
  return deduplicate(clauses, (clause) => clause.text, options);
}

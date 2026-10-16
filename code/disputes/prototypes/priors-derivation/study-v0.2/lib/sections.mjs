// SPDX-License-Identifier: AGPL-3.0-only
// Study v0.2: inert, section-preserving representation and auditable selection.
import { createHash } from 'node:crypto';
import { parse, Parser } from 'parse5';
import { traceNativeDecoration, bindNativeDecoration, unresolvedNativeDecoration, NATIVE_DECORATION_POLICY } from './source-decoration.mjs';

const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const normalize = (value) => value.normalize('NFC').replace(/[\u200B\uFEFF]/gu, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '').replace(/\s+/gu, ' ').trim();
export const NATIVE_COLLECTOR_POLICY = 'EXTRACTOR_EMITTED_ORIGIN_ROPES_V3';
export const HTML_BODY_POLICY = 'ALL_VISIBLE_ITERATIVE_DOM_TAPE_BOUNDED_RECONSTRUCTION_V1';
const ORIGIN = Symbol('private emitted collector origin');
const originRope = (text = '', pieces = text ? [{ text, synthetic: true }] : []) => ({ text, pieces });
const syntheticOrigin = (text) => originRope(text);
function joinOrigins(values, separator = '') {
  const pieces = []; const texts = [];
  for (const [index, rope] of values.entries()) {
    if (index && separator) { pieces.push({ text: separator, synthetic: true }); texts.push(separator); }
    texts.push(rope.text); for (const piece of rope.pieces) pieces.push(piece);
  }
  return originRope(texts.join(''), pieces);
}
function originContext(trace) {
  const issues = [], runs = new Map(), duplicate = new Set();
  for (const run of trace?.runs ?? []) { if (runs.has(run.id)) duplicate.add(run.id); runs.set(run.id, run); }
  const issue = (code, component) => { component = ({ trace: 'tracer', bind: 'collector', table: 'collector' })[component] ?? component; if (issues.length < 1000 && !issues.some(item => item.code === code && item.component === component)) issues.push({ code, ...(component ? { component } : {}) }); };
  const rawRun = (start, end, text) => {
    const id = `run:${start}-${end}`, run = runs.get(id);
    if (!run || duplicate.has(id) || run.decoded_text !== text || run.decoded_sha256 !== hash(text)) { issue('TEXT_NODE_ORIGIN_UNRESOLVED'); return originRope(text, [{ text, unknown: true }]); }
    return originRope(text, text ? [{ text, sources: [{ run_id: id, decoded_start: 0, decoded_end: text.length }], normalization: 'EXACT_DECODED' }] : []);
  };
  const node = value => rawRun(value.sourceCodeLocation?.startOffset, value.sourceCodeLocation?.endOffset, value.value);
  const hasFilteredOrigins = sources => sources.some(part => /[\u200B\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(runs.get(part.run_id)?.decoded_text.slice(part.decoded_start, part.decoded_end) ?? ''));
  const independentlyEmptyOrigins = sources => sources.every(part => { const run = runs.get(part.run_id); return run && normalize(run.decoded_text.slice(part.decoded_start, part.decoded_end)) === ''; });
  return { issues, issue, node, rawRun, hasFilteredOrigins, independentlyEmptyOrigins };
}
function indexedOrigin(rope) {
  let offset = 0;
  const entries = rope.pieces.map(piece => { const start = offset; offset += piece.text.length; return { piece, start, end: offset }; });
  return { entries, starts: entries.map(item => item.start), ends: entries.map(item => item.end), length: offset };
}
function sliceOrigins(rope, start, end, context, indexed = indexedOrigin(rope), includeEnd = end === rope.text.length) {
  const pieces = []; let first = lowerBound(indexed.ends, start);
  while (first && indexed.entries[first - 1].end === start) first -= 1;
  for (let index = first; index < indexed.entries.length; index += 1) {
    const item = indexed.entries[index];
    if (item.start > end || item.start === end && !includeEnd) break;
    if (item.start === item.end) { if (item.start >= start && (item.start < end || includeEnd && item.start === end)) pieces.push(item.piece); continue; }
    const low = Math.max(start, item.start), high = Math.min(end, item.end); if (low >= high) continue;
    const piece = item.piece;
    if (low === item.start && high === item.end) { pieces.push(piece); continue; }
    const text = piece.text.slice(low - item.start, high - item.start);
    if (piece.synthetic || piece.unknown) { pieces.push({ ...piece, text }); continue; }
    if (piece.normalization !== 'EXACT_DECODED' || piece.sources.length !== 1) { context.issue('TRANSFORMED_ORIGIN_PARTIAL_SPLIT'); pieces.push({ text, unknown: true }); continue; }
    const source = piece.sources[0]; pieces.push({ text, sources: [{ ...source, decoded_start: source.decoded_start + low - item.start, decoded_end: source.decoded_start + high - item.start }], normalization: 'EXACT_DECODED' });
  }
  return originRope(rope.text.slice(start, end), pieces);
}
function rewriteOrigins(rope, changes, context) {
  if (!changes.length) return rope;
  const indexed = indexedOrigin(rope), values = []; let cursor = 0;
  for (const change of changes) {
    values.push(sliceOrigins(rope, cursor, change.start, context, indexed, false));
    const prior = sliceOrigins(rope, change.start, change.end, context, indexed, false), sources = prior.pieces.flatMap(piece => piece.sources ?? []);
    const unknown = prior.pieces.some(piece => piece.unknown);
    if (!change.text) {
      const removed = [];
      for (const piece of prior.pieces) {
        // A trimmed joint group has no output character to allocate. Separate
        // its original ordered parts only when EACH is independently empty
        // under the exact frozen normalizer; differing ancestry is retained.
        if (piece.sources?.length > 1 && context.independentlyEmptyOrigins(piece.sources)) {
          for (const source of piece.sources) removed.push({ text: '', sources: [source], normalization: 'EXTRACTOR_NFC_FILTER_WHITESPACE_V1' });
        } else removed.push({ ...piece, text: '', ...(piece.sources ? { normalization: piece.text ? change.normalization : piece.normalization } : {}) });
      }
      values.push(originRope('', removed));
    }
    else {
      // A removed source origin can lie INSIDE a later whitespace collapse.
      // Preserve its original place in the joint evidence; moving it to an
      // ordinary before/after zero segment would reorder the DOM origins.
      const normalization = change.normalization === 'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1' && context.hasFilteredOrigins(sources)
        ? 'EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1' : change.normalization;
      values.push(originRope(change.text, [{ text: change.text, ...(unknown ? { unknown: true } : sources.length ? { sources, normalization } : { synthetic: true }) }]));
    }
    cursor = change.end;
  }
  values.push(sliceOrigins(rope, cursor, rope.text.length, context, indexed, true));
  return joinOrigins(values);
}
function normalizeOrigins(rope, expected, context) {
  if (!rope || rope.pieces.map(piece => piece.text).join('') !== rope.text) { context.issue('COLLECTOR_ROPE_INPUT_MISMATCH'); return originRope(expected, [{ text: expected, unknown: true }]); }
  let result = rope;
  if (result.text.normalize('NFC') !== result.text) {
    const changes = [];
    for (const item of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(result.text)) {
      const text = item.segment.normalize('NFC');
      if (text !== item.segment) changes.push({ start: item.index, end: item.index + item.segment.length, text, normalization: 'EXTRACTOR_NFC_FILTER_WHITESPACE_V1' });
    }
    result = rewriteOrigins(result, changes, context);
  }
  result = rewriteOrigins(result, [...result.text.matchAll(/[\u200B\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/gu)].map(match => ({ start: match.index, end: match.index + match[0].length, text: '', normalization: 'EXTRACTOR_NFC_FILTER_WHITESPACE_V1' })), context);
  const changes = [];
  for (const match of result.text.matchAll(/\s+/gu)) {
    const text = match.index === 0 || match.index + match[0].length === result.text.length ? '' : ' ';
    if (text !== match[0]) changes.push({ start: match.index, end: match.index + match[0].length, text, normalization: text ? 'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1' : 'EXTRACTOR_NFC_FILTER_WHITESPACE_V1' });
  }
  result = rewriteOrigins(result, changes, context);
  if (result.text !== expected) { context.issue('COLLECTOR_NORMALIZATION_MISMATCH'); return originRope(expected, [{ text: expected, unknown: true }]); }
  return result;
}
function emptyOrigins(rope, context) {
  return normalizeOrigins(rope, '', context);
}
function originSegments(blocks, context) {
  const segments = [];
  for (const block of blocks) {
    const rope = block[ORIGIN];
    if (!rope || rope.text !== block.text) { context.issue('EMITTED_BLOCK_ORIGIN_UNRESOLVED'); continue; }
    let offset = block.start;
    for (const piece of rope.pieces) {
      if (piece.unknown) context.issue('EMITTED_PIECE_ORIGIN_UNRESOLVED');
      if (piece.sources?.length) segments.push({ normalized_start: offset, normalized_end: offset + piece.text.length, sources: piece.sources, normalization: piece.normalization });
      else if (piece.synthetic && /[^\s|]/u.test(piece.text)) context.issue('NONSEPARATOR_SYNTHETIC_COLLECTOR_TEXT');
      offset += piece.text.length;
    }
    if (offset !== block.end) context.issue('COLLECTOR_BLOCK_OFFSET_MISMATCH');
  }
  return segments;
}
function nativeFailureCode(component, error) {
  if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/u.test(error.code)) return error.code;
  const message = String(error?.message ?? '');
  const known = [
    [/depth/iu, 'DEPTH_LIMIT'], [/node bound/iu, 'NODE_LIMIT'], [/raw bound|source exceeds/iu, 'RAW_LIMIT'],
    [/legacy|format/iu, 'SOURCE_PROFILE'], [/source origin reused|source origin.*order|ranges overlap/iu, 'ORIGIN_REUSE_OR_ORDER'],
    [/splits a codepoint/iu, 'CODEPOINT_BOUNDARY'], [/differs from exact normalized|origin differs/iu, 'NORMALIZED_LITERAL_MISMATCH'],
    [/identity|tracer identity|collector identity/iu, 'SOURCE_IDENTITY'], [/binding differs|digest differs/iu, 'SOURCE_DIGEST_BINDING'],
  ];
  return `NATIVE_${component.toUpperCase()}_${known.find(([pattern]) => pattern.test(message))?.[1] ?? 'IMPLEMENTATION_FAILURE'}`;
}
const BLOCKS = new Set(['address', 'article', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'li', 'main', 'nav', 'ol', 'p', 'section', 'ul']);
const OMIT = new Set(['head', 'script', 'style', 'template', 'noscript', 'svg', 'canvas', 'iframe', 'object', 'embed']);
const ASSERTION = /\b(?:shall|must|may|will|can|could|should|would|does|do|agrees?|means?|entitled|obligated|is|are|has|have|required|except|unless|provided|notwithstanding|subject to)\b/i;
const SUBJECT_PREDICATE = /\b(?:each|any|the|neither|either|every|this|that)\b.*\b(?:represents?|warrants?|undertakes?|covenants?)\b/iu;
const OPERATIVE = /\b(?:shall|must|will|agrees?|covenants?|warrant\w*|obligations?|required|notify|notices? (?:shall|must|will|are|to)|deliver|pay|responsib\w*|permitted|provided|except|unless|subject to|may|rights|duties|instructions|liabil\w*|rent|quantity|replace|inventory|receipt|minimum|maximum)\b/i;
const FUNCTIONS = [
  ['performance', /\b(?:perform\w*|services?|workmanship|quality|standards?|specifications?|deliver\w*|acceptance|warrant\w*)\b/i],
  ['payment_cost', /\b(?:pay\w*|fees?|costs?|expenses?|invoices?|compensation|reimburse\w*|rent|prices?)\b/i],
  ['scope_change', /\b(?:scope|amend\w*|chang\w*|modif\w*|authoriz\w*|consent|approval|assign\w*)\b/i],
  ['notice_response', /\b(?:notices?|notify|notification|cure|correct\w*|respond\w*|response|communicat\w*|disput\w*)\b/i],
  ['termination_transition', /\b(?:terminat\w*|expir\w*|transition|wind.?down|cancel\w*|return\w*)\b/i],
  ['risk_control', /\b(?:risk|liab\w*|indemn\w*|neglig\w*|force majeure|control|mitigat\w*|damages?|loss\w*)\b/i],
  ['information_records', /\b(?:information|confidential\w*|privacy|records?|data|reports?|audit\w*|inspect\w*|documents?)\b/i],
  ['general_terms', /\b(?:interpret\w*|constru\w*|governing|severab\w*|counterparts?|entire agreement|definitions?)\b/i],
  ['inventory_schedule', /\b(?:inventory|schedule|quantit\w*|items?|materials?|equipment|components?|dates?|rooms?|units?)\b/i],
];

function integer(value, name, low, high) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new TypeError(`${name} must be an integer in ${low}..${high}`);
  return value;
}

const LAYOUT_LABEL = /^(?:CONFIDENTIAL(?:\s+TREATMENT\s+REQUESTED)?|EXECUTION COPY|BOEING PROPRIETARY|(?:PAGE\s+)?\d+(?:\s+OF\s+\d+)?|\[?REMAINDER OF PAGE INTENTIONALLY LEFT BLANK\]?)$/iu;
const COUNTRY_CONTACT_LABEL = /^(?:USA|US|U\.S\.(?:A\.)?|UNITED STATES(?: OF AMERICA)?|UK|U\.K\.|UNITED KINGDOM|SWITZERLAND|GERMANY|FRANCE|CANADA|AUSTRALIA|CHINA|JAPAN|INDIA|SINGAPORE|HONG KONG)$/iu;
const CONTACT_LINE = /^(?:\d+\s+.*\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?|way|floor|suite|building|parkway|crescent)\b|(?:facsimile|fax|telephone|tel|attention|email|e-mail|swift|aba|account)\s*:)/iu;
const CONTACT_DELIVERY = /^(?:via|by)\b.*\b(?:mail|fax|facsimile|courier)\b/iu;
const SECTION_TITLE_CUE = /\b(?:definitions?|interpretation|governance|services?|performance|notices?|payment|fees?|expenses?|costs?|liability|indemnification|warranties|representations|covenants|termination|force majeure|confidentiality|scope|law|jurisdiction|arbitration|rights|obligations?|duties|records|disputes?|amendments?|assignment)\b/iu;
const OPENING_FORMULA = /^(?:KNOW ALL MEN BY THESE PRESENTS|NOW[ ,]+THEREFORE|WHEREAS\b|IN WITNESS WHEREOF|W\s*I\s*T\s*N\s*E\s*S\s*S\s*E?\s*T\s*H\s*:)/iu;
const ENTITY_TITLE = /\b(?:inc\.?|llc|ltd\.?|corp\.?|corporation|limited|gmbh|partners|investments|investors|advisors|insurance company)\b/iu;
const COUNTRIES = /\b(?:UNITED KINGDOM|UNITED STATES(?: OF AMERICA)?|UNITED ARAB EMIRATES|HONG KONG|CAYMAN ISLANDS|USA|UAE|UK|SWITZERLAND|GERMANY|FRANCE|CANADA|AUSTRALIA|CHINA|JAPAN|INDIA|SINGAPORE|ARGENTINA|BRAZIL|KAZAKHSTAN|RUSSIA)\b/giu;
const countryLabel = (text) => COUNTRY_CONTACT_LABEL.test(text) || text.replace(COUNTRIES, '').replace(/[\s,;|/.-]/gu, '') === '';
const assertion = (text) => ASSERTION.test(text) || SUBJECT_PREDICATE.test(text);
const looksTitle = (text) => text.length <= 180 && text.split(/\s+/u).length <= 20 && !assertion(text) && !OPENING_FORMULA.test(text) && !countryLabel(text) && !CONTACT_LINE.test(text) && !CONTACT_DELIVERY.test(text);

function numberedPrefix(text) {
  const match = text.match(/^(?:(Section|SECTION|section|ARTICLE|Article)\s+)?(\d+(?:\.\d+)*)([.)])?\s+(?:\|\s*)?([\p{Lu}\p{Lo}].*)$/u);
  if (!match || CONTACT_LINE.test(text)) return null;
  // An unpunctuated integer is not sufficient evidence of a section number:
  // addresses, amounts and footnotes commonly have that form. A short all-cap
  // title or an explicit Section/Article marker provides additional structure.
  if (!match[1] && !match[3] && !match[2].includes('.') && (!/^[\p{Lu}\p{N}\s.,:()\-/&'’®™]+$/u.test(match[4]) || !SECTION_TITLE_CUE.test(match[4]))) return null;
  return { number: match[2], depth: match[2].split('.').length, marker: match[1], title: match[4], title_start: text.length - match[4].length };
}

const CAPITAL_TITLE = /^[\p{Lu}\p{N}\s.,:;()\-/&'’®™]+$/u;
const QUOTE_INTRODUCTION = /\b(?:legend|following|form|quoted?|quotation|reads?|statement|set forth below)\b/iu;
const standaloneMarker = (text) => /^(?:(?:ARTICLE|Article|CHAPTER|Chapter)\s+[IVXLC\d]+|(?:EXHIBIT|Exhibit|SCHEDULE|Schedule|APPENDIX|Appendix|ANNEX|Annex|ATTACHMENT|Attachment)\s+[\p{L}\d]+)[.:]?$/u.test(text);
const TITLE_CONNECTIVES = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'per', 'the', 'to', 'under', 'upon', 'with', 'without']);
function captionForm(text) {
  if (/\b(?:and|or|provided|unless|except|that|which|by|for|from|in|of|on|the|to|with)\s*[.:]?$/iu.test(text)) return false;
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-/]*/gu) ?? [];
  const content = words.filter((word) => !TITLE_CONNECTIVES.has(word.toLocaleLowerCase('en-US')));
  return content.length > 0 && content.every((word) => /^[\p{Lu}\p{N}]/u.test(word));
}
const boundedCaptionForm = (text) => text.length <= 180 && text.split(/\s+/u).length <= 20 && captionForm(text);
const attachmentPrefix = (text) => text.match(/^((?:EXHIBIT|Exhibit|SCHEDULE|Schedule|APPENDIX|Appendix|ANNEX|Annex|ATTACHMENT|Attachment)\s+[\p{L}\d]+(?:[.\d-]*)?)\b([\s\S]*)$/u);
function attachmentCaption(text) {
  const match = attachmentPrefix(text);
  if (!match) return null;
  const suffix = match[2].replace(/^\s*[.:\-–—]\s*/u, '').trim();
  // An attachment reference can begin an ordinary wrapped sentence. The
  // marker alone, or a literal caption-form suffix, is positive evidence;
  // starting with the word Schedule/Annex/etc. is not sufficient evidence.
  // Keep parenthetical definitions, comma-linked restrictions and unfinished
  // body clauses literal without inventing an attachment boundary.
  if (suffix && (!/^(?:[\p{Lu}\p{N}]|\(|\[)/u.test(suffix) || /[;,]/u.test(suffix) || !captionForm(suffix) || assertion(suffix) || /[.!?]$/u.test(suffix))) return null;
  return { level: 1, kind: 'attachment_heading', section_boundary: true, verified: false, confidence: 'literal_attachment_marker_and_caption_form', attachment_evidence: suffix ? 'MARKER_WITH_CAPTION_FORM_SUFFIX' : 'STANDALONE_MARKER' };
}
const UNFINISHED_CONNECTOR = /\b(?:(?:provided|except)(?:\s*,?\s*however)?|unless|if|because|although|though|while|whether|until|when|where|that|however|and|or|but|of|to|from|for|with|without|under|upon|into|in|on|at|by|as|than|the|a|an|such|any|all|both|each|every|either|neither)\s*,?\s*$/iu;
const sentenceClosed = (text) => /[.!?;:]\s*[”"')\]]*\s*$/u.test(text);
const BODY_PREDICATE = /\b(?:grants?|licenses?|refers?|incorporates?|described|identified|specified|listed|set forth)\b/iu;
const unfinishedProse = (block) => Boolean(block && !block.heading && !sentenceClosed(block.text) && (assertion(block.text) || BODY_PREDICATE.test(block.text)) && (UNFINISHED_CONNECTOR.test(block.text) || attachmentPrefix(block.text)));
const enumeration = (text) => /^(?:\d+(?:\.\d+)*[.)]?|\([a-zA-Z\d]+\)|[a-zA-Z][.)])\s+(?:\|\s*)?\S/u.test(text);
const enumerationScheme = (text) => /^\(?\d/u.test(text) ? { kind: 'numeric', depth: (text.match(/^\d+(?:\.\d+)*/u)?.[0] ?? '').split('.').length } : { kind: 'letter', depth: 0 };
const enumeratedBlock = (block, level) => Boolean(block && (enumeration(block.text) || block.source_list_item || block.kind === 'enumerated_paragraph' || block.heading?.kind === 'explicit_heading' && numberedPrefix(block.text) && block.heading.html_level > level));
function nextListItem(blocks, start, level) {
  let index = start;
  while (blocks[index] && (['layout_label', 'contact_label', 'repeated_document_title'].includes(blocks[index].kind) || CONTACT_LINE.test(blocks[index].text))) index += 1;
  return !blocks[index]?.source_continuation && !blocks[index]?.quote_context && enumeratedBlock(blocks[index], level) ? blocks[index] : null;
}

const ATTACHMENT_LIST_SUBJECT = /\b(?:exhibits?|schedules?|appendix|appendices|annex(?:es)?|attachments?|riders?|documents?)\b/iu;
const ATTACHMENT_LIST_FORWARD_CUE = /\b(?:following|as follows|(?:listed|specified|identified|described|set forth)\s+(?:below|herein|hereunder)|incorporat\w*\s+(?:[\s\S]*?\s+)?by reference)\b/iu;
function attachmentReferenceCaption(block) {
  return Boolean(block && !block.source_continuation && !block.quote_context && attachmentPrefix(block.text) && !assertion(block.text) && boundedCaptionForm(block.text));
}
function nextAttachmentReference(blocks, start) {
  let index = start;
  // Retain narrow page/layout labels, but do not skip arbitrary contact text,
  // opening formulas or a new document title to manufacture adjacency.
  while (blocks[index] && LAYOUT_LABEL.test(blocks[index].text)) index += 1;
  return attachmentReferenceCaption(blocks[index]) ? blocks[index] : null;
}
function attachmentReferenceIntroduction(block) {
  return /:\s*$/u.test(block.text) && !block.source_continuation && !block.quote_context && ATTACHMENT_LIST_SUBJECT.test(block.text) && ATTACHMENT_LIST_FORWARD_CUE.test(block.text);
}
function attachmentReferenceFrameFence(block, frame) {
  if (!block.heading || block.source_continuation || block.quote_context || block.source_list_item || block.source_table_scope || block.delimiter_scope) return false;
  // A deeper native heading can belong to a listed exhibit/rider. Where the
  // source actually supplies levels, retain that local heading and its body
  // rather than treat its Section label as return to the surrounding text.
  if (Number.isSafeInteger(frame.native_scope_level) && Number.isSafeInteger(block.heading.html_level) && block.heading.html_level > frame.native_scope_level) return false;
  // A listed attachment caption is a reference, not proof that its body starts
  // here. Native presentation alone likewise cannot close this dependency.
  // Ambiguous later attachments remain in a broader, explicitly unverified
  // span; typed source Article/Section boundaries supply the positive fence.
  return (inferredHeading(block.text)?.kind ?? block.heading.kind) === 'article_heading' || Boolean(numberedPrefix(block.text)?.marker);
}

const SOURCE_TABLE_KIND = new Set(['table_caption', 'table_header', 'table_row', 'table_unstructured', 'table_sgml_text']);
function nextSourceTable(blocks, start) {
  let index = start;
  while (blocks[index] && (['layout_label', 'contact_label', 'repeated_document_title'].includes(blocks[index].kind) || CONTACT_LINE.test(blocks[index].text))) index += 1;
  const first = blocks[index];
  if (first?.source_table_start && !first.source_continuation && !first.quote_context) return { first, table: first, evidence: 'EXPLICIT_SOURCE_TABLE_START_WITH_LAYOUT_TEXT' };
  // Caption rows and actual source captions may stand between a colon and the
  // table it introduces. They supply layout evidence, never column semantics.
  while (blocks[index] && !SOURCE_TABLE_KIND.has(blocks[index].kind) && !blocks[index].source_table_start) {
    const block = blocks[index];
    const inferred = inferredHeading(block.text);
    if (!block.heading || !looksTitle(block.text) || numberedPrefix(block.text) || ['article_heading', 'attachment_heading', 'document_title', 'letter_subject'].includes(inferred?.kind)) return null;
    index += 1;
    while (blocks[index] && ['layout_label', 'contact_label'].includes(blocks[index].kind)) index += 1;
  }
  const table = blocks[index];
  if (!table || table.source_continuation || table.quote_context) return null;
  return { first, table, evidence: first === table ? 'DIRECT_SOURCE_TABLE' : 'SOURCE_CAPTIONS_FOLLOWED_BY_TABLE' };
}

function tableFrameFence(block, frame) {
  if (!block.heading || SOURCE_TABLE_KIND.has(block.kind) || block.source_table_scope || block.delimiter_scope || block.source_list_item) return false;
  const inferred = inferredHeading(block.text);
  if (['article_heading', 'attachment_heading', 'document_title', 'letter_subject'].includes(inferred?.kind ?? block.heading.kind)) return true;
  const prefix = numberedPrefix(block.text);
  // A caption-like numbered footnote is not a new section merely because it
  // has the same inferred level. Typed markers or outside-table native level
  // provide additional source evidence; all other numbering stays ambiguous.
  return Boolean(prefix && (prefix.marker || Number.isSafeInteger(block.heading.html_level) && block.heading.html_level <= frame.level));
}

function letteredPrefix(text) {
  // A letter and a literal short caption ending in punctuation are stronger
  // evidence than a bare enumeration. These are retained subheadings, not
  // independent parents that could detach qualifications from their governor.
  const match = text.match(/^([a-z][.)])\s+([\p{Lu}][^.!?:;]{1,100}[.:])(?:\s+([\s\S]+))?$/u);
  if (!match || !looksTitle(match[2])) return null;
  return { title: `${match[1]} ${match[2]}`, body: match[3] ?? '' };
}

function inferredHeading(text, { structural = false, markerCaption = false } = {}) {
  if (!text || !looksTitle(text) || LAYOUT_LABEL.test(text) || /\.{3,}|\.{2,}\s*\d+$/u.test(text)) return null;
  const article = text.match(/^(?:ARTICLE|Article|CHAPTER|Chapter)\s+([IVXLC\d]+)(?:\b|[.:-])/u);
  if (article) return { level: 1, kind: 'article_heading', section_boundary: true, verified: false, confidence: 'heuristic_structure' };
  const attachment = attachmentCaption(text);
  if (attachment) return attachment;
  if (attachmentPrefix(text)) return null;
  if (/^(?:Re|RE|Subject|SUBJECT)\s*:/u.test(text)) return { level: 2, kind: 'letter_subject', verified: false, confidence: 'literal_source_subject' };
  const numbered = numberedPrefix(text);
  // Numbered non-cased-script prose needs actual source caption evidence.
  // A Chinese sentence beginning 8.1 is not a title merely because English
  // modal-word rules cannot recognize its operative language.
  if (numbered && /^\p{Lo}/u.test(numbered.title) && (!structural || /[。！？；]$/u.test(numbered.title) || numbered.title.length > 80)) return null;
  // Numbering an imperative does not turn it into a caption. Unmarked prose
  // needs actual caption form; otherwise retain its wrapped sentence whole.
  if (numbered && !numbered.marker && !/^\p{Lo}/u.test(numbered.title) && !captionForm(numbered.title)) return null;
  if (numbered && ENTITY_TITLE.test(numbered.title) && !SECTION_TITLE_CUE.test(numbered.title)) return null;
  if (numbered && !/[;!?]$/.test(text)) return { level: Math.min(6, Math.max(2, numbered.depth + 1)), kind: 'numbered_heading', section_boundary: numbered.depth <= 2, verified: false, confidence: 'heuristic_structure', label: text.replace(/\s*\|\s*/gu, ' ') };
  if (/\b(?:contract|agreement|bill of sale|deed|memorandum of understanding)\s*$/iu.test(text) && /\p{Lu}/u.test(text) && !ENTITY_TITLE.test(text)) return { level: 2, kind: 'document_title', verified: false, confidence: 'literal_document_title_heuristic' };
  const lettered = letteredPrefix(text);
  if (lettered && !lettered.body) return { level: 3, kind: 'lettered_subheading', section_boundary: false, verified: false, confidence: 'literal_letter_and_punctuated_caption' };
  // Capitalization alone does not establish a boundary. In particular, a last
  // wrapped word with a period is often part of a quoted operative provision.
  if ((structural || markerCaption) && (CAPITAL_TITLE.test(text) || captionForm(text)) && /\p{Lu}/u.test(text) && !/[.;!?]$/.test(text)) return { level: 2, kind: 'caption_heading', verified: false, confidence: markerCaption ? 'literal_marker_followed_by_caption' : 'source_layout_and_capitalized_caption' };
  return null;
}

function inlineTitle(text) {
  const lettered = letteredPrefix(text);
  if (lettered?.body) return { ...lettered, heading: inferredHeading(lettered.title) };
  const prefix = numberedPrefix(text); if (!prefix) return null;
  // In older layout tables an uppercase title has no terminal punctuation.
  // Its transition to an ordinary sentence is still literal source evidence.
  const words = [...prefix.title.matchAll(/\S+/gu)]; let end = 0;
  for (const word of words) {
    if (!/^[\p{Lu}\p{N},:;&'’()\-/]+[.]?$/u.test(word[0])) break;
    end = word.index + word[0].length;
  }
  if (end && end < prefix.title.length) {
    const title = text.slice(0, prefix.title_start + end), body = text.slice(prefix.title_start + end).trim();
    const heading = inferredHeading(title);
    if (heading && /^(?:In|This|The|Each|Any|During|Upon|Prior|After|Notwithstanding|Except|If|Unless|Provided|A|An)\b/u.test(body)) return { title, body, heading };
  }
  const dot = text.match(/^((?:(?:Section|SECTION|section)\s+|ARTICLE\s+|Article\s+)?\d+(?:\.\d+)*[.)]?\s+(?:\|\s*)?[\p{Lu}][^.]{1,140}[.:])\s+([\s\S]+)$/u);
  if (dot && inferredHeading(dot[1])) return { title: dot[1], body: dot[2], heading: inferredHeading(dot[1]) };
  return null;
}

function delimiters(text, state) {
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '“' || character === '„') state.smartQuote += 1;
    else if (character === '”') state.smartQuote = Math.max(0, state.smartQuote - 1);
    else if (character === '"') {
      // Direction matters: in malformed source such as 'term," a closing mark
      // is not evidence that a new quotation starts over the next articles.
      // Preserve the literal punctuation and disclose the unmatched closer.
      const prior = text[index - 1] ?? '', next = text[index + 1] ?? '';
      const opening = !prior || /[\s([{=:;—]/u.test(prior);
      const closing = !next || /[\s,.;:!?)}\]]/u.test(next);
      if (closing && !opening) { if (!state.quote) state.unpairedClosingQuotes += 1; state.quote = false; }
      else if (opening && !closing) state.quote = true;
      else state.quote = !state.quote;
    }
    else if (character === '(') state.parenthesis += 1;
    else if (character === ')') state.parenthesis = Math.max(0, state.parenthesis - 1);
    else if (character === '[') state.bracket += 1;
    else if (character === ']') state.bracket = Math.max(0, state.bracket - 1);
  }
}
const delimiterState = () => ({ quote: false, smartQuote: 0, parenthesis: 0, bracket: 0, unpairedClosingQuotes: 0 });
const openDelimiter = (state) => state.quote || state.smartQuote > 0 || state.parenthesis > 0 || state.bracket > 0;

// Navigation is a separate literal-source index. None of these candidates can
// change the conservative V9 source partition, its headings or governor frames.
const POSTAL_CONTACT = /^[\p{L} .'’,-]+,?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?$/u;
// V13 navigation grammar is deliberately independent of boundary inference.
// Rejecting a label here never removes its text or changes a source partition.
const NAV_FILING_HEADER = /^EX(?:-[\p{L}\d.]+)?\s+\d+\s+\S+\.(?:txt|html?)\b/iu;
const NAV_PAGE_LABEL = /^(?:PAGE\s+(?:[\p{Lu}]\s*[-.]?\s*)?\d+(?:\s+OF\s+\d+)?|[\p{Lu}]-\d+)$/iu;
const NAV_DATE_LABEL = /^(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})$/iu;
const NAV_CONTACT_FIELD = /^(?:by|name|title|date|address|to|from|copies?\s+to)\s*:/iu;
const NAV_GEOGRAPHIC_LINE = /^[\p{L} .'’\-]+,\s*[\p{L} .'’\-]+(?:\s+\d{5}(?:-\d{4})?)?$/u;
const NAV_INSTITUTION_LINE = /\b(?:department|commission|authority|agency|bureau|institute|bank)\b/iu;
const NAV_TYPED_MARKER = /^(?:(?:SECTION|ARTICLE|CHAPTER)\s+(?:[\p{Lu}]?\d+(?:\.\d+)*|[IVXLC]+)|(?:EXHIBIT|SCHEDULE|APPENDIX|ANNEX|ATTACHMENT)\s+[\p{L}\d]+(?:[.\d-]*))[.:]?$/iu;
const NAV_BODY_START = /^(?:the|this|that|each|any|every|neither|either|both|all|it|its|you|your|we|our|they|their|if|unless|except|provided|notwithstanding|subject\s+to|upon|during|after|before|when|where|with\s+respect\s+to)\b/iu;
const NAV_DOCUMENT_PREFIX = /^(?:(?:(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)?)\s+)?amendment(?:\s+no\.?\s*\d+)?\s+to|(?:form\s+of|terms\s+and\s+conditions\s+of))$/iu;
const NAV_DOCUMENT_WORD = /\b(?:agreement|amendment|contract|indenture|lease|proposal|deed|instrument|plan|bill of sale)\b/iu;
const NAV_FORM_FIELD = /^(?:ship\s+to|bill\s+to|signed|signatures?(?:\s+page)?|execution\s+page|print(?:ed)?\s+name|authorized\s+signatory|by|name|title|date|address)\s*(?:[:_]|$)|_{3,}/iu;
const NAV_CITATION = /\b(?:U\.?S\.?C\.?|C\.?F\.?R\.?|§|v\.|versus)\b/u;
function navigationBlocked(text) {
  return !text || LAYOUT_LABEL.test(text) || NAV_FILING_HEADER.test(text) || NAV_PAGE_LABEL.test(text) || NAV_DATE_LABEL.test(text) || NAV_CONTACT_FIELD.test(text) || NAV_FORM_FIELD.test(text) || countryLabel(text) || CONTACT_LINE.test(text) || CONTACT_DELIVERY.test(text) || POSTAL_CONTACT.test(text) || OPENING_FORMULA.test(text) || /^[-–—]\s*\d+\s*[-–—]$/u.test(text) || /^(?:TYPE|SEQUENCE|FILENAME|DESCRIPTION)\s*:/iu.test(text) || /\.{2,}/u.test(text);
}
function navigationCaptionForm(text, { native = false, typed = false, delimited = false } = {}) {
  // Numbering alone cannot make an ordinary sentence a caption. Permit a
  // sentence-case phrase only at a literal caption/body delimiter whose
  // following text independently has body form (checked by the caller).
  const sentenceCase = typed && delimited && text.length <= 180 && text.split(/\s+/u).length <= 20 && /^[\p{Lu}][\p{L}\p{N}\s.,:;()\-/&'’®™]+$/u.test(text) && !/[!?;]/u.test(text) && !NAV_BODY_START.test(text);
  if ((!boundedCaptionForm(text) && !sentenceCase) || OPENING_FORMULA.test(text)) return false;
  // Short genuine mixed-case captions such as What Notices Must Include are
  // permitted with native evidence; ALL-CAPS operative sentences are not.
  return !assertion(native ? text.replace(/\b(?:Must|Is|Are)\b/gu, '') : text);
}
function navigationCaptionPrefix(title, evidence) {
  const separators = [...title.matchAll(/[.:](?=\s)/gu)];
  for (const match of separators) {
    const caption = title.slice(0, match.index + 1), body = title.slice(match.index + 1).trim();
    // An abbreviation is not an inline caption boundary merely because an
    // assertion occurs later in the paragraph. Require a body-shaped suffix.
    const abbreviated = /(?:^|\s|\.)\p{Lu}\.$/u.test(caption) && /^\p{Lu}/u.test(body);
    if (body && !abbreviated && navigationCaptionForm(caption, { ...evidence, delimited: true }) && (NAV_BODY_START.test(body) || assertion(body) || /^[\p{Ll}]/u.test(body) && !navigationCaptionForm(body, evidence) || /^(?:Within\s*\d|For\s+(?:the|each|any)|As\s+(?:required|provided|specified|set\s+forth))\b/iu.test(body))) return caption;
  }
  return navigationCaptionForm(title, evidence) ? title : null;
}
function navigationLiteral(text, { structural = false, htmlLevel = null } = {}) {
  const native = Boolean(htmlLevel), marker = text.match(/^((?:ARTICLE|CHAPTER)\s+[IVXLC\d]+)(?:[.:\-–—]?\s+|$)([\s\S]*)$/iu);
  if (marker) {
    const tail = marker[2];
    if (!tail) return { literal: text, kind: 'article_heading' };
    const caption = navigationCaptionPrefix(tail, { native, typed: true });
    if (!caption) return { literal: marker[1], kind: 'article_marker_unresolved_caption' };
    return { literal: text.slice(0, text.length - tail.length + caption.length), kind: 'article_heading' };
  }
  if (NAV_TYPED_MARKER.test(text)) return { literal: text, kind: /^(?:SECTION)/iu.test(text) ? 'section_marker' : 'attachment_heading' };
  const number = text.match(/^(?:(Section|SECTION|section)\s+)?([\p{Lu}]?\d+(?:\.\d+)*)([.)])?\s*(?:\|\s*)?([\p{Lu}\p{Lo}][\s\S]*)$/u);
  // Bare integers also prefix addresses, footnotes and data. Layout alone
  // cannot turn them into section markers; retain an adjacent caption instead.
  if (number && (number[1] || number[3] || number[2].includes('.'))) {
    if (/\p{Lo}/u.test(number[4][0]) && (!structural || /[。！？；]$/u.test(number[4]))) return null;
    const caption = navigationCaptionPrefix(number[4], { native, typed: true });
    if (caption && (!ENTITY_TITLE.test(caption) || SECTION_TITLE_CUE.test(caption))) return { literal: text.slice(0, text.length - number[4].length + caption.length), kind: 'numbered_heading' };
  }
  const letter = text.match(/^(?:\([a-z]\)|[a-z][.)])\s*([\p{Lu}][\s\S]*)$/u);
  if (letter) {
    const caption = navigationCaptionPrefix(letter[1], { native, typed: true });
    if (caption && (/[.:]$/u.test(caption) || structural || native)) return { literal: text.slice(0, text.length - letter[1].length + caption.length), kind: 'lettered_subheading' };
    return null;
  }
  const split = inlineTitle(text);
  if (split && navigationCaptionForm(split.title, { native })) return { literal: split.title, kind: split.heading.kind };
  if (NAV_DOCUMENT_PREFIX.test(text) && (structural || native)) return { literal: text, kind: 'document_title_fragment' };
  // Non-cased scripts need literal layout evidence rather than an English
  // title dictionary. Spaced single characters are a narrow caption form;
  // ordinary unspaced sentences and punctuation remain unknown here.
  if ((structural || native) && /^(?:\p{Lo}\s+){2,}\p{Lo}$/u.test(text) && text.replace(/\s/gu, '').length <= 40) return { literal: text, kind: 'source_caption' };
  if (!navigationCaptionForm(text, { native })) return null;
  if (/^[\p{Lu}\p{N}'’\-]+\.$/u.test(text) || native && !structural && sentenceClosed(text)) return null;
  const existing = inferredHeading(text, { structural });
  if (existing) return { literal: text, kind: existing.kind };
  if (structural || native) return { literal: text, kind: native ? 'native_caption' : 'source_caption' };
  return null;
}
function navigationStandaloneMarker(text) { return standaloneMarker(text) || NAV_TYPED_MARKER.test(text); }
function navigationContactRole(block, index, blocks) {
  const neighbors = blocks.slice(Math.max(0, index - 2), index + 3).filter((item) => item !== block);
  if (/^\d+\s+/u.test(block.text) && !/^\d+[.)]/u.test(block.text) && neighbors.some((item) => POSTAL_CONTACT.test(item.text) || CONTACT_LINE.test(item.text) || NAV_CONTACT_FIELD.test(item.text))) return true;
  if (!NAV_GEOGRAPHIC_LINE.test(block.text)) return false;
  return neighbors.some((item) => CONTACT_LINE.test(item.text) || POSTAL_CONTACT.test(item.text) || countryLabel(item.text) || NAV_DATE_LABEL.test(item.text) || looksTitle(item.text) && (ENTITY_TITLE.test(item.text) || NAV_INSTITUTION_LINE.test(item.text)) || /^In\s+the\s+Matter\s+of\b/iu.test(item.text));
}
function navigationSeed(text, { structural = false, htmlLevel = null, sourceKind = 'text', ...ambiguity } = {}) {
  if (navigationBlocked(text)) return null;
  const quotedPrefix = text.match(/^[““"']+\s*(?=(?:Section\s+|ARTICLE\s+|\d+[.)]|\([a-z]\)))/iu)?.[0] ?? '';
  const start = quotedPrefix.length;
  const heading = navigationLiteral(text.slice(start), { structural, htmlLevel });
  const literal = heading?.literal;
  if (!heading || navigationBlocked(literal) || ENTITY_TITLE.test(literal) && sourceKind !== 'literal_marker_followed_caption' && !['article_heading', 'numbered_heading', 'document_title'].includes(heading.kind) && !NAV_DOCUMENT_WORD.test(literal)) return null;
  return { label: literal, relative_start: start, relative_end: start + literal.length, parts: [{ text: literal, relative_start: start, relative_end: start + literal.length }], kind: heading.kind, source_evidence: { source_kind: sourceKind, html_level: htmlLevel, literal_typed_marker: Boolean(numberedPrefix(literal)?.marker || NAV_TYPED_MARKER.test(literal)), source_layout_caption: structural }, ambiguity: { ...ambiguity, ...(quotedPrefix ? { source_quote_context: true } : {}) } };
}
function shiftNavigation(seeds, shift) {
  return seeds.map((seed) => ({ ...seed, relative_start: seed.relative_start + shift, relative_end: seed.relative_end + shift, parts: seed.parts.map((part) => ({ ...part, relative_start: part.relative_start + shift, relative_end: part.relative_end + shift })) }));
}
function navigationSlice(seeds, start, end) {
  const selected = [];
  for (const seed of seeds) {
    if (seed.parts.every((part) => part.relative_start >= start && part.relative_end <= end)) { selected.push(seed); continue; }
    // A positively identified literal caption may cross an unchanged legacy
    // inline split. Clip only its navigation pieces, then reconstruct the
    // complete label from all pieces after normalized offsets are assigned.
    if (!seed.navigation_group) continue;
    const parts = seed.parts.filter((part) => part.relative_end > start && part.relative_start < end).map((part) => {
      const low = Math.max(start, part.relative_start), high = Math.min(end, part.relative_end);
      return { text: part.text.slice(low - part.relative_start, high - part.relative_start), relative_start: low, relative_end: high };
    });
    if (parts.length) selected.push({ ...seed, parts, relative_start: parts[0].relative_start, relative_end: parts.at(-1).relative_end });
  }
  return shiftNavigation(selected, -start);
}
function navigationBeforeInlineBody(seeds, text, titleEnd, bodyStart, groupKey) {
  return seeds.flatMap((seed) => {
    if (!(seed.relative_start < titleEnd && seed.relative_end > bodyStart)) return [seed];
    // Whole-caption source emphasis is positive grouping evidence. A plain
    // numbered line is not: its first prose word may share the caption line.
    if (seed.source_evidence.source_kind === 'inert_whole_emphasized_source_caption') return [{ ...seed, navigation_group: seed.navigation_group ?? { key: groupKey, label: seed.label } }];
    // The unchanged legacy splitter can also cut a real caption at an
    // internal colon. Retain both literal caption-form sides; an operative
    // suffix or a prose opener after a terminal period gets no such evidence.
    const suffix = text.slice(bodyStart, seed.relative_end);
    if (text[titleEnd - 1] === ':' && navigationCaptionForm(suffix) && !NAV_BODY_START.test(suffix)) return [{ ...seed, navigation_group: { key: groupKey, label: seed.label }, source_evidence: { ...seed.source_evidence, inline_caption_scope: 'CAPTION_FORM_BOTH_SIDES_OF_INTERNAL_COLON' } }];
    const parts = seed.parts.filter((part) => part.relative_start < titleEnd).map((part) => {
      const end = Math.min(part.relative_end, titleEnd);
      return { text: part.text.slice(0, end - part.relative_start), relative_start: part.relative_start, relative_end: end };
    }).filter((part) => part.text);
    if (!parts.length) return [];
    const { navigation_group, ...caption } = seed;
    return [{ ...caption, label: normalize(parts.map((part) => part.text).join(' ')), relative_start: parts[0].relative_start, relative_end: parts.at(-1).relative_end, parts, source_evidence: { ...seed.source_evidence, inline_caption_scope: 'CAPTION_SIDE_OF_UNCHANGED_LEGACY_SPLIT' } }];
  });
}
function navigationForBlocks(blocks, contractId, normalizedText) {
  const anchors = []; const seen = new Set();
  for (const [blockIndex, block] of blocks.entries()) for (const seed of block.navigation_candidates ?? []) {
    // Every producer, including whole-emphasis groups and table cells, passes
    // the same final lexical gate. A wrapper never exempts a page/form label.
    if (navigationBlocked(seed.navigation_group?.label ?? seed.label) || navigationContactRole(block, blockIndex, blocks)) continue;
    const parts = seed.parts.map((part) => ({ text: part.text, start: block.start + part.relative_start, end: block.start + part.relative_end }));
    // Fail closed on an index construction bug rather than attach a title to
    // different text. There is no substring search or fabricated caption here.
    if (!parts.length || parts.some((part) => normalizedText.slice(part.start, part.end) !== part.text)) throw new Error('Literal navigation range differs from normalized source');
    const start = parts[0].start, end = parts.at(-1).end;
    const label = normalize(parts.map((part) => part.text).join(' '));
    const ambiguity = { ...seed.ambiguity, source_continuation: Boolean(block.source_continuation), source_sentence_continuation: Boolean(block.source_sentence_continuation), source_quote_context: Boolean(block.quote_context || seed.ambiguity?.source_quote_context), within_introduced_list_frame: Boolean(block.list_frame), source_list_item: Boolean(block.source_list_item), table_layout: Boolean(block.delimiter_scope || block.source_table_scope || block.fixed_width_numeric_record) };
    let nextIndex = blockIndex + 1;
    while (blocks[nextIndex] && (LAYOUT_LABEL.test(blocks[nextIndex].text) || countryLabel(blocks[nextIndex].text))) nextIndex += 1;
    const next = blocks[nextIndex];
    const localNumberedBody = next?.text.match(/^(\d+)\.\d+\b/u);
    const prior = blocks[blockIndex - 1];
    const kind = seed.kind === 'document_title' && localNumberedBody && prior?.text === localNumberedBody[1] ? 'document_or_section_caption_unresolved' : seed.kind;
    const anchor = { id: `${contractId}:navigation:${start}-${end}:${hash(label).slice(0, 12)}`, label, start, end, parts, kind, source_evidence: seed.source_evidence, parent_boundary_suppressed: Boolean(block.heading_suppressed_reason || !block.heading || block.heading.within_introduced_list_frame), suppression_reason: block.heading_suppressed_reason ?? (block.list_frame ? 'CONSERVATIVE_INTRODUCED_LIST_FRAME' : !block.heading ? 'NO_INDEPENDENT_PARENT_BOUNDARY' : null), ambiguity, governing_hierarchy_verified: false, scope: 'LITERAL_SOURCE_NAVIGATION_ONLY', ...(seed.navigation_group ? { navigation_group: seed.navigation_group } : {}) };
    const key = `${start}:${end}:${label}`;
    const repeatedRunningTitle = NAV_DOCUMENT_WORD.test(label) && !anchor.source_evidence.literal_typed_marker && anchors.some((item) => item.label === label) && [blocks[blockIndex - 1], blocks[blockIndex + 1]].some((item) => item && (LAYOUT_LABEL.test(item.text) || NAV_PAGE_LABEL.test(item.text)));
    if (!seen.has(key) && !repeatedRunningTitle) { seen.add(key); anchors.push(anchor); }
  }
  // A leading all-capital document caption may span literal source lines,
  // including an entity and an unfinished 'FOR/TO' piece. Group only the
  // bounded caption-shaped opening sequence, never body clauses or metadata.
  // This is a source index, not proof that any displayed title governs a unit.
  const opening = [];
  for (const block of blocks) {
    if (!opening.length && (NAV_FILING_HEADER.test(block.text) || /^(?:TYPE|SEQUENCE|FILENAME|DESCRIPTION)\s*:/iu.test(block.text))) continue;
    if (navigationBlocked(block.text) || !CAPITAL_TITLE.test(block.text) || !/\p{Lu}/u.test(block.text) || assertion(block.text) || NAV_CITATION.test(block.text)) break;
    const label = normalize([...opening.map(item => item.text), block.text].join(' '));
    if (label.length > 180 || label.split(/\s+/u).length > 20) break;
    opening.push(block);
  }
  if (opening.length > 1) {
    const label = normalize(opening.map(block => block.text).join(' '));
    if (NAV_DOCUMENT_WORD.test(label) && /\b(?:agreement|amendment|contract|lease|deed|instrument|plan|proposal)\s*\.?$/iu.test(label)) {
      const parts = opening.map(block => ({ text: block.text, start: block.start, end: block.end }));
      const start = parts[0].start, end = parts.at(-1).end;
      anchors.push({ id: `${contractId}:navigation:${start}-${end}:${hash(label).slice(0, 12)}`, label, start, end, parts, kind: 'document_title', source_evidence: { source_kind: 'literal_leading_document_caption_lines', html_level: null, literal_typed_marker: false, source_layout_caption: false, grouped_title_pieces: 'NAVIGATION_ONLY_LEADING_LITERAL_DOCUMENT_CAPTION_UNVERIFIED' }, parent_boundary_suppressed: true, suppression_reason: 'NO_VERIFIED_GOVERNING_HIERARCHY', ambiguity: { unresolved_title_continuation: false }, governing_hierarchy_verified: false, scope: 'LITERAL_SOURCE_NAVIGATION_ONLY' });
    }
  }
  const groups = new Map();
  for (const anchor of anchors) if (anchor.navigation_group) { const key = anchor.navigation_group.key; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(anchor); }
  const groupedMembers = new Set(), sourceGroups = [];
  for (const members of groups.values()) {
    members.sort((left, right) => left.start - right.start || left.end - right.end);
    const parts = members.flatMap((anchor) => anchor.parts), first = members[0], label = normalize(parts.map((part) => part.text).join(' '));
    if (label !== first.navigation_group.label || parts.some((part, index) => index && part.start < parts[index - 1].end)) continue;
    const groupedEvidence = first.source_evidence.source_kind === 'inert_whole_emphasized_source_caption' ? 'INERT_WHOLE_SOURCE_CAPTION_GROUP' : 'LITERAL_CAPTION_FORM_ACROSS_INTERNAL_SEPARATOR';
    const combined = { ...first, label, start: parts[0].start, end: parts.at(-1).end, parts, source_evidence: { ...first.source_evidence, grouped_title_pieces: groupedEvidence } };
    combined.id = `${contractId}:navigation:${combined.start}-${combined.end}:${hash(label).slice(0, 12)}`;
    combined.parent_boundary_suppressed = members.some((anchor) => anchor.parent_boundary_suppressed);
    combined.ambiguity = Object.fromEntries([...new Set(members.flatMap((anchor) => Object.keys(anchor.ambiguity)))].map((key) => [key, members.some((anchor) => anchor.ambiguity[key])]));
    delete combined.navigation_group;
    sourceGroups.push(combined); members.forEach((anchor) => groupedMembers.add(anchor));
  }
  const ordered = [...anchors.filter((anchor) => !groupedMembers.has(anchor)), ...sourceGroups].sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
  const grouped = [];
  for (const anchor of ordered) {
    const previous = grouped.at(-1), adjacent = previous && previous.end <= anchor.start && /^\s*$/u.test(normalizedText.slice(previous.end, anchor.start));
    const documentCaption = adjacent && previous?.kind === 'document_title_fragment' && anchor.kind === 'document_title' && navigationCaptionForm(previous.label + ' ' + anchor.label);
    if (documentCaption) {
      previous.parts.push(...anchor.parts); previous.end = anchor.end; previous.label = normalize(previous.parts.map((part) => part.text).join(' '));
      previous.id = `${contractId}:navigation:${previous.start}-${previous.end}:${hash(previous.label).slice(0, 12)}`;
      previous.kind = 'document_title';
      previous.source_evidence = { ...previous.source_evidence, grouped_title_pieces: 'NAVIGATION_ONLY_ADJACENT_SOURCE_MARKER_AND_CAPTION' };
      previous.ambiguity = Object.fromEntries([...new Set([...Object.keys(previous.ambiguity), ...Object.keys(anchor.ambiguity)])].map((key) => [key, Boolean(previous.ambiguity[key] || anchor.ambiguity[key])]));
      continue;
    }
    grouped.push(anchor);
  }
  const identities = new Set();
  return grouped.filter((anchor) => {
    if (anchor.kind === 'document_title_fragment' || identities.has(anchor.id)) return false;
    identities.add(anchor.id); return true;
  }).map((anchor) => { const value = { ...anchor }; delete value.navigation_group; return value; });
}

// Anchor arrays are constructed once, then treated as immutable source indexes.
const navigationIndexes = new WeakMap();
/** Nearest preceding label is navigation, never verification of a governor. */
export function sourceNavigationForRange(anchors, start, end) {
  if (!Array.isArray(anchors) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) throw new TypeError('Explicit literal navigation range required');
  let index = navigationIndexes.get(anchors);
  if (!index) {
    const starts = anchors.map((anchor) => anchor.start); let maximum = -1;
    const maximumEnds = anchors.map((anchor) => { maximum = Math.max(maximum, anchor.end); return maximum; });
    index = { starts, maximumEnds }; navigationIndexes.set(anchors, index);
  }
  const preceding = lowerBound(index.starts, start + 1) - 1;
  const nearest = preceding >= 0 ? anchors[preceding] : null;
  const first = lowerBound(index.maximumEnds, start + 1);
  const within = [];
  for (let ordinal = first; ordinal < anchors.length && anchors[ordinal].start < end; ordinal += 1) if (anchors[ordinal].end > start) within.push(anchors[ordinal]);
  return { nearest_anchor: nearest, within_unit: within, governing_hierarchy_verified: false, scope: 'LITERAL_SOURCE_NAVIGATION_ONLY', status: nearest || within.length ? 'LITERAL_ANCHORS_PRESENT' : 'UNKNOWN_NO_SOURCE_SUPPORTED_ANCHOR', nearest_relation: nearest ? 'PRECEDING_OR_AT_RANGE_START_NOT_VERIFIED_GOVERNOR' : null };
}

function sectionBlocks(input, warnings, origins = originContext(null)) {
  const blocks = [];
  const contexts = new Map([['document', { state: delimiterState(), previous: null, introducedQuote: false }]]);
  const documentTitles = new Set(); let suppressed = 0; let unfinishedSuppressed = 0; let nativeProseSuppressed = 0; let unknownCaptions = 0; let fixedWidthIndex = 0; let navigationSplitIndex = 0;
  for (const sourceBlock of input) {
    const seed = navigationSeed(sourceBlock.text, { structural: ['layout_caption', 'table_caption'].includes(sourceBlock.kind), htmlLevel: sourceBlock.heading?.html_level ?? null, sourceKind: sourceBlock.kind });
    const block = { ...sourceBlock, navigation_candidates: sourceBlock.navigation_candidates ?? (sourceBlock.heading_eligible === false ? [] : seed ? [seed] : []) };
    if (LAYOUT_LABEL.test(block.text) || countryLabel(block.text) || CONTACT_DELIVERY.test(block.text) || OPENING_FORMULA.test(block.text)) { blocks.push({ ...block, kind: countryLabel(block.text) || CONTACT_DELIVERY.test(block.text) ? 'contact_label' : 'layout_label', heading: null }); continue; }
    const scope = block.fixed_width_numeric_record ? `fixed_width_record_${++fixedWidthIndex}` : block.delimiter_scope ?? 'document';
    if (!contexts.has(scope)) contexts.set(scope, { state: delimiterState(), previous: null, introducedQuote: false });
    const context = contexts.get(scope), state = context.state, previous = context.previous;
    const capitalized = CAPITAL_TITLE.test(block.text) && /\p{Lu}{3}/u.test(block.text);
    if (previous && /:\s*$/u.test(previous.text) && QUOTE_INTRODUCTION.test(previous.text) && !(attachmentReferenceIntroduction(previous) && attachmentReferenceCaption(block)) && (capitalized || /^[“"\[]/u.test(block.text))) context.introducedQuote = true;
    // A colon-introduced, uppercase quotation need not have outer quote marks.
    // Its first ordinary paragraph ends that layout context; explicit quotes
    // and parentheses continue to bind independently across source blocks.
    if (context.introducedQuote && !capitalized && !/^[“"\[]/u.test(block.text)) context.introducedQuote = false;
    const sentenceContinuation = unfinishedProse(previous) || previous?.source_sentence_continuation && !sentenceClosed(previous.text);
    const continuation = openDelimiter(state) || scope !== 'document' && openDelimiter(contexts.get('document').state) || block.quote_context || block.continuation_at_start || context.introducedQuote || sentenceContinuation;
    const caption = !continuation && previous?.heading && standaloneMarker(previous.text) ? inferredHeading(block.text, { markerCaption: true }) : null;
    const precedingMarker = previous?.navigation_candidates?.findLast((item) => navigationStandaloneMarker(item.label));
    if (!block.navigation_candidates.length && precedingMarker && looksTitle(block.text)) {
      const navigationCaption = navigationSeed(block.text, { structural: true, sourceKind: 'literal_marker_followed_caption' });
      if (navigationCaption) block.navigation_candidates.push(navigationCaption);
    }
    let candidate = { ...block, heading: continuation ? null : block.heading ?? caption, source_continuation: Boolean(continuation), source_sentence_continuation: Boolean(sentenceContinuation || block.source_sentence_continuation) };
    // Converted filings can put every ordinary paragraph in h1..h6 tags.
    // A native tag supplies layout evidence, not a new title for a lower-case
    // continuation or an operative sentence. Preserve literal typed/inline
    // titles and ordinary caption-form headings; otherwise retain the prose
    // with unknown hierarchy rather than let presentation sever its governor.
    if (candidate.heading?.kind === 'explicit_heading' && !inferredHeading(candidate.text) && !inlineTitle(candidate.text) && (/^\p{Ll}/u.test(candidate.text) || assertion(candidate.text) && (!boundedCaptionForm(candidate.text) || sentenceClosed(candidate.text)))) {
      candidate = { ...candidate, heading: null, kind: 'native_heading_prose', heading_suppressed_reason: 'body_shaped_native_heading_without_title_evidence' };
      nativeProseSuppressed += 1;
    }
    if (!candidate.heading && block.heading?.kind === 'explicit_heading') candidate.source_heading_presentation = { html_level: block.heading.html_level, kind: block.heading.kind, verified: false };
    if (candidate.heading?.kind === 'document_title') {
      const titleKey = normalize(candidate.text).toLocaleUpperCase('en-US');
      if (documentTitles.has(titleKey)) candidate = { ...candidate, heading: null, kind: 'repeated_document_title', heading_suppressed_reason: 'repeated_document_title_retained_without_new_boundary' };
      documentTitles.add(titleKey);
    }
    if (continuation && (block.heading || inlineTitle(block.text))) {
      if (sentenceContinuation) { unfinishedSuppressed += 1; candidate.heading_suppressed_reason = 'source_unfinished_sentence_continuation'; }
      else { suppressed += 1; candidate.heading_suppressed_reason = 'source_quote_or_delimiter_continuation'; }
    }
    if (!candidate.heading && looksTitle(block.text) && capitalized && !continuation) unknownCaptions += 1;
    delimiters(block.text, state);
    context.previous = candidate;
    if (continuation || block.heading_eligible === false) { blocks.push(candidate); continue; }
    // Conventional numbered titles can share an element/table cell with the
    // first operative sentence. Splitting inserts a paragraph separator only;
    // every title/body character remains in the normalized source.
    const split = inlineTitle(candidate.text);
    if (split) {
      const bodyStart = candidate.text.length - split.body.length;
      const captionGroup = `inline_caption_${++navigationSplitIndex}`;
      candidate.navigation_candidates = navigationBeforeInlineBody(candidate.navigation_candidates, candidate.text, split.title.length, bodyStart, captionGroup);
      blocks.push({ text: split.title, kind: 'inline_numbered_heading', heading: split.heading, navigation_candidates: navigationSlice(candidate.navigation_candidates, 0, split.title.length) });
      const body = { ...candidate, text: split.body, heading: null, navigation_candidates: navigationSlice(candidate.navigation_candidates, bodyStart, candidate.text.length) };
      if (candidate[ORIGIN]) {
        blocks.at(-1)[ORIGIN] = joinOrigins([sliceOrigins(candidate[ORIGIN], 0, split.title.length, origins, undefined, false), emptyOrigins(sliceOrigins(candidate[ORIGIN], split.title.length, bodyStart, origins, undefined, false), origins)]);
        body[ORIGIN] = sliceOrigins(candidate[ORIGIN], bodyStart, candidate.text.length, origins);
      }
      blocks.push(body);
      // Subsequent continuity follows the emitted operative paragraph, not
      // the original title-plus-body node. Narrow page labels above remain
      // transparent to this context and are still retained as literal text.
      context.previous = body;
    } else blocks.push(candidate);
  }
  const joined = [];
  for (const block of blocks) {
    const previous = joined.at(-1);
    if (previous?.heading && looksTitle(block.text) && /^(?:of|and|for|by|to|with)\b/iu.test(block.text) && !/[.:;!?]$/u.test(previous.text) && !numberedPrefix(block.text)) {
      const shift = previous.text.length + 2;
      const priorSeed = previous.navigation_candidates?.at(-1);
      if (priorSeed && priorSeed.relative_end === previous.text.length && boundedCaptionForm(block.text) && !assertion(block.text)) {
        priorSeed.parts.push({ text: block.text, relative_start: shift, relative_end: shift + block.text.length });
        priorSeed.relative_end = shift + block.text.length;
        priorSeed.label = priorSeed.parts.map((part) => part.text).join(' ');
        priorSeed.source_evidence = { ...priorSeed.source_evidence, grouped_title_pieces: 'V9_SOURCE_WRAPPED_CAPTION_CONTINUATION' };
      } else {
        if (priorSeed) priorSeed.ambiguity = { ...priorSeed.ambiguity, unresolved_title_continuation: true };
        previous.navigation_candidates.push(...shiftNavigation(block.navigation_candidates ?? [], shift));
      }
      previous.text += `\n\n${block.text}`;
      if (previous[ORIGIN] && block[ORIGIN]) { const prior = previous[ORIGIN]; prior.text = previous.text; prior.pieces.push({ text: '\n\n', synthetic: true }); for (const piece of block[ORIGIN].pieces) prior.pieces.push(piece); }
      previous.heading = { ...previous.heading, label: normalize(previous.text), wrapped_title_continuation: true };
      if (/\.{3,}/u.test(previous.text)) { previous.heading = null; previous.kind = 'table_of_contents_entry'; }
    } else joined.push(block);
  }
  if (suppressed) warnings.push({ code: 'CONTINUATION_HEADING_SUPPRESSED', count: suppressed, message: 'Apparent headings inside source quotations, parentheses, brackets or indented quotations were retained with their governing context.' });
  if (unfinishedSuppressed) warnings.push({ code: 'UNFINISHED_SENTENCE_HEADING_SUPPRESSED', count: unfinishedSuppressed, message: 'Apparent headings following unfinished source prose were retained with the antecedent sentence. This conservative continuity is not verification of governing hierarchy.' });
  if (nativeProseSuppressed) warnings.push({ code: 'BODY_SHAPED_NATIVE_HEADING_RETAINED', count: nativeProseSuppressed, message: 'Native HTML heading tags containing operative prose without title evidence were retained as text with unknown hierarchy; tag level alone does not establish a semantic boundary.' });
  if (unknownCaptions) warnings.push({ code: 'UNANCHORED_CAPITALIZATION_RETAINED', count: unknownCaptions, message: 'Capitalized fragments without source heading evidence are retained as text with unknown hierarchy.' });
  if (openDelimiter(contexts.get('document').state)) warnings.push({ code: 'UNRESOLVED_SOURCE_DELIMITER_CONTINUITY', message: 'A source quotation, parenthesis or bracket remains open. Continuation text is retained without asserting independent boundaries; inspect the original source.' });
  const tableOpen = [...contexts].filter(([scope, context]) => scope !== 'document' && !scope.startsWith('fixed_width_record_') && openDelimiter(context.state)).length;
  if (tableOpen) warnings.push({ code: 'UNRESOLVED_TABLE_DELIMITER_SCOPED', count: tableOpen, message: 'Unclosed punctuation inside an explicit source table remains uncertain there; it does not establish quotation or parenthesis continuity in later text outside that table. All table text is retained.' });
  const fixedWidthOpen = [...contexts].filter(([scope, context]) => scope.startsWith('fixed_width_record_') && openDelimiter(context.state)).length;
  if (fixedWidthOpen) warnings.push({ code: 'UNRESOLVED_FIXED_WIDTH_DELIMITER_SCOPED', count: fixedWidthOpen, message: 'Unclosed punctuation in a multi-line record with repeated aligned numeric fields remains local to that uncertain fixed-width layout. All values remain literal; no column meaning or relationship was inferred.' });
  const quoteClosers = [...contexts.values()].reduce((sum, context) => sum + context.state.unpairedClosingQuotes, 0);
  if (quoteClosers) warnings.push({ code: 'UNPAIRED_CLOSING_QUOTE_RETAINED', count: quoteClosers, message: 'A directionally closing double quote lacks a matching opener. Original punctuation is retained; the closing mark does not invent an opening quotation over subsequent source sections.' });
  return preserveListFrames(joined, warnings);
}

function preserveListFrames(blocks, warnings) {
  let frame = null; let frameIndex = 0; let governingLevel = 1; let frames = 0; let tableFrames = 0; let referenceFrames = 0; let previousHeading = null;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const prefix = numberedPrefix(block.text);
    const strongBoundary = frame?.dependency_kind === 'ATTACHMENT_REFERENCE_LIST_FORWARD_DEPENDENCY' ? attachmentReferenceFrameFence(block, frame) : frame?.dependency_kind === 'SOURCE_TABLE_FORWARD_REFERENCE' ? tableFrameFence(block, frame) : block.heading && (['article_heading', 'attachment_heading', 'document_title', 'letter_subject'].includes(block.heading.kind) || block.heading.kind === 'explicit_heading' && (block.heading.html_level ?? block.heading.level) <= (frame?.level ?? 6) || block.heading.kind === 'numbered_heading' && prefix?.marker);
    if (frame && strongBoundary && index > frame.governor_index) frame = null;
    const firstReference = attachmentReferenceIntroduction(block) ? nextAttachmentReference(blocks, index + 1) : null;
    if (firstReference) {
      // A newly stated forward governor may occur inside a preceding broad
      // table/list frame. Preserve that earlier frame's source provenance,
      // rather than require !frame or assert a verified nested legal scope.
      const prior = frame ? [frame.index, ...(frame.prior_frame_indices ?? [])] : [];
      frame = { index: ++frameIndex, governor_index: index, level: block.heading?.level ?? governingLevel, native_scope_level: block.heading?.html_level ?? previousHeading?.html_level ?? null, evidence: 'LITERAL_COLON_FOLLOWED_BY_ATTACHMENT_REFERENCES', dependency_kind: 'ATTACHMENT_REFERENCE_LIST_FORWARD_DEPENDENCY', prior_frame_indices: [...new Set(prior)] };
      referenceFrames += 1;
    }
    const firstItem = nextListItem(blocks, index + 1, block.heading?.level ?? governingLevel);
    // The colon is a literal forward dependency. Keep all enumerated items and
    // later cost/qualification paragraphs with it until a strong source fence.
    // Where the fence is uncertain this deliberately retains a broader parent.
    if (!frame && /:\s*$/u.test(block.text) && firstItem) {
      frame = { index: ++frameIndex, governor_index: index, level: block.heading?.level ?? governingLevel, evidence: 'LITERAL_COLON_FOLLOWED_BY_ENUMERATION', item_scheme: enumerationScheme(firstItem.text) }; frames += 1;
    }
    const followingTable = !frame && /:\s*$/u.test(block.text) ? nextSourceTable(blocks, index + 1) : null;
    if (followingTable) {
      frame = { index: ++frameIndex, governor_index: index, level: block.heading?.level ?? governingLevel, evidence: 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE', dependency_kind: 'SOURCE_TABLE_FORWARD_REFERENCE', table_evidence: followingTable.evidence }; tableFrames += 1;
    }
    // An attachment caption immediately followed by a list likewise governs
    // that list; a bare schedule title is not the complete schedule body.
    if (!frame && block.heading && firstItem && (block.heading.kind === 'attachment_heading' || block.heading.kind === 'caption_heading' && previousHeading?.kind === 'attachment_heading')) {
      frame = { index: ++frameIndex, governor_index: index, level: block.heading.level, evidence: 'SOURCE_ATTACHMENT_CAPTION_FOLLOWED_BY_ENUMERATION', item_scheme: enumerationScheme(firstItem.text) }; frames += 1;
    }
    if (frame) {
      block.list_frame = { ...frame, governor: index === frame.governor_index };
      if (block.heading && index > frame.governor_index) block.heading = { ...block.heading, original_level: block.heading.level, level: Math.max(3, frame.level + 1, block.heading.level), section_boundary: false, within_introduced_list_frame: true };
    }
    if (block.heading && !block.heading.within_introduced_list_frame) { governingLevel = block.heading.level; previousHeading = block.heading; }
  }
  if (frames) warnings.push({ code: 'INTRODUCED_LIST_FRAMES_RETAINED', count: frames, message: 'Literal colon/list or attachment-caption/list dependencies retain enumerated body and following qualifications together. Frames end at strong source boundaries; inferred parent scope and semantic completeness remain unverified.' });
  if (tableFrames) warnings.push({ code: 'INTRODUCED_TABLE_FRAMES_RETAINED', count: tableFrames, message: 'A literal colon followed by source tables retains captions, consecutive tables and following qualification/footnote text with its governor until a typed source fence. This conservative forward-reference frame does not verify column meanings or semantic closure.' });
  if (referenceFrames) warnings.push({ code: 'INTRODUCED_ATTACHMENT_REFERENCE_FRAMES_RETAINED', count: referenceFrames, message: 'A literal forward attachment-list governor retains listed references and following qualifications through page layout until a typed source fence. Listed labels do not reconstruct attachment bodies; strikeout effects, governing hierarchy and semantic closure remain unverified.' });
  return blocks;
}

function plainBlocks(content, origin = null, origins = originContext(null)) {
  const blocks = [];
  let originLines = [], pendingOrigins = [];
  const sourceLines = [...content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)].filter(match => match[0].length).map(match => ({ start: match.index, end: match.index + match[0].length }));
  const originIndex = origin ? indexedOrigin(origin) : null;
  let sourceLineIndex = 0;
  let lines = []; let rawLines = []; let navigationLines = []; let navigationOffset = 0; let firstIndent = 0; let paragraphContinuation = false; let paragraphQuote = false; let paragraphWrappedSentence = false; let startState = delimiterState();
  const state = delimiterState(); let lastParagraph = null; let indentedQuote = null; let wrapHeadingsSuppressed = 0;
  const flush = () => {
    const text = normalize(lines.join(' ')); lines = [];
    // Some EDGAR schedules have no TABLE tags. Repeated, aligned numeric fields
    // are source-layout evidence, not a semantic assertion about those fields.
    // A truncated label in one record cannot open a parenthesis over the rest
    // of the filing. Prose with assertion language does not use this rule.
    const numericLines = rawLines.filter((line) => (line.match(/\b\d[\d,./-]*\b/gu) ?? []).length >= 3 && /\S\s{2,}\S/u.test(line)).length;
    const fixedWidth = rawLines.length >= 2 && numericLines >= 2 && !assertion(text);
    rawLines = [];
    if (fixedWidth) Object.assign(state, startState);
    if (text) { const block = { text, kind: fixedWidth ? 'fixed_width_numeric_record' : 'paragraph', heading: paragraphContinuation || paragraphQuote || fixedWidth ? null : inferredHeading(text), continuation_at_start: paragraphContinuation, quote_context: paragraphQuote, source_sentence_continuation: paragraphWrappedSentence && !sentenceClosed(text), source_indent: firstIndent, fixed_width_numeric_record: fixedWidth, navigation_candidates: navigationLines.length ? navigationLines : undefined }; if (origin) block[ORIGIN] = normalizeOrigins(joinOrigins(originLines), text, origins); blocks.push(block); lastParagraph = block; }
    originLines = [];
    navigationLines = []; navigationOffset = 0;
    paragraphWrappedSentence = false;
  };
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const sourceLine = sourceLines[sourceLineIndex++];
    const lineOrigin = origin && sourceLine ? sliceOrigins(origin, sourceLine.start, sourceLine.end, origins, originIndex, sourceLine.end === content.length) : originRope();
    const text = normalize(raw);
    if (!text) { flush(); if (origin && lineOrigin.text) pendingOrigins.push(emptyOrigins(lineOrigin, origins)); continue; }
    const indent = raw.match(/^\s*/u)[0].length;
    if (!lines.length && indentedQuote != null && indent < indentedQuote) indentedQuote = null;
    if (!lines.length && lastParagraph && /:\s*$/u.test(lastParagraph.text) && indent > lastParagraph.source_indent && QUOTE_INTRODUCTION.test(lastParagraph.text)) indentedQuote = indent;
    const continuation = openDelimiter(state) || indentedQuote != null;
    // Join line wrapping before capitalization inference. Only literal typed
    // markers or enumerations can interrupt an existing paragraph, and never
    // while the source still places them inside a quotation or parenthesis.
    const proposedHeading = continuation ? null : inferredHeading(text);
    const wrappedSentence = proposedHeading && lines.length && unfinishedProse({ text: normalize(lines.join(' ')), heading: null });
    const heading = wrappedSentence ? null : proposedHeading;
    if (wrappedSentence) { wrapHeadingsSuppressed += 1; paragraphWrappedSentence = true; }
    const enumerated = numberedPrefix(text) || /^(?:\([a-zA-Z\d]+\)|[a-zA-Z][.)]|\d+(?:\.\d+)*[.)])\s+/u.test(text);
    const typedHeading = heading && heading.kind !== 'document_title';
    if (!continuation && lines.length && (typedHeading || enumerated)) flush();
    if (!lines.length) { firstIndent = indent; paragraphContinuation = openDelimiter(state); paragraphQuote = indentedQuote != null; startState = { ...state }; }
    if (origin) { if (!originLines.length && pendingOrigins.length) { for (const value of pendingOrigins) originLines.push(value); pendingOrigins = []; } originLines.push(lineOrigin); }
    const seed = navigationSeed(text, { sourceKind: 'literal_plain_source_line', raw_line_delimiter_continuation: Boolean(continuation), wrapped_sentence_continuation: Boolean(wrappedSentence) });
    if (seed) navigationLines.push(...shiftNavigation([seed], navigationOffset));
    navigationOffset += text.length + 1;
    lines.push(text);
    rawLines.push(raw);
    delimiters(text, state);
    if (typedHeading && !letteredPrefix(text)?.body) flush();
  }
  flush();
  if (origin && pendingOrigins.length && blocks.length) blocks.at(-1)[ORIGIN] = joinOrigins([blocks.at(-1)[ORIGIN], ...pendingOrigins]);
  return { blocks, title: '', excluded: [], warnings: wrapHeadingsSuppressed ? [{ code: 'WRAPPED_SENTENCE_HEADING_SUPPRESSED', count: wrapHeadingsSuppressed, message: 'An apparent heading on a wrapped source line was retained inside its unfinished paragraph; all literal text remains available for source review.' }] : [] };
}

function visibleText(tree, step = () => {}) {
  const parts = [];
  const pending = [{ node: tree, exit: false }];
  while (pending.length) {
    step(); const { node, exit } = pending.pop();
    if (exit) { if (BLOCKS.has(node.tagName)) parts.push('\n'); continue; }
    if (OMIT.has(node.tagName)) continue;
    const attrs = new Map((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
    if (attrs.has('hidden') || attrs.get('aria-hidden') === 'true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(attrs.get('style') ?? '')) continue;
    if (node.nodeName === '#text') parts.push(node.value ?? '');
    if (node.tagName === 'br' || BLOCKS.has(node.tagName) || ['td', 'th', 'tr', 'table'].includes(node.tagName)) parts.push('\n');
    pending.push({ node, exit: true });
    const children = node.childNodes ?? []; for (let index = children.length - 1; index >= 0; index -= 1) pending.push({ node: children[index], exit: false });
  }
  return parts.join('');
}

function legacySgmlBlocks(content, origins = originContext(null)) {
  const tableCount = (content.match(/<TABLE\b/giu) ?? []).length;
  // EDGAR's <S>/<C> column markers are not HTML rows. Strip only known framing
  // and formatting tags, preserving every visible line and literal comparison.
  const result = { blocks: [], title: '', excluded: [], warnings: [] }; const scopes = []; const tableStarts = new Set(); let cursor = 0; let tableIndex = 0;
  const append = (value, start, end) => {
    const stripped = value.replace(/<\/?(?:DOCUMENT|TYPE|SEQUENCE|FILENAME|DESCRIPTION|TEXT|PAGE|CAPTION|S|C)\b[^>]*>/giu, '\n');
    const escaped = stripped.replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
    const decoded = visibleText(parse(`<pre>${escaped}</pre>`));
    const paragraphs = plainBlocks(decoded, value ? origins.rawRun(start, end, decoded) : originRope(), origins);
    const scoped = paragraphs.blocks.map((block) => scopes.length ? { ...block, delimiter_scope: scopes.at(-1), source_table_scope: scopes.at(-1), kind: block.heading ? block.kind : 'table_sgml_text' } : block);
    if (scopes.length && scoped.length && !tableStarts.has(scopes.at(-1))) { scoped[0].source_table_start = true; tableStarts.add(scopes.at(-1)); }
    result.blocks.push(...scoped);
    result.warnings.push(...paragraphs.warnings);
  };
  // Table boundaries are literal source structure. A truncated location such
  // as "Sample City (AREA" must not place later contract articles in brackets.
  for (const marker of content.matchAll(/<\/?TABLE\b[^>]*>/giu)) {
    append(content.slice(cursor, marker.index), cursor, marker.index);
    if (/^<\//u.test(marker[0])) scopes.pop(); else scopes.push(`sgml_table_${++tableIndex}`);
    cursor = marker.index + marker[0].length;
  }
  append(content.slice(cursor), cursor, content.length);
  if (scopes.length) result.warnings.push({ code: 'SGML_UNCLOSED_TABLE_SCOPE', message: 'An explicit SGML table lacks a closing marker. Remaining source is retained in that uncertain layout scope.' });
  result.warnings.push({ code: 'SEC_SGML_LINES_PRESERVED', message: 'Legacy SGML source without HTML paragraphs/rows was kept as line-wrapped text before heading detection; no visible table text was discarded.' });
  if (tableCount) result.warnings.push({ code: 'SGML_TABLE_LAYOUT_UNCERTAIN', count: tableCount, message: 'SGML table text is retained without inventing HTML cells or assigning column roles. Consult the original fixed-width source for layout.' });
  return result;
}

function htmlBlocks(content, origins, bounds) {
  let work = 0, materializedCharacters = 0, nextMemoryCheck = 2048;
  const boundFailure = (code) => { const error = new Error('Complete HTML reconstruction exceeded a declared resource bound; no accepted partial body is emitted.'); error.code = code; throw error; };
  const step = (count = 1) => { work += count; if (work > bounds.maxWork) boundFailure('HTML_COLLECTION_WORK_BOUND'); if (work >= nextMemoryCheck) { if (process.memoryUsage().rss > bounds.maxMemoryBytes) boundFailure('HTML_COLLECTION_MEMORY_BOUND'); nextMemoryCheck = work + 2048; } };
  const materialized = (count) => { materializedCharacters += count; if (materializedCharacters > bounds.maxMaterializedCharacters) boundFailure('HTML_COLLECTION_MATERIALIZATION_BOUND'); step(); };
  if (process.memoryUsage().rss > bounds.maxMemoryBytes) boundFailure('HTML_COLLECTION_MEMORY_BOUND');
  function parseTree(value) {
    // The unchanged pinned tree adapter supplies all DOM semantics. Guard its
    // allocation/text entry points before they can grow an unbounded tree;
    // post-parse inventory alone would enforce the limit too late.
    let allocated = 1, decoded = 0;
    const allocate = () => { step(); if (++allocated > bounds.maxNodes) boundFailure('HTML_COLLECTION_NODE_BOUND'); };
    const text = value => { decoded += value.length; step(value.length || 1); if (decoded > bounds.maxDecodedCharacters) boundFailure('HTML_COLLECTION_DECODED_OUTPUT_BOUND'); };
    const parser = new Parser({ sourceCodeLocationInfo: true }), adapter = parser.treeAdapter;
    parser.treeAdapter = {
      ...adapter,
      createElement(tag,namespace,attrs) { allocate(); step(attrs.reduce((n,a)=>n+a.name.length+a.value.length+1,0)); return adapter.createElement(tag,namespace,attrs); },
      createDocumentFragment() { allocate(); return adapter.createDocumentFragment(); },
      createCommentNode(value) { allocate(); step(value.length || 1); return adapter.createCommentNode(value); },
      setDocumentType(document,...args) { if (!document.childNodes.some(n=>n.nodeName==='#documentType')) allocate(); return adapter.setDocumentType(document,...args); },
      insertText(parent,value) { text(value); if (parent.childNodes.at(-1)?.nodeName !== '#text') allocate(); return adapter.insertText(parent,value); },
      insertTextBefore(parent,value,before) { text(value); step(parent.childNodes.length); const index=parent.childNodes.indexOf(before); if (parent.childNodes[index-1]?.nodeName !== '#text') allocate(); return adapter.insertTextBefore(parent,value,before); },
    };
    parser.tokenizer.write(value,true); return parser.document;
  }
  const tree = parseTree(content);
  const pending = [tree];
  let body = tree; let title = ''; let nodes = 0;
  while (pending.length) {
    step(); if (++nodes > bounds.maxNodes) boundFailure('HTML_COLLECTION_NODE_BOUND');
    const node = pending.pop();
    if (node.tagName === 'body') body = node;
    if (node.tagName === 'title') title = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
    for (const child of node.childNodes ?? []) pending.push(child);
  }
  const blocks = []; const excluded = new Map(); const warnings = []; const sourceImages = [];
  const omittedReason = (node) => {
    if (OMIT.has(node.tagName)) return `inert_${node.tagName}_excluded`;
    const attrs = new Map((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
    return attrs.has('hidden') || attrs.get('aria-hidden') === 'true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(attrs.get('style') ?? '') ? 'hidden_html_excluded' : null;
  };
  // One persistent enter/text/exit tape. Subtrees are immutable range views,
  // not arrays copied through each ancestor. Visibility and decoding are
  // inspected once, independently of the paragraph/table work-stack depth.
  const tape = [], ranges = new WeakMap(), textCache = new WeakMap(), originCache = new WeakMap();
  const build = [{ node: body, depth: 0, exit: false, parent: null }]; let decodedCharacters = 0, maxBodyDepth = 0;
  const finishView = (info, parent) => { info.end = tape.length; if (parent) parent.asciiBases = Math.min(181,parent.asciiBases+info.asciiBases); };
  while (build.length) {
    step(); const { node, depth, exit, parent } = build.pop(), range = ranges.get(node);
    if (exit) {
      if (range.boundary) tape.push({ text: '\n', synthetic: true });
      if (node.tagName === 'table') tape.push({ note: 'nested_table_flattened' });
      finishView(range,parent); continue;
    }
    const info = { start: tape.length, end: tape.length, boundary: false, asciiBases: 0 }; ranges.set(node, info);
    const reason = omittedReason(node);
    if (reason) { tape.push({ note: reason }); finishView(info,parent); continue; }
    maxBodyDepth = Math.max(maxBodyDepth, depth);
    if (node.nodeName === '#text') {
      const value = node.value ?? ''; decodedCharacters += value.length;
      if (decodedCharacters > bounds.maxDecodedCharacters) boundFailure('HTML_COLLECTION_DECODED_OUTPUT_BOUND');
      // ASCII base characters survive NFC and the frozen zero/control filter.
      // 181 is a proof that the unchanged <=180-character heading grammar
      // cannot accept this subtree, without materializing it per ancestor.
      for (const unused of value.matchAll(/[A-Za-z0-9]/gu)) { if (++info.asciiBases === 181) break; }
      tape.push({ text: value, node }); finishView(info,parent); continue;
    }
    if (node.tagName === 'br') { tape.push({ text: '\n', synthetic: true }); finishView(info,parent); continue; }
    const attrs = new Map((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
    if (node.tagName === 'img') {
      const src = attrs.get('src') ?? '', alt = attrs.get('alt') ?? '', width = attrs.get('width') ?? null, height = attrs.get('height') ?? null;
      sourceImages.push({ src: src.slice(0, 2048), src_sha256: hash(src), src_truncated: src.length > 2048, alt: alt.slice(0, 2048), alt_sha256: hash(alt), alt_truncated: alt.length > 2048, width, height, page_sized_dimensions: Number(width) >= 300 && Number(height) >= 400, page_like_reference: /(?:page|pg)[_ -]?\d|\d{3,}\.(?:jpe?g|png|tiff?)\b/iu.test(src), alt_is_missing_or_filename: !alt.trim() || /\.(?:jpe?g|png|gif|tiff?)\]?\s*$/iu.test(alt), asset_read: false, alternative_text_is_verified_transcription: false });
    }
    info.boundary = BLOCKS.has(node.tagName) || ['td', 'th', 'tr', 'table'].includes(node.tagName) || /^h[1-6]$/.test(node.tagName ?? '');
    if (info.boundary) tape.push({ text: '\n', synthetic: true });
    build.push({ node, depth, exit: true, parent }); const children = node.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) build.push({ node: children[index], depth: depth + 1, exit: false, parent: info });
  }
  const note = (reason, count = 1) => excluded.set(reason, (excluded.get(reason) ?? 0) + count);
  const noteIndexes = new Map();
  for (let index = 0; index < tape.length; index += 1) { const reason = tape[index].note; if (reason) { if (!noteIndexes.has(reason)) noteIndexes.set(reason, []); noteIndexes.get(reason).push(index); } }
  function replayInlineNotes(node) {
    const range = ranges.get(node), counts = [];
    for (const [reason, positions] of noteIndexes) { const start = lowerBound(positions, range.start), end = lowerBound(positions, range.end); if (end > start) counts.push({ reason, count: end - start, first: positions[start] }); }
    counts.sort((a,b)=>a.first-b.first); for (const item of counts) note(item.reason,item.count);
  }
  function subtreeText(node) {
    if (textCache.has(node)) return textCache.get(node);
    const range = ranges.get(node), texts = [];
    for (let index = range.start; index < range.end; index += 1) { step(); if (tape[index].text) texts.push(tape[index].text); }
    const text = texts.join(''); materialized(text.length); textCache.set(node, text); return text;
  }
  const omit = (node) => {
    if (OMIT.has(node.tagName)) { note(`inert_${node.tagName}_excluded`); return true; }
    const attrs = new Map((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
    if (attrs.has('hidden') || attrs.get('aria-hidden') === 'true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(attrs.get('style') ?? '')) { note('hidden_html_excluded'); return true; }
    return false;
  };
  function inline(node, depth = 0) {
    step(); replayInlineNotes(node); return subtreeText(node);
  }
  let quoteDepth = 0; let listDepth = 0; let listItemDepth = 0;
  let emptyOriginPieces = [];
  function add(raw, kind = 'paragraph', heading = null, evidence = {}, origin = null) {
    const pieces = raw.split('\n').map(normalize).filter(Boolean);
    if (pieces.length > 1 && /^(?:ARTICLE|Article|CHAPTER|Chapter)\s+[IVXLC\d]+[.:]?$/u.test(pieces[0]) || pieces.length > 1 && /^(?:EXHIBIT|Exhibit|SCHEDULE|Schedule|APPENDIX|Appendix|ANNEX|Annex)\s+[\p{L}\d]+[.:]?$/u.test(pieces[0])) {
      const mapped = []; let start = 0; let leading = []; const originIndex = origin ? indexedOrigin(origin) : null;
      for (const line of raw.split('\n')) {
        const end = start + line.length, text = normalize(line);
        const value = origin ? normalizeOrigins(sliceOrigins(origin, start, end, origins, originIndex, end === raw.length), text, origins) : originRope(text, [{ text, unknown: true }]);
        if (text) { mapped.push(joinOrigins([originRope('', leading), value])); leading = []; }
        else if (mapped.length) mapped[mapped.length - 1] = joinOrigins([mapped.at(-1), value]);
        else for (const piece of value.pieces) leading.push(piece);
        // Source newlines become separators, with any sourced characters
        // consumed explicitly rather than reassigned to a title word.
        if (origin && end < raw.length) { const newline = emptyOrigins(sliceOrigins(origin, end, end + 1, origins, originIndex, end + 1 === raw.length), origins); if (mapped.length) mapped[mapped.length - 1] = joinOrigins([mapped.at(-1), newline]); else for (const piece of newline.pieces) leading.push(piece); }
        start = end + 1;
      }
      add(pieces[0], kind, null, evidence, mapped[0]); add(pieces.slice(1).join(' '), kind, null, evidence, joinOrigins(mapped.slice(1), ' ')); return;
    }
    const text = normalize(raw);
    const mapped = origin ? normalizeOrigins(origin, text, origins) : originRope(text, [{ text, unknown: true }]);
    if (text) {
      const block = { text, kind, heading: heading ?? inferredHeading(text, evidence), quote_context: quoteDepth > 0, source_list_item: listItemDepth > 0, source_list_depth: listDepth };
      block[ORIGIN] = originRope(text, [...emptyOriginPieces, ...mapped.pieces]); emptyOriginPieces = []; blocks.push(block);
    } else for (const piece of mapped.pieces) emptyOriginPieces.push(piece);
  }
  let buffer = '';
  let bufferOrigins = [];
  const flush = (kind) => { add(buffer, kind, null, {}, joinOrigins(bufferOrigins)); buffer = ''; bufferOrigins = []; };
  let tableIndex = 0; let navigationCaptionIndex = 0;
  // Navigation inspection must never increment the legacy exclusion ledger.
  // These pure helpers mirror inert visibility without calling note/omit/inline.
  function navigationOmitted(node) {
    if (OMIT.has(node.tagName)) return true;
    const attrs = new Map((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
    return attrs.has('hidden') || attrs.get('aria-hidden') === 'true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(attrs.get('style') ?? '');
  }
  function navigationInline(node, depth = 0) {
    step();
    if (depth > 256) return '';
    if (node.nodeName === '#text') return node.value ?? '';
    if (navigationOmitted(node)) return '';
    if (node.tagName === 'br') return '\n';
    const value = (node.childNodes ?? []).map((child) => navigationInline(child, depth + 1)).join('');
    return BLOCKS.has(node.tagName) || ['td', 'th', 'tr', 'table'].includes(node.tagName) || /^h[1-6]$/.test(node.tagName ?? '') ? `\n${value}\n` : value;
  }
  // Pure source sidecar traversal. It cannot increment the legacy exclusion
  // ledger and is used only for an actually emitted inline value.
  function inlineOrigins(node, depth = 0) {
    if (originCache.has(node)) return originCache.get(node);
    const range = ranges.get(node), values = [];
    for (let index = range.start; index < range.end; index += 1) { step(); const event = tape[index]; if (event.node) values.push(origins.node(event.node)); else if (event.synthetic) values.push(syntheticOrigin(event.text)); }
    const value = joinOrigins(values); materialized(value.text.length); originCache.set(node,value); return value;
  }
  const navigationEmphasis = (node) => ['b', 'strong', 'u'].includes(node.tagName) || /(?:font-weight\s*:\s*(?:bold|[7-9]00)|text-decoration\s*:\s*underline)/iu.test((node.attrs ?? []).find((attr) => attr.name === 'style')?.value ?? '');
  function allNavigationTextEmphasized(node, inherited = false, depth = 0) {
    step();
    if (depth > 256) return false;
    if (navigationOmitted(node)) return true;
    if (node.nodeName === '#text') return !node.value.trim() || inherited;
    const emphasized = inherited || navigationEmphasis(node);
    return (node.childNodes ?? []).every((child) => allNavigationTextEmphasized(child, emphasized, depth + 1));
  }
  function initialNavigationEmphasis(node) {
    let prefix = '', stopped = false, sawEmphasis = false;
    function collect(current, inherited = false, depth = 0) {
      step();
      if (stopped || depth > 256 || navigationOmitted(current)) return;
      const emphasized = inherited || navigationEmphasis(current);
      if (current.nodeName === '#text') {
        if (!current.value.trim()) { prefix += current.value; return; }
        if (!emphasized) { stopped = true; return; }
        sawEmphasis = true; prefix += current.value; return;
      }
      if (current.tagName === 'br') prefix += '\n';
      for (const child of current.childNodes ?? []) collect(child, emphasized, depth + 1);
    }
    collect(node);
    return sawEmphasis ? normalize(prefix) : '';
  }
  function annotateInitialNavigationCaption(first, prefix) {
    const block = blocks[first], seed = navigationSeed(prefix, { structural: true, sourceKind: 'inert_initial_emphasized_caption' });
    if (!block || !seed || seed.label !== prefix || !block.text.startsWith(prefix)) return;
    const remainder = block.text.slice(prefix.length).trim();
    // Emphasis on the subject of a sentence, a blank field, or an entity in a
    // contact line does not establish a caption. The literal delimiter may sit
    // just outside the emphasized element; no source punctuation is invented.
    if (remainder && !/[.:;]$/u.test(prefix) && !/^[.:;]\s*(?:\p{Lu}|\p{Ll})/u.test(remainder) && !NAV_TYPED_MARKER.test(prefix)) return;
    if (NAV_FORM_FIELD.test(block.text) || /^\s*,\s*(?:Inc\.?|LLC|Ltd\.?|Corp\.?)/iu.test(remainder)) return;
    block.navigation_candidates = [seed];
  }
  function annotateNavigationCaption(first, fullText) {
    const seed = navigationSeed(fullText, { structural: true, sourceKind: 'inert_whole_emphasized_source_caption' });
    if (!seed || seed.label !== fullText || !blocks.slice(first).length) return;
    const members = blocks.slice(first);
    if (normalize(members.map((block) => block.text).join(' ')) !== fullText) return;
    const group = { key: `source_caption_${++navigationCaptionIndex}`, label: fullText };
    for (const block of members) {
      block.navigation_candidates = [{ ...seed, label: block.text, relative_start: 0, relative_end: block.text.length, parts: [{ text: block.text, relative_start: 0, relative_end: block.text.length }], navigation_group: group }];
    }
  }
  function* rows(node, depth = 0, scope, stats) {
    if (omit(node)) return;
    if (node.nodeName === '#text') {
      const value = origins.node(node);
      if (!normalize(value.text)) for (const piece of emptyOrigins(value, origins).pieces) emptyOriginPieces.push(piece);
      else origins.issue('VISIBLE_TABLE_TEXT_OUTSIDE_CELLS_NOT_EMITTED', 'table');
      return;
    }
    if (node.tagName === 'caption') {
      const first = blocks.length;
      add(inline(node, depth + 1), 'table_caption', null, { structural: true }, inlineOrigins(node, depth + 1));
      for (let index = first; index < blocks.length; index += 1) { blocks[index].source_table_scope = scope; blocks[index].delimiter_scope = scope; }
      stats.captions += blocks.length - first;
      return;
    }
    if (node.tagName === 'tr') {
      stats.rows += 1;
      const cells = (node.childNodes ?? []).filter((child) => ['td', 'th'].includes(child.tagName));
      const cellOrigin = cell => { const value = inlineOrigins(cell, depth + 1); return normalizeOrigins(value, normalize(value.text), origins); };
      const directBlocks = (cell) => (cell.childNodes ?? []).filter((child) => BLOCKS.has(child.tagName) || /^h[1-6]$/.test(child.tagName ?? '') || child.tagName === 'table');
      const numericLabel = text => /^(?:(?:Section|SECTION|section)\s+)?\d+(?:\.\d+)*[.)]?$/u.test(text);
      let texts, numberedLabel = false;
      if (cells.length === 1 && directBlocks(cells[0]).length) {
        // The cell's actual block children are traversed below. The former
        // speculative full-cell read influenced only omission counters.
        // Replay those exact notes from its range, without copying an entire
        // document once for every enclosing one-cell layout table.
        replayInlineNotes(cells[0]); texts = [];
      } else if (cells.length === 2 && directBlocks(cells[1]).length > 1 && ranges.get(cells[1]).asciiBases > 180) {
        const first = normalize(inline(cells[0],depth+1));
        if (first && numericLabel(first)) { replayInlineNotes(cells[1]); texts = [first]; numberedLabel = true; }
        else texts = [first,normalize(inline(cells[1],depth+1))].filter(Boolean);
      } else texts = cells.map((cell) => normalize(inline(cell, depth + 1))).filter(Boolean);
      numberedLabel ||= texts.length === 2 && numericLabel(texts[0]);
      const trivia = current => { const value = inlineOrigins(current, depth + 1); if (normalize(value.text)) { origins.issue('VISIBLE_ROW_TEXT_OUTSIDE_CELLS_NOT_EMITTED', 'table'); return originRope(); } return emptyOrigins(value, origins); };
      // A single layout cell or a number-plus-multiparagraph cell may contain
      // the entire document. Keep its actual paragraph/heading structure.
      if (cells.length === 1 && directBlocks(cells[0]).length || numberedLabel && directBlocks(cells[1]).length > 1) {
        flush(); const first = blocks.length; const cell = cells.at(-1);
        const priorEmpty = numberedLabel ? emptyOriginPieces : []; if (numberedLabel) emptyOriginPieces = [];
        const before = [], after = []; let seenBody = false;
        for (const child of node.childNodes ?? []) { if (child === cell) { seenBody = true; continue; } if (cells.includes(child)) continue; (seenBody ? after : before).push(trivia(child)); }
        if (!numberedLabel) for (const value of before) for (const piece of value.pieces) emptyOriginPieces.push(piece);
        // A layout cell is normally bypassed to preserve its block children.
        // Its OWN hidden/inert visibility still governs those descendants;
        // bypassing that guard both leaked text in the legacy path and asks
        // the visible tape for ranges it correctly never created.
        if (!omittedReason(cell)) for (const child of cell.childNodes ?? []) yield walk(child, depth + 1);
        flush();
        for (let index = first; index < blocks.length; index += 1) blocks[index].source_table_scope ??= scope;
        if (numberedLabel && blocks[first]) {
          const prefix = `${texts[0]} | `;
          if (blocks[first].navigation_candidates) blocks[first].navigation_candidates = shiftNavigation(blocks[first].navigation_candidates, prefix.length);
          blocks[first].text = prefix + blocks[first].text; blocks[first].heading = inferredHeading(blocks[first].text);
          const leading = [], between = []; let seenNumber = false;
          for (const child of node.childNodes ?? []) { if (child === cells[0]) { seenNumber = true; continue; } if (child === cell) break; if (!cells.includes(child)) (seenNumber ? between : leading).push(trivia(child)); }
          blocks[first][ORIGIN] = joinOrigins([originRope('', priorEmpty), ...leading, cellOrigin(cells[0]), ...between, syntheticOrigin(' | '), blocks[first][ORIGIN] ?? originRope(blocks[first].text.slice(prefix.length), [{ text: blocks[first].text.slice(prefix.length), unknown: true }])]);
        }
        if (numberedLabel && !blocks[first]) emptyOriginPieces = priorEmpty.concat(emptyOriginPieces);
        for (const value of after) for (const piece of value.pieces) emptyOriginPieces.push(piece);
        return;
      }
      // Three-column TOCs and genuine inventory/data rows stay tabular. Only a
      // conservative number-plus-title layout row can propose a section path.
      if (texts.length) {
        const text = texts.join(' | '); const header = cells.every((cell) => cell.tagName === 'th');
        const row = { text, kind: header ? 'table_header' : 'table_row', heading: !header && numberedLabel ? inferredHeading(text) : null, heading_eligible: !header && numberedLabel, delimiter_scope: scope };
        // Navigation may index a source-supported label cell even when the
        // unchanged legacy partition correctly retains this as a table row.
        // Use the already collected literal text; never call inline/omit again.
        if (texts.length === 2 && !numberedLabel) {
          const label = texts[0], value = texts[1];
          const labelCell = cells.find((cell) => normalize(navigationInline(cell)) === label);
          const rowLabelEvidence = labelCell?.tagName === 'th' || allNavigationTextEmphasized(labelCell ?? {}) || assertion(value) || /^Re\s*:/iu.test(label);
          const seed = rowLabelEvidence && !/^\d/u.test(label) && !NAV_CITATION.test(label) && navigationSeed(label, { structural: true, sourceKind: 'literal_source_table_label_cell', table_layout: true });
          if (seed && seed.label === label) row.navigation_candidates = [seed];
          // A subject label in one cell explicitly identifies the next literal
          // cell as its caption; keep the cells as distinct exact pieces.
          if (/^Re\s*:$/iu.test(label) && navigationCaptionForm(value) && !navigationBlocked(value)) row.navigation_candidates = [{ label: normalize(text), relative_start: 0, relative_end: text.length, parts: [{ text: label, relative_start: 0, relative_end: label.length }, { text: value, relative_start: label.length + 3, relative_end: text.length }], kind: 'source_caption', source_evidence: { source_kind: 'literal_source_table_subject_cells', html_level: null, literal_typed_marker: false, source_layout_caption: true }, ambiguity: { table_layout: true } }];
        }
        const values = []; let emitted = false;
        for (const child of node.childNodes ?? []) { const value = cells.includes(child) ? cellOrigin(child) : trivia(child); if (value.text) { if (emitted) values.push(syntheticOrigin(' | ')); emitted = true; } values.push(value); }
        row[ORIGIN] = joinOrigins([originRope('', emptyOriginPieces), ...values]); emptyOriginPieces = []; blocks.push(row);
      } else for (const child of node.childNodes ?? []) for (const piece of trivia(child).pieces) emptyOriginPieces.push(piece);
      return;
    }
    for (const child of node.childNodes ?? []) yield rows(child, depth + 1, scope, stats);
  }
  function* walk(node, depth = 0) {
    if (node.nodeName === '#text') { buffer += node.value ?? ''; bufferOrigins.push(origins.node(node)); return; }
    if (omit(node)) return;
    if (node.tagName === 'br') { buffer += '\n'; bufferOrigins.push(syntheticOrigin('\n')); return; }
    if (node.tagName === 'table') {
      flush(); const first = blocks.length; const priorEmpty = [...emptyOriginPieces]; const scope = `html_table_${++tableIndex}`; const stats = { rows: 0, captions: 0 }; yield rows(node, depth + 1, scope, stats);
      if (!stats.rows || blocks.length === first) {
        // A rowless malformed table must still retain its entire visible text.
        // Replace only this collector's provisional caption blocks with that
        // same whole-table fallback so captions cannot hide or duplicate body.
        blocks.splice(first);
        emptyOriginPieces = priorEmpty;
        const text = normalize(inline(node, depth + 1));
        if (text) { const block = { text, kind: 'table_unstructured', heading: null, heading_eligible: false, delimiter_scope: scope }; block[ORIGIN] = joinOrigins([originRope('', emptyOriginPieces), normalizeOrigins(inlineOrigins(node, depth + 1), text, origins)]); emptyOriginPieces = []; blocks.push(block); warnings.push({ code: 'TABLE_WITHOUT_HTML_ROWS_RETAINED', message: 'Table has visible text without usable tr/td rows. All visible text is retained; original column/role layout needs source review.' }); }
        else for (const piece of emptyOrigins(inlineOrigins(node, depth + 1), origins).pieces) emptyOriginPieces.push(piece);
      }
      if (stats.rows && stats.captions) warnings.push({ code: 'HTML_TABLE_CAPTIONS_RETAINED', count: stats.captions, message: 'Genuine HTML caption text is retained in source-tree order beside its rows. Earlier recipes omitted such captions when rows were present; normalized bytes and downstream source identity can therefore change. Caption and column semantics remain unverified.' });
      if (blocks[first]) { blocks[first].source_table_start = true; blocks[first].source_table_scope ??= scope; }
      return;
    }
    if (/^h[1-6]$/.test(node.tagName ?? '')) {
      flush();
      const text = normalize(inline(node, depth + 1));
      const inferred = inferredHeading(text);
      add(text, 'explicit_heading', { ...inferred, level: inferred?.level ?? Number(node.tagName[1]), html_level: Number(node.tagName[1]), kind: 'explicit_heading', verified: false, confidence: 'explicit_html_structure_not_semantic_verification' }, {}, normalizeOrigins(inlineOrigins(node, depth + 1), text, origins));
      return;
    }
    if (node.tagName === 'pre') { flush(); const paragraphs = plainBlocks(inline(node, depth + 1), inlineOrigins(node, depth + 1), origins); if (paragraphs.blocks[0]) { const first = paragraphs.blocks[0]; first[ORIGIN] = joinOrigins([originRope('', emptyOriginPieces), first[ORIGIN]]); emptyOriginPieces = []; } blocks.push(...paragraphs.blocks.map((block) => ({ ...block, quote_context: block.quote_context || quoteDepth > 0 }))); warnings.push(...paragraphs.warnings); return; }
    const block = BLOCKS.has(node.tagName);
    if (block) flush();
    const navigationFirst = blocks.length;
    if (node.tagName === 'ol' || node.tagName === 'ul') listDepth += 1;
    if (node.tagName === 'li') listItemDepth += 1;
    if (node.tagName === 'blockquote' || node.tagName === 'q') quoteDepth += 1;
    // A whole source paragraph emphasized as a caption can support a heading;
    // a bold word inside ordinary text cannot. Styling still proves no meaning.
    const children = block ? (node.childNodes ?? []).filter((child) => child.nodeName !== '#text' || child.value.trim()) : [];
    const emphasis = (child) => ['b', 'strong', 'u'].includes(child.tagName) || /(?:font-weight\s*:\s*(?:bold|[7-9]00)|text-decoration\s*:\s*underline)/iu.test((child.attrs ?? []).find((attr) => attr.name === 'style')?.value ?? '');
    const emphasized = children.some(emphasis) && children.every((child) => emphasis(child) || /^(?:\d+(?:\.\d+)*[.)]?\s*)?$/u.test(normalize(inline(child, depth + 1))));
    const attrs = new Map((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
    const centered = block && (attrs.get('align') === 'center' || /(?:^|;)\s*text-align\s*:\s*center\s*(?:;|$)/iu.test(attrs.get('style') ?? ''));
    // This additional styling evidence is used only by the navigation index.
    // Neutral FONT/SPAN wrappers do not change the legacy emphasis decision,
    // collector output, source text, headings or partition boundaries.
    const navigationText = block && (centered || allNavigationTextEmphasized(node)) ? normalize(navigationInline(node, depth + 1)) : '';
    const navigationPrefix = block && !navigationText ? initialNavigationEmphasis(node) : '';
    let paragraphRaw = '';
    if (emphasized || centered) {
      if (ranges.get(node).asciiBases > 180) replayInlineNotes(node);
      else paragraphRaw = inline(node, depth + 1);
    }
    const paragraphText = normalize(paragraphRaw);
    if ((emphasized || centered) && inferredHeading(paragraphText, { structural: true })) {
      add(paragraphRaw, 'layout_caption', null, { structural: true }, inlineOrigins(node, depth + 1));
    } else {
    for (const child of node.childNodes ?? []) yield walk(child, depth + 1);
    if (block) flush(node.tagName === 'li' ? 'enumerated_paragraph' : 'paragraph');
    }
    if (navigationText) annotateNavigationCaption(navigationFirst, navigationText);
    else if (navigationPrefix) annotateInitialNavigationCaption(navigationFirst, navigationPrefix);
    if (node.tagName === 'blockquote' || node.tagName === 'q') { flush(); quoteDepth -= 1; }
    if (node.tagName === 'li') listItemDepth -= 1;
    if (node.tagName === 'ol' || node.tagName === 'ul') listDepth -= 1;
  }
  // Generators suspend local enter/exit state on the heap. The runner owns the
  // only traversal stack; nested table/layout callbacks never recurse in JS.
  const actions = [walk(body)];
  while (actions.length) { step(); const action = actions.at(-1).next(); if (action.done) actions.pop(); else actions.push(action.value); }
  flush();
  if (emptyOriginPieces.length && blocks.length) { const last = blocks.at(-1); last[ORIGIN] = joinOrigins([last[ORIGIN] ?? originRope(last.text, [{ text: last.text, unknown: true }]), originRope('', emptyOriginPieces)]); }
  if (maxBodyDepth > 256) warnings.push({ code: 'HTML_ALL_VISIBLE_DEEP_BODY_RECONSTRUCTED', body_relative_depth: maxBodyDepth, message: 'The bounded iterative collector retained the complete visible DOM beyond the former depth cut. This changes earlier incomplete bodies and requires new full-source review; heading and governing completeness remain unverified.' });
  if (excluded.has('nested_table_flattened')) warnings.push({ code: 'NESTED_TABLE_FLATTENED', message: 'Nested layout-table text is retained with cell boundaries but its inner column structure is flattened; inspect source context.' });
  let imageDependency = null;
  if (sourceImages.length) {
    const originalBody = content.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/iu)?.[1] ?? content.match(/<TEXT\b[^>]*>([\s\S]*?)<\/TEXT\s*>/iu)?.[1] ?? content;
    const bodyLines = visibleText(parseTree(originalBody), step).split('\n').map(normalize).filter(Boolean);
    const readable = normalize(bodyLines.join(' '));
    const words = readable.split(/\s+/u).filter(Boolean).length;
    const textualStatement = bodyLines.some((line) => assertion(line) || OPERATIVE.test(line) && !inferredHeading(line) && !OPENING_FORMULA.test(line));
    const headerOnly = !readable || readable.length < 300 && words < 30 && !textualStatement;
    imageDependency = { images: sourceImages, readable_body_characters: readable.length, readable_body_whitespace_segments: words, readable_text_present: !headerOnly, nonreconstructable_header_only: headerOnly, textual_body_reconstructable: headerOnly ? false : null, assessment: headerOnly ? 'ONLY_EMPTY_OR_SHORT_NONOPERATIVE_HEADER_TEXT_WITH_IMAGE_DEPENDENCIES' : 'TEXT_PRESENT_IMAGE_CONTENT_NOT_READ', image_pixels_read: false, ocr_run: false };
    warnings.push({ code: 'SOURCE_IMAGE_DEPENDENCIES', message: 'Referenced image content was not downloaded or read. ALT values and filenames are dependency evidence, not reconstructed contract terms.', image_count: sourceImages.length });
  }
  return { blocks, title: normalize(title), excluded: [...excluded].map(([reason, count]) => ({ reason, count })), warnings, image_dependency: imageDependency };
}

function classify(text, blocks) {
  if (OPERATIVE.test(text)) return { kind: 'operative', reason: 'operative_language_observed' };
  const cleaned = text.replace(/\s+/gu, ' ').trim();
  if (/^[\d\s.,|\-/]+$/u.test(cleaned) || /^(?:(?:page\s+)?\d+(?:\s+of\s+\d+)?|<PAGE>|BOEING PROPRIETARY)$/i.test(cleaned)) return { kind: 'structural_noise', reason: 'standalone_pagination_or_footer' };
  if (/\b(?:no|not|never|without|unless|except|prohibited|forbidden)\b/i.test(cleaned)) return { kind: 'unknown', reason: 'possible_negative_condition_requires_context' };
  if (blocks.every((block) => block.heading) && cleaned.split(' ').length < 20) return { kind: 'structural_noise', reason: 'heading_without_body_retained' };
  // Tables, schedules, contact information and signatures remain unknown unless
  // they meet a narrowly verifiable noise rule. Their contractual role needs audit.
  return { kind: 'unknown', reason: blocks.some((block) => block.kind.startsWith('table_')) ? 'table_or_schedule_requires_context' : 'no_operative_language_classification' };
}

function functionTags(text) {
  const tags = FUNCTIONS.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
  return tags.length ? tags : ['unknown'];
}

function lowerBound(values, target) {
  let low = 0; let high = values.length;
  while (low < high) { const mid = (low + high) >>> 1; if (values[mid] < target) low = mid + 1; else high = mid; }
  return low;
}

/** Full source and section parents survive even when representation units split. */
export function extractSections(record, options = {}) {
  if (!record || typeof record.content !== 'string' || !['html', 'text'].includes(record.format)) throw new TypeError('record requires content and format html or text');
  const maxRawBytes = integer(options.maxRawBytes ?? 8 * 1024 * 1024, 'maxRawBytes', 1024, 64 * 1024 * 1024);
  const maxCharacters = integer(options.maxCharacters ?? options.maxContentChars ?? 8 * 1024 * 1024, 'maxCharacters', 1024, 64 * 1024 * 1024);
  const minSectionWords = integer(options.minSectionWords ?? options.minWords ?? 20, 'minSectionWords', 1, 2000);
  const maxChunkWords = integer(options.maxChunkWords ?? options.maxUnitWords ?? options.maxEmbeddingChunkWords ?? 300, 'maxChunkWords', 20, 4000);
  const contextWords = integer(options.contextWords ?? 60, 'contextWords', 0, 500);
  const boundaryLevel = integer(options.sectionBoundaryLevel ?? 2, 'sectionBoundaryLevel', 1, 6);
  const htmlBounds = {
    maxNodes: integer(options.maxHtmlNodes ?? 1000000, 'maxHtmlNodes', 1, 2000000),
    maxDecodedCharacters: integer(options.maxHtmlDecodedCharacters ?? maxRawBytes, 'maxHtmlDecodedCharacters', 1, 512 * 1024 * 1024),
    maxWork: integer(options.maxHtmlWork ?? maxCharacters * 128, 'maxHtmlWork', 1, 16 * 1024 * 1024 * 1024),
    maxMaterializedCharacters: integer(options.maxHtmlMaterializedCharacters ?? maxCharacters * 32, 'maxHtmlMaterializedCharacters', 1, 2 * 1024 * 1024 * 1024),
    maxMemoryBytes: integer(options.maxHtmlMemoryBytes ?? 4 * 1024 * 1024 * 1024, 'maxHtmlMemoryBytes', 1024 * 1024, 6 * 1024 * 1024 * 1024),
  };
  const { content, ...metadata } = record;
  const contract = { ...metadata, id: String(record.id ?? `contract-${hash(record.source_url ?? content).slice(0, 20)}`), source_url: String(record.source_url ?? '') };
  const result = { contract, status: 'accepted', normalized_text: '', normalized_sha256: hash(''), sections: [], units: [], warnings: [], excluded: [], parameters: { maxRawBytes, maxCharacters, minSectionWords, maxChunkWords, contextWords, sectionBoundaryLevel: boundaryLevel, offsets: 'UTF16_IN_NORMALIZED_TEXT', word_index: 'PRECOMPUTED_ONCE_PER_DOCUMENT', word_count_basis: 'whitespace_segments_not_tokenizer_tokens', heading_policy: 'SOURCE_NATIVE_PROSE_AND_PAGE_TRANSPARENT_CONTINUITY_V9_UNVERIFIED', attachment_reference_policy: 'LITERAL_FORWARD_GOVERNOR_AND_ATTACHMENT_REFERENCES_V12_UNVERIFIED', source_navigation_policy: 'V13_NAVIGATION_ONLY_SHARED_FILTERS_LITERAL_CAPTIONS_NOT_GOVERNING_HIERARCHY', parent_completeness: 'FULL_STORED_SOURCE_SPAN_NOT_VERIFIED_COMPLETE_GOVERNING_HIERARCHY', image_policy: 'REJECT_NONRECONSTRUCTABLE_IMAGE_BODY_NO_OCR_OR_ASSET_FETCH', noise_policy: 'NARROW_NOISE_RULES_UNKNOWN_CONTENT_RETAINED' } };
  const identity = options.nativeDecorationIdentity ?? {};
  for (const key of ['tracerSourceSHA256', 'collectorSourceSHA256']) if (identity[key] != null && !/^[a-f0-9]{64}$/u.test(identity[key])) throw new TypeError(`Invalid native decoration ${key}`);
  result.parameters.native_decoration_policy = NATIVE_DECORATION_POLICY;
  result.parameters.native_collector_policy = NATIVE_COLLECTOR_POLICY;
  result.parameters.html_body_policy = HTML_BODY_POLICY;
  result.parameters.html_collection_bounds = htmlBounds;
  let nativeTrace = null, origins = originContext(null), emittedBlocks = [], nativeFormat = record.format;
  const finish = () => {
    const segments = originSegments(emittedBlocks, origins);
    const binding = { raw: content, normalizedText: result.normalized_text, trace: nativeTrace, format: nativeFormat, tracerSourceSHA256: identity.tracerSourceSHA256, collectorSourceSHA256: identity.collectorSourceSHA256, collectorSegments: segments, collectorIssues: origins.issues };
    let envelope;
    if (!nativeTrace || !identity.tracerSourceSHA256 || !identity.collectorSourceSHA256) {
      origins.issue(nativeTrace ? 'NATIVE_SOURCE_IDENTITY_UNBOUND' : 'NATIVE_TRACE_NOT_AVAILABLE');
      envelope = unresolvedNativeDecoration(binding);
    } else {
      try { envelope = bindNativeDecoration(nativeTrace, binding); }
      catch (error) { origins.issue(nativeFailureCode('bind', error), 'bind'); envelope = unresolvedNativeDecoration(binding); }
    }
    result.native_source_decorations = envelope;
    const reference = (start, end) => ({ envelope_sha256: envelope.sha256, raw_sha256: envelope.raw.sha256, normalized_sha256: envelope.normalized.sha256, tracer_source_sha256: envelope.tracer_source_sha256, collector_source_sha256: envelope.collector_source_sha256, policy: envelope.policy, collector_policy: NATIVE_COLLECTOR_POLICY, start, end, mapping_status: envelope.mapping_status, input_eligibility: envelope.input_eligibility, projection_required: true });
    for (const section of result.sections) section.native_source_decorations_ref = reference(section.start, section.end);
    for (const unit of result.units) unit.native_source_decorations_ref = reference(unit.start, unit.end);
    return result;
  };
  const reject = (code, message) => { result.status = 'rejected'; result.warnings.push({ code, message }); result.excluded.push({ reason: code.toLowerCase() }); return finish(); };
  if (!content.trim()) return reject('EMPTY_SOURCE', 'Source has no readable content.');
  if (content.length > maxCharacters || Buffer.byteLength(content, 'utf8') > maxRawBytes) return reject('SOURCE_BOUND_EXCEEDED', 'Source exceeds the declared character or UTF-8 byte bound; it was not truncated.');
  const status = record.http_status ?? record.status_code;
  if (status != null && (!Number.isInteger(status) || status < 200 || status >= 300)) return reject('HTTP_STATUS', 'Source is not a successful document response.');
  const replacementCount = (content.match(/\uFFFD/g) ?? []).length;
  const nulCount = (content.match(/\u0000/g) ?? []).length;
  if (replacementCount >= 4 && replacementCount / content.length > 0.01 || nulCount / content.length > 0.002) return reject('ENCODING_FAILURE', 'Substantial undecodable or NUL characters require source-decoding review.');
  if (replacementCount) result.warnings.push({ code: 'ENCODING_REPLACEMENTS', message: `${replacementCount} replacement characters remain; unknown bytes were not repaired.` });
  const sgml = record.format === 'text' && /<DOCUMENT>|<TEXT>|<TABLE>/i.test(content);
  const htmlStructure = /<(?:html|body|p|div|pre|h[1-6]|tr|td|br|img|script|style|template)\b/iu.test(content);
  nativeFormat = sgml && !htmlStructure ? 'legacy-sgml' : record.format === 'html' || sgml ? 'html' : 'text';
  let traceFailure = null;
  try { nativeTrace = traceNativeDecoration(content, { format: nativeFormat, maxRawBytes }); }
  catch (error) { traceFailure = nativeFailureCode('trace', error); }
  origins = originContext(nativeTrace);
  if (!nativeTrace) origins.issue(traceFailure ?? 'NATIVE_TRACE_NOT_AVAILABLE', 'trace');
  let collected;
  try { collected = sgml && !htmlStructure ? legacySgmlBlocks(content, origins) : record.format === 'html' || sgml ? htmlBlocks(content, origins, htmlBounds) : plainBlocks(content, origins.rawRun(0, content.length, content), origins); }
  catch (error) {
    if (!/^HTML_COLLECTION_(?:WORK|MEMORY|MATERIALIZATION|NODE|DECODED_OUTPUT)_BOUND$/u.test(error?.code ?? '')) throw error;
    result.reconstruction_status = 'BLOCKED_INCOMPLETE_HTML_RESOURCE_BOUND';
    origins.issue(error.code, 'collector');
    return reject(error.code, 'The declared HTML reconstruction bound was exceeded. The raw source is retained; no accepted partial text or discovery units were emitted.');
  }
  if (sgml && htmlStructure) result.warnings.push({ code: 'SEC_SGML_INERT_PARSE', message: 'SEC source contains actual HTML structure and was parsed as an inert tree; inspect source-format fidelity.' });
  result.warnings.push(...collected.warnings); result.excluded.push(...collected.excluded);
  result.source_dependencies = { image_body: collected.image_dependency ?? null };
  let offset = 0; const path = [];
  const blocks = sectionBlocks(collected.blocks, result.warnings, origins).map((candidate) => {
    const listScope = path.some((label) => /^(?:(?:PERMITTED|APPROVED|AUTHORIZED)\b.*\b(?:MANAGERS|SUPPLIERS|ENTITIES|SIGNATORIES)|LIST OF\b)/iu.test(label));
    const block = listScope && candidate.heading?.kind === 'numbered_heading' && !SECTION_TITLE_CUE.test(numberedPrefix(candidate.text)?.title ?? candidate.text) ? { ...candidate, heading: null, kind: 'enumerated_list_item' } : candidate;
    if (block.heading) { path.splice(block.heading.level - 1); path[block.heading.level - 1] = block.heading.label ?? block.text; }
    const indexed = { ...block, start: offset, end: offset + block.text.length, heading_path: path.filter(Boolean) };
    offset = indexed.end + 2; return indexed;
  });
  result.normalized_text = blocks.map((block) => block.text).join('\n\n');
  result.normalized_sha256 = hash(result.normalized_text);
  emittedBlocks = blocks;
  const navigationAnchors = navigationForBlocks(blocks, contract.id, result.normalized_text);
  const navigationStarts = navigationAnchors.map((item) => item.start);
  if (collected.image_dependency?.nonreconstructable_header_only) {
    result.reconstruction_status = 'NONRECONSTRUCTABLE_SOURCE';
    return reject('NONRECONSTRUCTABLE_IMAGE_BODY', 'Only empty or short nonoperative header text is reconstructable from this image-dependent source. Raw source and image references are preserved; no OCR, image text or discovery units were invented.');
  }
  if (!result.normalized_text) return reject('EMPTY_EXTRACTION', 'Inert extraction produced no readable text.');
  const scriptProfile = Object.fromEntries(['Han', 'Hiragana', 'Katakana', 'Hangul', 'Arabic', 'Cyrillic'].map((script) => [script, [...result.normalized_text.matchAll(new RegExp(`\\p{Script=${script}}`, 'gu'))].length]).filter(([, count]) => count > 0));
  result.script_profile = scriptProfile;
  if (Object.keys(scriptProfile).length) result.warnings.push({ code: 'NON_LATIN_SCRIPT_OBSERVED', message: 'Observed scripts are retained without language exclusion. Whitespace word counts may poorly describe their segmentation; an English embedding model requires separate transfer evaluation.', script_profile: scriptProfile });
  const statusPattern = /access denied|request rate threshold exceeded|undeclared automated tool|too many requests|service unavailable|internal server error|page not found|verify (?:that )?you are human|captcha/i;
  if (statusPattern.test(collected.title) || /^(?:SEC(?:\.gov)?[ |:\-]*)?(?:access denied|request rate threshold exceeded|too many requests|service unavailable|internal server error|page not found|verify (?:that )?you are human|captcha)\b/i.test(result.normalized_text) || /your request originates from an undeclared automated tool/i.test(result.normalized_text.slice(0, 1000))) return reject('STATUS_PAGE', 'Source appears to be an error or access-control response.');
  const matches = [...result.normalized_text.matchAll(/\S+/gu)];
  const starts = matches.map((match) => match.index); const ends = matches.map((match) => match.index + match[0].length);
  const range = (start, end) => [lowerBound(starts, start), lowerBound(starts, end)];
  const before = (start) => { if (!contextWords) return ''; const word = lowerBound(starts, start); return word ? result.normalized_text.slice(starts[Math.max(0, word - contextWords)], start).trim() : ''; };
  const after = (end) => { if (!contextWords) return ''; const word = lowerBound(starts, end); return word < starts.length ? result.normalized_text.slice(end, ends[Math.min(ends.length - 1, word + contextWords - 1)]).trim() : ''; };
  const spans = []; let begin = 0; let bodySeen = false;
  for (let index = 1; index < blocks.length; index += 1) {
    const prior = blocks[index - 1];
    if (!prior.heading && !['layout_label', 'contact_label'].includes(prior.kind)) bodySeen = true;
    if (blocks[index].heading && (blocks[index].heading.level <= boundaryLevel || blocks[index].heading.section_boundary) && bodySeen) { spans.push([begin, index]); begin = index; bodySeen = false; }
  }
  spans.push([begin, blocks.length]);
  for (const [first, last] of spans) {
    const members = blocks.slice(first, last); const start = members[0].start; const end = members.at(-1).end;
    // An article/caption/section title chain stays beside its first body rather
    // than producing a supposedly reviewable parent containing only a title.
    const firstBody = members.findIndex((member) => !member.heading && !['layout_label', 'contact_label'].includes(member.kind));
    const anchor = members.slice(0, firstBody < 0 ? members.length : firstBody).findLast((member) => member.heading && (member.heading.level <= boundaryLevel || member.heading.section_boundary)) ?? members[0];
    const text = result.normalized_text.slice(start, end); const sha256 = hash(text);
    const classification = classify(text, members); const [firstWord, endWord] = range(start, end);
    const section = { id: `${contract.id}:section:${start}-${end}:${sha256.slice(0, 12)}`, contract_id: contract.id, source_url: contract.source_url, text, start, end, heading: anchor.heading_path.at(-1) ?? '', heading_path: anchor.heading_path, heading_provenance: anchor.heading ?? null, boundary_verified: false, sha256, word_count: endWord - firstWord, word_count_basis: 'whitespace_segments_not_tokenizer_tokens', kind: classification.kind, classification_reason: classification.reason, warnings: [], context_before: before(start), context_after: after(end), subheadings: members.filter((member) => member.heading).map((member) => ({ text: member.text, start: member.start, end: member.end, level: member.heading.level, heading_path: member.heading_path, provenance: member.heading })), units: [] };
    section.source_navigation_anchors = navigationAnchors.slice(lowerBound(navigationStarts, start), lowerBound(navigationStarts, end)).filter((item) => item.end <= end);
    const suppressedPresentations = members.filter((member) => member.source_heading_presentation).map((member) => ({ start: member.start, end: member.end, ...member.source_heading_presentation, reason: member.heading_suppressed_reason ?? 'source_continuation_not_independent_boundary' }));
    if (suppressedPresentations.length) section.suppressed_heading_presentations = suppressedPresentations;
    section.completeness = { full_stored_span_retained: true, governing_hierarchy_verified: false, semantic_completeness_verified: false, basis: 'SOURCE_SPAN_WITH_CONSERVATIVE_GOVERNOR_FRAMES' };
    const frames = new Map();
    for (const member of members) if (member.list_frame) {
      const key = member.list_frame.index;
      if (!frames.has(key)) frames.set(key, { first: member, last: member, governor: member.list_frame.governor ? member : null, evidence: member.list_frame.evidence, dependency_kind: member.list_frame.dependency_kind, native_scope_level: member.list_frame.native_scope_level ?? null, prior_frame_indices: member.list_frame.prior_frame_indices ?? [] });
      const frame = frames.get(key); frame.last = member; if (member.list_frame.governor) frame.governor = member;
    }
    const frameId = (frame) => `${contract.id}:frame:${frame.first.start}-${frame.last.end}:${hash(result.normalized_text.slice(frame.first.start, frame.last.end)).slice(0, 12)}`;
    section.governor_frames = [...frames].map(([key, frame]) => ({ id: frameId(frame), start: frame.first.start, end: frame.last.end, sha256: hash(result.normalized_text.slice(frame.first.start, frame.last.end)), governor: frame.governor ? { start: frame.governor.start, end: frame.governor.end, text: frame.governor.text, sha256: hash(frame.governor.text) } : null, source_evidence: frame.evidence, boundary_verified: false, semantic_completeness_verified: false, closure: [...frames.values()].some((other) => other.prior_frame_indices.includes(key)) ? 'NEXT_LITERAL_FORWARD_GOVERNOR_NOT_PROOF_OF_SEMANTIC_CLOSURE' : last < blocks.length ? 'NEXT_STRONG_SOURCE_BOUNDARY' : 'END_OF_RETAINED_SOURCE_NOT_PROOF_OF_SEMANTIC_CLOSURE', ...(frame.dependency_kind === 'ATTACHMENT_REFERENCE_LIST_FORWARD_DEPENDENCY' ? { dependency_kind: frame.dependency_kind, source_native_scope_level: frame.native_scope_level, reference_contents_reconstructed: false, strikeout_effect_verified: false, prior_source_frames: frame.prior_frame_indices.filter((prior) => frames.has(prior)).map((prior) => ({ id: frameId(frames.get(prior)), start: frames.get(prior).first.start, end: frames.get(prior).last.end, source_evidence: frames.get(prior).evidence, relation: 'PRECEDING_CONSERVATIVE_SOURCE_FRAME_NOT_VERIFIED_GOVERNOR' })) } : {}) }));
    if (section.governor_frames.some((frame) => frame.source_evidence !== 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE')) section.warnings.push({ code: 'GOVERNOR_LIST_CONTEXT_RETAINED', message: 'Introduced items and subsequent qualification/cost paragraphs share this stored parent. Frame scope is conservative source structure and still requires actual source review.' });
    if (section.governor_frames.some((frame) => frame.source_evidence === 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE')) section.warnings.push({ code: 'GOVERNOR_TABLE_CONTEXT_RETAINED', message: 'Introduced tables and following shared qualifications remain in this stored parent. Table layout and semantic completeness are unverified and require actual source reading.' });
    if (section.governor_frames.some((frame) => frame.source_evidence === 'LITERAL_COLON_FOLLOWED_BY_ATTACHMENT_REFERENCES')) section.warnings.push({ code: 'GOVERNOR_ATTACHMENT_REFERENCE_CONTEXT_RETAINED', message: 'The literal reference-list governor and listed labels share the retained parent. This does not reconstruct referenced plans, riders or other attachment contents, interpret strikeout effects, or verify governing hierarchy.' });
    if (section.word_count > 1500) section.warnings.push({ code: 'LONG_SECTION_REQUIRES_BOUNDARY_REVIEW', message: 'A long parent can contain unresolved section boundaries. Its complete text is retained; heading paths are hypotheses, not verified semantic structure.' });
    if (!anchor.heading && !anchor.heading_path.length) section.warnings.push({ code: 'UNKNOWN_HEADING_STRUCTURE_RETAINED', message: 'No reliable heading was inferred. Full source and bounded units remain available for manual boundary review.' });
    if (section.word_count < minSectionWords) section.warnings.push({ code: 'SHORT_SECTION_RETAINED', message: 'Below target size; potentially operative short provisions and continuations are retained.' });
    if (/^[a-z]|^\(?\d+\)?\s+(?:day|days|month|months)\b/.test(text) && !members[0].heading) section.warnings.push({ code: 'POSSIBLE_CONTINUATION_START', message: 'Section starts like a continuation; consult retained source and neighboring context.' });
    const memberStarts = members.map((member) => member.start);
    let cursor = firstWord;
    while (cursor < endWord) {
      let limit = Math.min(cursor + maxChunkWords, endWord);
      if (limit < endWord) {
        // Prefer paragraph end, then sentence end; neither changes the full parent.
        const minimum = cursor + Math.floor(maxChunkWords * 0.5);
        const paragraphEnds = members.map((member) => lowerBound(starts, member.end)).filter((value) => value >= minimum && value <= limit);
        if (paragraphEnds.length) limit = paragraphEnds.at(-1);
        else for (let candidate = limit - 1; candidate >= minimum; candidate -= 1) if (/[.;!?][”"')\]]?$/.test(matches[candidate][0])) { limit = candidate + 1; break; }
      }
      const unitStart = starts[cursor]; const unitEnd = ends[limit - 1]; const unitText = result.normalized_text.slice(unitStart, unitEnd); const digest = hash(unitText);
      const localHeadingPath = members[Math.max(0, lowerBound(memberStarts, unitStart + 1) - 1)].heading_path;
      const unitWarnings = [...section.warnings];
      if (firstWord !== cursor || limit !== endWord) unitWarnings.push({ code: 'CHUNK_IN_COMPLETE_SECTION', message: 'Embedding unit is part of a fully retained stored source span; governing hierarchy and semantic completeness are unverified. An exception or condition can appear elsewhere in the parent.' });
      if (/\b(?:if|unless|except|provided|notwithstanding|subject to|and|or)[\s,:;]*$/i.test(unitText)) unitWarnings.push({ code: 'POSSIBLE_CONDITION_CONTINUATION', message: 'Trailing condition/conjunction may continue in the next unit; consult parent section.' });
      section.units.push({ id: `${section.id}:unit:${unitStart}-${unitEnd}:${digest.slice(0, 12)}`, parent_section_id: section.id, parent_governing_hierarchy_verified: false, governor_frame_ids: section.governor_frames.filter((frame) => frame.start < unitEnd && frame.end > unitStart).map((frame) => frame.id), contract_id: contract.id, source_url: contract.source_url, text: unitText, start: unitStart, end: unitEnd, heading: localHeadingPath.at(-1) ?? '', heading_path: localHeadingPath, heading_verified: false, sha256: digest, word_count: limit - cursor, word_count_basis: 'whitespace_segments_not_tokenizer_tokens', kind: section.kind, classification_reason: section.classification_reason, function_tags: functionTags(unitText), warnings: unitWarnings, context_before: before(unitStart), context_after: after(unitEnd), chunk_index: section.units.length });
      section.units.at(-1).source_navigation = sourceNavigationForRange(section.source_navigation_anchors, unitStart, unitEnd);
      cursor = limit;
    }
    for (const unit of section.units) { unit.chunk_count = section.units.length; result.units.push(unit); }
    result.sections.push(section);
  }
  if (!result.units.some((unit) => unit.kind !== 'structural_noise')) return reject('NO_SUBSTANTIVE_CONTENT', 'Extraction contains only narrowly identified structural noise; all source text remains retained.');
  return finish();
}

/** Deterministic function coverage and parent diversity, with explicit bounds. */
export function selectUnits(sectionRecords, options = {}) {
  if (!Array.isArray(sectionRecords)) throw new TypeError('selectUnits requires an array of section or unit records');
  const seed = String(options.seed ?? 'nonverba-study-v0.2');
  const maxPerContract = integer(options.maxPerContract ?? 40, 'maxPerContract', 1, 1000000);
  const maxUnits = options.maxUnits == null ? Number.MAX_SAFE_INTEGER : integer(options.maxUnits, 'maxUnits', 1, Number.MAX_SAFE_INTEGER);
  const rows = sectionRecords.flatMap((section) => Array.isArray(section.units) ? section.units : [section]);
  const ids = new Set(); const pools = new Map(); const exclusions = new Map();
  const key = (row, salt = '') => hash(JSON.stringify([seed, row.contract_id, row.id, salt]));
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.contract_id !== 'string' || !row.contract_id || typeof row.text !== 'string' || !row.text.trim()) throw new TypeError('Selection rows require distinct id, contract_id and nonempty text');
    ids.add(row.id);
    if (row.kind === 'structural_noise') { exclusions.set(row.id, 'structural_noise_retained_in_extraction'); continue; }
    if (!pools.has(row.contract_id)) pools.set(row.contract_id, []);
    pools.get(row.contract_id).push({ ...row, function_tags: functionTags(row.text) });
  }
  const chosenPools = new Map(); const coverage = [];
  for (const [contractId, pool] of pools) {
    const ranks = new Map(pool.map((row) => [row.id, key(row)]));
    const ordered = [...pool].sort((left, right) => ranks.get(left.id).localeCompare(ranks.get(right.id)) || left.id.localeCompare(right.id));
    const observedTags = unique(ordered.flatMap((row) => row.function_tags)).sort((left, right) => hash(`${seed}:${contractId}:${left}`).localeCompare(hash(`${seed}:${contractId}:${right}`)));
    const chosen = []; const chosenIds = new Set(); const parents = new Set();
    const take = (row) => { if (row && chosen.length < maxPerContract && !chosenIds.has(row.id)) { chosen.push(row); chosenIds.add(row.id); parents.add(row.parent_section_id ?? row.id); } };
    for (const tag of observedTags) take(ordered.find((row) => !chosenIds.has(row.id) && row.function_tags.includes(tag)));
    for (const row of ordered) if (!parents.has(row.parent_section_id ?? row.id)) take(row);
    for (const row of ordered) take(row);
    for (const row of pool) if (!chosenIds.has(row.id)) exclusions.set(row.id, 'explicit_per_contract_unit_bound');
    chosenPools.set(contractId, chosen);
    coverage.push({ contract_id: contractId, available_units: pool.length, observed_function_tags: observedTags, planned_units: chosen.length });
  }
  const contractOrder = [...chosenPools.keys()].sort((left, right) => hash(`${seed}:${left}`).localeCompare(hash(`${seed}:${right}`)) || left.localeCompare(right));
  const selected = [];
  for (let rank = 0; rank < maxPerContract && selected.length < maxUnits; rank += 1) for (const contractId of contractOrder) {
    const row = chosenPools.get(contractId)[rank]; if (row) selected.push(row); if (selected.length === maxUnits) break;
  }
  const selectedIds = new Set(selected.map((row) => row.id));
  for (const pool of chosenPools.values()) for (const row of pool) if (!selectedIds.has(row.id)) exclusions.set(row.id, 'explicit_global_unit_bound');
  const selectedByContract = new Map();
  for (const row of selected) { if (!selectedByContract.has(row.contract_id)) selectedByContract.set(row.contract_id, []); selectedByContract.get(row.contract_id).push(row); }
  for (const record of coverage) {
    const selectedRows = selectedByContract.get(record.contract_id) ?? [];
    record.selected_units = selectedRows.length;
    record.selected_function_tags = unique(selectedRows.flatMap((row) => row.function_tags)).sort();
    record.unrepresented_function_tags = record.observed_function_tags.filter((tag) => !record.selected_function_tags.includes(tag));
    record.selected_parent_count = new Set(selectedRows.map((row) => row.parent_section_id ?? row.id)).size;
  }
  return { selected, excluded: rows.filter((row) => exclusions.has(row.id)).map((row) => ({ id: row.id, contract_id: row.contract_id, parent_section_id: row.parent_section_id ?? null, start: row.start, end: row.end, sha256: row.sha256, kind: row.kind, reason: exclusions.get(row.id) })), coverage: coverage.sort((left, right) => left.contract_id.localeCompare(right.contract_id)), parameters: { seed, maxPerContract, maxUnits, algorithm: 'seeded_function_coverage_then_parent_diversity_then_round_robin_contracts', function_tags_are: 'lexical_sampling_categories_not_discovered_priors', short_operative_units: 'retained' } };
}

const unique = (values) => [...new Set(values)];

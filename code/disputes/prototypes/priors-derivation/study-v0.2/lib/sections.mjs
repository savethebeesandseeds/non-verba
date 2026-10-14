// SPDX-License-Identifier: AGPL-3.0-only
// Study v0.2: inert, section-preserving representation and auditable selection.
import { createHash } from 'node:crypto';
import { parse } from 'parse5';

const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const normalize = (value) => value.normalize('NFC').replace(/[\u200B\uFEFF]/gu, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '').replace(/\s+/gu, ' ').trim();
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

function sectionBlocks(input, warnings) {
  const blocks = [];
  const contexts = new Map([['document', { state: delimiterState(), previous: null, introducedQuote: false }]]);
  const documentTitles = new Set(); let suppressed = 0; let unfinishedSuppressed = 0; let nativeProseSuppressed = 0; let unknownCaptions = 0; let fixedWidthIndex = 0;
  for (const block of input) {
    if (LAYOUT_LABEL.test(block.text) || countryLabel(block.text) || CONTACT_DELIVERY.test(block.text) || OPENING_FORMULA.test(block.text)) { blocks.push({ ...block, kind: countryLabel(block.text) || CONTACT_DELIVERY.test(block.text) ? 'contact_label' : 'layout_label', heading: null }); continue; }
    const scope = block.fixed_width_numeric_record ? `fixed_width_record_${++fixedWidthIndex}` : block.delimiter_scope ?? 'document';
    if (!contexts.has(scope)) contexts.set(scope, { state: delimiterState(), previous: null, introducedQuote: false });
    const context = contexts.get(scope), state = context.state, previous = context.previous;
    const capitalized = CAPITAL_TITLE.test(block.text) && /\p{Lu}{3}/u.test(block.text);
    if (previous && /:\s*$/u.test(previous.text) && QUOTE_INTRODUCTION.test(previous.text) && (capitalized || /^[“"\[]/u.test(block.text))) context.introducedQuote = true;
    // A colon-introduced, uppercase quotation need not have outer quote marks.
    // Its first ordinary paragraph ends that layout context; explicit quotes
    // and parentheses continue to bind independently across source blocks.
    if (context.introducedQuote && !capitalized && !/^[“"\[]/u.test(block.text)) context.introducedQuote = false;
    const sentenceContinuation = unfinishedProse(previous) || previous?.source_sentence_continuation && !sentenceClosed(previous.text);
    const continuation = openDelimiter(state) || scope !== 'document' && openDelimiter(contexts.get('document').state) || block.quote_context || block.continuation_at_start || context.introducedQuote || sentenceContinuation;
    const caption = !continuation && previous?.heading && standaloneMarker(previous.text) ? inferredHeading(block.text, { markerCaption: true }) : null;
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
      blocks.push({ text: split.title, kind: 'inline_numbered_heading', heading: split.heading });
      const body = { ...candidate, text: split.body, heading: null };
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
      previous.text += `\n\n${block.text}`;
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
  let frame = null; let frameIndex = 0; let governingLevel = 1; let frames = 0; let previousHeading = null;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const prefix = numberedPrefix(block.text);
    const strongBoundary = block.heading && (['article_heading', 'attachment_heading', 'document_title', 'letter_subject'].includes(block.heading.kind) || block.heading.kind === 'explicit_heading' && (block.heading.html_level ?? block.heading.level) <= (frame?.level ?? 6) || block.heading.kind === 'numbered_heading' && prefix?.marker);
    if (frame && strongBoundary && index > frame.governor_index) frame = null;
    const firstItem = nextListItem(blocks, index + 1, block.heading?.level ?? governingLevel);
    // The colon is a literal forward dependency. Keep all enumerated items and
    // later cost/qualification paragraphs with it until a strong source fence.
    // Where the fence is uncertain this deliberately retains a broader parent.
    if (!frame && /:\s*$/u.test(block.text) && firstItem) {
      frame = { index: ++frameIndex, governor_index: index, level: block.heading?.level ?? governingLevel, evidence: 'LITERAL_COLON_FOLLOWED_BY_ENUMERATION', item_scheme: enumerationScheme(firstItem.text) }; frames += 1;
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
  return blocks;
}

function plainBlocks(content) {
  const blocks = [];
  let lines = []; let rawLines = []; let firstIndent = 0; let paragraphContinuation = false; let paragraphQuote = false; let paragraphWrappedSentence = false; let startState = delimiterState();
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
    if (text) { const block = { text, kind: fixedWidth ? 'fixed_width_numeric_record' : 'paragraph', heading: paragraphContinuation || paragraphQuote || fixedWidth ? null : inferredHeading(text), continuation_at_start: paragraphContinuation, quote_context: paragraphQuote, source_sentence_continuation: paragraphWrappedSentence && !sentenceClosed(text), source_indent: firstIndent, fixed_width_numeric_record: fixedWidth }; blocks.push(block); lastParagraph = block; }
    paragraphWrappedSentence = false;
  };
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const text = normalize(raw);
    if (!text) { flush(); continue; }
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
    lines.push(text);
    rawLines.push(raw);
    delimiters(text, state);
    if (typedHeading && !letteredPrefix(text)?.body) flush();
  }
  flush();
  return { blocks, title: '', excluded: [], warnings: wrapHeadingsSuppressed ? [{ code: 'WRAPPED_SENTENCE_HEADING_SUPPRESSED', count: wrapHeadingsSuppressed, message: 'An apparent heading on a wrapped source line was retained inside its unfinished paragraph; all literal text remains available for source review.' }] : [] };
}

function visibleText(tree) {
  const parts = [];
  const walk = (node, depth = 0) => {
    if (depth > 256) return;
    if (OMIT.has(node.tagName)) return;
    const attrs = new Map((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
    if (attrs.has('hidden') || attrs.get('aria-hidden') === 'true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(attrs.get('style') ?? '')) return;
    if (node.nodeName === '#text') parts.push(node.value ?? '');
    if (node.tagName === 'br' || BLOCKS.has(node.tagName) || ['td', 'th', 'tr', 'table'].includes(node.tagName)) parts.push('\n');
    for (const child of node.childNodes ?? []) walk(child, depth + 1);
    if (BLOCKS.has(node.tagName)) parts.push('\n');
  };
  walk(tree); return parts.join('');
}

function legacySgmlBlocks(content) {
  const tableCount = (content.match(/<TABLE\b/giu) ?? []).length;
  // EDGAR's <S>/<C> column markers are not HTML rows. Strip only known framing
  // and formatting tags, preserving every visible line and literal comparison.
  const result = { blocks: [], title: '', excluded: [], warnings: [] }; const scopes = []; let cursor = 0; let tableIndex = 0;
  const append = (value) => {
    const stripped = value.replace(/<\/?(?:DOCUMENT|TYPE|SEQUENCE|FILENAME|DESCRIPTION|TEXT|PAGE|CAPTION|S|C)\b[^>]*>/giu, '\n');
    const escaped = stripped.replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
    const decoded = visibleText(parse(`<pre>${escaped}</pre>`));
    const paragraphs = plainBlocks(decoded);
    result.blocks.push(...paragraphs.blocks.map((block) => scopes.length ? { ...block, delimiter_scope: scopes.at(-1), kind: block.heading ? block.kind : 'table_sgml_text' } : block));
    result.warnings.push(...paragraphs.warnings);
  };
  // Table boundaries are literal source structure. A truncated location such
  // as "Sample City (AREA" must not place later contract articles in brackets.
  for (const marker of content.matchAll(/<\/?TABLE\b[^>]*>/giu)) {
    append(content.slice(cursor, marker.index));
    if (/^<\//u.test(marker[0])) scopes.pop(); else scopes.push(`sgml_table_${++tableIndex}`);
    cursor = marker.index + marker[0].length;
  }
  append(content.slice(cursor));
  if (scopes.length) result.warnings.push({ code: 'SGML_UNCLOSED_TABLE_SCOPE', message: 'An explicit SGML table lacks a closing marker. Remaining source is retained in that uncertain layout scope.' });
  result.warnings.push({ code: 'SEC_SGML_LINES_PRESERVED', message: 'Legacy SGML source without HTML paragraphs/rows was kept as line-wrapped text before heading detection; no visible table text was discarded.' });
  if (tableCount) result.warnings.push({ code: 'SGML_TABLE_LAYOUT_UNCERTAIN', count: tableCount, message: 'SGML table text is retained without inventing HTML cells or assigning column roles. Consult the original fixed-width source for layout.' });
  return result;
}

function htmlBlocks(content) {
  const tree = parse(content);
  const pending = [tree];
  let body = tree; let title = '';
  while (pending.length) {
    const node = pending.pop();
    if (node.tagName === 'body') body = node;
    if (node.tagName === 'title') title = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
    for (const child of node.childNodes ?? []) pending.push(child);
  }
  const blocks = []; const excluded = new Map(); const warnings = []; const sourceImages = [];
  const inventory = (node, depth = 0) => {
    if (depth > 256) return;
    if (OMIT.has(node.tagName)) return;
    const attrs = new Map((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
    if (attrs.has('hidden') || attrs.get('aria-hidden') === 'true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(attrs.get('style') ?? '')) return;
    if (node.tagName === 'img') {
      const src = attrs.get('src') ?? '', alt = attrs.get('alt') ?? '', width = attrs.get('width') ?? null, height = attrs.get('height') ?? null;
      sourceImages.push({ src: src.slice(0, 2048), src_sha256: hash(src), src_truncated: src.length > 2048, alt: alt.slice(0, 2048), alt_sha256: hash(alt), alt_truncated: alt.length > 2048, width, height, page_sized_dimensions: Number(width) >= 300 && Number(height) >= 400, page_like_reference: /(?:page|pg)[_ -]?\d|\d{3,}\.(?:jpe?g|png|tiff?)\b/iu.test(src), alt_is_missing_or_filename: !alt.trim() || /\.(?:jpe?g|png|gif|tiff?)\]?\s*$/iu.test(alt), asset_read: false, alternative_text_is_verified_transcription: false });
    }
    for (const child of node.childNodes ?? []) inventory(child, depth + 1);
  };
  inventory(body);
  const note = (reason) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
  const omit = (node) => {
    if (OMIT.has(node.tagName)) { note(`inert_${node.tagName}_excluded`); return true; }
    const attrs = new Map((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
    if (attrs.has('hidden') || attrs.get('aria-hidden') === 'true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(attrs.get('style') ?? '')) { note('hidden_html_excluded'); return true; }
    return false;
  };
  function inline(node, depth = 0) {
    if (depth > 256) { note('html_depth_limit'); return ''; }
    if (node.nodeName === '#text') return node.value ?? '';
    if (omit(node)) return '';
    if (node.tagName === 'br') return '\n';
    const value = (node.childNodes ?? []).map((child) => inline(child, depth + 1)).join('');
    if (node.tagName === 'table') note('nested_table_flattened');
    return BLOCKS.has(node.tagName) || ['td', 'th', 'tr', 'table'].includes(node.tagName) || /^h[1-6]$/.test(node.tagName ?? '') ? `\n${value}\n` : value;
  }
  let quoteDepth = 0; let listDepth = 0; let listItemDepth = 0;
  function add(raw, kind = 'paragraph', heading = null, evidence = {}) {
    const pieces = raw.split('\n').map(normalize).filter(Boolean);
    if (pieces.length > 1 && /^(?:ARTICLE|Article|CHAPTER|Chapter)\s+[IVXLC\d]+[.:]?$/u.test(pieces[0]) || pieces.length > 1 && /^(?:EXHIBIT|Exhibit|SCHEDULE|Schedule|APPENDIX|Appendix|ANNEX|Annex)\s+[\p{L}\d]+[.:]?$/u.test(pieces[0])) {
      add(pieces[0], kind, null, evidence); add(pieces.slice(1).join(' '), kind, null, evidence); return;
    }
    const text = normalize(raw);
    if (text) blocks.push({ text, kind, heading: heading ?? inferredHeading(text, evidence), quote_context: quoteDepth > 0, source_list_item: listItemDepth > 0, source_list_depth: listDepth });
  }
  let buffer = '';
  const flush = (kind) => { add(buffer, kind); buffer = ''; };
  let tableIndex = 0;
  function rows(node, depth = 0, scope) {
    if (depth > 256) { note('html_depth_limit'); return; }
    if (omit(node)) return;
    if (node.tagName === 'tr') {
      const cells = (node.childNodes ?? []).filter((child) => ['td', 'th'].includes(child.tagName));
      const texts = cells.map((cell) => normalize(inline(cell, depth + 1))).filter(Boolean);
      const numberedLabel = texts.length === 2 && /^(?:(?:Section|SECTION|section)\s+)?\d+(?:\.\d+)*[.)]?$/u.test(texts[0]);
      const directBlocks = (cell) => (cell.childNodes ?? []).filter((child) => BLOCKS.has(child.tagName) || /^h[1-6]$/.test(child.tagName ?? '') || child.tagName === 'table');
      // A single layout cell or a number-plus-multiparagraph cell may contain
      // the entire document. Keep its actual paragraph/heading structure.
      if (cells.length === 1 && directBlocks(cells[0]).length || numberedLabel && directBlocks(cells[1]).length > 1) {
        flush(); const first = blocks.length; const cell = cells.at(-1);
        for (const child of cell.childNodes ?? []) walk(child, depth + 1);
        flush();
        if (numberedLabel && blocks[first]) { blocks[first].text = `${texts[0]} | ${blocks[first].text}`; blocks[first].heading = inferredHeading(blocks[first].text); }
        return;
      }
      // Three-column TOCs and genuine inventory/data rows stay tabular. Only a
      // conservative number-plus-title layout row can propose a section path.
      if (texts.length) {
        const text = texts.join(' | '); const header = cells.every((cell) => cell.tagName === 'th');
        blocks.push({ text, kind: header ? 'table_header' : 'table_row', heading: !header && numberedLabel ? inferredHeading(text) : null, heading_eligible: !header && numberedLabel, delimiter_scope: scope });
      }
      return;
    }
    for (const child of node.childNodes ?? []) rows(child, depth + 1, scope);
  }
  function walk(node, depth = 0) {
    if (depth > 256) { note('html_depth_limit'); return; }
    if (node.nodeName === '#text') { buffer += node.value ?? ''; return; }
    if (omit(node)) return;
    if (node.tagName === 'br') { buffer += '\n'; return; }
    if (node.tagName === 'table') {
      flush(); const first = blocks.length; const scope = `html_table_${++tableIndex}`; rows(node, depth + 1, scope);
      if (blocks.length === first) {
        const text = normalize(inline(node, depth + 1));
        if (text) { blocks.push({ text, kind: 'table_unstructured', heading: null, heading_eligible: false, delimiter_scope: scope }); warnings.push({ code: 'TABLE_WITHOUT_HTML_ROWS_RETAINED', message: 'Table has visible text without usable tr/td rows. All visible text is retained; original column/role layout needs source review.' }); }
      }
      return;
    }
    if (/^h[1-6]$/.test(node.tagName ?? '')) {
      flush();
      const text = normalize(inline(node, depth + 1));
      const inferred = inferredHeading(text);
      add(text, 'explicit_heading', { ...inferred, level: inferred?.level ?? Number(node.tagName[1]), html_level: Number(node.tagName[1]), kind: 'explicit_heading', verified: false, confidence: 'explicit_html_structure_not_semantic_verification' });
      return;
    }
    if (node.tagName === 'pre') { flush(); const paragraphs = plainBlocks(inline(node, depth + 1)); blocks.push(...paragraphs.blocks.map((block) => ({ ...block, quote_context: block.quote_context || quoteDepth > 0 }))); warnings.push(...paragraphs.warnings); return; }
    const block = BLOCKS.has(node.tagName);
    if (block) flush();
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
    const paragraphRaw = emphasized || centered ? inline(node, depth + 1) : '';
    const paragraphText = normalize(paragraphRaw);
    if ((emphasized || centered) && inferredHeading(paragraphText, { structural: true })) {
      add(paragraphRaw, 'layout_caption', null, { structural: true });
    } else {
    for (const child of node.childNodes ?? []) walk(child, depth + 1);
    if (block) flush(node.tagName === 'li' ? 'enumerated_paragraph' : 'paragraph');
    }
    if (node.tagName === 'blockquote' || node.tagName === 'q') { flush(); quoteDepth -= 1; }
    if (node.tagName === 'li') listItemDepth -= 1;
    if (node.tagName === 'ol' || node.tagName === 'ul') listDepth -= 1;
  }
  walk(body); flush();
  if (excluded.has('html_depth_limit')) warnings.push({ code: 'HTML_DEPTH_LIMIT', message: 'Source deeper than 256 elements was omitted. This extraction is incomplete and needs review.' });
  if (excluded.has('nested_table_flattened')) warnings.push({ code: 'NESTED_TABLE_FLATTENED', message: 'Nested layout-table text is retained with cell boundaries but its inner column structure is flattened; inspect source context.' });
  let imageDependency = null;
  if (sourceImages.length) {
    const originalBody = content.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/iu)?.[1] ?? content.match(/<TEXT\b[^>]*>([\s\S]*?)<\/TEXT\s*>/iu)?.[1] ?? content;
    const bodyLines = visibleText(parse(originalBody)).split('\n').map(normalize).filter(Boolean);
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
  const { content, ...metadata } = record;
  const contract = { ...metadata, id: String(record.id ?? `contract-${hash(record.source_url ?? content).slice(0, 20)}`), source_url: String(record.source_url ?? '') };
  const result = { contract, status: 'accepted', normalized_text: '', normalized_sha256: hash(''), sections: [], units: [], warnings: [], excluded: [], parameters: { maxRawBytes, maxCharacters, minSectionWords, maxChunkWords, contextWords, sectionBoundaryLevel: boundaryLevel, offsets: 'UTF16_IN_NORMALIZED_TEXT', word_index: 'PRECOMPUTED_ONCE_PER_DOCUMENT', word_count_basis: 'whitespace_segments_not_tokenizer_tokens', heading_policy: 'SOURCE_NATIVE_PROSE_AND_PAGE_TRANSPARENT_CONTINUITY_V9_UNVERIFIED', parent_completeness: 'FULL_STORED_SOURCE_SPAN_NOT_VERIFIED_COMPLETE_GOVERNING_HIERARCHY', image_policy: 'REJECT_NONRECONSTRUCTABLE_IMAGE_BODY_NO_OCR_OR_ASSET_FETCH', noise_policy: 'NARROW_NOISE_RULES_UNKNOWN_CONTENT_RETAINED' } };
  const reject = (code, message) => { result.status = 'rejected'; result.warnings.push({ code, message }); result.excluded.push({ reason: code.toLowerCase() }); return result; };
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
  const collected = sgml && !htmlStructure ? legacySgmlBlocks(content) : record.format === 'html' || sgml ? htmlBlocks(content) : plainBlocks(content);
  if (sgml && htmlStructure) result.warnings.push({ code: 'SEC_SGML_INERT_PARSE', message: 'SEC source contains actual HTML structure and was parsed as an inert tree; inspect source-format fidelity.' });
  result.warnings.push(...collected.warnings); result.excluded.push(...collected.excluded);
  result.source_dependencies = { image_body: collected.image_dependency ?? null };
  let offset = 0; const path = [];
  const blocks = sectionBlocks(collected.blocks, result.warnings).map((candidate) => {
    const listScope = path.some((label) => /^(?:(?:PERMITTED|APPROVED|AUTHORIZED)\b.*\b(?:MANAGERS|SUPPLIERS|ENTITIES|SIGNATORIES)|LIST OF\b)/iu.test(label));
    const block = listScope && candidate.heading?.kind === 'numbered_heading' && !SECTION_TITLE_CUE.test(numberedPrefix(candidate.text)?.title ?? candidate.text) ? { ...candidate, heading: null, kind: 'enumerated_list_item' } : candidate;
    if (block.heading) { path.splice(block.heading.level - 1); path[block.heading.level - 1] = block.heading.label ?? block.text; }
    const indexed = { ...block, start: offset, end: offset + block.text.length, heading_path: path.filter(Boolean) };
    offset = indexed.end + 2; return indexed;
  });
  result.normalized_text = blocks.map((block) => block.text).join('\n\n');
  result.normalized_sha256 = hash(result.normalized_text);
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
    const suppressedPresentations = members.filter((member) => member.source_heading_presentation).map((member) => ({ start: member.start, end: member.end, ...member.source_heading_presentation, reason: member.heading_suppressed_reason ?? 'source_continuation_not_independent_boundary' }));
    if (suppressedPresentations.length) section.suppressed_heading_presentations = suppressedPresentations;
    section.completeness = { full_stored_span_retained: true, governing_hierarchy_verified: false, semantic_completeness_verified: false, basis: 'SOURCE_SPAN_WITH_CONSERVATIVE_GOVERNOR_FRAMES' };
    const frames = new Map();
    for (const member of members) if (member.list_frame) {
      const key = member.list_frame.index;
      if (!frames.has(key)) frames.set(key, { first: member, last: member, governor: member.list_frame.governor ? member : null, evidence: member.list_frame.evidence });
      const frame = frames.get(key); frame.last = member; if (member.list_frame.governor) frame.governor = member;
    }
    section.governor_frames = [...frames.values()].map((frame) => ({ id: `${contract.id}:frame:${frame.first.start}-${frame.last.end}:${hash(result.normalized_text.slice(frame.first.start, frame.last.end)).slice(0, 12)}`, start: frame.first.start, end: frame.last.end, sha256: hash(result.normalized_text.slice(frame.first.start, frame.last.end)), governor: frame.governor ? { start: frame.governor.start, end: frame.governor.end, text: frame.governor.text, sha256: hash(frame.governor.text) } : null, source_evidence: frame.evidence, boundary_verified: false, semantic_completeness_verified: false, closure: last < blocks.length ? 'NEXT_STRONG_SOURCE_BOUNDARY' : 'END_OF_RETAINED_SOURCE_NOT_PROOF_OF_SEMANTIC_CLOSURE' }));
    if (section.governor_frames.length) section.warnings.push({ code: 'GOVERNOR_LIST_CONTEXT_RETAINED', message: 'Introduced items and subsequent qualification/cost paragraphs share this stored parent. Frame scope is conservative source structure and still requires actual source review.' });
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
      cursor = limit;
    }
    for (const unit of section.units) { unit.chunk_count = section.units.length; result.units.push(unit); }
    result.sections.push(section);
  }
  if (!result.units.some((unit) => unit.kind !== 'structural_noise')) return reject('NO_SUBSTANTIVE_CONTENT', 'Extraction contains only narrowly identified structural noise; all source text remains retained.');
  return result;
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

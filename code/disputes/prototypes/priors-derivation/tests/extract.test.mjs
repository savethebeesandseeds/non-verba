// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractContract, deduplicateContracts, deduplicateClauses, sha256 } from '../lib/extract.mjs';

const source = (id, content, format = 'html', extra = {}) => ({ id, source_url: `https://example.invalid/contracts/${id}`, format, content, ...extra });
const baseClause = 'The Operator shall make a reasonable effort to complete the agreed work within the stated period. The Requester shall provide access to the premises and the materials identified in the agreed scope. Either party shall promptly communicate any difficulty that could prevent performance, and both parties shall consider a practical opportunity to correct the deficiency before ending cooperation.';

test('HTML extraction is inert, preserves headings/table context and exposes exact UTF-16 offsets', () => {
  const html = `<html><head><title>Service Agreement</title><style>body:after { content: "FORGED STYLE" }</style></head><body><h2>1. PERFORMANCE</h2><p>${baseClause} 📷</p><script>globalThis.contractPwned = true; document.write('FORGED SCRIPT');</script><template>FORGED TEMPLATE</template><p hidden>FORGED HIDDEN</p><svg><text>FORGED SVG</text></svg><h2>2. REMEDY</h2><table><tr><th>Condition</th><th>Response</th></tr><tr><td>When work falls short</td><td>The parties shall discuss a bounded opportunity to repair the outcome within the original scope, without requiring indefinite additional unpaid work.</td></tr></table></body></html>`;
  const result = extractContract(source('inert', html));
  assert.equal(result.status, 'accepted');
  assert.equal(globalThis.contractPwned, undefined);
  assert.doesNotMatch(result.normalized_text, /FORGED/);
  assert.match(result.normalized_text, /When work falls short \| The parties/);
  assert.equal(result.normalized_sha256, sha256(result.normalized_text));
  assert.equal(result.clauses[0].heading, '1. PERFORMANCE');
  assert.match(result.clauses[0].context_after, /2\. REMEDY/);
  assert.match(result.clauses.at(-1).context_before, /Condition \| Response/);
  assert.ok(result.excluded.some((entry) => entry.reason === 'inert_script_excluded'));
  for (const clause of result.clauses) {
    assert.equal(result.normalized_text.slice(clause.start, clause.end), clause.text);
    assert.equal(clause.sha256, sha256(clause.text));
    assert.equal(clause.contract_id, 'inert');
  }
  assert.deepEqual(result.clauses.map((clause) => clause.id), extractContract(source('inert', html)).clauses.map((clause) => clause.id));
});

test('plain text paragraphs retain meaningful headings and merge short neighboring statements without crossing headings', () => {
  const text = `PERFORMANCE\n\nThe Operator shall work diligently.\n\nThe Requester shall supply the materials needed for the agreed task, and shall identify the acceptance conditions before work begins.\n\nREMEDY\n\n${baseClause}\n\nRepair is voluntary.`;
  const result = extractContract(source('plain', text, 'text'));
  assert.equal(result.status, 'accepted');
  assert.equal(result.clauses[0].heading, 'PERFORMANCE');
  assert.match(result.clauses[0].text, /diligently\.\n\nThe Requester/);
  assert.equal(result.clauses[0].segmentation.reason, 'combined_short_blocks');
  assert.ok(result.clauses.some((clause) => clause.text === 'Repair is voluntary.' && clause.segmentation.reason === 'below_minimum_retained'));
  for (const clause of result.clauses) assert.equal(result.normalized_text.slice(clause.start, clause.end), clause.text);
});

test('long clauses split with no lost words, no offset overlap, and explicit segmentation reasons', () => {
  const long = Array.from({ length: 187 }, (_, index) => `word${index}${index % 19 === 18 ? '.' : ''}`).join(' ');
  const result = extractContract(source('long', `<h1>OBLIGATIONS</h1><p>${long}</p>`), { maxWords: 40, minWords: 20 });
  assert.equal(result.status, 'accepted');
  assert.ok(result.clauses.length > 4);
  assert.equal(result.clauses.map((clause) => clause.text).join(' '), long);
  for (let index = 0; index < result.clauses.length; index += 1) {
    const clause = result.clauses[index];
    assert.equal(clause.segmentation.reason, 'max_words_split');
    assert.ok(clause.segmentation.word_count <= 40);
    assert.equal(result.normalized_text.slice(clause.start, clause.end), clause.text);
    if (index) assert.ok(result.clauses[index - 1].end < clause.start);
  }
});

test('encoding, access pages and empty extraction fail visibly rather than becoming contracts', () => {
  const attempts = [
    [source('empty', '<script>lots of fake contract language</script>'), 'EMPTY_EXTRACTION'],
    [source('access', '<title>SEC.gov | Request Rate Threshold Exceeded</title><p>You have exceeded the allowed request rate. Please wait and try again later.</p>'), 'STATUS_PAGE'],
    [source('status', baseClause, 'text', { http_status: 403 }), 'HTTP_STATUS'],
    [source('encoding', '\uFFFD'.repeat(12) + ' garbled contract '), 'ENCODING_FAILURE'],
    [source('short', 'Terms incomplete.', 'text'), 'INSUFFICIENT_CONTEXT'],
  ];
  for (const [document, code] of attempts) {
    const result = extractContract(document);
    assert.equal(result.status, 'rejected');
    assert.equal(result.clauses.length, 0);
    assert.ok(result.warnings.some((warning) => warning.code === code));
  }
  assert.throws(() => extractContract(source('bad-option', baseClause, 'text'), { minWords: 200, maxWords: 30 }), /minWords/);
});

test('a contract discussing unavailable services is retained and mixed-case numbered section labels remain headings', () => {
  const result = extractContract(source('availability', `<p>1. Service Availability</p><p>${baseClause} If the service is temporarily unavailable, the parties shall discuss a practical alternative within the original scope.</p><p>THE OPERATOR SHALL NOT PERFORM UNAUTHORIZED EXTRA WORK.</p>`));
  assert.equal(result.status, 'accepted');
  assert.equal(result.clauses[0].heading, '1. Service Availability');
  assert.match(result.clauses[0].text, /temporarily unavailable/);
  assert.ok(result.clauses.some((clause) => clause.text === 'THE OPERATOR SHALL NOT PERFORM UNAUTHORIZED EXTRA WORK.'));
});

test('exact repeated filings retain every source reference and use whitespace-normalized digests', () => {
  const first = extractContract(source('filing-a', `<p>${baseClause}</p>`));
  const second = extractContract(source('filing-b', baseClause.replace(/ /g, '\n'), 'text'));
  const result = deduplicateContracts([first, second]);
  assert.equal(result.records.length, 2);
  assert.equal(result.families.length, 1);
  assert.equal(result.exact_groups.length, 1);
  assert.equal(result.exact_groups[0].sources.length, 2);
  assert.deepEqual(result.exact_groups[0].sources.map((reference) => reference.source_url).sort(), [first.contract.source_url, second.contract.source_url].sort());
  assert.equal(result.records[1].duplicate_kind, 'exact');
  assert.equal(result.records[0].family_id, result.records[1].family_id);
  assert.equal(result.stats.exact_duplicate_count, 1);
});

test('conservative near duplicates are reported and retained, while legal modal and amount contrasts stay separate', () => {
  const padding = 'The parties acknowledge that the requirements were reviewed together before entering the arrangement. Written communications will remain available to both parties so that practical difficulties can be understood in the context of the agreed work, resources, access, timing, acceptance criteria, and intended benefit. This process requires consideration of relevant evidence and reasonable explanations from each party before any proposed practical resolution is recorded. The original description of cooperation remains available throughout the discussion to help participants explain their concerns with appropriate supporting context about the service.';
  const text = `${baseClause} ${padding} Payment is due within 30 days and is limited to $1000.`;
  const clauses = [
    { id: 'a', contract_id: 'one', source_url: 'https://example.invalid/a', text },
    { id: 'b', contract_id: 'two', source_url: 'https://example.invalid/b', text: text.replace('practical difficulties', 'practical complications') },
    { id: 'c', contract_id: 'three', source_url: 'https://example.invalid/c', text: text.replace('shall make', 'may make') },
    { id: 'd', contract_id: 'four', source_url: 'https://example.invalid/d', text: text.replace('$1000', '$1001') },
  ];
  const result = deduplicateClauses(clauses);
  assert.equal(result.records.length, 4);
  assert.equal(result.records[0].family_id, result.records[1].family_id);
  assert.notEqual(result.records[0].family_id, result.records[2].family_id);
  assert.notEqual(result.records[0].family_id, result.records[3].family_id);
  assert.ok(result.near_matches.some((match) => match.accepted && match.family_joined));
  assert.ok(result.near_matches.some((match) => !match.accepted && match.reason === 'negation_or_modal_difference_retained'));
  assert.ok(result.near_matches.some((match) => !match.accepted && match.reason === 'numeric_difference_retained'));
  assert.equal(result.representatives.length, 3);
});

test('short similar labels and negation contrasts do not form near duplicate families', () => {
  const short = deduplicateClauses([{ id: 'short-a', text: 'A practical remedy is offered.' }, { id: 'short-b', text: 'A practical remedy is required.' }]);
  assert.equal(short.families.length, 2);
  const long = `${baseClause} ${baseClause} ${baseClause}`;
  const contrast = deduplicateClauses([{ id: 'yes', text: long }, { id: 'no', text: long.replace('shall make', 'shall not make') }], { threshold: 0.8 });
  assert.equal(contrast.families.length, 2);
  assert.ok(contrast.near_matches.some((match) => !match.accepted));
  assert.throws(() => deduplicateClauses([{ id: 'duplicate-id', text: long }, { id: 'duplicate-id', text: long }]), /distinct/);
});

test('deduplication family IDs and representatives are stable under input reorder', () => {
  const clauses = [{ id: 'z', text: baseClause }, { id: 'a', text: baseClause.replace(/ /g, '  ') }, { id: 'm', text: 'A different, short and independent clause about notice to the other party.' }];
  const first = deduplicateClauses(clauses);
  const second = deduplicateClauses([...clauses].reverse());
  const key = (result) => new Map(result.records.map((record) => [record.id, [record.family_id, record.family_representative_id, record.duplicate_kind]]));
  assert.deepEqual(key(first), key(second));
});

test('near families require every pair to match instead of allowing transitive boilerplate drift', () => {
  const tokens = Array.from({ length: 150 }, (_, index) => `term${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + index % 26)}`);
  const oneChange = [...tokens]; oneChange[20] = 'changedalpha';
  const twoChanges = [...oneChange]; twoChanges[60] = 'changedbeta';
  const result = deduplicateClauses([{ id: 'a', text: tokens.join(' ') }, { id: 'b', text: oneChange.join(' ') }, { id: 'c', text: twoChanges.join(' ') }]);
  assert.equal(result.families.length, 2);
  assert.equal(result.near_matches.filter((match) => match.accepted).length, 2);
  assert.ok(result.near_matches.some((match) => match.accepted && !match.family_joined && match.reason === 'complete_link_guard_kept_separate'));
  assert.equal(result.records.length, 3);
});

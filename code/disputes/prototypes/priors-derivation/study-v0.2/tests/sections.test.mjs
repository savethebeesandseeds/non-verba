// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { extractSections, selectUnits } from '../lib/sections.mjs';

const source = (content, format = 'html') => ({ id: 'contract-source', source_url: 'https://example.invalid/contract', content, format });

test('parent sections retain enumerated conditions and exceptions in inert HTML', () => {
  const content = '<h1>ARTICLE I SERVICES</h1><h2>1. Performance</h2><p>(a) The Operator shall deliver the agreed result.</p><p>(b) The Requester shall provide access.</p><p>Provided, however, that unsafe access is not required.</p><h3>1.1.1 Additional conditions</h3><p>Unless both parties authorize a written change, no extra work is included.</p><h2>2. Notice</h2><p>Notice shall be in writing and identify the deficiency.</p><script>globalThis.sectionsPwned = true; document.write("FORGED")</script><style>.x{content:"FORGED"}</style>';
  const result = extractSections(source(content));
  assert.equal(result.status, 'accepted');
  assert.equal(globalThis.sectionsPwned, undefined);
  assert.doesNotMatch(result.normalized_text, /FORGED/);
  const performance = result.sections.find((section) => section.heading === '1. Performance');
  assert.match(performance.text, /\(a\).*\(b\)/s);
  assert.match(performance.text, /Provided, however/);
  assert.match(performance.text, /Unless both parties/);
  assert.ok(performance.heading_path.includes('ARTICLE I SERVICES'));
  assert.ok(performance.subheadings.some((heading) => heading.text === '1.1.1 Additional conditions'));
  for (const section of result.sections) assert.equal(result.normalized_text.slice(section.start, section.end), section.text);
  for (const unit of result.units) assert.equal(result.normalized_text.slice(unit.start, unit.end), unit.text);
});

test('bounded chunks retain a complete parent and all words, including short final exceptions', () => {
  const words = Array.from({ length: 365 }, (_, index) => `word${index}`).join(' ');
  const result = extractSections(source(`<h2>1. Work</h2><p>${words}</p><p>Except that no unauthorized work is required.</p>`), { maxChunkWords: 100, contextWords: 12 });
  const section = result.sections[0];
  assert.ok(section.units.length > 3);
  assert.equal(section.units.map((unit) => unit.text).join(' ').replace(/\s+/gu, ' '), section.text.replace(/\s+/gu, ' '));
  assert.ok(section.units.every((unit) => unit.word_count <= 100));
  assert.ok(section.units.every((unit) => unit.parent_section_id === section.id && unit.chunk_count === section.units.length));
  assert.ok(section.units.every((unit) => unit.context_before.split(/\s+/u).filter(Boolean).length <= 12));
  assert.ok(section.units.every((unit) => unit.context_after.split(/\s+/u).filter(Boolean).length <= 12));
  assert.match(section.units.at(-1).text, /Except that no unauthorized/);
  assert.equal(selectUnits(result.sections, { maxPerContract: 100 }).selected.length, result.units.length);
});

test('operative notices and table inventory obligations are never discarded as structural noise', () => {
  const result = extractSections(source('<h2>1. Notices</h2><p>All notices shall be delivered in writing to the agreed address.</p><h2>2. Inventory</h2><p>The Operator shall return the listed inventory.</p><table><tr><th>Item</th><th>Quantity</th></tr><tr><td>Keys</td><td>2</td></tr><tr><td>Camera 📷</td><td>1</td></tr></table>'));
  assert.equal(result.sections.length, 2);
  assert.ok(result.sections.every((section) => section.kind === 'operative'));
  assert.match(result.sections[1].text, /Keys \| 2/);
  assert.match(result.sections[1].text, /Camera 📷 \| 1/);
  assert.equal(selectUnits(result.sections).selected.length, result.units.length);
});

test('plain wrapped enumerated subclauses stay together and unavailable-service terms remain source material', () => {
  const result = extractSections(source('1. Performance\n\n(a) The services shall be provided\nusing the agreed equipment.\n\n(b) If service is unavailable,\nthe Operator shall notify the Requester.\n\nProvided that an unsafe alternative is not required.\n\n2. Notice\n\nThe Requester shall acknowledge receipt of notices.', 'text'));
  assert.equal(result.status, 'accepted');
  assert.match(result.sections[0].text, /\(a\).*\(b\).*Provided that/s);
  assert.ok(result.sections[0].kind === 'operative');
});

test('status, undecodable input and byte-bound failures are explicit and never truncated', () => {
  assert.equal(extractSections(source('<title>Access Denied</title><p>Your request is blocked.</p>')).status, 'rejected');
  assert.equal(extractSections(source('\uFFFD'.repeat(20), 'text')).status, 'rejected');
  const result = extractSections(source('é'.repeat(900), 'text'), { maxRawBytes: 1024, maxCharacters: 2048 });
  assert.equal(result.status, 'rejected');
  assert.ok(result.warnings.some((warning) => warning.code === 'SOURCE_BOUND_EXCEEDED'));
});

test('selection has no implicit twenty-unit cap and remains deterministic with explicit coverage exclusions', () => {
  const rows = Array.from({ length: 70 }, (_, index) => ({ id: `unit-${index}`, contract_id: index < 35 ? 'a' : 'b', parent_section_id: `parent-${index}`, text: index % 3 === 0 ? 'The Operator shall perform the service and deliver the result.' : index % 3 === 1 ? 'The Requester shall pay the agreed fee and documented expenses.' : 'A party shall give written notice and discuss a bounded correction.', kind: 'operative' }));
  const first = selectUnits(rows, { seed: 'fixed', maxPerContract: 30, maxUnits: 45 });
  const second = selectUnits([...rows].reverse(), { seed: 'fixed', maxPerContract: 30, maxUnits: 45 });
  assert.equal(first.selected.length, 45);
  assert.deepEqual(first.selected.map((row) => row.id), second.selected.map((row) => row.id));
  assert.equal(first.excluded.length, 25);
  assert.ok(first.excluded.some((row) => row.reason === 'explicit_global_unit_bound'));
  assert.ok(first.excluded.some((row) => row.reason === 'explicit_per_contract_unit_bound'));
  assert.ok(first.coverage.every((record) => record.selected_function_tags.includes('payment_cost') && record.selected_function_tags.includes('notice_response') && record.selected_function_tags.includes('performance')));
});

test('notice addresses remain in notice context rather than becoming numbered headings', () => {
  const result = extractSections(source('<p>4. Notices. Notices shall be delivered to the following recipient.</p><p>Research Office</p><p>1200 Example Avenue, 3rd floor</p><p>Sample City, ZZ 12345</p><p>USA</p><p>Facsimile: (000) 123-4567</p><p>Attention: Records Officer</p><p>Copies to:</p><p>Alternate Office</p><p>Switzerland</p><p>Attention: Second Officer</p><p>5. Termination. Either party may terminate upon written notice.</p>'));
  const notice = result.sections.find((section) => section.heading === '4. Notices.');
  assert.ok(notice);
  assert.match(notice.text, /Research Office.*1200 Example Avenue.*12345.*USA.*123-4567.*Records Officer.*Switzerland.*Second Officer/s);
  assert.ok(!result.sections.some((section) => /1200|Records Officer/u.test(section.heading)));
  assert.equal(notice.boundary_verified, false);
  assert.equal(notice.heading_provenance.confidence, 'heuristic_structure');
});

test('inline numbered titles delimit complete provisions and preserve exceptions and amounts', () => {
  const content = '<p>6. Transfers.</p><p>Unless the Requester directs otherwise, funds shall transfer within two days.</p><p>7. Documentation. Prior written authorization is required before any additional service.</p><p>8. General Duties. The Operator shall perform only the expressly agreed duties; except that emergency protection is permitted.</p><p>9. Fees. The Requester shall pay 45 units within thirty days, provided that a disputed invoice may be withheld.</p><p>10. Termination. No termination is permitted without notice unless both parties consent.</p>';
  const result = extractSections(source(content));
  assert.deepEqual(result.sections.map((section) => section.heading), ['6. Transfers.', '7. Documentation.', '8. General Duties.', '9. Fees.', '10. Termination.']);
  assert.match(result.sections[0].text, /Unless.*two days/s);
  assert.match(result.sections[2].text, /only.*except/s);
  assert.match(result.sections[3].text, /45 units.*thirty days.*provided/s);
  assert.match(result.sections[4].text, /No.*without.*unless/s);
  for (const section of result.sections) assert.equal(result.normalized_text.slice(section.start, section.end), section.text);
});

test('number-plus-title layout rows can delimit sections without promoting TOC or inventory rows', () => {
  const content = '<p>EXHIBITS</p><table><tr><td>1.</td><td>DEFINITIONS</td><td>3</td></tr></table><p>AMENDED PROMOTION AGREEMENT®</p><table><tr><td>1.</td><td>DEFINITIONS.</td></tr><tr><td>1.1</td><td>“Work” means the expressly authorized services.</td></tr><tr><td>2.</td><td>PERFORMANCE. The Operator shall return all listed inventory unless the Requester accepts a replacement.</td></tr><tr><th>Item</th><th>Quantity</th></tr><tr><td>2</td><td>KEYS</td></tr><tr><td>Camera</td><td>1</td></tr><tr><td>3.</td><td>NOTICES.</td></tr><tr><td>(a)</td><td>A notice shall identify the requested correction.</td></tr></table>';
  const result = extractSections(source(content));
  const definitions = result.sections.find((section) => section.heading === '1. DEFINITIONS.');
  const performance = result.sections.find((section) => section.heading === '2. PERFORMANCE.');
  assert.ok(definitions && performance);
  assert.match(definitions.text, /expressly authorized services/);
  assert.match(performance.text, /unless.*2 \| KEYS.*Camera \| 1/s);
  assert.ok(!result.sections.some((section) => section.heading.includes('KEYS') || /DEFINITIONS.*3/u.test(section.heading)));
  assert.match(result.normalized_text, /1\. \| DEFINITIONS \| 3/);
});

test('single-cell and numbered multiparagraph layout tables retain inner section structure', () => {
  const content = '<table><tr><td><p>1. Work. The Operator shall perform the agreed work.</p><p>(a) The Requester shall provide access.</p><p>Except that unsafe access is not required.</p><p>2. Payment. The Requester shall pay 30 units.</p></td></tr></table><table><tr><td>3.</td><td><p>Notices.</p><p>A notice shall be written.</p><p>Provided that an emergency message may precede it.</p></td></tr></table>';
  const result = extractSections(source(content));
  assert.equal(result.sections.length, 3);
  assert.match(result.sections[0].text, /\(a\).*Except/s);
  assert.match(result.sections[1].text, /30 units/);
  assert.match(result.sections[2].text, /written.*Provided/s);
  for (const unit of result.units) assert.equal(result.normalized_text.slice(unit.start, unit.end), unit.text);
});

test('page labels cannot reset a continuing condition or become semantic headings', () => {
  const result = extractSections(source('<p>1. Payment. The Requester shall pay the fee unless</p><p>CONFIDENTIAL</p><p>4</p><p>the Operator has failed to give the required notice.</p><p>CONFIDENTIAL</p><p>2. Records. The Operator shall preserve the records.</p>'));
  assert.equal(result.sections.length, 2);
  assert.match(result.sections[0].text, /unless.*CONFIDENTIAL.*required notice/s);
  assert.ok(result.units.every((unit) => !unit.heading_path.includes('CONFIDENTIAL')));
  assert.match(result.normalized_text, /CONFIDENTIAL/);
});

test('non-Latin scripts are preserved with segmentation and model-transfer uncertainty', () => {
  const text = '服务提供方必须按照约定完成工作，除非双方书面同意变更。'.repeat(20);
  const result = extractSections(source(text, 'text'));
  assert.equal(result.status, 'accepted');
  assert.equal(result.normalized_text, text);
  assert.ok(result.script_profile.Han > 100);
  assert.ok(result.warnings.some((warning) => warning.code === 'NON_LATIN_SCRIPT_OBSERVED'));
  assert.equal(result.units[0].word_count_basis, 'whitespace_segments_not_tokenizer_tokens');
  assert.equal(result.units[0].word_count, 1);
  assert.equal(result.units[0].text, text);
  assert.ok(result.sections[0].warnings.some((warning) => warning.code === 'UNKNOWN_HEADING_STRUCTURE_RETAINED'));
});

test('uppercase SECTION markers delimit provisions without splitting their enumerated conditions', () => {
  const content = '<p>ARTICLE 2.</p><p>COMMITMENTS</p><p>SECTION 2.01 The Commitments.</p><p>(a) The Operator shall provide 500 units, provided that authorization remains valid.</p><p>(b) Unless the Requester consents, no additional commitment is required.</p><p>SECTION 2.02 Conversions. The Requester shall give written notice before conversion.</p><p>SECTION 2.03 Reduction. The commitment shall be reduced to $0 when the service is completed.</p>';
  const result = extractSections(source(content));
  const first = result.sections.find((section) => section.heading === 'SECTION 2.01 The Commitments.');
  assert.match(first.text, /500 units.*provided.*\(b\).*Unless.*no additional/s);
  assert.ok(!first.text.includes('SECTION 2.02'));
  const final = result.sections.find((section) => section.heading === 'SECTION 2.03 Reduction.');
  assert.match(final.text, /\$0/);
  assert.ok(final.heading_path.includes('ARTICLE 2.'));
  for (const section of result.sections) assert.equal(result.normalized_text.slice(section.start, section.end), section.text);
});

function checkOffsets(result) {
  for (const row of [...result.sections, ...result.units]) {
    assert.equal(result.normalized_text.slice(row.start, row.end), row.text);
    assert.equal(createHash('sha256').update(row.text).digest('hex'), row.sha256);
  }
}

test('image-dependent sources with only filing headers are explicitly nonreconstructable', () => {
  for (const image of ['<img src="page001.jpg" alt="[page001.jpg]">', '<img src="exhibit-pg01.jpg">', '<img src="scan.jpg" width="612" height="792" alt="">']) {
    const raw = `<DOCUMENT><TYPE>EX-10<SEQUENCE>2<FILENAME>exhibit.htm<TEXT><html><body><p>Exhibit 10</p>${image}</body></html></TEXT></DOCUMENT>`;
    const result = extractSections(source(raw));
    assert.equal(result.status, 'rejected');
    assert.equal(result.reconstruction_status, 'NONRECONSTRUCTABLE_SOURCE');
    assert.equal(result.sections.length, 0);
    assert.equal(result.units.length, 0);
    assert.ok(result.warnings.some((warning) => warning.code === 'NONRECONSTRUCTABLE_IMAGE_BODY'));
    assert.equal(result.source_dependencies.image_body.images.length, 1);
    assert.equal(result.source_dependencies.image_body.image_pixels_read, false);
    assert.equal(result.source_dependencies.image_body.ocr_run, false);
    assert.equal(result.source_dependencies.image_body.images[0].alternative_text_is_verified_transcription, false);
    assert.doesNotMatch(result.normalized_text, /page001\.jpg|exhibit-pg01\.jpg|scan\.jpg/);
  }
});

test('textual provisions with a logo remain available with honest image uncertainty', () => {
  const result = extractSections(source('<img src="logo.jpg" alt="Logo" width="100" height="40"><p>1. Payment. The Requester shall pay $50 unless the Operator fails to complete the expressly agreed work.</p>'));
  assert.equal(result.status, 'accepted');
  assert.match(result.normalized_text, /\$50.*unless/s);
  assert.equal(result.source_dependencies.image_body.textual_body_reconstructable, null);
  assert.ok(result.warnings.some((warning) => warning.code === 'SOURCE_IMAGE_DEPENDENCIES'));
  checkOffsets(result);
});

test('legacy SGML retains fixed-width table identity, numbers and letter conditions without HTML rows', () => {
  const raw = '<DOCUMENT>\n<TYPE>EX-10\n<TEXT>\n<TABLE>\n<CAPTION>\n<S>                  <C>                     <C>\nProvider              Morgan Example         Provider Services, Inc.\n                      President              120 Main Street\n                      Procurement            555.100.2000 Phone\n</TABLE>\n\nJune 1, 2000\n\nThe parties shall extend the rates for thirty-one (31) days.\nIf replacement rates are agreed earlier, those rates supersede this extension.\n\n</TEXT>\n</DOCUMENT>';
  const result = extractSections(source(raw, 'text'));
  assert.equal(result.status, 'accepted');
  assert.match(result.normalized_text, /Morgan Example.*President.*Procurement/s);
  assert.match(result.normalized_text, /Provider Services, Inc\./);
  assert.match(result.normalized_text, /555\.100\.2000/);
  assert.match(result.normalized_text, /thirty-one \(31\).*If replacement rates/s);
  assert.ok(result.warnings.some((warning) => warning.code === 'SGML_TABLE_LAYOUT_UNCERTAIN'));
  checkOffsets(result);
});

test('legacy SGML line wrapping preserves numbered sections and full continuations', () => {
  const raw = '<DOCUMENT>\n<TEXT>\nTABLE OF CONTENTS\n1. GRANTING CLAUSE...........1\n2. RENT.....................2\n\nSection 1.02 Representations and Covenants of the Operator\nand the Requester..................................21\n\nARTICLE I\n\nSection 1.01 Definitions.\n\n“Work” means the expressly authorized services.\n\nSection 1.02 Representations and Covenants of the Operator\nand the Requester.\n\nThe Operator shall provide access, provided that\nunsafe entry is not required.\n\n2.       ACCEPTANCE OF PREMISES.\nThe Requester shall acknowledge receipt.\n\n(10) years is a quoted duration, not a new heading.\n\n3.       USE. The Operator shall use the premises only for authorized work.\nUnless both parties agree otherwise, this condition continues.\n\n</TEXT>\n</DOCUMENT>';
  const result = extractSections(source(raw, 'text'));
  const representations = result.sections.find((row) => /Section 1\.02/.test(row.heading));
  assert.match(representations.heading, /and the Requester\./);
  assert.match(representations.text, /provided that.*unsafe entry is not required/s);
  assert.ok(!representations.text.includes('2. ACCEPTANCE'));
  assert.ok(result.sections.some((row) => row.heading === '2. ACCEPTANCE OF PREMISES.'));
  assert.ok(result.sections.some((row) => row.heading === '3. USE.'));
  assert.ok(!result.sections.some((row) => row.heading.startsWith('(10)')));
  assert.ok(!result.sections.some((row) => row.heading.includes('........')));
  assert.match(result.normalized_text, /\(10\) years/);
  assert.match(result.sections.find((row) => row.heading === '3. USE.').text, /Unless both parties/);
  checkOffsets(result);
});

test('malformed HTML tables retain visible caption text with explicit layout uncertainty', () => {
  const result = extractSections(source('<table><caption><s>Provider Services, Inc. <c>Morgan Example <c>Procurement Manager <c>5551000</caption></table><p>The Operator shall retain the records unless both parties authorize deletion.</p>'));
  assert.match(result.normalized_text, /Provider Services, Inc\..*Morgan Example.*Procurement Manager.*5551000/s);
  assert.match(result.normalized_text, /unless both parties/);
  assert.ok(result.warnings.some((warning) => warning.code === 'TABLE_WITHOUT_HTML_ROWS_RETAINED'));
  checkOffsets(result);
});

test('literal document and subject titles outrank introductory formulas, delivery lines and country footers', () => {
  const content = '<p><b>Supplementary Contract</b></p><p>The Operator shall perform the agreed work.</p><p>BILL OF SALE</p><p>KNOW ALL MEN BY THESE PRESENTS:</p><p>The Seller warrants title, except for the listed claims.</p><p>VIA CERTIFIED MAIL AND FACSIMILE (000) 123-4567</p><p>Re: Notice of Termination of Services Agreement</p><p>The Requester shall give notice before termination.</p><p>UNITED KINGDOM UNITED STATES SINGAPORE AUSTRALIA ARGENTINA BRAZIL KAZAKHSTAN RUSSIA UAE</p>';
  const result = extractSections(source(content));
  assert.ok(result.sections.some((row) => row.heading === 'Supplementary Contract'));
  const bill = result.sections.find((row) => row.heading === 'BILL OF SALE');
  assert.match(bill.text, /KNOW ALL MEN.*except for/s);
  assert.ok(result.sections.some((row) => /^Re: Notice of Termination/.test(row.heading)));
  assert.ok(!result.sections.some((row) => /^(?:KNOW ALL MEN|VIA CERTIFIED|UNITED KINGDOM)/.test(row.heading)));
  assert.match(result.normalized_text, /KAZAKHSTAN RUSSIA UAE/);
  checkOffsets(result);
});

test('wrapped article captions and permitted-entity lists retain literal hierarchy', () => {
  const content = '<p>ARTICLE III</p><p>CERTIFICATE OF INCORPORATION AND BYLAWS</p><p>OF THE SURVIVING CORPORATION</p><p>3.1 Charter. The charter shall remain effective unless lawfully amended.</p><p>EXHIBIT C<br>PERMITTED FUND MANAGERS</p><table><tr><td>5.</td><td>Example Real Estate Investments</td></tr><tr><td>6.</td><td>Another Named Entity</td></tr></table>';
  const result = extractSections(source(content));
  const charter = result.sections.find((row) => row.heading === '3.1 Charter.');
  assert.ok(charter.heading_path.includes('CERTIFICATE OF INCORPORATION AND BYLAWS OF THE SURVIVING CORPORATION'));
  const list = result.sections.find((row) => row.heading === 'PERMITTED FUND MANAGERS');
  assert.ok(list.heading_path.includes('EXHIBIT C'));
  assert.match(list.text, /5\. \| Example Real Estate Investments.*6\. \| Another Named Entity/s);
  assert.ok(!result.sections.some((row) => row.heading.startsWith('5.') || row.heading.startsWith('6.')));
  checkOffsets(result);
});

test('unpunctuated uppercase table titles, covenant nouns and Chapter markers delimit real provisions', () => {
  const content = '<table><tr><td>6.</td><td>REPRESENTATIONS AND WARRANTIES</td></tr><tr><td>(a)</td><td>The Operator warrants authority.</td></tr><tr><td>7.</td><td>RIGHT OF FIRST REFUSAL In addition, during the stated term. The Requester shall allow thirty (30) days for a response.</td></tr><tr><td>8.</td><td>CHOICE OF LAW This Agreement shall be governed by the stated law.</td></tr></table><p>Section 9.11 Cumulative Remedies. The remedies are cumulative.</p><p>Section 9.12 Nonpetition Covenant. Each party agrees not to commence proceedings until one year and one day after payment.</p><p>Chapter IV cooperation mechanism</p><p>The parties shall communicate about corrections.</p><p>Chapter V: the effectiveness, alteration and termination of the agreement</p><p>No amendment is effective unless signed by both parties.</p>';
  const result = extractSections(source(content));
  assert.ok(result.sections.some((row) => row.heading === '7. RIGHT OF FIRST REFUSAL'));
  assert.ok(result.sections.some((row) => row.heading === '8. CHOICE OF LAW'));
  const covenant = result.sections.find((row) => row.heading === 'Section 9.12 Nonpetition Covenant.');
  assert.match(covenant.text, /not.*one year and one day/s);
  assert.ok(!result.sections.find((row) => row.heading === 'Section 9.11 Cumulative Remedies.').text.includes('Nonpetition'));
  assert.ok(result.sections.some((row) => row.heading === 'Chapter IV cooperation mechanism'));
  assert.ok(result.sections.some((row) => row.heading.startsWith('Chapter V:')));
  checkOffsets(result);
});

test('wrapped capitalized legends remain with their governor and subsequent qualifications', () => {
  const raw = '3. Purchaser Representations.\n\n        f. Legends. The Purchaser understands that the items may bear the following legend:\n\n               THESE ITEMS HAVE NOT BEEN REGISTERED. THEY MAY NOT BE SOLD\n               EXCEPT UNDER AN AVAILABLE EXEMPTION. NOTWITHSTANDING THE FOREGOING,\n               THE ITEMS MAY BE PLEDGED IN A FINANCING ARRANGEMENT SECURED BY SUCH\n               ITEMS.\n\n        Certificates shall not contain such legend if the stated resale conditions\nare satisfied; provided that reasonable written assurances are supplied.\n\n        g. Investor Status. The Purchaser represents that the stated status is accurate.\n\n        h. Restricted Items. Resale is permitted only in the stated circumstances.\n\n4. Company Representations.\n\nThe Company warrants its authority.';
  const result = extractSections(source(raw, 'text'));
  const governor = result.sections.find((section) => section.heading === '3. Purchaser Representations.');
  assert.ok(governor);
  assert.match(governor.text, /f\. Legends\..*NOTWITHSTANDING.*PLEDGED.*ITEMS\..*Certificates.*such legend.*provided.*written assurances.*g\. Investor Status\..*h\. Restricted Items\./s);
  assert.ok(!result.sections.some((section) => section.heading === 'ITEMS.'));
  assert.ok(governor.subheadings.some((heading) => heading.text === 'f. Legends.' && heading.level === 3));
  assert.ok(governor.subheadings.some((heading) => heading.text === 'g. Investor Status.'));
  assert.ok(!governor.text.includes('4. Company Representations.'));
  checkOffsets(result);
});

test('source quote and parenthesis continuity suppress apparent numbered boundaries across paragraphs', () => {
  const content = '<h2>1. Prescribed Wording</h2><p>The notice shall contain the words “First give notice.</p><p>2. PAYMENT. Do not demand payment unless the correction period has expired.”</p><p>Such wording is required only for the first notice.</p><p>(The annex includes</p><p>3. NOTICES.</p><p>without changing these conditions.)</p><p>4. Completion. The Operator shall retain all records.</p>';
  const result = extractSections(source(content));
  assert.deepEqual(result.sections.map((section) => section.heading), ['1. Prescribed Wording', '4. Completion.']);
  assert.match(result.sections[0].text, /“First.*2\. PAYMENT.*unless.*expired.”.*Such wording.*3\. NOTICES.*conditions\.\)/s);
  assert.ok(result.warnings.some((warning) => warning.code === 'CONTINUATION_HEADING_SUPPRESSED'));
  checkOffsets(result);
});

test('indented unquoted prescribed text cannot create a numbered boundary', () => {
  const raw = '1. Notice Form.\n\nThe notice shall use the following form:\n\n        2. PAYMENT. NO AMOUNT IS DUE UNLESS THE PERIOD HAS EXPIRED.\n\n        3. RIGHTS. ALL RIGHTS REMAIN SUBJECT TO THE STATED EXCEPTION.\n\nThe prescribed form is required only for the initial notice.\n\n4. Records.\nThe Operator shall retain the notice.';
  const result = extractSections(source(raw, 'text'));
  assert.deepEqual(result.sections.map((section) => section.heading), ['1. Notice Form.', '4. Records.']);
  assert.match(result.sections[0].text, /2\. PAYMENT.*UNLESS.*3\. RIGHTS.*SUBJECT TO.*initial notice/s);
  checkOffsets(result);
});

test('HTML quote structure overrides apparent heading tags while actual layout captions retain evidence', () => {
  const content = '<h2>1. Notice</h2><p>The notice shall contain the following statement:</p><blockquote><h2>2. REQUIRED STEPS</h2><p>NO PAYMENT IS DUE UNLESS A CORRECTION IS OFFERED.</p><h2>ITEMS.</h2></blockquote><p>Such statement is required only after written notice.</p><p><b>OTHER AGREEMENTS</b></p><p>The parties shall preserve those agreements unless amended.</p><p><b>FRAGMENT.</b></p><p>3. Termination. Either party may terminate after notice.</p>';
  const result = extractSections(source(content));
  assert.ok(!result.sections.some((section) => section.heading === '2. REQUIRED STEPS' || section.heading === 'ITEMS.' || section.heading === 'FRAGMENT.'));
  assert.match(result.sections.find((section) => section.heading === '1. Notice').text, /2\. REQUIRED STEPS.*UNLESS.*ITEMS\..*Such statement/s);
  const agreements = result.sections.find((section) => section.heading === 'OTHER AGREEMENTS');
  assert.match(agreements.text, /preserve.*unless amended/s);
  assert.equal(agreements.heading_provenance.confidence, 'source_layout_and_capitalized_caption');
  checkOffsets(result);
});

test('bare capitalization has unknown hierarchy and cannot detach conditions or partial words', () => {
  const raw = '1. Duties.\nThe Operator shall preserve all\nAGREEMENTS\nand records unless the Requester authorizes disposal.\n\nOTHER AGREEMENTS\n\nThe listed arrangements shall continue, except that expired terms do not revive.\n\n(a) A bare enumeration is retained.\n\nb) Titled Conditions. These conditions are binding unless expressly waived.\n\n2. Notices.\nThe Requester shall send a written notice.';
  const result = extractSections(source(raw, 'text'));
  assert.deepEqual(result.sections.map((section) => section.heading), ['1. Duties.', '2. Notices.']);
  assert.match(result.sections[0].text, /preserve all AGREEMENTS and records unless.*OTHER AGREEMENTS.*except.*\(a\).*b\) Titled Conditions\./s);
  assert.ok(result.sections[0].subheadings.some((heading) => heading.text === 'b) Titled Conditions.'));
  assert.ok(result.warnings.some((warning) => warning.code === 'UNANCHORED_CAPITALIZATION_RETAINED'));
  checkOffsets(result);
});

test('article and caption chains stay adjacent to their first operative section', () => {
  const result = extractSections(source('<div style="text-align: center">ARTICLE VI<br><br>OTHER AGREEMENTS</div><div>Section 6.1 Independence. The Operator shall act independently unless expressly authorized.</div><div>Section 6.2 No Petition. Each party agrees to refrain until one year and one day after payment.</div>'));
  assert.deepEqual(result.sections.map((section) => section.heading), ['Section 6.1 Independence.', 'Section 6.2 No Petition.']);
  assert.match(result.sections[0].text, /ARTICLE VI.*OTHER AGREEMENTS.*Section 6\.1.*unless expressly authorized/s);
  assert.ok(result.sections[0].heading_path.includes('ARTICLE VI'));
  assert.ok(result.sections[0].heading_path.includes('OTHER AGREEMENTS'));
  assert.ok(!result.sections.some((section) => section.text === 'OTHER AGREEMENTS'));
  checkOffsets(result);
});

test('source-centered captions may contain internal punctuation but never take bare body fragments as headings', () => {
  const result = extractSections(source('<p style="text-align:center">ORGANIZATION</p><p>The Company shall maintain its office.</p><p style="text-align:center;font-weight:bold"><font style="text-decoration:underline">MEMBER; MEMBERSHIP INTEREST</font></p><p>Except as otherwise provided, a member shall not bind the Company.</p>'));
  assert.deepEqual(result.sections.map((section) => section.heading), ['ORGANIZATION', 'MEMBER; MEMBERSHIP INTEREST']);
  assert.match(result.sections[1].text, /Except.*shall not bind/s);
  checkOffsets(result);
});

test('non-cased script titles require source formatting and retain both language continuations', () => {
  const result = extractSections(source('<p><font>7.</font> <b>争议解决</b></p><p>7.1 双方应首先协商，除非另有约定。</p><p>The parties shall negotiate before submitting a dispute.</p><p><font>8.</font> <b>违约责任</b></p><p>8.1 违约方应补正，除非法律另有规定。</p><p>The party shall cure within 30 days, provided that a written notice is given.</p><p><font>9.</font> <b>通知</b></p><p>The notice shall identify the deficiency.</p>'));
  assert.deepEqual(result.sections.map((section) => section.heading), ['7. 争议解决', '8. 违约责任', '9. 通知']);
  assert.match(result.sections[0].text, /7\.1 双方应首先协商，除非另有约定。.*shall negotiate/s);
  assert.ok(!result.sections[0].text.includes('8. 违约责任'));
  assert.match(result.sections[1].text, /8\.1 违约方应补正，除非法律另有规定。.*30 days.*provided.*written notice/s);
  assert.ok(result.warnings.some((warning) => warning.code === 'NON_LATIN_SCRIPT_OBSERVED'));
  checkOffsets(result);
});

test('repeated document titles retain text without interrupting continuing qualifications', () => {
  const result = extractSections(source('<p>Business Cooperation Agreement</p><p>1. Work. The Operator shall perform, unless</p><p>3</p><p>Business Cooperation Agreement</p><p>the Requester gives a written cancellation.</p><p>2. Notice. Notice shall be written.</p>'));
  const work = result.sections.find((section) => section.heading === '1. Work.');
  assert.match(work.text, /unless.*Business Cooperation Agreement.*written cancellation/s);
  assert.equal(result.sections.filter((section) => section.heading === 'Business Cooperation Agreement').length, 0);
  checkOffsets(result);
});

test('unclosed punctuation in explicit data tables cannot govern later source articles', () => {
  const cases = [
    source('<DOCUMENT>\n<TEXT>\nEXHIBIT ONE\n\nLOAN SCHEDULE\n<TABLE>\n<S>LOCATION <C>BALANCE\nSample City (AREA 12345 400.00\nOther City "LABEL 200.00\n</TABLE>\n\nARTICLE II\n\nSection 2.01 Duties.\nThe Operator shall retain records unless the Requester authorizes disposal.\n\nSection 2.02 Notices.\nA notice shall be written.\n</TEXT>\n</DOCUMENT>', 'text'),
    source('<h2>1. Inventory</h2><table><tr><th>Location</th><th>Quantity</th></tr><tr><td>Sample City (AREA</td><td>2</td></tr><tr><td>Other City "LABEL</td><td>1</td></tr></table><h2>2. Duties</h2><p>The Operator shall retain records unless the Requester authorizes disposal.</p><h2>3. Notices</h2><p>A notice shall be written.</p>'),
  ];
  for (const record of cases) {
    const result = extractSections(record);
    assert.ok(result.sections.some((section) => /(?:Section 2\.01|2\.) Duties/.test(section.heading)));
    assert.ok(result.sections.some((section) => /(?:Section 2\.02|3\.) Notices/.test(section.heading)));
    assert.match(result.normalized_text, /Sample City \(AREA.*Other City "LABEL/s);
    assert.ok(result.warnings.some((warning) => warning.code === 'UNRESOLVED_TABLE_DELIMITER_SCOPED'));
    assert.ok(!result.warnings.some((warning) => warning.code === 'UNRESOLVED_SOURCE_DELIMITER_CONTINUITY'));
    checkOffsets(result);
  }
});

test('truncated labels in untagged fixed-width numeric records cannot swallow later provisions', () => {
  const raw = 'EXHIBIT ONE\n\nLOAN SCHEDULE\n\n1234567       X00/G01     F                  438,000.00         ZZ\n                          360                437,553.43         1\n                          5.8750             2590.94            80\nSAMPLE CITY (AREA 12304    2                  07/12/04           00\n0438197816                05                 09/01/04           0.0000\n\nEXHIBIT TWO\n\nSTANDARD TERMS OF\nSERVICING AGREEMENT\n\nARTICLE I\n\nSection 1.01 Definitions.\n“Work” means the expressly authorized services.\n\nSection 1.02 Duties.\nThe Operator shall preserve the records, unless the Requester authorizes disposal.';
  const result = extractSections(source(raw, 'text'));
  const duties = result.sections.find((section) => section.heading === 'Section 1.02 Duties.');
  assert.ok(duties);
  assert.match(duties.text, /unless.*authorizes disposal/s);
  assert.match(result.normalized_text, /438,000\.00.*437,553\.43.*SAMPLE CITY \(AREA.*07\/12\/04/s);
  assert.ok(result.warnings.some((warning) => warning.code === 'UNRESOLVED_FIXED_WIDTH_DELIMITER_SCOPED'));
  assert.ok(!result.warnings.some((warning) => warning.code === 'UNRESOLVED_SOURCE_DELIMITER_CONTINUITY'));
  checkOffsets(result);
});

test('a malformed closing quote is retained rather than opening a quotation over following articles', () => {
  const raw = `Section 1.02 Use of Words.\n\n"Herein," "hereby," 'thereof," and equivalent words refer to this agreement.\n\nARTICLE II\n\nSection 2.01 Duties.\nThe Operator shall preserve records unless disposal is authorized.\n\nSection 2.02 Notices.\nA notice shall contain the words "First notify the other party.\n\n3. PAYMENT. Do not demand payment before the correction period expires."\n\nSuch wording is required only on the first notice.\n\nSection 2.03 Completion.\nThe parties shall acknowledge completion.`;
  const result = extractSections(source(raw, 'text'));
  assert.ok(result.sections.some((section) => section.heading === 'Section 2.01 Duties.'));
  assert.ok(result.sections.some((section) => section.heading === 'Section 2.03 Completion.'));
  const notice = result.sections.find((section) => section.heading === 'Section 2.02 Notices.');
  assert.match(notice.text, /"First notify.*3\. PAYMENT.*expires\.".*Such wording/s);
  assert.match(result.normalized_text, /'thereof,"/);
  assert.ok(result.warnings.some((warning) => warning.code === 'UNPAIRED_CLOSING_QUOTE_RETAINED'));
  checkOffsets(result);
});

test('introduced numbered construction work and all following cost qualifications share the governor parent', () => {
  const raw = 'EXHIBIT B\n\nWORK ADDENDUM\n\nThe Provider agrees to furnish the improvements specified below:\n\n1. Remodel lighting in the warehouse based on the\nstorage layout approved by both parties.\n\n2. The Provider shall submit the required drawings for approval.\n\n3. Implement the modifications to the alarm system\nin accordance with the approved drawings.\n\nThe Provider shall pay up to $20,000. The Requester shall reimburse any excess within thirty days after written demand.\n\nCompetitive bids are required, unless both parties agree otherwise. The Requester may manage contractors; reimbursement requires an invoice and supporting documents.\n\nIf the upgrade is required solely by the Requester\'s change of use, the Requester shall bear its cost.\n\nEXHIBIT C\n\nREPORTS\n\nThe Provider shall preserve the reports.';
  const result = extractSections(source(raw, 'text'));
  const work = result.sections.find((section) => section.text.includes('improvements specified below:'));
  assert.match(work.text, /1\. Remodel lighting.*storage layout.*2\. The Provider.*3\. Implement.*\$20,000.*thirty days.*Competitive bids.*unless.*supporting documents.*change of use.*bear its cost/s);
  assert.ok(!work.text.includes('EXHIBIT C'));
  assert.ok(!result.sections.some((section) => /^\d\. (?:Remodel|Implement)/u.test(section.heading)));
  assert.equal(work.governor_frames.length, 1);
  const frame = work.governor_frames[0];
  assert.match(frame.governor.text, /specified below:$/u);
  assert.equal(result.normalized_text.slice(frame.start, frame.end).length, frame.end - frame.start);
  assert.equal(createHash('sha256').update(result.normalized_text.slice(frame.start, frame.end)).digest('hex'), frame.sha256);
  assert.equal(work.completeness.semantic_completeness_verified, false);
  assert.ok(work.units.some((unit) => unit.governor_frame_ids.includes(frame.id)));
  checkOffsets(result);
});

test('imperative numbered sentences are retained whole and are not inferred captions', () => {
  const raw = '1. Remodel lighting in the warehouse according to the\nlayout chosen by both parties.\n\n2. Cause the drawings to be prepared and submit them\nfor written approval before work begins.\n\n3. Payment.\nThe Requester shall pay only for authorized work.';
  const result = extractSections(source(raw, 'text'));
  assert.ok(!result.sections.some((section) => /^1\.|^2\./u.test(section.heading)));
  assert.match(result.normalized_text, /according to the layout.*submit them for written approval/s);
  assert.ok(result.sections.some((section) => section.heading === '3. Payment.'));
  checkOffsets(result);
});

test('a complete schedule caption and enumerated body remain one conservative source parent', () => {
  const content = '<div align="right">Schedule A</div><div align="center">Review Materials</div><table><tr><td>1.</td><td>Forms of work authorization applicable to the services; and</td></tr></table><table><tr><td>2.</td><td>An electronic record describing the services as of the agreed cutoff date or another applicable determination date.</td></tr></table><div align="right">Schedule B</div><div align="center">Other Documents</div><p>The Provider shall preserve the other documents.</p>';
  const result = extractSections(source(content));
  const schedule = result.sections.find((section) => section.heading === 'Review Materials');
  assert.ok(schedule.heading_path.includes('Schedule A'));
  assert.match(schedule.text, /Schedule A.*Review Materials.*1\. \| Forms.*; and.*2\. \| An electronic record.*cutoff date or another applicable determination date/s);
  assert.ok(!schedule.text.includes('Schedule B'));
  assert.ok(!result.sections.some((section) => section.text === 'Schedule A\n\nReview Materials'));
  assert.equal(schedule.governor_frames.length, 1);
  assert.equal(schedule.completeness.governing_hierarchy_verified, false);
  checkOffsets(result);
});

test('nested alphabetic and numeric list captions do not sever an outer governor or later reimbursement', () => {
  const content = '<h2>1. Work</h2><p>The Provider shall complete the following:</p><p>(a) The work includes:</p><p>(i) Required systems are:</p><p>1. Lighting</p><p>2. Controls</p><p>The Requester shall reimburse excess cost within30days, except for unauthorized work.</p><h2>EXHIBIT B</h2><p>The parties shall preserve receipts.</p>';
  const result = extractSections(source(content));
  const work = result.sections.find((section) => section.heading === '1. Work');
  assert.match(work.text, /following:.*\(a\).*\(i\).*1\. Lighting.*2\. Controls.*within30days.*except for unauthorized/s);
  assert.ok(!work.text.includes('EXHIBIT B'));
  assert.equal(work.governor_frames.length, 1);
  checkOffsets(result);
});

test('literal HTML heading level prevents a nested Section caption from ending an outer list', () => {
  const content = '<h2>1. Work</h2><p>The notice shall include:</p><h3>Section 1. Lighting</h3><p>The Provider shall inspect the lighting.</p><h3>Section 2. Controls</h3><p>The Provider shall inspect the controls.</p><p>Except that unsafe access is not required.</p><h2>2. Records</h2><p>The parties shall preserve records.</p>';
  const result = extractSections(source(content));
  const work = result.sections.find((section) => section.heading === '1. Work');
  assert.match(work.text, /notice shall include:.*Section 1\. Lighting.*Section 2\. Controls.*Except that unsafe access/s);
  assert.ok(!work.text.includes('2. Records'));
  assert.ok(work.subheadings.filter((heading) => /^Section/u.test(heading.text)).every((heading) => heading.provenance.html_level === 3));
  checkOffsets(result);
});

test('intervening pagination stays literal while the introduced list frame remains intact', () => {
  const raw = '1. Work.\n\nThe Provider shall furnish the following:\n\nCONFIDENTIAL\n\n8\n\n1. Lighting\n\nThe Provider shall inspect the lighting.\n\n2. Controls\n\nThe Requester shall pay the excess, unless otherwise agreed.\n\nEXHIBIT B\n\nThe parties shall preserve records.';
  const result = extractSections(source(raw, 'text'));
  const work = result.sections.find((section) => section.heading === '1. Work.');
  assert.match(work.text, /following:.*CONFIDENTIAL.*8.*1\. Lighting.*2\. Controls.*unless otherwise agreed/s);
  assert.ok(!work.text.includes('EXHIBIT B'));
  assert.equal(work.governor_frames.length, 1);
  checkOffsets(result);
});

test('native HTML list structure supplies enumeration evidence without inventing marker text', () => {
  const content = '<h2>1. Work</h2><p>The Provider shall perform:</p><ol><li><p>Inspect the lighting.</p></li><li><p>Inspect the controls.</p><ul><li>Retain exception records.</li></ul></li></ol><p>The Requester shall reimburse only documented authorized expense.</p><h2>2. Notices</h2><p>A notice shall be written.</p>';
  const result = extractSections(source(content));
  const work = result.sections.find((section) => section.heading === '1. Work');
  assert.match(work.text, /shall perform:.*Inspect the lighting.*Inspect the controls.*Retain exception records.*only documented authorized/s);
  assert.ok(!work.text.includes('2. Notices'));
  assert.ok(!/1\. Inspect|2\. Inspect/u.test(result.normalized_text));
  assert.equal(work.governor_frames.length, 1);
  checkOffsets(result);
});

test('wrapped attachment references retain a license grant and its use restriction together', () => {
  const raw = '2.2 License.\n\nThe Provider grants the Requester a limited personal license to use the items set forth on\nAnnex Q (collectively, the "Materials"), but only in connection with\nthe authorized work and as permitted by Section 6.\n\nEXHIBIT R\n\nAPPROVED RECORDS\n\nThe Requester shall preserve the records.';
  const result = extractSections(source(raw, 'text'));
  const license = result.sections.find((section) => section.heading === '2.2 License.');
  assert.match(license.text, /grants.*set forth on Annex Q.*but only in connection with the authorized work.*Section 6/s);
  assert.ok(!result.sections.some((section) => section.heading.startsWith('Annex Q')));
  assert.ok(!license.text.includes('EXHIBIT R'));
  assert.ok(result.sections.some((section) => section.heading_path.includes('EXHIBIT R') && section.text.includes('APPROVED RECORDS')));
  checkOffsets(result);
});

test('standalone-looking attachment markers inside unfinished wrapped prose are not boundaries', () => {
  for (const marker of ['EXHIBIT K', 'Schedule 2.1', 'Appendix C', 'ANNEX IV', 'Attachment D']) {
    const raw = `1. Work.\n\nThe Provider shall observe the limits described in\n${marker}\nand may exceed them only with written authorization.\n\nEXHIBIT Z\n\nRECORDS\n\nThe parties shall preserve records.`;
    const result = extractSections(source(raw, 'text'));
    const work = result.sections.find((section) => section.heading === '1. Work.');
    assert.ok(work.text.includes(marker));
    assert.match(work.text, /only with written authorization/s);
    assert.ok(!result.sections.some((section) => section.heading === marker));
    assert.ok(result.sections.some((section) => section.heading_path.includes('EXHIBIT Z') && section.text.includes('RECORDS')));
    assert.ok(result.warnings.some((warning) => warning.code === 'WRAPPED_SENTENCE_HEADING_SUPPRESSED'));
    checkOffsets(result);
  }
});

test('paragraph and native heading tags cannot sever a literal unfinished attachment reference', () => {
  for (const reference of ['<p><b>Schedule F</b></p>', '<h3>Appendix C (Services)</h3>']) {
    const content = `<h2>1. License</h2><p>The Provider grants a limited personal license to the items identified in</p>${reference}<p>but only for the authorized work and without any right to sublicense.</p><h2>2. Records</h2><p>The Requester shall preserve records.</p>`;
    const result = extractSections(source(content));
    const license = result.sections.find((section) => section.heading === '1. License');
    assert.match(license.text, /identified in.*(?:Schedule F|Appendix C).*but only.*without any right to sublicense/s);
    assert.ok(!license.text.includes('2. Records'));
    assert.ok(result.warnings.some((warning) => warning.code === 'UNFINISHED_SENTENCE_HEADING_SUPPRESSED'));
    checkOffsets(result);
  }
});

test('attachment marker prefixes do not make body-reference clauses into captions', () => {
  const content = '<h2>1. Duties</h2><p>The parties agreed to the following limits.</p><p>Schedule A (collectively, the "Items"), but only in connection with</p><p>authorized work.</p><p>Exhibit B to the Agreement</p><p>is incorporated subject to the stated exception.</p><h2>2. Notice</h2><p>The Provider shall give written notice.</p>';
  const result = extractSections(source(content));
  const duties = result.sections.find((section) => section.heading === '1. Duties');
  assert.match(duties.text, /Schedule A.*but only.*authorized work.*Exhibit B to the Agreement.*subject to the stated exception/s);
  assert.ok(!result.sections.some((section) => /^(?:Schedule A|Exhibit B)/u.test(section.heading)));
  checkOffsets(result);
});

test('positive standalone attachment and caption evidence still establish unverified source fences', () => {
  const raw = 'EXHIBIT A\n\nThe Provider shall preserve the listed records.\n\nSchedule 2.1: Payment Terms\n\nThe Requester shall pay the agreed amount.\n\nAppendix C (Services)\n\nThe Provider shall perform the authorized work.\n\nANNEX IV - Approved Records\n\nThe parties shall keep the records.';
  const result = extractSections(source(raw, 'text'));
  assert.deepEqual(result.sections.map((section) => section.heading), ['EXHIBIT A', 'Schedule 2.1: Payment Terms', 'Appendix C (Services)', 'ANNEX IV - Approved Records']);
  assert.ok(result.sections.every((section) => section.heading_provenance.verified === false));
  assert.ok(result.sections.every((section) => section.heading_provenance.attachment_evidence));
  checkOffsets(result);
});

test('layout labels between unfinished prose and an attachment reference retain the same governor', () => {
  const raw = '1. Work.\n\nThe Provider shall apply the restrictions specified under\n\nCONFIDENTIAL\n\n12\n\nSchedule A\n\nbut only to the first authorized delivery.\n\nEXHIBIT B\n\nThe parties shall preserve receipts.';
  const result = extractSections(source(raw, 'text'));
  const work = result.sections.find((section) => section.heading === '1. Work.');
  assert.match(work.text, /specified under.*CONFIDENTIAL.*12.*Schedule A.*but only to the first authorized delivery/s);
  assert.ok(!work.text.includes('EXHIBIT B'));
  assert.ok(!result.sections.some((section) => section.heading === 'Schedule A'));
  checkOffsets(result);
});

test('a body attachment reference does not end an introduced list and detach later payment conditions', () => {
  const content = '<h2>1. Work</h2><p>The Provider shall furnish:</p><p>1. Lighting</p><p>The lights are identified in</p><p>Attachment D (collectively, the "Equipment"), but only for</p><p>the authorized location.</p><p>The Requester shall reimburse documented excess cost within thirty days, except for unauthorized work.</p><h2>EXHIBIT B</h2><p>The parties shall preserve receipts.</p>';
  const result = extractSections(source(content));
  const work = result.sections.find((section) => section.heading === '1. Work');
  assert.match(work.text, /shall furnish:.*Lighting.*identified in.*Attachment D.*only for.*authorized location.*thirty days.*except for unauthorized/s);
  assert.ok(!work.text.includes('EXHIBIT B'));
  assert.equal(work.governor_frames.length, 1);
  checkOffsets(result);
});

test('unfinished reference continuity survives short fragments until literal sentence closure', () => {
  const cases = [
    source('<h2>1. License</h2><p>The Provider grants rights identified in</p><p>Schedule A</p><p>and</p><h3>Annex B</h3><p>but only for approved work.</p><h2>2. Records</h2><p>The parties shall preserve records.</p>'),
    source('1. License.\n\nThe Provider grants rights identified in\nSchedule A\n\nand\n\nAnnex B\n\nbut only for approved work.\n\n2. Records.\n\nThe parties shall preserve records.', 'text'),
  ];
  for (const record of cases) {
    const result = extractSections(record);
    const license = result.sections.find((section) => /^1\. License/u.test(section.heading));
    assert.match(license.text, /identified in.*Schedule A.*and.*Annex B.*but only for approved work/s);
    assert.ok(!license.text.includes('2. Records'));
    assert.ok(!result.sections.some((section) => /^(?:Schedule A|Annex B)/u.test(section.heading)));
    checkOffsets(result);
  }
});

test('inline native heading bodies retain a proviso and all qualifications across pagination', () => {
  const content = '<h2>5.05 Confidentiality. Each Member shall safeguard the information using its customary care, provided</h2><p align="center">19</p><hr><h2>that an inadvertent disclosure is mitigated and reasonable steps prevent repetition. No restriction applies to information (1) public without breach; (2) already known; (3) lawfully obtained; (4) independently developed; (5) required by law, after written notice and disclosure only of the required portion; (6) reviewed by an informed auditor; or (7) released in writing. An injunction may be sought. Member includes its affiliates.</h2><h2>5.06 Publicity. Neither Member shall announce the arrangement without approval, except when legally required.</h2>';
  const result = extractSections(source(content));
  const confidentiality = result.sections.find((section) => section.heading === '5.05 Confidentiality.');
  assert.match(confidentiality.text, /customary care, provided.*19.*that an inadvertent disclosure.*mitigated.*\(1\).*required portion.*\(7\).*injunction.*affiliates/s);
  assert.ok(!confidentiality.text.includes('5.06 Publicity'));
  assert.ok(result.sections.some((section) => section.heading === '5.06 Publicity.' && section.text.includes('except when legally required')));
  assert.ok(confidentiality.suppressed_heading_presentations.some((item) => item.html_level === 2 && item.verified === false && result.normalized_text.slice(item.start, item.end).startsWith('that an inadvertent')));
  assert.ok(result.warnings.some((warning) => warning.code === 'UNFINISHED_SENTENCE_HEADING_SUPPRESSED'));
  checkOffsets(result);
});

test('conditional introducers retain native prose through narrow page and footer labels', () => {
  for (const connector of ['provided', 'provided, however,', 'except', 'unless', 'if', 'subject to', 'because', 'however,']) {
    const result = extractSections(source(`<p>1. Duties. The Provider shall perform the authorized work ${connector}</p><p>CONFIDENTIAL</p><p>Page 3 of 9</p><h3>the Requester supplies safe access and the stated approval.</h3><h2>2. Records</h2><p>The parties shall preserve the records.</p>`));
    const duties = result.sections.find((section) => section.heading === '1. Duties.');
    assert.ok(duties.text.includes(connector));
    assert.match(duties.text, /CONFIDENTIAL.*Page 3 of 9.*safe access.*approval\./s);
    assert.ok(!duties.text.includes('2. Records'));
    assert.ok(result.sections.some((section) => section.heading === '2. Records'));
    assert.ok(!result.sections.some((section) => /^the Requester/u.test(section.heading)));
    checkOffsets(result);
  }
});

test('native body paragraphs cannot invent boundaries while genuine mixed-case captions remain', () => {
  const content = '<h2>1. Work</h2><p>The Provider shall perform the authorized work.</p><h2>Each delivery shall include the agreed records, except that private records need not be copied.</h2><h2>that qualification also applies to replacement deliveries.</h2><h2>What Notices Must Include</h2><p>Each notice shall identify the deficiency.</p><h2>Limitation of Liability</h2><p>Neither party shall owe indirect damages.</p>';
  const result = extractSections(source(content));
  const work = result.sections.find((section) => section.heading === '1. Work');
  assert.match(work.text, /Each delivery.*except that private records.*that qualification.*replacement deliveries/s);
  assert.ok(!work.text.includes('What Notices Must Include'));
  assert.ok(result.sections.some((section) => section.heading === 'What Notices Must Include'));
  assert.ok(result.sections.some((section) => section.heading === 'Limitation of Liability'));
  assert.ok(work.suppressed_heading_presentations.every((item) => item.html_level === 2 && item.verified === false));
  assert.ok(result.warnings.some((warning) => warning.code === 'BODY_SHAPED_NATIVE_HEADING_RETAINED'));
  checkOffsets(result);
});

test('native and paragraph inline titles use the emitted body as continuing sentence context', () => {
  for (const tag of ['h2', 'p']) {
    const content = `<${tag}>Section 1.01 Duties. The Provider shall comply with the restrictions provided</${tag}><p>6</p><h3>that only authorized costs may be reimbursed.</h3><p>Section 1.02 Notices. Notice shall be in writing.</p><p>ARTICLE II</p><p>Section 2.01 Records. The parties shall preserve records.</p>`;
    const result = extractSections(source(content));
    const duties = result.sections.find((section) => section.heading === 'Section 1.01 Duties.');
    assert.match(duties.text, /restrictions provided.*6.*that only authorized costs/s);
    assert.ok(!duties.text.includes('Section 1.02'));
    assert.ok(result.sections.some((section) => section.heading === 'Section 1.02 Notices.'));
    assert.ok(result.sections.some((section) => section.heading_path.includes('ARTICLE II')));
    checkOffsets(result);
  }
});

test('plain proviso continuity retains standalone-looking caption words until sentence closure', () => {
  const result = extractSections(source('1. Work.\n\nThe Provider shall apply the agreed restriction provided\n\nCONFIDENTIAL\n\n8\n\nThe Agreement\n\nis amended in writing before extra work begins.\n\nEXHIBIT B\n\nThe parties shall preserve receipts.', 'text'));
  const work = result.sections.find((section) => section.heading === '1. Work.');
  assert.match(work.text, /restriction provided.*CONFIDENTIAL.*8.*The Agreement.*amended in writing/s);
  assert.ok(!work.text.includes('EXHIBIT B'));
  assert.ok(result.sections.some((section) => section.heading === 'EXHIBIT B'));
  checkOffsets(result);
});

test('all-capital native operative paragraphs need bounded caption evidence', () => {
  const body = 'THE PROVIDER SHALL KEEP THE REQUESTER INFORMED OF EVERY MATERIAL CHANGE TO THE AUTHORIZED WORK AND SHALL NOT PERFORM ADDITIONAL WORK WITHOUT PRIOR WRITTEN APPROVAL EXCEPT WHEN EMERGENCY PROTECTION IS REQUIRED';
  const result = extractSections(source(`<h2>1. Work</h2><p>The Provider shall perform the authorized work.</p><h2>${body}</h2><p>This condition applies to replacement work.</p><h2>LIMITATION OF LIABILITY</h2><p>Neither party shall owe indirect damages.</p>`));
  const work = result.sections.find((section) => section.heading === '1. Work');
  assert.ok(work.text.includes(body));
  assert.match(work.text, /This condition applies to replacement work/);
  assert.ok(!work.text.includes('LIMITATION OF LIABILITY'));
  assert.ok(result.sections.some((section) => section.heading === 'LIMITATION OF LIABILITY'));
  assert.ok(work.suppressed_heading_presentations.some((item) => result.normalized_text.slice(item.start, item.end) === body));
  checkOffsets(result);
});

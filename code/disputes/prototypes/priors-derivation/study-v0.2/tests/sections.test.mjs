// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { extractSections, selectUnits } from '../lib/sections.mjs';
import { nativeDecorationInput, projectNativeDecoration } from '../lib/source-decoration.mjs';

// Synthetic identities test API binding only; they never attest current study
// source files, a real cache, a source reading, or resolution of an issue.
const syntheticNativeIdentity = { tracerSourceSHA256: 'a'.repeat(64), collectorSourceSHA256: 'b'.repeat(64) };
const nativeSource = (content, format = 'html', options = {}) => extractSections({ id: 'synthetic-native-source', source_url: 'https://example.invalid/native', content, format }, { ...options, nativeDecorationIdentity: syntheticNativeIdentity });
const nativeCoverage = result => {
  const coverage = new Map();
  for (const segment of result.native_source_decorations.segments) for (const part of segment.sources) {
    const rows = coverage.get(part.run_id) ?? []; rows.push([part.decoded_start, part.decoded_end]); coverage.set(part.run_id, rows);
  }
  for (const rows of coverage.values()) { rows.sort((a,b) => a[0] - b[0]); for (let i=1; i<rows.length; i++) assert.ok(rows[i][0] >= rows[i-1][1], 'source origin cannot be consumed twice'); }
  return coverage;
};

test('collector origins distinguish repeated identical marked and unmarked words by DOM source ranges', () => {
  const raw = '<p>alpha <strike>duplicate</strike> duplicate <u>duplicate</u>.</p>', result = nativeSource(raw), envelope = result.native_source_decorations;
  assert.equal(result.normalized_text, 'alpha duplicate duplicate duplicate.');
  assert.equal(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  assert.equal(envelope.tracer_source_sha256, syntheticNativeIdentity.tracerSourceSHA256);
  assert.equal(envelope.collector_source_sha256, syntheticNativeIdentity.collectorSourceSHA256);
  const projection = projectNativeDecoration(envelope, { raw, normalizedText: result.normalized_text, start: 0, end: result.normalized_text.length });
  assert.deepEqual(projection.annotations.map(a => a.text), ['duplicate', 'duplicate']);
  assert.notEqual(projection.annotations[0].origins[0].run_id, projection.annotations[1].origins[0].run_id);
  assert.ok(!('trace' in result.units[0].native_source_decorations_ref));
  assert.equal(result.units[0].native_source_decorations_ref.envelope_sha256, envelope.sha256);
  nativeCoverage(result); checkOffsets(result);
});

test('zero-output marked whitespace at both caption/body cuts is retained once without moving source words', () => {
  const raw = '<p><strike> \t</strike><u>1. Duties. </u>The Provider shall retain records.<strike> \t</strike></p>', result = nativeSource(raw), envelope = result.native_source_decorations;
  assert.equal(result.normalized_text, '1. Duties.\n\nThe Provider shall retain records.');
  assert.equal(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  const zeros = envelope.segments.filter(s => s.start === s.end);
  assert.ok(zeros.length >= 3); assert.ok(zeros.some(s => s.start === 0)); assert.ok(zeros.some(s => s.start === 10)); assert.ok(zeros.some(s => s.start === result.normalized_text.length));
  const coverage = nativeCoverage(result);
  for (const run of envelope.trace.runs.filter(r => r.path_id)) assert.equal((coverage.get(run.id) ?? []).reduce((n,[a,b]) => n + b-a, 0), run.decoded_text.length);
  checkOffsets(result);
});

test('single-run NFC, NBSP conversion and filtered zero-width characters have explicit source transforms', () => {
  const raw = '<p><u>e\u0301</u> X&nbsp;Y Z\u200bQ</p>', result = nativeSource(raw), envelope = result.native_source_decorations;
  assert.equal(result.normalized_text, 'é X Y ZQ');
  assert.equal(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  assert.ok(envelope.segments.some(s => s.normalization === 'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'));
  assert.ok(envelope.segments.some(s => s.normalization === 'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'));
  assert.match(nativeDecorationInput(envelope, { raw, normalizedText: result.normalized_text, start: 0, end: result.normalized_text.length }).text, /NATIVE_SOURCE_MARKS_UNVERIFIED/u);
  nativeCoverage(result); checkOffsets(result);
});

test('cross-run NFC with different native marks remains ambiguous without losing the source unit', () => {
  const raw = '<p><u>e</u><strike>\u0301</strike></p>', result = nativeSource(raw);
  assert.equal(result.status, 'accepted'); assert.equal(result.normalized_text, 'é'); assert.ok(result.units.length);
  assert.notEqual(result.native_source_decorations.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  assert.ok(result.native_source_decorations.ambiguous_segments > 0);
  assert.throws(() => nativeDecorationInput(result.native_source_decorations, { raw, normalizedText: result.normalized_text, start: 0, end: 1 }), /unresolved/iu);
  nativeCoverage(result); checkOffsets(result);
});

test('shared-path collapsed whitespace retains every source with explicit joint attribution', () => {
  const raw = '<p><u>A <span> B</span> C</u></p>', result = nativeSource(raw), envelope = result.native_source_decorations;
  assert.equal(result.normalized_text, 'A B C');
  assert.equal(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  const segment = envelope.segments.find(s => s.sources.length > 1);
  assert.ok(segment); assert.equal(segment.normalization, 'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1');
  const runs = new Map(envelope.trace.runs.map(r => [r.id,r]));
  const paths = new Set(segment.sources.map(s => runs.get(s.run_id).path_id));
  assert.equal(paths.size, 1); assert.equal(segment.sources.length, 2);
  assert.deepEqual(segment.joint_source_attribution, { policy: 'IDENTICAL_NATIVE_PATH_WHITESPACE_COLLAPSE_V1', path_id: [...paths][0], per_run_character_attribution: false });
  const view = projectNativeDecoration(envelope, { raw, normalizedText:result.normalized_text,start:segment.start,end:segment.end });
  assert.ok(view.annotations.some(a => a.joint_source_attributions?.some(x => x.per_run_character_attribution === false)));
  assert.ok(view.annotations.flatMap(a => a.origins).every(o => o.clipping_mapping !== 'EXACT_DECODED_RANGE'));
  nativeCoverage(result); checkOffsets(result);
});

test('all-null native paths can share one collapsed space without inventing per-run character ownership', () => {
  const raw = '<p>A <span> B</span> C</p>', result = nativeSource(raw), envelope = result.native_source_decorations;
  assert.equal(result.normalized_text, 'A B C'); assert.equal(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  const segment = envelope.segments.find(s => s.sources.length > 1);
  assert.ok(segment); assert.equal(segment.joint_source_attribution.path_id, null);
  assert.equal(segment.joint_source_attribution.per_run_character_attribution, false);
  assert.equal(nativeDecorationInput(envelope, { raw, normalizedText:result.normalized_text,start:0,end:result.normalized_text.length }).text, result.normalized_text);
  nativeCoverage(result); checkOffsets(result);
});

test('different native paths retain a complete ordered joint witness without claiming exact character attribution', () => {
  for (const raw of ['<p><u>The Provider shall maintain records </u><strike> and retain each delivery receipt.</strike></p>', '<p><u>The Provider shall maintain records </u><u> and retain each delivery receipt.</u></p>']) {
    const result = nativeSource(raw), envelope = result.native_source_decorations;
    assert.equal(result.normalized_text, 'The Provider shall maintain records and retain each delivery receipt.'); assert.equal(result.status, 'accepted'); assert.ok(result.units.length);
    assert.notEqual(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
    const segment = envelope.segments.find(s => s.sources.length > 1);
    assert.ok(segment); assert.equal(segment.mapping, 'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE');
    assert.equal(segment.joint_source_attribution.per_run_character_attribution, false);
    assert.equal(segment.joint_source_attribution.native_mark_attribution_verified, false);
    const projection=projectNativeDecoration(envelope,{raw,normalizedText:result.normalized_text,start:0,end:result.normalized_text.length});
    const witness=projection.annotations.find(a=>a.joint_whitespace_witness)?.joint_whitespace_witness;
    assert.ok(witness);assert.equal(witness.origins.length,2);assert.equal(witness.normalized_output.mark_attribution,'UNVERIFIED_NO_SOURCE_ORIGIN_SELECTED');
    const encoded=nativeDecorationInput(envelope,{raw,normalizedText:result.normalized_text,start:0,end:result.normalized_text.length}).text;
    assert.notEqual(encoded,result.normalized_text);assert.match(encoded,/JOINT_NORMALIZATION_UNVERIFIED/u);
    nativeCoverage(result); checkOffsets(result);
  }
});

test('shared native ancestry alone cannot make cross-run NFC attribution exact', () => {
  const raw = '<p><u>e<span>\u0301</span></u></p>', result = nativeSource(raw), envelope = result.native_source_decorations;
  assert.equal(result.normalized_text, 'é'); assert.notEqual(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  const segment = envelope.segments.find(s => s.sources.length > 1);
  assert.ok(segment); assert.equal(segment.normalization, 'EXTRACTOR_NFC_FILTER_WHITESPACE_V1');
  assert.equal(segment.mapping, 'AMBIGUOUS_PER_RUN_MAPPING'); assert.equal(segment.joint_source_attribution, undefined);
  nativeCoverage(result); checkOffsets(result);
});

test('filtered origins inside a collapsed space stay in ordered joint evidence', () => {
  for (const filtered of ['\u200b', '\ufeff', '\u0001', '\u000b']) {
    const raw = `<p><u>The Provider shall retain ${filtered} every delivery receipt.</u></p>`, result = nativeSource(raw), envelope = result.native_source_decorations;
    assert.equal(result.normalized_text, 'The Provider shall retain every delivery receipt.');
    assert.equal(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN'); assert.deepEqual(envelope.collector_issues, []);
    const segment = envelope.segments.find(s => s.normalization === 'EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1');
    assert.ok(segment); assert.equal(segment.end - segment.start, 1);
    assert.equal(segment.filtered_source_events.length, 1);
    const runs = new Map(envelope.trace.runs.map(r => [r.id,r])), joined = segment.sources.map(p => runs.get(p.run_id).decoded_text.slice(p.decoded_start,p.decoded_end)).join('');
    assert.equal(joined, ` ${filtered} `);
    assert.ok(segment.sources.some(p => p.decoded_start <= segment.filtered_source_events[0].decoded_start && p.decoded_end >= segment.filtered_source_events[0].decoded_end));
    nativeCoverage(result); checkOffsets(result);
  }
});

test('filtered whitespace across runs retains all ordered origins and explicit differing-mark joint evidence', () => {
  for (const different of [false, true]) {
    const raw = different
      ? '<p><u>The Provider shall retain </u><strike>\u200b</strike><u> every delivery receipt.</u></p>'
      : '<p><u>The Provider shall retain <span>\u200b</span> every delivery receipt.</u></p>';
    const result = nativeSource(raw), envelope = result.native_source_decorations;
    assert.equal(result.normalized_text, 'The Provider shall retain every delivery receipt.');
    assert.equal(result.status, 'accepted'); assert.deepEqual(envelope.collector_issues, []);
    const segment = envelope.segments.find(s => s.normalization === 'EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1');
    assert.ok(segment); assert.equal(segment.sources.length, 3); assert.equal(segment.filtered_source_events.length, 1);
    if (different) {
      assert.equal(segment.mapping, 'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE'); assert.equal(segment.joint_source_attribution.native_mark_attribution_verified, false);
      const projection=projectNativeDecoration(envelope,{raw,normalizedText:result.normalized_text,start:0,end:result.normalized_text.length});
      const witness=projection.annotations.find(a=>a.joint_whitespace_witness)?.joint_whitespace_witness;
      assert.ok(witness);assert.equal(witness.origins.length,3);
      assert.match(nativeDecorationInput(envelope,{raw,normalizedText:result.normalized_text,start:0,end:result.normalized_text.length}).text,/JOINT_NORMALIZATION_UNVERIFIED/u);
    } else {
      assert.equal(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN'); assert.equal(segment.joint_source_attribution.per_run_character_attribution, false);
    }
    nativeCoverage(result); checkOffsets(result);
  }
});

test('filtered origins at caption cuts and trimmed edges retain zero output without fabricated space locations', () => {
  const raw = '<p><strike> \u200b </strike><u>1. Duties. </u>The Provider shall retain records.<strike> \u200b </strike></p>', result = nativeSource(raw), envelope = result.native_source_decorations;
  assert.equal(result.normalized_text, '1. Duties.\n\nThe Provider shall retain records.'); assert.equal(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  assert.ok(envelope.segments.filter(s=>s.start===s.end).length >= 4);
  assert.ok(!envelope.segments.some(s=>s.normalization==='EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1'));
  const coverage=nativeCoverage(result); for(const run of envelope.trace.runs) assert.equal((coverage.get(run.id)??[]).reduce((n,[a,b])=>n+b-a,0),run.decoded_text.length);
  checkOffsets(result);
});

test('trimmed multi-run whitespace splits only independently empty origins without changing their source point', () => {
  const raw = '<p><u> \t</u><strike> \n</strike>The Provider shall retain records.<u> \t</u><strike> \n</strike></p>', result = nativeSource(raw), envelope = result.native_source_decorations;
  assert.equal(result.normalized_text, 'The Provider shall retain records.'); assert.equal(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  const zeros=envelope.segments.filter(s=>s.start===s.end);assert.ok(zeros.length>=4);
  assert.ok(zeros.every(s=>s.sources.length===1));assert.ok(zeros.every(s=>s.start===0||s.start===result.normalized_text.length));
  const coverage=nativeCoverage(result);for(const run of envelope.trace.runs)assert.equal((coverage.get(run.id)??[]).reduce((n,[a,b])=>n+b-a,0),run.decoded_text.length);
  checkOffsets(result);
});

test('a collapsed space later trimmed from a table cell retains independent differing zero origins', () => {
  const raw = '<table><tr><td><u>The Provider shall retain records </u><strike> </strike></td><td>9</td></tr></table>', result=nativeSource(raw), envelope=result.native_source_decorations;
  assert.equal(result.normalized_text,'The Provider shall retain records | 9');assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');
  const zeros=envelope.segments.filter(s=>s.start===s.end);assert.ok(zeros.length>=2);assert.ok(zeros.every(s=>s.sources.length===1));
  const coverage=nativeCoverage(result);for(const run of envelope.trace.runs)assert.equal((coverage.get(run.id)??[]).reduce((n,[a,b])=>n+b-a,0),run.decoded_text.length);
  checkOffsets(result);
});

test('table captions, genuine rows, numbered layout prefixes and fallback consume each origin once', () => {
  const raw = '<table><caption><u>Rates</u></caption><tr><td><strike>Low</strike></td><td>7</td></tr></table><table><tr><td><u>2.</u></td><td><p>Records.</p><p>The Provider shall retain receipts.</p></td></tr></table><table><caption><strike>Other Records</strike></caption></table>';
  const result = nativeSource(raw), envelope = result.native_source_decorations;
  assert.match(result.normalized_text, /Rates.*Low \| 7.*2\. \| Records\..*retain receipts.*Other Records/s);
  assert.equal(envelope.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  const coverage = nativeCoverage(result);
  for (const run of envelope.trace.runs) assert.equal((coverage.get(run.id) ?? []).reduce((n,[a,b]) => n+b-a,0), run.decoded_text.length);
  // Frozen V13 reports one flattening event from its whole-table fallback.
  // The sidecar must preserve that existing ledger rather than erase it.
  assert.deepEqual(result.excluded, [{ reason: 'nested_table_flattened', count: 1 }]);
  assert.equal(result.normalized_sha256, 'e029cc3163a02fcc4b2c5e612007c1bbc3974638d8b38f266be1d5de4dc9c96b');
  checkOffsets(result);
});

test('PRE line joins, CRLF and wrapped captions retain origins with stable paragraph source', () => {
  const raw = '<pre><u>ARTICLE I</u>\r\n\r\n<u>RECORDS</u>\r\n\r\nThe Provider shall retain\r\nthe original receipts.\r\n\r\n2. Notices.\r\nThe Requester shall give notice.</pre>', result = nativeSource(raw);
  assert.match(result.normalized_text, /ARTICLE I.*RECORDS.*retain the original receipts.*2\. Notices.*give notice/s);
  assert.equal(result.native_source_decorations.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  nativeCoverage(result); checkOffsets(result);
  const plain = nativeSource('1. Records.\r\n\r\nThe Provider shall retain\r\nthe original receipts.\r\n', 'text');
  assert.equal(plain.native_source_decorations.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  nativeCoverage(plain); checkOffsets(plain);
});

test('approved literal SGML profile preserves framing and unknown tag text without interpreting native changes', () => {
  const raw = '<DOCUMENT><TYPE>EX-10<TEXT>1. Records.\n\nThe Provider shall retain A&amp;B.\n<TABLE><S><C>Item    7    9\n<STRIKE>literal tag text</STRIKE></TABLE>\n2. Notice.\nThe Requester shall notify.</TEXT></DOCUMENT>', result = nativeSource(raw, 'text');
  assert.match(result.normalized_text, /retain A&B.*<STRIKE>literal tag text<\/STRIKE>/s);
  assert.equal(result.native_source_decorations.trace.source_profile, 'LEGACY_SEC_SGML_LITERAL_TAGS_V1');
  assert.equal(result.native_source_decorations.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  assert.equal(result.native_source_decorations.trace.sources.length, 0);
  nativeCoverage(result); checkOffsets(result);
});

test('missing current source identity is explicit unbound and cannot silently encode plain text', () => {
  const raw = '<p>The Provider shall retain <strike>all</strike> records.</p>', result = extractSections({ id:'synthetic-unbound',content:raw,format:'html' });
  assert.equal(result.status, 'accepted'); assert.ok(result.units.length);
  assert.equal(result.native_source_decorations.tracer_source_sha256, null);
  assert.equal(result.native_source_decorations.collector_source_sha256, null);
  assert.notEqual(result.native_source_decorations.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
  assert.throws(() => nativeDecorationInput(result.native_source_decorations, { raw, normalizedText:result.normalized_text,start:0,end:result.normalized_text.length }), /unresolved/iu);
  checkOffsets(result);
});

test('four-MiB flat and deep many-leaf sources keep complete origins within the declared memory bound', { timeout: 120000 }, t => {
  const limit = 4 * 1024 * 1024, leaf = `<span>${'x'.repeat(64)}</span>`, started = process.hrtime.bigint();
  for (const depth of [0, 200]) {
    const prefix = '<div>'.repeat(depth) + '<p><u>marker</u>', suffix = '</p>' + '</div>'.repeat(depth);
    const leaves = Math.floor((limit - prefix.length - suffix.length) / leaf.length), raw = prefix + leaf.repeat(leaves) + suffix;
    const result = nativeSource(raw, 'html', { maxContentChars: limit, maxRawBytes: limit });
    assert.ok(raw.length <= limit && raw.length > limit - leaf.length);
    assert.equal(result.status, 'accepted'); assert.equal(result.normalized_text.length, 6 + leaves * 64);
    assert.equal(result.native_source_decorations.mapping_status, 'EXACT_COLLECTOR_ORIGIN');
    assert.equal(result.native_source_decorations.trace.runs.length, leaves + 1);
    assert.equal(result.native_source_decorations.unmapped.length, 0);
    assert.equal(result.native_source_decorations.unmapped_normalized.length, 0);
    nativeCoverage(result); checkOffsets(result);
    const rss = process.resourceUsage().maxRSS * 1024;
    assert.ok(rss < 6 * 1024 ** 3, `maximum RSS ${rss} exceeds six GiB`);
    t.diagnostic(JSON.stringify({ synthetic_raw_bytes: Buffer.byteLength(raw), depth, leaves, normalized_characters: result.normalized_text.length, maximum_rss_bytes: rss }));
  }
  t.diagnostic(JSON.stringify({ elapsed_seconds: Number(process.hrtime.bigint() - started) / 1e9 }));
});

test('all-visible body collection crosses former 255/256 cuts without dropping late conditions', () => {
  const body = '<h2>Section 1.1 Records</h2><p>The Provider shall retain receipts, except cancelled work, and give notice within30days.</p>';
  const flat = nativeSource(body);
  for (const depth of [254,255,256,257,701]) {
    const result=nativeSource('<div>'.repeat(depth)+body+'</div>'.repeat(depth));
    assert.equal(result.status,'accepted');assert.equal(result.normalized_text,flat.normalized_text);
    assert.ok(!result.excluded.some(x=>x.reason==='html_depth_limit'));assert.ok(!result.warnings.some(x=>x.code==='HTML_DEPTH_LIMIT'));
    if(depth>=255)assert.ok(result.warnings.some(x=>x.code==='HTML_ALL_VISIBLE_DEEP_BODY_RECONSTRUCTED'));
    checkOffsets(result);
  }
});

test('701-deep inline, PRE and table bodies retain every visible literal and omit hidden or inert branches', () => {
  const wrap=s=>'<span>'.repeat(701)+s+'</span>'.repeat(701);
  const raw='<p>Opening evidence.</p><div>'+wrap('<p>The Provider shall retain <u>late records</u> unless cancelled.</p>')+'</div>'+
    '<div>'.repeat(701)+'<pre>2. COSTS.\nThe Requester shall pay75 after notice.\nExcept disputed charges.</pre><table><caption>Shared Limits</caption><tr><th>Item</th><th>Maximum</th></tr><tr><td>Records</td><td>75</td></tr></table><p>These limits apply only to approved work.</p>'+'</div>'.repeat(701)+
    '<div hidden>'+wrap('hidden secret')+'</div><script>inert secret</script><p>The parties shall retain the original source.</p>';
  const result=nativeSource(raw);assert.equal(result.status,'accepted');
  for(const literal of ['Opening evidence.','late records','unless cancelled.','pay75','Except disputed charges.','Shared Limits','Item | Maximum','Records | 75','only to approved work','original source.'])assert.ok(result.normalized_text.includes(literal),literal);
  assert.ok(!/hidden secret|inert secret/u.test(result.normalized_text));assert.equal(result.normalized_text.split('late records').length-1,1);
  assert.equal(result.excluded.find(x=>x.reason==='hidden_html_excluded').count,1);assert.equal(result.excluded.find(x=>x.reason==='inert_script_excluded').count,1);
  checkOffsets(result);
});

test('deep layout-table enter/exit callbacks do not use the JavaScript call stack', () => {
  const depth=701,raw='<table><tr><td>'.repeat(depth)+'<p>The Provider shall retain all receipts except withdrawn notices.</p>'+'</td></tr></table>'.repeat(depth), result=nativeSource(raw);
  assert.equal(result.status,'accepted');assert.equal(result.normalized_text,'The Provider shall retain all receipts except withdrawn notices.');
  assert.ok(!result.warnings.some(x=>x.code==='HTML_DEPTH_LIMIT'));checkOffsets(result);
});

test('hidden layout cells cannot leak native captions or crash while visible sibling rows retain complete origins', () => {
  for(const visibility of ['hidden','hidden="false"','aria-hidden="true"','style="display:none"','style="visibility:hidden"']){
    const raw=`<table><tr><td ${visibility}><h2>Hidden Caption</h2><p><strike>Hidden words shall not be collected.</strike></p></td></tr><tr><td><p>The Provider shall retain <u>visible receipts</u> except cancelled work.</p></td></tr></table>`,result=nativeSource(raw),envelope=result.native_source_decorations;
    assert.equal(result.status,'accepted');assert.equal(result.normalized_text,'The Provider shall retain visible receipts except cancelled work.');
    assert.equal(result.excluded.find(x=>x.reason==='hidden_html_excluded').count,1);
    assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.deepEqual(envelope.collector_issues,[]);
    assert.ok(!envelope.trace.sources.some(s=>s.native_tag==='strike'));assert.ok(envelope.trace.sources.some(s=>s.native_tag==='u'));
    nativeCoverage(result);checkOffsets(result);
  }
  const visible=nativeSource('<table><tr><td><h2>Visible Caption</h2><p>The Provider shall retain all delivery receipts.</p></td></tr></table>');
  assert.match(visible.normalized_text,/Visible Caption.*retain all delivery receipts/s);assert.ok(!visible.excluded.some(x=>x.reason==='hidden_html_excluded'));checkOffsets(visible);
});

test('declared HTML resource failures block the whole body instead of accepting truncated discovery units', () => {
  const raw='<h2>Records</h2><p>The Provider shall retain delivery receipts unless cancelled.</p>';
  for(const [option,value,code] of [['maxHtmlNodes',3,'HTML_COLLECTION_NODE_BOUND'],['maxHtmlDecodedCharacters',10,'HTML_COLLECTION_DECODED_OUTPUT_BOUND'],['maxHtmlWork',3,'HTML_COLLECTION_WORK_BOUND'],['maxHtmlMaterializedCharacters',3,'HTML_COLLECTION_MATERIALIZATION_BOUND'],['maxHtmlMemoryBytes',1024*1024,'HTML_COLLECTION_MEMORY_BOUND']]) {
    const result=nativeSource(raw,'html',{[option]:value});assert.equal(result.status,'rejected');assert.equal(result.reconstruction_status,'BLOCKED_INCOMPLETE_HTML_RESOURCE_BOUND');
    assert.equal(result.normalized_text,'');assert.deepEqual(result.units,[]);assert.deepEqual(result.sections,[]);assert.ok(result.warnings.some(x=>x.code===code));
    assert.notEqual(result.native_source_decorations.mapping_status,'EXACT_COLLECTOR_ORIGIN');
  }
});

test('four-MiB source at depth701 reconstructs late body under explicit time and RSS bounds', {timeout:120000}, t=>{
  const limit=4*1024*1024,depth=701,leaf='<span>'+('x'.repeat(64))+'</span>';
  for(const [mode,open,close]of[['ordinary','<div>','</div>'],['centered','<div align="center">','</div>'],['layout-table','<table><tr><td>','</td></tr></table>']]){
    const prefix=open.repeat(depth)+'<p>The Provider shall retain ',suffix=' except cancelled work.</p>'+close.repeat(depth),leaves=Math.floor((limit-prefix.length-suffix.length)/leaf.length),raw=prefix+leaf.repeat(leaves)+suffix,started=process.hrtime.bigint(),result=nativeSource(raw,'html',{maxRawBytes:limit,maxContentChars:limit});
    assert.equal(result.status,'accepted');assert.equal(result.normalized_text,'The Provider shall retain '+('x'.repeat(64*leaves))+' except cancelled work.');
    assert.ok(!result.excluded.some(x=>x.reason==='html_depth_limit'));checkOffsets(result);
    const elapsed=Number(process.hrtime.bigint()-started)/1e9,rss=process.resourceUsage().maxRSS*1024;assert.ok(elapsed<60);assert.ok(rss<6*1024**3);
    t.diagnostic(JSON.stringify({synthetic_raw_bytes:Buffer.byteLength(raw),depth,mode,leaves,normalized_characters:result.normalized_text.length,elapsed_seconds:elapsed,maximum_rss_bytes:rss}));
  }
});

// V13 examples are fictional structural controls. None copies a corpus case.
const navLabels = (result) => result.sections.flatMap(s => s.source_navigation_anchors.map(a => a.label));

test('V13 every emphasis/native/plain producer rejects the same page, date, contact and form pollution', () => {
  const rejected = ['13', '- 7 -', 'Page K8', 'April 12, 2024', '145 Broad Street', 'Ship to: ______', 'Signature Page', 'Title:', 'R-9'];
  for (const wrap of [t => `<p>${t}</p>`, t => `<h3>${t}</h3>`, t => `<p><b>${t}</b></p>`, t => `<p><font><u>${t}</u></font></p>`, t => `<div align="center">${t}</div>`]) {
    const result = extractSections(source(wrap('Section 1.1 Notice and Response') + rejected.map(wrap).join('') + '<p>The Provider shall retain the notice unless withdrawn.</p>'));
    assert.ok(navLabels(result).includes('Section 1.1 Notice and Response'));
    for (const label of rejected) assert.ok(!navLabels(result).includes(label), label);
    for (const label of rejected) assert.ok(result.normalized_text.includes(label));
    checkOffsets(result);
  }
});

test('V13 emphasized sentence subjects and contact prefixes are not captions, while delimited captions survive', () => {
  const raw = '<p><b>THIS AGREEMENT</b> is made by the parties.</p><p><b>SAMPLE SUPPLIER</b>, Inc., 400 Long Street</p><p><b>Ship to</b>: ______</p><p><b>Audit Findings.</b> Within20days the Provider shall respond.</p><p><b>Notice Content</b>. The Requester shall state the action.</p>';
  const result = extractSections(source(raw)), labels = navLabels(result);
  assert.ok(!labels.includes('THIS AGREEMENT')); assert.ok(!labels.includes('SAMPLE SUPPLIER')); assert.ok(!labels.includes('Ship to'));
  assert.ok(labels.includes('Audit Findings.')); assert.ok(labels.includes('Notice Content'));
  assert.match(result.normalized_text, /THIS AGREEMENT is made.*SAMPLE SUPPLIER, Inc.*Ship to:.*Audit Findings/s);
  checkOffsets(result);
});

test('navigation does not group a six-character prose opener across an unchanged inline split', () => {
  const raw = 'The following rules apply:\n\n7.4 Safekeeping and Handling of Records. Vendor\nmaintains the inventory, sends receipts and pays costs.\n\n8. Notices\nThe Provider shall retain notices.';
  const result = nativeSource(raw, 'text'), anchors = result.sections.flatMap(section => section.source_navigation_anchors);
  const caption = anchors.find(anchor => anchor.label === '7.4 Safekeeping and Handling of Records.');
  assert.ok(caption);
  assert.ok(!anchors.some(anchor => /Vendor|maintains|sends receipts/u.test(anchor.label)));
  assert.equal(caption.parts.length, 1);
  assert.equal(result.normalized_text.slice(caption.start, caption.end), caption.label);
  assert.equal(caption.source_evidence.inline_caption_scope, 'CAPTION_SIDE_OF_UNCHANGED_LEGACY_SPLIT');
  assert.equal(result.normalized_text, 'The following rules apply:\n\n7.4 Safekeeping and Handling of Records.\n\nVendor\n\nmaintains the inventory, sends receipts and pays costs.\n\n8. Notices\n\nThe Provider shall retain notices.');
  assert.ok(result.sections.some(section => section.text.includes('Vendor\n\nmaintains the inventory, sends receipts and pays costs.')));
  checkOffsets(result); nativeCoverage(result);
});

test('numbered ordinary predicates stay prose across plain, native-heading and emphasis producers', () => {
  const prose = '7. Supplier retains receipts and delivers records.';
  for (const wrap of [text => `<p>${text}</p>`, text => `<h3>${text}</h3>`, text => `<p><b>${text}</b></p>`, text => `<div align="center">${text}</div>`]) {
    const result = nativeSource(wrap(prose) + '<p>8. Payment. The Requester shall pay fees.</p>');
    assert.ok(!navLabels(result).some(label => /Supplier|retains|delivers/u.test(label)));
    assert.ok(navLabels(result).includes('8. Payment.'));
    assert.ok(result.normalized_text.includes(prose));
    checkOffsets(result); nativeCoverage(result);
  }
  const delimited = extractSections(source('<p>7.6 Legal proceedings. The Provider shall disclose pending claims.</p>'));
  assert.ok(navLabels(delimited).includes('7.6 Legal proceedings.'));
  assert.ok(!navLabels(delimited).some(label => /shall disclose/u.test(label)));
});

test('an internal colon groups literal caption sides without grouping an operative suffix', () => {
  const result = nativeSource('<p>Article 8 Notices: Content and Timing</p><p>Article 9 Notices: Supplier retains receipts and delivers records.</p><p>Article 10 Notices: The Provider shall retain records.</p>');
  const anchors = result.sections.flatMap(section => section.source_navigation_anchors);
  const caption = anchors.find(anchor => anchor.label === 'Article 8 Notices: Content and Timing');
  assert.ok(caption);
  assert.equal(caption.source_evidence.grouped_title_pieces, 'LITERAL_CAPTION_FORM_ACROSS_INTERNAL_SEPARATOR');
  assert.ok(anchors.some(anchor => anchor.label === 'Article 10 Notices:'));
  assert.ok(!anchors.some(anchor => /Supplier|retains receipts|shall retain/u.test(anchor.label)));
  assert.ok(result.normalized_text.includes('Supplier retains receipts and delivers records.'));
  assert.ok(result.normalized_text.includes('The Provider shall retain records.'));
  for (const part of caption.parts) assert.equal(result.normalized_text.slice(part.start, part.end), part.text);
  checkOffsets(result); nativeCoverage(result);
});

test('V13 plain integers cannot turn rural addresses or footnotes into section captions', () => {
  const result = extractSections(source('<p><b>1762 Route 508</b></p><p>Example Town, ZZ 12345</p><p><b>17 Debt Collection 15 U.S.C. 1692</b></p><p>15</p><p><b>Equipment Records</b></p><p>15.1 The Provider shall retain the agreed records.</p><p>7.6 Legal proceedings. The parties shall disclose pending claims.</p>'));
  const labels = navLabels(result);
  assert.ok(!labels.some(t => /^1762|^17 Debt|^15$/u.test(t)));
  assert.ok(labels.includes('Equipment Records'));
  assert.ok(labels.includes('7.6 Legal proceedings.'));
  checkOffsets(result);
});

test('V13 literal first-cell captions are indexed separately from unchanged table partitions', () => {
  const raw = '<table><tr><td>Lease Maintenance</td><td>The Provider shall maintain the property unless access is denied.</td></tr><tr><td>Material Contracts</td><td>The Requester shall keep an inventory.</td></tr><tr><td>Amount</td><td>200</td></tr><tr><td>The Provider shall pay</td><td>300</td></tr><tr><td>Re:</td><td>Replacement Credit Instrument</td></tr></table>';
  const result = extractSections(source(raw)), labels = navLabels(result);
  assert.ok(labels.includes('Lease Maintenance')); assert.ok(labels.includes('Material Contracts'));
  assert.ok(labels.includes('Re: Replacement Credit Instrument'));
  assert.ok(!labels.includes('Amount')); assert.ok(!labels.includes('The Provider shall pay'));
  assert.ok(result.sections.flatMap(s => s.source_navigation_anchors).find(a => a.label === 'Re: Replacement Credit Instrument').parts.length === 2);
  assert.match(result.normalized_text, /Lease Maintenance \| The Provider.*Amount \| 200.*Re: \| Replacement/s);
  checkOffsets(result);
});

test('V13 inline local captions accept sentence case and quoted letter captions without changing quote frames', () => {
  const raw = '<p>The sample reads:</p><blockquote><p>“4.7 Compliance with Section 505B. The Provider shall retain the specified records.</p><p>(b)Death or disability. The benefit is payable only after notice.</p></blockquote><p>The sample does not establish an entitlement.</p>';
  const result = extractSections(source(raw)), anchors = result.sections.flatMap(s => s.source_navigation_anchors);
  assert.ok(anchors.some(a => a.label === '4.7 Compliance with Section 505B.'));
  assert.ok(anchors.some(a => a.label === '(b)Death or disability.'));
  assert.ok(anchors.find(a => a.label === '4.7 Compliance with Section 505B.').ambiguity.source_quote_context);
  assert.match(result.normalized_text, /“4\.7.*shall retain.*only after notice.*does not establish/s);
  checkOffsets(result);
});

test('V13 abbreviations do not cut an inline caption before its actual body delimiter', () => {
  const result = extractSections(source('<p>3. U.S. Reporting Responsibilities. The Provider shall give a report.</p><p>Article 7 Protection: Confidential records include notices and shall remain protected.</p><p>Article 8 Notices: Content and Timing</p>'));
  const labels = navLabels(result);
  assert.ok(labels.includes('3. U.S. Reporting Responsibilities.')); assert.ok(!labels.includes('3. U.S.'));
  assert.ok(labels.includes('Article 7 Protection:')); assert.ok(labels.includes('Article 8 Notices: Content and Timing'));
  checkOffsets(result);
});

test('V13 leading multiline document captions keep exact literal pieces and entity words', () => {
  const result = extractSections(source('<p>EX-10.1 2 example.htm AGREEMENT</p><p>SAMPLE DISTRIBUTION</p><p>PROPOSAL FOR</p><p>EXAMPLE RETAILER, INC.</p><p>FIRST AMENDMENT</p><p>The parties shall retain the original agreement except as amended.</p>'));
  const anchor = result.sections.flatMap(s => s.source_navigation_anchors).find(a => a.label === 'SAMPLE DISTRIBUTION PROPOSAL FOR EXAMPLE RETAILER, INC. FIRST AMENDMENT');
  assert.ok(anchor); assert.equal(anchor.parts.length, 4);
  assert.ok(anchor.parts.every(p => result.normalized_text.slice(p.start, p.end) === p.text));
  assert.equal(anchor.governing_hierarchy_verified, false);
  checkOffsets(result);
});

test('V13 overlapping leading-title and fragment candidates cannot duplicate literal parts or anchor identities', () => {
  const result = extractSections(source('<p><b>FIRST AMENDMENT TO</b></p><p><b>PROJECT SERVICES AGREEMENT</b></p><p>The Provider shall preserve the stated records.</p>'));
  const anchors = result.sections.flatMap(s => s.source_navigation_anchors);
  assert.ok(anchors.some(a => a.label === 'FIRST AMENDMENT TO PROJECT SERVICES AGREEMENT'));
  assert.equal(new Set(anchors.map(a => a.id)).size, anchors.length);
  for (const a of anchors) {
    assert.ok(a.parts.every((p, i) => !i || p.start >= a.parts[i - 1].end));
    assert.equal(a.parts.map(p => p.text).join(' ').replace(/\s+/gu, ' '), a.label);
  }
  checkOffsets(result);
});

test('V13 spaced non-cased-script captions need literal layout evidence and exclude ordinary sentences', () => {
  const result = extractSections(source('<p align="center"><font><b>工 作 记 录 书</b></font></p><p>双方应当保存所有工作记录。</p><h2>任何一方应当提供工作记录并承担相关费用。</h2>'));
  assert.ok(navLabels(result).includes('工 作 记 录 书'));
  assert.ok(!navLabels(result).some(t => t.includes('双方应当') || t.includes('任何一方应当')));
  checkOffsets(result);
  const unknown = extractSections(source('<p>工 作 记 录 书</p><p>The Provider shall retain records.</p>'));
  assert.ok(!navLabels(unknown).includes('工 作 记 录 书'));
});

test('V13 repeated document titles next to source page labels do not become running-header anchors', () => {
  const result = extractSections(source('<p><b>PROJECT SERVICES AGREEMENT</b></p><p>The Provider shall perform the work.</p><p>7</p><p><b>PROJECT SERVICES AGREEMENT</b></p><p>The Requester shall give notice.</p><h2>Section 2.1 Records.</h2><p>The Provider shall keep receipts.</p>'));
  assert.equal(navLabels(result).filter(t => t === 'PROJECT SERVICES AGREEMENT').length, 1);
  assert.ok(navLabels(result).includes('Section 2.1 Records.'));
  assert.equal(result.normalized_text.match(/PROJECT SERVICES AGREEMENT/gu).length, 2);
  checkOffsets(result);
});

test('V13 explicit unknown metadata stubs are not supplied with a later out-of-scope title', () => {
  const result = extractSections(source('<p>EX-10.7 1 sample.htm DOCUMENT</p><p><b>FIRST AMENDMENT TO THE WORK AGREEMENT</b></p><p>The parties shall retain the records.</p>'));
  const first = result.sections.find(s => s.text === 'EX-10.7 1 sample.htm DOCUMENT');
  assert.ok(first); assert.equal(first.units[0].source_navigation.nearest_anchor, null);
  assert.equal(first.units[0].source_navigation.within_unit.length, 0);
  assert.ok(navLabels(result).includes('FIRST AMENDMENT TO THE WORK AGREEMENT'));
  checkOffsets(result);
});

// V12 fixtures below are authored structural examples, not corpus quotations.
const referenceFrames = (section) => section.governor_frames.filter(frame => frame.source_evidence === 'LITERAL_COLON_FOLLOWED_BY_ATTACHMENT_REFERENCES');

test('V12 introduced attachment references retain governor, page-spanning labels and shared qualification until a real Article', () => {
  const pieces = ['ARTICLE I', 'The following exhibits are incorporated in this instrument by reference:', 'EXHIBIT A SITE RECORDS', 'EXHIBIT B ACCESS PLAN', '12', 'CONFIDENTIAL', 'EXHIBIT C WORK SPECIFICATIONS', 'SAFETY NOTICE RIDER', 'SERVICE GUARANTY', 'PROJECT ADDENDUM', 'The listed references apply only to authorized work, except excluded equipment.', 'ARTICLE II', 'The Provider shall retain receipts.'];
  const html = pieces.map((piece, index) => `${index === 4 ? '<hr style="page-break-after:always">' : ''}<p>${piece}</p>`).join('');
  const result = extractSections(source(html)), parent = result.sections.find(s => s.text.includes('following exhibits'));
  assert.equal(result.normalized_text, pieces.join('\n\n'));
  assert.match(parent.text, /by reference:.*EXHIBIT A.*EXHIBIT B.*12.*CONFIDENTIAL.*EXHIBIT C.*SAFETY NOTICE RIDER.*SERVICE GUARANTY.*PROJECT ADDENDUM.*except excluded equipment/s);
  assert.ok(!parent.text.includes('ARTICLE II'));
  const frame = referenceFrames(parent)[0]; assert.ok(frame);
  assert.equal(frame.governor.text, pieces[1]); assert.equal(frame.reference_contents_reconstructed, false);
  assert.equal(frame.boundary_verified, false); assert.equal(frame.semantic_completeness_verified, false);
  assert.ok(parent.subheadings.filter(item => /^EXHIBIT/u.test(item.text)).every(item => item.provenance.section_boundary === false));
  assert.ok(result.sections.some(s => s.text.startsWith('ARTICLE II')));
  checkOffsets(result);
});

test('V12 new attachment governor inside a preceding broad table frame retains both literal provenance records', () => {
  const raw = '<h2>1.1 Reference Data</h2><p>The following data apply:</p><table><tr><th>Field</th><th>Value</th></tr><tr><td>Duration</td><td>Twenty days</td></tr></table><p><b>1.2ATTACHMENTS</b></p><p>The exhibits listed below are incorporated by reference:</p><p>EXHIBIT A RECORD PLAN</p><p>EXHIBIT B SAFE ACCESS</p><p>The references exclude emergency work.</p><h2>ARTICLE II</h2><p>The Provider shall give notice.</p>';
  const result = extractSections(source(raw)), parent = result.sections.find(s => s.text.includes('listed below'));
  assert.match(parent.text, /following data.*Duration.*Twenty days.*1.2ATTACHMENTS.*incorporated by reference.*EXHIBIT A.*EXHIBIT B.*exclude emergency/s);
  const prior = parent.governor_frames.find(frame => frame.source_evidence === 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE');
  const added = referenceFrames(parent)[0]; assert.ok(prior); assert.ok(added);
  assert.equal(prior.governor.text, 'The following data apply:');
  assert.equal(added.governor.text, 'The exhibits listed below are incorporated by reference:');
  assert.equal(added.prior_source_frames[0].id, prior.id);
  assert.equal(added.prior_source_frames[0].relation, 'PRECEDING_CONSERVATIVE_SOURCE_FRAME_NOT_VERIFIED_GOVERNOR');
  assert.equal(prior.closure, 'NEXT_LITERAL_FORWARD_GOVERNOR_NOT_PROOF_OF_SEMANTIC_CLOSURE');
  assert.ok(!parent.text.includes('ARTICLE II'));
  checkOffsets(result);
  const rowSource = '<p>The following exhibits are incorporated by reference:</p><table><tr><td>EXHIBIT A RECORD PLAN</td><td>EXHIBIT B ACCESS PLAN</td></tr><tr><td>SERVICE RIDER</td><td>PROJECT ADDENDUM</td></tr></table><p>The listed references exclude cancelled work.</p><p>ARTICLE II</p><p>The Provider shall give notice.</p>';
  const rowResult = extractSections(source(rowSource)), rowParent = rowResult.sections.find(s => s.text.includes('following exhibits'));
  assert.match(rowParent.text, /EXHIBIT A RECORD PLAN.*EXHIBIT B ACCESS PLAN.*SERVICE RIDER.*PROJECT ADDENDUM.*exclude cancelled work/s);
  assert.ok(referenceFrames(rowParent).length);
  assert.ok(!rowParent.text.includes('ARTICLE II'));
  checkOffsets(rowResult);
});

test('V12 plain, PRE and SGML attachment-reference lists keep literal page continuation and Section fence', () => {
  const body = 'ARTICLE I\n\nThe schedules listed below are included by reference:\n\nSCHEDULE A ACCESS RECORDS\n\n9\n\nSCHEDULE B WORK PLAN\n\nSITE RIDER\n\nThe listed references exclude stored materials.\n\nSection 2.01 Notices.\n\nThe Provider shall give notice.';
  for (const [content, format] of [[body, 'text'], [`<pre>${body}</pre>`, 'html'], [`<DOCUMENT><TYPE>EX-10<TEXT>${body.replace('\n\n9\n\n', '\n\n<PAGE>\n9\n\n')}</TEXT></DOCUMENT>`, 'text']]) {
    const result = extractSections(source(content, format)), parent = result.sections.find(s => s.text.includes('listed below'));
    assert.match(parent.text, /by reference.*SCHEDULE A.*9.*SCHEDULE B.*SITE RIDER.*exclude stored materials/s);
    assert.ok(!parent.text.includes('Section 2.01'));
    assert.ok(referenceFrames(parent).length);
    assert.ok(result.sections.some(s => s.text.includes('Section 2.01')));
    checkOffsets(result);
  }
});

test('V12 inert attachment-list wrappers and strikeout preserve visible source words without deciding deletion effects', () => {
  const raw = '<p>The exhibits listed below are incorporated by reference:</p><p><kbd><strike>E<font>XHIBIT</font> A</strike></kbd><strike>L<font>OCATION</font> R<font>ECORD</font>.</strike> INTENTIONALLY DELETED</p><p><kbd>E<font>XHIBIT</font> B </kbd>WORK PLAN.</p><hr><p>EXHIBIT C OTHER RECORDS</p><p>LIMITS RIDER</p><p>ARTICLE II</p><p>The Provider shall retain notices.</p>';
  const result = extractSections(source(raw)), parent = result.sections.find(s => s.text.includes('listed below'));
  assert.match(parent.text, /EXHIBIT ALOCATION RECORD\. INTENTIONALLY DELETED.*EXHIBIT B WORK PLAN\..*EXHIBIT C.*LIMITS RIDER/s);
  assert.equal(referenceFrames(parent)[0].strikeout_effect_verified, false);
  assert.equal(referenceFrames(parent)[0].reference_contents_reconstructed, false);
  assert.ok(!parent.text.includes('ARTICLE II'));
  checkOffsets(result);
});

test('V12 real standalone attachments after completed provisions retain their ordinary parent boundary', () => {
  const result = extractSections(source('<h2>Section 1.01 Duties.</h2><p>The Provider shall perform the agreed work.</p><p>EXHIBIT A</p><p>The parties shall retain records for twenty days.</p><p>ARTICLE II</p><p>The Requester shall give notice.</p>'));
  assert.ok(result.sections.some(s => s.heading === 'EXHIBIT A' && s.text.includes('twenty days')));
  assert.ok(result.sections.every(s => referenceFrames(s).length === 0));
  assert.ok(!result.sections.find(s => s.text.includes('agreed work')).text.includes('EXHIBIT A'));
  checkOffsets(result);
});

test('V12 ordinary body references and non-attachment forward colons do not invent reference-list frames', () => {
  for (const raw of [
    '<p>The Provider shall give the following notice:</p><p>Schedule A Records</p><p>The notice must identify the requested work.</p>',
    '<p>The exhibits are described elsewhere:</p><p>EXHIBIT A RECORDS</p><p>The Provider shall retain records.</p>',
    '<p>The schedules listed below are incorporated by reference:</p><p>Schedule A shall apply only to approved work.</p><p>The Provider shall give notice.</p>',
  ]) {
    const result = extractSections(source(raw));
    assert.ok(result.sections.every(s => referenceFrames(s).length === 0));
    assert.match(result.normalized_text, /Provider|requested work/u);
    checkOffsets(result);
  }
});

test('V12 typed Article and Section fences need outside-list source evidence, not a nested reference or quotation', () => {
  const raw = '<p>The exhibits listed below are incorporated by reference:</p><ol><li>EXHIBIT A RECORDS<h3>Section 9 Reference Index</h3><p>This is a listed reference label.</p><h3>ARTICLE IX</h3></li><li>EXHIBIT B WORK PLAN</li></ol><p>The listed references exclude rejected work.</p><h2>Section 2.01 Notices.</h2><p>The Provider shall notify the Requester.</p>';
  const result = extractSections(source(raw)), parent = result.sections.find(s => s.text.includes('listed below'));
  assert.match(parent.text, /EXHIBIT A.*Section 9.*ARTICLE IX.*EXHIBIT B.*exclude rejected work/s);
  assert.ok(!parent.text.includes('Section 2.01'));
  const native = extractSections(source('<h2>Section 1.01 References.</h2><p>The following exhibits are incorporated by reference:</p><p>EXHIBIT A RECORD PLAN</p><h3>Section 9 Local Attachment Index</h3><p>The local label identifies only the listed reference.</p><p>EXHIBIT B WORK PLAN</p><p>The listed references exclude rejected work.</p><h2>Section 2.01 Notices.</h2><p>The Provider shall give notice.</p>'));
  const nativeParent = native.sections.find(s => s.text.includes('following exhibits'));
  assert.match(nativeParent.text, /EXHIBIT A.*Section 9 Local.*only the listed reference.*EXHIBIT B.*exclude rejected work/s);
  assert.ok(!nativeParent.text.includes('Section 2.01'));
  assert.equal(referenceFrames(nativeParent)[0].source_native_scope_level, 2);
  const quoted = extractSections(source('<blockquote><p>The following exhibits are incorporated by reference:</p><p>EXHIBIT A SAMPLE RECORD</p></blockquote><p>The example is not adopted by the parties.</p><p>ARTICLE II</p><p>The Provider shall retain records.</p>'));
  assert.ok(quoted.sections.every(s => referenceFrames(s).length === 0));
  checkOffsets(result); checkOffsets(native); checkOffsets(quoted);
});

test('V12 introduced attachment-reference lists have no item-count or arbitrary parent cap', () => {
  const refs = Array.from({ length: 85 }, (_, i) => `EXHIBIT A${i + 1} RETAINED WORK RECORDS`);
  const raw = `<p>The following exhibits are incorporated by reference:</p>${refs.map(text => `<p>${text}</p>`).join('')}<p>The references apply only after approval and exclude cancelled work.</p><p>ARTICLE II</p><p>The Provider shall retain notices.</p>`;
  const result = extractSections(source(raw), { maxChunkWords: 20 }), parent = result.sections.find(s => s.text.includes('following exhibits'));
  for (const text of refs) assert.ok(parent.text.includes(text));
  assert.match(parent.text, /only after approval.*exclude cancelled work/s);
  assert.ok(parent.units.length > 20);
  assert.equal(parent.units.reduce((n, unit) => n + unit.word_count, 0), parent.word_count);
  assert.ok(parent.units.every(unit => unit.governor_frame_ids.includes(referenceFrames(parent)[0].id)));
  assert.ok(!parent.text.includes('ARTICLE II'));
  checkOffsets(result);
});

test('V12 attachment frames preserve earlier construction, proviso and compound-table conditions', () => {
  const raw = '<h2>Section 1.01 Work.</h2><p>The Provider shall complete the following work:</p><p>1. Install lighting.</p><p>2. Fit controls.</p><p>The allowance is $700; excess is payable within30days unless disputed.</p><h2>Section 1.02 Confidentiality.</h2><p>The parties shall protect records provided</p><p>4</p><h3>that only required disclosures are permitted.</h3><h2>Section 1.03 Rates.</h2><p>The rates depend on the following tables:</p><p><b>First Rates</b></p><table><tr><td>Low</td><td>5</td></tr></table><table><tr><td>High</td><td>9</td></tr></table><p>Interpolation applies unless the work is excluded.</p><h2>Section 1.04 Attachments.</h2><p>The exhibits listed below are incorporated by reference:</p><p>EXHIBIT A WORK RECORDS</p><p>EXHIBIT B AUTHORIZATION</p><h2>Section 1.05 License.</h2><p>The Provider grants the rights specified on</p><p>Schedule A</p><p>but only for approved work.</p>';
  const result = extractSections(source(raw));
  assert.match(result.sections.find(s => s.text.includes('complete the following')).text, /lighting.*controls.*\$700.*within30days unless disputed/s);
  assert.match(result.sections.find(s => s.text.includes('protect records')).text, /provided.*4.*that only required disclosures/s);
  assert.match(result.sections.find(s => s.text.includes('rates depend')).text, /First Rates.*Low.*5.*High.*9.*Interpolation.*unless the work is excluded/s);
  assert.match(result.sections.find(s => s.text.includes('exhibits listed')).text, /EXHIBIT A.*EXHIBIT B/s);
  assert.match(result.sections.find(s => s.text.includes('Provider grants')).text, /specified on.*Schedule A.*only for approved work/s);
  checkOffsets(result);
});

// V11 fixtures are authored synthetic source structures, not corpus samples.

test('V11 navigation-only traversal cannot increment the legacy inert/hidden/nested-table exclusion ledger', () => {
  const raw = '<div><script>FORGED</script><span hidden>HIDDEN</span><table><tr><td><table><tr><td><b>Thresholds</b></td></tr></table></td></tr></table><p>The Provider shall retain the records unless disposal is authorized.</p></div>';
  const result = extractSections(source(raw));
  const counts = Object.fromEntries(result.excluded.map(item => [item.reason, item.count]));
  assert.equal(counts.inert_script_excluded, 1);
  assert.equal(counts.hidden_html_excluded, 1);
  assert.equal(counts.nested_table_flattened, 1);
  assert.doesNotMatch(result.normalized_text, /FORGED|HIDDEN/u);
  checkOffsets(result);
});

test('V11 navigation rejects filing metadata, dates, alphanumeric page labels and contextual contact locations', () => {
  const raw = '<p>EX-10.9 3 sample.htm WORK AGREEMENT</p><p>WORK AGREEMENT</p><p>June 18, 2021</p><p>OFFICE OF SAMPLE AUTHORITY</p><p>SAMPLE TOWN, REGION</p><p>123 Broad Street</p><p>Page Q7</p><p>R-12</p><h2>Law, Jurisdiction</h2><p>The Company shall send a written notice.</p>';
  const result = extractSections(source(raw)), labels = result.sections.flatMap(s => s.source_navigation_anchors.map(a => a.label));
  assert.ok(labels.includes('WORK AGREEMENT'));
  assert.ok(labels.includes('Law, Jurisdiction'));
  assert.ok(!labels.some(label => /^EX-|June 18|SAMPLE TOWN|Page Q7|R-12/u.test(label)));
  assert.match(result.normalized_text, /EX-10\.9.*sample\.htm.*June 18.*SAMPLE TOWN, REGION.*Page Q7.*R-12/s);
  checkOffsets(result);
});

test('V11 lettered navigation distinguishes a caption from a complete operative list sentence', () => {
  const raw = '<h2>1. Payment</h2><p>The Requester shall pay as follows:</p><p>i. The sum of $4,000 to be delivered to the Provider upon execution of this Agreement.</p><p>a) Records. The Provider shall retain receipts.</p><p>The Requester shall reimburse excess within30days, except disputed charges.</p>';
  const result = extractSections(source(raw)), section = result.sections.find(s => s.text.includes('sum of $4,000'));
  const labels = section.source_navigation_anchors.map(a => a.label);
  assert.ok(!labels.some(label => label.startsWith('i. The sum')));
  assert.ok(labels.includes('a) Records.'));
  assert.match(section.text, /sum of \$4,000.*upon execution.*retain receipts.*except disputed/s);
  assert.ok(section.governor_frames.length > 0);
  checkOffsets(result);
});

test('V11 exact alphanumeric and no-space inline captions are navigation only', () => {
  const raw = '<p>Section D3.01 Recipient Default. The Provider shall cure within30days after notice.</p><p>8.Intellectual Property. The Provider shall return only the specified records.</p><p>9.Notice of Activities. The Requester shall give written notice.</p>';
  const result = extractSections(source(raw)), anchors = result.sections.flatMap(s => s.source_navigation_anchors);
  for (const label of ['Section D3.01 Recipient Default.', '8.Intellectual Property.', '9.Notice of Activities.']) {
    const a = anchors.find(a => a.label === label);
    assert.ok(a, label); assert.equal(result.normalized_text.slice(a.start, a.end), label);
  }
  assert.match(result.normalized_text, /cure within30days.*return only.*written notice/s);
  checkOffsets(result);
});

test('V11 typed article navigation trims an operative body suffix without changing the body source', () => {
  const raw = '<p>Article 7 Confidentiality: Confidential information includes the following records and shall be protected unless disclosure is authorized.</p><p>Article 8 Notices: Content and Timing</p><p>A notice shall identify the requested action.</p>';
  const result = extractSections(source(raw)), labels = result.sections.flatMap(s => s.source_navigation_anchors.map(a => a.label));
  assert.ok(labels.includes('Article 7 Confidentiality:'));
  assert.ok(!labels.some(label => /information includes|shall be protected/u.test(label)));
  assert.ok(labels.includes('Article 8 Notices: Content and Timing'));
  assert.match(result.normalized_text, /Confidential information includes.*unless disclosure.*Article 8/s);
  checkOffsets(result);
});

test('V11 source-typed marker and adjacent caption retain exact distinct evidence without inventing hierarchy', () => {
  const raw = '<p>Section 4.10</p><p><b>Class 10 – Warrants.</b></p><p>The holder shall retain the warrant unless cancelled.</p><p>ARTICLE VII</p><p><font><b>AUDITS; COMPLAINTS; REGULATORY MATTERS; ETC.</b></font></p><p>The Provider shall respond within30days.</p>';
  const result = extractSections(source(raw)), anchors = result.sections.flatMap(s => s.source_navigation_anchors);
  assert.ok(anchors.some(a => a.parts.some(p => p.text === 'Section 4.10')));
  assert.ok(anchors.some(a => a.parts.some(p => p.text === 'Class 10 – Warrants.')));
  assert.ok(anchors.some(a => a.parts.some(p => p.text === 'AUDITS; COMPLAINTS; REGULATORY MATTERS; ETC.')));
  assert.ok(anchors.every(a => a.governing_hierarchy_verified === false));
  checkOffsets(result);
});

test('V11 inert neutral-wrapper emphasis preserves a full multiline caption and exact literal parts', () => {
  const raw = '<p><font><b>Scientific, Clinical, and Regulatory<br>Advisor Agreement</b></font></p><p>The Advisor shall provide the specified services unless cancelled.</p>';
  const result = extractSections(source(raw)), anchors = result.sections.flatMap(s => s.source_navigation_anchors);
  const a = anchors.find(a => a.label === 'Scientific, Clinical, and Regulatory Advisor Agreement');
  assert.ok(a); assert.equal(a.source_evidence.grouped_title_pieces, 'INERT_WHOLE_SOURCE_CAPTION_GROUP');
  // Legacy normalization may collapse a BR into one exact normalized piece;
  // a fabricated second part would not improve source provenance.
  assert.ok(a.parts.length >= 1);
  assert.equal(a.parts.map(p => p.text).join(' ').replace(/\s+/gu, ' '), a.label);
  assert.ok(a.parts.every(p => result.normalized_text.slice(p.start, p.end) === p.text));
  assert.match(result.normalized_text, /Scientific, Clinical, and Regulatory.*Advisor Agreement.*unless cancelled/s);
  checkOffsets(result);
});

test('V11 initial emphasized caption is indexed but an emphasized operative opening is not', () => {
  const raw = '<p><font><b>Audit Feedback.</b></font> Within30days the Provider shall send a report.</p><p><b>THE PROVIDER SHALL PAY ALL COSTS.</b> Except for unauthorized costs.</p>';
  const result = extractSections(source(raw)), labels = result.sections.flatMap(s => s.source_navigation_anchors.map(a => a.label));
  assert.ok(labels.includes('Audit Feedback.'));
  assert.ok(!labels.some(label => label.includes('SHALL PAY')));
  assert.match(result.normalized_text, /Audit Feedback.*Within30days.*SHALL PAY ALL COSTS.*Except for unauthorized/s);
  checkOffsets(result);
});

test('V11 document-sounding local caption retains unresolved scope rather than an invented document boundary', () => {
  const raw = '<p>14</p><p><b>POWER PURCHASE AGREEMENT</b></p><p>14.1 The Provider shall negotiate the agreement.</p><p>14.2 The Requester shall approve its terms.</p>';
  const result = extractSections(source(raw)), a = result.sections.flatMap(s => s.source_navigation_anchors).find(a => a.label === 'POWER PURCHASE AGREEMENT');
  assert.ok(a); assert.equal(a.kind, 'document_or_section_caption_unresolved');
  assert.equal(a.governing_hierarchy_verified, false);
  assert.match(result.normalized_text, /14.*POWER PURCHASE AGREEMENT.*14\.1.*14\.2/s);
  checkOffsets(result);
});


const source = (content, format = 'html') => ({ id: 'contract-source', source_url: 'https://example.invalid/contract', content, format });

// DECLARED_SYNTHETIC V9 baseline, captured before V10 source edits. These cases
// contain no new colon/table dependency, so all legacy geometry stays exact.
const navigationBaselines = [
  {
    "content": "<h2>1. Work</h2><p>The Operator shall complete these tasks:</p><p>1. Lighting</p><p>Install the agreed lamps.</p><p>2. Controls</p><p>The Requester shall pay excess within30days, unless disputed.</p><h2>EXHIBIT B</h2><p>Inventory shall be returned.</p>",
    "format": "html",
    "expected": {
      "i": 0,
      "status": "accepted",
      "text": "1. Work\n\nThe Operator shall complete these tasks:\n\n1. Lighting\n\nInstall the agreed lamps.\n\n2. Controls\n\nThe Requester shall pay excess within30days, unless disputed.\n\nEXHIBIT B\n\nInventory shall be returned.",
      "sha": "2a9e2e45950a4ea26eed6dc3ef967a81fe7bd1c4539c84afbdd70e367b8dc753",
      "sections": [
        {
          "id": "navigation-baseline-0:section:0-165:dfeba67ab1ed",
          "start": 0,
          "end": 165,
          "heading": "1. Work",
          "heading_path": [
            "1. Work"
          ],
          "governor_frames": [
            {
              "id": "navigation-baseline-0:frame:9-165:7163796361c3",
              "start": 9,
              "end": 165,
              "sha256": "7163796361c32ae2b909b835d365126e9f8a5ba617ad725e31567523fdbef077",
              "governor": {
                "start": 9,
                "end": 49,
                "text": "The Operator shall complete these tasks:",
                "sha256": "5d40d3cf370fba05daf69e43f85d8b3cfc748217bb0ade824418ba03d3e41c38"
              },
              "source_evidence": "LITERAL_COLON_FOLLOWED_BY_ENUMERATION",
              "boundary_verified": false,
              "semantic_completeness_verified": false,
              "closure": "NEXT_STRONG_SOURCE_BOUNDARY"
            }
          ]
        },
        {
          "id": "navigation-baseline-0:section:167-206:33aa9cc28c6f",
          "start": 167,
          "end": 206,
          "heading": "EXHIBIT B",
          "heading_path": [
            "EXHIBIT B"
          ],
          "governor_frames": []
        }
      ],
      "units": [
        {
          "id": "navigation-baseline-0:section:0-165:dfeba67ab1ed:unit:0-102:ddff10c5c615",
          "start": 0,
          "end": 102,
          "sha256": "ddff10c5c6155a515f8e56e78b782e26e3977a0f8c248106063ee1063ac60d6a",
          "heading": "1. Work",
          "heading_path": [
            "1. Work"
          ],
          "governor_frame_ids": [
            "navigation-baseline-0:frame:9-165:7163796361c3"
          ]
        },
        {
          "id": "navigation-baseline-0:section:0-165:dfeba67ab1ed:unit:104-165:f9a2ca483e1b",
          "start": 104,
          "end": 165,
          "sha256": "f9a2ca483e1b71ec5331cab8da546070ffa1953cd93a68125da1393c4ca05eaf",
          "heading": "2. Controls",
          "heading_path": [
            "1. Work",
            "2. Controls"
          ],
          "governor_frame_ids": [
            "navigation-baseline-0:frame:9-165:7163796361c3"
          ]
        },
        {
          "id": "navigation-baseline-0:section:167-206:33aa9cc28c6f:unit:167-206:33aa9cc28c6f",
          "start": 167,
          "end": 206,
          "sha256": "33aa9cc28c6f538700db03de0f9d1ddb1d6c08b5f02a62e6c90eac6cba562bc6",
          "heading": "EXHIBIT B",
          "heading_path": [
            "EXHIBIT B"
          ],
          "governor_frame_ids": []
        }
      ]
    }
  },
  {
    "content": "1. Duties. The Operator shall perform the agreed work (unless notified.\n\n2. Notice. The Requester shall notify in writing.\n\n3. Payment. The Requester shall pay10units within30days, except that a disputed charge is withheld.",
    "format": "text",
    "expected": {
      "i": 1,
      "status": "accepted",
      "text": "1. Duties.\n\nThe Operator shall perform the agreed work (unless notified.\n\n2. Notice. The Requester shall notify in writing.\n\n3. Payment. The Requester shall pay10units within30days, except that a disputed charge is withheld.",
      "sha": "d91cb9ceceab8ec0ef8d368b82266b2b6d73cdfa76b017c0c654f4a742667f30",
      "sections": [
        {
          "id": "navigation-baseline-1:section:0-224:d91cb9ceceab",
          "start": 0,
          "end": 224,
          "heading": "1. Duties.",
          "heading_path": [
            "1. Duties."
          ],
          "governor_frames": []
        }
      ],
      "units": [
        {
          "id": "navigation-baseline-1:section:0-224:d91cb9ceceab:unit:0-123:53e4bedb9724",
          "start": 0,
          "end": 123,
          "sha256": "53e4bedb9724eac28932fb84493403470ae57cf56dce978c521f30ce7ea2576f",
          "heading": "1. Duties.",
          "heading_path": [
            "1. Duties."
          ],
          "governor_frame_ids": []
        },
        {
          "id": "navigation-baseline-1:section:0-224:d91cb9ceceab:unit:125-224:0cb6fd94ab3f",
          "start": 125,
          "end": 224,
          "sha256": "0cb6fd94ab3f35c8da1c716f66bb36756178b14c9cb45382a12ee1687cffc338",
          "heading": "1. Duties.",
          "heading_path": [
            "1. Duties."
          ],
          "governor_frame_ids": []
        }
      ]
    }
  },
  {
    "content": "<p>ARTICLE III</p><p>CERTIFICATE OF INCORPORATION</p><p>AND BYLAWS</p><p>OF THE SURVIVING CORPORATION</p><p>The Operator shall preserve the records.</p><p>4. Notices. Written notice is required.</p>",
    "format": "html",
    "expected": {
      "i": 2,
      "status": "accepted",
      "text": "ARTICLE III\n\nCERTIFICATE OF INCORPORATION\n\nAND BYLAWS\n\nOF THE SURVIVING CORPORATION\n\nThe Operator shall preserve the records.\n\n4. Notices.\n\nWritten notice is required.",
      "sha": "ad38489c46f07587c652f588a62eddab011b4bdde12fc2a713b24ac248c1fa6a",
      "sections": [
        {
          "id": "navigation-baseline-2:section:0-125:d26f61c7847f",
          "start": 0,
          "end": 125,
          "heading": "CERTIFICATE OF INCORPORATION AND BYLAWS OF THE SURVIVING CORPORATION",
          "heading_path": [
            "ARTICLE III",
            "CERTIFICATE OF INCORPORATION AND BYLAWS OF THE SURVIVING CORPORATION"
          ],
          "governor_frames": []
        },
        {
          "id": "navigation-baseline-2:section:127-167:8d4bf78b3233",
          "start": 127,
          "end": 167,
          "heading": "4. Notices.",
          "heading_path": [
            "ARTICLE III",
            "4. Notices."
          ],
          "governor_frames": []
        }
      ],
      "units": [
        {
          "id": "navigation-baseline-2:section:0-125:d26f61c7847f:unit:0-125:d26f61c7847f",
          "start": 0,
          "end": 125,
          "sha256": "d26f61c7847f5617f0f825c0b36d4a4b3e47ae5a908a9db1e6cfdefb0884f9e0",
          "heading": "ARTICLE III",
          "heading_path": [
            "ARTICLE III"
          ],
          "governor_frame_ids": []
        },
        {
          "id": "navigation-baseline-2:section:127-167:8d4bf78b3233:unit:127-167:8d4bf78b3233",
          "start": 127,
          "end": 167,
          "sha256": "8d4bf78b32336728f6570d6998bec3ae529af6c377ff3c742a64ae82cca5b57e",
          "heading": "4. Notices.",
          "heading_path": [
            "ARTICLE III",
            "4. Notices."
          ],
          "governor_frame_ids": []
        }
      ]
    }
  }
];
function legacyNavigationGeometry(result, i) {
  return { i, status: result.status, text: result.normalized_text, sha: result.normalized_sha256,
    sections: result.sections.map(({ id, start, end, heading, heading_path, governor_frames }) => ({ id, start, end, heading, heading_path, governor_frames })),
    units: result.units.map(({ id, start, end, sha256, heading, heading_path, governor_frame_ids }) => ({ id, start, end, sha256, heading, heading_path, governor_frame_ids })) };
}
for (const [i, fixture] of navigationBaselines.entries()) test(`literal navigation preserves frozen V9 text and geometry for synthetic case ${i}`, () => {
  const result = extractSections({ id: `navigation-baseline-${i}`, source_url: 'https://example.invalid/synthetic', content: fixture.content, format: fixture.format }, { maxChunkWords: 20 });
  assert.deepEqual(legacyNavigationGeometry(result, i), fixture.expected);
  for (const section of result.sections) for (const anchor of section.source_navigation_anchors) {
    assert.equal(anchor.scope, 'LITERAL_SOURCE_NAVIGATION_ONLY'); assert.equal(anchor.governing_hierarchy_verified, false);
    assert.equal(anchor.start, anchor.parts[0].start); assert.equal(anchor.end, anchor.parts.at(-1).end);
    assert.equal(anchor.label, anchor.parts.map(part => part.text).join(' '));
    for (const part of anchor.parts) assert.equal(result.normalized_text.slice(part.start, part.end), part.text);
  }
});

test('navigation recovers literal inline captions despite unresolved quote continuity without splitting parents', () => {
  const fixture = navigationBaselines[1], result = extractSections({ id: 'navigation-baseline-1', content: fixture.content, format: fixture.format }, { maxChunkWords: 20 });
  assert.equal(result.sections.length, 1);
  const anchors = result.sections[0].source_navigation_anchors;
  assert.deepEqual(anchors.map(anchor => anchor.label), ['1. Duties.', '2. Notice.', '3. Payment.']);
  assert.ok(anchors.slice(1).every(anchor => anchor.parent_boundary_suppressed && anchor.ambiguity.source_continuation));
  assert.equal(result.units[1].heading, '1. Duties.');
  assert.equal(result.units[1].source_navigation.nearest_anchor.label, '3. Payment.');
  assert.equal(result.units[1].source_navigation.governing_hierarchy_verified, false);
});

test('multiline caption navigation retains literal pieces instead of fabricating a legal hierarchy', () => {
  const fixture = navigationBaselines[2], result = extractSections({ id: 'multiline-navigation', content: fixture.content, format: fixture.format });
  const anchor = result.sections[0].source_navigation_anchors.find(item => item.label.startsWith('CERTIFICATE'));
  assert.deepEqual(anchor.parts.map(part => part.text), ['CERTIFICATE OF INCORPORATION', 'AND BYLAWS', 'OF THE SURVIVING CORPORATION']);
  assert.equal(anchor.source_evidence.grouped_title_pieces, 'V9_SOURCE_WRAPPED_CAPTION_CONTINUATION');
  assert.equal(anchor.governing_hierarchy_verified, false);
});

test('navigation does not promote native body prose, source addresses or a quoted final word', () => {
  const content = '<h2>1. Notices</h2><p>The Operator shall keep notices provided</p><p>19</p><h2>that upon discovery the Requester shall notify promptly unless prohibited.</h2><h3>1200 Example Avenue</h3><h3>Sample City, ZZ 12345</h3><h3>USA</h3><h2>SECURITIES.</h2><h2>What Notices Must Include</h2><p>Notice shall identify the defect.</p><h2>2. Payment</h2><p>The Requester shall pay10units.</p>';
  const result = extractSections(source(content));
  const labels = result.sections.flatMap(section => section.source_navigation_anchors.map(anchor => anchor.label));
  assert.ok(labels.includes('What Notices Must Include')); assert.ok(labels.includes('2. Payment'));
  for (const fragment of ['that upon discovery', '1200 Example Avenue', 'Sample City', 'USA', 'SECURITIES.']) assert.ok(!labels.some(label => label.includes(fragment)));
  checkOffsets(result);
});

test('introduced list captions remain navigation with explicit frame ambiguity and an unknown fallback', () => {
  const fixture = navigationBaselines[0], result = extractSections({ id: 'list-navigation', content: fixture.content, format: fixture.format }, { maxChunkWords: 20 });
  const anchors = result.sections[0].source_navigation_anchors;
  assert.ok(anchors.filter(anchor => /Lighting|Controls/.test(anchor.label)).every(anchor => anchor.ambiguity.within_introduced_list_frame && anchor.parent_boundary_suppressed));
  const unknown = extractSections(source('<p>The Operator shall deliver only the agreed work, unless access is unsafe.</p>'));
  assert.equal(unknown.units[0].source_navigation.status, 'UNKNOWN_NO_SOURCE_SUPPORTED_ANCHOR');
  assert.equal(unknown.units[0].source_navigation.nearest_anchor, null);
});

test('colon governor retains two original tables and their shared qualification across page and caption transitions', () => {
  const content = '<h2>1. Vesting</h2><p>The award shall vest only after service and in accordance with the following tables:</p><table><tr><td colspan="3"><p><strong>First Measure</strong></p></td></tr><tr><th>Rank</th><th>Amount</th></tr><tr><td>40th percentile</td><td>50%</td></tr><tr><td>80th percentile (Maximum</td><td>150%</td></tr></table><p>19</p><h2>Second Measure</h2><table><tr><th>Rank</th><th>Amount</th></tr><tr><td>30th percentile</td><td>0%</td></tr><tr><td>70th percentile</td><td>200%</td></tr></table><h3>Calculation Note</h3><p>* Both amounts use linear interpolation between the thresholds, except that no excess is due.</p><h2>2. Settlement</h2><p>Settlement shall follow written notice.</p>';
  const result = extractSections(source(content));
  const vesting = result.sections.find(section => section.heading === '1. Vesting');
  for (const literal of ['First Measure', '40th percentile | 50%', '80th percentile (Maximum | 150%', 'Second Measure', '30th percentile | 0%', '70th percentile | 200%', 'Calculation Note', 'Both amounts use linear interpolation', 'except that no excess']) assert.ok(vesting.text.includes(literal), literal);
  assert.ok(!vesting.text.includes('2. Settlement'));
  assert.ok(result.sections.some(section => section.heading === '2. Settlement'));
  assert.equal(vesting.governor_frames.length, 1);
  assert.equal(vesting.governor_frames[0].source_evidence, 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE');
  assert.equal(vesting.governor_frames[0].semantic_completeness_verified, false);
  assert.ok(result.warnings.some(warning => warning.code === 'INTRODUCED_TABLE_FRAMES_RETAINED'));
  assert.ok(vesting.source_navigation_anchors.find(anchor => anchor.label === 'Second Measure').ambiguity.within_introduced_list_frame);
  checkOffsets(result);
});

test('colon to direct source table retains rows and note but respects the next typed article', () => {
  const result = extractSections(source('<p>Rates shall follow this table:</p><table><tr><th>Item</th><th>Fee</th></tr><tr><td>Work A</td><td>12</td></tr></table><p>Fees exclude authorized expenses.</p><h1>ARTICLE II</h1><p>The Requester shall give notice.</p>'));
  assert.match(result.sections[0].text, /Rates.*Work A \\| 12.*exclude authorized expenses/s);
  assert.ok(!result.sections[0].text.includes('ARTICLE II'));
  assert.ok(result.sections[0].governor_frames.some(frame => frame.source_evidence === 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE'));
  checkOffsets(result);
});

test('a new typed section before a table does not falsely satisfy an earlier colon dependency', () => {
  const result = extractSections(source('<h2>1. Work</h2><p>The Operator shall perform work:</p><h2>2. Prices</h2><table><tr><th>Item</th><th>Fee</th></tr><tr><td>A</td><td>12</td></tr></table><p>The fee is payable after notice.</p>'));
  assert.ok(result.sections[0].governor_frames.every(frame => frame.source_evidence !== 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE'));
  assert.ok(!result.sections[0].text.includes('2. Prices'));
  checkOffsets(result);
});

test('numbered shared source footnotes remain with both tables until an explicit Section fence', () => {
  const content = '<h2>1. Award</h2><p>The amount shall follow these tables:</p><table><tr><th>First</th><th>Rate</th></tr><tr><td>A</td><td>25%</td></tr></table><h3>Second Measure</h3><table><tr><th>Second</th><th>Rate</th></tr><tr><td>B</td><td>75%</td></tr></table><p>1. Source: Q4 Results</p><p>Both measures shall use that source; no other quarter is included.</p><h2>Section 2. Settlement</h2><p>The Requester shall give written notice.</p>';
  const result = extractSections(source(content));
  assert.match(result.sections[0].text, /A \| 25%.*B \| 75%.*1\. Source:\s+Q4 Results.*no other quarter/s);
  assert.ok(!result.sections[0].text.includes('Section 2. Settlement'));
  assert.ok(result.sections.some(section => section.heading === 'Section 2. Settlement'));
  assert.equal(result.sections[0].governor_frames[0].source_evidence, 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE');
  checkOffsets(result);
});

test('a colon followed by a one-cell source table retains native inner captions and shared definitions', () => {
  const result = extractSections(source('<h2>1. Work</h2><p>The scope shall follow this table:</p><table><tr><td><h2>Section 1. Included Work</h2><p>The Operator shall install the agreed controls.</p><h3>Definition</h3><p>Controls exclude unsafe replacement parts.</p></td></tr></table><p>Both parties shall share the stated costs.</p><h2>Section 2. Notice</h2><p>The Requester shall notify in writing.</p>'));
  const work = result.sections[0];
  assert.match(work.text, /Section 1\. Included Work.*install the agreed controls.*exclude unsafe replacement parts.*share the stated costs/s);
  assert.ok(!work.text.includes('Section 2. Notice'));
  assert.equal(work.governor_frames[0].source_evidence, 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE');
  checkOffsets(result);
});

test('intervening source caption still links a one-cell table and its shared footer to the colon governor', () => {
  const result = extractSections(source('<h2>1. Rates</h2><p>The rates shall follow this table:</p><h3>Rate Schedule</h3><table><tr><td><p>The regular rate is12units.</p><h3>Definition</h3><p>Emergency work excludes unsafe access.</p></td></tr></table><p>Both rates exclude documented expenses.</p><h2>Section 2. Notices</h2><p>The Requester shall give written notice.</p>'));
  assert.match(result.sections[0].text, /Rate Schedule.*regular rate is12units.*Definition.*excludes unsafe access.*exclude documented expenses/s);
  assert.ok(!result.sections[0].text.includes('Section 2. Notices'));
  assert.equal(result.sections[0].governor_frames[0].source_evidence, 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE');
  checkOffsets(result);
});

test('legacy SGML table markers retain typed inner captions and shared notes under the colon governor', () => {
  const content = '<DOCUMENT>\n<TEXT>\n1. Payment\n\nThe rates shall follow these tables:\n<TABLE>\nSection 1. Table Meaning.\n\n<S>Alpha <C>12 units\n</TABLE>\n<TABLE>\n<S>Beta <C>24 units\n</TABLE>\nBoth rates exclude unsafe work and expenses.\n\nSection 2. Notices.\n\nThe Requester shall give written notice.\n</TEXT>\n</DOCUMENT>';
  const result = extractSections(source(content, 'text'));
  assert.match(result.sections[0].text, /Section 1\. Table Meaning.*Alpha.*12 units.*Beta.*24 units.*exclude unsafe work/s);
  assert.ok(!result.sections[0].text.includes('Section 2. Notices.'));
  assert.ok(result.sections[0].governor_frames.some(frame => frame.source_evidence === 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE'));
  assert.ok(result.warnings.some(warning => warning.code === 'SGML_TABLE_LAYOUT_UNCERTAIN'));
  checkOffsets(result);
});

test('genuine HTML captions are preserved once before their rows and shared qualification', () => {
  const content = '<h2>1. Rates</h2><p>Rates shall follow this table:</p><table><caption>Thresholds and Exceptions</caption><tr><th>Work</th><th>Fee</th></tr><tr><td>A</td><td>12</td></tr></table><p>These fees exclude unsafe work.</p><h2>Section 2. Notices</h2><p>The Requester shall give notice.</p>';
  const result = extractSections(source(content));
  assert.equal(result.normalized_text, '1. Rates\n\nRates shall follow this table:\n\nThresholds and Exceptions\n\nWork | Fee\n\nA | 12\n\nThese fees exclude unsafe work.\n\nSection 2. Notices\n\nThe Requester shall give notice.');
  assert.equal(result.normalized_text.split('Thresholds and Exceptions').length - 1, 1);
  assert.match(result.sections[0].text, /Rates.*Thresholds and Exceptions.*Work \| Fee.*A \| 12.*exclude unsafe work/s);
  assert.ok(!result.sections[0].text.includes('Section 2. Notices'));
  const caption = result.sections[0].source_navigation_anchors.find(anchor => anchor.label === 'Thresholds and Exceptions');
  assert.equal(caption.source_evidence.source_kind, 'table_caption'); assert.equal(caption.ambiguity.table_layout, true);
  assert.equal(caption.governing_hierarchy_verified, false);
  assert.ok(result.warnings.some(warning => warning.code === 'HTML_TABLE_CAPTIONS_RETAINED' && warning.count === 1));
  checkOffsets(result);
});

test('genuine caption emphasis and entities remain literal while active and hidden content stays excluded', () => {
  const result = extractSections(source('<p>The amounts shall follow this table:</p><table><caption><strong>Fees &amp; Exceptions</strong><script>globalThis.captionPwned = true</script><span hidden>FORGED</span></caption><tr><td>First</td><td>4</td></tr></table><p>Except that no fee is due for unsafe work.</p>'));
  assert.match(result.normalized_text, /Fees & Exceptions.*First \| 4.*Except that no fee/s);
  assert.doesNotMatch(result.normalized_text, /captionPwned|FORGED/); assert.equal(globalThis.captionPwned, undefined);
  checkOffsets(result);
});

test('a rowless table with a caption retains the whole fallback exactly once', () => {
  const result = extractSections(source('<p>The Operator shall use the following information.</p><table><caption>Unknown Layout</caption><s>Supplier Entity</s><c>Quantity12</c></table><p>No unsafe material may be used.</p>'));
  for (const literal of ['Unknown Layout', 'Supplier Entity', 'Quantity12']) assert.equal(result.normalized_text.split(literal).length - 1, 1);
  assert.ok(result.warnings.some(warning => warning.code === 'TABLE_WITHOUT_HTML_ROWS_RETAINED'));
  checkOffsets(result);
});

test('compound captioned tables preserve literal order, malformed labels and the shared note', () => {
  const content = '<h2>1. Award</h2><p>The award shall follow these tables:</p><table><caption>First Measure</caption><tr><td>Maximum (</td><td>120%</td></tr></table><p>19</p><table><caption>Second Measure</caption><tr><td>Threshold</td><td>25%</td></tr></table><p>* Both measures use the same interpolation rule, unless service is incomplete.</p><h2>Section 2. Notices</h2><p>Written notice shall be given.</p>';
  const result = extractSections(source(content));
  assert.match(result.sections[0].text, /First Measure.*Maximum \( \| 120%.*19.*Second Measure.*Threshold \| 25%.*same interpolation rule.*unless service is incomplete/s);
  assert.ok(!result.sections[0].text.includes('Section 2. Notices'));
  assert.equal(result.sections[0].governor_frames[0].source_evidence, 'LITERAL_COLON_FOLLOWED_BY_SOURCE_TABLE');
  assert.equal(result.warnings.filter(warning => warning.code === 'HTML_TABLE_CAPTIONS_RETAINED').length, 2);
  checkOffsets(result);
});

test('a body-shaped wrapped suffix stays an unresolved navigation fragment rather than a fabricated multiline title', () => {
  const result = extractSections(source('<p>ARTICLE I</p><p>CONTRACT ADMINISTRATION</p><p>and if access fails</p><p>The Operator shall notify in writing.</p>'));
  const anchor = result.sections[0].source_navigation_anchors.find(item => item.label === 'CONTRACT ADMINISTRATION');
  assert.ok(anchor); assert.equal(anchor.ambiguity.unresolved_title_continuation, true);
  assert.ok(!anchor.parts.some(part => part.text.includes('if access fails')));
  checkOffsets(result);
});
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

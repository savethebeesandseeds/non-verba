// SPDX-License-Identifier: AGPL-3.0-only
// All inputs are DECLARED_SYNTHETIC. No public contract/source case is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Parser} from 'parse5';
import {traceNativeDecoration,bindNativeDecoration as actualBindNativeDecoration,projectNativeDecoration,nativeDecorationInput,createNativeDecorationView,unresolvedNativeDecoration,verifyNativeDecorationEnvelope,legacySgmlProfileApplies,LEGACY_SGML_PROFILE,NATIVE_DECORATION_INPUT_POLICY} from '../lib/source-decoration.mjs';
const tracerSourceSHA256='a'.repeat(64);
const collectorSourceSHA256='b'.repeat(64);
// Declared synthetic method identities only. Production defaults never invent
// a digest; missing current-method bindings are explicitly unbound.
const bindNativeDecoration=(trace,options)=>actualBindNativeDecoration(trace,{collectorSourceSHA256,...options});
const origin=(run,start,end,textStart=0,textEnd=run.decoded_text.length,normalization='EXACT_DECODED')=>({normalized_start:start,normalized_end:end,sources:[{run_id:run.id,decoded_start:textStart,decoded_end:textEnd}],normalization});
function bound(raw,normalizedText,select){const trace=traceNativeDecoration(raw);return {trace,envelope:bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:select(trace.runs),tracerSourceSHA256})};}

test('adjacent differently marked source values remain distinct without changing normalized bytes',()=>{
  const raw='<p><strike>2.50</strike><u>1.25</u> per item</p>',normalizedText='2.501.25 per item';
  const {trace,envelope}=bound(raw,normalizedText,r=>r.map((run,i)=>origin(run,[0,4,8][i],[4,8,17][i])));
  assert.deepEqual(trace.sources.map(s=>s.native_tag),['strike','u']);assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');
  const options={raw,normalizedText,start:0,end:normalizedText.length},projection=projectNativeDecoration(envelope,options),input=nativeDecorationInput(envelope,options);
  assert.deepEqual(projection.annotations.map(a=>[a.text,a.marks[0].native_tag]),[['2.50','strike'],['1.25','u']]);
  assert.ok(!input.text.includes('2.501.25'));assert.match(input.text,/2\.50.*NATIVE_SOURCE_MARKS_UNVERIFIED.*1\.25/s);
  assert.equal(normalizedText,'2.501.25 per item');assert.ok(projection.annotations.every(a=>a.effectiveness_verified===false));
});

test('nested inherited native marks and CSS none retain every original ancestor source',()=>{
  const raw='<del cite="https://example.invalid"><span style="text-decoration: line-through !important"><u><span style="text-decoration-line:none">A&amp;B</span></u></span></del>';
  const {trace,envelope}=bound(raw,'A&B',runs=>[origin(runs[0],0,3)]),p=projectNativeDecoration(envelope,{raw,normalizedText:'A&B'});
  assert.equal(trace.runs[0].decoded_text,'A&B');assert.equal(raw.slice(trace.runs[0].raw.start,trace.runs[0].raw.end),'A&amp;B');
  assert.deepEqual(new Set(p.annotations[0].marks.map(m=>m.native_tag).filter(Boolean)),new Set(['del','u']));
  assert.deepEqual(p.annotations[0].marks.flatMap(m=>m.declarations.map(d=>d.value)),['none','line-through !important']);
  assert.ok(p.annotations[0].marks.every(m=>!m.computed_style_verified&&!m.effectiveness_verified));
});

test('native S INS and U are literal tags, with no applied insertion/deletion version',()=>{
  const raw='<s>old</s><ins>new</ins><u>note</u>',normalizedText='oldnewnote';
  const {trace,envelope}=bound(raw,normalizedText,r=>[origin(r[0],0,3),origin(r[1],3,6),origin(r[2],6,10)]);
  assert.deepEqual(trace.sources.map(s=>s.native_tag),['s','ins','u']);assert.ok(!('effective_version' in envelope));
  assert.ok(nativeDecorationInput(envelope,{raw,normalizedText}).text.includes('old'));
});

test('inert/comment/explicit hidden subtrees cannot supply decorated runs or marks',()=>{
  const raw='<script><del>forged</del></script><!-- <u>comment</u> --><svg><text style="text-decoration:line-through">svg</text></svg><span hidden><del>hidden</del></span><u aria-hidden="true">aria</u><del style="display:none">css</del><p><u>visible</u></p>';
  const trace=traceNativeDecoration(raw);assert.deepEqual(trace.runs.map(r=>r.decoded_text),['visible']);assert.deepEqual(trace.sources.map(s=>s.native_tag),['u']);
});

test('HTML parser recovery is disclosed rather than inventing raw syntactic ancestry',()=>{
  // HTML S breaks out of foreign SVG content under the same parse5 DOM rules
  // used by the collector. It is not a descendant of the omitted SVG node.
  const trace=traceNativeDecoration('<svg><text><s>recovered</s></text></svg>');
  assert.deepEqual(trace.runs.map(r=>r.decoded_text),['recovered']);assert.deepEqual(trace.sources.map(s=>s.native_tag),['s']);assert.ok(trace.parser_errors.length>0);assert.equal(trace.computed_style_verified,false);
});

test('duplicate source strings map by exact run origins, not first occurrence',()=>{
  const raw='<p>same</p><p><u>same</u></p>',normalizedText='same\n\nsame';
  const {trace,envelope}=bound(raw,normalizedText,r=>[origin(r[0],0,4),origin(r[1],6,10)]),p=projectNativeDecoration(envelope,{raw,normalizedText});
  assert.equal(p.annotations.length,1);assert.equal(p.annotations[0].start,6);assert.equal(p.annotations[0].origins[0].raw.start,trace.runs[1].raw.start);
  assert.throws(()=>bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(trace.runs[1],0,4),origin(trace.runs[1],6,10)],tracerSourceSHA256}),/reused/);
  assert.throws(()=>bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(trace.runs[1],0,4),origin(trace.runs[0],6,10)],tracerSourceSHA256}),/out of order/);
  const omittedPrefix=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(trace.runs[1],0,4)],tracerSourceSHA256});assert.equal(omittedPrefix.collector_mapping_status,'UNRESOLVED_COLLECTOR_ORIGIN');assert.throws(()=>nativeDecorationInput(omittedPrefix,{raw,normalizedText}),/plain-only/);
  const joined=traceNativeDecoration('<span>same</span><u>same</u>');
  assert.throws(()=>bindNativeDecoration(joined,{raw:'<span>same</span><u>same</u>',normalizedText:'samesame',collectorSegments:[{normalized_start:0,normalized_end:8,sources:[joined.runs[1],joined.runs[0]].map(r=>({run_id:r.id,decoded_start:0,decoded_end:4})),normalization:'EXACT_DECODED'}],tracerSourceSHA256}),/out of order/);
});

test('NFC zero-width/control filtering and whitespace require declared exact collector transformation',()=>{
  const raw='<u> e\u0301\u200B\u0007  x </u>',trace=traceNativeDecoration(raw),run=trace.runs[0],normalizedText='é x';
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(run,0,3,0,run.decoded_text.length,'EXTRACTOR_NFC_FILTER_WHITESPACE_V1')],tracerSourceSHA256});
  assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.equal(envelope.trace.runs[0].decoded_text,' e\u0301\u200B\u0007  x ');
  assert.throws(()=>bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(run,0,3)],tracerSourceSHA256}),/differs/);
});

test('cross-run NFC composition is joint evidence with unresolved per-run attribution',()=>{
  const raw='<span>e</span><u>\u0301</u>',trace=traceNativeDecoration(raw),normalizedText='é';
  const collectorSegments=[{normalized_start:0,normalized_end:1,sources:trace.runs.map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization:'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'}];
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments,tracerSourceSHA256});
  assert.equal(envelope.mapping_status,'UNRESOLVED_COLLECTOR_OR_NATIVE_STYLE_MAPPING');assert.equal(projectNativeDecoration(envelope,{raw,normalizedText}).annotations[0].mapping,'AMBIGUOUS_PER_RUN_MAPPING');
  assert.throws(()=>nativeDecorationInput(envelope,{raw,normalizedText}),/plain-only/);
});

test('missing or partial collector origins stay unresolved and preserve the unit rather than silently encoding plain text',()=>{
  const raw='<del>pending</del>',trace=traceNativeDecoration(raw),normalizedText='pending';
  for(const collectorSegments of [undefined,[],[origin(trace.runs[0],0,3,0,3)]]){
    const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments,tracerSourceSHA256});assert.notEqual(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');
    assert.throws(()=>nativeDecorationInput(envelope,{raw,normalizedText}),/plain-only/);assert.equal(normalizedText,'pending');
  }
});

test('range projection clips normalized text while retaining whole raw origin with disclosed clipping',()=>{
  const raw='<u>abcdef</u>',normalizedText='abcdef';const {envelope}=bound(raw,normalizedText,r=>[origin(r[0],0,6)]);
  for(const [start,end] of [[0,2],[2,4],[4,6]]){const p=projectNativeDecoration(envelope,{raw,normalizedText,start,end});assert.equal(p.annotations[0].text,normalizedText.slice(start,end));assert.equal(p.annotations[0].clipped,true);const input=nativeDecorationInput(envelope,{raw,normalizedText,start,end});assert.match(input.text,/NATIVE_SOURCE_MARKS_UNVERIFIED/);assert.ok(input.text.includes(normalizedText.slice(start,end)));}
});

test('raw, normalized, method identity and envelope tampering are rejected',()=>{
  const raw='<u>safe</u>',normalizedText='safe',trace=traceNativeDecoration(raw),{envelope}=bound(raw,normalizedText,r=>[origin(r[0],0,4)]);
  assert.throws(()=>bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[],tracerSourceSHA256:'bad'}),/identity/);
  assert.throws(()=>projectNativeDecoration(envelope,{raw:raw+' ',normalizedText}),/binding/);assert.throws(()=>projectNativeDecoration(envelope,{raw,normalizedText:'else'}),/binding/);
  const damaged=structuredClone(envelope);damaged.trace.runs[0].decoded_text='else';assert.throws(()=>projectNativeDecoration(damaged,{raw,normalizedText}),/digest/);
});

test('surrogate-pair origins and normalized ranges cannot split a codepoint',()=>{
  const raw='<u>😀x</u>',trace=traceNativeDecoration(raw),normalizedText='😀x';
  assert.throws(()=>bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(trace.runs[0],0,1,0,1)],tracerSourceSHA256}),/codepoint/);
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(trace.runs[0],0,3)],tracerSourceSHA256});assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');
  assert.throws(()=>projectNativeDecoration(envelope,{raw,normalizedText,start:1,end:3}),/codepoint/);
});

test('unknown stylesheet cascade remains unresolved without making style contents visible annotations',()=>{
  const raw='<style>.deleted { text-decoration:line-through }</style><p class="deleted">value</p>',trace=traceNativeDecoration(raw);
  assert.deepEqual(trace.runs.map(r=>r.decoded_text),['value']);assert.equal(trace.sources.length,0);assert.ok(trace.unresolved.some(v=>v.kind==='STYLESHEET_CASCADE_NOT_COMPUTED'));
  const envelope=bindNativeDecoration(trace,{raw,normalizedText:'value',collectorSegments:[origin(trace.runs[0],0,5)],tracerSourceSHA256});assert.equal(envelope.collector_mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.equal(envelope.native_style_status,'UNRESOLVED_STYLESHEET_CASCADE');assert.throws(()=>nativeDecorationInput(envelope,{raw,normalizedText:'value'}),/plain-only/);
});

test('CSS quoted separators stay literal and explicit bounds emit no partial trace/projection',()=>{
  const raw='<u style="text-decoration:var(--x, \'a;b\'); text-decoration-line:underline">value</u>',trace=traceNativeDecoration(raw);
  assert.equal(trace.sources[0].declarations.length,2);assert.ok(trace.sources[0].declarations[0].value.includes('a;b'));
  assert.throws(()=>traceNativeDecoration(raw,{maxNodes:1}),/node bound/);
  const envelope=bindNativeDecoration(trace,{raw,normalizedText:'value',collectorSegments:[origin(trace.runs[0],0,5)],tracerSourceSHA256});assert.throws(()=>projectNativeDecoration(envelope,{raw,normalizedText:'value',maxCharacters:128,maxRuns:1,start:0,end:6}),/end/);
});

test('four-MiB plain source remains a bounded single-pass trace with no substring mapping work',()=>{
  const raw='x'.repeat(4*1024*1024),trace=traceNativeDecoration(raw,{format:'text'});
  assert.equal(trace.runs.length,1);assert.equal(trace.raw.bytes,4*1024*1024);assert.equal(trace.sources.length,0);
  const envelope=bindNativeDecoration(trace,{raw,normalizedText:raw,collectorSegments:[origin(trace.runs[0],0,raw.length)],tracerSourceSHA256});assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');
});

test('long marked text windows stay bounded and a prepared view does not leak outside-window text',()=>{
  const normalizedText='abcdefgh '.repeat(12000),raw='<u>'+normalizedText+'</u>';
  const {envelope}=bound(raw,normalizedText,r=>[origin(r[0],0,normalizedText.length)]),view=createNativeDecorationView(envelope,{raw,normalizedText});
  envelope.trace.runs[0].decoded_text='tampered after preparation';
  for(let start=0;start<normalizedText.length;start+=1000){const end=Math.min(start+128,normalizedText.length),p=view.project({start,end,maxCharacters:128});assert.equal(p.annotations[0].text,normalizedText.slice(start,end));assert.equal(Object.hasOwn(p.annotations[0].origins[0],'decoded_text'),false);assert.ok(JSON.stringify(p).length<4096);assert.ok(view.input({start,end,maxCharacters:128}).text.includes(normalizedText.slice(start,end)));}
});

test('decorated whitespace lost by normalization retains a zero-output source-origin record',()=>{
  const raw='<u>   </u><span>next</span>',trace=traceNativeDecoration(raw),normalizedText='next';
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(trace.runs[0],0,0,0,3,'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'),origin(trace.runs[1],0,4)],tracerSourceSHA256});
  assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');const p=projectNativeDecoration(envelope,{raw,normalizedText});assert.equal(p.annotations.length,1);assert.equal(p.annotations[0].start,0);assert.equal(p.annotations[0].end,0);assert.equal(p.annotations[0].origins[0].decoded_end,3);assert.match(nativeDecorationInput(envelope,{raw,normalizedText}).text,/NATIVE_SOURCE_MARKS_UNVERIFIED/);
});

test('unrecognized or escaped inline CSS is retained literally instead of assumed undecorated',()=>{
  const raw='<span style="text\\2d decoration:line-through">earlier</span><span style="text-decoration:underline">later</span>',normalizedText='earlierlater';
  const {trace,envelope}=bound(raw,normalizedText,r=>[origin(r[0],0,7),origin(r[1],7,12)]);
  assert.equal(trace.sources.length,2);assert.equal(trace.sources[0].declarations.length,0);assert.equal(trace.sources[0].style_attribute.decoded_value,'text\\2d decoration:line-through');
  const input=nativeDecorationInput(envelope,{raw,normalizedText});assert.ok(!input.text.includes('earlierlater'));assert.match(input.text,/style_literal/);assert.equal(input.computed_style_verified,false);
});

// V2 controls: synthetic mixed SGML/HTML prefix and exact adopted attributes;
// no already-exposed public source is imported, read or encoded by these tests.
function allOrigins(raw){const trace=traceNativeDecoration(raw);let end=0;const collectorSegments=trace.runs.map(run=>{const start=end;end+=run.decoded_text.length;return origin(run,start,end);}),normalizedText=trace.runs.map(run=>run.decoded_text).join('');return {trace,normalizedText,envelope:bindNativeDecoration(trace,{raw,normalizedText,collectorSegments,tracerSourceSHA256})};}

test('implicit BODY attributes adopted after a mixed source prefix retain exact source-token provenance',()=>{
  const prefix='<DOCUMENT>\nFILING HEADER\n<HTML><HEAD></HEAD>',body='<BODY style="font-size:10pt;font-family:serif">',raw=prefix+body+'<P><U>marked</U></P></BODY></HTML></DOCUMENT>';
  const {trace,envelope,normalizedText}=allOrigins(raw),source=trace.sources.find(s=>s.tag==='body');
  assert.ok(source);assert.equal(source.element,null);assert.equal(source.element_start_tag,null);assert.equal(source.start_tag.start,prefix.length);assert.equal(raw.slice(source.start_tag.start,source.start_tag.end),body);
  assert.equal(source.start_tag_role,'ATTRIBUTE_ADOPTION_SOURCE_TOKEN');assert.equal(source.element_scope.kind,'PARSER_RECOVERED_DOM_DESCENDANTS');assert.equal(source.element_scope.raw_interval_verified,false);assert.equal(source.element_scope.source_origin,'PARSE5_START_TOKEN_ATTRIBUTE_OBJECT_IDENTITY');
  assert.match(raw.slice(source.style_attribute.start,source.style_attribute.end),/^style="font-size/);assert.equal(source.input_relevance,'NONDECORATION_STYLE_METADATA');assert.equal(trace.unresolved.length,0);assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');
  const projected=projectNativeDecoration(envelope,{raw,normalizedText});assert.ok(projected.annotations.some(a=>a.marks.some(m=>m.element===null&&m.tag==='body')));assert.equal(nativeDecorationInput(envelope,{raw,normalizedText}).encoded_annotation_groups,1);
});

test('later BODY attribute adoption uses the later token rather than an earlier element start tag',()=>{
  const before='<HTML><HEAD></HEAD><BODY><P>earlier</P>',later='<BODY style="text-decoration:line-through">',raw=before+later+'<P>later</P></BODY></HTML>';
  const {trace,envelope,normalizedText}=allOrigins(raw),source=trace.sources.find(s=>s.tag==='body');
  assert.equal(source.start_tag.start,before.length);assert.notEqual(source.element_start_tag.start,source.start_tag.start);assert.equal(source.start_tag_role,'ATTRIBUTE_ADOPTION_SOURCE_TOKEN');assert.equal(source.element_scope.raw_interval_verified,true);assert.equal(source.element_scope.attribute_adoption,true);
  assert.equal(source.declarations[0].value,'line-through');assert.equal(trace.unresolved.length,0);const input=nativeDecorationInput(envelope,{raw,normalizedText});assert.ok(input.text.includes('earlierlater'));assert.match(input.text,/text-decoration:line-through/);assert.equal(input.effectiveness_verified,false);
});

test('duplicate BODY attributes follow parser adoption identity rather than matching the last equal tag',()=>{
  const first='<HTML><HEAD></HEAD><BODY style="font-size:10pt">',raw=first+'<P>earlier</P><BODY style="text-decoration:line-through"><P>later</P></BODY></HTML>';
  const {trace,envelope,normalizedText}=allOrigins(raw),source=trace.sources.find(s=>s.tag==='body');
  assert.equal(source.start_tag.start,'<HTML><HEAD></HEAD>'.length);assert.equal(source.style_attribute.decoded_value,'font-size:10pt');assert.equal(source.declarations.length,0);assert.equal(trace.sources.length,1);assert.equal(trace.unresolved.length,0);
  const input=nativeDecorationInput(envelope,{raw,normalizedText});assert.equal(input.text,normalizedText);assert.equal(input.encoded_annotation_groups,0);assert.equal(input.nondecoration_style_sources_retained_in_trace,1);
  const duplicate=traceNativeDecoration('<BODY style="font-size:10pt" style="text-decoration:line-through">value</BODY>');assert.equal(duplicate.sources[0].style_attribute.decoded_value,'font-size:10pt');assert.equal(duplicate.sources[0].input_relevance,'NONDECORATION_STYLE_METADATA');assert.equal('<BODY style="font-size:10pt" style="text-decoration:line-through">value</BODY>'.slice(duplicate.sources[0].style_attribute.start,duplicate.sources[0].style_attribute.end),'style="font-size:10pt"');
  const hidden=traceNativeDecoration('HEADER<HTML><BODY style="visibility:hidden"><U>omitted</U></BODY></HTML>');assert.equal(hidden.runs.length,0);assert.equal(hidden.sources.length,0);
});

test('font and layout metadata remain in the trace without consuming compact model annotation groups',()=>{
  const raw='<BODY style="font-family:serif;font-size:10pt;text-align:left">'+Array.from({length:600},()=>'<SPAN style="font-size:10pt;margin-left:0pt">x</SPAN>').join('')+'</BODY>';
  const {trace,envelope,normalizedText}=allOrigins(raw),view=createNativeDecorationView(envelope,{raw,normalizedText});
  assert.equal(trace.sources.length,601);assert.ok(trace.sources.every(s=>s.input_relevance==='NONDECORATION_STYLE_METADATA'));
  const input=view.input({start:0,end:128,maxRuns:1,maxCharacters:128});assert.equal(input.text,'x'.repeat(128));assert.equal(input.encoded_annotation_groups,0);assert.equal(input.nondecoration_style_sources_retained_in_trace,601);
  const p=view.project({start:0,end:2});assert.ok(p.annotations.some(a=>a.marks.some(m=>m.style_attribute.decoded_value.includes('font-family'))));assert.equal(p.projection_policy,'ALL_NATIVE_STYLE_SOURCE_METADATA');
});

test('adjacent character runs share compact mark evidence only when the literal native source is the same',()=>{
  const letters=value=>[...value].map(c=>`<FONT style="font-size:10pt;font-family:serif">${c}</FONT>`).join('');
  const raw='<BODY style="font-size:10pt"><STRIKE>'+letters('earlier')+'</STRIKE><U>'+letters('later')+'</U></BODY>',{trace,envelope,normalizedText}=allOrigins(raw),input=nativeDecorationInput(envelope,{raw,normalizedText,maxRuns:2});
  assert.equal(trace.sources.length,15);assert.equal(input.encoded_annotation_groups,2);assert.ok(!input.text.includes('earlierlater'));assert.ok(!input.text.includes('font-size'));assert.ok(!input.text.includes('font-family'));assert.match(input.text,/earlier.*NATIVE_SOURCE_MARKS_UNVERIFIED.*later/s);assert.ok(input.text.length<300);
  const separate=allOrigins('<U>a</U><U>b</U>');assert.equal(nativeDecorationInput(separate.envelope,{raw:'<U>a</U><U>b</U>',normalizedText:separate.normalizedText}).encoded_annotation_groups,2);
});

test('unknown CSS and decoration-family declarations cannot use the neutral font/layout shortcut',()=>{
  for(const style of ['display:inline-block','font-size:var(--unknown)','text\\2d decoration:line-through','--change:line-through','text-decoration-color:red','font-size:10pt;broken']) {
    const raw=`<SPAN style="${style}">value</SPAN>`,{trace,envelope,normalizedText}=allOrigins(raw),source=trace.sources[0],input=nativeDecorationInput(envelope,{raw,normalizedText});
    assert.notEqual(source.input_relevance,'NONDECORATION_STYLE_METADATA');assert.equal(input.encoded_annotation_groups,1);assert.ok(input.text.includes('style_literal'));assert.equal(input.computed_style_verified,false);assert.equal(source.effectiveness_verified,false);
  }
});

test('finite whitespace profile keeps one ASCII boundary without trimming source whitespace',()=>{
  const raw='<span>A</span><u>&nbsp;\t</u><span>B</span>',trace=traceNativeDecoration(raw),normalizedText='A B';
  const segments=[origin(trace.runs[0],0,1),origin(trace.runs[1],1,2,0,trace.runs[1].decoded_text.length,'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'),origin(trace.runs[2],2,3)];
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:segments,tracerSourceSHA256});assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.equal(projectNativeDecoration(envelope,{raw,normalizedText}).annotations[0].text,' ');
  assert.throws(()=>bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(trace.runs[0],0,1,0,1,'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1')],tracerSourceSHA256}),error=>error.code==='NATIVE_DECORATION_WHITESPACE_REQUIRED');
  const whitespace=traceNativeDecoration('<u>&nbsp;</u>');assert.throws(()=>bindNativeDecoration(whitespace,{raw:'<u>&nbsp;</u>',normalizedText:'',collectorSegments:[origin(whitespace.runs[0],0,0,0,1,'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1')],tracerSourceSHA256}),error=>error.code==='NATIVE_DECORATION_OUTPUT_MISMATCH');
});

test('different-path whitespace receives complete joint evidence without assigning the space to one mark',()=>{
  const raw='<span>\t</span><u>&nbsp;</u>',trace=traceNativeDecoration(raw),normalizedText=' ';
  const segment={normalized_start:0,normalized_end:1,sources:trace.runs.map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization:'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'};
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[segment],tracerSourceSHA256});assert.equal(envelope.ambiguous_segments,1);assert.equal(envelope.collector_mapping_status,'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE');assert.equal(envelope.input_eligibility,'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE');const view=createNativeDecorationView(envelope,{raw,normalizedText}),annotation=view.projectRelevant().annotations[0];assert.deepEqual(annotation.marks,[]);assert.equal(annotation.joint_whitespace_witness.origins.length,2);assert.deepEqual(annotation.joint_whitespace_witness.origins.map(o=>o.marks.map(m=>m.native_tag)),[[],['u']]);assert.match(view.input().text,/JOINT_NORMALIZATION_UNVERIFIED/);
});

test('collector issues retain a complete trace while a trace failure produces an explicitly unavailable sealed shell',()=>{
  const raw='<u>source</u>',normalizedText='source',trace=traceNativeDecoration(raw),issues=[{code:'COLLECTOR_ORIGIN_UNSUPPORTED',component:'collector',raw_range:{start:0,end:raw.length},normalized_range:{start:0,end:6}}];
  const retained=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(trace.runs[0],0,6)],tracerSourceSHA256,collectorIssues:issues});assert.equal(retained.trace.sha256,trace.sha256);assert.equal(retained.collector_mapping_status,'UNRESOLVED_COLLECTOR_ORIGIN');assert.equal(retained.collector_issues[0].code,issues[0].code);assert.throws(()=>nativeDecorationInput(retained,{raw,normalizedText}),/plain-only/);
  const shell=unresolvedNativeDecoration({raw,normalizedText,tracerSourceSHA256,collectorSourceSHA256,format:'legacy-sgml',collectorIssues:['LEGACY_PROFILE_PENDING']});assert.equal(shell.trace.trace_status,'UNAVAILABLE_SOURCE_NATIVE_TRACE');assert.equal(shell.native_style_status,'UNAVAILABLE_SOURCE_NATIVE_TRACE');assert.equal(shell.trace.sources.length,0);assert.notEqual(shell.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.equal(verifyNativeDecorationEnvelope(shell,{raw,normalizedText}).source_authenticity_recomputed,false);assert.throws(()=>nativeDecorationInput(shell,{raw,normalizedText}),/plain-only/);
  assert.throws(()=>unresolvedNativeDecoration({raw,normalizedText,collectorIssues:[]}),/requires a collector issue/);assert.throws(()=>unresolvedNativeDecoration({raw,normalizedText,collectorIssues:[{code:'INVALID',text:'unapproved payload'}]}),/Machine collector/);
});

test('current tracer and collector identities are both bound; absent bindings stay explicit unbound',()=>{
  const raw='<u>source</u>',normalizedText='source',trace=traceNativeDecoration(raw),options={raw,normalizedText,collectorSegments:[origin(trace.runs[0],0,6)]};
  for(const identities of [{},{tracerSourceSHA256},{collectorSourceSHA256}]){const envelope=actualBindNativeDecoration(trace,{...options,...identities});assert.equal(envelope.method_identity_status,'UNBOUND_MISSING_CURRENT_METHOD_IDENTITIES');assert.equal(envelope.mapping_status,'UNBOUND_REQUIRES_CURRENT_METHOD_IDENTITIES');assert.ok(envelope.tracer_source_sha256===null||envelope.collector_source_sha256===null);assert.throws(()=>nativeDecorationInput(envelope,{raw,normalizedText}),/plain-only/);}
  const envelope=actualBindNativeDecoration(trace,{...options,tracerSourceSHA256,collectorSourceSHA256});assert.equal(envelope.collector_source_sha256,collectorSourceSHA256);assert.equal(verifyNativeDecorationEnvelope(envelope,{raw,normalizedText,expectedTracerSourceSHA256:tracerSourceSHA256,expectedCollectorSourceSHA256:collectorSourceSHA256}).mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.throws(()=>verifyNativeDecorationEnvelope(envelope,{raw,normalizedText,expectedCollectorSourceSHA256:'c'.repeat(64)}),/current method binding/);assert.throws(()=>actualBindNativeDecoration(trace,{...options,tracerSourceSHA256:[tracerSourceSHA256],collectorSourceSHA256}),error=>error.code==='NATIVE_DECORATION_INVALID_METHOD_IDENTITY');
});

test('terminal zero-output ownership is explicit and bound for intermediate, final and empty windows',()=>{
  const raw='<u> </u><span>A</span><u> </u><span>B</span><u> </u>',trace=traceNativeDecoration(raw),normalizedText='AB';
  const segments=[origin(trace.runs[0],0,0,0,1,'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'),origin(trace.runs[1],0,1),origin(trace.runs[2],1,1,0,1,'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'),origin(trace.runs[3],1,2),origin(trace.runs[4],2,2,0,1,'EXTRACTOR_NFC_FILTER_WHITESPACE_V1')];
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:segments,tracerSourceSHA256}),view=createNativeDecorationView(envelope,{raw,normalizedText});
  assert.deepEqual(view.projectRelevant({start:0,end:1}).annotations.map(a=>a.start),[0]);assert.deepEqual(view.projectRelevant({start:1,end:2}).annotations.map(a=>a.start),[1]);assert.deepEqual(view.projectRelevant({start:1,end:2,includeEndZeroWidth:true}).annotations.map(a=>a.start),[1,2]);assert.equal(view.project({start:1,end:1}).annotations.length,0);assert.deepEqual(view.project({start:1,end:1,includeEndZeroWidth:true}).annotations.map(a=>a.start),[1]);assert.deepEqual(view.project({start:2,end:2,includeEndZeroWidth:true}).annotations.map(a=>a.start),[2]);
  const ordinary=view.input({start:1,end:2}),terminal=view.input({start:1,end:2,includeEndZeroWidth:true});assert.notEqual(ordinary.projection_sha256,terminal.projection_sha256);assert.equal(terminal.normalized_range.include_end_zero_width,true);assert.equal(terminal.policy,NATIVE_DECORATION_INPUT_POLICY);assert.equal(terminal.encoded_annotation_groups,2);assert.throws(()=>view.projectRelevant({start:0,end:2,includeEndZeroWidth:true,maxRuns:1}),/exceeds explicit bound/);
});

// Exact frozen legacy reference before decoration integration: TABLE chunks,
// framing replacement, angle escape, then ONE PRE pass (not recursive decode).
function frozenLegacyDecodedChunks(raw){const chunks=[];let cursor=0;function append(value){if(!value)return;const stripped=value.replace(/<\/?(?:DOCUMENT|TYPE|SEQUENCE|FILENAME|DESCRIPTION|TEXT|PAGE|CAPTION|S|C)\b[^>]*>/giu,'\n'),escaped=stripped.replace(/</gu,'&lt;').replace(/>/gu,'&gt;'),parser=new Parser();parser.tokenizer.write(`<pre>${escaped}</pre>`,true);const pending=[parser.document],text=[];while(pending.length){const node=pending.pop();if(node.tagName==='head')continue;if(node.nodeName==='#text')text.push(node.value??'');const children=node.childNodes??[];for(let i=children.length-1;i>=0;i--)pending.push(children[i]);}chunks.push(text.join(''));}for(const marker of raw.matchAll(/<\/?TABLE\b[^>]*>/giu)){append(raw.slice(cursor,marker.index));cursor=marker.index+marker[0].length;}append(raw.slice(cursor));return chunks;}

test('legacy profile preserves frozen routing and literal unknown tags instead of interpreting SGML S/C as marks',()=>{
  const raw='<DOCUMENT>\r\n<TEXT>Alpha &amp;lt; B&nbsp;C <STRIKE>old</STRIKE>\n<S>Col1<C>Col2\n<TABLE><S>A<C>B</TABLE>Tail</TEXT></DOCUMENT>',trace=traceNativeDecoration(raw,{format:'legacy-sgml'});
  assert.equal(legacySgmlProfileApplies(raw),true);assert.equal(trace.source_profile,LEGACY_SGML_PROFILE);assert.equal(trace.sources.length,0);assert.equal(trace.paths.length,0);assert.deepEqual(trace.runs.map(r=>r.decoded_text),frozenLegacyDecodedChunks(raw));assert.ok(trace.runs.some(r=>r.decoded_text.includes('<STRIKE>old</STRIKE>')));assert.ok(trace.runs.some(r=>r.decoded_text.includes('&lt;')));assert.ok(trace.runs.some(r=>r.decoded_text.includes('\u00a0')));assert.ok(trace.transform_ledger.some(e=>e.kind==='LEGACY_FRAMING_TO_NEWLINE'&&raw.slice(e.raw.start,e.raw.end)==='<S>'));assert.equal(trace.transform_ledger.filter(e=>e.kind==='LEGACY_TABLE_APPEND_BOUNDARY').length,2);
  assert.equal(legacySgmlProfileApplies(raw,'html'),false);assert.equal(legacySgmlProfileApplies('<TABLE border="1">value</TABLE>'),false);assert.equal(legacySgmlProfileApplies('<DOCUMENT><P>html body</P></DOCUMENT>'),false);assert.throws(()=>traceNativeDecoration('<DOCUMENT><P>html body</P></DOCUMENT>',{format:'legacy-sgml'}),error=>error.code==='NATIVE_DECORATION_LEGACY_ROUTE_MISMATCH');
});

test('legacy chunk provenance retains one PRE leading-LF suppression, CRLF and no improved malformed-tag grammar',()=>{
  const raw='<TEXT>\nA<TABLE>\nB</TABLE>\r\nC',trace=traceNativeDecoration(raw,{format:'legacy-sgml'});assert.deepEqual(trace.runs.map(r=>r.decoded_text),['\nA','B','C']);assert.equal(trace.transform_ledger.filter(e=>e.kind==='LEGACY_SINGLE_PRE_DECODE').length,3);
  const normalizedText='A\n\nB\n\nC',segments=[origin(trace.runs[0],0,1,0,2,'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'),origin(trace.runs[1],3,4),origin(trace.runs[2],6,7)],envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:segments,tracerSourceSHA256});assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.equal(nativeDecorationInput(envelope,{raw,normalizedText}).text,normalizedText);
  const malformed='<DOCUMENT><TEXT>A<S title=">">B',m=traceNativeDecoration(malformed,{format:'legacy-sgml'});assert.deepEqual(m.runs.map(r=>r.decoded_text),frozenLegacyDecodedChunks(malformed));assert.ok(m.runs[0].decoded_text.includes('\">B'));assert.throws(()=>traceNativeDecoration(raw,{format:'legacy-sgml',maxNodes:1}),error=>error.code==='NATIVE_DECORATION_LEGACY_LEDGER_BOUND');
});

// V3: original-token identities survive active-formatting reconstruction and
// adoption-agency replacements. Every fixture remains DECLARED_SYNTHETIC.
function boundJoinedRuns(raw){return bound(raw,traceNativeDecoration(raw).runs.map(r=>r.decoded_text).join(''),runs=>{let end=0;return runs.map(run=>{const start=end;end+=run.decoded_text.length;return origin(run,start,end);});});}

test('native formatting reconstruction shares one literal token while retaining separate parsed DOM scopes',()=>{
  const raw='<p><u>A</p>B</u>',normalizedText='AB',ordinary=traceNativeDecoration('<p><u>A</u></p><p><u>B</u></p>');
  const {trace,envelope}=boundJoinedRuns(raw);assert.deepEqual(trace.unresolved,[]);assert.equal(trace.sources.length,1);assert.equal(new Set(trace.paths.map(p=>p.source_id)).size,1);assert.equal(trace.sources[0].start_tag.start,3);assert.equal(trace.sources[0].element,null);assert.equal(trace.sources[0].element_scope.raw_interval_verified,false);
  assert.deepEqual(trace.sources[0].dom_scopes.map(s=>s.raw_interval_verified),[true,false]);assert.equal(trace.sources[0].dom_scopes[1].kind,'PARSER_RECONSTRUCTED_FORMATTING_DOM_DESCENDANTS');assert.equal(trace.sources[0].dom_scopes[1].element,null);assert.ok(trace.sources[0].dom_scopes[1].parser_reported_location);assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');
  const view=createNativeDecorationView(envelope,{raw,normalizedText}),first=view.projectRelevant({start:0,end:1}),second=view.projectRelevant({start:1,end:2});assert.equal(first.annotations[0].marks[0].dom_scopes.length,1);assert.equal(second.annotations[0].marks[0].dom_scopes.length,1);assert.equal(first.annotations[0].marks[0].dom_scopes[0].raw_interval_verified,true);assert.equal(second.annotations[0].marks[0].dom_scopes[0].raw_interval_verified,false);
  const whole=view.projectRelevant({start:0,end:2});assert.equal(whole.annotations.length,1);assert.equal(whole.annotations[0].marks[0].dom_scopes.length,2);assert.equal(whole.annotations[0].origins.length,2);assert.equal(ordinary.sources.length,2);assert.notEqual(ordinary.sources[0].id,ordinary.sources[1].id);assert.deepEqual(ordinary.unresolved,[]);
});

test('adoption-agency native clone without a node location retains original token and recovered descendant scope',()=>{
  const raw='<u>A<div>B</u>C</div>',normalizedText='ABC',{trace,envelope}=boundJoinedRuns(raw);assert.deepEqual(trace.unresolved,[]);assert.equal(trace.sources.length,1);assert.equal(trace.sources[0].dom_scopes.length,2);assert.equal(trace.sources[0].dom_scopes[1].parser_reported_location,null);
  const view=createNativeDecorationView(envelope,{raw,normalizedText});assert.equal(view.projectRelevant({start:1,end:2}).annotations[0].marks[0].start_tag.start,0);assert.equal(view.projectRelevant({start:2,end:3}).annotations.length,0);assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.ok(view.input({start:0,end:3}).text.endsWith('C'));
});

test('inline CSS formatting recovery preserves exact original attribute range without inventing attribute adoption',()=>{
  for(const raw of ['<p><em style="text-decoration:line-through">A</p>B</em>','<u style="text-decoration:none">A<div>B</u>C</div>']){const {trace,envelope}=boundJoinedRuns(raw),source=trace.sources[0];assert.deepEqual(trace.unresolved,[]);assert.equal(trace.sources.length,1);assert.equal(source.dom_scopes.length,2);assert.equal(source.element_scope.attribute_adoption,false);assert.equal(source.start_tag_role,'SHARED_ORIGINAL_FORMATTING_SOURCE_TOKEN');assert.ok(raw.slice(source.style_attribute.start,source.style_attribute.end).startsWith('style='));assert.ok(source.style_declarations.length>0);assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.equal(source.computed_style_verified,false);assert.equal(source.effectiveness_verified,false);}
});

test('nested reconstruction and duplicate equal literal formatting tags keep distinct source identities',()=>{
  const raw='<p><u><strike>A</p>B</strike></u><u>C</u>',normalizedText='ABC',{trace,envelope}=boundJoinedRuns(raw);assert.deepEqual(trace.unresolved,[]);assert.equal(trace.sources.length,3);assert.equal(new Set(trace.sources.map(s=>s.id)).size,3);assert.equal(trace.sources.filter(s=>s.dom_scopes).length,2);
  const view=createNativeDecorationView(envelope,{raw,normalizedText}),p=view.projectRelevant({start:0,end:2});assert.equal(p.annotations[0].marks.length,2);assert.ok(p.annotations[0].marks.every(m=>m.dom_scopes.length===2));assert.notEqual(view.projectRelevant({start:2,end:3}).annotations[0].marks[0].id,p.annotations[0].marks.find(m=>m.native_tag==='u').id);
});

test('hidden and inert reconstructed formatting scopes follow the full parsed DOM visibility',()=>{
  const raw='<p hidden><u>A</p>B</u><script><u>C</u></script><p><u>D</u></p>',trace=traceNativeDecoration(raw);assert.deepEqual(trace.runs.map(r=>r.decoded_text),['B','D']);assert.deepEqual(trace.unresolved,[]);assert.equal(trace.sources.length,2);assert.equal(trace.sources[0].dom_scopes.length,1);assert.equal(trace.sources[0].dom_scopes[0].raw_interval_verified,false);assert.equal(trace.sources[0].element,null);assert.ok(trace.sources.every(s=>s.native_tag==='u'));
});

test('identical native-path whitespace has explicit exact joint attribution without per-run character ownership',()=>{
  const raw='<u> <span>\t</span></u>',trace=traceNativeDecoration(raw),normalizedText=' ',segment={normalized_start:0,normalized_end:1,sources:trace.runs.map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization:'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'};
  assert.equal(trace.runs.length,2);assert.equal(trace.runs[0].path_id,trace.runs[1].path_id);const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[segment],tracerSourceSHA256});assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.equal(envelope.segments[0].sources.length,2);assert.deepEqual(envelope.segments[0].joint_source_attribution,{policy:'IDENTICAL_NATIVE_PATH_WHITESPACE_COLLAPSE_V1',path_id:trace.runs[0].path_id,per_run_character_attribution:false});
  const view=createNativeDecorationView(envelope,{raw,normalizedText}),p=view.projectRelevant({start:0,end:1});assert.equal(p.annotations[0].origins.length,2);assert.ok(p.annotations[0].origins.every(o=>o.clipping_mapping==='WHOLE_COLLECTOR_ORIGIN'));assert.equal(p.annotations[0].joint_source_attributions[0].per_run_character_attribution,false);assert.ok(view.input({start:0,end:1}).text.includes('NATIVE_SOURCE_MARKS_UNVERIFIED'));
  const nullRaw='<span> </span><span>\t</span>',nullTrace=traceNativeDecoration(nullRaw),nullSegment={...segment,sources:nullTrace.runs.map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length}))},nullEnvelope=bindNativeDecoration(nullTrace,{raw:nullRaw,normalizedText,collectorSegments:[nullSegment],tracerSourceSHA256});assert.equal(nullEnvelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.equal(nullEnvelope.segments[0].joint_source_attribution.path_id,null);
});

test('different recovered DOM paths retain per-origin scope witnesses instead of exact output attribution',()=>{
  const raw='<p><u> </p>\t</u>',trace=traceNativeDecoration(raw),segment={normalized_start:0,normalized_end:1,sources:trace.runs.map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization:'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'};assert.equal(trace.sources.length,1);assert.notEqual(trace.runs[0].path_id,trace.runs[1].path_id);const envelope=bindNativeDecoration(trace,{raw,normalizedText:' ',collectorSegments:[segment],tracerSourceSHA256});assert.equal(envelope.segments[0].mapping,'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE');assert.equal(envelope.segments[0].joint_source_attribution.per_run_character_attribution,false);const witness=projectNativeDecoration(envelope,{raw,normalizedText:' '}).annotations[0].joint_whitespace_witness;assert.deepEqual(witness.origins.map(o=>o.marks[0].dom_scopes.map(s=>s.raw_interval_verified)),[[true],[false]]);assert.equal(nativeDecorationInput(envelope,{raw,normalizedText:' '}).joint_whitespace_witnesses,1);
});

test('filtered whitespace keeps every internal zero/control origin in order with finite decoded event evidence',()=>{
  const raw='<u> <span>\u200b</span>\t<span>\u0007</span> </u>',trace=traceNativeDecoration(raw),normalizedText=' ',segment={normalized_start:0,normalized_end:1,sources:trace.runs.map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization:'EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1'},envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[segment],tracerSourceSHA256});
  assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.deepEqual(envelope.segments[0].sources.map(p=>p.run_id),trace.runs.map(r=>r.id));assert.deepEqual(envelope.segments[0].filtered_source_events.map(e=>e.category),['ZERO_WIDTH_FILTER','CONTROL_FILTER']);assert.equal(envelope.segments[0].joint_source_attribution.per_run_character_attribution,false);
  const view=createNativeDecorationView(envelope,{raw,normalizedText}),annotation=view.projectRelevant().annotations[0];assert.equal(annotation.origins.length,trace.runs.length);assert.ok(annotation.filtered_source_events.every(e=>e.normalized_group.start===0&&e.normalized_group.end===1));assert.ok(annotation.origins.every(o=>o.clipping_mapping==='WHOLE_COLLECTOR_ORIGIN'));assert.equal(view.input().encoded_annotation_groups,1);
});

test('filtered zero marks with different ancestry do not become claimed decoration on the collapsed space',()=>{
  const raw='<u> </u><s>\u200b</s><u>\t</u>',trace=traceNativeDecoration(raw),segment={normalized_start:0,normalized_end:1,sources:trace.runs.map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization:'EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1'},envelope=bindNativeDecoration(trace,{raw,normalizedText:' ',collectorSegments:[segment],tracerSourceSHA256});assert.equal(envelope.segments[0].mapping,'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE');assert.equal(envelope.segments[0].sources.length,3);assert.equal(envelope.segments[0].filtered_source_events.length,1);assert.equal(envelope.segments[0].joint_source_attribution.native_mark_attribution_verified,false);const p=projectNativeDecoration(envelope,{raw,normalizedText:' '}),w=p.annotations[0].joint_whitespace_witness;assert.deepEqual(p.annotations[0].marks,[]);assert.deepEqual(w.origins.map(o=>o.marks[0].native_tag),['u','s','u']);assert.equal(w.origins[1].filtered_source_events[0].category,'ZERO_WIDTH_FILTER');assert.deepEqual(w.origins[1].decoded_codepoints_rle,[{codepoint:'U+200B',count:1}]);assert.equal(nativeDecorationInput(envelope,{raw,normalizedText:' '}).joint_whitespace_witnesses,1);
});

test('filtered whitespace profile rejects letters, non-frozen controls, empty filtered output and absent filter events',()=>{
  for(const [value,code] of [[' \u200bx ','NATIVE_DECORATION_WHITESPACE_REQUIRED'],['\u200b','NATIVE_DECORATION_WHITESPACE_REQUIRED'],[' \u2060 ','NATIVE_DECORATION_WHITESPACE_REQUIRED'],[' \t ','NATIVE_DECORATION_FILTER_EVENT_REQUIRED']]){const raw='<u>'+value+'</u>',trace=traceNativeDecoration(raw);assert.throws(()=>bindNativeDecoration(trace,{raw,normalizedText:' ',collectorSegments:[origin(trace.runs[0],0,1,0,trace.runs[0].decoded_text.length,'EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1')],tracerSourceSHA256}),error=>error.code===code);}
});

test('visible body-depth cutoff preserves the last emitted text plus HTML/BODY ancestor styles',()=>{
  const raw='<html style="font-weight:normal"><body style="font-size:10pt">'+'<span style="font-weight:normal">'.repeat(254)+'<u>A</u>'+'</span>'.repeat(254)+'</body></html>',trace=traceNativeDecoration(raw,{visibilityProfile:'COLLECTOR_BODY_RELATIVE_VISIBLE_DEPTH_V1'});assert.deepEqual(trace.runs.map(r=>r.decoded_text),['A']);assert.deepEqual(trace.unresolved,[]);assert.equal(trace.depth_profile.root,'PARSED_BODY');assert.equal(trace.depth_profile.max_visible_depth,256);assert.equal(trace.sources.length,257);
  const envelope=bindNativeDecoration(trace,{raw,normalizedText:'A',collectorSegments:[origin(trace.runs[0],0,1)],tracerSourceSHA256}),view=createNativeDecorationView(envelope,{raw,normalizedText:'A'});assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.equal(view.project().annotations[0].marks.length,257);assert.equal(view.projectRelevant().annotations[0].marks.length,1);
});

test('deeper visible frontier keeps an available partial trace and explicit unresolved source evidence',()=>{
  const raw='<p><u>A</u></p>'+'<div>'.repeat(256)+'<u>B</u>'+'</div>'.repeat(256),trace=traceNativeDecoration(raw,{visibilityProfile:'COLLECTOR_BODY_RELATIVE_VISIBLE_DEPTH_V1'});assert.equal(trace.trace_status,'AVAILABLE_SOURCE_NATIVE_TRACE');assert.deepEqual(trace.runs.map(r=>r.decoded_text),['A']);assert.equal(trace.unresolved.length,1);assert.equal(trace.unresolved[0].kind,'COLLECTOR_DEPTH_SCOPE_UNTRACED');assert.equal(trace.unresolved[0].body_relative_depth,257);assert.equal(raw.slice(trace.unresolved[0].raw.start,trace.unresolved[0].raw.end),'<u>');assert.equal(trace.unresolved[0].parser_reported_scope.raw_interval_verified,false);
  const envelope=bindNativeDecoration(trace,{raw,normalizedText:'A',collectorSegments:[origin(trace.runs[0],0,1)],tracerSourceSHA256}),view=createNativeDecorationView(envelope,{raw,normalizedText:'A'});assert.equal(envelope.mapping_status,'UNRESOLVED_COLLECTOR_OR_NATIVE_STYLE_MAPPING');assert.equal(view.projectRelevant().annotations[0].text,'A');assert.throws(()=>view.input(),error=>error.code==='NATIVE_DECORATION_UNRESOLVED_MAPPING');assert.equal(trace.raw.characters,raw.length);
});

test('hidden/inert source at the visible depth frontier cannot create annotations or unresolved visible scope',()=>{
  const raw='<p><u>A</u></p>'+'<div>'.repeat(256)+'<span hidden><u>B</u></span><script><u>C</u></script>'+'</div>'.repeat(256),trace=traceNativeDecoration(raw);assert.deepEqual(trace.runs.map(r=>r.decoded_text),['A']);assert.deepEqual(trace.unresolved,[]);assert.equal(trace.sources.length,1);
});

test('repeated reconstructed scopes keep reported coordinates without hashing growing unverified intervals',()=>{
  const raw='<p><u>A</p>'+'<p>B</p>'.repeat(1000)+'</u>',normalizedText='A'+'B'.repeat(1000),{trace,envelope}=boundJoinedRuns(raw);assert.deepEqual(trace.unresolved,[]);assert.equal(trace.sources.length,1);assert.equal(trace.sources[0].dom_scopes.length,1001);assert.ok(trace.sources[0].dom_scopes.filter(s=>s.parser_reported_location).every(s=>s.parser_reported_location.raw_interval_verified===false&&!Object.hasOwn(s.parser_reported_location,'sha256')));
  const view=createNativeDecorationView(envelope,{raw,normalizedText}),projection=view.projectRelevant({start:1000,end:1001});assert.equal(projection.annotations[0].marks[0].dom_scopes.length,1);assert.ok(JSON.stringify(projection).length<5000);assert.equal(projection.annotations[0].text,'B');
});

test('filtered-event metadata consumes the explicit projection origin budget without dropping evidence',()=>{
  const value=' '+('\u200b\u0007'.repeat(100))+' ',raw='<u>'+value+'</u>',trace=traceNativeDecoration(raw),envelope=bindNativeDecoration(trace,{raw,normalizedText:' ',collectorSegments:[origin(trace.runs[0],0,1,0,trace.runs[0].decoded_text.length,'EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1')],tracerSourceSHA256}),view=createNativeDecorationView(envelope,{raw,normalizedText:' '});assert.equal(envelope.segments[0].filtered_source_events.length,200);assert.equal(view.projectRelevant({maxOrigins:256}).annotations[0].filtered_source_events.length,200);assert.throws(()=>view.projectRelevant({maxOrigins:64}),error=>error.code==='NATIVE_DECORATION_PROJECTION_BOUND');assert.equal(envelope.segments[0].filtered_source_events.length,200);
});

// V4 permits complete joint whitespace witnesses, not arbitrary attribution.
function jointWhitespace(raw,normalization='EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1') {const trace=traceNativeDecoration(raw),segment={normalized_start:0,normalized_end:1,sources:trace.runs.map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization};return {trace,segment,envelope:bindNativeDecoration(trace,{raw,normalizedText:' ',collectorSegments:[segment],tracerSourceSHA256})};}

test('joint whitespace witnesses are self-contained on every actual overlapping source window',()=>{
  const raw='<span>A</span><u> </u><s>\t</s><span>B</span>',trace=traceNativeDecoration(raw),normalizedText='A B',segment={normalized_start:1,normalized_end:2,sources:trace.runs.slice(1,3).map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization:'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'},envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(trace.runs[0],0,1),segment,origin(trace.runs[3],2,3)],tracerSourceSHA256}),view=createNativeDecorationView(envelope,{raw,normalizedText});
  for(const [start,end] of [[0,2],[1,3],[0,3]]){const input=view.input({start,end});assert.equal(input.joint_whitespace_witnesses,1);assert.equal(input.input_eligibility,'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE');assert.ok(input.text.includes('U+0020'));assert.ok(input.text.includes('U+0009'));assert.match(input.text,/\[\/JOINT_NORMALIZATION_UNVERIFIED\]\n /u);assert.ok(!input.text.includes('[NATIVE_SOURCE_MARKS_UNVERIFIED'));}
  assert.equal(view.input({start:0,end:1}).joint_whitespace_witnesses,0);assert.equal(view.input({start:2,end:3}).joint_whitespace_witnesses,0);assert.equal(view.projectRelevant({start:1,end:2}).annotations[0].joint_whitespace_witness.normalized_output.mark_attribution,'UNVERIFIED_NO_SOURCE_ORIGIN_SELECTED');
});

test('per-origin RLE preserves long whitespace codepoints losslessly and caps irreducible witnesses',()=>{
  const raw='<u>'+' '.repeat(100000)+'</u><s>&nbsp;&nbsp;&nbsp;</s>',{envelope}=jointWhitespace(raw),view=createNativeDecorationView(envelope,{raw,normalizedText:' '}),w=view.projectRelevant({maxOrigins:64}).annotations[0].joint_whitespace_witness;assert.deepEqual(w.origins.map(o=>o.decoded_codepoints_rle),[[{codepoint:'U+0020',count:100000}],[{codepoint:'U+00A0',count:3}]]);assert.ok(view.input({maxOrigins:64}).text.length<2000);
  const alternating='<u>'+(' \t'.repeat(100))+'</u><s> </s>',a=jointWhitespace(alternating),prepared=createNativeDecorationView(a.envelope,{raw:alternating,normalizedText:' '});assert.throws(()=>prepared.input({maxOrigins:64}),error=>error.code==='NATIVE_DECORATION_PROJECTION_BOUND');assert.equal(a.envelope.segments[0].sources.length,2);assert.equal(prepared.projectRelevant().annotations[0].joint_whitespace_witness.origins[0].decoded_codepoints_rle.length,200);
});

test('neutral-style-only different paths still emit a joint witness while all styles remain inspectable',()=>{
  const raw='<span style="font-size:9pt"> </span><span style="font-weight:bold">\t</span>',{envelope}=jointWhitespace(raw),view=createNativeDecorationView(envelope,{raw,normalizedText:' '}),relevant=view.projectRelevant().annotations[0],all=view.project().annotations[0];assert.equal(relevant.joint_whitespace_witness.origins.length,2);assert.ok(relevant.joint_whitespace_witness.origins.every(o=>o.marks.length===0));assert.ok(all.joint_whitespace_witness.origins.every(o=>o.marks[0].style_attribute.decoded_value.length>0));assert.equal(view.input().joint_whitespace_witnesses,1);assert.equal(view.input().nondecoration_style_sources_retained_in_trace,2);
});

test('joint whitespace eligibility cannot bypass source gaps, collector issues, missing identities or stylesheets',()=>{
  for(const prefix of ['<p>missing</p>','<style>u{text-decoration:none}</style>','']){const raw=prefix+'<u> </u><s>\t</s>',trace=traceNativeDecoration(raw),last=trace.runs.slice(-2),segment={normalized_start:0,normalized_end:1,sources:last.map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization:'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'},options={raw,normalizedText:' ',collectorSegments:[segment],tracerSourceSHA256,...(!prefix?{collectorIssues:['SOURCE_ORIGIN_PENDING']}: {})},envelope=bindNativeDecoration(trace,options);assert.equal(envelope.input_eligibility,'BLOCKED_UNRESOLVED_SOURCE_EVIDENCE');assert.throws(()=>nativeDecorationInput(envelope,{raw,normalizedText:' ',maxOrigins:1}),error=>error.code==='NATIVE_DECORATION_UNRESOLVED_MAPPING');}
  const raw='<u> </u><s>\t</s>',{trace,segment}=jointWhitespace(raw),unbound=actualBindNativeDecoration(trace,{raw,normalizedText:' ',collectorSegments:[segment]});assert.equal(unbound.input_eligibility,'BLOCKED_UNRESOLVED_SOURCE_EVIDENCE');assert.equal(verifyNativeDecorationEnvelope(unbound,{raw,normalizedText:' '}).input_eligibility,'BLOCKED_UNRESOLVED_SOURCE_EVIDENCE');
});

test('joint whitespace elsewhere does not turn material native value spans into joint or clean values',()=>{
  const raw='<strike>2.50</strike><u>1.25</u><u> </u><s>\t</s>',trace=traceNativeDecoration(raw),normalizedText='2.501.25 ',joint={normalized_start:8,normalized_end:9,sources:trace.runs.slice(2).map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization:'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'},envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[origin(trace.runs[0],0,4),origin(trace.runs[1],4,8),joint],tracerSourceSHA256}),view=createNativeDecorationView(envelope,{raw,normalizedText});assert.equal(envelope.mapping_status,'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE');const local=view.projectRelevant({start:0,end:8});assert.ok(local.annotations.every(a=>a.mapping==='EXACT_COLLECTOR_ORIGIN'));assert.deepEqual(local.annotations.map(a=>[a.text,a.marks[0].native_tag]),[['2.50','strike'],['1.25','u']]);assert.equal(view.input({start:0,end:8}).joint_whitespace_witnesses,0);assert.ok(!view.input({start:0,end:9}).text.includes('2.501.25'));
});

test('complete visible profile retains depth701 text and late native table/PRE descendants',()=>{
  const raw='<html><body>'+'<div>'.repeat(700)+'<pre><u>A&amp;B</u></pre><table><tr><td><strike>C</strike></td></tr></table>'+'</div>'.repeat(700)+'</body></html>',trace=traceNativeDecoration(raw);assert.equal(trace.depth_profile.policy,'COMPLETE_VISIBLE_DOM_V1');assert.equal(trace.depth_profile.max_visible_depth,null);assert.deepEqual(trace.runs.map(r=>r.decoded_text),['A&B','C']);assert.deepEqual(trace.sources.map(s=>s.native_tag),['u','strike']);assert.deepEqual(trace.unresolved,[]);assert.ok(trace.resource_profile.document_nodes>700);assert.equal(trace.resource_profile.decoded_characters,4);
  const envelope=bindNativeDecoration(trace,{raw,normalizedText:'A&BC',collectorSegments:[origin(trace.runs[0],0,3),origin(trace.runs[1],3,4)],tracerSourceSHA256});assert.equal(envelope.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.equal(createNativeDecorationView(envelope,{raw,normalizedText:'A&BC'}).projectRelevant().annotations.length,2);
});

test('deep native scopes bind exact artifact intervals without quadratic ancestor content hashing',()=>{
  const raw='<u>'.repeat(700)+'X'+'</u>'.repeat(700),trace=traceNativeDecoration(raw);assert.deepEqual(trace.unresolved,[]);assert.equal(trace.sources.length,700);assert.equal(trace.depth_profile.max_native_ancestor_sources,700);assert.ok(trace.sources.every(s=>s.element.binding==='WHOLE_RAW_SHA256_AND_EXACT_UTF16_INTERVAL_V1'&&s.element.raw_sha256===trace.raw.sha256&&!Object.hasOwn(s.element,'sha256')&&s.element_scope.raw_interval_verified));assert.ok(trace.resource_profile.charged_work_units<raw.length*32);
  const envelope=bindNativeDecoration(trace,{raw,normalizedText:'X',collectorSegments:[origin(trace.runs[0],0,1)],tracerSourceSHA256}),view=createNativeDecorationView(envelope,{raw,normalizedText:'X'});assert.equal(view.projectRelevant().annotations[0].marks.length,700);assert.throws(()=>view.projectRelevant({maxOrigins:64}),error=>error.code==='NATIVE_DECORATION_PROJECTION_BOUND');
});

test('complete trace enforces full DOM node, decoded output, work and RSS budgets without partial success',()=>{
  const raw='<u>AB</u>';assert.throws(()=>traceNativeDecoration(raw,{maxDecodedCharacters:1}),error=>error.code==='NATIVE_DECORATION_DECODED_OUTPUT_BOUND');assert.throws(()=>traceNativeDecoration(raw,{maxWorkUnits:1}),error=>error.code==='NATIVE_DECORATION_WORK_BOUND');assert.throws(()=>traceNativeDecoration(raw,{maxMemoryBytes:1}),error=>error.code==='NATIVE_DECORATION_MEMORY_BOUND');assert.throws(()=>traceNativeDecoration('<div hidden>'+'<span>'.repeat(100)+'</span>'.repeat(100)+'</div>',{maxNodes:20}),error=>error.code==='NATIVE_DECORATION_NODE_BOUND');
  assert.deepEqual(traceNativeDecoration('<div hidden>'+'<u>'.repeat(700)+'hidden'+'</u>'.repeat(700)+'</div><u>shown</u>').runs.map(r=>r.decoded_text),['shown']);
});

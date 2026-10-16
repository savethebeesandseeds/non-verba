// SPDX-License-Identifier: AGPL-3.0-only
// Every source string is DECLARED_SYNTHETIC. No factual-answer evaluation.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {traceNativeDecoration as upstreamTrace} from './upstream/source-decoration.original.mjs';
import {traceNativeDecoration,createNativeDecorationView} from './source-decoration.prototype.mjs';
import {bindSynthetic,origin,jointWhitespaceFixture,zeroFixture,governingFixture,sha} from './source-fixtures.mjs';
import {TAGS,CSS,JOINT,ZERO,LAYOUT,featureAtom,decodeModelText,deriveFiniteNine,digest,policy as codecPolicy} from './finite-codec.mjs';
import {prospectiveForms,ARMS} from './parent-stream.mjs';
import {preparePrototypeWindows,DEFAULT_BUDGET} from './window-planner.mjs';
import {immutableCopy} from './immutable-state.mjs';
const forms=fixture=>prospectiveForms({fixture,parent:{id:'SYNTHETIC_PARENT',start:0,end:fixture.normalizedText.length},unit:{id:'SYNTHETIC_UNIT',start:0,end:fixture.normalizedText.length}});
const declaredSyntheticCounter={policy_sha256:'f'.repeat(64),tokenCount:text=>Array.from(text).length+2};

test('both isolated forks reproduce exactly from retained upstream bytes and explicit patches',()=>{
  const patches=JSON.parse(readFileSync(new URL('./fork-patches.json',import.meta.url)));
  for(const [key,file] of [['native','source-decoration.prototype.mjs'],['codec','finite-codec.mjs']]){
    let text=readFileSync(new URL('./'+patches[key].upstream,import.meta.url),'utf8');assert.equal(sha(text),patches[key].sha256);
    for(const patch of patches[key].patches){assert.equal(text.split(patch.old).length,2);text=text.replace(patch.old,patch.new);}
    assert.equal(readFileSync(new URL('./'+file,import.meta.url),'utf8'),text);
  }
});
test('bare nine tags remain distinct exact original native evidence with no effect claims',()=>{
  for(const tag of TAGS){const fixture=bindSynthetic(`<p><${tag}>same</${tag}></p>`);assert.deepEqual(fixture.trace.sources.map(s=>s.native_tag),[tag]);assert.equal(fixture.envelope.input_eligibility,'EXACT_SOURCE_EVIDENCE');assert.equal(fixture.normalizedText,'same');assert.equal(fixture.trace.effectiveness_verified,false);assert.equal(fixture.trace.computed_style_verified,false);assert.match(forms(fixture).unit.encodeWindow().text,new RegExp('\\[NF '+tag+'\\]'));}
});
test('unchanged upstream loses bare emphasis while the isolated fork preserves identical literal text',()=>{
  const raw='<b>B</b><strong>S</strong><i>I</i><em>E</em>';
  assert.equal(upstreamTrace(raw).sources.length,0);const f=bindSynthetic(raw);assert.equal(f.normalizedText,'BSIE');assert.deepEqual(f.trace.sources.map(s=>s.native_tag),['b','strong','i','em']);
});
test('literal CSS weight style and shorthand retain exact values and unknown effects',()=>{
  for(const style of ['font-weight:700 !important','font-style:oblique 12deg','font:italic 700 12px Fictional']){
    const f=bindSynthetic(`<span style="${style}">word</span>`),s=f.trace.sources[0];assert.equal(s.style_attribute.decoded_value,style);assert.equal(f.raw.slice(s.style_attribute.start,s.style_attribute.end).includes(style),true);assert.equal(s.input_relevance,'LITERAL_EMPHASIS_DECLARATION_EFFECT_UNVERIFIED');assert.equal(f.trace.computed_style_verified,false);
    const encoded=forms(f).unit.encodeWindow().text;assert.match(encoded,/CSS_UNKNOWN/);assert.equal(encoded.includes(style),false);assert.equal(decodeModelText(encoded),'word');
  }
});
test('CSS emphasis is never translated to native b strong i em',()=>{
  const f=bindSynthetic('<span style="font-weight:bold;font-style:italic">Q</span>'),input=forms(f).unit;
  assert.equal(input.features.spans[0].mask,CSS);assert.equal(f.trace.sources[0].native_tag,null);assert.equal(input.binding.status,'INFORMATION_REDUCED_NOT_LOSSLESS_MODEL_INPUT');
});
test('nested ancestors preserve all nine distinct literal marks while finite sets disclose order loss',()=>{
  const raw=TAGS.map(t=>`<${t}>`).join('')+'Q'+[...TAGS].reverse().map(t=>`</${t}>`).join(''),f=bindSynthetic(raw);
  const p=createNativeDecorationView(f.envelope,{raw:f.raw,normalizedText:f.normalizedText}).projectRelevant();
  assert.deepEqual(new Set(p.annotations[0].marks.map(m=>m.native_tag)),new Set(TAGS));assert.equal(forms(f).unit.features.spans[0].mask,511);
  const duplicate=bindSynthetic('<b><b>Q</b></b>');assert.equal(duplicate.trace.sources.length,2);assert.equal(forms(duplicate).unit.features.spans[0].mask,32);
});
test('recovered formatting keeps original literal token identity and disclosed reconstructed scope',()=>{
  const f=bindSynthetic('<p><b>A<i>B</b>C</i>D</p>');assert.equal(f.normalizedText,'ABCD');assert.equal(f.trace.unresolved.length,0);
  const italic=f.trace.sources.find(s=>s.native_tag==='i');assert.ok(italic.dom_scopes?.length>=2);assert.equal(italic.start_tag_role,'SHARED_ORIGINAL_FORMATTING_SOURCE_TOKEN');assert.equal(italic.element_scope.raw_interval_verified,false);assert.equal(f.raw.slice(italic.start_tag.start,italic.start_tag.end),'<i>');assert.equal(decodeModelText(forms(f).unit.encodeWindow().text),'ABCD');
});
test('head scripts comments hidden style and inert content cannot become bold/italic evidence',()=>{
  const raw='<script><b>BAD</b></script><!-- <i>BAD</i> --><p hidden><strong>BAD</strong></p><em style="display:none">BAD</em><template><b>BAD</b></template><p><b>VISIBLE</b></p>',f=bindSynthetic(raw);
  assert.equal(f.normalizedText,'VISIBLE');assert.deepEqual(f.trace.sources.map(s=>s.native_tag),['b']);
});
test('Black color wrapper never suppresses a nested bare bold caption',()=>{
  const f=bindSynthetic('<table><caption><font color="Black"><b>FICTIONAL CAPTION</b></font></caption><tr><td><strong>ITEM</strong></td></tr></table>');
  assert.ok(f.trace.sources.some(s=>s.native_tag==='b'));assert.equal(decodeModelText(forms(f).parent.encodeWindow().text),'FICTIONAL CAPTIONITEM');assert.equal(f.envelope.input_eligibility,'EXACT_SOURCE_EVIDENCE');
});
test('duplicate literal text maps to distinct marked and unmarked raw runs',()=>{
  const f=bindSynthetic('<p>same</p><p><b>same</b></p>');assert.equal(f.trace.runs.length,2);assert.notEqual(f.trace.runs[0].raw.start,f.trace.runs[1].raw.start);const spans=forms(f).unit.features.spans;assert.deepEqual(spans.map(x=>x.mask),[0,32]);
});
test('escaped marker-shaped source text and slash syntax roundtrip exactly',()=>{
  const literal='[NF b] fictional \\ [/NF] 😀 [',f=bindSynthetic(`<b>${literal}</b>`),encoded=forms(f).unit.encodeWindow().text;assert.equal(decodeModelText(encoded),literal);assert.match(encoded,/\\\[/);assert.throws(()=>decodeModelText('[NF bogus]Q[/NF]'));assert.throws(()=>decodeModelText('[NF b][NF i]Q[/NF][/NF]'));assert.throws(()=>decodeModelText('[literal]'));
});
test('all legal tag/unknown/zero masks roundtrip; joint cannot claim a native tag',()=>{
  for(let mask=0;mask<4096;mask++){const valid=!(mask&JOINT)||!(mask&511);if(valid)assert.equal(decodeModelText(featureAtom('😀',mask)),'😀');else assert.throws(()=>featureAtom('Q',mask));}
  assert.equal(decodeModelText(featureAtom(' | ',LAYOUT)),' | ');assert.throws(()=>featureAtom('Q',LAYOUT));assert.throws(()=>featureAtom('Q',LAYOUT|32));
});
test('different-ancestry joint space retains every rich origin and assigns no native output tag',()=>{
  const f=jointWhitespaceFixture(),input=forms(f).unit;assert.equal(f.envelope.input_eligibility,'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE');assert.equal(f.envelope.segments[1].sources.length,2);assert.equal(input.features.spans.find(s=>s.start===1).mask,JOINT);assert.equal(decodeModelText(input.encodeWindow().text),'X Y');
});
test('zero events at start intermediate and terminal boundaries have exact window ownership',()=>{
  const f=zeroFixture(),input=forms(f).unit;assert.deepEqual(input.features.zero_events.map(x=>x.position),[0,1,2]);
  const a=input.encodeWindow({start:0,end:1}),b=input.encodeWindow({start:1,end:2,includeEndZeroWidth:true});assert.deepEqual(a.zero_events.map(x=>x.position),[0]);assert.deepEqual(b.zero_events.map(x=>x.position),[1,2]);assert.equal(decodeModelText(a.text)+decodeModelText(b.text),'AB');assert.throws(()=>input.encodeWindow({start:0,end:1,includeEndZeroWidth:true}));
});
test('single-run NFC and emoji preserve declared output with no split-surrogate windows',()=>{
  const f=bindSynthetic('<em>e\u0301😀</em>',{id:'SYNTHETIC_NFC',normalizedText:'é😀',segments:t=>[origin(t.runs[0],0,3,0,t.runs[0].decoded_text.length,'EXTRACTOR_NFC_FILTER_WHITESPACE_V1')]}),input=forms(f).unit;
  assert.equal(decodeModelText(input.encodeWindow().text),'é😀');assert.throws(()=>input.encodeWindow({start:0,end:2}));
});
test('cross-run NFC remains blocked rather than being made finite-input eligible',()=>{
  const f=bindSynthetic('<b>e</b><i>\u0301</i>',{id:'SYNTHETIC_NFC_AMBIGUOUS',normalizedText:'é',segments:t=>[{normalized_start:0,normalized_end:1,sources:t.runs.map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization:'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'}]});
  assert.equal(f.envelope.input_eligibility,'BLOCKED_UNRESOLVED_SOURCE_EVIDENCE');assert.throws(()=>forms(f),/Unresolved source/);
});
test('uncomputed stylesheet cascade remains a retained blocker',()=>{
  const f=bindSynthetic('<style>b{font-weight:normal}</style><p><b>Q</b></p>');assert.equal(f.envelope.input_eligibility,'BLOCKED_UNRESOLVED_SOURCE_EVIDENCE');assert.throws(()=>forms(f));
});
test('full-parent descriptor includes far preceding prohibition and later exception; unit is ablation',()=>{
  const g=governingFixture(),f=prospectiveForms(g),body=decodeModelText(f.unit.encodeWindow().text),context=decodeModelText(f.parent.encodeWindow().text);
  assert.equal(body,g.availability.focal);assert.equal(body.includes(g.availability.governor),false);assert.ok(context.includes(g.availability.governor));assert.ok(context.includes(g.availability.exception));assert.ok(g.fixture.normalizedText.slice(0,g.unit.start).split(/\s+/u).length>60);
  assert.equal(f.descriptor.dependency_completeness_verified,false);assert.equal(f.descriptor.semantic_completeness_verified,false);assert.equal(f.descriptor.navigation_prefix,false);assert.equal(f.descriptor.word_cap,null);assert.equal(ARMS.length,4);
});
test('fixed facts stay identical when only one literal emphasis tag changes',()=>{
  const a=governingFixture({emphasis:'b'}),b=governingFixture({emphasis:'strong'});assert.equal(a.fixture.normalizedText,b.fixture.normalizedText);assert.deepEqual(a.availability,b.availability);const x=prospectiveForms(a),y=prospectiveForms(b);assert.notEqual(x.parent.encodeWindow().text,y.parent.encodeWindow().text);assert.equal(decodeModelText(x.parent.encodeWindow().text),decodeModelText(y.parent.encodeWindow().text));
});
test('supplied-parent coverage never asserts an outside governor is included or hierarchy complete',()=>{
  const g=governingFixture(),shortParent={id:'SYNTHETIC_SHORT_PARENT',start:g.unit.start,end:g.fixture.normalizedText.length},f=prospectiveForms({...g,parent:shortParent});assert.equal(f.parent.encodeWindow().text.includes(g.availability.governor),false);assert.equal(f.descriptor.dependency_completeness_verified,false);
});
test('same-parent different focal units disclose duplicate parent input rather than inventing focus text',()=>{
  const g=governingFixture(),a=prospectiveForms(g),b=prospectiveForms({...g,unit:{id:'SYNTHETIC_ANOTHER_UNIT',start:0,end:20}});assert.equal(a.parent.encodeWindow().text,b.parent.encodeWindow().text);assert.notEqual(digest(a.descriptor),digest(b.descriptor));assert.equal(a.descriptor.pooling_performed,false);
});
test('parent/unit identity and codepoint/source boundaries reject invalid construction',()=>{
  const f=bindSynthetic('<b>😀Q</b>');assert.throws(()=>prospectiveForms({fixture:f,parent:{id:'SYNTHETIC_P',start:0,end:3},unit:{id:'SYNTHETIC_U',start:1,end:3}}),/codepoint/);assert.throws(()=>prospectiveForms({fixture:{...f,source_kind:'CORPUS'},parent:{id:'SYNTHETIC_P',start:0,end:3},unit:{id:'SYNTHETIC_U',start:0,end:3}}));
});
test('bounded word/codepoint planner preserves literal coverage and zero events with a declared synthetic counter',()=>{
  const input=forms(zeroFixture()).unit,result=preparePrototypeWindows(input,declaredSyntheticCounter,{maxTokens:128});assert.ok(result.windows.every(w=>w.tokens<=128));assert.equal(result.source_literal_coverage,true);assert.equal(result.overlap,0);assert.equal(result.inference,false);
  const long=forms(bindSynthetic('<i>'+('abc_'.repeat(180))+'😀中</i>')).unit,r=preparePrototypeWindows(long,declaredSyntheticCounter,{maxTokens:128});assert.equal(r.fallback_used,true);assert.equal(r.windows.map(w=>decodeModelText(w.text)).join(''),long.normalizedText);
});
test('irreducible token overflow is retained explicitly, never plain fallback or partial success',()=>{
  const input=forms(bindSynthetic('<b>Q</b>')).unit;assert.throws(()=>preparePrototypeWindows(input,{policy_sha256:'f'.repeat(64),tokenCount:()=>1000}),e=>e.code==='PROTOTYPE_MINIMUM_CODEPOINT_ENCODING_OVERFLOW'&&e.retained_failure&&e.partial_stream_accepted===false);
});
test('tokenizer work exhaustion rejects the entire stream with bounded diagnostics',()=>{
  const input=forms(bindSynthetic('<i>'+('fictional words '.repeat(1000))+'</i>')).parent;assert.throws(()=>preparePrototypeWindows(input,declaredSyntheticCounter,{maxTokenizerCalls:2}),e=>e.code==='PROTOTYPE_TOKENIZER_WORK_BOUND'&&e.work.tokenizer_calls===2&&e.partial_stream_accepted===false);
});
test('long literal CSS remains rich evidence while reduced stream explicitly omits the value',()=>{
  const style='font-weight:700;'+('font-family:Fictional;'.repeat(1000)),f=bindSynthetic(`<span style="${style}">Q</span>`),input=forms(f).unit;assert.equal(f.trace.sources[0].style_attribute.decoded_value,style);assert.ok(input.encodeWindow().text.length<100);assert.match(input.encodeWindow().text,/CSS_UNKNOWN/);assert.equal(decodeModelText(input.encodeWindow().text),'Q');
});
test('1.1-million-character synthetic parent is fully represented but bounded planning can fail explicitly',()=>{
  const total=1107802,prefix='DECLARED SYNTHETIC: a preceding condition remains source evidence. ',focal='A fictional focal record near the end.',filler='neutral fictional fact. ',fill=filler.repeat(Math.ceil((total-prefix.length-focal.length)/filler.length)).slice(0,total-prefix.length-focal.length),fixture=bindSynthetic(`<p><b>${prefix}</b>${fill}<i>${focal}</i></p>`,{id:'SYNTHETIC_LONG_PARENT_1107802'}),f=prospectiveForms({fixture,parent:{id:'SYNTHETIC_LARGE_PARENT',start:0,end:total},unit:{id:'SYNTHETIC_LATE_UNIT',start:total-focal.length,end:total}});
  assert.equal(fixture.normalizedText.length,total);assert.equal(f.parent.binding.source_range.end,total);assert.equal(f.descriptor.dependency_completeness_verified,false);assert.throws(()=>preparePrototypeWindows(f.parent,declaredSyntheticCounter,{maxTokenizerCalls:32}),e=>e.code==='PROTOTYPE_TOKENIZER_WORK_BOUND'&&e.partial_stream_accepted===false);
});

test('P1 public span masks and coordinates cannot mutate later encoding or feature identities',()=>{
  const input=forms(bindSynthetic('<b>A</b><i>B</i>')).unit,before=input.encodeWindow({includeEndZeroWidth:true}),identity=digest(input.binding),feature=digest(input.features);
  for(const mutate of [()=>{input.features.spans[0].mask=0;},()=>{input.features.spans[0].start=1;},()=>{input.features.spans[0].end=0;},()=>{input.features.spans.push({start:0,end:2,mask:0});},()=>{input.features.spans=[];},()=>{input.features={};},()=>{input.externalSegments[0].start=1;},()=>{input.externalSegments[0].mapping='CHANGED';},()=>{input.externalSegments.pop();}]){
    assert.throws(mutate,TypeError);assert.deepEqual(input.encodeWindow({includeEndZeroWidth:true}),before);assert.equal(digest(input.binding),identity);assert.equal(digest(input.features),feature);
  }
});
test('P1 zero/gap arrays and nested external gap records are recursively immutable',()=>{
  const zero=forms(zeroFixture()).unit,zeroBefore=zero.encodeWindow({includeEndZeroWidth:true});
  assert.throws(()=>{zero.features.zero_events[0].position=2;},TypeError);assert.throws(()=>{zero.features.zero_events[0].mask=0;},TypeError);assert.throws(()=>zero.features.zero_events.splice(0,1),TypeError);assert.throws(()=>zeroBefore.zero_events.push({position:0,mask:0}),TypeError);assert.deepEqual(zero.encodeWindow({includeEndZeroWidth:true}),zeroBefore);
  const f=bindSynthetic('<b>Q</b><i>R</i>',{id:'SYNTHETIC_LAYOUT_IMMUTABLE',normalizedText:'Q | R',segments:t=>[origin(t.runs[0],0,1),origin(t.runs[1],4,5)]}),input=forms(f).unit,before=input.encodeWindow();
  assert.equal(input.features.normalization_gaps.length,1);assert.throws(()=>{input.features.normalization_gaps[0].status='NATIVE_NEUTRAL';},TypeError);assert.throws(()=>input.features.normalization_gaps.push({}),TypeError);assert.throws(()=>{input.externalSegments[1].native_mark_attribution='VERIFIED';},TypeError);assert.deepEqual(input.encodeWindow(),before);
});
test('P1 caller evidence qualification and envelope aliases detach from private encoding state',()=>{
  const f=bindSynthetic('<b>Q</b>'),evidence={source_kind:'DECLARED_SYNTHETIC',nested:{parts:[{range:{start:0,end:1}}]}},qualification={flags:{body:true},scopes:[[0,1]]};
  const input=deriveFiniteNine({normalizedText:f.normalizedText,envelope:f.envelope,start:0,end:1,evidence,qualification}),before=input.encodeWindow(),binding=digest(input.binding);
  assert.notEqual(input.binding.evidence,evidence);assert.notEqual(input.binding.qualification,qualification);assert.equal(Object.isFrozen(evidence),false);
  evidence.nested.parts[0].range.start=99;evidence.nested.parts.push({range:{start:100,end:101}});qualification.flags.body=false;qualification.scopes[0][0]=99;
  f.envelope.segments[0].start=99;f.envelope.trace.paths[0].source_id='CALLER_MUTATION';f.envelope.trace.runs[0].path_id=null;
  assert.deepEqual(input.encodeWindow(),before);assert.equal(digest(input.binding),binding);assert.equal(input.binding.evidence.nested.parts[0].range.start,0);assert.equal(input.binding.qualification.flags.body,true);
});
test('P1 public binding and per-window evidence cannot mutate nested identities or future results',()=>{
  const f=bindSynthetic('<b>Q</b>'),input=deriveFiniteNine({normalizedText:'Q',envelope:f.envelope,start:0,end:1,evidence:{nested:{parts:[{verified:false}]}},qualification:{flags:{body:true}}}),before=input.encodeWindow();
  for(const mutate of [()=>{input.binding.feature_sha256='f'.repeat(64);},()=>{input.binding.source_range.end=0;},()=>{input.binding.evidence.nested.parts[0].verified=true;},()=>{input.binding.qualification.flags.body=false;},()=>{before.external_evidence.nested.parts.push({});},()=>{before.source_range.start=1;},()=>{input.binding={};}])assert.throws(mutate,TypeError);
  assert.notEqual(before.external_evidence,input.binding.evidence);assert.deepEqual(input.encodeWindow(),before);assert.equal(before.input_sha256,digest(input.binding));
});
test('P1 parent unit nested caller metadata and returned descriptor flags have no mutable aliases',()=>{
  const original=bindSynthetic('<b>Q</b><i>R</i>'),fixture={...original},parent={id:'SYNTHETIC_IMMUTABLE_P',start:0,end:2,scope:{flags:{verified:false},parts:[{start:0,end:2}]}},unit={id:'SYNTHETIC_IMMUTABLE_U',start:1,end:2,flags:{focus:true},notes:[{kind:'DECLARED_SYNTHETIC'}]},f=prospectiveForms({fixture,parent,unit}),before=f.parent.encodeWindow(),unitBefore=f.unit.encodeWindow(),descriptor=digest(f.descriptor);
  parent.start=1;parent.scope.flags.verified=true;parent.scope.parts[0].end=1;unit.start=0;unit.flags.focus=false;unit.notes.push({kind:'CALLER_MUTATION'});fixture.id='SYNTHETIC_CHANGED';fixture.normalizedText='CHANGED';
  assert.equal(f.descriptor.parent.start,0);assert.equal(f.descriptor.unit.start,1);assert.equal(f.descriptor.parent.scope.flags.verified,false);assert.equal(f.descriptor.unit.flags.focus,true);
  for(const mutate of [()=>{f.descriptor.parent.scope.flags.verified=true;},()=>{f.descriptor.parent.scope.parts[0].start=1;},()=>{f.descriptor.unit.start=0;},()=>f.descriptor.unit.notes.push({}),()=>{f.descriptor.dependency_completeness_verified=true;},()=>{f.descriptor.navigation_prefix=true;},()=>{f.descriptor.word_cap=60;},()=>{f.arms[0].form='parent';}])assert.throws(mutate,TypeError);
  assert.equal(digest(f.descriptor),descriptor);assert.equal(f.parent.binding.evidence.descriptor_sha256,descriptor);assert.equal(f.unit.binding.evidence.descriptor_sha256,descriptor);assert.deepEqual(f.parent.encodeWindow(),before);assert.deepEqual(f.unit.encodeWindow(),unitBefore);
});
test('P1 fresh equivalent sources are deterministic and exported nested policy flags are frozen',()=>{
  const f=bindSynthetic('<strong>Q</strong>'),make=()=>deriveFiniteNine({normalizedText:'Q',envelope:f.envelope,start:0,end:1,evidence:{nested:{values:[1,2]}},qualification:{flags:{body:true}}}),a=make(),b=make();
  assert.notEqual(a.features,b.features);assert.notEqual(a.binding.evidence,b.binding.evidence);assert.deepEqual(a.encodeWindow(),b.encodeWindow());assert.equal(digest(a.binding),digest(b.binding));
  assert.throws(()=>codecPolicy.flags.push('FORGED'),TypeError);assert.throws(()=>{codecPolicy.tags[0]='b';},TypeError);assert.throws(()=>{codecPolicy.unavailable_tag_features[0]='NONE';},TypeError);assert.throws(()=>{ARMS[0].model='OTHER';},TypeError);
});
test('P1 immutable data snapshots reject mutable exotic containers cycles and executable properties',()=>{
  for(const value of [new Map([['x',1]]),new Set([1]),new Date(),new Uint8Array([1]),{x:NaN},{x:()=>1}])assert.throws(()=>immutableCopy(value),TypeError);
  const cycle={};cycle.self=cycle;assert.throws(()=>immutableCopy(cycle),/Cyclic/);let called=0;const getter={get value(){called++;return 1;}};assert.throws(()=>immutableCopy(getter),/data properties/);assert.equal(called,0);
  const caller={a:[{x:1}]},copy=immutableCopy(caller);caller.a[0].x=2;assert.equal(copy.a[0].x,1);assert.throws(()=>{copy.a[0].x=3;},TypeError);assert.equal(Object.isFrozen(caller.a[0]),false);
});
test('P2 executable exact ceilings equal the existing declared protocol and accept exact-boundary options',()=>{
  const protocol=JSON.parse(readFileSync(new URL('./protocol.json',import.meta.url),'utf8')).resource_budget;
  assert.equal(DEFAULT_BUDGET.maxTokenizerCalls,protocol.tokenizer_calls_per_stream);assert.equal(DEFAULT_BUDGET.maxEncodedProbeCharacters,protocol.probe_encoded_characters);assert.equal(DEFAULT_BUDGET.maxRSSBytes,protocol.rss_bytes);assert.equal(DEFAULT_BUDGET.maxWindows,protocol.windows_per_stream);assert.equal(codecPolicy.maximum_windows,protocol.windows_per_stream);
  let calls=0;const input=forms(bindSynthetic('<b>Q</b>')).unit,result=preparePrototypeWindows(input,{policy_sha256:'f'.repeat(64),tokenCount:text=>{calls++;return text.length+2;}},{...DEFAULT_BUDGET});assert.ok(calls>0);assert.deepEqual(result.budget,DEFAULT_BUDGET);assert.ok(result.windows.every(w=>w.tokens<=256));
});
test('P2 every over-ceiling nonfinite invalid-type and malformed option rejects before tokenizer calls',()=>{
  const input=forms(bindSynthetic('<b>Q</b>')).unit;let calls=0;const counter={policy_sha256:'f'.repeat(64),tokenCount:()=>{calls++;return 3;}};
  for(const [key,ceiling] of Object.entries(DEFAULT_BUDGET)){
    assert.throws(()=>preparePrototypeWindows(input,counter,{[key]:ceiling+1}),/ceiling/);
    for(const invalid of [Infinity,-Infinity,NaN,'20000',true,null,{},[],1.5,0,-1,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>preparePrototypeWindows(input,counter,{[key]:invalid}));
  }
  for(const options of [null,[],new Date(),'budget',42,()=>1,{misspelledBudget:1},{[Symbol('budget')]:1}])assert.throws(()=>preparePrototypeWindows(input,counter,options));
  const accessor={get maxTokens(){calls++;return 256;}};assert.throws(()=>preparePrototypeWindows(input,counter,accessor),/data properties/);
  assert.equal(calls,0);assert.throws(()=>{DEFAULT_BUDGET.maxTokenizerCalls=100000;},TypeError);
});
test('P2 caller budget mutation inside tokenizer cannot change the validated private budget',()=>{
  const input=forms(bindSynthetic('<b>Q</b>')).unit,options={maxTokens:256,maxTokenizerCalls:20};const result=preparePrototypeWindows(input,{policy_sha256:'f'.repeat(64),tokenCount:text=>{options.maxTokens=1;options.maxTokenizerCalls=100000;return text.length+2;}},options);
  assert.equal(result.budget.maxTokens,256);assert.equal(result.budget.maxTokenizerCalls,20);assert.throws(()=>{result.budget.maxTokens=1;},TypeError);assert.ok(result.work.tokenizer_calls<=20);assert.equal(result.source_literal_coverage,true);
});

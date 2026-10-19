// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE: authored literals and fictional counters; no corpus/runtime assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extractSections,NATIVE_COLLECTOR_POLICY} from '../../../lib/sections.mjs';
import {traceNativeDecoration,bindNativeDecoration} from '../../../lib/source-decoration.mjs';
import {createNativeSourceContext,createNativeRepresentation,nativeRepresentationWindow,NAVIGATION_SCOPE} from '../../../lib/representation.mjs';
import {nativeEmbeddingWindows} from '../../../lib/embedding.mjs';
import {createDeclaredContextSet,declaredContextSourceIdentity} from '../declared-context-set-v1/context-set.mjs';
import {prepareDeclaredNativeNodes,verifyDeclaredNativeNodes,summarizeDeclaredNativeNodes,POLICY,POLICY_SHA256,SUBSET_POLICY,SUBSET_POLICY_SHA256,ORIGINS,LIMITS} from './native-nodes.mjs';
const H=v=>createHash('sha256').update(v).digest('hex'),C=v=>Array.isArray(v)?`[${v.map(C).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${C(v[k])}`).join(',')}}`:JSON.stringify(v),D=v=>H(C(v));
const policy={version:'SOURCE_FREE_FICTIONAL_COUNTER',actual_execution:false},methodPins={tracer_source_sha256:'a'.repeat(64),collector_source_sha256:'b'.repeat(64)};
const counter=tokenCount=>({policy,policy_sha256:D(policy),tokenCount}),clone=structuredClone;
const ref={path:'SOURCE_FREE/declared-reading.json',sha256:H('SOURCE_FREE_DECLARATION_NOT_AUTHENTICATED'),bytes:1};
function request(raw,normalizedText,envelope,range,attachments=[]){
 const source={contract_id:'SOURCE_FREE_NATIVE_NODES',source_sha256:H('SOURCE_FREE_METHOD_NOT_ATTESTED'),normalized_sha256:H(normalizedText),normalized_utf16_length:normalizedText.length},id=declaredContextSourceIdentity(source),node=(id_,r,role)=>({id:id_,source_identity_sha256:id,range:{...r,sha256:H(normalizedText.slice(r.start,r.end))},declared_role:role,annotation_ref:{...ref}});
 const declaration={source,focal:node('focal',range,'FOCAL'),attachments:attachments.map((r,i)=>node('attachment_'+i,r,'REVIEWER_DECLARED_WITNESS'))},contextSet=createDeclaredContextSet({...declaration,normalized_text:normalizedText}).artifact;
 return {contextSet,declaration,raw,normalizedText,envelope,methodPins,counter:counter(s=>Math.ceil(Array.from(s).length/4)+2)};
}
function nativePair(raw,{dropZeroWidth=false}={}){
 const trace=traceNativeDecoration(raw),mapped=trace.runs.map(r=>dropZeroWidth?r.decoded_text.replace(/[\u200B\uFEFF]/gu,''):r.decoded_text),normalizedText=mapped.join('');let at=0;
 const envelope=bindNativeDecoration(trace,{raw,normalizedText,tracerSourceSHA256:methodPins.tracer_source_sha256,collectorSourceSHA256:methodPins.collector_source_sha256,collectorSegments:trace.runs.map((r,i)=>{const start=at;at+=mapped[i].length;return {normalized_start:start,normalized_end:at,sources:[{run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length}],normalization:mapped[i]===r.decoded_text?'EXACT_DECODED':'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'};})});
 // These are synthetic native-reference fixtures, never created by the new module.
 const parent={id:'SOURCE_FREE_PARENT',contract_id:'SOURCE_FREE_NATIVE_NODES',cohort:'discovery-broad',start:0,end:normalizedText.length,sha256:H(normalizedText)},unit={...parent,id:'SOURCE_FREE_UNIT',parent_section_id:parent.id,text:normalizedText,source_navigation:{nearest_anchor:null,within_unit:[],scope:NAVIGATION_SCOPE,governing_hierarchy_verified:false},native_source_decorations_ref:{envelope_sha256:envelope.sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,policy:envelope.policy,collector_policy:NATIVE_COLLECTOR_POLICY,start:0,end:normalizedText.length,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,projection_required:true}};
 const context=createNativeSourceContext({raw,normalizedText,envelope,expectedTracerSourceSHA256:methodPins.tracer_source_sha256,expectedCollectorSourceSHA256:methodPins.collector_source_sha256}),representation=createNativeRepresentation(unit,{context,parent});return {args:request(raw,normalizedText,envelope,{start:0,end:normalizedText.length}),unit,parent,representation};
}
function verify(args,artifact){const {counter:unused,...source}=args;return verifyDeclaredNativeNodes({...source,artifact,counter_policy:policy});}
function differential(f,cost,limits){let expectedCalls=0,actualCalls=0;const opts={maxTokens:limits?.maxTokens??256,overlapWords:limits?.overlapWords??16,limits:limits?.planner??{}},expected=nativeEmbeddingWindows(f.representation,s=>{expectedCalls++;return cost(s);},opts),args={...f.args,counter:counter(s=>{actualCalls++;return cost(s);}),...(limits?{limits}:{})},out=prepareDeclaredNativeNodes(args);assert.equal(out.artifact.nodes[0].status,'COMPLETE');assert.deepEqual(out.artifact.nodes[0].windows,expected,'Exact encoder bytes/hash/source_ranges/policies/zero-end/geometry/weights match production v5');assert.equal(actualCalls,expectedCalls);assert.equal(out.artifact.counter_requests,actualCalls);assert.equal(out.artifact.nodes[0].work.tokenizer_calls,actualCalls);assert.equal(verify(args,out.artifact),true);return {args,...out};}
function rangeCost(f,cost){const points=[0];for(const p of f.args.normalizedText)points.push(points.at(-1)+p.length);const map=new Map();for(let a=0;a<points.length-1;a++)for(let b=a+1;b<points.length;b++){const start=points[a],end=points[b],s=nativeRepresentationWindow(f.representation,{start,end}).text,n=cost(f.args.normalizedText.slice(start,end));if(map.has(s))assert.equal(map.get(s),n);map.set(s,n);}return s=>{assert.ok(map.has(s),'Only unchanged native encodings can be counted');return map.get(s);};}

test('SOURCE_FREE actual extractor focal is byte-for-byte production v5; outside-parent nodes stay separate',()=>{
 const words=Array.from({length:100},(_,i)=>'duty'+i).join(' '),global='GLOBAL_REFERENCE remains a separately declared nonlocal condition.',later='LATER_REFERENCE remains separate without a fabricated governing hierarchy.',raw='<h1>Article I. Global conditions</h1><p>'+global+'</p><h1>Article II. Duties</h1><p>During the declared term, permission remains subject to the following obligations:</p><p>(i) <u>'+words+'</u>;</p><h1>Article III. Later terms</h1><p>'+later+'</p>';
 const e=extractSections({id:'SOURCE_FREE_NATIVE_NODES',format:'html',cohort:'discovery-broad',content:raw},{minSectionWords:1,maxChunkWords:20,nativeDecorationIdentity:{tracerSourceSHA256:methodPins.tracer_source_sha256,collectorSourceSHA256:methodPins.collector_source_sha256}});assert.equal(e.status,'accepted');const pos=e.normalized_text.indexOf('duty30'),unit=e.units.find(u=>u.start<=pos&&u.end>pos);assert.ok(unit,'Fixture requires an actual emitted unit containing duty30');const parent=e.sections.find(p=>p.id===unit.parent_section_id);assert.ok(parent);
 const context=createNativeSourceContext({raw,normalizedText:e.normalized_text,envelope:e.native_source_decorations,expectedTracerSourceSHA256:methodPins.tracer_source_sha256,expectedCollectorSourceSHA256:methodPins.collector_source_sha256}),representation=createNativeRepresentation(unit,{context,parent}),range={start:unit.start,end:unit.end},g=e.normalized_text.indexOf(global),l=e.normalized_text.indexOf(later);assert.ok(g>=0&&l>=0&&g+global.length<=parent.start&&l>=parent.end,'Explicit source headings keep both declared witnesses outside this focal parent');
 const args=request(raw,e.normalized_text,e.native_source_decorations,range,[{start:g,end:g+global.length},{start:l,end:l+later.length}]),out=prepareDeclaredNativeNodes(args),expected=nativeEmbeddingWindows(representation,args.counter.tokenCount);assert.deepEqual(out.artifact.nodes[0].windows,expected);assert.equal(out.artifact.nodes.length,3);assert.equal(verify(args,out.artifact),true);assert.equal(out.artifact.source_text_concatenated,false);assert.equal(out.artifact.accepted_runtime_brand_minted,false);assert.equal(out.artifact.nodes[1].windows[0].source_ranges[0].start,g);assert.equal(out.artifact.nodes[2].windows[0].source_ranges[0].start,l);assert.ok(out.artifact.nodes.every(n=>n.declaration.text===e.normalized_text.slice(n.declaration.range.start,n.declaration.range.end)));
});

test('SOURCE_FREE word/CJK successful paths retain full production encodings and fixed policies',()=>{
 differential(nativePair('<p>alpha <strike>beta gamma delta epsilon zeta eta theta</strike> last words</p>'),s=>Math.ceil(Array.from(s).length/4)+2,{maxTokens:64,overlapWords:2});
 differential(nativePair('<u>'+'甲乙丙丁𠀀'.repeat(10)+'</u>'),s=>Array.from(s).length+2,{maxTokens:128,overlapWords:3});
 assert.equal(ORIGINS.planner_source_sha256,'d9629fd6df2e5250ad2e4efcab57dbc8f35c0bb559b4479aee25d586527d5340');assert.equal(POLICY_SHA256,D(POLICY));
});

function progressRegression(f,cost){
 const count=rangeCost(f,cost),old=nativeEmbeddingWindows(f.representation,count,{maxTokens:8,overlapWords:16});let previous=0;
 assert.ok(old.some(w=>{const bad=w.source_utf16_end<=previous||w.weight<=0;previous=w.source_utf16_end;return bad;}),'Fixture must reproduce the old overlapping fast-path defect');
 let calls=0;const args={...f.args,counter:counter(s=>{assert.ok(++calls<=1000);return count(s);}),limits:{maxTokens:8,overlapWords:16,planner:{maxEncodeProbes:1000,maxTokenizerCalls:1000,maxWindows:32}}},out=prepareDeclaredNativeNodes(args),node=out.artifact.nodes[0];
 assert.equal(node.status,'COMPLETE');assert.equal(verify(args,out.artifact),true);previous=0;
 for(const w of node.windows){assert.equal(w.source_utf16_start,previous,'Replacement is a complete nonoverlapping partition');assert.ok(w.source_utf16_end>previous&&w.weight>0&&w.tokens<=8);previous=w.source_utf16_end;}
 assert.equal(previous,f.args.normalizedText.length);assert.equal(node.windows.map(w=>f.args.normalizedText.slice(w.source_utf16_start,w.source_utf16_end)).join(''),f.args.normalizedText);assert.equal(node.windows.reduce((n,w)=>n+w.weight,0),Array.from(f.args.normalizedText).length);
 assert.ok(node.work.fast_windows_completed>=1,'Discarded successful fast windows remain charged');assert.ok(node.work.final_recounts>node.windows.length,'Discarded final recounts remain charged');assert.equal(node.work.tokenizer_calls,calls);assert.ok(node.work.over_limit_probes>0);return {args,out};
}

test('SOURCE_FREE receding WORD overlap restarts full-node nonoverlapping fallback with spent work',()=>{
 const f=nativePair('<u>wa wb wc wd we wf wg wh</u>'),cost=s=>{const words=s.trim().split(/\s+/u);return words[0]==='wa'?(words.length<=5?8:9):words[0]==='wb'?(words.length<=2?8:9):8;},r=progressRegression(f,cost);
 assert.ok(r.out.artifact.nodes[0].windows.every(w=>w.segmentation==='native_all_language_nonoverlapping_codepoint_boundaries_v1'));assert.equal(r.out.artifact.nodes[0].work.search_edges,0);
 const bounded=prepareDeclaredNativeNodes({...r.args,limits:{...r.args.limits,planner:{...r.args.limits.planner,maxEncodeProbes:12}}});assert.equal(bounded.artifact.nodes[0].status,'HELD');assert.deepEqual(bounded.artifact.nodes[0].windows,[]);assert.equal(bounded.artifact.nodes[0].failure.code,'NATIVE_WINDOW_SEARCH_BOUND');assert.ok(bounded.artifact.nodes[0].work.fast_windows_completed>=1);assert.equal(verify({...r.args,limits:{...r.args.limits,planner:{...r.args.limits.planner,maxEncodeProbes:12}}},bounded.artifact),true);
});

test('SOURCE_FREE receding CJK overlap discards the partial path before bounded exhaustive search',()=>{
 const literal='甲乙丙丁戊己庚辛',f=nativePair('<u>'+literal+'</u>'),cost=s=>{const points=Array.from(s),start=literal.indexOf(points[0]);return start===0?(points.length<=5?8:9):start===1?(points.length<=2?8:9):8;},r=progressRegression(f,cost);
 assert.ok(r.out.artifact.nodes[0].windows.every(w=>w.segmentation==='native_all_language_exhaustive_codepoint_partition_v1'));assert.ok(r.out.artifact.nodes[0].work.search_edges>0);assert.equal(POLICY.name,'EXPERIMENTAL_DECLARED_NATIVE_NODES_V2_PROGRESS_GUARDED_UNADOPTED');assert.equal(POLICY.copied_bridge_source_sha256,'435ed69148e95f98db23ec1df8703582bc688e41b7201c2481747a0223ab106c');
});

test('SOURCE_FREE 296/nonmonotone/greedy-dead-end repairs differentially retain spent v5 work',()=>{
 for(const [text,cost]of [['HEADING',s=>s==='HEADING'?296:16+Array.from(s).length*16],['ABCD',s=>s==='ABC'?250:s==='D'?1:296],['ABCDE',s=>s==='ABCD'?250:s==='AB'?200:s==='CDE'?250:296]]){const f=nativePair('<u>'+text+'</u>'),out=differential(f,rangeCost(f,cost));assert.ok(out.artifact.nodes[0].work.over_limit_probes>0);assert.ok(out.artifact.nodes[0].windows.every(w=>w.tokens<=256));assert.equal(out.artifact.nodes[0].windows.reduce((n,w)=>n+w.weight,0),Array.from(text).length);}
});

test('SOURCE_FREE Unicode and terminal zero-events retain exactly the production ownership',()=>{
 const f=nativePair('<u>😀</u><u>\u200B</u><b>A</b><u>\u200B</u>',{dropZeroWidth:true}),out=differential(f,rangeCost(f,s=>Array.from(s).length===1?1:296));assert.deepEqual(out.artifact.nodes[0].windows.map(w=>[w.source_utf16_start,w.source_utf16_end]),[[0,2],[2,3]]);assert.equal(out.artifact.nodes[0].windows[0].source_ranges[0].include_end_zero_width,false);assert.equal(out.artifact.nodes[0].windows[1].source_ranges[0].include_end_zero_width,true);
 const args={...f.args,...request(f.args.raw,f.args.normalizedText,f.args.envelope,{start:0,end:2},[{start:0,end:3},{start:2,end:3}])},plans=prepareDeclaredNativeNodes(args);assert.equal(verify(args,plans.artifact),true);assert.ok(plans.artifact.nodes.every(n=>n.windows.at(-1).source_ranges[0].include_end_zero_width));assert.equal(plans.artifact.overlap_and_terminal_events_may_repeat_between_nodes,true);assert.equal(plans.artifact.global_unique_source_weights_claimed,false);
});

test('SOURCE_FREE projection bound recovery uses unchanged native evidence and no clipping',()=>{
 const f=nativePair('<u>'+'x'.repeat(25000)+'</u>'),out=differential(f,()=>1);assert.ok(out.artifact.nodes[0].windows.length>1);assert.ok(out.artifact.nodes[0].work.encoding_bound_probes>0);assert.ok(out.artifact.nodes[0].windows.every(w=>w.text.includes('"tag":"u"')));assert.equal(out.artifact.nodes[0].windows.map(w=>f.args.normalizedText.slice(w.source_utf16_start,w.source_utf16_end)).join(''),f.args.normalizedText);
});

test('SOURCE_FREE atom/encoding/search/counter failures retain whole nodes with no partial window acceptance',()=>{
 for(const [make,limits,wanted]of [[()=>counter(()=>296),undefined,'NATIVE_WINDOW_TOKEN_OVERFLOW'],[()=>counter(()=>1),{planner:{maxEncodedCharacters:1}},'NATIVE_WINDOW_ENCODING_BOUND'],[()=>counter(()=>296),{planner:{maxEncodeProbes:1}},'NATIVE_WINDOW_SEARCH_BOUND'],[()=>counter(()=>{throw Object.assign(new Error('PRIVATE_SOURCE_MUST_NOT_ESCAPE'),{code:'SYNTHETIC_COUNTER'});}),undefined,'NATIVE_WINDOW_TOKENIZER_FAILURE']]){const f=nativePair('<u>Q</u>'),args={...f.args,counter:make(),...(limits?{limits}:{})},out=prepareDeclaredNativeNodes(args),n=out.artifact.nodes[0];assert.equal(n.status,'HELD');assert.equal(n.failure.code,wanted);assert.deepEqual(n.windows,[]);assert.equal(n.failure.partial_node_accepted,false);assert.equal(verify(args,out.artifact),true);assert.ok(!JSON.stringify(out).includes('PRIVATE_SOURCE_MUST_NOT_ESCAPE'));}
 const f=nativePair('<u>ABCDE</u>'),cost=rangeCost(f,s=>['A','AB'].includes(s)?1:296),out=prepareDeclaredNativeNodes({...f.args,counter:counter(cost)});assert.equal(out.artifact.nodes[0].status,'HELD');assert.ok(out.artifact.nodes[0].work.fast_windows_completed>0);assert.ok(out.artifact.nodes[0].work.final_recounts>0);assert.deepEqual(out.artifact.nodes[0].windows,[]);
});

test('SOURCE_FREE shared request and output bounds preserve spent work without refund or partial success',()=>{
 const f=nativePair('<u>one two three</u>'),args={...f.args,limits:{total_counter_requests:1}},out=prepareDeclaredNativeNodes(args);assert.equal(out.artifact.counter_requests,1);assert.equal(out.artifact.nodes[0].status,'HELD');assert.equal(out.artifact.nodes[0].failure.cause_code,'NATIVE_CONTEXT_COUNTER_BOUND');assert.equal(verify(args,out.artifact),true);
 const bound=prepareDeclaredNativeNodes({...f.args,limits:{node_output_bytes:1}});assert.equal(bound.artifact.nodes[0].failure.code,'NATIVE_CONTEXT_NODE_OUTPUT_BOUND');assert.ok(bound.artifact.counter_requests>0);assert.equal(verify({...f.args,limits:{node_output_bytes:1}},bound.artifact),true);
 for(const limits of [{input_bytes:1},{output_bytes:1},{max_nodes:LIMITS.max_nodes+1},{planner:{maxTokenizerCalls:20001}}])assert.throws(()=>prepareDeclaredNativeNodes({...f.args,limits}),e=>e.code==='NATIVE_CONTEXT_RESOURCE_BOUND');
});

test('SOURCE_FREE binding mutations fail before counters and immutable source is detached before callbacks',()=>{
 const f=nativePair('<u>safe words</u>');for(const mutate of [x=>{x.raw+='x';},x=>{x.normalizedText+='x';},x=>{x.methodPins.collector_source_sha256='c'.repeat(64);},x=>{x.contextSet.nodes[0].range.end--;},x=>{x.declaration.focal.annotation_ref.sha256='c'.repeat(64);},x=>{x.envelope.segments[0].end--;},x=>{x.counter.policy_sha256='c'.repeat(64);},x=>{x.contextSet.governance_verified=true;}]){const x={...clone({...f.args,counter:undefined}),counter:counter(()=>{assert.fail('Counter must not run for corrupted binding');})};delete x.counter.undefined;mutate(x);assert.throws(()=>prepareDeclaredNativeNodes(x));}
 const x={...clone({...f.args,counter:undefined}),counter:counter(()=>{x.contextSet.nodes[0].text='mutated after entry';x.envelope.sha256='c'.repeat(64);return 1;})},out=prepareDeclaredNativeNodes(x);assert.equal(out.artifact.nodes[0].declaration.text,'safe words');assert.ok(Object.isFrozen(out.artifact.nodes[0].windows));assert.equal(out.artifact.context_adequate,null);assert.equal(out.artifact.token_counts_independently_verified,false);assert.equal(out.artifact.external_final_window_recount_required,true);
});

test('SOURCE_FREE independent readback rejects geometry/native/identity/policy/authority/window/work tampering',()=>{
 const f=nativePair('<u>alpha beta gamma</u>'),out=prepareDeclaredNativeNodes(f.args);assert.equal(verify(f.args,out.artifact),true);for(const mutate of [a=>{a.nodes[0].windows[0].source_ranges[0].start++;},a=>{a.nodes[0].windows[0].text+='x';},a=>{a.nodes[0].windows[0].sha256=H('x');},a=>{a.nodes[0].windows[0].source_ranges[0].include_end_zero_width=false;},a=>{a.nodes[0].windows[0].tokens=257;},a=>{a.nodes[0].input_sha256=H('x');},a=>{a.counter_policy_sha256=H('x');},a=>{a.policy.heading_input='GUESS';},a=>{a.accepted_runtime_brand_minted=true;},a=>{a.nodes[0].work.tokenizer_calls=0;},a=>{a.nodes[0].windows[0].invented=true;}]){const a=clone(out.artifact);mutate(a);assert.throws(()=>verify(f.args,a));}
 assert.deepEqual(summarizeDeclaredNativeNodes(out.artifact),out.metadata);assert.equal(out.metadata.authority,'NONE');
 for(const mutate of [a=>{a.counter_requests=0;a.nodes[0].work.tokenizer_calls=0;},a=>{a.nodes[0].work.maximum_measured_tokens=0;},a=>{a.nodes[0].work.encode_probes=a.nodes[0].work.tokenizer_calls-1;}]){const a=clone(out.artifact);mutate(a);assert.throws(()=>verify(f.args,a),'Declared work must remain internally consistent even though execution is unverified');}
 // Counts within the bound remain callback declarations; verifier makes no attestation.
 const a=clone(out.artifact);a.nodes[0].windows[0].tokens=1;assert.equal(verify(f.args,a),true);assert.equal(a.token_counts_independently_verified,false);
});

function subsetFixture(){
 const f=nativePair('<u>focal only; first attachment; last attachment</u>'),text=f.args.normalizedText,first=text.indexOf('first'),last=text.indexOf('last');
 return request(f.args.raw,text,f.args.envelope,{start:0,end:first},[{start:first,end:last},{start:last,end:text.length}]);
}

test('SOURCE_FREE explicit subset plans only requested nodes in request order without replacing the focal',()=>{
 const original=subsetFixture(),all=prepareDeclaredNativeNodes(original);let calls=0;
 const args={...original,planned_node_ids:['attachment_1','attachment_0'],counter:counter(s=>{calls++;assert.ok(!s.includes('focal only'),'Unplanned focal must never enter the counter');return Math.ceil(Array.from(s).length/4)+2;})},out=prepareDeclaredNativeNodes(args);
 assert.equal(original.contextSet.nodes[0].declared_role,'FOCAL');assert.equal(original.contextSet.nodes.length,3);assert.deepEqual(out.artifact.planned_node_ids,args.planned_node_ids);assert.deepEqual(out.artifact.nodes.map(n=>n.declaration.id),args.planned_node_ids);
 assert.deepEqual(out.artifact.nodes[0].windows,all.artifact.nodes[2].windows);assert.deepEqual(out.artifact.nodes[1].windows,all.artifact.nodes[1].windows);assert.equal(calls,out.artifact.counter_requests);assert.equal(calls,out.artifact.nodes.reduce((n,x)=>n+x.work.tokenizer_calls,0));assert.equal(verify(args,out.artifact),true);
 assert.equal(out.artifact.context_set_sha256,all.artifact.context_set_sha256);assert.equal(out.artifact.focal_replaced,false);assert.equal(out.artifact.policy_sha256,SUBSET_POLICY_SHA256);assert.equal(out.metadata.policy_sha256,SUBSET_POLICY_SHA256);assert.equal(SUBSET_POLICY_SHA256,D(SUBSET_POLICY));assert.notEqual(SUBSET_POLICY_SHA256,POLICY_SHA256);
});

test('SOURCE_FREE missing, duplicate, empty and malformed subset requests fail before counters',()=>{
 for(const planned_node_ids of [[],['missing'],['attachment_0','attachment_0'],['attachment_0',1],null,'attachment_0',undefined]){
  const args={...subsetFixture(),planned_node_ids,counter:counter(()=>assert.fail('Invalid subset cannot spend a counter request'))};assert.throws(()=>prepareDeclaredNativeNodes(args));
 }
 const args={...subsetFixture(),planned_node_ids:['attachment_1'],limits:{max_nodes:1},counter:counter(()=>assert.fail('A subset cannot bypass whole-context bounds'))};assert.throws(()=>prepareDeclaredNativeNodes(args),e=>e.code==='NATIVE_CONTEXT_RESOURCE_BOUND');
});

test('SOURCE_FREE subset still validates every declared node and detaches its requested IDs',()=>{
 for(const mutate of [x=>{x.contextSet.nodes[0].text+='x';},x=>{x.declaration.focal.range.end--;},x=>{x.contextSet.nodes[1].annotation_ref.sha256=H('unplanned mutation');}]){
  const x={...clone({...subsetFixture(),counter:undefined}),planned_node_ids:['attachment_1'],counter:counter(()=>assert.fail('Unplanned-node corruption must fail before counting'))};mutate(x);assert.throws(()=>prepareDeclaredNativeNodes(x));
 }
 const x={...subsetFixture(),planned_node_ids:['attachment_1'],counter:counter(()=>{x.planned_node_ids[0]='focal';return 1;})},out=prepareDeclaredNativeNodes(x);assert.deepEqual(out.artifact.planned_node_ids,['attachment_1']);assert.equal(out.artifact.nodes[0].declaration.id,'attachment_1');assert.ok(Object.isFrozen(out.artifact.planned_node_ids));
});

test('SOURCE_FREE subset readback rejects omission, substitution, reordering and policy/cache-binding tampering',()=>{
 const args={...subsetFixture(),planned_node_ids:['attachment_1','attachment_0']},out=prepareDeclaredNativeNodes(args);assert.equal(verify(args,out.artifact),true);
 for(const mutate of [a=>{delete a.planned_node_ids;},a=>{a.planned_node_ids.reverse();},a=>{a.planned_node_ids[0]='focal';},a=>{a.nodes.reverse();},a=>{a.nodes.pop();},a=>{a.policy=clone(POLICY);a.policy_sha256=POLICY_SHA256;},a=>{a.nodes[0].input_binding.planned_node_ids_sha256=H('wrong subset');}]){const a=clone(out.artifact);mutate(a);assert.throws(()=>verify(args,a));}
 assert.throws(()=>verify({...args,planned_node_ids:['attachment_0','attachment_1']},out.artifact));const {planned_node_ids:unused,...defaultArgs}=args;assert.throws(()=>verify(defaultArgs,out.artifact));
});

test('SOURCE_FREE omitted subset preserves default-all identity and explicit-all uses a separate identity',()=>{
 const args=subsetFixture(),out=prepareDeclaredNativeNodes(args),explicit={...args,planned_node_ids:args.contextSet.nodes.map(n=>n.id)},selected=prepareDeclaredNativeNodes(explicit);
 assert.equal(Object.hasOwn(out.artifact,'planned_node_ids'),false);assert.equal(out.artifact.policy_sha256,POLICY_SHA256);assert.equal(out.artifact.nodes.length,args.contextSet.nodes.length);assert.equal(verify(args,out.artifact),true);
 assert.deepEqual(out.artifact.nodes.map(n=>n.windows),selected.artifact.nodes.map(n=>n.windows));assert.notEqual(out.artifact.nodes[0].input_sha256,selected.artifact.nodes[0].input_sha256);assert.equal(verify(explicit,selected.artifact),true);assert.throws(()=>verify(args,selected.artifact));assert.throws(()=>verify(explicit,out.artifact));
});

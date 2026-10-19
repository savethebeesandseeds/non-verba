// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE. All tokenCount functions below are fictional controls, not
// attestations of the policy metadata or openings of installed tokenizers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractSections} from '../sections.prototype.mjs';
import {projectFocalContext} from '../focal-context-projection-v1/projection.mjs';
import {buildMatchedContextArms} from '../matched-context-arms-v1/arms.mjs';
import {sha,digest,featureAtom,decodeModelText,policy as codecPolicy} from '../finite-codec.mjs';
import {buildWindowCensus,verifyWindowCensus,summarizeWindowCensus,windowCensusDescriptors,COUNTER_POLICY_SHA256S,LIMITS} from './census.mjs';
const manifest=JSON.parse(readFileSync(new URL('../actual-entry-v1/runtime/named-service-manifest.json',import.meta.url),'utf8'));
const cp=manifest.models.map(m=>({policy:m.policy,policy_sha256:m.policy_sha256}));
const tracer=sha(readFileSync(new URL('../source-decoration.prototype.mjs',import.meta.url))),collector=sha(readFileSync(new URL('../sections.prototype.mjs',import.meta.url)));
const arms=['FOCAL_ONLY','PARENT_NEIGHBORS_60','COMPLETE_EXISTING_FRAME','FULL_AVAILABLE_NORMALIZED_DOCUMENT'];
const J=v=>JSON.stringify(v,null,2)+'\n';
function ref(matched){return{path:'/SOURCE_FREE/fictional-matched-wrapper.json.gz',sha256:sha('SOURCE_FREE_NOT_A_STORED_WRAPPER'),bytes:1,encoding:'gzip',decoded_sha256:sha(J({matched})),decoded_bytes:Buffer.byteLength(J({matched}))};}
function packet(matched){return{matched,matched_ref:ref(matched)};}
function counters(fn=(text,d)=>Math.max(1,Math.ceil(Array.from(decodeModelText(d.form==='NATIVE9'?text:featureAtom(text,0))).length/32))){return cp.map(p=>({...p,tokenCount:fn}));}
function verify(p,result,limits){assert.equal(verifyWindowCensus({...p,census:result.artifact,counter_policies:cp,limits}),true);assert.deepEqual(summarizeWindowCensus(result.artifact),result.metadata);}
function realFixture(){
 const raw='<html><body><h1>Section 1 General</h1><p>SYNTHETIC_GLOBAL condition outside the parent.</p><h1>Section 2 Obligations</h1><p>53. The synthetic holder must satisfy the following:</p>'+Array.from({length:9},(_,i)=>'<p>('+String.fromCharCode(97+i)+') '+Array.from({length:40},(_,j)=>'retains'+j).join(' ')+';</p>').join('')+'<p>SYNTHETIC_SHARED_CONSEQUENCE follows the complete list.</p><h1>Section 3 Later</h1><p>SYNTHETIC_LATER condition remains in the available document.</p></body></html>';
 const e=JSON.parse(JSON.stringify(extractSections({id:'SYNTHETIC_CENSUS',format:'html',source_url:'https://synthetic.invalid/census',content:raw},{minWords:1,maxUnitWords:300,nativeDecorationIdentity:{tracerSourceSHA256:tracer,collectorSourceSHA256:collector}})));
 assert.equal(e.status,'accepted');const focal=e.units.find(u=>u.chunk_index===1&&u.governor_frame_ids.length);assert.ok(focal);const projection=projectFocalContext({extraction:e,focal_id:focal.id}).artifact;
 return packet(buildMatchedContextArms({extraction:e,focal_id:focal.id,projection}).artifact);
}
// Small internally authored serialized-feature packets isolate codec/window
// edges. They claim no collector/native-origin custody and use no real inputs.
function syntheticPacket(text='alpha beta gamma delta',zeroLocal=[]){
 const offset=17,range={start:offset,end:offset+text.length,sha256:sha(text)},features={spans:[{start:offset,end:offset+text.length,mask:32}],normalization_gaps:[],zero_events:zeroLocal.map(position=>({position:offset+position,mask:2048}))},external_segments=[];
 const cuts=[...new Set([0,text.length,...zeroLocal])].sort((a,b)=>a-b),parts=[];for(let i=0;i<cuts.length;i++){const at=cuts[i];if(zeroLocal.includes(at))parts.push(featureAtom('',2048));if(cuts[i+1]!==undefined)parts.push(featureAtom(text.slice(at,cuts[i+1]),32));}
 const encodedText=parts.join(''),binding={source_range:range,policy_sha256:digest(codecPolicy),feature_sha256:digest(features),normalization_gaps_sha256:digest([]),external_segment_links_sha256:digest(external_segments),evidence:'SOURCE_FREE_SERIALIZED_FEATURES_NO_ORIGIN_ATTESTATION'};
 const native9={binding,features,external_segments,encoded:{text:encodedText,sha256:sha(encodedText),source_range:range,zero_events:features.zero_events,include_end_zero_width:true,input_sha256:digest(binding),feature_sha256:digest(features)}};
 return packet({schema:'matched-context-arms-v1',source:{focal:{id:'SYNTHETIC_CENSUS_UNIT'},source_free_fixture:true,origin_provenance_verified:false},arms:arms.map(arm=>({arm,status:'PREPARED_RANGE_NOT_TOKENIZED',representation_sha256:digest({arm,range,fixture:'SOURCE_FREE'}),range,forms:{native9,strip:{text,sha256:range.sha256,source_range:range}}})),authority:'NONE',quality_gate_pass:false,accepted_runtime_brand_minted:false,source_text_truncated:false});
}
const denied=fn=>assert.throws(fn,e=>['CENSUS_SOURCE_BINDING','INVALID_INPUT','QA_FINITE_FEATURE_INVARIANT','CENSUS_INPUT_BOUND'].includes(e.code));

test('real synthetic collector yields 16 policy-bound streams with exact native-aligned strip coverage',()=>{
 const p=realFixture(),calls=[],events=[],result=buildWindowCensus({...p,counters:counters((text,d)=>{calls.push({text,stream_id:d.stream_id});return Math.max(1,Math.ceil(Array.from(text).length/48));}),onFinalWindow:e=>{assert.equal(calls.at(-1).stream_id,e.stream_id);assert.equal(sha(calls.at(-1).text),e.input_sha256);events.push(e);return true;}});verify(p,result);
 assert.equal(result.metadata.stream_count,16);assert.equal(result.metadata.held_count,0);assert.equal(result.metadata.charged_requests,calls.length);assert.deepEqual(result.artifact.counter_policies.map(p=>p.policy_sha256),COUNTER_POLICY_SHA256S);
 assert.deepEqual(windowCensusDescriptors({...p,counter_policies:cp}),result.artifact.streams.map(s=>s.descriptor));
 for(let i=0;i<16;i+=2){const n=result.artifact.streams[i],s=result.artifact.streams[i+1],arm=p.matched.arms.find(a=>a.arm===n.descriptor.arm);assert.deepEqual(s.windows.map(w=>w.source_range),n.windows.map(w=>w.source_range));assert.equal(s.windows.map(w=>w.text).join(''),arm.forms.strip.text);assert.equal(n.windows.map(w=>decodeModelText(w.text)).join(''),arm.forms.strip.text);assert.equal(n.native_planner_work.final_window_recounts,n.windows.length);assert.equal(s.charged_requests,s.windows.length);assert.equal(n.descriptor.coordinates,'LOCAL_UTF16_FROM_ARM_START');assert.equal(n.windows[0].normalized_source_range.start,arm.range.start);}
 assert.equal(events.length,result.artifact.streams.reduce((n,s)=>n+s.windows.length,0));assert.equal(result.artifact.execution_attested,false);assert.equal(result.artifact.inference,false);assert.equal(result.artifact.pooling_performed,false);assert.equal(result.artifact.context_adequate,null);assert.equal(result.artifact.origin_provenance_rebuilt,false);assert.ok(Object.isFrozen(result.artifact.streams[0].windows));
});

test('aligned strip overflow is retained without clipping, independent strip replanning or native failure',()=>{
 const p=syntheticPacket(),calls=[],result=buildWindowCensus({...p,counters:counters((text,d)=>{calls.push(d.form);return d.form==='STRIP'?257:1;})});verify(p,result);
 assert.equal(result.metadata.complete_count,8);assert.equal(result.metadata.held_count,8);
 for(let i=0;i<16;i+=2){const n=result.artifact.streams[i],s=result.artifact.streams[i+1];assert.equal(n.status,'COMPLETE_TOKENIZER_WINDOW_PLAN');assert.equal(s.status,'HELD_ALIGNED_STRIP_OVERFLOW');assert.equal(s.windows,null);assert.equal(s.attempted_windows.length,1);assert.equal(s.attempted_windows[0].text,p.matched.arms[i/4|0].forms.strip.text);assert.equal(s.attempted_windows[0].tokens,257);assert.deepEqual(s.attempted_windows[0].source_range,n.windows[0].source_range);assert.equal(s.charged_requests,1);assert.equal(s.partial_stream_accepted,false);}
 assert.equal(calls.filter(f=>f==='STRIP').length,8);
 const forged=structuredClone(result.artifact);for(const s of forged.streams)if(s.descriptor.form==='STRIP'){s.status='HELD_ALIGNED_STRIP_COUNT';s.code='CENSUS_STREAM_FAILURE';}denied(()=>verifyWindowCensus({...p,census:forged,counter_policies:cp}));
 const stopped=buildWindowCensus({...p,counters:counters(()=>1),onFinalWindow:e=>e.stream_id===result.artifact.streams[1].descriptor.stream_id?false:true});verify(p,stopped);const extra=structuredClone(stopped.artifact);assert.equal(extra.streams[1].attempted_windows.length,extra.streams[0].windows.length);extra.streams[1].charged_requests++;denied(()=>verifyWindowCensus({...p,census:extra,counter_policies:cp}));
});

test('literal marker collisions, Unicode codepoints and terminal zero events survive the Q19 bridge',()=>{
 const text='🧭α中 [NF b] literal [/NF] \\ end',p=syntheticPacket(text,[0,3,text.length]),result=buildWindowCensus({...p,counters:counters(()=>1),limits:{maxProbeCharacters:8}});verify(p,result,{maxProbeCharacters:8});
 for(let i=0;i<16;i+=2){const n=result.artifact.streams[i],s=result.artifact.streams[i+1];assert.equal(n.windows.map(w=>decodeModelText(w.text)).join(''),text);assert.equal(s.windows.map(w=>w.text).join(''),text);assert.deepEqual(n.windows.flatMap(w=>w.zero_events),[{position:0,mask:2048},{position:3,mask:2048},{position:text.length,mask:2048}]);assert.equal(n.windows.at(-1).include_end_zero_width,true);for(const w of n.windows)assert.ok(!(w.source_range.start===1||w.source_range.end===1));assert.deepEqual(s.windows.flatMap(w=>w.zero_events),n.windows.flatMap(w=>w.zero_events));}
});

test('failed word and codepoint attempts remain charged; paired strip has no native plan or calls',()=>{
 const p=syntheticPacket('alpha beta gamma'),calls=[],result=buildWindowCensus({...p,counters:counters((text,d)=>{calls.push(d);return 257;})});verify(p,result);
 assert.equal(result.metadata.complete_count,0);assert.equal(result.metadata.held_count,16);assert.equal(result.metadata.charged_requests,calls.length);assert.ok(calls.length>8);assert.ok(calls.every(d=>d.form==='NATIVE9'));
 for(let i=0;i<16;i+=2){const n=result.artifact.streams[i],s=result.artifact.streams[i+1];assert.equal(n.code,'PROTOTYPE_MINIMUM_CODEPOINT_ENCODING_OVERFLOW');assert.ok(n.native_planner_work.encode_probes>=2);assert.equal(n.native_planner_work.tokenizer_calls,n.charged_requests);assert.equal(s.status,'HELD_NO_NATIVE_WINDOW_PLAN');assert.equal(s.windows,null);assert.equal(s.charged_requests,0);}
});

test('discarded word windows do not commit; rejected final hooks retain whole-stream failure and spent calls',()=>{
 const p=syntheticPacket('a extraordinarilylongword'),commits=[],calls=[],result=buildWindowCensus({...p,counters:counters((text,d)=>{calls.push(d.stream_id);return Array.from(decodeModelText(d.form==='NATIVE9'?text:featureAtom(text,0))).length>4?257:1;}),onFinalWindow:e=>{commits.push(e);return true;}});verify(p,result);
 for(let i=0;i<16;i+=2){const n=result.artifact.streams[i];assert.equal(n.windows[0].segmentation,'ALL_LANGUAGE_UNICODE_CODEPOINT_FALLBACK');assert.equal(commits.filter(e=>e.stream_id===n.descriptor.stream_id).length,n.windows.length);assert.ok(n.charged_requests>n.windows.length*2);}
 const stopped=buildWindowCensus({...p,counters:counters(()=>1),onFinalWindow:()=>false});verify(p,stopped);assert.ok(stopped.artifact.streams.filter(s=>s.descriptor.form==='NATIVE9').every(s=>s.code==='PROTOTYPE_FINAL_WINDOW_COMMIT_REJECTED'&&s.windows===null&&s.charged_requests>0));assert.ok(stopped.artifact.streams.filter(s=>s.descriptor.form==='STRIP').every(s=>s.charged_requests===0));
});

test('upstream held arms stay held with zero calls while the other original arms remain present',()=>{
 const p=syntheticPacket(),m=structuredClone(p.matched);m.arms[2]={...m.arms[2],status:'HELD_UNRESOLVED_CONTEXT',range:null,forms:null};const q=packet(m),calls=[],r=buildWindowCensus({...q,counters:counters((text,d)=>{calls.push(d);return 1;})});verify(q,r);assert.equal(r.metadata.stream_count,16);assert.equal(r.metadata.held_count,4);assert.ok(calls.every(d=>d.arm!=='COMPLETE_EXISTING_FRAME'));assert.deepEqual(r.artifact.streams.filter(s=>s.descriptor.arm==='COMPLETE_EXISTING_FRAME').map(s=>s.status),['HELD_UPSTREAM_ARM','HELD_NO_NATIVE_WINDOW_PLAN','HELD_UPSTREAM_ARM','HELD_NO_NATIVE_WINDOW_PLAN']);
});

test('independent structural verifier rejects geometry, zero, policy, ordering, source identity and work tampering',()=>{
 const p=syntheticPacket('🧭 alpha beta',[0,13]),r=buildWindowCensus({...p,counters:counters(()=>1)});verify(p,r);
 for(const mutate of[a=>a.streams.reverse(),a=>a.streams[0].windows[0].normalized_source_range.start++,a=>a.streams[1].windows[0].text+='x',a=>a.streams[0].windows[0].zero_events.pop(),a=>a.streams[0].descriptor.tokenizer_policy_sha256=sha('forged'),a=>a.matched_ref.decoded_sha256=sha('forged'),a=>a.streams[0].native_planner_work.extra='SYNTHETIC_SOURCE_WORDS',a=>a.streams[0].native_planner_work.peak_sampled_rss_bytes=LIMITS.maxRSSBytes+1,a=>a.streams[0].charged_requests--,a=>a.execution_attested=true,a=>a.extra_grant=true]){const census=structuredClone(r.artifact);mutate(census);denied(()=>verifyWindowCensus({...p,census,counter_policies:cp}));}
 for(const mutate of[m=>m.arms[0].forms.native9.encoded.text+='x',m=>m.arms[3].forms.native9.binding.feature_sha256=sha('forged'),m=>m.arms[0].forms.native9.features.spans[0].start++]){const m=structuredClone(p.matched);mutate(m);let calls=0;denied(()=>buildWindowCensus({...packet(m),counters:counters(()=>{calls++;return 1;})}));assert.equal(calls,0);}
 const wrong=structuredClone(cp);wrong[0].policy.special_tokens=false;denied(()=>windowCensusDescriptors({...p,counter_policies:wrong}));
});

test('lower-only work bounds preserve spent failures; exact combined byte limit accepts and lower cap throws no artifact',()=>{
 const p=syntheticPacket(),small=buildWindowCensus({...p,counters:counters(()=>1),limits:{max_total_calls:1}});verify(p,small,{max_total_calls:1});assert.equal(small.metadata.charged_requests,1);assert.equal(small.metadata.complete_count,0);
 const sourceBound=buildWindowCensus({...p,counters:counters(()=>assert.fail('source bound must precede callbacks')),limits:{maxSourceCharacters:8}});verify(p,sourceBound,{maxSourceCharacters:8});assert.equal(sourceBound.metadata.charged_requests,0);assert.equal(sourceBound.metadata.held_count,16);
 const r=buildWindowCensus({...p,counters:counters(()=>1)});let cap=r.metadata.combined_bytes;for(let i=0;i<16;i++){const a=structuredClone(r.artifact);a.limits.output_bytes=cap;const next=summarizeWindowCensus(a).combined_bytes;if(next===cap)break;cap=next;}
 const exact=buildWindowCensus({...p,counters:counters(()=>1),limits:{output_bytes:cap}});verify(p,exact,{output_bytes:cap});assert.equal(exact.metadata.combined_bytes,cap);assert.throws(()=>buildWindowCensus({...p,counters:counters(()=>1),limits:{output_bytes:cap-1}}),e=>e.code==='CENSUS_OUTPUT_BOUND'&&e.required_bytes===cap&&e.charged_requests>0&&!Object.hasOwn(e,'artifact'));
 for(const limits of[{maxTokens:257},{maxTokenizerCalls:20001},{max_total_calls:60001},{input_bytes:LIMITS.input_bytes+1},{output_bytes:LIMITS.output_bytes+1},{unexpected:1}])assert.throws(()=>buildWindowCensus({...p,counters:counters(()=>1),limits}),e=>e.code==='INVALID_INPUT');
 assert.throws(()=>buildWindowCensus({...p,counters:counters(()=>1),limits:{input_bytes:1}}),e=>e.code==='CENSUS_INPUT_BOUND');
});

test('untrusted JSON accessors and error-code coercion cannot become source reads or lose failure accounting',()=>{
 const p=syntheticPacket(),m=structuredClone(p.matched);let reads=0;Object.defineProperty(m,'extra',{enumerable:true,get(){reads++;return 'SYNTHETIC_SECRET';}});assert.throws(()=>buildWindowCensus({...p,matched:m,counters:counters(()=>1)}),e=>e.code==='INVALID_INPUT');assert.equal(reads,0);
 for(const make of[()=>Object.assign(Error('not retained'),{code:123}),()=>Object.assign(Error('not retained'),{code:{toString(){reads++;return'BAD';},[Symbol.toPrimitive](){reads++;return'BAD';}}}),()=>Object.defineProperty(Error('not retained'),'code',{get(){reads++;return'BAD';}})]){const r=buildWindowCensus({...p,counters:counters(()=>{throw make();})});verify(p,r);assert.equal(r.metadata.stream_count,16);assert.equal(r.metadata.complete_count,0);assert.ok(r.artifact.streams.every(s=>s.code==='CENSUS_STREAM_FAILURE'));assert.equal(reads,0);}
});

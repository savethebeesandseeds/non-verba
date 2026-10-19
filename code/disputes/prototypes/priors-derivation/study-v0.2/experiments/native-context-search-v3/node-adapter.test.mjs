// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE: authored literals and fictional counters; no corpus/runtime assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extractSections,NATIVE_COLLECTOR_POLICY} from '../../lib/sections.mjs';
import {traceNativeDecoration,bindNativeDecoration} from '../../lib/source-decoration.mjs';
import {createNativeSourceContext,createNativeRepresentation,nativeRepresentationWindow,NAVIGATION_SCOPE} from '../../lib/representation.mjs';
import {createDeclaredContextSet,declaredContextSourceIdentity} from '../literal-emphasis-parent-v1/declared-context-set-v1/context-set.mjs';
import {prepareDeclaredNativeNodes,verifyDeclaredNativeNodes,summarizeDeclaredNativeNodes,POLICY,POLICY_SHA256,SUBSET_POLICY,SUBSET_POLICY_SHA256,ORIGINS,LIMITS} from './node-adapter.mjs';
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

function available(f,range={start:0,end:1}){
 const a=request(f.args.raw,f.args.normalizedText,f.args.envelope,range,[{start:0,end:f.args.normalizedText.length}]);
 a.declaration.attachments[0].id='available_normalized_document';a.declaration.attachments[0].declared_role='AVAILABLE_NORMALIZED_DOCUMENT';
 a.contextSet=createDeclaredContextSet({...a.declaration,normalized_text:a.normalizedText}).artifact;a.planned_node_ids=['available_normalized_document'];return a;
}
const withoutCounter=a=>{const{counter:ignored,...rest}=a;return clone(rest);};

test('SOURCE_FREE V3 subset plans only available node while validating genuine unplanned focal and binding distinct identity',()=>{
 const args=available(nativePair('<u>Focal words. Whole available source stays separate.</u>')),out=prepareDeclaredNativeNodes(args),n=out.artifact.nodes[0];
 assert.equal(out.artifact.schema,'experimental-declared-native-node-plans-v3');assert.equal(out.metadata.schema,'experimental-declared-native-node-summary-v3');assert.equal(out.artifact.nodes.length,1);assert.equal(n.declaration.id,'available_normalized_document');assert.equal(n.declaration.declared_role,'AVAILABLE_NORMALIZED_DOCUMENT');assert.equal(args.contextSet.nodes[0].declared_role,'FOCAL');assert.equal(args.contextSet.nodes.length,2);assert.deepEqual(out.artifact.planned_node_ids,['available_normalized_document']);assert.equal(out.artifact.policy_sha256,SUBSET_POLICY_SHA256);assert.equal(SUBSET_POLICY.name,'EXPERIMENTAL_DECLARED_NATIVE_NODES_V3_EXPLICIT_SUBSET_UNADOPTED');assert.equal(SUBSET_POLICY_SHA256,D(SUBSET_POLICY));assert.equal(POLICY_SHA256,D(POLICY));assert.equal(ORIGINS.planner_source_sha256,'01ae57a912ebe8c544d80d33a39a574b0341dafb141f13ac43970f441a668d0a');assert.equal(verify(args,out.artifact),true);assert.equal(out.artifact.accepted_runtime_brand_minted,false);assert.equal(out.artifact.context_adequate,null);assert.equal(out.metadata.authority,'NONE');assert.deepEqual(out.metadata,summarizeDeclaredNativeNodes(out.artifact));
});

test('SOURCE_FREE invalid subset and unplanned focal/source/native/counter corruption fail before counters',()=>{
 const base=available(nativePair('<u>Focal and available source.</u>'));
 for(const ids of [[],null,undefined,'available_normalized_document',['missing'],['available_normalized_document','available_normalized_document']]){const x={...withoutCounter(base),planned_node_ids:ids,counter:counter(()=>assert.fail('No invalid input can spend a counter call'))};assert.throws(()=>prepareDeclaredNativeNodes(x));}
 for(const mutate of [x=>{x.contextSet.nodes[0].text+='x';},x=>{x.declaration.focal.range.end++;},x=>{x.raw+='x';},x=>{x.normalizedText+='x';},x=>{x.methodPins.collector_source_sha256='c'.repeat(64);},x=>{x.envelope.sha256='c'.repeat(64);},x=>{x.counter.policy_sha256='c'.repeat(64);}]){const x={...withoutCounter(base),counter:counter(()=>assert.fail('Corrupted binding must fail before a counter call'))};mutate(x);assert.throws(()=>prepareDeclaredNativeNodes(x));}
 const x={...withoutCounter(base),limits:{max_nodes:1},counter:counter(()=>assert.fail('Subset cannot bypass full-context bound'))};assert.throws(()=>prepareDeclaredNativeNodes(x),e=>e.code==='NATIVE_CONTEXT_RESOURCE_BOUND');
});

test('SOURCE_FREE V3 detaches source/declaration/subset before callbacks and returns frozen plans',()=>{
 const x=available(nativePair('<u>Focal and whole available literal.</u>')),original=x.normalizedText;
 x.counter=counter(()=>{x.planned_node_ids[0]='focal';x.declaration.attachments[0].id='changed';x.normalizedText='mutated after entry';x.envelope.sha256='c'.repeat(64);return 1;});
 const out=prepareDeclaredNativeNodes(x);assert.deepEqual(out.artifact.planned_node_ids,['available_normalized_document']);assert.equal(out.artifact.nodes[0].declaration.text,original);assert.equal(out.artifact.nodes[0].declaration.id,'available_normalized_document');assert.ok(Object.isFrozen(out.artifact.nodes[0].windows));assert.ok(Object.isFrozen(out.artifact.planned_node_ids));assert.equal(out.artifact.source_text_concatenated,false);assert.equal(out.artifact.focal_replaced,false);assert.equal(out.artifact.token_counts_independently_verified,false);assert.equal(out.artifact.external_final_window_recount_required,true);
});

test('SOURCE_FREE V3 independent readback rejects geometry, policy, old schema/segmentation and work tampering',()=>{
 const args=available(nativePair('<u>Focal and available whole source.</u>')),out=prepareDeclaredNativeNodes(args);assert.equal(verify(args,out.artifact),true);
 for(const mutate of [a=>{a.schema='experimental-declared-native-node-plans-v1';},a=>{a.policy.name='EXPERIMENTAL_DECLARED_NATIVE_NODES_V2_EXPLICIT_SUBSET_UNADOPTED';},a=>{a.planned_node_ids[0]='focal';},a=>{a.nodes[0].windows[0].source_ranges[0].start++;},a=>{a.nodes[0].windows[0].text+='x';},a=>{a.nodes[0].windows[0].weight=0;},a=>{a.nodes[0].windows[0].segmentation='native_all_language_exhaustive_codepoint_partition_v1';},a=>{a.nodes[0].input_sha256=H('bad');},a=>{a.nodes[0].work.tokenizer_calls=0;},a=>{a.counter_policy_sha256=H('bad');},a=>{a.quality_gate_pass=true;}]){const a=clone(out.artifact);mutate(a);assert.throws(()=>verify(args,a));}
 const declaredOnly=clone(out.artifact);declaredOnly.nodes[0].windows[0].tokens=1;assert.equal(verify(args,declaredOnly),true,'Range readback is not an independent token-count attestation');assert.equal(declaredOnly.token_counts_independently_verified,false);
});

test('SOURCE_FREE V3 cap failures retain all callback/planner work and accept no partial windows',()=>{
 const base=available(nativePair('<u>Focal more words and whole available source.</u>'));
 for(const limits of [{planner:{maxEncodeProbes:1,maxTokenizerCalls:1}},{total_counter_requests:1}]){let calls=0;const args={...base,limits,counter:counter(()=>{calls++;return 1;})},out=prepareDeclaredNativeNodes(args),n=out.artifact.nodes[0];assert.equal(n.status,'HELD');assert.deepEqual(n.windows,[]);assert.equal(n.failure.partial_node_accepted,false);assert.equal(out.artifact.counter_requests,calls);assert.equal(calls,1);assert.ok(n.work.encode_probes>=calls);assert.ok(n.work.tokenizer_calls>=calls);assert.equal(verify(args,out.artifact),true);}
 assert.equal(LIMITS.total_counter_requests,60000);
});

test('SOURCE_FREE V3 hinted whole-node fallback verifies new segmentation, exact native projection and unique Unicode weights',()=>{
 const f=nativePair('<u>A🙂BCDEFGH</u>'),args=available(f),offsets=[0];for(const c of args.normalizedText)offsets.push(offsets.at(-1)+c.length);
 const costs=new Map();for(let a=0;a<offsets.length-1;a++)for(let b=a+1;b<offsets.length;b++){const s=nativeRepresentationWindow(f.representation,{start:offsets[a],end:offsets[b]}).text,n=a===0?(b<=4?8:9):b-a===4||b===offsets.length-1&&b-a<=4?8:9;assert.ok(!costs.has(s)||costs.get(s)===n);costs.set(s,n);}
 args.counter=counter(s=>{assert.ok(costs.has(s));return costs.get(s);});args.limits={maxTokens:8,overlapWords:0};const out=prepareDeclaredNativeNodes(args),n=out.artifact.nodes[0];assert.equal(n.status,'COMPLETE');assert.equal(verify(args,out.artifact),true);assert.ok(n.work.search_edges>0);assert.ok(n.windows.every(w=>w.segmentation==='experimental_native_hinted_exhaustive_codepoint_partition_v3'));let end=0;
 for(const w of n.windows){assert.equal(w.source_utf16_start,end);end=w.source_utf16_end;assert.ok(w.weight>0&&w.tokens<=8);assert.match(w.text,/"tag":"u"/);assert.equal(w.source_ranges[0].role,'reviewer_declared_context_node');}
 assert.equal(end,args.normalizedText.length);assert.equal(n.windows.reduce((sum,w)=>sum+w.weight,0),offsets.length-1);assert.equal(n.windows.at(-1).source_ranges[0].include_end_zero_width,true);const stale=clone(out.artifact);stale.nodes[0].windows[0].segmentation='native_all_language_exhaustive_codepoint_partition_v1';assert.throws(()=>verify(args,stale));
});

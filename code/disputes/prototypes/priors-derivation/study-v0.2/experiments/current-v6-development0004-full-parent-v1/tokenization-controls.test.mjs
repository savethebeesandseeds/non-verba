// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic text only; no tokenizer package/model/source-case access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import * as trial from './representation.mjs';
import {nativeEmbeddingWindows} from './tokenization-planner.mjs';
import {windowLiteralCoverage,completeSourceCoverage,ROOT_ACTIVATED} from './tokenization-run.mjs';
import {traceNativeDecoration,bindNativeDecoration} from '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/source-decoration.mjs';
import {NATIVE_COLLECTOR_POLICY} from '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/sections.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const target=trial.FULL_STORED_PARENT_TARGET;
const witness='SYNTHETIC Holder consent exception and waiver witness.';
let parentText=('context '.repeat(1200)).slice(0,target.parent_end-target.parent_start);
parentText=parentText.slice(0,16)+witness+parentText.slice(16+witness.length);
const fullText='p'.repeat(target.parent_start)+parentText+' synthetic suffix';
const markStart=target.parent_start+16,markEnd=markStart+witness.length;
const raw='<span>'+fullText.slice(0,markStart)+'</span><u>'+fullText.slice(markStart,markEnd)+'</u><span>'+fullText.slice(markEnd)+'</span>';
const trace=traceNativeDecoration(raw),normalizedText=trace.runs.map(run=>run.decoded_text).join('');
assert.equal(normalizedText,fullText);
let offset=0;
const envelope=bindNativeDecoration(trace,{raw,normalizedText,tracerSourceSHA256:'a'.repeat(64),collectorSourceSHA256:'b'.repeat(64),collectorSegments:trace.runs.map(run=>{const start=offset;offset+=run.decoded_text.length;return {normalized_start:start,normalized_end:offset,sources:[{run_id:run.id,decoded_start:0,decoded_end:run.decoded_text.length}],normalization:'EXACT_DECODED'};})});
const parent={id:'synthetic-parent',contract_id:target.contract_id,cohort:'synthetic-control',start:target.parent_start,end:target.parent_end,sha256:sha(parentText)};
const unit={id:'synthetic-unit',parent_section_id:parent.id,contract_id:parent.contract_id,cohort:parent.cohort,start:target.unit_start,end:target.unit_end,text:normalizedText.slice(target.unit_start,target.unit_end),source_navigation:{nearest_anchor:null,within_unit:[],scope:'LITERAL_SOURCE_NAVIGATION_ONLY',governing_hierarchy_verified:false}};
unit.sha256=sha(unit.text);
unit.native_source_decorations_ref={envelope_sha256:envelope.sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,policy:envelope.policy,collector_policy:NATIVE_COLLECTOR_POLICY,start:unit.start,end:unit.end,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,projection_required:true};
const contextFor=api=>api.createNativeSourceContext({raw,normalizedText,envelope,expectedTracerSourceSHA256:'a'.repeat(64),expectedCollectorSourceSHA256:'b'.repeat(64)});
const opts=()=>({context:contextFor(trial),parent,contextScope:trial.FULL_STORED_PARENT_TRIAL,trialAuditId:target.audit_id});
const full=()=>trial.createNativeRepresentation(unit,opts());

test('planner/constants/helper are exact S6 source and worker import is inactive',()=>{
 const s=fs.readFileSync('/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/embedding.mjs','utf8');
 const p=fs.readFileSync(new URL('./tokenization-planner.mjs',import.meta.url),'utf8');
 const block=s.slice(s.indexOf('export const NATIVE_WINDOW_LIMITS'),s.indexOf('\n/** Source-only readiness'));
 assert.ok(p.endsWith(block+'\n\n'));
 assert.ok(p.includes(s.match(/^function integer[^\n]+/mu)[0]));
 assert.equal(ROOT_ACTIVATED,false);
});
test('same-instance synthetic native windows fully cover parent and independently recount',()=>{
 const rep=full();let calls=0;const cost=s=>Math.ceil(s.length/8)+2;
 const windows=nativeEmbeddingWindows(rep,s=>{calls++;return cost(s);},{maxTokens:256,overlapWords:16,limits:{maxEncodeProbes:2000,maxTokenizerCalls:2000,maxWindows:512,maxSourceCharacters:9113}});
 assert.ok(windows.length>1&&windows.length<=512&&calls<=2000);
 const ranges=windows.map(w=>{assert.equal(cost(w.text),w.tokens);assert.ok(w.tokens<=256);assert.equal(w.sha256,sha(w.text));assert.equal(w.source_ranges.length,1);assert.equal(w.source_ranges[0].start,parent.start+w.source_utf16_start);return w.source_ranges[0];});
 assert.equal(completeSourceCoverage(ranges,parent),true);
});
test('literal co-presence distinguishes whole qualifier, start point and whole first word',()=>{
 assert.deepEqual(windowLiteralCoverage({start:56665,end:57291}),{full_qualifier:true,covenant_start_point:true,whole_first_selected_word:true,qualifier_and_start_point:true,qualifier_and_whole_first_word:true});
 assert.equal(windowLiteralCoverage({start:56665,end:57285}).qualifier_and_whole_first_word,false);
 assert.equal(windowLiteralCoverage({start:56665,end:57285}).qualifier_and_start_point,true);
 assert.equal(windowLiteralCoverage({start:56666,end:57291}).qualifier_and_whole_first_word,false);
 assert.equal(windowLiteralCoverage({start:56665,end:57284}).qualifier_and_start_point,false);
 assert.throws(()=>windowLiteralCoverage({start:1,end:1}),/TOKENIZATION_COVERAGE_RANGE/);
});
test('coverage gaps/tails and planner bounds retain HOLD rather than partial success',()=>{
 assert.throws(()=>completeSourceCoverage([{start:parent.start+1,end:parent.end}],parent),/COVERAGE_GAP/);
 assert.throws(()=>completeSourceCoverage([{start:parent.start,end:parent.end-1}],parent),/COVERAGE_TAIL/);
 assert.throws(()=>nativeEmbeddingWindows(full(),()=>1,{limits:{maxEncodeProbes:1,maxTokenizerCalls:1,maxWindows:512}}),e=>e.code==='NATIVE_WINDOW_SEARCH_BOUND'&&e.retained_failure===true&&e.partial_stream_accepted===false&&e.work.encode_probes===1);
 assert.throws(()=>nativeEmbeddingWindows(full(),()=>NaN),e=>e.code==='NATIVE_WINDOW_TOKENIZER_FAILURE');
});


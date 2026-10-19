// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic source-free controls: target IDs/ranges are technical fixtures only.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as trial from './representation.mjs';
import * as original from '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/representation.mjs';
import {traceNativeDecoration,bindNativeDecoration,createNativeDecorationView} from '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/source-decoration.mjs';
import {NATIVE_COLLECTOR_POLICY} from '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/sections.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const started=performance.now();
after(()=>{const maxRSS=process.resourceUsage().maxRSS*1024;assert.ok(maxRSS<=536870912);console.log(JSON.stringify({schema:'source-free-full-parent-controls-v1',actual_sources_read:0,model_calls:0,tokenizer_callbacks:0,max_RSS_bytes:maxRSS,elapsed_ms:Math.ceil(performance.now()-started)}));});
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

test('default descriptor, identity and native bytes equal unchanged frozen S6',()=>{
 const oldRep=original.createNativeRepresentation(unit,{context:contextFor(original),parent});
 const newRep=trial.createNativeRepresentation(unit,{context:contextFor(trial),parent});
 assert.deepEqual(newRep,oldRep);
 assert.deepEqual(trial.nativeRepresentationWindow(newRep),original.nativeRepresentationWindow(oldRep));
 assert.deepEqual(trial.modelInputIdentity({...unit,native_input:newRep}),original.modelInputIdentity({...unit,native_input:oldRep}));
 assert.equal(Object.hasOwn(newRep.descriptor,'context_scope'),false);
});
test('default retains sixty-word guard',()=>{
 assert.throws(()=>trial.createNativeRepresentation(unit,{context:contextFor(trial),parent,bodyRange:parent}),/sixty/);
});
test('opt-in contains exactly original parent and focal, with distinct prospective identity',()=>{
 const rep=full();
 assert.equal(rep.text,parentText);assert.equal(rep.text.length,9113);
 assert.equal(rep.text.slice(2763,4505),unit.text);
 assert.equal(rep.descriptor.policy,trial.FULL_STORED_PARENT_POLICY);
 assert.equal(rep.descriptor.neighbor_words.maximum,null);
 assert.ok(rep.descriptor.neighbor_words.before+rep.descriptor.neighbor_words.after>60);
 assert.equal(rep.descriptor.outside_parent_context_verified,false);
 assert.equal(rep.descriptor.semantic_sufficiency_verified,false);
 assert.equal(rep.descriptor.authority,'NONE');
 assert.equal(rep.descriptor.effectiveness_verified,false);
 assert.equal(rep.descriptor.computed_style_verified,false);
 assert.ok(Object.isFrozen(rep.descriptor.parts[0]));
 const base=trial.createNativeRepresentation(unit,{context:contextFor(trial),parent});
 assert.notEqual(rep.input_sha256,base.input_sha256);
});
test('full native encoding is byte-identical to original current native view',()=>{
 const rep=full(),encoded=trial.nativeRepresentationWindow(rep);
 const direct=createNativeDecorationView(envelope,{raw,normalizedText}).input({start:parent.start,end:parent.end,includeEndZeroWidth:true});
 assert.equal(encoded.text,direct.text);
 assert.equal(encoded.sha256,sha(direct.text));
 assert.ok(encoded.text.includes(witness));
 assert.equal(encoded.source_ranges.length,1);
 assert.equal(encoded.source_ranges[0].start,parent.start);
 assert.equal(encoded.source_ranges[0].end,parent.end);
 assert.equal(encoded.source_ranges[0].source_sha256,parent.sha256);
 assert.equal(encoded.window_annotations_self_contained,true);
 assert.ok(encoded.text.includes('NATIVE_SOURCE_MARKS_UNVERIFIED'));
});
test('explicit opt-in rejects other audit, contract, parent, focal or selected range',()=>{
 assert.throws(()=>trial.createNativeRepresentation(unit,{...opts(),trialAuditId:'development-0005'}),/restricted/);
 assert.throws(()=>trial.createNativeRepresentation({...unit,contract_id:'other'},{...opts(),parent:{...parent,contract_id:'other'}}),/restricted/);
 const shifted={...parent,start:parent.start+1,sha256:sha(normalizedText.slice(parent.start+1,parent.end))};
 assert.throws(()=>trial.createNativeRepresentation(unit,{...opts(),parent:shifted}),/restricted/);
 const shortened={...unit,end:unit.end-1,text:unit.text.slice(0,-1)};
 shortened.sha256=sha(shortened.text);shortened.native_source_decorations_ref={...unit.native_source_decorations_ref,end:shortened.end};
 assert.throws(()=>trial.createNativeRepresentation(shortened,opts()),/restricted/);
 assert.throws(()=>trial.createNativeRepresentation(unit,{...opts(),bodyRange:{start:unit.start,end:unit.end}}),/complete original/);
 assert.throws(()=>trial.createNativeRepresentation(unit,{...opts(),contextScope:'OTHER'}),/Unknown/);
 assert.throws(()=>trial.createNativeRepresentation(unit,{context:contextFor(trial),parent,trialAuditId:target.audit_id}),/explicit/);
});
test('authentication, same-module ownership, heading and source hashes remain enforced',()=>{
 assert.throws(()=>trial.createNativeRepresentation(unit,{...opts(),context:contextFor(original)}),/Authenticated/);
 assert.throws(()=>trial.nativeRepresentationWindow({...full()}),/Authenticated/);
 assert.throws(()=>trial.createNativeRepresentation(unit,{...opts(),includeHeading:true}),/heading promotion/);
 assert.throws(()=>trial.createNativeRepresentation({...unit,sha256:'0'.repeat(64)},opts()),/text\/hash/);
 assert.throws(()=>trial.createNativeRepresentation(unit,{...opts(),parent:{...parent,sha256:'0'.repeat(64)}}),/parent binding/);
});
test('pretokenization windows retain exact source ranges and terminal ownership',()=>{
 const rep=full(),cut=2763;
 const left=trial.nativeRepresentationWindow(rep,{start:0,end:cut}),right=trial.nativeRepresentationWindow(rep,{start:cut,end:rep.text.length});
 const view=createNativeDecorationView(envelope,{raw,normalizedText});
 assert.equal(left.text,view.input({start:parent.start,end:parent.start+cut,includeEndZeroWidth:false}).text);
 assert.equal(right.text,view.input({start:parent.start+cut,end:parent.end,includeEndZeroWidth:true}).text);
 assert.equal(left.source_ranges[0].end,right.source_ranges[0].start);
 assert.throws(()=>trial.nativeRepresentationWindow(rep,{start:0,end:rep.text.length+1}),/UTF16/);
});


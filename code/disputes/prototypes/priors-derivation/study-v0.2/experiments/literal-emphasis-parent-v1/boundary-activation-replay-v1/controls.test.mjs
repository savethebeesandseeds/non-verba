// SPDX-License-Identifier: AGPL-3.0-only
// Internally authored SOURCE_FREE HTML only; no actual packets or IO permits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSections as baselineExtract} from '../sections.prototype.mjs';
import {extractSections as frozenV2Extract} from '../list-governor-boundary-v2/sections.prototype.mjs';
import {probeExtractSections} from '../boundary-activation-probe-v1/sections.prototype.mjs';
import {createBoundaryProbe,verifyBoundaryProbe,projectBoundaryProbe} from '../boundary-activation-probe-v1/probe.mjs';
import {digest} from '../finite-codec.mjs';
import {COMPARISON_CASES,COMPARISON_ROWS} from '../source-only-adverse-comparison-v1/fixed-cases.mjs';
import {REPLAY_METHODS as M,measureReplayInvariants,measureProbeObservation,prepareBoundaryReplay} from './kernel.mjs';
const caption=(n,title,styledNumber=true)=>styledNumber?`<p><b><u>${n}. ${title}</u></b></p>`:`<p>${n}. <b><u>${title}</u></b></p>`;
function fixture(styledNumber=true){return'<html><body>'+caption(1,'Permission',styledNumber)+'<p>The synthetic holder may proceed only under the following conditions:</p><p>(i) The synthetic applicant delivers the form;</p><p>(ii) The synthetic applicant pays the amount;</p><p>This synthetic qualification applies to every condition.</p>'+caption(2,'Notices',styledNumber)+'<p>The synthetic holder must send the notice.</p></body></html>';}
function extracted(raw,fn,collector){return fn({id:'SYNTHETIC_REPLAY_DOCUMENT',format:'html',source_url:'https://synthetic.invalid/replay',content:raw},{minWords:1,maxUnitWords:300,nativeDecorationIdentity:{tracerSourceSHA256:M.tracer_sha256,collectorSourceSHA256:collector}});}
function pair(styledNumber=true){const raw=fixture(styledNumber),baseline=extracted(raw,baselineExtract,M.baseline_collector_sha256),frozenV2=extracted(raw,frozenV2Extract,M.frozen_v2_collector_sha256),observed=extracted(raw,probeExtractSections,M.variant_collector_sha256),variant=observed.extraction,focal=baseline.units[0],parent=baseline.sections[0];return{raw,baseline,frozenV2,variant,probe:observed.probe,expectedNative:structuredClone(baseline.native_source_decorations),originalFocal:{id:focal.id,start:focal.start,end:focal.end,sha256:focal.sha256},originalParent:{id:parent.id,start:parent.start,end:parent.end,sha256:parent.sha256}};}
function facts(p,result,collectorSHA256){return measureReplayInvariants({...p,result,collectorSHA256,normalizedText:p.baseline.normalized_text});}
const deny=(fn,code)=>assert.throws(fn,e=>e.code===code);
function reseal(e){delete e.trace.sha256;e.trace.sha256=digest(e.trace);delete e.sha256;e.sha256=digest(e);}

test('diagnostic collector observes frozen V2 while preserving its synthetic boundary change',()=>{
  const p=pair(),a=facts(p,p.baseline,M.baseline_collector_sha256),b=facts(p,p.variant,M.variant_collector_sha256);
  assert.equal(a.section_count,1);assert.equal(b.section_count,2);assert.equal(a.original_focal_identity_present,true);assert.equal(a.original_parent_identity_present,true);
  assert.equal(b.original_parent_identity_present,false);assert.notEqual(a.geometry_sha256,b.geometry_sha256);assert.equal(b.closure_hypothesis_count,1);assert.equal(b.frame_hypothesis_count,1);
  assert.equal(a.native_invariant_sha256,b.native_invariant_sha256);assert.equal(a.trace_sha256,b.trace_sha256);assert.equal(a.segments_sha256,b.segments_sha256);assert.equal(a.unknowns_sha256,b.unknowns_sha256);assert.notEqual(a.native_envelope_sha256,b.native_envelope_sha256);
  assert.equal(b.current_parent_overlaps.length,2);assert.equal(b.focal_coverage.uncovered_non_whitespace_utf16,0);assert.ok(b.focal_coverage.uncovered_utf16>0);assert.equal(b.selection_recomputed,false);assert.equal(b.quality_gate_pass,false);
  const observed=measureProbeObservation({frozenV2:p.frozenV2,diagnostic:p.variant,probe:p.probe});
  assert.deepEqual(observed,projectBoundaryProbe(p.probe));assert.equal(verifyBoundaryProbe(p.probe),true);assert.equal(observed.truncated,false);assert.ok(observed.event_count>0);assert.ok(Object.isFrozen(observed));assert.ok(Object.isFrozen(observed.counters));
  assert.equal(facts(p,p.frozenV2,M.frozen_v2_collector_sha256).geometry_sha256,b.geometry_sha256);
});

test('bare numeric prefix probe remains observationally equal to frozen V2',()=>{
  const p=pair(false),a=facts(p,p.baseline,M.baseline_collector_sha256),b=facts(p,p.variant,M.variant_collector_sha256);
  assert.equal(a.section_count,1);assert.equal(b.section_count,2);assert.equal(b.closure_hypothesis_count,1);assert.equal(b.frame_hypothesis_count,1);
  assert.notEqual(a.geometry_sha256,b.geometry_sha256);assert.equal(b.original_parent_identity_present,false);
  assert.equal(a.native_invariant_sha256,b.native_invariant_sha256);assert.equal(a.trace_sha256,b.trace_sha256);assert.equal(a.segments_sha256,b.segments_sha256);assert.equal(a.unknowns_sha256,b.unknowns_sha256);
  assert.deepEqual(measureProbeObservation({frozenV2:p.frozenV2,diagnostic:p.variant,probe:p.probe}),projectBoundaryProbe(p.probe));
});

test('probe comparison preserves unknown non-excluded fields and rejects witness tampering',()=>{
  const p=pair(),changed=structuredClone(p.variant);changed.synthetic_unknown_preserved_field={value:1};
  deny(()=>measureProbeObservation({frozenV2:p.frozenV2,diagnostic:changed,probe:p.probe}),'REPLAY_PROBE_V2_CORE_DIFFERENCE');
  const corrupted=structuredClone(p.probe);corrupted.event_count+=1;
  assert.throws(()=>measureProbeObservation({frozenV2:p.frozenV2,diagnostic:p.variant,probe:corrupted}));
  const recorder=createBoundaryProbe(),event={stage:1,reason_mask:0,block_sha256:'1'.repeat(64),block_utf16:1};let admitted=0;
  deny(()=>{for(;admitted<4096;admitted++)recorder.record(event);},'PROBE_BOUND');
  assert.ok(admitted>0);deny(()=>recorder.finish(),'PROBE_BOUND');
});
test('a changed normalized literal is rejected instead of accepted as geometry drift',()=>{
  const p=pair();p.variant.normalized_text+=' SYNTHETIC_MUTATION';deny(()=>facts(p,p.variant,M.variant_collector_sha256),'REPLAY_NORMALIZED_LITERAL');
});

test('baseline identity and original focal/parent geometry must both be exact',()=>{
  const p=pair(),wrong=structuredClone(p.originalFocal);wrong.sha256='0'.repeat(64);deny(()=>facts({...p,originalFocal:wrong},p.baseline,M.baseline_collector_sha256),'REPLAY_ORIGINAL_LITERAL_BINDING');
  const id=structuredClone(p.originalParent);id.id='SYNTHETIC_FORGED_PARENT';deny(()=>facts({...p,originalParent:id},p.baseline,M.baseline_collector_sha256),'REPLAY_BASELINE_ORIGINAL_GEOMETRY');
  deny(()=>facts(p,p.baseline,'0'.repeat(64)),'REPLAY_METHOD_IDENTITY');
});

test('re-sealed native unknown/error changes cannot pass literal preservation alone',()=>{
  const p=pair();p.variant.native_source_decorations.trace.parser_errors.push({code:'SYNTHETIC_ADDITIONAL_PARSER_FACT',start:0,end:0});reseal(p.variant.native_source_decorations);assert.throws(()=>facts(p,p.variant,M.variant_collector_sha256));
});

test('scoped native references must follow the new envelope and new row geometry',()=>{
  const p=pair();p.variant.units[0].native_source_decorations_ref=structuredClone(p.baseline.units[0].native_source_decorations_ref);deny(()=>facts(p,p.variant,M.variant_collector_sha256),'REPLAY_SCOPED_NATIVE_REFERENCE');
});

test('facts contain only static codes, numbers, booleans, hashes and numeric intervals',()=>{
  const p=pair(),b=facts(p,p.variant,M.variant_collector_sha256),serialized=JSON.stringify(b);
  assert.ok(!serialized.includes('Permission'));assert.ok(!serialized.includes('synthetic applicant'));assert.ok(!serialized.includes('source_url'));assert.ok(!serialized.includes('SYNTHETIC_REPLAY_DOCUMENT'));
  assert.ok(Object.isFrozen(b));assert.ok(Object.isFrozen(b.current_parent_overlaps));assert.ok(Object.isFrozen(b.focal_coverage));
});

test('text disguised as a numeric replay fact is rejected',()=>{
  const p=pair();p.variant.sections[0].word_count='SYNTHETIC_NOT_A_NUMBER';deny(()=>facts(p,p.variant,M.variant_collector_sha256),'REPLAY_SECTION_GEOMETRY');
});

test('actual preparation has no unknown-case/0048 or source-free admission bypass',()=>{
  for(const binding of[{}, {...structuredClone(COMPARISON_CASES[0]),audit_id:'development-0048'}, {source_kind:'SOURCE_FREE_FIXTURE'}])deny(()=>prepareBoundaryReplay({binding}),'REPLAY_FIXED_BINDING');
  deny(()=>prepareBoundaryReplay({binding:COMPARISON_CASES[0],rawBytes:Buffer.alloc(0),normalizedBytes:Buffer.alloc(0),baselineNativeBytes:Buffer.alloc(0)}),'REPLAY_BUFFER_BOUND');
  deny(()=>prepareBoundaryReplay({binding:COMPARISON_CASES[0],row:COMPARISON_ROWS[0],record:{},currentCache:{},sourceProof:{},freshGuard:{},custody:{},rawBytes:Buffer.from('SYNTHETIC_RAW'),normalizedBytes:Buffer.from('SYNTHETIC_NORMALIZED'),baselineNativeBytes:Buffer.from('{}')}),'REPLAY_CURRENT_SOURCE');
});

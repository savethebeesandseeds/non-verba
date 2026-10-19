// SPDX-License-Identifier: AGPL-3.0-only
// Real collector on internally authored SOURCE_FREE HTML only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractSections} from '../sections.prototype.mjs';
import {sha,digest} from '../finite-codec.mjs';
import {projectFocalContext,summarizeFocalContext,verifyFocalContext,CONTEXT_LIMITS} from './projection.mjs';
const tracer=sha(readFileSync(new URL('../source-decoration.prototype.mjs',import.meta.url))),collector=sha(readFileSync(new URL('../sections.prototype.mjs',import.meta.url)));
const words=Array.from({length:38},()=> 'retains').join(' ');
const longItems=Array.from({length:20},(_,i)=>`<p>(${String.fromCharCode(97+i)}) The synthetic applicant ${words} every stated source condition;</p>`).join('');
function extract(body){
  const raw=`<html><body><p>Section 1 Permission</p>${body}</body></html>`;
  const result=extractSections({id:'SYNTHETIC_CONTEXT_DOCUMENT',format:'html',source_url:'https://synthetic.invalid/context',content:raw},{minWords:1,maxUnitWords:300,nativeDecorationIdentity:{tracerSourceSHA256:tracer,collectorSourceSHA256:collector}});
  assert.equal(result.status,'accepted');return result;
}
function fixture(){
  const extraction=extract('<p>Earlier synthetic antecedent remains outside the introduced frame.</p><p>The synthetic holder may proceed only under the following conditions:</p>'+longItems+'<p>This synthetic shared qualification governs every listed source item.</p>');
  const focal=extraction.units.find(u=>u.chunk_index===1&&u.governor_frame_ids.length);assert.ok(focal);return{extraction,focal};
}
function project(p,limits){return projectFocalContext({extraction:p.extraction,focal_id:p.focal.id,limits});}
function verify(p,result,limits){assert.equal(verifyFocalContext({artifact:result.artifact,extraction:p.extraction,focal_id:p.focal.id,limits}),true);assert.deepEqual(summarizeFocalContext(result.artifact),result.metadata);}
const binding=fn=>assert.throws(fn,e=>e.code==='SOURCE_CONTEXT_BINDING');

test('complete existing frame restores literal lead-in and shared qualification while frozen focal stays exact',()=>{
  const p=fixture(),before=digest(p.extraction),r=project(p);verify(p,r);
  assert.ok(!p.focal.text.includes('following conditions'));assert.ok(!p.focal.text.includes('shared qualification'));
  assert.equal(r.artifact.status,'PROJECTED_EXISTING_SOURCE_FRAMES_UNVERIFIED');assert.deepEqual(r.artifact.focal,p.focal);assert.equal(r.artifact.focal.id,p.focal.id);
  assert.equal(r.artifact.contexts.length,1);const c=r.artifact.contexts[0];
  assert.equal(c.text,p.extraction.normalized_text.slice(c.frame.start,c.frame.end));assert.ok(c.text.includes('following conditions'));assert.ok(c.text.includes('shared qualification'));
  assert.ok(!c.text.includes('Earlier synthetic antecedent'));assert.equal(c.frame.governor.text,p.extraction.normalized_text.slice(c.frame.governor.start,c.frame.governor.end));
  assert.equal(r.artifact.parent_reference.role,'PARENT_REVIEW_CONTEXT_UNVERIFIED');assert.equal(Object.hasOwn(r.artifact.parent_reference,'text'),false);
  assert.equal(r.artifact.context_adequate,null);assert.equal(r.artifact.antecedents_reviewed,false);assert.equal(r.artifact.later_governors_complete,false);assert.equal(r.artifact.governance_verified,false);
  assert.equal(r.artifact.selection_recomputed,false);assert.equal(r.artifact.native_projection_performed,false);assert.equal(digest(p.extraction),before);assert.ok(Object.isFrozen(c.frame));
});

test('numeric frame followed by a second colon list does not invent a second governing span',()=>{
  const extraction=extract('<p>The first synthetic requirement introduces these obligations:</p><p>1. The synthetic applicant '+words+' every first source condition;</p><p>2. The synthetic applicant '+words+' every second source condition;</p><p>The second synthetic requirement introduces these additional conditions:</p>'+longItems+'<p>This synthetic shared qualification remains literal.</p>');
  const focal=extraction.units.find(u=>u.chunk_index===1&&u.governor_frame_ids.length),p={extraction,focal};assert.ok(focal);
  const r=project(p);verify(p,r);const c=r.artifact.contexts[0];
  assert.ok(c.text.includes('second synthetic requirement'));assert.ok(c.frame.governor.text.includes('first synthetic requirement'));assert.ok(!c.frame.governor.text.includes('second synthetic requirement'));
  assert.equal(r.artifact.later_governors_complete,false);assert.equal(r.artifact.context_adequate,null);
});

test('unnumbered literal governor is retained without heading/number substitution; missing evidence stays unresolved',()=>{
  const p=fixture(),r=project(p);assert.ok(!/^\d/u.test(r.artifact.contexts[0].frame.governor.text));
  const missing=structuredClone(p.extraction),focal=missing.units.find(u=>u.id===p.focal.id),parent=missing.sections.find(s=>s.id===focal.parent_section_id);parent.governor_frames[0].governor=null;
  const q={extraction:missing,focal},unknown=project(q);verify(q,unknown);assert.equal(unknown.artifact.status,'UNRESOLVED_CONTEXT_SCOPE');assert.ok(unknown.artifact.reason_codes.includes('MISSING_STORED_GOVERNOR_EVIDENCE'));assert.equal(unknown.artifact.contexts[0].governor_evidence_present,false);
  const absent=structuredClone(p.extraction),u=absent.units.find(u=>u.id===p.focal.id),s=absent.sections.find(s=>s.id===u.parent_section_id);s.governor_frames=[];
  const a={extraction:absent,focal:u},noFrame=project(a);verify(a,noFrame);assert.equal(noFrame.artifact.status,'UNRESOLVED_CONTEXT_SCOPE');assert.equal(noFrame.artifact.contexts.length,0);assert.deepEqual(noFrame.artifact.focal,u);
  const noRefs=structuredClone(p.extraction),v=noRefs.units.find(u=>u.id===p.focal.id);delete v.governor_frame_ids;
  const n={extraction:noRefs,focal:v},none=project(n);verify(n,none);assert.ok(none.artifact.reason_codes.includes('NO_STORED_FRAME_REFERENCES'));
});

test('duplicate IDs, altered ranges/hashes/literals and corrupt native references are integrity failures',()=>{
  for(const mutate of[
    (e,u,s)=>e.units.push(structuredClone(u)),
    (e,u,s)=>s.governor_frames.push(structuredClone(s.governor_frames[0])),
    (e,u,s)=>{u.text+=' SYNTHETIC_CORRUPTION';},
    (e,u,s)=>{s.governor_frames[0].sha256='0'.repeat(64);},
    (e,u,s)=>{s.governor_frames[0].end=s.end+1;},
    (e,u,s)=>{s.governor_frames[0].governor.text+=' SYNTHETIC_CORRUPTION';},
    (e,u,s)=>{u.native_source_decorations_ref.start++;},
    (e,u,s)=>{delete s.native_source_decorations_ref.normalized_sha256;},
    (e,u,s)=>{s.completeness.semantic_completeness_verified=true;}
  ]){const p=fixture(),e=structuredClone(p.extraction),u=e.units.find(u=>u.id===p.focal.id),s=e.sections.find(s=>s.id===u.parent_section_id);mutate(e,u,s);binding(()=>projectFocalContext({extraction:e,focal_id:u.id}));}
});

test('direct collector native raw hash is sealed; optional processor raw hash is checked only when present',()=>{
  const p=fixture();assert.equal(Object.hasOwn(p.extraction,'raw_sha256'),false);const direct=project(p);verify(p,direct);
  const e=structuredClone(p.extraction);e.raw_sha256=e.native_source_decorations.raw.sha256;const q={extraction:e,focal:e.units.find(u=>u.id===p.focal.id)},cacheShape=project(q);verify(q,cacheShape);
  for(const value of['0'.repeat(64),undefined,null]){const bad=structuredClone(e);bad.raw_sha256=value;binding(()=>projectFocalContext({extraction:bad,focal_id:p.focal.id}));}
  const broken=structuredClone(p.extraction);broken.native_source_decorations.raw.sha256='0'.repeat(64);binding(()=>projectFocalContext({extraction:broken,focal_id:p.focal.id}));
  const invalid=structuredClone(p.extraction),native=invalid.native_source_decorations;native.raw.sha256='SYNTHETIC_INVALID_RAW_HASH';delete native.sha256;native.sha256=digest(native);binding(()=>projectFocalContext({extraction:invalid,focal_id:p.focal.id}));
});

test('exact final combined byte threshold admits once; next lower byte fails without partial context',()=>{
  const p=fixture(),full=project(p);let n=full.metadata.combined_payload_bytes;
  for(let i=0;i<16;i++){const a=structuredClone(full.artifact);a.limits.context_payload_bytes=n;const next=summarizeFocalContext(a).combined_payload_bytes;if(next===n)break;n=next;}
  const limits={context_payload_bytes:n,max_context_spans:32},exact=project(p,limits);verify(p,exact,limits);assert.equal(exact.artifact.status,'PROJECTED_EXISTING_SOURCE_FRAMES_UNVERIFIED');assert.equal(exact.metadata.combined_payload_bytes,n);
  const lower={...limits,context_payload_bytes:n-1},failed=project(p,lower);verify(p,failed,lower);assert.equal(failed.artifact.status,'CONTEXT_SCOPE_TOO_LARGE');assert.equal(failed.artifact.focal,null);assert.equal(failed.artifact.contexts.length,0);assert.equal(failed.artifact.parent_reference.id,full.artifact.parent_reference.id);assert.equal(failed.artifact.source_text_truncated,false);
  for(const limits of[{context_payload_bytes:262145},{max_context_spans:33},{max_context_spans:0},{unknown_limit:1}])assert.throws(()=>project(p,limits),e=>e.code==='INVALID_INPUT');
});

test('an oversized whole focal record becomes a bounded refs-only resource failure',()=>{
  const p=fixture(),e=structuredClone(p.extraction),focal=e.units.find(u=>u.id===p.focal.id);focal.synthetic_retained_metadata='SYNTHETIC_PADDING '.repeat(20000);
  const q={extraction:e,focal},r=project(q);verify(q,r);assert.equal(r.artifact.status,'CONTEXT_SCOPE_TOO_LARGE');assert.equal(r.artifact.focal,null);assert.equal(r.artifact.contexts.length,0);assert.ok(r.metadata.combined_payload_bytes<CONTEXT_LIMITS.context_payload_bytes);assert.equal(r.artifact.focal_reference.focal_record_sha256,digest(focal));
});

test('failure reference envelopes also have a hard bound even with tiny requested limits',()=>{
  const p=fixture(),small=project(p,{context_payload_bytes:1});verify(p,small,{context_payload_bytes:1});assert.equal(small.artifact.status,'CONTEXT_SCOPE_TOO_LARGE');assert.ok(small.metadata.combined_payload_bytes<=262144);
  const e=structuredClone(p.extraction),focal=e.units.find(u=>u.id===p.focal.id),parent=e.sections.find(s=>s.id===focal.parent_section_id);parent.native_source_decorations_ref.synthetic_unknown_large='SYNTHETIC_REF_METADATA '.repeat(20000);
  assert.throws(()=>projectFocalContext({extraction:e,focal_id:focal.id}),error=>error.code==='CONTEXT_SCOPE_TOO_LARGE'&&error.reason==='FAILURE_ENVELOPE_BOUND'&&error.full_parent_reference.id_sha256===sha(parent.id)&&JSON.stringify(error).length<2048);
});

test('unknown native/frame fields remain exact and returned metadata exposes no source text',()=>{
  const p=fixture(),e=structuredClone(p.extraction),focal=e.units.find(u=>u.id===p.focal.id),parent=e.sections.find(s=>s.id===focal.parent_section_id);
  focal.native_source_decorations_ref.synthetic_unknown={hash:'b'.repeat(64),observed:false};parent.native_source_decorations_ref.synthetic_unknown={hash:'c'.repeat(64),counts:[0,2]};parent.governor_frames[0].synthetic_native_unknown={role_hash:'d'.repeat(64),value:null};
  const q={extraction:e,focal},r=project(q);verify(q,r);assert.deepEqual(r.artifact.focal.native_source_decorations_ref,focal.native_source_decorations_ref);assert.deepEqual(r.artifact.parent_reference.native_source_decorations_ref,parent.native_source_decorations_ref);assert.deepEqual(r.artifact.contexts[0].frame.synthetic_native_unknown,parent.governor_frames[0].synthetic_native_unknown);
  const words=JSON.stringify(r.metadata);assert.equal(words.includes('synthetic applicant'),false);assert.equal(words.includes('SYNTHETIC_CONTEXT_DOCUMENT'),false);assert.equal(words.includes('https://'),false);
  focal.native_source_decorations_ref.synthetic_unknown.observed=true;assert.equal(r.artifact.focal.native_source_decorations_ref.synthetic_unknown.observed,false);
});

test('independent verifier rejects clipped, forged, reordered, relabeled or adequate context',()=>{
  const p=fixture(),good=project(p);
  for(const mutate of[
    a=>{a.contexts[0].text=a.contexts[0].text.slice(1);},a=>{a.contexts[0].frame.start++;},a=>{a.contexts[0].role='PARENT_REVIEW_CONTEXT_UNVERIFIED';},a=>{a.context_adequate=true;},a=>{a.focal.text+=' SYNTHETIC_FORGED_FOCAL';},a=>{a.source_frame_ids=['SYNTHETIC_FORGED_FRAME'];},a=>{a.unrecognized_claim=true;},a=>{a.status='CONTEXT_SCOPE_TOO_LARGE';a.focal=null;a.contexts=[];a.reason_codes=['SPAN_LIMIT'];a.required_bytes_basis='SPAN_COUNT';}
  ]){const artifact=structuredClone(good.artifact);mutate(artifact);binding(()=>verifyFocalContext({artifact,extraction:p.extraction,focal_id:p.focal.id}));}
});

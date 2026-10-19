// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE: real collector, internally authored HTML; no actual IO or models.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractSections} from '../sections.prototype.mjs';
import {sha,digest,decodeModelText} from '../finite-codec.mjs';
import {projectFocalContext} from '../focal-context-projection-v1/projection.mjs';
import {buildMatchedContextArms,verifyMatchedContextArms,summarizeMatchedContextArms,LIMITS,ARM_ORDER,FAILURE_ENVELOPE_BYTES} from './arms.mjs';
const tracer=sha(readFileSync(new URL('../source-decoration.prototype.mjs',import.meta.url))),collector=sha(readFileSync(new URL('../sections.prototype.mjs',import.meta.url)));
const words=Array.from({length:40},(_,i)=>'retains'+i).join(' ');
function fixture(){
 const items=Array.from({length:15},(_,i)=>`<p>(${String.fromCharCode(97+i)}) The synthetic holder ${words} the listed obligation and its deadline;</p>`).join('');
 const raw='<html><body><h1>Section 1 General Conditions</h1><p>GLOBAL_SYNTHETIC_QUALIFICATION applies across the available document, subject to the unavailable synthetic exhibit.</p><h1>Section 2 Controlled Provision</h1><p>53. The synthetic holder must satisfy all the following obligations:</p>'+items+'<p>SHARED_SYNTHETIC_CONSEQUENCE applies to every listed item and continues after the sampled chunk.</p><h1>Section 3 Later Terms</h1><p>LATER_SYNTHETIC_GLOBAL remains available beyond the sampled parent; this source does not reconstruct any missing attachment.</p></body></html>';
 const extraction=extractSections({id:'SYNTHETIC_MATCHED_CONTEXT',format:'html',source_url:'https://synthetic.invalid/matched-context',content:raw},{minWords:1,maxUnitWords:300,nativeDecorationIdentity:{tracerSourceSHA256:tracer,collectorSourceSHA256:collector}});
 assert.equal(extraction.status,'accepted');const focal=extraction.units.find(u=>u.chunk_index===1&&u.governor_frame_ids.length);assert.ok(focal);
 // The real input contract is a retained JSON artifact, not collector aliases.
 return bind(JSON.parse(JSON.stringify(extraction)),focal.id);
}
function bind(extraction,focal_id){return{extraction,focal_id,projection:projectFocalContext({extraction,focal_id}).artifact};}
function syncNested(e,u){const p=e.sections.find(s=>s.id===u.parent_section_id);p.units[p.units.findIndex(v=>v.id===u.id)]=structuredClone(u);}
function verify(p,r,limits){assert.equal(verifyMatchedContextArms({...p,artifact:r.artifact,limits}),true);assert.deepEqual(summarizeMatchedContextArms(r.artifact),r.metadata);}
const bytes=v=>Buffer.byteLength(JSON.stringify(v,null,2)+'\n');
const denied=fn=>assert.throws(fn,e=>['MATCHED_SOURCE_BINDING','SOURCE_CONTEXT_BINDING','INVALID_INPUT','QA_FINITE_FEATURE_INVARIANT'].includes(e.code));

test('four complete matched ranges retain focal, continuation and nonlocal globals with unknown semantics',()=>{
 const p=fixture(),before=digest(p),r=buildMatchedContextArms(p);verify(p,r);
 assert.deepEqual(r.artifact.arms.map(a=>a.arm),ARM_ORDER);assert.equal(r.metadata.prepared_count,4);assert.equal(r.metadata.held_count,0);
 const [focal,near,frame,document]=r.artifact.arms,u=p.extraction.units.find(u=>u.id===p.focal_id);
 assert.deepEqual(r.artifact.source.focal,u);assert.equal(focal.forms.strip.text,u.text);assert.equal(focal.range.start,u.start);assert.equal(focal.range.end,u.end);
 assert.ok(!focal.forms.strip.text.includes('following obligations'));assert.ok(!focal.forms.strip.text.includes('SHARED_SYNTHETIC_CONSEQUENCE'));
 assert.ok(frame.forms.strip.text.includes('following obligations'));assert.ok(frame.forms.strip.text.includes('SHARED_SYNTHETIC_CONSEQUENCE'));
 assert.ok(!frame.forms.strip.text.includes('GLOBAL_SYNTHETIC_QUALIFICATION'));assert.ok(!near.forms.strip.text.includes('GLOBAL_SYNTHETIC_QUALIFICATION'));
 assert.equal(document.forms.strip.text,p.extraction.normalized_text);assert.ok(document.forms.strip.text.includes('GLOBAL_SYNTHETIC_QUALIFICATION'));assert.ok(document.forms.strip.text.includes('LATER_SYNTHETIC_GLOBAL'));
 for(const a of r.artifact.arms){assert.equal(decodeModelText(a.forms.native9.encoded.text),a.forms.strip.text);assert.equal(a.forms.strip.sha256,a.range.sha256);assert.equal(a.representation_identity.tokenizer,'NOT_OPEN');assert.equal(a.representation_identity.window_policy,'NOT_OPEN');assert.equal(a.representation_identity.aggregation,'NOT_OPEN');assert.equal(a.context_adequate,null);assert.equal(a.governance_verified,false);assert.equal(a.document_completeness_verified,false);assert.equal(a.referenced_attachments_reconstructed,false);assert.equal(a.authority,'NONE');}
 assert.equal(r.artifact.source_text_truncated,false);assert.equal(r.artifact.heading_promoted,false);assert.equal(r.artifact.accepted_runtime_brand_minted,false);assert.equal(digest(p),before);assert.ok(Object.isFrozen(frame.source_frame));
});

test('60-word allocation is total, exact and redistributes only within the retained parent',()=>{
 const p=fixture(),r=buildMatchedContextArms(p),a=r.artifact.arms[1],u=p.extraction.units.find(u=>u.id===p.focal_id),s=p.extraction.sections.find(s=>s.id===u.parent_section_id);
 assert.deepEqual({before:a.neighbor_words.before,after:a.neighbor_words.after},{before:30,after:30});
 assert.equal((p.extraction.normalized_text.slice(a.range.start,u.start).match(/\S+/gu)??[]).length,30);assert.equal((p.extraction.normalized_text.slice(u.end,a.range.end).match(/\S+/gu)??[]).length,30);
 assert.ok(a.range.start>=s.start&&a.range.end<=s.end);assert.equal(a.forms.strip.text,p.extraction.normalized_text.slice(a.range.start,a.range.end));
 const first=bind(p.extraction,s.units[0].id),edge=buildMatchedContextArms(first);verify(first,edge);assert.equal(edge.artifact.arms[1].neighbor_words.before,0);assert.equal(edge.artifact.arms[1].neighbor_words.after,60);
});

test('missing frame stays held while other complete arms survive without any fallback or replacement',()=>{
 const p=fixture(),e=structuredClone(p.extraction),u=e.units.find(u=>u.id===p.focal_id),s=e.sections.find(s=>s.id===u.parent_section_id);s.governor_frames=[];
 const q=bind(e,u.id),r=buildMatchedContextArms(q);verify(q,r);const frame=r.artifact.arms[2];
 assert.equal(r.artifact.status,'HELD_WITH_COMPLETE_OTHER_ARMS');assert.equal(frame.status,'HELD_UNRESOLVED_CONTEXT');assert.equal(frame.reason,'PROJECTED_FRAME_UNAVAILABLE');assert.equal(frame.range,null);assert.equal(frame.forms,null);assert.equal(frame.payload_retained,false);assert.equal(r.metadata.prepared_count,3);assert.equal(r.metadata.held_count,1);assert.deepEqual(r.artifact.source.focal,u);
});

test('a partially containing stored frame is held; outside-parent frame corruption is rejected',()=>{
 const p=fixture(),e=structuredClone(p.extraction),u=e.units.find(u=>u.id===p.focal_id),s=e.sections.find(s=>s.id===u.parent_section_id),f=s.governor_frames.find(f=>u.governor_frame_ids.includes(f.id));
 f.end=u.end-1;f.sha256=sha(e.normalized_text.slice(f.start,f.end));const q=bind(e,u.id),r=buildMatchedContextArms(q);verify(q,r);assert.equal(r.artifact.arms[2].reason,'STORED_FRAME_DOES_NOT_CONTAIN_FULL_FOCAL');assert.equal(r.artifact.arms[2].forms,null);
 const broken=structuredClone(p.extraction),v=broken.units.find(u=>u.id===p.focal_id),parent=broken.sections.find(s=>s.id===v.parent_section_id);parent.governor_frames[0].start=parent.start-1;parent.governor_frames[0].sha256=sha(broken.normalized_text.slice(parent.start-1,parent.governor_frames[0].end));denied(()=>bind(broken,v.id));
});

test('multiple frame references are not merged into an invented contiguous context',()=>{
 const p=fixture(),e=structuredClone(p.extraction),u=e.units.find(u=>u.id===p.focal_id),s=e.sections.find(s=>s.id===u.parent_section_id),f=structuredClone(s.governor_frames[0]);f.id+=':SYNTHETIC_SECOND';s.governor_frames.push(f);u.governor_frame_ids.push(f.id);syncNested(e,u);
 const q=bind(e,u.id),r=buildMatchedContextArms(q);verify(q,r);assert.equal(r.artifact.arms[2].reason,'SINGLE_COMPLETE_STORED_FRAME_REQUIRED');assert.equal(r.artifact.arms[2].range,null);assert.equal(r.artifact.disjoint_ranges_joined,false);
});

test('source, native, projection and claimed identities cannot be substituted',()=>{
 const p=fixture();for(const change of[
  q=>{q.extraction.normalized_text+=' SYNTHETIC_MUTATION';},
  q=>{q.extraction.native_source_decorations.trace.runs[0].decoded_text+=' SYNTHETIC_MUTATION';},
  q=>{q.extraction.units.find(u=>u.id===q.focal_id).native_source_decorations_ref.start++;},
  q=>{q.projection.contexts[0].text+=' SYNTHETIC_MUTATION';},
  q=>{q.projection.context_adequate=true;},
  q=>{q.focal_id='SYNTHETIC_UNKNOWN_ID';}
 ]){const q=structuredClone(p);change(q);denied(()=>buildMatchedContextArms(q));}
 const r=buildMatchedContextArms(p);for(const change of[
  a=>{a.arms.reverse();},a=>{a.arms[0].forms.strip.text+=' SYNTHETIC_MUTATION';},a=>{a.arms[0].forms.native9.encoded.text+='x';},
  a=>{a.arms[1].range.start--;},a=>{a.arms[0].representation_identity.tokenizer='SYNTHETIC_FAKE_POLICY';},
  a=>{a.arms[3].document_completeness_verified=true;},a=>{a.unknown_grant=true;}
 ]){const a=structuredClone(r.artifact);change(a);denied(()=>verifyMatchedContextArms({...p,artifact:a}));}
});

test('unknown focal and native-reference fields remain whole and change the distinct identity',()=>{
 const p=fixture(),e=structuredClone(p.extraction),u=e.units.find(u=>u.id===p.focal_id),s=e.sections.find(s=>s.id===u.parent_section_id);
 u.synthetic_unknown={unreviewed:['SYNTHETIC_UNKNOWN'],adequacy:null};u.native_source_decorations_ref.synthetic_unknown_native={value:'SYNTHETIC_UNKNOWN_NATIVE',verified:false};s.native_source_decorations_ref.synthetic_parent_unknown={value:'SYNTHETIC_PARENT_UNKNOWN'};syncNested(e,u);
 const q=bind(e,u.id),r=buildMatchedContextArms(q);verify(q,r);assert.deepEqual(r.artifact.source.focal.synthetic_unknown,u.synthetic_unknown);assert.deepEqual(r.artifact.source.focal.native_source_decorations_ref.synthetic_unknown_native,u.native_source_decorations_ref.synthetic_unknown_native);assert.deepEqual(r.artifact.source.parent_reference.native_source_decorations_ref.synthetic_parent_unknown,s.native_source_decorations_ref.synthetic_parent_unknown);
 assert.notEqual(r.artifact.arms[0].representation_sha256,buildMatchedContextArms(p).artifact.arms[0].representation_sha256);u.synthetic_unknown.unreviewed.push('SYNTHETIC_LATER_MUTATION');assert.equal(r.artifact.source.focal.synthetic_unknown.unreviewed.length,1);assert.ok(Object.isFrozen(r.artifact.source.focal.synthetic_unknown));
});

test('exact per-arm byte boundary accepts; next lower byte retains a whole-input failure only',()=>{
 const p=fixture(),full=buildMatchedContextArms(p),n=bytes(full.artifact.arms[0]);assert.ok(n<LIMITS.arm_bytes);
 const exact=buildMatchedContextArms({...p,limits:{arm_bytes:n}});verify(p,exact,{arm_bytes:n});assert.equal(exact.artifact.arms[0].status,'PREPARED_RANGE_NOT_TOKENIZED');assert.equal(bytes(exact.artifact.arms[0]),n);
 const low=buildMatchedContextArms({...p,limits:{arm_bytes:n-1}});verify(p,low,{arm_bytes:n-1});assert.equal(low.artifact.arms[0].reason,'ARM_PAYLOAD_BOUND');assert.equal(low.artifact.arms[0].required_bytes,n);assert.equal(low.artifact.arms[0].forms,null);assert.equal(low.artifact.arms[0].source_text_truncated,false);
});

test('exact final combined boundary includes metadata; lower bounds yield bounded refs-only failure',()=>{
 const p=fixture(),full=buildMatchedContextArms(p);let n=full.metadata.combined_bytes;
 for(let i=0;i<16;i++){const a=structuredClone(full.artifact);a.limits.combined_bytes=n;const next=summarizeMatchedContextArms(a).combined_bytes;if(next===n)break;n=next;}
 const exact=buildMatchedContextArms({...p,limits:{combined_bytes:n}});verify(p,exact,{combined_bytes:n});assert.equal(exact.metadata.combined_bytes,n);assert.equal(exact.artifact.combined_resource_failure,false);
 for(const cap of[n-1,1]){const r=buildMatchedContextArms({...p,limits:{combined_bytes:cap}});verify(p,r,{combined_bytes:cap});assert.equal(r.artifact.status,'HELD_RESOURCE_BOUND');assert.equal(r.artifact.source.focal,null);assert.ok(r.artifact.arms.every(a=>a.forms===null));assert.ok(r.metadata.combined_bytes<=FAILURE_ENVELOPE_BYTES);assert.equal(r.artifact.source_text_truncated,false);}
});

test('input/output limits are lower-only, trusted plain JSON is enforced, no authority is created',()=>{
 const p=fixture();for(const limits of[{input_bytes:LIMITS.input_bytes+1},{arm_bytes:LIMITS.arm_bytes+1},{combined_bytes:LIMITS.combined_bytes+1},{combined_bytes:0},{unknown:1}])assert.throws(()=>buildMatchedContextArms({...p,limits}),e=>e.code==='INVALID_INPUT');
 assert.throws(()=>buildMatchedContextArms({...p,limits:{input_bytes:1}}),e=>e.code==='MATCHED_INPUT_TOO_LARGE'&&e.limit_bytes===1);
 let reads=0;const q=structuredClone(p);Object.defineProperty(q.extraction,'source_payload',{enumerable:true,get(){reads++;return 'SYNTHETIC_GETTER';}});assert.throws(()=>buildMatchedContextArms(q),e=>e.code==='INVALID_INPUT');assert.equal(reads,0);
 for(const change of[e=>{e.synthetic_sparse=new Array(1000001);},e=>{const a=['SYNTHETIC_VALUE'];a.synthetic_hidden='SYNTHETIC_DROPPED';e.synthetic_array=a;}]){const e=structuredClone(p.extraction);change(e);assert.throws(()=>buildMatchedContextArms({...p,extraction:e}),error=>error.code==='INVALID_INPUT'&&error.reason==='DENSE_JSON_ARRAY_REQUIRED');}
 const r=buildMatchedContextArms(p);assert.equal(r.artifact.accepted_runtime_brand_minted,false);assert.equal(r.artifact.selection_recomputed,false);assert.equal(r.artifact.focal_replaced,false);assert.equal(r.artifact.model_access,false);assert.equal(r.artifact.tokenizer_access,false);assert.equal(r.artifact.quality_gate_pass,false);assert.equal(r.artifact.authority,'NONE');
 assert.equal(Object.hasOwn(r.artifact,'token_count'),false);assert.equal(Object.hasOwn(r.artifact,'native_input'),false);
});

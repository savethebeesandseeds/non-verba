// SPDX-License-Identifier: AGPL-3.0-only
// Pure source-span projection. Input custody and all IO remain external.
import {sha,digest} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
export const CONTEXT_LIMITS=Object.freeze({context_payload_bytes:262144,max_context_spans:32});
const PROJECTED='PROJECTED_EXISTING_SOURCE_FRAMES_UNVERIFIED',UNRESOLVED='UNRESOLVED_CONTEXT_SCOPE',TOO_LARGE='CONTEXT_SCOPE_TOO_LARGE';
const J=v=>JSON.stringify(v,null,2)+'\n',bytes=v=>Buffer.byteLength(J(v),'utf8'),same=(a,b)=>a===undefined||b===undefined?a===b:digest(a)===digest(b),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const fail=(code,reason)=>{throw Object.assign(Error(code),{code,reason});};
function check(ok,reason){if(!ok)fail('SOURCE_CONTEXT_BINDING',reason);}
function limits(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(CONTEXT_LIMITS,k)))fail('INVALID_INPUT','LIMIT_KEYS');
  const out={...CONTEXT_LIMITS,...value};for(const[k,max]of Object.entries(CONTEXT_LIMITS))if(!Number.isSafeInteger(out[k])||out[k]<1||out[k]>max)fail('INVALID_INPUT','LIMIT_VALUE');return out;
}
function span(text,row){
  check(row&&Number.isSafeInteger(row.start)&&Number.isSafeInteger(row.end)&&row.start>=0&&row.end>row.start&&row.end<=text.length,'SPAN_RANGE');
  for(const n of[row.start,row.end])check(!(n>0&&n<text.length&&/[\uD800-\uDBFF]/u.test(text[n-1])&&/[\uDC00-\uDFFF]/u.test(text[n])),'SPLIT_CODEPOINT');
  check(hash(row.sha256)&&sha(text.slice(row.start,row.end))===row.sha256,'SPAN_HASH');
  if(Object.hasOwn(row,'text'))check(row.text===text.slice(row.start,row.end),'SPAN_LITERAL');
}
function noClaim(row){
  for(const key of['governing_hierarchy_verified','governance_verified','semantic_completeness_verified','boundary_verified','source_reviewed','context_adequate','antecedents_reviewed','later_governors_complete','parent_governing_hierarchy_verified'])check(row?.[key]!==true,'CALLER_VERIFICATION_CLAIM');
}
function nativeRef(ref,row,envelope){
  check(ref&&typeof ref==='object'&&!Array.isArray(ref),'NATIVE_REFERENCE');
  const expected={envelope_sha256:envelope.sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,policy:envelope.policy,collector_policy:'EXTRACTOR_EMITTED_ORIGIN_ROPES_V3',start:row.start,end:row.end,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,projection_required:true};
  for(const[k,v]of Object.entries(expected))check(v!==undefined&&same(ref[k],v),'NATIVE_REFERENCE');
}
function input(extraction,focal_id){
  if(!extraction||extraction.status!=='accepted'||typeof extraction.normalized_text!=='string'||typeof focal_id!=='string'||!focal_id||!Array.isArray(extraction.units)||!Array.isArray(extraction.sections))fail('INVALID_INPUT','EXTRACTION_SHAPE');
  const text=extraction.normalized_text;check(sha(text)===extraction.normalized_sha256,'NORMALIZED_HASH');
  const units=new Map(),parents=new Map();
  for(const row of extraction.units){check(row&&typeof row.id==='string'&&!units.has(row.id),'DUPLICATE_UNIT');units.set(row.id,row);}
  for(const row of extraction.sections){check(row&&typeof row.id==='string'&&!parents.has(row.id),'DUPLICATE_PARENT');parents.set(row.id,row);}
  const focal=units.get(focal_id);check(focal,'MISSING_FOCAL');const parent=parents.get(focal.parent_section_id);check(parent&&Array.isArray(parent.units),'MISSING_PARENT');
  check(parent.units.every(u=>u&&typeof u.id==='string'&&u.parent_section_id===parent.id)&&new Set(parent.units.map(u=>u.id)).size===parent.units.length,'PARENT_UNIT_IDS');
  const nested=parent.units.filter(u=>u.id===focal_id);check(nested.length===1&&same(nested[0],focal),'PARENT_UNIT_JOIN');span(text,focal);span(text,parent);check(focal.start>=parent.start&&focal.end<=parent.end,'PARENT_CONTAINMENT');
  check(typeof focal.text==='string'&&typeof parent.text==='string','SOURCE_TEXT_REQUIRED');noClaim(focal);noClaim(parent);noClaim(parent.completeness);noClaim(parent.heading_provenance);
  const envelope=extraction.native_source_decorations,{sha256,...body}=envelope??{};
  check(hash(sha256)&&digest(body)===sha256&&hash(envelope.raw?.sha256)&&(!Object.hasOwn(extraction,'raw_sha256')||envelope.raw.sha256===extraction.raw_sha256)&&envelope.normalized?.sha256===extraction.normalized_sha256,'NATIVE_ENVELOPE');nativeRef(focal.native_source_decorations_ref,focal,envelope);nativeRef(parent.native_source_decorations_ref,parent,envelope);
  const ids=focal.governor_frame_ids??[];check(Array.isArray(ids)&&ids.every(id=>typeof id==='string'&&id.length>0)&&new Set(ids).size===ids.length,'FRAME_REFERENCE_IDS');
  const map=new Map();check(parent.governor_frames===undefined||Array.isArray(parent.governor_frames),'FRAME_ARRAY');
  for(const frame of parent.governor_frames??[]){check(frame&&typeof frame.id==='string'&&!map.has(frame.id),'DUPLICATE_FRAME');map.set(frame.id,frame);}
  const selected=ids.map(id=>map.get(id)),reasons=[];
  if(!ids.length)reasons.push('NO_STORED_FRAME_REFERENCES');if(selected.some(f=>!f))reasons.push('MISSING_STORED_FRAME_REFERENCE');
  for(const frame of selected.filter(Boolean)){
    span(text,frame);check(frame.start>=parent.start&&frame.end<=parent.end&&frame.start<focal.end&&frame.end>focal.start,'FRAME_CONTAINMENT_OR_OVERLAP');noClaim(frame);noClaim(frame.prototype_boundary_hypothesis);
    if(frame.governor==null){if(!reasons.includes('MISSING_STORED_GOVERNOR_EVIDENCE'))reasons.push('MISSING_STORED_GOVERNOR_EVIDENCE');}
    else{span(text,frame.governor);check(typeof frame.governor.text==='string'&&frame.governor.start>=frame.start&&frame.governor.end<=frame.end,'GOVERNOR_LITERAL');}
    check(typeof frame.closure==='string'&&typeof frame.source_evidence==='string','FRAME_PROVENANCE');
  }
  const parentRef={role:'PARENT_REVIEW_CONTEXT_UNVERIFIED',id:parent.id,start:parent.start,end:parent.end,sha256:parent.sha256,parent_record_sha256:digest(parent),native_source_decorations_ref:parent.native_source_decorations_ref};
  const focalRef={id:focal.id,parent_section_id:focal.parent_section_id,start:focal.start,end:focal.end,sha256:focal.sha256,focal_record_sha256:digest(focal)};
  return{extraction,text,focal,parent,envelope,ids,selected,reasons,parentRef,focalRef};
}
function minimumPayload(p){return bytes(p.focal)+bytes(p.parentRef)+p.selected.filter(Boolean).reduce((n,f)=>n+bytes(f)+bytes(p.text.slice(f.start,f.end)),0);}
function contexts(p){return p.selected.map(frame=>({role:'EXISTING_SOURCE_FRAME_CONTEXT',frame,text:p.text.slice(frame.start,frame.end),complete_existing_stored_frame_span:true,governor_evidence_present:frame.governor!=null,semantic_completeness_verified:false,governance_verified:false}));}
function base(p,bounds,status,reasons,sourceContexts,focal,required=null,basis=null){
  return{schema:'focal-context-projection-v1',status,reason_codes:reasons,limits:bounds,source_extraction_sha256:digest(p.extraction),source_native_envelope_sha256:p.envelope.sha256,source_native_record_sha256:digest(p.envelope),focal_reference:p.focalRef,focal,parent_reference:p.parentRef,source_frame_ids:p.ids,contexts:sourceContexts,context_adequate:null,governance_verified:false,semantic_completeness_verified:false,antecedents_reviewed:false,later_governors_complete:false,stored_frame_closure_is_semantic_proof:false,selection_recomputed:false,focal_replaced:false,native_projection_performed:false,source_text_truncated:false,whole_parent_text_fallback:false,required_payload_bytes:required,required_bytes_basis:basis,quality_gate_pass:false,authority:'NONE'};
}
export function summarizeFocalContext(artifact){
  const artifactBytes=bytes(artifact);
  const out={schema:'focal-context-projection-metadata-v1',status:artifact.status,reason_codes:artifact.reason_codes,source_extraction_sha256:artifact.source_extraction_sha256,artifact_sha256:sha(J(artifact)),artifact_bytes:artifactBytes,metadata_bytes:0,combined_payload_bytes:0,focal_id_sha256:sha(artifact.focal_reference.id),focal_record_sha256:artifact.focal_reference.focal_record_sha256,focal_literal_sha256:artifact.focal_reference.sha256,parent_id_sha256:sha(artifact.parent_reference.id),parent_literal_sha256:artifact.parent_reference.sha256,source_native_record_sha256:artifact.source_native_record_sha256,referenced_frame_count:artifact.source_frame_ids.length,context_span_count:artifact.contexts.length,governor_evidence_count:artifact.contexts.filter(c=>c.governor_evidence_present).length,context_payload_bytes_limit:artifact.limits.context_payload_bytes,max_context_spans:artifact.limits.max_context_spans,context_adequate:null,governance_verified:false,semantic_completeness_verified:false,antecedents_reviewed:false,selection_recomputed:false,focal_replaced:false,native_projection_performed:false,source_text_truncated:false,whole_parent_text_fallback:false,quality_gate_pass:false,authority:'NONE'};
  for(let i=0;i<16;i++){out.metadata_bytes=bytes(out);out.combined_payload_bytes=artifactBytes+out.metadata_bytes;if(bytes(out)===out.metadata_bytes)return immutableCopy(out);}fail('INVALID_INPUT','METADATA_SIZE_FIXPOINT');
}
function result(artifact){
  const metadata=summarizeFocalContext(artifact);
  if(artifact.status===TOO_LARGE&&metadata.combined_payload_bytes>CONTEXT_LIMITS.context_payload_bytes){
    const p=artifact.parent_reference,f=artifact.focal_reference;
    throw Object.assign(Error(TOO_LARGE),{code:TOO_LARGE,reason:'FAILURE_ENVELOPE_BOUND',full_parent_reference:{id_sha256:sha(p.id),start:p.start,end:p.end,sha256:p.sha256,parent_record_sha256:p.parent_record_sha256},focal_reference:{id_sha256:sha(f.id),start:f.start,end:f.end,sha256:f.sha256,focal_record_sha256:f.focal_record_sha256},source_frame_count:artifact.source_frame_ids.length});
  }
  return immutableCopy({artifact,metadata});
}
/** No source reads, collector calls, reselection, semantic grant or native
 * reprojection. Only complete existing frame spans are source payloads. */
export function projectFocalContext({extraction,focal_id,limits:requested}={}){
  const bounds=limits(requested),p=input(extraction,focal_id),missing=p.reasons.some(r=>r!=='MISSING_STORED_GOVERNOR_EVIDENCE');
  if(p.ids.length>bounds.max_context_spans)return result(base(p,bounds,TOO_LARGE,['SPAN_LIMIT'],[],null,null,'SPAN_COUNT'));
  if(missing){const unresolved=base(p,bounds,UNRESOLVED,p.reasons,[],p.focal);const out=result(unresolved);if(out.metadata.combined_payload_bytes<=bounds.context_payload_bytes)return out;return result(base(p,bounds,TOO_LARGE,['PAYLOAD_LIMIT'],[],null,out.metadata.combined_payload_bytes,'CANONICAL_UNRESOLVED'));
  }
  const minimum=minimumPayload(p);if(minimum>bounds.context_payload_bytes)return result(base(p,bounds,TOO_LARGE,['PAYLOAD_LIMIT'],[],null,minimum,'SOURCE_LITERAL_LOWER_BOUND'));
  const candidate=base(p,bounds,p.reasons.length?UNRESOLVED:PROJECTED,p.reasons,contexts(p),p.focal),out=result(candidate);
  if(out.metadata.combined_payload_bytes>bounds.context_payload_bytes)return result(base(p,bounds,TOO_LARGE,['PAYLOAD_LIMIT'],[],null,out.metadata.combined_payload_bytes,'CANONICAL_COMPLETE'));
  return out;
}
/** Independent readback validation: never calls projectFocalContext. Known
 * source joins and every retained full literal/frame/native ref are compared. */
export function verifyFocalContext({artifact,extraction,focal_id,limits:requested}={}){
  const bounds=limits(requested),p=input(extraction,focal_id);
  check(artifact&&artifact.schema==='focal-context-projection-v1'&&same(artifact.limits,bounds)&&same(artifact.focal_reference,p.focalRef)&&same(artifact.parent_reference,p.parentRef)&&same(artifact.source_frame_ids,p.ids),'PROJECTION_IDENTITY');
  const header=base(p,bounds,artifact.status,artifact.reason_codes,artifact.contexts,artifact.focal,artifact.required_payload_bytes,artifact.required_bytes_basis);check(same(header,artifact),'PROJECTION_UNKNOWN_OR_CHANGED_HEADER');
  check([PROJECTED,UNRESOLVED,TOO_LARGE].includes(artifact.status)&&Array.isArray(artifact.contexts)&&Array.isArray(artifact.reason_codes),'PROJECTION_STATUS');
  const missing=p.reasons.some(r=>r!=='MISSING_STORED_GOVERNOR_EVIDENCE');
  if(artifact.status===TOO_LARGE){
    check(summarizeFocalContext(artifact).combined_payload_bytes<=CONTEXT_LIMITS.context_payload_bytes,'RESOURCE_FAILURE_ENVELOPE_BOUND');
    check(artifact.focal===null&&artifact.contexts.length===0,'RESOURCE_FAILURE_NO_PARTIAL_PAYLOAD');
    if(artifact.required_bytes_basis==='SPAN_COUNT')check(p.ids.length>bounds.max_context_spans&&same(artifact.reason_codes,['SPAN_LIMIT'])&&artifact.required_payload_bytes===null,'RESOURCE_SPAN_BOUND');
    else{
      check(p.ids.length<=bounds.max_context_spans&&same(artifact.reason_codes,['PAYLOAD_LIMIT']),'RESOURCE_PAYLOAD_REASON');let required;
      if(artifact.required_bytes_basis==='SOURCE_LITERAL_LOWER_BOUND'){check(!missing,'RESOURCE_LOWER_BOUND');required=minimumPayload(p);}
      else if(artifact.required_bytes_basis==='CANONICAL_UNRESOLVED'){check(missing,'RESOURCE_UNRESOLVED_BOUND');required=summarizeFocalContext(base(p,bounds,UNRESOLVED,p.reasons,[],p.focal)).combined_payload_bytes;}
      else{check(artifact.required_bytes_basis==='CANONICAL_COMPLETE'&&!missing,'RESOURCE_CANONICAL_BOUND');required=summarizeFocalContext(base(p,bounds,p.reasons.length?UNRESOLVED:PROJECTED,p.reasons,contexts(p),p.focal)).combined_payload_bytes;}
      check(required>bounds.context_payload_bytes&&artifact.required_payload_bytes===required,'RESOURCE_PAYLOAD_BOUND');
    }
  }else{
    check(same(artifact.focal,p.focal)&&p.ids.length<=bounds.max_context_spans&&same(artifact.reason_codes,p.reasons)&&artifact.status===(p.reasons.length?UNRESOLVED:PROJECTED)&&artifact.required_payload_bytes===null&&artifact.required_bytes_basis===null,'FOCAL_OR_STATUS_CHANGED');
    if(missing)check(artifact.contexts.length===0,'UNRESOLVED_NO_PARTIAL_CONTEXT');
    else{
      check(artifact.contexts.length===p.selected.length,'CONTEXT_COUNT');
      for(const[c,i]of artifact.contexts.map((c,i)=>[c,i])){const f=p.selected[i];check(c.role==='EXISTING_SOURCE_FRAME_CONTEXT'&&same(c.frame,f)&&c.text===p.text.slice(f.start,f.end)&&c.complete_existing_stored_frame_span===true&&c.governor_evidence_present===(f.governor!=null)&&c.semantic_completeness_verified===false&&c.governance_verified===false&&Object.keys(c).length===7,'COMPLETE_FRAME_CONTEXT');}
    }
    check(summarizeFocalContext(artifact).combined_payload_bytes<=bounds.context_payload_bytes,'PROJECTION_PAYLOAD_BOUND');
  }
  return true;
}

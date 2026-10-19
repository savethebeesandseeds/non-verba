// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE: observed-slice literals/qualifications; coordinate wiring stays machine-only.
import {createHash} from 'node:crypto';
import {createNativePresentation as createResponse,verifyNativePresentation as verifyResponse,unpackResponse,LIMITS} from './response-validation.mjs';
export {LIMITS,unpackResponse};
export const POLICY='OBSERVED_PARENT_SLICE_LITERAL_QUALIFIED_STACK_PRESENTATION_V3_UNADOPTED';
const H=v=>createHash('sha256').update(v).digest('hex'),J=JSON.stringify,B=v=>Buffer.byteLength(v,'utf8'),clone=structuredClone;
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
function catalog(){const values=[],ids=new Map();return{values,add(value){const key=J(value);if(!ids.has(key)){ids.set(key,String(values.length+1));values.push({id:ids.get(key),value});}return ids.get(key);}};}
function derive(root,base){
 const n=root.native_source_decorations,old=base.review_view;
 const literals=old.native_literal_definitions.map(({id,literal})=>({id,literal})),literalIDs=new Map(literals.map(x=>[x.literal,x.id]));
 const literal=v=>{if(v===null)return null;check(literalIDs.has(v),'PRESENTATION_V3_LITERAL_NOT_COVERED');return literalIDs.get(v);};
 const marks=catalog(),stacks=catalog(),qualifications=catalog(),witnesses=catalog(),markOccurrences=[];
 const events=xs=>xs.map(e=>({category:e.category}));
 function qualifiedMark(m,annotation,jointOrigin,index){
  const value={tag:{literal:literal(m.tag)},native_tag:m.native_tag===null?null:{literal:literal(m.native_tag)},start_tag_role:m.start_tag_role,
   element_scope:clone(m.element_scope),source_interval_presence:{element:m.element!==null,element_start_tag:m.element_start_tag!==null,end_tag:m.end_tag!==null},
   style_attribute:m.style_attribute===null?null:{literal:literal(m.style_attribute.decoded_value)},
   declarations:m.declarations.map(d=>Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v===null?null:{literal:literal(v)}]))),
   style_declarations:m.style_declarations.map(d=>Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v===null?null:{literal:literal(v)}]))),
   input_relevance:m.input_relevance,computed_style_verified:m.computed_style_verified,effectiveness_verified:m.effectiveness_verified,
   ...(Object.hasOwn(m,'dom_scopes')?{dom_scopes:m.dom_scopes.map(s=>({kind:s.kind,raw_interval_verified:s.raw_interval_verified,source_interval_presence:{element:s.element!==null,element_start_tag:s.element_start_tag!==null,end_tag:s.end_tag!==null},
    ...(Object.hasOwn(s,'source_origin')?{source_origin:s.source_origin}:{}),...(Object.hasOwn(s,'parser_reported_location')?{parser_reported_location:s.parser_reported_location===null?null:{present:true,raw_interval_verified:s.parser_reported_location.raw_interval_verified}}:{})}))}:{})};
  const id=marks.add(value);markOccurrences.push({annotation,joint_origin:jointOrigin,mark:index,qualified_mark_id:id,original_source_id:m.id,original_mark_sha256:H(J(m))});return id;
 }
 const stack=(ms,annotation,jointOrigin=null)=>stacks.add(ms.map((m,i)=>qualifiedMark(m,annotation,jointOrigin,i)));
 function witness(w,annotation){return witnesses.add({policy:w.policy,normalized_output:{text_from_observed_parent_slice:true,mark_attribution:w.normalized_output.mark_attribution},
  origins:w.origins.map((o,i)=>({stack:stack(o.marks,annotation,i),decoded_codepoints_rle:o.decoded_codepoints_rle.map(c=>({literal:literal(c.codepoint),count:c.count})),filtered_source_events:events(o.filtered_source_events),output_character_attribution_verified:o.output_character_attribution_verified})),per_run_character_attribution:w.per_run_character_attribution});}
 const rows=n.annotations.map((a,i)=>{
  const q=qualifications.add({mapping:a.mapping,normalization:a.normalization,clipped:a.clipped,
   ordered_origin_qualifications:a.origins.map(o=>({clipping_mapping:o.clipping_mapping})),
   joint_source_attributions:a.joint_source_attributions.map(j=>Object.fromEntries(Object.entries(j).filter(([k])=>!['start','end','path_id'].includes(k)))),
   filtered_source_events:events(a.filtered_source_events),computed_style_verified:a.computed_style_verified,effectiveness_verified:a.effectiveness_verified});
  return [a.start-n.range.start,a.end-n.range.start,stack(a.marks,i),q,a.start===a.end,Object.hasOwn(a,'joint_whitespace_witness')?witness(a.joint_whitespace_witness,i):null];
 });
 const identity={original_response:base.original_response,audit_id:root.audit_id,source_id:root.source_id,contract_id:root.contract_id,packet:clone(root.packet),reported_binding:clone(root.binding),
  range:clone(root.range),native_range:clone(n.range),reported_parent_absolute_start:root.range.absolute_normalized_start-root.range.offset,envelope_sha256:n.envelope_sha256,tracer_source_sha256:n.tracer_source_sha256,collector_source_sha256:n.collector_source_sha256,projection_policy:n.projection_policy};
 return {identity,markOccurrences,view:{schema:'observed-parent-slice-qualified-stack-review-view-v3',policy:POLICY,
  scope:'OBSERVED_TEXT_AND_NATIVE_LITERAL_VALUES_WITH_QUALIFIED_ORDERED_APPLICATIONS_ONLY',
  claim:'observed slice text, distinct native literals, qualified stacks and every ordered application',
  machine_only:'Exact original coordinate/hash/origin wiring is preserved and verified separately; no human reading of that wiring is claimed.',
  not_reading_claims:['FULL_RESPONSE_JSON_READ','WHOLE_ORIGINAL_DOCUMENT_READ','WHOLE_NATIVE_ENVELOPE_READ','COMPUTED_STYLE_OR_EFFECT_VERIFIED'],
  case:clone(old.case),observed_parent_slice:clone(old.observed_parent_slice),reported_full_parent_coverage:root.range.complete_source_in_this_slice,
  native_literal_definitions:literals,qualified_mark_definitions:marks.values,stack_definitions:stacks.values,application_qualifications:qualifications.values,joint_whitespace_witnesses:witnesses.values,
  application_table:{order:'EXACT_ORIGINAL_ANNOTATION_ORDER; ROW_INDEX_IS_ORDINAL',coordinates:'HALF_OPEN_UTF16_RELATIVE_TO_OBSERVED_SLICE_START',columns:['start','end','stack_id','qualification_id','zero_output','joint_witness_id'],rows},
  unverified_status:clone(old.unverified_status),required_original_source_reading:'SEPARATE_AND_UNCHANGED',full_response_json_read:false,whole_original_document_read:false,whole_native_envelope_read:false,actual_reading:false,authority:'NONE'}};
}
export function createNativePresentation(serialized,{limits:options}={}){
 const base=createResponse(serialized,{limits:options});verifyResponse(serialized,base,{limits:options});
 const derived=derive(JSON.parse(serialized),base),review=J(derived.view),l={...LIMITS,...options};
 check(B(review)<=l.review_bytes&&review.length<=l.review_utf16,'PRESENTATION_V3_REVIEW_BOUND');
 const result={schema:'reversible-observed-parent-slice-presentation-v3',policy:POLICY,input_identity:derived.identity,input_sha256:H(J(derived.identity)),original_response:clone(base.original_response),packed_response:base.packed_response,
  machine_coverage:{...base.coverage,original_application_links:base.review_view.ordered_applications,qualified_mark_occurrences:derived.markOccurrences},review_view:derived.view,review_view_sha256:H(review),
  full_response_json_read:false,original_source_reading_requirement_changed:false,actual_reading:false,source_quality_gate_pass:false,authority:'NONE'};
 check(B(J(result))<=l.presentation_bytes,'PRESENTATION_V3_OUTPUT_BOUND');return result;
}
export function verifyNativePresentation(serialized,presentation,{limits:options}={}){
 check(unpackResponse(presentation.packed_response,{limits:options})===serialized,'PRESENTATION_V3_RESPONSE_INVERSE');
 const expected=createNativePresentation(serialized,{limits:options});check(J(expected)===J(presentation),'PRESENTATION_V3_SLICE_LITERAL_STACK_COVERAGE');
 return{status:'EXACT_RESPONSE_AND_OBSERVED_SLICE_QUALIFIED_STACK_VIEW',original_response:expected.original_response,input_sha256:expected.input_sha256,review_view_sha256:expected.review_view_sha256,actual_reading:false,source_quality_gate_pass:false,authority:'NONE'};
}
export function reviewJSON(presentation,{limits:options}={}){const s=unpackResponse(presentation.packed_response,{limits:options});verifyNativePresentation(s,presentation,{limits:options});return J(presentation.review_view);}

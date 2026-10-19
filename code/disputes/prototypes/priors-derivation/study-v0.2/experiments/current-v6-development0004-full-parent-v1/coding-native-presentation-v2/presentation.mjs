// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE: compact human view over the unchanged V1 lossless verifier.
import {createHash} from 'node:crypto';
import {createNativePresentation as createV1,verifyNativePresentation as verifyV1,unpackResponse,LIMITS} from '../coding-native-presentation-v1/presentation.mjs';
export {LIMITS};
export const POLICY='COMPLETE_NATIVE_LITERALS_AND_QUALIFIED_STACK_TABLE_V2_UNADOPTED';
const H=v=>createHash('sha256').update(v).digest('hex'),J=JSON.stringify,B=v=>Buffer.byteLength(v,'utf8');
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
const clone=structuredClone;
function catalog(){const values=[],ids=new Map();return {values,add(v){const key=J(v);if(!ids.has(key)){const id=String(values.length+1);ids.set(key,id);values.push({id,value:v});}return ids.get(key);}};}
function derive(root,base){
 const old=base.review_view,literals=old.native_literal_definitions.map(({id,literal})=>({id,literal})),literalIDs=new Map(literals.map(x=>[x.literal,x.id]));
 const literal=v=>{if(v===null)return null;check(literalIDs.has(v),'PRESENTATION_V2_LITERAL_NOT_COVERED');return literalIDs.get(v);};
 const marks=catalog(),stacks=catalog(),qualifications=catalog(),witnesses=catalog();
 function mark(m){
  // Every original mark field survives once per distinct complete definition.
  // Only native literal values become references to the single literal catalog.
  const value=clone(m);value.tag={literal:literal(m.tag)};value.native_tag=m.native_tag===null?null:{literal:literal(m.native_tag)};
  if(m.style_attribute!==null)value.style_attribute={...clone(m.style_attribute),decoded_value:{literal:literal(m.style_attribute.decoded_value)}};
  for(const k of ['declarations','style_declarations'])value[k]=m[k].map(d=>Object.fromEntries(Object.entries(d).map(([key,v])=>[key,v===null?null:{literal:literal(v)}])));
  return marks.add(value);
 }
 const stack=ms=>stacks.add(ms.map(mark));
 const native=root.native_source_decorations;
 function witness(w){
  const value=clone(w),o=w.normalized_output;
  value.normalized_output={start:o.start,end:o.end,parent_relative_range:[o.start-native.range.start,o.end-native.range.start],text_from_complete_parent:true,mark_attribution:o.mark_attribution};
  value.origins=w.origins.map(origin=>{
   const item=clone(origin);item.marks={stack:stack(origin.marks)};
   item.decoded_codepoints_rle=origin.decoded_codepoints_rle.map(c=>({literal:literal(c.codepoint),count:c.count}));
   return item;
  });return witnesses.add(value);
 }
 const rows=native.annotations.map(a=>{
  const q={mapping:a.mapping,normalization:a.normalization,clipped:a.clipped,source_segment_count:a.source_segment_count,origins:clone(a.origins),joint_source_attributions:clone(a.joint_source_attributions),filtered_source_events:clone(a.filtered_source_events),computed_style_verified:a.computed_style_verified,effectiveness_verified:a.effectiveness_verified};
  return [a.start-native.range.start,a.end-native.range.start,stack(a.marks),qualifications.add(q),a.start===a.end,Object.hasOwn(a,'joint_whitespace_witness')?witness(a.joint_whitespace_witness):null];
 });
 return {
  schema:'qualified-native-stack-review-view-v2',policy:POLICY,
  scope:'COMPLETE_STORED_PARENT_AND_LITERAL_VALUES_OF_EXACT_ALL_NATIVE_PROJECTION_ONLY',
  claim:'complete native literals, qualified distinct marks/stacks, and every ordered application',
  not_reading_claims:['FULL_RESPONSE_JSON_READ','WHOLE_ORIGINAL_DOCUMENT_READ','WHOLE_NATIVE_ENVELOPE_READ','COMPUTED_STYLE_OR_EFFECT_VERIFIED'],
  case:clone(old.case),complete_parent:clone(old.complete_parent),native_literal_definitions:literals,
  mark_definitions:marks.values,stack_definitions:stacks.values,application_qualifications:qualifications.values,joint_whitespace_witnesses:witnesses.values,
  application_table:{order:'EXACT_ORIGINAL_ANNOTATION_ORDER; ROW_INDEX_IS_ORDINAL',coordinates:'HALF_OPEN_UTF16_RELATIVE_TO_COMPLETE_PARENT_START',columns:['start','end','stack_id','qualification_id','zero_output','joint_witness_id'],rows},
  unverified_status:clone(old.unverified_status),required_original_source_reading:'SEPARATE_AND_UNCHANGED',
  full_response_json_read:false,whole_original_document_read:false,whole_native_envelope_read:false,actual_reading:false,authority:'NONE'
 };
}
export function createNativePresentation(serialized,{limits:options}={}){
 const base=createV1(serialized,{limits:options});verifyV1(serialized,base,{limits:options});
 const view=derive(JSON.parse(serialized),base),review=J(view),l={...LIMITS,...options};
 check(B(review)<=l.review_bytes&&review.length<=l.review_utf16,'PRESENTATION_V2_REVIEW_BOUND');
 const result={schema:'reversible-native-stack-presentation-v2',policy:POLICY,original_response:clone(base.original_response),packed_response:base.packed_response,
  machine_coverage:{...base.coverage,original_application_links:base.review_view.ordered_applications},review_view:view,review_view_sha256:H(review),
  full_response_json_read:false,original_source_reading_requirement_changed:false,actual_reading:false,source_quality_gate_pass:false,authority:'NONE'};
 check(B(J(result))<=l.presentation_bytes,'PRESENTATION_V2_OUTPUT_BOUND');return result;
}
export function verifyNativePresentation(serialized,presentation,{limits:options}={}){
 check(unpackResponse(presentation.packed_response,{limits:options})===serialized,'PRESENTATION_V2_RESPONSE_INVERSE');
 const expected=createNativePresentation(serialized,{limits:options});
 check(J(expected)===J(presentation),'PRESENTATION_V2_LITERAL_STACK_APPLICATION_COVERAGE');
 return {status:'EXACT_RESPONSE_AND_QUALIFIED_NATIVE_STACK_VIEW',original_response:expected.original_response,review_view_sha256:expected.review_view_sha256,actual_reading:false,source_quality_gate_pass:false,authority:'NONE'};
}
export function reviewJSON(presentation,{limits:options}={}){
 const serialized=unpackResponse(presentation.packed_response,{limits:options});verifyNativePresentation(serialized,presentation,{limits:options});return J(presentation.review_view);
}

// SPDX-License-Identifier: AGPL-3.0-only
// Pure B partition-aggregate presentation — PROTOTYPE / UNADOPTED; no IO.
import{createHash}from'node:crypto';
import{createNativePresentation as single,verifyNativePresentation as singleVerify}from'/tmp/nonverba-coding-b-native-presentation-v3-2m-v1-controls-20261019-a1/presentation.mjs';
import{packResponse,unpackResponse,LIMITS}from'/tmp/nonverba-coding-b-native-presentation-v3-2m-v1-controls-20261019-a1/response-validation.mjs';
export{LIMITS,unpackResponse};
export const POLICY='CODING_B_PARTITIONED_NATIVE_OBSERVED_SLICE_PRESENTATION_V1_UNADOPTED';
const H=v=>createHash('sha256').update(v).digest('hex'),J=JSON.stringify,B=v=>Buffer.byteLength(v,'utf8'),copy=structuredClone;
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});},same=(a,b)=>J(a)===J(b),point=(s,p)=>Number.isSafeInteger(p)&&p>=0&&p<=s.length&&!(p&&p<s.length&&/[\uD800-\uDBFF]/u.test(s[p-1])&&/[\uDC00-\uDFFF]/u.test(s[p]));
const fields=(v,required,optional=[])=>check(v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k)),'B_PARTITION_FIELDS');
const integer=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const CAPS=Object.freeze({projection_calls:255,fragments:128,depth:16,projection_utf8_bytes:8388608,max_requested_utf16:20000});
function bounds(o={}){check(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>Object.hasOwn(LIMITS,k)),'B_PARTITION_LIMITS');const l={...LIMITS,...o};for(const k of Object.keys(l))check(integer(l[k],1,LIMITS[k]),'B_PARTITION_LIMITS');return l;}
function prepared(serialized,l){
 const packed=packResponse(serialized,{limits:l}),root=JSON.parse(serialized),r=root.range,n=root.native_source_decorations;
 fields(root,['audit_id','source_id','contract_id','purpose','packet','source','binding','range','text','source_scope','semantic_completeness','native_source_decorations'],['source_url']);
 fields(r,['offset','end','requested_limit','codepoint_aligned','total_characters','absolute_normalized_start','offset_basis','complete_source_in_this_slice','next_offset']);
 check(root.purpose==='coding'&&root.source==='parent'&&root.source_scope==='EXTRACTED_FLAT_SPAN'&&typeof root.text==='string','B_PARTITION_PARENT_SCOPE');
 for(const k of ['offset','end','total_characters','absolute_normalized_start'])check(integer(r[k]),'B_PARTITION_RANGE');
 check(integer(r.requested_limit,1,20000)&&r.codepoint_aligned===true&&r.end>r.offset&&r.end<=r.total_characters&&r.end-r.offset===root.text.length&&r.absolute_normalized_start>=r.offset&&Math.min(r.offset+r.requested_limit,r.total_characters)-r.end>=0&&Math.min(r.offset+r.requested_limit,r.total_characters)-r.end<=1&&r.next_offset===(r.end<r.total_characters?r.end:null)&&r.complete_source_in_this_slice===(r.offset===0&&r.end===r.total_characters),'B_PARTITION_RANGE');
 fields(n,['schema','scope','projection_policy','range','fragments','work','attempted_ranges','bound_refusals','limits','coverage','intermediate_terminal_events','terminal_parent_events','marks_and_joint_witnesses','actual_reading','model_windows','quality_gate_pass','authority']);
 check(n.schema==='bounded-native-audit-view-partitions-v1'&&n.scope==='PRE_TOKENIZATION_AUDIT_VIEW_PARTITIONS_NOT_MODEL_WINDOWS'&&n.projection_policy==='ALL_NATIVE_STYLE_SOURCE_METADATA'&&n.coverage==='EXACT_ORDERED_NONOVERLAPPING_NORMALIZED_RANGE'&&n.intermediate_terminal_events==='HALF_OPEN; SHARED_BOUNDARY_EVENTS_OWNED_BY_RIGHT_PARTITION'&&n.terminal_parent_events==='ONLY_LAST_PARTITION_AT_PARENT_END'&&n.marks_and_joint_witnesses==='ALL_RETURNED_FIELDS_UNCHANGED; REPEATED_MARK_METADATA_DISCLOSED; NO_DEDUPLICATION_OR_ATTRIBUTION'&&n.actual_reading===false&&n.model_windows===false&&n.quality_gate_pass===false&&n.authority==='NONE','B_PARTITION_POLICY');
 fields(n.range,['start','end','include_end_zero_width']);const start=r.absolute_normalized_start,end=start+root.text.length,parentEnd=start-r.offset+r.total_characters;
 check(n.range.start===start&&n.range.end===end&&n.range.include_end_zero_width===(r.end===r.total_characters),'B_PARTITION_NATIVE_RANGE');
 fields(n.limits,Object.keys(CAPS));for(const[k,v]of Object.entries(CAPS))check(integer(n.limits[k],1,v),'B_PARTITION_PRODUCER_LIMIT');check(end-start<=n.limits.max_requested_utf16,'B_PARTITION_PRODUCER_LIMIT');
 fields(n.work,['projection_calls','projection_bound_refusals','fragments','maximum_depth','projection_utf8_bytes']);
 check(Array.isArray(n.fragments)&&n.fragments.length>0&&n.fragments.length<=n.limits.fragments&&Array.isArray(n.attempted_ranges)&&n.attempted_ranges.length<=n.limits.projection_calls&&Array.isArray(n.bound_refusals),'B_PARTITION_ARRAYS');
 let at=start,projectionBytes=0,common=null;
 for(let i=0;i<n.fragments.length;i++){const f=n.fragments[i];fields(f,['index','start','end','include_end_zero_width','projection']);check(f.index===i&&f.start===at&&integer(f.end,f.start+1,end)&&point(root.text,f.start-start)&&point(root.text,f.end-start)&&f.include_end_zero_width===(f.end===parentEnd),'B_PARTITION_FRAGMENT_COVERAGE');at=f.end;
  const p=f.projection;check(p&&same(p.range,{start:f.start,end:f.end,include_end_zero_width:f.include_end_zero_width})&&p.projection_policy===n.projection_policy,'B_PARTITION_PROJECTION_RANGE');
  const identity=['policy','projection_policy','envelope_sha256','tracer_source_sha256','collector_source_sha256','raw_sha256','normalized_sha256','method_identity_status'].map(k=>[k,p[k]]);
  if(common===null)common=identity;else check(same(identity,common),'B_PARTITION_SOURCE_IDENTITIES');check(p.normalized_sha256===root.binding.sha256,'B_PARTITION_NORMALIZED_BINDING');
  check(Array.isArray(p.annotations)&&p.annotations.every(a=>a.start!==a.end||a.start<f.end||f.include_end_zero_width&&a.start===f.end),'B_PARTITION_ZERO_OWNERSHIP');projectionBytes+=B(J(p));
 }
 check(at===end,'B_PARTITION_FRAGMENT_COVERAGE');
 let ai=0,fi=0,ri=0,maxDepth=0;
 function visit(a,b,d){check(d<=n.limits.depth,'B_PARTITION_ATTEMPT_DEPTH');maxDepth=Math.max(maxDepth,d);const t=n.attempted_ranges[ai++];fields(t,['call','start','end','depth','include_end_zero_width']);check(same(t,{call:ai,start:a,end:b,depth:d,include_end_zero_width:b===parentEnd}),'B_PARTITION_ATTEMPT_TREE');const refusal=n.bound_refusals[ri];if(refusal&&refusal.start===a&&refusal.end===b&&refusal.depth===d){fields(refusal,['start','end','depth','code']);check(refusal.code==='NATIVE_DECORATION_PROJECTION_BOUND','B_PARTITION_REFUSAL');ri++;let cut=a+Math.floor((b-a)/2);if(!point(root.text,cut-start))cut--;if(cut<=a)cut=a+(root.text.codePointAt(a-start)>0xffff?2:1);check(cut>a&&cut<b,'B_PARTITION_ATTEMPT_SPLIT');visit(a,cut,d+1);visit(cut,b,d+1);}else{const f=n.fragments[fi++];check(f&&f.start===a&&f.end===b,'B_PARTITION_ATTEMPT_SUCCESS');}}
 visit(start,end,0);
 check(ai===n.attempted_ranges.length&&fi===n.fragments.length&&ri===n.bound_refusals.length&&n.work.projection_calls===ai&&n.work.projection_bound_refusals===ri&&n.work.fragments===fi&&n.work.maximum_depth===maxDepth&&n.work.projection_utf8_bytes===projectionBytes&&projectionBytes<=n.limits.projection_utf8_bytes,'B_PARTITION_WORK');
 return{root,packed,start,end,n};
}
function derive(p,l){
 const{root,n,start}=p,fragments=[],machine=[];
 for(const f of n.fragments){const offset=root.range.offset+f.start-start,end=offset+f.end-f.start,range={offset,end,total_characters:root.range.total_characters,absolute_normalized_start:f.start,offset_basis:root.range.offset_basis,complete_source_in_this_slice:offset===0&&end===root.range.total_characters,next_offset:end<root.range.total_characters?end:null};
  const derived={...root,range,text:root.text.slice(f.start-start,f.end-start),native_source_decorations:f.projection},serialized=J(derived),v=single(serialized,{limits:l});singleVerify(serialized,v,{limits:l});
  fragments.push({index:f.index,scope:'DERIVED_PER_FRAGMENT_VIEW; NOT_ORIGINAL_READER_RESPONSE_BYTES',original_normalized_range:[f.start,f.end],view:v.review_view});
  machine.push({index:f.index,original_projection_sha256:H(J(f.projection)),derived_response_sha256:H(serialized),derived_response_bytes:B(serialized),derived_presentation_bytes:B(J(v)),derived_input_sha256:v.input_sha256,derived_view_sha256:v.review_view_sha256,original_fragment_fields_sha256:H(J(f))});
 }
 check(fragments.map(f=>f.view.observed_parent_slice.text).join('')===root.text,'B_PARTITION_TEXT_UNION');
 const outer=Object.fromEntries(Object.entries(root).filter(([k])=>!['text','native_source_decorations'].includes(k))),report=Object.fromEntries(Object.entries(n).filter(([k])=>k!=='fragments'));
 return{machine,view:{schema:'coding-b-partitioned-observed-native-review-view-v1',policy:POLICY,scope:'EXACT_OBSERVED_PARENT_SLICE_TEXT_AND_ALL_FRAGMENT_NATIVE_LITERAL_QUALIFICATIONS',outer_original_fields_without_text_or_native:outer,original_partition_report_without_fragments:report,reported_full_parent_coverage:root.range.complete_source_in_this_slice,fragments,original_source_reading_requirement_changed:false,full_response_json_read:false,whole_original_document_read:false,whole_native_envelope_read:false,computed_style_verified:false,effectiveness_verified:false,actual_reading:false,source_quality_gate_pass:false,authority:'NONE'}};
}
export function createNativePresentation(serialized,{limits:options}={}){
 const l=bounds(options),p=prepared(serialized,l),d=derive(p,l),review=J(d.view);check(B(review)<=l.review_bytes&&review.length<=l.review_utf16,'B_PARTITION_TOTAL_REVIEW_BOUND');
 const identity={original_response:{sha256:H(serialized),bytes:B(serialized)},outer_range:p.root.range,aggregate_range:p.n.range,fragments:d.machine},out={schema:'coding-b-reversible-partitioned-native-presentation-v1',policy:POLICY,original_response:identity.original_response,packed_response:p.packed,input_identity:identity,input_sha256:H(J(identity)),machine_coverage:{original_canonical_inverse_exact:true,original_tree_limit:l.nodes,exact_ordered_disjoint_source_union:true,zero_policy:'HALF_OPEN_RIGHT_OWNED; ONLY_PARENT_TERMINAL_AT_LAST_END',fragment_count:p.n.fragments.length,derived_fragment_bindings:d.machine,original_coordinate_and_origin_wiring_preserved_in_packed_response:true},review_view:d.view,review_view_sha256:H(review),full_response_json_read:false,original_source_reading_requirement_changed:false,actual_reading:false,source_quality_gate_pass:false,authority:'NONE'};
 check(unpackResponse(out.packed_response,{limits:l})===serialized,'B_PARTITION_ORIGINAL_INVERSE');check(B(J(out))<=l.presentation_bytes,'B_PARTITION_TOTAL_PRESENTATION_BOUND');return out;
}
export function verifyNativePresentation(serialized,presentation,{limits:options}={}){const l=bounds(options);check(B(J(presentation))<=l.presentation_bytes,'B_PARTITION_TOTAL_PRESENTATION_BOUND');check(unpackResponse(presentation.packed_response,{limits:l})===serialized,'B_PARTITION_ORIGINAL_INVERSE');const expected=createNativePresentation(serialized,{limits:l});check(J(expected)===J(presentation),'B_PARTITION_EXACT_COVERAGE');return{status:'EXACT_ORIGINAL_AGGREGATE_INVERSE_AND_DERIVED_FRAGMENT_VIEWS',input_sha256:expected.input_sha256,original_response:expected.original_response,review_view_sha256:expected.review_view_sha256,actual_reading:false,source_quality_gate_pass:false,authority:'NONE'};}
export function reviewJSON(presentation,{limits:options}={}){const s=unpackResponse(presentation.packed_response,{limits:options});verifyNativePresentation(s,presentation,{limits:options});return J(presentation.review_view);}

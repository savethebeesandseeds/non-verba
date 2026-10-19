// SPDX-License-Identifier: AGPL-3.0-only
// Fictional responses only; no stored pages, source readers, coders or models.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNativePresentation as create,verifyNativePresentation as verify,reviewJSON} from './presentation.mjs';
import {createNativePresentation as prior,unpackResponse} from '../coding-native-presentation-v1/presentation.mjs';
const H=v=>createHash('sha256').update(v).digest('hex'),clone=structuredClone;
const rr=(start=10,end=20)=>({start,end,sha256:H(String(start)+':'+end)});
function mark(adopted=false){return {
 id:'synthetic-mark',tag:'span',native_tag:null,start_tag:rr(),start_tag_role:adopted?'ATTRIBUTE_ADOPTION_SOURCE_TOKEN':'ELEMENT_START_TAG',element:{start:10,end:80,raw_sha256:H('raw'),binding:'WHOLE_RAW_SHA256_AND_EXACT_UTF16_INTERVAL_V1'},element_start_tag:rr(),
 element_scope:{kind:adopted?'SHARED_LITERAL_SOURCE_WITH_PARSER_RECONSTRUCTED_DOM_SCOPES':'PARSED_DOM_ELEMENT_WITH_RAW_RANGE',raw_interval_verified:!adopted,attribute_adoption:adopted,source_origin:adopted?'PARSE5_START_TOKEN_ATTRIBUTE_OBJECT_IDENTITY':'NODE_SOURCE_LOCATION'},end_tag:rr(75,80),
 style_attribute:{...rr(12,19),decoded_value:'unknown-x:"not waived";text-decoration:underline'},declarations:[{property:'text-decoration',value:'underline',literal:'text-decoration:underline'}],style_declarations:[{property:'unknown-x',value:'"not waived"',literal:'unknown-x:"not waived"'},{property:'text-decoration',value:'underline',literal:'text-decoration:underline'}],input_relevance:'UNRESOLVED_CSS',computed_style_verified:false,effectiveness_verified:false,
 ...(adopted?{dom_scopes:[{id:'synthetic-scope',kind:'PARSER_RECONSTRUCTED_FORMATTING_DOM_DESCENDANTS',raw_interval_verified:false,element:null,element_start_tag:null,end_tag:null,parser_reported_location:{start:10,end:80,raw_interval_verified:false},source_origin:'PARSE5_ORIGINAL_START_TOKEN_ATTRS_ARRAY_IDENTITY'}]}:{})
};}
function annotation(start,end,text,marks=[]){return {start,end,source_segment_start:start,source_segment_end:end,source_segment_count:1,clipped:false,mapping:'EXACT_COLLECTOR_ORIGIN',normalization:'EXACT_DECODED',origins:[],marks,joint_source_attributions:[],filtered_source_events:[],computed_style_verified:false,effectiveness_verified:false,text};}
function fixture(repetitions=0){
 const text=repetitions?'X'.repeat(repetitions):'same 🚀 same 🚀 ',m=mark(),annotations=repetitions?Array.from({length:repetitions},(_,i)=>annotation(100+i,101+i,'X',[m,m])):[annotation(100,107,'same 🚀',[m,m]),annotation(108,115,'same 🚀',[mark(true)]),annotation(115,115,'',[m]),annotation(115,116,' ',[])];
 if(!repetitions){
  annotations[2].filtered_source_events=[{run_id:'zero',decoded_start:0,decoded_end:1,category:'ZERO_WIDTH_FILTER',decoded_sha256:H('\uFEFF')}];
  const a=annotations[3];a.mapping='COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE';a.normalization='EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1';a.joint_source_attributions=[{start:115,end:116,policy:'COMPLETE_ORDERED_WHITESPACE_ORIGIN_EVIDENCE_V1',native_mark_attribution_verified:false,per_run_character_attribution:false}];
  a.joint_whitespace_witness={policy:'COMPLETE_ORDERED_WHITESPACE_ORIGIN_EVIDENCE_V1',normalized_output:{text:' ',start:115,end:116,mark_attribution:'UNVERIFIED_NO_SOURCE_ORIGIN_SELECTED'},origins:[{run_id:'space',raw:rr(300,303),decoded_start:0,decoded_end:2,decoded_sha256:H(' \uFEFF'),decoded_codepoints_rle:[{codepoint:'U+0020',count:1},{codepoint:'U+FEFF',count:1}],marks:[mark(true)],filtered_source_events:[{run_id:'space',decoded_start:1,decoded_end:2,category:'ZERO_WIDTH_FILTER',decoded_sha256:H('\uFEFF')}],output_character_attribution_verified:false}],per_run_character_attribution:false};
 }
 return {audit_id:'coding-0001',source_id:'synthetic-parent',contract_id:'synthetic-contract',purpose:'coding',packet:{path:'synthetic.json',sha256:H('packet'),bytes:123},source:'parent',binding:{sha256:H(text),bytes:Buffer.byteLength(text)},range:{offset:0,end:text.length,total_characters:text.length,absolute_normalized_start:100,offset_basis:'UTF16',complete_source_in_this_slice:true,next_offset:null},text,source_scope:'EXTRACTED_FLAT_SPAN',semantic_completeness:'UNVERIFIED_REQUIRES_ORIGINAL_SOURCE_READING',native_source_decorations:{schema:'native-source-decoration-projection-v2',policy:'NATIVE_SOURCE_DECORATION_COLLECTOR_ORIGIN_V4',projection_policy:'ALL_NATIVE_STYLE_SOURCE_METADATA',nondecoration_style_sources_retained_in_trace:1,envelope_sha256:H('envelope'),tracer_source_sha256:H('tracer'),collector_source_sha256:H('collector'),method_identity_status:'CURRENT_METHOD_BINDINGS_SUPPLIED',collector_issue_count:0,raw_sha256:H('raw'),normalized_sha256:H(text),range:{start:100,end:100+text.length,include_end_zero_width:true},collector_mapping_status:'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE',native_style_status:'UNRESOLVED_STYLESHEET_CASCADE',mapping_status:'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE',input_eligibility:'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE',unmapped_ranges:0,unmapped_normalized_ranges:0,unresolved_style_or_origin_evidence:1,annotations,computed_style_verified:false,effectiveness_verified:false,authority:'NONE'}};
}
test('exact full response reconstructs; claims remain prospective and separate from original reading',()=>{
 const s=JSON.stringify(fixture()),p=create(s);assert.equal(unpackResponse(p.packed_response),s);assert.equal(verify(s,p).status,'EXACT_RESPONSE_AND_QUALIFIED_NATIVE_STACK_VIEW');
 assert.equal(p.full_response_json_read,false);assert.equal(p.actual_reading,false);assert.equal(p.source_quality_gate_pass,false);assert.equal(p.original_source_reading_requirement_changed,false);
 assert.equal(p.review_view.required_original_source_reading,'SEPARATE_AND_UNCHANGED');assert.equal(p.review_view.whole_native_envelope_read,false);assert.equal(p.review_view.complete_parent.text,fixture().text);
});
test('distinct literals occur once; duplicate marks and equal text at different offsets remain separate applications',()=>{
 const p=create(JSON.stringify(fixture())),v=p.review_view,rows=v.application_table.rows;
 assert.equal(new Set(v.native_literal_definitions.map(x=>x.literal)).size,v.native_literal_definitions.length);assert.equal(v.native_literal_definitions.filter(x=>x.literal===mark().style_attribute.decoded_value).length,1);
 assert.deepEqual(rows.map(r=>r.slice(0,2)),[[0,7],[8,15],[15,15],[15,16]]);assert.equal(v.stack_definitions.find(x=>x.id===rows[0][2]).value.length,2);
 const stack=v.stack_definitions.find(x=>x.id===rows[0][2]).value;assert.equal(stack[0],stack[1]);assert.notEqual(rows[0][2],rows[1][2]);
 assert.ok(!reviewJSON(p).includes('/native_source_decorations/annotations/'));assert.ok(p.machine_coverage.original_application_links[0].annotation_pointer);
});
test('adoption and reconstructed DOM scope qualifiers stay complete in distinct definitions',()=>{
 const v=create(JSON.stringify(fixture())).review_view,defs=v.mark_definitions.map(x=>x.value);
 assert.equal(defs.length,2);const adopted=defs.find(x=>x.element_scope.attribute_adoption);assert.equal(adopted.element_scope.source_origin,'PARSE5_START_TOKEN_ATTRIBUTE_OBJECT_IDENTITY');
 assert.deepEqual(adopted.dom_scopes,mark(true).dom_scopes);assert.equal(adopted.start_tag_role,'ATTRIBUTE_ADOPTION_SOURCE_TOKEN');assert.equal(adopted.input_relevance,'UNRESOLVED_CSS');assert.equal(adopted.computed_style_verified,false);assert.equal(adopted.effectiveness_verified,false);
});
test('every zero event, ordered joint origin, codepoint and filtered event remains visible',()=>{
 const p=create(JSON.stringify(fixture())),v=p.review_view,rows=v.application_table.rows;assert.equal(rows[2][4],true);assert.notEqual(rows[3][5],null);
 const q=v.application_qualifications.find(x=>x.id===rows[2][3]).value;assert.equal(q.filtered_source_events[0].category,'ZERO_WIDTH_FILTER');
 const w=v.joint_whitespace_witnesses.find(x=>x.id===rows[3][5]).value;assert.equal(w.origins[0].run_id,'space');assert.equal(w.origins[0].output_character_attribution_verified,false);assert.equal(w.normalized_output.text_from_complete_parent,true);
 assert.deepEqual(w.origins[0].decoded_codepoints_rle.map(x=>[v.native_literal_definitions.find(d=>d.id===x.literal).literal,x.count]),[['U+0020',1],['U+FEFF',1]]);
});
test('unknown schema and fields are held by unchanged V1 checks',()=>{
 for(const mutate of [f=>f.future='unknown',f=>f.native_source_decorations.schema='future',f=>f.native_source_decorations.annotations[0].marks[0].element_scope.future=true]){const f=fixture();mutate(f);assert.throws(()=>create(JSON.stringify(f)));}
});
test('tampering with rows, qualifications, stacks, literals, coverage or packed bytes rejects',()=>{
 const s=JSON.stringify(fixture()),p=create(s);for(const mutate of [x=>x.review_view.application_table.rows.pop(),x=>x.review_view.mark_definitions[1].value.element_scope.attribute_adoption=false,x=>x.review_view.stack_definitions[0].value.reverse().pop(),x=>x.review_view.native_literal_definitions[0].literal='changed',x=>x.machine_coverage.original_application_links.pop(),x=>x.packed_response.original_json_sha256='0'.repeat(64)]){const q=clone(p);mutate(q);assert.throws(()=>verify(s,q));}
});
test('fictional repeated-metadata fixture measures a smaller human view, without an actual-source savings claim',()=>{
 const s=JSON.stringify(fixture(80)),a=prior(s),b=create(s),before=Buffer.byteLength(JSON.stringify(a.review_view)),after=Buffer.byteLength(reviewJSON(b));assert.ok(after<before);assert.equal(b.review_view.application_table.rows.length,80);assert.equal(b.review_view.mark_definitions.length,1);
 console.log(JSON.stringify({schema:'fictional-presentation-v2-size-comparison',fixture_only:true,actual_sources:0,v1_human_view_bytes:before,v2_human_view_bytes:after,applications:80,actual_savings_measured:false}));
});

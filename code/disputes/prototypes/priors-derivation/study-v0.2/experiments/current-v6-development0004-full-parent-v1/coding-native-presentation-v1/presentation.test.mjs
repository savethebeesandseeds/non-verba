// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC: no corpus, stored pages, readers, tokenizers or models.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNativePresentation as create,verifyNativePresentation as verify,packResponse,unpackResponse,reviewJSON,LIMITS} from './presentation.mjs';
const H=v=>createHash('sha256').update(v).digest('hex'),clone=structuredClone;
const rr=(start=10,end=20)=>({start,end,sha256:H(`synthetic:${start}:${end}`)});
function mark(id='mark:10-20',tag='u'){
  const style='font-weight:700; text-decoration:underline; unknown-x:"not waived"';
  return {id,tag,native_tag:tag,start_tag:rr(),start_tag_role:'ELEMENT_START_TAG',element:{start:10,end:80,raw_sha256:H('synthetic raw'),binding:'WHOLE_RAW_SHA256_AND_EXACT_UTF16_INTERVAL_V1'},element_start_tag:rr(),element_scope:{kind:'PARSED_DOM_ELEMENT_WITH_RAW_RANGE',raw_interval_verified:true,attribute_adoption:false,source_origin:'NODE_SOURCE_LOCATION'},end_tag:rr(75,80),style_attribute:{...rr(12,19),decoded_value:style},declarations:[{property:'text-decoration',value:'underline',literal:' text-decoration:underline'}],style_declarations:[{property:'font-weight',value:'700',literal:'font-weight:700'},{property:'text-decoration',value:'underline',literal:' text-decoration:underline'},{property:'unknown-x',value:'"not waived"',literal:' unknown-x:"not waived"'}],input_relevance:'UNRESOLVED_CSS',computed_style_verified:false,effectiveness_verified:false};
}
function annotation(start,end,text,marks=[mark()]){return {start,end,source_segment_start:start,source_segment_end:end,source_segment_count:1,clipped:false,mapping:'EXACT_COLLECTOR_ORIGIN',normalization:'EXACT_DECODED',origins:[{run_id:'run:'+start,raw:rr(start+100,end+100),decoded_start:0,decoded_end:Math.max(1,end-start),decoded_sha256:H(text),clipping_mapping:'EXACT_DECODED_RANGE'}],marks,joint_source_attributions:[],filtered_source_events:[],computed_style_verified:false,effectiveness_verified:false,text};}
function fixture(){
  const text='A🚀 A🚀 ',a=[annotation(100,103,'A🚀'),annotation(104,107,'A🚀'),annotation(107,107,'',[mark('mark:50-60','del')]),annotation(107,108,' ',[])];
  a[2].filtered_source_events=[{normalized_group:{start:107,end:107},run_id:'run:zero',decoded_start:0,decoded_end:1,category:'ZERO_WIDTH_FILTER',decoded_sha256:H('\uFEFF')}];
  a[3].mapping='COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE';a[3].normalization='EXTRACTOR_FILTERED_WHITESPACE_TO_ASCII_SPACE_V1';a[3].joint_source_attributions=[{start:107,end:108,policy:'COMPLETE_ORDERED_WHITESPACE_ORIGIN_EVIDENCE_V1',native_mark_attribution_verified:false,per_run_character_attribution:false}];
  a[3].joint_whitespace_witness={policy:'COMPLETE_ORDERED_WHITESPACE_ORIGIN_EVIDENCE_V1',normalized_output:{text:' ',start:107,end:108,mark_attribution:'UNVERIFIED_NO_SOURCE_ORIGIN_SELECTED'},origins:[{run_id:'run:space-a',raw:rr(300,303),decoded_start:0,decoded_end:3,decoded_sha256:H('  \uFEFF'),decoded_codepoints_rle:[{codepoint:'U+0020',count:2},{codepoint:'U+FEFF',count:1}],marks:[mark()],filtered_source_events:[{run_id:'run:space-a',decoded_start:2,decoded_end:3,category:'ZERO_WIDTH_FILTER',decoded_sha256:H('\uFEFF')}],output_character_attribution_verified:false},{run_id:'run:space-b',raw:rr(400,401),decoded_start:0,decoded_end:1,decoded_sha256:H(' '),decoded_codepoints_rle:[{codepoint:'U+0020',count:1}],marks:[mark('mark:50-60','del')],filtered_source_events:[],output_character_attribution_verified:false}],per_run_character_attribution:false};
  return {audit_id:'coding-0001',source_id:'synthetic-parent',contract_id:'synthetic-contract',purpose:'coding',packet:{path:'synthetic/coding.json',sha256:H('packet'),bytes:123},source:'parent',binding:{sha256:H(text),bytes:Buffer.byteLength(text)},range:{offset:0,end:text.length,total_characters:text.length,absolute_normalized_start:100,offset_basis:'UTF16 decoded text; raw text slices are not raw byte offsets',complete_source_in_this_slice:true,next_offset:null},text,source_url:'https://synthetic.invalid/source',source_scope:'EXTRACTED_FLAT_SPAN',semantic_completeness:'UNVERIFIED_REQUIRES_ORIGINAL_SOURCE_READING',native_source_decorations:{schema:'native-source-decoration-projection-v2',policy:'NATIVE_SOURCE_DECORATION_COLLECTOR_ORIGIN_V4',projection_policy:'ALL_NATIVE_STYLE_SOURCE_METADATA',nondecoration_style_sources_retained_in_trace:1,envelope_sha256:H('envelope'),tracer_source_sha256:H('tracer'),collector_source_sha256:H('collector'),method_identity_status:'CURRENT_METHOD_BINDINGS_SUPPLIED',collector_issue_count:0,raw_sha256:H('raw'),normalized_sha256:H(text),range:{start:100,end:100+text.length,include_end_zero_width:true},collector_mapping_status:'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE',native_style_status:'UNRESOLVED_STYLESHEET_CASCADE',mapping_status:'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE',input_eligibility:'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE',unmapped_ranges:0,unmapped_normalized_ranges:0,unresolved_style_or_origin_evidence:1,annotations:a,computed_style_verified:false,effectiveness_verified:false,authority:'NONE'}};
}
const serialized=()=>JSON.stringify(fixture());
test('full compact response JSON reconstructs exactly with all repeated decoration metadata',()=>{
  const s=serialized(),p=create(s);assert.equal(unpackResponse(p.packed_response),s);assert.equal(H(unpackResponse(p.packed_response)),H(s));assert.equal(verify(s,p).status,'EXACT_RESPONSE_AND_COMPLETE_LITERAL_RELATIONSHIP_VIEW');
  assert.ok(Object.keys(p.packed_response.dictionary).length>0);assert.equal(p.actual_reading,false);assert.equal(p.full_response_json_read,false);assert.equal(p.original_source_reading_requirement_changed,false);
});
test('shared dictionary preserves unknown data, every member order, duplicate and array position',()=>{
  const a={first:'x'.repeat(100),second:'y'.repeat(100)},b={second:a.second,first:a.first},v={future:{'x/y~z':[{...a},b,a,a],unclassified:['not omitted',null,false,42]}},s=JSON.stringify(v),packed=packResponse(s);
  assert.equal(unpackResponse(packed),s);assert.deepEqual(JSON.parse(unpackResponse(packed)),v);assert.deepEqual(Object.keys(JSON.parse(unpackResponse(packed)).future['x/y~z'][1]),['second','first']);
});
test('native literals are defined once while every occurrence and application remains distinct',()=>{
  const p=create(serialized()),v=p.review_view,style=fixture().native_source_decorations.annotations[0].marks[0].style_attribute.decoded_value;
  const entry=v.native_literal_definitions.filter(x=>x.literal===style);assert.equal(entry.length,1);assert.ok(entry[0].occurrences.length>=3);
  assert.deepEqual(v.ordered_applications.map(x=>x.normalized_range),[[100,103],[104,107],[107,107],[107,108]]);
  assert.equal(v.complete_parent.text,'A🚀 A🚀 ');assert.equal(v.ordered_applications[0].text_sha256,v.ordered_applications[1].text_sha256);assert.notEqual(v.ordered_applications[0].annotation_pointer,v.ordered_applications[1].annotation_pointer);
});
test('complete ordered JSON relationship and every string occurrence are covered',()=>{
  const f=fixture(),p=create(JSON.stringify(f));let strings=0,relationships=0,keys=0;function oracle(v){if(typeof v==='string')strings++;else if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v)){relationships++;if(!Array.isArray(v))keys++;oracle(x);}}}oracle(f);
  assert.equal(p.coverage.string_value_occurrences,strings);assert.equal(p.coverage.ordered_relationships,relationships);assert.equal(p.coverage.object_key_occurrences,keys);
  assert.equal(p.coverage.source_text_occurrences+p.coverage.native_literal_occurrence_count+p.coverage.machine_structure_string_occurrences,strings);
  assert.deepEqual(p.coverage.native_literal_occurrences.map(x=>x.pointer),p.review_view.native_literal_definitions.flatMap(x=>x.occurrences).sort((a,b)=>p.coverage.native_literal_occurrences.findIndex(x=>x.pointer===a)-p.coverage.native_literal_occurrences.findIndex(x=>x.pointer===b)));
});
test('zero-output events, joint whitespace, origin order and codepoints are retained',()=>{
  const s=serialized(),p=create(s),apps=p.review_view.ordered_applications;assert.equal(p.coverage.zero_output_applications,1);assert.equal(p.coverage.joint_whitespace_applications,1);assert.equal(apps[2].zero_output,true);assert.equal(apps[2].filtered_event_pointers.length,1);assert.ok(apps[3].joint_whitespace_witness_pointer);assert.ok(apps[3].witness_native_literals.some(x=>p.review_view.native_literal_definitions.some(d=>d.id===x.literal_id&&d.literal==='U+FEFF')));
  const restored=JSON.parse(unpackResponse(p.packed_response));assert.deepEqual(restored.native_source_decorations.annotations[3].joint_whitespace_witness.origins,fixture().native_source_decorations.annotations[3].joint_whitespace_witness.origins);
});
test('unknown schema, projection policy and new fields fail before any presentation claim',()=>{
  for(const mutate of [f=>f.native_source_decorations.schema='native-source-decoration-projection-v3',f=>f.native_source_decorations.projection_policy='COMPACT_DECORATION_RELEVANT_NATIVE_EVIDENCE',f=>f.new_field='not silently ignored',f=>f.native_source_decorations.new_field={literal:'not discarded'},f=>f.native_source_decorations.annotations[0].marks[0].future_literal='except this',f=>f.native_source_decorations.annotations[3].joint_whitespace_witness.origins[0].future='x']){
    const f=fixture();mutate(f);const s=JSON.stringify(f);assert.equal(unpackResponse(packResponse(s)),s);assert.throws(()=>create(s));
  }
});
test('partial parents and unsupported source modes cannot obtain complete-parent claims',()=>{
  for(const mutate of [f=>f.source='raw',f=>f.purpose='development',f=>f.range.offset=1,f=>f.range.total_characters++,f=>f.range.complete_source_in_this_slice=false,f=>f.native_source_decorations.range.include_end_zero_width=false]){const f=fixture();mutate(f);assert.throws(()=>create(JSON.stringify(f)));}
});
test('source association cannot split a surrogate, move a duplicate, or alter annotation text',()=>{
  for(const mutate of [f=>f.native_source_decorations.annotations[0].end=102,f=>f.native_source_decorations.annotations[1].start=103,f=>f.native_source_decorations.annotations[0].text='other',f=>f.native_source_decorations.annotations[2].end=109]){const f=fixture();mutate(f);assert.throws(()=>create(JSON.stringify(f)));}
  const p=create(serialized());assert.equal(p.review_view.complete_parent.text.length,8);assert.equal(unpackResponse(p.packed_response),serialized());
});
test('tampered views, occurrences, ordering, witness relations and original bytes refuse verification',()=>{
  const s=serialized(),p=create(s);
  for(const mutate of [x=>x.review_view.complete_parent.text='shortened',x=>x.review_view.native_literal_definitions[0].occurrences.pop(),x=>x.review_view.ordered_applications.reverse(),x=>x.review_view.ordered_applications[3].joint_whitespace_witness_pointer=null,x=>x.coverage.native_literal_occurrences.pop(),x=>x.coverage.all_ordered_relationships_sha256='0'.repeat(64)]){const x=clone(p);mutate(x);assert.throws(()=>verify(s,x));}
  assert.throws(()=>verify(s.replace('not waived','waived'),p));
});
test('dictionary cycles, unknown refs, unused objects and literal reserved refs fail closed',()=>{
  const packed=packResponse(serialized());for(const mutate of [x=>x.dictionary.d999={$ref:'d999'},x=>x.value={$ref:'missing'},x=>x.dictionary.unused='not used',x=>x.original_json_sha256='f'.repeat(64)]){const x=clone(packed);mutate(x);assert.throws(()=>unpackResponse(x));}
  assert.throws(()=>packResponse(JSON.stringify({literal:{$ref:'d0'}})));
});
test('Unicode, quotes, escaped marker-looking literals and unknown CSS remain literal values',()=>{
  const f=fixture();f.native_source_decorations.annotations[0].marks[0].style_attribute.decoded_value='"\\\n[not a wrapper] é𝒳 中国';const s=JSON.stringify(f),p=create(s);assert.equal(unpackResponse(p.packed_response),s);assert.ok(p.review_view.native_literal_definitions.some(x=>x.literal==='"\\\n[not a wrapper] é𝒳 中国'));
  assert.throws(()=>packResponse('{"s":"\\ud800"}'));assert.throws(()=>packResponse('{"s":"\\udc00"}'));
});
test('response, tree, whole presentation and complete review bounds never truncate',()=>{
  const s=serialized(),p=create(s),view=JSON.stringify(p.review_view);
  assert.throws(()=>create(s,{limits:{response_bytes:Buffer.byteLength(s)-1}}));assert.throws(()=>create(s,{limits:{nodes:10}}));assert.throws(()=>create(s,{limits:{depth:2}}));assert.throws(()=>create(s,{limits:{presentation_bytes:JSON.stringify(p).length-1}}));assert.throws(()=>create(s,{limits:{review_bytes:Buffer.byteLength(view)-1}}));assert.throws(()=>create(s,{limits:{review_utf16:view.length-1}}));
  assert.equal(reviewJSON(p),view);assert.throws(()=>create(s,{limits:{response_bytes:LIMITS.response_bytes+1}}));assert.throws(()=>create(s,{limits:{unbounded:true}}));
});
test('noncanonical JSON, duplicate member spelling and formatting are never normalized silently',()=>{
  for(const s of [' '+serialized(),serialized()+'\n','{"a":1,"a":1}','{"x":"\\u0061"}','{"n":1e0}'])assert.throws(()=>packResponse(s));
});

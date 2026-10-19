// SPDX-License-Identifier: AGPL-3.0-only
// Pure, prospective presentation. No files, readers, model calls or judgments.
import {createHash} from 'node:crypto';

export const POLICY='CODING_B_OBSERVED_NATIVE_LITERAL_SLICE_MACHINE_STRUCTURE_V3_2M_UNADOPTED';
export const LIMITS=Object.freeze({response_bytes:2097152,presentation_bytes:4194304,review_bytes:1048576,review_utf16:1048576,nodes:100000,depth:64});
const fail=c=>{throw Object.assign(Error(c),{code:c});},ok=(v,c)=>{if(!v)fail(c);};
const H=v=>createHash('sha256').update(v).digest('hex');
const C=v=>Array.isArray(v)?'['+v.map(C).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}':JSON.stringify(v);
const D=v=>H(C(v)),B=v=>Buffer.byteLength(v,'utf8'),own=(v,k)=>Object.hasOwn(v,k);
const pointer=t=>t.length?'/'+t.map(s=>String(s).replace(/~/g,'~0').replace(/\//g,'~1')).join('/'):'';
const scalar=s=>{for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){ok(i+1<s.length&&s.charCodeAt(++i)>=0xdc00&&s.charCodeAt(i)<=0xdfff,'PRESENTATION_SURROGATE');}else ok(c<0xdc00||c>0xdfff,'PRESENTATION_SURROGATE');}};
const point=(s,i)=>!(i>0&&i<s.length&&/[\uD800-\uDBFF]/u.test(s[i-1])&&/[\uDC00-\uDFFF]/u.test(s[i]));
function limits(options={}){ok(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>own(LIMITS,k)),'PRESENTATION_LIMIT_KEYS');const out={...LIMITS,...options};for(const k of Object.keys(LIMITS))ok(Number.isSafeInteger(out[k])&&out[k]>0&&out[k]<=LIMITS[k],'PRESENTATION_LIMIT');return out;}
function inspect(value,l){let nodes=0;function walk(v,depth){ok(++nodes<=l.nodes&&depth<=l.depth,'PRESENTATION_TREE_BOUND');if(typeof v==='string')scalar(v);else if(v&&typeof v==='object'){if(!Array.isArray(v))for(const k of Object.keys(v))scalar(k);ok(!(Object.keys(v).length===1&&typeof v.$ref==='string'),'PRESENTATION_RESERVED_REF');for(const x of Array.isArray(v)?v:Object.values(v))walk(x,depth+1);}else if(typeof v==='number')ok(Number.isFinite(v),'PRESENTATION_NUMBER');}walk(value,0);return nodes;}
function parse(serialized,l){ok(typeof serialized==='string'&&B(serialized)<=l.response_bytes,'PRESENTATION_RESPONSE_BOUND');let value;try{value=JSON.parse(serialized);}catch{fail('PRESENTATION_JSON');}ok(JSON.stringify(value)===serialized,'PRESENTATION_CANONICAL_JSON_REQUIRED');inspect(value,l);return value;}

// Port of representation-replay.mjs dictionary(): repeated subtrees >=80
// serialized characters and deterministic shared refs. Exact serialized subtree
// identities additionally preserve differing object-member orders byte for byte.
export function packResponse(serialized,{limits:options}={}){
  const l=limits(options),value=parse(serialized,l),counts=new Map(),values=new Map();
  function count(v){if(v&&typeof v==='object')for(const child of Array.isArray(v)?v:Object.values(v))count(child);if(JSON.stringify(v).length>=80){const key=H(JSON.stringify(v));counts.set(key,(counts.get(key)??0)+1);values.set(key,v);}}count(value);
  const keys=[...counts].filter(([,n])=>n>1).map(([k])=>k).sort(),ids=new Map(keys.map((k,i)=>[k,'d'+i]));
  function encode(v,owner=null){const key=H(JSON.stringify(v));if(ids.has(key)&&key!==owner)return {$ref:ids.get(key)};if(Array.isArray(v))return v.map(x=>encode(x));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]));return v;}
  const result={schema:'lossless-recursive-shared-object-dictionary-v1',dictionary:Object.fromEntries(keys.map(k=>[ids.get(k),encode(values.get(k),k)])),value:encode(value),original_json_sha256:H(serialized),original_json_bytes:B(serialized)};
  ok(unpackResponse(result,{limits:options})===serialized,'PRESENTATION_EXACT_RESPONSE_ROUNDTRIP');return result;
}
export function unpackResponse(packed,{limits:options}={}){
  const l=limits(options);ok(packed&&packed.schema==='lossless-recursive-shared-object-dictionary-v1'&&packed.dictionary&&typeof packed.dictionary==='object'&&!Array.isArray(packed.dictionary),'PRESENTATION_DICTIONARY_SCHEMA');
  ok(JSON.stringify(Object.keys(packed))===JSON.stringify(['schema','dictionary','value','original_json_sha256','original_json_bytes']),'PRESENTATION_DICTIONARY_FIELDS');
  const visiting=new Set(),used=new Set();let nodes=0;
  function decode(v,depth){ok(++nodes<=l.nodes&&depth<=l.depth,'PRESENTATION_DECODE_BOUND');if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===1&&typeof v.$ref==='string'){ok(/^d[0-9]+$/.test(v.$ref)&&!visiting.has(v.$ref)&&own(packed.dictionary,v.$ref),'PRESENTATION_DICTIONARY_REF');visiting.add(v.$ref);used.add(v.$ref);const out=decode(packed.dictionary[v.$ref],depth+1);visiting.delete(v.$ref);return out;}if(Array.isArray(v))return v.map(x=>decode(x,depth+1));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x,depth+1)]));return v;}
  const value=decode(packed.value,0);ok(used.size===Object.keys(packed.dictionary).length,'PRESENTATION_UNUSED_DICTIONARY');const serialized=JSON.stringify(value);
  ok(B(serialized)<=l.response_bytes&&H(serialized)===packed.original_json_sha256&&B(serialized)===packed.original_json_bytes,'PRESENTATION_RESPONSE_RECONSTRUCTION');inspect(value,l);return serialized;
}

function object(v){ok(v&&typeof v==='object'&&!Array.isArray(v),'PRESENTATION_OBJECT');}
function fields(v,required,optional=[]){object(v);ok(required.every(k=>own(v,k)),'PRESENTATION_MISSING_FIELD');ok(Object.keys(v).every(k=>required.includes(k)||optional.includes(k)),'PRESENTATION_UNKNOWN_FIELD');}
function ints(v,keys){for(const k of keys)ok(Number.isSafeInteger(v[k])&&v[k]>=0,'PRESENTATION_COORDINATE');}
function interval(v,{artifact=false,reported=false}={}){
  if(v===null)return;
  if(artifact)fields(v,['start','end','raw_sha256','binding']);else if(reported)fields(v,['start','end','raw_interval_verified']);else fields(v,['start','end','sha256']);
  ints(v,['start','end']);ok(v.end>=v.start,'PRESENTATION_INTERVAL');
}
function declarations(a){ok(Array.isArray(a),'PRESENTATION_DECLARATIONS');for(const d of a){fields(d,['property','value','literal']);ok((typeof d.property==='string'||d.property===null)&&(typeof d.value==='string'||d.value===null)&&typeof d.literal==='string','PRESENTATION_DECLARATION');}}
function mark(m){
  fields(m,['id','tag','native_tag','start_tag','start_tag_role','element','element_start_tag','element_scope','end_tag','style_attribute','declarations','style_declarations','input_relevance','computed_style_verified','effectiveness_verified'],['dom_scopes']);
  interval(m.start_tag);interval(m.element,{artifact:true});interval(m.element_start_tag);interval(m.end_tag);
  fields(m.element_scope,['kind','raw_interval_verified','attribute_adoption','source_origin']);
  if(m.style_attribute!==null){fields(m.style_attribute,['start','end','sha256','decoded_value']);ints(m.style_attribute,['start','end']);ok(m.style_attribute.end>=m.style_attribute.start&&typeof m.style_attribute.decoded_value==='string','PRESENTATION_STYLE');}
  declarations(m.declarations);declarations(m.style_declarations);
  ok(typeof m.id==='string'&&typeof m.tag==='string'&&(typeof m.native_tag==='string'||m.native_tag===null)&&m.computed_style_verified===false&&m.effectiveness_verified===false,'PRESENTATION_MARK');
  if(own(m,'dom_scopes')){ok(Array.isArray(m.dom_scopes),'PRESENTATION_DOM_SCOPES');for(const s of m.dom_scopes){fields(s,['id','kind','raw_interval_verified','element','element_start_tag','end_tag'],['parser_reported_location','source_origin']);interval(s.element,{artifact:true});interval(s.element_start_tag);interval(s.end_tag);if(own(s,'parser_reported_location'))interval(s.parser_reported_location,{reported:true});}}
}
function filtered(e){fields(e,['run_id','decoded_start','decoded_end','category','decoded_sha256'],['normalized_group']);ints(e,['decoded_start','decoded_end']);ok(e.decoded_end>=e.decoded_start,'PRESENTATION_FILTER_RANGE');if(own(e,'normalized_group')){fields(e.normalized_group,['start','end']);ints(e.normalized_group,['start','end']);}}
function origin(o){fields(o,['run_id','raw','decoded_start','decoded_end','decoded_sha256','clipping_mapping']);interval(o.raw);ints(o,['decoded_start','decoded_end']);ok(o.decoded_end>=o.decoded_start,'PRESENTATION_ORIGIN_RANGE');}
function witness(w){
  fields(w,['policy','normalized_output','origins','per_run_character_attribution']);fields(w.normalized_output,['text','start','end','mark_attribution']);ints(w.normalized_output,['start','end']);
  ok(Array.isArray(w.origins),'PRESENTATION_WITNESS_ORIGINS');for(const o of w.origins){fields(o,['run_id','raw','decoded_start','decoded_end','decoded_sha256','decoded_codepoints_rle','marks','filtered_source_events','output_character_attribution_verified']);interval(o.raw);ints(o,['decoded_start','decoded_end']);ok(Array.isArray(o.decoded_codepoints_rle)&&Array.isArray(o.marks)&&Array.isArray(o.filtered_source_events),'PRESENTATION_WITNESS_ARRAYS');for(const c of o.decoded_codepoints_rle){fields(c,['codepoint','count']);ok(/^U\+[0-9A-F]{4,6}$/.test(c.codepoint)&&Number.isSafeInteger(c.count)&&c.count>0,'PRESENTATION_CODEPOINT_RLE');}o.marks.forEach(mark);o.filtered_source_events.forEach(filtered);}
}
function schema(root){
  fields(root,['audit_id','source_id','contract_id','purpose','packet','source','binding','range','text','source_scope','semantic_completeness','native_source_decorations'],['source_url']);
  ok(root.purpose==='coding'&&root.source==='parent'&&root.source_scope==='EXTRACTED_FLAT_SPAN'&&typeof root.text==='string','PRESENTATION_CODING_PARENT_SCOPE');
  fields(root.packet,['path','sha256','bytes']);fields(root.binding,['sha256','bytes']);
  fields(root.range,['offset','end','total_characters','absolute_normalized_start','offset_basis','complete_source_in_this_slice','next_offset']);ints(root.range,['offset','end','total_characters','absolute_normalized_start']);
  ok(root.range.end>root.range.offset&&root.range.end-root.range.offset===root.text.length&&root.range.end<=root.range.total_characters&&root.range.absolute_normalized_start>=root.range.offset&&root.range.complete_source_in_this_slice===(root.range.offset===0&&root.range.end===root.range.total_characters)&&root.range.next_offset===(root.range.end<root.range.total_characters?root.range.end:null),'PRESENTATION_EXACT_REPORTED_PARENT_SLICE_REQUIRED');
  const n=root.native_source_decorations;
  fields(n,['schema','policy','projection_policy','nondecoration_style_sources_retained_in_trace','envelope_sha256','tracer_source_sha256','collector_source_sha256','method_identity_status','collector_issue_count','raw_sha256','normalized_sha256','range','collector_mapping_status','native_style_status','mapping_status','input_eligibility','unmapped_ranges','unmapped_normalized_ranges','unresolved_style_or_origin_evidence','annotations','computed_style_verified','effectiveness_verified','authority']);
  ok(n.schema==='native-source-decoration-projection-v2'&&n.policy==='NATIVE_SOURCE_DECORATION_COLLECTOR_ORIGIN_V4'&&n.projection_policy==='ALL_NATIVE_STYLE_SOURCE_METADATA'&&n.computed_style_verified===false&&n.effectiveness_verified===false&&n.authority==='NONE','PRESENTATION_UNSUPPORTED_NATIVE_SCHEMA_OR_POLICY');
  fields(n.range,['start','end','include_end_zero_width']);ints(n.range,['start','end']);ok(n.range.start===root.range.absolute_normalized_start&&n.range.end===n.range.start+root.text.length&&n.range.include_end_zero_width===(root.range.end===root.range.total_characters),'PRESENTATION_NATIVE_RANGE');
  ok(Array.isArray(n.annotations),'PRESENTATION_ANNOTATIONS');
  for(const a of n.annotations){
    fields(a,['start','end','source_segment_start','source_segment_end','source_segment_count','clipped','mapping','normalization','origins','marks','joint_source_attributions','filtered_source_events','computed_style_verified','effectiveness_verified','text'],['joint_whitespace_witness']);
    ints(a,['start','end','source_segment_start','source_segment_end','source_segment_count']);ok(a.start>=n.range.start&&a.end>=a.start&&a.end<=n.range.end&&typeof a.text==='string'&&a.text===root.text.slice(a.start-n.range.start,a.end-n.range.start)&&point(root.text,a.start-n.range.start)&&point(root.text,a.end-n.range.start),'PRESENTATION_ANNOTATION_SOURCE');
    ok(Array.isArray(a.origins)&&Array.isArray(a.marks)&&Array.isArray(a.joint_source_attributions)&&Array.isArray(a.filtered_source_events)&&a.computed_style_verified===false&&a.effectiveness_verified===false,'PRESENTATION_ANNOTATION_ARRAYS');a.origins.forEach(origin);a.marks.forEach(mark);a.filtered_source_events.forEach(filtered);
    for(const j of a.joint_source_attributions){fields(j,['start','end','policy','per_run_character_attribution'],['path_id','native_mark_attribution_verified']);ints(j,['start','end']);}
    if(own(a,'joint_whitespace_witness')){witness(a.joint_whitespace_witness);ok(a.joint_whitespace_witness.normalized_output.text===a.text&&a.joint_whitespace_witness.normalized_output.start===a.start&&a.joint_whitespace_witness.normalized_output.end===a.end,'PRESENTATION_WITNESS_SOURCE');}
  }
}
function literalRole(tokens){
  const key=tokens.at(-1),s=tokens.map(String);
  if(s.length===1&&key==='text'||key==='text'&&(s.includes('annotations')||s.includes('normalized_output')))return 'SOURCE_TEXT';
  if(s.includes('marks')&&(['tag','native_tag'].includes(key)||s.includes('style_attribute')&&key==='decoded_value'||(s.includes('declarations')||s.includes('style_declarations'))&&['property','value','literal'].includes(key)))return 'NATIVE_LITERAL';
  if(s.includes('decoded_codepoints_rle')&&key==='codepoint')return 'NATIVE_LITERAL';
  return 'MACHINE_STRUCTURE';
}
function derive(root){
  const native=root.native_source_decorations,catalog=[],ids=new Map(),strings=[],relationships=[];let nodes=0,keyCount=0;
  // Explicit traversal avoids treating repeated values as the same occurrence.
  function visit(v,tokens=[]){nodes++;const p=pointer(tokens);if(typeof v==='string'){
    const role=literalRole(tokens);let id=null;if(role==='NATIVE_LITERAL'){if(!ids.has(v)){ids.set(v,'L'+String(ids.size+1));catalog.push({id:ids.get(v),literal:v,occurrences:[]});}id=ids.get(v);catalog.find(x=>x.id===id).occurrences.push(p);}strings.push({pointer:p,role,sha256:H(v),UTF16:v.length,literal_id:id});
  }else if(v&&typeof v==='object'){
    const entries=Array.isArray(v)?v.map((x,i)=>[i,x]):Object.entries(v);for(let i=0;i<entries.length;i++){const [key,x]=entries[i];if(!Array.isArray(v))keyCount++;const child=[...tokens,key];relationships.push({parent:p,child:pointer(child),member:key,ordinal:i});visit(x,child);}
  }}visit(root);
  const occurrenceRefs=p=>strings.filter(x=>x.role==='NATIVE_LITERAL'&&(x.pointer===p||x.pointer.startsWith(p+'/'))).map(x=>({pointer:x.pointer,literal_id:x.literal_id}));
  const marked=(m,j,p)=>({ordinal:j,pointer:p,source_id:m.id,native_literals:occurrenceRefs(p),scope_kind:m.element_scope.kind,raw_interval_verified:m.element_scope.raw_interval_verified,start_tag_role:m.start_tag_role,input_relevance:m.input_relevance,reconstructed_dom_scope_count:m.dom_scopes?.length??0});
  const apps=native.annotations.map((a,i)=>{
    const p='/native_source_decorations/annotations/'+i;
    return {ordinal:i,annotation_pointer:p,normalized_range:[a.start,a.end],parent_relative_range:[a.start-native.range.start,a.end-native.range.start],zero_output:a.start===a.end,text_sha256:H(a.text),mapping:a.mapping,normalization:a.normalization,clipped:a.clipped,ordered_marks:a.marks.map((m,j)=>marked(m,j,p+'/marks/'+j)),origin_pointers:a.origins.map((_,j)=>p+'/origins/'+j),joint_attribution_pointers:a.joint_source_attributions.map((_,j)=>p+'/joint_source_attributions/'+j),filtered_event_pointers:a.filtered_source_events.map((_,j)=>p+'/filtered_source_events/'+j),joint_whitespace_witness_pointer:own(a,'joint_whitespace_witness')?p+'/joint_whitespace_witness':null,witness_native_literals:own(a,'joint_whitespace_witness')?occurrenceRefs(p+'/joint_whitespace_witness'):[],ordered_joint_origins:own(a,'joint_whitespace_witness')?a.joint_whitespace_witness.origins.map((o,j)=>({ordinal:j,pointer:p+'/joint_whitespace_witness/origins/'+j,run_id:o.run_id,ordered_marks:o.marks.map((m,k)=>marked(m,k,p+'/joint_whitespace_witness/origins/'+j+'/marks/'+k)),codepoints:o.decoded_codepoints_rle.map(c=>({...c})),filtered_event_count:o.filtered_source_events.length,output_character_attribution_verified:o.output_character_attribution_verified})):[]};
  });
  const view={schema:'complete-native-literal-review-view-v1',policy:POLICY,scope:'OBSERVED_STORED_PARENT_SLICE_AND_LITERAL_VALUES_OF_EXACT_ALL_NATIVE_PROJECTION_ONLY',claim:'observed-slice native-literal presentation plus machine-verified structure',not_reading_claims:['FULL_RESPONSE_JSON_READ','WHOLE_ORIGINAL_DOCUMENT_READ','WHOLE_NATIVE_ENVELOPE_READ','COMPUTED_STYLE_OR_EFFECT_VERIFIED'],case:{audit_id:root.audit_id,source_id:root.source_id,contract_id:root.contract_id,source_url:root.source_url??null},observed_parent_slice:{text:root.text,normalized_range:[native.range.start,native.range.end],parent_relative_range:[root.range.offset,root.range.end],reported_total_parent_characters:root.range.total_characters,reported_complete_parent:root.range.complete_source_in_this_slice,include_parent_terminal_zero_width:native.range.include_end_zero_width,sha256:H(root.text)},native_literal_definitions:catalog,ordered_applications:apps,unverified_status:{computed_style_verified:false,effectiveness_verified:false,native_style_status:native.native_style_status,mapping_status:native.mapping_status,input_eligibility:native.input_eligibility,collector_issue_count:native.collector_issue_count,unmapped_ranges:native.unmapped_ranges,unmapped_normalized_ranges:native.unmapped_normalized_ranges,unresolved_style_or_origin_evidence:native.unresolved_style_or_origin_evidence},required_original_source_reading:'SEPARATE_AND_UNCHANGED',authority:'NONE'};
  return {view,coverage:{nodes,object_key_occurrences:keyCount,string_value_occurrences:strings.length,source_text_occurrences:strings.filter(x=>x.role==='SOURCE_TEXT').length,native_literal_occurrence_count:strings.filter(x=>x.role==='NATIVE_LITERAL').length,machine_structure_string_occurrences:strings.filter(x=>x.role==='MACHINE_STRUCTURE').length,all_string_occurrences_sha256:D(strings),ordered_relationships:relationships.length,all_ordered_relationships_sha256:D(relationships),native_literal_occurrences:strings.filter(x=>x.role==='NATIVE_LITERAL'),application_count:apps.length,zero_output_applications:apps.filter(a=>a.zero_output).length,joint_whitespace_applications:apps.filter(a=>a.joint_whitespace_witness_pointer!==null).length}};
}
export function createNativePresentation(serialized,{limits:options}={}){
  const l=limits(options),root=parse(serialized,l);schema(root);const packed=packResponse(serialized,{limits:options}),derived=derive(root),reviewJSON=JSON.stringify(derived.view);
  ok(B(reviewJSON)<=l.review_bytes&&reviewJSON.length<=l.review_utf16,'PRESENTATION_REVIEW_BOUND');
  const result={schema:'reversible-native-presentation-v1',policy:POLICY,original_response:{sha256:H(serialized),bytes:B(serialized)},packed_response:packed,review_view:derived.view,coverage:derived.coverage,review_view_sha256:H(reviewJSON),full_response_json_read:false,original_source_reading_requirement_changed:false,actual_reading:false,authority:'NONE'};
  ok(B(JSON.stringify(result))<=l.presentation_bytes,'PRESENTATION_OUTPUT_BOUND');return result;
}
export function verifyNativePresentation(serialized,presentation,{limits:options}={}){
  const l=limits(options);ok(B(JSON.stringify(presentation))<=l.presentation_bytes,'PRESENTATION_OUTPUT_BOUND');
  ok(presentation?.schema==='reversible-native-presentation-v1'&&presentation.policy===POLICY,'PRESENTATION_SCHEMA');
  ok(unpackResponse(presentation.packed_response,{limits:options})===serialized,'PRESENTATION_ORIGINAL_JSON');
  const expected=createNativePresentation(serialized,{limits:options});ok(JSON.stringify(expected)===JSON.stringify(presentation),'PRESENTATION_LITERAL_OR_RELATIONSHIP_COVERAGE');return {status:'EXACT_RESPONSE_AND_OBSERVED_SLICE_LITERAL_RELATIONSHIP_VIEW',original_response:expected.original_response,review_view_sha256:expected.review_view_sha256,actual_reading:false,source_quality_gate_pass:false,authority:'NONE'};
}
export function reviewJSON(presentation,{limits:options}={}){
  const original=unpackResponse(presentation.packed_response,{limits:options});verifyNativePresentation(original,presentation,{limits:options});return JSON.stringify(presentation.review_view);
}

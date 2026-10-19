// SPDX-License-Identifier: AGPL-3.0-only
// Fictional controls only. No prepared responses, coders, readers or models.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createNativePresentation as create,verifyNativePresentation as verify,reviewJSON,unpackResponse} from './presentation.mjs';
import {createNativePresentation as prior} from '../coding-native-presentation-v2/presentation.mjs';
import {fixture,mark,rr} from './fixture.mjs';
const H=v=>createHash('sha256').update(v).digest('hex'),J=JSON.stringify,clone=structuredClone;
function slice(full,start,end){const f=clone(full),base=full.range.absolute_normalized_start;f.text=full.text.slice(start,end);Object.assign(f.range,{offset:start,end,total_characters:full.text.length,absolute_normalized_start:base+start,complete_source_in_this_slice:start===0&&end===full.text.length,next_offset:end<full.text.length?end:null});f.native_source_decorations.range={start:base+start,end:base+end,include_end_zero_width:end===full.text.length};f.native_source_decorations.annotations=f.native_source_decorations.annotations.filter(a=>a.start>=base+start&&a.end<=base+end&&(a.start<base+end||end===full.text.length));return f;}
test('validator is an explicit exact-literal fork; V1 remains unchanged',()=>{
 const baseline=fs.readFileSync(new URL('../coding-native-presentation-v1/presentation.mjs',import.meta.url),'utf8'),delta=JSON.parse(fs.readFileSync(new URL('./source-delta.json',import.meta.url),'utf8'));assert.equal(H(baseline),delta.baseline_sha256);let expected=baseline;
 for(const p of delta.ordered_exact_replacements){assert.equal(expected.split(p.old).length,2);expected=expected.replace(p.old,p.new);}assert.equal(fs.readFileSync(new URL('./response-validation.mjs',import.meta.url),'utf8'),expected);
});
test('full responses preserve exact bytes and explicitly reported full-parent coverage only',()=>{
 const s=J(fixture()),p=create(s);assert.equal(unpackResponse(p.packed_response),s);assert.equal(verify(s,p).status,'EXACT_RESPONSE_AND_OBSERVED_SLICE_QUALIFIED_STACK_VIEW');assert.equal(p.review_view.reported_full_parent_coverage,true);assert.equal(Object.hasOwn(p.review_view,'complete_parent'),false);assert.equal(p.review_view.observed_parent_slice.include_parent_terminal_zero_width,true);assert.equal(p.actual_reading,false);assert.equal(p.original_source_reading_requirement_changed,false);
});
test('first and final partial slices preserve total, offsets, absolute coordinates and truthful terminal ownership',()=>{
 const f=fixture();for(const [start,end] of [[0,8],[8,f.text.length],[15,f.text.length]]){const response=slice(f,start,end),s=J(response),p=create(s),v=p.review_view;assert.equal(v.reported_full_parent_coverage,false);assert.equal(v.observed_parent_slice.reported_total_parent_characters,f.text.length);assert.deepEqual(v.observed_parent_slice.parent_relative_range,[start,end]);assert.deepEqual(p.input_identity.range,response.range);assert.equal(p.input_identity.reported_parent_absolute_start,100);assert.equal(v.observed_parent_slice.include_parent_terminal_zero_width,end===f.text.length);assert.equal(unpackResponse(p.packed_response),s);assert.equal(verify(s,p).actual_reading,false);}
});
test('a fictional 46415-character parent remains partial after an eight-character observed slice',()=>{
 const f=fixture();f.text+='X'.repeat(46415-f.text.length);f.binding={sha256:H(f.text),bytes:Buffer.byteLength(f.text)};Object.assign(f.range,{end:46415,total_characters:46415});f.native_source_decorations.range.end=46515;f.native_source_decorations.normalized_sha256=H(f.text);
 const p=create(J(slice(f,0,8)));assert.equal(p.review_view.observed_parent_slice.reported_total_parent_characters,46415);assert.equal(p.review_view.reported_full_parent_coverage,false);assert.equal(p.input_identity.range.next_offset,8);assert.equal(p.review_view.observed_parent_slice.text.length,8);
});
test('false full-parent declarations, inconsistent totals/ranges and terminal flags are rejected',()=>{
 for(const mutate of [f=>f.range.complete_source_in_this_slice=true,f=>f.range.total_characters=7,f=>f.range.end++,f=>f.range.next_offset=null,f=>f.range.absolute_normalized_start=0,f=>f.native_source_decorations.range.include_end_zero_width=true]){const f=slice(fixture(),0,8);mutate(f);assert.throws(()=>create(J(f)));}
 const end=slice(fixture(),8,16);end.native_source_decorations.range.include_end_zero_width=false;assert.throws(()=>create(J(end)));
});
test('surrogate cuts and unknown root, scope, witness or projection fields fail closed',()=>{
 for(const [a,b] of [[0,6],[6,8]])assert.throws(()=>create(J(slice(fixture(),a,b))));
 for(const mutate of [f=>f.future=true,f=>f.native_source_decorations.projection_policy='future',f=>f.native_source_decorations.annotations[0].marks[0].element_scope.future=true,f=>f.native_source_decorations.annotations[3].joint_whitespace_witness.future=true]){const f=fixture();mutate(f);assert.throws(()=>create(J(f)));}
});
test('wire differences factor out while all adoption/DOM/status distinctions and duplicate stack members remain',()=>{
 const f=fixture(2),a=f.native_source_decorations.annotations;a[1].marks=clone(a[0].marks);for(const m of a[1].marks){m.id='different-token';m.start_tag=rr(400,450);m.element_start_tag=rr(400,450);}
 const v=create(J(f)).review_view;assert.equal(v.qualified_mark_definitions.length,1);assert.equal(v.stack_definitions[0].value.length,2);assert.equal(v.stack_definitions[0].value[0],v.stack_definitions[0].value[1]);assert.equal(v.application_table.rows.length,2);
 const q=create(J(fixture())).review_view,adopted=q.qualified_mark_definitions.map(x=>x.value).find(x=>x.element_scope.attribute_adoption);assert.equal(q.qualified_mark_definitions.length,2);assert.equal(adopted.element_scope.source_origin,mark(true).element_scope.source_origin);assert.equal(adopted.dom_scopes[0].kind,mark(true).dom_scopes[0].kind);assert.equal(adopted.dom_scopes[0].parser_reported_location.raw_interval_verified,false);assert.equal(adopted.start_tag_role,'ATTRIBUTE_ADOPTION_SOURCE_TOKEN');assert.equal(adopted.computed_style_verified,false);
});
test('all literal definitions, ordered duplicate/zero applications and joint origins remain visible',()=>{
 const p=create(J(fixture())),v=p.review_view,rows=v.application_table.rows;assert.equal(new Set(v.native_literal_definitions.map(x=>x.literal)).size,v.native_literal_definitions.length);assert.deepEqual(rows.map(r=>r.slice(0,2)),[[0,7],[8,15],[15,15],[15,16]]);assert.equal(rows[2][4],true);
 const q=v.application_qualifications.find(x=>x.id===rows[2][3]).value;assert.equal(q.filtered_source_events[0].category,'ZERO_WIDTH_FILTER');const w=v.joint_whitespace_witnesses.find(x=>x.id===rows[3][5]).value;assert.equal(w.origins[0].output_character_attribution_verified,false);assert.deepEqual(w.origins[0].decoded_codepoints_rle.map(c=>[v.native_literal_definitions.find(x=>x.id===c.literal).literal,c.count]),[['U+0020',1],['U+FEFF',1]]);assert.ok(!reviewJSON(p).includes('/native_source_decorations/annotations/'));
});
test('identity, packed bytes, applications, literal values and visible qualifications reject tampering',()=>{
 const s=J(slice(fixture(),8,16)),p=create(s);for(const mutate of [x=>x.input_identity.range.total_characters++,x=>x.review_view.reported_full_parent_coverage=true,x=>x.review_view.application_table.rows.pop(),x=>x.review_view.qualified_mark_definitions[0].value.element_scope.attribute_adoption=false,x=>x.review_view.native_literal_definitions[0].literal='changed',x=>x.machine_coverage.qualified_mark_occurrences.pop(),x=>x.packed_response.original_json_sha256='0'.repeat(64)]){const q=clone(p);mutate(q);assert.throws(()=>verify(s,q));}
 const changed=JSON.parse(s);changed.range.total_characters++;changed.range.next_offset=changed.range.end;changed.native_source_decorations.range.include_end_zero_width=false;const next=create(J(changed));assert.notEqual(next.input_sha256,p.input_sha256);assert.throws(()=>verify(J(changed),p));
});
test('fictional coordinate/origin variation is smaller than V2 without an actual savings claim',()=>{
 const f=fixture(80);for(const [i,a]of f.native_source_decorations.annotations.entries()){for(const m of a.marks){m.id='token-'+i;m.start_tag=rr(1000+i*10,1009+i*10);m.element_start_tag=rr(1000+i*10,1009+i*10);}a.origins=[{run_id:'run-'+i,raw:rr(2000+i*10,2009+i*10),decoded_start:0,decoded_end:1,decoded_sha256:H('X'),clipping_mapping:'EXACT_DECODED_RANGE'}];}
 const s=J(f),before=Buffer.byteLength(J(prior(s).review_view)),p=create(s),after=Buffer.byteLength(reviewJSON(p));assert.ok(after<before);assert.equal(p.review_view.qualified_mark_definitions.length,1);assert.equal(p.review_view.application_qualifications.length,1);assert.equal(p.review_view.application_table.rows.length,80);
 console.log(J({schema:'fictional-presentation-v3-size-comparison',fixture_only:true,actual_sources:0,v2_human_view_bytes:before,v3_human_view_bytes:after,applications:80,actual_savings_measured:false}));
});

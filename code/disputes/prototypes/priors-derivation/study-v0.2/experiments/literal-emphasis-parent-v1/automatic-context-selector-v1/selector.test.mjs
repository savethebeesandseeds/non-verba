// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selectAutomaticContext,LIMITS} from './selector.mjs';
const H=s=>createHash('sha256').update(s).digest('hex');
function fixture(parts){let normalizedText='';const navigationAnchors=[];for(const[label,body]of parts){const start=normalizedText.length;normalizedText+=label+'\n'+body+'\n\n';navigationAnchors.push({id:'anchor_'+navigationAnchors.length,label,start,end:start+label.length,kind:'numbered_heading',source_evidence:{source_kind:'paragraph'},governing_hierarchy_verified:false});}return{normalizedText,navigationAnchors,governorFrames:[]};}
function span(d,text,offset=0){const start=d.normalizedText.indexOf(text,offset);assert.ok(start>=0);return{start,end:start+text.length,sha256:H(text)};}
function run(d,focal,limits){return selectAutomaticContext({...d,focal:span(d,focal),...(limits?{limits}:{})});}
const codes=a=>a.issues.map(i=>i.code),has=(a,token)=>a.attachments.some(n=>n.basis.some(b=>b.token===token));
function checkLiteralBindings(a,d){for(const n of a.attachments)assert.equal(H(d.normalizedText.slice(n.range.start,n.range.end)),n.range.sha256);assert.equal(a.quality_gate_pass,false);assert.equal(a.source_custody_authenticated,false);assert.equal(a.source_text_concatenated,false);assert.equal(a.manual_witness_catalog_used,false);assert.ok(Object.isFrozen(a));}

test('SOURCE_FREE complete touched interval restores omitted list introduction; existing governor prefix remains separate',()=>{
 const d=fixture([['Section 1. Intro','Subject to Section 2, these items follow:'],['Section 2. Duties','Prior written consent is required during the term.\n(i) First duty.\n(ii) Second duty.'],['Section 3. End','Other terms.']]);
 const frame=span(d,d.normalizedText),governor=span(d,'Subject to Section 2, these items follow:');d.governorFrames=[{...frame,governor}];const a=run(d,'(ii) Second duty.');assert.equal(a.status,'SELECTED_BOUNDED_PROVISIONAL_CONTEXT');const local=a.attachments.find(n=>n.basis.some(b=>b.token==='2'));assert.ok(d.normalizedText.slice(local.range.start,local.range.end).includes('Prior written consent'));assert.ok(a.attachments.some(n=>n.roles.includes('EXISTING_SOURCE_GOVERNOR_PREFIX')));assert.ok(a.references.some(r=>r.source_anchor_id.startsWith('governor_')));checkLiteralBindings(a,d);
});
test('SOURCE_FREE cross-section focal attaches complete 11/12/13 and explicit 12-to10 target',()=>{
 const d=fixture([['10. Earlier terms','The earlier body.'],['11. Restrictions','Written permission precedes (i) the first obligation.'],['12. Other terms','The obligations in Section 10 remain.'],['13. Final terms','The full final body follows its caption.']]);const start=d.normalizedText.indexOf('(i)'),end=d.navigationAnchors[3].end,focal={start,end,sha256:H(d.normalizedText.slice(start,end))};const a=selectAutomaticContext({...d,focal});assert.equal(a.status,'SELECTED_BOUNDED_PROVISIONAL_CONTEXT');for(const n of ['10','11','12','13'])assert.ok(has(a,n));const thirteen=a.attachments.find(n=>n.basis.some(b=>b.token==='13'));assert.ok(d.normalizedText.slice(thirteen.range.start,thirteen.range.end).includes('full final body'));checkLiteralBindings(a,d);
});
test('SOURCE_FREE Paragraphs 10 and 11 resolve as unique untyped literal aliases',()=>{
 const d=fixture([['10. First','First body.'],['11. Second','Second body.'],['12. Third','Paragraphs 10 and 11 apply.']]);const a=run(d,'Paragraphs 10 and 11 apply.');assert.equal(a.status,'SELECTED_BOUNDED_PROVISIONAL_CONTEXT');assert.ok(has(a,'10')&&has(a,'11'));assert.ok(a.references.some(r=>r.targets.map(t=>t.token).join(',')==='10,11'));assert.equal(a.policy.governing_hierarchy_verified,false);
});
test('SOURCE_FREE explicit groups and bounded integer ranges retain every target',()=>{
 const d=fixture([['Section 1. A','Body.'],['Section 2. B','Body.'],['Section 3. C','Body.'],['Section 4. D','Body.'],['Section 5. E','Body.'],['Section 6. F','Sections 1, 3 through 5 apply.']]);const a=run(d,'Sections 1, 3 through 5 apply.');assert.equal(a.status,'SELECTED_BOUNDED_PROVISIONAL_CONTEXT');for(const n of ['1','3','4','5'])assert.ok(has(a,n));assert.ok(a.references.some(r=>r.targets.map(t=>t.token).join(',')==='1,3,4,5'));
});
test('SOURCE_FREE Roman Section V is supported by typed or corroborated literal candidates',()=>{
 const d=fixture([['IV. Prior','Prior body.'],['V. Court','Court body.'],['VI. Later','Later body.'],['VII. Motion','Subject to Section V.']]);const a=run(d,'Subject to Section V.');assert.equal(a.status,'SELECTED_BOUNDED_PROVISIONAL_CONTEXT');assert.ok(has(a,'V'));const typed=fixture([['Section V. Court','Court body.'],['Section VIII. Motion','Subject to Section V.']]);assert.equal(run(typed,'Subject to Section V.').status,'SELECTED_BOUNDED_PROVISIONAL_CONTEXT');
});
test('SOURCE_FREE standalone Roman/letter ambiguity is retained HELD',()=>{
 const d=fixture([['C. Caption','Uncertain letter or Roman marker.'],['Section 1. Intro','See Section C.']]);const a=run(d,'See Section C.');assert.equal(a.status,'HELD_UNRESOLVED_PROVISIONAL_CONTEXT');assert.ok(codes(a).includes('AMBIGUOUS_ROMAN_OR_LETTER_CAPTION'));assert.ok(codes(a).includes('MISSING_EXPLICIT_REFERENCE_TARGET'));
});
test('SOURCE_FREE duplicate labels and missing targets are explicit HELD, never first-match selection',()=>{
 const d=fixture([['Section 10. One','Body.'],['Section 10. Two','Body.'],['Section 11. Three','Sections 10 and 99 apply.']]);const a=run(d,'Sections 10 and 99 apply.');assert.equal(a.status,'HELD_UNRESOLVED_PROVISIONAL_CONTEXT');for(const c of ['DUPLICATE_LITERAL_CAPTION_LABEL','AMBIGUOUS_EXPLICIT_REFERENCE_TARGET','MISSING_EXPLICIT_REFERENCE_TARGET'])assert.ok(codes(a).includes(c));
});
test('SOURCE_FREE cycles terminate with already-included targets; deeper unselected references remain HELD',()=>{
 const cyclic=fixture([['Section 10. One','Section 11 applies.'],['Section 11. Two','Section 10 applies.']]);const a=run(cyclic,'Section 11 applies.');assert.equal(a.status,'SELECTED_BOUNDED_PROVISIONAL_CONTEXT');assert.equal(a.attachments.length,2);assert.ok(a.references.length<10);
 const deep=fixture([['Section 10. One','Section 11 applies.'],['Section 11. Two','Section 12 applies.'],['Section 12. Three','Section 13 applies.'],['Section 13. Four','Body.']]);const b=run(deep,'Section 11 applies.');assert.equal(b.status,'HELD_UNRESOLVED_PROVISIONAL_CONTEXT');assert.ok(codes(b).includes('REFERENCE_HOP_BOUND'));assert.ok(!has(b,'13'));assert.ok(b.references.some(r=>r.targets.some(t=>t.token==='13')&&r.resolutions.some(r=>r.status==='HELD_HOP_BOUND')));
});
test('SOURCE_FREE attachment, character, group and occurrence bounds preserve typed HELD',()=>{
 const d=fixture([['Section 1. A','Body.'],['Section 2. B','Body.'],['Section 3. C','Sections 1 and 2 apply.']]);assert.ok(codes(run(d,'Sections 1 and 2 apply.',{attachments:1})).includes('ATTACHMENT_COUNT_BOUND'));assert.ok(codes(run(d,'Sections 1 and 2 apply.',{attached_characters:5})).includes('ATTACHED_SOURCE_CHARACTER_BOUND'));assert.ok(codes(run(d,'Sections 1 and 2 apply.',{group_targets:1})).includes('UNSUPPORTED_OR_BOUNDED_REFERENCE_GROUP'));assert.ok(codes(run(d,'Sections 1 and 2 apply.',{reference_occurrences:1})).includes('REFERENCE_OCCURRENCE_BOUND'));
});
test('SOURCE_FREE unsupported suffixes and missing caption evidence cannot become complete',()=>{
 const d=fixture([['Section 1. A','Body.'],['Section 2. B','Section 1(a) applies.']]);assert.ok(codes(run(d,'Section 1(a) applies.')).includes('UNSUPPORTED_OR_BOUNDED_REFERENCE_GROUP'));const absent={normalizedText:'No caption. Section 10 applies.',navigationAnchors:[],governorFrames:[]};const a=run(absent,'Section 10 applies.');assert.equal(a.status,'HELD_UNRESOLVED_PROVISIONAL_CONTEXT');assert.ok(codes(a).includes('NO_SOURCE_SUPPORTED_TOUCHED_CAPTION'));assert.ok(codes(a).includes('MISSING_EXPLICIT_REFERENCE_TARGET'));
});
test('SOURCE_FREE external Exhibit/Schedule/Appendix references remain hash/range HELD rows',()=>{
 const d=fixture([['Section 1. A','Exhibits A–D, Schedule 1 and Appendix B are referenced.']]);const a=run(d,'Exhibits A–D, Schedule 1 and Appendix B are referenced.');assert.equal(a.status,'HELD_UNRESOLVED_PROVISIONAL_CONTEXT');assert.ok(codes(a).includes('UNSUPPORTED_OR_EXTERNAL_REFERENCE'));for(const marker of ['EXHIBITS','SCHEDULE','APPENDIX'])assert.ok(a.references.some(r=>r.unsupported_or_external&&r.marker===marker));for(const r of a.references.filter(r=>r.unsupported_or_external))assert.equal(H(d.normalizedText.slice(r.start,r.end)),r.literal_sha256);
});
test('SOURCE_FREE excluded numeric navigation cannot become a caption; child intervals stop at shallower markers',()=>{
 const d=fixture([['Section 10. Parent','Parent introduction.'],['Section 10.3. Child','Child body.'],['Section 11. Next','Next body.']]);const a=run(d,'Child body.');assert.equal(a.status,'SELECTED_BOUNDED_PROVISIONAL_CONTEXT');const child=a.caption_candidates.find(c=>c.token==='10.3');assert.equal(child.interval.end,d.navigationAnchors[2].start);const x=fixture([['Section 1. First','Body.'],['2. Page','Unrelated label.'],['Section 3. Third','Third body.']]);x.navigationAnchors[1].kind='page_number';x.navigationAnchors[1].source_evidence.source_kind='page_label';const b=run(x,'Third body.');assert.ok(codes(b).includes('UNSUPPORTED_NUMERIC_NAVIGATION_EVIDENCE'));assert.ok(!b.caption_candidates.some(c=>c.token==='2'));
});
test('SOURCE_FREE output bound returns an unaccepted HELD commitment rather than a clipped selection',()=>{
 const d=fixture([['Section 1. A','Body.']]);const a=run(d,'Body.',{output_bytes:1024});assert.equal(a.status,'HELD_OUTPUT_BOUND');assert.equal(a.partial_selection_accepted,false);assert.ok(a.unaccepted_selection_sha256);assert.ok(Buffer.byteLength(JSON.stringify(a))<=1024);
});
test('SOURCE_FREE exact source hashes, codepoint bounds, immutable inputs and catalog-free API are enforced',()=>{
 const d=fixture([['Section 1. A','A 😀 source.']]),focal=span(d,'A 😀 source.'),before=structuredClone(d);const a=selectAutomaticContext({...d,focal});assert.deepEqual(d,before);checkLiteralBindings(a,d);assert.throws(()=>selectAutomaticContext({...d,focal:{...focal,sha256:'0'.repeat(64)}}),{code:'AUTO_CONTEXT_RANGE'});assert.throws(()=>selectAutomaticContext({...d,focal,manualWitnesses:[]}),{code:'AUTO_CONTEXT_INPUT_KEYS'});assert.throws(()=>selectAutomaticContext({...d,focal,limits:{attachments:LIMITS.attachments+1}}),{code:'AUTO_CONTEXT_OPTIONS'});
});

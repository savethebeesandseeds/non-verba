// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_FICTIONAL. No actual source, selector case, model or study IO.
import test from 'node:test';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import{selectDependencyContext,LIMITS,BASE_SOURCE}from'./dependency-closure.mjs';
const H=s=>createHash('sha256').update(s).digest('hex');
function fixture(preamble,clauses){let normalizedText=preamble+'\n\n';const navigationAnchors=[];for(const[label,body]of clauses){const start=normalizedText.length;normalizedText+=label+'\n'+body+'\n\n';navigationAnchors.push({id:'synthetic_'+navigationAnchors.length,label,start,end:start+label.length,kind:'numbered_heading',source_evidence:{source_kind:'paragraph'}});}return{normalizedText,navigationAnchors,governorFrames:[]};}
function span(x,text){const start=x.normalizedText.indexOf(text);assert(start>=0);return{start,end:start+text.length,sha256:H(text)};}
const run=(x,text,o)=>selectDependencyContext({...x,focal:span(x,text)},o);
const codes=x=>x.issues.map(i=>i.code),included=(x,s,text)=>x.added_dependencies.some(d=>s.slice(d.range.start,d.range.end).includes(text));
function timing(){return fixture('"Company" means the operator.\n\n"Services" means testing the instrument.',[
 ['Section 73. Alpha','The initial term of this Agreement shall commence on day A and terminate on day B.'],
 ['Section 4. Beta','Either party may terminate this Agreement upon ten days written notice.'],
 ['Section 62. Gamma','During the term of this Agreement, Company shall perform Services.'],
 ['Section 90. Delta','An unrelated clause.']]);}

test('body predicates and referenced source definition work with arbitrary clause numbers and unrelated captions',()=>{
 const x=timing(),a=run(x,'During the term of this Agreement, Company shall perform Services.');
 assert(included(a,x.normalizedText,'commence on day A'));assert(included(a,x.normalizedText,'ten days written notice'));assert(included(a,x.normalizedText,'testing the instrument'));
 assert(a.added_dependencies.some(d=>d.reasons.some(r=>r.kind==='DURATION_GOVERNOR'&&r.evidence.caption_name_used===false)));assert.equal(a.semantic_completeness_verified,false);assert.equal(a.authority,'NONE');
 for(const d of a.added_dependencies)assert.equal(H(x.normalizedText.slice(d.range.start,d.range.end)),d.range.sha256);
});
test('a Term or Termination heading alone supplies no duration or termination authority',()=>{
 const x=fixture('',[['Section 8. Term','Duration figures appear elsewhere.'],['Section 2. Termination','This paragraph is a caption example.'],['Section 77. Duties','During the term of this Agreement, the operator shall act.']]);
 const a=run(x,'During the term of this Agreement, the operator shall act.');assert(codes(a).includes('MISSING_TEMPORAL_BODY_CANDIDATE'));assert.equal(a.added_dependencies.length,0);assert(a.demands.every(d=>d.status==='MISSING_SOURCE_BODY_CANDIDATE'));
});
test('quoted alias does not replace an independently evidenced operative specification',()=>{
 const x=fixture('The work concerns field testing (the "Services").',[
  ['Section 81. Arbitrary','The consulting services to be provided by the operator are matters reasonably requested by the director.'],
  ['Section 3. Services','A caption alone is insufficient.'],
  ['Section 65. Duty','The operator may use records only to perform the Services.']]);
 const a=run(x,'The operator may use records only to perform the Services.');assert(included(a,x.normalizedText,'field testing'));assert(included(a,x.normalizedText,'reasonably requested'));assert(!a.added_dependencies.some(d=>d.range.start===x.navigationAnchors[1].start));assert(a.added_dependencies.some(d=>d.reasons.some(r=>r.kind==='OPERATIVE_TERM_SPECIFICATION'&&r.evidence.caption_name_used===false)));
});
test('caption-only trailing touch stays in focal bytes but does not introduce irrelevant Shares definitions',()=>{
 const x=fixture('"Shares" means the two issued classes.',[['Section 2. Duty','The operator shall refrain from trading.'],['Section 9. Unrelated','Shares shall not be transferred.']]),focal={start:x.normalizedText.indexOf('The operator'),end:x.navigationAnchors[1].end};focal.sha256=H(x.normalizedText.slice(focal.start,focal.end));
 const before=structuredClone(x),a=selectDependencyContext({...x,focal});assert.deepEqual(a.focal,focal);assert.deepEqual(x,before);assert.equal(a.caption_only_tail_exclusions.length,1);assert.equal(a.dependency_seed.end,x.navigationAnchors[1].start);assert(a.caption_only_tail_exclusions[0].original_focal_retained);assert(!a.base_selection.attachments.some(n=>n.basis.some(b=>b.token==='9')));assert(!a.demands.some(d=>d.term_sha256===H('Shares')));
});
test('actual body touch or an explicit required reference keeps the extra clause and its own definition dependency',()=>{
 const x=fixture('"Shares" means the two issued classes.',[['Section 2. Duty','Section 9 applies to the operator.'],['Section 9. Other','Shares shall not be transferred.']]);
 const a=run(x,'Section 9 applies to the operator.');assert(a.base_selection.attachments.some(n=>n.basis.some(b=>b.token==='9')));assert(included(a,x.normalizedText,'two issued classes'));
 const f={start:x.normalizedText.indexOf('Section 9 applies'),end:x.normalizedText.indexOf('Shares shall')+6};f.sha256=H(x.normalizedText.slice(f.start,f.end));const b=selectDependencyContext({...x,focal:f});assert.equal(b.caption_only_tail_exclusions.length,0);assert(included(b,x.normalizedText,'two issued classes'));
});
test('parenthetical aliases and forward definitions are generic; ambiguous duplicate definitions are never first-matched',()=>{
 const x=fixture('The operator supplies instrument testing (the "Work").\n\n"Unit" means version A.\n\n"Unit" means version B.',[['Section 41. Duty','The operator shall deliver Work and Unit.']]),a=run(x,'The operator shall deliver Work and Unit.');
 assert(included(a,x.normalizedText,'instrument testing'));assert(codes(a).includes('AMBIGUOUS_LITERAL_DEFINITION'));assert(!a.added_dependencies.some(d=>d.reasons.some(r=>r.evidence.term_sha256===H('Unit'))));
});
test('otherwise-provided exceptions stay explicitly UNCLOSED and callers cannot supply an exception catalog',()=>{
 const x=fixture('',[['Section 1. Duty','Except as otherwise provided herein, the operator shall act.']]),a=run(x,'Except as otherwise provided herein, the operator shall act.');
 assert(codes(a).includes('BROAD_EXCEPTION_SCOPE_UNCLOSED'));assert.equal(a.broad_exception_closure_verified,false);assert.equal(a.status,'HELD_UNCLOSED_DEPENDENCIES');assert.throws(()=>run(x,'Except as otherwise provided herein, the operator shall act.',{exceptionCatalog:[]}));assert.throws(()=>selectDependencyContext({...x,focal:span(x,'Except as otherwise provided herein, the operator shall act.'),manualWitnesses:[]}));
});
test('definition cycles terminate, hop/attachment limits hold, new explicit references are disclosed rather than silently expanded',()=>{
 const x=fixture('"Alpha" means Beta.\n\n"Beta" means Alpha.',[['Section 6. Duty','The operator shall use Alpha.']]);
 const a=run(x,'The operator shall use Alpha.');assert.equal(a.added_dependencies.length,2);assert(codes(run(x,'The operator shall use Alpha.',{hops:1})).includes('DEPENDENCY_HOP_BOUND'));assert(codes(run(timing(),'During the term of this Agreement, Company shall perform Services.',{added_ranges:1})).includes('DEPENDENCY_ATTACHMENT_BOUND'));
 const y=fixture('"Alpha" means the output specified in Section 44.',[['Section 6. Duty','The operator shall use Alpha.'],['Section 44. Later','Output detail.']]),b=run(y,'The operator shall use Alpha.');assert(codes(b).includes('NEW_DEPENDENCY_EXPLICIT_REFERENCES_UNEXPANDED'));assert(!included(b,y.normalizedText,'Output detail'));
 assert(Object.isFrozen(a));assert.equal(BASE_SOURCE.bytes,14877);assert.throws(()=>run(x,'The operator shall use Alpha.',{added_ranges:LIMITS.added_ranges+1}));assert.throws(()=>run(x,'The operator shall use Alpha.',{output_bytes:100}));
});

// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_FICTIONAL. Pure values only: no study IO, admission or source display.
import test from 'node:test';
import assert from 'node:assert/strict';
import {H,D,ID,METHOD,RUN,Q,PINS,LIMITS,CLOSED_POOL_CARRY,scalarText,exactRef,validateFreshGuard,qualifyMetadata,extractWindows,compareModelTexts,prepareDocuments,paginateDocuments,renderPage,validateObservation,forwardState} from './reader-core.mjs';
import {main} from './reader.mjs';
const raw='x'.repeat(47662),binding={raw_ref:{path:RUN+'/SYNTHETIC/0055.html',sha256:H(raw),bytes:raw.length},normalized_sha256:'1'.repeat(64),nodes:Array.from({length:7},(_,i)=>({id:i?'synthetic-context-'+i:'focal',range:{start:i*100,end:i*100+40,sha256:'2'.repeat(64)}}))};
function plan(index=0){
 const input_binding={selection_ref:PINS.selection,current_epoch_ref:PINS.epoch,current_source_sha256:METHOD,raw_sha256:binding.raw_ref.sha256,normalized_sha256:binding.normalized_sha256};
 let at=0;
 const nodes=binding.nodes.map((declaration,i)=>({declaration:structuredClone(declaration),status:'COMPLETE',windows:Array.from({length:i?2:3},()=>{const text='SYNTHETIC_WINDOW_'+at+++'\n[NATIVE_EMPTY_DICTIONARY_V1 {"definition":"complete literal definition"}]\nAn actor shall act only if a condition applies.\n';return{text,sha256:H(text),tokens:30+index,input_policy:'NATIVE_EMPTY_DICTIONARY_SELF_CONTAINED_WINDOW_V1_UNADOPTED',empty_native_dictionary:{encoded_text_sha256:H(text),encoded_text_UTF8_bytes:Buffer.byteLength(text)}};})}));
 return {artifact:{schema:'automatic-context-native-dictionary-windows-v1',prototype:true,adopted:false,authority:'NONE',actual_reading:false,semantic_completeness_verified:false,model_inference:false,quality_gate_pass:false,input_binding,input_sha256:D(input_binding),native_artifact:{nodes}}};
}
const windows=()=>[extractWindows(plan(0),binding,0),extractWindows(plan(1),binding,1)];
function guard(){const rows=Array.from({length:100},(_,i)=>({audit_id:'SYNTHETIC-fresh-'+i,contract_id:'SYNTHETIC-CID-'+i%29})),body={schema:'stored-reader-complete-fresh100-guard-v1',rows,contract_ids:[...new Set(rows.map(r=>r.contract_id))].sort()};return {...body,projection_sha256:D(body)};}
function observation(p){return{reader:ID.reviewer,page:p.global,output_sha256:p.sha256,output_bytes:p.bytes,output_utf16:p.utf16,whole_tool_utf16:p.utf16+20,whole_tool_utf8_bytes:p.bytes+20,tool_call_id:'SYNTHETIC-tool-call',chunk_id:'SYNTHETIC-chunk',complete_forwarded_response_observed:true,truncation_observed:false,stdout_exact_prepared:true,affirmation:'ACTUALLY_READ_THIS_COMPLETE_PAGE'};}

test('inactive import has no actual entry execution; fixed pool remains closed carry',()=>{
 assert.equal(typeof main,'function');assert.equal(Q.endsWith('/current-v6-0055-automatic-context-source-review-20261019-v1'),true);
 assert.deepEqual(CLOSED_POOL_CARRY,{planning:39061,recount:158,elapsed_ms:475387.035676,output_bytes:14239376});assert(Object.isFrozen(CLOSED_POOL_CARRY));assert.equal(LIMITS.phase_ms,1200000);
});
test('complete100→29 guard refuses duplicate audits, dropped CIDs and protected0055 even when re-sealed',()=>{
 assert.equal(validateFreshGuard(guard()),true);
 for(const change of[g=>g.rows[1].audit_id=g.rows[0].audit_id,g=>g.contract_ids.pop(),g=>{g.rows=g.rows.map(r=>({...r,contract_id:r.contract_id===g.contract_ids[0]?ID.contract_id:r.contract_id}));g.contract_ids[0]=ID.contract_id;}]){
  const g=guard();change(g);const{projection_sha256,...b}=g;g.projection_sha256=D(b);assert.throws(()=>validateFreshGuard(g));
 }
});
test('named refs reject path escape, unpinned sizes, extra roles and invalid digests',()=>{
 assert.deepEqual(exactRef(binding.raw_ref),binding.raw_ref);
 for(const delta of[{path:RUN+'/../outside'},{path:'/tmp/not-admitted'},{bytes:Infinity},{bytes:0},{sha256:'wrong'},{extra:true}])assert.throws(()=>exactRef({...binding.raw_ref,...delta}));
});
test('metadata qualification rejects othercase or stale/current-authority claims before any payload can be returned',()=>{
 const b={schema:'current-v6-body-prior-actual-scope-qualification-v1',source_sha256:METHOD,current_supporting_review_assembled:false,materiality_holds_cleared:0,new_actual_readings:0,rows:Array.from({length:200},(_,i)=>({audit_id:'SYNTHETIC-'+i,contract_id:'synthetic'}))};
 const input={body:b,guard:guard(),epoch:{},selection:{},result:{}};assert.throws(()=>qualifyMetadata(input),/READER_FIXED_ONE_CASE/);
 b.rows[0]={audit_id:ID.audit_id,contract_id:ID.contract_id,current_v6_body_scope_qualification:{status:'EXACT_PRIOR_OBSERVATION_SCOPE_INPUTS_PRESERVED_CURRENT_V6',current_extraction_source_sha256:'stale'}};assert.throws(()=>qualifyMetadata(input),/READER_CURRENT_ROW/);
 b.current_supporting_review_assembled=true;assert.throws(()=>qualifyMetadata(input),/READER_BODY_METADATA/);
});
test('all7 nodes/all15 exact dictionary texts survive extraction without coordinate JSON',()=>{
 const p=plan(),rows=extractWindows(p,binding,0);assert.equal(rows.length,15);assert.equal(new Set(rows.map(w=>w.node_index)).size,7);assert.deepEqual(rows.map(w=>w.text),p.artifact.native_artifact.nodes.flatMap(n=>n.windows.map(w=>w.text)));assert(rows.every(w=>w.text.includes('complete literal definition')));
});
test('window schema binding, node order, text hash, token ceiling and incomplete nodes are hard failures',()=>{
 for(const change of[p=>p.artifact.input_binding.raw_sha256='0'.repeat(64),p=>p.artifact.native_artifact.nodes[1].declaration.id='other',p=>p.artifact.native_artifact.nodes[2].status='HELD',p=>p.artifact.native_artifact.nodes[0].windows[0].text+='lost hash',p=>p.artifact.native_artifact.nodes[0].windows[0].tokens=257,p=>p.artifact.native_artifact.nodes[0].windows.pop()]){const p=plan();change(p);assert.throws(()=>extractWindows(p,binding,0));}
});
test('exact equality qualifies textbytes only despite distinct model token metadata',()=>{
 const pair=windows(),c=compareModelTexts(...pair);assert.equal(c.all15_exact_equal,true);assert(c.rows.every(r=>r.UTF8_equal&&r.node_order_equal));assert.match(c.qualification_scope,/NOT_MODEL_SEMANTICS/);
 const p=prepareDocuments(raw,binding,pair);assert.equal(p.documents.length,16);assert.equal(p.documents[0].text,raw);assert(p.documents.slice(1).every(d=>d.models.join(',')==='0,1'));
});
test('one differing last text or moved node requires two separate15-window reading scopes',()=>{
 for(const change of[p=>p[1][14].text+='different',p=>p[1][14].node_id='moved']){
  const pair=windows();change(pair);const p=prepareDocuments(raw,binding,pair);assert.equal(p.comparison.all15_exact_equal,false);assert.equal(p.documents.length,31);assert.equal(p.documents.filter(d=>d.models[0]===1).length,15);
 }
});
test('own full original is mandatory; ROOT previous reading cannot replace a missing character or different bytes',()=>{
 for(const s of[raw.slice(1),raw.slice(0,-1)+'y'])assert.throws(()=>prepareDocuments(s,binding,windows()));
});
test('lossless pagination keeps dictionaries, literal HTML and astral pairs exact',()=>{
 const text=('<b>SYNTHETIC😀</b>\n[NATIVE_EMPTY_DICTIONARY_V1 complete definition]\n').repeat(180),doc={id:'synthetic-full-literal',models:[0],text,sha256:H(text)},p=paginateDocuments([doc]);
 let reconstructed='';for(const page of p.pages){const response=renderPage(doc,page),from=response.indexOf('\n')+1;reconstructed+=response.slice(from,-1);assert(page.end-page.start<=8500);assert(response.length<=8800);assert.equal(page.sha256,H(response));}
 assert.equal(reconstructed,text);assert(p.visible_capture_charge<=262144);assert.equal(p.pages[0].start,0);assert.equal(p.pages.at(-1).end,text.length);
});
test('unpaired surrogates and visible/capture overflow fail rather than trim or restart',()=>{
 assert.throws(()=>scalarText('SYNTHETIC\ud800'));assert.throws(()=>scalarText('\udc00'));
 const text='z'.repeat(140000);assert.throws(()=>paginateDocuments([{id:'oversize',models:[0],text,sha256:H(text)}]),/READER_TOTAL_VISIBLE_CAPTURE/);
});
test('forward transport never equates emission to reading or permits skip/re-emission',()=>{
 assert.deepEqual(forwardState([true,false],[false,false],2),{acknowledged:0,pending:1,complete:false});assert.equal(forwardState([true,true],[true,true],2).complete,true);
 for(const[e,a]of[[[false,true],[false,false]],[[true,true],[false,false]],[[false,false],[true,false]],[[true,false],[true,true]]])assert.throws(()=>forwardState(e,a,2));
});
test('separate observed-page declaration binds exact tool/page/hash/whole response and refuses replay',()=>{
 const docs=prepareDocuments(raw,binding,windows()).documents,p=paginateDocuments(docs).pages[0],o=observation(p);assert.equal(validateObservation(o,p),true);
 for(const change of[x=>x.reader='ROOT',x=>x.page++,x=>x.output_sha256='0'.repeat(64),x=>x.output_bytes--,x=>x.output_utf16--,x=>x.whole_tool_utf16=9001,x=>x.whole_tool_utf8_bytes=p.bytes+2049,x=>x.complete_forwarded_response_observed=false,x=>x.truncation_observed=true,x=>x.stdout_exact_prepared=false,x=>x.affirmation='file exists',x=>x.extra='literal']){const x=structuredClone(o);change(x);assert.throws(()=>validateObservation(x,p));}
 assert.throws(()=>validateObservation(o,p,[o.chunk_id]));
});

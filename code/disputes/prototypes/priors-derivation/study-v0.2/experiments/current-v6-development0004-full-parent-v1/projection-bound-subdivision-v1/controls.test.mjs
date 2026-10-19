// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC only. Importing the inactive driver performs no I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_ATTEMPTS, CASE, boundary, split, startPlan, nextRange, advance, coverage, nativeArgs, authenticatePacket, validateLeaf, natural, plus, guardPacketRead, validateCacheReceipt, cacheLoaderCharge} from './plan.mjs';
import {validateAdmission, validateMeterReservation, candidateReservation, SOURCE, PRIOR, PACKET, R, S} from './diagnostic.mjs';
const text = 'a'.repeat(28000) + 'b'.repeat(1000) + 'c'.repeat(17415);
function execute(value, outcome, ceiling = 32, range = [28000, 29000]) {
  let plan = startPlan(value, range, {fictional: true}, ceiling); const calls = [];
  while (nextRange(plan)) { const pair = nextRange(plan); calls.push(pair); plan = advance(plan, value, outcome(pair, calls.length)); }
  return {plan, calls, coverage: coverage(plan, value)};
}
test('fictional success subdivides known failure once, in exact left/right order', () => {
  const r = execute(text, () => 'COMPLETE_ALL_NATIVE'); assert.deepEqual(r.calls, [[28000,28500],[28500,29000]]);
  assert.equal(r.plan.attempts, 2); assert.equal(r.coverage.all_leaves_complete, true);
  assert.equal(r.coverage.actual_reading, false); assert.equal(r.coverage.semantic_completeness, false);
});
test('fixed ceiling includes failures and never skips pending intervals', () => {
  const r = execute(text, () => 'NATIVE_DECORATION_PROJECTION_BOUND'); assert.equal(r.calls.length, MAX_ATTEMPTS);
  assert.equal(r.coverage.exact_interval_union, true); assert.equal(r.coverage.all_leaves_complete, false);
  assert.equal(r.coverage.attempt_ceiling_reached, true); assert.ok(r.plan.unresolved.length > 0);
  assert.ok(r.plan.unresolved.every(p => p.reason.includes('CAUSE_UNKNOWN')));
});
test('nested subdivision is depth first but accepted leaves remain gap free', () => {
  const r = execute(text, pair => pair[1] - pair[0] > 125 ? 'NATIVE_DECORATION_PROJECTION_BOUND' : 'COMPLETE_ALL_NATIVE');
  assert.equal(r.plan.accepted.length, 8); assert.equal(r.coverage.all_leaves_complete, true);
  assert.deepEqual(r.plan.accepted, Array.from({length:8},(_,i)=>[28000+125*i,28125+125*i]));
});
test('astral midpoint shifts to a complete codepoint boundary without loss', () => {
  const s = 'a'.repeat(499) + '\u{1F680}' + 'b'.repeat(499); assert.equal(s.length, 1000);
  assert.equal(boundary(s,500),false); assert.deepEqual(split(s,[0,1000]),[[0,499],[499,1000]]);
  const r = execute(s, () => 'COMPLETE_ALL_NATIVE',32,[0,1000]);
  assert.equal(r.plan.accepted.map(([a,b])=>s.slice(a,b)).join(''),s);
});
test('single astral codepoint and single BMP leaf can remain unresolved', () => {
  for (const s of ['\u{1F680}','x']) { const p=startPlan(s,[0,s.length],{fictional:true}); assert.equal(nextRange(p),null); assert.equal(p.accepted.length,0); assert.equal(coverage(p,s).all_leaves_complete,false); }
});
test('Unicode controls exercise actual newline NUL and astral values', () => {
  const s='A\n\u0000\u{1F680}Z'; assert.ok(s.includes('\n')); assert.ok([...s].some(c=>c.charCodeAt(0)===0)); assert.ok([...s].some(c=>c.codePointAt(0)>65535));
  const r=execute(s,()=> 'COMPLETE_ALL_NATIVE',32,[0,s.length]); assert.equal(JSON.parse(JSON.stringify(r.plan.accepted.map(([a,b])=>s.slice(a,b)).join(''))),s);
});
test('malformed limits, codepoint splits and gaps fail closed', () => {
  for(const n of [0,33,-1,1.5,NaN,Infinity,'32'])assert.throws(()=>startPlan(text,[28000,29000],{},n));
  assert.throws(()=>split('a\u{1F680}b',[0,2])); const p=startPlan(text,[28000,29000],{});p.pending[0][0]++;assert.throws(()=>coverage(p,text));
  assert.throws(()=>advance(startPlan(text,[28000,29000],{}),text,'PARTIAL_PROJECTION'));
});
test('all candidate args stay in fixed interval with all-native and no heading', () => {
  const r=execute(text,p=>p[1]-p[0]>125?'NATIVE_DECORATION_PROJECTION_BOUND':'COMPLETE_ALL_NATIVE');
  for(const pair of r.calls)assert.deepEqual(nativeArgs(pair),{source:'parent',offset:pair[0],limit:pair[1]-pair[0],showProposedHeading:false,nativeDecorations:'all'});
  for(const pair of [[27999,28001],[28000,29001],[28000,28000]])assert.throws(()=>nativeArgs(pair));
  // Every actual fixed leaf ends before the parent end; frozen reader therefore
  // owns zero-width events at a split with the right leaf, never an invented EOF.
  assert.ok(r.calls.every(p=>p[1]!==CASE.parent_characters));
});
function fixture() {
  const rows=Array.from({length:500},(_,i)=>({audit_id:'coding-'+String(i+1).padStart(4,'0'),contract_id:'contract-'+i.toString(16).padStart(20,'0')}));
  rows[105]={audit_id:CASE.audit_id,id:CASE.source_id,contract_id:CASE.contract_id,parent:{start:54,end:46469,sha256:'d'.repeat(64)},lineage:{normalized_sha256:CASE.normalized_sha256,raw_sha256:CASE.raw_sha256,source_url:'https://fictional.invalid/DECLARED_SYNTHETIC'}};
  return {packet:{purpose:'coding',rows},guard:{full_fresh100:true,fresh_sections:100,fresh_contract_count:29,fresh_contract_ids:Array.from({length:29},(_,i)=>'contract-'+(10000+i).toString(16).padStart(20,'0'))}};
}
test('full 29-CID guard is checked against every fixed packet row', () => {
  const {packet,guard}=fixture();assert.equal(authenticatePacket(packet,guard).audit_id,CASE.audit_id);
  packet.rows[499].contract_id=guard.fresh_contract_ids[28];assert.throws(()=>authenticatePacket(packet,guard),/FRESH_CONTRACT_OVERLAP/);
});
test('incomplete/duplicate Fresh guards and wrong case lineage are rejected', () => {
  for(const mutate of [g=>g.full_fresh100=false,g=>g.fresh_sections=99,g=>g.fresh_contract_ids.pop(),g=>g.fresh_contract_ids[1]=g.fresh_contract_ids[0]]){const {packet,guard}=fixture();mutate(guard);assert.throws(()=>authenticatePacket(packet,guard));}
  for(const mutate of [p=>p.purpose='development',p=>p.rows.pop(),p=>p.rows.reverse(),p=>p.rows[105].id='other',p=>p.rows[105].parent.start=55,p=>p.rows[105].lineage.normalized_sha256='e'.repeat(64),p=>p.rows[105].lineage.raw_sha256='e'.repeat(64)]){const {packet,guard}=fixture();mutate(packet);assert.throws(()=>authenticatePacket(packet,guard));}
});
function leaf() {
  const normalized='z'.repeat(54)+text, range=[28000,28500], sourceURL='https://fictional.invalid/DECLARED_SYNTHETIC';
  return {normalized,range,sourceURL,value:{audit_id:CASE.audit_id,source_id:CASE.source_id,contract_id:CASE.contract_id,purpose:'coding',source:'parent',packet:{path:PACKET.relative_path,sha256:PACKET.sha256,bytes:PACKET.bytes},binding:{sha256:CASE.normalized_sha256,bytes:CASE.normalized_bytes},range:{offset:range[0],end:range[1],total_characters:46415,absolute_normalized_start:28054,complete_source_in_this_slice:false,next_offset:range[1],offset_basis:'UTF16 decoded text; raw text slices are not raw byte offsets'},text:normalized.slice(28054,28554),source_url:sourceURL,source_scope:'EXTRACTED_FLAT_SPAN',semantic_completeness:'UNVERIFIED_REQUIRES_ORIGINAL_SOURCE_READING',native_source_decorations:{schema:'native-source-decoration-projection-v2',projection_policy:'ALL_NATIVE_STYLE_SOURCE_METADATA',range:{start:28054,end:28554,include_end_zero_width:false},normalized_sha256:CASE.normalized_sha256,raw_sha256:CASE.raw_sha256,annotations:[{declared_synthetic_joint_witness:{origins:['A','B']},zero_output:true}],computed_style_verified:false,effectiveness_verified:false,authority:'NONE'}}};
}
test('leaf validation preserves complete joint/zero-output records and exact absolute inverse',()=>{
  const f=leaf(),before=JSON.stringify(f.value);assert.equal(validateLeaf(f.value,f.range,f.normalized,PACKET,f.sourceURL),true);assert.equal(JSON.stringify(f.value),before);
});
test('wrong leaf identity/range/terminal flag/inverse or priming metadata is rejected',()=>{
  const mutations=[v=>v.audit_id='coding-0107',v=>v.packet.sha256='0'.repeat(64),v=>v.range.offset++,v=>v.range.absolute_normalized_start++,v=>v.range.next_offset=null,v=>v.range.complete_source_in_this_slice=true,v=>v.native_source_decorations.range.include_end_zero_width=true,v=>v.native_source_decorations.projection_policy='COMPACT_DECORATION_RELEVANT_NATIVE_EVIDENCE',v=>v.text='wrong',v=>v.source_url='wrong',v=>v.proposed_heading={},v=>v.source_navigation={}];
  for(const mutate of mutations){const f=leaf();mutate(f.value);assert.throws(()=>validateLeaf(f.value,f.range,f.normalized,PACKET,f.sourceURL));}
});
function admission(){return {schema:'root-fixed0106-projection-diagnostic-admission-v1',active:true,source_sha256:SOURCE,authority:'ROOT_DIAGNOSTIC_ONLY',output:R+'/coding/open-coding-a/current-v6/projection-bound-diagnostic-v1/run-v1',max_attempts:32,prior_phases_closed:true,old_locks_preserved:true,reading_phase:false,semantic_claim:false,prior_checkpoint:{...PRIOR},prior_failed_range:[28000,29000],carry:{visible_bytes:4144325,capture_bytes:19321916,artifact_bytes:27919155,source_copy_floor_bytes:262144},clock:{origin_ns:'1000',deadline_ns:'1000001000'},new_limits:{visible:1048576,capture:268435456,artifact:134217728},external_watchdog_ms:60000,external_capture_meter:true,max_heap_mib:512,max_rss_bytes:1073741824,engineering_source_copy_bytes:40000};}
test('prospective admission cannot refund/reopen phases, expand scope or disable guards',()=>{
  validateAdmission(admission());for(const mutate of [a=>a.active=false,a=>a.reading_phase=true,a=>a.semantic_claim=true,a=>a.old_locks_preserved=false,a=>a.max_attempts=33,a=>a.carry.capture_bytes--,a=>a.carry.source_copy_floor_bytes--,a=>a.prior_failed_range[1]++,a=>a.clock.deadline_ns='9999999999999999',a=>a.external_watchdog_ms=60001,a=>a.new_limits.capture++,a=>a.engineering_source_copy_bytes=65537]){const a=admission();mutate(a);assert.throws(()=>validateAdmission(a));}
});
test('safe accounting primitives reject negative, nonnumeric and overflowing charges',()=>{
  for(const n of [-1,1.5,NaN,Infinity,'1',undefined])assert.throws(()=>natural(n));assert.equal(plus(10,20),30);assert.throws(()=>plus(Number.MAX_SAFE_INTEGER,1));
});
test('invalid full Fresh metadata prevents the exact packet-read gate callback',()=>{
  for(const mutate of [g=>g.full_fresh100=false,g=>g.fresh_sections=99,g=>g.fresh_contract_ids.pop(),g=>g.fresh_contract_ids[1]=g.fresh_contract_ids[0]]){const {guard}=fixture();mutate(guard);let calls=0;assert.throws(()=>guardPacketRead(guard,()=>{calls++;return 'fictional';}));assert.equal(calls,0);}
  const {guard}=fixture();let calls=0;assert.equal(guardPacketRead(guard,()=>{calls++;return 'fictional';}),'fictional');assert.equal(calls,1);
});
test('exact candidate preflight separates visible from capture and artifact reservations',()=>{
  const limits={visible:1048576,capture:268435456,artifact:134217728},usage={visible:65536,capture:1000000,artifact:65536},reserve=candidateReservation(2000000,4000000);
  assert.equal(reserve.visible,4096);assert.ok(reserve.capture>2*1024**2);assert.equal(reserve.artifact,2*1024**2+65536);
  assert.equal(validateMeterReservation(usage,limits,reserve),usage);
  for(const k of ['visible','capture','artifact']){const near={...usage,[k]:limits[k]-reserve[k]};validateMeterReservation(near,limits,reserve);near[k]++;assert.throws(()=>validateMeterReservation(near,limits,reserve));}
  validateMeterReservation(usage,limits);validateMeterReservation(usage,limits,{capture:1});
  for(const n of [-1,'1',NaN,Infinity,undefined,Number.MAX_SAFE_INTEGER])assert.throws(()=>validateMeterReservation(usage,limits,{capture:n}));
  assert.throws(()=>validateMeterReservation(usage,limits,{typo:1}));assert.throws(()=>candidateReservation(Number.MAX_SAFE_INTEGER,1));
});
test('fictional compressed cache manifest binds encoded decoded and canonical content identities',()=>{
  const e={relative_path:'extraction-cache/DECLARED_SYNTHETIC.json.gz',sha256:'a'.repeat(64),bytes:73,decoded_bytes:240,decoded_sha256:'b'.repeat(64),result_sha256:'c'.repeat(64)};
  const r={path:e.relative_path,sha256:e.sha256,bytes:e.bytes,result_sha256:e.result_sha256,storage:{schema:'lossless-gzip-extraction-cache-v1',encoding:'gzip',serializer:'UTF8_JSON_STRINGIFY_PRETTY_2_FINAL_LF_V1',decoded_bytes:e.decoded_bytes,decoded_sha256:e.decoded_sha256}};
  assert.equal(validateCacheReceipt(r,e),240);
  for(const mutate of [v=>v.path='other',v=>v.sha256='d'.repeat(64),v=>v.bytes++,v=>v.result_sha256='d'.repeat(64),v=>v.storage.encoding='plain',v=>v.storage.decoded_bytes++,v=>v.storage.decoded_sha256='d'.repeat(64),v=>v.storage.serializer='other']){const v=structuredClone(r);mutate(v);assert.throws(()=>validateCacheReceipt(v,e));}
});
test('cache loader charges manifest encoded and decoded on setup and every frozen reader attempt',()=>{
  const loader=cacheLoaderCharge(89549,760,665576);assert.deepEqual(loader,{read:90309,decoded:665576});
  const setup={read:760+89549+loader.read,decoded:loader.decoded};assert.deepEqual(setup,{read:180618,decoded:665576});
  const attempt={read:89549+loader.read,decoded:loader.decoded};assert.deepEqual(attempt,{read:179858,decoded:665576});
  for(const n of [0,-1,NaN,Infinity,'89549'])assert.throws(()=>cacheLoaderCharge(n,760,665576));assert.throws(()=>cacheLoaderCharge(89549,65537,665576));assert.throws(()=>cacheLoaderCharge(89549,760,64*1024**2+1));
});
test('DECLARED_SYNTHETIC gzip fixture uses exact frozen store.readJSON and enforces decoded bounds',async()=>{
  const fs=await import('node:fs/promises'),{randomUUID}=await import('node:crypto'),store=await import(S+'/lib/store.mjs'),{digest,sha256}=await import(S+'/../lib/common.mjs');
  const root=store.STUDY_BASE+'/test-store-'+randomUUID(),name='extraction-cache/DECLARED_SYNTHETIC.json.gz',value={declared_synthetic:true,text:'A\n\u0000\u{1F680}',native:{marks:['u'],joint:[{origin:'fictional-A'},{origin:'fictional-B'}]},authority:'NONE'};
  await fs.mkdir(root);const stored=await store.writeExtractionCache(root,name,value),receipt={...stored.artifact,storage:stored.storage,result_sha256:digest(value)};await store.writeJSON(root,name+'.manifest.json',receipt);
  const encoded=await fs.readFile(root+'/'+name);assert.equal(sha256(encoded),stored.artifact.sha256);assert.deepEqual(await store.readJSON(root,name,{maxBytes:stored.storage.decoded_bytes}),value);
  const absent='extraction-cache/absent.json.gz';await store.writeJSON(root,absent+'.manifest.json',{...receipt,path:absent,storage:{...receipt.storage,decoded_bytes:receipt.storage.decoded_bytes+1}});await assert.rejects(store.readJSON(root,absent,{maxBytes:receipt.storage.decoded_bytes}),/receipt binding or decoded bound/);
  let bytes=0;async function measure(p){const s=await fs.lstat(p);bytes+=s.size;if(s.isDirectory())for(const n of await fs.readdir(p))await measure(p+'/'+n);}await measure(root);assert.ok(bytes<=1048576);console.log(JSON.stringify({declared_synthetic_fixture:root,artifact_bytes_including_directories:bytes,artifact_limit:1048576,retained:true}));
});

// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED FICTIONAL source-free controls. No real source, clock or authority.
import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{fixture,doc,amounts,sha}from'./fixture.mjs';
import{createBatchCursor,restoreBatchCursor,validateRosterBasis,currentIdentity,snapshot,charge,validateObservedUsage,recordTerminal}from'./policy.mjs';
import{cachedPermit,verifyCachedPage,acquisitionRequirements}from'./cached-adapter.mjs';
import{syntheticExample}from'./example.mjs';
const clone=structuredClone,full=f=>createBatchCursor({...f.args(),packet:f.packet,guard:f.guard});
const terminal=(c,t)=>recordTerminal(c,{receipt_document:t.text,receipt_ref:t.ref});
const repin=(x,kind,change)=>{const v=JSON.parse(x[kind+'_document']);change(v);const d=doc(x[kind+'_ref'].path,v);return{...x,[kind+'_document']:d.text,[kind+'_ref']:d.ref};};
test('fixed500/Fresh29 identity, contiguous20 and explicit rejected placeholder',()=>{
 const f=fixture({rejected:0});assert.equal(validateRosterBasis({roster:f.roster.value,packet:f.packet,guard:f.guard}).cases,20);assert.equal(snapshot(full(f)).original_denominator,20);
 for(const alter of [f=>f.packet.rows.pop(),f=>f.packet.rows[106].record.status='unknown',f=>f.roster.value.cases[1].ordinal=4,f=>f.roster.value.cases[0].case_binding.parent={...f.packet.rows[106].parent},f=>f.guard.fresh_contract_ids[0]=f.packet.rows[106].contract_id]){const b=fixture({rejected:0});alter(b);assert.throws(()=>validateRosterBasis({roster:b.roster.value,packet:b.packet,guard:b.guard}));}
});
test('both literal presenter profiles and full acquisition obligations stay separate',()=>{
 for(const [partitioned,parentCap] of[[false,500],[true,5000],[true,20000]]){const f=fixture({partitioned,parentCap}),c=full(f),q=f.cached(0),p=cachedPermit(c,q),page=JSON.parse(q.manifest_document).pages[0];assert.equal(verifyCachedPage(c,q,{permit:p,expected_page_ref:page,page_ref:page}).actual_reading,false);const a=acquisitionRequirements(c);assert.equal(a.presenter.profile.response_bytes,partitioned?2097152:1048576);assert.equal(a.presenter.parent_cap,parentCap);assert.equal(a.cached_permit_cannot_replace_full_acquisition_guard,true);assert.equal(a.source_acquisition_authorized,false);}
});
test('cached reconstruction needs only pinned metadata and opaque terminal receipts',()=>{
 const f=fixture(),c=restoreBatchCursor(f.args());assert.throws(()=>restoreBatchCursor({...f.args(),packet:undefined}),/CACHED_NO_SOURCE/);terminal(c,f.terminal(0));const d=restoreBatchCursor(f.args());terminal(d,f.terminal(0));assert.deepEqual(snapshot(c),snapshot(d));assert.equal(currentIdentity(d).case.case_binding.audit_id,'coding-0108');assert.equal(snapshot(d).actual_reading_inferred,false);const e=syntheticExample();assert.equal(e.snapshot.case_used,null);assert.equal(e.metadata_validation.status,'EXACT_CURRENT_CASE_CACHED_PAGE_METADATA');
});
test('only ordered completions or exact externally preadmitted dispositions advance',()=>{
 const f=fixture({rejected:0,disposition:0}),c=full(f);assert.throws(()=>terminal(c,f.terminal(0)),/COMPLETION_SCOPE/);assert.throws(()=>terminal(c,f.terminal(1)),/TERMINAL_BINDING/);terminal(c,f.terminal(0,'HELD_DISPOSITION'));for(let i=1;i<20;i++)terminal(c,f.terminal(i));assert.equal(snapshot(c).declared_source_completions,19);assert.equal(snapshot(c).held_dispositions,1);assert.equal(currentIdentity(c).case,null);assert.throws(()=>terminal(c,f.terminal(0)),/STOPPED/);
 const b=fixture(),d=full(b);assert.throws(()=>terminal(d,b.terminal(0,'HELD_DISPOSITION')),/UNADMITTED_DISPOSITION/);assert.equal(snapshot(d).terminal_count,0);
 const g=fixture({disposition:0}),h=full(g),t=g.terminal(0,'HELD_DISPOSITION');t.value.reason_proof_ref.sha256='0'.repeat(64);const wrong=doc(t.ref.path,t.value);assert.throws(()=>terminal(h,wrong),/UNADMITTED_DISPOSITION/);
});
test('current capsule, page, presenter, coder and permit pins cannot substitute',()=>{
 const f=fixture(),c=full(f),q=f.cached(0),p=cachedPermit(c,q),page=JSON.parse(q.manifest_document).pages[0];
 for(const change of[v=>v.reviewer_id='OTHER',v=>v.presenter.profile.response_bytes=1,v=>v.audit_id='coding-0108',v=>v.old_scope_anchor_ref=f.roster.ref])assert.throws(()=>cachedPermit(c,repin(q,'capsule',change)));
 assert.throws(()=>cachedPermit(c,repin(q,'manifest',v=>v.contract_id='contract-'+'f'.repeat(20))));assert.throws(()=>verifyCachedPage(c,q,{permit:p,expected_page_ref:page,page_ref:{...page,sha256:'f'.repeat(64)}}));terminal(c,f.terminal(0));assert.throws(()=>verifyCachedPage(c,q,{permit:p,expected_page_ref:page,page_ref:page}));
});
test('global-only absolute ledger totals keep failed costs, floor once and no clock reset',()=>{
 const f=fixture(),c=full(f);const initial=snapshot(c);assert.equal(initial.used.source_copy,65536);assert.equal(initial.per_case_limits_issued,false);let used={...initial.used,visible:8,capture:12};validateObservedUsage(c,{phase_used:used,now_ns:'1001000000'});terminal(c,f.terminal(0));assert.equal(snapshot(c).used.source_copy,65536);assert.equal(snapshot(c).clock.origin_ns,'1000000000');assert.throws(()=>validateObservedUsage(c,{phase_used:{...used,visible:7},now_ns:'1002000000'}),/ROLLBACK/);assert.throws(()=>validateObservedUsage(c,{phase_used:used,case_used:[],now_ns:'1002000000'}),/GLOBAL_ONLY/);
 used={...used,visible:f.allocation.value.phase_limits.visible+1};assert.throws(()=>validateObservedUsage(c,{phase_used:used,now_ns:'1002000000'}),/BUDGET_HELD/);assert.equal(snapshot(c).used.visible,1048577);assert.equal(snapshot(c).held,'CAP_visible');assert.throws(()=>charge(c,amounts(0),{now_ns:'1002000000'}),/STOPPED/);
});
test('explicit per-case quotas enforce totals; thrown cap/time costs never vanish',()=>{
 const f=fixture({perCase:true});f.allocation.value.case_limits[0].visible=1;const a=doc(f.allocation.ref.path,f.allocation.value),args={...f.args(),admission_document:a.text,admission_ref:a.ref},c=restoreBatchCursor(args);assert.throws(()=>charge(c,{...amounts(0),visible:2},{now_ns:'1001000000'}),/BUDGET_HELD/);assert.equal(snapshot(c).case_used[0].visible,2);
 const d=full(fixture()),z=amounts(0);charge(d,z,{now_ns:'1002000000'});assert.throws(()=>charge(d,{...z,capture:5},{now_ns:'1001000000'}),/CLOCK_HELD/);assert.equal(snapshot(d).used.capture,5);assert.equal(snapshot(d).last_observed_ns,'1002000000');
 const e=full(fixture({perCase:true})),s=snapshot(e);assert.throws(()=>validateObservedUsage(e,{phase_used:s.used,case_used:Array.from({length:20},()=>amounts(0)),now_ns:'1001000000'}),/USAGE_SUM/);
});
test('caller aliases and public returns are detached and recursively immutable',()=>{
 const f=fixture(),args=f.args(),c=restoreBatchCursor(args),before=snapshot(c);args.roster_ref.sha256='0'.repeat(64);f.allocation.value.clock.origin_ns='999';assert.deepEqual(snapshot(c),before);assert.throws(()=>currentIdentity(c).case.case_binding.parent.start=99,TypeError);assert.throws(()=>snapshot(c).clock.origin_ns='1',TypeError);assert.throws(()=>snapshot({}),/CURSOR/);const q=f.cached(0),r=full(fixture()),p=cachedPermit(r,q);q.capsule_ref.sha256='0'.repeat(64);assert.notEqual(p.inner.capsule_ref.sha256,q.capsule_ref.sha256);assert.throws(()=>p.inner.case_binding.parent.start=1,TypeError);
});
test('reused generic helper is byte-identical to the pinned efficient guard',()=>{
 assert.equal(sha(readFileSync(new URL('./cached-guard.mjs',import.meta.url))), '9d7ab5a0c17c9ec4de2d660edbf2a9295712fa83d29d5b57e1071954a06cbf49');
});

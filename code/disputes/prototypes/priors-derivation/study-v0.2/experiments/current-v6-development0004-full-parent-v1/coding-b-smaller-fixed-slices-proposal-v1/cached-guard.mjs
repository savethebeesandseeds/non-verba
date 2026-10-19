// SPDX-License-Identifier: AGPL-3.0-only
// Pure generic transport binding. No study paths, source content or filesystem I/O.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),check=(v,c)=>{if(!v)throw Error(c);},ref=(a,b)=>a&&b&&a.path===b.path&&a.sha256===b.sha256&&a.bytes===b.bytes;
export function validateCapsule(a,g,i){
 check(g.schema===i.capsule_schema&&g.reviewer_id===i.reviewer_id&&g.audit_id===i.case_binding.audit_id&&same(g.case_binding,i.case_binding)&&g.source_sha256===i.source_epoch&&ref(g.packet_ref,i.packet_ref)&&ref(g.method_epoch_ref,i.method_epoch_ref)&&ref(g.full_guard_ref,a.guard_ref)&&ref(g.old_scope_anchor_ref,a.old_scope_anchor_ref)&&ref(g.phase_close_ref,i.phase_close_ref),'CACHED_CAPSULE_IDENTITY');
 check(same(g.cached_actions,['emit','acknowledge','status'])&&g.source_acquisition_allowed===false&&g.source_quality_gate_pass===false&&g.authority==='NONE'&&g.human===false,'CACHED_CAPSULE_SCOPE');
 check(g.full_fresh100===true&&g.fresh_sections===100&&g.fresh_contract_count===29&&Array.isArray(g.fresh_contract_ids)&&g.fresh_contract_ids.length===29&&new Set(g.fresh_contract_ids).size===29&&g.fresh_contract_ids.every(x=>/^contract-[a-f0-9]{20}$/u.test(x))&&!g.fresh_contract_ids.includes(i.case_binding.contract_id),'CACHED_FRESH_CASE');return g;
}
export function makePermit(a,m,mr,i){return {capsule_ref:a.case_capsule_ref,guard_ref:a.guard_ref,source_epoch:i.source_epoch,method_epoch_ref:i.method_epoch_ref,case_binding:i.case_binding,packet_ref:i.packet_ref,manifest_ref:mr,view_ref:m.view,presentation_ref:m.presentation};}
export function validateCachedPage(a,g,m,mr,permit,expectedPage,page,i){
 validateCapsule(a,g,i);check(m.audit_id===i.case_binding.audit_id&&m.source_id===i.case_binding.source_id&&m.contract_id===i.case_binding.contract_id&&m.source_epoch===i.source_epoch&&same(m.case_capsule_ref,a.case_capsule_ref)&&same(m.full_guard_ref,a.guard_ref)&&same(m.method_epoch_ref,i.method_epoch_ref)&&same(m.packet_ref,i.packet_ref)&&m.full_source_guard_verified===true,'CACHED_PREPARED_IDENTITY');
 check(same(permit,makePermit(a,m,mr,i))&&same(expectedPage,page)&&Array.isArray(m.pages)&&m.pages.some(p=>same(p,page)),'CACHED_CALLER_PIN');return true;
}

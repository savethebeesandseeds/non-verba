// SPDX-License-Identifier: AGPL-3.0-only
// Independent observer validation after every child writer/pipe has joined.
import {canonical,hash,integer,LIMITS,METADATA_OUTPUTS,same,fail,exact,reference} from './builtin-gate.mjs';
import {freezeSelection} from './projector.mjs';
const seal=v=>{const{sha256,...body}=v??{};return typeof sha256==='string'&&hash(canonical(body))===sha256;};
function finalMetadataMembership(pre,projection,freeze){
  if(!Array.isArray(pre.development_rows)||pre.development_rows.length!==200)fail('EXECUTOR_FINAL_PARENT200_MAP');
  const originals=new Map();
  for(const row of pre.development_rows){
    exact(row,['audit_id','contract_id']);
    if(['audit_id','contract_id'].some(k=>typeof row[k]!=='string'||!row[k]||row[k].length>256)||originals.has(row.audit_id))fail('EXECUTOR_FINAL_PARENT200_MAP');
    originals.set(row.audit_id,row);
  }
  if(!same(pre.development_rows.map(r=>r.audit_id),pre.expected_ids)||pre.mandatory_audit_ids.some(id=>!originals.has(id)))fail('EXECUTOR_FINAL_PARENT200_MAP');
  const partition=new Set();
  if(!/^[a-f0-9]{64}$/u.test(pre.current_source_proof_sha256??'')||projection.current_source_proof?.sha256!==pre.current_source_proof_sha256||projection.rows.some(r=>r.source_sha256!==pre.current_source_proof_sha256))fail('EXECUTOR_FINAL_PROJECTION_SOURCE_JOIN');
  for(const kind of ['rows','ineligible_rows','protected_rows','failures']){
    if(!Array.isArray(projection[kind]))fail('EXECUTOR_FINAL_PROJECTION_PARTITION');
    for(const row of projection[kind]){
      const original=originals.get(row?.audit_id);
      if(!original||row.contract_id!==original.contract_id||partition.has(row.audit_id))fail('EXECUTOR_FINAL_PROJECTION_PARENT_JOIN');
      partition.add(row.audit_id);
    }
  }
  if(partition.size!==200)fail('EXECUTOR_FINAL_PROJECTION_PARTITION');
  const protectedRows=pre.development_rows.filter(r=>pre.freshGuard.contract_ids.includes(r.contract_id));
  if(!same(projection.protected_rows,protectedRows)||protectedRows.some(r=>pre.mandatory_audit_ids.includes(r.audit_id)))fail('EXECUTOR_FINAL_PROTECTED_PARTITION');
  const eligible=new Map(projection.rows.map(r=>[r.audit_id,r]));
  if(!same(projection.rows.map(r=>r.audit_id),pre.expected_ids.filter(id=>eligible.has(id))))fail('EXECUTOR_FINAL_ELIGIBLE_ORDER');
  for(const row of freeze.ordered)if(!eligible.has(row?.audit_id)||!same(row,eligible.get(row.audit_id)))fail('EXECUTOR_FINAL_SELECTED_ROW_MEMBERSHIP');
  const expected=freezeSelection(projection,pre.mandatory_audit_ids);
  if(!same(freeze,expected))fail('EXECUTOR_FINAL_SELECTION_RECOMPUTE');
}
export function validateFinalMetadata({documents,refs,source_epoch_sha256,worker_done}){
  if(!Array.isArray(refs)||refs.length!==6||!same(refs.map(r=>r.path),METADATA_OUTPUTS))fail('EXECUTOR_FINAL_SIX_OUTPUTS');
  const[pre,ids,guard,projection,freeze,summary]=METADATA_OUTPUTS.map(n=>documents[n]);
  if(!seal(pre)||!seal(projection)||!seal(freeze)||pre.status!=='COMPLETE_ID_ONLY_PREFLIGHT_BEFORE_INIT'||pre.mode!=='ROOT_ADMITTED_METADATA_ONLY'||pre.source_epoch_sha256!==source_epoch_sha256||pre.expected_ids.length!==200||new Set(pre.expected_ids).size!==200||pre.mandatory_audit_ids.length!==45||new Set(pre.mandatory_audit_ids).size!==45||pre.freshGuard.contract_ids.length!==29||pre.completeFreshProof.rows.length!==100||!same(pre.completeFreshProof,guard)||ids.preflight_sha256!==pre.sha256||!same(ids.expected_ids,pre.expected_ids)||projection.status!=='COMPLETE_METADATA_PROJECTION_NOT_SOURCE_READING'||!same(projection.freshGuard,pre.freshGuard)||!same(projection.completeFreshProof,guard)||projection.development_denominator!==200||!same(projection.roster_reference,pre.roster_ref))fail('EXECUTOR_FINAL_PREFLIGHT_PROJECTION');
  const partition=[...projection.rows,...projection.ineligible_rows,...projection.protected_rows,...projection.failures].map(r=>r.audit_id);if(partition.length!==200||new Set(partition).size!==200||partition.some(id=>!pre.expected_ids.includes(id))||projection.failures.length)fail('EXECUTOR_FINAL_ORIGINAL200');
  if(freeze.status!=='ORDERED69_METADATA_FROZEN_NOT_SOURCE_AUTHORIZATION'||freeze.nominal_denominator!==69||freeze.planned_denominator!==69||freeze.ordered.length!==69||new Set(freeze.ordered.map(r=>r.audit_id)).size!==69||!same(freeze.ordered.slice(0,45).map(r=>r.audit_id),pre.mandatory_audit_ids)||!same(freeze.policy.additional.map(r=>r.quota),[12,6,6])||freeze.policy.seed!=='nonverba-literal-emphasis-parent-v1-20261016-predeclared'||freeze.failures_replaced!==false||freeze.raw_opened!==false||freeze.metadata_projection_sha256!==projection.sha256||freeze.pool_sha256!==hash(canonical(projection.rows))||freeze.fresh_guard_sha256!==pre.freshGuard.projection_sha256||freeze.ordered.some(r=>pre.freshGuard.contract_ids.includes(r.contract_id)))fail('EXECUTOR_FINAL_FIXED69');
  finalMetadataMembership(pre,projection,freeze);
  if(summary.schema!=='metadata-execution-phaseA-summary-v1'||summary.status!=='COMPLETE'||summary.original_denominator!==200||summary.nominal_source_denominator!==69||summary.total_calls!==0||summary.raw_originals_opened!==false||summary.new_tracer_used!==false||summary.actual_metadata_execution!==true||summary.manual_source_reading!==false||summary.source_quality_pass!==false||summary.source_or_native_qualification!==false||!same(summary.completed_ids,pre.expected_ids)||summary.failed_ids.length||summary.remaining_ids.length||summary.preflight_sha256!==pre.sha256||summary.metadata_projection_sha256!==projection.sha256||summary.ordered69_sha256!==freeze.sha256||worker_done.status!=='COMPLETE'||worker_done.total_calls!==0||!same(worker_done.completed_ids,pre.expected_ids)||worker_done.failed_ids.length||worker_done.remaining_ids.length)fail('EXECUTOR_FINAL_SUMMARY');
  return{original_denominator:200,completed:200,failed:0,remaining:0,selected:69,mandatory:45,protected:projection.protected_rows.length,ineligible:projection.ineligible_rows.length,preflight_sha256:pre.sha256,projection_sha256:projection.sha256,freeze_sha256:freeze.sha256,quality_or_reading_authority:false};
}
export function makeObservedCheckpoint(input){
  exact(input,['phase','configuration_ref','source_epoch_ref','decision_ref','proof_ref','resource_journal_ref','observer','observer_known_present','observed_children_absent','all_output_readbacks_verified','all_child_capture_readbacks_verified','external_observer_exit_readback_required','clock','original_RUN_floor_bytes','original_growth_baseline_bytes','cumulative_cost']);
  if(input.phase!=='METADATA_SELECTION_ONLY'||input.observed_children_absent!==true||input.all_output_readbacks_verified!==true||input.all_child_capture_readbacks_verified!==true||input.observer_known_present!==true||input.external_observer_exit_readback_required!==true)fail('EXECUTOR_CHECKPOINT_SCOPE');
  for(const k of['configuration_ref','source_epoch_ref','decision_ref','proof_ref','resource_journal_ref'])reference(input[k],{max:1048576});exact(input.observer,['pid','start_ticks','group']);integer(input.observer.pid,1,2147483647);integer(input.observer.group,1,2147483647);if(!/^[1-9][0-9]{0,19}$/u.test(input.observer.start_ticks))fail('EXECUTOR_CHECKPOINT_BIRTH');
  exact(input.cumulative_cost,['active_elapsed_ms','admitted_output_bytes']);integer(input.cumulative_cost.active_elapsed_ms,0,LIMITS.active_elapsed_ms);integer(input.cumulative_cost.admitted_output_bytes,1,LIMITS.pilot_bytes);if(input.original_RUN_floor_bytes!==12330904043||input.original_growth_baseline_bytes!==12330245718)fail('EXECUTOR_CHECKPOINT_BASELINE');
  exact(input.clock,['id','launcher_start_ns','observer_finish_ns','issuer_deadline_ns']);if(input.clock.id!=='LINUX_MONOTONIC'||['launcher_start_ns','observer_finish_ns','issuer_deadline_ns'].some(k=>!/^\d{1,20}$/u.test(input.clock[k]??'')))fail('EXECUTOR_CHECKPOINT_CLOCK');const start=BigInt(input.clock.launcher_start_ns),finish=BigInt(input.clock.observer_finish_ns),deadline=BigInt(input.clock.issuer_deadline_ns);if(finish<start||deadline-finish!==BigInt(LIMITS.issuer_reserve_ms)*1000000n||input.cumulative_cost.active_elapsed_ms!==Number((deadline-start+999999n)/1000000n))fail('EXECUTOR_CHECKPOINT_CHARGED_CLOCK');
  const root=input.proof_ref.path.replace(/\/observer\/proof\.json$/u,'');if(root===input.proof_ref.path||input.resource_journal_ref.path!==root+'/observer/resource-proof.jsonl'||!/^\/opt\/nonverba-build\/priors-derivation\/study-v0\.2\/20261013-study-15000\/qa\/literal-emphasis-actualA-[A-Za-z0-9_-]+\/execution$/u.test(root))fail('EXECUTOR_CHECKPOINT_PROOF_SCOPE');
  const body={schema:'metadata-execution-observed-phaseA-checkpoint-v1',...input,authority:'NONE',actual_metadata_only:true,new_actual_reading:false,source_or_native_qualification:false,quality_gate_pass:false},record={...body,sha256:hash(canonical(body))};if(Buffer.byteLength(JSON.stringify(record,null,2)+'\n')>LIMITS.checkpoint_reserve_bytes)fail('EXECUTOR_CHECKPOINT_BOUND');return record;
}

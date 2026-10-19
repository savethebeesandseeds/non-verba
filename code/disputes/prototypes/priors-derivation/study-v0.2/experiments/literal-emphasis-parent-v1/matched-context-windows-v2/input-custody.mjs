// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE. Pure v2 carry wrapper; original authenticated Q19 custody is reused.
import {sha,digest} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {RUN,COMPARISON_CASES as CASES} from '../source-only-adverse-comparison-v1/fixed-cases.mjs';
import {validateCensusInputCustody as originalCustody,checkCensusInputMetadata,checkStoredMatchedInput} from '../matched-context-windows-v1/input-custody.mjs';
export {checkCensusInputMetadata,checkStoredMatchedInput};
const POLICY_SHA256='a348ea1e9e44cd4c74c46f45485deb3f020d6e9dc64eb85d3ed034f9109626e8';
const ORIGINAL_POLICY_SHA256='bc38d74ac4781516d86141c0dd15f2a4cc5ef54514741afc784beead3912c664';
const Q20=RUN+'/qa/literal-emphasis-parent-v1-matched-context-windows-v1';
const Q21=RUN+'/qa/literal-emphasis-parent-v1-matched-context-windows-v2';
const J=v=>Buffer.from(JSON.stringify(v,null,2)+'\n'),same=(a,b)=>a===undefined||b===undefined?a===b:digest(a)===digest(b);
const check=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
const int=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const FIELDS={policy:'ROOT-window-policy.json',closed:'ROOT-window-clock-closed.json',execution:'ROOT-execution.json',native:'ROOT-native-invocation.json',held:'prepare-HELD.json'};
const RETAINED=['prior_policy_ref','prior_completion_ref','prior_admission_ref','prior_source_epoch_ref','prior_pending_ref','prior_manifest_ref','prior_closed_ref','prior_execution_ref','prior_terminal_ref','prior_post_result_copy_ref','arms_inputs','prior_summary_refs','source_metadata_bindings','source_sha256','guard_ref','failed_available','ordered_arms','counter_policies','service_manifest_ref','named_runtime_decision_ref','source_scope','census_limits','planner_limits','limits','capture_total_bytes','combined_prospective_cap','cumulative_source_active_ms_cap','tokenizer_phase_ms_cap','global_counter_calls','per_stream_counter_calls','counter_call_reservation_batch','total_streams','streams_per_case','growth_baseline','growth_hard','whole_RUN_cap','unused_reservations_not_refunded','counter_reservations_not_refunded','all_probes_failed_work_final_counts_strip_counts_and_checker_recounts_charged','all_historical_caps_unchanged'];
function pin(value,r){check(r&&Object.keys(r).sort().join('|')==='bytes|path|sha256'&&typeof r.path==='string'&&/^[a-f0-9]{64}$/u.test(r.sha256)&&int(r.bytes,1)&&r.bytes<=262144,'CENSUS_INPUT_FAILED_REF');const b=J(value);check(b.length===r.bytes&&sha(b)===r.sha256,'CENSUS_INPUT_FAILED_PIN');}
function authority(value){check(value?.quality_gate_pass===false&&value.authority==='NONE','CENSUS_INPUT_FAILED_AUTHORITY');}
function strictPolicy(policy){check(policy&&digest(policy)===POLICY_SHA256,'CENSUS_INPUT_PINNED_POLICY');}

/** SOURCE_FREE structural control only. The actual route below first requires
 * the immutable new policy and original Q20 policy canonical identities. */
export function checkFailedCensusCarry({policy:p,failed_attempt:f}={}){
  check(p?.schema==='ROOT_MATCHED_CONTEXT_WINDOWS_POLICY_V1'&&p.QA_root===Q21&&p.failed_attempt_retained===true&&p.retry_changes==='EXACT_LOOKUP_SPELLING_AND_CANONICAL_PHYSICAL_ROUTE_PROOF; SAME_FIXED_32_STREAM_SCOPE_AND_LIMITS','CENSUS_INPUT_RETRY_SCOPE');authority(p);
  check(f&&Object.keys(f).sort().join('|')==='closed|execution|held|native|policy'&&p.failed_attempt_refs&&Object.keys(p.failed_attempt_refs).sort().join('|')==='closed_ref|execution_ref|held_ref|native_ref|policy_ref','CENSUS_INPUT_FAILED_REFS');
  for(const[key,name]of Object.entries(FIELDS)){const r=p.failed_attempt_refs[key+'_ref'];check(r?.path===Q20+'/'+name,'CENSUS_INPUT_FAILED_SCOPE');pin(f[key],r);}
  const{policy:old,closed:z,execution:e,native:n,held:h}=f,refs=p.failed_attempt_refs;
  check(old.schema==='ROOT_MATCHED_CONTEXT_WINDOWS_POLICY_V1'&&old.QA_root===Q20,'CENSUS_INPUT_FAILED_POLICY');authority(old);
  for(const key of RETAINED)check(same(p[key],old[key]),'CENSUS_INPUT_RETAINED_SCOPE');
  check(Array.isArray(p.expected_package_routes)&&p.expected_package_routes.length===4&&p.expected_package_routes.every(r=>typeof r.expected_lookup_location==='string'&&r.expected_lookup_location.startsWith('/'))&&same(p.expected_package_routes.map(({expected_lookup_location,...r})=>r),old.expected_package_routes),'CENSUS_INPUT_LOOKUP_SCOPE');
  check(p.prior_charged_bytes===491861412&&p.base_charged_bytes===491861412&&p.new_source_copy_reservation_bytes===0&&p.post_result_source_copy_reservation_bytes===0&&p.initial_source_active_ms===1595365&&p.initial_capture_bytes===973096&&p.initial_journal_rows===3809&&p.initial_journal_bytes===1408234&&p.additional_source_active_ms===1196352&&p.initial_source_active_ms+p.additional_source_active_ms===p.cumulative_source_active_ms_cap&&p.whole_RUN_floor===12562826613,'CENSUS_INPUT_RETRY_CARRY');
  check(same(p.carried_source_copy_reservations,{first_Q20_16777216_slot_spent:true,second_Q20_16777216_slot_allocated_once_to_this_corrected_attempt:true,post_result_Q20_16777216_slot_still_reserved:true,new_reservations_charged:0,unused_reservations_not_refunded:true}),'CENSUS_INPUT_RETRY_RESERVATIONS');
  check(z.schema==='ROOT-matched-context-window-clock-closed-v1'&&z.status==='HELD_BEFORE_SERVICE_IMPORT_NO_COUNTERS_OR_STREAM_OUTCOMES'&&z.source_preparation_clock_closed===true&&same(z.policy_ref,refs.policy_ref)&&same(z.execution_ref,refs.execution_ref)&&same(z.native_invocation_ref,refs.native_ref)&&z.source_active_ms_charged===p.initial_source_active_ms&&z.charged_pilot_bytes===p.prior_charged_bytes&&z.cumulative_private_and_metadata_capture_bytes===p.initial_capture_bytes&&z.cumulative_journal_rows===p.initial_journal_rows&&z.cumulative_journal_bytes===p.initial_journal_bytes,'CENSUS_INPUT_FAILED_CLOSED');authority(z);
  check(z.QA_bytes_before_closure===344310&&z.metadata_only_visible_reservation_bytes===65536&&z.terminal_physical_reservation_bytes===32768&&old.base_charged_bytes+z.QA_bytes_before_closure+z.metadata_only_visible_reservation_bytes+z.terminal_physical_reservation_bytes===z.charged_pilot_bytes&&same(z.source_copy_reservations,{total_new_source_bytes:33554432,first_16777216_slot_spent:true,second_16777216_slot_unspent_carried_for_corrected_attempt:true,post_result_16777216_slot_unspent_carried:true})&&z.failed_evidence_retained===true&&z.all_owned_births_and_groups_absent===true&&z.unused_reservations_not_refunded===true,'CENSUS_INPUT_FAILED_COSTS');
  check(z.held_code==='WINDOW_RUNTIME_PACKAGE_LOCATION'&&z.named_refs_verified===18&&z.package_imports===0&&z.counter_constructors===0&&z.counter_calls===0&&z.streams_produced===0&&z.models_opened_for_inference===0&&z.pooling_performed===false&&z.materiality_holds_cleared===0&&z.first_priors_decided===false,'CENSUS_INPUT_FAILED_ZERO_WORK');
  check(e.schema==='ROOT-matched-context-window-execution-v1'&&e.status==='HELD_TOKENIZER_CENSUS'&&e.held_code==='CENSUS_PREPARE_EXIT'&&same(e.policy_ref,refs.policy_ref)&&e.phase_origin_ns===e.source_origin_ns&&/^[0-9]{1,32}$/u.test(e.phase_origin_ns??'')&&e.source_active_ms===old.initial_source_active_ms+e.phase_elapsed_ms&&int(e.phase_elapsed_ms)&&e.source_active_ms<=z.source_active_ms_charged&&e.all_known_births_and_original_groups_absent===true&&e.inference===false&&e.pooling_performed===false,'CENSUS_INPUT_FAILED_EXECUTION');authority(e);
  check(Array.isArray(e.actors)&&e.actors.length===2&&e.actors[0].role==='capacity'&&e.actors[0].exit_code===null&&e.actors[0].signal==='SIGKILL'&&e.actors[1].role==='prepare'&&e.actors[1].exit_code===77&&e.actors[1].signal===null&&e.actors.every(a=>a.closed===true&&a.error===null),'CENSUS_INPUT_FAILED_ACTORS');
  check(n.schema==='ROOT-matched-window-native-invocation-v1'&&same(n.admission_ref,e.admission_ref)&&n.supervisor_exit===77&&n.supervisor_signal===null&&n.supervisor_error===null&&n.receipt?.schema==='matched-window-supervisor-receipt-v1'&&n.receipt.status===e.status&&same(n.receipt.execution_ref,refs.execution_ref),'CENSUS_INPUT_FAILED_NATIVE');authority(n);authority(n.receipt);
  check(h.schema==='matched-window-actor-held-v1'&&h.role==='prepare'&&h.status==='HELD'&&h.code===z.held_code&&h.stage==='FIXED_SERVICE_OPEN'&&h.source_payloads_opened===true&&h.counters_opened===false&&same(h.completed_cases,[])&&h.phase_origin_ns===e.phase_origin_ns&&h.source_origin_ns===e.source_origin_ns&&same(h.actor,e.actors[1].actor)&&h.global_counter_reserved===0&&h.local_counter_reserved===0&&h.local_counter_actual===0,'CENSUS_INPUT_FAILED_HELD');authority(h);
  const g=h.runtime_guard_progress;check(g?.schema==='matched-context-windows-runtime-failure-progress-v1'&&g.synthetic===false&&Array.isArray(g.verified_receipts)&&g.verified_receipts.length===18&&g.verified_receipts.every(r=>r.actual_bytes_rehashed===true)&&same(g.package_routes,[])&&g.service_import_started===false&&g.constructor_started===false&&g.counter_pair_returned===false&&g.tokenizer_calls_attested===false&&g.external_supervision_attested===false,'CENSUS_INPUT_FAILED_PROGRESS');authority(g);
  return immutableCopy({charged_bytes:p.prior_charged_bytes,active_ms:p.initial_source_active_ms,capture_bytes:p.initial_capture_bytes,journal_rows:p.initial_journal_rows,journal_bytes:p.initial_journal_bytes});
}

export function validateCensusInputCustody(args){
  strictPolicy(args?.policy);check(args.failed_attempt?.policy&&digest(args.failed_attempt.policy)===ORIGINAL_POLICY_SHA256,'CENSUS_INPUT_PINNED_FAILED_POLICY');
  const carried_costs=checkFailedCensusCarry(args),original=originalCustody({policy:args.failed_attempt.policy,prior:args.prior,guard:args.guard});
  return immutableCopy({...original,carried_costs,failed_attempt_refs:args.policy.failed_attempt_refs,failed_attempt_retained:true,carried_source_copy_reservations:args.policy.carried_source_copy_reservations});
}
export function verifyStoredMatchedInput(args){
  strictPolicy(args?.policy);const i=CASES.findIndex(b=>same(b,args.slot?.binding));check(i>=0,'CENSUS_INPUT_FIXED_CASE');
  check(same(args.slot.arms_ref,args.policy.arms_inputs[i].arms_ref)&&same(args.slot.summary_ref,args.policy.arms_inputs[i].summary_ref),'CENSUS_INPUT_ALLOWED_REF');
  return checkStoredMatchedInput(args);
}

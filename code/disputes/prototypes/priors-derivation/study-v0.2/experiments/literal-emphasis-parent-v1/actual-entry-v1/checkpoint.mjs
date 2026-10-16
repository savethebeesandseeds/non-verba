// SPDX-License-Identifier: AGPL-3.0-only
// Pure cumulative resource accounting. A seal is never an admission ticket.
import {digest,sha,canonical,integer,reference,EXECUTION_LIMITS as L,EXECUTION_RESERVATION as R,fail} from '../pilot-execution-control.mjs';
import {immutableCopy} from '../immutable-state.mjs';
export const CHECKPOINT_RESERVE=4096;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
export function checkedPriorCost(value){
  if(!value||Object.keys(value).sort().join(',')!=='active_elapsed_ms,admitted_output_bytes')fail('ACTUAL_PRIOR_COST_FIELDS');
  integer(value.active_elapsed_ms,0,L.elapsed_ms);integer(value.admitted_output_bytes,0,L.pilot_new_run_bytes);return immutableCopy(value);
}
export function cumulativeCost(prior,{active_elapsed_ms,admitted_output_bytes}){prior=checkedPriorCost(prior);integer(active_elapsed_ms);integer(admitted_output_bytes);const total={active_elapsed_ms:prior.active_elapsed_ms+active_elapsed_ms,admitted_output_bytes:prior.admitted_output_bytes+admitted_output_bytes};if(!Number.isSafeInteger(total.active_elapsed_ms)||!Number.isSafeInteger(total.admitted_output_bytes)||total.active_elapsed_ms>L.elapsed_ms||total.admitted_output_bytes>L.pilot_new_run_bytes)fail('ACTUAL_CUMULATIVE_PHASE_BUDGET');return immutableCopy(total);}
export function makePhaseCheckpoint(input){
  const body=structuredClone(input);if(body.schema!=='closed-actual-prototype-phase-checkpoint-v1'||body.phase!=='METADATA_SELECTION_ONLY'||body.authority!=='NONE'||body.ownership_verified_absent!==true||body.outputs_final_rehash_verified!==true||!hash(body.source_epoch_sha256)||body.original_RUN_floor_bytes!==R.run_at_reservation||body.original_growth_baseline_bytes!==R.baseline)fail('ACTUAL_CHECKPOINT_SCOPE');
  for(const key of['configuration_ref','result_ref','resource_journal_ref'])reference(body[key],{absolute:true,maxBytes:8388608});
  checkedPriorCost(body.cumulative_cost);if(body.checkpoint_bytes_reserved!==CHECKPOINT_RESERVE||body.cumulative_cost.admitted_output_bytes<CHECKPOINT_RESERVE)fail('ACTUAL_CHECKPOINT_UNCHARGED');
  const value=immutableCopy({...body,sha256:digest(body)});if(Buffer.byteLength(JSON.stringify(value,null,2)+'\n')>CHECKPOINT_RESERVE)fail('ACTUAL_CHECKPOINT_BOUND');return value;
}
export function verifyPhaseCheckpoint(checkpoint,{source_epoch_sha256,expected_prior}={}){
  const {sha256,...body}=checkpoint??{};if(!hash(sha256)||digest(body)!==sha256)fail('ACTUAL_CHECKPOINT_SEAL');const checked=makePhaseCheckpoint(body);if(checked.sha256!==sha256||checked.source_epoch_sha256!==source_epoch_sha256||canonical(checkedPriorCost(expected_prior))!==canonical(checked.cumulative_cost))fail('ACTUAL_CHECKPOINT_BINDING');return checked;
}
export function zeroPriorCost(){return immutableCopy({active_elapsed_ms:0,admitted_output_bytes:0});}

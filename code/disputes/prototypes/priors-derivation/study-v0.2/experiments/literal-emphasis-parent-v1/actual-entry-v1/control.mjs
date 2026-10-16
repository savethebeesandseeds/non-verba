// SPDX-License-Identifier: AGPL-3.0-only
// Closed actual API; detached extended fixture config for source-only controls.
import * as base from '../pilot-execution-control.mjs';
import {checkedPriorCost} from './checkpoint.mjs';
import {JOURNAL_LIMITS} from './resource-journal.mjs';
import {admitActualExecution} from './admission.mjs';
export * from '../pilot-execution-control.mjs';
export function inspectActualConfiguration(){admitActualExecution();}
const OLD=['schema','mode','phase','root','source_epoch_sha256','runtime','closure','worker','bindings','mandatory_audit_ids','selected_freeze_ref','metadata_projection_ref','expected_ids','stream_ids','allowed_writes','capacity','limits','actual_authorization'];
const EXTRA=['prior_cost','prior_phase_checkpoint_ref','roster_ref','artifact_bindings_ref','runtime_boundary_ref','source_epoch_ref','complete_guard_ref','resource_journal_limits'];
export function baseFixtureConfig(config){const value={};for(const key of OLD)value[key]=config[key];value.schema='literal-emphasis-exact69-guardian-config-v1';return value;}
export function validateExecutionConfig(input){
  const config=JSON.parse(base.canonical(input));base.exact(config,[...OLD,...EXTRA]);if(config.schema!=='closed-actual-entry-fixture-config-v1')base.fail('ACTUAL_CONFIG_SCHEMA');base.validateExecutionConfig(baseFixtureConfig(config));
  checkedPriorCost(config.prior_cost);base.exact(config.resource_journal_limits,Object.keys(JOURNAL_LIMITS));for(const[k,limit]of Object.entries(JOURNAL_LIMITS))base.integer(config.resource_journal_limits[k],1,limit);
  for(const key of['roster_ref','artifact_bindings_ref','source_epoch_ref'])base.reference(config[key],{maxBytes:8388608});for(const key of['prior_phase_checkpoint_ref','runtime_boundary_ref','complete_guard_ref'])if(config[key]!==null)base.reference(config[key],{maxBytes:8388608});
  if(config.phase==='METADATA_SELECTION_ONLY'&&(config.prior_phase_checkpoint_ref!==null||config.prior_cost.active_elapsed_ms||config.prior_cost.admitted_output_bytes||config.complete_guard_ref!==null))base.fail('ACTUAL_PHASE_A_PRIOR_COST');
  if(config.phase==='PREPARE_SELECTED69'&&(!config.prior_phase_checkpoint_ref||!config.complete_guard_ref))base.fail('ACTUAL_PHASE_B_CHECKPOINT_REQUIRED');return config;
}
export function createExecutionBook(input){
  const config=validateExecutionConfig(input),book=base.createExecutionBook(baseFixtureConfig(config));return Object.freeze({get totalCalls(){return book.totalCalls;},get admittedBytes(){return config.prior_cost.admitted_output_bytes+book.admittedBytes;},get committed(){return book.committed;},get pending(){return book.pending;},progress:row=>book.progress(row),request(row){if(config.prior_cost.admitted_output_bytes+book.admittedBytes+row.encoded_bytes>base.EXECUTION_LIMITS.pilot_new_run_bytes)base.fail('ACTUAL_CUMULATIVE_PHASE_BUDGET');return book.request(row);},commit:row=>book.commit(row),done:row=>book.done(row)});
}

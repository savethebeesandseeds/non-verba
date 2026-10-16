// SPDX-License-Identifier: AGPL-3.0-only
// Future configuration SHAPE only. No actual refs are opened or admitted.
import {immutableCopy} from '../../immutable-state.mjs';
import {digest} from '../../finite-codec.mjs';
import {STATIC_METADATA_REFS} from '../bindings.mjs';
import {EXECUTION_LIMITS,EXECUTION_RESERVATION,CAPACITY_BINDINGS} from '../../pilot-execution-control.mjs';
import {reference} from './input-io.mjs';
import {fail} from './admission.mjs';
export const FIXED_INPUT_RUN='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const FIXED_INPUT_REFS=immutableCopy({development:{path:'audits/592ddf76b713d8ad4a13/development.json',sha256:'a815edbd6f3a176d12159d032b77a7d979c57dcec0d012b209ac0cf3582e5559',bytes:912507},fresh:{path:'audits/592ddf76b713d8ad4a13/fresh_representation.json',sha256:'b7f2a7d36149a64aa63a127fcc22989dc3b1f1eaf7701bf74c06701558917e18',bytes:452683},manifest:{path:'processing/874c6b505ae5fc09/calibration-1000-cea0eeae0bf69647/extraction-manifest.json',sha256:'676e548d62e358dc7b3b61f4be987861631d0e32f7707c9e9f0af0f096737921',bytes:5178351}});
export function inspectProspectiveConfigurationShape(input){
  const c=immutableCopy(input),keys=['schema','phase','data_root','output_prefix','source_epoch_ref','bindings','roster_ref','capacity','limits','prior_cost','expected_denominators','stream_ids','execution_manifest_ref','authority'];
  if(Object.keys(c).sort().join(',')!==keys.sort().join(',')||c.schema!=='metadata-selection-prospective-config-shape-v1'||c.phase!=='METADATA_SELECTION_ONLY'||c.data_root!==FIXED_INPUT_RUN||typeof c.output_prefix!=='string'||!/^qa\/[A-Za-z0-9_-]+\/$/u.test(c.output_prefix)||c.authority!=='NONE')fail('METADATA_PROSPECTIVE_CONFIG_SHAPE');
  reference(c.source_epoch_ref);if(digest(c.bindings)!==digest(FIXED_INPUT_REFS)||digest(c.roster_ref)!==digest(STATIC_METADATA_REFS.roster)||digest(c.limits)!==digest(EXECUTION_LIMITS)||digest(c.capacity)!==digest({bindings:CAPACITY_BINDINGS,reservation:EXECUTION_RESERVATION})||digest(c.expected_denominators)!==digest({fresh:100,protected_contracts:29,development:200,mandatory:45,selected:69})||digest(c.prior_cost)!==digest({active_elapsed_ms:0,admitted_output_bytes:0})||!Array.isArray(c.stream_ids)||c.stream_ids.length||c.execution_manifest_ref!==null)fail('METADATA_PROSPECTIVE_CONFIG_BINDINGS');
  return immutableCopy({configuration:c,source_review_only:true,execution_admitted:false,expected_ids_derived_by_parent_preflight:true,tokenizer_call_allowance:0,external_manifest_pins_config_not_reverse:true});
}

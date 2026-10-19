// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Pure stream planning; no IO permit or runtime issuer.
import {digest,sha} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {validateTypedCaseRoster} from '../typed-case-roster-v1/roster.mjs';
import {EXECUTION_LIMITS,EXECUTION_RESERVATION} from '../pilot-execution-control.mjs';
import {checkedPriorCost} from '../actual-entry-v1/checkpoint.mjs';

export const ACTUAL_POLICY_SHA256S=immutableCopy(['728bb65a00c45e8b6a4e1cdb1e5f8a69d5946234deb8bef089b61261dc8f541d','e05a9bd1e27021b8857015953480d3653acd794e3c5d0cd5dba8f35a75618bf1']);
export const FICTIONAL_POLICY_SHA256S=immutableCopy([sha('SYNTHETIC_TYPED_COUNTER_POLICY_0'),sha('SYNTHETIC_TYPED_COUNTER_POLICY_1')]);
export const POLICY=immutableCopy({id:'PROTOTYPE_TYPED_SOURCE_ROUTE_FIRST_LAYER_V1',protocol_cases:69,available_cases:67,unavailable_controls:2,actual_units:53,parent_anchors:14,counter_models:2,artifact_files_for_two_actual_models:12,forms:['focal','parent'],planned_streams:268,duplicate_arm_inputs_require_disclosure:true,actual_io_authority:false,adopted:false,authority:'NONE'});
const fictionalPlans=new WeakMap(),HASH=/^[a-f0-9]{64}$/u;
const fail=code=>{throw Object.assign(Error(code),{code});};
const same=(a,b)=>digest(a)===digest(b);
const requireThat=(value,code)=>{if(!value)fail(code);};
function sealed(value){const{sha256,...body}=value??{};return HASH.test(sha256??'')&&digest(body)===sha256;}
function syntheticID(value){return typeof value==='string'&&/^SYNTHETIC_[A-Za-z0-9_:-]+$/u.test(value);}
function syntheticPath(value){return typeof value==='string'&&/^SYNTHETIC_[A-Za-z0-9_:/.-]+$/u.test(value)&&!value.split('/').some(p=>!p||p==='.'||p==='..');}
function context(roster,inputs,options){
  const o=immutableCopy(options);requireThat(o&&Object.keys(o).sort().join(',')==='fixture,model_policy_sha256s,prior_cost'&&typeof o.fixture==='boolean','TYPED_SOURCE_OPTIONS');
  validateTypedCaseRoster(roster,inputs,{fixture:o.fixture});
  const expected=o.fixture?FICTIONAL_POLICY_SHA256S:ACTUAL_POLICY_SHA256S;requireThat(Array.isArray(o.model_policy_sha256s)&&o.model_policy_sha256s.length===2&&new Set(o.model_policy_sha256s).size===2&&same(o.model_policy_sha256s,expected),'TYPED_SOURCE_TWO_FIXED_POLICIES');
  const prior=checkedPriorCost(o.prior_cost),r=immutableCopy(roster);requireThat(r.duplicate_arm_inputs_require_disclosure===true,'TYPED_SOURCE_DUPLICATE_DISCLOSURE');
  if(o.fixture)for(const c of r.ordered_cases){requireThat(syntheticID(c.audit_id)&&syntheticID(c.contract_id),'TYPED_SOURCE_SYNTHETIC_ONLY');if(c.case_kind==='AVAILABLE_FOCAL'){for(const key of['audit_id','contract_id','focal_id','parent_id'])requireThat(syntheticID(c.focal[key]),'TYPED_SOURCE_SYNTHETIC_ONLY');for(const key of['raw_path','normalized_path','cache_path'])requireThat(syntheticPath(c.focal[key]),'TYPED_SOURCE_SYNTHETIC_PATH_ONLY');}}
  return{roster:r,fixture:o.fixture,policies:expected,prior};
}
function deriveBody(c){
  const streams=[],cases=c.roster.ordered_cases.map((row,original_index)=>{const available=row.case_kind==='AVAILABLE_FOCAL',focal_binding_sha256=available?digest(row.focal):null,ids=[];if(available)for(const[model_index,tokenizer_policy_sha256]of c.policies.entries())for(const form of POLICY.forms){const stream_id=row.audit_id+':'+tokenizer_policy_sha256+':'+form;ids.push(stream_id);streams.push({stream_id,case_id:row.case_id,audit_id:row.audit_id,contract_id:row.contract_id,model_index,tokenizer_policy_sha256,form,focal_kind:row.focal.focal_kind,focal_binding_sha256});}return{original_index,case_id:row.case_id,audit_id:row.audit_id,contract_id:row.contract_id,case_kind:row.case_kind,selection_role:row.selection_role,stratum:row.stratum,focal_kind:available?row.focal.focal_kind:null,focal_binding_sha256,stream_ids:ids};});
  return{schema:'typed-source-preparation-plan-v1',status:'PROTOTYPE_STREAM_DESCRIPTORS_NOT_IO_PERMITS',prototype:true,adopted:false,source_kind:c.fixture?'SOURCE_FREE_FIXTURE':'PROSPECTIVE_ACTUAL_DEVELOPMENT',counter_kind:c.fixture?'SYNTHETIC_POLICY_MARKERS_NOT_OPENED':'EXPECTED_PINNED_COUNTER_POLICIES_NOT_OPENED',policy:POLICY,typed_roster_sha256:c.roster.sha256,input_refs:c.roster.input_refs,source_epoch_sha256:c.roster.source_epoch_sha256,current_source_proof_sha256:c.roster.current_source_proof_sha256,fresh_guard_sha256:c.roster.fresh_guard_sha256,legacy_origin_status:c.roster.legacy_origin_status,legacy_plan_status:c.roster.legacy_plan_status,original_denominator:200,original_dispositions:c.roster.original_dispositions,mandatory_ids:c.roster.mandatory_ids,counts:c.roster.counts,model_policy_sha256s:c.policies,prior_cost:c.prior,costs_are_declared_not_observed:true,b_limits:{...EXECUTION_LIMITS,input_decoded_bytes:33554432},reservation:EXECUTION_RESERVATION,cases,streams,model_artifacts_verified:false,loaders_connected:false,actual_counters_opened:false,old_checkpoint_promoted:false,checkpoint_authority:false,phase_B_authority:false,actual_io_authority:false,source_reading_authority:false,tokenizer_authority:false,quality_authority:false,full_owned_two_phase_prerequisite_satisfied:false,authority:'NONE'};
}
export function validateTypedPreparationPlan(plan,roster,inputs,options){
  const c=context(roster,inputs,options);requireThat(sealed(plan),'TYPED_SOURCE_PLAN_SEAL');const{sha256,...body}=plan;requireThat(same(body,deriveBody(c)),'TYPED_SOURCE_PLAN_BINDING');requireThat(plan.cases.length===69&&plan.streams.length===268&&new Set(plan.streams.map(r=>r.stream_id)).size===268&&plan.cases.filter(r=>r.case_kind==='UNAVAILABLE_CONTROL').every(r=>r.stream_ids.length===0&&r.focal_kind===null&&r.focal_binding_sha256===null),'TYPED_SOURCE_STREAM_DISPOSITIONS');return immutableCopy({status:'VALID_TYPED_STREAM_PLANNING_ONLY',protocol_cases:69,available_cases:67,unavailable_controls:2,planned_streams:268,authority:'NONE'});
}
export function buildTypedPreparationPlan(roster,inputs,options){const c=context(roster,inputs,options),body=deriveBody(c),plan=immutableCopy({...body,sha256:digest(body)});validateTypedPreparationPlan(plan,roster,inputs,options);if(c.fixture)fictionalPlans.set(plan,Object.freeze({plan}));return plan;}
// A brand verifies only this immutable synthetic routing plan, never actual IO.
export function assertFictionalPreparationPlan(plan){const record=fictionalPlans.get(plan);if(!record||record.plan!==plan||!Object.isFrozen(plan)||plan.source_kind!=='SOURCE_FREE_FIXTURE'||plan.actual_io_authority!==false)fail('TYPED_SOURCE_OWNED_FICTIONAL_PLAN_REQUIRED');return record.plan;}

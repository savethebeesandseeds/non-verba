// SPDX-License-Identifier: AGPL-3.0-only
// Closed SOURCE_FREE routing simulation. No real loader, counter or issuer.
import {immutableCopy} from '../immutable-state.mjs';
import {assertFictionalPreparationPlan} from './plan.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
export const ACTUAL_TYPED_SOURCE_ENABLED=false;
export function prepareActualTypedSources(){fail('TYPED_SOURCE_ACTUAL_CLOSED');}
function checkedHooks(backend){
  if(!backend||Object.getPrototypeOf(backend)!==Object.prototype)fail('TYPED_SOURCE_FICTIONAL_HOOKS');const d=Object.getOwnPropertyDescriptors(backend),names=['loader','adapter','meter'];if(Reflect.ownKeys(backend).length!==names.length||names.some(k=>!Object.hasOwn(d,k)||!Object.hasOwn(d[k],'value')||typeof d[k].value!=='function'))fail('TYPED_SOURCE_FICTIONAL_HOOKS');return Object.freeze(Object.fromEntries(names.map(k=>[k,d[k].value])));
}
function safeCode(error){try{const d=Object.getOwnPropertyDescriptor(error,'code');return d&&Object.hasOwn(d,'value')&&typeof d.value==='string'&&/^[A-Z0-9_]{1,100}$/u.test(d.value)?d.value:'TYPED_SOURCE_FICTIONAL_ROUTE_FAILURE';}catch{return'TYPED_SOURCE_FICTIONAL_ROUTE_FAILURE';}}
async function routeCase(record,backend,state){
  // Even inspecting a hook object is downstream of this no-source branch.
  if(record.case_kind==='UNAVAILABLE_CONTROL')return immutableCopy({original_index:record.original_index,case_id:record.case_id,audit_id:record.audit_id,contract_id:record.contract_id,case_kind:'UNAVAILABLE_CONTROL',status:'UNAVAILABLE_CONTROL_NO_SOURCE_ROUTE',descriptor:null,stream_ids:[],loader_calls:0,adapter_calls:0,meter_calls:0,counter_calls:0,source_opened:false,actual_reading:false,authority:'NONE'});
  let stage='HOOK_BINDING',loader_calls=0,adapter_calls=0,meter_calls=0;
  try{state.hooks??=checkedHooks(backend);stage='LOADER';loader_calls++;const loaded=immutableCopy(await state.hooks.loader(record));stage='ADAPTER';adapter_calls++;const adapted=immutableCopy(await state.hooks.adapter(record,loaded));stage='METER';meter_calls++;const streams=state.streams.get(record.case_id);immutableCopy(await state.hooks.meter(record,adapted,streams));return immutableCopy({original_index:record.original_index,case_id:record.case_id,audit_id:record.audit_id,contract_id:record.contract_id,case_kind:'AVAILABLE_FOCAL',status:'FICTIONAL_AVAILABLE_ROUTE_COMPLETED_NOT_SOURCE_PREPARATION',focal_kind:record.focal_kind,stream_ids:record.stream_ids,loader_calls,adapter_calls,meter_calls,actual_source_prepared:false,actual_reading:false,authority:'NONE'});}
  catch(error){return immutableCopy({original_index:record.original_index,case_id:record.case_id,audit_id:record.audit_id,contract_id:record.contract_id,case_kind:'AVAILABLE_FOCAL',status:'FICTIONAL_AVAILABLE_ROUTE_FAILED_NOT_REPLACED',failed_stage:stage,code:safeCode(error),focal_kind:record.focal_kind,stream_ids:record.stream_ids,loader_calls,adapter_calls,meter_calls,actual_source_prepared:false,partial_stream_accepted:false,actual_reading:false,authority:'NONE'});}
}
export async function consumeFictionalPreparation(plan,backend){
  // Reject forged, cloned, actual or mutable plans before any backend access.
  const owned=assertFictionalPreparationPlan(plan),streams=new Map(owned.cases.filter(c=>c.case_kind==='AVAILABLE_FOCAL').map(c=>[c.case_id,Object.freeze(owned.streams.filter(s=>s.case_id===c.case_id))])),state={hooks:null,streams},outcomes=[];
  for(const record of owned.cases)outcomes.push(await routeCase(record,backend,state));
  const controls=outcomes.filter(r=>r.case_kind==='UNAVAILABLE_CONTROL'),available=outcomes.filter(r=>r.case_kind==='AVAILABLE_FOCAL'),failed=available.filter(r=>r.status==='FICTIONAL_AVAILABLE_ROUTE_FAILED_NOT_REPLACED'),complete=available.filter(r=>r.status==='FICTIONAL_AVAILABLE_ROUTE_COMPLETED_NOT_SOURCE_PREPARATION');
  return immutableCopy({schema:'typed-source-fictional-route-result-v1',status:failed.length?'HELD_FICTIONAL_AVAILABLE_FAILURES_RETAINED':'COMPLETE_FICTIONAL_ROUTING_ONLY',source_kind:'SOURCE_FREE_FIXTURE',counter_kind:owned.counter_kind,plan_sha256:owned.sha256,typed_roster_sha256:owned.typed_roster_sha256,original_denominator:200,protocol_denominator:69,available_denominator:67,unavailable_control_denominator:2,actual_unit_denominator:53,parent_anchor_denominator:14,planned_streams:268,terminal_ids:outcomes.map(r=>r.audit_id),completed_available_ids:complete.map(r=>r.audit_id),failed_available_ids:failed.map(r=>r.audit_id),unavailable_control_ids:controls.map(r=>r.audit_id),remaining_ids:[],outcomes,declared_prior_cost:owned.prior_cost,resource_observation_performed:false,actual_source_prepared:false,actual_counter_calls:0,old_checkpoint_promoted:false,checkpoint_issued:false,full_owned_two_phase_prerequisite_satisfied:false,quality_authority:false,source_reading_authority:false,phase_B_authority:false,actual_io_authority:false,adopted:false,authority:'NONE'});
}

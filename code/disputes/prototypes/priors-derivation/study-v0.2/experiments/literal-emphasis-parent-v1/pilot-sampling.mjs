// SPDX-License-Identifier: AGPL-3.0-only
// Pure prospective metadata selection. No files, raw callbacks or actual draw.
import {immutableCopy} from './immutable-state.mjs';
import {digest,sha} from './finite-codec.mjs';
export const CURRENT_SOURCE='874c6b505ae5fc09fd3d92d46c64cd5474abf90fe574537c5e101b4fcaac6afa';
export const SAMPLING_POLICY=immutableCopy({id:'PROTOTYPE_PROSPECTIVE_DEVELOPMENT_45_PLUS24_V1',seed:'nonverba-literal-emphasis-parent-v1-20261016-predeclared',mandatory:45,additional:[{stratum:'CSS_EMPHASIS_PROXY',quota:12},{stratum:'PARENT_DISTANCE_GEOMETRY_PROXY',quota:6},{stratum:'DENSE_LONG_JOINT_ZERO_PROXY',quota:6}],priority:'FIXED_STRATUM_ORDER_THEN_SHA256_SEEDED_ROW_PRIORITY_THEN_AUDIT_ID',additional_deduplication:'NO_MANDATORY_AUDIT_UNIT_OR_CONTRACT; ONE_ADDITIONAL_UNIT_PER_CONTRACT',shortage:'RETAIN_SHORTAGE_NO_FALLBACK_STRATUM_OR_LATER_REPLACEMENT',failure_substitution:false,semantic_governor_detection:false,source_exposure:false,authority:'NONE'});
const KEYS=new Set(['audit_id','contract_id','unit_id','parent_id','source_sha256','metadata_basis_sha256','development_row','raw_sha256','raw_bytes','unit_start','unit_end','parent_start','parent_end','normalized_sha256','unit_sha256','css_emphasis_sources','native_mark_sources','emphasized_caption_count','joint_groups','zero_events','parent_units']);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
export function checkedMetadataRow(input,{control=false}={}){
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!KEYS.has(k)))throw new Error('Source-only metadata projection required; no source/coder fields');
  const row=immutableCopy(input);for(const key of ['audit_id','contract_id','unit_id','parent_id'])if(typeof row[key]!=='string'||!row[key])throw new Error('Exact metadata IDs required');
  for(const key of ['source_sha256','metadata_basis_sha256','raw_sha256','normalized_sha256','unit_sha256'])if(!hash(row[key]))throw new Error('Exact metadata bindings required');
  if(row.development_row!==true||!control&&row.source_sha256!==CURRENT_SOURCE)throw new Error('Frozen development/current-source membership required');
  for(const key of ['raw_bytes','unit_start','unit_end','parent_start','parent_end','css_emphasis_sources','native_mark_sources','emphasized_caption_count','joint_groups','zero_events','parent_units'])if(!Number.isSafeInteger(row[key])||row[key]<0)throw new Error('Finite source metadata counts/ranges required');
  if(row.unit_start<row.parent_start||row.unit_end<=row.unit_start||row.parent_end<row.unit_end)throw new Error('Focal geometry differs from actual parent');return row;
}
export function checkedFreshGuard(input){
  const guard=immutableCopy(input),keys=['schema','fresh_packet_sha256','projection_sha256','fresh_packet_rows','contract_ids'];
  if(!guard||Object.keys(guard).some(k=>!keys.includes(k))||guard.schema!=='CONTRACT_ID_ONLY_FRESH_GUARD_V1'||guard.fresh_packet_rows!==100||!hash(guard.fresh_packet_sha256)||!Array.isArray(guard.contract_ids)||guard.contract_ids.length<1||guard.contract_ids.length>100||guard.contract_ids.some(x=>typeof x!=='string'||!x)||new Set(guard.contract_ids).size!==guard.contract_ids.length)throw new Error('Complete fresh100 contract-ID-only projection required');
  const {projection_sha256,...body}=guard;if(projection_sha256!==digest(body))throw new Error('Fresh guard projection binding differs');return guard;
}
/** This is a denial/eligibility check, NOT an authorization or guardian ticket. */
export function metadataAccessRequest(row,freshGuard,{control=false}={}){
  row=checkedMetadataRow(row,{control});const guard=checkedFreshGuard(freshGuard);
  if(guard.contract_ids.includes(row.contract_id))throw Object.assign(new Error('Protected fresh contract; no raw callback permitted'),{code:'PILOT_PROTECTED_CONTRACT'});
  const body={schema:'pilot-metadata-access-request-v1',status:'METADATA_ELIGIBLE_NOT_SOURCE_AUTHORIZATION',source_kind:control?'DECLARED_SYNTHETIC_CONTROL':'PROSPECTIVE_ACTUAL_DEVELOPMENT',row,fresh_guard_sha256:guard.projection_sha256,fresh_packet_sha256:guard.fresh_packet_sha256,external_guardian_required:true,raw_opened:false,authority:'NONE'};return immutableCopy({...body,sha256:digest(body)});
}
const eligible=(row,stratum)=>stratum==='CSS_EMPHASIS_PROXY'?row.css_emphasis_sources+row.native_mark_sources+row.emphasized_caption_count>0:stratum==='PARENT_DISTANCE_GEOMETRY_PROXY'?Math.max(row.unit_start-row.parent_start,row.parent_end-row.unit_end)>=512:row.joint_groups+row.zero_events>0||row.native_mark_sources>=32||row.parent_end-row.parent_start>=8192||row.parent_units>=8;
export function prospectivePilotSelection({rows,mandatoryAuditIds,freshGuard,control=false}={}){
  if(!Array.isArray(rows)||!Array.isArray(mandatoryAuditIds)||mandatoryAuditIds.length!==45||new Set(mandatoryAuditIds).size!==45)throw new Error('Exactly45 distinct mandatory development audit IDs required');
  const guard=checkedFreshGuard(freshGuard),pool=rows.map(r=>checkedMetadataRow(r,{control})),byAudit=new Map();for(const row of pool){if(byAudit.has(row.audit_id))throw new Error('Duplicate audit ID in frozen metadata pool');byAudit.set(row.audit_id,row);}
  const mandatory=[],missing=[],protectedMandatory=[];for(const id of mandatoryAuditIds){const row=byAudit.get(id);if(!row){missing.push(id);continue;}if(guard.contract_ids.includes(row.contract_id))protectedMandatory.push(id);mandatory.push(row);}
  const mandatoryAudit=new Set(mandatoryAuditIds),units=new Set(mandatory.map(r=>r.unit_id)),contracts=new Set(mandatory.map(r=>r.contract_id)),extras=[],shortages=[];let protectedBeforeDraw=0;
  const candidates=pool.filter(row=>{if(guard.contract_ids.includes(row.contract_id)){protectedBeforeDraw++;return false;}return !mandatoryAudit.has(row.audit_id)&&!units.has(row.unit_id)&&!contracts.has(row.contract_id);});
  const rank=row=>sha(JSON.stringify([SAMPLING_POLICY.seed,row.contract_id,row.unit_id,row.audit_id]));
  for(const rule of SAMPLING_POLICY.additional){const choices=candidates.filter(row=>eligible(row,rule.stratum)).sort((a,b)=>rank(a).localeCompare(rank(b))||a.audit_id.localeCompare(b.audit_id));let count=0;for(const row of choices){if(count===rule.quota)break;if(units.has(row.unit_id)||contracts.has(row.contract_id))continue;extras.push({stratum:rule.stratum,row});units.add(row.unit_id);contracts.add(row.contract_id);count++;}if(count<rule.quota)shortages.push({stratum:rule.stratum,wanted:rule.quota,selected:count,missing:rule.quota-count});}
  return immutableCopy({schema:'prospective-pilot-selection-plan-v1',status:missing.length||protectedMandatory.length||shortages.length?'HELD_INCOMPLETE_PLAN':'PROSPECTIVE_METADATA_PLAN_NOT_EXECUTION_AUTHORITY',policy:SAMPLING_POLICY,source_kind:control?'DECLARED_SYNTHETIC_CONTROL':'PROSPECTIVE_ACTUAL_DEVELOPMENT',pool_sha256:digest(pool),fresh_guard_sha256:guard.projection_sha256,mandatory_ids_in_supplied_frozen_order:mandatoryAuditIds,mandatory,additional:extras,missing_mandatory:missing,protected_mandatory:protectedMandatory,shortages,protected_before_draw:protectedBeforeDraw,nominal_denominator:69,planned_denominator:mandatory.length+extras.length,failures_replaced:false,raw_opened:false,actual_selection_executed:!control,authority:'NONE'});
}

// SPDX-License-Identifier: AGPL-3.0-only
// Actual metadata worker route; no loader/adapter/tracer/meter/runtime imports.
import {digest} from '../../finite-codec.mjs';
import {contextOf} from './admission.mjs';
import {initializedScope} from './control.mjs';
import {deriveDevelopmentMetadata,freezeSelection} from './projector.mjs';
import {writeMetadata} from './output-io.mjs';
export async function runMetadataWorker(permit){
  const c=contextOf(permit),scope=initializedScope(permit),projection=await deriveDevelopmentMetadata(c.input_root,c.bindings,{permit,mandatoryAuditIds:scope.mandatory_audit_ids,rosterRef:c.roster_ref,sourceEpochSHA256:c.source_epoch_sha256});
  if(digest(projection.freshGuard)!==digest(scope.freshGuard)||digest(projection.completeFreshProof)!==digest(scope.completeFreshProof))throw Error('EXECUTOR_PREFLIGHT_CHANGED');
  const outputs=[await writeMetadata(permit,'metadata-projection.json',projection)];let freeze;try{freeze=freezeSelection(projection,scope.mandatory_audit_ids);}catch(e){const body={schema:'typed-focal-prospective69-freeze-v2',status:'HELD_INCOMPLETE_METADATA_NO_DRAW',nominal_denominator:69,ordered:[],mandatory_ids:scope.mandatory_audit_ids,metadata_projection_sha256:projection.sha256,failures_replaced:false,raw_opened:false,authority:'NONE',code:/^[A-Z0-9_]+$/u.test(e.code??'')?e.code:'EXECUTOR_SELECTION_HELD'};freeze={...body,sha256:digest(body)};}outputs.push(await writeMetadata(permit,'ordered69-freeze.json',freeze));
  const failed=new Set((projection.failures??[]).map(r=>r.audit_id)),processed=new Set([...projection.rows,...projection.ineligible_rows,...projection.protected_rows].map(r=>r.audit_id)),completed_ids=scope.expected_ids.filter(id=>processed.has(id)&&!failed.has(id)),failed_ids=scope.expected_ids.filter(id=>failed.has(id)),remaining_ids=scope.expected_ids.filter(id=>!processed.has(id)&&!failed.has(id));
  const status=projection.status==='COMPLETE_METADATA_PROJECTION_NOT_SOURCE_READING'&&freeze.status==='ORDERED69_METADATA_FROZEN_NOT_SOURCE_AUTHORIZATION'&&freeze.ordered.length===69&&!failed_ids.length&&!remaining_ids.length?'COMPLETE':'HELD',summary={schema:'metadata-execution-phaseA-summary-v1',status,original_denominator:200,nominal_source_denominator:69,completed_ids,failed_ids,remaining_ids,preflight_sha256:scope.sha256,metadata_projection_sha256:projection.sha256,ordered69_sha256:freeze.sha256,total_calls:0,raw_originals_opened:false,new_tracer_used:false,actual_metadata_execution:!c.fixture,manual_source_reading:false,source_quality_pass:false,source_or_native_qualification:false,authority:'NONE'};outputs.push(await writeMetadata(permit,'summary.json',summary));return{status,total_calls:0,completed_ids,failed_ids,remaining_ids,output_refs:outputs};
}

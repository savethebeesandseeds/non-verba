// SPDX-License-Identifier: AGPL-3.0-only
// Metadata phase ONLY: never imports loader, adapter, tracer, meter or runtime.
import {digest} from '../../finite-codec.mjs';
import {contextOf,fail} from './admission.mjs';
import {permitForInit,initializedScope} from './control.mjs';
import {deriveDevelopmentMetadata,freezeSelection} from './projector.mjs';
import {writeFictionalMetadata,outputSnapshot} from './output-io.mjs';
export async function runFictionalMetadataDriver(init){
  const permit=permitForInit(init),scope=initializedScope(permit),c=contextOf(permit);if(init.tokenizer_call_allowance!==0||init.stream_ids.length)fail('METADATA_NO_TOKENIZER');
  const projection=await deriveDevelopmentMetadata(c.input_root,c.bindings,{permit,mandatoryAuditIds:scope.mandatory_audit_ids,rosterRef:c.roster_ref,sourceEpochSHA256:c.source_epoch_sha256});
  if(digest(projection.freshGuard)!==digest(scope.freshGuard)||digest(projection.completeFreshProof)!==digest(scope.completeFreshProof))fail('METADATA_PREFLIGHT_GUARD_CHANGED');
  await writeFictionalMetadata(permit,scope,'metadata-projection.json',projection);
  let freeze;try{freeze=freezeSelection(projection,scope.mandatory_audit_ids);}catch(error){const body={schema:'typed-focal-prospective69-freeze-v2',status:'HELD_INCOMPLETE_METADATA_NO_DRAW',nominal_denominator:69,ordered:[],mandatory_ids:scope.mandatory_audit_ids,metadata_projection_sha256:projection.sha256,failures_replaced:false,raw_opened:false,authority:'NONE',code:/^[A-Z0-9_]+$/u.test(error.code??'')?error.code:'METADATA_SELECTION_HELD'};freeze={...body,sha256:digest(body)};}
  await writeFictionalMetadata(permit,scope,'ordered69-freeze.json',freeze);
  const failed=new Set((projection.failures??[]).map(r=>r.audit_id)),processed=new Set([...projection.rows,...projection.ineligible_rows,...projection.protected_rows].map(r=>r.audit_id)),completed_ids=scope.expected_ids.filter(id=>processed.has(id)&&!failed.has(id)),failed_ids=scope.expected_ids.filter(id=>failed.has(id)),remaining_ids=scope.expected_ids.filter(id=>!processed.has(id)&&!failed.has(id));
  if(completed_ids.length+failed_ids.length+remaining_ids.length!==200)fail('METADATA_ORIGINAL200_PARTITION');
  const summary={schema:'metadata-selection-fictional-summary-v1',status:projection.status==='COMPLETE_METADATA_PROJECTION_NOT_SOURCE_READING'&&freeze.status==='ORDERED69_METADATA_FROZEN_NOT_SOURCE_AUTHORIZATION'&&!failed_ids.length&&!remaining_ids.length?'COMPLETE_FICTIONAL_METADATA_ONLY':'HELD_FICTIONAL_METADATA_ONLY',original_denominator:200,source_pilot_denominator:69,completed_ids,failed_ids,remaining_ids,preflight_sha256:scope.sha256,metadata_projection_sha256:projection.sha256,ordered69_sha256:freeze.sha256,total_calls:0,raw_originals_opened:false,actual_execution:false,manual_source_reading:false,source_quality_pass:false,authority:'NONE'};
  await writeFictionalMetadata(permit,scope,'summary.json',summary);return Object.freeze({summary,projection,freeze,outputs:outputSnapshot(permit)});
}

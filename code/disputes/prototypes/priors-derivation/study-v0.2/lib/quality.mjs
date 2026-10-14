// SPDX-License-Identifier: AGPL-3.0-only
// Structural admission for an actual authored fresh review, not its automation.
import {readJSON,digest,sha256,within,requireContainer} from '../../lib/common.mjs';
import {readFile} from 'node:fs/promises';
import {studyPath,hashFile,readRows} from './store.mjs';
import {atomicJSON,extractionSourceIdentity} from './workflow.mjs';
import {auditPurpose} from './audit.mjs';
import {assertNoUnresolvedSourceIssues} from './source-issues.mjs';
export function assessFreshReview(packet,review,{target=100,adequacyTarget=.95}={}) {
  const ids=packet.rows.map(row=>row.audit_id??row.id);if(ids.length!==target||new Set(ids).size!==ids.length)throw new Error('Fresh packet must contain the declared unique target');
  if(packet.rows.some(row=>typeof row.parent?.id!=='string')||new Set(packet.rows.map(row=>row.parent.id)).size!==target)throw new Error('Fresh reconstructed section denominator requires unique parent sections');
  if(packet.purpose!=='fresh_representation'||review.purpose!=='fresh_representation'||!review.reviewer||!Array.isArray(review.judgments)||review.judgments.length!==target)throw new Error('Actual fresh representation review coverage required');
  const expected=new Set(ids);let adequate=0,losses=0;const readModes=new Set(['FULL_PARENT_AND_SOURCE','FULL_PARENT_AND_RELEVANT_SOURCE']);
  for(const row of review.judgments){if(!expected.delete(row.audit_id)||typeof row.context_adequate!=='boolean'||typeof row.heading_adequate!=='boolean'||typeof row.material_loss_observed!=='boolean'||typeof row.unresolved_material_loss!=='boolean'||typeof row.reason!=='string'||row.reason.trim().length<10||!readModes.has(row.reading))throw new Error('Fresh judgment missing actual source reading, identity or explicit decision');if(row.context_adequate&&row.heading_adequate)adequate++;if(row.unresolved_material_loss)losses++;}
  return {target,reviewed:target,adequate,adequacy_rate:adequate/target,unresolved_material_losses:losses,gate_passed:adequate/target>=adequacyTarget&&losses===0,interpretation:'Authored agent source review; no human/participant/legal validation or external execution attestation.'};
}
export function assessSupportingReview(packet,review,{purpose,target}={}){
  const ids=new Set(packet.rows.map(row=>row.audit_id));if(packet.purpose!==purpose||review.purpose!==purpose||review.status!=='REVIEWED'||!review.reviewer||packet.rows.length!==target||ids.size!==target||!Array.isArray(review.judgments)||review.judgments.length!==target)throw new Error('Complete authored supporting review required');
  for(const row of review.judgments){if(!ids.delete(row.audit_id)||!['FULL_PARENT_AND_SOURCE','FULL_PARENT_AND_RELEVANT_SOURCE','ORIGINAL_MARKUP_AND_RETAINED_TEXT'].includes(row.reading)||typeof row.reason!=='string'||row.reason.trim().length<10||row.unresolved_material_loss!==false||purpose==='source_integrity'&&row.exclusion_supported!==true)throw new Error('Supporting review lacks unique actual reading or unresolved loss');}
  return {reviewed:target,status:'REVIEWED',purpose};
}
export function assessCalibrationCoverage(extraction,selected,{target=1000}={}){
  if(selected.length!==target||new Set(selected.map(row=>row.id)).size!==target||extraction.scope!==`calibration-${target}`||extraction.requested_contracts!==target||extraction.eligible_prefix_contracts!==target||extraction.selected_prefix_terminal_complete!==true)throw new Error('Calibration gate requires the complete frozen calibration selection');
  const expected=new Map(selected.map(row=>[row.id,row])),seen=new Set(),records=extraction.contract_records??[],missing=extraction.missing_contracts??[];
  for(const row of [...records,...missing]){if(!expected.has(row.id)||seen.has(row.id)||row.cohort!==expected.get(row.id).cohort)throw new Error('Calibration coverage has duplicate, unknown or wrong-cohort records');seen.add(row.id);}
  if(seen.size!==target||records.length!==extraction.contracts||extraction.accepted+extraction.rejected!==records.length||missing.some(row=>row.acquisition_status!=='TERMINAL_DOWNLOAD_FAILURE'))throw new Error('Calibration shortages must be explicit terminal failures, never pending records');
  if(records.some(row=>!['accepted','rejected'].includes(row.status))||records.filter(row=>row.status==='accepted').length!==extraction.accepted||records.filter(row=>row.status==='rejected').length!==extraction.rejected)throw new Error('Calibration acceptance counts differ from individual source statuses');
  const status=extraction.terminal_selection_status;if(!status||status.declared_prefix!==target||status.raw_committed!==records.length||status.raw_processed!==records.length||status.terminal_download_failures!==missing.length||status.pending_or_unattempted!==0)throw new Error('Calibration terminal accounting differs from retained coverage');
  return {selected:target,processed:records.length,accepted:extraction.accepted,rejected:extraction.rejected,terminal_failures:missing.length};
}
async function requireCalibrationCoverage(runDir,extraction){const {verifyStudy}=await import('./acquisition.mjs');const {study,recipe}=await verifyStudy(runDir);const selected=[];for await(const row of readRows(runDir,study.selection.path))if(row.calibration&&row.cohort.startsWith('discovery-'))selected.push(row);if(recipe.calibration.contracts!==1000)throw new Error('This quality gate requires the declared 1000-contract study calibration');if(extraction.input_snapshot?.selection_sha256!==study.selection.sha256||extraction.input_snapshot?.recipe_sha256!==study.recipe_file.sha256)throw new Error('Calibration input does not bind the frozen selection and recipe');return assessCalibrationCoverage(extraction,selected);}

async function verifyAuditPacket(runDir,packet,extraction,extractionPath,{purpose}={}){
  const source=packet.source;if(packet.purpose!==purpose||!source)throw new Error('Expected source-bound audit purpose');const {sha256:claimed,...body}=source;if(claimed!==digest(body))throw new Error('Audit source identity checksum differs');
  const binding=await hashFile(await studyPath(runDir,extractionPath));if(source.input_manifest?.path!==extractionPath||source.input_manifest.sha256!==binding.sha256||source.input_manifest.bytes!==binding.bytes||source.extraction_source?.sha256!==extraction.source.sha256)throw new Error('Audit input is not the exact calibration extraction');
  const recipe=await readJSON(await studyPath(runDir,'recipe.json'));if(source.seed!==`${recipe.seed}:audit-v1`)throw new Error('Audit purpose seed differs from the predeclared recipe');
  let protocol=null;if(source.protocol){const retained=await hashFile(await studyPath(runDir,source.protocol.path));if(retained.sha256!==source.protocol.sha256||retained.bytes!==source.protocol.bytes)throw new Error('Predeclared audit protocol changed');protocol=await readJSON(await studyPath(runDir,source.protocol.path));if(protocol.status!=='PREDECLARED_FRESH_REPAIR_AUDIT'||protocol.fresh_scope!=='ACCEPTED_RECONSTRUCTABLE_SOURCE'||!Array.isArray(protocol.excluded_contract_ids))throw new Error('Expected declared fresh repair scope');}
  const excluded=new Set(protocol?.excluded_contract_ids??[]),receipts=new Map((extraction.cache??[]).map(row=>[row.id,row])),records=new Map(extraction.contract_records.map(row=>[row.id,row]));
  const verifiedFiles=new Map();
  const checkFile=async(path,expected,bytes)=>{let actual=verifiedFiles.get(path);if(!actual){actual=await hashFile(await studyPath(runDir,path));verifiedFiles.set(path,actual);}if(actual.sha256!==expected||bytes!==undefined&&actual.bytes!==bytes)throw new Error('Reviewed raw, normalized or cache evidence changed');};
  for(const row of packet.rows){
    const item=receipts.get(row.contract_id),record=records.get(row.contract_id);
    if(!item||!record||row.lineage?.cache_path!==item.path||row.lineage.cache_sha256!==item.sha256||row.lineage.raw_sha256!==record.raw_sha256||row.lineage.cohort!==record.cohort)throw new Error('Audit row differs from its actual extracted source');
    if(['development','fresh_representation'].includes(purpose)&&auditPurpose(row.contract_id,{seed:source.seed})!==purpose)throw new Error('Audit row crosses its predeclared contract-disjoint purpose pool');
    if(purpose==='fresh_representation'&&(record.status!=='accepted'||excluded.has(row.contract_id)))throw new Error('Fresh source is rejected or previously exposed');
    await checkFile(item.path,item.sha256,item.bytes);const cached=await readJSON(await studyPath(runDir,item.path));
    if(cached.contract?.id!==row.contract_id||cached.contract.path!==row.lineage.raw_path||cached.raw_sha256!==record.raw_sha256||sha256(cached.normalized_text)!==cached.normalized_sha256)throw new Error('Audit cache raw or normalized lineage differs');
    await checkFile(row.lineage.raw_path,record.raw_sha256);
    if(record.normalized_path){if(row.lineage.normalized_path!==record.normalized_path||row.lineage.normalized_sha256!==record.normalized_sha256||cached.normalized_sha256!==record.normalized_sha256)throw new Error('Audit normalized file lineage differs');await checkFile(record.normalized_path,record.normalized_sha256);}
    const parent=cached.sections.find(value=>value.id===row.parent?.id);
    if(purpose!=='fresh_representation'&&record.status==='rejected'&&row.parent?.cache_pointer==='/normalized_text'){if(row.parent.start!==0||row.parent.end!==cached.normalized_text.length||row.parent.sha256!==cached.normalized_sha256)throw new Error('Rejected document anchor differs');}
    else if(!parent||parent.start!==row.parent.start||parent.end!==row.parent.end||parent.sha256!==row.parent.sha256||sha256(cached.normalized_text.slice(parent.start,parent.end))!==parent.sha256)throw new Error('Audit parent ID or source boundary differs from actual cache');
  }
  if(purpose==='source_integrity'){const rejected=extraction.contract_records.filter(row=>row.status==='rejected').map(row=>row.id).sort(),actual=packet.rows.map(row=>row.contract_id).sort();if(digest(actual)!==digest(rejected))throw new Error('Integrity controls must cover every distinct rejected contract exactly once');}
  return {protocol};
}

/** Read-only expansion gate, before any request outside frozen calibration IDs. */
export async function verifyCalibrationGate(runDir,{recipe}={}){
  requireContainer();recipe=recipe??await readJSON(await studyPath(runDir,'recipe.json'));
  let source;try{source=await extractionSourceIdentity(recipe);}catch(error){throw new Error(`CALIBRATION_GATE_NOT_PASSED: current extraction identity is not established (${error.message})`);}
  await assertNoUnresolvedSourceIssues(runDir,source.sha256);
  const gatePath=`quality-gates/${source.sha256}/gate.json`;let gate;
  try{gate=await readJSON(await studyPath(runDir,gatePath));}catch(error){if(error.code==='ENOENT')throw new Error('CALIBRATION_GATE_NOT_PASSED: preserve the calibration boundary until the current source version passes authored review');throw error;}
  if(gate.status!=='CALIBRATION_GATE_PASSED'||gate.authority!=='NONE'||gate.extraction_source_sha256!==source.sha256)throw new Error('CALIBRATION_GATE_NOT_PASSED: current source gate differs');
  const required=[[gate.calibration_extraction_manifest_path,gate.calibration_extraction_manifest_sha256],[gate.fresh_packet_path,gate.fresh_packet_sha256],[gate.fresh_audit?.review_path,gate.fresh_audit?.review_sha256],[gate.development_audit_review_path,gate.development_audit_review_sha256]];
  if(gate.source_integrity?.reviewed){required.push([gate.source_integrity.packet_path,gate.source_integrity.packet_sha256],[gate.source_integrity.review_path,gate.source_integrity.review_sha256]);}
  for(const [path,expected] of required){if(typeof path!=='string'||!expected||(await hashFile(await studyPath(runDir,path))).sha256!==expected)throw new Error('CALIBRATION_GATE_NOT_PASSED: bound review artifact differs');}
  const extraction=await readJSON(await studyPath(runDir,gate.calibration_extraction_manifest_path));await requireCalibrationCoverage(runDir,extraction);if(extraction.source?.sha256!==source.sha256)throw new Error('CALIBRATION_GATE_NOT_PASSED: extraction source differs from current methods');
  const packet=await readJSON(await studyPath(runDir,gate.fresh_packet_path)),review=await readJSON(await studyPath(runDir,gate.fresh_audit.review_path));
  await verifyAuditPacket(runDir,packet,extraction,gate.calibration_extraction_manifest_path,{purpose:'fresh_representation'});
  const metrics=assessFreshReview(packet,review,{target:100,adequacyTarget:recipe.calibration.adequacyTarget});if(!metrics.gate_passed||packet.source?.extraction_source?.sha256!==source.sha256)throw new Error('CALIBRATION_GATE_NOT_PASSED: actual fresh review does not pass');
  const development=await readJSON(await studyPath(runDir,gate.development_audit_review_path));if(development.extraction_source_sha256!==source.sha256||development.packet_sha256!==(await hashFile(await studyPath(runDir,development.packet_path))).sha256)throw new Error('CALIBRATION_GATE_NOT_PASSED: development source or packet differs');const developmentPacket=await readJSON(await studyPath(runDir,development.packet_path));await verifyAuditPacket(runDir,developmentPacket,extraction,gate.calibration_extraction_manifest_path,{purpose:'development'});assessSupportingReview(developmentPacket,development,{purpose:'development',target:200});
  if((packet.source.protocol||extraction.rejected)&&(!gate.source_integrity||gate.source_integrity.reviewed!==extraction.rejected))throw new Error('CALIBRATION_GATE_NOT_PASSED: complete rejection controls are absent');
  if(gate.source_integrity?.reviewed){const integrity=await readJSON(await studyPath(runDir,gate.source_integrity.packet_path)),authored=await readJSON(await studyPath(runDir,gate.source_integrity.review_path));if(authored.packet_sha256!==gate.source_integrity.packet_sha256||authored.extraction_source_sha256!==source.sha256)throw new Error('CALIBRATION_GATE_NOT_PASSED: integrity source differs');await verifyAuditPacket(runDir,integrity,extraction,gate.calibration_extraction_manifest_path,{purpose:'source_integrity'});assessSupportingReview(integrity,authored,{purpose:'source_integrity',target:integrity.count});}
  return {status:'CALIBRATION_GATE_PASSED',path:gatePath,source_sha256:source.sha256,...await hashFile(await studyPath(runDir,gatePath))};
}
export async function sealQualityGate(runDir,{extractionPath,packetPath,reviewPath,developmentReviewPath,integrityReviewPath}={}) {
  requireContainer();const extraction=await readJSON(await studyPath(runDir,extractionPath));const packet=await readJSON(await studyPath(runDir,packetPath));const review=await readJSON(await studyPath(runDir,reviewPath));const development=await readJSON(await studyPath(runDir,developmentReviewPath));
  const recipe=await readJSON(await studyPath(runDir,'recipe.json'));const metrics=assessFreshReview(packet,review,{target:recipe.calibration.representationAudit-200,adequacyTarget:recipe.calibration.adequacyTarget});
  const coverage=await requireCalibrationCoverage(runDir,extraction);if((await extractionSourceIdentity(recipe)).sha256!==extraction.source.sha256)throw new Error('Calibration review source differs from the current extraction methods');
  const observed_source_issues=await assertNoUnresolvedSourceIssues(runDir,extraction.source.sha256);
  if(review.extraction_source_sha256!==extraction.source.sha256)throw new Error('Fresh review must declare its actual extraction source');
  if(extraction.rejected&&!packet.source?.protocol)throw new Error('Rejected sources require a declared full integrity-control protocol');
  await verifyAuditPacket(runDir,packet,extraction,extractionPath,{purpose:'fresh_representation'});
  if(extraction.scope!=='calibration-1000'||extraction.contracts<1||packet.source?.extraction_source?.sha256!==extraction.source.sha256||review.packet_sha256!==(await hashFile(await studyPath(runDir,packetPath))).sha256||development.extraction_source_sha256!==extraction.source.sha256||development.purpose!=='development'||development.status!=='REVIEWED'||!Array.isArray(development.judgments)||development.judgments.length!==200||development.judgments.some(row=>row.unresolved_material_loss!==false))throw new Error('Calibration/source-bound development and fresh reviews required');
  const developmentPacket=await readJSON(await studyPath(runDir,development.packet_path));if(development.packet_sha256!==(await hashFile(await studyPath(runDir,development.packet_path))).sha256||developmentPacket.source?.extraction_source?.sha256!==extraction.source.sha256)throw new Error('Development packet byte/source binding required');await verifyAuditPacket(runDir,developmentPacket,extraction,extractionPath,{purpose:'development'});assessSupportingReview(developmentPacket,development,{purpose:'development',target:200});
  let integrity=null;
  if(packet.source.protocol){
    const integrityPacketPath=packetPath.replace(/[^/]+$/,'source_integrity.json'),integrityPacket=await readJSON(await studyPath(runDir,integrityPacketPath));
    if(integrityPacket.source?.sha256!==packet.source.sha256||integrityPacket.rows.length!==extraction.rejected)throw new Error('Every rejected source requires an integrity control');await verifyAuditPacket(runDir,integrityPacket,extraction,extractionPath,{purpose:'source_integrity'});
    if(integrityPacket.count){const authored=await readJSON(await studyPath(runDir,integrityReviewPath));if(authored.packet_sha256!==(await hashFile(await studyPath(runDir,integrityPacketPath))).sha256||authored.extraction_source_sha256!==extraction.source.sha256)throw new Error('Source integrity review byte/source binding required');assessSupportingReview(integrityPacket,authored,{purpose:'source_integrity',target:integrityPacket.count});integrity={packet_path:integrityPacketPath,packet_sha256:(await hashFile(await studyPath(runDir,integrityPacketPath))).sha256,review_path:integrityReviewPath,review_sha256:(await hashFile(await studyPath(runDir,integrityReviewPath))).sha256,reviewed:integrityPacket.count};}
    else integrity={packet_path:integrityPacketPath,reviewed:0,status:'NO_REJECTED_SOURCES'};
  }
  const records={calibration_extraction_manifest_path:extractionPath,calibration_extraction_manifest_sha256:(await hashFile(await studyPath(runDir,extractionPath))).sha256,fresh_packet_path:packetPath,fresh_packet_sha256:(await hashFile(await studyPath(runDir,packetPath))).sha256,fresh_review_path:reviewPath,development_review_path:developmentReviewPath};
  const fresh_audit={...metrics,review_path:reviewPath,review_sha256:(await hashFile(await studyPath(runDir,reviewPath))).sha256};
  const gate={schema_version:2,status:metrics.gate_passed?'CALIBRATION_GATE_PASSED':'CALIBRATION_GATE_FAILED',extraction_source_sha256:extraction.source.sha256,coverage,observed_source_issues,...records,fresh_audit,development_audit_review_path:developmentReviewPath,development_audit_review_sha256:(await hashFile(await studyPath(runDir,developmentReviewPath))).sha256,...(integrity?{source_integrity:integrity}:{}),authority:'NONE',participant_evaluation:'NOT_RUN',execution_attested:false};
  const path=`quality-gates/${extraction.source.sha256}/${metrics.gate_passed?'gate':`failed-${digest(gate).slice(0,16)}`}.json`;await atomicJSON(within(runDir,path),gate);return {...gate,manifest_path:path};
}

// SPDX-License-Identifier: AGPL-3.0-only
// Versioned actual repair orchestration. Source review is never generated here.
import {readFile} from 'node:fs/promises';
import {requireContainer,sha256} from '../../lib/common.mjs';
import {validateStudyRoot,studyPath,readJSON,hashFile} from '../lib/store.mjs';
import {atomicJSON,extractStudy} from '../lib/workflow.mjs';
import {freezeMainUnitBudget} from '../lib/budget.mjs';
import {verifyNoveltyPlan} from '../lib/novelty.mjs';
import {buildAuditPackets} from '../lib/audit.mjs';
import {prepareDiscovery} from '../lib/admission.mjs';
requireContainer();const run=validateStudyRoot(process.argv[2]),version=process.argv[3];
if(!/^v[1-9][0-9]*$/.test(version??''))throw new Error('Explicit authored repair version required');
const configBytes=await readFile(new URL(`../calibration-repairs/${version}.json`,import.meta.url));
const config=JSON.parse(configBytes),previous=await readJSON(run,config.previous_protocol);
if(config.id!==`repair-${version}`||config.authority!=='NONE'||previous.status!=='PREDECLARED_FRESH_REPAIR_AUDIT')throw new Error('Expected declared versioned calibration repair');
const ids=new Set([...previous.excluded_contract_ids,...config.additional_source_diagnostic_contracts]);
const records=[{path:config.previous_protocol,...await hashFile(await studyPath(run,config.previous_protocol))}];
for(const item of config.new_exposure_artifacts){const actual=await hashFile(await studyPath(run,item.path));if(actual.sha256!==item.sha256)throw new Error('Actual failed review exposure bytes changed');const record=await readJSON(run,item.path);const exposed=record[item.exposure_field];if(!Array.isArray(exposed)||exposed.some(id=>typeof id!=='string'||!id))throw new Error('Actual exposure record lacks declared source IDs');for(const id of exposed)ids.add(id);records.push({path:item.path,...actual});}
for(const item of config.additional_evidence_records??[]){const actual=await hashFile(await studyPath(run,item.path));if(actual.sha256!==item.sha256)throw new Error('Diagnostic exposure evidence bytes changed');records.push({path:item.path,...actual});}
const exposurePath=`audit-protocols/${config.id}/exposure.json`;
const exposure={schema_version:2,status:'DECLARED_SOURCE_EXPOSURES',source_exposed_contract_ids:[...ids].sort(),source_records:records,diagnostic_contracts:config.additional_source_diagnostic_contracts,unknown_other_exposure:'UNKNOWN',authority:'NONE'};
await atomicJSON(await studyPath(run,exposurePath,{missing:true}),exposure);
const protocol={...previous,excluded_contract_ids:[...ids].sort(),exposure_records:[...previous.exposure_records,{path:exposurePath,...await hashFile(await studyPath(run,exposurePath))}],repair:{id:config.id,source_config_sha256:sha256(configBytes),reason:config.reason},fresh_unique_parent_sections:true};
const protocolPath=`audit-protocols/${config.id}/protocol.json`;
await atomicJSON(await studyPath(run,protocolPath,{missing:true}),protocol);
await freezeMainUnitBudget(run);await verifyNoveltyPlan(run);
const extraction=await extractStudy(run,{limit:1000,calibrationOnly:true});
const audits=await buildAuditPackets(run,extraction,{protocolPath});
const admission=await prepareDiscovery(run,extraction);
const summary={schema_version:2,status:'REPAIR_CALIBRATION_PREPARED_REVIEW_NOT_RUN',authority:'NONE',repair_id:config.id,script_sha256:sha256(await readFile(new URL(import.meta.url))),source_config_sha256:sha256(configBytes),protocol:{path:protocolPath,...await hashFile(await studyPath(run,protocolPath))},extraction:{path:extraction.manifest_path,source_sha256:extraction.source.sha256,contracts:extraction.contracts,accepted:extraction.accepted,rejected:extraction.rejected,sections:extraction.sections,selected_units:extraction.selected_units,terminal_selection_status:extraction.terminal_selection_status},audits:{path:audits.manifest_path,packets:audits.packets},admission:{path:admission.manifest_path,counts:admission.counts,memory:admission.memory},participant_evaluation:'NOT_RUN'};
const path=`calibration-${config.id}-${extraction.source.sha256.slice(0,16)}-${audits.source.sha256.slice(0,12)}.json`;
await atomicJSON(await studyPath(run,path,{missing:true}),summary);console.log(JSON.stringify({...summary,summary_path:path},null,2));

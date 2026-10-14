// SPDX-License-Identifier: AGPL-3.0-only
// Actual repair attempt orchestration; this never fabricates a source review.
import {readFile} from 'node:fs/promises';
import {requireContainer,sha256} from '../../lib/common.mjs';
import {validateStudyRoot,studyPath,readJSON,hashFile} from '../lib/store.mjs';
import {atomicJSON,extractStudy} from '../lib/workflow.mjs';
import {freezeMainUnitBudget} from '../lib/budget.mjs';
import {buildAuditPackets} from '../lib/audit.mjs';
import {prepareDiscovery} from '../lib/admission.mjs';
requireContainer();const run=validateStudyRoot(process.argv[2]);
const earlierA='audits/e60e50a66f63f3755dae/fresh-review-a.failed-partial.json';
const earlierB='coding/open-coding-b/reading-status-500.json';
const a=await readJSON(run,earlierA),b=await readJSON(run,earlierB);
if((await hashFile(await studyPath(run,earlierA))).sha256!=='303d0a97cb8b7943a806d15a3cd243bd1a38a2b7318076b3bbca2401bb4d01d5')throw new Error('Earlier actual failure record differs');
const diagnosticIds=['contract-c91c2c7d25a162c4e655','contract-f4c4967a55b179a597aa','contract-2e4a98a83fde16a04154','contract-49b5a8c61152ddafe21e','contract-d76e9f561397645f36fa','contract-f8af8531d81ef6b03175','contract-ca391ae29a0bbe541b4e','contract-b04f803958dcf0d9e515','contract-6949aa43570cdccef279','contract-0690ec0a5f3f4ade578b','contract-a1468528da8e55948b26','contract-22ffac27c5244c2f58c3','contract-23f05d83d1e2a578193a','contract-6cc01041e297cbdd6ae6','contract-5128b0b3b4169020fa9d','contract-7a0f60bb9c354b54a8b2','contract-c07dc12c0ca8cbffea62','contract-6351e45ee40805f6781e'];
const bIds=b.rows.filter(row=>row.reading_status?.startsWith('FULL_REFERENCED_PARENT')||row.technical_context_only===true).map(row=>row.contract_id);
const ids=[...new Set([...a.source_exposed_contract_ids,...bIds,...diagnosticIds,'contract-747eb57b22605a753170','contract-01d80bfe2e71046d8b3e'])].sort();
const sourceRecords=await Promise.all([earlierA,earlierB].map(async path=>({path,...await hashFile(await studyPath(run,path))})));
const exposure={schema_version:2,status:'DECLARED_SOURCE_EXPOSURES',source_exposed_contract_ids:ids,source_records:sourceRecords,additional_diagnostic_ids:diagnosticIds,diagnostic_author:'Extractor author actual-source replay,18 contracts; root engineering inspection,2 contracts',unknown_other_exposure:'UNKNOWN',authority:'NONE'};
const exposurePath='audit-protocols/repair-v5/exposure.json';await atomicJSON(await studyPath(run,exposurePath,{missing:true}),exposure);
const protocol={schema_version:2,status:'PREDECLARED_FRESH_REPAIR_AUDIT',fresh_scope:'ACCEPTED_RECONSTRUCTABLE_SOURCE',rejection_controls:'ALL_REJECTED_SOURCES',purpose_assignment:'Unchanged recipe.seed:audit-v1 purpose pools; no redistribution',excluded_contract_ids:ids,exposure_records:[{path:exposurePath,...await hashFile(await studyPath(run,exposurePath))}],fresh_count:100,development_count:200,adequacy_target:.95,zero_unresolved_material_loss:true,denominator:'100 reconstructed-source sections; distinct contracts and within-contract correlation reported. Correct rejections are separate controls.',previous_failed_review:sourceRecords[0],authority:'NONE',human_or_participant_review:false};
const protocolPath='audit-protocols/repair-v5/protocol.json';await atomicJSON(await studyPath(run,protocolPath,{missing:true}),protocol);
await freezeMainUnitBudget(run);
const extraction=await extractStudy(run,{limit:1000,calibrationOnly:true});
const audits=await buildAuditPackets(run,extraction,{protocolPath});
const admission=await prepareDiscovery(run,extraction);
const summary={schema_version:2,status:'CALIBRATION_PREPARED_REVIEW_NOT_RUN',authority:'NONE',script_sha256:sha256(await readFile(new URL(import.meta.url))),protocol:{path:protocolPath,...await hashFile(await studyPath(run,protocolPath))},extraction:{path:extraction.manifest_path,source_sha256:extraction.source.sha256,contracts:extraction.contracts,accepted:extraction.accepted,rejected:extraction.rejected,sections:extraction.sections,selected_units:extraction.selected_units,terminal_selection_status:extraction.terminal_selection_status},audits:{path:audits.manifest_path,packets:audits.packets},admission:{path:admission.manifest_path,counts:admission.counts,memory:admission.memory},participants:'NOT_RUN'};
await atomicJSON(await studyPath(run,`calibration-v5-${extraction.source.sha256.slice(0,16)}-${audits.source.sha256.slice(0,12)}.json`,{missing:true}),summary);console.log(JSON.stringify(summary,null,2));

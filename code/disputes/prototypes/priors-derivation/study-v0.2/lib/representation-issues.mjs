// SPDX-License-Identifier: AGPL-3.0-only
// Partial model-input findings are distinct from full-parent/source loss claims.
import {readFile,readdir} from 'node:fs/promises';
import {digest,sha256,requireContainer} from '../../lib/common.mjs';
import {hashFile,readJSON,studyPath,writeJSON} from './store.mjs';

const HEX=/^[a-f0-9]{64}$/u;
const DIRECTORY='representation-issues/observed';
const NAME=/^issue-[a-f0-9]{64}\.json$/u;
const SCOPE='DECLARED_ACTUAL_COMPONENT_OUTPUTS_ONLY';
function hash(value){if(!HEX.test(value??''))throw new Error('Explicit representation issue SHA-256 required');return value;}
async function bound(run,ref,{json=true,maxBytes=16*1024**2}={}){
  if(typeof ref?.path!=='string'||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>maxBytes)throw new Error('Exact bounded representation issue path/hash/bytes required');
  const actual=await hashFile(await studyPath(run,ref.path));
  if(actual.sha256!==hash(ref.sha256)||actual.bytes!==ref.bytes)throw new Error('Representation issue artifact binding differs');
  return json?await readJSON(run,ref.path,{maxBytes}):null;
}

/** Fixed historical codec specification, not executable QA helper code. Every
 * displayed byte must cover the complete dictionary, which reconstructs the
 * exact canonical bundle and its separately retained full projections. */
export async function verifyHistoricalRepresentationDisplay(run,indexRef){
  const index=await bound(run,indexRef),bundle=await bound(run,index.bundle,{maxBytes:128*1024**2});
  if(index.schema!=='v13-prepared-page-index-v1'||index.status!=='MACHINE_PREPARED_NOT_TOOL_DISPLAYED'||index.actual_reading!==false||!Array.isArray(index.pages)||!index.pages.length||index.pages.length>10000||bundle.schema!=='v13-native-current-model-sourceparts-machine-bundle-v1'||bundle.actual_reading!==false||bundle.audit_id!==index.audit_id||digest(bundle)!==index.bundle_canonical_sha256)throw new Error('Historical prepared display/bundle schema differs');
  await bound(run,index.lossless_display,{json:false,maxBytes:128*1024**2});const display=await readFile(await studyPath(run,index.lossless_display.path),'utf8'),encoding=JSON.parse(display);
  if(encoding.schema!=='lossless-recursive-shared-object-dictionary-v1'||!encoding.dictionary||Array.isArray(encoding.dictionary)||index.lossless_dictionary?.verified!==true||index.lossless_dictionary.entries!==Object.keys(encoding.dictionary).length||index.lossless_dictionary.roundtrip_sha256!==digest(bundle))throw new Error('Historical lossless dictionary differs');
  const visiting=new Set();function equals(encoded,actual){if(encoded&&typeof encoded==='object'&&!Array.isArray(encoded)&&Object.keys(encoded).length===1&&typeof encoded.$ref==='string'){if(visiting.has(encoded.$ref)||!Object.hasOwn(encoding.dictionary,encoded.$ref))throw new Error('Historical dictionary cycle or missing reference');visiting.add(encoded.$ref);equals(encoding.dictionary[encoded.$ref],actual);visiting.delete(encoded.$ref);return;}if(encoded&&typeof encoded==='object'){if(!actual||typeof actual!=='object'||Array.isArray(encoded)!==Array.isArray(actual)||digest(Object.keys(encoded).sort())!==digest(Object.keys(actual).sort()))throw new Error('Historical dictionary full bundle reconstruction differs');for(const key of Object.keys(encoded))equals(encoded[key],actual[key]);}else if(encoded!==actual)throw new Error('Historical dictionary literal reconstruction differs');}equals(encoding.value,bundle);
  const point=i=>!(i>0&&i<display.length&&/[\uD800-\uDBFF]/u.test(display[i-1])&&/[\uDC00-\uDFFF]/u.test(display[i]));let end=0;
  for(const [i,page]of index.pages.entries()){await bound(run,page,{json:false,maxBytes:128*1024});const text=await readFile(await studyPath(run,page.path),'utf8');if(page.index!==i||page.start!==end||!Number.isSafeInteger(page.end)||page.end<=page.start||!point(page.start)||!point(page.end)||page.characters!==text.length||page.end-page.start!==text.length||text!==display.slice(page.start,page.end))throw new Error('Historical actual pages do not cover full frozen display');end=page.end;}
  if(end!==display.length)throw new Error('Historical actual display is incomplete');
  if(!Array.isArray(bundle.projections)||!bundle.projections.length||!Array.isArray(index.required_projection_artifacts)||index.required_projection_artifacts.length!==bundle.projections.length)throw new Error('Historical full projection artifacts missing');
  const ids=new Set();for(let i=0;i<bundle.projections.length;i++){const projection=bundle.projections[i],ref=index.required_projection_artifacts[i];if(ids.has(projection.id)||ref.id!==projection.id||projection.projection_sha256!==digest(projection.projection)||ref.projection_sha256!==projection.projection_sha256)throw new Error('Historical projection identity differs');ids.add(projection.id);const retained=await bound(run,ref,{maxBytes:128*1024**2});if(digest(retained)!==digest(projection))throw new Error('Historical full projection differs from displayed evidence');}
  return {index,bundle};
}

/** Authenticate retained declarations and bytes. This never infers reading from
 * emitted files, hashes, a checker result, or an agent's registration action. */
async function evidenceFor(run,{actual_review,strict_result,audit_id}){
  const review=await bound(run,actual_review),strict=await bound(run,strict_result,{maxBytes:128*1024});
  if(review.schema!=='v13-actual-native-and-model-sourceparts-review-v1'||!['ACTUAL_CURRENT_COMPONENT_REVIEW','BLOCKED'].includes(review.status)||review.authority!=='NONE'||review.human!==false||review.reviewer?.kind!=='AGENT'||review.reviewer.actual_reading_declared!==true||!Array.isArray(review.expected_audit_ids)||review.expected_audit_ids.length!==1||review.expected_audit_ids[0]!==audit_id||review.rows?.length!==1)throw new Error('Original actual partial component review required');
  const row=review.rows[0];
  if(row.audit_id!==audit_id||row.reviewer_id!==review.reviewer.id||row.actual_reading_declared!==true||row.open_material_representation_concern!==true||row.unresolved_material_loss!==true||row.production_model_heading_association_adequate!==false||row.computed_style_verified!==false||row.effectiveness_verified!==false||row.semantic_completeness_verified!==false||row.model_execution_performed!==false||row.new_whole_parent_body_read!==false||typeof row.reason!=='string'||row.reason.trim().length<20||typeof row.uncertainty!=='string'||row.uncertainty.trim().length<20)throw new Error('Explicit unresolved partial representation concern and limits required');
  if(strict.schema!=='v13-native-component-checker-result-v1'||strict.status!=='BLOCKED'||strict.expected_cases!==1||strict.rows?.length!==1||strict.rows[0].audit_id!==audit_id||strict.rows[0].status!=='BLOCKED_UNRESOLVED_MATERIAL_LOSS'||strict.source_quality_gate_pass!==false||strict.exact_path_sha_bytes_bindings_verified!==true||strict.actual_reading_not_machine_inferred!==true||digest(strict.strict_checker)!==digest(review.strict_checker))throw new Error('Matching blocked component binding result required');
  for(const key of ['policy','extraction_manifest','packet','preparation_freeze','strict_checker','strict_checker_supplement']){
    if(key==='strict_checker_supplement'&&review[key]===undefined)continue;
    await bound(run,review[key],{json:false});
  }
  const extraction=await bound(run,review.extraction_manifest),packet=await bound(run,review.packet),{index,bundle}=await verifyHistoricalRepresentationDisplay(run,row.prepared_page_index);
  const source=hash(review.extraction_source_sha256),{sha256:claimed,...sourceBody}=extraction.source??{};
  if(claimed!==source||digest(sourceBody)!==source)throw new Error('Observed representation extraction source differs');
  const packetRows=packet.rows?.filter(value=>value.audit_id===audit_id);
  if(packetRows?.length!==1||packet.source?.extraction_source?.sha256!==source||bundle.extraction_source_sha256!==source||bundle.contract_id!==packetRows[0].contract_id||index.audit_id!==audit_id||index.actual_reading!==false||!Array.isArray(index.pages)||!index.pages.length||index.pages.length>10000||!Array.isArray(row.page_reads)||row.page_reads.length!==index.pages.length||strict.rows[0].pages!==index.pages.length)throw new Error('Exact complete component-output coverage required, without a whole-parent claim');
  for(let i=0;i<index.pages.length;i++){
    const page=index.pages[i],read=row.page_reads[i];
    if(page.index!==i||read.page!==i||read.tool_response_observed_and_read!==true||typeof read.tool_call_reference!=='string'||!read.tool_call_reference.trim())throw new Error('Ordered actual tool-response declarations required');
    await bound(run,page,{json:false});
    const emission=await bound(run,read.emission),pageText=await readFile(await studyPath(run,page.path),'utf8');
    const header=JSON.stringify({audit_id,page:i,pages:index.pages.length,display_start:page.start,display_end:page.end,reviewer:review.reviewer.id})+'\n',response=header+pageText;
    if(emission.schema!=='v13-source-page-emission-v1'||emission.status!=='HELPER_EMITTED_PAGE_REQUIRES_ACTUAL_TOOL_OUTPUT_AND_REVIEWER_DECLARATION'||emission.audit_id!==audit_id||emission.reviewer!==review.reviewer.id||emission.actual_tool_result_observed_by_helper!==false||emission.actual_reading!==false||digest(emission.page)!==digest(page)||page.characters!==pageText.length||page.end-page.start!==pageText.length||emission.response_text!==response||emission.response_sha256!==sha256(response)||emission.response_characters!==response.length||response.length>7500)throw new Error('Emitted component response does not replay exact prepared page');
  }
  return {extraction_source_sha256:source,contract_id:packetRows[0].contract_id,reviewer_id:review.reviewer.id,actual_component_pages:index.pages.length,reading_scope:SCOPE,strict_result_scope:'BLOCKED_CORROBORATION; RECEIPT_AND_EMITTED_PAGES_REPLAYED_SEPARATELY',whole_parent_adequacy_claimed:false,whole_original_presentation_verified:false,effectiveness_verified:false};
}

/** Register an adverse finding without pretending a full parent was read. The
 * original authored receipt and its failed checker result stay immutable. */
export async function recordObservedRepresentationIssue(run,{actual_review,strict_result,audit_id,finding}={}){
  requireContainer();
  if(typeof finding!=='string'||finding.trim().length<20||finding.length>4000)throw new Error('Specific scoped representation finding required');
  const evidence={actual_review,strict_result,audit_id},verified=await evidenceFor(run,evidence);
  const body={schema:'observed-partial-representation-issue-v1',status:'UNRESOLVED',classification:'MATERIAL_MODEL_HEADING_REPRESENTATION',...verified,evidence,finding,authority:'NONE',human:false,adopted:false};
  const issue_id=`issue-${digest(body)}`,path=`${DIRECTORY}/${issue_id}.json`,value={...body,issue_id};
  try{const old=await readJSON(run,path);if(digest(old)!==digest(value))throw new Error('Immutable representation issue differs');return {path,...await hashFile(await studyPath(run,path)),resumed:true};}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return {...await writeJSON(run,path,value),resumed:false};
}

export async function validateObservedRepresentationIssue(run,ref){
  const value=await bound(run,ref,{maxBytes:128*1024}),{issue_id,...body}=value;
  if(value.schema!=='observed-partial-representation-issue-v1'||value.status!=='UNRESOLVED'||value.classification!=='MATERIAL_MODEL_HEADING_REPRESENTATION'||value.authority!=='NONE'||value.human!==false||value.adopted!==false||issue_id!==`issue-${digest(body)}`||ref.path!==`${DIRECTORY}/${issue_id}.json`)throw new Error('Observed representation issue identity differs');
  const verified=await evidenceFor(run,value.evidence);
  for(const [key,wanted]of Object.entries(verified))if(value[key]!==wanted)throw new Error('Observed representation issue declared scope differs');
  return value;
}

/** Snapshot only the live observed registry. Resolving one issue never deletes it. */
export async function representationIssueRegistry(run){
  requireContainer();let entries;
  try{entries=await readdir(await studyPath(run,DIRECTORY),{withFileTypes:true});}
  catch(error){if(error.code==='ENOENT')return {issues:[],sha256:digest([])};throw error;}
  if(entries.length>1000||entries.some(value=>!value.isFile()||!NAME.test(value.name)))throw new Error('Invalid observed representation issue registry');
  const issues=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    const path=`${DIRECTORY}/${entry.name}`,ref={path,...await hashFile(await studyPath(run,path))};await validateObservedRepresentationIssue(run,ref);issues.push(ref);
  }
  return {issues,sha256:digest(issues)};
}

/** The original finding remains adverse. Only an independently reverified replay
 * can establish a prefix/role repair for this exact source epoch. */
export async function assertNoUnresolvedRepresentationIssues(run,sourceSHA){
  requireContainer();hash(sourceSHA);const registry=await representationIssueRegistry(run),issues=[],held=[];
  for(const issue of registry.issues){
    const id=issue.path.split('/').at(-1),path=`representation-issues/resolutions/${sourceSHA}/${id}`;let resolution;
    try{resolution={path,...await hashFile(await studyPath(run,path))};}catch(error){if(error.code!=='ENOENT')throw error;held.push(issue);continue;}
    const {verifyRepresentationResolution}=await import('./representation-replay.mjs');
    const verified=await verifyRepresentationResolution(run,resolution,{issue,extraction_source_sha256:sourceSHA});issues.push({issue,resolution:verified.resolution,replay:verified.replay});
  }
  if(held.length)throw new Error(`UNRESOLVED_OBSERVED_REPRESENTATION_ISSUE: ${held.length} actual partial findings require independent exact-source repair replay for ${sourceSHA}`);
  return {observed:registry.issues.length,resolved:issues.length,issues,registry_sha256:registry.sha256,scope:'PREFIX_ROLE_INJECTION_ONLY; ALL_OTHER_GATES_UNCHANGED'};
}

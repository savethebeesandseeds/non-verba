// SPDX-License-Identifier: AGPL-3.0-only
// An observed loss survives a method-version change until an actual bound replay.
import {readFile,readdir} from 'node:fs/promises';
import {digest,sha256,requireContainer} from '../../lib/common.mjs';
import {studyPath,readJSON,hashFile,writeJSON} from './store.mjs';

const HEX=/^[a-f0-9]{64}$/;
const ISSUE=/^issue-[a-f0-9]{64}\.json$/;
const MAX_ISSUES=1000;
const normalized=value=>value.replace(/\s+/gu,' ').trim();
function hash(value){if(!HEX.test(value??''))throw new Error('Explicit SHA-256 required');return value;}
function sourceIdentity(source){const {sha256:claimed,...body}=source??{};if(hash(claimed)!==digest(body))throw new Error('Extraction source identity checksum differs');return claimed;}
async function boundJSON(run,reference,{maxBytes=16*1024**2}={}){
  if(typeof reference?.path!=='string')throw new Error('Literal bound artifact path required');
  const path=await studyPath(run,reference.path),actual=await hashFile(path);
  if(actual.sha256!==hash(reference.sha256)||reference.bytes!==undefined&&reference.bytes!==actual.bytes)throw new Error('Bound source-issue artifact bytes differ');
  return {value:await readJSON(run,reference.path,{maxBytes}),reference:{path:reference.path,...actual}};
}
async function commit(run,path,value){
  try{const retained=await readJSON(run,path,{maxBytes:128*1024});if(digest(retained)!==digest(value))throw new Error('Immutable source-issue receipt differs');return {path,...await hashFile(await studyPath(run,path)),resumed:true};}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return {...await writeJSON(run,path,value),resumed:false};
}
function ranges(value,length,{complete=false}={}){
  if(!Array.isArray(value)||!value.length||value.length>1000)throw new Error('Actual bounded reading ranges required');
  const sorted=value.map(pair=>{if(!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isSafeInteger)||pair[0]<0||pair[1]<=pair[0]||pair[1]>length)throw new Error('Invalid actual reading range');return [...pair];}).sort((a,b)=>a[0]-b[0]);
  const merged=[];for(const pair of sorted){const last=merged.at(-1);if(last&&pair[0]<=last[1])last[1]=Math.max(last[1],pair[1]);else merged.push(pair);}
  if(complete&&(merged.length!==1||merged[0][0]!==0||merged[0][1]!==length))throw new Error('Actual complete parent reading required');
  return merged;
}
function literals(evidence){
  const values=[evidence.literal_governor,...(evidence.schema==='literal-source-neighbor-boundary-finding-v1'?[evidence.literal_detached_qualification]:[...(evidence.literal_list_examples??[]),...(evidence.literal_cost_examples??[])])];
  if(values.length<2||values.length>100||values.some(value=>typeof value!=='string'||value.trim().length<10||value.length>20000))throw new Error('Literal governor and detached context evidence required');
  return [...new Set(values.map(normalized))];
}
function requireReadLiterals(raw,readRanges,required){
  const pieces=ranges(readRanges,raw.length).map(([start,end])=>normalized(raw.slice(start,end)));
  if(required.some(value=>!pieces.some(piece=>piece.includes(value))))throw new Error('Actual raw reading ranges do not cover the literal issue context');
}
function parentFromCache(normalizedText,parents,contractId,reference){
  const parent=parents?.find(row=>row.id===reference?.id);
  if(!parent||parent.contract_id!==contractId||parent.start!==reference.start||parent.end!==reference.end||parent.sha256!==reference.sha256||sha256(normalizedText.slice(parent.start,parent.end))!==parent.sha256)throw new Error('Issue parent boundary or text differs');
  return parent;
}
function checkedSnippet(source,reference,readRanges){
  const actualRanges=ranges(readRanges,source.length),snippet=reference?.actual_read_snippet;
  if(!snippet||!Number.isSafeInteger(snippet.start)||!Number.isSafeInteger(snippet.end)||snippet.start<0||snippet.end<=snippet.start||snippet.end>source.length||snippet.end-snippet.start>20000||!actualRanges.some(([start,end])=>start<=snippet.start&&end>=snippet.end)||snippet.text!==source.slice(snippet.start,snippet.end)||sha256(snippet.text)!==hash(snippet.sha256))throw new Error('Observed issue snippet bytes, hash or actual reading coverage differ');
  return snippet;
}

async function extractedParent(run,manifestRef,contractId,parentRef,rawRef){
  const {value:extraction,reference:manifest}=await boundJSON(run,manifestRef),sourceSHA=sourceIdentity(extraction.source);
  const record=extraction.contract_records?.find(row=>row.id===contractId),receipt=extraction.cache?.find(row=>row.id===contractId);
  if(!record||!receipt||record.status!=='accepted')throw new Error('Issue parent must bind an accepted extracted contract');
  const {value:cache,reference:cacheRef}=await boundJSON(run,receipt);
  if(cache.contract?.id!==contractId||cache.source?.sha256!==sourceSHA||receipt.source_sha256!==sourceSHA||cache.raw_sha256!==record.raw_sha256||sha256(cache.normalized_text)!==cache.normalized_sha256)throw new Error('Issue cache, source or normalized lineage differs');
  if(receipt.result_sha256!==undefined&&receipt.result_sha256!==digest(cache))throw new Error('Issue cache result receipt differs');
  const parent=parentFromCache(cache.normalized_text,cache.sections,contractId,parentRef);
  if(rawRef.path!==cache.contract.path||rawRef.sha256!==record.raw_sha256)throw new Error('Issue raw source scope differs');
  const rawPath=await studyPath(run,rawRef.path),actualRaw=await hashFile(rawPath);
  if(actualRaw.sha256!==rawRef.sha256||actualRaw.bytes>4*1024**2)throw new Error('Issue raw source bytes differ or exceed study contract bound');
  if(record.normalized_path){const actual=await hashFile(await studyPath(run,record.normalized_path));if(actual.sha256!==record.normalized_sha256||actual.sha256!==cache.normalized_sha256)throw new Error('Issue normalized artifact differs');}
  return {sourceSHA,manifest,cacheRef,parent,parents:cache.sections,normalizedText:cache.normalized_text,normalizedRef:record.normalized_path?{path:record.normalized_path,sha256:record.normalized_sha256}:null,text:cache.normalized_text.slice(parent.start,parent.end),raw:await readFile(rawPath,'utf8'),rawRef:{path:rawRef.path,...actualRaw}};
}

async function observedEvidence(run,reference){
  const {value:evidence,reference:evidenceRef}=await boundJSON(run,reference,{maxBytes:128*1024});
  const neighbor=evidence.schema==='literal-source-neighbor-boundary-finding-v1';
  if(!neighbor&&evidence.schema!=='literal-source-boundary-finding-v1'||typeof evidence.finding!=='string'||evidence.finding.length<20||!evidence.reviewer_kind||evidence.authority!=='NONE')throw new Error('Actual literal source-boundary finding required');
  const {value:packet,reference:packetRef}=await boundJSON(run,evidence.packet);
  sourceIdentity(packet.source);const rows=packet.rows?.filter(row=>row.audit_id===evidence.audit_id);
  if(rows?.length!==1||rows[0].contract_id!==evidence.contract_id)throw new Error('Issue audit identity or contract differs');
  const row=rows[0],parent=neighbor?{id:evidence.sampled_parent?.id,start:evidence.sampled_parent?.start,end:evidence.sampled_parent?.end,sha256:evidence.sampled_parent?.sha256}:{id:row.parent.id,start:evidence.parent?.normalized_start,end:evidence.parent?.normalized_end,sha256:evidence.parent?.sha256};
  if(parent.id!==row.parent.id||parent.start!==row.parent.start||parent.end!==row.parent.end||parent.sha256!==row.parent.sha256||!neighbor&&evidence.parent.characters!==parent.end-parent.start)throw new Error('Issue observation differs from supplied audit parent');
  const original=await extractedParent(run,packet.source.input_manifest,evidence.contract_id,parent,evidence.raw);
  if(original.sourceSHA!==packet.source.extraction_source?.sha256||row.lineage?.cache_path!==original.cacheRef.path||row.lineage.cache_sha256!==original.cacheRef.sha256||row.lineage.raw_path!==original.rawRef.path||row.lineage.raw_sha256!==original.rawRef.sha256)throw new Error('Issue audit source lineage differs');
  if(neighbor){
    if(evidence.status!=='FAILED_PARTIAL_SOURCE_REVIEW'||evidence.material_loss_observed!==true||evidence.unresolved_material_loss!==true||evidence.affected_governing_parent_fully_read!==false||evidence.extraction_source_sha256!==original.sourceSHA||evidence.cache?.path!==original.cacheRef.path||evidence.cache.sha256!==original.cacheRef.sha256||evidence.normalized?.path!==original.normalizedRef?.path||evidence.normalized.sha256!==original.normalizedRef?.sha256||!Array.isArray(evidence.affected_parents)||evidence.affected_parents.length!==2)throw new Error('Actual partial neighboring-parent source binding required');
    ranges(evidence.sampled_parent.actual_read_ranges,original.text.length,{complete:true});
    const affected=evidence.affected_parents.map(reference=>parentFromCache(original.normalizedText,original.parents,evidence.contract_id,reference));
    const index=original.parents.findIndex(value=>value.id===affected[0].id);
    if(affected.some(value=>value.id===parent.id)||original.parents[index+1]?.id!==affected[1].id||affected[1].start<affected[0].end||original.normalizedText.slice(affected[0].end,affected[1].start).trim())throw new Error('Affected operative parents must be actual adjacent spans distinct from the sampled anchor');
    const observed=ranges(evidence.affected_parent_actual_normalized_read_ranges,original.normalizedText.length),allRead=ranges(evidence.normalized.actual_read_ranges,original.normalizedText.length);
    if(!allRead.some(([start,end])=>start<=parent.start&&end>=parent.end)||observed.some(([start,end])=>!allRead.some(([left,right])=>left<=start&&right>=end))||observed.some(([start,end])=>start<=affected[0].start&&end>=affected[0].end))throw new Error('Partial neighboring-parent reading scope differs');
    const normalizedSnippet=checkedSnippet(original.normalizedText,evidence.normalized,evidence.affected_parent_actual_normalized_read_ranges),rawSnippet=checkedSnippet(original.raw,evidence.raw,evidence.raw.actual_read_ranges),required=literals(evidence);
    const before=normalized(original.normalizedText.slice(affected[0].start,affected[0].end)),after=normalized(original.normalizedText.slice(affected[1].start,affected[1].end));
    if(!before.endsWith(required[0])||before.includes(required[1])||!after.startsWith(required[1])||after.includes(required[0])||required.some(value=>!normalized(normalizedSnippet.text).includes(value)||!normalized(rawSnippet.text).includes(value)))throw new Error('Literal governor and qualification are not evidenced across the observed adjacent boundary');
    requireReadLiterals(original.normalizedText,evidence.affected_parent_actual_normalized_read_ranges,required);requireReadLiterals(original.raw,evidence.raw.actual_read_ranges,required);
    return {evidence,evidenceRef,packetRef,original,required,parent:{id:affected[0].id,start:affected[0].start,end:affected[0].end,sha256:affected[0].sha256},neighbor:{sampled_parent:parent,affected_parents:affected.map(({id,start,end,sha256})=>({id,start,end,sha256})),observed_reading_scope:{mode:'PARTIAL_NEIGHBOR_SOURCE',affected_governing_parent_fully_read:false,sampled_parent_actual_read_ranges:evidence.sampled_parent.actual_read_ranges,affected_parent_actual_normalized_read_ranges:evidence.affected_parent_actual_normalized_read_ranges,normalized_actual_read_ranges:evidence.normalized.actual_read_ranges,raw_actual_read_ranges:evidence.raw.actual_read_ranges}}};
  }
  ranges(evidence.parent.actual_read_ranges,original.text.length,{complete:true});
  const required=literals(evidence);requireReadLiterals(original.raw,evidence.raw.actual_read_ranges,required);
  const oldText=normalized(original.text);
  if(!oldText.includes(required[0])||required.slice(1).every(value=>oldText.includes(value)))throw new Error('No evidenced detached literal context outside the observed parent');
  return {evidence,evidenceRef,packetRef,original,required,parent};
}
function issueBody(found){
  return {schema:'observed-source-issue-v1',status:'UNRESOLVED',classification:'MATERIAL_BOUNDARY',extraction_source_sha256:found.original.sourceSHA,evidence:found.evidenceRef,packet:found.packetRef,extraction_manifest:found.original.manifest,audit_id:found.evidence.audit_id,contract_id:found.evidence.contract_id,parent:found.parent,raw:found.original.rawRef,required_preserved_literals:found.required,...(found.neighbor??{}),authority:'NONE',execution_attested:false};
}

/** Register an actual observed material boundary loss; hashes never assert reading. */
export async function registerObservedSourceIssue(run,{evidencePath,evidenceSHA}={}){
  requireContainer();const found=await observedEvidence(run,{path:evidencePath,sha256:evidenceSHA});
  const body=issueBody(found);
  const issueId=`issue-${digest(body)}`,receipt={...body,issue_id:issueId};
  const result=await commit(run,`source-issues/observed/${issueId}.json`,receipt);
  return {status:'UNRESOLVED',issue_id:issueId,source_sha256:body.extraction_source_sha256,...result};
}

async function verifiedIssue(run,reference){
  const {value:issue,reference:issueRef}=await boundJSON(run,reference,{maxBytes:128*1024});
  const {issue_id:issueId,...body}=issue;
  if(issue.schema!=='observed-source-issue-v1'||issue.status!=='UNRESOLVED'||issue.classification!=='MATERIAL_BOUNDARY'||issueId!==`issue-${digest(body)}`||issueRef.path!==`source-issues/observed/${issueId}.json`)throw new Error('Observed source-issue receipt identity differs');
  const found=await observedEvidence(run,issue.evidence);
  if(digest(body)!==digest(issueBody(found)))throw new Error('Observed source-issue receipt scope differs');
  return {issue,issueRef,found};
}

async function verifiedReplay(run,issue,issueRef,replayRef){
  const {value:replay,reference}=await boundJSON(run,replayRef,{maxBytes:128*1024});
  if(replay.schema!=='source-issue-replay-v1'||replay.issue?.path!==issueRef.path||replay.issue.sha256!==issueRef.sha256||replay.contract_id!==issue.contract_id||typeof replay.reviewer!=='string'||replay.reviewer.trim().length<3||!['FULL_PARENT_AND_SOURCE','FULL_PARENT_AND_RELEVANT_SOURCE'].includes(replay.reading)||replay.repair_adequate!==true||replay.unresolved_material_loss!==false||replay.material_loss_observed!==false||typeof replay.reason!=='string'||replay.reason.trim().length<20||replay.authority!=='NONE')throw new Error('Actual authored complete source-issue replay required');
  if(replay.raw?.path!==issue.raw.path||replay.raw.sha256!==issue.raw.sha256)throw new Error('Repair replay must use the original issue raw source');
  const repaired=await extractedParent(run,replay.extraction_manifest,issue.contract_id,replay.parent,replay.raw);
  ranges(replay.parent.actual_read_ranges,repaired.text.length,{complete:true});
  requireReadLiterals(repaired.raw,replay.raw.actual_read_ranges,issue.required_preserved_literals);
  if(issue.required_preserved_literals.some(value=>!normalized(repaired.text).includes(value)))throw new Error('Repaired parent still omits evidenced governing or associated context');
  return {reference,repaired};
}

/** Record a separate resolution for one exact source version, preserving the issue. */
export async function resolveObservedSourceIssue(run,{issuePath,issueSHA,replayPath,replaySHA}={}){
  requireContainer();const {issue,issueRef}=await verifiedIssue(run,{path:issuePath,sha256:issueSHA});
  const {reference,repaired}=await verifiedReplay(run,issue,issueRef,{path:replayPath,sha256:replaySHA});
  const resolution={schema:'observed-source-issue-resolution-v1',status:'RESOLVED_FOR_EXACT_SOURCE',issue:issueRef,extraction_source_sha256:repaired.sourceSHA,replay:reference,extraction_manifest:repaired.manifest,parent:{id:repaired.parent.id,start:repaired.parent.start,end:repaired.parent.end,sha256:repaired.parent.sha256},authority:'NONE',execution_attested:false};
  return {status:resolution.status,source_sha256:repaired.sourceSHA,...await commit(run,`source-issues/resolutions/${repaired.sourceSHA}/${issue.issue_id}.json`,resolution)};
}

/** Read-only global hold: a new source SHA cannot silently discard an old loss. */
export async function assertNoUnresolvedSourceIssues(run,sourceSHA){
  requireContainer();hash(sourceSHA);let entries;
  try{entries=await readdir(await studyPath(run,'source-issues/observed'),{withFileTypes:true});}
  catch(error){if(error.code==='ENOENT')return {status:'NO_UNRESOLVED_OBSERVED_SOURCE_ISSUES',source_sha256:sourceSHA,observed:0,resolved:0,issues:[],authority:'NONE'};throw error;}
  if(entries.length>MAX_ISSUES||entries.some(item=>!item.isFile()||!ISSUE.test(item.name)))throw new Error('Observed source-issue registry has unsupported entries or exceeds its bound');
  const receipts=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    const issuePath=`source-issues/observed/${entry.name}`,binding=await hashFile(await studyPath(run,issuePath));
    const {issue,issueRef}=await verifiedIssue(run,{path:issuePath,...binding});
    const resolutionPath=`source-issues/resolutions/${sourceSHA}/${issue.issue_id}.json`;let resolution;
    try{resolution=await readJSON(run,resolutionPath,{maxBytes:128*1024});}
    catch(error){if(error.code==='ENOENT')throw new Error(`UNRESOLVED_OBSERVED_SOURCE_ISSUE: ${issue.issue_id} from ${issue.extraction_source_sha256} requires an actual repair replay for ${sourceSHA}`);throw error;}
    if(resolution.schema!=='observed-source-issue-resolution-v1'||resolution.status!=='RESOLVED_FOR_EXACT_SOURCE'||resolution.extraction_source_sha256!==sourceSHA||digest(resolution.issue)!==digest(issueRef))throw new Error('Observed source-issue resolution scope differs');
    const replay=await verifiedReplay(run,issue,issueRef,resolution.replay);
    const parent={id:replay.repaired.parent.id,start:replay.repaired.parent.start,end:replay.repaired.parent.end,sha256:replay.repaired.parent.sha256};
    if(replay.repaired.sourceSHA!==sourceSHA||digest(resolution.extraction_manifest)!==digest(replay.repaired.manifest)||digest(resolution.parent)!==digest(parent))throw new Error('Observed source-issue resolution differs from replay');
    receipts.push({issue:issueRef,resolution:{path:resolutionPath,...await hashFile(await studyPath(run,resolutionPath))},replay:replay.reference});
  }
  return {status:'NO_UNRESOLVED_OBSERVED_SOURCE_ISSUES',source_sha256:sourceSHA,observed:entries.length,resolved:receipts.length,issues:receipts,authority:'NONE'};
}

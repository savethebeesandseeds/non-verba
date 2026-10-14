// SPDX-License-Identifier: AGPL-3.0-only
// Audit packets schedule review; sampling cues are not judgments or adequacy claims.
import {readFile} from 'node:fs/promises';
import {digest,sha256} from '../../lib/common.mjs';
import {hashFile,readJSON,readRows,studyPath,writeJSON} from './store.mjs';
import {verifyStudy} from './acquisition.mjs';

const DEFAULT_COUNTS={development:200,fresh_representation:100,coding:500,negative:200};
const PURPOSES=Object.keys(DEFAULT_COUNTS);
const DISCOVERY=new Set(['discovery-broad','discovery-relevant']);
const lowerBound=(values,target)=>{let low=0,high=values.length;while(low<high){const mid=(low+high)>>>1;if(values[mid]<target)low=mid+1;else high=mid;}return low;};

export function auditPurpose(contract_id,{seed='nonverba-study-v0.2-audit'}={}){
  if(typeof contract_id!=='string'||!contract_id||typeof seed!=='string'||!seed)throw new Error('Audit purpose requires a contract id and explicit seed');
  const rank=parseInt(digest([seed,'purpose',contract_id]).slice(0,8),16)/2**32;
  return rank<.2?'development':rank<.3?'fresh_representation':rank<.8?'coding':'negative';
}

async function immutableJSON(runDir,name,value){
  try{const old=await readJSON(runDir,name,{maxBytes:64*1024**2});if(digest(old)!==digest(value))throw new Error(`Immutable audit artifact differs: ${name}`);return {path:name,...await hashFile(await studyPath(runDir,name))};}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return writeJSON(runDir,name,value);
}

function exactRange(record,normalized,description){
  if(!Number.isSafeInteger(record.start)||!Number.isSafeInteger(record.end)||record.start<0||record.end<record.start||record.end>normalized.length||normalized.slice(record.start,record.end)!==record.text||sha256(record.text)!==record.sha256)throw new Error(`Audit ${description} normalized offset/hash mismatch`);
}

function excerpt(normalized,starts,ends,start,end,seed,id){
  const first=lowerBound(starts,start),last=lowerBound(starts,end),words=last-first;
  if(words<=300)return {text:normalized.slice(start,end),start,end,sha256:sha256(normalized.slice(start,end)),word_count:words,complete_reference:true};
  const shift=parseInt(digest([seed,'excerpt',id]).slice(0,8),16)%(words-300+1);
  const from=starts[first+shift],to=ends[first+shift+299],text=normalized.slice(from,to);
  return {text,start:from,end:to,sha256:sha256(text),word_count:300,complete_reference:false};
}

function omissionFlags(parent,shown,normalized,sourceExcluded){
  const unseen=normalized.slice(parent.start,shown.start)+' '+normalized.slice(shown.end,parent.end);
  return {parent_excerpt_incomplete:shown.start!==parent.start||shown.end!==parent.end,condition_or_exception_cues_outside_excerpt:/\b(?:if|unless|except|provided|notwithstanding|subject to)\b/i.test(unseen),original_source_omissions_recorded:sourceExcluded.length>0,omitted_original_node_offsets:'NOT_RECORDED',requires_full_parent_and_original_source_review:true};
}

function candidatesFor(cache,cacheRecord,contractRecord,selectedIds,seed){
  const normalized=cache.normalized_text;
  if(typeof normalized!=='string'||sha256(normalized)!==cache.normalized_sha256)throw new Error('Audit cached normalized source digest mismatch');
  const words=[...normalized.matchAll(/\S+/gu)],starts=words.map(word=>word.index),ends=words.map(word=>word.index+word[0].length);
  const contractId=cache.contract.id,sourceExcluded=cache.excluded??[],warnings=cache.warnings??[];
  const metadataFlags=Object.fromEntries(['amend','restate','joinder','termination'].filter(key=>Object.hasOwn(cache.contract.metadata??{},key)).map(key=>[key,cache.contract.metadata[key]]));
  const lineage={cache_path:cacheRecord.path,cache_sha256:cacheRecord.sha256,raw_path:cache.contract.path,raw_sha256:cache.raw_sha256,normalized_path:contractRecord.normalized_path??null,normalized_sha256:cache.normalized_sha256,offset_basis:'UTF16_IN_NORMALIZED_TEXT',source_url:cache.contract.source_url??'',cohort:cache.contract.cohort};
  const parents=new Map();for(const [index,parent] of (cache.sections??[]).entries()){exactRange(parent,normalized,'parent');parents.set(parent.id,{parent,index});}
  const result=[];
  const add=(record,parent,category,cues,pointer)=>{
    exactRange(record,normalized,'sample');const shown=excerpt(normalized,starts,ends,record.start,record.end,seed,record.id);
    const parentReference={id:parent.id,start:parent.start,end:parent.end,sha256:parent.sha256,complete_parent_reference:true,reference_scope:'EXTRACTED_FLAT_SPAN',semantic_completeness:'UNVERIFIED_REQUIRES_ORIGINAL_SOURCE_READING',cache_pointer:pointer,normalized_path:lineage.normalized_path,normalized_sha256:cache.normalized_sha256};
    result.push({id:record.id,contract_id:contractId,category,excerpt:shown,parent:parentReference,lineage,omission_flags:omissionFlags(parent,shown,normalized,sourceExcluded),sampling_cues:cues,source_omission_cues:sourceExcluded,document_warnings:warnings,metadata_flags:metadataFlags,rank:digest([seed,'sample',record.id,category])});
  };
  for(const {parent,index} of parents.values())add(parent,parent,'complete_parent',['full_section_sampling_anchor'],`/sections/${index}`);
  for(const unit of cache.units??[]){
    exactRange(unit,normalized,'unit');const found=parents.get(unit.parent_section_id);
    if(!found||unit.start<found.parent.start||unit.end>found.parent.end)throw new Error('Audit unit lacks its actual complete parent');
    const admitted=selectedIds.has(unit.id),cues=[admitted?'unit_admitted':'unit_not_admitted'];
    if(unit.kind==='structural_noise')cues.push('structural_noise_machine_classification');
    if(unit.chunk_count>1)cues.push('parent_split_into_embedding_units');
    if(/\b(?:if|unless|except|provided|notwithstanding|subject to)\b/i.test(unit.text))cues.push('condition_or_exception_text');
    if(/\b(?:inventory|schedule|quantity|item|equipment)\b/i.test(unit.text))cues.push('inventory_or_schedule_text');
    add(unit,found.parent,admitted?'admitted_unit':'unselected_unit',cues,`/sections/${found.index}`);
  }
  if(cache.status!=='accepted'||sourceExcluded.length||warnings.length||Object.values(metadataFlags).some(Boolean)){
    const found=parents.values().next().value;
    const parent=found?.parent??{id:`${contractId}:normalized-document`,start:0,end:normalized.length,text:normalized,sha256:cache.normalized_sha256};
    const cues=[];if(cache.status!=='accepted')cues.push('document_extraction_rejected');if(sourceExcluded.length)cues.push('source_omissions_recorded');if(warnings.length)cues.push('document_warnings_recorded');for(const [key,value] of Object.entries(metadataFlags))if(value)cues.push(`unverified_metadata_${key}_flag`);
    add(parent,parent,'document_omission_anchor',cues,found?`/sections/${found.index}`:'/normalized_text');
  }
  return result;
}

function choose(pool,target,purpose,{uniqueParent=false}={}){
  const groups=new Map();
  const priority=row=>purpose==='negative'?(row.category==='document_omission_anchor'?0:row.sampling_cues.includes('structural_noise_machine_classification')?1:row.category==='unselected_unit'?2:3):0;
  const spans=new Map();
  for(const row of pool){const key=JSON.stringify(uniqueParent?[row.contract_id,row.parent.id]:[row.contract_id,row.excerpt.start,row.excerpt.end,row.parent.id]);const old=spans.get(key);if(!old||priority(row)<priority(old)||priority(row)===priority(old)&&row.rank<old.rank)spans.set(key,row);}
  for(const row of spans.values()){if(!groups.has(row.contract_id))groups.set(row.contract_id,[]);groups.get(row.contract_id).push(row);}
  for(const rows of groups.values())rows.sort((a,b)=>priority(a)-priority(b)||a.rank.localeCompare(b.rank));
  const contracts=[...groups.keys()].sort((a,b)=>digest([purpose,a]).localeCompare(digest([purpose,b])));
  const selected=[];
  for(let index=0;selected.length<target;index++){
    let progress=false;for(const contract of contracts){const row=groups.get(contract)[index];if(row){selected.push(row);progress=true;if(selected.length===target)break;}}
    if(!progress)break;
  }
  return selected;
}

/** Full-cache audit universe; no sealed reserve, supplied codebook or completed review. */
export async function buildAuditPackets(runDir,extractionManifest,{seed,counts={},protocolPath}={}){
  const {recipe,study}=await verifyStudy(runDir);if(study.status!=='READY')throw new Error('Audit requires frozen ready cohort membership');seed=seed??`${recipe.seed}:audit-v1`;
  if(typeof seed!=='string'||!seed)throw new Error('Audit requires an explicit nonempty seed');
  if(Object.keys(counts).some(key=>!PURPOSES.includes(key)))throw new Error('Unknown audit purpose count');
  counts={...DEFAULT_COUNTS,...counts};for(const target of Object.values(counts))if(!Number.isSafeInteger(target)||target<0||target>10_000)throw new Error('Invalid bounded audit packet count');
  let protocol=null,protocolFile=null;const exposed=new Set();
  if(protocolPath){
    protocol=await readJSON(runDir,protocolPath,{maxBytes:8*1024**2});protocolFile={path:protocolPath,...await hashFile(await studyPath(runDir,protocolPath))};
    if(protocol.status!=='PREDECLARED_FRESH_REPAIR_AUDIT'||protocol.fresh_scope!=='ACCEPTED_RECONSTRUCTABLE_SOURCE'||protocol.rejection_controls!=='ALL_REJECTED_SOURCES'||!Array.isArray(protocol.excluded_contract_ids)||!Array.isArray(protocol.exposure_records))throw new Error('Invalid declared repair audit protocol');
    for(const id of protocol.excluded_contract_ids){if(typeof id!=='string'||!id||exposed.has(id))throw new Error('Invalid or duplicate exposed contract exclusion');exposed.add(id);}
    for(const item of protocol.exposure_records){const actual=await hashFile(await studyPath(runDir,item.path));if(actual.sha256!==item.sha256)throw new Error('Repair audit exposure artifact changed');const record=await readJSON(runDir,item.path,{maxBytes:32*1024**2});for(const id of record.source_exposed_contract_ids??[])if(!exposed.has(id))throw new Error('Previously exposed source omitted from fresh exclusions');for(const sourceRecord of record.source_records??[]){const retained=await hashFile(await studyPath(runDir,sourceRecord.path));if(retained.sha256!==sourceRecord.sha256)throw new Error('Declared underlying exposure record changed');}}
  }
  const manifestPath=extractionManifest.manifest_path;
  if(typeof manifestPath!=='string')throw new Error('Audit requires extraction manifest_path for exact input-byte binding');
  const input=await readJSON(runDir,manifestPath,{maxBytes:64*1024**2}),claimed={...extractionManifest};delete claimed.manifest_path;
  if(digest(input)!==digest(claimed))throw new Error('Supplied extraction manifest differs from retained bytes');
  if(input.authority!=='NONE'||input.adopted_catalog!==false||!Array.isArray(input.cache))throw new Error('Expected research-only extraction cache manifest');
  const membership=new Map();for await(const row of readRows(runDir,study.selection.path))membership.set(row.id,row);
  const selectedIds=new Set();const inputShards=[];
  for(const shard of input.shards?.units??[]){const actual=await hashFile(await studyPath(runDir,shard.path));if(actual.sha256!==shard.sha256||actual.bytes!==shard.bytes)throw new Error('Audit selected-unit shard digest mismatch');inputShards.push({path:shard.path,...actual});for await(const row of readRows(runDir,shard.path)){if(!DISCOVERY.has(row.cohort))throw new Error('Sealed cohort cannot enter audit packets');if(selectedIds.has(row.id))throw new Error('Repeated admitted audit unit');selectedIds.add(row.id);}}
  if(input.contracts!==input.cache.length||input.selected_units!==selectedIds.size)throw new Error('Audit input accounting differs from declared source artifacts');
  const files=[];for(const name of ['audit.mjs','store.mjs','acquisition.mjs'])files.push({path:`study-v0.2/lib/${name}`,sha256:sha256(await readFile(new URL(name,import.meta.url)))});for(const [path,url] of [['lib/common.mjs','../../lib/common.mjs'],['package-lock.json','../../package-lock.json']])files.push({path,sha256:sha256(await readFile(new URL(url,import.meta.url)))});
  const source={schema_version:2,algorithm:protocol?'contract_disjoint_full_cache_repair_audit_v3_unique_fresh_parents':'contract_disjoint_full_cache_purpose_sampling_v1',seed,counts,max_excerpt_words:300,input_manifest:{path:manifestPath,...await hashFile(await studyPath(runDir,manifestPath))},input_recipe:await hashFile(await studyPath(runDir,'recipe.json')),extraction_source:input.source,input_shards:inputShards,files,...(protocol?{protocol:protocolFile,unique_fresh_parent_sections:true}:{}),execution_attested:false};source.sha256=digest(source);
  const prefix=`audits/${source.sha256.slice(0,20)}`;
  const contractRecords=new Map((input.contract_records??[]).map(row=>[row.id,row]));
  const pools=Object.fromEntries(PURPOSES.map(purpose=>[purpose,[]])),universe=Object.fromEntries(PURPOSES.map(purpose=>[purpose,{contracts:0,candidates:0,categories:{}}]));
  const seen=new Set(),knownUnits=new Set(),rejectionControls=[];const freshExcluded={previously_exposed_contracts:0,rejected_contracts:0};
  for(const cacheRecord of input.cache){
    if(seen.has(cacheRecord.id))throw new Error('Repeated audit cache contract');seen.add(cacheRecord.id);
    const actual=await hashFile(await studyPath(runDir,cacheRecord.path));if(actual.sha256!==cacheRecord.sha256)throw new Error('Audit cached extraction digest mismatch');
    const cache=await readJSON(runDir,cacheRecord.path,{maxBytes:64*1024**2});const contractRecord=contractRecords.get(cacheRecord.id);
    const member=membership.get(cacheRecord.id);
    if(!contractRecord||!member||cache.contract.id!==cacheRecord.id||cache.contract.cohort!==contractRecord.cohort||member.cohort!==contractRecord.cohort||!DISCOVERY.has(contractRecord.cohort))throw new Error('Sealed or mismatched audit cache contract');
    if(cache.source?.sha256!==input.source?.sha256||cache.raw_sha256!==contractRecord.raw_sha256)throw new Error('Audit cached source lineage mismatch');
    const raw=await hashFile(await studyPath(runDir,cache.contract.path));if(raw.sha256!==cache.raw_sha256)throw new Error('Audit raw source digest mismatch');
    if(contractRecord.normalized_path){const normalized=await hashFile(await studyPath(runDir,contractRecord.normalized_path));if(normalized.sha256!==cache.normalized_sha256||contractRecord.normalized_sha256!==cache.normalized_sha256)throw new Error('Audit normalized source digest mismatch');}
    for(const unit of cache.units??[])knownUnits.add(unit.id);
    const purpose=auditPurpose(cache.contract.id,{seed});
    const candidates=candidatesFor(cache,cacheRecord,contractRecord,selectedIds,seed);
    if(protocol&&cache.status!=='accepted'){const anchor=candidates.find(row=>row.category==='document_omission_anchor');if(!anchor)throw new Error('Rejected source lacks retained integrity anchor');rejectionControls.push({...anchor,rejection_reason:cache.reason??cache.rejection_reason??'Declared rejected extraction'});}
    if(protocol&&purpose==='fresh_representation'&&(exposed.has(cache.contract.id)||cache.status!=='accepted')){if(exposed.has(cache.contract.id))freshExcluded.previously_exposed_contracts++;if(cache.status!=='accepted')freshExcluded.rejected_contracts++;continue;}
    universe[purpose].contracts++;universe[purpose].candidates+=candidates.length;
    const byCategory=new Map();for(const row of candidates){universe[purpose].categories[row.category]=(universe[purpose].categories[row.category]??0)+1;if(!byCategory.has(row.category))byCategory.set(row.category,[]);byCategory.get(row.category).push(row);}
    // A bounded per-contract candidate reservoir retains every category, including exclusions.
    for(const rows of byCategory.values())pools[purpose].push(...rows.sort((a,b)=>a.rank.localeCompare(b.rank)).slice(0,4));
  }
  if([...selectedIds].some(id=>!knownUnits.has(id)))throw new Error('Admitted audit unit has no declared full-cache source');
  const packets={},shortages={};
  for(const purpose of PURPOSES){
    const chosen=choose(pools[purpose],counts[purpose],purpose,{uniqueParent:!!protocol&&purpose==='fresh_representation'});
    const rows=chosen.map((row,index)=>{
      const {rank,...value}=row;
      if(purpose==='coding')for(const key of ['category','sampling_cues','source_omission_cues','document_warnings','metadata_flags'])delete value[key];
      return {...value,audit_id:`${purpose}-${String(index+1).padStart(4,'0')}`,review:{status:'NOT_RUN',response:null}};
    });
    const packet={schema_version:2,status:'AUDIT_NOT_RUN',prototype:true,authority:'NONE',adopted_catalog:false,purpose,source,target:counts[purpose],count:rows.length,shortage:counts[purpose]-rows.length,distinct_contracts:new Set(rows.map(row=>row.contract_id)).size,universe:purpose==='coding'?{contracts:universe[purpose].contracts,candidates:universe[purpose].candidates}:universe[purpose],method:purpose==='negative'?'Purposive machine/source cues within a separately assigned contract pool; these cues are not negative ground truth':'Deterministic category-preserving sampling with contract round robin within a separately assigned purpose pool',freshness:{meaning:'Contract-disjoint across the four pools in this audit attempt',previous_pilot_or_agent_exposure:protocol&&purpose==='fresh_representation'?'DECLARED_EXPOSED_CONTRACTS_EXCLUDED_OTHER_EXPOSURE_UNKNOWN':'UNKNOWN_NOT_VERIFIED',...(protocol&&purpose==='fresh_representation'?{scope:protocol.fresh_scope,excluded:freshExcluded,repeated_sections_per_contract:'Report correlation; section count is not independent contract count'}:{}),coder_priming:'Coding artifact supplies no function, cluster, candidate labels or existing codebook; reviewer history is not established'},excerpt_policy:'At most300sourcewords; exact normalized offsets and hashes; complete parent remains referenced, not duplicated',prompt:purpose==='coding'?'Read the complete referenced parent and original context. Describe relevant considerations in your own words, distinguish facts from interpretations, and record ambiguity. No supplied codebook or expected answer.':'Inspect the represented source against its complete parent and original document. Record omissions, ambiguous boundaries, counterexamples and uncertainty without assuming sampling cues are correct.',rows};
    const artifact=await immutableJSON(runDir,`${prefix}/${purpose}.json`,packet);
    packets[purpose]={...artifact,count:rows.length,target:counts[purpose],shortage:packet.shortage,distinct_contracts:packet.distinct_contracts,status:'AUDIT_NOT_RUN'};shortages[purpose]=packet.shortage;
  }
  if(protocol){const rows=rejectionControls.sort((a,b)=>a.contract_id.localeCompare(b.contract_id)).map((row,index)=>{const {rank,...value}=row;return {...value,audit_id:`source_integrity-${String(index+1).padStart(4,'0')}`,review:{status:'NOT_RUN',response:null}};});const packet={schema_version:2,status:'AUDIT_NOT_RUN',purpose:'source_integrity',authority:'NONE',source,target:rows.length,count:rows.length,scope:'Every rejected acquired calibration source, separate from the reconstructable fresh denominator',prompt:'Read original markup and retained text. Judge whether exclusion prevents unreconstructable material from being represented as a complete provision. Image pixels/OCR are not supplied and must not be claimed read. Supported exclusion is not reconstructed-context adequacy.',rows};packets.source_integrity={...await immutableJSON(runDir,`${prefix}/source_integrity.json`,packet),count:rows.length,target:rows.length,shortage:0,status:'AUDIT_NOT_RUN'};}
  const manifest={schema_version:2,status:'AUDIT_NOT_RUN',authority:'NONE',adopted_catalog:false,source,input_manifest_sha256:source.input_manifest.sha256,packets,shortages,no_adequacy_claim:true};
  const artifact=await immutableJSON(runDir,`${prefix}/manifest.json`,manifest);
  return {...manifest,manifest_path:artifact.path};
}

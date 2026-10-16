// SPDX-License-Identifier: AGPL-3.0-only
import {readFile,writeFile,mkdir,access,link,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {sha256,digest,readJSON,requireContainer,within} from '../../lib/common.mjs';
import {hashFile,writeRows,readRows,studyPath,readJSON as readStudyJSON} from './store.mjs';
import {atomicJSON} from './workflow.mjs';
import {createBatchEmbedder} from './embedding.mjs';
import {createChunkVectorCache} from './vector-cache.mjs';
import {sourceNavigationLabel,HEADING_INPUT_POLICY,createNativeSourceContext,createNativeRepresentation,modelInputIdentity,NATIVE_REPRESENTATION_POLICY} from './representation.mjs';
import {loadNativeDecoration} from './native-decoration-store.mjs';
import {NATIVE_DECORATION_INPUT_POLICY} from './source-decoration.mjs';
import {createBalancedReservoir,fitMiniBatch,assignVectors,evaluationDigest,comparePartitions} from './geometry.mjs';

async function commitBytes(path,bytes) {
  await mkdir(dirname(path),{recursive:true});
  try{const old=await readFile(path);if(sha256(old)!==sha256(bytes))throw new Error('Immutable binary shard changed');return {bytes:old.length,sha256:sha256(old)};}catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=`${path}.${randomUUID()}.partial`;
  try{await writeFile(temporary,bytes,{flag:'wx'});await link(temporary,path);}finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {bytes:bytes.length,sha256:sha256(bytes)};
}
function encode(vectors) {const bytes=Buffer.allocUnsafe(vectors.length*4);for(let i=0;i<vectors.length;i++){if(!Number.isFinite(vectors[i]))throw new Error('Nonfinite embedding');bytes.writeFloatLE(vectors[i],i*4);}return bytes;}
function decode(bytes,dimensions) {if(bytes.length%(dimensions*4))throw new Error('Misaligned vector bytes');const vectors=new Float32Array(bytes.length/4);for(let i=0;i<vectors.length;i++){vectors[i]=bytes.readFloatLE(i*4);if(!Number.isFinite(vectors[i]))throw new Error('Nonfinite retained embedding');}return vectors;}
function artifactDigest(value) {const {manifest_path,...manifest}=value;return digest(manifest);}
function unitShards(admission) {const shards=Array.isArray(admission.shards)?admission.shards:admission.shards?.units;if(!Array.isArray(shards))throw new Error('Admission requires declared representative shards');return shards;}
async function boundFile(runDir,item) {const path=await studyPath(runDir,item.path);const actual=await hashFile(path);if(actual.sha256!==item.sha256||(item.bytes!=null&&actual.bytes!==item.bytes))throw new Error(`Artifact binding changed: ${item.path}`);return path;}
async function maybeJSON(path) {try{return await readJSON(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}

/** One hydrated contract/view at a time; returned representations are ephemeral.
 * The caller must finish a chunk before retaining another contract's view. */
export function createStudyNativeInputLoader(runDir,admission) {
  requireContainer();
  let metadata=null,current=null;
  const readMetadata=async()=>{
    if(metadata)return metadata;
    const input=admission.input??{},path=input.extraction_manifest_path;
    if(!path){metadata={legacy:true,records:new Map()};return metadata;}
    const exactFileBinding=!!input.extraction_manifest_file?.sha256;
    const extraction=await readJSON(exactFileBinding?await boundFile(runDir,{path,...input.extraction_manifest_file}):await studyPath(runDir,path));
    if(artifactDigest(extraction)!==input.extraction_manifest_sha256||extraction.source?.sha256!==input.extraction_source_sha256)throw new Error('Native input extraction manifest differs from admission');
    const {sha256:sourceSHA,...sourceBody}=extraction.source??{};if(digest(sourceBody)!==sourceSHA)throw new Error('Native extraction source identity digest differs');
    const records=new Map();for(const record of extraction.contract_records??[]){if(records.has(record.id))throw new Error('Duplicate native input contract metadata');records.set(record.id,record);}
    const legacy=![...records.values()].some(record=>record.native_source_decorations!==undefined);
    if(!legacy&&!exactFileBinding)throw new Error('Native input loading requires the exact admission extraction manifest file binding');
    metadata={legacy,records,extraction};return metadata;
  };
  return async(unit,{bodyRange,includeHeading=false}={})=>{
    if(!['discovery-broad','discovery-relevant'].includes(unit?.cohort))throw new Error('Reserve unit attempted to enter discovery native input preparation');
    const info=await readMetadata(),record=info.records.get(unit.contract_id);
    if(info.legacy){if(unit.native_source_decorations_ref!==undefined)throw new Error('Current native unit lacks bound extraction metadata');return {...unit,contextual_text:`${sourceNavigationLabel(unit)}\n${unit.text}`};}
    if(!record||record.status!=='accepted'||!record.native_source_decorations||!unit.native_source_decorations_ref)throw new Error('Current native contract/unit metadata missing; plain fallback forbidden');
    if(!current||current.id!==unit.contract_id){
      const expected=async name=>{const declared=info.extraction.source.files?.find(file=>file.path===name)?.sha256,actual=sha256(await readFile(new URL(`./${name}`,import.meta.url)));if(declared!==actual)throw new Error(`Current native method differs: ${name}`);return actual;};
      const expectedTracerSourceSHA256=await expected('source-decoration.mjs'),expectedCollectorSourceSHA256=await expected('sections.mjs');
      if(record.normalized_path!==unit.normalized_path)throw new Error('Native unit normalized artifact differs from its contract');
      const normalizedText=await readFile(await studyPath(runDir,record.normalized_path),'utf8');if(sha256(normalizedText)!==record.normalized_sha256)throw new Error('Native normalized source byte binding differs');
      const cacheRef=info.extraction.cache?.find(item=>item.id===unit.contract_id);if(!cacheRef)throw new Error('Native contract extraction cache reference missing');
      await boundFile(runDir,cacheRef);const cache=await readStudyJSON(runDir,cacheRef.path,{maxBytes:64*1024**2});
      if(cache.contract?.id!==unit.contract_id||cache.contract?.cohort!==unit.cohort||cache.source?.sha256!==info.extraction.source.sha256||cache.raw_sha256!==record.raw_sha256||cache.normalized_sha256!==record.normalized_sha256||cache.normalized_text!==normalizedText||digest(cache.native_source_decorations)!==digest(record.native_source_decorations))throw new Error('Native cache contract/source reference differs');
      if(typeof cache.contract.path!=='string'||!cache.contract.path.startsWith('raw/'))throw new Error('Bound original native raw path required');
      const rawBytes=await readFile(await studyPath(runDir,cache.contract.path));if(sha256(rawBytes)!==record.raw_sha256||cache.contract.acquisition?.sha256!==record.raw_sha256||rawBytes.length!==cache.contract.acquisition.bytes)throw new Error('Native raw source byte binding differs');
      const envelope=await loadNativeDecoration(runDir,record.native_source_decorations),context=createNativeSourceContext({raw:rawBytes.toString('utf8'),normalizedText,envelope,expectedTracerSourceSHA256,expectedCollectorSourceSHA256});
      current={id:unit.contract_id,context,parents:new Map(cache.sections.map(parent=>[parent.id,{...parent,cohort:parent.cohort??cache.contract.cohort}])),normalized_path:record.normalized_path};
    }
    if(current.normalized_path!==unit.normalized_path)throw new Error('Native normalized unit path changed within contract');
    return {...unit,native_input:createNativeRepresentation(unit,{context:current.context,parent:current.parents.get(unit.parent_section_id),bodyRange,includeHeading})};
  };
}

export async function embedStudy(runDir,admission,{log=console.log,createEmbedder=createBatchEmbedder}={}) {
  requireContainer();const recipe=await readJSON(within(runDir,'recipe.json'));
  const identity={admission_sha256:artifactDigest(admission),config:recipe.embedding,heading_input_policy:HEADING_INPUT_POLICY,native_representation_policy:NATIVE_REPRESENTATION_POLICY,native_input_policy:NATIVE_DECORATION_INPUT_POLICY,native_source:sha256(await readFile(new URL('./source-decoration.mjs',import.meta.url))),native_store_source:sha256(await readFile(new URL('./native-decoration-store.mjs',import.meta.url))),representation_source:sha256(await readFile(new URL('./representation.mjs',import.meta.url))),embedding_source:sha256(await readFile(resolve(dirname(fileURLToPath(import.meta.url)),'embedding.mjs'))),orchestration_source:sha256(await readFile(fileURLToPath(import.meta.url)))};
  const prefix=`embeddings/${digest(identity).slice(0,16)}`;
  const finalPath=within(runDir,`${prefix}/manifest.json`);
  const completed=await maybeJSON(finalPath);if(completed){for await(const ignored of readEmbeddingBatches(runDir,completed)){}return {...completed,manifest_path:`${prefix}/manifest.json`};}
  const embedder=await createEmbedder({...recipe.embedding,max_units:500,token_budget:recipe.embedding.tokenBudget});
  let cache;try{cache=await createChunkVectorCache(runDir,{model:embedder.model,window_policy:embedder.window_policy,embedding_source:identity.embedding_source},{dimensions:recipe.embedding.dimensions});}catch(error){await embedder.dispose();throw error;}
  const shards=[];const batch=[];let number=0;let count=0;let inferenceCalls=0;const started=Date.now(),nativeInput=createStudyNativeInputLoader(runDir,admission);
  const flush=async()=>{
    if(!batch.length)return;const units=batch.splice(0);const tag=String(number++).padStart(6,'0');
    const prepared=[];for(const unit of units)prepared.push(await nativeInput(unit));
    const ids=units.map(unit=>unit.id),inputs=prepared.map(modelInputIdentity);
    const input_sha256=digest(inputs.map(input=>input.input_sha256));const manifestName=`${prefix}/batch-${tag}.json`;
    let shard;
    try{shard=await readJSON(within(runDir,manifestName));if(shard.ordered_ids_sha256!==digest(ids)||shard.input_sha256!==input_sha256)throw new Error('Resume input chunk changed');const actual=await hashFile(within(runDir,shard.vectors.path));if(actual.sha256!==shard.vectors.sha256)throw new Error('Resume vector chunk changed');}
    catch(error){if(error.code!=='ENOENT')throw error;const packed=new Float32Array(units.length*recipe.embedding.dimensions);const retainedInputs=new Array(units.length);const missing=[];let hits=0;
      for(let i=0;i<units.length;i++){const found=await cache.get(inputs[i].input_sha256);if(found){if(found.input.native_evidence_status!==inputs[i].native_evidence_status&&inputs[i].native_representation)throw new Error('Cached current native evidence differs');packed.set(found.vector,i*recipe.embedding.dimensions);retainedInputs[i]={...found.input,unit_id:units[i].id,native_evidence_status:inputs[i].native_evidence_status};hits++;}else missing.push({unit:prepared[i],identity:inputs[i],index:i});}
      let fresh=null;if(missing.length){fresh=await embedder.embedUnits(missing.map(item=>item.unit));inferenceCalls++;for(let i=0;i<missing.length;i++){if(fresh.inputs[i].input_sha256!==missing[i].identity.input_sha256)throw new Error('Actual embedding input differs from frozen source representation');if(missing[i].identity.native_representation&&fresh.inputs[i].native_evidence_status!=='BOUND_NATIVE_SOURCE_EVIDENCE')throw new Error('Actual embedding omitted bound native source evidence');packed.set(fresh.packed_vectors.subarray(i*recipe.embedding.dimensions,(i+1)*recipe.embedding.dimensions),missing[i].index*recipe.embedding.dimensions);retainedInputs[missing[i].index]={...fresh.inputs[i],native_evidence_status:missing[i].identity.native_evidence_status};}await cache.put({...fresh,inputs:missing.map((item,i)=>({...fresh.inputs[i],native_evidence_status:item.identity.native_evidence_status}))});}
      const result={packed_vectors:packed,dimensions:recipe.embedding.dimensions,inputs:retainedInputs,provenance:{model:embedder.model,window_policy:embedder.window_policy,vector_cache:cache.prefix,cache_hits:hits,new_units:missing.length,fresh_inference:fresh?.provenance??null,execution_attested:false}};
      const vectorName=`${prefix}/batch-${tag}.f32`;const vectorInfo=await commitBytes(within(runDir,vectorName),encode(result.packed_vectors));
      shard={schema_version:2,rows:units.length,dimensions:result.dimensions,encoding:'float32-le',ordered_ids_sha256:digest(ids),input_sha256,unit_ids:ids,units:units.map(unit=>({id:unit.id,contract_id:unit.contract_id,cohort:unit.cohort,family_id:unit.family_id??unit.id,template_blocking_id:unit.template_blocking_id??null,partition:'fit'})),inputs:result.inputs,provenance:result.provenance,vectors:{path:vectorName,...vectorInfo}};
      await atomicJSON(within(runDir,manifestName),shard);
    }
    shards.push({path:manifestName,sha256:sha256(await readFile(within(runDir,manifestName))),rows:shard.rows,vectors:shard.vectors});count+=shard.rows;
    log(`Verified embedding progress ${count} units (${inferenceCalls} new bounded chunks)`);
  };
  try {
    for(const shard of unitShards(admission)){await boundFile(runDir,shard);for await(const row of readRows(runDir,shard.path)){const unit=JSON.parse(row.payload);if(!unit.cohort?.startsWith('discovery-'))throw new Error('Reserve unit attempted to enter discovery embedding');if(unit.id!==row.id)throw new Error('Representative payload ID differs from storage ID');if(batch.length&&(unit.native_source_decorations_ref!==undefined||batch[0].native_source_decorations_ref!==undefined)&&batch[0].contract_id!==unit.contract_id)await flush();batch.push(unit);if(batch.length===500)await flush();}}
    await flush();
  }finally{await embedder.dispose();}
  const manifest={schema_version:2,status:'REAL_CPU_EMBEDDINGS_RESEARCH_ONLY',identity,model:embedder.model,window_policy:embedder.window_policy,rows:count,dimensions:recipe.embedding.dimensions,shards,elapsed_seconds:(Date.now()-started)/1000,authority:'NONE',execution_attested:false};
  await atomicJSON(finalPath,manifest);return {...manifest,manifest_path:`${prefix}/manifest.json`};
}

export async function* readEmbeddingBatches(runDir,manifest) {
  let total=0;const ids=new Set();
  for(const item of manifest.shards){const shard=await readJSON(await boundFile(runDir,item));const bytes=await readFile(await boundFile(runDir,shard.vectors));const vectors=decode(bytes,shard.dimensions);
    if(shard.dimensions!==manifest.dimensions||shard.rows!==item.rows||shard.units.length!==shard.rows||vectors.length!==shard.rows*shard.dimensions||digest(shard.units.map(row=>row.id))!==shard.ordered_ids_sha256||digest(shard.unit_ids)!==shard.ordered_ids_sha256)throw new Error('Embedding rows, ordered identities or dimensions differ');
    for(const row of shard.units){if(row.partition!=='fit'||!row.cohort?.startsWith('discovery-')||ids.has(row.id))throw new Error('Duplicate or reserve row in discovery embeddings');ids.add(row.id);}total+=shard.rows;
    yield {rows:shard.units,vectors,dimensions:shard.dimensions};
  }
  if(total!==manifest.rows)throw new Error('Embedding manifest omits rows');
}

export async function discoverStudy(runDir,embeddings,{log=console.log}={}) {
  requireContainer();const recipe=await readJSON(within(runDir,'recipe.json'));
  const identity={embeddings_sha256:artifactDigest(embeddings),geometry:recipe.geometry,geometry_source:sha256(await readFile(resolve(dirname(fileURLToPath(import.meta.url)),'geometry.mjs'))),orchestration_source:sha256(await readFile(fileURLToPath(import.meta.url)))};
  const prefix=`geometry/${digest(identity).slice(0,16)}`;
  const completed=await maybeJSON(within(runDir,`${prefix}/manifest.json`));if(completed){await verifyGeometry(runDir,completed);return {...completed,manifest_path:`${prefix}/manifest.json`};}
  const reservoir=createBalancedReservoir({capacity:recipe.geometry.reservoirSize,perContract:20,perFamily:2,dimensions:embeddings.dimensions,seed:recipe.geometry.seed});
  for await(const batch of readEmbeddingBatches(runDir,embeddings))reservoir.addBatch(batch.rows,batch.vectors);
  const sampled=reservoir.snapshot();if(sampled.rows.length<2)throw new Error('Too few independent discovery units for geometry');
  const evalRows=sampled.rows.slice(0,Math.min(recipe.geometry.evaluationSize,sampled.rows.length));const evalVectors=sampled.vectors.subarray(0,evalRows.length*embeddings.dimensions);const evalDigest=evaluationDigest(evalRows);
  const runs=[];const partitions=[];let primary=null;
  for(const k of recipe.geometry.kValues)for(let repeat=1;repeat<=recipe.geometry.repeats;repeat++) {
    const id=`k${k}-r${repeat}`;let retained;
    try{retained=await readJSON(within(runDir,`${prefix}/${id}.json`));}
    catch(error){if(error.code!=='ENOENT')throw error;log(`Fitting ${id} on ${sampled.rows.length} balanced fit units`);
      const fitted=fitMiniBatch(sampled.rows,sampled.vectors,{k,seed:recipe.geometry.seed+k*1009+repeat,batchSize:recipe.geometry.batchSize,iterations:recipe.geometry.iterations,dimensions:embeddings.dimensions});
      const assignment=assignVectors(evalRows,evalVectors,fitted);retained={id,requested_k:k,effective_k:fitted.effective_k,repeat,dimensions:fitted.dimensions,centroids:Array.from(fitted.centroids),counts:Array.from(fitted.counts),evaluation_sha256:evalDigest,evaluation_labels:assignment.map(row=>row.label),method:fitted.method??fitted.parameters??null,reservoir:sampled.statistics};await atomicJSON(within(runDir,`${prefix}/${id}.json`),retained);
    }
    if(retained.evaluation_sha256!==evalDigest)throw new Error('Retained geometry evaluation set changed');
    runs.push({id,path:`${prefix}/${id}.json`,sha256:sha256(await readFile(within(runDir,`${prefix}/${id}.json`))),requested_k:k,effective_k:retained.effective_k,repeat});partitions.push({id,evaluation_sha256:evalDigest,labels:retained.evaluation_labels});
    if(k===recipe.geometry.primaryK&&repeat===recipe.geometry.primaryRepeat)primary=retained;
  }
  const comparisons=[];for(let i=0;i<partitions.length;i++)for(let j=i+1;j<partitions.length;j++)comparisons.push({left:partitions[i].id,right:partitions[j].id,...comparePartitions(partitions[i],partitions[j])});
  if(!primary)throw new Error('Predeclared primary geometry absent');
  const model={centroids:Float32Array.from(primary.centroids),dimensions:embeddings.dimensions,effective_k:primary.effective_k};
  const assignmentShards=[];let ordinal=0;
  for await(const batch of readEmbeddingBatches(runDir,embeddings)) {
    const assignments=assignVectors(batch.rows,batch.vectors,model);const path=`${prefix}/assignments-${String(ordinal++).padStart(6,'0')}.parquet`;
    const rows=assignments.map(row=>({id:row.unit_id,cluster:row.cluster_id??String(row.label),payload:JSON.stringify(row)}));
    let shard;try{shard=await readJSON(within(runDir,`${path}.json`));await boundFile(runDir,shard);if(shard.records_sha256!==digest(rows))throw new Error('Assignment resume inputs changed');}
    catch(error){if(error.code!=='ENOENT')throw error;let file;try{file=await writeRows(runDir,path,rows,{schema:{id:'VARCHAR',cluster:'VARCHAR',payload:'VARCHAR'}});}catch(commitError){if(commitError.code!=='EEXIST')throw commitError;const retained=[];for await(const row of readRows(runDir,path))retained.push(row);if(digest(retained)!==digest(rows))throw new Error('Orphan assignment shard differs');file={path,rows:rows.length,...await hashFile(await studyPath(runDir,path))};}shard={...file,records_sha256:digest(rows)};await atomicJSON(within(runDir,`${path}.json`),shard);}assignmentShards.push(shard);
  }
  const manifest={schema_version:2,status:'FIXED_DISCOVERY_SCHEDULE_RETAINED',identity,reservoir:sampled.statistics,evaluation:{sha256:evalDigest,unit_ids:evalRows.map(row=>row.id)},runs,comparisons,primary:primary.id,assignment_shards:assignmentShards,rows:embeddings.rows,authority:'NONE',execution_attested:false};
  await atomicJSON(within(runDir,`${prefix}/manifest.json`),manifest);return {...manifest,manifest_path:`${prefix}/manifest.json`};
}

export async function verifyGeometry(runDir,manifest) {
  for(const item of [...manifest.runs,...manifest.assignment_shards])await boundFile(runDir,item);
  const ids=new Set();let total=0;
  for(const shard of manifest.assignment_shards)for await(const row of readRows(runDir,shard.path)){const assignment=JSON.parse(row.payload);if(ids.has(row.id)||assignment.unit_id!==row.id||assignment.partition!=='fit')throw new Error('Assignment identity or partition differs');ids.add(row.id);total++;}
  if(total!==manifest.rows)throw new Error('Geometry manifest omits assignments');return {status:'VERIFIED',rows:total,runs:manifest.runs.length};
}

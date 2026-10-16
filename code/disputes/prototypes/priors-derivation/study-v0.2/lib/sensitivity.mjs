// SPDX-License-Identifier: AGPL-3.0-only
// Four frozen comparison arms. Geometry agreement supplies no normative authority.
import {readFile, writeFile, mkdir, link, unlink, stat, readdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {digest, sha256, requireContainer} from '../../lib/common.mjs';
import {validateStudyRoot, studyPath, hashFile, readJSON, readRows, writeRows, openDatabase, sqlQuote} from './store.mjs';
import {atomicJSON} from './workflow.mjs';
import {createBatchEmbedder, createArtifactBatchEmbedder, normalizeFloat32,prepareEmbeddingInput,createPinnedTokenCounter,embeddingCacheKey,embeddingWindowPolicy} from './embedding.mjs';
import {createStudyNativeInputLoader} from './analysis.mjs';
import {createChunkVectorCache} from './vector-cache.mjs';
import {sourceNavigationLabel,verifySourceNavigation,HEADING_INPUT_POLICY,LEGACY_HEADING_INPUT_POLICY,modelInputIdentity,NATIVE_REPRESENTATION_POLICY} from './representation.mjs';
import {NATIVE_DECORATION_INPUT_POLICY} from './source-decoration.mjs';
import {verifyCalibrationGate} from './quality.mjs';
import {assertNoUnresolvedSourceIssues} from './source-issues.mjs';
import {createBalancedReservoir, fitMiniBatch, assignVectors, evaluationDigest, comparePartitions, exactSmallComparator} from './geometry.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const cohorts = new Set(['discovery-broad', 'discovery-relevant']);
const schema = {id:'VARCHAR', contract_id:'VARCHAR', cohort:'VARCHAR', kind:'VARCHAR', payload:'VARCHAR'};
const policy = Object.freeze({version:'frozen-four-arm-sensitivity-v3-contiguous-native-source-span', chunk_units:500, exact_subset:2000, per_family:2,
  native_input:NATIVE_DECORATION_INPUT_POLICY,native_representation:NATIVE_REPRESENTATION_POLICY,native_memory:'Hydrate, encode and infer one current source unit at a time; never retain a 500-contract array of full native views.',
  arm_identifiers:'Historical IDs containing heading are compatibility identifiers. Current native representation fields select contiguous source spans with navigation metadata excluded; legacy unavailable inputs retain their historical prefix.',
  native_lexical:'Production native source windows using the verified baseline tokenizer, joined with a literal newline; retain every annotation and encoded window without truncation.',
  context:'At most 60 nearest complete whitespace words in the verified actual parent: 30 each side, unused capacity redistributed; no relevance ranker.',
  lexical:'UTF-8 FNV1a32 namespaced word/bigram buckets, high-bit sign, per-feature sublinear TF, unsigned bucket DF on the frozen training subset, smooth IDF, final L2 normalization.',
  exact:{maximum_rows:2000, repeats:1, max_iterations:30, silhouette_sample_size:64, representative_count:1},
  selection_ties:'sha256(seed + colon + unit ID), then unit ID; contract round robin by SHA256 contract priority',
  evaluation:'Common frozen discovery units; in-sample geometric comparison, not heldout or blinded validation.'});
const armDefinitions = [
  {id:'baseline-heading-unit', representation:'unit-source-span', model:'baseline'},
  {id:'baseline-parent-context', representation:'verified-parent-context-source-span', model:'baseline'},
  {id:'second-model-heading-unit', representation:'unit-source-span', model:'second'},
  {id:'lexical-heading-unit', representation:'unit-source-span', model:'lexical'}
];

function identityOf(value) {const {manifest_path, ...record} = value; return digest(record);}
function validHash(value) {return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);}
function count(value) {const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid bounded study count.'); return n;}
function unitShards(admission) {const shards = admission.shards?.units; if (!Array.isArray(shards) || !shards.length) throw new Error('Comparison needs explicit admitted representative shards.'); return shards;}
async function bound(run, item) {
  if (!item || !validHash(item.sha256) || !Number.isSafeInteger(item.bytes)) throw new Error('Comparison artifact requires exact byte and SHA256 bindings.');
  const path = await studyPath(run, item.path); const actual = await hashFile(path);
  if (actual.sha256 !== item.sha256 || actual.bytes !== item.bytes) throw new Error(`Comparison artifact binding changed: ${item.path}`); return path;
}
async function receipt(run, name) {return {path:name, ...await hashFile(await studyPath(run, name))};}
async function optional(run, name) {try {return await readJSON(run, name, {maxBytes:128*1024*1024});} catch (error) {if (error.code === 'ENOENT') return null; throw error;}}
async function json(run, name, value) {await atomicJSON(await studyPath(run, name, {missing:true}), value); return receipt(run, name);}
async function binary(run, name, vectors) {
  const path = await studyPath(run, name, {missing:true}); const bytes = Buffer.alloc(vectors.length * 4);
  for (let i=0; i<vectors.length; i++) {if (!Number.isFinite(vectors[i])) throw new Error('Nonfinite comparison vector.'); bytes.writeFloatLE(vectors[i], i*4);}
  await mkdir(dirname(path), {recursive:true});
  try {const old = await readFile(path); if (sha256(old) !== sha256(bytes)) throw new Error('Immutable comparison vector shard differs.'); return receipt(run, name);}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  const temporary = `${path}.${randomUUID()}.partial`;
  try {await writeFile(temporary, bytes, {flag:'wx'}); await link(temporary, path);}
  finally {await unlink(temporary).catch(error=>{if (error.code !== 'ENOENT') throw error;});} return receipt(run, name);
}
async function shard(run, name, rows) {
  const old = await optional(run, `${name}.json`); const hash = digest(rows);
  if (old) {await bound(run, old); if (old.records_sha256 !== hash || old.rows !== rows.length) throw new Error('Frozen comparison inputs changed on resume.'); return old;}
  let result;
  try {result = await writeRows(run, name, rows, {schema});}
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const retained = []; for await (const row of readRows(run, name)) retained.push(row);
    if (digest(retained) !== hash) throw new Error('Orphan comparison input shard differs; preserved.'); result = {path:name, rows:retained.length, ...await hashFile(await studyPath(run, name))};
  }
  const record = {...result, records_sha256:hash}; await json(run, `${name}.json`, record); return record;
}
function memoryTracker() {
  const start = process.memoryUsage(); const peak = {...start}; let samples = 0;
  const sample = () => {const current = process.memoryUsage(); for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], current[key]); samples++;};
  return {sample, report:()=>({start, peak_observed:peak, final:process.memoryUsage(), samples, measurement:'Process memory sampled at stage/batch boundaries; not an OS continuous high-water measurement.'})};
}
function nearestWords(text, start, end, reverse) {
  // Hold at most 60 word bounds, rather than tokenizing an entire long parent.
  const words = []; let cursor = reverse?end:start; const whitespace = character=>/\s/u.test(character);
  while (words.length<60 && (reverse?cursor>start:cursor<end)) {
    if (reverse) {
      while(cursor>start&&whitespace(text[cursor-1])) cursor--;
      if(cursor===start) break; const wordEnd=cursor;
      while(cursor>start&&!whitespace(text[cursor-1])) cursor--;
      words.push({start:cursor,end:wordEnd});
    } else {
      while(cursor<end&&whitespace(text[cursor])) cursor++;
      if(cursor===end) break; const wordStart=cursor;
      while(cursor<end&&!whitespace(text[cursor])) cursor++;
      words.push({start:wordStart,end:cursor});
    }
  }
  return reverse?words.reverse():words;
}

/** Source slices use JavaScript UTF16 offsets, preserving complete whitespace words. */
export function verifiedParentRepresentation(unit, parent, normalized, contextWords=60) {
  if (contextWords !== 60 || typeof normalized !== 'string' || !unit || !parent) throw new Error('The fixed context arm requires its actual retained parent and 60-word policy.');
  if (parent.id !== unit.parent_section_id || parent.contract_id !== unit.contract_id || parent.cohort !== unit.cohort) throw new Error('Parent identity/cohort differs from the admitted unit.');
  if (![parent.start,parent.end,unit.start,unit.end].every(Number.isSafeInteger) || parent.start < 0 || parent.end > normalized.length || parent.start > unit.start || unit.end > parent.end || unit.start > unit.end) throw new Error('Verified parent does not contain the exact admitted unit span.');
  if (!validHash(unit.sha256) || sha256(unit.text) !== unit.sha256 || normalized.slice(unit.start,unit.end) !== unit.text) throw new Error('Unit text/hash differs from its normalized source span.');
  if (!validHash(parent.sha256) || sha256(normalized.slice(parent.start,parent.end)) !== parent.sha256) throw new Error('Parent text/hash differs from its normalized source span.');
  verifySourceNavigation(unit,normalized);
  const before = nearestWords(normalized,parent.start,unit.start,true); const after = nearestWords(normalized,unit.end,parent.end,false);
  let left = Math.min(30,before.length); let right = Math.min(30,after.length);
  left += Math.min(60-left-right,before.length-left); right += Math.min(60-left-right,after.length-right);
  const beforeStart = left ? before[before.length-left].start : unit.start;
  const afterEnd = right ? after[right-1].end : unit.end;
  const heading = sourceNavigationLabel(unit);
  const currentNative=unit.native_source_decorations_ref!==undefined||unit.native_source_decorations!==undefined;
  return {primary:currentNative?unit.text:`${heading}\n${unit.text}`, contextual:currentNative?normalized.slice(beforeStart,afterEnd):`${heading}\n${normalized.slice(beforeStart,afterEnd)}`,
    provenance:{unit_id:unit.id, parent_section_id:parent.id, unit_sha256:unit.sha256, parent_sha256:parent.sha256, heading_sha256:sha256(heading),
      unit_start:unit.start, unit_end:unit.end, parent_start:parent.start, parent_end:parent.end, context_start:beforeStart, context_end:afterEnd,
      before_words:left, after_words:right, maximum_neighbor_words:60, offsets:'JavaScript UTF16 normalized-source offsets, not raw byte offsets',
      policy:policy.context, heading_input_policy:currentNative?HEADING_INPUT_POLICY:LEGACY_HEADING_INPUT_POLICY, heading_source:currentNative?'EXCLUDED_NAVIGATION_METADATA_ONLY':Object.hasOwn(unit,'source_navigation')?'LITERAL_SOURCE_NAVIGATION_UNVERIFIED':'LEGACY_INHERITED_HEADING_UNVERIFIED', inherited_heading_is_provisional:true}};
}

function featureHash(value) {let hash = 2166136261; for (const byte of Buffer.from(value, 'utf8')) hash = Math.imul(hash ^ byte, 16777619) >>> 0; return hash;}
export function lexicalFeatures(text, {dimensions=2048, minTokenChars=2}={}) {
  if (dimensions !== 2048 || minTokenChars !== 2 || typeof text !== 'string') throw new Error('Lexical baseline policy is fixed at 2048 buckets and minimum token length 2.');
  const tokens = (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_'’-]*/gu) || []).filter(token=>token.length>=minTokenChars);
  if (tokens.length > 8192) throw new Error('Lexical input exceeds its bounded token count.');
  const terms = new Map(); const add = term=>terms.set(term,(terms.get(term)||0)+1);
  tokens.forEach(token=>add(`w:${token}`)); for (let i=1; i<tokens.length; i++) add(`b:${tokens[i-1]}\0${tokens[i]}`);
  const tf = new Float64Array(dimensions); const present = new Set();
  for (const [term, frequency] of terms) {const hash = featureHash(term); const bucket = hash % dimensions; const sign = (hash & 0x80000000) ? -1 : 1; tf[bucket] += sign*(1+Math.log(frequency)); present.add(bucket);}
  return {tf, present, tokens:tokens.length, features:terms.size};
}
export function lexicalVector(text, model) {
  if (model.dimensions !== 2048 || model.idf?.length !== 2048) throw new Error('Lexical model dimensions differ.');
  const feature = lexicalFeatures(text); for (let i=0; i<2048; i++) feature.tf[i] *= model.idf[i];
  if (!feature.tf.some(value=>value!==0)) throw new Error('Lexical baseline has no nonzero source signal; same-unit comparison cannot invent a replacement direction.');
  return normalizeFloat32(feature.tf);
}

async function sourceBindings() {
  const names = ['sensitivity.mjs','representation.mjs','embedding.mjs','analysis.mjs','source-decoration.mjs','native-decoration-store.mjs','sections.mjs','source-issues.mjs','quality.mjs','audit.mjs','geometry.mjs','vector-cache.mjs','store.mjs','workflow.mjs','../../lib/common.mjs','../../lib/discover.mjs','../../package-lock.json','../comparison-recipe.json'];
  const files = []; for (const name of names) {const bytes = await readFile(resolve(directory,name)); files.push({path:name,bytes:bytes.length,sha256:sha256(bytes)});} return files;
}
async function qualityGate(run, admission, fullTarget) {
  const source = admission.input?.extraction_source_sha256; if (!validHash(source)) throw new Error('Admission must bind its exact extraction source identity.');
  let authoritative=null;
  if(fullTarget){await assertNoUnresolvedSourceIssues(run,source);authoritative=await verifyCalibrationGate(run);if(authoritative.source_sha256!==source)throw new Error('Full sensitivity admission differs from the authoritative current extraction source');}
  const path = `quality-gates/${source}/gate.json`; const gate = await optional(run,path);
  if (!gate) {if (fullTarget) throw new Error('Full comparison requires the exact source-specific calibration quality gate; no inference started.'); return {status:'NOT_AVAILABLE_PRE_GATE_ENGINEERING_ONLY',path,source_sha256:source,semantic_validity_established:false};}
  const fresh = gate.fresh_audit;
  if (gate.schema_version !== 2 || gate.status !== 'CALIBRATION_GATE_PASSED' || gate.authority !== 'NONE' || gate.extraction_source_sha256 !== source || fresh?.target !== 100 || fresh.reviewed !== 100 || !Number.isSafeInteger(fresh.adequate) || fresh.adequate < 95 || fresh.adequate > 100 || fresh.unresolved_material_losses !== 0 || !validHash(fresh.review_sha256) || !validHash(gate.development_audit_review_sha256)) throw new Error('Source-specific quality gate is incomplete or does not pass its declared fresh audit.');
  const calibrationBinding = {path:gate.calibration_extraction_manifest_path,sha256:gate.calibration_extraction_manifest_sha256,bytes:(await hashFile(await studyPath(run,gate.calibration_extraction_manifest_path))).bytes};
  const calibration = await bound(run,calibrationBinding);
  const manifest = JSON.parse(await readFile(calibration,'utf8')); if (manifest.source?.sha256 !== source) throw new Error('Quality-gate calibration extraction source differs.');
  const reviews = [];
  for (const [name,hash] of [[fresh.review_path,fresh.review_sha256],[gate.development_audit_review_path,gate.development_audit_review_sha256]]) {
    if (name) {const record = await receipt(run,name); if (record.sha256 !== hash) throw new Error('Quality-gate actual judge-record digest differs.'); reviews.push(record);}
  }
  if (fullTarget && reviews.length !== 2) throw new Error('Full comparison gate must bind both actual development and fresh judge-record paths.');
  return {status:gate.status,binding:await receipt(run,path),source_sha256:source,calibration_extraction:calibrationBinding,fresh_audit:fresh,review_bindings:reviews,verification_scope:fullTarget?'AUTHORITATIVE_CURRENT_SOURCE_AND_GLOBAL_HOLD':'STORED_GATE_METADATA_ONLY_PARTIAL_ENGINEERING',...(authoritative?{authoritative}:{}),
    semantic_validity_established:false,interpretation:'Passing representation audit permits this engineering comparison; it does not validate prior meanings or participant suitability.'};
}

/** Public real check for callers/tests; stored passing JSON is insufficient. */
export async function verifyFullSensitivityGate(run,admission){requireContainer();return qualityGate(run,admission,true);}

async function gateFingerprint(run,source){
  const entries=[];
  for(const name of ['source-issues/observed',`source-issues/resolutions/${source}`,'representation-issues/observed',`representation-issues/resolutions/${source}`]){
    let files;try{files=await readdir(await studyPath(run,name),{withFileTypes:true});}catch(error){if(error.code==='ENOENT'){entries.push({directory:name,files:[]});continue;}throw error;}
    if(files.length>1000||files.some(file=>!file.isFile()||!/^issue-[a-f0-9]{64}\.json$/u.test(file.name)))throw new Error('Source gate registry fingerprint has unsupported entries');
    const boundFiles=[];for(const file of files.sort((a,b)=>a.name.localeCompare(b.name))){const path=`${name}/${file.name}`,binding=await hashFile(await studyPath(run,path));if(binding.bytes>1024**2)throw new Error('Source gate registry fingerprint exceeds its metadata bound');boundFiles.push({path,...binding});}entries.push({directory:name,files:boundFiles});
  }
  const path=`quality-gates/${source}/gate.json`;let gate;try{gate={path,...await hashFile(await studyPath(run,path))};}catch(error){if(error.code!=='ENOENT')throw error;gate=null;}
  const policyPath=`representation-issues/replay-policies/${source}.json`,replayControls=[];
  let replayPolicy=null;try{replayPolicy=await readJSON(run,policyPath,{maxBytes:128*1024});}catch(error){if(error.code!=='ENOENT')throw error;}
  if(replayPolicy){
    if(replayPolicy.schema!=='partial-representation-replay-policy-v1'||replayPolicy.extraction_source_sha256!==source)throw new Error('Replay policy control scope differs');
    const policyBinding=await hashFile(await studyPath(run,policyPath));if(policyBinding.bytes>128*1024)throw new Error('Replay policy control exceeds its metadata bound');replayControls.push({path:policyPath,...policyBinding});
    for(const ref of [replayPolicy.protocol_ref,replayPolicy.reviewer_assignments]){
      if(typeof ref?.path!=='string'||!validHash(ref.sha256)||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>128*1024)throw new Error('Exact bounded replay policy control reference required');
      const actual=await hashFile(await studyPath(run,ref.path));if(actual.sha256!==ref.sha256||actual.bytes!==ref.bytes)throw new Error('Replay policy control binding differs');
      replayControls.push({path:ref.path,...actual});
    }
  }
  const observed=entries.filter(entry=>entry.directory.endsWith('/observed')).flatMap(entry=>entry.files);
  return {sha256:digest({gate,entries,replayControls}),observed_paths:observed.map(file=>file.path),observed_refs:observed};
}

/** Content checks detect gate/registry changes between bounded full checks.
 * The production verifier is hard-wired, including in synthetic tests. */
export async function createSensitivitySourceGuard(run,admission,{fullTarget=false}={}){
  requireContainer();if(typeof fullTarget!=='boolean')throw new Error('Explicit full-target source guard scope required');
  if(!fullTarget)return {scope:'PARTIAL_PRE_GATE_ENGINEERING_ONLY',checkpoint:async()=>{},beforeInference:async()=>{}};
  const source=admission.input?.extraction_source_sha256;if(!validHash(source))throw new Error('Full sensitivity source guard requires its admission source');
  let verified=null,gateSHA=null;const observed=new Map(),memoryPath=`sensitivity-source-guards/${source}/observed`;
  const remember=async ref=>{
    if(!/^(?:source-issues|representation-issues)\/observed\/issue-[a-f0-9]{64}\.json$/u.test(ref?.path??'')||!validHash(ref.sha256)||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>1024**2)throw new Error('Persisted source guard requires exact bounded observed receipt references');
    const previous=observed.get(ref.path);if(previous&&digest(previous)!==digest(ref))throw new Error('Previously observed source-issue receipt changed; no inference may replace a known issue');
    if(!previous){const name=(ref.path.startsWith('representation-issues/')?'representation-':'')+ref.path.split('/').at(-1);await json(run,`${memoryPath}/${name}`,{schema:'sensitivity-observed-source-reference-v1',source_sha256:source,issue:ref,authority:'NONE'});observed.set(ref.path,ref);}
  };
  let retained=[];try{retained=await readdir(await studyPath(run,memoryPath),{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  if(retained.length>2000||retained.some(file=>!file.isFile()||!/^(?:representation-)?issue-[a-f0-9]{64}\.json$/u.test(file.name)))throw new Error('Persisted source guard contains unsupported records');
  for(const file of retained){const record=await readJSON(run,`${memoryPath}/${file.name}`,{maxBytes:4096}),expected=file.name.startsWith('representation-')?`representation-issues/observed/${file.name.slice('representation-'.length)}`:`source-issues/observed/${file.name}`;if(record.schema!=='sensitivity-observed-source-reference-v1'||record.source_sha256!==source||record.authority!=='NONE'||record.issue?.path!==expected)throw new Error('Persisted source guard record differs');await remember(record.issue);}
  // The sealed gate is an independent historical snapshot even if this stage
  // has never run before. Remember it before testing today's registry contents.
  const sealed=await optional(run,`quality-gates/${source}/gate.json`),legacySeed=sealed?.observed_source_issues?.issues??[],representationSeed=sealed?.observed_source_issues?.representation_issues?.issues??[];
  if(!Array.isArray(legacySeed)||legacySeed.length>1000||!Array.isArray(representationSeed)||representationSeed.length>1000)throw new Error('Sealed observed-source snapshot exceeds its bound');for(const item of [...legacySeed,...representationSeed])await remember(item.issue);
  const retainedIssues=async state=>{const current=new Map(state.observed_refs.map(ref=>[ref.path,ref]));for(const [path,ref]of observed){if(!current.has(path))throw new Error('Previously observed source-issue receipt removed; no inference may forget a known issue');if(digest(current.get(path))!==digest(ref))throw new Error('Previously observed source-issue receipt changed; no inference may replace a known issue');}for(const ref of state.observed_refs)await remember(ref);};
  const checkpoint=async()=>{const before=await gateFingerprint(run,source);await retainedIssues(before);const result=await verifyFullSensitivityGate(run,admission);const after=await gateFingerprint(run,source);await retainedIssues(after);if(before.sha256!==after.sha256)throw new Error('Source gate/registry changed during authoritative verification; retry before inference');if(gateSHA!==null&&gateSHA!==result.binding.sha256)throw new Error('Frozen full-target quality-gate bytes changed; retry with a new study identity');gateSHA=result.binding.sha256;verified=after.sha256;return result;};
  const beforeInference=async()=>{const current=await gateFingerprint(run,source);await retainedIssues(current);if(current.sha256!==verified)await checkpoint();};
  await checkpoint();return {scope:'AUTHORITATIVE_FULL_TARGET_CHECKPOINTS',checkpoint,beforeInference};
}

async function frozenSelection(run, admission, comparison, prefix, db) {
  const views = []; for (const item of unitShards(admission)) views.push(sqlQuote(await bound(run,item)));
  await db.connection.run(`CREATE VIEW units AS SELECT * FROM read_parquet([${views.join(',')}])`);
  const query = async sql=>(await db.connection.runAndReadAll(sql)).getRowObjectsJS();
  const invalid = await query("SELECT count(*) AS n FROM units WHERE cohort IS NULL OR cohort NOT IN ('discovery-broad','discovery-relevant') OR json_extract_string(payload,'$.cohort') IS NULL OR json_extract_string(payload,'$.cohort')!=cohort OR json_extract_string(payload,'$.id')!=id OR json_extract_string(payload,'$.contract_id')!=contract_id");
  const duplicates = await query('SELECT count(*)-count(DISTINCT id) AS n FROM units');
  if (count(invalid[0].n) || count(duplicates[0].n)) throw new Error('Reserve, mismatched or repeated representative identity entered sensitivity admission.');
  const mixed = await query('SELECT contract_id FROM units GROUP BY contract_id HAVING count(DISTINCT cohort)>1 LIMIT 1'); if (mixed.length) throw new Error('One comparison contract spans discovery cohorts.');
  const totals = (await query('SELECT count(*) AS units,count(DISTINCT contract_id) AS contracts FROM units'))[0];
  const seed = sqlQuote(`${comparison.seed}:`);
  const records = await query(`WITH ranked AS (SELECT id,contract_id,cohort,json_extract_string(payload,'$.family_id') AS family_id,row_number() OVER (PARTITION BY contract_id ORDER BY sha256(${seed}||id),id) AS rank FROM units) SELECT id,contract_id,cohort,family_id FROM ranked WHERE rank<=${comparison.perContract} ORDER BY rank,sha256(${seed}||contract_id),contract_id,id LIMIT ${comparison.unitTarget}`);
  if (records.length < 2) throw new Error('Sensitivity needs at least two admitted discovery representatives.');
  const rows = records.map(row=>({...row,family_id:row.family_id||row.id,partition:'fit'}));
  const reservoir = createBalancedReservoir({capacity:comparison.geometry.reservoirSize,perContract:comparison.perContract,perFamily:policy.per_family,dimensions:1,seed:comparison.geometry.seed});
  for (const row of rows) reservoir.add(row,Float32Array.of(1));
  const training = reservoir.snapshot();
  const result = {schema_version:2,status:'FROZEN_BEFORE_COMPARISON_INFERENCE',authority:'NONE',adopted_catalog:false,selection:comparison.selection,seed:comparison.seed,
    unit_target:comparison.unitTarget,selected_units:rows.length,target_shortage:comparison.unitTarget-rows.length,admitted_representatives:count(totals.units),admitted_contracts:count(totals.contracts),selected_contracts:new Set(rows.map(row=>row.contract_id)).size,
    per_contract:comparison.perContract,unit_ids:rows.map(row=>row.id),ordered_units_sha256:evaluationDigest(rows),rows,
    training:{unit_ids:training.rows.map(row=>row.id),sha256:evaluationDigest(training.rows),statistics:training.statistics},
    evaluation:{unit_ids:rows.slice(0,Math.min(comparison.geometry.evaluationSize,rows.length)).map(row=>row.id),sha256:evaluationDigest(rows.slice(0,Math.min(comparison.geometry.evaluationSize,rows.length)))},
    exact:{unit_ids:rows.slice(0,Math.min(policy.exact_subset,rows.length)).map(row=>row.id),sha256:evaluationDigest(rows.slice(0,Math.min(policy.exact_subset,rows.length)))},
    evaluation_partition:'DISCOVERY_IN_SAMPLE_NOT_RESERVE',reserve_accessed:false};
  const binding = await json(run,`${prefix}/selection.json`,result); return {...result,binding};
}

async function freezeInputs(run, admission, selection, prefix, db, tracker, log) {
  const sectionFiles = [];
  for (const item of admission.input?.sections_shards || []) sectionFiles.push(sqlQuote(await bound(run,item)));
  if (!sectionFiles.length) throw new Error('Context comparison requires explicit retained parent-section shards.');
  await db.connection.run(`CREATE VIEW parents AS SELECT * FROM read_parquet([${sectionFiles.join(',')}])`);
  const extractionPath = admission.input.extraction_manifest_path;
  const extractionBinding = await receipt(run,extractionPath);
  const extraction = await readJSON(run,extractionPath,{maxBytes:128*1024*1024});
  const {manifest_path:ignored,...extractionBody} = extraction; const declared = admission.input.extraction_manifest_sha256;
  const declaredFile = admission.input.extraction_manifest_file||admission.source?.input_manifest_file;
  if (declaredFile && (declaredFile.sha256!==extractionBinding.sha256 || declaredFile.bytes!==extractionBinding.bytes)) throw new Error('Sensitivity extraction manifest byte binding differs from admission.');
  if (declared!==extractionBinding.sha256 && declared!==digest(extractionBody)) throw new Error('Sensitivity extraction manifest hash differs from admission.');
  const extractionEncoding = declared===extractionBinding.sha256?'exact-file-sha256':'canonical-finite-json-sha256';
  if (extraction.source?.sha256 !== admission.input.extraction_source_sha256) throw new Error('Extraction source identity differs from sensitivity admission.');
  const contracts = new Map((extraction.contract_records||[]).map(row=>[row.id,row])); if (contracts.size !== (extraction.contract_records||[]).length) throw new Error('Extraction contract identity is repeated.');
  const normalizedBindings = new Map(); const loaded = new Map(); const shards = []; let total = 0;const prepareNative=createStudyNativeInputLoader(run,admission);
  for (let start=0; start<selection.rows.length; start+=500) {
    const desired = selection.rows.slice(start,start+500); const ids = desired.map(row=>sqlQuote(row.id));
    const found = (await db.connection.runAndReadAll(`SELECT u.id,u.contract_id,u.cohort,u.payload,json_extract_string(p.payload,'$.id') AS parent_id,json_extract_string(p.payload,'$.contract_id') AS parent_contract_id,json_extract_string(p.payload,'$.cohort') AS parent_cohort,p.cohort AS parent_row_cohort,json_extract(p.payload,'$.start') AS parent_start,json_extract(p.payload,'$.end') AS parent_end,json_extract_string(p.payload,'$.sha256') AS parent_sha256 FROM units u LEFT JOIN parents p ON p.id=json_extract_string(u.payload,'$.parent_section_id') WHERE u.id IN (${ids.join(',')})`)).getRowObjectsJS();
    const map = new Map(); for (const row of found) {if (map.has(row.id)) throw new Error('Repeated actual parent makes context lineage ambiguous.'); map.set(row.id,row);}
    const inputs = [];
    for (const frozen of desired) {
      const row = map.get(frozen.id); if (!row || !row.parent_id) throw new Error('A frozen comparison unit has no actual retained parent; no arm may silently drop it.');
      const unit = JSON.parse(row.payload); const record = contracts.get(unit.contract_id);
      if (unit.id !== row.id || unit.contract_id !== row.contract_id || unit.cohort !== row.cohort || !cohorts.has(unit.cohort) || unit.family_id && unit.family_id !== frozen.family_id) throw new Error('Frozen comparison source identity changed.');
      if (!record || record.normalized_path !== unit.normalized_path || !validHash(record.normalized_sha256) || !validHash(record.raw_sha256)) throw new Error('Comparison needs extraction-bound raw/normalized source provenance.');
      if (row.parent_cohort && row.parent_cohort !== row.parent_row_cohort) throw new Error('Parent payload cohort differs from its source row.');
      const parent = {id:row.parent_id,contract_id:row.parent_contract_id,cohort:row.parent_row_cohort,start:Number(row.parent_start),end:Number(row.parent_end),sha256:row.parent_sha256};
      let normalized = loaded.get(unit.normalized_path);
      if (!normalized) {
        const sourcePath = await studyPath(run,unit.normalized_path); const previous = normalizedBindings.get(unit.normalized_path);
        // Once bound, one bounded read supplies both the text and recheck, avoiding two
        // full reads for each repeated contract in the round-robin selection stream.
        const sourceBinding = previous || await hashFile(sourcePath);
        if (sourceBinding.bytes > 8*1024*1024 || sourceBinding.sha256 !== record.normalized_sha256) throw new Error('Normalized comparison source exceeds bounds or differs from extraction digest.');
        if ((await stat(sourcePath)).size!==sourceBinding.bytes) throw new Error('Normalized comparison source changed after binding.');
        const bytes = await readFile(sourcePath); if (bytes.length!==sourceBinding.bytes || sha256(bytes)!==sourceBinding.sha256) throw new Error('Normalized comparison source changed after binding.');
        normalized = bytes.toString('utf8'); loaded.set(unit.normalized_path,normalized); if (loaded.size>2) loaded.delete(loaded.keys().next().value);
        normalizedBindings.set(unit.normalized_path,{path:unit.normalized_path,...sourceBinding,contract_id:unit.contract_id,raw_source_sha256:record.raw_sha256});
      }
      const representation = verifiedParentRepresentation(unit,parent,normalized);
      const payload = {row:frozen,primary:representation.primary,contextual:representation.contextual,source_text:unit.text,
        primary_sha256:sha256(representation.primary),contextual_sha256:sha256(representation.contextual),source_url:unit.source_url||null,
        provenance:{...representation.provenance,normalized_path:unit.normalized_path,normalized_sha256:record.normalized_sha256,raw_source_sha256:record.raw_sha256}};
      if(unit.native_source_decorations_ref){
        const primary=await prepareNative(unit),contextual=await prepareNative(unit,{bodyRange:{start:representation.provenance.context_start,end:representation.provenance.context_end}});
        payload.native={source_unit:unit,primary:{descriptor:primary.native_input.descriptor,input_sha256:modelInputIdentity(primary).input_sha256},contextual:{descriptor:contextual.native_input.descriptor,input_sha256:modelInputIdentity(contextual).input_sha256}};
      }else if(record.native_source_decorations)throw new Error('Current native comparison unit lost its source reference; plain fallback forbidden');
      inputs.push({id:unit.id,contract_id:unit.contract_id,cohort:unit.cohort,kind:'FROZEN_SENSITIVITY_INPUT',payload:JSON.stringify(payload)});
    }
    const path = `${prefix}/inputs/batch-${String(start/500).padStart(6,'0')}.parquet`; shards.push(await shard(run,path,inputs)); total += inputs.length; tracker.sample(); log(`Frozen verified comparison inputs: ${total}/${selection.selected_units}`);
  }
  const result = {schema_version:2,status:'ALL_SOURCE_STRINGS_AND_NATIVE_DESCRIPTORS_FROZEN_BEFORE_INFERENCE',rows:total,ordered_units_sha256:selection.ordered_units_sha256,shards,
    source_bindings:[extractionBinding,...[...normalizedBindings.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'))],verified_parent_coverage:total/selection.selected_units,
    extraction_manifest_digest_encoding:extractionEncoding,extraction_manifest_exact_file_binding:extractionBinding,context_neighbor_word_limit:60,source_representation_is_provisional:true,reserve_accessed:false};
  const binding = await json(run,`${prefix}/inputs/manifest.json`,result); return {...result,binding};
}

async function* inputBatches(run, inputs, selection) {
  let ordinal = 0;
  for (const item of inputs.shards) {
    await bound(run,item); const batch = [];
    for await (const row of readRows(run,item.path,{batchSize:500})) {
      const value = JSON.parse(row.payload); const frozen = selection.rows[ordinal++];
      if (!frozen || row.id !== frozen.id || value.row.id !== row.id || row.contract_id !== frozen.contract_id || row.cohort !== frozen.cohort || value.row.partition !== 'fit' || !cohorts.has(row.cohort) || sha256(value.primary)!==value.primary_sha256 || sha256(value.contextual)!==value.contextual_sha256) throw new Error('Frozen comparison input order, boundary or text digest differs.');
      batch.push(value); if (batch.length>500) throw new Error('Comparison input shard exceeds its bounded chunk.');
    }
    if (batch.length!==item.rows) throw new Error('Comparison input shard omits rows.'); yield batch;
  }
  if (ordinal!==selection.selected_units) throw new Error('Comparison inputs omit frozen identities.');
}

/** Shared preparation for every arm. Persisted descriptors authenticate source
 * selection; only the loader can restore the private native view for encoding.
 */
export async function prepareSensitivityInput(item,definition,prepareNative){
  if(!['unit-source-span','verified-parent-context-source-span'].includes(definition?.representation))throw new Error('Comparison requires the current contiguous source-span representation policy');
  const contextual=definition.representation==='verified-parent-context-source-span',text=contextual?item.contextual:item.primary;
  if(!item.native)return {id:item.row.id,contextual_text:text};
  if(!item.native.source_unit?.native_source_decorations_ref)throw new Error('Frozen native sensitivity source reference is missing');
  const source=item.native.source_unit;
  const aligned=unit=>unit?.id===item.row.id&&unit.contract_id===item.row.contract_id&&unit.cohort===item.row.cohort&&cohorts.has(unit.cohort)&&(unit.family_id??unit.id)===(item.row.family_id??item.row.id);
  if(!aligned(source))throw new Error('Frozen native sensitivity outer/source identity, cohort or family differs');
  const expected=contextual?item.native.contextual:item.native.primary,prepared=await prepareNative(item.native.source_unit,contextual?{bodyRange:{start:item.provenance.context_start,end:item.provenance.context_end}}:{}),identity=modelInputIdentity(prepared);
  if(!aligned(prepared)||identity.native_evidence_status!=='BOUND_NATIVE_SOURCE_EVIDENCE'||identity.input_sha256!==expected.input_sha256||digest(identity.native_representation)!==digest(expected.descriptor))throw new Error('Frozen native sensitivity prepared identity or source descriptor differs');
  return prepared;
}

function nativeModelProvenance(prepared,engine,metadata){
  if(typeof engine.tokenCount!=='function'||!validHash(engine.window_policy_sha256))throw new Error('Native comparison proof requires the actual model tokenizer/window policy');
  const policy=engine.window_policy,result=prepareEmbeddingInput(prepared,engine.tokenCount,{maxTokens:policy.max_tokens,overlapWords:policy.overlap_words,maxWords:policy.max_words_per_unit});
  if(metadata?.unit_id!==prepared.id||metadata.window_policy_sha256!==engine.window_policy_sha256||metadata.model_revision!==engine.model.revision||metadata.cache_key!==embeddingCacheKey(result.input.input_sha256,engine.model.revision,engine.window_policy_sha256)||Object.keys(result.input).some(key=>digest(metadata[key]??null)!==digest(result.input[key])))throw new Error('Native comparison model provenance differs from actual source windows');
  return result.input;
}
function nativeLexicalProvenance(prepared,tokenCounter,metadata,trainingSHA){
  const {text:ignored,...expected}=sensitivityLexicalInput(prepared,tokenCounter);
  if(metadata?.unit_id!==prepared.id||metadata.lexical_training_sha256!==trainingSHA||Object.keys(expected).some(key=>digest(metadata[key]??null)!==digest(expected[key])))throw new Error('Native lexical provenance differs from actual source windows');
}

export function sensitivityLexicalInput(prepared,tokenCounter){
  const identity=modelInputIdentity(prepared);
  if(!prepared.native_input)return {text:identity.text,input_sha256:identity.input_sha256,native_evidence_status:identity.native_evidence_status};
  if(!tokenCounter?.tokenCount||!validHash(tokenCounter.policy_sha256))throw new Error('Native lexical input requires the verified baseline tokenizer');
  const result=prepareEmbeddingInput(prepared,tokenCounter.tokenCount),text=result.windows.map(window=>window.text).join('\n');
  return {text,input_sha256:identity.input_sha256,native_evidence_status:identity.native_evidence_status,encoded_sha256:sha256(text),tokenizer_policy_sha256:tokenCounter.policy_sha256,window_policy:result.policy,windows:result.input.windows};
}

async function lexicalModel(run, inputs, selection, prefix,prepareNative,tokenCounter,guard) {
  const training = new Set(selection.training.unit_ids); const df = new Uint32Array(2048); let documents=0; let tokens=0; let features=0;
  for await (const batch of inputBatches(run,inputs,selection)){await guard.checkpoint();for (const item of batch) if (training.has(item.row.id)) {
    await guard.beforeInference();
    const prepared=await prepareSensitivityInput(item,armDefinitions[3],prepareNative),actual=sensitivityLexicalInput(prepared,tokenCounter),feature = lexicalFeatures(actual.text); for (const bucket of feature.present) df[bucket]++; documents++; tokens+=feature.tokens; features+=feature.features;
  }}
  if (documents!==training.size) throw new Error('Lexical DF omits a frozen training unit.');
  const model = {schema_version:2,method:'signed-hashed-word-bigram-tfidf',dimensions:2048,documents,training_sha256:selection.training.sha256,document_frequency:Array.from(df),
    idf:Array.from(df,n=>Math.log((1+documents)/(1+n))+1),policy:policy.lexical,lowercase:true,min_token_chars:2,normalization:'final L2',tokens,features,
    occupied_buckets:df.filter(n=>n>0).length,collision_warning:'Hash buckets combine unrelated terms; sign cancellation and collision are lexical-baseline limitations.'};
  return {...model,binding:await json(run,`${prefix}/lexical-model.json`,model)};
}

function decode(bytes, dimensions, expectedRows) {
  if (bytes.length!==expectedRows*dimensions*4) throw new Error('Comparison vector shard length differs.'); const vectors = new Float32Array(bytes.length/4);
  for (let i=0; i<vectors.length; i++) {vectors[i]=bytes.readFloatLE(i*4); if (!Number.isFinite(vectors[i])) throw new Error('Nonfinite comparison vector bytes.');} return vectors;
}
async function readVectorShard(run,item,selection,armId) {
  const manifest = await readJSON(run,item.path); const bytes = await readFile(await bound(run,manifest.vectors));
  if (manifest.arm!==armId || manifest.frozen_units_sha256!==selection.ordered_units_sha256 || manifest.rows>500 || manifest.rows!==item.rows || manifest.unit_ids.length!==manifest.rows || digest(manifest.unit_ids)!==manifest.ordered_ids_sha256) throw new Error('Comparison vector manifest identity differs.');
  return {manifest,vectors:decode(bytes,manifest.dimensions,manifest.rows)};
}

async function runArm(run, definition, engine, lexical, inputs, selection, comparison, prefix, tracker, log,prepareNative,tokenCounter,guard) {
  const dimensions = definition.model==='lexical' ? 2048 : engine.model.dimensions;
  if (definition.model!=='lexical' && dimensions!==384) throw new Error('Comparison model dimensions must match the frozen 384-dimension CPU recipe.');
  const embeddingSource = (await sourceBindings()).find(item=>item.path==='embedding.mjs').sha256;
  const cache = engine ? await createChunkVectorCache(run,{model:engine.model,window_policy:engine.window_policy,embedding_source:embeddingSource},{dimensions}) : null;
  const armPrefix = `${prefix}/${definition.id}`; const shards = []; let ordinal=0; let hits=0; let newUnits=0; let calls=0; const started=Date.now();
  for await (const batch of inputBatches(run,inputs,selection)) {
    await guard.checkpoint();
    const path = `${armPrefix}/batch-${String(ordinal++).padStart(6,'0')}.json`; const ids = batch.map(item=>item.row.id);
    const texts = batch.map(item=>definition.representation==='verified-parent-context-source-span'?item.contextual:item.primary),keys=batch.map((item,i)=>item.native?(definition.representation==='verified-parent-context-source-span'?item.native.contextual:item.native.primary).input_sha256:sha256(texts[i])); const inputHash = digest(keys);
    let retained = await optional(run,path);
    if (retained) {
      if (retained.arm!==definition.id || retained.dimensions!==dimensions || retained.ordered_ids_sha256!==digest(ids) || retained.input_sha256!==inputHash || retained.frozen_units_sha256!==selection.ordered_units_sha256 || retained.rows!==batch.length || retained.inputs?.length!==batch.length) throw new Error('Comparison resume arm inputs changed.');
      const expectedModel = engine?.model||{method:lexical.method,dimensions:2048,model_binding:lexical.binding};
      if (digest(retained.model)!==digest(expectedModel) || digest(retained.window_policy)!==digest(engine?.window_policy||null)) throw new Error('Comparison resume model or window policy differs.');
      for (let i=0;i<ids.length;i++) if (retained.inputs[i].unit_id!==ids[i] || retained.inputs[i].input_sha256!==keys[i]) throw new Error('Comparison resume ordered input provenance differs.');
      for(let i=0;i<ids.length;i++)if(batch[i].native){const prepared=await prepareSensitivityInput(batch[i],definition,prepareNative);if(engine)nativeModelProvenance(prepared,engine,retained.inputs[i]);else nativeLexicalProvenance(prepared,tokenCounter,retained.inputs[i],lexical.training_sha256);}
      await bound(run,retained.vectors); decode(await readFile(await studyPath(run,retained.vectors.path)),dimensions,batch.length);
    } else {
      const packed = new Float32Array(batch.length*dimensions); const records = new Array(batch.length); const missing = []; let cacheHits=0,directNative=0;
      if (engine) {
        for (let i=0; i<batch.length; i++) {
          const found = await cache.get(keys[i]);if(found){if(batch[i].native)nativeModelProvenance(await prepareSensitivityInput(batch[i],definition,prepareNative),engine,found.input);packed.set(found.vector,i*dimensions);records[i]={...found.input,unit_id:ids[i]};cacheHits++;continue;}
          if(batch[i].native){
            // Await and release each authenticated view before hydrating the
            // next round-robin contract. Vectors/receipts are the only retained data.
            const prepared=await prepareSensitivityInput(batch[i],definition,prepareNative);await guard.beforeInference();const fresh=await engine.embedUnits([prepared]);calls++;
            if(fresh.dimensions!==dimensions||fresh.inputs.length!==1||fresh.packed_vectors.length!==dimensions||fresh.inputs[0].input_sha256!==keys[i])throw new Error('Native comparison inference differs from frozen source identity');
            nativeModelProvenance(prepared,engine,fresh.inputs[0]);
            packed.set(fresh.packed_vectors,i*dimensions);records[i]={...fresh.inputs[0],unit_id:ids[i]};await cache.put(fresh);directNative++;
          }else missing.push({id:ids[i],contextual_text:texts[i],index:i});
        }
        if (missing.length) {
          await guard.beforeInference();
          const fresh = await engine.embedUnits(missing); calls++;
          if (fresh.dimensions!==dimensions || fresh.inputs.length!==missing.length || fresh.packed_vectors.length!==missing.length*dimensions) throw new Error('Comparison inference output does not align with actual frozen inputs.');
          for (let i=0; i<missing.length; i++) {if (fresh.inputs[i].input_sha256!==sha256(missing[i].contextual_text)) throw new Error('Comparison inference used a different text.'); packed.set(fresh.packed_vectors.subarray(i*dimensions,(i+1)*dimensions),missing[i].index*dimensions); records[missing[i].index]={...fresh.inputs[i],unit_id:missing[i].id};}
          await cache.put(fresh);
        }
      } else for (let i=0; i<batch.length; i++) {await guard.beforeInference();const prepared=await prepareSensitivityInput(batch[i],definition,prepareNative),actual=sensitivityLexicalInput(prepared,tokenCounter);packed.set(lexicalVector(actual.text,lexical),i*dimensions);const {text:ignored,...provenance}=actual;records[i]={unit_id:ids[i],...provenance,lexical_training_sha256:lexical.training_sha256};}
      const vectorReceipt = await binary(run,`${armPrefix}/batch-${String(ordinal-1).padStart(6,'0')}.f32`,packed);
      retained = {schema_version:2,arm:definition.id,representation:definition.representation,rows:batch.length,dimensions,unit_ids:ids,ordered_ids_sha256:digest(ids),
        frozen_units_sha256:selection.ordered_units_sha256,input_sha256:inputHash,inputs:records,vectors:vectorReceipt,encoding:'float32-le',cache_hits:cacheHits,new_units:engine?missing.length+directNative:batch.length,
        model:engine?.model||{method:lexical.method,dimensions:2048,model_binding:lexical.binding},window_policy:engine?.window_policy||null,synthetic_runtime:engine?.window_policy?.runtime==='DECLARED_SYNTHETIC_INJECTED_RUNTIME',execution_attested:false};
      await json(run,path,retained);
    }
    shards.push({...await receipt(run,path),rows:batch.length,vectors:retained.vectors}); hits+=retained.cache_hits; newUnits+=retained.new_units; tracker.sample(); log(`Sensitivity ${definition.id}: retained ${Math.min(ordinal*500,selection.selected_units)}/${selection.selected_units} same-unit vectors`);
  }
  const result = {schema_version:2,arm:definition.id,...definition,dimensions,rows:selection.selected_units,ordered_units_sha256:selection.ordered_units_sha256,shards,model:engine?.model||{method:lexical.method,binding:lexical.binding},
    window_policy:engine?.window_policy||null,vector_cache:cache?.prefix||null,cache_stats:{retained_chunk_cache_hits:hits,retained_chunk_new_units:newUnits,new_inference_chunks_this_invocation:calls},elapsed_seconds:(Date.now()-started)/1000,authority:'NONE',execution_attested:false};
  // Preserve immutable duration/call counts after a completed arm; verify every bound shard.
  const existing = await optional(run,`${armPrefix}/manifest.json`);
  if (existing) {if (existing.ordered_units_sha256!==result.ordered_units_sha256 || digest(existing.shards)!==digest(result.shards)) throw new Error('Retained sensitivity arm differs.'); return {...existing,binding:await receipt(run,`${armPrefix}/manifest.json`)};}
  return {...result,binding:await json(run,`${armPrefix}/manifest.json`,result)};
}

async function geometryForArm(run, arm, selection, comparison, prefix, tracker) {
  const trainingMap = new Map(selection.training.unit_ids.map((id,i)=>[id,i])); const evalMap = new Map(selection.evaluation.unit_ids.map((id,i)=>[id,i]));
  const exactMap = arm.id==='baseline-heading-unit' ? new Map(selection.exact.unit_ids.map((id,i)=>[id,i])) : new Map();
  const training = new Float32Array(trainingMap.size*arm.dimensions); const evaluation = new Float32Array(evalMap.size*arm.dimensions); const exact = new Float32Array(exactMap.size*arm.dimensions); let ordinal=0;
  for (const item of arm.shards) {
    await bound(run,item); const {manifest,vectors} = await readVectorShard(run,item,selection,arm.id);
    for (let i=0; i<manifest.rows; i++) {
      const id = manifest.unit_ids[i]; if (id!==selection.unit_ids[ordinal++]) throw new Error('Same-unit vector order changed across comparison arms.');
      const vector = vectors.subarray(i*arm.dimensions,(i+1)*arm.dimensions);
      for (const [map,matrix] of [[trainingMap,training],[evalMap,evaluation],[exactMap,exact]]) {const offset = map.get(id); if (offset!=null) matrix.set(vector,offset*arm.dimensions);}
    }
    tracker.sample();
  }
  if (ordinal!==selection.selected_units) throw new Error('Sensitivity arm omits same-unit vectors.');
  const rowsById = new Map(selection.rows.map(row=>[row.id,row])); const trainingRows = selection.training.unit_ids.map(id=>rowsById.get(id)); const evaluationRows = selection.evaluation.unit_ids.map(id=>rowsById.get(id));
  const options = {k:comparison.geometry.k,seed:comparison.geometry.seed,batchSize:comparison.geometry.batchSize,iterations:comparison.geometry.iterations,dimensions:arm.dimensions};
  const fitted = fitMiniBatch(trainingRows,training,options); tracker.sample(); const assignments = assignVectors(evaluationRows,evaluation,fitted);
  const result = {schema_version:2,arm:arm.id,requested_k:options.k,effective_k:fitted.effective_k,dimensions:arm.dimensions,centroids:Array.from(fitted.centroids),counts:Array.from(fitted.counts),method:fitted.method,warnings:fitted.warnings,
    training_sha256:selection.training.sha256,evaluation_sha256:selection.evaluation.sha256,evaluation_labels:assignments.map(row=>row.label),evaluation_similarity_mean:assignments.reduce((sum,row)=>sum+row.similarity,0)/assignments.length,
    evaluation_count:assignments.length,interpretation:policy.evaluation,authority:'NONE',execution_attested:false};
  const binding = await json(run,`${prefix}/${arm.id}/geometry.json`,result);
  let exactComparison = null;
  if (exactMap.size) {
    const sourceRows = new Map(); for await (const batch of inputBatches(run,await readJSON(run,`${prefix}/inputs/manifest.json`),selection)) for (const item of batch) if (exactMap.has(item.row.id)) sourceRows.set(item.row.id,{...item.row,text:item.source_text});
    const exactRows = selection.exact.unit_ids.map(id=>sourceRows.get(id));
    const mini = fitMiniBatch(exactRows,exact,options); const miniAssignments = assignVectors(exactRows,exact,mini);
    const exactResult = exactSmallComparator(exactRows,exact,{dimensions:arm.dimensions,maximumRows:2000,kValues:[comparison.geometry.k],seed:comparison.geometry.seed,repeats:1,maxIterations:30,silhouetteSampleSize:64,representativeCount:1});
    const runResult = exactResult.result.runs[0]; const clusterIndex = new Map(runResult.clusters.map((cluster,i)=>[cluster.id,i])); const assignmentById = new Map(runResult.assignments.map(row=>[row.clause_id,clusterIndex.get(row.cluster_id)]));
    const exactLabels = exactRows.map(row=>assignmentById.get(row.id));
    exactComparison = {schema_version:2,status:'BOUNDED_EXACT_METHOD_COMPARATOR',baseline_arm:arm.id,subset_count:exactRows.length,subset_sha256:selection.exact.sha256,requested_k:comparison.geometry.k,
      mini:{effective_k:mini.effective_k,method:mini.method,warnings:mini.warnings},exact:{method:exactResult.method,parameters:exactResult.result.parameters,seed:runResult.seed,effective_k:runResult.effective_k,iterations:runResult.iterations,converged:runResult.converged,warnings:runResult.warnings},
      comparison:comparePartitions({evaluation_sha256:selection.exact.sha256,labels:miniAssignments.map(row=>row.label)},{evaluation_sha256:selection.exact.sha256,labels:exactLabels}),
      interpretation:'Both methods fitted the same frozen <=2000 discovery subset at fixed k64. Initialization implementations/seeds differ; this is a method sensitivity diagnostic, not isolation of the update rule alone.'};
    exactComparison.binding = await json(run,`${prefix}/exact-small-comparator.json`,exactComparison); tracker.sample();
  }
  return {...result,binding,exact_comparison:exactComparison};
}

/** Explicit factory injection is labelled synthetic; it never establishes a real-study result. */
async function verifyCompletedProvenance(run,admission,existing,inputs,selection,{recipe,comparison,comparisonModel,synthetic,createBaselineEmbedder,createSecondEmbedder,guard}){
  const expected=armDefinitions.map(({id,model,representation})=>({id,model,representation,rows:selection.selected_units}));
  if(digest(existing.arms?.map(({id,model,representation,rows})=>({id,model,representation,rows}))??null)!==digest(expected))throw new Error('Completed sensitivity arm identities or row counts differ');
  await bound(run,existing.lexical_model);
  const prepareNative=createStudyNativeInputLoader(run,admission),engines=new Map();let lexicalCounter=null,lexicalModel=null;
  const engineFor=async definition=>{
    if(engines.has(definition.model))return engines.get(definition.model);
    const config={...(definition.model==='second'?comparison.secondModel:recipe.embedding),max_units:500,token_budget:recipe.embedding.tokenBudget};
    let engine;
    if(synthetic)engine=definition.model==='second'?await createSecondEmbedder(config,comparisonModel,{log:()=>{}}):await createBaselineEmbedder(config,{log:()=>{}});
    else{const counter=await createPinnedTokenCounter(config,definition.model==='second'?{manifest:comparisonModel}:{}),window_policy=embeddingWindowPolicy(config,counter.model);if(definition.model==='baseline')lexicalCounter=counter;engine={model:counter.model,tokenCount:counter.tokenCount,window_policy,window_policy_sha256:digest(window_policy)};}
    engines.set(definition.model,engine);return engine;
  };
  try{
    for(const [index,definition]of armDefinitions.entries()){
      await guard.checkpoint();const arm=existing.arms[index];await bound(run,arm.manifest);const record=await readJSON(run,arm.manifest.path),dimensions=definition.model==='lexical'?2048:384;let ordinal=0,shardIndex=0;
      if(arm.dimensions!==dimensions||record.dimensions!==dimensions||record.arm!==definition.id)throw new Error('Completed sensitivity arm dimensions or identity differ');
      for await(const batch of inputBatches(run,inputs,selection)){
        await guard.checkpoint();const item=record.shards[shardIndex++];if(!item)throw new Error('Completed sensitivity arm omits an input batch');await bound(run,item);
        const {manifest:retained}=await readVectorShard(run,item,selection,definition.id),ids=batch.map(item=>item.row.id),keys=batch.map(item=>item.native?(definition.representation==='verified-parent-context-source-span'?item.native.contextual:item.native.primary).input_sha256:sha256(definition.representation==='verified-parent-context-source-span'?item.contextual:item.primary));
        if(retained.dimensions!==dimensions||retained.rows!==batch.length||digest(retained.unit_ids)!==digest(ids)||retained.input_sha256!==digest(keys)||retained.inputs?.length!==batch.length)throw new Error('Completed sensitivity ordered input provenance differs');
        for(let i=0;i<batch.length;i++){
          if(retained.inputs[i].unit_id!==ids[i]||retained.inputs[i].input_sha256!==keys[i])throw new Error('Completed sensitivity ordered input provenance differs');
          if(!batch[i].native)continue;
          const prepared=await prepareSensitivityInput(batch[i],definition,prepareNative);await guard.beforeInference();
          if(definition.model==='lexical'){
            lexicalCounter??=await createPinnedTokenCounter(recipe.embedding);lexicalModel??=await readJSON(run,existing.lexical_model.path);nativeLexicalProvenance(prepared,lexicalCounter,retained.inputs[i],lexicalModel.training_sha256);
          }else{
            const engine=await engineFor(definition);if(digest(retained.model)!==digest(engine.model)||digest(retained.window_policy)!==digest(engine.window_policy))throw new Error('Completed sensitivity model or window policy differs');nativeModelProvenance(prepared,engine,retained.inputs[i]);
          }
        }
        ordinal+=retained.rows;
      }
      if(ordinal!==selection.selected_units||shardIndex!==record.shards.length)throw new Error('Completed sensitivity arm omits or adds retained rows');
    }
  }finally{for(const engine of engines.values())await engine.dispose?.();}
}

export async function runSensitivity(runDirectory, admission, {log=console.log, createBaselineEmbedder=createBatchEmbedder, createSecondEmbedder=createArtifactBatchEmbedder}={}) {
  requireContainer(); const run = validateStudyRoot(runDirectory); const tracker = memoryTracker();
  if (!admission || admission.authority!=='NONE' || admission.adopted_catalog===true || admission.gates?.reserve_accessed===true) throw new Error('Sensitivity requires research-only discovery admission with reserve untouched.');
  const synthetic = createBaselineEmbedder!==createBatchEmbedder || createSecondEmbedder!==createArtifactBatchEmbedder;
  const sourceRecipeBytes = await readFile(resolve(directory,'../comparison-recipe.json')); const sourceRecipe = JSON.parse(sourceRecipeBytes);
  const comparison = await readJSON(run,'comparison-plan.json');
  if (digest(comparison)!==digest(sourceRecipe) || comparison.unitTarget!==30000 || comparison.perContract!==20 || comparison.contextWords!==60 || comparison.geometry.k!==64 || comparison.geometry.reservoirSize!==20000 || comparison.geometry.evaluationSize!==1024 || comparison.lexical.dimensions!==2048) throw new Error('Run comparison plan differs from the frozen source recipe.');
  const recipe = await readJSON(run,'recipe.json'); const comparisonModel = await readJSON(run,'comparison-model.json');
  if (!synthetic && (comparisonModel.repository!==comparison.secondModel.repository || comparisonModel.revision!==comparison.secondModel.revision || comparisonModel.dimensions!==384 || comparisonModel.license!=='apache-2.0')) throw new Error('Second model differs from its predeclared comparison revision.');
  const gateAtStart = await qualityGate(run,admission,false);
  const identity = {schema_version:2,admission_sha256:identityOf(admission),comparison_plan:await receipt(run,'comparison-plan.json'),comparison_model:await receipt(run,'comparison-model.json'),baseline_recipe:await receipt(run,'recipe.json'),
    source_files:await sourceBindings(),policy,quality_gate_sha256:gateAtStart.binding?.sha256||null,synthetic_runtime:synthetic,runtime:{node:process.version,platform:process.platform,arch:process.arch}};
  const prefix = `sensitivity/${digest(identity).slice(0,24)}`; const finalName = `${prefix}/manifest.json`;
  const db = await openDatabase({memory:'512MB'}); let selection; let inputs; let gate;
  try {
    selection = await frozenSelection(run,admission,comparison,prefix,db);
    gate = await qualityGate(run,admission,selection.selected_units===comparison.unitTarget);
    if ((gate.binding?.sha256||null)!==identity.quality_gate_sha256) throw new Error('Quality gate changed during comparison freezing; retry from the preserved source-bound artifacts.');
    inputs = await freezeInputs(run,admission,selection,prefix,db,tracker,log);
  } finally {db.close();}
  tracker.sample();
  const guard=await createSensitivitySourceGuard(run,admission,{fullTarget:selection.selected_units===comparison.unitTarget});
  const existing = await optional(run,finalName);
  if (existing) {
    const {manifest_sha256,...payload} = existing; if (manifest_sha256!==digest(payload)) throw new Error('Completed comparison manifest checksum differs.');
    if (digest(existing.identity)!==digest(identity) || existing.selection.sha256!==selection.binding.sha256 || existing.inputs.sha256!==inputs.binding.sha256 || digest(existing.quality_gate)!==digest(gate)) throw new Error('Completed comparison identity or gate changed; preserved.');
    for (const item of existing.artifact_bindings) await bound(run,item);
    await verifyCompletedProvenance(run,admission,existing,inputs,selection,{recipe,comparison,comparisonModel,synthetic,createBaselineEmbedder,createSecondEmbedder,guard});
    await guard.checkpoint();return {...existing,manifest_path:finalName};
  }
  // This receipt is committed before either model is constructed or any inference begins.
  const preInference = await json(run,`${prefix}/pre-inference-freeze.json`,{schema_version:2,status:'FROZEN_BEFORE_INFERENCE',identity,selection:selection.binding,inputs:inputs.binding,quality_gate:gate,
    common_training_sha256:selection.training.sha256,common_evaluation_sha256:selection.evaluation.sha256,exact_subset_sha256:selection.exact.sha256});
  const prepareNative=createStudyNativeInputLoader(run,admission);let nativeInputs=false;for await(const batch of inputBatches(run,inputs,selection))if(batch.some(item=>item.native)){nativeInputs=true;break;}
  await guard.checkpoint();const tokenCounter=nativeInputs?await createPinnedTokenCounter(recipe.embedding):null;
  const started = Date.now(); const lexical = await lexicalModel(run,inputs,selection,prefix,prepareNative,tokenCounter,guard); const arms = []; const partitions = []; let exactComparison=null;
  for (const definition of armDefinitions) {
    let engine=null;
    try {
      await guard.checkpoint();
      if (definition.model==='baseline') engine=await createBaselineEmbedder({...recipe.embedding,max_units:500,token_budget:recipe.embedding.tokenBudget},{log});
      if (definition.model==='second') engine=await createSecondEmbedder({...comparison.secondModel,max_units:500,token_budget:recipe.embedding.tokenBudget},comparisonModel,{log});
      await guard.checkpoint();const arm = await runArm(run,definition,engine,lexical,inputs,selection,comparison,prefix,tracker,log,prepareNative,tokenCounter,guard);
      await guard.checkpoint();
      const geometric = await geometryForArm(run,arm,selection,comparison,prefix,tracker);
      arms.push({id:definition.id,model:definition.model,representation:definition.representation,rows:arm.rows,dimensions:arm.dimensions,manifest:arm.binding,geometry:geometric.binding,effective_k:geometric.effective_k,
        ordered_units_sha256:arm.ordered_units_sha256,training_sha256:geometric.training_sha256,evaluation_sha256:geometric.evaluation_sha256});
      partitions.push({id:definition.id,evaluation_sha256:selection.evaluation.sha256,labels:geometric.evaluation_labels}); if (geometric.exact_comparison) exactComparison=geometric.exact_comparison.binding;
    } finally {await engine?.dispose();}
  }
  const comparisons = []; for (let left=0; left<partitions.length; left++) for (let right=left+1; right<partitions.length; right++) comparisons.push({left:partitions[left].id,right:partitions[right].id,...comparePartitions(partitions[left],partitions[right])});
  const artifactBindings = [selection.binding,inputs.binding,preInference,lexical.binding,...inputs.source_bindings,...inputs.shards,...arms.flatMap(arm=>[arm.manifest,arm.geometry]),exactComparison];
  const result = {schema_version:2,status:synthetic?'DECLARED_SYNTHETIC_COMPARISON_COMPLETED':selection.target_shortage?'PRE_GATE_ENGINEERING_BENCHMARK_COMPLETED':'FIXED_SAME_UNIT_SENSITIVITY_COMPLETED',
    identity,selection:selection.binding,inputs:inputs.binding,pre_inference_freeze:preInference,quality_gate:gate,unit_target:30000,actual_units:selection.selected_units,target_shortage:selection.target_shortage,
    target_reached:selection.target_shortage===0,training_units:selection.training.unit_ids.length,evaluation_units:selection.evaluation.unit_ids.length,common_evaluation_sha256:selection.evaluation.sha256,
    arms,comparisons,lexical_model:lexical.binding,exact_small_comparator:exactComparison,artifact_bindings:artifactBindings,
    bounds:{unit_chunks:500,training_subset_units:20000,evaluation_subset_units:1024,exact_baseline_subset_units:2000,maximum_dimensions:2048,source_files_lru:2,normalized_file_bytes:8*1024*1024,all_pairs_matrix:false,geometry_copies:'The bounded training matrix and its normalized geometry copy may coexist; no study-wide vector matrix is constructed.'},
    memory:tracker.report(),elapsed_seconds:(Date.now()-started)/1000,synthetic_runtime:synthetic,reserve_accessed:false,semantic_validity_established:false,participant_evaluation:'NOT_RUN',authority:'NONE',adopted_catalog:false,execution_attested:false,
    limitations:[selection.target_shortage?`Only ${selection.selected_units} of the predeclared 30000 units were available under the fixed contract cap; this is a calibration engineering benchmark, not the full comparison.`:'The fixed target was reached; corpus coverage and participant relevance still require independent review.',
      policy.evaluation,'No candidate coding, names, chosen prior dimensions or tuned k enter this comparison.','The two MiniLM models share model family and substantially overlapping training data; second-model agreement is not independence of assumptions.',
      'Parent context verifies retained normalized source spans, not the adequacy of extraction, heading inheritance or remote source truth.','Lexical hashing collides terms and is a sensitivity control, not a semantic representation.',
      'Agreement at fixed k64 can reflect templates and bargaining conventions; frequency is not normative validity.','Exact comparator uses <=2000 frozen baseline units and distinct initialization; it cannot certify full-corpus equivalence.',
      'Only bounded training/evaluation subsets are resident; binary vector shards remain preserved for source-bound replay.','Measured process-memory samples do not establish a continuous operating-system peak.']};
  const manifest = {...result,manifest_sha256:digest(result)};
  await guard.checkpoint();
  await json(run,finalName,manifest); return {...manifest,manifest_path:finalName};
}

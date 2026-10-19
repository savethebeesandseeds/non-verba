// SPDX-License-Identifier: AGPL-3.0-only
// Bounded CPU embedding. Model downloads and all-corpus vector accumulation are deliberately absent.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, lstat, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import {modelInputIdentity,nativeRepresentationWindow,NATIVE_REPRESENTATION_POLICY} from './representation.mjs';
import {NATIVE_DECORATION_INPUT_POLICY} from './source-decoration.mjs';

export const PINNED_MODEL = Object.freeze({ repository: 'Xenova/all-MiniLM-L6-v2', revision: '751bff37182d3f1213fa05d7196b954e230abad9', dimensions: 384, max_tokens: 256, dtype: 'fp32', device: 'cpu', pooling: 'mean' });
const MODEL_ROOT = '/opt/nonverba-tools/priors-derivation-0.1/models';
const EXPECTED_FILES = Object.freeze({
  'config.json': '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7',
  'tokenizer.json': 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0',
  'tokenizer_config.json': '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3',
  'special_tokens_map.json': 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
  'onnx/model.onnx': '759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e',
  'README.md': '63ea99bf681a2e9eda4f6a537d5ed8fda95d1677111656da37e9cfd080c3af02',
});
const sha256 = value => createHash('sha256').update(value).digest('hex');
const verifiedArtifactRuntime = Symbol('verified-artifact-runtime');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const digest = value => sha256(canonical(value));
function integer(value, min, max, name) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${name} must be an integer in ${min}..${max}`); return value; }
function abort(signal) { if (signal?.aborted) throw signal.reason || new Error('Embedding aborted.'); }
async function regularFile(file) { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular file: ${file}`); return info; }
async function hashFile(file) { await regularFile(file); const hash = createHash('sha256'); for await (const part of createReadStream(file)) hash.update(part); return hash.digest('hex'); }

export function normalizeFloat32(vector) {
  let scale = 0; for (const value of vector) { if (!Number.isFinite(value)) throw new Error('Non-finite embedding coordinate.'); scale = Math.max(scale, Math.abs(value)); }
  if (!scale) throw new Error('Zero embedding norm.');
  let norm = 0; for (const value of vector) norm += (value / scale) ** 2; norm = Math.sqrt(norm);
  return Float32Array.from(vector, value => value / scale / norm);
}

/** Actual tokenizer counts include special tokens. Source words are never truncated. */
export function embeddingWindows(text, countTokens, { maxTokens = 256, overlapWords = 16 } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('Embedding input must contain text.');
  integer(maxTokens, 8, 256, 'maxTokens'); integer(overlapWords, 0, 128, 'overlapWords');
  const words = text.match(/\S+/gu); const windows = []; let start = 0; let previousEnd = 0;
  const measured = input => { const value = countTokens(input); if (!Number.isSafeInteger(value) || value < 1) throw new Error('Tokenizer returned an invalid count.'); return value; };
  if(words.some(word=>word.length>2048&&/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word)&&measured(Array.from(word.slice(0,2048)).slice(0,1024).join(''))>maxTokens))return characterWindows(text,measured,{maxTokens,overlapCharacters:overlapWords});
  while (start < words.length) {
    let low = start + 1; let high = words.length; let end = start;
    while (low <= high) { const middle = (low + high) >>> 1; if (measured(words.slice(start, middle).join(' ')) <= maxTokens) { end = middle; low = middle + 1; } else high = middle - 1; }
    if (end === start) {
      if(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(words[start]))return characterWindows(text,measured,{maxTokens,overlapCharacters:overlapWords});
      throw new Error('A complete source word exceeds tokenizer capacity; input retained as failed rather than truncated.');
    }
    const input = words.slice(start, end).join(' '); const tokens = measured(input);
    if (tokens > maxTokens) throw new Error('Measured embedding window exceeds tokenizer capacity.');
    const newWords = end - Math.max(start, previousEnd);
    windows.push({ text: input, tokens, word_start: start, word_end: end, weight: newWords, sha256: sha256(input) });
    previousEnd = end; if (end === words.length) break;
    start = Math.max(start + 1, end - Math.min(overlapWords, end - start - 1));
  }
  return windows;
}

/** Choose boundaries before encoding. Every independently measured model input
 * carries its own native marks; encoded strings are never subsequently cut. */
export const NATIVE_WINDOW_LIMITS=Object.freeze({maxEncodeProbes:20000,maxTokenizerCalls:20000,maxWindows:8192,maxSourceCharacters:2097152,maxEncodedCharacters:262144});
export const NATIVE_WINDOW_PLANNER_POLICY='FULL_NATIVE_WORD_FAST_PATH_THEN_BOUNDED_ALL_LANGUAGE_CODEPOINT_PARTITION_V6';
export function nativeEmbeddingWindows(representation,countTokens,{maxTokens=256,overlapWords=16,limits={}}={}) {
  integer(maxTokens,8,256,'maxTokens');integer(overlapWords,0,128,'overlapWords');
  if(!limits||typeof limits!=='object'||Array.isArray(limits)||Object.keys(limits).some(k=>!Object.hasOwn(NATIVE_WINDOW_LIMITS,k)))throw new Error('Unknown native planner limit');
  const budget={...NATIVE_WINDOW_LIMITS,...limits};for(const[k,n]of Object.entries(budget))integer(n,1,NATIVE_WINDOW_LIMITS[k],k);
  const work={encode_probes:0,tokenizer_calls:0,encoding_bound_probes:0,over_limit_probes:0,maximum_measured_tokens:0,fast_windows_completed:0,search_edges:0,final_recounts:0};
  const cause=error=>{try{const d=Object.getOwnPropertyDescriptor(error,'code');return typeof d?.value==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(d.value)?d.value:null;}catch{return null;}};
  const fail=(code,message,reason,error)=>{throw Object.assign(new Error(message),{code,reason,retained_failure:true,partial_stream_accepted:false,work:{...work}},error?{cause_code:cause(error)}:{});};
  const text=representation?.text;if(typeof text!=='string'||!text.trim())throw new Error('Native representation must contain source text');
  if(text.length>budget.maxSourceCharacters)fail('NATIVE_WINDOW_SEARCH_BOUND','Native source exceeds the declared planner bound; feasibility remains unknown','SOURCE_CHARACTERS');
  const words=Array.from(text.matchAll(/\S+/gu),match=>({start:match.index,end:match.index+match[0].length,text:match[0]}));
  const measured=(start,end)=>{
    if(work.encode_probes>=budget.maxEncodeProbes)fail('NATIVE_WINDOW_SEARCH_BOUND','Native encode probe budget exhausted; feasibility remains unknown','ENCODE_PROBES');work.encode_probes++;
    let encoded;try{encoded=nativeRepresentationWindow(representation,{start,end});}catch(error){if(error.code==='NATIVE_DECORATION_PROJECTION_BOUND'){work.encoding_bound_probes++;return{tokens:Infinity,encoding_bound:true};}fail('NATIVE_WINDOW_ENCODING_FAILURE','Native range encoding failed; source retained as failed','ENCODER_FAILURE',error);}
    if(encoded.text.length>budget.maxEncodedCharacters){work.encoding_bound_probes++;return{tokens:Infinity,encoding_bound:true};}
    if(work.tokenizer_calls>=budget.maxTokenizerCalls)fail('NATIVE_WINDOW_SEARCH_BOUND','Native tokenizer call budget exhausted; feasibility remains unknown','TOKENIZER_CALLS');work.tokenizer_calls++;
    let tokens;try{tokens=countTokens(encoded.text);}catch(error){fail('NATIVE_WINDOW_TOKENIZER_FAILURE','Native token counter failed; source retained as failed','COUNTER_FAILURE',error);}if(!Number.isSafeInteger(tokens)||tokens<1)fail('NATIVE_WINDOW_TOKENIZER_FAILURE','Tokenizer returned an invalid count','INVALID_COUNT');work.maximum_measured_tokens=Math.max(work.maximum_measured_tokens,tokens);if(tokens>maxTokens)work.over_limit_probes++;return{...encoded,tokens};
  };
  const finalWindow=(start,end)=>{work.final_recounts++;const w=measured(start,end);if(w.encoding_bound)fail('NATIVE_WINDOW_ENCODING_BOUND','Final native range exceeded its encoding bound','FINAL_ENCODING_BOUND');if(w.tokens>maxTokens)fail('NATIVE_WINDOW_TOKENIZER_FAILURE','Final native count changed beyond capacity','FINAL_COUNT_CHANGED');return w;};
  let points,offsets;const codepoints=()=>{if(!points){points=Array.from(text);offsets=[0];for(const value of points)offsets.push(offsets.at(-1)+value.length);}};
  const windowBound=windows=>{if(windows.length>budget.maxWindows)fail('NATIVE_WINDOW_SEARCH_BOUND','Native window budget exhausted; feasibility remains unknown','WINDOW_COUNT');};
  const characterFast=(overlap,segmentation)=>{
    codepoints();
    const windows=[];let start=0,previousEnd=0;
    while(start<points.length){let low=start+1,high=Math.min(points.length,start+maxTokens*4),end=start;
      while(low<=high){const middle=(low+high)>>>1;if(measured(offsets[start],offsets[middle]).tokens<=maxTokens){end=middle;low=middle+1;}else high=middle-1;}
      if(end===start||end<=previousEnd)return null;
      const window=finalWindow(offsets[start],offsets[end]);
      windows.push({...window,source_character_start:start,source_character_end:end,source_utf16_start:offsets[start],source_utf16_end:offsets[end],weight:end-Math.max(start,previousEnd),weight_unit:'new_source_codepoints',segmentation});work.fast_windows_completed++;windowBound(windows);
      previousEnd=end;if(end===points.length)break;start=Math.max(start+1,end-Math.min(overlap,end-start-1));
    }return windows;
  };
  // Fast probes establish measured success only. Their failure does not prove
  // monotone counts: enumerate the Unicode DAG and backtrack past dead suffixes.
  // Repaired partitions tile the source without overlap; each weight is unique
  // source-codepoint coverage, not comparability with the old overlap16 arm.
  const exhaustiveFallback=()=>{
    codepoints();const encodingBefore=work.encoding_bound_probes,dead=new Set(),stack=[{start:0,next:points.length,via:null}];let path=null;
    while(stack.length){const frame=stack.at(-1);if(frame.next<=frame.start){dead.add(frame.start);stack.pop();continue;}if(work.search_edges>=budget.maxEncodeProbes)fail('NATIVE_WINDOW_SEARCH_BOUND','Native candidate-edge budget exhausted; feasibility remains unknown','SEARCH_EDGES');const end=frame.next--;work.search_edges++;if(dead.has(end))continue;const probe=measured(offsets[frame.start],offsets[end]);if(probe.tokens>maxTokens)continue;
      const edge={start:frame.start,end};if(end===points.length){path=[...stack.slice(1).map(f=>f.via),edge];break;}
      if(stack.length>=budget.maxWindows)fail('NATIVE_WINDOW_SEARCH_BOUND','Native partition search reached its window bound; feasibility remains unknown','WINDOW_COUNT');stack.push({start:end,next:points.length,via:edge});
    }
    if(!path){if(work.encoding_bound_probes>encodingBefore)fail('NATIVE_WINDOW_ENCODING_BOUND','Complete native candidates exceeded encoding/projection bounds; token feasibility remains unknown','UNMEASURED_ENCODING_BOUND');fail('NATIVE_WINDOW_TOKEN_OVERFLOW','Exhaustively measured native candidates admit no complete source partition; source retained as failed','EXHAUSTIVE_MEASURED_NO_PARTITION');}
    const windows=path.map(edge=>{const window=finalWindow(offsets[edge.start],offsets[edge.end]);return{...window,source_character_start:edge.start,source_character_end:edge.end,source_utf16_start:offsets[edge.start],source_utf16_end:offsets[edge.end],weight:edge.end-edge.start,weight_unit:'new_source_codepoints',segmentation:'native_all_language_exhaustive_codepoint_partition_v1'};});windowBound(windows);windows[0].native_planner_work={...work};return windows;
  };
  const fallback=cjk=>{const fast=characterFast(cjk?overlapWords:0,cjk?'native_cjk_codepoint_boundaries_before_encoding':'native_all_language_nonoverlapping_codepoint_boundaries_v1');if(!fast)return exhaustiveFallback();if(!cjk)fast[0].native_planner_work={...work};return fast;};
  const windows=[];let start=0,previousEnd=0;
  while(start<words.length){let low=start+1,high=words.length,end=start;
    const left=start===0?0:words[start].start,right=index=>index===words.length?text.length:words[index].start;
    while(low<=high){const middle=(low+high)>>>1;if(measured(left,right(middle)).tokens<=maxTokens){end=middle;low=middle+1;}else high=middle-1;}
    if(end===start)return fallback(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(words[start].text));
    if(end<=previousEnd)return fallback(false);
    const window=finalWindow(left,right(end));
    windows.push({...window,word_start:start,word_end:end,source_utf16_start:left,source_utf16_end:right(end),weight:end-Math.max(start,previousEnd),weight_unit:'new_source_words',segmentation:'native_complete_words_before_encoding'});work.fast_windows_completed++;windowBound(windows);
    previousEnd=end;if(end===words.length)break;start=Math.max(start+1,end-Math.min(overlapWords,end-start-1));
  }
  return windows;
}

/** Source-only readiness and inference share this exact planner. The caller
 * binds its token counter to the frozen model artifacts, never a claimed count. */
export function prepareEmbeddingInput(unit,countTokens,{maxTokens=256,overlapWords=16,maxWords=4096}={}) {
  integer(maxWords,1,4096,'maxWords');const identity=modelInputIdentity(unit),text=identity.text;
  if((text.match(/\S+/gu)??[]).length>maxWords)throw new Error('Unit exceeds the bounded complete-word input limit');
  const windows=unit.native_input?nativeEmbeddingWindows(unit.native_input,countTokens,{maxTokens,overlapWords}):embeddingWindows(text,countTokens,{maxTokens,overlapWords});
  return {schema:'prepared-model-source-windows-v1',policy:{native_representation:NATIVE_REPRESENTATION_POLICY,native_input:NATIVE_DECORATION_INPUT_POLICY,native_window_planner:NATIVE_WINDOW_PLANNER_POLICY,native_planner_limits:NATIVE_WINDOW_LIMITS,max_tokens:maxTokens,overlap_words:overlapWords,max_source_words:maxWords,encoded_strings_truncated:false},input:{input_sha256:identity.input_sha256,source_text_sha256:sha256(text),native_evidence_status:identity.native_evidence_status,...(identity.native_representation?{native_representation:identity.native_representation}:{}),windows:windows.map(({text:ignored,...metadata})=>metadata)},windows};
}

// Whitespace is not a word boundary in many CJK passages. Preserve literal
// slices and expose the changed weighting unit rather than dropping their tail.
function characterWindows(text,countTokens,{maxTokens,overlapCharacters}) {
  const characters=Array.from(text);const offsets=[0];for(const c of characters)offsets.push(offsets.at(-1)+c.length);
  const windows=[];let start=0;let previousEnd=0;
  while(start<characters.length){let low=start+1;let high=Math.min(characters.length,start+maxTokens*4);let end=start;
    while(low<=high){const middle=(low+high)>>>1;if(countTokens(text.slice(offsets[start],offsets[middle]))<=maxTokens){end=middle;low=middle+1;}else high=middle-1;}
    if(end===start)throw new Error('A source codepoint exceeds tokenizer capacity; input retained as failed.');
    const input=text.slice(offsets[start],offsets[end]);const tokens=countTokens(input);if(tokens>maxTokens)throw new Error('Character window exceeds measured token capacity');
    windows.push({text:input,tokens,source_character_start:start,source_character_end:end,source_utf16_start:offsets[start],source_utf16_end:offsets[end],weight:end-Math.max(start,previousEnd),weight_unit:'new_source_codepoints',segmentation:'cjk_overlong_whitespace_segment_fallback',sha256:sha256(input)});
    previousEnd=end;if(end===characters.length)break;start=Math.max(start+1,end-Math.min(overlapCharacters,end-start-1));
  }
  return windows;
}

/** Padded token budget, not merely sum of unpadded lengths, controls each model call. */
export function planWindowBatches(windows, { tokenBudget = 8192, maxBatchWindows = 32, bucketWidth = 32 } = {}) {
  integer(tokenBudget, 8, 1048576, 'tokenBudget'); integer(maxBatchWindows, 1, 512, 'maxBatchWindows'); integer(bucketWidth, 1, 256, 'bucketWidth');
  const buckets = new Map();
  for (const [index, window] of windows.entries()) {
    integer(window.tokens, 1, 256, 'window token count'); if (window.tokens > tokenBudget) throw new Error('Token budget cannot hold a measured complete window.');
    const bucket = Math.ceil(window.tokens / bucketWidth); if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push({ ...window, original_index: index });
  }
  const batches = [];
  for (const [bucket, entries] of [...buckets].sort(([a], [b]) => a - b)) {
    let current = []; let maximum = 0;
    const flush = () => { if (current.length) batches.push({ bucket, windows: current, actual_input_tokens: current.reduce((sum, item) => sum + item.tokens, 0), padded_tokens: maximum * current.length }); current = []; maximum = 0; };
    for (const entry of entries) {
      if (current.length && (current.length >= maxBatchWindows || Math.max(maximum, entry.tokens) * (current.length + 1) > tokenBudget)) flush();
      current.push(entry); maximum = Math.max(maximum, entry.tokens);
    }
    flush();
  }
  return batches;
}

export function embeddingCacheKey(inputSha256, modelRevision, policySha256) {
  if (![inputSha256, policySha256].every(value => /^[a-f0-9]{64}$/.test(value)) || !/^[a-f0-9]{40}$/.test(modelRevision)) throw new Error('Cache identity requires exact input, model revision and policy hashes.');
  return digest({ input_sha256: inputSha256, model_revision: modelRevision, window_policy_sha256: policySha256 });
}
function encodeVector(vector) { const bytes = Buffer.alloc(vector.length * 4); for (let index = 0; index < vector.length; index++) bytes.writeFloatLE(vector[index], index * 4); return bytes; }
function decodeVector(bytes, dimensions) {
  if (bytes.length !== dimensions * 4) throw new Error('Cached vector byte length differs from model dimensions.');
  const vector = new Float32Array(dimensions); let norm = 0;
  for (let i = 0; i < dimensions; i++) { vector[i] = bytes.readFloatLE(i * 4); if (!Number.isFinite(vector[i])) throw new Error('Non-finite cached vector.'); norm += vector[i] ** 2; }
  if (Math.abs(Math.sqrt(norm) - 1) > 0.0001) throw new Error('Cached vector is not normalized.'); return vector;
}

async function verifyExistingModel(config) {
  if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Embedding runs only inside the documented managed Linux container.');
  if (config.repository !== PINNED_MODEL.repository || config.revision !== PINNED_MODEL.revision || config.dimensions !== PINNED_MODEL.dimensions || config.dtype !== 'fp32' || config.device !== 'cpu' || config.pooling !== 'mean') throw new Error('v0.2 baseline must reuse the exact existing MiniLM CPU/fp32 model.');
  const directory = path.resolve(MODEL_ROOT, config.repository, config.revision);
  const manifestFile = path.join(directory, 'provisioning.json'); await regularFile(manifestFile);
  const model = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (model.repository !== config.repository || model.revision !== config.revision) throw new Error('Existing provisioning identity differs from the requested model.');
  const verifiedFiles = [];
  for (const [name, expected] of Object.entries(EXPECTED_FILES)) {
    const file = path.join(directory, name); const hash = await hashFile(file);
    if (hash !== expected || model.files?.find(item => item.path === name)?.sha256 !== expected) throw new Error(`Existing pinned model digest mismatch: ${name}`);
    verifiedFiles.push({ path: name, sha256: hash, bytes: (await lstat(file)).size });
  }
  return { ...model, directory, files: verifiedFiles, verified_file_set_sha256: digest(verifiedFiles), downloads_attempted: 0, verification_status: 'VERIFIED_EXISTING_PINNED_ARTIFACTS', execution_attested: false };
}

async function productionRuntime(config) {
  const model = await verifyExistingModel(config);
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false; env.allowLocalModels = true; env.useFSCache = false; env.useBrowserCache = false; env.useCustomCache = false;
  const extractor = await pipeline('feature-extraction', model.directory, { device: 'cpu', dtype: 'fp32', session_options: { intraOpNumThreads: config.intra_op_threads, interOpNumThreads: 1 } });
  if (Number.isFinite(extractor.tokenizer.model_max_length) && config.max_tokens > extractor.tokenizer.model_max_length) { await extractor.dispose(); throw new Error('Declared token limit exceeds tokenizer capacity.'); }
  return { model, tokenCount: text => extractor.tokenizer.encode(text).length,
    extractBatch: async texts => (await extractor(texts, { pooling: 'mean', normalize: true, padding: true, truncation: false })).tolist(), dispose: () => extractor.dispose() };
}

/** Exact existing artifacts and tokenizer only: no ONNX session, fitting,
 * model inference or remote access is needed for mechanical input readiness. */
export async function createPinnedTokenCounter(inputConfig={}, {manifest=null}={}) {
  const config={...PINNED_MODEL,...inputConfig};integer(config.max_tokens,8,256,'max_tokens');
  const model=manifest?await verifyArtifactModel(config,manifest):await verifyExistingModel(config);
  const {AutoTokenizer,env}=await import('@huggingface/transformers');
  env.allowRemoteModels=false;env.allowLocalModels=true;env.useFSCache=false;env.useBrowserCache=false;env.useCustomCache=false;
  const tokenizer=await AutoTokenizer.from_pretrained(model.directory,{local_files_only:true});
  if(Number.isFinite(tokenizer.model_max_length)&&config.max_tokens>tokenizer.model_max_length)throw new Error('Declared token limit exceeds the pinned tokenizer capacity');
  const policy={version:'PINNED_EXISTING_TOKENIZER_ONLY_NO_INFERENCE_V1',model_repository:config.repository,model_revision:config.revision,verified_file_set_sha256:model.verified_file_set_sha256,special_tokens:true,truncation:false,runtime:'@huggingface/transformers@3.8.1',downloads_attempted:0,onnx_session_created:false,model_inference:false};
  return {model,policy,policy_sha256:digest(policy),tokenCount:text=>{if(typeof text!=='string'||text.length>1024**2)throw new Error('Tokenizer readiness input exceeds its explicit text bound');return tokenizer.encode(text,{add_special_tokens:true}).length;}};
}

/** Pure shared policy identity. Read-only replay needs no inference session. */
export function embeddingWindowPolicy(inputConfig={},model={}, {syntheticRuntime=false}={}){
  const config = { ...PINNED_MODEL, max_units: 500, max_words_per_unit: 4096, token_budget: 8192, max_batch_windows: 32, bucket_width: 32, overlap_words: 16, intra_op_threads: 2, ...inputConfig };
  integer(config.max_units, 1, 500, 'max_units'); integer(config.dimensions, 1, 2048, 'dimensions'); integer(config.max_tokens, 8, 256, 'max_tokens'); integer(config.intra_op_threads, 1, 32, 'intra_op_threads');
  integer(config.max_words_per_unit, 1, 4096, 'max_words_per_unit'); integer(config.token_budget, 8, 1048576, 'token_budget'); integer(config.max_batch_windows, 1, 512, 'max_batch_windows'); integer(config.bucket_width, 1, 256, 'bucket_width'); integer(config.overlap_words, 0, 128, 'overlap_words');
  if(typeof syntheticRuntime!=='boolean')throw new Error('Explicit policy runtime scope required');
  return { version: 'complete-source-ranges-native-window-encoding-v6', native_representation_policy:NATIVE_REPRESENTATION_POLICY,native_input_policy:NATIVE_DECORATION_INPUT_POLICY,native_window_order:'unencoded_source_boundaries_then_complete_native_encoding_then_actual_tokenizer_recount; no_encoded_string_truncation',legacy_native_evidence:'LEGACY_NATIVE_EVIDENCE_UNAVAILABLE', max_tokens: config.max_tokens, overlap_words: config.overlap_words, token_budget: config.token_budget, max_batch_windows: config.max_batch_windows, bucket_width: config.bucket_width,
    padding_budget: 'longest_measured_input_times_window_count', window_weight: 'new_source_words; unique newly covered source_codepoints for native fallback', cjk_fallback:'unchanged successful CJK fast path with requested codepoint overlap; language-model suitability remains unvalidated',native_window_planner:NATIVE_WINDOW_PLANNER_POLICY,native_fallback:'all_languages; bounded exhaustive Unicode-boundary partition after unsuccessful fast probes; no plain/finite fallback',native_repaired_fallback_overlap:0,native_planner_limits:NATIVE_WINDOW_LIMITS,native_fallback_work:'aggregate attempted probes/calls retained on failure and first repaired window; no unbounded feasibility claim', aggregation: 'Float64 weighted window means then Float32 L2 normalization', pooling: config.pooling, dtype: config.dtype, device: config.device, intra_op_threads: config.intra_op_threads, inter_op_threads: 1,
    dimensions: config.dimensions, max_words_per_unit: config.max_words_per_unit, normalization: 'window and final L2 normalization',
    runtime: syntheticRuntime ? 'DECLARED_SYNTHETIC_INJECTED_RUNTIME' : '@huggingface/transformers@3.8.1', synthetic_runtime_id: syntheticRuntime ? model?.synthetic_runtime_id || null : null, model_files_sha256: model?.verified_file_set_sha256 || model?.file_set_sha256 || null };
}

/** Test runtimes must be explicitly injected; production never fetches model files. */
export async function createBatchEmbedder(inputConfig = {}, { log = () => {}, runtime = null } = {}) {
  const config = { ...PINNED_MODEL, max_units: 500, max_words_per_unit: 4096, token_budget: 8192, max_batch_windows: 32, bucket_width: 32, overlap_words: 16, intra_op_threads: 2, ...inputConfig };
  // Validate before opening the model, as well as constructing its exact policy.
  embeddingWindowPolicy(config);
  const engine = runtime || await productionRuntime(config);
  const syntheticRuntime = !!runtime && !engine[verifiedArtifactRuntime];
  if (typeof engine.tokenCount !== 'function' || typeof engine.extractBatch !== 'function') throw new Error('Embedding runtime must provide tokenCount and extractBatch.');
  const policy=embeddingWindowPolicy(config,engine.model,{syntheticRuntime});
  const policyHash = digest(policy); let busy = false; let disposed = false;
  const cacheDir = config.cache_dir ? path.resolve(config.cache_dir) : null;
  if (cacheDir && !path.isAbsolute(config.cache_dir)) throw new Error('cache_dir must be an absolute managed-container path.');
  if (cacheDir) {
    const allowed = ['/opt/nonverba-build/priors-derivation/study-v0.2', '/opt/nonverba-tools/priors-derivation-0.1/cache', '/opt/nonverba-tools/priors-derivation-study-v0.2'];
    if (!allowed.some(root => cacheDir === root || cacheDir.startsWith(`${root}/`)) && !(runtime && cacheDir.startsWith('/tmp/priors-embedding-test-'))) throw new Error('Embedding cache must stay inside the documented managed study/cache namespace.');
    let current = cacheDir;
    while (current !== path.dirname(current)) {
      try { const info = await lstat(current); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Embedding cache path components must be regular directories.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      current = path.dirname(current);
    }
    await mkdir(cacheDir, { recursive: true });
  }
  const cacheFile = key => path.join(cacheDir, key.slice(0, 2), `${key}.json`);
  async function readCache(key, inputHash) {
    if (!cacheDir) return null;
    const file = cacheFile(key);
    try { const parent = await lstat(path.dirname(file)); if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error('Cache bucket must be a regular directory.'); const info = await regularFile(file); if (info.size > 1048576) throw new Error('Cached embedding entry exceeds bounded size.'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const record = JSON.parse(await readFile(file, 'utf8')); const { manifest_sha256, ...payload } = record;
    if (digest(payload) !== manifest_sha256 || record.cache_key !== key || record.input_sha256 !== inputHash || record.model_revision !== config.revision || record.window_policy_sha256 !== policyHash || record.dimensions !== config.dimensions) throw new Error('Embedding cache manifest identity or integrity mismatch.');
    const bytes = Buffer.from(record.vector_base64, 'base64'); if (sha256(bytes) !== record.vector_sha256) throw new Error('Embedding cache vector digest mismatch.');
    return { vector: decodeVector(bytes, config.dimensions), input: record.input };
  }
  async function writeCache(key, inputHash, vector, input) {
    if (!cacheDir) return;
    const file = cacheFile(key); await mkdir(path.dirname(file), { recursive: true });
    const parent = await lstat(path.dirname(file)); if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error('Cache bucket must be a regular directory.');
    const bytes = encodeVector(vector); const payload = { schema_version: 2, artifact_type: 'verified_embedding_cache_entry', cache_key: key, input_sha256: inputHash, model_revision: config.revision, window_policy_sha256: policyHash, dimensions: config.dimensions,
      vector_encoding: 'ordered_float32_little_endian', vector_sha256: sha256(bytes), vector_base64: bytes.toString('base64'), input };
    const entry = { ...payload, manifest_sha256: digest(payload) }; const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporary, `${JSON.stringify(entry)}\n`, { flag: 'wx' });
      try { await link(temporary, file); } catch (error) { if (error.code !== 'EEXIST') throw error; const existing = await readCache(key, inputHash); if (sha256(encodeVector(existing.vector)) !== payload.vector_sha256) throw new Error('Concurrent cache result differs; existing data preserved.'); }
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function embedUnits(units, { onBatch = async () => {}, signal = null } = {}) {
    if (busy || disposed) throw new Error(disposed ? 'Embedding runtime has been disposed.' : 'Concurrent embedding calls are not supported.');
    if (!Array.isArray(units) || units.length > config.max_units) throw new Error(`embedUnits accepts at most ${config.max_units} units per chunk.`);
    busy = true;
    try {
      abort(signal); const ids = units.map(unit => unit?.id ?? unit?.unit_id); if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('Each embedding chunk needs unique nonempty unit IDs.');
      const groups = new Map(); const inputs = new Array(units.length); const vectors = new Array(units.length); const windows = [];
      const stats = { enabled: !!cacheDir, hits: 0, unique_inputs_embedded: 0, repeated_inputs_reused: 0, entries_written: 0 };
      for (const [index, unit] of units.entries()) {
        abort(signal); const identity=modelInputIdentity(unit),text=identity.text;
        if ((text.match(/\S+/gu) || []).length > config.max_words_per_unit) throw new Error(`Unit ${ids[index]} exceeds the bounded complete-word input limit.`);
        const inputHash = identity.input_sha256; const key = embeddingCacheKey(inputHash, config.revision, policyHash);
        if (groups.has(key)) { groups.get(key).indices.push(index); stats.repeated_inputs_reused++; continue; }
        const cached = await readCache(key, inputHash);
        if(cached&&(cached.input.native_evidence_status!==identity.native_evidence_status||digest(cached.input.native_representation??null)!==digest(identity.native_representation??null)))throw new Error('Cached native input evidence differs from current source');
        const prepared=cached?null:prepareEmbeddingInput(unit,engine.tokenCount,{maxTokens:config.max_tokens,overlapWords:config.overlap_words,maxWords:config.max_words_per_unit}),sourceWindows=prepared?.windows;
        const input = cached?.input || { ...prepared.input, cache_key: key, window_policy_sha256: policyHash };
        const group = { key, inputHash, input, indices: [index], vector: cached?.vector || null, sum: cached ? null : new Float64Array(config.dimensions), complete: 0, totalWeight: input.windows.reduce((sum, window) => sum + window.weight, 0) };
        groups.set(key, group);
        if (cached) stats.hits++; else {
          windows.push(...sourceWindows.map(window => ({ ...window, cache_key: key }))); stats.unique_inputs_embedded++;
        }
      }
      const batches = planWindowBatches(windows, { tokenBudget: config.token_budget, maxBatchWindows: config.max_batch_windows, bucketWidth: config.bucket_width });
      let processed = 0;
      for (const [batchIndex, batch] of batches.entries()) {
        abort(signal); const started = performance.now(); const matrix = await engine.extractBatch(batch.windows.map(window => window.text)); abort(signal);
        if (!Array.isArray(matrix) || matrix.length !== batch.windows.length) throw new Error('Embedding runtime output row count differs from measured inputs.');
        for (const [index, vector] of matrix.entries()) {
          if (!vector || vector.length !== config.dimensions) throw new Error('Embedding runtime output dimensions differ from the declared model.');
          const normalized = normalizeFloat32(vector); const window = batch.windows[index]; const group = groups.get(window.cache_key);
          for (let dimension = 0; dimension < config.dimensions; dimension++) group.sum[dimension] += normalized[dimension] * window.weight / group.totalWeight;
          group.complete++;
          if (group.complete === group.input.windows.length) { group.vector = normalizeFloat32(group.sum); await writeCache(group.key, group.inputHash, group.vector, group.input); if (cacheDir) stats.entries_written++; }
        }
        processed += batch.windows.length;
        await onBatch({ batch_index: batchIndex, batch_count: batches.length, window_count: batch.windows.length, processed_windows: processed, total_windows: windows.length, actual_input_tokens: batch.actual_input_tokens, padded_tokens: batch.padded_tokens, bucket: batch.bucket, elapsed_ms: performance.now() - started });
      }
      const packed = new Float32Array(units.length * config.dimensions);
      for (const group of groups.values()) {
        if (!group.vector) throw new Error('Input aggregation did not cover every measured source window.');
        for (const index of group.indices) { vectors[index] = group.vector.slice(); packed.set(group.vector, index * config.dimensions); inputs[index] = { unit_id: ids[index], ...group.input, model_revision: config.revision }; }
      }
      log(`Embedded chunk: ${units.length} units, ${windows.length} windows, ${batches.length} bounded CPU calls, ${stats.hits} cache hits.`);
      return { vectors, packed_vectors: packed, dimensions: config.dimensions, unit_ids: ids, inputs, cache_stats: stats,
        provenance: { schema_version: 2, model: engine.model || { ...PINNED_MODEL, execution_attested: false }, window_policy: policy, window_policy_sha256: policyHash, ordered_unit_ids_sha256: digest(ids), vector_encoding: 'ordered_float32_little_endian', node: process.version, platform: process.platform, arch: process.arch,
          determinism: 'Fixed input order/policy and same runtime execution; exact Float32 bits are not promised across CPU, library or runtime versions.', synthetic_runtime: syntheticRuntime, chunks_bounded_to_units: config.max_units } };
    } finally { busy = false; }
  }
  return { model: engine.model, window_policy: policy, window_policy_sha256: policyHash, embedUnits, tokenCount: engine.tokenCount,
    dispose: async () => { if (busy) throw new Error('Cannot dispose an active embedding runtime.'); if (!disposed) { disposed = true; await engine.dispose?.(); } } };
}

async function verifyArtifactModel(config,manifest) {
  if(process.platform!=='linux'||process.env.NONVERBA_CONTAINER!=='1')throw new Error('Comparison inference requires the managed Linux container.');
  const base='/opt/nonverba-tools/priors-derivation-0.2/models';
  const directory=path.resolve(base,config.repository,config.revision);
  if(!directory.startsWith(`${base}/`)||! /^[a-f0-9]{40}$/.test(config.revision)||manifest.repository!==config.repository||manifest.revision!==config.revision||manifest.directory!==directory||manifest.license!=='apache-2.0'||config.dtype!=='fp32'||config.device!=='cpu'||config.pooling!=='mean')throw new Error('Comparison artifact identity/configuration differs.');
  let ancestor=directory;while(ancestor!=='/'){const info=await lstat(ancestor);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Linked model directory rejected.');ancestor=path.dirname(ancestor);}
  const files=[];
  for(const name of Object.keys(EXPECTED_FILES)) {const declared=manifest.files?.find(item=>item.path===name);if(!declared||!/^[a-f0-9]{64}$/.test(declared.sha256))throw new Error('Missing comparison model file binding.');const file=path.join(directory,name);if(await hashFile(file)!==declared.sha256||(await lstat(file)).size!==declared.bytes)throw new Error(`Comparison artifact changed: ${name}`);files.push(declared);}
  return {...manifest,files,verified_file_set_sha256:digest(files),verification_status:'VERIFIED_EXPLICIT_COMPARISON_ARTIFACTS',downloads_attempted:0,execution_attested:false};
}

/** Explicit comparison artifact set; baseline loading above remains pinned independently. */
export async function createArtifactBatchEmbedder(config, manifest, options={}) {
  const model=await verifyArtifactModel(config,manifest),directory=model.directory;
  const {pipeline,env}=await import('@huggingface/transformers');env.allowRemoteModels=false;env.allowLocalModels=true;env.useFSCache=false;env.useBrowserCache=false;env.useCustomCache=false;
  const extractor=await pipeline('feature-extraction',directory,{device:'cpu',dtype:'fp32',session_options:{intraOpNumThreads:config.intra_op_threads??2,interOpNumThreads:1}});
  if(Number.isFinite(extractor.tokenizer.model_max_length)&&config.max_tokens>extractor.tokenizer.model_max_length){await extractor.dispose();throw new Error('Comparison token limit exceeds tokenizer.');}
  const runtime={model,[verifiedArtifactRuntime]:true,tokenCount:text=>extractor.tokenizer.encode(text).length,extractBatch:async texts=>(await extractor(texts,{pooling:'mean',normalize:true,padding:true,truncation:false})).tolist(),dispose:()=>extractor.dispose()};
  try{return await createBatchEmbedder(config,{...options,runtime});}catch(error){await extractor.dispose();throw error;}
}

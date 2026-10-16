// SPDX-License-Identifier: AGPL-3.0-only
// Worker-only existing-cache/native IO. Original raw paths have no read API.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {digest} from '../../finite-codec.mjs';
import {contextOf,assertPermit,fail} from './admission.mjs';
import {checkedPath,readParentMetadata,parseJSON,sha} from './input-io.mjs';
import {preflightContext} from './preflight.mjs';
import {initializedScope} from './control.mjs';
const nativeReady=new WeakMap();
export {parseJSON};
export function caseBudget(){return {decoded:0};}
function access(permit){const scope=initializedScope(permit),c=contextOf(permit),entry=preflightContext(permit,scope);return{scope,c,...entry};}
export async function readBound(root,name,expected,{permit}={}){assertPermit(permit,root);if(expected?.path!==name)fail('METADATA_PARENT_REF_PATH');return readParentMetadata(permit,expected);}
async function fileBytes(root,name,expected,maxBytes){
  const target=await checkedPath(root,name),fd=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await fd.stat();if(!before.isFile()||before.size>maxBytes||expected?.bytes!==undefined&&before.size!==expected.bytes)fail('METADATA_INPUT_SIZE');const b=Buffer.alloc(before.size);let at=0;while(at<b.length){const r=await fd.read(b,at,b.length-at,at);if(!r.bytesRead)fail('METADATA_INPUT_TRUNCATED');at+=r.bytesRead;}const after=await fd.stat();if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||expected?.sha256&&sha(b)!==expected.sha256)fail('METADATA_INPUT_BYTES');return b;}finally{await fd.close();}
}
function decode(encoded,storage,budget){if(encoded.length>8388608||!Number.isSafeInteger(budget?.decoded)||budget.decoded<0||!Number.isSafeInteger(storage?.decoded_bytes)||storage.decoded_bytes<1||storage.decoded_bytes>33554432-budget.decoded)fail('METADATA_DECODED_AGGREGATE');let b;try{b=gunzipSync(encoded,{maxOutputLength:storage.decoded_bytes});}catch{fail('METADATA_GZIP');}if(b.length!==storage.decoded_bytes||sha(b)!==storage.decoded_sha256)fail('METADATA_DECODED_BINDING');budget.decoded+=b.length;return b;}
export async function readCache(root,ref,{permit,budget}){
  assertPermit(permit,root);const {scope,manifest}=access(permit),matches=(manifest.cache??[]).filter(r=>r.id===ref.id);
  if(scope.freshGuard.contract_ids.includes(ref.id))fail('METADATA_PROTECTED_BEFORE_CACHE');
  if(matches.length!==1||digest(matches[0])!==digest(ref)||!scope.development_rows.some(r=>r.contract_id===ref.id))fail('METADATA_CACHE_NOT_BOUND');
  const receiptBytes=await fileBytes(root,ref.path+'.manifest.json',null,65536),receipt=parseJSON(receiptBytes),storage=receipt.storage;
  if(receipt.path!==ref.path||receipt.sha256!==ref.sha256||receipt.bytes!==ref.bytes||storage?.schema!=='lossless-gzip-extraction-cache-v1'||storage.encoding!=='gzip'||storage.serializer!=='UTF8_JSON_STRINGIFY_PRETTY_2_FINAL_LF_V1')fail('EXACT69_CACHE_RECEIPT');
  const encoded=await fileBytes(root,ref.path,ref,8388608),plain=decode(encoded,storage,budget),value=parseJSON(plain);
  if(JSON.stringify(value,null,2)+'\n'!==plain.toString('utf8')||digest(value)!==receipt.result_sha256)fail('EXACT69_CACHE_SERIALIZATION');
  const record=manifest.contract_records.filter(r=>r.id===ref.id);if(record.length!==1||value.contract?.id!==ref.id||value.raw_sha256!==receipt.raw_sha256||receipt.id!==ref.id||receipt.source_sha256!==manifest.source.sha256||digest(value.source)!==digest(manifest.source)||digest(record[0].native_source_decorations)!==digest(value.native_source_decorations))fail('METADATA_CACHE_NATIVE_LINEAGE');let ready=nativeReady.get(permit);if(!ready){ready=new Set();nativeReady.set(permit,ready);}ready.add(ref.id+':'+value.native_source_decorations.sha256);
  return{value,receipt,receipt_binding:{sha256:sha(receiptBytes),bytes:receiptBytes.length}};
}
export async function hydrateNative(root,ref,{permit,budget}){
  assertPermit(permit,root);const {scope,manifest}=access(permit),records=(manifest.contract_records??[]).filter(r=>r.native_source_decorations?.sha256===ref?.sha256);
  if(records.length!==1||scope.freshGuard.contract_ids.includes(records[0].id)||!scope.development_rows.some(r=>r.contract_id===records[0].id)||digest(records[0].native_source_decorations)!==digest(ref))fail('METADATA_NATIVE_NOT_BOUND_OR_PROTECTED');
  if(!nativeReady.get(permit)?.has(records[0].id+':'+ref.sha256))fail('METADATA_NATIVE_REQUIRES_BOUND_CACHE');
  if(ref.schema!=='native-source-decoration-reference-v1')fail('EXACT69_NATIVE_REFERENCE_REQUIRED');const{sha256,...body}=ref;if(digest(body)!==sha256||ref.storage_policy!=='LOSSLESS_GZIP_FULL_NATIVE_ENVELOPE_ONCE_PER_CONTRACT_V1')fail('EXACT69_NATIVE_REFERENCE_SEAL');
  const encoded=await fileBytes(root,ref.artifact.path,ref.artifact,8388608),plain=decode(encoded,{decoded_bytes:ref.uncompressed_bytes,decoded_sha256:ref.uncompressed_sha256},budget),envelope=parseJSON(plain);
  const expected={envelope_sha256:envelope.sha256,raw_sha256:envelope.raw?.sha256,normalized_sha256:envelope.normalized?.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,method_identity_status:envelope.method_identity_status,policy:envelope.policy,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility};for(const[k,v]of Object.entries(expected))if(ref[k]!==v)fail('EXACT69_NATIVE_REFERENCE_MISMATCH');return envelope;
}

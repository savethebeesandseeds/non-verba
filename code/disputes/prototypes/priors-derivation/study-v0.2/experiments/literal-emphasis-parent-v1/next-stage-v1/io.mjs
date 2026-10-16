// SPDX-License-Identifier: AGPL-3.0-only
// Exact no-follow IO; filesystem callbacks cannot be injected.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {sha,digest} from '../finite-codec.mjs';
import {PILOT_LIMITS} from '../pilot-resources.mjs';
import {assertPermit} from './admission.mjs';
import {assertTransport} from './transport.mjs';
export const ENCODED_LIMIT=8*1024**2,DECODED_LIMIT=32*1024**2;
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function exactUTF8(bytes){const text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))fail('EXACT69_INVALID_UTF8');return text;}
export function parseJSON(bytes){try{return JSON.parse(exactUTF8(bytes));}catch(error){fail(error.code==='EXACT69_INVALID_UTF8'?error.code:'EXACT69_INVALID_JSON');}}
export function caseBudget(){return {decoded:0,encoded:0};}
export function countDecoded(budget,bytes){if(!Number.isSafeInteger(bytes)||bytes<0||budget.decoded+bytes>DECODED_LIMIT)fail('EXACT69_CASE_DECODED_AGGREGATE');budget.decoded+=bytes;}
export async function checkedPath(root,name,{missing=false}={}){
  if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'))fail('EXACT69_RELATIVE_PATH_REQUIRED');
  const path=resolve(root,name);if(!path.startsWith(root+'/'))fail('EXACT69_PATH_ESCAPE');
  let cursor='/';for(const piece of dirname(path).split('/').filter(Boolean)){cursor=join(cursor,piece);const stat=await fs.lstat(cursor);if(!stat.isDirectory()||stat.isSymbolicLink())fail('EXACT69_LINKED_PATH');}
  try{const stat=await fs.lstat(path);if(!stat.isFile()||stat.isSymbolicLink())fail('EXACT69_NONREGULAR_FILE');}catch(error){if(!(missing&&error.code==='ENOENT'))throw error;}
  return path;
}
export async function readBound(root,name,expected,{permit,maxBytes=ENCODED_LIMIT,budget=null}={}){
  assertPermit(permit,root);if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>DECODED_LIMIT)fail('EXACT69_READ_LIMIT');
  const path=await checkedPath(root,name),file=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await file.stat();if(!before.isFile()||before.size>maxBytes||expected?.bytes!==undefined&&before.size!==expected.bytes)fail('EXACT69_FILE_SIZE_BINDING');const chunks=[];let total=0;while(total<=maxBytes){const buffer=Buffer.alloc(Math.min(65536,maxBytes+1-total)),{bytesRead}=await file.read(buffer,0,buffer.length,null);if(!bytesRead)break;total+=bytesRead;chunks.push(buffer.subarray(0,bytesRead));}if(total>maxBytes)fail('EXACT69_FILE_GREW_BEYOND_BOUND');const bytes=Buffer.concat(chunks,total),after=await file.stat();if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||bytes.length!==before.size||expected?.sha256&&sha(bytes)!==expected.sha256)fail('EXACT69_FILE_BYTE_BINDING');if(budget)countDecoded(budget,bytes.length);return bytes;}finally{await file.close();}
}
export function decompressBound(bytes,{decoded_bytes,decoded_sha256},budget){
  if(bytes.length>ENCODED_LIMIT||!Number.isSafeInteger(decoded_bytes)||decoded_bytes<1||decoded_bytes>DECODED_LIMIT-budget.decoded)fail('EXACT69_GZIP_BOUND');let plain;try{plain=gunzipSync(bytes,{maxOutputLength:decoded_bytes});}catch{fail('EXACT69_GZIP_DECODE');}if(plain.length!==decoded_bytes||sha(plain)!==decoded_sha256)fail('EXACT69_GZIP_BINDING');countDecoded(budget,plain.length);return plain;
}
export async function readCache(root,reference,{permit,budget}){
  const receiptBytes=await readBound(root,reference.path+'.manifest.json',null,{permit,maxBytes:65536}),receipt=parseJSON(receiptBytes),storage=receipt.storage;
  if(receipt.path!==reference.path||receipt.sha256!==reference.sha256||receipt.bytes!==reference.bytes||storage?.schema!=='lossless-gzip-extraction-cache-v1'||storage.encoding!=='gzip'||storage.serializer!=='UTF8_JSON_STRINGIFY_PRETTY_2_FINAL_LF_V1')fail('EXACT69_CACHE_RECEIPT');
  const encoded=await readBound(root,reference.path,reference,{permit,maxBytes:ENCODED_LIMIT}),plain=decompressBound(encoded,storage,budget),text=exactUTF8(plain),value=parseJSON(plain);if(JSON.stringify(value,null,2)+'\n'!==text||digest(value)!==receipt.result_sha256)fail('EXACT69_CACHE_SERIALIZATION');return {value,receipt,receipt_binding:{sha256:sha(receiptBytes),bytes:receiptBytes.length}};
}
export async function hydrateNative(root,reference,{permit,budget}){
  if(reference?.schema!=='native-source-decoration-reference-v1')fail('EXACT69_NATIVE_REFERENCE_REQUIRED');const{sha256,...body}=reference;if(digest(body)!==sha256||reference.storage_policy!=='LOSSLESS_GZIP_FULL_NATIVE_ENVELOPE_ONCE_PER_CONTRACT_V1')fail('EXACT69_NATIVE_REFERENCE_SEAL');
  const encoded=await readBound(root,reference.artifact.path,reference.artifact,{permit,maxBytes:ENCODED_LIMIT}),plain=decompressBound(encoded,{decoded_bytes:reference.uncompressed_bytes,decoded_sha256:reference.uncompressed_sha256},budget),envelope=parseJSON(plain);
  const expected={envelope_sha256:envelope.sha256,raw_sha256:envelope.raw?.sha256,normalized_sha256:envelope.normalized?.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,method_identity_status:envelope.method_identity_status,policy:envelope.policy,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility};for(const[key,value]of Object.entries(expected))if(reference[key]!==value)fail('EXACT69_NATIVE_REFERENCE_MISMATCH');return envelope;
}
export async function writeGzipCase(root,name,value,{permit,outputBudget,transport,caseID,kind='case'}){
  assertPermit(permit,root);assertTransport(transport);const plain=Buffer.from(JSON.stringify(value,null,2)+'\n');if(plain.length>DECODED_LIMIT)fail('EXACT69_CASE_DECODED_OUTPUT');const encoded=gzipSync(plain,{level:6});if(encoded.length>ENCODED_LIMIT||!Number.isSafeInteger(outputBudget.used)||outputBudget.used+encoded.length>PILOT_LIMITS.pilot_new_run_bytes)fail('EXACT69_CASE_OUTPUT_LIMIT');const request=await transport.requestWrite({case_id:caseID,path:name,kind,encoded_bytes:encoded.length,decoded_bytes:plain.length}),path=await checkedPath(root,name,{missing:true}),file=await fs.open(path,'wx',0o600);try{await file.writeFile(encoded);await file.sync();}finally{await file.close();}outputBudget.used+=encoded.length;const ref={path:name,sha256:sha(encoded),bytes:encoded.length};await transport.committed(request,ref,sha(plain),plain.length);return{...ref,decoded_sha256:sha(plain),decoded_bytes:plain.length};
}
export async function writeMetadata(root,name,value,{permit,outputBudget,transport,caseID='SYNTHETIC_STAGE',kind='metadata'}){assertPermit(permit,root);assertTransport(transport);const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');if(bytes.length>ENCODED_LIMIT||outputBudget.used+bytes.length>PILOT_LIMITS.pilot_new_run_bytes)fail('EXACT69_METADATA_OUTPUT_LIMIT');const request=await transport.requestWrite({case_id:caseID,path:name,kind,encoded_bytes:bytes.length,decoded_bytes:bytes.length}),path=await checkedPath(root,name,{missing:true}),file=await fs.open(path,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}outputBudget.used+=bytes.length;const ref={path:name,sha256:sha(bytes),bytes:bytes.length};await transport.committed(request,ref,sha(bytes),bytes.length);return{...ref,decoded_sha256:sha(bytes),decoded_bytes:bytes.length};}

// SPDX-License-Identifier: AGPL-3.0-only
// Lossless prototype sidecars keep full source evidence once per contract.
import {readFile,stat,mkdir,open,link,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {digest,sha256} from '../../lib/common.mjs';
import {studyPath,assertUnlinked,hashFile} from './store.mjs';

const compress=promisify(gzip),decompress=promisify(gunzip);
export const NATIVE_DECORATION_STORAGE_POLICY='LOSSLESS_GZIP_FULL_NATIVE_ENVELOPE_ONCE_PER_CONTRACT_V1';
export const MAX_NATIVE_ENVELOPE_BYTES=256*1024**2;
export const MAX_NATIVE_COMPRESSED_BYTES=64*1024**2;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const methodIdentity=value=>value===null||hex(value);
function checkedMethod(value){
  const supplied=hex(value.tracer_source_sha256)&&hex(value.collector_source_sha256);
  const eligibility=value.mapping_status==='EXACT_COLLECTOR_ORIGIN'?'EXACT_SOURCE_EVIDENCE':value.mapping_status==='COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE'?value.mapping_status:'BLOCKED_UNRESOLVED_SOURCE_EVIDENCE';
  if(!methodIdentity(value.tracer_source_sha256)||!methodIdentity(value.collector_source_sha256)||value.method_identity_status!==(supplied?'CURRENT_METHOD_BINDINGS_SUPPLIED':'UNBOUND_MISSING_CURRENT_METHOD_IDENTITIES')||!supplied&&eligibility!=='BLOCKED_UNRESOLVED_SOURCE_EVIDENCE'||value.input_eligibility!==eligibility)throw new Error('Native storage method scope differs');
}

function seal(value){return {...value,sha256:digest(value)};}
function checkedSeal(value,label){const {sha256:hash,...body}=value??{};if(!hex(hash)||digest(body)!==hash)throw new Error(`${label} digest differs`);return value;}
function checkedEnvelope(value){
  checkedSeal(value,'Native envelope');checkedSeal(value.trace,'Native trace');
  if(!/^native-source-decoration-envelope-v[1-9]\d*$/u.test(value.schema??'')||!hex(value.raw?.sha256)||!hex(value.normalized?.sha256)||value.trace.raw?.sha256!==value.raw.sha256||typeof value.policy!=='string'||typeof value.mapping_status!=='string'||value.authority!=='NONE'||value.computed_style_verified!==false||value.effectiveness_verified!==false)throw new Error('Native envelope binding or scope differs');
  checkedMethod(value);
  return value;
}
function checkedReference(value){
  checkedSeal(value,'Native envelope reference');
  if(value.schema!=='native-source-decoration-reference-v1'||value.storage_policy!==NATIVE_DECORATION_STORAGE_POLICY||!hex(value.envelope_sha256)||!hex(value.raw_sha256)||!hex(value.normalized_sha256)||value.authority!=='NONE'||!Number.isSafeInteger(value.uncompressed_bytes)||value.uncompressed_bytes<1||value.uncompressed_bytes>MAX_NATIVE_ENVELOPE_BYTES||!hex(value.uncompressed_sha256)||!Number.isSafeInteger(value.artifact?.bytes)||value.artifact.bytes<1||value.artifact.bytes>MAX_NATIVE_COMPRESSED_BYTES||!hex(value.artifact.sha256)||typeof value.artifact.path!=='string'||!value.artifact.path.endsWith('.json.gz'))throw new Error('Native envelope reference binding or bound differs');
  checkedMethod(value);
  return value;
}
function matchReference(envelope,reference){
  if(envelope.sha256!==reference.envelope_sha256||envelope.raw.sha256!==reference.raw_sha256||envelope.normalized.sha256!==reference.normalized_sha256||envelope.tracer_source_sha256!==reference.tracer_source_sha256||(envelope.collector_source_sha256??null)!==reference.collector_source_sha256||envelope.method_identity_status!==reference.method_identity_status||envelope.policy!==reference.policy||envelope.mapping_status!==reference.mapping_status||envelope.input_eligibility!==reference.input_eligibility)throw new Error('Native sidecar source binding differs');
}

/** Immutable, exact-byte gzip. A caller may supply its remaining study budget;
 * the temporary file and exclusive commit are both covered conservatively.
 * Existing artifacts are verified and reused, never replaced or repaired.
 */
export async function storeNativeDecoration(runDir,name,envelope,{remainingBytes=Number.MAX_SAFE_INTEGER}={}){
  checkedEnvelope(envelope);
  if(!Number.isSafeInteger(remainingBytes)||remainingBytes<0||typeof name!=='string'||!name.endsWith('.json.gz'))throw new Error('Explicit native storage path/budget required');
  const plain=Buffer.from(JSON.stringify(envelope));if(plain.length>MAX_NATIVE_ENVELOPE_BYTES)throw new Error('Native envelope exceeds explicit decompressed bound; evidence retained, extraction not admitted');
  const bytes=await compress(plain,{level:6});if(bytes.length>MAX_NATIVE_COMPRESSED_BYTES)throw new Error('Native sidecar exceeds explicit compressed bound');
  const path=await studyPath(runDir,name,{missing:true});let resumed=false;
  try{const actual=await hashFile(path);if(actual.sha256!==sha256(bytes)||actual.bytes!==bytes.length)throw new Error('Immutable native sidecar already differs');resumed=true;}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    if(bytes.length*2>remainingBytes)throw new Error('Native sidecar exceeds remaining study storage budget');
    await mkdir(dirname(path),{recursive:true});await assertUnlinked(dirname(path));
    const partial=`${path}.${randomUUID()}.partial`,file=await open(partial,'wx',0o600);
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    try{await link(partial,path);}catch(error){if(error.code!=='EEXIST')throw error;const actual=await hashFile(path);if(actual.sha256!==sha256(bytes)||actual.bytes!==bytes.length)throw new Error('Concurrent immutable native sidecar differs');resumed=true;}
    // Remove only this successful writer's transfer, retaining any failed data.
    await unlink(partial);
  }
  const reference=seal({schema:'native-source-decoration-reference-v1',storage_policy:NATIVE_DECORATION_STORAGE_POLICY,envelope_sha256:envelope.sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256??null,method_identity_status:envelope.method_identity_status,policy:envelope.policy,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,uncompressed_bytes:plain.length,uncompressed_sha256:sha256(plain),artifact:{path:name,bytes:bytes.length,sha256:sha256(bytes)},authority:'NONE'});
  return {reference,resumed,added_bytes:resumed?0:bytes.length};
}

/** Bound compressed input and zlib output before JSON allocation; verify both
 * serialized bytes and the independently sealed full evidence object.
 */
export async function loadNativeDecoration(runDir,value){
  if(value?.schema!=='native-source-decoration-reference-v1')return checkedEnvelope(value);
  const reference=checkedReference(value),path=await studyPath(runDir,reference.artifact.path);
  if((await stat(path)).size!==reference.artifact.bytes)throw new Error('Native sidecar compressed byte binding differs');
  const bytes=await readFile(path);if(sha256(bytes)!==reference.artifact.sha256)throw new Error('Native sidecar compressed digest differs');
  const plain=await decompress(bytes,{maxOutputLength:reference.uncompressed_bytes});
  if(plain.length!==reference.uncompressed_bytes||sha256(plain)!==reference.uncompressed_sha256)throw new Error('Native sidecar decompressed binding differs');
  const envelope=checkedEnvelope(JSON.parse(plain.toString('utf8')));matchReference(envelope,reference);return envelope;
}

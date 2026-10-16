// SPDX-License-Identifier: AGPL-3.0-only
// Immutable bounded chunks permit cumulative study checkpoints without per-unit files.
import {readFile,readdir,mkdir,writeFile,link,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import {digest,sha256,within,readJSON} from '../../lib/common.mjs';
import {hashFile,studyPath} from './store.mjs';
import {atomicJSON} from './workflow.mjs';
async function binary(path,bytes) {await mkdir(dirname(path),{recursive:true});try{const old=await readFile(path);if(sha256(old)!==sha256(bytes))throw new Error('Vector cache binary collision');return {sha256:sha256(old),bytes:old.length};}catch(error){if(error.code!=='ENOENT')throw error;}const temporary=`${path}.${randomUUID()}.partial`;try{await writeFile(temporary,bytes,{flag:'wx'});await link(temporary,path);}finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}return {sha256:sha256(bytes),bytes:bytes.length};}
export async function createChunkVectorCache(runDir,identity,{dimensions}={}) {
  const prefix=`vector-cache/${digest(identity).slice(0,24)}`;await studyPath(runDir,prefix,{missing:true});await mkdir(within(runDir,prefix),{recursive:true});
  const index=new Map();const loaded=new Map();
  for(const name of (await readdir(within(runDir,prefix))).filter(name=>/^chunk-[a-f0-9]{64}[.]json$/.test(name)).sort()) {
    const manifest=await readJSON(await studyPath(runDir,`${prefix}/${name}`));if(digest(manifest.identity)!==digest(identity)||manifest.dimensions!==dimensions||manifest.inputs.length>500)throw new Error('Vector cache manifest identity differs');
    const actual=await hashFile(await studyPath(runDir,manifest.vectors.path));if(actual.sha256!==manifest.vectors.sha256||actual.bytes!==manifest.inputs.length*dimensions*4)throw new Error('Vector cache bytes changed');
    manifest.inputs.forEach((input,offset)=>{if(!/^[a-f0-9]{64}$/.test(input.input_sha256))throw new Error('Invalid cached input identity');const item={manifest,offset,input};if(index.has(input.input_sha256)&&index.get(input.input_sha256).input.vector_sha256!==input.vector_sha256)throw new Error('Conflicting cached vectors');index.set(input.input_sha256,item);});
  }
  const get=async hash=>{const item=index.get(hash);if(!item)return null;const path=item.manifest.vectors.path;let bytes=loaded.get(path);if(!bytes){bytes=await readFile(await studyPath(runDir,path));if(sha256(bytes)!==item.manifest.vectors.sha256)throw new Error('Cached vector bytes changed after indexing');loaded.set(path,bytes);if(loaded.size>8)loaded.delete(loaded.keys().next().value);}const start=item.offset*dimensions*4;const segment=bytes.subarray(start,start+dimensions*4);if(sha256(segment)!==item.input.vector_sha256)throw new Error('Cached vector row changed');const vector=new Float32Array(dimensions);for(let d=0;d<dimensions;d++){vector[d]=segment.readFloatLE(d*4);if(!Number.isFinite(vector[d]))throw new Error('Nonfinite cached vector');}return {vector,input:item.input.metadata};};
  const put=async(result)=>{if(!result.inputs.length)return;if(result.dimensions!==dimensions||result.inputs.length>500||result.packed_vectors.length!==result.inputs.length*dimensions)throw new Error('Cache chunk dimensions differ');const bytes=Buffer.alloc(result.packed_vectors.length*4);for(let i=0;i<result.packed_vectors.length;i++){if(!Number.isFinite(result.packed_vectors[i]))throw new Error('Nonfinite cache input');bytes.writeFloatLE(result.packed_vectors[i],i*4);}const inputs=result.inputs.map((input,i)=>({input_sha256:input.input_sha256,vector_sha256:sha256(bytes.subarray(i*dimensions*4,(i+1)*dimensions*4)),metadata:input}));const tag=digest(inputs.map(item=>item.input_sha256));const vectorPath=`${prefix}/chunk-${tag}.f32`;const retained=await binary(within(runDir,vectorPath),bytes);const manifest={schema_version:2,identity,dimensions,inputs,vectors:{path:vectorPath,...retained}};await atomicJSON(within(runDir,`${prefix}/chunk-${tag}.json`),manifest);inputs.forEach((input,offset)=>index.set(input.input_sha256,{manifest,offset,input}));};
  return {get,put,prefix,size:()=>index.size};
}

// SPDX-License-Identifier: AGPL-3.0-only
import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {digest,sha256,requireContainer,readJSON,within} from '../../lib/common.mjs';
import {atomicJSON} from './workflow.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const names=['config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','onnx/model.onnx','README.md'];
async function unlinkedDirectory(path) {let current=path;while(current!=='/'){try{const info=await lstat(current);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Model directory must be regular and unlinked');}catch(error){if(error.code!=='ENOENT')throw error;}current=dirname(current);}}
export async function freezeComparisonPlan(runDir) {
  requireContainer();const recipe=await readJSON(resolve(root,'../comparison-recipe.json'));await atomicJSON(within(runDir,'comparison-plan.json'),recipe);return recipe;
}
export async function provisionComparisonModel(runDir,{log=console.log}={}) {
  requireContainer();const plan=await freezeComparisonPlan(runDir);const config=plan.secondModel;
  const base='/opt/nonverba-tools/priors-derivation-0.2/models';const directory=resolve(base,config.repository,config.revision);
  if(!directory.startsWith(`${base}/`)||! /^[a-f0-9]{40}$/.test(config.revision))throw new Error('Comparison model requires exact managed revision');
  await unlinkedDirectory(directory);await mkdir(directory,{recursive:true});
  const metadata_url=`https://huggingface.co/api/models/${config.repository}/revision/${config.revision}?blobs=true`;
  const response=await fetch(metadata_url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error(`Model metadata HTTP_${response.status}`);
  const metadata=await response.json();if(metadata.sha!==config.revision||metadata.cardData?.license!==config.license)throw new Error('Comparison revision/license mismatch');
  const files=[];let downloaded=0;
  for(const name of names) {
    const declared=metadata.siblings.find(item=>item.rfilename===name);if(!declared||declared.size>134217728)throw new Error('Comparison artifact missing or outside frozen size bound');
    const path=resolve(directory,name);await unlinkedDirectory(dirname(path));await mkdir(dirname(path),{recursive:true});let bytes;
    try{const info=await lstat(path);if(info.isSymbolicLink()||!info.isFile())throw new Error('Model artifact must be a regular file');bytes=await readFile(path);}
    catch(error){if(error.code!=='ENOENT')throw error;log(`Provisioning exact comparison artifact ${name}`);const r=await fetch(`https://huggingface.co/${config.repository}/resolve/${config.revision}/${name}`,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw new Error(`Model artifact HTTP_${r.status}`);let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>134217728)throw new Error('Comparison artifact exceeds134MiB bound');chunks.push(Buffer.from(chunk));}bytes=Buffer.concat(chunks);}
    const hash=sha256(bytes);if(bytes.length!==declared.size||(declared.lfs&&declared.lfs.sha256!==hash)||(!declared.lfs&&createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')!==declared.blobId))throw new Error(`Comparison artifact upstream binding differs: ${name}`);
    try{await lstat(path);}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(path,bytes,{flag:'wx'});downloaded+=bytes.length;}
    files.push({path:name,bytes:bytes.length,sha256:hash,upstream_blob_id:declared.blobId,upstream_lfs_sha256:declared.lfs?.sha256??null});
  }
  const manifest={schema_version:2,...config,directory,files,file_set_sha256:digest(files),metadata_url,license:'apache-2.0',execution_attested:false};
  await atomicJSON(resolve(directory,'provisioning.json'),manifest);await atomicJSON(within(runDir,'comparison-model.json'),manifest);
  return {status:'PINNED_COMPARISON_MODEL_VERIFIED',downloaded_bytes:downloaded,manifest_path:'comparison-model.json',model:manifest};
}

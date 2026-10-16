// SPDX-License-Identifier: AGPL-3.0-only
// Scoped source closure only. Never loads packages, production payloads or RUN.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {sha,digest} from '../../finite-codec.mjs';
export const OWNED_FILES=Object.freeze(['README.md','API.md','fork-origins.json','admission.mjs','input-io.mjs','preflight.mjs','control.mjs','io.mjs','output-io.mjs','projector.mjs','driver.mjs','bootstrap.mjs','resources.mjs','configuration.mjs','fixtures.mjs','controls.test.mjs','identity.mjs','freeze.mjs']);
export const REUSED=Object.freeze([
  {path:'finite-codec.mjs',sha256:'61511a5846365aa6282f531c2dfcc5e5bc0e1645db4fccb978472ca82f95aa72',bytes:11055},
  {path:'immutable-state.mjs',sha256:'8fed0925dc180a5099c873f22023c07493f6d115018f9f1ff5df34b70b7394b9',bytes:1976},
  {path:'pilot-sampling.mjs',sha256:'6d2352c1732eafa6e657d38fd50a4a9c8762c4567ab0746366162765125bbf38',bytes:7277},
  {path:'pilot-execution-control.mjs',sha256:'53556135cc01cc546216d97bc1500180d87e61e5d96a9e7075adff17b62db570',bytes:15508},
  {path:'next-stage-v1/focal-selection.mjs',sha256:'d1f10a48123ae0281600f8baca2b3f6c8e8e473da94e1f26cc8d96454630db2f',bytes:5945},
  {path:'actual-entry-v1/bindings.mjs',sha256:'81b64584114049c06c32481a99d190077cc2866124d29ac8e9dfbbb7bdefa943',bytes:3986},
  {path:'actual-entry-v1/checkpoint.mjs',sha256:'a7bde16bb7ee6d77219db181fe2a7d6404af345e82a97fecc548445d6c618221',bytes:2823}
]);
export const PROJECTOR_ORIGIN=Object.freeze({path:'actual-entry-v1/projector.mjs',sha256:'99d1d31b28af2cb11c63899508f16b7eb54477aa5d8cc57c86012ebb004d30b4',bytes:19060});
const transforms=[['../finite-codec.mjs','../../finite-codec.mjs'],['../immutable-state.mjs','../../immutable-state.mjs'],['../pilot-sampling.mjs','../../pilot-sampling.mjs'],['../next-stage-v1/focal-selection.mjs','../../next-stage-v1/focal-selection.mjs'],['./bindings.mjs','../bindings.mjs']];
export async function scopedSourceClosure(){
  if(typeof vm.SourceTextModule!=='function')throw Error('METADATA_STATIC_VM_FLAG_REQUIRED');const base=new URL('../../',import.meta.url),own=[],reused=[],texts=new Map(),allowed=new Set();
  for(const name of OWNED_FILES){const url=new URL(name,import.meta.url),s=await fs.lstat(url);if(!s.isFile()||s.isSymbolicLink())throw Error('METADATA_SOURCE_FILE_TYPE');const b=await fs.readFile(url);own.push({path:'actual-entry-v1/metadata-selection-v1/'+name,sha256:sha(b),bytes:b.length});texts.set(url.href,b.toString('utf8'));allowed.add(url.href);}
  for(const r of[...REUSED,PROJECTOR_ORIGIN]){const url=new URL(r.path,base),s=await fs.lstat(url),b=await fs.readFile(url);if(!s.isFile()||s.isSymbolicLink()||b.length!==r.bytes||sha(b)!==r.sha256)throw Error('METADATA_REUSED_SOURCE_CHANGED');if(r!==PROJECTOR_ORIGIN){reused.push(r);texts.set(url.href,b.toString('utf8'));allowed.add(url.href);}}
  const original=await fs.readFile(new URL(PROJECTOR_ORIGIN.path,base),'utf8');let expected=original;for(const[a,b]of transforms)expected=expected.replace("from '"+a+"'","from '"+b+"'");if(expected!==texts.get(new URL('projector.mjs',import.meta.url).href))throw Error('METADATA_PROJECTOR_NONIMPORT_CHANGE');
  const static_edges=[];for(const[url,text]of texts){if(!url.endsWith('.mjs'))continue;const mod=new vm.SourceTextModule(text,{identifier:url});for(const specifier of mod.dependencySpecifiers){if(specifier.startsWith('node:'))continue;const target=specifier.startsWith('.')?new URL(specifier,url).href:null;if(!target||!allowed.has(target))throw Error('METADATA_UNBOUND_STATIC_IMPORT');static_edges.push({from:fileURLToPath(url),specifier,target:fileURLToPath(target)});}}
  const dynamic_entries=['./admission.mjs','./preflight.mjs','./output-io.mjs','./control.mjs','./driver.mjs'].map(specifier=>({from:'bootstrap.mjs',specifier,target:'actual-entry-v1/metadata-selection-v1/'+specifier.slice(2)}));
  const body={schema:'closed-metadata-selection-scoped-source-v1',status:'SOURCE_ONLY_ACTUAL_ENTRY_CLOSED',owned_files:own,reused_files:reused,projector_origin:PROJECTOR_ORIGIN,projector_exact_changes:transforms.map(([from,to])=>({from,to,kind:'STATIC_IMPORT_ROUTING_ONLY'})),static_edges,dynamic_entries,static_modules_linked_or_evaluated:false,configured_runtime:'EXISTING_MANAGED_NODE_ONLY_NO_TOKENIZER_RUNTIME',dynamic_general_closure_verified:false,actual_enabled:false,authority:'NONE'};return{...body,sha256:digest(body)};
}

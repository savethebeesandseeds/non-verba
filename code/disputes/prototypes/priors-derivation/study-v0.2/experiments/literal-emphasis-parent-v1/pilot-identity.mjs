// SPDX-License-Identifier: AGPL-3.0-only
// Explicit code/runtime dependency binding. No corpus or directory inventory.
import {readFile,realpath} from 'node:fs/promises';
import vm from 'node:vm';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,sha} from './finite-codec.mjs';
import {immutableCopy} from './immutable-state.mjs';
import {freezePrototype} from './freeze.mjs';
export const UPSTREAM='/tmp/nonverba-unified-source/f7cd9407508443b8a20ad70bc46349ab/code/disputes/prototypes/priors-derivation/study-v0.2';
export const PREPARATION_NODE_VERSION='v22.23.3';
export const UPSTREAM_MODULES=Object.freeze(['sections.mjs','source-decoration.mjs','native-decoration-store.mjs','source-issues.mjs','representation-issues.mjs','representation-replay.mjs','audit-reader.mjs','representation.mjs','embedding.mjs','analysis.mjs','sensitivity.mjs','workflow.mjs','store.mjs','acquisition.mjs','../comparison-recipe.json','../../lib/common.mjs','../../lib/acquire.mjs','../../lib/analyze.mjs','../../lib/extract.mjs','../../lib/embed.mjs','../../lib/discover.mjs','../../package.json','../../package-lock.json']);
const PACKAGES=new Set(['parse5','entities']);
export const CONFIGURED_ENTRIES=immutableCopy({prototype_collector:'./sections.prototype.mjs',control_upstream_collector:UPSTREAM+'/lib/sections.mjs',pinned_tokenizer_service:UPSTREAM+'/lib/embedding.mjs',tokenizer_runtime:'@huggingface/transformers@3.8.1'});
export function assertConfiguredEntryPoint(role,specifier){if(!Object.hasOwn(CONFIGURED_ENTRIES,role)||CONFIGURED_ENTRIES[role]!==specifier)throw Object.assign(new Error('Unbound runtime/callback entrypoint; actual execution remains disabled'),{code:'PILOT_UNBOUND_RUNTIME_ENTRYPOINT'});return specifier;}
/** Parse, never link/evaluate, public pinned ESM source. Documentation and
 * strings are not import declarations. Dynamic runtime execution is unclaimed. */
export function staticModuleRequests(text){if(process.version!==PREPARATION_NODE_VERSION||typeof vm.SourceTextModule!=='function')throw new Error('Dependency binding requires pinned Node22.23.3 with --experimental-vm-modules parse-only backend');const parsed=new vm.SourceTextModule(text);if(parsed.status!=='unlinked')throw new Error('Static dependency parser unexpectedly linked');return [...parsed.dependencySpecifiers];}
function conditional(value){if(typeof value==='string')return value;if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Unsupported pinned package export shape');for(const [key,target] of Object.entries(value))if(['node','import','default'].includes(key))return conditional(target);throw new Error('Pinned ESM export condition unresolved');}
async function parserClosure(){
  const files=new Map(),packages=new Map(),pending=[fileURLToPath(import.meta.resolve('parse5'))];let total=0;
  async function bare(specifier,parent){const [name,...parts]=specifier.split('/');if(!PACKAGES.has(name))throw new Error('Unexpected parser dependency');let at=dirname(parent),root,bytes;while(true){try{const p=join(at,'node_modules',name,'package.json');bytes=await readFile(p);root=dirname(p);break;}catch(error){if(error.code!=='ENOENT')throw error;}const next=dirname(at);if(next===at)throw new Error('Pinned parser dependency missing');at=next;}
    root=await realpath(root);if(!root.startsWith('/opt/nonverba-tools/priors-derivation-0.1/node_modules/'))throw new Error('Parser dependency outside existing pinned runtime');const pkg=JSON.parse(bytes),sub=parts.length?'./'+parts.join('/') :'.',exports=pkg.exports,target=conditional(exports&&Object.keys(exports).some(k=>k.startsWith('.'))?exports[sub]:exports);if(!target.startsWith('./'))throw new Error('External package export target unsupported');packages.set(root+'/package.json',{path:root+'/package.json',sha256:sha(bytes),bytes:bytes.length,name:pkg.name,version:pkg.version});return resolve(root,target);
  }
  while(pending.length){const path=await realpath(pending.pop());if(files.has(path))continue;if(files.size>=128||!path.startsWith('/opt/nonverba-tools/priors-derivation-0.1/node_modules/')||!path.endsWith('.js'))throw new Error('Parser static closure exceeds its reviewed scope');const bytes=await readFile(path),text=bytes.toString('utf8');total+=bytes.length;if(total>2097152)throw new Error('Oversized parser dependency closure');files.set(path,{path,sha256:sha(bytes),bytes:bytes.length});for(const spec of staticModuleRequests(text)){if(spec.startsWith('node:'))continue;pending.push(spec.startsWith('.')?resolve(dirname(path),spec):await bare(spec,path));}}
  // Bind the entry's own package descriptor too, even if no bare re-export.
  await bare('parse5',fileURLToPath(import.meta.url));return {policy:'REVIEWED_STATIC_ESM_PARSE5_ENTITIES_IMPORT_REEXPORT_CLOSURE_V1',files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),packages:[...packages.values()].sort((a,b)=>a.path.localeCompare(b.path)),bytes:total,backend:'NODE_VM_SOURCE_TEXT_MODULE_PARSE_ONLY_NO_LINK_OR_EVALUATION',required_flag:'--experimental-vm-modules',dynamic_runtime_closure_verified:false,reviewed_static_graph_only:true};
}
export async function computePilotEpoch({extractionOptions,selectionOptions}={}){
  if(process.env.NONVERBA_CONTAINER!=='1'||process.platform!=='linux')throw new Error('Managed Linux source-free/actual-pilot environment required');
  const frozen=await freezePrototype(),upstream=[];for(const path of UPSTREAM_MODULES){const bytes=await readFile(resolve(UPSTREAM,'lib',path));upstream.push({path,sha256:sha(bytes)});}
  const parser=await parserClosure(),own=file=>frozen.files.find(f=>f.path===file)?.sha256;
  const body={schema:'isolated-actual-pilot-source-epoch-v1',status:'PROTOTYPE_UNADOPTED_NEW_METHOD_NOT_CURRENT874',experiment_source_set_sha256:frozen.ordered_source_set_sha256,experiment_files:frozen.files,tracer_source_sha256:own('source-decoration.prototype.mjs'),collector_source_sha256:own('sections.prototype.mjs'),codec_source_sha256:own('finite-codec.mjs'),planner_source_sha256:own('window-planner.mjs'),upstream_reference_files:upstream,parser_dependency_closure:parser,configured_runtime_entries:CONFIGURED_ENTRIES,dependency_scope:'EXACT_OWNED_FILE_SET_PLUS_STATIC_PARSER_ESM_GRAPH_PLUS_EXPLICIT_CONFIGURED_FROZEN_SERVICE; NOT_GENERAL_DYNAMIC_REQUIRE_CALLBACK_FS_CODE_CLOSURE',dynamic_runtime_closure_verified:false,actual_entry_hard_disabled:true,runtime:{node:process.version,platform:process.platform,architecture:process.arch},tokenizer_runtime:'EXACT_FROZEN_PINNED_TOKENIZER_API_AND_VERIFIED_MODEL_FILE_SET; separate measured policies required; external runtime package code not byte-enumerated here',parameters:{extraction:extractionOptions,selection:selectionOptions},whole_experiment_dependency_binding:true,old23_fingerprint_covers_new_modules:false,authority:'NONE'};
  return immutableCopy({...body,sha256:digest(body)});
}
export function verifyCurrentProof(source,epoch,{control=false}={}){
  const {sha256,...body}=source??{};if(sha256!==digest(body)||digest(source.files)!==digest(epoch.upstream_reference_files)||digest(source.parameters?.extraction)!==digest(epoch.parameters.extraction)||source.parameters?.selection_seed!==epoch.parameters.selection.seed)throw new Error('Current production source proof/options/dependency binding differs');
  if(!control&&sha256!=='874c6b505ae5fc09fd3d92d46c64cd5474abf90fe574537c5e101b4fcaac6afa')throw new Error('Actual pilot requires exact current874 basis');return sha256;
}
/** Source-free test proof, explicitly different from current874. */
export function syntheticCurrentProof(epoch){const body={parameters:{extraction:epoch.parameters.extraction,native_input_profile:{baseline_embedding:null},selection_seed:epoch.parameters.selection.seed,selection_authority:'PROVISIONAL_PER_CONTRACT_ONLY_GLOBAL_ADMISSION_SEPARATE'},files:epoch.upstream_reference_files,runtime:epoch.runtime};return immutableCopy({...body,sha256:digest(body)});}

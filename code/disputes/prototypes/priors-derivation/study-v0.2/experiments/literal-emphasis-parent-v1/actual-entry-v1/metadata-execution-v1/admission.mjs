// SPDX-License-Identifier: AGPL-3.0-only
// Functional actual capability requires the verified external literal gate.
import fs from 'node:fs/promises';
import path from 'node:path';
import {immutableCopy} from '../../immutable-state.mjs';
import {gateContext,FIXED_RUN,fail,reference} from './builtin-gate.mjs';
import {assertActorAdmission} from './builtin-ownership.mjs';
export {fail};
const contexts=new WeakMap();
const permissions=new WeakMap();
function mint(data){const permit=Object.freeze({kind:'OWNED_METADATA_PHASE_CONTEXT'});contexts.set(permit,immutableCopy(data));return permit;}
export function admitVerifiedMetadata(token,role,proof){const g=gateContext(token);if(g.actual_io_verified!==true)fail('EXECUTOR_FAKE_GATE_NOT_ACTUAL_AUTHORITY');if(!['PARENT','WORKER'].includes(role))fail('EXECUTOR_ROLE');assertActorAdmission(proof,token,role,{first_access:true});const permit=mint({phase:'METADATA_SELECTION_ONLY',role,input_root:FIXED_RUN,output_root:g.output_root,bindings:g.config.bindings,roster_ref:g.config.roster_ref,source_epoch_sha256:g.epoch_ref.sha256,fixture:false,source_kind:'ROOT_ADMITTED_METADATA_ONLY',actual_authority:false});permissions.set(permit,{token,role,proof,first:false});return permit;}
export function admitActualExecution(token,proof,role){const g=gateContext(token);if(g.actual_io_verified!==true)fail('EXECUTOR_FAKE_GATE_NOT_ACTUAL_AUTHORITY');assertActorAdmission(proof,token,role,{first_access:true});return g;}
export function authorizeFirstMetadataRead(permit){const c=contextOf(permit);if(c.fixture)return;const p=permissions.get(permit);if(!p)fail('EXECUTOR_ACTOR_OBSERVER_AUTHORIZATION_REQUIRED');if(!p.first){assertActorAdmission(p.proof,p.token,p.role,{first_access:true});p.first=true;}}
export function contextOf(permit){const c=contexts.get(permit);if(!c)fail('EXECUTOR_PRIVATE_CONTEXT_REQUIRED');return c;}
export function assertPermit(permit,root){const c=contextOf(permit);if(c.input_root!==root)fail('EXECUTOR_INPUT_ROOT');return c.fixture?'SOURCE_FREE_FIXTURE':'ROOT_ADMITTED_METADATA_ONLY';}
export function assertSyntheticID(permit,root,id){assertPermit(permit,root);if(typeof id!=='string'||!/^SYNTHETIC_[A-Za-z0-9_:-]+$/u.test(id))fail('EXECUTOR_SYNTHETIC_ID');}
export async function admitFictionalMetadata(data){const c=immutableCopy(data);if(c.phase!=='METADATA_SELECTION_ONLY'||!['PARENT','WORKER'].includes(c.role)||typeof c.input_root!=='string'||!/^\/tmp\/literal-emphasis-(?:execution|metadata)-[A-Za-z0-9_-]+\/inputs$/u.test(c.input_root)||c.output_root!==path.dirname(c.input_root)+'/outputs'||c.actual_authority!==false||Object.keys(c.bindings??{}).sort().join(',')!=='development,fresh,manifest')fail('EXECUTOR_FICTIONAL_CONTEXT');for(const r of[...Object.values(c.bindings),c.roster_ref])reference(r,{abs:false});for(const root of[c.input_root,c.output_root])if(await fs.realpath(root)!==root||(await fs.lstat(root)).isSymbolicLink())fail('EXECUTOR_FICTIONAL_ROOT');return mint({...c,fixture:true,source_kind:'SOURCE_FREE_FIXTURE'});}

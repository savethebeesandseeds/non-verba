// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE PREPARATION ONLY. Actual entries reject before touching arguments.
import fs from 'node:fs/promises';
import path from 'node:path';
import {immutableCopy} from '../../immutable-state.mjs';
import {reference} from '../../pilot-execution-control.mjs';
const contexts=new WeakMap();
export const ACTUAL_METADATA_ENTRY_ENABLED=false;
export const PHASE='METADATA_SELECTION_ONLY';
export const fail=code=>{throw Object.assign(Error(code),{code});};
export function admitActualMetadataSelection(){fail('ACTUAL_METADATA_SELECTION_CLOSED');}
export const admitActualExecution=admitActualMetadataSelection;
export function openActualMetadataContext(){fail('ACTUAL_METADATA_SELECTION_CLOSED');}
export async function admitFictionalMetadata(input){
  const value=immutableCopy(input),{input_root,output_root}=value;
  if(value.phase!==PHASE||typeof input_root!=='string'||typeof output_root!=='string'||!/^\/tmp\/literal-emphasis-metadata-[A-Za-z0-9_-]+\/inputs$/u.test(input_root)||output_root!==path.dirname(input_root)+'/outputs')fail('METADATA_FICTIONAL_TWO_ROOTS_REQUIRED');
  if(!value.bindings||Object.keys(value.bindings).sort().join(',')!=='development,fresh,manifest')fail('METADATA_EXACT_THREE_INPUT_ROLES');
  for(const ref of[value.bindings.manifest,value.bindings.fresh,value.bindings.development,value.roster_ref])reference(ref,{maxBytes:8388608});
  if(!/^[a-f0-9]{64}$/u.test(value.source_epoch_sha256??''))fail('METADATA_SOURCE_EPOCH_REFERENCE');
  for(const root of[input_root,output_root]){let at='/';for(const part of root.split('/').filter(Boolean)){at=path.join(at,part);const s=await fs.lstat(at);if(!s.isDirectory()||s.isSymbolicLink())fail('METADATA_FICTIONAL_ROOT_LINK');}if(await fs.realpath(root)!==root)fail('METADATA_FICTIONAL_REALPATH');}
  if(value.actual_authority!==false)fail('METADATA_FICTIONAL_NOT_AUTHORITY');
  const permit=Object.freeze({kind:'FICTIONAL_METADATA_TWO_ROOT_CAPABILITY'});contexts.set(permit,value);return permit;
}
export function contextOf(permit){const c=contexts.get(permit);if(!c)fail('METADATA_PRIVATE_FICTIONAL_PERMIT_REQUIRED');return c;}
export function assertPermit(permit,root){if(contextOf(permit).input_root!==root)fail('METADATA_INPUT_ROOT_MISMATCH');return 'SOURCE_FREE_FIXTURE';}
export function assertSyntheticID(permit,root,id){assertPermit(permit,root);if(typeof id!=='string'||!/^SYNTHETIC_[A-Za-z0-9_:-]+$/u.test(id))fail('METADATA_FICTIONAL_ID_REQUIRED');}

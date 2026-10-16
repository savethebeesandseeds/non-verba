// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE-ONLY successor. No public argument, JSON seal or flag enables actual.
import {realpath,lstat} from 'node:fs/promises';
import {immutableCopy} from '../immutable-state.mjs';
export const ACTUAL_ENTRY_ENABLED=false;
export const ACTUAL_REVISION='SOURCE_ONLY_CLOSED_BEFORE_INPUT_ACCESS';
const permits=new WeakMap();
const fail=code=>{throw Object.assign(Error(code),{code});};
export function admitActualExecution(){fail('ACTUAL_ENTRY_CLOSED');}
export function openActualPhase(){fail('ACTUAL_ENTRY_CLOSED');}
export async function admitFictionalPhase(root,phase='MANUAL_READER'){
  if(typeof root!=='string'||!/^\/tmp\/literal-emphasis-(?:next|actual)-[A-Za-z0-9_-]+$/u.test(root)||!['METADATA_SELECTION_ONLY','PREPARE_SELECTED69','MANUAL_READER'].includes(phase))fail('ACTUAL_FICTIONAL_ROOT_PHASE_REQUIRED');
  if(await realpath(root)!==root||(await lstat(root)).isSymbolicLink())fail('ACTUAL_FICTIONAL_LINKED_ROOT');
  const context=immutableCopy({root,phase,source_kind:'DECLARED_FICTIONAL_ONLY',actual_authority:false}),permit=Object.freeze({kind:'FICTIONAL_CONTROL_NOT_ACTUAL_AUTHORIZATION'});permits.set(permit,context);return permit;
}
export function assertFictionalPermit(permit,root,{phase}={}){const context=permits.get(permit);if(!context||context.root!==root||phase&&context.phase!==phase)fail('ACTUAL_OWNED_FICTIONAL_PERMIT_REQUIRED');return context;}
// Compatibility for exact isolated copies; all admitted roots remain fictional.
export function assertPermit(permit,root){assertFictionalPermit(permit,root);return 'SOURCE_FREE_FIXTURE';}
export const admitFixtureExecution=root=>admitFictionalPhase(root,'METADATA_SELECTION_ONLY');
export function assertSyntheticID(permit,root,id){assertPermit(permit,root);if(typeof id!=='string'||!id.startsWith('SYNTHETIC_'))fail('ACTUAL_FICTIONAL_ID_REQUIRED');}

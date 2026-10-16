// SPDX-License-Identifier: AGPL-3.0-only
// PREPARATION ONLY. A source revision, not a runtime switch, blocks actual IO.
import {realpath,lstat} from 'node:fs/promises';
export const ACTUAL_REVISION='BLOCKED_PENDING_ROOT_EXECUTION_SHA_AND_ORDERED69_FREEZE';
const permits=new WeakMap();
const reject=code=>{throw Object.assign(new Error(code),{code});};
export function admitActualExecution(){reject('EXACT69_ACTUAL_EXECUTION_DISABLED');}
export async function admitFixtureExecution(root){
  if(typeof root!=='string'||!/^\/tmp\/literal-emphasis-next-[A-Za-z0-9_-]+$/u.test(root))reject('EXACT69_SYNTHETIC_ROOT_REQUIRED');
  if((await realpath(root))!==root||(await lstat(root)).isSymbolicLink())reject('EXACT69_LINKED_FIXTURE_ROOT');
  const permit=Object.freeze({kind:'DECLARED_SYNTHETIC_ONLY_NOT_ACTUAL_AUTHORIZATION'});permits.set(permit,{root,kind:'SOURCE_FREE_FIXTURE'});return permit;
}
export function assertPermit(permit,root){const bound=permits.get(permit);if(!bound||bound.root!==root||bound.kind!=='SOURCE_FREE_FIXTURE')reject('EXACT69_OWNED_ADMISSION_REQUIRED');return bound.kind;}
export function assertSyntheticID(permit,root,id){assertPermit(permit,root);if(typeof id!=='string'||!id.startsWith('SYNTHETIC_'))reject('EXACT69_SYNTHETIC_ID_REQUIRED');}

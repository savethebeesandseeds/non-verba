// SPDX-License-Identifier: AGPL-3.0-only
// Builtins-only actual entry is unconditionally closed, before arguments/imports.
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const ACTUAL_METADATA_LAUNCH_ENABLED=false;
const closed=()=>{throw Object.assign(Error('ACTUAL_METADATA_SELECTION_CLOSED'),{code:'ACTUAL_METADATA_SELECTION_CLOSED'});};
export function startActualMetadataSelection(){closed();}
export function firstActualBuiltinResourceSample(){closed();}
export function observeActualPhaseExit(){closed();}
// This in-process /tmp harness makes no process ownership/resource-proof claims.
export async function startFictionalMetadataSelection(input){
  const{admitFictionalMetadata}=await import('./admission.mjs'),{preflightFictionalMetadata}=await import('./preflight.mjs'),{writeFictionalMetadata}=await import('./output-io.mjs'),{createFictionalHandshake}=await import('./control.mjs');
  const permit=await admitFictionalMetadata(input),scope=await preflightFictionalMetadata(permit);
  await writeFictionalMetadata(permit,scope,'parent-preflight.json',scope,{parent:true});await writeFictionalMetadata(permit,scope,'ordered-development200-ids.json',{schema:'metadata-original200-id-order-v1',expected_ids:scope.expected_ids,preflight_sha256:scope.sha256,authority:'NONE'},{parent:true});await writeFictionalMetadata(permit,scope,'complete-fresh-guard.json',scope.completeFreshProof,{parent:true});
  if(scope.status!=='COMPLETE_ID_ONLY_PREFLIGHT_BEFORE_INIT')return Object.freeze({status:scope.status,scope,worker_initialized:false,actual_authority:false});
  const h=createFictionalHandshake(permit,scope),registered=h.hello({pid:2,start_ticks:'1'}),init=h.ready({preflight_sha256:registered.preflight_sha256});
  // Only this fixed metadata entry is imported after the branded INIT exists.
  const{runFictionalMetadataDriver}=await import('./driver.mjs');return runFictionalMetadataDriver(init);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){process.stderr.write('ACTUAL_METADATA_SELECTION_CLOSED\n');process.exitCode=2;}

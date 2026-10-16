// SPDX-License-Identifier: AGPL-3.0-only
// Imported only after builtin source/capture/resource/owned INIT checks.
import {loadRootInvocation,gateContext,fail} from './builtin-gate.mjs';
import {admitVerifiedMetadata} from './admission.mjs';
import {preflightMetadata} from './preflight.mjs';
import {createOwnedTransport} from './transport.mjs';
import {bindChannel,activateMetadataWorker} from './control.mjs';
import {verifyActorAdmission} from './builtin-ownership.mjs';
import {writeMetadata} from './output-io.mjs';
export async function runOwnedMetadataRole(init){
  if(!process.connected||typeof process.send!=='function'||init?.type!=='INIT'||!['PARENT','WORKER'].includes(init.role))fail('EXECUTOR_OWNED_INIT_REQUIRED');
  const gate=loadRootInvocation(init.literal_args,{entry_path:init.bootstrap_entry}),g=gateContext(gate);if(init.source_epoch_sha256!==g.epoch_ref.sha256||init.configuration_sha256!==g.configuration_ref.sha256)fail('EXECUTOR_INIT_SOURCE_CONFIG');
  // Repeated source/Node hashing is complete before the fresh parent lease.
  const channel=createOwnedTransport(init),grant=await channel.request({type:'ADMISSION_REFRESH',registration_sha256:init.registration_ref?.sha256}),proof=verifyActorAdmission(gate,init,grant.admission_ref),permit=admitVerifiedMetadata(gate,init.role,proof);bindChannel(permit,channel);const scope=await preflightMetadata(permit);
  if(init.role==='PARENT'){
    channel.send({type:'PREFLIGHT',preflight_sha256:scope.sha256,status:scope.status,expected_ids:scope.expected_ids,mandatory_ids:scope.mandatory_audit_ids,freshGuard:scope.freshGuard});
    const refs=[await writeMetadata(permit,'parent-preflight.json',scope),await writeMetadata(permit,'ordered-development200-ids.json',{schema:'metadata-original200-id-order-v1',expected_ids:scope.expected_ids,preflight_sha256:scope.sha256,authority:'NONE'}),await writeMetadata(permit,'complete-fresh-guard.json',scope.completeFreshProof)];
    await channel.done({status:scope.status==='COMPLETE_ID_ONLY_PREFLIGHT_BEFORE_INIT'?'PARENT_COMPLETE':'HELD',preflight_sha256:scope.sha256,output_refs:refs,total_calls:0});return;
  }
  activateMetadataWorker(permit,scope,init.parent_scope);const{runMetadataWorker}=await import('./driver.mjs');await channel.done(await runMetadataWorker(permit));
}

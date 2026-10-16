// SPDX-License-Identifier: AGPL-3.0-only
// Fictional handshake and closed actual control. No process/resource observations.
import {immutableCopy} from '../../immutable-state.mjs';
import {contextOf,fail} from './admission.mjs';
import {preflightContext} from './preflight.mjs';
export {EXECUTION_LIMITS,EXECUTION_RESERVATION,CAPACITY_BINDINGS,assessExecutionSample} from '../../pilot-execution-control.mjs';
const initialized=new WeakMap(),inits=new WeakMap();
export function inspectActualMetadataConfiguration(){fail('ACTUAL_METADATA_SELECTION_CLOSED');}
export function createFictionalHandshake(permit,scope){
  contextOf(permit);preflightContext(permit,scope);if(scope.status!=='COMPLETE_ID_ONLY_PREFLIGHT_BEFORE_INIT')fail('METADATA_PREFLIGHT_HELD_NO_INIT');let state='PREFLIGHT_COMPLETE',identity=null;
  return Object.freeze({hello(input){if(state!=='PREFLIGHT_COMPLETE'||!Number.isSafeInteger(input?.pid)||input.pid<2||!/^\d+$/u.test(input.start_ticks??''))fail('METADATA_FICTIONAL_HELLO');identity=immutableCopy(input);state='REGISTERED';return immutableCopy({type:'REGISTERED',identity,preflight_sha256:scope.sha256,fictional:true});},ready(input){if(state!=='REGISTERED'||input?.preflight_sha256!==scope.sha256)fail('METADATA_REGISTERED_ACK_REQUIRED');state='INITIALIZED';const init=immutableCopy({type:'INIT',phase:'METADATA_SELECTION_ONLY',preflight_sha256:scope.sha256,expected_ids:scope.expected_ids,mandatory_audit_ids:scope.mandatory_audit_ids,source_epoch_sha256:scope.source_epoch_sha256,tokenizer_call_allowance:0,stream_ids:[],fictional_identity:identity,actual_authority:false});initialized.set(permit,scope);inits.set(init,permit);return init;},state:()=>state});
}
export function initializedScope(permit){const s=initialized.get(permit);if(!s)fail('METADATA_WORKER_INIT_REQUIRED');return s;}
export function permitForInit(init){const p=inits.get(init);if(!p)fail('METADATA_OWNED_INIT_REQUIRED');return p;}

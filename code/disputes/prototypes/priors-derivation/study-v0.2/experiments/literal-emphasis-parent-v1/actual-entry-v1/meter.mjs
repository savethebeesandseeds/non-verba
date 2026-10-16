// SPDX-License-Identifier: AGPL-3.0-only
// Source-only counter adapter. Actual opening is closed before any arguments.
import {digest,sha} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {assertPermit,admitActualExecution} from './admission.mjs';
import {assertTransport} from './transport.mjs';
import {checkedPriorCost} from './checkpoint.mjs';
import {verifyOpenedCounterBindings,checkedArtifactBindings} from './bindings.mjs';
const policies=[0,1].map(n=>immutableCopy({version:'DECLARED_FICTIONAL_CODEPOINT_COUNTER_V1',model_repository:'SYNTHETIC_MODEL_'+n,model_revision:sha('SYNTHETIC_REVISION_'+n).slice(0,40),verified_file_set_sha256:sha('SYNTHETIC_FILE_SET_'+n),special_tokens:true,truncation:false,runtime:'DECLARED_FICTIONAL_ONLY_NOT_TRANSFORMERS',downloads_attempted:0,onnx_session_created:false,model_inference:false}));
export const FIXTURE_COUNTER_POLICIES=Object.freeze(policies.map(digest));
export const FIXTURE_EXPECTED_POLICIES=immutableCopy(policies.map((policy,n)=>({policy,policy_sha256:FIXTURE_COUNTER_POLICIES[n]})));
const meters=new WeakMap(),fail=code=>{throw Object.assign(Error(code),{code});};
export function openActualCounters(){admitActualExecution();}
export async function createInputMeter(root,{permit,transport,streamIDs,expectedBindings,priorCost={active_elapsed_ms:0,admitted_output_bytes:0}}){
  assertPermit(permit,root);assertTransport(transport);const prior=checkedPriorCost(priorCost);if(!Array.isArray(streamIDs)||new Set(streamIDs).size!==streamIDs.length)fail('ACTUAL_STREAM_ALLOWLIST');const allowed=Object.freeze([...streamIDs]),expected=checkedArtifactBindings(expectedBindings,{fixture:true});
  const rawCounters=policies.map((policy,n)=>({policy,policy_sha256:FIXTURE_COUNTER_POLICIES[n],tokenCount:text=>Array.from(text).length+2}));verifyOpenedCounterBindings(rawCounters,expected);
  const state={total:0,active:null,start:performance.now(),peakRSS:process.memoryUsage().rss},progress=()=>{if(state.active)transport.progress({case_id:state.active.caseID,stream_id:state.active.id,total_calls:state.total,stream_calls:state.active.calls,completed_windows:state.active.windows});};
  const check=()=>{state.peakRSS=Math.max(state.peakRSS,process.memoryUsage().rss);if(state.peakRSS>1073741824||prior.active_elapsed_ms+performance.now()-state.start>180000)fail('ACTUAL_CUMULATIVE_RESOURCE_BOUND');};
  const counters=rawCounters.map(counter=>Object.freeze({...counter,tokenCount(text){if(!state.active)fail('ACTUAL_NO_ACTIVE_STREAM');check();if(state.total>=60000||state.active.calls>=20000)fail('ACTUAL_CALL_BOUND');state.total++;state.active.calls++;const value=counter.tokenCount(text);if(state.total%32===0)progress();return value;}}));
  const meter=Object.freeze({beginStream(caseID,id){if(state.active||!allowed.includes(id)||!id.startsWith(caseID+':'))fail('ACTUAL_STREAM_BINDING');state.active={caseID,id,calls:0,windows:0};check();},endStream(windows){if(!state.active)return;if(!Number.isSafeInteger(windows)||windows<0||windows>8192)fail('ACTUAL_STREAM_WINDOWS');state.active.windows=windows;progress();state.active=null;},snapshot(){return immutableCopy({total_calls:state.total,peak_sampled_RSS_bytes:state.peakRSS,elapsed_ms:performance.now()-state.start,prior_active_elapsed_ms:prior.active_elapsed_ms,active_stream:state.active?.id??null,inference:false});}});meters.set(meter,{counters,bindings:immutableCopy({source_kind:'DECLARED_FICTIONAL_CODEPOINT_COUNTER_ONLY',expected_opened_bindings_verified:true,policies:FIXTURE_EXPECTED_POLICIES,pinned_tokenizers_called:false,models_or_inference_executed:false})});return meter;
}
export function assertOwnedMeter(meter){const value=meters.get(meter);if(!value)fail('ACTUAL_OWNED_METER_REQUIRED');return value;}

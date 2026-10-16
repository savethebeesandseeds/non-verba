// SPDX-License-Identifier: AGPL-3.0-only
// One job-wide synchronous call budget; only named local counter factories.
import {sha} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {openPinnedCounters} from '../pinned-tokenizers.mjs';
import {assertPermit} from './admission.mjs';
import {assertTransport} from './transport.mjs';
export const FIXTURE_COUNTER_POLICIES=Object.freeze([sha('DECLARED_SYNTHETIC_COUNTER_BASELINE_V1'),sha('DECLARED_SYNTHETIC_COUNTER_COMPARISON_V1')]);
const meters=new WeakMap(),fail=code=>{throw Object.assign(Error(code),{code});};
export async function createInputMeter(root,{permit,transport,streamIDs}){
  const fixture=assertPermit(permit,root)==='SOURCE_FREE_FIXTURE';assertTransport(transport);if(!Array.isArray(streamIDs)||new Set(streamIDs).size!==streamIDs.length)fail('EXACT69_STREAM_ALLOWLIST');
  const opened=fixture?{counters:FIXTURE_COUNTER_POLICIES.map(policy_sha256=>({policy_sha256,tokenCount:text=>Array.from(text).length+2})),bindings:{source_kind:'DECLARED_SYNTHETIC_COUNTER_ONLY_NOT_PINNED_MODEL',models_or_inference_executed:false}}:await openPinnedCounters();
  const state={total:0,active:null,start:performance.now(),peakRSS:process.memoryUsage().rss};
  const progress=()=>{if(state.active)transport.progress({case_id:state.active.caseID,stream_id:state.active.id,total_calls:state.total,stream_calls:state.active.calls,completed_windows:state.active.windows});};
  const check=()=>{state.peakRSS=Math.max(state.peakRSS,process.memoryUsage().rss);if(state.peakRSS>1073741824||performance.now()-state.start>180000)fail('EXACT69_SYNCHRONOUS_JOB_RESOURCE_BOUND');};
  const counters=opened.counters.map(counter=>Object.freeze({...counter,tokenCount(text){if(!state.active)fail('EXACT69_NO_ACTIVE_STREAM');check();if(state.total>=60000||state.active.calls>=20000)fail('EXACT69_GLOBAL_OR_STREAM_CALL_BOUND');state.total++;state.active.calls++;const value=counter.tokenCount(text);if(state.total%32===0)progress();return value;}}));
  const meter=Object.freeze({beginStream(caseID,id){if(state.active||!streamIDs.includes(id)||!id.startsWith(caseID+':'))fail('EXACT69_STREAM_BINDING');state.active={caseID,id,calls:0,windows:0};check();},endStream(windows){if(!state.active)return;if(!Number.isSafeInteger(windows)||windows<0||windows>8192)fail('EXACT69_STREAM_WINDOW_BOUND');state.active.windows=windows;progress();state.active=null;},snapshot(){return immutableCopy({total_calls:state.total,peak_sampled_RSS_bytes:state.peakRSS,elapsed_ms:performance.now()-state.start,active_stream:state.active?.id??null,inference:false});}});meters.set(meter,{counters,bindings:immutableCopy(opened.bindings)});return meter;
}
export function assertOwnedMeter(meter){const value=meters.get(meter);if(!value)fail('EXACT69_OWNED_METER_REQUIRED');return value;}

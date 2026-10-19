// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE ordering/identity controls. No installed model or service is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openGuardedNamedCounters,runSyntheticRuntimeGuardControl,CHUNK_BYTES,COUNTER_POLICY_SHAS} from './runtime-guard.mjs';

const manifest=()=>JSON.parse(readFileSync(new URL('../actual-entry-v1/runtime/named-service-manifest.json',import.meta.url),'utf8'));
const lookupRoot='/tmp/nonverba-unified-source/f7cd9407508443b8a20ad70bc46349ab/code/disputes/prototypes/priors-derivation/study-v0.2/node_modules';
const routes=m=>m.packages.map(p=>({specifier:p.name,importer_ref:p.importer_ref,descriptor_ref:p.descriptor_ref,import_entry_ref:p.import_entry_ref,require_entry_ref:p.require_entry_ref??null,expected_lookup_location:p.name==='@huggingface/transformers'?lookupRoot+'/'+p.name+'/package.json':p.descriptor_ref.path,expected_location:p.descriptor_ref.path,aliases:[]}));
const control=scenario=>runSyntheticRuntimeGuardControl({scenario});
const stage=(r,name)=>r.events.findIndex(e=>e.stage===name);

test('both manifests, all12 artifacts and four locations precede the only simulated constructor',async()=>{
 const r=await control('VALID');assert.equal(r.status,'PASS_SOURCE_FREE_CONTROL_NOT_ACTUAL_OPEN');assert.equal(r.error,null);assert.equal(r.constructor_calls,1);assert.equal(r.fake_counter_calls,1);assert.equal(r.closed_pair_rejects,true);
 const before=stage(r,'BEFORE_FIRST_CONSTRUCTOR'),construct=stage(r,'SIMULATED_CONSTRUCTOR');assert.ok(before>=0&&construct>before);
 for(let i=0;i<2;i++){const manifestAt=r.events.findIndex(e=>e.stage==='SIMULATED_VERIFY'&&e.role==='model-manifest:'+i);assert.ok(manifestAt>=0&&manifestAt<before);for(let f=0;f<6;f++){const at=r.events.findIndex(e=>e.stage==='SIMULATED_VERIFY'&&e.role==='model-artifact:'+i+':'+f);assert.ok(at>=0&&at<before);}}
 assert.equal(r.events.filter(e=>e.stage==='SIMULATED_LOCATION').length,4);assert.ok(stage(r,'BOTH_MANIFESTS_AND_ALL12_VERIFIED')<stage(r,'BEFORE_SERVICE_IMPORT'));
 assert.equal(r.bindings.receipts.filter(e=>e.role.startsWith('named-code:')).length,11);assert.equal(r.bindings.receipts.filter(e=>e.role.startsWith('model-artifact:')).length,12);assert.equal(r.bindings.package_routes.length,4);
 assert.ok(r.bindings.receipts.every(e=>e.stream_chunk_bytes===CHUNK_BYTES&&e.actual_bytes_rehashed===false));
 const expected=routes(manifest());for(let i=0;i<4;i++){const route=r.bindings.package_routes[i];assert.equal(route.actual_lookup_path,expected[i].expected_lookup_location);assert.equal(route.actual_descriptor_path,expected[i].expected_location);assert.equal(route.lookup_path_shape_verified,false);assert.equal(route.location_observed,false);}
 assert.notEqual(r.bindings.package_routes[0].actual_lookup_path,r.bindings.package_routes[0].actual_descriptor_path);assert.deepEqual(r.bindings.package_routes[0].named_lookup_symlink,{path:lookupRoot,canonical_target:'/opt/nonverba-tools/priors-derivation-0.1/node_modules'});assert.ok(r.bindings.package_routes.slice(1).every(route=>route.named_lookup_symlink===null&&route.actual_lookup_path===route.actual_descriptor_path));
});

test('source-free result discloses fake IO, unknown graph and independent supervision limits',async()=>{
 const r=await control('VALID'),b=r.bindings;assert.equal(r.real_package_resolution,false);assert.equal(r.real_package_import,false);assert.equal(r.real_model_artifact_bytes_opened,false);assert.equal(r.real_counter_opened,false);assert.equal(r.actual_tokenizer_calls,0);assert.equal(r.external_supervisor_exercised,false);
 assert.equal(b.actual_file_hash_verification,false);assert.equal(b.actual_counter_pair_opened,false);assert.equal(b.synthetic_counter_pair,true);assert.equal(b.tokenizer_calls_attested,false);assert.equal(b.ROOT_meter_required,true);assert.equal(b.aggregate_RSS_supervision_attested_by_gateway,false);assert.equal(b.process_stop_authority,false);assert.equal(b.full_dynamic_or_native_graph_complete,false);assert.equal(b.native_or_ONNX_code_may_load_on_import,true);assert.equal(b.local_flags_apply_after_package_evaluation,true);assert.equal(b.OS_or_network_sandbox,false);assert.equal(b.inference_requested,false);assert.equal(b.ONNX_session_requested,false);assert.equal(b.pooling_requested,false);
 assert.equal(b.shared_runtime_phase_ceiling_ms,180000);assert.equal(b.new_runtime_phase_origin_created,false);assert.equal(b.shared_global_call_ceiling,60000);assert.equal(b.per_stream_call_ceiling,20000);assert.equal(b.logical_stream_scope,32);assert.equal(b.quality_gate_pass,false);assert.equal(b.authority,'NONE');assert.ok(Object.isFrozen(b.opened_metadata[0].policy));
 assert.deepEqual(b.opened_metadata.map(m=>m.policy_sha256),COUNTER_POLICY_SHAS);
});

test('the last artifact failure prevents import and both counter constructors',async()=>{
 const r=await control('LAST_ARTIFACT_FAIL');assert.equal(r.error,'WINDOW_RUNTIME_SYNTHETIC_ARTIFACT_FAIL');assert.equal(r.constructor_calls,0);assert.equal(r.fake_counter_calls,0);assert.equal(stage(r,'SIMULATED_SERVICE_IMPORT'),-1);assert.equal(r.bindings,null);assert.equal(r.failure_progress.constructor_started,false);assert.equal(r.failure_progress.service_import_started,false);assert.equal(r.failure_progress.verified_receipts.filter(e=>e.role.startsWith('model-artifact:')).length,11);
});

test('missing second manifest does not permit baseline-only construction',async()=>{
 const r=await control('MISSING_SECOND_MANIFEST');assert.equal(r.error,'WINDOW_RUNTIME_SYNTHETIC_MANIFEST_MISSING');assert.equal(r.constructor_calls,0);assert.equal(r.fake_counter_calls,0);assert.equal(stage(r,'SIMULATED_SERVICE_IMPORT'),-1);
});

test('boundary stops and wrong raw, canonical or symlink witnesses prevent import',async()=>{
 const r=await control('BOUNDARY_STOP');assert.equal(r.error,'WINDOW_RUNTIME_SYNTHETIC_BOUNDARY_STOP');assert.equal(r.constructor_calls,0);assert.equal(stage(r,'SIMULATED_SERVICE_IMPORT'),-1);
 const wrong=await control('WRONG_PACKAGE_LOCATION');assert.equal(wrong.error,'WINDOW_RUNTIME_ROUTE_RECEIPT');assert.equal(wrong.constructor_calls,0);assert.equal(wrong.fake_counter_calls,0);
 for(const scenario of['WRONG_LOOKUP_LOCATION','UNEXPECTED_LOOKUP_SYMLINK']){const mismatch=await control(scenario);assert.equal(mismatch.error,'WINDOW_RUNTIME_ROUTE_RECEIPT');assert.equal(mismatch.constructor_calls,0);assert.equal(mismatch.fake_counter_calls,0);assert.equal(stage(mismatch,'SIMULATED_SERVICE_IMPORT'),-1);}
 const reordered=await control('REORDERED_ROUTES');assert.equal(reordered.error,'WINDOW_RUNTIME_FIXED_ROUTES');assert.equal(reordered.constructor_calls,0);assert.equal(reordered.events.length,0);
});

test('both callable identities and complete policies are required before any function escapes',async()=>{
 const missing=await control('MISSING_SECOND_CALLABLE');assert.equal(missing.error,'WINDOW_RUNTIME_BOTH_CALLABLE_COUNTERS');assert.equal(missing.constructor_calls,1);assert.equal(missing.fake_counter_calls,0);assert.equal(missing.bindings,null);
 const wrong=await control('WRONG_RETURNED_POLICY');assert.equal(wrong.error,'RUNTIME_OPENED_COUNTER_IDENTITY');assert.equal(wrong.constructor_calls,1);assert.equal(wrong.fake_counter_calls,0);assert.equal(wrong.bindings,null);
});

test('strict actual export rejects caller-modified manifest or routes before runtime IO',async()=>{
 let calls=0;const boundary=async()=>{calls++;};const m=manifest(),r=routes(m);m.actual_counter_opening_approved=true;
 await assert.rejects(()=>openGuardedNamedCounters({manifest:m,boundary,expectedPackageRoutes:r}),e=>e.code==='WINDOW_RUNTIME_FIXED_MANIFEST');assert.equal(calls,0);
 const original=manifest(),wrong=routes(original);wrong[0].aliases=['SYNTHETIC_ALIAS'];await assert.rejects(()=>openGuardedNamedCounters({manifest:original,boundary,expectedPackageRoutes:wrong}),e=>e.code==='WINDOW_RUNTIME_FIXED_ROUTES');assert.equal(calls,0);
 const rawFallback=routes(original);rawFallback[0].expected_lookup_location=rawFallback[0].expected_location;await assert.rejects(()=>openGuardedNamedCounters({manifest:original,boundary,expectedPackageRoutes:rawFallback}),e=>e.code==='WINDOW_RUNTIME_FIXED_ROUTES');assert.equal(calls,0);
 await assert.rejects(()=>openGuardedNamedCounters({manifest:original,expectedPackageRoutes:routes(original)}),e=>e.code==='WINDOW_RUNTIME_OWNED_BOUNDARY_REQUIRED');assert.equal(calls,0);
});

test('no getter, arbitrary synthetic scenario or injected backend can enter the strict route',async()=>{
 let getterCalls=0;const m=manifest();Object.defineProperty(m,'source_payload',{enumerable:true,get(){getterCalls++;return 'SYNTHETIC_GETTER';}});
 await assert.rejects(()=>openGuardedNamedCounters({manifest:m,boundary:async()=>{},expectedPackageRoutes:[]}),e=>e.code==='WINDOW_RUNTIME_PLAIN_DATA');assert.equal(getterCalls,0);
 await assert.rejects(()=>runSyntheticRuntimeGuardControl({scenario:'ARBITRARY_REAL_IMPORT'}),e=>e.code==='WINDOW_RUNTIME_SYNTHETIC_SCENARIO');
 const unknown=await runSyntheticRuntimeGuardControl({scenario:'VALID',backend:{importService(){throw Error('INJECTED_BACKEND');}}});assert.equal(unknown.status,'PASS_SOURCE_FREE_CONTROL_NOT_ACTUAL_OPEN');assert.equal(unknown.real_package_import,false);
});

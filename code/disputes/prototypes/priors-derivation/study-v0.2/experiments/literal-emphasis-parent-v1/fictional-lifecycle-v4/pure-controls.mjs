// SPDX-License-Identifier: AGPL-3.0-only
// Pure source-extracted lifecycle/IPC controls: no filesystem/proc/child/data IO.
import vm from 'node:vm';
import assert from 'node:assert/strict';
export async function runPureLifecycleControls({bootstrapSource,runnerSources}){
 const reports=[],check=async(name,fn)=>{await fn();reports.push({name,status:'PASS'});};
 const dispatch=bootstrapSource.slice(bootstrapSource.indexOf('if(process.argv[1]&&path.resolve(process.argv[1])===SELF){'));
 assert.ok(dispatch.includes('else setImmediate(async()=>{try{await fixtureCLI('));
 const proofHelper=bootstrapSource.match(/export function assertOwnedBootstrapProof[^\n]+/)?.[0],clockHelper=bootstrapSource.match(/export function monotonicActiveMs[^\n]+/)?.[0];
 assert.ok(proofHelper&&clockHelper);
 async function lifecycle({wrongArgs=false,reject=false}={}){
  const queue=[],events=[],stderr=[],process={argv:wrongArgs?['node','/SYNTHETIC/bootstrap.mjs']:['node','/SYNTHETIC/bootstrap.mjs','--fictional-config','/SYNTHETIC/configuration.json','SYNTHETIC_SHA','1'],exitCode:0,stderr:{write:s=>stderr.push(s)}};
  const context=vm.createContext({process,path:{resolve:v=>v},SELF:'/SYNTHETIC/bootstrap.mjs',fs:{writeSync:(fd,s)=>stderr.push(s)},setImmediate:fn=>queue.push(fn),performance:{now:()=>1},events,reject});
  let boot,guardian,dynamicStatus=null;
  const body="const proofs=new WeakMap(),fail=code=>{throw Object.assign(Error(code),{code});};\n"+proofHelper+"\n"+clockHelper+"\nasync function fixtureCLI(ref){events.push('fixture-start');const proof=Object.freeze({});proofs.set(proof,{scope:'SYNTHETIC_PRIVATE_PROOF'});const g=await import('./guardian.mjs');if(reject)throw Object.assign(Error('SYNTHETIC_REJECTION'),{code:'SYNTHETIC_REJECTION'});const result=g.supervise(proof);if(result.scope!=='SYNTHETIC_PRIVATE_PROOF')throw Error('proof registry mismatch');events.push('guardian-complete');}\n"+dispatch;
  boot=new vm.SourceTextModule(body,{context,identifier:'file:///SYNTHETIC/bootstrap.mjs',importModuleDynamically:async specifier=>{assert.equal(specifier,'./guardian.mjs');dynamicStatus=boot.status;assert.equal(dynamicStatus,'evaluated');guardian=new vm.SourceTextModule("import {assertOwnedBootstrapProof,monotonicActiveMs} from './bootstrap.mjs';export function supervise(proof){return assertOwnedBootstrapProof(proof);}",{context,identifier:'file:///SYNTHETIC/guardian.mjs'});await guardian.link(async spec=>{assert.equal(spec,'./bootstrap.mjs');return boot;});await guardian.evaluate({timeout:100});return guardian;}});
  await boot.link(async()=>{throw Error('unexpected static bootstrap import');});await boot.evaluate({timeout:100});
  assert.equal(boot.status,'evaluated');assert.deepEqual(events,[]);
  for(const fn of queue)await fn();
  return{queue,events,stderr,process,dynamicStatus};
 }
 await check('deferred CLI imports guardian only after bootstrap evaluated; private proof backedge resolves',async()=>{const r=await lifecycle();assert.equal(r.dynamicStatus,'evaluated');assert.deepEqual(r.events,['fixture-start','guardian-complete']);assert.equal(r.process.exitCode,0);assert.equal(r.stderr.length,0);});
 await check('deferred CLI catches async rejection and preserves explicit failure exit',async()=>{const r=await lifecycle({reject:true});assert.equal(r.process.exitCode,2);assert.deepEqual(r.stderr,['SYNTHETIC_REJECTION\n']);});
 await check('default/wrong CLI remains CLOSED before scheduling fixture work',async()=>{const r=await lifecycle({wrongArgs:true});assert.equal(r.queue.length,0);assert.deepEqual(r.events,[]);assert.equal(r.process.exitCode,2);assert.deepEqual(r.stderr,['ACTUAL_ENTRY_CLOSED\n']);});
 for(const name of ['controller.mjs','invoke.mjs','launch.mjs']){
  await check(name+' terminal own IPC disconnect is guarded, once-only, and follows metadata/join path',async()=>{
   const source=runnerSources[name],helper=source.match(/function releaseParentIPC\(\)\{[^\n]+\}/)?.[0];assert.ok(helper);
   const events=[],p={connected:true,disconnect(){events.push('disconnect');this.connected=false;}},context=vm.createContext({process:p});vm.runInContext(helper,context);vm.runInContext('releaseParentIPC();releaseParentIPC();',context);
   assert.deepEqual(events,['disconnect']);assert.equal(p.connected,false);
   const call=source.lastIndexOf('releaseParentIPC();');assert.ok(call>source.lastIndexOf(name==='controller.mjs'?"S.write(out+'/completion.json'":"finishRef=put(out+'/finish.json'"));
   if(name!=='controller.mjs'){const terminal=source.slice(source.lastIndexOf('finally{'));assert.ok(terminal.includes('clearTimeout(deadlineTimer);clearInterval(sampleTimer);releaseParentIPC();'));}
  });
 }
 await check('IPC disconnect error is propagated rather than represented as successful close',async()=>{const helper=runnerSources['invoke.mjs'].match(/function releaseParentIPC\(\)\{[^\n]+\}/)[0],context=vm.createContext({process:{connected:true,disconnect(){throw Object.assign(Error('SYNTHETIC_IPC_ERROR'),{code:'SYNTHETIC_IPC_ERROR'});}}});vm.runInContext(helper,context);assert.throws(()=>vm.runInContext('releaseParentIPC()',context),/SYNTHETIC_IPC_ERROR/);});
 return{schema:'FICTIONAL_LIFECYCLE_V4_PURE_CONTROLS_V1',passed:reports.length,failed:0,skipped:0,reports,scope:{actual_bootstrap_or_guardian_or_runner_imported:false,full_fictional_suite:false,real_process_or_IPC_or_child_or_proc_or_resource_action:false,filesystem_data_model_or_counter_action:false},authority:'NONE'};
}


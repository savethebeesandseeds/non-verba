// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LOCATION_VERIFIER_FIELDS,retainLocationVerificationInputs,createLocationContextImporter} from '../../web/src/location-verification-inputs.js';
function setup(){const fields=new Map(LOCATION_VERIFIER_FIELDS.map(id=>[id,{value:id+' retained'}]));fields.set('live-proof-file',{files:[{name:'original.cose'}]});return {fields,root:{getElementById:id=>fields.get(id)}};}
for(const phase of ['file read','WASM verification']){
  test('changed verifier inputs while '+phase+' awaits cannot publish earlier verdict',async()=>{
    for(const id of [...LOCATION_VERIFIER_FIELDS,'live-proof-file']){
      const {fields,root}=setup(),held=retainLocationVerificationInputs(root);let release;
      const gate=new Promise(resolve=>release=resolve);
      const pending=(async()=>{await gate;if(!held.current())throw new Error('Inputs changed');return {verified:true};})();
      if(id==='live-proof-file')fields.get(id).files=[{name:'replacement.cose'}];else fields.get(id).value+=' changed';
      release();await assert.rejects(pending,/Inputs changed/);
    }
  });
}
test('unchanged exact inputs permit result; snapshots cannot be changed and equal filename is not equal File',()=>{
  const {fields,root}=setup(),held=retainLocationVerificationInputs(root);assert.equal(held.current(),true);
  assert.throws(()=>{held.values['live-original-input']='forged';},TypeError);
  fields.get('live-proof-file').files=[{name:'original.cose'}];assert.equal(held.current(),false);
});

test('latest context selection wins while an older file read is delayed',async()=>{
  const importer=createLocationContextImporter();let release;
  const old=importer.start({size:13,arrayBuffer:()=>new Promise(r=>release=r)},()=>true);
  const latest=importer.start({size:15,arrayBuffer:async()=>new TextEncoder().encode('{ "version":1 }').buffer},()=>true);
  assert.equal(await latest.result,'{ "version":1 }');release(new TextEncoder().encode('{"version":1}').buffer);
  await assert.rejects(old.result,/cancelled/);assert.equal(old.isLatest(),false);assert.equal(latest.isLatest(),true);
});
test('context file completion cannot overwrite manual edit, suspended page or newly started verification',async()=>{
  for(const reason of ['edit','suspend','new verification']){
    let release,current=true;const importer=createLocationContextImporter();
    const job=importer.start({size:13,arrayBuffer:()=>new Promise(r=>release=r)},()=>current);
    current=false;release(new TextEncoder().encode('{"version":1}').buffer);await assert.rejects(job.result,/cancelled/,reason);
  }
});
test('empty, oversized or malformed UTF-8 context files fail before publishing',async()=>{
  const importer=createLocationContextImporter();
  await assert.rejects(importer.start({size:4*1024*1024+1,arrayBuffer:()=>{throw new Error('Must not read');}},()=>true).result,/4 MiB/);
  await assert.rejects(importer.start({size:1,arrayBuffer:async()=>new Uint8Array([255]).buffer},()=>true).result,/encoded data/);
});

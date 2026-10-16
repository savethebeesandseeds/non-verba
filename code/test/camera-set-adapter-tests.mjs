// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import {cameraSetPlatform,collectCameraSet} from '../../web/src/camera-set-platform.js';
const pin='a'.repeat(64),id='12345678-1234-1234-1234-123456789abc';
const caps={available:true,version:1,key_fingerprint:pin};
test('camera-set transport: complete set, refusal, cancellation and bounded deadline', async () => {
function fake(statuses) {
  let cancelled=0,captures=0;
  const bridge={capabilities:()=>JSON.stringify(caps),begin:()=>JSON.stringify({session_id:id}),
    status:()=>JSON.stringify({ok:true,session_id:id,key_fingerprint:pin,...statuses.shift()}),
    capture:()=>{captures++;return JSON.stringify({ok:true,session_id:id});},
    cancel:()=>{cancelled++;return JSON.stringify({session_id:id,state:'cancelled',cleanup:'unknown'});}};
  return {platform:cameraSetPlatform(bridge),counts:()=>({cancelled,captures})};
}
const request={version:1};
const complete={state:'complete',result:{type:'nonverba-camera-set-bundle',attempt_id:id}};
{
  const f=fake([{state:'awaiting-location'},complete]);
  const result=await collectCameraSet({platform:f.platform,request,acquireLocation:async()=>({})});
  assert.equal(result.attempt_id,id);assert.deepEqual(f.counts(),{cancelled:0,captures:1});
}
for(const status of [complete,{state:'error',ok:false,error:'one camera failed'},{state:'capturing',key_fingerprint:'b'.repeat(64)},{state:'unrecognised'}]) {
  const f=fake([status]);await assert.rejects(collectCameraSet({platform:f.platform,request,acquireLocation:async()=>({})}));assert.equal(f.counts().cancelled,1);
}
{
  const f=fake([{state:'awaiting-location'}]),controller=new AbortController();
  await assert.rejects(collectCameraSet({platform:f.platform,request,signal:controller.signal,acquireLocation:async()=>{controller.abort();return {};}}));
  assert.equal(f.counts().captures,0);assert.ok(f.counts().cancelled>=1);
}
{
  const f=fake([{state:'preview'}]);let tick=0;
  await assert.rejects(collectCameraSet({platform:f.platform,request,acquireLocation:async()=>({}),now:()=>tick++*66000}),/deadline/);
  assert.equal(f.counts().cancelled,1);
}
assert.throws(()=>cameraSetPlatform({capabilities:()=>'{'}),/incomplete/i);
console.log('8 camera-set adapter cases passed (synthetic bridge; no physical camera).');
});

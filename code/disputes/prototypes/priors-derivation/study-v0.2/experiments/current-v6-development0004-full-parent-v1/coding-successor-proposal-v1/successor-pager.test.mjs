// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC: imports stay inactive; no file, corpus or coding access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOT_ACTIVATED,ownedWritePath,validateRequestInterval,joinedPageState,validateObservedPage} from './successor-pager.mjs';

test('inactive import and all write paths preserve predecessor namespaces',()=>{
  assert.equal(ROOT_ACTIVATED,false);
  const root='/SYNTHETIC/coding/open-coding-b/current-v6/successor-v1';
  assert.equal(ownedWritePath(root,root+'/retained-transitions/r000001/ack-00030.json'),root+'/retained-transitions/r000001/ack-00030.json');
  for(const p of ['/SYNTHETIC/coding/open-coding-b/current-v6/run-v1/operation-lock','/SYNTHETIC/coding/open-coding-b/current-v6/run-v2/phase-admission.json',root,root+'/../run-v2/operation-lock',root+'-other/ack.json'])assert.throws(()=>ownedWritePath(root,p));
});
test('B retained 29 of 77 resumes exactly page30 without repeating old transitions',()=>{
  const oldEmitted=Array.from({length:77},(_,i)=>i<29),oldAcknowledged=[...oldEmitted],newEmitted=Array(77).fill(false),newAcknowledged=[...newEmitted];
  const state=()=>joinedPageState({oldEmitted,oldAcknowledged,newEmitted,newAcknowledged});
  assert.equal(state().acknowledged.filter(Boolean).length,29);
  newEmitted[29]=true;assert.equal(state().emitted[29],true);newAcknowledged[29]=true;
  assert.equal(state().acknowledged.filter(Boolean).length,30);assert.equal(oldAcknowledged.filter(Boolean).length,29);
  newEmitted[28]=true;assert.throws(state);newEmitted[28]=false;
  newAcknowledged[30]=true;assert.throws(state);newAcknowledged[30]=false;
  newEmitted[31]=true;assert.throws(state);newEmitted[31]=false;
  oldAcknowledged[50]=true;assert.throws(state);
});
test('both inherited and new manifests bind the original request offset and limit',()=>{
  const m={offset:20000,limit:20000,range:{offset:20000,end:35000,total_characters:35000}};
  assert.equal(validateRequestInterval(m),true);
  for(const change of [x=>delete x.offset,x=>delete x.limit,x=>x.offset=0,x=>x.range.end=34999,x=>x.limit=20001,x=>x.range.offset=19999]){
    const x=structuredClone(m);change(x);assert.throws(()=>validateRequestInterval(x));
  }
});
test('whole output plus wrapper must fit9000 and every exact page observation is explicit',()=>{
  const p={sha256:'a'.repeat(64),bytes:8506},a={outputSHA:p.sha256,outputBytes:8506,outputUTF16:8500,wholeToolOutputUTF16:9000,outerToolResponseObservedComplete:true,outerTruncationMarkerObserved:false,forwardedStdoutExactPrepared:true};
  assert.equal(validateObservedPage(a,p,8500),true);
  for(const change of [x=>x.wholeToolOutputUTF16=9001,x=>x.wholeToolOutputUTF16=8499,x=>delete x.wholeToolOutputUTF16,x=>x.outputSHA='b'.repeat(64),x=>x.outputBytes=8500,x=>x.outputUTF16=8499,x=>x.outerToolResponseObservedComplete=false,x=>x.outerTruncationMarkerObserved=true,x=>x.forwardedStdoutExactPrepared=false]){
    const x=structuredClone(a);change(x);assert.throws(()=>validateObservedPage(x,p,8500));
  }
});

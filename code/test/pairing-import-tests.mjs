// SPDX-License-Identifier: AGPL-3.0-only
// Shared camera/audio pre-challenge file-picker gate, no sensors or native UI.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PairingFileImport} from '../../web/src/pairing-import.js';
function fixture(){let preparations=0,cancelled=0,hidden=false,native=true;const owner={role:'requester',phase:'pairing',connected:false,prepareAnswerImport(){preparations++;}};
  let current=owner;const gate=new PairingFileImport({current:()=>current,cancel:()=>cancelled++,native:()=>native,hidden:()=>hidden});
  return {owner,gate,get preparations(){return preparations;},get cancelled(){return cancelled;},set hidden(v){hidden=v;},set native(v){native=v;},replace(){current={...owner};}};
}
test('native pause needs both explicit answer-import intent and own-picker signal',()=>{
  const f=fixture();try{f.gate.nativeEvent(true);assert.equal(f.gate.permitsPause(),false);f.gate.begin();assert.equal(f.preparations,1);assert.equal(f.gate.permitsPause(),false);f.gate.nativeEvent(true);assert.equal(f.gate.permitsPause(),true);}finally{f.gate.clear();}
});
test('ordinary browser picker has only a bounded pre-challenge allowance',()=>{
  const f=fixture();try{f.native=false;f.gate.begin();assert.equal(f.gate.permitsPause(),true);f.owner.phase='authenticating';assert.equal(f.gate.permitsPause(),false);}finally{f.gate.clear();}
});
test('operator, connected peer and every active acquisition phase get no allowance',()=>{
  for(const change of [{role:'operator'},{connected:true},{phase:'authenticating'},{phase:'connected'},{phase:'testing'},{phase:'recording'},{phase:'awaiting-wav'},{phase:'complete'}]){
    const f=fixture();Object.assign(f.owner,change);try{f.gate.begin();f.gate.nativeEvent(true);assert.equal(f.gate.permitsPause(),false);assert.equal(f.preparations,0);}finally{f.gate.clear();}
  }
});
test('replacement or pagehide cleanup makes a late file result inapplicable',async()=>{
  for(const change of ['replacement','pagehide']){const f=fixture();try{f.gate.begin();f.gate.nativeEvent(true);if(change==='replacement')f.replace();else f.gate.clear();await assert.rejects(f.gate.foreground(),/cancelled/);assert.equal(f.gate.permitsPause(),false);}finally{f.gate.clear();}}
});
test('picker result waits for foreground without starting or resuming a challenge',async()=>{
  const f=fixture();try{f.gate.begin();f.gate.nativeEvent(true);f.hidden=true;const pending=f.gate.foreground();f.gate.nativeEvent(false);f.hidden=false;await pending;assert.equal(f.preparations,1);assert.equal(f.owner.phase,'pairing');}finally{f.gate.clear();}
});
test('one-minute expiration cancels and clears the exception',()=>{
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;let callback,delay;
  globalThis.setTimeout=(fn,ms)=>{callback=fn;delay=ms;return 123;};globalThis.clearTimeout=()=>{};
  const f=fixture();try{f.gate.begin();f.gate.nativeEvent(true);assert.equal(delay,60000);callback();assert.equal(f.cancelled,1);assert.equal(f.gate.permitsPause(),false);}finally{f.gate.clear();globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
test('cleared or cancelled picker cannot confer an allowance on a subsequent session',()=>{
  const f=fixture();try{f.gate.begin();f.gate.nativeEvent(true);f.gate.clear();f.gate.begin();assert.equal(f.gate.permitsPause(),false);assert.equal(f.preparations,2);}finally{f.gate.clear();}
});

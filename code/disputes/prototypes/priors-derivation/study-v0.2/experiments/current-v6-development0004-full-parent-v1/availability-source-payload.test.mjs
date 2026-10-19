// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodedSourceLiteralOccurrence as find} from './availability-run.mjs';
const word='synthetic qualifier';
test('native annotation metadata alone cannot establish payload availability',()=>{
  const encoded='\n[NATIVE_SOURCE_MARKS_UNVERIFIED '+JSON.stringify([{value:word}])+']\nother words\n[/NATIVE_SOURCE_MARKS_UNVERIFIED]\n';
  assert.equal(find(encoded,word,word),-1);
});
test('joint annotation metadata alone cannot establish payload availability',()=>{
  const encoded='\n[JOINT_NORMALIZATION_UNVERIFIED '+JSON.stringify({value:word})+']\n[/JOINT_NORMALIZATION_UNVERIFIED]\n ';
  assert.equal(find(encoded,word,word),-1);
});
test('source occurrence after metadata is located outside its JSON',()=>{
  const header='\n[NATIVE_SOURCE_MARKS_UNVERIFIED '+JSON.stringify([{value:word}])+']\n';
  assert.equal(find(header+word+'\n[/NATIVE_SOURCE_MARKS_UNVERIFIED]\n',word,word),header.length);
});
test('plain source payload and reserved-marker ambiguity remain explicit',()=>{
  assert.equal(find('prefix '+word,'prefix '+word,word),7);
  assert.equal(find(word,'different source',word),-1);
  assert.equal(find(word,'\n[NATIVE_SOURCE_MARKS_UNVERIFIED fake]\n'+word,word),-1);
});

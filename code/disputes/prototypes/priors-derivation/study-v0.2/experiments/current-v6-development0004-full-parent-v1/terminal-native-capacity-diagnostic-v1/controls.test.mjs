// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixedTerminalRanges,diagnoseTerminal} from './diagnostic.mjs';
const H=s=>createHash('sha256').update(s).digest('hex');
const encoder=text=>r=>({text:JSON.stringify([text.slice(r.start,r.end),r.includeEndZeroWidth]),source:text.slice(r.start,r.end),original_native_sha256:H('fictional-native')});
test('terminal surrogate pair remains one complete codepoint in both contrasts',()=>{const r=fixedTerminalRanges('x😀');assert.deepEqual(r.slice(1,3).map(x=>[x.start,x.end]),[[1,3],[1,3]]);assert.equal(r[1].includeEndZeroWidth,true);assert.equal(r[2].includeEndZeroWidth,false);});
test('zero-output terminal is retained separately without adopting an omission',()=>{const out=diagnoseTerminal({text:'ab',encode:encoder('ab'),countTokens:s=>s.length});assert.equal(out.rows[3].source_UTF16,0);assert.equal(out.rows[3].includeEndZeroWidth,true);assert.equal(out.counter_calls,8);assert.equal(out.quality_gate_pass,false);assert.equal(out.whole_partition_feasibility_proved,false);});
test('an encoder cannot substitute source while preserving a valid-looking hash',()=>{assert.throws(()=>diagnoseTerminal({text:'ab',encode:r=>({...encoder('ab')(r),source:'wrong'}),countTokens:()=>1}),/TERMINAL_SOURCE_INVERSE/);});
test('changed independent counts stop the diagnostic',()=>{let n=0;assert.throws(()=>diagnoseTerminal({text:'ab',encode:encoder('ab'),countTokens:()=>++n}),/TERMINAL_RECOUNT_CHANGED/);});
test('invalid native binding stops before any counter call',()=>{let calls=0;assert.throws(()=>diagnoseTerminal({text:'ab',encode:r=>({...encoder('ab')(r),original_native_sha256:'x'}),countTokens:()=>++calls}),/TERMINAL_NATIVE_BINDING/);assert.equal(calls,0);});
test('empty, malformed or overlong source cannot silently select another geometry',()=>{for(const s of ['', '\uD800','\uDC00','x'.repeat(1001)])assert.throws(()=>fixedTerminalRanges(s),/TERMINAL_SOURCE_BOUND/);});

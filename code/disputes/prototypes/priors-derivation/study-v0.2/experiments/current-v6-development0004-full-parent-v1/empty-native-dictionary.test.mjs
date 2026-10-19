// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeEmptyNativeCluster as encode,decodeEmptyNativeCluster as decode,EMPTY_NATIVE_DICTIONARY_POLICY as policy} from './empty-native-dictionary.mjs';
const wrap=x=>'\n[NATIVE_SOURCE_MARKS_UNVERIFIED '+JSON.stringify(x)+']\n\n[/NATIVE_SOURCE_MARKS_UNVERIFIED]\n';
const a=[{tag:'b',style_literal:'color:red;color:blue',declarations:[{property:'color',value:'red'},{property:'color',value:'blue'}],events:['first','second','first'],css_interpretation:'UNRESOLVED'}],b=[{tag:'u',unknown_style:{order:['x','x','y']}}];
const hash=x=>createHash('sha256').update(x).digest('hex');
test('dictionary round-trip retains exact UTF8 bytes, ordered duplicates and sequence',()=>{
 const original=wrap(a)+wrap(b)+wrap(a),encoded=encode(original);
 assert.equal(decode(encoded),original);assert.equal(hash(decode(encoded)),hash(original));
 assert.deepEqual(JSON.parse(encoded),[policy,[a,b],[0,1,0]]);
 assert.ok(encoded.length<original.length);
});
test('all metadata survives Unicode, escapes, reserved-looking strings and unknown fields',()=>{
 const m=[{style_literal:'𝒳é\n[NATIVE_SOURCE_MARKS_UNVERIFIED ]',declarations:[{property:'x',value:'"\\'}],empty:[],future:{events:[null,true,3]}}];
 const source=wrap(m)+wrap([]);assert.equal(decode(encode(source)),source);
});
test('reject nonempty payload, free text, joint wrappers and wrapper ambiguity',()=>{
 for(const s of [wrap(a).replace('\n\n[/','\nX\n[/'), ' '+wrap(a),wrap(a)+'tail',wrap(a).replace('NATIVE_SOURCE','JOINT_NORMALIZATION'),wrap(a).replace('\n\n[/','\n\n\n[/')])assert.throws(()=>encode(s));
});
test('reject malformed/noncanonical JSON and invalid metadata without normalization',()=>{
 for(const s of [wrap(a).replace('[{','[ {'),wrap(a).replace('"b"','"\\u0062"'),wrap(a).replace('[{','[{oops'),wrap(a).replace(JSON.stringify(a),'[null]')])assert.throws(()=>encode(s));
 assert.throws(()=>decode(' '+encode(wrap(a))));
 assert.throws(()=>decode(JSON.stringify(['OTHER',[a],[0]])));
});
test('decoder rejects duplicate/unused dictionaries, wrong order and invalid indices',()=>{
 for(const v of [[policy,[a,a],[0,1]],[policy,[a,b],[0]],[policy,[a,b],[1,0]],[policy,[a],[1]],[policy,[a],[-1]],[policy,[a],[0.5]],[policy,[a],[]]])assert.throws(()=>decode(JSON.stringify(v)));
});
test('both directions enforce 4096 UTF16 and64groups bounds',()=>{
 assert.throws(()=>encode(wrap([{style_literal:'x'.repeat(4096)}])));
 assert.throws(()=>encode(wrap([]).repeat(65)));
 assert.throws(()=>decode(JSON.stringify([policy,[[]],Array(65).fill(0)])));
 assert.throws(()=>decode('x'.repeat(4097)));
 const source=wrap([]).repeat(50);assert.ok(source.length<=4096);assert.equal(decode(encode(source)),source);
});


// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE in-memory controls: no source input, actor, filesystem or CLI call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selectPage,visibleCharge,assertSessionOpen,PAGE_LIMITS} from './page-reader.mjs';
const H=s=>createHash('sha256').update(s).digest('hex');

test('escaping and astral Unicode roundtrip over bounded forward pages',()=>{
 const text=('SYNTHETIC "\\\n\u0000 <tag>&\u2028😀𝄞 ').repeat(1100);let cursor=0,index=0,recovered='';
 do{const p=selectPage(text,cursor,{audit_id:'development-0055',document:'parent_text',page_index:++index}),b=JSON.parse(p.serialized);assert.ok(p.serialized.length<=PAGE_LIMITS.utf16);assert.ok(Buffer.byteLength(p.serialized)<=PAGE_LIMITS.utf8);assert.equal(b.range.start_utf16,cursor);assert.equal(b.text,text.slice(cursor,b.range.end_utf16));assert.equal(b.page_body_sha256,H(b.text));assert.equal(b.full_document_sha256,H(text));assert.equal(b.page_count,null);assert.equal(b.has_more,b.range.end_utf16<text.length);assert.equal(b.actual_source_exposed_to_model,true);assert.equal(b.quality_gate_pass,false);assert.ok(!p.serialized.includes('<tag>'));assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.body)&&Object.isFrozen(p.body.range));recovered+=b.text;cursor=b.range.end_utf16;assert.ok(index<100);}while(cursor<text.length);assert.equal(recovered,text);
});
test('6000-unit candidate never cuts an astral pair and a caller cannot start inside it',()=>{
 const text='x'.repeat(5999)+'😀z',first=selectPage(text),end=first.body.range.end_utf16;assert.equal(end,5999);const last=selectPage(text,end,{audit_id:'development-0047',page_index:2});assert.equal(last.body.text,'😀z');assert.equal(last.body.has_more,false);assert.throws(()=>selectPage(text,6000));assert.throws(()=>selectPage('\ud800'));assert.throws(()=>selectPage('SYNTHETIC',0,{audit_id:'development-0048'}));
});
test('closed or ambiguous session marker denies before any coercion',()=>{
 assertSessionOpen(false);let reads=0;const poison={get valueOf(){reads++;throw Error('COERCE');},get toString(){reads++;throw Error('READ');}};for(const value of[true,null,undefined,0,poison])assert.throws(()=>assertSessionOpen(value),e=>e.code==='PAGE_SESSION_CLOSED');assert.equal(reads,0);
});
test('visible charge is one shared cumulative allowance across both cases',()=>{
 const first=selectPage('SYNTHETIC0055😀',0,{audit_id:'development-0055',document:'focal_text'}),second=selectPage('SYNTHETIC0047"',0,{audit_id:'development-0047',document:'finite9_focal'}),a=visibleCharge(0,first.serialized,{physical_bytes:10000,private_capture_bytes:172}),b=visibleCharge(a.after,second.serialized,{physical_bytes:11000,private_capture_bytes:172});assert.equal(a.bytes,Buffer.byteLength(first.serialized));assert.equal(b.before,a.after);assert.equal(b.after,Buffer.byteLength(first.serialized)+Buffer.byteLength(second.serialized));assert.ok(b.after>second.serialized.length);assert.ok(Object.isFrozen(b));
});
test('last byte fits exactly; next serialized byte is denied without refunds',()=>{
 const serialized='{}',private_capture_bytes=172,remaining=262144-15794-private_capture_bytes,at=visibleCharge(remaining-2,serialized,{physical_bytes:4194304,private_capture_bytes});assert.equal(at.after,remaining);assert.throws(()=>visibleCharge(at.after,'0',{physical_bytes:4194304,private_capture_bytes}),e=>e.code==='PAGE_VISIBLE_CUMULATIVE_BOUND');assert.throws(()=>visibleCharge(at.after,serialized,{physical_bytes:4194304,private_capture_bytes}));
});
test('physical, serialized and numeric budget guards remain independent of case choice',()=>{
 for(const [previous,serialized,options]of[[0,'{}',{physical_bytes:4194305,private_capture_bytes:0}],[NaN,'{}',{physical_bytes:0,private_capture_bytes:0}],[0,'x'.repeat(7501),{physical_bytes:0,private_capture_bytes:0}],[0,'{}',{physical_bytes:0,private_capture_bytes:-1}],[0,'',{physical_bytes:0,private_capture_bytes:0}]])assert.throws(()=>visibleCharge(previous,serialized,options));
});

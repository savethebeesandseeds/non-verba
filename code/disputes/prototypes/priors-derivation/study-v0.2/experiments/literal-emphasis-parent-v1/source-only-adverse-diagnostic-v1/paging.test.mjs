// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE: pure bounded transport controls; no files or actual contract text.
import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPage} from './page-reader.mjs';
test('escaped pages preserve every codepoint and stay within the complete reply budget',()=>{
  const text=('😀\\\"\n\t<&>\u2028\u2029X').repeat(2500);let at=0,index=1,reconstructed='';
  while(at<text.length){const {body,serialized}=selectPage(text,at,{document:'raw_full',page_index:index++});assert.ok(serialized.length<=7500);assert.ok(Buffer.byteLength(serialized)<=65536);assert.deepEqual(JSON.parse(serialized),body);assert.equal(body.range.start_utf16,at);assert.ok(body.range.end_utf16>at);assert.equal(body.page_count,null);assert.equal(body.text,text.slice(at,body.range.end_utf16));assert.ok(!/[\uD800-\uDBFF]$/u.test(body.text));reconstructed+=body.text;at=body.range.end_utf16;}
  assert.equal(reconstructed,text);
});
test('plain parent fits one page; arbitrary offsets cannot split surrogate pairs',()=>{
  const result=selectPage('SOURCE_FREE parent 😀',0,{document:'parent_text'});assert.equal(result.body.has_more,false);assert.equal(result.body.text,'SOURCE_FREE parent 😀');assert.throws(()=>selectPage('A😀B',2));assert.throws(()=>selectPage('SOURCE_FREE',-1));
});

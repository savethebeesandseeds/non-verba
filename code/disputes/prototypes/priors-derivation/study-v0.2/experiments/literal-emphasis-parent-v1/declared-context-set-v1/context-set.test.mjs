// SPDX-License-Identifier: AGPL-3.0-only
// Internally authored SOURCE_FREE declarations; no counters, models or corpus.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDeclaredContextSet as create,verifyDeclaredContextSet as verify,declaredContextSourceIdentity,LIMITS} from './context-set.mjs';
const H=s=>createHash('sha256').update(s).digest('hex'),clone=v=>JSON.parse(JSON.stringify(v)),J=v=>JSON.stringify(v,null,2)+'\n';
function fixture(){
  const intro='Synthetic activities require written permission during the term, directly or indirectly.';
  const consent='Synthetic item consent requires both the organization and its adviser.';
  const list=Array.from({length:24},(_,i)=>`Item ${i} ${'retains literal source conditions '.repeat(24)}only.`).join('\n\n');
  const text=intro+'\n\n'+list+'\n\n'+consent+'\n\nSynthetic ending 😀.';
  const source={contract_id:'SYNTHETIC_DOCUMENT',source_sha256:H('SYNTHETIC_SOURCE_METHOD'),normalized_sha256:H(text),normalized_utf16_length:text.length};
  const node=(id,literal,declared_role)=>{const start=text.indexOf(literal);return {id,source_identity_sha256:declaredContextSourceIdentity(source),range:{start,end:start+literal.length,sha256:H(literal)},declared_role,annotation_ref:{path:'SYNTHETIC/annotations.json',sha256:H('SYNTHETIC_ANNOTATION'),bytes:20}};};
  return {source,normalized_text:text,focal:node('focal','Item 12 '+ 'retains literal source conditions '.repeat(24)+'only.','FOCAL'),attachments:[node('consent',consent,'ITEM_CONSENT'),node('intro',intro,'CONDITIONAL_INTRODUCTION')]};
}
const deny=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('SOURCE_FREE long-list focal retains separate declared intro and consent in supplied order',()=>{
  const f=fixture(),before=JSON.stringify(f),out=create(f),a=out.artifact;
  assert.equal(verify({...f,artifact:a}),true);assert.deepEqual(a.nodes.map(n=>n.id),['focal','consent','intro']);
  assert.ok(!a.nodes[0].text.includes('written permission'));assert.ok(!a.nodes[0].text.includes('both the organization'));
  for(const n of a.nodes){assert.equal(n.text,f.normalized_text.slice(n.range.start,n.range.end));assert.equal(H(n.text),n.range.sha256);}
  assert.ok(a.nodes[2].range.end<a.nodes[0].range.start);assert.ok(a.nodes[0].range.end<a.nodes[1].range.start);
  assert.equal(Object.hasOwn(a,'text'),false);assert.equal(a.source_text_concatenated,false);assert.equal(a.context_adequate,null);assert.equal(a.authority,'NONE');assert.equal(a.annotation_refs_authenticated,false);
  assert.equal(JSON.stringify(f),before);assert.equal(Object.isFrozen(f.source),false);assert.ok(Object.isFrozen(a.nodes[1].annotation_ref));assert.equal(out.metadata.artifact_sha256,H(J(a)));
});
test('SOURCE_FREE wrong whole-source identity and wrong node source are rejected',()=>{
  for(const mutate of[f=>f.normalized_text+='x',f=>f.source.normalized_sha256='0'.repeat(64),f=>f.source.contract_id='OTHER',f=>f.source.source_sha256='0'.repeat(64),f=>f.attachments[0].source_identity_sha256='0'.repeat(64)]){const f=fixture();mutate(f);deny(()=>create(f),'DECLARED_CONTEXT_SOURCE');}
});
test('SOURCE_FREE duplicate identities, nonpositive ranges and corrupt span hashes reject',()=>{
  for(const mutate of[f=>f.attachments[0].id=f.focal.id,f=>f.attachments[0].range.start=-1,f=>f.attachments[0].range.end=f.attachments[0].range.start,f=>f.attachments[0].range.end=f.normalized_text.length+1,f=>f.attachments[0].range.sha256='0'.repeat(64),f=>f.attachments[0].declared_role='FOCAL']){const f=fixture();mutate(f);deny(()=>create(f),'DECLARED_CONTEXT_NODE');}
});
test('SOURCE_FREE Unicode boundaries retain whole codepoints and reject split or lone surrogates',()=>{
  const f=fixture(),at=f.normalized_text.indexOf('😀'),n=f.attachments[0];n.range={start:at,end:at+2,sha256:H('😀')};assert.equal(create(f).artifact.nodes[1].text,'😀');
  for(const range of[{start:at+1,end:at+2,sha256:H('\uDE00')},{start:at,end:at+1,sha256:H('\uD83D')}]){const g=clone(f);g.attachments[0].range=range;deny(()=>create(g),'DECLARED_CONTEXT_NODE');}
  const g=fixture();g.normalized_text+='\uD800';g.source.normalized_utf16_length++;g.source.normalized_sha256=H(g.normalized_text);deny(()=>create(g),'DECLARED_CONTEXT_INPUT');
});
test('SOURCE_FREE output cap is exact and lower-only source/node bounds fail without partial result',()=>{
  const f=fixture(),out=create(f),bytes=Buffer.byteLength(J(out.artifact))+Buffer.byteLength(J(out.metadata));
  assert.equal(verify({...f,limits:{output_bytes:bytes},artifact:create({...f,limits:{output_bytes:bytes}}).artifact}),true);
  for(const limits of[{output_bytes:bytes-1},{source_utf16:f.normalized_text.length-1},{attachments:1},{output_bytes:LIMITS.output_bytes+1}])deny(()=>create({...f,limits}),'DECLARED_CONTEXT_BOUND');
  const g=fixture();g.attachments=new Array(1000000);deny(()=>create(g),'DECLARED_CONTEXT_BOUND');
});
test('SOURCE_FREE plain JSON shape rejects accessors, hidden fields, malformed refs and sparse arrays',()=>{
  let reads=0;const f=fixture();Object.defineProperty(f.attachments[0],'declared_role',{enumerable:true,get(){reads++;throw Error('GETTER');}});deny(()=>create(f),'DECLARED_CONTEXT_INPUT');assert.equal(reads,0);
  for(const mutate of[g=>Object.defineProperty(g.focal,'hidden',{value:true}),g=>g.attachments[0].annotation_ref.bytes=0,g=>g.attachments[0].annotation_ref.sha256='bad',g=>delete g.attachments[0],g=>g.attachments.extra=true]){const g=fixture();mutate(g);assert.throws(()=>create(g));}
});
test('SOURCE_FREE verifier rejects reordered nodes, altered literals/refs/source and positive authority',()=>{
  const f=fixture(),out=create(f);for(const mutate of[a=>a.nodes.reverse(),a=>a.nodes[0].text+='x',a=>a.nodes[1].range.start++,a=>a.nodes[1].annotation_ref.path='OTHER',a=>a.nodes[1].declared_role='OTHER',a=>a.source.contract_id='OTHER',a=>a.source_identity_sha256='0'.repeat(64),a=>a.context_adequate=true,a=>a.authority='APPROVED',a=>a.joined_text='invented',a=>a.nodes.push(clone(a.nodes[0]))]){const artifact=clone(out.artifact);mutate(artifact);assert.throws(()=>verify({...f,artifact}));}
});

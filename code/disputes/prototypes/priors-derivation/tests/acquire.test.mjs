// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedFetch, selectSample, contractURLs } from '../lib/acquire.mjs';
import { embeddingWindows, normalizeVector } from '../lib/embed.mjs';
import { canonical, within } from '../lib/common.mjs';

const recipe = { seed: 'fixed', strata: [{label:'services',count:7},{label:'lease',count:3}], max_per_filer:2, limits:{max_contracts:300} };
const rows = Array.from({length:40}, (_,i) => ({doc_key:`${i % 12 + 1}/000000000000000001/doc${i}.htm`,label:i < 28?'services':'lease',year:2001+(i % 24)}));
test('sample is deterministic, type/era spread and globally capped by filer', () => {
  const a=selectSample(rows,recipe,10);const b=selectSample([...rows].reverse(),recipe,10);
  assert.deepEqual(a,b);assert.equal(a.selected.length,10);
  const ciks=new Map();for(const row of a.selected)ciks.set(row.cik,(ciks.get(row.cik)??0)+1);
  assert.ok([...ciks.values()].every(n=>n<=2));assert.equal(a.selected.filter(r=>r.label==='services').length,7);
  assert.ok(new Set(a.selected.map(r=>r.sampling_stratum)).size>=4);
});
test('sample exposes shortages and rejects out-of-bound counts', () => {
  assert.equal(selectSample([],recipe,10).shortfall,10);assert.throws(()=>selectSample(rows,recipe,301));
});
test('document keys cannot become traversal, alternate origin or credentials', () => {
  for(const key of ['../x','1/000000000000000001/../secret','1/000000000000000001/.','1/000000000000000001/..','https://evil','1/000000000000000001/a?x'])assert.throws(()=>contractURLs(key));
  assert.match(contractURLs(rows[0].doc_key).original,/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
});
test('bounded download enforces origin and actual streamed bytes', async () => {
  const fake=async()=>new Response('0123456789',{status:200});
  await assert.rejects(boundedFetch('https://mcc.law.stanford.edu/data/x',{maxBytes:5,fetcher:fake,retries:0}),/BYTE_LIMIT/);
  await assert.rejects(boundedFetch('http://mcc.law.stanford.edu/data/x',{maxBytes:20,fetcher:fake}),/origin/);
  const r=await boundedFetch('https://mcc.law.stanford.edu/data/x',{maxBytes:20,fetcher:fake});assert.equal(r.bytes,10);assert.equal(r.sha256.length,64);
});
test('token windows cover every word without truncation and account for overlap', () => {
  const text=Array.from({length:30},(_,i)=>`word${i}`).join(' ');
  const count=t=>t.split(' ').length+2;const windows=embeddingWindows(text,count,10,2);
  assert.ok(windows.length>1);assert.ok(windows.every(w=>w.tokens<=10));
  assert.equal(windows.reduce((s,w)=>s+w.weight,0),30);
  assert.deepEqual(new Set(windows.flatMap(w=>w.text.split(' '))),new Set(text.split(' ')));
  assert.throws(()=>embeddingWindows('huge',()=>1000,10));
});
test('finite canonical manifests and normalized vectors reject silent corruption', () => {
  assert.equal(canonical({z:1,a:2}),' {"a":2,"z":1}'.trim());assert.throws(()=>canonical({x:NaN}));
  assert.throws(()=>within('/tmp/run','../escape'));assert.deepEqual(normalizeVector([3,4]),[.6,.8]);assert.throws(()=>normalizeVector([0,0]));
});

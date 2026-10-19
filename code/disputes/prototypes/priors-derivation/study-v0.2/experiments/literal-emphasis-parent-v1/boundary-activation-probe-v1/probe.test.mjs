// SPDX-License-Identifier: AGPL-3.0-only
// Internally authored SOURCE_FREE data only. No actual source/model IO.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {extractSections as frozenV2,selectUnits} from '../list-governor-boundary-v2/sections.prototype.mjs';
import {extractSections,probeExtractSections} from './sections.prototype.mjs';
import {createBoundaryProbe,verifyBoundaryProbe,projectBoundaryProbe,PROBE_LIMITS} from './probe.mjs';
import {stableCoreDifferences,stableSelectionDifferences} from '../typed-owned-preparation-v1/comparison.mjs';
import {verifyNativeDecorationEnvelope} from '../source-decoration.prototype.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const tracer=hash(readFileSync(new URL('../source-decoration.prototype.mjs',import.meta.url)));
const frozenSHA=hash(readFileSync(new URL('../list-governor-boundary-v2/sections.prototype.mjs',import.meta.url)));
const probeSHA=hash(readFileSync(new URL('./sections.prototype.mjs',import.meta.url)));
const caption=(n,title,external=false,inline=true)=>`<p><font><span>${n}. </span><span><b><u>${title}${external?'':'.'}</u></b></span></font>${external?'.':''}${inline?' The synthetic holder must retain the source record.':''}</p>${inline?'':'<p>The synthetic holder must retain the source record.</p>'}`;
const list='<p>(i) The synthetic applicant delivers the form;</p><p>(ii) The synthetic applicant retains the receipt;</p>';
const fixture=(tail,{first=caption(1,'Permission',false,false),items=list}={})=>`<html><body>${first}<p>The synthetic permission depends on the following conditions:</p>${items}<p>This synthetic qualification governs every listed item.</p>${tail}</body></html>`;
const warning=r=>r.warnings.find(w=>w.code==='PROTOTYPE_EMPHASIZED_NUMERIC_PEER_CLOSURE_HYPOTHESIS')?.count??0;
const invariant=e=>{const{sha256,collector_source_sha256,...body}=e;return body;};
function run(raw){
  const record={id:'SYNTHETIC_ACTIVATION_PROBE',format:'html',source_url:'https://synthetic.invalid/probe',content:raw};
  const options=collector=>({minWords:1,maxUnitWords:300,nativeDecorationIdentity:{tracerSourceSHA256:tracer,collectorSourceSHA256:collector}});
  const old=frozenV2(record,options(frozenSHA)),ordinary=extractSections(record,options(frozenSHA));
  assert.deepEqual(ordinary,old);
  const{extraction,probe}=probeExtractSections(record,options(probeSHA));
  assert.equal(old.status,'accepted');assert.equal(extraction.status,'accepted');
  assert.deepEqual(stableCoreDifferences(old,extraction),[]);
  assert.deepEqual(invariant(old.native_source_decorations),invariant(extraction.native_source_decorations));
  assert.notEqual(old.native_source_decorations.sha256,extraction.native_source_decorations.sha256);
  for(const[result,collector]of[[old,frozenSHA],[extraction,probeSHA]])verifyNativeDecorationEnvelope(result.native_source_decorations,{raw,normalizedText:result.normalized_text,expectedTracerSourceSHA256:tracer,expectedCollectorSourceSHA256:collector});
  const selection={seed:'SYNTHETIC_PROBE_SELECTION',maxPerContract:40,maxUnits:1000};
  assert.deepEqual(stableSelectionDifferences(selectUnits(old.units,selection),selectUnits(extraction.units,selection)),[]);
  assert.equal(verifyBoundaryProbe(probe),true);assert.ok(Object.isFrozen(probe.caption_records));
  const projection=projectBoundaryProbe(probe);assert.equal(projection.caption_record_count,probe.caption_records.length);assert.ok(projection.decoded_bytes<=262144);
  function metadataOnly(v){if(typeof v==='string')assert.match(v,/^[a-f0-9]{64}$/u);else if(Array.isArray(v))v.forEach(metadataOnly);else if(v&&typeof v==='object')Object.values(v).forEach(metadataOnly);else assert.ok(v===null||typeof v==='boolean'||Number.isSafeInteger(v));}
  metadataOnly(probe);metadataOnly(projection);return{old,extraction,probe,projection};
}
const counts=(probe,stage,bit)=>Object.entries(probe.counters).some(([k,n])=>{const[s,m]=k.split(':').map(Number);return s===stage&&n>0&&(bit===0?m===0:(m&bit)!==0);});

test('internal punctuation admits V2 while external punctuation exposes exact-title mismatch without changing it',()=>{
  const inside=run(fixture(caption(2,'Notices'))),outside=run(fixture(caption(2,'Notices',true)));
  assert.equal(inside.extraction.normalized_text,outside.extraction.normalized_text);
  assert.equal(warning(inside.extraction),1);assert.equal(warning(outside.extraction),0);
  const r=outside.probe.caption_records.find(r=>r.stage===1&&r.number===2&&(r.reason_mask&4));
  assert.ok(r);assert.equal(r.following_codepoint,46);assert.equal(r.title_utf16,r.literal_utf16+1);assert.equal(r.common_prefix_utf16,r.literal_utf16);
  assert.ok(r.raw_start>=0&&r.raw_end>r.raw_start);assert.equal(counts(outside.probe,2,2048),true);
});

test('external punctuation on the governing caption retains a missing-governing-number frame',()=>{
  const r=run(fixture(caption(2,'Notices'),{first:caption(1,'Permission',true,false)}));
  assert.equal(warning(r.extraction),0);assert.equal(counts(r.probe,3,4),true);assert.equal(counts(r.probe,4,16),true);
  assert.ok(r.probe.caption_records.some(r=>r.stage===1&&r.number===1&&(r.reason_mask&4)&&r.following_codepoint===46));
});

test('probe distinguishes list, quote, table and wrong-peer gates without changing V2',()=>{
  for(const[tail,stage,bit]of[
    [`<ul><li>${caption(2,'Notices')}</li></ul>`,2,16],
    [`<blockquote>${caption(2,'Notices')}</blockquote>`,2,64],
    [`<table><tr><td>${caption(2,'Notices')}</td></tr></table>`,2,1024],
    [caption(3,'Notices'),4,64]
  ]){const r=run(fixture(tail));assert.equal(warning(r.extraction),0);assert.equal(counts(r.probe,stage,bit),true);}
  const numeric='<p>1. The synthetic applicant delivers the form;</p><p>2. The synthetic applicant retains the receipt;</p>';
  const r=run(fixture(caption(2,'Notices'),{items:numeric}));assert.equal(warning(r.extraction),0);assert.equal(counts(r.probe,3,1),true);
});

test('CSS-only and partial body evidence remains rejected and only hashes reach probe records',()=>{
  for(const tail of['<p>2. <span style="font-weight:bold">Notices.</span> The synthetic holder must retain the record.</p>','<p>2. <b>Notice</b> Procedures.</p><p>The synthetic holder must retain the record.</p>']){
    const r=run(fixture(tail));assert.equal(warning(r.extraction),0);assert.equal(counts(r.probe,1,1)||counts(r.probe,1,4),true);
    assert.equal(JSON.stringify(r.probe).includes('Notices'),false);assert.equal(JSON.stringify(r.probe).includes('synthetic.invalid'),false);
  }
});

test('ledger budget is fixed, never truncated, and remains failed after overflow',()=>{
  assert.deepEqual(PROBE_LIMITS,{schema_version:1,max_bytes:262144,max_records:1024,max_summary_bytes:65536});
  const recorder=createBoundaryProbe();let held=false;
  for(let i=0;i<=1024;i++){try{recorder.record({stage:1,reason_mask:4,block_sha256:'a'.repeat(64),block_utf16:20,block_index:i,literal_sha256:'b'.repeat(64),title_sha256:'c'.repeat(64)});}catch(error){assert.equal(error.code,'PROBE_BOUND');held=true;break;}}
  assert.equal(held,true);assert.throws(()=>recorder.finish(),{code:'PROBE_BOUND'});
});

test('validator binds counters, ordinals, field types and seal; arbitrary fields are rejected before coercion',()=>{
  const recorder=createBoundaryProbe();recorder.count(4,1);recorder.record({stage:1,reason_mask:4,block_sha256:'a'.repeat(64),block_utf16:12});const good=recorder.finish();assert.equal(verifyBoundaryProbe(good),true);
  const reseal=v=>{const{sha256,...body}=v;return{...body,sha256:hash(JSON.stringify(body))};};
  for(const change of[v=>{v.event_count++;},v=>{v.caption_records[0].ordinal=2;},v=>{v.caption_records[0].block_utf16='a'.repeat(64);},v=>{v.caption_records[0].source_text='SYNTHETIC_REJECTED_FIELD';}]){
    const bad=structuredClone(good);change(bad);assert.throws(()=>verifyBoundaryProbe(reseal(bad)));
  }
  let reads=0;const bad=createBoundaryProbe(),event={stage:1,reason_mask:0,block_sha256:'a'.repeat(64),block_utf16:2};Object.defineProperty(event,'title_sha256',{enumerable:true,get(){reads++;return 'b'.repeat(64);}});
  assert.throws(()=>bad.record(event),{code:'PROBE_EVENT'});assert.equal(reads,0);assert.throws(()=>bad.finish(),{code:'PROBE_EVENT'});
});

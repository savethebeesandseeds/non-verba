// SPDX-License-Identifier: AGPL-3.0-only
// Internally authored SOURCE_FREE fixtures only; no actual corpus/model access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractSections as baseline,selectUnits} from '../sections.prototype.mjs';
import {extractSections as frozenV1} from '../list-governor-boundary-v1/sections.prototype.mjs';
import {extractSections as variant,LIST_GOVERNOR_BOUNDARY_POLICY} from './sections.prototype.mjs';
import {sha} from '../finite-codec.mjs';
import {verifyNativeDecorationEnvelope} from '../source-decoration.prototype.mjs';
import {stableCoreDifferences,stableSelectionDifferences} from '../typed-owned-preparation-v1/comparison.mjs';
const tracer=sha(readFileSync(new URL('../source-decoration.prototype.mjs',import.meta.url)));
const baselineCollector=sha(readFileSync(new URL('../sections.prototype.mjs',import.meta.url)));
const variantCollector=sha(readFileSync(new URL('./sections.prototype.mjs',import.meta.url)));
const v1Collector=sha(readFileSync(new URL('../list-governor-boundary-v1/sections.prototype.mjs',import.meta.url)));
const heading=(n,title='Notices',inline=true)=>inline?`<p><b><u>${n}. ${title}.</u></b> The synthetic holder must send the synthetic notice.</p>`:`<p><b><u>${n}. ${title}</u></b></p><p>The synthetic holder must send the synthetic notice.</p>`;
const governor='<p>The synthetic permission applies only if the following conditions are satisfied:</p>';
const items='<p>(i) The synthetic applicant delivers the signed form;</p><p>(ii) The synthetic applicant pays the stated amount;</p>';
const qualification='<p>This synthetic qualification governs every listed item.</p>';
const fixture=(tail,{first=heading(1,'Permission',false),list=items}={})=>`<html><body>${first}${governor}${list}${qualification}${tail}</body></html>`;
const bareHeading=(n,title='Notices',inline=true,tag='bu')=>{
  const caption=tag==='bu'?`<b><u>${title}.</u></b>`:`<${tag}>${title}.</${tag}>`;
  return `<p><font><span>${n}. </span><span>${caption}</span></font>${inline?' The synthetic holder must send the synthetic notice.':''}</p>${inline?'':'<p>The synthetic holder must send the synthetic notice.</p>'}`;
};
function compare(raw,options={}){
  const record={id:'SYNTHETIC_LIST_GOVERNOR_DOCUMENT',format:'html',source_url:'https://synthetic.invalid/list-governor',content:raw};
  const extract=(fn,collector)=>fn(record,{minWords:1,maxUnitWords:300,...options,nativeDecorationIdentity:{tracerSourceSHA256:tracer,collectorSourceSHA256:collector}});
  const a=extract(baseline,baselineCollector),b=extract(variant,variantCollector);
  assert.equal(a.status,'accepted');assert.equal(b.status,'accepted');
  assert.equal(b.normalized_text,a.normalized_text);assert.equal(b.normalized_sha256,a.normalized_sha256);
  assert.deepEqual(b.native_source_decorations.trace,a.native_source_decorations.trace);
  assert.deepEqual(b.native_source_decorations.segments,a.native_source_decorations.segments);
  assert.deepEqual(b.native_source_decorations.unmapped,a.native_source_decorations.unmapped);
  assert.deepEqual(b.native_source_decorations.unmapped_normalized,a.native_source_decorations.unmapped_normalized);
  assert.deepEqual(b.native_source_decorations.collector_issues,a.native_source_decorations.collector_issues);
  assert.notEqual(a.native_source_decorations.sha256,b.native_source_decorations.sha256);
  for(const[result,collector]of[[a,baselineCollector],[b,variantCollector]])verifyNativeDecorationEnvelope(result.native_source_decorations,{raw,normalizedText:result.normalized_text,expectedTracerSourceSHA256:tracer,expectedCollectorSourceSHA256:collector});
  return{a,b};
}
const newWarning=result=>result.warnings.find(w=>w.code==='PROTOTYPE_EMPHASIZED_NUMERIC_PEER_CLOSURE_HYPOTHESIS');
function inactive(raw,options){
  const{a,b}=compare(raw,options),detached=structuredClone(b);delete detached.parameters.list_governor_boundary_policy;
  assert.equal(newWarning(b),undefined);assert.deepEqual(stableCoreDifferences(a,detached),[]);
  const selection={seed:'SYNTHETIC_LIST_GOVERNOR_SELECTION',maxPerContract:40,maxUnits:1000};
  assert.deepEqual(stableSelectionDifferences(selectUnits(a.units,selection),selectUnits(b.units,selection)),[]);
  return{a,b};
}

test('initial emphasized next peer caption plus body closes only the proposed source frame',()=>{
  const{a,b}=compare(fixture(heading(2)));
  assert.equal(a.sections.length,1);assert.equal(b.sections.length,2);
  const before=b.sections[0],after=b.sections[1];
  assert.ok(before.text.includes('following conditions'));assert.ok(before.text.includes('(i)'));assert.ok(before.text.includes('(ii)'));assert.ok(before.text.includes('qualification governs'));
  assert.ok(!before.text.includes('2. Notices.'));assert.ok(after.text.startsWith('2. Notices.'));assert.ok(after.text.includes('must send'));
  assert.equal(before.governor_frames[0].closure,'NEXT_EMPHASIZED_NUMERIC_PEER_HYPOTHESIS_NOT_SEMANTIC_CLOSURE');
  assert.equal(after.heading_provenance.prototype_boundary_hypothesis.status,'EMPHASIZED_NEXT_NUMERIC_PEER_HYPOTHESIS');
  assert.equal(newWarning(b).count,1);assert.equal(newWarning(b).boundary_verified,false);assert.equal(newWarning(b).semantic_completeness_verified,false);
  assert.equal(b.parameters.list_governor_boundary_policy,LIST_GOVERNOR_BOUNDARY_POLICY);
  for(const s of b.sections){assert.equal(s.boundary_verified,false);assert.equal(s.completeness.governing_hierarchy_verified,false);assert.equal(s.completeness.semantic_completeness_verified,false);}
});

test('whole emphasized caption and neutral wrapped initial caption use existing source evidence',()=>{
  const tails=[heading(2,'Notices',false),'<p><span><b><u>2. Notices.</u></b></span> The synthetic holder must send notice.</p>'];
  for(const tail of tails){const{a,b}=compare(fixture(tail));assert.equal(a.sections.length,1);assert.equal(b.sections.length,2);assert.equal(newWarning(b).count,1);}
});

test('roman/letter items and their shared qualification remain beside the governor',()=>{
  for(const list of[items,'<p>(a) The synthetic applicant delivers the form;</p><p>(b) The synthetic applicant pays the amount;</p>']){
    const{b}=compare(fixture(heading(2),{list}));assert.equal(b.sections.length,2);const first=b.sections[0];assert.ok(first.text.includes('following conditions'));assert.ok(first.text.includes('pays'));assert.ok(first.text.includes('qualification governs'));assert.equal(first.governor_frames.length,1);
  }
});

test('numeric-first introduced lists retain the baseline even for emphasized numbered captions',()=>{
  const list='<p><b>1. Delivery.</b> The synthetic applicant delivers the form;</p><p><b>2. Payment.</b> The synthetic applicant pays the amount;</p>';
  const{a,b}=inactive(fixture(heading(2),{list}));assert.equal(a.sections.length,1);assert.equal(b.sections.length,1);
});

test('sourceLI and source list depth prevent inline-caption promotion without affecting legacy logic',()=>{
  for(const list of[
    '<ul><li>(i) The synthetic applicant delivers the form;</li><li><p><b>2. Notices.</b> The synthetic holder must send notice.</p></li></ul>',
    '<ul><p>(i) The synthetic applicant delivers the form;</p><p><b>2. Notices.</b> The synthetic holder must send notice.</p></ul>'
  ])inactive(fixture('',{list}));
});

test('unmarked sourceLI before an outside peer is not literal letter/roman evidence',()=>{
  const list='<ul><li>The synthetic applicant delivers the signed form;</li><li>The synthetic applicant pays the stated amount;</li></ul>';
  const{a,b}=inactive(fixture(heading(2),{list}));assert.equal(a.sections.length,1);assert.equal(b.sections.length,1);
});

test('quoted/table/unfinished-source contexts remain unchanged',()=>{
  const embedded=[
    '<blockquote><p><b>2. Notices.</b> The synthetic holder must send notice.</p></blockquote>',
    '<table><tr><td><p><b>2. Notices.</b> The synthetic holder must send notice.</p></td></tr></table>',
    '<p>The synthetic holder shall act only if</p><p><b>2. Notices.</b> the synthetic applicant receives notice.</p>',
    '<p>The synthetic holder records (</p><p><b>2. Notices.</b> The synthetic applicant receives notice.</p><p>)</p>'
  ];
  for(const tail of embedded)inactive(fixture(tail));
});

test('bare numbers, wrong peers, decimal prefixes and operative emphasis do not close a frame',()=>{
  for(const tail of['<p>2. Notices.</p><p>The synthetic holder must send notice.</p>',heading(3),heading(1),heading('2.1'),'<p><b>2. The synthetic holder must send notice.</b></p>'])inactive(fixture(tail));
  inactive(fixture(heading(2),{first:'<p>1. Permission.</p><p>The synthetic holder may proceed.</p>'}));
});

test('explicitArticle and Section fences retain their baseline behavior',()=>{
  for(const tail of['<p>Section 2 Notices</p><p>The synthetic holder must send notice.</p>','<p>ARTICLE II</p><p>The synthetic holder must send notice.</p>','<h2>2. Notices</h2><p>The synthetic holder must send notice.</p>']){
    const{a,b}=inactive(fixture(tail));assert.equal(a.sections.length,2);assert.equal(b.sections.length,2);
  }
});

test('Unicode/literal origins and native marks remain exact across the boundary change',()=>{
  const unicodeItems='<p>(i) The synthetic applicant preserves <b>cafe\u0301&nbsp;😀</b> and literal [NF markers];</p><p>(ii) The synthetic applicant retains <u></u><em>全部</em> source characters;</p>';
  const{b}=compare(fixture(heading(2),{list:unicodeItems}));assert.equal(b.sections.length,2);assert.ok(b.normalized_text.includes('café 😀'));assert.ok(b.normalized_text.includes('[NF markers]'));assert.ok(b.normalized_text.includes('全部'));
});

test('the parent-boundary variant deliberately leaves long-list focal packing unchanged',()=>{
  const list=Array.from({length:14},(_,i)=>`<p>(${String.fromCharCode(97+i)}) The synthetic applicant ${Array.from({length:32},()=> 'retains').join(' ')} every stated source condition;</p>`).join('');
  const{b}=compare(fixture(heading(2),{list})),first=b.sections[0];assert.equal(b.sections.length,2);assert.ok(first.units.length>1);assert.ok(first.units.every(u=>u.word_count<=300));assert.ok(first.units.some(u=>!u.text.includes('following conditions')));assert.ok(first.units.every(u=>u.warnings.some(w=>w.code==='CHUNK_IN_COMPLETE_SECTION')));
  assert.ok(first.text.includes('(a)'));assert.ok(first.text.includes('(n)'));assert.ok(first.text.includes('qualification governs'));
});

test('V2 bridges the source-free bare-integer plus tagged-caption gap left inactive by frozen V1',()=>{
  const raw=fixture(bareHeading(2),{first:bareHeading(1,'Permission',false)}),{a,b}=compare(raw);
  const old=frozenV1({id:'SYNTHETIC_LIST_GOVERNOR_DOCUMENT',format:'html',source_url:'https://synthetic.invalid/list-governor',content:raw},{minWords:1,maxUnitWords:300,nativeDecorationIdentity:{tracerSourceSHA256:tracer,collectorSourceSHA256:v1Collector}});
  assert.equal(a.sections.length,1);assert.equal(old.sections.length,1);assert.equal(newWarning(old),undefined);
  assert.equal(old.normalized_text,a.normalized_text);assert.equal(b.sections.length,2);assert.equal(newWarning(b).count,1);
  assert.equal(b.sections[1].heading_provenance.prototype_boundary_hypothesis.next_caption_evidence,'LITERAL_BARE_INTEGER_THEN_B_U_STRONG_CAPTION');
  assert.ok(b.sections[0].text.includes('qualification governs'));assert.ok(b.sections[1].text.startsWith('2. Notices.'));
  assert.match(LIST_GOVERNOR_BOUNDARY_POLICY,/_V2$/u);
});

test('bare integer with B, U, strong or nested B/U captions uses only existing title boundaries',()=>{
  for(const tag of['b','u','strong','bu'])for(const inline of[true,false]){
    const{a,b}=compare(fixture(bareHeading(2,'Notices',inline,tag),{first:bareHeading(1,'Permission',false,tag)}));
    assert.equal(a.sections.length,1);assert.equal(b.sections.length,2);assert.equal(newWarning(b).count,1);
    assert.equal(b.normalized_text.split('\n\n').length,a.normalized_text.split('\n\n').length);
    assert.equal(b.sections[0].governor_frames[0].boundary_verified,false);
  }
});

test('centered plaintext and CSS-only caption styling supply no V2 literal-tag evidence',()=>{
  const plain='<p align="center">2. Notices.</p><p>The synthetic holder must send notice.</p>';
  const css='<p>2. <span style="font-weight:bold;text-decoration:underline">Notices.</span> The synthetic holder must send notice.</p>';
  const wholeCSS='<p style="font-weight:bold;text-decoration:underline">2. Notices.</p><p>The synthetic holder must send notice.</p>';
  for(const tail of[plain,css,wholeCSS])inactive(fixture(tail,{first:bareHeading(1,'Permission',false)}));
  for(const first of['<p align="center">1. Permission.</p><p>The synthetic holder may proceed.</p>','<p>1. <span style="font-weight:bold">Permission.</span></p><p>The synthetic holder may proceed.</p>'])inactive(fixture(bareHeading(2),{first}));
});

test('partial captions, operative emphasis and structural interruptions cannot manufacture a title',()=>{
  for(const tail of[
    '<p>2. <b>Notice</b> Procedures.</p><p>The synthetic holder must send notice.</p>',
    '<p>2. <b>The synthetic holder</b> must send notice.</p>',
    '<p>2. <b>The synthetic holder must send notice.</b></p>',
    '<p><b>2.</b> Notices.</p><p>The synthetic holder must send notice.</p>',
    '<p>2. <b>Notices</b><br><b>Procedures.</b></p><p>The synthetic holder must send notice.</p>',
    '<div>2. <p><b>Notices.</b></p></div><p>The synthetic holder must send notice.</p>',
    '<p>2. <em>Notices.</em> The synthetic holder must send notice.</p>'
  ])inactive(fixture(tail,{first:bareHeading(1,'Permission',false)}));
});

test('new literal-tag route retains LI, list-depth, quote, table and continuation exclusions',()=>{
  const caption=bareHeading(2);
  for(const tail of[
    `<ul><li>${caption}</li></ul>`,`<ul>${caption}</ul>`,
    `<blockquote>${caption}</blockquote>`,`<table><tr><td>${caption}</td></tr></table>`,
    `<p>The synthetic holder shall act only if</p>${caption}`,
    `<p>The synthetic holder records (</p>${caption}<p>)</p>`
  ])inactive(fixture(tail,{first:bareHeading(1,'Permission',false)}));
  const unmarked='<ul><li>The synthetic applicant delivers the form;</li><li>The synthetic applicant pays the amount;</li></ul>';
  inactive(fixture(caption,{first:bareHeading(1,'Permission',false),list:unmarked}));
});

test('bare-caption route rejects numeric lists, missing governors, skipped/repeated/decimal peers',()=>{
  const first=bareHeading(1,'Permission',false);
  for(const n of[1,3,'2.1'])inactive(fixture(bareHeading(n),{first}));
  inactive(fixture(bareHeading(2),{first:'<p>1. Permission.</p><p>The synthetic holder may proceed.</p>'}));
  inactive(`<html><body>${first}<p>The synthetic holder may proceed.</p>${bareHeading(2)}</body></html>`);
  const numeric='<p>1. <b>Delivery.</b> The synthetic applicant delivers the form;</p><p>2. <b>Payment.</b> The synthetic applicant pays the amount;</p>';
  inactive(fixture(bareHeading(2),{first,list:numeric}));
});

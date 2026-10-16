// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sourceNavigationLabel,verifySourceNavigation,NAVIGATION_SCOPE,createNativeSourceContext,createNativeRepresentation,nativeRepresentationWindow,modelInputIdentity,LEGACY_NATIVE_STATUS} from '../lib/representation.mjs';
import {traceNativeDecoration,bindNativeDecoration} from '../lib/source-decoration.mjs';
import {NATIVE_COLLECTOR_POLICY} from '../lib/sections.mjs';
import {verifiedParentRepresentation} from '../lib/sensitivity.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
function anchor(text,start=0) {
  return {label:text,start,end:start+text.length,parts:[{text,start,end:start+text.length}],kind:'numbered_heading',scope:NAVIGATION_SCOPE,governing_hierarchy_verified:false,ambiguity:['RETAINED_UNCLOSED_SOURCE_QUOTE']};
}
function navigation(nearest) {
  return {nearest_anchor:nearest,within_unit:[],scope:NAVIGATION_SCOPE,governing_hierarchy_verified:false};
}

test('literal navigation replaces a stale inherited prefix without claiming a governor',()=>{
  const unit={start:100,heading:'Section 1',heading_path:['Section 1'],source_navigation:navigation(anchor('Section 12. Payment.'))};
  assert.equal(sourceNavigationLabel(unit),'Section 12. Payment.');
  assert.equal(unit.heading,'Section 1');
  assert.equal(unit.source_navigation.governing_hierarchy_verified,false);
  assert.deepEqual(unit.source_navigation.nearest_anchor.ambiguity,['RETAINED_UNCLOSED_SOURCE_QUOTE']);
});

test('explicit unknown navigation uses no stale prefix while historical artifacts retain their input',()=>{
  assert.equal(sourceNavigationLabel({heading:'RECITALS',source_navigation:navigation(null)}),'');
  assert.equal(sourceNavigationLabel({heading_path:['ARTICLE 3','Section 3.01']}),'ARTICLE 3 > Section 3.01');
});

test('a multiline literal caption keeps exact UTF16 pieces and introduces no words',()=>{
  const first='REGISTRATION RIGHTS',second='AGREEMENT',a=anchor(first);
  a.end=first.length+2+second.length;a.label=first+' '+second;
  a.parts.push({text:second,start:first.length+2,end:a.end});
  assert.equal(sourceNavigationLabel({source_navigation:navigation(a)}),a.label);
  const unicode=anchor('Section 8.1 交付📦');
  assert.equal(sourceNavigationLabel({source_navigation:navigation(unicode)}),unicode.label);
  unicode.parts[0].end=Buffer.byteLength(unicode.label);
  assert.throws(()=>sourceNavigationLabel({source_navigation:navigation(unicode)}),/coordinates differ/);
});

test('unverified navigation rejects invented labels, shifted coordinates and asserted legal hierarchy',()=>{
  const a=anchor('Section 12. Payment.'),unit={start:100,source_navigation:navigation(a)};
  a.label='Section 12. Irrevocable Payment.';
  assert.throws(()=>sourceNavigationLabel(unit),/label differs/);
  a.label=a.parts[0].text;a.parts[0].start++;
  assert.throws(()=>sourceNavigationLabel(unit),/coordinates differ/);
  a.parts[0].start--;unit.source_navigation.governing_hierarchy_verified=true;
  assert.throws(()=>sourceNavigationLabel(unit),/unverified literal scope/);
  unit.source_navigation.governing_hierarchy_verified=false;unit.source_navigation.nearest_anchor=anchor('Section 12. Payment.',101);
  assert.throws(()=>sourceNavigationLabel(unit),/after the unit/);
});

test('both fixed comparison inputs use the same new prefix and preserve their source/context spans',()=>{
  const title='Section 12. Payment.',body='Tenant shall pay rent except for an expressly excused delay.';
  const normalized=title+'\n\n'+body+'\n\nNotice shall remain effective.';
  const parent={id:'synthetic-parent',contract_id:'synthetic-contract',cohort:'discovery-broad',start:0,end:normalized.length,sha256:sha(normalized)};
  const unit={id:'synthetic-unit',parent_section_id:parent.id,contract_id:parent.contract_id,cohort:parent.cohort,start:title.length+2,end:title.length+2+body.length,text:body,sha256:sha(body),heading:'RECITALS',source_navigation:navigation(anchor(title))};
  const result=verifiedParentRepresentation(unit,parent,normalized);
  assert.equal(result.primary,title+'\n'+body);
  assert.equal(result.contextual,title+'\n'+normalized.slice(result.provenance.context_start,result.provenance.context_end));
  assert.equal(result.provenance.unit_sha256,sha(body));
  assert.equal(result.provenance.maximum_neighbor_words,60);
  assert.equal(result.provenance.heading_source,'LITERAL_SOURCE_NAVIGATION_UNVERIFIED');
  assert.ok(result.provenance.before_words+result.provenance.after_words<=60);
});

test('a navigation label cannot point to different actual normalized text',()=>{
  const normalized='Section 12. Payment.\n\nTenant shall pay rent.';
  const unit={start:22,source_navigation:navigation(anchor('Section 12. Payment.'))};
  verifySourceNavigation(unit,normalized);
  assert.throws(()=>verifySourceNavigation(unit,normalized.replace('Payment','Privacy')),/normalized source/);
  const within=anchor('Tenant shall pay rent.',22);unit.source_navigation.within_unit.push(within);
  verifySourceNavigation(unit,normalized);
  within.parts[0].end++;
  assert.throws(()=>verifySourceNavigation(unit,normalized),/coordinates differ/);
});

// Every new case below is declared synthetic; no contract corpus is opened.
function nativeFixture(raw,select={}) {
  const trace=traceNativeDecoration(raw),normalizedText=trace.runs.map(run=>run.decoded_text).join('');let offset=0;
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,tracerSourceSHA256:'a'.repeat(64),collectorSourceSHA256:'b'.repeat(64),collectorSegments:trace.runs.map(run=>{const start=offset;offset+=run.decoded_text.length;return {normalized_start:start,normalized_end:offset,sources:[{run_id:run.id,decoded_start:0,decoded_end:run.decoded_text.length}],normalization:'EXACT_DECODED'};})});
  const parent={id:'synthetic-parent',contract_id:'synthetic-contract',cohort:'discovery-broad',start:0,end:normalizedText.length,sha256:sha(normalizedText)};
  const start=select.start??0,end=select.end??normalizedText.length,text=normalizedText.slice(start,end);
  const unit={id:'synthetic-unit',parent_section_id:parent.id,contract_id:parent.contract_id,cohort:parent.cohort,start,end,text,sha256:sha(text),source_navigation:navigation(null),native_source_decorations_ref:{envelope_sha256:envelope.sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,policy:envelope.policy,collector_policy:NATIVE_COLLECTOR_POLICY,start,end,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,projection_required:true}};
  const context=createNativeSourceContext({raw,normalizedText,envelope,expectedTracerSourceSHA256:'a'.repeat(64),expectedCollectorSourceSHA256:'b'.repeat(64)});
  return {raw,normalizedText,envelope,parent,unit,context};
}

test('native inputs exclude noncontiguous navigation pieces and retain only the selected source span',()=>{
  const f=nativeFixture('<p><u>Heading</u> omitted gap <strike>Caption</strike> Body <u>same</u></p>',{start:28});
  const a=anchor('Heading');a.end=27;a.label='Heading Caption';a.parts.push({text:'Caption',start:20,end:27});f.unit.source_navigation=navigation(a);
  const representation=createNativeRepresentation(f.unit,{context:f.context,parent:f.parent});
  assert.deepEqual(representation.descriptor.parts.map(p=>[p.kind,p.role,p.normalized_start,p.normalized_end]),[['source','unit_body',28,f.unit.end]]);
  assert.equal(representation.text,f.unit.text);
  const window=nativeRepresentationWindow(representation);
  assert.match(window.text,/"tag":"u"/);assert.ok(!window.text.includes('"tag":"strike"'));assert.ok(!window.text.includes('Heading')&&!window.text.includes('Caption')&&!window.text.includes('omitted gap'));
  assert.equal(window.source_ranges.length,1);assert.equal(window.effectiveness_verified,false);
  const identity=modelInputIdentity({...f.unit,native_input:representation});assert.equal(identity.native_evidence_status,'BOUND_NATIVE_SOURCE_EVIDENCE');assert.notEqual(identity.input_sha256,sha(representation.text));
  assert.equal(f.unit.source_navigation.nearest_anchor,a,'The independently verified navigation metadata is preserved');
  f.unit.source_navigation=navigation(anchor('Heading'));
  const other=createNativeRepresentation(f.unit,{context:f.context,parent:f.parent});assert.equal(other.input_sha256,representation.input_sha256,'Changing only valid navigation metadata cannot change model input');
  assert.throws(()=>createNativeRepresentation(f.unit,{context:f.context,parent:f.parent,includeHeading:true}),/forbids heading promotion/);
});

test('source captions inside a selected body or contiguous context remain once with their native marks',()=>{
  const f=nativeFixture('<p><u>Local caption</u> Body wording remains.</p>');f.unit.source_navigation=navigation(anchor('Local caption'));
  const body=createNativeRepresentation(f.unit,{context:f.context,parent:f.parent}),window=nativeRepresentationWindow(body);
  assert.equal(body.text,f.normalizedText);assert.equal((body.text.match(/Local caption/gu)||[]).length,1);assert.equal(body.descriptor.parts.length,1);assert.match(window.text,/"tag":"u"/);
  const start=f.normalizedText.indexOf('Body'),unit={...f.unit,start,text:f.normalizedText.slice(start),sha256:sha(f.normalizedText.slice(start)),native_source_decorations_ref:{...f.unit.native_source_decorations_ref,start}};
  const bare=createNativeRepresentation(unit,{context:f.context,parent:f.parent});assert.equal(bare.text,unit.text);assert.doesNotMatch(nativeRepresentationWindow(bare).text,/Local caption|"tag":"u"/);
  const context=createNativeRepresentation(unit,{context:f.context,parent:f.parent,bodyRange:{start:0,end:unit.end}});
  assert.equal(context.text,f.normalizedText);assert.equal(context.descriptor.parts[0].role,'verified_parent_context');assert.equal(context.descriptor.parts.length,1);assert.match(nativeRepresentationWindow(context).text,/"tag":"u"/);
});

test('current native comparison strings exclude prose-role navigation while fixed context coordinates stay unchanged',()=>{
  const f=nativeFixture('<p>Earlier prose is not a selected title. Local body must remain.</p>',{start:39});
  f.unit.source_navigation=navigation(anchor('Earlier prose is not a selected title.'));
  const result=verifiedParentRepresentation(f.unit,f.parent,f.normalizedText);
  assert.equal(result.primary,f.unit.text);assert.equal(result.contextual,f.normalizedText.slice(result.provenance.context_start,result.provenance.context_end));
  assert.equal(result.provenance.heading_source,'EXCLUDED_NAVIGATION_METADATA_ONLY');assert.match(result.provenance.heading_input_policy,/NAVIGATION_METADATA_EXCLUDED/);
  const legacy={...f.unit};delete legacy.native_source_decorations_ref;const historical=verifiedParentRepresentation(legacy,f.parent,f.normalizedText);
  for(const key of ['context_start','context_end','before_words','after_words','maximum_neighbor_words'])assert.equal(result.provenance[key],historical.provenance[key],'Source selection is unchanged by excluding metadata prefixes');
  const malformed={...f.unit,source_navigation:navigation(anchor('Invented earlier title.'))};assert.throws(()=>createNativeRepresentation(malformed,{context:f.context,parent:f.parent}),/normalized source/);
});

test('identical literal values retain different original runs and immutable representation bindings',()=>{
  const f=nativeFixture('<p>same <strike>same</strike> <u>same</u></p>');
  const representation=createNativeRepresentation(f.unit,{context:f.context,parent:f.parent}),window=nativeRepresentationWindow(representation,{start:5,end:9});
  assert.match(window.text,/"tag":"strike"/);assert.ok(!window.text.includes('"tag":"u"'));
  assert.deepEqual(window.source_ranges.map(r=>[r.start,r.end]),[[5,9]]);
  assert.throws(()=>{representation.descriptor.parts[0].normalized_start=1;},TypeError);
  assert.throws(()=>modelInputIdentity({...f.unit,native_input:{...representation}}),/Authenticated/);
  f.unit.native_source_decorations_ref={...f.unit.native_source_decorations_ref,start:1};
  assert.throws(()=>modelInputIdentity({...f.unit,native_input:representation}),/Authenticated/);
});

test('native context refuses changed raw/normalized/methods, unresolved origins and missing unit refs',()=>{
  const f=nativeFixture('<p><u>visible words</u></p>'),options={raw:f.raw,normalizedText:f.normalizedText,envelope:f.envelope,expectedTracerSourceSHA256:'a'.repeat(64),expectedCollectorSourceSHA256:'b'.repeat(64)};
  assert.throws(()=>createNativeSourceContext({...options,raw:f.raw+' '}),/binding/);
  assert.throws(()=>createNativeSourceContext({...options,normalizedText:'invented words'}),/binding/);
  assert.throws(()=>createNativeSourceContext({...options,expectedCollectorSourceSHA256:'c'.repeat(64)}),/method binding/);
  assert.throws(()=>createNativeSourceContext({...options,expectedTracerSourceSHA256:undefined}),/identities/);
  const trace=traceNativeDecoration(f.raw),unresolved=bindNativeDecoration(trace,{raw:f.raw,normalizedText:f.normalizedText,collectorSegments:[],tracerSourceSHA256:'a'.repeat(64),collectorSourceSHA256:'b'.repeat(64)});
  assert.throws(()=>createNativeSourceContext({...options,envelope:unresolved}),/unresolved/);
  assert.throws(()=>createNativeRepresentation({...f.unit,native_source_decorations_ref:undefined},{context:f.context,parent:f.parent}),/unit reference/);
  assert.throws(()=>createNativeRepresentation({...f.unit,native_source_decorations_ref:{...f.unit.native_source_decorations_ref,collector_policy:'STALE_SYNTHETIC_COLLECTOR_POLICY'}},{context:f.context,parent:f.parent}),/unit reference/);
});

test('parent context and navigation roles cannot invent or extend source scopes',()=>{
  const text=Array.from({length:75},(_,i)=>'word'+i).join(' '),f=nativeFixture('<p>'+text+'</p>',{start:text.indexOf('word70'),end:text.indexOf('word71')-1});
  assert.throws(()=>createNativeRepresentation(f.unit,{context:f.context,parent:f.parent,bodyRange:{start:0,end:f.unit.end}}),/sixty/);
  assert.throws(()=>createNativeRepresentation(f.unit,{context:f.context,parent:{...f.parent,end:f.unit.end-1}}),/parent binding/);
  assert.throws(()=>createNativeRepresentation(f.unit,{context:f.context,parent:f.parent,bodyRange:{start:f.unit.start+1,end:f.unit.end}}),/contain the unit/);
  const stale={...f.unit};delete stale.source_navigation;assert.throws(()=>createNativeRepresentation(stale,{context:f.context,parent:f.parent}),/literal navigation/);
});

test('legacy inputs disclose missing native evidence while current refs can never fall back to flat text',()=>{
  const legacy=modelInputIdentity({id:'legacy',text:'old source text'});assert.equal(legacy.native_evidence_status,LEGACY_NATIVE_STATUS);assert.equal(legacy.input_sha256,sha('old source text'));
  assert.throws(()=>modelInputIdentity({id:'current',text:'old source text',native_source_decorations_ref:{}}),/authenticated native_input/);
});

test('joint whitespace retains both ordered marked origins in each self-contained model window',()=>{
  const raw='<p>Alpha<strike> </strike><u>  </u>Beta</p>',trace=traceNativeDecoration(raw),normalizedText='Alpha Beta';
  assert.deepEqual(trace.runs.map(run=>run.decoded_text),['Alpha',' ','  ','Beta']);
  const source=index=>({run_id:trace.runs[index].id,decoded_start:0,decoded_end:trace.runs[index].decoded_text.length});
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,tracerSourceSHA256:'a'.repeat(64),collectorSourceSHA256:'b'.repeat(64),collectorSegments:[
    {normalized_start:0,normalized_end:5,sources:[source(0)],normalization:'EXACT_DECODED'},
    {normalized_start:5,normalized_end:6,sources:[source(1),source(2)],normalization:'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'},
    {normalized_start:6,normalized_end:10,sources:[source(3)],normalization:'EXACT_DECODED'}
  ]});
  assert.equal(envelope.mapping_status,'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE');
  const context=createNativeSourceContext({raw,normalizedText,envelope,expectedTracerSourceSHA256:'a'.repeat(64),expectedCollectorSourceSHA256:'b'.repeat(64)});
  const parent={id:'synthetic-parent',contract_id:'synthetic-contract',cohort:'discovery-broad',start:0,end:10,sha256:sha(normalizedText)};
  const unit={...parent,id:'synthetic-unit',parent_section_id:parent.id,text:normalizedText,source_navigation:navigation(null),native_source_decorations_ref:{envelope_sha256:envelope.sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,policy:envelope.policy,collector_policy:NATIVE_COLLECTOR_POLICY,start:0,end:10,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,projection_required:true}};
  const representation=createNativeRepresentation(unit,{context,parent}),window=nativeRepresentationWindow(representation,{start:5,end:6});
  assert.equal(representation.descriptor.input_eligibility,'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE');
  assert.equal(window.source_ranges[0].joint_whitespace_witnesses,1);assert.equal(window.source_ranges[0].input_eligibility,envelope.input_eligibility);
  assert.match(window.text,/JOINT_NORMALIZATION_UNVERIFIED/);assert.match(window.text,/"tag":"strike"/);assert.match(window.text,/"tag":"u"/);
  assert.ok(window.text.indexOf('"strike"')<window.text.indexOf('"u"'));assert.match(window.text,/"count":1/);assert.match(window.text,/"count":2/);
  assert.ok(window.text.endsWith('\n '));assert.equal(window.window_annotations_self_contained,true);assert.equal(window.effectiveness_verified,false);
  const forged={...unit,native_source_decorations_ref:{...unit.native_source_decorations_ref,input_eligibility:'EXACT_SOURCE_EVIDENCE'}};
  assert.throws(()=>createNativeRepresentation(forged,{context,parent}),/unit reference/);
});

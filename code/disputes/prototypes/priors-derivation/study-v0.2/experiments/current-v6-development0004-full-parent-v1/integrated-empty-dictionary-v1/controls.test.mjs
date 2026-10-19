// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic fixtures only; exact target IDs/ranges are technical coordinates.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as api from './representation.mjs';
import * as prior from '../representation.mjs';
import * as frozen from '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/representation.mjs';
import {traceNativeDecoration,bindNativeDecoration} from '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/source-decoration.mjs';
import {NATIVE_COLLECTOR_POLICY} from '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/sections.mjs';
import {encodeNativeDictionaryWindow as encode,decodeNativeDictionaryWindow as decode,reconstructDictionaryWindowSource as source,assertUnambiguousSourceText} from './window-dictionary.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex'),started=performance.now(),target=api.FULL_STORED_PARENT_TARGET;
after(()=>{const rss=process.resourceUsage().maxRSS*1024;assert.ok(rss<536870912);console.log(JSON.stringify({schema:'source-free-integrated-empty-dictionary-controls-v1',actual_sources_read:0,tokenizer_calls:0,model_calls:0,elapsed_ms:Math.ceil(performance.now()-started),max_RSS_bytes:rss}));});
function fixture(marker=''){
 let parentText=('word '.repeat(2000)).slice(0,9113);if(marker)parentText=marker+parentText.slice(marker.length);
 const entries=[],exact=text=>{if(text)entries.push({raw:'<span>'+text+'</span>',output:text});},zero=()=>{for(const tag of ['u','s','u'])entries.push({raw:`<${tag}> </${tag}>`,output:''});};
 exact('p'.repeat(target.parent_start));zero();exact(parentText.slice(0,16));
 entries.push({raw:'<u>'+parentText.slice(16,60)+'</u>',output:parentText.slice(16,60)});exact(parentText.slice(60,104));
 // The two differently marked origins collapse to one space, never one chosen mark.
 entries.push({raw:'<u> </u><s>\t</s>',output:parentText[104],joint:true});
 exact(parentText.slice(105,2763));zero();exact(parentText.slice(2763,4505));
 entries.push({raw:'<u> </u>',output:''});exact(parentText.slice(4505));zero();exact(' suffix');
 const raw=entries.map(x=>x.raw).join(''),trace=traceNativeDecoration(raw),normalizedText=entries.map(x=>x.output).join('');let run=0,at=0;
 const segments=entries.map(entry=>{const count=entry.joint?2:1,runs=trace.runs.slice(run,run+count);run+=count;const start=at;at+=entry.output.length;return {normalized_start:start,normalized_end:at,sources:runs.map(r=>({run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length})),normalization:entry.joint?'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1':entry.output?'EXACT_DECODED':'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'};});
 assert.equal(run,trace.runs.length);
 const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:segments,tracerSourceSHA256:'a'.repeat(64),collectorSourceSHA256:'b'.repeat(64)});
 const parent={id:'synthetic-parent',contract_id:target.contract_id,cohort:'synthetic',start:target.parent_start,end:target.parent_end,sha256:sha(parentText)};
 const unit={id:'synthetic-unit',contract_id:parent.contract_id,cohort:parent.cohort,parent_section_id:parent.id,start:target.unit_start,end:target.unit_end,text:normalizedText.slice(target.unit_start,target.unit_end),source_navigation:{scope:'LITERAL_SOURCE_NAVIGATION_ONLY',governing_hierarchy_verified:false,nearest_anchor:null,within_unit:[]}};unit.sha256=sha(unit.text);
 unit.native_source_decorations_ref={envelope_sha256:envelope.sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,policy:envelope.policy,collector_policy:NATIVE_COLLECTOR_POLICY,start:unit.start,end:unit.end,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,projection_required:true};
 const context=mod=>mod.createNativeSourceContext({raw,normalizedText,envelope,expectedTracerSourceSHA256:'a'.repeat(64),expectedCollectorSourceSHA256:'b'.repeat(64)});
 const options=mod=>({context:context(mod),parent,contextScope:mod.FULL_STORED_PARENT_TRIAL,trialAuditId:target.audit_id});
 const representation=(mod=api,dict=true)=>mod.createNativeRepresentation(unit,{...options(mod),...(dict?{windowEncodingScope:api.EMPTY_DICTIONARY_TRIAL}:{})});
 return {raw,parentText,normalizedText,envelope,parent,unit,context,options,representation};
}
const f=fixture();
test('default remains byte-identical to frozen S6 and prior full-parent fork',()=>{
 const current=api.createNativeRepresentation(f.unit,{context:f.context(api),parent:f.parent}),old=frozen.createNativeRepresentation(f.unit,{context:f.context(frozen),parent:f.parent});
 assert.equal(JSON.stringify(current),JSON.stringify(old));
 assert.equal(JSON.stringify(api.nativeRepresentationWindow(current)),JSON.stringify(frozen.nativeRepresentationWindow(old)));
 assert.deepEqual(api.modelInputIdentity({...f.unit,native_input:current}),frozen.modelInputIdentity({...f.unit,native_input:old}));
 const legacy=f.representation(prior,false),unchanged=f.representation(api,false);assert.equal(JSON.stringify(unchanged),JSON.stringify(legacy));
 assert.equal(JSON.stringify(api.nativeRepresentationWindow(unchanged)),JSON.stringify(prior.nativeRepresentationWindow(legacy)));
});
test('exact full-parent opt-in has distinct representation/input identities and unchanged source',()=>{
 const rep=f.representation(),plain=f.representation(api,false);
 assert.equal(rep.text,f.parentText);assert.equal(rep.text.slice(2763,4505),f.unit.text);
 assert.notEqual(rep.input_sha256,plain.input_sha256);assert.equal(rep.descriptor.policy,api.EMPTY_DICTIONARY_REPRESENTATION_POLICY);
 assert.equal(rep.descriptor.input_policy,api.DICTIONARY_WINDOW_POLICY);assert.equal(rep.descriptor.dictionary_model_interpretation_verified,false);
 assert.equal(rep.descriptor.authority,'NONE');assert.equal(rep.descriptor.semantic_sufficiency_verified,false);
 assert.throws(()=>api.createNativeRepresentation(f.unit,{context:f.context(api),parent:f.parent,windowEncodingScope:api.EMPTY_DICTIONARY_TRIAL}),/explicit exact/);
 assert.throws(()=>api.createNativeRepresentation(f.unit,{...f.options(api),windowEncodingScope:'other'}),/Unknown/);
 assert.throws(()=>api.createNativeRepresentation(f.unit,{...f.options(api),windowEncodingScope:api.EMPTY_DICTIONARY_TRIAL,trialAuditId:'other'}),/restricted/);
 assert.throws(()=>api.createNativeRepresentation(f.unit,{...f.options(api),windowEncodingScope:api.EMPTY_DICTIONARY_TRIAL,bodyRange:f.unit}),/complete original/);
 assert.throws(()=>api.createNativeRepresentation(f.unit,{...f.options(api),context:f.context(prior),windowEncodingScope:api.EMPTY_DICTIONARY_TRIAL}),/Authenticated/);
});
test('complete synthetic parent round-trips the entire serialized window byte for byte',()=>{
 const encoded=api.nativeRepresentationWindow(f.representation()),original=prior.nativeRepresentationWindow(f.representation(prior,false));
 assert.equal(JSON.stringify(decode(encoded)),JSON.stringify(original));assert.equal(source(encoded),f.parentText);
 assert.deepEqual(encoded.source_ranges,original.source_ranges);assert.equal(encoded.empty_native_dictionary.original_window_sha256,sha(JSON.stringify(original)));
 assert.equal(encoded.empty_native_dictionary.clusters,3);assert.equal(encoded.empty_native_dictionary.empty_annotation_groups,9);
 assert.ok(encoded.text.includes('JOINT_NORMALIZATION_UNVERIFIED'));assert.ok(encoded.text.includes(f.parentText.slice(16,60)));
 assert.ok(encoded.text.length<original.text.length);assert.equal(encoded.sha256,sha(encoded.text));
});
test('each disjoint and overlapping window carries its own dictionary and exact terminal ownership',()=>{
 const integrated=f.representation(),plain=f.representation(prior,false),ranges=[[0,2763],[2763,9113],[0,105],[16,4505],[2763,4505],[4505,9113],[9112,9113]];
 for(const [start,end] of ranges){const result=api.nativeRepresentationWindow(integrated,{start,end}),original=prior.nativeRepresentationWindow(plain,{start,end});assert.equal(JSON.stringify(decode(result)),JSON.stringify(original));assert.equal(source(result),f.parentText.slice(start,end));assert.equal(result.source_ranges[0].include_end_zero_width,end===9113);}
 const left=api.nativeRepresentationWindow(integrated,{start:0,end:2763}),right=api.nativeRepresentationWindow(integrated,{start:2763,end:9113});
 assert.equal(left.empty_native_dictionary.empty_annotation_groups,3);assert.equal(right.empty_native_dictionary.empty_annotation_groups,6);
 assert.throws(()=>api.nativeRepresentationWindow(integrated,{start:1,end:1}),/UTF16/);assert.throws(()=>api.nativeRepresentationWindow(integrated,{start:0,end:9114}),/UTF16/);
 assert.throws(()=>api.nativeRepresentationWindow({...integrated}),/Authenticated/);
});
const wrap=(m,text='')=>'\n[NATIVE_SOURCE_MARKS_UNVERIFIED '+JSON.stringify(m)+']\n'+text+'\n[/NATIVE_SOURCE_MARKS_UNVERIFIED]\n';
const a=[{tag:'u',future:{literal:'[NATIVE_SOURCE_MARKS_UNVERIFIED metadata only',events:['x','x']}}],b=[{tag:'s'}];
const window=text=>({text,representation_start:0,representation_end:1,source_ranges:[{encoded_sha256:sha(text),future:['ordered','ordered']}],input_policy:'ORIGINAL_SYNTHETIC',mapping_status:'EXACT_COLLECTOR_ORIGIN',sha256:sha(text),future:{duplicates:[1,1,2]}});
test('nonempty native payloads, joint wrappers and arbitrary metadata stay exact across multiple clusters',()=>{
 const joint='\n[JOINT_NORMALIZATION_UNVERIFIED '+JSON.stringify({origins:[{marks:a}],unknown:['𝒳','𝒳']})+']\n[/JOINT_NORMALIZATION_UNVERIFIED]\n';
 const original=window(wrap(a)+wrap(b)+wrap(a,'𝒳é')+joint+' '+wrap(b)+wrap(b)+'Z'),encoded=encode(original,{sourceText:'𝒳é Z'});
 assert.equal(JSON.stringify(decode(encoded)),JSON.stringify(original));assert.equal(source(encoded),'𝒳é Z');assert.ok(encoded.text.includes(wrap(a,'𝒳é')));assert.ok(encoded.text.includes(joint));assert.deepEqual(encoded.future,original.future);
});
test('single empty groups remain literal and no-group windows round-trip without changing source',()=>{
 for(const [text,src] of [[wrap(a)+'source','source'],['𝒳 no annotation','𝒳 no annotation']]){const original=window(text),encoded=encode(original,{sourceText:src});assert.equal(encoded.text,text);assert.equal(encoded.empty_native_dictionary.clusters,0);assert.equal(JSON.stringify(decode(encoded)),JSON.stringify(original));}
});
test('planner metadata cannot silently change the pinned original serialized window',()=>{
 const rep=f.representation(),pure=api.nativeRepresentationWindow(rep,{start:0,end:2763});
 assert.throws(()=>decode({...pure,weight:1,source_start:0,native_planner_work:{calls:1}}),/SERIALIZED_RECONSTRUCTION/);
 const regenerated=api.nativeRepresentationWindow(rep,{start:0,end:2763});
 assert.equal(regenerated.text,pure.text);assert.equal(regenerated.sha256,pure.sha256);assert.deepEqual(regenerated.source_ranges,pure.source_ranges);
 assert.equal(JSON.stringify(decode(regenerated)),JSON.stringify(prior.nativeRepresentationWindow(f.representation(prior,false),{start:0,end:2763})));
});
test('reserved marker ambiguity is rejected in source, including partial and closing spellings',()=>{
 for(const marker of ['[NATIVE_SOURCE_MARKS_UNVERIFIED','[/NATIVE_SOURCE_MARKS_UNVERIFIED','[JOINT_NORMALIZATION_UNVERIFIED','[/JOINT_NORMALIZATION_UNVERIFIED','[NATIVE_EMPTY_DICTIONARY_V1']){assert.throws(()=>assertUnambiguousSourceText(marker),/RESERVED/);assert.throws(()=>encode(window('text'),{sourceText:marker}),/RESERVED/);}
 const ambiguous=fixture('[NATIVE_EMPTY_DICTIONARY_V1');assert.throws(()=>ambiguous.representation(),/RESERVED/);
 assert.doesNotThrow(()=>ambiguous.representation(api,false));
});
test('malformed, noncanonical, nonempty-cluster, tampered and oversized inputs fail as complete windows',()=>{
 for(const text of [wrap(a).replace('[{','[ {'),wrap(a).replace('"u"','"\\u0075"'),wrap(a).slice(0,-2),wrap(a)+'[/NATIVE_SOURCE_MARKS_UNVERIFIED',wrap(a).replace(JSON.stringify(a),'[null]'),'\n[JOINT_NORMALIZATION_UNVERIFIED {}]\nwrong'])assert.throws(()=>encode(window(text),{sourceText:''}));
 assert.throws(()=>encode(window(wrap(a).repeat(65)),{sourceText:''}),/BOUND/);assert.throws(()=>encode(window('x'.repeat(1048577)),{sourceText:''}),/BOUND/);
 assert.throws(()=>encode(window(wrap([{style_literal:'x'.repeat(2100)}]).repeat(2)),{sourceText:''}),/BOUND/);
 assert.throws(()=>encode(window('x'),{sourceText:'different'}),/RECONSTRUCTION/);
 const encoded=encode(window(wrap(a)+wrap(b)+'X'),{sourceText:'X'});
 for(const change of [e=>e.text+='x',e=>e.source_ranges[0].future.push('changed'),e=>e.empty_native_dictionary.clusters++,e=>e.empty_native_dictionary.original_input_policy='changed',e=>e.empty_native_dictionary.extra=true,e=>e.text=e.text.replace('NATIVE_EMPTY_DICT_V1_UNADOPTED','OTHER')]){const copy=structuredClone(encoded);change(copy);assert.throws(()=>decode(copy));}
});

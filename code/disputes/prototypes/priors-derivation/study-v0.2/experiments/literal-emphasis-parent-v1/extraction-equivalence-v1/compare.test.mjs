// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE: fictional JSON/native references, never a corpus or runtime attestation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {SOURCE_FILES,CHANGED_FILES,CACHE_MASK,digest,validateSourceTransition,compareNativeReferences,compareDecodedCaches,validateReceipt,verifyCacheEncoding,compareManifestHeader,compareContractRecords,validateLimits,checkSample,checkOutputBudget,forecastRemainingReads} from './compare.mjs';
const H=v=>createHash('sha256').update(v).digest('hex'),copy=v=>JSON.parse(JSON.stringify(v)),J=v=>JSON.stringify(v,null,2)+'\n',seal=v=>({...v,sha256:digest(v)});
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);
function sources(){
  const body={parameters:{extraction:{contextWords:60},native_input_profile:{baseline_embedding:{max_tokens:256}},selection_seed:'SOURCE_FREE'},files:SOURCE_FILES.map(path=>({path,sha256:H('OLD:'+path)})),runtime:{node:'SOURCE_FREE',platform:'linux',architecture:'x64'}};
  const oldSource=seal(body),next=copy(body);for(const f of next.files)if(CHANGED_FILES.includes(f.path))f.sha256=H('NEW:'+f.path);const newSource=seal(next);
  const expected={old_sha256:oldSource.sha256,new_sha256:newSource.sha256,changes:Object.fromEntries(CHANGED_FILES.map(path=>[path,[oldSource.files.find(f=>f.path===path).sha256,newSource.files.find(f=>f.path===path).sha256]]))};return {oldSource,newSource,expected};
}
function fixture(){
  const pair=sources(),id='contract-00000000000000000001',text='Conditional introduction: permission is required during the term.\n\n'+('Earlier separate item. '.repeat(80))+'\n\nSelected focal item; separate counsel consent applies.\n\nLater qualification unless the stated exception applies.';
  const rawSHA=H('FICTIONAL_RAW'),normSHA=H(text);
  const native=source=>seal({schema:'native-source-decoration-reference-v1',storage_policy:'LOSSLESS_GZIP_FULL_NATIVE_ENVELOPE_ONCE_PER_CONTRACT_V1',envelope_sha256:H('FICTIONAL_ENVELOPE'),raw_sha256:rawSHA,normalized_sha256:normSHA,tracer_source_sha256:source.files[1].sha256,collector_source_sha256:source.files[0].sha256,method_identity_status:'CURRENT_METHOD_BINDINGS_SUPPLIED',policy:'SOURCE_FREE_NATIVE',mapping_status:'EXACT_COLLECTOR_ORIGIN',input_eligibility:'EXACT_SOURCE_EVIDENCE',uncompressed_bytes:400,uncompressed_sha256:H('FICTIONAL_UNCOMPRESSED'),artifact:{path:`native-decorations/${source.sha256.slice(0,16)}/${id}.json.gz`,bytes:123,sha256:H('FICTIONAL_GZIP')},authority:'NONE'});
  const body={contract:{id,cohort:'discovery-broad'},status:'accepted',raw_sha256:rawSHA,normalized_text:text,normalized_sha256:normSHA,sections:[{id:'parent',start:0,end:text.length,text,units:[{id:'focal',text:'Selected focal item',start:text.indexOf('Selected focal item'),source_navigation:{nearest_anchor:{label:'Unverified caption'}}}],governor_frames:[{start:0,end:70,boundary_verified:false}]}],units:[{id:'focal',parent_section_id:'parent',text:'Selected focal item',warnings:[{code:'CHUNK_IN_COMPLETE_SECTION'}]}],excluded:[{reason:'hidden_html_excluded',count:1}],warnings:[{code:'UNKNOWN_HEADING_STRUCTURE_RETAINED'}],parameters:{contextWords:60},source_dependencies:{image_body:null}};
  const a={...copy(body),source:pair.oldSource,native_source_decorations:native(pair.oldSource)},b={...copy(body),source:pair.newSource,native_source_decorations:native(pair.newSource)};
  return {...pair,id,a,b,options:{id,oldSource:pair.oldSource,newSource:pair.newSource}};
}
function receipt(value){const plain=Buffer.from(J(value)),encoded=gzipSync(plain,{level:6});return {id:value.contract.id,path:`extraction-cache/${value.source.sha256.slice(0,16)}/${value.contract.id}.json.gz`,sha256:H(encoded),bytes:encoded.length,storage:{schema:'lossless-gzip-extraction-cache-v1',encoding:'gzip',serializer:'UTF8_JSON_STRINGIFY_PRETTY_2_FINAL_LF_V1',decoded_bytes:plain.length,decoded_sha256:H(plain)},raw_sha256:value.raw_sha256,source_sha256:value.source.sha256,result_sha256:digest(value)};}
function reseal(value){const{sha256,...body}=value;return seal(body);}

test('SOURCE_FREE exact23 identities permit exactly the three predeclared file transitions',()=>{
  const f=sources();assert.equal(validateSourceTransition(f.oldSource,f.newSource,f.expected),true);assert.equal(SOURCE_FILES.length,23);assert.deepEqual(CACHE_MASK,['/source/files/8/sha256','/source/files/11/sha256','/source/files/12/sha256','/source/sha256','/native_source_decorations/artifact/path','/native_source_decorations/sha256']);
  const changed=copy(f.newSource);changed.files[0].sha256=H('UNDECLARED');const s=reseal(changed);rejects(()=>validateSourceTransition(f.oldSource,s,{...f.expected,new_sha256:s.sha256}),'SOURCE_UNEXPECTED_FILE_CHANGE');
  const reordered=copy(f.newSource);[reordered.files[0],reordered.files[1]]=[reordered.files[1],reordered.files[0]];rejects(()=>validateSourceTransition(f.oldSource,reseal(reordered),f.expected),'SOURCE_FILE_ORDER');
  const bad=copy(f.newSource);bad.sha256=H('WRONG_SEAL');rejects(()=>validateSourceTransition(f.oldSource,bad,f.expected),'SOURCE_SEAL');
});
test('SOURCE_FREE runtime and parameters are immutable despite otherwise valid new seals',()=>{
  const f=sources();for(const field of ['parameters','runtime']){const b=copy(f.newSource);b[field].unexpected=true;const s=reseal(b);rejects(()=>validateSourceTransition(f.oldSource,s,{...f.expected,new_sha256:s.sha256}),field==='parameters'?'SOURCE_PARAMETERS':'SOURCE_RUNTIME');}
  const changed=copy(f.newSource);changed.files[8].sha256=H('UNAPPROVED_NEW_EMBEDDING');const s=reseal(changed);rejects(()=>validateSourceTransition(f.oldSource,s,{...f.expected,new_sha256:s.sha256}),'SOURCE_CHANGED_PIN');
});
test('SOURCE_FREE entire long-list source and all nested evidence survive the six-field cache mask',()=>{
  const f=fixture();const row=compareDecodedCaches(f.a,f.b,f.options);assert.equal(row.cache_decoded_bytes,Buffer.byteLength(J(f.a)));assert.equal(Buffer.byteLength(J(f.a)),Buffer.byteLength(J(f.b)));assert.equal(row.normalized_utf16_length,f.a.normalized_text.length);assert.equal(f.a.sections[0].text,f.a.normalized_text);
  const mutations=[x=>{x.sections[0].text+=' OMITTED';},x=>{x.sections[0].governor_frames[0].end++;},x=>{x.sections[0].units[0].source_navigation.nearest_anchor.label='Changed';},x=>{x.units[0].warnings=[];},x=>{x.excluded[0].reason='other';},x=>{x.source_dependencies.image_body={unknown:true};},x=>{x.status='rejected';},x=>{x.unexpected_field=true;}];
  for(const mutate of mutations){const b=copy(f.b);mutate(b);rejects(()=>compareDecodedCaches(f.a,b,f.options),'CACHE_UNEXPECTED_CONTENT_CHANGE');}
});
test('SOURCE_FREE native reference only changes exact path and recomputed seal',()=>{
  const f=fixture(),a=f.a.native_source_decorations,b=f.b.native_source_decorations;assert.equal(compareNativeReferences(a,b,f.options),true);
  const path=copy(b);path.artifact.path=path.artifact.path.replace(f.id,'contract-00000000000000000002');rejects(()=>compareNativeReferences(a,reseal(path),f.options),'NATIVE_EXACT_PATH');
  const collector=copy(b);collector.collector_source_sha256=H('CHANGED_COLLECTOR');rejects(()=>compareNativeReferences(a,reseal(collector),f.options),'NATIVE_CONTENT_OR_IDENTITY');
  const encoded=copy(b);encoded.artifact.bytes++;rejects(()=>compareNativeReferences(a,reseal(encoded),f.options),'NATIVE_WHOLE_GZIP');
  const uncompressed=copy(b);uncompressed.uncompressed_bytes++;rejects(()=>compareNativeReferences(a,reseal(uncompressed),f.options),'NATIVE_CONTENT_OR_IDENTITY');
  const broken=copy(b);broken.sha256=H('NOT_ITS_SEAL');rejects(()=>compareNativeReferences(a,broken,f.options),'NATIVE_REF_SEAL');
});
test('SOURCE_FREE cache normalization and receipt lengths/hashes are derived, never ignored',()=>{
  const f=fixture();for(const value of [f.a,f.b])assert.equal(validateReceipt(receipt(value),value,{id:f.id,source:value.source}),true);
  const r=receipt(f.b);r.storage.decoded_bytes++;rejects(()=>validateReceipt(r,f.b,{id:f.id,source:f.newSource}),'CACHE_RECEIPT_SERIALIZATION');
  const wrong=receipt(f.b);wrong.source_sha256=f.oldSource.sha256;rejects(()=>validateReceipt(wrong,f.b,{id:f.id,source:f.newSource}),'CACHE_RECEIPT_IDENTITY');
  const b=copy(f.b);b.normalized_sha256=H('CHANGED_SOURCE');rejects(()=>compareDecodedCaches(f.a,b,f.options),'CACHE_UNEXPECTED_CONTENT_CHANGE');
  const a=copy(f.a),c=copy(f.b);a.normalized_sha256=c.normalized_sha256=H('WRONG_BUT_SAME');a.native_source_decorations.normalized_sha256=c.native_source_decorations.normalized_sha256=a.normalized_sha256;a.native_source_decorations=reseal(a.native_source_decorations);c.native_source_decorations=reseal(c.native_source_decorations);rejects(()=>compareDecodedCaches(a,c,f.options),'CACHE_SOURCE_BINDING');
});
test('SOURCE_FREE source-defined gzip verifies the real encoded length and all compressed bytes',async()=>{
  const f=fixture(),r=receipt(f.b);assert.equal(await verifyCacheEncoding(r,f.b),true);
  await assert.rejects(verifyCacheEncoding({...r,bytes:r.bytes+1},f.b),e=>e.code==='CACHE_SOURCE_DEFINED_GZIP');
  await assert.rejects(verifyCacheEncoding({...r,sha256:H('OTHER_ENCODED')},f.b),e=>e.code==='CACHE_SOURCE_DEFINED_GZIP');
});
test('SOURCE_FREE fixed manifest population/order and accounting are independently frozen',()=>{
  const f=fixture(),ids=Array.from({length:994},(_,i)=>'contract-'+i.toString(16).padStart(20,'0')),accounting={method:'SOURCE_FREE_EXACT_ACCOUNTING'};
  const base={schema_version:2,status:'EXTRACTION_RESEARCH_ONLY',contracts:994,accepted:937,rejected:57,requested_contracts:1000,missing_contracts:Array.from({length:6},(_,i)=>({id:'missing-'+i})),selected_prefix_terminal_complete:true,input_snapshot:{available:ids},input_sha256:H('SAME_INPUT'),cache:ids.map(id=>({id})),contract_records:ids.map(id=>({id})),shards:{units:[],sections:[],exclusions:[]},authority:'NONE'};
  const a={...copy(base),source:f.oldSource},b={...copy(base),source:f.newSource,storage_accounting:accounting},options={oldSource:f.oldSource,newSource:f.newSource,accounting};assert.equal(compareManifestHeader(a,b,options),true);
  const old=copy(a);old.storage_accounting=null;rejects(()=>compareManifestHeader(old,b,options),'OLD_ACCOUNTING_MUST_BE_ABSENT');
  const changed=copy(b);changed.storage_accounting={other:true};rejects(()=>compareManifestHeader(a,changed,options),'NEW_ACCOUNTING');
  const order=copy(b);[order.cache[0],order.cache[1]]=[order.cache[1],order.cache[0]];rejects(()=>compareManifestHeader(a,order,options),'MANIFEST_CONTRACT_ORDER');
  const extra=copy(b);extra.unexpected=true;rejects(()=>compareManifestHeader(a,extra,options),'MANIFEST_HEADER_CHANGE');
  const missing=copy(b);missing.cache.pop();rejects(()=>compareManifestHeader(a,missing,options),'MANIFEST_994');
});
test('SOURCE_FREE contract records allow only reference relocation and accepted normalized path',()=>{
  const f=fixture(),common={id:f.id,status:'accepted',normalized_sha256:f.a.normalized_sha256,sections:1,selected_units:1,coverage:[{available_units:1}]},a={...common,native_source_decorations:f.a.native_source_decorations,normalized_path:`normalized/${f.oldSource.sha256.slice(0,16)}/${f.id}.txt`},b={...copy(common),native_source_decorations:f.b.native_source_decorations,normalized_path:`normalized/${f.newSource.sha256.slice(0,16)}/${f.id}.txt`};assert.equal(compareContractRecords(a,b,f.options),true);
  const wrong=copy(b);wrong.normalized_path=wrong.normalized_path.replace(f.id,'other');rejects(()=>compareContractRecords(a,wrong,f.options),'NORMALIZED_PATH');
  const count=copy(b);count.selected_units++;rejects(()=>compareContractRecords(a,count,f.options),'CONTRACT_RECORD_CHANGE');
  const rejectedA={id:f.id,status:'rejected',native_source_decorations:f.a.native_source_decorations},rejectedB={id:f.id,status:'rejected',native_source_decorations:f.b.native_source_decorations};assert.equal(compareContractRecords(rejectedA,rejectedB,f.options),true);rejectedB.normalized_path='invented';rejects(()=>compareContractRecords(rejectedA,rejectedB,f.options),'REJECTED_NORMALIZED_PATH');
});
test('SOURCE_FREE resource samples accept equality and reject each independent cap and invalid limits',()=>{
  const limits={phase_ms:1200000,heap_bytes:1024**3,rss_bytes:3*1024**3,QA_bytes:4*1024**2,read_bytes:4*1024**3};assert.equal(validateLimits(limits),true);
  const sample={elapsed_ms:limits.phase_ms,rss_bytes:limits.rss_bytes,heap_used_bytes:limits.heap_bytes,read_bytes:limits.read_bytes};assert.equal(checkSample(limits,sample),true);
  for(const [key,code]of [['elapsed_ms','PHASE_CAP'],['rss_bytes','RSS_CAP'],['heap_used_bytes','HEAP_USED_CAP'],['read_bytes','READ_CAP']])rejects(()=>checkSample(limits,{...sample,[key]:sample[key]+1}),code);
  rejects(()=>checkSample(limits,{...sample,elapsed_ms:-1}),'PHASE_CAP');rejects(()=>validateLimits({...limits,phase_ms:1200001}),'LIMITS');rejects(()=>validateLimits({...limits,heap_bytes:1024**3+1}),'LIMITS');
});
test('SOURCE_FREE QA terminal reserve is charged once and remains usable for a compact failure',()=>{
  const cap=4*1024**2;assert.equal(checkOutputBudget(cap-32769,1,cap),true);rejects(()=>checkOutputBudget(cap-32768,1,cap),'QA_CAP');assert.equal(checkOutputBudget(cap-32768,32768,cap,{terminal:true}),true);rejects(()=>checkOutputBudget(cap-32768,32769,cap,{terminal:true}),'QA_CAP');
  const f=fixture(),a=receipt(f.a),b=receipt(f.b),forecast=forecastRemainingReads([{cache:[a],contract_records:[{native_source_decorations:f.a.native_source_decorations}]},{cache:[b],contract_records:[{native_source_decorations:f.b.native_source_decorations}]}]);assert.equal(forecast.explicit_file_bytes,a.bytes+b.bytes+2*Buffer.byteLength(J(a))+2*Buffer.byteLength(J(b))+246);assert.equal(forecast.cache_reader_sentinel_budget_bytes,4);assert.equal(forecast.decoded_cache_payload_bytes,a.storage.decoded_bytes+b.storage.decoded_bytes);assert.equal(forecast.gzip_reencoded_input_bytes,forecast.decoded_cache_payload_bytes);
});

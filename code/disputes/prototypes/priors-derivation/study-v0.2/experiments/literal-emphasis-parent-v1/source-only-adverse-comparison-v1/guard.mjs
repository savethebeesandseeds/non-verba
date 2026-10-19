// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE. Pure metadata denial checks; no permit, IO, fixture bypass or model entry.
import {digest,sha} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {checkedFocal} from '../next-stage-v1/focal-selection.mjs';
import {validateTypedCaseRoster} from '../typed-case-roster-v1/roster.mjs';
import {RUN,SOURCE,LIMITS,COMPARISON_REFS as REFS,COMPARISON_CASES as CASES,FAILED_AVAILABLE,CACHE_RESULT_SHA256S} from './fixed-cases.mjs';
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});},same=(a,b)=>digest(a)===digest(b);
const names=['preflight','ids','guard','projection','legacy_plan','summary','roster','origin'];
const sealed=v=>{const{sha256,...body}=v??{};return typeof sha256==='string'&&/^[a-f0-9]{64}$/u.test(sha256)&&digest(body)===sha256;};
function exactKeys(v,keys,c){check(v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value')),c);}
function one(rows,predicate,c){check(Array.isArray(rows),c);const found=rows.filter(predicate);check(found.length===1,c);return found[0];}
function relative(file){check(typeof file==='string'&&file.startsWith(RUN+'/'),'COMPARISON_RUN_PATH');return file.slice(RUN.length+1);}
const absolute=ref=>({...ref,path:RUN+'/'+ref.path});

function completeGuard(guard,cid){
  check(guard?.schema==='stored-reader-complete-fresh100-guard-v1'&&guard.source_epoch_sha256===REFS.metadata_source_epoch_ref.sha256&&same(guard.fresh_packet_ref,REFS.relative_fresh_ref)&&Array.isArray(guard.rows)&&guard.rows.length===100&&Array.isArray(guard.contract_ids)&&guard.contract_ids.length===29,'COMPARISON_COMPLETE_FRESH_GUARD');
  const audits=new Set(),ids=new Set();
  for(const r of guard.rows){exactKeys(r,['audit_id','contract_id'],'COMPARISON_FRESH_ROW');check(typeof r.audit_id==='string'&&r.audit_id.length>0&&r.audit_id.length<=256&&typeof r.contract_id==='string'&&r.contract_id.length>0&&r.contract_id.length<=256&&!audits.has(r.audit_id),'COMPARISON_FRESH_ROW');audits.add(r.audit_id);ids.add(r.contract_id);}
  const{projection_sha256,...body}=guard;
  check(digest(body)===projection_sha256&&ids.size===29&&same([...ids].sort(),guard.contract_ids),'COMPARISON_FRESH_SEAL');
  check(!ids.has(cid),'COMPARISON_PROTECTED_CONTRACT');
}

/** A self-sealed fictional guard is usable by pure denial controls only. Main
 * validation additionally authenticates all eight pinned documents and joins
 * this entire guard to their preflight/projection. No authority is minted. */
export function checkComparisonCaseMetadata({row,selected,guard,refs,ordered_index}){
  const binding=CASES.find(c=>c.audit_id===selected?.audit_id);
  check(binding&&ordered_index===binding.ordered_index&&selected.contract_id===binding.contract_id&&selected.case_id===binding.case_id&&selected.case_kind==='AVAILABLE_FOCAL'&&selected.selection_role==='MANDATORY'&&selected.stratum===null,'COMPARISON_FIXED_CASE');
  checkedFocal(row,{fixture:false});
  check(row.audit_id===binding.audit_id&&row.contract_id===binding.contract_id&&row.source_sha256===SOURCE&&same(selected.focal,row),'COMPARISON_SELECTED_ROW');
  const f=binding.focal,p=binding.parent;
  check(row.focal_kind==='ACTUAL_UNIT'&&row.focal_start===f.start&&row.focal_end===f.end&&row.focal_sha256===f.sha256&&row.parent_id===p.id&&row.parent_start===p.start&&row.parent_end===p.end&&row.parent_sha256===p.sha256&&row.focal_id!==row.parent_id&&row.focal_start>=row.parent_start&&row.focal_end<=row.parent_end&&(row.focal_start>row.parent_start||row.focal_end<row.parent_end),'COMPARISON_FIXED_GEOMETRY');
  check(digest(row)===binding.row_canonical_sha256,'COMPARISON_CANONICAL_ROW');
  completeGuard(guard,binding.contract_id);
  exactKeys(refs,['raw','normalized','cache','receipt','native'],'COMPARISON_FIVE_REFS');
  check(same(refs,binding.source_refs),'COMPARISON_PAYLOAD_REF_SUBSTITUTION');
  check(row.raw_path===relative(refs.raw.path)&&row.raw_sha256===refs.raw.sha256&&row.raw_bytes===refs.raw.bytes&&row.normalized_path===relative(refs.normalized.path)&&row.normalized_sha256===refs.normalized.sha256&&row.cache_path===relative(refs.cache.path)&&row.cache_sha256===refs.cache.sha256&&row.cache_bytes===refs.cache.bytes&&row.cache_receipt_sha256===refs.receipt.sha256,'COMPARISON_ROW_REFS');
  check(binding.cache_storage.decoded_bytes+binding.native_storage.decoded_bytes+refs.raw.bytes+refs.normalized.bytes===binding.declared_combined_decoded_input_bytes&&binding.declared_combined_decoded_input_bytes<=LIMITS.combined_decoded_input_bytes&&refs.raw.bytes<=LIMITS.raw_bytes&&refs.normalized.bytes<=LIMITS.decoded_characters&&Object.values(refs).every(r=>r.bytes<=LIMITS.compressed_output_bytes),'COMPARISON_DECLARED_RESOURCE_BOUND');
  return immutableCopy({row,selected,guard,refs,binding});
}

function manifestCase(manifest,row,binding,index){
  const cache=one(manifest.cache,r=>r.id===row.contract_id,'COMPARISON_MANIFEST_CACHE'),record=one(manifest.contract_records,r=>r.id===row.contract_id,'COMPARISON_MANIFEST_CONTRACT'),native=record.native_source_decorations;
  check(same(absolute({path:cache.path,sha256:cache.sha256,bytes:cache.bytes}),binding.source_refs.cache)&&cache.raw_sha256===row.raw_sha256&&cache.source_sha256===SOURCE&&cache.result_sha256===CACHE_RESULT_SHA256S[index]&&cache.storage?.schema==='lossless-gzip-extraction-cache-v1'&&cache.storage.encoding==='gzip'&&cache.storage.serializer==='UTF8_JSON_STRINGIFY_PRETTY_2_FINAL_LF_V1'&&cache.storage.decoded_bytes===binding.cache_storage.decoded_bytes&&cache.storage.decoded_sha256===binding.cache_storage.decoded_sha256,'COMPARISON_CACHE_IDENTITY');
  check(record.status==='accepted'&&record.raw_sha256===row.raw_sha256&&record.normalized_path===row.normalized_path&&record.normalized_sha256===row.normalized_sha256,'COMPARISON_MANIFEST_IDENTITY');
  check(sealed(native)&&native.schema==='native-source-decoration-reference-v1'&&native.storage_policy==='LOSSLESS_GZIP_FULL_NATIVE_ENVELOPE_ONCE_PER_CONTRACT_V1'&&native.sha256===row.native_reference_sha256&&native.sha256===binding.native_reference_sha256&&native.envelope_sha256===binding.native_envelope_sha256&&native.raw_sha256===row.raw_sha256&&native.normalized_sha256===row.normalized_sha256&&same(absolute(native.artifact),binding.source_refs.native)&&native.uncompressed_bytes===binding.native_storage.decoded_bytes&&native.uncompressed_sha256===binding.native_storage.decoded_sha256,'COMPARISON_NATIVE_REFERENCE');
}

function retainedBoundFailure(typedRoster,projection,manifest,guard){
  const f=FAILED_AVAILABLE[0],selected=typedRoster.ordered_cases[f.ordered_index],row=projection.rows[f.projection_row_index];
  check(selected&&row&&selected.audit_id===f.audit_id&&selected.contract_id===f.contract_id&&selected.case_id===f.case_id&&selected.case_kind==='AVAILABLE_FOCAL'&&selected.selection_role==='MANDATORY'&&selected.stratum===null&&same(selected.focal,row)&&digest(row)===f.row_canonical_sha256,'COMPARISON_RETAINED_AVAILABLE_IDENTITY');
  checkedFocal(row,{fixture:false});completeGuard(guard,f.contract_id);
  const first=typedRoster.ordered_cases.find(c=>c.case_kind==='AVAILABLE_FOCAL'&&c.focal.focal_start>=c.focal.parent_start&&c.focal.focal_end<=c.focal.parent_end&&(c.focal.focal_start>c.focal.parent_start||c.focal.focal_end<c.focal.parent_end));
  check(first===selected&&row.focal_kind==='ACTUAL_UNIT','COMPARISON_FIRST_STRICT_SUBSET');
  const cache=one(manifest.cache,c=>c.id===f.contract_id,'COMPARISON_RETAINED_CACHE'),record=one(manifest.contract_records,c=>c.id===f.contract_id,'COMPARISON_RETAINED_CONTRACT'),native=record.native_source_decorations;
  check(record.status==='accepted'&&record.raw_sha256===row.raw_sha256&&record.normalized_sha256===row.normalized_sha256&&cache.source_sha256===SOURCE&&cache.path===row.cache_path&&cache.sha256===row.cache_sha256&&cache.bytes===row.cache_bytes&&cache.storage?.decoded_bytes===f.cache_decoded_bytes&&sealed(native)&&native.sha256===row.native_reference_sha256&&native.raw_sha256===row.raw_sha256&&native.normalized_sha256===row.normalized_sha256&&native.uncompressed_bytes===f.native_decoded_bytes&&row.raw_bytes===f.raw_bytes,'COMPARISON_RETAINED_BOUND_METADATA');
  const total=f.cache_decoded_bytes+f.native_decoded_bytes+f.raw_bytes+f.normalized_bytes;
  check(total===f.declared_combined_decoded_input_bytes&&total>LIMITS.combined_decoded_input_bytes&&total-LIMITS.combined_decoded_input_bytes===f.excess_decoded_bytes&&f.cache_decoded_bytes+f.native_decoded_bytes>LIMITS.combined_decoded_input_bytes,'COMPARISON_RETAINED_BOUND');
  return FAILED_AVAILABLE;
}

/** Exact prospective two-case policy array only; old0045/0089/0172 and arbitrary
 * caller IDs never enter the allowed cases. ROOT authenticates the supplied
 * manifest/development buffers before this pure validation; no excerpts or
 * protected fresh words are inspected here. */
export function validateComparisonMetadata({bindings,input,typedRoster,manifest,development}){
  const b=immutableCopy(bindings);check(same(b,CASES),'COMPARISON_PINNED_BINDINGS');
  validateTypedCaseRoster(typedRoster,input,{fixture:false});
  const typedBytes=Buffer.from(JSON.stringify(typedRoster,null,2)+'\n');
  check(sha(typedBytes)===REFS.typed_roster_ref.sha256&&typedBytes.length===REFS.typed_roster_ref.bytes,'COMPARISON_TYPED_ROSTER_FILE');
  const documents={};exactKeys(input,names,'COMPARISON_EIGHT_INPUTS');
  for(const name of names){const entry=input[name],expected=REFS.metadata_inputs[name];check(same(entry.ref,typedRoster.input_refs[name])&&entry.ref.sha256===expected.sha256&&entry.ref.bytes===expected.bytes&&expected.path.endsWith('/'+entry.ref.path),'COMPARISON_METADATA_REF');documents[name]=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(entry.bytes));}
  const pre=documents.preflight,projection=documents.projection,guard=documents.guard;
  check(same(absolute(pre.bindings.manifest),REFS.current_manifest_ref)&&same(absolute(pre.bindings.development),REFS.development_ref)&&same(absolute(pre.bindings.fresh),REFS.fresh_ref)&&same(pre.bindings,projection.bindings),'COMPARISON_CURRENT_PACKET_REFS');
  check(same(documents.origin.source_epoch_ref,REFS.metadata_source_epoch_ref)&&pre.source_epoch_sha256===REFS.metadata_source_epoch_ref.sha256&&typedRoster.source_epoch_sha256===REFS.metadata_source_epoch_ref.sha256,'COMPARISON_SOURCE_EPOCH_REF');
  check(sealed(manifest?.source)&&manifest.source.sha256===SOURCE&&same(manifest.source,projection.current_source_proof)&&same(development?.source?.extraction_source,manifest.source)&&same(development.source.input_manifest,pre.bindings.manifest),'COMPARISON_CURRENT_SOURCE');
  check(Array.isArray(development.rows)&&development.rows.length===200&&same(development.rows.map(r=>({audit_id:r.audit_id,contract_id:r.contract_id})),pre.development_rows)&&new Set(development.rows.map(r=>r.audit_id)).size===200,'COMPARISON_DEVELOPMENT_MEMBERSHIP');
  check(same(guard,pre.completeFreshProof)&&same(guard,projection.completeFreshProof)&&same(guard.contract_ids,pre.freshGuard.contract_ids)&&guard.fresh_packet_ref.sha256===pre.freshGuard.fresh_packet_sha256,'COMPARISON_GUARD_JOIN');
  const failed=retainedBoundFailure(typedRoster,projection,manifest,guard),cases=[];
  for(const[index,binding]of b.entries()){
    const selected=typedRoster.ordered_cases[binding.ordered_index],row=projection.rows[binding.projection_row_index];
    check(one(typedRoster.ordered_cases,r=>r.audit_id===binding.audit_id,'COMPARISON_TYPED_MEMBERSHIP')===selected&&one(projection.rows,r=>r.audit_id===binding.audit_id,'COMPARISON_PROJECTION_MEMBERSHIP')===row,'COMPARISON_FIXED_POSITIONS');
    const checked=checkComparisonCaseMetadata({row,selected,guard,refs:binding.source_refs,ordered_index:binding.ordered_index});
    const dev=one(development.rows,r=>r.audit_id===binding.audit_id,'COMPARISON_DEVELOPMENT_CASE');
    check(dev.contract_id===binding.contract_id&&dev.id===row.focal_id&&dev.parent?.id===row.parent_id&&dev.parent.start===row.parent_start&&dev.parent.end===row.parent_end&&dev.parent.sha256===row.parent_sha256&&dev.parent.normalized_path===row.normalized_path&&dev.parent.normalized_sha256===row.normalized_sha256,'COMPARISON_DEVELOPMENT_GEOMETRY');
    check(dev.lineage?.cache_path===row.cache_path&&dev.lineage.cache_sha256===row.cache_sha256&&dev.lineage.raw_path===row.raw_path&&dev.lineage.raw_sha256===row.raw_sha256&&dev.lineage.normalized_path===row.normalized_path&&dev.lineage.normalized_sha256===row.normalized_sha256&&dev.lineage.offset_basis==='UTF16_IN_NORMALIZED_TEXT','COMPARISON_DEVELOPMENT_LINEAGE');
    manifestCase(manifest,row,binding,index);cases.push(checked);
  }
  return immutableCopy({cases,guard,failed_available:failed,source_payloads_opened:false,authority:'NONE'});
}

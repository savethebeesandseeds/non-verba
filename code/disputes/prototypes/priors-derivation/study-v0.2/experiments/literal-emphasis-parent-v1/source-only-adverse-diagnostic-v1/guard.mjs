// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE. Pure metadata denial checks; no IO, admission, callbacks or permits.
import {digest,sha} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {checkedFocal} from '../next-stage-v1/focal-selection.mjs';
import {validateTypedCaseRoster} from '../typed-case-roster-v1/roster.mjs';

const RUN='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
const EXEC=RUN+'/qa/literal-emphasis-actualA-metadata-engineering-20261017-bound80-v8/execution/';
const BINDINGS_SHA='f2c49a0e2a16426840069aa487876380decac86a20afa9388b5493d495d4ef12';
const AUDIT='development-0045',CID='contract-af284f93afed7c37b17e';
const CASE='281472ea5d6b14852c6b03e805511a95f6f8b29137a23c4e6d930225a06e8ed0';
const SOURCE='874c6b505ae5fc09fd3d92d46c64cd5474abf90fe574537c5e101b4fcaac6afa';
const ROW_SHA='afc659d00a4919a1e38d79c2b5ca1eadc9f1b2690d396b93a7206f13b32fc14a';
const RANGE_SHA='ca0e37a53f0a70366e67cad593b0c420ba2eee5422817e12a7fce0216ac5e876';
const EPOCH_SHA='48372b760ebbf6a06ccb488642201335c944dc2ff1b7f65a7a18269e158a0464';
const freshRef=immutableCopy({path:'audits/592ddf76b713d8ad4a13/fresh_representation.json',sha256:'b7f2a7d36149a64aa63a127fcc22989dc3b1f1eaf7701bf74c06701558917e18',bytes:452683});
const sourceEpochRef=immutableCopy({path:RUN+'/qa/literal-emphasis-actualA-metadata-engineering-20261017-bound80-v8/admission/source-epoch.json',sha256:EPOCH_SHA,bytes:14258});
const files={preflight:'parent-preflight.json',ids:'ordered-development200-ids.json',guard:'complete-fresh-guard.json',projection:'metadata-projection.json',legacy_plan:'ordered69-freeze.json',summary:'summary.json'};
const names=[...Object.keys(files),'roster','origin'];
const check=(value,code)=>{if(!value)throw Object.assign(Error(code),{code});};
const same=(a,b)=>digest(a)===digest(b);
const relative=path=>{check(typeof path==='string'&&path.startsWith(RUN+'/'),'DIAGNOSTIC_RUN_PATH');return path.slice(RUN.length+1);};
const absolute=ref=>({...ref,path:RUN+'/'+ref.path});
const sealed=value=>{const{sha256,...body}=value??{};return typeof sha256==='string'&&/^[a-f0-9]{64}$/u.test(sha256)&&digest(body)===sha256;};
function exactKeys(value,keys,code){check(value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')),code);}
function one(rows,predicate,code){check(Array.isArray(rows),code);const found=rows.filter(predicate);check(found.length===1,code);return found[0];}

/** Public constants are a finite allowlist, never an IO capability. */
export const DIAGNOSTIC_REFS=immutableCopy({
  raw:{path:RUN+'/raw/'+CID+'.html',sha256:'e629eb278e3cc2872f93733c09614f72197f8695b6eba8d653074d7ce8d1aea3',bytes:220353},
  normalized:{path:RUN+'/normalized/874c6b505ae5fc09/'+CID+'.txt',sha256:'68ce0ec0661ad6f3bfc3bfdb8d5c6dfb790785292d29aa35323bada092278278',bytes:59789},
  cache:{path:RUN+'/extraction-cache/874c6b505ae5fc09/'+CID+'.json.gz',sha256:'2f33f63a68316deec07a7746951ca4201453c9fa25dd983e3c454af7eef25b7e',bytes:123393},
  receipt:{path:RUN+'/extraction-cache/874c6b505ae5fc09/'+CID+'.json.gz.manifest.json',sha256:'cc8c0e0dfe2407c29fb1c9aa23316bdafd343723578f0e2e2f491b4873fa27ba',bytes:761},
  native:{path:RUN+'/native-decorations/874c6b505ae5fc09/'+CID+'.json.gz',sha256:'45e72757f2e733534096b248cc7fdf929d0677c62c792e9caa92ea474d4abd25',bytes:305031}
});

/** Small independently testable metadata checks. A self-sealed guard here does
 * not prove its origin: only validateDiagnosticMetadata joins the pinned eight
 * documents. Neither function grants authority or opens any supplied path.
 * Supported domain: trusted parsed JSON trees and typed-roster input bytes. */
export function checkSelectedDiagnosticMetadata({row,selected,guard,refs}){
  check(selected?.audit_id===AUDIT&&selected.contract_id===CID&&selected.case_id===CASE&&selected.case_kind==='AVAILABLE_FOCAL'&&selected.selection_role==='MANDATORY'&&selected.stratum===null,'DIAGNOSTIC_FIXED_CASE');
  checkedFocal(row,{fixture:false});
  check(row.audit_id===AUDIT&&row.contract_id===CID&&row.source_sha256===SOURCE&&same(selected.focal,row),'DIAGNOSTIC_SELECTED_ROW');
  check(row.focal_kind==='ACTUAL_UNIT'&&row.focal_start===25713&&row.parent_start===25713&&row.focal_end===27030&&row.parent_end===27030&&row.focal_end-row.focal_start===1317&&row.focal_sha256===RANGE_SHA&&row.parent_sha256===RANGE_SHA&&row.focal_id!==row.parent_id,'DIAGNOSTIC_FIXED_GEOMETRY');
  check(digest(row)===ROW_SHA,'DIAGNOSTIC_CANONICAL_ROW');
  check(guard?.schema==='stored-reader-complete-fresh100-guard-v1'&&guard.source_epoch_sha256===EPOCH_SHA&&same(guard.fresh_packet_ref,freshRef)&&Array.isArray(guard.rows)&&guard.rows.length===100&&Array.isArray(guard.contract_ids)&&guard.contract_ids.length===29,'DIAGNOSTIC_COMPLETE_FRESH_GUARD');
  const auditIDs=new Set(),contractIDs=new Set();
  for(const r of guard.rows){exactKeys(r,['audit_id','contract_id'],'DIAGNOSTIC_FRESH_ROW');check(typeof r.audit_id==='string'&&r.audit_id.length>0&&r.audit_id.length<=256&&typeof r.contract_id==='string'&&r.contract_id.length>0&&r.contract_id.length<=256&&!auditIDs.has(r.audit_id),'DIAGNOSTIC_FRESH_ROW');auditIDs.add(r.audit_id);contractIDs.add(r.contract_id);}
  const{projection_sha256,...guardBody}=guard;
  check(digest(guardBody)===projection_sha256&&same([...contractIDs].sort(),guard.contract_ids)&&contractIDs.size===29,'DIAGNOSTIC_FRESH_SEAL');
  check(!contractIDs.has(CID),'DIAGNOSTIC_PROTECTED_CONTRACT');
  exactKeys(refs,['raw','normalized','cache','receipt','native'],'DIAGNOSTIC_FIVE_REFS');
  check(same(refs,DIAGNOSTIC_REFS),'DIAGNOSTIC_PAYLOAD_REF_SUBSTITUTION');
  check(row.raw_path===relative(refs.raw.path)&&row.raw_sha256===refs.raw.sha256&&row.raw_bytes===refs.raw.bytes&&row.normalized_path===relative(refs.normalized.path)&&row.normalized_sha256===refs.normalized.sha256&&row.cache_path===relative(refs.cache.path)&&row.cache_sha256===refs.cache.sha256&&row.cache_bytes===refs.cache.bytes&&row.cache_receipt_sha256===refs.receipt.sha256,'DIAGNOSTIC_ROW_REFS');
  return immutableCopy({row,guard,refs});
}

/** Actual identity is fixed in source: no fixture switch, permit or IO seam.
 * ROOT must authenticate the supplied buffers/parsed manifest/development,
 * opaque fresh packet and source epoch before independently minting admission.
 * We deliberately never inspect development excerpts or fresh source text. */
export function validateDiagnosticMetadata({bindings,input,typedRoster,manifest,development}){
  const b=immutableCopy(bindings);
  check(digest(b)===BINDINGS_SHA,'DIAGNOSTIC_PINNED_BINDINGS');
  validateTypedCaseRoster(typedRoster,input,{fixture:false});
  check(sha(Buffer.from(JSON.stringify(typedRoster,null,2)+'\n'))===b.typed_roster_ref.sha256&&Buffer.byteLength(JSON.stringify(typedRoster,null,2)+'\n')===b.typed_roster_ref.bytes,'DIAGNOSTIC_TYPED_ROSTER_FILE');
  const d={};
  for(const name of names){const entry=input[name],ref=entry.ref,expected=b.metadata_inputs[name],path=files[name]?EXEC+ref.path:RUN+'/'+ref.path;check(path===expected.path&&ref.sha256===expected.sha256&&ref.bytes===expected.bytes&&same(ref,typedRoster.input_refs[name]),'DIAGNOSTIC_METADATA_REF');d[name]=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(entry.bytes));}
  const pre=d.preflight,projection=d.projection;
  check(same(absolute(pre.bindings.manifest),b.current_manifest_ref)&&same(absolute(pre.bindings.development),b.development_ref)&&same(absolute(pre.bindings.fresh),b.fresh_ref)&&same(pre.bindings,projection.bindings),'DIAGNOSTIC_CURRENT_PACKET_REFS');
  check(same(d.origin.source_epoch_ref,sourceEpochRef)&&pre.source_epoch_sha256===EPOCH_SHA&&typedRoster.source_epoch_sha256===EPOCH_SHA,'DIAGNOSTIC_SOURCE_EPOCH_REF');
  check(sealed(manifest?.source)&&manifest.source.sha256===SOURCE&&same(manifest.source,projection.current_source_proof)&&same(development?.source?.extraction_source,manifest.source)&&same(development.source.input_manifest,pre.bindings.manifest),'DIAGNOSTIC_CURRENT_SOURCE');
  check(Array.isArray(development.rows)&&development.rows.length===200&&same(development.rows.map(r=>({audit_id:r.audit_id,contract_id:r.contract_id})),pre.development_rows)&&new Set(development.rows.map(r=>r.audit_id)).size===200,'DIAGNOSTIC_DEVELOPMENT_MEMBERSHIP');
  const selected=typedRoster.ordered_cases[24],row=projection.rows[42];
  check(b.audit_id===AUDIT&&b.contract_id===CID&&b.case_id===CASE&&b.ordered_index===24&&b.row_canonical_sha256===ROW_SHA&&one(typedRoster.ordered_cases,r=>r.audit_id===AUDIT,'DIAGNOSTIC_TYPED_MEMBERSHIP')===selected&&one(projection.rows,r=>r.audit_id===AUDIT,'DIAGNOSTIC_PROJECTION_MEMBERSHIP')===row,'DIAGNOSTIC_FIXED_POSITIONS');
  const result=checkSelectedDiagnosticMetadata({row,selected,guard:d.guard,refs:b.source_refs});
  check(same(result.guard,pre.completeFreshProof)&&same(result.guard,projection.completeFreshProof)&&same(result.guard.contract_ids,pre.freshGuard.contract_ids)&&result.guard.fresh_packet_ref.sha256===pre.freshGuard.fresh_packet_sha256,'DIAGNOSTIC_GUARD_JOIN');
  const dev=one(development.rows,r=>r.audit_id===AUDIT,'DIAGNOSTIC_DEVELOPMENT_CASE');
  check(dev.contract_id===CID&&dev.id===row.focal_id&&dev.parent?.id===row.parent_id&&dev.parent.start===row.parent_start&&dev.parent.end===row.parent_end&&dev.parent.sha256===row.parent_sha256&&dev.parent.normalized_path===row.normalized_path&&dev.parent.normalized_sha256===row.normalized_sha256,'DIAGNOSTIC_DEVELOPMENT_GEOMETRY');
  check(dev.lineage?.cache_path===row.cache_path&&dev.lineage.cache_sha256===row.cache_sha256&&dev.lineage.raw_path===row.raw_path&&dev.lineage.raw_sha256===row.raw_sha256&&dev.lineage.normalized_path===row.normalized_path&&dev.lineage.normalized_sha256===row.normalized_sha256&&dev.lineage.offset_basis==='UTF16_IN_NORMALIZED_TEXT','DIAGNOSTIC_DEVELOPMENT_LINEAGE');
  const cache=one(manifest.cache,r=>r.id===CID,'DIAGNOSTIC_MANIFEST_CACHE'),record=one(manifest.contract_records,r=>r.id===CID,'DIAGNOSTIC_MANIFEST_CONTRACT'),native=record.native_source_decorations;
  check(same(absolute({path:cache.path,sha256:cache.sha256,bytes:cache.bytes}),result.refs.cache)&&cache.raw_sha256===row.raw_sha256&&cache.source_sha256===SOURCE&&cache.storage?.schema==='lossless-gzip-extraction-cache-v1'&&cache.storage.encoding==='gzip'&&cache.storage.serializer==='UTF8_JSON_STRINGIFY_PRETTY_2_FINAL_LF_V1'&&cache.storage.decoded_bytes===b.cache_storage.decoded_bytes&&cache.storage.decoded_sha256===b.cache_storage.decoded_sha256,'DIAGNOSTIC_CACHE_IDENTITY');
  check(record.status==='accepted'&&record.raw_sha256===row.raw_sha256&&record.normalized_path===row.normalized_path&&record.normalized_sha256===row.normalized_sha256,'DIAGNOSTIC_MANIFEST_IDENTITY');
  check(sealed(native)&&native.schema==='native-source-decoration-reference-v1'&&native.storage_policy==='LOSSLESS_GZIP_FULL_NATIVE_ENVELOPE_ONCE_PER_CONTRACT_V1'&&native.sha256===row.native_reference_sha256&&native.sha256===b.native_reference_sha256&&native.envelope_sha256===b.native_envelope_sha256&&native.raw_sha256===row.raw_sha256&&native.normalized_sha256===row.normalized_sha256&&same(absolute(native.artifact),result.refs.native)&&native.uncompressed_bytes===b.native_storage.decoded_bytes&&native.uncompressed_sha256===b.native_storage.decoded_sha256,'DIAGNOSTIC_NATIVE_REFERENCE');
  return result;
}

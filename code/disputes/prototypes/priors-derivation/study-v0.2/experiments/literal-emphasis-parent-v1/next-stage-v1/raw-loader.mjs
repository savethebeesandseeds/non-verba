// SPDX-License-Identifier: AGPL-3.0-only
// PREPARE_SELECTED69 only. Exact frozen row, fresh deny, old cache receipts,
// native sidecar, raw bytes and normalized artifact are bound separately.
import {digest,sha} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {PILOT_LIMITS} from '../pilot-resources.mjs';
import {assertPermit,assertSyntheticID} from './admission.mjs';
import {checkedFocal} from './focal-selection.mjs';
import {projectCompleteFreshIDs,parametersFromProof} from './metadata.mjs';
import {readBound,readCache,hydrateNative,caseBudget,exactUTF8} from './io.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const sealed=value=>{const{sha256,...body}=value??{};return typeof sha256==='string'&&digest(body)===sha256;};
export async function loadFrozenSource(root,row,projection,freeze,{permit}){
  const fixture=assertPermit(permit,root)==='SOURCE_FREE_FIXTURE';row=checkedFocal(row,{fixture});if(fixture)assertSyntheticID(permit,root,row.contract_id);
  if(!sealed(projection)||!sealed(freeze)||projection.status!=='COMPLETE_METADATA_PROJECTION_NOT_SOURCE_READING'||freeze.status!=='ORDERED69_METADATA_FROZEN_NOT_SOURCE_AUTHORIZATION'||freeze.planned_denominator!==69||freeze.nominal_denominator!==69||freeze.ordered.length!==69||new Set(freeze.ordered.map(r=>r.audit_id)).size!==69||freeze.pool_sha256!==digest(projection.rows)||freeze.fresh_guard_sha256!==projection.freshGuard.projection_sha256||freeze.metadata_projection_sha256!==projection.sha256||freeze.current_source_proof_sha256!==projection.current_source_proof.sha256)fail('EXACT69_SEPARATE_ORDERED_FREEZE_REQUIRED');
  const selected=freeze.ordered.filter(r=>r.audit_id===row.audit_id),derived=projection.rows.filter(r=>r.audit_id===row.audit_id);if(selected.length!==1||derived.length!==1||digest(selected[0])!==digest(row)||digest(derived[0])!==digest(row))fail('EXACT69_FROZEN_ROW_MISMATCH');
  const source=projection.current_source_proof,parameters=parametersFromProof(source,{fixture});
  const freshGuard=await projectCompleteFreshIDs(root,projection.bindings.fresh,source,{permit,manifestReference:projection.bindings.manifest});
  if(freshGuard.projection_sha256!==projection.freshGuard.projection_sha256||freshGuard.contract_ids.includes(row.contract_id))fail('EXACT69_PROTECTED_OR_CHANGED_FRESH_GUARD'); // BEFORE cache/raw.
  const budget=caseBudget(),reference={path:row.cache_path,sha256:row.cache_sha256,bytes:row.cache_bytes},loaded=await readCache(root,reference,{permit,budget}),cache=loaded.value;
  if(loaded.receipt_binding.sha256!==row.cache_receipt_sha256||loaded.receipt.id!==row.contract_id||loaded.receipt.source_sha256!==source.sha256||loaded.receipt.raw_sha256!==row.raw_sha256||cache.contract?.id!==row.contract_id||cache.contract.path!==row.raw_path||cache.raw_sha256!==row.raw_sha256||digest(cache.source)!==digest(source)||cache.native_source_decorations?.sha256!==row.native_reference_sha256)fail('EXACT69_CURRENT_CACHE_LINEAGE');
  const envelope=await hydrateNative(root,cache.native_source_decorations,{permit,budget});
  const rawBytes=await readBound(root,row.raw_path,{sha256:row.raw_sha256,bytes:row.raw_bytes},{permit,maxBytes:PILOT_LIMITS.raw_bytes,budget}),raw=exactUTF8(rawBytes);
  if(envelope.raw.sha256!==sha(rawBytes)||envelope.raw.characters!==raw.length||envelope.raw.bytes!==rawBytes.length)fail('EXACT69_NATIVE_ORIGINAL_RAW_BINDING');
  const normalizedBytes=await readBound(root,row.normalized_path,{sha256:row.normalized_sha256},{permit,maxBytes:PILOT_LIMITS.decoded_characters,budget}),normalized=exactUTF8(normalizedBytes);
  if(normalized!==cache.normalized_text||sha(normalized)!==cache.normalized_sha256)fail('EXACT69_NORMALIZED_ARTIFACT_BINDING');
  const candidates=(row.focal_kind==='ACTUAL_UNIT'?cache.units:cache.sections).filter(r=>r.id===row.focal_id),parents=cache.sections.filter(r=>r.id===row.parent_id);if(candidates.length!==1||parents.length!==1)fail('EXACT69_EXACT_FOCAL_LOOKUP');const focal=candidates[0],parent=parents[0];
  if(focal.start!==row.focal_start||focal.end!==row.focal_end||focal.sha256!==row.focal_sha256||parent.start!==row.parent_start||parent.end!==row.parent_end||parent.sha256!==row.parent_sha256||row.focal_kind==='ACTUAL_UNIT'&&focal.parent_section_id!==parent.id||row.focal_kind==='FOCAL_PARENT_ANCHOR'&&focal.id!==parent.id)fail('EXACT69_FROZEN_FOCAL_SCOPE');
  return {row,rawBytes,record:immutableCopy(cache.contract),currentCache:{...cache,native_source_decorations:envelope},extractionOptions:parameters.extraction,selectionOptions:parameters.selection,freshGuard,projection_sha256:projection.sha256,ordered69_sha256:freeze.sha256,input_resource:{decoded_bytes:budget.decoded},source_access_kind:fixture?'DECLARED_SYNTHETIC_FIXTURE':'ROOT_REVIEWED_PROSPECTIVE_ACTUAL',actual_reading:false};
}

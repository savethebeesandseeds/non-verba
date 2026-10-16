// SPDX-License-Identifier: AGPL-3.0-only
// Parent ID-only preflight. No cache/native/loader/adapter/tokenizer imports.
import {digest} from '../../finite-codec.mjs';
import {immutableCopy} from '../../immutable-state.mjs';
import {checkedMandatoryRoster} from '../bindings.mjs';
import {contextOf,assertSyntheticID,fail} from './admission.mjs';
import {readParentMetadata,parseJSON,sha} from './input-io.mjs';
import {CURRENT_SOURCE} from './builtin-gate.mjs';
const owned=new WeakMap();
const sealed=v=>v&&typeof v.sha256==='string'&&digest(Object.fromEntries(Object.entries(v).filter(([k])=>k!=='sha256')))===v.sha256;
function packet(v,purpose,count,source,manifest){if(v?.schema_version!==2||v.purpose!==purpose||v.count!==count||v.target!==count||v.shortage!==0||!Array.isArray(v.rows)||v.rows.length!==count||new Set(v.rows.map(r=>r.audit_id)).size!==count||!sealed(v.source)||digest(v.source.extraction_source)!==digest(source)||digest(v.source.input_manifest)!==digest(manifest))fail('METADATA_PREFLIGHT_PACKET');}
export async function preflightMetadata(permit){
  const c=contextOf(permit),manifest=parseJSON(await readParentMetadata(permit,c.bindings.manifest)),source=manifest.source;
  if(!sealed(source)||!c.fixture&&source.sha256!==CURRENT_SOURCE||!source.parameters?.extraction||source.runtime?.node!==process.version||source.runtime.platform!==process.platform||source.runtime.architecture!==process.arch)fail('METADATA_PREFLIGHT_SOURCE');
  const freshBytes=await readParentMetadata(permit,c.bindings.fresh),fresh=parseJSON(freshBytes);packet(fresh,'fresh_representation',100,source,c.bindings.manifest);
  for(const r of fresh.rows){if(c.fixture){assertSyntheticID(permit,c.input_root,r.audit_id);assertSyntheticID(permit,c.input_root,r.contract_id);}if(typeof r.audit_id!=='string'||!r.audit_id||r.audit_id.length>256||typeof r.contract_id!=='string'||!r.contract_id||r.contract_id.length>256)fail('EXECUTOR_ID_SHAPE');}
  const contract_ids=[...new Set(fresh.rows.map(r=>r.contract_id))].sort();if(contract_ids.length!==29)fail('METADATA_PREFLIGHT_COMPLETE29');
  const roster=checkedMandatoryRoster(parseJSON(await readParentMetadata(permit,c.roster_ref)),{sourceSHA:source.sha256,fixture:c.fixture});
  const dev=parseJSON(await readParentMetadata(permit,c.bindings.development));packet(dev,'development',200,source,c.bindings.manifest);
  for(const r of dev.rows){if(c.fixture){assertSyntheticID(permit,c.input_root,r.audit_id);assertSyntheticID(permit,c.input_root,r.contract_id);}if(typeof r.audit_id!=='string'||!r.audit_id||r.audit_id.length>256||typeof r.contract_id!=='string'||!r.contract_id||r.contract_id.length>256)fail('EXECUTOR_ID_SHAPE');}
  const expected_ids=dev.rows.map(r=>r.audit_id);if(roster.mandatory_audit_ids.some(id=>!expected_ids.includes(id)))fail('METADATA_PREFLIGHT_MANDATORY_MEMBERSHIP');
  const protected_rows=dev.rows.filter(r=>contract_ids.includes(r.contract_id)).map(({audit_id,contract_id})=>({audit_id,contract_id}));
  const protected_mandatory=protected_rows.filter(r=>roster.mandatory_audit_ids.includes(r.audit_id));
  const guardBody={schema:'CONTRACT_ID_ONLY_FRESH_GUARD_V1',fresh_packet_sha256:sha(freshBytes),fresh_packet_rows:100,contract_ids};
  const freshGuard={...guardBody,projection_sha256:digest(guardBody)},proofBody={schema:'stored-reader-complete-fresh100-guard-v1',fresh_packet_ref:c.bindings.fresh,source_epoch_sha256:c.source_epoch_sha256,rows:fresh.rows.map(({audit_id,contract_id})=>({audit_id,contract_id})),contract_ids};
  const body={schema:'metadata-selection-parent-preflight-v1',mode:c.fixture?'SOURCE_FREE_FIXTURE':'ROOT_ADMITTED_METADATA_ONLY',phase:c.phase,status:protected_mandatory.length?'HELD_PROTECTED_MANDATORY_BEFORE_INIT':'COMPLETE_ID_ONLY_PREFLIGHT_BEFORE_INIT',bindings:c.bindings,roster_ref:c.roster_ref,source_epoch_sha256:c.source_epoch_sha256,current_source_proof_sha256:source.sha256,expected_ids,mandatory_audit_ids:roster.mandatory_audit_ids,freshGuard,completeFreshProof:{...proofBody,projection_sha256:digest(proofBody)},development_rows:dev.rows.map(({audit_id,contract_id})=>({audit_id,contract_id})),protected_rows,protected_mandatory,development_denominator:200,source_pilot_denominator:69,cache_opened:false,native_opened:false,raw_opened:false,tokenizer_calls:0,actual_authority:false};
  const result=immutableCopy({...body,sha256:digest(body)}),frozenManifest=immutableCopy(manifest);owned.set(result,Object.freeze({permit,manifest:frozenManifest,source:frozenManifest.source}));return result;
}
export function preflightContext(permit,scope){const entry=owned.get(scope);if(!entry||entry.permit!==permit)fail('METADATA_OWNED_PREFLIGHT_REQUIRED');return entry;}

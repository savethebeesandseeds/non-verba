// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Source availability descriptor; no dependency inference.
import {verifyNativeDecorationEnvelope} from './source-decoration.prototype.mjs';
import {deriveFiniteNine,digest,sha,POLICY as CODEC_POLICY} from './finite-codec.mjs';
import {immutableCopy} from './immutable-state.mjs';
export const POLICY='PROTOTYPE_FULL_STORED_PARENT_STREAM_AND_UNIT_ABLATION_V1_UNADOPTED';
export const ARMS=immutableCopy([
  {id:'baseline-unit-only-ablation',form:'unit',model:'pinned-L6'},
  {id:'baseline-full-parent-context',form:'parent',model:'pinned-L6'},
  {id:'second-model-unit-only-ablation',form:'unit',model:'pinned-L12'},
  {id:'lexical-unit-only-ablation',form:'unit',model:'lexical-on-pinned-L6-windows'}
]);
function range(text,start,end){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>text.length)throw new Error('Exact nonempty source range required');for(const n of [start,end])if(n>0&&n<text.length&&/[\uD800-\uDBFF]/u.test(text[n-1])&&/[\uDC00-\uDFFF]/u.test(text[n]))throw new Error('Source range splits a codepoint');}
export function prospectiveForms({fixture,parent,unit}={}){
  const selectedParent=immutableCopy(parent),selectedUnit=immutableCopy(unit);
  if(fixture?.source_kind!=='DECLARED_SYNTHETIC'||!/^SYNTHETIC_/u.test(selectedParent?.id??'')||!/^SYNTHETIC_/u.test(selectedUnit?.id??''))throw new Error('Explicit synthetic fixture/parent/unit required');
  const {raw,normalizedText,envelope,tracerSourceSHA256,collectorSourceSHA256}=fixture;
  const fixtureID=fixture.id;
  verifyNativeDecorationEnvelope(envelope,{raw,normalizedText,expectedTracerSourceSHA256:tracerSourceSHA256,expectedCollectorSourceSHA256:collectorSourceSHA256});
  range(normalizedText,selectedParent.start,selectedParent.end);range(normalizedText,selectedUnit.start,selectedUnit.end);
  if(selectedUnit.start<selectedParent.start||selectedUnit.end>selectedParent.end)throw new Error('Focal unit must be wholly inside the actual supplied parent');
  const privateDescriptor=immutableCopy({schema:'prototype-full-parent-context-v1',policy:POLICY,status:'PROTOTYPE_UNADOPTED_SYNTHETIC_ONLY',authority:'NONE',parent:{...selectedParent,sha256:sha(normalizedText.slice(selectedParent.start,selectedParent.end))},unit:{...selectedUnit,sha256:sha(normalizedText.slice(selectedUnit.start,selectedUnit.end))},raw_sha256:envelope.raw.sha256,normalized_sha256:sha(normalizedText),envelope_sha256:envelope.sha256,tracer_source_sha256:tracerSourceSHA256,collector_source_sha256:collectorSourceSHA256,codec:CODEC_POLICY,source_availability:'ENTIRE_SUPPLIED_STORED_PARENT',dependency_completeness_verified:false,semantic_completeness_verified:false,source_hierarchy_verified:false,navigation_prefix:false,governing_context_ranker:false,word_cap:null,pooling_performed:false,model_inference:false});
  const descriptorSHA=digest(privateDescriptor);
  const build=(form,selected)=>deriveFiniteNine({normalizedText,envelope,start:selected.start,end:selected.end,evidence:{source_kind:'DECLARED_SYNTHETIC',fixture_id:fixtureID,descriptor_sha256:descriptorSHA,form},qualification:{status:'DECLARED_SYNTHETIC_NOT_ACTUAL_SOURCE_REVIEW',authority:'NONE'}});
  return Object.freeze({descriptor:immutableCopy(privateDescriptor),unit:build('UNIT_ONLY_ABLATION',selectedUnit),parent:build('FULL_STORED_PARENT_AVAILABILITY_ONLY',selectedParent),arms:ARMS});
}

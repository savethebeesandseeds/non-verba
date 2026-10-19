// SPDX-License-Identifier: AGPL-3.0-only
// Literal navigation locates text; it does not verify its governing hierarchy.
import {createHash} from 'node:crypto';
import {createNativeDecorationView,verifyNativeDecorationEnvelope,NATIVE_DECORATION_INPUT_POLICY,NATIVE_DECORATION_POLICY} from '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/source-decoration.mjs';
import {NATIVE_COLLECTOR_POLICY} from '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/sections.mjs';
export const NAVIGATION_SCOPE = 'LITERAL_SOURCE_NAVIGATION_ONLY';
export const LEGACY_HEADING_INPUT_POLICY = 'SOURCE_NAVIGATION_LABEL_OR_EMPTY; LEGACY_HEADING_ONLY_WHEN_NAVIGATION_FIELD_ABSENT';
export const HEADING_INPUT_POLICY = 'CURRENT_NATIVE_CONTIGUOUS_SOURCE_SPAN_ONLY; NAVIGATION_METADATA_EXCLUDED; LEGACY_HISTORICAL_PREFIX_UNCHANGED';
export const NATIVE_REPRESENTATION_POLICY = 'ONE_CONTIGUOUS_SELECTED_SOURCE_SPAN_NATIVE_WINDOWS_NAVIGATION_METADATA_ONLY_V3';
// Isolated prospective availability trial; this is not an adopted input policy.
export const FULL_STORED_PARENT_TRIAL = 'DEVELOPMENT0004_FULL_AUTHENTICATED_STORED_PARENT_V1';
export const FULL_STORED_PARENT_POLICY = 'ONE_AUTHENTICATED_STORED_PARENT_NATIVE_PRETOKENIZATION_TRIAL_V1';
export const FULL_STORED_PARENT_TARGET = Object.freeze({audit_id:'development-0004',contract_id:'contract-327cc1e738fcb8a98106',parent_start:54521,parent_end:63634,unit_start:57284,unit_end:59026});
export const LEGACY_NATIVE_STATUS = 'LEGACY_NATIVE_EVIDENCE_UNAVAILABLE';
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const digest = value => sha(canonical(value));
const contexts = new WeakMap(),representations = new WeakMap();
const whitespace = value => value.replace(/\s+/gu, ' ').trim();

function checkedLiteralAnchor(anchor) {
  if (!anchor || anchor.scope !== NAVIGATION_SCOPE || anchor.governing_hierarchy_verified !== false || typeof anchor.label !== 'string' || !anchor.label || anchor.label.length > 2048 || !Number.isSafeInteger(anchor.start) || !Number.isSafeInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start || !Array.isArray(anchor.parts) || !anchor.parts.length) throw new Error('Source navigation requires a bounded literal anchor');
  let previousEnd = anchor.start;
  for (const part of anchor.parts) {
    if (typeof part.text !== 'string' || !part.text || !Number.isSafeInteger(part.start) || !Number.isSafeInteger(part.end) || part.start < previousEnd || part.end > anchor.end || part.end - part.start !== part.text.length) throw new Error('Source navigation literal-piece coordinates differ');
    previousEnd = part.end;
  }
  if (whitespace(anchor.parts.map(part => part.text).join(' ')) !== anchor.label) throw new Error('Source navigation label differs from its literal pieces');
  return anchor.label;
}

export function sourceNavigationLabel(unit) {
  if (!Object.hasOwn(unit, 'source_navigation')) return (unit.heading_path ?? []).join(' > ') || unit.heading || '';
  const navigation = unit.source_navigation;
  if (!navigation || navigation.scope !== NAVIGATION_SCOPE || navigation.governing_hierarchy_verified !== false || !Array.isArray(navigation.within_unit) || navigation.within_unit.length>512) throw new Error('Source navigation requires explicit unverified literal scope');
  for (const anchor of navigation.within_unit) checkedLiteralAnchor(anchor);
  if (navigation.nearest_anchor === null) return '';
  const label=checkedLiteralAnchor(navigation.nearest_anchor);
  if (Number.isSafeInteger(unit.start) && navigation.nearest_anchor.start > unit.start) throw new Error('Nearest source anchor cannot begin after the unit');
  return label;
}

export function verifySourceNavigation(unit, normalized) {
  sourceNavigationLabel(unit);
  if (!Object.hasOwn(unit, 'source_navigation')) return;
  for (const anchor of [unit.source_navigation.nearest_anchor, ...unit.source_navigation.within_unit].filter(Boolean)) {
    if (anchor.scope !== NAVIGATION_SCOPE || anchor.governing_hierarchy_verified !== false || !Array.isArray(anchor.parts) || !anchor.parts.length || typeof anchor.label !== 'string' || whitespace(anchor.parts.map(part => part.text).join(' ')) !== anchor.label) throw new Error('Source navigation anchor differs from its literal scope');
    for (const part of anchor.parts) if (!Number.isSafeInteger(part.start) || !Number.isSafeInteger(part.end) || part.start < 0 || part.end <= part.start || part.end > normalized.length || normalized.slice(part.start, part.end) !== part.text) throw new Error('Source navigation does not match its normalized source');
  }
}

function exactRange(value,text,label) {
  if(!value||!Number.isSafeInteger(value.start)||!Number.isSafeInteger(value.end)||value.start<0||value.end<=value.start||value.end>text.length||!pointBoundary(text,value.start)||!pointBoundary(text,value.end))throw new Error(`${label} requires an exact nonempty UTF16 source range`);
  return {start:value.start,end:value.end};
}
function pointBoundary(text,offset) {return !(offset>0&&offset<text.length&&/[\uD800-\uDBFF]/u.test(text[offset-1])&&/[\uDC00-\uDFFF]/u.test(text[offset]));}
function frozen(value){if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}

/** Hydrate once per contract. The retained context/view never enters a shard. */
export function createNativeSourceContext({raw,normalizedText,envelope,expectedTracerSourceSHA256,expectedCollectorSourceSHA256}={}) {
  if(!/^[a-f0-9]{64}$/u.test(expectedTracerSourceSHA256??'')||!/^[a-f0-9]{64}$/u.test(expectedCollectorSourceSHA256??''))throw new Error('Current tracer and collector source identities required');
  verifyNativeDecorationEnvelope(envelope,{raw,normalizedText,expectedTracerSourceSHA256,expectedCollectorSourceSHA256});
  const eligibility=envelope.mapping_status==='EXACT_COLLECTOR_ORIGIN'?'EXACT_SOURCE_EVIDENCE':envelope.mapping_status==='COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE'?envelope.mapping_status:null;
  if(!eligibility||envelope.input_eligibility!==eligibility||envelope.method_identity_status!=='CURRENT_METHOD_BINDINGS_SUPPLIED')throw new Error('Current native mapping unresolved; source retained, plain-only model fallback forbidden');
  const context=Object.freeze({schema:'bound-native-source-context-v1'});
  const binding=Object.fromEntries(['sha256','policy','mapping_status','input_eligibility','tracer_source_sha256','collector_source_sha256'].map(key=>[key,envelope[key]]));
  contexts.set(context,{view:createNativeDecorationView(envelope,{raw,normalizedText}),normalizedText,envelope:binding,raw_sha256:sha(raw),normalized_sha256:sha(normalizedText)});
  return context;
}

/** Current model input is exactly one authenticated contiguous source span.
 * Navigation remains verified metadata, never a separately promoted prefix. */
export function createNativeRepresentation(unit,{context,parent,bodyRange,includeHeading=false,contextScope,trialAuditId,...source}={}) {
  if(!context)context=createNativeSourceContext(source);
  const bound=contexts.get(context);if(!bound)throw new Error('Authenticated native source context required');
  if(typeof unit?.id!=='string'||!unit.id||typeof unit.contract_id!=='string'||!unit.contract_id)throw new Error('Native unit requires explicit source identity');
  const {normalizedText,envelope,view}=bound,unitRange=exactRange(unit,normalizedText,'Unit');
  if(typeof unit.text!=='string'||normalizedText.slice(unit.start,unit.end)!==unit.text||unit.sha256!==sha(unit.text))throw new Error('Native unit text/hash differs from its source range');
  const parentRange=exactRange(parent,normalizedText,'Parent');
  if(parent.id!==unit.parent_section_id||parent.contract_id!==unit.contract_id||parent.cohort!==unit.cohort||parent.start>unit.start||parent.end<unit.end||parent.sha256!==sha(normalizedText.slice(parent.start,parent.end)))throw new Error('Native unit parent binding differs');
  const ref=unit.native_source_decorations_ref;
  if(!ref||ref.envelope_sha256!==envelope.sha256||ref.raw_sha256!==bound.raw_sha256||ref.normalized_sha256!==bound.normalized_sha256||ref.tracer_source_sha256!==envelope.tracer_source_sha256||ref.collector_source_sha256!==envelope.collector_source_sha256||ref.collector_policy!==NATIVE_COLLECTOR_POLICY||ref.policy!==envelope.policy||ref.mapping_status!==envelope.mapping_status||ref.input_eligibility!==envelope.input_eligibility||ref.start!==unit.start||ref.end!==unit.end||ref.projection_required!==true)throw new Error('Current native unit reference differs from hydrated source');
  const fullParentTrial=contextScope===FULL_STORED_PARENT_TRIAL;
  if(contextScope!==undefined&&!fullParentTrial)throw new Error('Unknown native context trial scope');
  if(trialAuditId!==undefined&&!fullParentTrial)throw new Error('Trial audit identity requires the explicit full-parent opt-in');
  if(fullParentTrial&&(trialAuditId!==FULL_STORED_PARENT_TARGET.audit_id||unit.contract_id!==FULL_STORED_PARENT_TARGET.contract_id||parent.start!==FULL_STORED_PARENT_TARGET.parent_start||parent.end!==FULL_STORED_PARENT_TARGET.parent_end||unit.start!==FULL_STORED_PARENT_TARGET.unit_start||unit.end!==FULL_STORED_PARENT_TARGET.unit_end))throw new Error('Full-parent trial is restricted to the exact development-0004 stored parent and unit');
  const selected=exactRange(bodyRange??(fullParentTrial?parentRange:unitRange),normalizedText,'Model body');
  if(fullParentTrial&&(selected.start!==parent.start||selected.end!==parent.end))throw new Error('Full-parent trial requires the complete original stored parent range');
  if(selected.start<parentRange.start||selected.end>parentRange.end||selected.start>unit.start||selected.end<unit.end)throw new Error('Native body/context must contain the unit inside its current parent');
  if(selected.start<unit.start&&selected.start>parent.start&&!/\s/u.test(normalizedText[selected.start-1])&&!/\s/u.test(normalizedText[selected.start])||selected.end>unit.end&&selected.end<parent.end&&!/\s/u.test(normalizedText[selected.end-1])&&!/\s/u.test(normalizedText[selected.end]))throw new Error('Native neighboring context cannot cut a complete source word');
  const beforeWords=(normalizedText.slice(selected.start,unit.start).match(/\S+/gu)??[]).length,afterWords=(normalizedText.slice(unit.end,selected.end).match(/\S+/gu)??[]).length;
  if(!fullParentTrial&&beforeWords+afterWords>60)throw new Error('Fixed native parent-context input exceeds sixty complete neighboring words');
  if(typeof includeHeading!=='boolean')throw new Error('Explicit heading selection required');
  if(includeHeading)throw new Error('Current native input forbids heading promotion; navigation is metadata only');
  if(!Object.hasOwn(unit,'source_navigation'))throw new Error('Current native input requires literal navigation metadata or explicit unknown navigation');
  verifySourceNavigation(unit,normalizedText);
  const text=normalizedText.slice(selected.start,selected.end);if(!text.trim())throw new Error('Empty current native model input retained as failed');
  const pieces=[{kind:'source',role:selected.start===unit.start&&selected.end===unit.end?'unit_body':'verified_parent_context',start:0,end:text.length,normalized_start:selected.start,normalized_end:selected.end,source_sha256:sha(text)}];
  const descriptor=frozen({schema:'source-native-representation-v1',status:'BOUND_NATIVE_SOURCE_EVIDENCE',policy:fullParentTrial?FULL_STORED_PARENT_POLICY:NATIVE_REPRESENTATION_POLICY,...(fullParentTrial?{context_scope:FULL_STORED_PARENT_TRIAL,trial_audit_id:trialAuditId,stored_parent_coverage:'EXACT_ORIGINAL_PARENT_RANGE_ONLY',outside_parent_context_verified:false,semantic_sufficiency_verified:false}:{}),heading_input_policy:HEADING_INPUT_POLICY,input_policy:NATIVE_DECORATION_INPUT_POLICY,native_policy:NATIVE_DECORATION_POLICY,collector_policy:NATIVE_COLLECTOR_POLICY,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,envelope_sha256:envelope.sha256,raw_sha256:bound.raw_sha256,normalized_sha256:bound.normalized_sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,parent:{id:parent.id,...parentRange,sha256:parent.sha256},unit:{id:unit.id,contract_id:unit.contract_id,cohort:unit.cohort,...unitRange,sha256:unit.sha256},parts:pieces,neighbor_words:{before:beforeWords,after:afterWords,maximum:fullParentTrial?null:60},source_text_sha256:sha(text),zero_output_ownership:'HALF_OPEN_INTERMEDIATE; INCLUDE_SELECTED_SOURCE_PART_TERMINAL_END; OVERLAP_REPEATS_DISCLOSED_ORIGIN',computed_style_verified:false,effectiveness_verified:false,authority:'NONE'});
  const representation=Object.freeze({text,descriptor,input_sha256:digest(descriptor)});
  representations.set(representation,{view,unit_id:unit.id,unit_ref:digest(ref)});
  return representation;
}

export function nativeRepresentationWindow(representation,{start=0,end=representation?.text?.length}={}) {
  const bound=representations.get(representation);if(!bound)throw new Error('Authenticated native representation required');
  exactRange({start,end},representation.text,'Representation window');
  const parts=[],sources=[];
  for(const part of representation.descriptor.parts){const low=Math.max(start,part.start),high=Math.min(end,part.end);if(high<=low)continue;
    if(part.kind==='literal_separator')parts.push(part.text.slice(low-part.start,high-part.start));
    else {const range={start:part.normalized_start+low-part.start,end:part.normalized_start+high-part.start,includeEndZeroWidth:high===part.end},encoded=bound.view.input(range);parts.push(encoded.text);sources.push({role:part.role,...encoded.normalized_range,source_sha256:sha(representation.text.slice(low,high)),projection_sha256:encoded.projection_sha256,encoded_sha256:sha(encoded.text),encoded_annotation_groups:encoded.encoded_annotation_groups,mapping_status:encoded.mapping_status,input_eligibility:encoded.input_eligibility,joint_whitespace_witnesses:encoded.joint_whitespace_witnesses});}
  }
  const text=parts.join('');return {text,representation_start:start,representation_end:end,source_ranges:sources,input_policy:NATIVE_DECORATION_INPUT_POLICY,mapping_status:representation.descriptor.mapping_status,input_eligibility:representation.descriptor.input_eligibility,envelope_sha256:representation.descriptor.envelope_sha256,window_annotations_self_contained:true,computed_style_verified:false,effectiveness_verified:false,sha256:sha(text)};
}

/** Cache/inference use the same identity, including source origins and marks. */
export function modelInputIdentity(unit) {
  if(unit.native_input!==undefined){const representation=unit.native_input,bound=representations.get(representation),declared=representation?.descriptor?.unit;if(!bound||bound.unit_id!==unit.id||declared.contract_id!==unit.contract_id||declared.cohort!==unit.cohort||declared.start!==unit.start||declared.end!==unit.end||declared.sha256!==unit.sha256||sha(unit.text)!==declared.sha256||!unit.native_source_decorations_ref||bound.unit_ref!==digest(unit.native_source_decorations_ref))throw new Error('Authenticated current native_input required for this unit');return {text:representation.text,input_sha256:representation.input_sha256,native_evidence_status:'BOUND_NATIVE_SOURCE_EVIDENCE',native_representation:representation.descriptor};}
  if(unit.native_source_decorations_ref!==undefined||unit.native_source_decorations!==undefined)throw new Error('Current native source reference requires authenticated native_input; plain fallback forbidden');
  const text=unit.contextual_text??unit.embedding_text??unit.text;if(typeof text!=='string')throw new Error('Unit has no embedding text');
  return {text,input_sha256:sha(text),native_evidence_status:LEGACY_NATIVE_STATUS};
}


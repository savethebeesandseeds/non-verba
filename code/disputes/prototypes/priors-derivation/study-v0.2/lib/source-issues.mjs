// SPDX-License-Identifier: AGPL-3.0-only
// An observed loss survives a method-version change until an actual bound replay.
import {readFile,readdir} from 'node:fs/promises';
import {parseFragment} from 'parse5';
import {digest,sha256,requireContainer} from '../../lib/common.mjs';
import {studyPath,readJSON,hashFile,writeJSON} from './store.mjs';
import {extractSections} from './sections.mjs';
import {loadNativeDecoration} from './native-decoration-store.mjs';
import {createNativeDecorationView} from './source-decoration.mjs';
import {createNativeSourceContext,createNativeRepresentation} from './representation.mjs';
import {prepareEmbeddingInput,createPinnedTokenCounter} from './embedding.mjs';
import {assertNoUnresolvedRepresentationIssues} from './representation-issues.mjs';

const HEX=/^[a-f0-9]{64}$/;
const ISSUE=/^issue-[a-f0-9]{64}\.json$/;
const MAX_ISSUES=1000;
const normalized=value=>value.replace(/\s+/gu,' ').trim();
const INLINE_POLICY='LEXICAL_INLINE_HTML_V1';
const PRIOR_ACTUAL_MODE='QUALIFIED_SOURCE_ONLY_PRIOR_ACTUAL_READING';
const NEW_ACTUAL_MODE='NEW_ACTUAL_CURRENT_VERSION_READING';
const NATIVE_CLASS='MATERIAL_NATIVE_CHANGE_MARKUP';
const NATIVE_REVIEW_MODE='NEW_ACTUAL_BOUNDED_NATIVE_CHANGE_REVIEW';
const NATIVE_LIMITS=['governing_parent_fully_read','whole_original_document_read','effectiveness_conditions_verified','clean_operative_version_derived','human'];
const NATIVE_ARMS=['baseline-heading-unit','baseline-parent-context','second-model-heading-unit','lexical-heading-unit'];
const INLINE_TAGS=new Set(['FONT','SPAN','B','I','U','S','STRIKE','STRONG','EM','SUP','SUB','SMALL','BIG','KBD']);
const INERT_TAGS=new Set(['SCRIPT','STYLE','TEMPLATE','HEAD','NOSCRIPT','SVG','CANVAS','IFRAME','OBJECT','EMBED']);
const TAG_ATTRIBUTES=/^(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?$/u;
function excludedAttributes(tail){
  // Parse only the already lexically validated attribute tail, never body text.
  // The existing extractor uses parse5's decoded attributes and these exact
  // exclusion rules. CSS classes, inherited/computed styles and STRIKE meaning
  // are deliberately outside this policy.
  const node=parseFragment('<span'+tail+'></span>').childNodes[0];
  const attrs=new Map((node?.attrs??[]).map(({name,value})=>[name,value]));
  return attrs.has('hidden')||attrs.get('aria-hidden')==='true'||/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(attrs.get('style')??'');
}
function rawLiteralPolicy(value){
  if(value!==undefined&&value!==INLINE_POLICY)throw new Error('Unsupported explicit raw literal matching policy');
  return value;
}
function hash(value){if(!HEX.test(value??''))throw new Error('Explicit SHA-256 required');return value;}
function sourceIdentity(source){const {sha256:claimed,...body}=source??{};if(hash(claimed)!==digest(body))throw new Error('Extraction source identity checksum differs');return claimed;}
async function boundJSON(run,reference,{maxBytes=16*1024**2}={}){
  if(typeof reference?.path!=='string')throw new Error('Literal bound artifact path required');
  const path=await studyPath(run,reference.path),actual=await hashFile(path);
  if(actual.sha256!==hash(reference.sha256)||reference.bytes!==undefined&&reference.bytes!==actual.bytes)throw new Error('Bound source-issue artifact bytes differ');
  return {value:await readJSON(run,reference.path,{maxBytes}),reference:{path:reference.path,...actual}};
}
async function commit(run,path,value){
  try{const retained=await readJSON(run,path,{maxBytes:128*1024});if(digest(retained)!==digest(value))throw new Error('Immutable source-issue receipt differs');return {path,...await hashFile(await studyPath(run,path)),resumed:true};}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return {...await writeJSON(run,path,value),resumed:false};
}
function ranges(value,length,{complete=false}={}){
  if(!Array.isArray(value)||!value.length||value.length>1000)throw new Error('Actual bounded reading ranges required');
  const sorted=value.map(pair=>{if(!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isSafeInteger)||pair[0]<0||pair[1]<=pair[0]||pair[1]>length)throw new Error('Invalid actual reading range');return [...pair];}).sort((a,b)=>a[0]-b[0]);
  const merged=[];for(const pair of sorted){const last=merged.at(-1);if(last&&pair[0]<=last[1])last[1]=Math.max(last[1],pair[1]);else merged.push(pair);}
  if(complete&&(merged.length!==1||merged[0][0]!==0||merged[0][1]!==length))throw new Error('Actual complete parent reading required');
  return merged;
}
function literals(evidence){
  const values=[evidence.literal_governor,...(evidence.schema==='literal-source-neighbor-boundary-finding-v1'?[evidence.literal_detached_qualification]:[...(evidence.literal_list_examples??[]),...(evidence.literal_cost_examples??[])])];
  if(values.length<2||values.length>100||values.some(value=>typeof value!=='string'||value.trim().length<10||value.length>20000))throw new Error('Literal governor and detached context evidence required');
  return [...new Set(values.map(normalized))];
}
// This is a narrow lexical projection, not HTML rendering or source correction.
// Formatting preserves native KBD/STRIKE text. Every excluded/unsupported token
// leaves a barrier, so visible letters cannot silently join across it.
function lexicalRawPieces(raw,readRanges){
  const spans=[],openInline=[],invalid=[];
  const span=(kind,start,end)=>{if(end>start)spans.push({kind,start,end});};
  function tagEnd(start){
    let quote=null;
    for(let i=start+1;i<raw.length;i++){
      const char=raw[i];if(quote){if(char===quote)quote=null;}
      else if(char==='"'||char==="'")quote=char;
      else if(char==='>')return i+1;
      else if(char==='<')return null;
    }
    return null;
  }
  function inertEnd(name,start,depth=0){
    if(depth>=64)return raw.length;
    if(name==='SCRIPT'||name==='STYLE'){
      const close=new RegExp('</'+name+'\\s*>','giu');close.lastIndex=start;const found=close.exec(raw);return found?close.lastIndex:raw.length;
    }
    let nesting=1;
    for(let offset=start;offset<raw.length;){
      offset=raw.indexOf('<',offset);if(offset<0)return raw.length;
      if(raw.startsWith('<!--',offset)){const close=raw.indexOf('-->',offset+4);if(close<0)return raw.length;offset=close+3;continue;}
      const end=tagEnd(offset);if(end===null)return raw.length;
      const match=/^<(\/?)([A-Za-z][A-Za-z0-9:-]*)([\s\S]*)>$/u.exec(raw.slice(offset,end));
      if(!match||!TAG_ATTRIBUTES.test(match[3])||match[1]&&match[3].trim())return raw.length;
      const nested=match[2].toUpperCase();
      if(nested===name){nesting+=match[1]?-1:1;if(nesting===0)return end;}
      else if(!match[1]&&INERT_TAGS.has(nested)){offset=inertEnd(nested,end,depth+1);continue;}
      offset=end;
    }
    return raw.length;
  }
  for(let offset=0;offset<raw.length;){
    if(raw.startsWith('<!--',offset)){
      const close=raw.indexOf('-->',offset+4),end=close<0?raw.length:close+3;span('barrier',offset,end);offset=end;continue;
    }
    if(raw[offset]==='<'){
      const end=tagEnd(offset);if(end===null){span('barrier',offset,raw.length);break;}
      const token=raw.slice(offset,end),match=/^<(\/?)([A-Za-z][A-Za-z0-9:-]*)([\s\S]*)>$/u.exec(token);
      if(!match||!TAG_ATTRIBUTES.test(match[3])||match[1]&&match[3].trim()){
        if(match&&(INLINE_TAGS.has(match[2].toUpperCase())||INERT_TAGS.has(match[2].toUpperCase()))){
          const close=new RegExp('</'+match[2]+'\\s*>','giu');close.lastIndex=end;const found=close.exec(raw),stop=found?close.lastIndex:raw.length;
          span('barrier',offset,stop);offset=stop;continue;
        }
        span('barrier',offset,end);offset=end;continue;
      }
      const closing=!!match[1],name=match[2].toUpperCase(),selfClosing=/\/\s*>$/u.test(token);
      if(!closing&&(INERT_TAGS.has(name)||excludedAttributes(match[3]))){
        // No literal in an inert element, its attributes, or its hidden text is
        // evidence. Missing closure excludes the remainder rather than guessing.
        const stop=inertEnd(name,end);
        span('barrier',offset,stop);offset=stop;continue;
      }
      if(INLINE_TAGS.has(name)&&!selfClosing){
        if(!closing){openInline.push({name,start:offset});span('inline',offset,end);}
        else if(openInline.at(-1)?.name===name){openInline.pop();span('inline',offset,end);}
        else{invalid.push([openInline.at(-1)?.start??offset,end]);span('barrier',offset,end);}
      }else span('barrier',offset,end);
      offset=end;continue;
    }
    if(raw[offset]==='&'){
      const whitespace=/^&(?:[nN][bB][sS][pP]|#0*160|#[xX]0*[aA]0);/u.exec(raw.slice(offset,offset+32));
      if(whitespace){span('space',offset,offset+whitespace[0].length);offset+=whitespace[0].length;}
      else{const entity=/^&[A-Za-z0-9#]{1,30};/u.exec(raw.slice(offset,offset+32));const end=offset+(entity?.[0].length??1);span('barrier',offset,end);offset=end;}
      continue;
    }
    let end=offset+1;while(end<raw.length&&raw[end]!=='<'&&raw[end]!=='&')end++;
    span('text',offset,end);offset=end;
  }
  for(const opened of openInline)invalid.push([opened.start,raw.length]);
  // Keep the original intervals here. Even adjacent intervals must not jointly
  // support a complete literal that no individual output actually supplied.
  return readRanges.map(([left,right])=>{
    const pieces=[];
    for(const item of spans){
      if(item.end<=left||item.start>=right)continue;
      const start=Math.max(left,item.start),end=Math.min(right,item.end);
      if(invalid.some(([a,b])=>start<b&&end>a)){pieces.push('\0');continue;}
      if(item.kind==='text')pieces.push(raw.slice(start,end));
      else if(item.kind==='space'&&start===item.start&&end===item.end)pieces.push(' ');
      else if(item.kind!=='inline'||start!==item.start||end!==item.end)pieces.push('\0');
    }
    return normalized(pieces.join(''));
  });
}
function requireReadLiterals(raw,readRanges,required,policy){
  rawLiteralPolicy(policy);const checked=ranges(readRanges,raw.length);
  if(policy&&required.some(value=>value.includes('\0')))throw new Error('Unsupported literal control character');
  const pieces=policy?lexicalRawPieces(raw,readRanges):checked.map(([start,end])=>normalized(raw.slice(start,end)));
  if(required.some(value=>!pieces.some(piece=>piece.includes(value))))throw new Error('Actual raw reading ranges do not cover the literal issue context');
}
function parentFromCache(normalizedText,parents,contractId,reference){
  const parent=parents?.find(row=>row.id===reference?.id);
  if(!parent||parent.contract_id!==contractId||parent.start!==reference.start||parent.end!==reference.end||parent.sha256!==reference.sha256||sha256(normalizedText.slice(parent.start,parent.end))!==parent.sha256)throw new Error('Issue parent boundary or text differs');
  return parent;
}
function checkedSnippet(source,reference,readRanges){
  const actualRanges=ranges(readRanges,source.length),snippet=reference?.actual_read_snippet;
  if(!snippet||!Number.isSafeInteger(snippet.start)||!Number.isSafeInteger(snippet.end)||snippet.start<0||snippet.end<=snippet.start||snippet.end>source.length||snippet.end-snippet.start>20000||!actualRanges.some(([start,end])=>start<=snippet.start&&end>=snippet.end)||snippet.text!==source.slice(snippet.start,snippet.end)||sha256(snippet.text)!==hash(snippet.sha256))throw new Error('Observed issue snippet bytes, hash or actual reading coverage differ');
  return snippet;
}

async function extractedParent(run,manifestRef,contractId,parentRef,rawRef){
  const {value:extraction,reference:manifest}=await boundJSON(run,manifestRef),sourceSHA=sourceIdentity(extraction.source);
  const record=extraction.contract_records?.find(row=>row.id===contractId),receipt=extraction.cache?.find(row=>row.id===contractId);
  if(!record||!receipt||record.status!=='accepted')throw new Error('Issue parent must bind an accepted extracted contract');
  const {value:cache,reference:cacheRef}=await boundJSON(run,receipt,{maxBytes:64*1024**2});
  if(cache.contract?.id!==contractId||cache.source?.sha256!==sourceSHA||receipt.source_sha256!==sourceSHA||cache.raw_sha256!==record.raw_sha256||sha256(cache.normalized_text)!==cache.normalized_sha256)throw new Error('Issue cache, source or normalized lineage differs');
  if(receipt.result_sha256!==undefined&&receipt.result_sha256!==digest(cache))throw new Error('Issue cache result receipt differs');
  const parent=parentFromCache(cache.normalized_text,cache.sections,contractId,parentRef);
  if(rawRef.path!==cache.contract.path||rawRef.sha256!==record.raw_sha256)throw new Error('Issue raw source scope differs');
  const rawPath=await studyPath(run,rawRef.path),actualRaw=await hashFile(rawPath);
  if(actualRaw.sha256!==rawRef.sha256||actualRaw.bytes>4*1024**2)throw new Error('Issue raw source bytes differ or exceed study contract bound');
  if(record.normalized_path){const actual=await hashFile(await studyPath(run,record.normalized_path));if(actual.sha256!==record.normalized_sha256||actual.sha256!==cache.normalized_sha256)throw new Error('Issue normalized artifact differs');}
  return {sourceSHA,source:extraction.source,manifest,cacheRef,cache,record,parent,parents:cache.sections,normalizedText:cache.normalized_text,normalizedRef:record.normalized_path?{path:record.normalized_path,sha256:record.normalized_sha256}:null,text:cache.normalized_text.slice(parent.start,parent.end),raw:await readFile(rawPath,'utf8'),rawRef:{path:rawRef.path,...actualRaw}};
}

function nativeSnippet(source,snippet,readRanges){
  const result=checkedSnippet(source,{actual_read_snippet:snippet},readRanges);
  if(!readRanges.some(([start,end])=>start<=result.start&&end>=result.end))throw new Error('Native-change snippet must fit one actual reading interval');
  return result;
}
function containsSpan(context,part){return context.start<=part.start&&context.end>=part.end;}
function nativeMarks(raw,occurrence){
  const parsed=parseFragment(occurrence.text,{sourceCodeLocationInfo:true}),elements=parsed.childNodes.filter(node=>node.tagName);
  if(elements.length!==2||new Set(elements.map(node=>node.tagName)).size!==2||elements.some(node=>!['strike','u'].includes(node.tagName))||parsed.childNodes.some(node=>!node.tagName&&(node.nodeName!=='#text'||!/^[\s%]*$/u.test(node.value))))throw new Error('Exact supported native STRIKE/U markup pair required');
  return elements.map(node=>{
    const loc=node.sourceCodeLocation;if(!loc?.startTag||!loc.endTag)throw new Error('Complete native style element required');
    const start=occurrence.start+loc.startOffset,end=occurrence.start+loc.endOffset,text=raw.slice(start,end),literal=lexicalRawPieces(raw,[[start,end]])[0];
    if(!literal||literal.includes('\0')||literal.length>2000)throw new Error('Native style text is omitted, malformed or unsupported');
    return {native_element:node.tagName.toUpperCase(),start,end,sha256:sha256(text),text,literal_text:literal};
  });
}
async function nativeEvidence(run,evidence,evidenceRef,packetRef,row,parent,original){
  if(evidence.status!=='FAILED_PARTIAL_SOURCE_REVIEW'||evidence.material_loss_observed!==true||evidence.unresolved_material_loss!==true||evidence.extraction_source_sha256!==original.sourceSHA||evidence.sampled_parent.scope!=='REFERENCE_ONLY'||['sampled_parent_fully_read','governing_parent_fully_read','whole_original_document_read','effectiveness_conditions_verified','clean_operative_version_derived','human','adopted'].some(key=>evidence[key]!==false)||evidence.raw_literal_matching_policy!==undefined)throw new Error('Explicit partial native-change review scope required');
  if(evidence.cache?.path!==original.cacheRef.path||evidence.cache.sha256!==original.cacheRef.sha256||evidence.cache.bytes!==original.cacheRef.bytes||evidence.raw.bytes!==original.rawRef.bytes||evidence.normalized?.path!==original.normalizedRef?.path||evidence.normalized.sha256!==original.normalizedRef?.sha256)throw new Error('Native-change full source/cache artifact binding differs');
  const normalizedRef={path:original.normalizedRef.path,...await hashFile(await studyPath(run,original.normalizedRef.path))};
  if(evidence.normalized.bytes!==normalizedRef.bytes)throw new Error('Native-change normalized source byte count differs');
  if(evidence.extraction_manifest&&digest(evidence.extraction_manifest)!==digest(original.manifest))throw new Error('Native-change extraction manifest differs');
  let focal=null;
  if(evidence.sampled_focal!==undefined){if(evidence.sampled_focal.scope!=='REFERENCE_ONLY'||evidence.sampled_focal.id!==row.id)throw new Error('Native-change sampled focal must remain the packet reference only');focal=replayFocal(original,evidence.sampled_focal);}
  ranges(evidence.raw.actual_read_ranges,original.raw.length);ranges(evidence.normalized.actual_read_ranges,original.normalizedText.length);
  const instructions=nativeSnippet(original.raw,evidence.raw.source_instruction_and_effectiveness_context,evidence.raw.actual_read_ranges);
  if(instructions.text.length<20||!Array.isArray(evidence.occurrences)||!evidence.occurrences.length||evidence.occurrences.length>50)throw new Error('Actual native instruction/effectiveness context and bounded occurrences required');
  const ids=new Set(),rawStarts=new Set(),normalizedStarts=new Set(),occurrences=[];
  for(const item of evidence.occurrences){
    if(typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/u.test(item.id)||ids.has(item.id)||typeof item.context_anchor!=='string'||item.context_anchor.trim().length<10||item.context_anchor.length>200)throw new Error('Distinct native occurrence ID and literal context anchor required');
    ids.add(item.id);
    const rawOccurrence=nativeSnippet(original.raw,item.raw_occurrence,evidence.raw.actual_read_ranges),rawContext=nativeSnippet(original.raw,item.raw_context,evidence.raw.actual_read_ranges),normalizedOccurrence=nativeSnippet(original.normalizedText,item.normalized_occurrence,evidence.normalized.actual_read_ranges),normalizedContext=nativeSnippet(original.normalizedText,item.normalized_context,evidence.normalized.actual_read_ranges);
    if(rawStarts.has(rawOccurrence.start)||normalizedStarts.has(normalizedOccurrence.start))throw new Error('Duplicate native occurrence coordinates');
    rawStarts.add(rawOccurrence.start);normalizedStarts.add(normalizedOccurrence.start);
    const affected=parentFromCache(original.normalizedText,original.parents,evidence.contract_id,item.affected_parent_reference);
    if(!containsSpan(rawContext,rawOccurrence)||!containsSpan(normalizedContext,normalizedOccurrence)||!containsSpan(affected,normalizedContext)||!lexicalRawPieces(original.raw,[[rawContext.start,rawContext.end]])[0].includes(normalized(item.context_anchor))||!normalized(normalizedContext.text).includes(normalized(item.context_anchor)))throw new Error('Native occurrence context/affected-parent association differs');
    const marks=nativeMarks(original.raw,rawOccurrence);
    if(marks.map(mark=>mark.literal_text).join('')!==normalizedOccurrence.text)throw new Error('Declared flattened native text differs from the exact marked source');
    occurrences.push({id:item.id,context_anchor:item.context_anchor,raw_occurrence:rawOccurrence,raw_context:rawContext,normalized_occurrence:normalizedOccurrence,normalized_context:normalizedContext,affected_parent_reference:{id:affected.id,start:affected.start,end:affected.end,sha256:affected.sha256},native_style_spans:marks});
  }
  const artifacts=[];
  if(evidence.supporting_technical_artifacts!==undefined){
    if(!Array.isArray(evidence.supporting_technical_artifacts)||evidence.supporting_technical_artifacts.length>20)throw new Error('Bounded technical artifact references required');
    for(const ref of evidence.supporting_technical_artifacts){const actual={path:ref.path,...await hashFile(await studyPath(run,ref.path))};if(actual.sha256!==hash(ref.sha256)||actual.bytes!==ref.bytes)throw new Error('Native-change supporting artifact bytes differ');artifacts.push(actual);}
  }
  return {evidence,evidenceRef,packetRef,original,parent,native:{normalized:normalizedRef,sampled_parent:{...parent,scope:'REFERENCE_ONLY'},...(focal?{sampled_focal:{...focal,scope:'REFERENCE_ONLY'}}:{}),source_instruction_and_effectiveness_context:instructions,occurrences,supporting_technical_artifacts:artifacts,observed_reading_scope:{mode:'PARTIAL_NATIVE_CHANGE_SOURCE_REVIEW',sampled_parent_fully_read:false,governing_parent_fully_read:false,whole_original_document_read:false,effectiveness_conditions_verified:false,clean_operative_version_derived:false,raw_actual_read_ranges:evidence.raw.actual_read_ranges,normalized_actual_read_ranges:evidence.normalized.actual_read_ranges,interpretation:'NATIVE_TAG_NAMES_AND_LITERAL_TEXT_ONLY; NO_DELETION_ADDITION_OR_OPERATIVE_VERSION_DERIVED'}}};
}

async function observedEvidence(run,reference){
  const {value:evidence,reference:evidenceRef}=await boundJSON(run,reference,{maxBytes:128*1024});
  const rawMatchingPolicy=rawLiteralPolicy(evidence.raw_literal_matching_policy);
  const neighbor=evidence.schema==='literal-source-neighbor-boundary-finding-v1',native=evidence.schema==='native-change-markup-finding-v1';
  if(!native&&!neighbor&&evidence.schema!=='literal-source-boundary-finding-v1'||typeof evidence.finding!=='string'||evidence.finding.length<20||!evidence.reviewer_kind||evidence.authority!=='NONE')throw new Error('Actual supported source-integrity finding required');
  const {value:packet,reference:packetRef}=await boundJSON(run,evidence.packet);
  sourceIdentity(packet.source);const rows=packet.rows?.filter(row=>row.audit_id===evidence.audit_id);
  if(rows?.length!==1||rows[0].contract_id!==evidence.contract_id)throw new Error('Issue audit identity or contract differs');
  const row=rows[0],parent=neighbor||native?{id:evidence.sampled_parent?.id,start:evidence.sampled_parent?.start,end:evidence.sampled_parent?.end,sha256:evidence.sampled_parent?.sha256}:{id:row.parent.id,start:evidence.parent?.normalized_start,end:evidence.parent?.normalized_end,sha256:evidence.parent?.sha256};
  if(parent.id!==row.parent.id||parent.start!==row.parent.start||parent.end!==row.parent.end||parent.sha256!==row.parent.sha256||!neighbor&&!native&&evidence.parent.characters!==parent.end-parent.start)throw new Error('Issue observation differs from supplied audit parent');
  const original=await extractedParent(run,packet.source.input_manifest,evidence.contract_id,parent,evidence.raw);
  if(original.sourceSHA!==packet.source.extraction_source?.sha256||row.lineage?.cache_path!==original.cacheRef.path||row.lineage.cache_sha256!==original.cacheRef.sha256||row.lineage.raw_path!==original.rawRef.path||row.lineage.raw_sha256!==original.rawRef.sha256)throw new Error('Issue audit source lineage differs');
  if(native)return nativeEvidence(run,evidence,evidenceRef,packetRef,row,parent,original);
  if(neighbor){
    if(evidence.status!=='FAILED_PARTIAL_SOURCE_REVIEW'||evidence.material_loss_observed!==true||evidence.unresolved_material_loss!==true||evidence.affected_governing_parent_fully_read!==false||evidence.extraction_source_sha256!==original.sourceSHA||evidence.cache?.path!==original.cacheRef.path||evidence.cache.sha256!==original.cacheRef.sha256||evidence.normalized?.path!==original.normalizedRef?.path||evidence.normalized.sha256!==original.normalizedRef?.sha256||!Array.isArray(evidence.affected_parents)||evidence.affected_parents.length!==2)throw new Error('Actual partial neighboring-parent source binding required');
    ranges(evidence.sampled_parent.actual_read_ranges,original.text.length,{complete:true});
    const affected=evidence.affected_parents.map(reference=>parentFromCache(original.normalizedText,original.parents,evidence.contract_id,reference));
    const index=original.parents.findIndex(value=>value.id===affected[0].id);
    if(affected.some(value=>value.id===parent.id)||original.parents[index+1]?.id!==affected[1].id||affected[1].start<affected[0].end||original.normalizedText.slice(affected[0].end,affected[1].start).trim())throw new Error('Affected operative parents must be actual adjacent spans distinct from the sampled anchor');
    const observed=ranges(evidence.affected_parent_actual_normalized_read_ranges,original.normalizedText.length),allRead=ranges(evidence.normalized.actual_read_ranges,original.normalizedText.length);
    if(!allRead.some(([start,end])=>start<=parent.start&&end>=parent.end)||observed.some(([start,end])=>!allRead.some(([left,right])=>left<=start&&right>=end))||observed.some(([start,end])=>start<=affected[0].start&&end>=affected[0].end))throw new Error('Partial neighboring-parent reading scope differs');
    const normalizedSnippet=checkedSnippet(original.normalizedText,evidence.normalized,evidence.affected_parent_actual_normalized_read_ranges),rawSnippet=checkedSnippet(original.raw,evidence.raw,evidence.raw.actual_read_ranges),required=literals(evidence);
    const before=normalized(original.normalizedText.slice(affected[0].start,affected[0].end)),after=normalized(original.normalizedText.slice(affected[1].start,affected[1].end));
    if(!before.endsWith(required[0])||before.includes(required[1])||!after.startsWith(required[1])||after.includes(required[0])||required.some(value=>!normalized(normalizedSnippet.text).includes(value)||!rawMatchingPolicy&&!normalized(rawSnippet.text).includes(value)))throw new Error('Literal governor and qualification are not evidenced across the observed adjacent boundary');
    if(rawMatchingPolicy)requireReadLiterals(original.raw,[[rawSnippet.start,rawSnippet.end]],required,rawMatchingPolicy);
    requireReadLiterals(original.normalizedText,evidence.affected_parent_actual_normalized_read_ranges,required);requireReadLiterals(original.raw,evidence.raw.actual_read_ranges,required,rawMatchingPolicy);
    return {evidence,evidenceRef,packetRef,original,required,rawMatchingPolicy,parent:{id:affected[0].id,start:affected[0].start,end:affected[0].end,sha256:affected[0].sha256},neighbor:{sampled_parent:parent,affected_parents:affected.map(({id,start,end,sha256})=>({id,start,end,sha256})),observed_reading_scope:{mode:'PARTIAL_NEIGHBOR_SOURCE',affected_governing_parent_fully_read:false,sampled_parent_actual_read_ranges:evidence.sampled_parent.actual_read_ranges,affected_parent_actual_normalized_read_ranges:evidence.affected_parent_actual_normalized_read_ranges,normalized_actual_read_ranges:evidence.normalized.actual_read_ranges,raw_actual_read_ranges:evidence.raw.actual_read_ranges}}};
  }
  ranges(evidence.parent.actual_read_ranges,original.text.length,{complete:true});
  const required=literals(evidence);requireReadLiterals(original.raw,evidence.raw.actual_read_ranges,required,rawMatchingPolicy);
  const oldText=normalized(original.text);
  if(!oldText.includes(required[0])||required.slice(1).every(value=>oldText.includes(value)))throw new Error('No evidenced detached literal context outside the observed parent');
  return {evidence,evidenceRef,packetRef,original,required,parent,rawMatchingPolicy};
}
function issueBody(found){
  if(found.native){
    const body={schema:'observed-source-issue-v1',status:'UNRESOLVED',classification:NATIVE_CLASS,extraction_source_sha256:found.original.sourceSHA,evidence:found.evidenceRef,packet:found.packetRef,extraction_manifest:found.original.manifest,audit_id:found.evidence.audit_id,contract_id:found.evidence.contract_id,parent:found.parent,raw:found.original.rawRef,native_change_evidence:found.native,authority:'NONE',execution_attested:false};
    if(Buffer.byteLength(JSON.stringify(body))>120*1024)throw new Error('Native-change issue exceeds its bounded immutable receipt');
    return body;
  }
  return {schema:'observed-source-issue-v1',status:'UNRESOLVED',classification:'MATERIAL_BOUNDARY',extraction_source_sha256:found.original.sourceSHA,evidence:found.evidenceRef,packet:found.packetRef,extraction_manifest:found.original.manifest,audit_id:found.evidence.audit_id,contract_id:found.evidence.contract_id,parent:found.parent,raw:found.original.rawRef,required_preserved_literals:found.required,...(found.neighbor??{}),...(found.rawMatchingPolicy?{raw_literal_matching_policy:found.rawMatchingPolicy}:{}),authority:'NONE',execution_attested:false};
}

/** Register an actual observed material boundary loss; hashes never assert reading. */
export async function registerObservedSourceIssue(run,{evidencePath,evidenceSHA}={}){
  requireContainer();const found=await observedEvidence(run,{path:evidencePath,sha256:evidenceSHA});
  const body=issueBody(found);
  const issueId=`issue-${digest(body)}`,receipt={...body,issue_id:issueId};
  const result=await commit(run,`source-issues/observed/${issueId}.json`,receipt);
  return {status:'UNRESOLVED',issue_id:issueId,source_sha256:body.extraction_source_sha256,...result};
}

async function verifiedIssue(run,reference){
  const {value:issue,reference:issueRef}=await boundJSON(run,reference,{maxBytes:128*1024});
  const {issue_id:issueId,...body}=issue;
  if(issue.schema!=='observed-source-issue-v1'||issue.status!=='UNRESOLVED'||!['MATERIAL_BOUNDARY',NATIVE_CLASS].includes(issue.classification)||issueId!==`issue-${digest(body)}`||issueRef.path!==`source-issues/observed/${issueId}.json`)throw new Error('Observed source-issue receipt identity differs');
  const found=await observedEvidence(run,issue.evidence);
  if(digest(body)!==digest(issueBody(found)))throw new Error('Observed source-issue receipt scope differs');
  return {issue,issueRef,found};
}

function replayFocal(repaired,reference){
  if(reference===undefined)return null;
  const unit=repaired.parent.units?.find(value=>value.id===reference?.id);
  if(!unit||reference.start!==unit.start||reference.end!==unit.end||reference.sha256!==unit.sha256||unit.parent_section_id!==repaired.parent.id||unit.start<repaired.parent.start||unit.end>repaired.parent.end||sha256(repaired.normalizedText.slice(unit.start,unit.end))!==unit.sha256)throw new Error('Replay focal source binding differs');
  return {id:unit.id,start:unit.start,end:unit.end,sha256:unit.sha256};
}
function qualificationLimits(value){
  const keys=['scope','heading_reviewed','navigation_reviewed','whole_cache_read','new_body_read','notes'];
  if(!value||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||value.scope!=='PRIOR_ACTUAL_PARENT_AND_DECLARED_RAW_RANGES_ONLY'||['heading_reviewed','navigation_reviewed','whole_cache_read','new_body_read'].some(key=>value[key]!==false)||typeof value.notes!=='string'||value.notes.trim().length<20||value.notes.length>10000)throw new Error('Explicit source-only qualification contextual limits required');
  return value;
}

async function nativeMethodIdentity(){
  const names=['source-issues.mjs','representation-issues.mjs','representation-replay.mjs','source-decoration.mjs','native-decoration-store.mjs','sections.mjs','representation.mjs','embedding.mjs','analysis.mjs','sensitivity.mjs'];
  const files=[];for(const path of names)files.push({path,sha256:sha256(await readFile(new URL(path,import.meta.url)))});
  return files;
}
async function nativeRegistryIdentity(run,snapshot){
  const entries=await readdir(await studyPath(run,'source-issues/observed'),{withFileTypes:true});
  if(entries.length>MAX_ISSUES||entries.some(item=>!item.isFile()||!ISSUE.test(item.name)))throw new Error('Bound native registry has unsupported entries');
  const issues=[];for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){const path=`source-issues/observed/${entry.name}`,actual=await hashFile(await studyPath(run,path));const found=await verifiedIssue(run,{path,...actual});issues.push(found.issueRef);}
  if(snapshot!==undefined){
    if(!Array.isArray(snapshot)||!snapshot.length||snapshot.length>issues.length||new Set(snapshot.map(ref=>ref.path)).size!==snapshot.length||digest(snapshot)!==digest([...snapshot].sort((a,b)=>a.path.localeCompare(b.path)))||snapshot.some(ref=>!issues.some(current=>digest(current)===digest(ref))))throw new Error('Retained native registry snapshot references differ');
    return {observed_issues:snapshot,observed_issues_sha256:digest(snapshot)};
  }
  return {observed_issues:issues,observed_issues_sha256:digest(issues)};
}
function nativeScope(value){
  if(!value||NATIVE_LIMITS.some(key=>value[key]!==false)||value.authority!=='NONE')throw new Error('Explicit bounded native review scope required; whole-read/effectiveness/operative-version claims forbidden');
}
function exactNativeRef(value,expected,label){if(digest(value??null)!==digest(expected??null))throw new Error(`Native ${label} differs from recomputed evidence`);}
function sourceRange(text,start,end){return {start,end,sha256:sha256(text.slice(start,end))};}
function rawOrigins(envelope,start,end){
  const runs=new Map(envelope.trace.runs.map(run=>[run.id,run]));
  const segments=envelope.segments.filter(segment=>segment.sources.some(origin=>{const run=runs.get(origin.run_id);return run&&run.raw.start>=start&&run.raw.end<=end;}));
  if(!segments.length)throw new Error('Original raw interval has no current collector origin');
  return segments;
}
function markOrigins(envelope,raw,observed){
  const marks=[];
  for(const old of observed.native_style_spans){
    const candidates=envelope.trace.sources.filter(mark=>mark.native_tag===old.native_element.toLowerCase()&&mark.element_scope?.raw_interval_verified===true&&mark.element?.start===old.start&&mark.element.end===old.end&&mark.element.binding==='WHOLE_RAW_SHA256_AND_EXACT_UTF16_INTERVAL_V1'&&mark.element.raw_sha256===envelope.raw.sha256&&sha256(raw.slice(mark.element.start,mark.element.end))===old.sha256);
    if(candidates.length!==1)throw new Error('Original native tag interval/hash has no unique current source identity');
    const mark=candidates[0],paths=new Map(envelope.trace.paths.map(path=>[path.id,path]));
    if(!mark.start_tag||!mark.end_tag||mark.start_tag.sha256!==sha256(raw.slice(mark.start_tag.start,mark.start_tag.end))||mark.end_tag.sha256!==sha256(raw.slice(mark.end_tag.start,mark.end_tag.end)))throw new Error('Native tag boundaries differ');
    const descends=run=>{let id=run.path_id;for(let depth=0;id&&depth<=paths.size;depth++){const path=paths.get(id);if(!path)throw new Error('Native origin path missing');if(path.source_id===mark.id)return true;id=path.parent_id;}if(id)throw new Error('Native origin path cycle');return false;};
    const runs=envelope.trace.runs.filter(run=>run.raw.start>=mark.start_tag.end&&run.raw.end<=mark.end_tag.start&&descends(run));
    if(!runs.length||runs.some(run=>run.raw.sha256!==sha256(raw.slice(run.raw.start,run.raw.end)))||runs.map(run=>run.decoded_text).join('')!==old.literal_text)throw new Error('Original native raw text-run identity differs');
    const ids=new Set(runs.map(run=>run.id)),segments=envelope.segments.filter(segment=>segment.sources.some(origin=>ids.has(origin.run_id)));
    if(!segments.length||segments.some(segment=>segment.mapping!=='EXACT_COLLECTOR_ORIGIN'||segment.sources.some(origin=>!ids.has(origin.run_id))))throw new Error('Native mark lacks exact independent collector origins');
    marks.push({native_element:old.native_element,source_id:mark.id,element:mark.element,start_tag:mark.start_tag,end_tag:mark.end_tag,runs:runs.map(run=>({id:run.id,raw:run.raw,decoded_sha256:run.decoded_sha256})),normalized_ranges:segments.map(segment=>({start:segment.start,end:segment.end,sha256:segment.sha256,sources:segment.sources,normalization:segment.normalization}))});
  }
  if(marks.length!==2||marks[0].native_element!=='STRIKE'||marks[1].native_element!=='U')throw new Error('Both original STRIKE/U marks required');
  return marks;
}
function fixedContextRange(text,unit,parent){
  const before=[...text.slice(parent.start,unit.start).matchAll(/\S+/gu)],after=[...text.slice(unit.end,parent.end).matchAll(/\S+/gu)];
  let left=Math.min(30,before.length),right=Math.min(30,after.length);left+=Math.min(60-left-right,before.length-left);right+=Math.min(60-left-right,after.length-right);
  return {start:left?parent.start+before[before.length-left].index:unit.start,end:right?unit.end+after[right-1].index+after[right-1][0].length:unit.end};
}

/** Machine evidence only. No reading is inferred and no resolution is written.
 * Rebuild from exact raw source before trusting any retained envelope seal. */
export async function prepareNativeChangeReplayEvidence(run,{issuePath,issueSHA,extraction_manifest,parent,raw,second_model_manifest,registrySnapshot}={}){
  requireContainer();const {issue,issueRef}=await verifiedIssue(run,{path:issuePath,sha256:issueSHA});
  if(issue.classification!==NATIVE_CLASS)throw new Error('Dedicated native evidence requires a native-change issue');
  const repaired=await extractedParent(run,extraction_manifest,issue.contract_id,parent,raw);
  if(!['discovery-broad','discovery-relevant'].includes(repaired.cache.contract.cohort))throw new Error('Native replay cannot open sealed or undeclared source cohorts');
  if(digest(repaired.rawRef)!==digest(issue.raw))throw new Error('Native replay requires the exact original raw artifact');
  const method=await nativeMethodIdentity(),file=name=>method.find(item=>item.path===name).sha256;
  for(const name of ['source-decoration.mjs','sections.mjs'])if(repaired.source.files?.find(item=>item.path===name)?.sha256!==file(name))throw new Error('Current native extraction method identity differs');
  const recipe=await readJSON(run,'recipe.json'),comparison=JSON.parse(await readFile(new URL('../comparison-recipe.json',import.meta.url),'utf8'));
  exactNativeRef(repaired.source.parameters?.extraction,recipe.extraction,'recipe extraction profile');
  exactNativeRef(repaired.source.parameters?.native_input_profile,{baseline_embedding:recipe.embedding},'baseline model-input profile');
  if(repaired.source.files?.find(item=>item.path==='../comparison-recipe.json')?.sha256!==sha256(await readFile(new URL('../comparison-recipe.json',import.meta.url))))throw new Error('Native comparison profile differs from the extraction namespace');
  const identity={tracerSourceSHA256:file('source-decoration.mjs'),collectorSourceSHA256:file('sections.mjs')};
  const fresh=extractSections({...repaired.cache.contract,content:repaired.raw},{...recipe.extraction,nativeDecorationIdentity:identity});
  const envelope=await loadNativeDecoration(run,repaired.cache.native_source_decorations);
  if(repaired.cache.native_source_decorations?.schema!=='native-source-decoration-reference-v1'||digest(repaired.record.native_source_decorations)!==digest(repaired.cache.native_source_decorations))throw new Error('Current native replay requires the same lossless gzip envelope reference in cache and manifest');
  if(fresh.status!=='accepted'||envelope.mapping_status!=='EXACT_COLLECTOR_ORIGIN'||fresh.native_source_decorations.sha256!==envelope.sha256||digest(fresh.native_source_decorations)!==digest(envelope))throw new Error('Current native envelope differs from independently recomputed raw-source extraction');
  for(const key of ['contract','status','normalized_text','normalized_sha256','sections','units','parameters','warnings','excluded'])exactNativeRef(repaired.cache[key],fresh[key],`recomputed cache ${key}`);
  const view=createNativeDecorationView(envelope,{raw:repaired.raw,normalizedText:repaired.normalizedText}),context=createNativeSourceContext({raw:repaired.raw,normalizedText:repaired.normalizedText,envelope,expectedTracerSourceSHA256:identity.tracerSourceSHA256,expectedCollectorSourceSHA256:identity.collectorSourceSHA256});
  const occurrences=[];
  if(issue.native_change_evidence.occurrences.length!==2)throw new Error('Dedicated native replay requires both original observed occurrences');
  for(const observed of issue.native_change_evidence.occurrences){
    const marks=markOrigins(envelope,repaired.raw,observed),spans=marks.flatMap(mark=>mark.normalized_ranges),start=Math.min(...spans.map(span=>span.start)),end=Math.max(...spans.map(span=>span.end));
    const rawContext=observed.raw_context,contexts=rawOrigins(envelope,rawContext.start,rawContext.end),contextRange=sourceRange(repaired.normalizedText,Math.min(...contexts.map(span=>span.start)),Math.max(...contexts.map(span=>span.end)));
    const projection=view.project({...contextRange,includeEndZeroWidth:true}),input=view.input({...contextRange,includeEndZeroWidth:true});
    const containing=fresh.sections.filter(section=>section.start<=contextRange.start&&section.end>=contextRange.end);
    if(containing.length!==1)throw new Error('Both native occurrence and bounded context require one exact current parent');
    const unit=fresh.units.find(unit=>unit.parent_section_id===containing[0].id&&unit.start<=start&&unit.end>=end);
    if(!unit)throw new Error('Original native occurrence not contained in a current complete source unit');
    occurrences.push({id:observed.id,raw_occurrence:sourceRange(repaired.raw,observed.raw_occurrence.start,observed.raw_occurrence.end),raw_context:sourceRange(repaired.raw,rawContext.start,rawContext.end),marks,normalized_occurrence:sourceRange(repaired.normalizedText,start,end),normalized_context:contextRange,parent:{id:containing[0].id,...sourceRange(repaired.normalizedText,containing[0].start,containing[0].end)},unit:{id:unit.id,start:unit.start,end:unit.end,sha256:unit.sha256},projection:{range:projection.range,sha256:digest(projection)},encoded_context:{sha256:sha256(input.text),projection_sha256:input.projection_sha256,characters:input.text.length}});
  }
  const registry=await nativeRegistryIdentity(run,registrySnapshot);if(!registry.observed_issues.some(ref=>digest(ref)===digest(issueRef)))throw new Error('Native registry snapshot omits this issue');
  const binding={issue:issueRef,...registry,extraction_manifest:repaired.manifest,cache:repaired.cacheRef,raw:repaired.rawRef,normalized:repaired.normalizedRef,extraction_source_sha256:repaired.sourceSHA,envelope_sha256:envelope.sha256,native_reference:repaired.cache.native_source_decorations,method,recipe_extraction_sha256:digest(recipe.extraction),recipe_embedding_sha256:digest(recipe.embedding),comparison_recipe_sha256:digest(comparison)};
  const scope=Object.fromEntries(NATIVE_LIMITS.map(key=>[key,false]));
  const instruction=issue.native_change_evidence.source_instruction_and_effectiveness_context;
  const mechanical={schema:'native-change-mechanical-verification-v1',binding,occurrences,instruction_context:sourceRange(repaired.raw,instruction.start,instruction.end),source_authenticity_recomputed:true,...scope,authority:'NONE'};
  const {value:secondManifest,reference:secondRef}=await boundJSON(run,second_model_manifest),baseline=await createPinnedTokenCounter(recipe.embedding),second=await createPinnedTokenCounter(comparison.secondModel,{manifest:secondManifest});
  const arms=[];
  for(const id of NATIVE_ARMS){
    const counter=id==='second-model-heading-unit'?second:baseline,units=[];
    for(const occurrence of occurrences){const unit={...fresh.units.find(unit=>unit.id===occurrence.unit.id),cohort:fresh.contract.cohort},parent={...fresh.sections.find(parent=>parent.id===unit.parent_section_id),cohort:fresh.contract.cohort},bodyRange=id==='baseline-parent-context'?fixedContextRange(fresh.normalized_text,unit,parent):{start:unit.start,end:unit.end};
      const maxTokens=id==='second-model-heading-unit'?comparison.secondModel.max_tokens:recipe.embedding.max_tokens,overlapWords=recipe.embedding.overlap_words??16,maxWords=recipe.embedding.max_words_per_unit??4096;
      const prepared={...unit,native_input:createNativeRepresentation(unit,{context,parent,bodyRange})},plan=prepareEmbeddingInput(prepared,counter.tokenCount,{maxTokens,overlapWords,maxWords});
      if(plan.input.native_evidence_status!=='BOUND_NATIVE_SOURCE_EVIDENCE'||plan.windows.some(window=>window.tokens>maxTokens||window.tokens>256||window.sha256!==sha256(window.text)||!window.source_ranges.length||window.input_policy!==plan.policy.native_input))throw new Error('Actual native window/input readiness differs');
      const covers=(span,role)=>{let end=span.start;const ranges=plan.windows.flatMap(window=>window.source_ranges).filter(range=>role?range.role===role:range.role!=='literal_heading_part').sort((a,b)=>a.start-b.start||a.end-b.end);for(const range of ranges){if(range.start>end)break;if(range.end>end)end=range.end;if(end>=span.end)return true;}return false;};
      if(plan.input.native_representation.parts.length!==1||plan.input.native_representation.parts[0].kind!=='source'||plan.input.native_representation.parts[0].role!== (bodyRange.start===unit.start&&bodyRange.end===unit.end?'unit_body':'verified_parent_context'))throw new Error('Native replay requires exactly one contiguous source span without navigation promotion');
      if(plan.input.native_representation.parts.some(part=>!covers({start:part.normalized_start,end:part.normalized_end},part.role)))throw new Error('Final native windows omit selected source-span coverage');
      const covered=occurrence.marks.flatMap(mark=>mark.normalized_ranges).every(span=>covers(span));
      if(!covered)throw new Error('Final native windows omit an original marked source range');
      units.push({occurrence_id:occurrence.id,unit_id:unit.id,body_range:bodyRange,heading_status:'INTENTIONALLY_EXCLUDED_NAVIGATION_METADATA_ONLY',body_role:bodyRange.start===unit.start&&bodyRange.end===unit.end?'unit_body':'verified_parent_context',input:plan.input,window_policy:plan.policy,encoded_window_sha256:digest(plan.windows.map(window=>window.sha256)),lexical_assembly:id==='lexical-heading-unit'?'ENCODED_WINDOWS_JOINED_WITH_EXPLICIT_LF_SEPARATOR; NO_FIT':null});
    }
    arms.push({id,tokenizer_policy:counter.policy,tokenizer_policy_sha256:counter.policy_sha256,units});
  }
  const input_readiness={schema:'native-change-input-readiness-v1',binding,second_model_manifest:secondRef,arms,model_inference:false,fitting:false,...scope,authority:'NONE'};
  return {binding,mechanical_verification:mechanical,input_readiness};
}

async function verifiedNativeReplay(run,issue,issueRef,replay,reference,{retainedResolution=false}={}){
  if(replay.schema!=='native-change-issue-replay-v1'||replay.review_mode!==NATIVE_REVIEW_MODE||replay.newly_read_current_version!==true||['prior_actual_replay','prior_reading','qualification','required_preserved_literals'].some(key=>Object.hasOwn(replay,key)))throw new Error('NATIVE_CHANGE_RESOLUTION_NOT_SUPPORTED: dedicated newly actual bounded native review required; no qualification/literal bypass');
  nativeScope(replay);if(replay.contract_id!==issue.contract_id||typeof replay.reviewer!=='string'||replay.reviewer.trim().length<3||replay.repair_adequate!==true||replay.unresolved_material_loss!==false||replay.material_loss_observed!==false)throw new Error('Actual bounded native resolution judgment required');
  if(replay.issue?.path!==issueRef.path||replay.issue.sha256!==issueRef.sha256)throw new Error('Native replay issue differs');
  const refs=['mechanical_verification','input_readiness','actual_review'].map(key=>replay[key]);
  if(new Set(refs.map(ref=>ref?.path)).size!==3||refs.some(ref=>!Number.isSafeInteger(ref?.bytes)||ref.bytes<1||ref.path===reference.path||ref.path===issueRef.path))throw new Error('Three separate exact-byte native evidence artifacts required');
  const machine=await prepareNativeChangeReplayEvidence(run,{issuePath:issueRef.path,issueSHA:issueRef.sha256,extraction_manifest:replay.extraction_manifest,parent:replay.parent,raw:replay.raw,second_model_manifest:replay.second_model_manifest,...(retainedResolution?{registrySnapshot:replay.binding?.observed_issues}:{})});
  exactNativeRef(replay.binding,machine.binding,'replay binding');
  const mechanical=await boundJSON(run,replay.mechanical_verification),readiness=await boundJSON(run,replay.input_readiness),actual=await boundJSON(run,replay.actual_review,{maxBytes:128*1024});
  exactNativeRef(mechanical.value,machine.mechanical_verification,'mechanical artifact');exactNativeRef(readiness.value,machine.input_readiness,'readiness artifact');
  const review=actual.value;nativeScope(review);
  if(review.schema!=='native-change-actual-bounded-review-v1'||review.review_mode!==NATIVE_REVIEW_MODE||review.newly_read_current_version!==true||review.reviewer!==replay.reviewer||review.repair_adequate!==true||review.unresolved_material_loss!==false||review.material_loss_observed!==false||typeof review.reason!=='string'||review.reason.trim().length<20||typeof review.remaining_unknowns!=='string'||review.remaining_unknowns.trim().length<20||Object.hasOwn(review,'prior_actual_replay')||Object.hasOwn(review,'qualification'))throw new Error('Separate actual bounded native review and honest remaining unknowns required');
  exactNativeRef(review.binding,machine.binding,'actual review binding');exactNativeRef(review.mechanical_verification,mechanical.reference,'actual mechanical reference');exactNativeRef(review.input_readiness,readiness.reference,'actual readiness reference');
  const repaired=await extractedParent(run,replay.extraction_manifest,issue.contract_id,replay.parent,replay.raw);
  const readContains=(source,value,expected,label)=>{ranges(value,source.length);if(value.some(([start,end])=>end-start>20000||start<expected.start||end>expected.end)||value.reduce((n,[start,end])=>n+end-start,0)>100000||!value.some(([start,end])=>start<=expected.start&&end>=expected.end))throw new Error(`Actual native ${label} reading incomplete or outside bounded output`);};
  if(review.read_outputs_actually_displayed_and_read!==true||!Array.isArray(review.read_outputs)||review.read_outputs.length!==3||new Set(review.read_outputs.map(ref=>ref?.path)).size!==3)throw new Error('Separate bound displayed reader outputs and authored actual reading affirmation required');
  const view=createNativeDecorationView(await loadNativeDecoration(run,repaired.cache.native_source_decorations),{raw:repaired.raw,normalizedText:repaired.normalizedText});
  const outputs=new Map();
  for(const ref of review.read_outputs){
    if(!Number.isSafeInteger(ref.bytes)||ref.bytes<1)throw new Error('Native reader output exact byte binding required');
    const {value:output,reference:outputRef}=await boundJSON(run,ref,{maxBytes:1024*1024});
    if(output.schema!=='native-change-actual-read-output-v1'||output.actual_reading!==false||output.reader_source_sha256!==machine.binding.method.find(file=>file.path==='source-issues.mjs').sha256||output.envelope_sha256!==machine.binding.envelope_sha256||digest(output.cache_ref)!==digest(machine.binding.cache)||outputs.has(output.id))throw new Error('Native reader output source binding or scope differs');
    const expected=output.id==='instruction-context'?machine.mechanical_verification.instruction_context:machine.mechanical_verification.occurrences.find(row=>row.id===output.id)?.raw_context;
    if(!expected)throw new Error('Native reader output has an unsupported occurrence identity');
    exactNativeRef(output.raw,{path:repaired.rawRef.path,sha256:repaired.rawRef.sha256,range:{start:expected.start,end:expected.end},text:repaired.raw.slice(expected.start,expected.end)},'displayed raw output');
    if(output.id==='instruction-context'){if(output.normalized!==undefined||output.projection!==undefined)throw new Error('Instruction raw-only reading cannot imply normalized/projection reading');}
    else{const occurrence=machine.mechanical_verification.occurrences.find(row=>row.id===output.id),range=occurrence.normalized_context;
      exactNativeRef(output.normalized,{path:repaired.normalizedRef.path,sha256:repaired.normalizedRef.sha256,range:{start:range.start,end:range.end},text:repaired.normalizedText.slice(range.start,range.end)},'displayed normalized output');
      const projection=view.project({start:range.start,end:range.end,includeEndZeroWidth:true});exactNativeRef(output.projection,{range:projection.range,sha256:digest(projection),value:projection},'displayed projection output');
    }
    outputs.set(output.id,{output,reference:outputRef});
  }
  exactNativeRef(review.instruction_read_output,outputs.get('instruction-context')?.reference,'instruction reading output reference');
  readContains(repaired.raw,review.raw_actual_read_ranges,machine.mechanical_verification.instruction_context,'instruction/effectiveness context');
  if(!Array.isArray(review.occurrences)||review.occurrences.length!==2||new Set(review.occurrences.map(item=>item.id)).size!==2)throw new Error('Actual review must independently associate both occurrence IDs');
  for(const expected of machine.mechanical_verification.occurrences){const row=review.occurrences.find(row=>row.id===expected.id);if(!row||row.adequate!==true||typeof row.reason!=='string'||row.reason.trim().length<20||typeof row.remaining_unknowns!=='string'||row.remaining_unknowns.trim().length<20)throw new Error('Actual per-occurrence adequacy/reason/unknown association required');
    exactNativeRef(row.read_output,outputs.get(expected.id)?.reference,'occurrence reading output reference');
    for(const [key,wanted]of [['raw_occurrence',expected.raw_occurrence],['normalized_occurrence',expected.normalized_occurrence],['normalized_context',expected.normalized_context],['projection',expected.projection]])exactNativeRef(row[key],wanted,`actual ${key}`);
    readContains(repaired.raw,row.raw_actual_read_ranges,expected.raw_context,'raw occurrence/context');readContains(repaired.normalizedText,row.normalized_actual_read_ranges,expected.normalized_context,'normalized occurrence/context');
    readContains(repaired.normalizedText,row.projection_actual_read_ranges,expected.normalized_context,'projected occurrence/context');
  }
  const native={binding:machine.binding,mechanical_verification:mechanical.reference,input_readiness:readiness.reference,actual_review:actual.reference,review_mode:NATIVE_REVIEW_MODE,newly_read_current_version:true,...Object.fromEntries(NATIVE_LIMITS.map(key=>[key,false])),authority:'NONE'};
  return {reference,repaired,value:replay,native};
}
async function verifiedReplay(run,issue,issueRef,replayRef,{actualOnly=false,retainedResolution=false}={}){
  const {value:replay,reference}=await boundJSON(run,replayRef,{maxBytes:128*1024});
  if(issue.classification===NATIVE_CLASS)return verifiedNativeReplay(run,issue,issueRef,replay,reference,{retainedResolution});
  const qualified=replay.review_mode===PRIOR_ACTUAL_MODE;
  // Absence is the historical actual-reading declaration. An explicit mode or
  // flag must be understood; a no-new-reading claim cannot fall through as an
  // ordinary actual replay merely because it omits or misspells qualification.
  if(replay.review_mode!==undefined&&replay.review_mode!==PRIOR_ACTUAL_MODE&&replay.review_mode!==NEW_ACTUAL_MODE)throw new Error('Unsupported explicit source-issue replay review mode');
  if(replay.newly_read_current_version!==undefined&&typeof replay.newly_read_current_version!=='boolean')throw new Error('Explicit new-reading declaration must be boolean');
  if(actualOnly&&(qualified||replay.newly_read_current_version===false||replay.prior_actual_replay!==undefined||replay.prior_reading!==undefined||replay.qualification!==undefined))throw new Error('Qualification origin must be an original actual replay, never a qualified or chained origin');
  if(!qualified&&replay.newly_read_current_version===false)throw new Error('No-new-reading declaration requires supported source-only qualification and a bound actual origin');
  if(replay.prior_actual_replay!==undefined&&!qualified)throw new Error('Prior actual replay requires an explicit source-only qualification mode');
  if(rawLiteralPolicy(replay.raw_literal_matching_policy)!==issue.raw_literal_matching_policy)throw new Error('Repair replay raw literal matching policy differs from the observed issue');
  if(replay.schema!=='source-issue-replay-v1'||replay.issue?.path!==issueRef.path||replay.issue.sha256!==issueRef.sha256||replay.contract_id!==issue.contract_id||typeof replay.reviewer!=='string'||replay.reviewer.trim().length<3||!['FULL_PARENT_AND_SOURCE','FULL_PARENT_AND_RELEVANT_SOURCE'].includes(replay.reading)||replay.repair_adequate!==true||replay.unresolved_material_loss!==false||replay.material_loss_observed!==false||typeof replay.reason!=='string'||replay.reason.trim().length<20||replay.authority!=='NONE')throw new Error('Actual authored complete source-issue replay required');
  if(replay.raw?.path!==issue.raw.path||replay.raw.sha256!==issue.raw.sha256)throw new Error('Repair replay must use the original issue raw source');
  const repaired=await extractedParent(run,replay.extraction_manifest,issue.contract_id,replay.parent,replay.raw);
  ranges(replay.parent.actual_read_ranges,repaired.text.length,{complete:true});
  requireReadLiterals(repaired.raw,replay.raw.actual_read_ranges,issue.required_preserved_literals,issue.raw_literal_matching_policy);
  if(issue.required_preserved_literals.some(value=>!normalized(repaired.text).includes(value)))throw new Error('Repaired parent still omits evidenced governing or associated context');
  if(!qualified)return {reference,repaired,value:replay};
  const origin=replay.prior_actual_replay;
  if(replay.newly_read_current_version!==false||typeof origin?.path!=='string'||!Number.isSafeInteger(origin.bytes)||origin.bytes<1||origin.path===reference.path||origin.path===issueRef.path)throw new Error('Distinct bound prior actual replay and explicit no-new-reading declaration required');
  const limits=qualificationLimits(replay.contextual_limits),prior=await verifiedReplay(run,issue,issueRef,origin,{actualOnly:true});
  const parent=value=>({id:value.parent.id,start:value.parent.start,end:value.parent.end,sha256:value.parent.sha256});
  if(digest(parent(repaired))!==digest(parent(prior.repaired))||repaired.text!==prior.repaired.text||repaired.normalizedText!==prior.repaired.normalizedText||sha256(repaired.normalizedText)!==sha256(prior.repaired.normalizedText)||digest(repaired.rawRef)!==digest(prior.repaired.rawRef)||repaired.raw!==prior.repaired.raw||replay.raw_literal_matching_policy!==prior.value.raw_literal_matching_policy)throw new Error('Prior/current complete parent, normalized source, raw source or matching policy is not exactly equivalent');
  if(digest(replay.parent.actual_read_ranges)!==digest(prior.value.parent.actual_read_ranges)||digest(replay.raw.actual_read_ranges)!==digest(prior.value.raw.actual_read_ranges))throw new Error('Source-only qualification must preserve the exact prior actual reading intervals');
  const focal=replayFocal(repaired,replay.focal),priorFocal=replayFocal(prior.repaired,prior.value.focal);
  if(digest(focal)!==digest(priorFocal))throw new Error('Prior/current declared focal differs');
  const priorLimits=Object.fromEntries(['reason','epistemic_limits','limits','limitations','scope','contextual_limits'].filter(key=>Object.hasOwn(prior.value,key)).map(key=>[key,prior.value[key]]));
  const qualification={schema:'source-only-prior-actual-qualification-v1',review_mode:PRIOR_ACTUAL_MODE,newly_read_current_version:false,prior_actual_replay:prior.reference,prior_extraction_manifest:prior.repaired.manifest,prior_extraction_source_sha256:prior.repaired.sourceSHA,prior_reviewer:prior.value.reviewer,prior_reason_and_contextual_limits:priorLimits,contextual_limits:limits,actual_parent_read_ranges:prior.value.parent.actual_read_ranges,actual_raw_read_ranges:prior.value.raw.actual_read_ranges,focal,normalized_source_sha256:sha256(repaired.normalizedText),scope:'Source-only equivalence of previously actual complete parent and declared raw reading; no new body, heading, navigation or whole-cache reading.'};
  return {reference,repaired,value:replay,qualification};
}

/** Record a separate resolution for one exact source version, preserving the issue. */
export async function resolveObservedSourceIssue(run,{issuePath,issueSHA,replayPath,replaySHA}={}){
  requireContainer();const {issue,issueRef}=await verifiedIssue(run,{path:issuePath,sha256:issueSHA});
  const {reference,repaired,qualification,native}=await verifiedReplay(run,issue,issueRef,{path:replayPath,sha256:replaySHA});
  const resolution={schema:'observed-source-issue-resolution-v1',status:'RESOLVED_FOR_EXACT_SOURCE',issue:issueRef,extraction_source_sha256:repaired.sourceSHA,replay:reference,extraction_manifest:repaired.manifest,parent:{id:repaired.parent.id,start:repaired.parent.start,end:repaired.parent.end,sha256:repaired.parent.sha256},...(qualification?{qualification}:{}),...(native?{native}:{}),authority:'NONE',execution_attested:false};
  return {status:resolution.status,source_sha256:repaired.sourceSHA,...await commit(run,`source-issues/resolutions/${repaired.sourceSHA}/${issue.issue_id}.json`,resolution)};
}

/** Read-only global hold: a new source SHA cannot silently discard an old loss. */
export async function assertNoUnresolvedSourceIssues(run,sourceSHA){
  requireContainer();hash(sourceSHA);const representations=await assertNoUnresolvedRepresentationIssues(run,sourceSHA),representationReport=representations.observed?{representation_issues:representations}:{};let entries;
  try{entries=await readdir(await studyPath(run,'source-issues/observed'),{withFileTypes:true});}
  catch(error){if(error.code==='ENOENT')return {status:'NO_UNRESOLVED_OBSERVED_SOURCE_ISSUES',source_sha256:sourceSHA,observed:0,resolved:0,issues:[],...representationReport,authority:'NONE'};throw error;}
  if(entries.length>MAX_ISSUES||entries.some(item=>!item.isFile()||!ISSUE.test(item.name)))throw new Error('Observed source-issue registry has unsupported entries or exceeds its bound');
  const receipts=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    const issuePath=`source-issues/observed/${entry.name}`,binding=await hashFile(await studyPath(run,issuePath));
    const {issue,issueRef}=await verifiedIssue(run,{path:issuePath,...binding});
    const resolutionPath=`source-issues/resolutions/${sourceSHA}/${issue.issue_id}.json`;let resolution;
    try{resolution=await readJSON(run,resolutionPath,{maxBytes:128*1024});}
    catch(error){if(error.code==='ENOENT')throw new Error(`UNRESOLVED_OBSERVED_SOURCE_ISSUE: ${issue.issue_id} from ${issue.extraction_source_sha256} requires an actual repair replay for ${sourceSHA}`);throw error;}
    if(resolution.schema!=='observed-source-issue-resolution-v1'||resolution.status!=='RESOLVED_FOR_EXACT_SOURCE'||resolution.extraction_source_sha256!==sourceSHA||digest(resolution.issue)!==digest(issueRef))throw new Error('Observed source-issue resolution scope differs');
    const replay=await verifiedReplay(run,issue,issueRef,resolution.replay,{retainedResolution:true});
    const parent={id:replay.repaired.parent.id,start:replay.repaired.parent.start,end:replay.repaired.parent.end,sha256:replay.repaired.parent.sha256};
    if(replay.repaired.sourceSHA!==sourceSHA||digest(resolution.extraction_manifest)!==digest(replay.repaired.manifest)||digest(resolution.parent)!==digest(parent))throw new Error('Observed source-issue resolution differs from replay');
    if(digest(resolution.qualification??null)!==digest(replay.qualification??null))throw new Error('Observed source-issue qualification differs from its verified prior actual origin');
    if(digest(resolution.native??null)!==digest(replay.native??null))throw new Error('Observed native resolution differs from its independently verified evidence');
    receipts.push({issue:issueRef,resolution:{path:resolutionPath,...await hashFile(await studyPath(run,resolutionPath))},replay:replay.reference});
  }
  return {status:'NO_UNRESOLVED_OBSERVED_SOURCE_ISSUES',source_sha256:sourceSHA,observed:entries.length,resolved:receipts.length,issues:receipts,...representationReport,authority:'NONE'};
}

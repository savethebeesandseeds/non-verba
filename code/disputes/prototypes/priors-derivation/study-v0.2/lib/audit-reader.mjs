// SPDX-License-Identifier: AGPL-3.0-only
// Source-only primitive projection prevents accidental exposure of cached labels.
import {readFile,stat} from 'node:fs/promises';
import {sha256,requireContainer} from '../../lib/common.mjs';
import {studyPath,hashFile,readJSON} from './store.mjs';
import {sourceNavigationForRange} from './sections.mjs';
import {loadNativeDecoration} from './native-decoration-store.mjs';
import {createNativeDecorationView} from './source-decoration.mjs';
async function boundFile(runDir,name,expected,description){
  const bytes=await readFile(await studyPath(runDir,name)),binding={sha256:sha256(bytes),bytes:bytes.length};
  if(expected&&binding.sha256!==expected)throw new Error(`${description} binding differs`);
  return {text:bytes.toString('utf8'),binding};
}
async function boundCache(runDir,row,description){
  const name=row.lineage.cache_path,path=await studyPath(runDir,name);
  if((await stat(path)).size>64*1024**2)throw new Error('Source cache exceeds its explicit encoded read bound');
  const binding=await hashFile(path);if(binding.sha256!==row.lineage.cache_sha256)throw new Error(`${description} binding differs`);
  return {cache:await readJSON(runDir,name,{maxBytes:64*1024**2}),binding};
}
async function auditCase(runDir,packetPath,auditId){
  const file=await boundFile(runDir,packetPath),packet=JSON.parse(file.text),matches=packet.rows.filter(row=>row.audit_id===auditId);
  if(matches.length!==1)throw new Error('Unique packet audit ID required');
  return {packet,row:matches[0],packetBinding:{path:packetPath,...file.binding}};
}
async function parentSource(runDir,row){
  let normalized,binding;const name=row.parent.normalized_path??row.lineage.normalized_path;
  if(name){const file=await boundFile(runDir,name,row.lineage.normalized_sha256,'Normalized source');normalized=file.text;binding=file.binding;}
  else{const file=await boundCache(runDir,row,'Rejected-source cache');binding=file.binding;normalized=file.cache.normalized_text;if(typeof normalized!=='string'||sha256(normalized)!==row.lineage.normalized_sha256)throw new Error('Rejected-source normalized binding differs');}
  if(!Number.isSafeInteger(row.parent.start)||!Number.isSafeInteger(row.parent.end)||row.parent.start<0||row.parent.end<row.parent.start||row.parent.end>normalized.length)throw new Error('Parent source range differs');
  const text=normalized.slice(row.parent.start,row.parent.end);if(sha256(text)!==row.parent.sha256)throw new Error('Parent source binding differs');
  return {text,binding,absoluteStart:row.parent.start};
}

function projectedNavigation(parent,unit,row,source){
  if(!parent)return {nearest_anchor:null,within_unit:[],governing_hierarchy_verified:false,scope:'LITERAL_SOURCE_NAVIGATION_ONLY',status:'UNKNOWN_NO_EXTRACTED_PARENT',range:null};
  const start=unit?.start??row.excerpt?.start??row.parent.start,end=unit?.end??row.excerpt?.end??row.parent.end;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<row.parent.start||end<start||end>row.parent.end)throw new Error('Focal navigation range differs from retained parent');
  if(parent.start!==undefined&&(parent.start!==row.parent.start||parent.end!==row.parent.end||parent.sha256!==row.parent.sha256))throw new Error('Navigation parent binding differs');
  if(unit&&(unit.parent_section_id!==row.parent.id||source.text.slice(start-row.parent.start,end-row.parent.start)!==unit.text||sha256(unit.text)!==unit.sha256))throw new Error('Navigation unit binding differs');
  const anchors=(parent.source_navigation_anchors??[]).map(anchor=>{
    if(!Number.isSafeInteger(anchor.start)||!Number.isSafeInteger(anchor.end)||anchor.start<row.parent.start||anchor.end>row.parent.end||anchor.end<=anchor.start||!Array.isArray(anchor.parts)||!anchor.parts.length)throw new Error('Literal navigation anchor range differs');
    let priorEnd=anchor.start;
    const parts=anchor.parts.map(part=>{
      if(typeof part.text!=='string'||!Number.isSafeInteger(part.start)||!Number.isSafeInteger(part.end)||part.start<priorEnd||part.start<anchor.start||part.end>anchor.end||part.end<=part.start||source.text.slice(part.start-row.parent.start,part.end-row.parent.start)!==part.text)throw new Error('Literal navigation piece differs from source');
      priorEnd=part.end;return {text:part.text,start:part.start,end:part.end};
    });
    const label=parts.map(part=>part.text).join(' ').replace(/\s+/gu,' ').trim();
    if(parts[0].start!==anchor.start||parts.at(-1).end!==anchor.end||anchor.label!==label||anchor.id!==row.contract_id+':navigation:'+anchor.start+'-'+anchor.end+':'+sha256(label).slice(0,12))throw new Error('Literal navigation identity differs');
    const bounded=value=>typeof value==='string'&&value.length<=128?value:null;
    const evidence=anchor.source_evidence??{};
    return {id:anchor.id,label,start:anchor.start,end:anchor.end,parts,kind:bounded(anchor.kind),source_evidence:{source_kind:bounded(evidence.source_kind),html_level:Number.isSafeInteger(evidence.html_level)&&evidence.html_level>=1&&evidence.html_level<=6?evidence.html_level:null,literal_typed_marker:evidence.literal_typed_marker===true,source_layout_caption:evidence.source_layout_caption===true,grouped_title_pieces:bounded(evidence.grouped_title_pieces)},parent_boundary_suppressed:anchor.parent_boundary_suppressed===true,suppression_reason:bounded(anchor.suppression_reason),ambiguity:Object.fromEntries(['raw_line_delimiter_continuation','wrapped_sentence_continuation','source_continuation','source_sentence_continuation','source_quote_context','within_introduced_list_frame','source_list_item','table_layout','unresolved_title_continuation'].map(key=>[key,anchor.ambiguity?.[key]===true])),governing_hierarchy_verified:false,scope:'LITERAL_SOURCE_NAVIGATION_ONLY'};
  }).sort((a,b)=>a.start-b.start||a.end-b.end||a.id.localeCompare(b.id));
  const result={...sourceNavigationForRange(anchors,start,end),range:{start,end,offset_basis:'UTF16_IN_NORMALIZED_TEXT'}};
  if(!Object.hasOwn(parent,'source_navigation_anchors'))result.status='UNKNOWN_SOURCE_NAVIGATION_UNAVAILABLE_IN_CACHE';
  return result;
}
async function projectedNativeSource(runDir,row,start,end,mode){
  const {cache}=await boundCache(runDir,row,'Native source cache');
  if(!Object.hasOwn(cache,'native_source_decorations'))return {status:'UNAVAILABLE_IN_LEGACY_CACHE',range:{start,end},computed_style_verified:false,effectiveness_verified:false,authority:'NONE'};
  if(typeof cache.normalized_text!=='string'||sha256(cache.normalized_text)!==row.lineage.normalized_sha256)throw new Error('Native normalized source binding differs');
  const raw=await boundFile(runDir,row.lineage.raw_path,row.lineage.raw_sha256,'Raw source'),envelope=await loadNativeDecoration(runDir,cache.native_source_decorations),view=createNativeDecorationView(envelope,{raw:raw.text,normalizedText:cache.normalized_text});
  return (mode==='all'?view.project:view.projectRelevant)({start,end,maxRuns:512,maxCharacters:20000,maxOrigins:4096,includeEndZeroWidth:end===row.parent.end});
}

export async function readAuditSource(runDir,packetPath,auditId,{source='parent',offset=0,limit=12000,showProposedHeading=false,nativeDecorations='relevant'}={}) {
  requireContainer();if(!['parent','raw'].includes(source)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20000)throw new Error('Explicit bounded source slice required');
  if(!['relevant','all','none'].includes(nativeDecorations))throw new Error('Explicit native source projection mode required');
  const {packet,row,packetBinding}=await auditCase(runDir,packetPath,auditId);
  if(showProposedHeading&&packet.purpose==='coding')throw new Error('Coding reader forbids proposed hierarchy metadata');
  let text,binding,absoluteStart=0;
  if(source==='raw')({text,binding}=await boundFile(runDir,row.lineage.raw_path,row.lineage.raw_sha256,'Raw source'));
  else({text,binding,absoluteStart}=await parentSource(runDir,row));
  const end=Math.min(offset+limit,text.length);if(offset>text.length)throw new Error('Slice starts beyond source');
  const result={audit_id:row.audit_id,source_id:row.id,contract_id:row.contract_id,purpose:packet.purpose,packet:packetBinding,source,binding,range:{offset,end,total_characters:text.length,absolute_normalized_start:source==='parent'?absoluteStart+offset:null,offset_basis:'UTF16 decoded text; raw text slices are not raw byte offsets',complete_source_in_this_slice:offset===0&&end===text.length,next_offset:end<text.length?end:null},text:text.slice(offset,end),source_url:row.lineage.source_url};
  result.source_scope=source==='parent'?'EXTRACTED_FLAT_SPAN':'RETAINED_ORIGINAL_DOCUMENT';
  result.semantic_completeness='UNVERIFIED_REQUIRES_ORIGINAL_SOURCE_READING';
  if(source==='parent'&&nativeDecorations!=='none')result.native_source_decorations=await projectedNativeSource(runDir,row,absoluteStart+offset,absoluteStart+end,nativeDecorations);
  if(showProposedHeading){const {cache}=await boundCache(runDir,row,'Heading cache');const parent=cache.sections.find(value=>value.id===row.parent.id);result.proposed_heading=parent?{text:parent.heading,path:parent.heading_path,provenance:parent.heading_provenance??null}:{text:null,path:[],provenance:'NO_EXTRACTED_PARENT'};const unit=parent?.units?.find(value=>value.id===row.id);const retained=source==='parent'?{text,absoluteStart}:await parentSource(runDir,row);result.source_navigation=projectedNavigation(parent,unit,row,retained);}
  return result;
}

const normalizedWhitespace=value=>value.replace(/\s+/gu,' ').trim();
const escapeLiteral=value=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
// Only lexical whitespace, nbsp whitespace entities and HTML tags may intervene.
// The tag alternatives are disjoint so quoted attributes do not create nested
// ambiguous wildcard expressions; source text is never replaced in the result.
const gap=String.raw`(?:\s|&(?:[nN][bB][sS][pP]|#0*160|#[xX]0*[aA]0);|<\/?[A-Za-z](?:[^<>"']|"[^"]*"|'[^']*')*>)`;
const MAX_LOCATOR_OUTPUT=20000;
function boundedIdentity(value,name,max=256){if(value!==undefined&&(typeof value!=='string'||value.length>max))throw new Error(`Bounded ${name} identity required`);return value??null;}
function rawSlice(raw,match,before,after,budget){
  const size=match.end-match.start;let start,end;
  if(size>=budget){start=match.start;end=start+budget;}
  else{const spare=budget-size;let left=Math.min(before,match.start,Math.ceil(spare/2)),right=Math.min(after,raw.length-match.end,spare-left);left+=Math.min(before-left,match.start-left,spare-left-right);right+=Math.min(after-right,raw.length-match.end-right,spare-left-right);start=match.start-left;end=match.end+right;}
  return {match:{start:match.start,end:match.end},range:{start,end,complete_match_in_slice:start<=match.start&&end>=match.end,requested_context_complete:start===Math.max(0,match.start-before)&&end===Math.min(raw.length,match.end+after)},text:raw.slice(start,end)};
}

/** Literal source locator only. Finding a span does not constitute reading it. */
export async function locateAuditRaw(runDir,packetPath,auditId,{phrase,before=1000,after=3000,maxMatches=3}={}){
  requireContainer();
  if(typeof phrase!=='string'||phrase.length<3||phrase.length>200||normalizedWhitespace(phrase).length<3)throw new Error('Literal parent phrase requires 3–200 characters');
  if(!Number.isSafeInteger(before)||before<0||before>20000||!Number.isSafeInteger(after)||after<0||after>20000||!Number.isSafeInteger(maxMatches)||maxMatches<1||maxMatches>3)throw new Error('Explicit bounded raw location options required');
  const {packet,row,packetBinding}=await auditCase(runDir,packetPath,auditId),parent=await parentSource(runDir,row),literal=normalizedWhitespace(phrase);
  if(!normalizedWhitespace(parent.text).includes(literal))throw new Error('Literal phrase is absent from the hash-verified extracted span');
  const {text:raw,binding}=await boundFile(runDir,row.lineage.raw_path,row.lineage.raw_sha256,'Raw source');
  const pattern=literal.split(' ').map(word=>[...word].map(escapeLiteral).join(`${gap}*`)).join(`${gap}+`),matcher=new RegExp(pattern,'gu'),found=[];
  for(let match;found.length<=maxMatches&&(match=matcher.exec(raw));)found.push({start:match.index,end:match.index+match[0].length});
  const more=found.length>maxMatches,candidates=found.slice(0,maxMatches);
  const result={audit_id:boundedIdentity(row.audit_id,'audit'),source_id:boundedIdentity(row.id,'source'),contract_id:boundedIdentity(row.contract_id,'contract'),purpose:boundedIdentity(packet.purpose,'purpose',64),packet:packetBinding,raw:{path:row.lineage.raw_path,...binding,total_characters:raw.length},parent:{start:row.parent.start,end:row.parent.end,sha256:row.parent.sha256},phrase:literal,status:found.length?'LITERAL_CANDIDATES_FOUND':'NOT_FOUND',ambiguous:found.length>1,match_count_at_least:found.length,more_matches_exist:more,returned_matches:candidates.length,candidate_shortage:Math.max(0,maxMatches-candidates.length),offset_basis:'UTF16 decoded raw text; not byte offsets',operative_match:'NOT_ESTABLISHED; a table-of-contents occurrence is not automatically operative',reading_status:'NOT_READ_BY_LOCATOR',limits:{before,after,max_matches:maxMatches,max_output_characters:MAX_LOCATOR_OUTPUT},matches:[]};
  let budget=Math.floor(15000/Math.max(1,candidates.length));
  do{result.matches=candidates.map(match=>rawSlice(raw,match,before,after,budget));const excess=JSON.stringify(result).length-MAX_LOCATOR_OUTPUT;if(excess<=0)return result;if(budget===0)throw new Error('Locator metadata exceeds bounded output');budget=Math.max(0,budget-Math.max(1,Math.ceil(excess/Math.max(1,candidates.length))));}while(true);
}

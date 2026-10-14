// SPDX-License-Identifier: AGPL-3.0-only
// Source-only primitive projection prevents accidental exposure of cached labels.
import {readFile} from 'node:fs/promises';
import {readJSON,sha256,requireContainer} from '../../lib/common.mjs';
import {studyPath,hashFile} from './store.mjs';
async function boundFile(runDir,name,expected,description){
  const bytes=await readFile(await studyPath(runDir,name)),binding={sha256:sha256(bytes),bytes:bytes.length};
  if(expected&&binding.sha256!==expected)throw new Error(`${description} binding differs`);
  return {text:bytes.toString('utf8'),binding};
}
async function auditCase(runDir,packetPath,auditId){
  const file=await boundFile(runDir,packetPath),packet=JSON.parse(file.text),matches=packet.rows.filter(row=>row.audit_id===auditId);
  if(matches.length!==1)throw new Error('Unique packet audit ID required');
  return {packet,row:matches[0],packetBinding:{path:packetPath,...file.binding}};
}
async function parentSource(runDir,row){
  let normalized,binding;const name=row.parent.normalized_path??row.lineage.normalized_path;
  if(name){const file=await boundFile(runDir,name,row.lineage.normalized_sha256,'Normalized source');normalized=file.text;binding=file.binding;}
  else{const file=await boundFile(runDir,row.lineage.cache_path,row.lineage.cache_sha256,'Rejected-source cache');binding=file.binding;normalized=JSON.parse(file.text).normalized_text;if(typeof normalized!=='string'||sha256(normalized)!==row.lineage.normalized_sha256)throw new Error('Rejected-source normalized binding differs');}
  if(!Number.isSafeInteger(row.parent.start)||!Number.isSafeInteger(row.parent.end)||row.parent.start<0||row.parent.end<row.parent.start||row.parent.end>normalized.length)throw new Error('Parent source range differs');
  const text=normalized.slice(row.parent.start,row.parent.end);if(sha256(text)!==row.parent.sha256)throw new Error('Parent source binding differs');
  return {text,binding,absoluteStart:row.parent.start};
}
export async function readAuditSource(runDir,packetPath,auditId,{source='parent',offset=0,limit=12000,showProposedHeading=false}={}) {
  requireContainer();if(!['parent','raw'].includes(source)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20000)throw new Error('Explicit bounded source slice required');
  const {packet,row,packetBinding}=await auditCase(runDir,packetPath,auditId);
  if(showProposedHeading&&packet.purpose==='coding')throw new Error('Coding reader forbids proposed hierarchy metadata');
  let text,binding,absoluteStart=0;
  if(source==='raw')({text,binding}=await boundFile(runDir,row.lineage.raw_path,row.lineage.raw_sha256,'Raw source'));
  else({text,binding,absoluteStart}=await parentSource(runDir,row));
  const end=Math.min(offset+limit,text.length);if(offset>text.length)throw new Error('Slice starts beyond source');
  const result={audit_id:row.audit_id,source_id:row.id,contract_id:row.contract_id,purpose:packet.purpose,packet:packetBinding,source,binding,range:{offset,end,total_characters:text.length,absolute_normalized_start:source==='parent'?absoluteStart+offset:null,offset_basis:'UTF16 decoded text; raw text slices are not raw byte offsets',complete_source_in_this_slice:offset===0&&end===text.length,next_offset:end<text.length?end:null},text:text.slice(offset,end),source_url:row.lineage.source_url};
  result.source_scope=source==='parent'?'EXTRACTED_FLAT_SPAN':'RETAINED_ORIGINAL_DOCUMENT';
  result.semantic_completeness='UNVERIFIED_REQUIRES_ORIGINAL_SOURCE_READING';
  if(showProposedHeading){const cachePath=await studyPath(runDir,row.lineage.cache_path);if((await hashFile(cachePath)).sha256!==row.lineage.cache_sha256)throw new Error('Heading cache binding differs');const cache=await readJSON(cachePath);const parent=cache.sections.find(value=>value.id===row.parent.id);result.proposed_heading=parent?{text:parent.heading,path:parent.heading_path,provenance:parent.heading_provenance??null}:{text:null,path:[],provenance:'NO_EXTRACTED_PARENT'};}
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

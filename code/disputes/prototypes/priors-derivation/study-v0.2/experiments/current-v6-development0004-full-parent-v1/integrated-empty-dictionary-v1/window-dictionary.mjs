// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE: reversible empty-event syntax; no source or metadata is discarded.
import {createHash} from 'node:crypto';
import {encodeEmptyNativeCluster,decodeEmptyNativeCluster,EMPTY_NATIVE_DICTIONARY_POLICY} from './empty-native-dictionary.mjs';
export const DICTIONARY_WINDOW_POLICY='NATIVE_EMPTY_DICTIONARY_SELF_CONTAINED_WINDOW_V1_UNADOPTED';
const N='\n[NATIVE_SOURCE_MARKS_UNVERIFIED ',NC='\n[/NATIVE_SOURCE_MARKS_UNVERIFIED]\n';
const J='\n[JOINT_NORMALIZATION_UNVERIFIED ',JC='[/JOINT_NORMALIZATION_UNVERIFIED]\n';
const D='\n[NATIVE_EMPTY_DICTIONARY_V1 ',DC=']\n';
const RESERVED=['[NATIVE_SOURCE_MARKS_UNVERIFIED','[/NATIVE_SOURCE_MARKS_UNVERIFIED','[JOINT_NORMALIZATION_UNVERIFIED','[/JOINT_NORMALIZATION_UNVERIFIED','[NATIVE_EMPTY_DICTIONARY_V1'];
const MAX=1048576,MAX_GROUPS=16384;
const check=(v,c)=>{if(!v)throw new Error(c);};
const sha=v=>createHash('sha256').update(v).digest('hex');
const bytes=v=>Buffer.byteLength(v,'utf8');
export function assertUnambiguousSourceText(text){
 check(typeof text==='string'&&text.length<=MAX,'WINDOW_SOURCE_BOUND');
 check(!RESERVED.some(marker=>text.includes(marker)),'WINDOW_RESERVED_SOURCE_MARKER');
}
function header(text,start,kind){
 const end=text.indexOf(']\n',start);check(end>=start,'WINDOW_HEADER');
 const literal=text.slice(start,end);let value;
 try{value=JSON.parse(literal);}catch{throw new Error('WINDOW_METADATA_JSON');}
 check(JSON.stringify(value)===literal,'WINDOW_METADATA_NONCANONICAL');
 check(kind==='native'?Array.isArray(value)&&value.every(x=>x&&typeof x==='object'&&!Array.isArray(x)):value&&typeof value==='object'&&!Array.isArray(value),'WINDOW_METADATA_SHAPE');
 return end+2;
}
// Only generated wrappers are interpreted. Reserved-looking literal source is refused.
function parse(text,allowDictionary=false){
 check(typeof text==='string'&&text.length<=MAX,'WINDOW_TEXT_BOUND');
 const tokens=[];let at=0,groups=0;
 while(at<text.length){
  const candidates=[N,J,...(allowDictionary?[D]:[])].map(marker=>({marker,index:text.indexOf(marker,at)})).filter(x=>x.index>=0).sort((a,b)=>a.index-b.index);
  const next=candidates[0],end=next?.index??text.length,plain=text.slice(at,end);
  assertUnambiguousSourceText(plain);if(plain)tokens.push({kind:'source',literal:plain,source:plain});
  if(!next)break;
  at=end;check(++groups<=MAX_GROUPS,'WINDOW_GROUP_BOUND');
  if(next.marker===N){
   const body=header(text,at+N.length,'native'),close=text.indexOf(NC,body);check(close>=body,'WINDOW_NATIVE_CLOSE');
   const source=text.slice(body,close);assertUnambiguousSourceText(source);
   const literal=text.slice(at,close+NC.length);tokens.push({kind:source.length?'native':'empty',literal,source});at=close+NC.length;
  }else if(next.marker===J){
   const close=header(text,at+J.length,'joint');check(text.startsWith(JC,close),'WINDOW_JOINT_CLOSE');
   tokens.push({kind:'joint',literal:text.slice(at,close+JC.length),source:''});at=close+JC.length;
  }else{
   const close=text.indexOf(DC,at+D.length);check(close>=at+D.length,'WINDOW_DICTIONARY_CLOSE');
   const literal=text.slice(at+D.length,close),expanded=decodeEmptyNativeCluster(literal);
   const decoded=parse(expanded);check(decoded.length>1&&decoded.every(x=>x.kind==='empty'),'WINDOW_DICTIONARY_CLUSTER');
   tokens.push({kind:'dictionary',literal:expanded,source:'',groups:decoded.length});at=close+DC.length;
  }
 }
 return tokens;
}
function encodeText(text){
 const tokens=parse(text),parts=[];let clusters=0,emptyGroups=0;
 for(let i=0;i<tokens.length;){
  if(tokens[i].kind!=='empty'){parts.push(tokens[i++].literal);continue;}
  let end=i+1;while(end<tokens.length&&tokens[end].kind==='empty')end++;
  const cluster=tokens.slice(i,end).map(x=>x.literal).join('');
  if(end-i>1){parts.push(D+encodeEmptyNativeCluster(cluster)+DC);clusters++;emptyGroups+=end-i;}else parts.push(cluster);
  i=end;
 }
 return {text:parts.join(''),clusters,emptyGroups,source:tokens.map(x=>x.source).join('')};
}
const META_KEYS=['schema','policy','cluster_policy','original_input_policy','original_text_sha256','original_text_UTF8_bytes','encoded_text_sha256','encoded_text_UTF8_bytes','original_window_sha256','original_window_UTF8_bytes','source_text_sha256','source_text_UTF16','clusters','empty_annotation_groups','source_ranges_hash_semantics'];
export function encodeNativeDictionaryWindow(original,{sourceText}={}){
 check(original&&typeof original==='object'&&!Array.isArray(original)&&!Object.hasOwn(original,'empty_native_dictionary'),'WINDOW_ORIGINAL');
 check(typeof original.input_policy==='string'&&original.sha256===sha(original.text),'WINDOW_ORIGINAL_IDENTITY');
 assertUnambiguousSourceText(sourceText);
 const encoded=encodeText(original.text);check(encoded.source===sourceText,'WINDOW_SOURCE_RECONSTRUCTION');
 const serialized=JSON.stringify(original);check(serialized.length<=MAX,'WINDOW_SERIALIZED_BOUND');
 const metadata={schema:'lossless-native-window-dictionary-v1',policy:DICTIONARY_WINDOW_POLICY,cluster_policy:EMPTY_NATIVE_DICTIONARY_POLICY,original_input_policy:original.input_policy,original_text_sha256:original.sha256,original_text_UTF8_bytes:bytes(original.text),encoded_text_sha256:sha(encoded.text),encoded_text_UTF8_bytes:bytes(encoded.text),original_window_sha256:sha(serialized),original_window_UTF8_bytes:bytes(serialized),source_text_sha256:sha(sourceText),source_text_UTF16:sourceText.length,clusters:encoded.clusters,empty_annotation_groups:encoded.emptyGroups,source_ranges_hash_semantics:'UNCHANGED_ORIGINAL_NATIVE_SERIALIZATION_BEFORE_DICTIONARY'};
 const result={...original,text:encoded.text,input_policy:DICTIONARY_WINDOW_POLICY,sha256:sha(encoded.text),empty_native_dictionary:metadata};
 // Fail the complete window if inverse verification fails; never emit a partial repair.
 check(JSON.stringify(decodeNativeDictionaryWindow(result))===serialized,'WINDOW_ROUNDTRIP');return result;
}
export function decodeNativeDictionaryWindow(encoded){
 check(encoded&&typeof encoded==='object'&&!Array.isArray(encoded),'WINDOW_ENCODED');
 const m=encoded.empty_native_dictionary;
 check(m&&JSON.stringify(Object.keys(m))===JSON.stringify(META_KEYS)&&m.schema==='lossless-native-window-dictionary-v1'&&m.policy===DICTIONARY_WINDOW_POLICY&&m.cluster_policy===EMPTY_NATIVE_DICTIONARY_POLICY&&m.source_ranges_hash_semantics==='UNCHANGED_ORIGINAL_NATIVE_SERIALIZATION_BEFORE_DICTIONARY','WINDOW_DICTIONARY_METADATA');
 check(encoded.input_policy===DICTIONARY_WINDOW_POLICY&&encoded.sha256===sha(encoded.text)&&m.encoded_text_sha256===encoded.sha256&&m.encoded_text_UTF8_bytes===bytes(encoded.text),'WINDOW_ENCODED_IDENTITY');
 const tokens=parse(encoded.text,true),text=tokens.map(x=>x.literal).join(''),source=tokens.map(x=>x.source).join('');
 check(sha(text)===m.original_text_sha256&&bytes(text)===m.original_text_UTF8_bytes&&sha(source)===m.source_text_sha256&&source.length===m.source_text_UTF16,'WINDOW_ORIGINAL_RECONSTRUCTION');
 check(tokens.filter(x=>x.kind==='dictionary').length===m.clusters&&tokens.reduce((n,x)=>n+(x.groups??0),0)===m.empty_annotation_groups,'WINDOW_CLUSTER_COUNTS');
 const result=Object.fromEntries(Object.entries(encoded).filter(([key])=>key!=='empty_native_dictionary').map(([key,value])=>[key,key==='text'?text:key==='sha256'?m.original_text_sha256:key==='input_policy'?m.original_input_policy:value]));
 const serialized=JSON.stringify(result);check(sha(serialized)===m.original_window_sha256&&bytes(serialized)===m.original_window_UTF8_bytes,'WINDOW_SERIALIZED_RECONSTRUCTION');return result;
}
export function reconstructDictionaryWindowSource(encoded){return parse(decodeNativeDictionaryWindow(encoded).text).map(x=>x.source).join('');}

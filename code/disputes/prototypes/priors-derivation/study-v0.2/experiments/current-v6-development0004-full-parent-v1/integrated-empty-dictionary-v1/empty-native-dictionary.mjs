// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Empty native groups only; no production serializer change.
export const EMPTY_NATIVE_DICTIONARY_POLICY='NATIVE_EMPTY_DICT_V1_UNADOPTED';
const OPEN='\n[NATIVE_SOURCE_MARKS_UNVERIFIED ',END=']\n\n[/NATIVE_SOURCE_MARKS_UNVERIFIED]\n',MAX=4096,GROUPS=64;
const check=(v,c)=>{if(!v)throw new Error(c);};
function canonical(s){let v;try{v=JSON.parse(s);}catch{throw new Error('EMPTY_NATIVE_JSON');}check(JSON.stringify(v)===s,'EMPTY_NATIVE_NONCANONICAL');return v;}
function metadata(s){const v=canonical(s);check(Array.isArray(v)&&v.every(x=>x&&typeof x==='object'&&!Array.isArray(x)),'EMPTY_NATIVE_METADATA');return v;}
export function encodeEmptyNativeCluster(source){
 check(typeof source==='string'&&source.length>0&&source.length<=MAX,'EMPTY_NATIVE_BOUND');
 const dictionary=[],ids=[],seen=new Map();let at=0;
 while(at<source.length){
  check(ids.length<GROUPS&&source.startsWith(OPEN,at),'EMPTY_NATIVE_WRAPPER');
  const start=at+OPEN.length,end=source.indexOf(']\n',start);
  check(end>=start&&source.startsWith(END,end),'EMPTY_NATIVE_NONEMPTY_OR_AMBIGUOUS');
  const literal=source.slice(start,end);metadata(literal);
  let id=seen.get(literal);if(id===undefined){id=dictionary.length;dictionary.push(JSON.parse(literal));seen.set(literal,id);}ids.push(id);at=end+END.length;
 }
 return JSON.stringify([EMPTY_NATIVE_DICTIONARY_POLICY,dictionary,ids]);
}
export function decodeEmptyNativeCluster(encoded){
 check(typeof encoded==='string'&&encoded.length>0&&encoded.length<=MAX,'EMPTY_NATIVE_BOUND');
 const v=canonical(encoded);check(Array.isArray(v)&&v.length===3&&v[0]===EMPTY_NATIVE_DICTIONARY_POLICY&&Array.isArray(v[1])&&Array.isArray(v[2])&&v[2].length>0&&v[2].length<=GROUPS,'EMPTY_NATIVE_FORMAT');
 const d=v[1].map(x=>{const s=JSON.stringify(x);metadata(s);return s;}),ids=v[2];
 check(d.length>0&&d.length<=ids.length&&new Set(d).size===d.length,'EMPTY_NATIVE_DICTIONARY');
 check(ids.every(id=>Number.isSafeInteger(id)&&id>=0&&id<d.length),'EMPTY_NATIVE_INDEX');
 const source=ids.map(id=>OPEN+d[id]+END).join('');check(source.length<=MAX,'EMPTY_NATIVE_BOUND');
 check(encodeEmptyNativeCluster(source)===encoded,'EMPTY_NATIVE_ORDER_OR_UNUSED');return source;
}


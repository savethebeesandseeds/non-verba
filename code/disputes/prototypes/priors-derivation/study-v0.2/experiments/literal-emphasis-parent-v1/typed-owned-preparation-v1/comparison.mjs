// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Trusted plain JSON-tree comparison; no IO/admission.
export const MAX_DIFFERENCES=128;
const rowPath=p=>p.length===2&&['sections','units'].includes(p[0])||p.length===4&&['sections','units'].includes(p[0])&&p[2]==='units';
const coreExcluded=(p,key)=>p.length===0&&['source','raw_sha256','native_source_decorations'].includes(key)||p.length===1&&p[0]==='parameters'&&key==='native_decoration_policy'||key==='native_source_decorations_ref'&&rowPath(p);
const selectionExcluded=(p,key)=>p.length===2&&p[0]==='selected'&&key==='native_source_decorations_ref';

function compare(a,b,excluded,path='',parts=[],out=[]){
  if(Object.is(a,b))return out;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'){out.push(path||'/');return out;}
  for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
    if(out.length>=MAX_DIFFERENCES)break;
    // Exclude before reading either property: full native envelopes stay untouched.
    if(excluded(parts,key))continue;
    if(!Object.hasOwn(a,key)||!Object.hasOwn(b,key))out.push(path+'/'+key);
    else compare(a[key],b[key],excluded,path+'/'+key,[...parts,key],out);
  }
  return out;
}
export const stableCoreDifferences=(a,b)=>compare(a,b,coreExcluded);
export const stableSelectionDifferences=(a,b)=>compare(a,b,selectionExcluded);

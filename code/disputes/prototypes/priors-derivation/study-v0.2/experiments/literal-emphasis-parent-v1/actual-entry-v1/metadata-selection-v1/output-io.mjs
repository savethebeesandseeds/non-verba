// SPDX-License-Identifier: AGPL-3.0-only
// Exclusive output-root writes. No callback transport or actual write authority.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {contextOf,fail} from './admission.mjs';
import {checkedPath,sha} from './input-io.mjs';
import {preflightContext} from './preflight.mjs';
import {initializedScope} from './control.mjs';
const books=new WeakMap(),parentNames=['parent-preflight.json','ordered-development200-ids.json','complete-fresh-guard.json'],workerNames=['metadata-projection.json','ordered69-freeze.json','summary.json'];
export async function writeFictionalMetadata(permit,scope,name,value,{parent=false}={}){
  const c=contextOf(permit);preflightContext(permit,scope);if(!(parent?parentNames:workerNames).includes(name)||!parent&&initializedScope(permit)!==scope)fail('METADATA_WRITE_SCOPE');
  const b=Buffer.from(JSON.stringify(value,null,2)+'\n');let book=books.get(permit);if(!book){book={bytes:0,refs:[]};books.set(permit,book);}if(b.length>8388608||book.bytes+b.length>134217728||book.refs.some(r=>r.path===name))fail('METADATA_OUTPUT_BOUND_OR_RETRY');
  const target=await checkedPath(c.output_root,name,{missing:true}),fd=await fs.open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await fd.writeFile(b);await fd.sync();}finally{await fd.close();}const dir=await fs.open(path.dirname(target),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await dir.sync();}finally{await dir.close();}
  const observed=await fs.readFile(target);if(!observed.equals(b))fail('METADATA_OUTPUT_READBACK');const ref=Object.freeze({path:name,sha256:sha(b),bytes:b.length});book.bytes+=b.length;book.refs.push(ref);return ref;
}
export function outputSnapshot(permit){contextOf(permit);const b=books.get(permit);return Object.freeze({bytes:b?.bytes??0,refs:Object.freeze([...(b?.refs??[])])});}

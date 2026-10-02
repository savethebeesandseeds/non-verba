// SPDX-License-Identifier: AGPL-3.0-only
// Source manifest for the browser export's two freshness observations.
// These local filesystem observations are not reproducible-build attestation.
import {lstat,readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,extname} from 'node:path';
const insist=(ok,message)=>{if(!ok)throw new Error(message);};
export async function captureBuildSources({sourceRoot,cratesRoot,cargoRoot}){
  const candidates=new Map();
  async function directory(path){
    const st=await lstat(path);insist(st.isDirectory()&&!st.isSymbolicLink(),'Invalid source directory: '+path);
    return readdir(path,{withFileTypes:true});
  }
  for(const entry of await directory(sourceRoot)){
    if(['.html','.js','.css'].includes(extname(entry.name)))candidates.set('web/'+entry.name,join(sourceRoot,entry.name));
  }
  async function visit(path,prefix=''){
    for(const entry of await directory(path)){
      const file=join(path,entry.name),name=prefix+entry.name;
      insist(!entry.isSymbolicLink(),'Symlinked Rust source is unsupported: '+file);
      if(entry.isDirectory())await visit(file,name+'/');
      else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')candidates.set('crates/'+name,file);
    }
  }
  await visit(cratesRoot);
  for(const name of ['Cargo.toml','Cargo.lock'])candidates.set(name,join(cargoRoot,name));
  insist(candidates.size<=10000,'Too many build source inputs.');
  const manifest={};let total=0;
  for(const [name,path] of [...candidates].sort(([a],[b])=>a<b?-1:a>b?1:0)){
    const before=await lstat(path,{bigint:true});
    insist(before.isFile()&&!before.isSymbolicLink()&&before.size<=128n*1024n*1024n,'Invalid source input: '+path);
    total+=Number(before.size);insist(total<=512*1024*1024,'Build sources exceed inspection bound.');
    const data=await readFile(path),after=await lstat(path,{bigint:true});
    insist(after.isFile()&&!after.isSymbolicLink()&&before.mtimeNs===after.mtimeNs&&before.size===after.size&&BigInt(data.length)===before.size,'Source changed while reading: '+path);
    manifest[name]={path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),mtime_ns:before.mtimeNs.toString()};
  }
  return manifest;
}
export async function assertBuildSourcesUnchanged(expected,paths){
  const actual=await captureBuildSources(paths);
  insist(JSON.stringify(actual)===JSON.stringify(expected),'Build source content, file set or modification times changed during packaging.');
  return actual;
}

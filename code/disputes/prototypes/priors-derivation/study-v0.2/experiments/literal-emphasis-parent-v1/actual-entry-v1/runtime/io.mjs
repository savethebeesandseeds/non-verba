// SPDX-License-Identifier: AGPL-3.0-only
// Builtin streaming checks. No package import, fetch, cache or directory scan.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertFictionalPermit} from '../admission.mjs';
import {MANIFEST,OWN_FILES} from './profile.mjs';
import {ref,fail,json,equal,sha} from './validation.mjs';
function streamVerified(expected,{collect=false}={}){
  ref(expected);const held=[],parts=expected.path.split('/').filter(Boolean),name=parts.pop();let fd;
  try{let parent=fs.openSync('/',fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);held.push(parent);for(const part of parts){parent=fs.openSync('/proc/self/fd/'+parent+'/'+part,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);held.push(parent);}fd=fs.openSync('/proc/self/fd/'+parent+'/'+name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const before=fs.fstatSync(fd);if(!before.isFile()||before.size!==expected.bytes||collect&&before.size>2097152)fail('RUNTIME_REGULAR_FILE_BOUND');const hash=createHash('sha256'),chunk=Buffer.alloc(65536),pieces=[];let offset=0;while(offset<expected.bytes){const n=fs.readSync(fd,chunk,0,Math.min(chunk.length,expected.bytes-offset),offset);if(!n)fail('RUNTIME_TRUNCATED_FILE');offset+=n;hash.update(chunk.subarray(0,n));if(collect)pieces.push(Buffer.from(chunk.subarray(0,n)));}const after=fs.fstatSync(fd);if(fs.readSync(fd,chunk,0,1,offset)||after.size!==before.size||after.dev!==before.dev||after.ino!==before.ino||hash.digest('hex')!==expected.sha256)fail('RUNTIME_FILE_INTEGRITY');return collect?Buffer.concat(pieces):null;}finally{if(fd!==undefined)fs.closeSync(fd);for(const parent of held.reverse())fs.closeSync(parent);}
}
function ownSource(file){if(!OWN_FILES.includes(file))fail('RUNTIME_OWN_SOURCE');return fileURLToPath(new URL(file,import.meta.url));}
export function readStaticManifest(){return json(streamVerified({...MANIFEST,path:ownSource(MANIFEST.path)},{collect:true}));}
export function ownedSourceRefs(){return OWN_FILES.map(file=>{const p=ownSource(file),fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>262144)fail('RUNTIME_SOURCE_BOUND');const b=fs.readFileSync(fd);if(b.length!==stat.size||fs.fstatSync(fd).size!==stat.size)fail('RUNTIME_SOURCE_CHANGED');return{path:'actual-entry-v1/runtime/'+file,sha256:sha(b),bytes:b.length};}finally{fs.closeSync(fd);}});}
export function readFixtureJSON(root,expected,{permit}){assertFictionalPermit(permit,root,{phase:'PREPARE_SELECTED69'});ref(expected);if(!expected.path.startsWith(root+'/'))fail('RUNTIME_FICTIONAL_PATH_ONLY');return json(streamVerified(expected,{collect:true}));}
export function fixtureBackend(root,definition,{permit}){
  assertFictionalPermit(permit,root,{phase:'PREPARE_SELECTED69'});if(definition.schema!=='FICTIONAL_RUNTIME_ROLE_BINDINGS_V1'||definition.actual_authority!==false||!Array.isArray(definition.rows)||definition.rows.length>64)fail('RUNTIME_FIXTURE_DEFINITION');const byRole=new Map(),aliases=new Map();for(const row of definition.rows){if(typeof row.role!=='string'||byRole.has(row.role))fail('RUNTIME_FIXTURE_ROLE');ref(row.logical_ref);ref(row.physical_ref);if(!row.physical_ref.path.startsWith(root+'/'))fail('RUNTIME_FICTIONAL_PATH_ONLY');if(aliases.has(row.logical_ref.path))equal(aliases.get(row.logical_ref.path),row.physical_ref);aliases.set(row.logical_ref.path,row.physical_ref);byRole.set(row.role,row);}
  return Object.freeze({read(role,expected,{collect=false}={}){const row=byRole.get(role);if(!row)fail('RUNTIME_MISSING_FIXTURE_ROLE');equal(row.logical_ref,expected);return streamVerified(row.physical_ref,{collect});},locate(pkg){
    // This is direct fictional binding validation, NOT Node package resolution.
    // A general resolver may walk ancestors outside the permitted fixture root.
    if(typeof pkg.name!=='string'||! /^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/u.test(pkg.name)||pkg.name.split('/').some(p=>p==='.'||p==='..'))fail('RUNTIME_PACKAGE_LOCATION');
    ref(pkg.importer_ref);ref(pkg.descriptor_ref);ref(pkg.import_entry_ref);if(pkg.require_entry_ref)ref(pkg.require_entry_ref);
    const importers=definition.importers?.filter(r=>r.logical_path===pkg.importer_ref.path),importerRef=aliases.get(pkg.importer_ref.path);
    if(importers?.length!==1||!importerRef||typeof importers[0].physical_path!=='string'||path.resolve(importers[0].physical_path)!==importers[0].physical_path||!importers[0].physical_path.startsWith(root+'/')||importers[0].physical_path!==importerRef.path)fail('RUNTIME_FIXTURE_IMPORTER');
    for(const row of definition.rows.filter(r=>r.logical_ref.path===pkg.importer_ref.path))equal(row.logical_ref,pkg.importer_ref);
    streamVerified(importerRef); // Authenticate the held no-follow regular importer before any package file.
    const packageRoot=path.join(root,'node_modules',pkg.name),logicalRoot=path.dirname(pkg.descriptor_ref.path);
    const bound=(role,expected,physicalPath)=>{const row=byRole.get(role);if(!row)fail('RUNTIME_PACKAGE_LOCATION');equal(row.logical_ref,expected);if(row.physical_ref.path!==physicalPath)fail('RUNTIME_PACKAGE_LOCATION');streamVerified(row.physical_ref);};
    bound('descriptor:'+pkg.name,pkg.descriptor_ref,path.join(packageRoot,'package.json'));
    for(const [role,expected]of [['entry:',pkg.import_entry_ref],...(pkg.require_entry_ref?[['require-entry:',pkg.require_entry_ref]]:[])]){const relative=path.relative(logicalRoot,expected.path);if(!relative||relative.startsWith('../')||path.isAbsolute(relative))fail('RUNTIME_PACKAGE_LOCATION');bound(role+pkg.name,expected,path.join(packageRoot,relative));}
    return {specifier:pkg.name,logical_descriptor:pkg.descriptor_ref.path,fixture_descriptor:path.join(packageRoot,'package.json'),resolver:'DIRECT_BOUND_FICTIONAL_PACKAGE_LOCATION_NOT_NODE_RESOLUTION',real_package_resolved:false,real_resolver_connection_implemented:false};
  }});
}

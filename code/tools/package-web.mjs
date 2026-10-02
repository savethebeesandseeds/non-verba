#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Container-only browser export using the provisioned Node runtime.
// node tools/package-web.mjs [--output-dir /workspace/code/artifacts/container-builds/<build>]
// Keeps existing releases. Performs no builds, installations or sensor operations.
import {readFile,writeFile,mkdir,readdir,lstat,realpath} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,dirname,join,basename,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {crc32,parseZip,entryBytes} from './verify-android-package.mjs';
import {captureBuildSources,assertBuildSourcesUnchanged} from './browser-package-sources.mjs';
import {collectReleaseNotices} from './release-notices.mjs';
const code=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const webRoot=resolve(code,'../web/dist'),exportsRoot=join(code,'artifacts/container-builds');
const target='/opt/nonverba-build/target/wasm32-unknown-unknown/release/nonverba_core.wasm';
const bindgen='/opt/nonverba-tools/wasm-bindgen/wasm-bindgen';
const MAX_FILE=128*1024*1024,MAX_TOTAL=512*1024*1024;
const insist=(value,message)=>{if(!value)throw new Error(message);};
const digest=data=>createHash('sha256').update(data).digest('hex');
const execute=promisify(execFile);
export function safeName(name){
  insist(typeof name==='string'&&name.length>0&&!name.startsWith('/')&&!name.includes('\\')
    &&!/[\\\x00-\x1f\x7f]/.test(name)&&!/^[A-Za-z]:/.test(name)
    &&name.split('/').every(p=>p!==''&&p!=='.'&&p!=='..'),'Unsafe archive name: '+name);
  insist(basename(name).toLowerCase()!=='review.html','Local review entry must not be packaged: '+name);
}
export function releaseReadme(source,version){
  insist(/^\d+\.\d+\.\d+$/.test(version),'Invalid browser version.');
  insist(source.startsWith('Non-verba camera, audio and location {{VERSION}} - development preview\n')
    && (source.match(/\{\{VERSION\}\}/g)||[]).length===1 && source.trim().split('\n').length>=20,
    'Release README template changed; review the preserved warnings.');
  return Buffer.from(source.replace('{{VERSION}}',version).trimEnd()+'\n');
}
// Fixed metadata, bounded ZIP32 deflate writer. The independent central/local
// parser verifies every produced archive before it can receive a passing report.
export function makeArchive(payloads){
  insist(payloads instanceof Map&&payloads.size>0&&payloads.size<=10000,'Unsupported archive entry count.');
  const local=[],central=[];let offset=0,total=0;
  for(const [name,data] of [...payloads].sort(([a],[b])=>a<b?-1:a>b?1:0)){
    safeName(name);insist(Buffer.isBuffer(data)&&data.length<=MAX_FILE,'Input exceeds package bound.');
    total+=data.length;insist(total<=MAX_TOTAL,'Expanded browser package exceeds bound.');
    const encoded=Buffer.from(name),compressed=deflateRawSync(data,{level:6}),crc=crc32(data);
    insist(encoded.length<=65535,'Archive name exceeds ZIP32 bound.');
    const header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);
    header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);
    header.writeUInt32LE(data.length,22);header.writeUInt16LE(encoded.length,26);
    const entry=Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(0x314,4);entry.writeUInt16LE(20,6);
    entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(8,10);entry.writeUInt16LE(33,14);
    entry.writeUInt32LE(crc,16);entry.writeUInt32LE(compressed.length,20);entry.writeUInt32LE(data.length,24);
    entry.writeUInt16LE(encoded.length,28);entry.writeUInt32LE((0o100644*65536)>>>0,38);entry.writeUInt32LE(offset,42);
    local.push(header,encoded,compressed);central.push(entry,encoded);
    offset+=header.length+encoded.length+compressed.length;
    insist(offset<=MAX_TOTAL,'Archive exceeds inspection bound.');
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(payloads.size,8);end.writeUInt16LE(payloads.size,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  insist(offset+directory.length+end.length<=MAX_TOTAL,'Archive exceeds inspection bound.');
  return Buffer.concat([...local,directory,end]);
}
export function verifyArchive(bytes,expected){
  insist(bytes.length<=MAX_TOTAL,'Archive exceeds inspection bound.');
  const entries=parseZip(bytes);
  insist(entries.size===expected.size&&[...entries.keys()].every(k=>expected.has(k)),'Archive file set differs from expected package.');
  let total=0;const assets=[];
  for(const [name,entry] of entries){
    safeName(name);total+=entry.bytes;insist(total<=MAX_TOTAL,'Expanded browser package exceeds bound.');
    const data=entryBytes(bytes,entry),wanted=expected.get(name),sha=digest(data);
    insist(data.length===wanted.bytes&&sha===wanted.sha256,'Archive entry differs from expected bytes: '+name);
    assets.push({path:name,bytes:data.length,sha256:sha});
  }
  return assets.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
async function regularBytes(path){
  const stat=await lstat(path);insist(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=MAX_FILE,'Missing, symlinked or oversized input: '+path);
  const bytes=await readFile(path);insist(bytes.length<=MAX_FILE,'Input exceeds package bound: '+path);return bytes;
}
async function files(root,excludeReview=false){
  const result=new Map();
  async function visit(directory,prefix=''){
    const stat=await lstat(directory);insist(stat.isDirectory()&&!stat.isSymbolicLink(),'Invalid input directory: '+directory);
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const name=prefix+entry.name,path=join(directory,entry.name);
      insist(!entry.isSymbolicLink(),'Symlinked input is unsupported: '+path);
      if(entry.isDirectory())await visit(path,name+'/');
      else {
        insist(entry.isFile(),'Non-regular input: '+path);
        if(excludeReview&&entry.name.toLowerCase()==='review.html')continue;
        safeName(name);result.set(name,path);
      }
    }
  }
  await visit(root);insist(result.size>0,'No input files: '+root);return result;
}
async function compareBuild(web,inspection){
  const src=resolve(code,'../web/src'),source=new Map();
  for(const item of await readdir(src,{withFileTypes:true})){
    if(item.isFile()&&['.html','.js','.css'].includes(extname(item.name)))source.set(item.name,join(src,item.name));
  }
  const built=[...web.keys()].filter(n=>!n.includes('/')&&['.html','.js','.css'].includes(extname(n)));
  insist(built.length===source.size&&built.every(n=>source.has(n)),'web/dist entry files differ from current web/src.');
  for(const [name,path] of source)insist(digest(await regularBytes(path))===digest(await regularBytes(web.get(name))),'Stale web/dist source asset: '+name);
  const rust=[join(code,'Cargo.toml'),join(code,'Cargo.lock')];
  const crateFiles=await files(join(code,'crates'));
  for(const [name,path] of crateFiles)if(name.endsWith('.rs')||basename(name)==='Cargo.toml')rust.push(path);
  let latest=rust[0],mtime=0n;
  for(const path of rust){const st=await lstat(path,{bigint:true});if(st.mtimeNs>mtime){mtime=st.mtimeNs;latest=path;}}
  const wasmStat=await lstat(target,{bigint:true});
  insist(wasmStat.mtimeNs>=mtime,'Linux WASM output predates current Rust input: '+latest);
  const wasmHash=digest(await regularBytes(target)),reference=join(inspection,'wasm-reference');
  await mkdir(reference);await execute(bindgen,['--target','web','--out-dir',reference,'--out-name','nonverba_core',target],{timeout:60000,maxBuffer:1024*1024});
  const generated=await files(reference),packaged=[...web.keys()].filter(n=>n.startsWith('pkg/')).map(n=>n.slice(4));
  insist(generated.size===packaged.length&&packaged.every(n=>generated.has(n)),'Generated Linux WASM file set differs from web/dist/pkg.');
  for(const [name,path] of generated)insist(digest(await regularBytes(path))===digest(await regularBytes(web.get('pkg/'+name))),'WASM asset differs from current Linux output: '+name);
  insist(digest(await regularBytes(target))===wasmHash,'Linux WASM output changed during inspection.');
  return {source_assets_match:true,wasm_matches_current_linux_output:true,wasm_build_output:target,
    wasm_build_sha256:wasmHash,newest_rust_input:latest,wasm_modified_utc:new Date(Number(wasmStat.mtimeMs)).toISOString(),
    freshness_basis:'Exact current web source and regenerated wasm-bindgen bytes; local modification times. Not reproducible-build attestation.'};
}
async function main(){
  insist(process.platform==='linux'&&process.env.NONVERBA_CONTAINER==='1'&&(await lstat('/.dockerenv')).isFile(),'Use code/dev.ps1 inside managed non-verba-dev; host packaging is prohibited.');
  const args=process.argv.slice(2);insist(args.length===0||(args.length===2&&args[0]==='--output-dir'),'Usage: node tools/package-web.mjs [--output-dir DIRECTORY]');
  const version=JSON.parse(await readFile(join(code,'package.json'),'utf8')).version;insist(/^\d+\.\d+\.\d+$/.test(version),'Invalid browser version.');
  const stamp=new Date().toISOString().replaceAll(/[-:]/g,'').replace(/\.\d+Z$/,'Z')+'-'+randomBytes(4).toString('hex');
  await mkdir(exportsRoot,{recursive:true});
  const output=args.length?resolve(args[1]):join(exportsRoot,stamp);
  if(args.length){
    const st=await lstat(output);insist(st.isDirectory()&&!st.isSymbolicLink()&&dirname(await realpath(output))===await realpath(exportsRoot),'Output must be an existing direct directory under container-builds.');
  }else await mkdir(output);
  const archive=join(output,'nonverba-browser-'+version+'.zip'),checksum=archive+'.sha256';
  const inspection=join(code,'artifacts/qa','browser-'+version+'-linux-package-'+stamp+'-files'),reportPath=inspection.slice(0,-6)+'.json';
  await mkdir(inspection,{recursive:true});
  const report={schema_version:2,version,checked_at_utc:new Date().toISOString(),passed:false,archive,report_path:reportPath,inspection_directory:inspection,
    device_tested:false,browser_tests_run:false,sensor_tests_run:false,legacy_releases_modified:false,packager:'node',errors:[],assets:[]};
  try{
    for(const path of [archive,checksum]){
      let found=false;try{await lstat(path);found=true;}catch(e){if(e.code!=='ENOENT')throw e;}
      insist(!found,'Export already exists; select a fresh directory. Existing releases are preserved.');
    }
    const sourcePaths={sourceRoot:resolve(code,'../web/src'),cratesRoot:join(code,'crates'),cargoRoot:code};
    const sourceManifest=await captureBuildSources(sourcePaths);
    const web=await files(webRoot,true);insist(web.has('pkg/nonverba_core_bg.wasm'),'Shared WebAssembly asset is missing.');
    Object.assign(report,await compareBuild(web,inspection));
    const payloadPaths=new Map([...web].map(([name,path])=>['web/dist/'+name,path]));
    payloadPaths.set('code/tools/serve.mjs',join(code,'tools/serve.mjs'));
    const readmePath=join(code,'tools/release-readme.txt'),readme=releaseReadme((await regularBytes(readmePath)).toString('utf8').replace(/\r\n/g,'\n').replace(/^\uFEFF/,''),version);
    const payloads=new Map(),expected=new Map();let total=readme.length;
    for(const [name,path] of payloadPaths){
      const data=await regularBytes(path);total+=data.length;insist(total<=MAX_TOTAL,'Expanded browser package exceeds bound.');
      payloads.set(name,data);expected.set(name,{bytes:data.length,sha256:digest(data)});
    }
    payloads.set('README.txt',readme);expected.set('README.txt',{bytes:readme.length,sha256:digest(readme)});
    const notices=await collectReleaseNotices();
    for(const [name,data] of notices){
      total+=data.length;insist(total<=MAX_TOTAL,'Expanded browser package exceeds bound.');
      payloads.set(name,data);expected.set(name,{bytes:data.length,sha256:digest(data)});
    }
    const bytes=makeArchive(payloads);await writeFile(archive,bytes,{flag:'wx'});
    report.assets=verifyArchive(await readFile(archive),expected);
    for(const [name,path] of payloadPaths)insist(digest(await regularBytes(path))===expected.get(name).sha256,'Build input changed during archive verification: '+name);
    insist(digest(await regularBytes(target))===report.wasm_build_sha256,'Linux WASM output changed before package completion.');
    insist(releaseReadme((await regularBytes(readmePath)).toString('utf8').replace(/\r\n/g,'\n').replace(/^\uFEFF/,''),version).equals(readme),'README source changed during packaging.');
    const recheckedNotices=await collectReleaseNotices();
    insist(recheckedNotices.size===notices.size&&[...notices].every(([name,data])=>recheckedNotices.get(name)?.equals(data)),'License/source notices changed during packaging.');
    insist(digest(await readFile(archive))===digest(bytes),'Archive changed during verification.');
    Object.assign(report,{bytes:bytes.length,sha256:digest(bytes),web_assets:web.size,review_excluded:true,server_matches:true,release_warnings_preserved:true,license_source_notices_included:true,notice_count:notices.size,readme_sha256:digest(readme)});
    await writeFile(checksum,report.sha256+'  '+basename(archive)+'\n',{flag:'wx'});
    await assertBuildSourcesUnchanged(sourceManifest,sourcePaths);
    report.source_manifest=sourceManifest;report.source_manifest_rechecked=true;
    report.checksum_path=checksum;report.passed=true;
  }catch(error){report.errors.push(error.message);}
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(Object.fromEntries(['passed','archive','report_path','web_assets','sha256','errors'].map(k=>[k,report[k]])),null,2));
  if(!report.passed)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});

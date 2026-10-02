#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Read-only comparison against a current, already built checkout.
import {readFile,lstat,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyArchive,releaseReadme} from './package-web.mjs';
import {collectReleaseNotices} from './release-notices.mjs';

const code=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(process.platform!=='linux'||process.env.NONVERBA_CONTAINER!=='1') throw new Error('Run inside the managed Linux container.');
if(args.length!==2||args[0]!=='--archive') throw new Error('Usage: node tools/verify-web-package.mjs --archive PATH');
const hash=data=>createHash('sha256').update(data).digest('hex');
const expected=new Map();
async function add(name,path) {
  const item=await lstat(path);
  if(!item.isFile()||item.isSymbolicLink()||item.size>128*1024*1024) throw new Error('Unsupported package input: '+path);
  const data=await readFile(path);expected.set(name,{bytes:data.length,sha256:hash(data)});
}
async function visit(path,prefix='') {
  const item=await lstat(path);
  if(!item.isDirectory()||item.isSymbolicLink()) throw new Error('Linked package source directory.');
  for(const entry of await readdir(path,{withFileTypes:true})) {
    if(entry.name.toLowerCase()==='review.html') continue;
    if(entry.isDirectory()) await visit(join(path,entry.name),prefix+entry.name+'/');
    else await add('web/dist/'+prefix+entry.name,join(path,entry.name));
  }
}
await visit(resolve(code,'../web/dist'));
await add('code/tools/serve.mjs',join(code,'tools/serve.mjs'));
const version=JSON.parse(await readFile(join(code,'package.json'),'utf8')).version;
const readme=releaseReadme((await readFile(join(code,'tools/release-readme.txt'),'utf8')).replace(/\r\n/g,'\n'),version);
expected.set('README.txt',{bytes:readme.length,sha256:hash(readme)});
for(const [name,data] of await collectReleaseNotices()) expected.set(name,{bytes:data.length,sha256:hash(data)});
const path=resolve(args[1]),item=await lstat(path);
if(!item.isFile()||item.isSymbolicLink()||item.size>512*1024*1024) throw new Error('Unsupported browser archive.');
const archive=await readFile(path),assets=verifyArchive(archive,expected);
console.log(JSON.stringify({passed:true,archive:path,sha256:hash(archive),assets:assets.length,license_source_notices_verified:true,device_tested:false},null,2));

// SPDX-License-Identifier: AGPL-3.0-only
import {mkdir,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {stageFaceModel} from './stage-face-model.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const webRoot=path.resolve(root,'../web');
if(process.platform!=='linux'||process.env.NONVERBA_CONTAINER!=='1')throw new Error('Run the web build through code/dev.ps1 inside non-verba-dev.');
function run(command,args){const result=spawnSync(command,args,{cwd:root,stdio:'inherit',shell:false});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
run('cargo',['build','--locked','--release','--target','wasm32-unknown-unknown','-p','nonverba-core']);
await mkdir(path.join(webRoot,'dist/pkg'),{recursive:true});
run('wasm-bindgen',['--target','web','--out-dir','../web/dist/pkg','--out-name','nonverba_core',path.join(process.env.CARGO_TARGET_DIR||path.join(root,'target'),'wasm32-unknown-unknown/release/nonverba_core.wasm')]);
for(const item of await readdir(path.join(webRoot,'src'))){if(!item.endsWith('.html')&&!item.endsWith('.js')&&!item.endsWith('.css'))continue;await copyFile(path.join(webRoot,'src',item),path.join(webRoot,'dist',item));}
// Local Codex element review needs inline style elements. Production stays strict.
const html=await readFile(path.join(webRoot,'src/index.html'),'utf8');
const review=html.replace('<title>','<meta name="robots" content="noindex,nofollow"><title>').replace("style-src 'self';", "style-src 'self'; style-src-elem 'self' 'unsafe-inline';");
await writeFile(path.join(webRoot,'dist/review.html'),review);
await stageFaceModel();
console.log('Built ../web/dist (review.html is local-only and excluded from Android packaging).');

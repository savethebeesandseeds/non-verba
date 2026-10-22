// SPDX-License-Identifier: AGPL-3.0-only
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {stageFaceModel} from '../provision/stage-face-model.mjs';
import {collectBuildFiles,stageBuildFiles} from './build-files.mjs';
import {collectWebAssets,assertAndroidWebAssets,ANDROID_WEB_DIST} from './web-assets.mjs';
import {enterAndroidBuildLock} from './android-build-lock.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const webRoot=path.resolve(root,'../web');
if(process.platform!=='linux'||process.env.NONVERBA_CONTAINER!=='1')throw new Error('Run the web build through code/dev.ps1 inside non-verba-dev.');
const args=process.argv.slice(2);
if(args.length>1||(args.length===1&&args[0]!=='--android'))throw new Error('Usage: node tools/build/build-web.mjs [--android]');
const android=args[0]==='--android';
enterAndroidBuildLock();
const output=path.join(webRoot,android?ANDROID_WEB_DIST:'dist');
const sourceAssets=await collectWebAssets(webRoot,{target:android?'android':'browser'});
const assets=new Map(sourceAssets);
function run(command,args,capture=false){const result=spawnSync(command,args,{cwd:root,stdio:capture?'pipe':'inherit',encoding:'utf8',shell:false});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed (${result.status}): ${result.stderr||''}`);return(result.stdout||'').trim();}
const bindgen=process.env.NONVERBA_WASM_BINDGEN||'wasm-bindgen';
const version=run(bindgen,['--version'],true);
if(version!=='wasm-bindgen 0.2.122')throw new Error(`Expected wasm-bindgen 0.2.122; found ${version}.`);
run('cargo',['build','--locked','--release','--target','wasm32-unknown-unknown','-p','nonverba-core']);
await mkdir(output,{recursive:true});
// Bindgen rewrites all outputs. Compare its temporary result before staging so
// an unchanged WASM build does not invalidate Android asset packaging.
const temporary=await mkdtemp(path.join(output,'.bindgen-'));
try {
  run(bindgen,['--target','web','--out-dir',temporary,'--out-name','nonverba_core',path.join(process.env.CARGO_TARGET_DIR||path.join(root,'target'),'wasm32-unknown-unknown/release/nonverba_core.wasm')]);
  for(const [name,bytes] of await collectBuildFiles(temporary))assets.set('pkg/'+name,bytes);
} finally {await rm(temporary,{recursive:true,force:true});}
if(!android){
  // Local Codex element review needs inline style elements. Production stays strict.
  const html=assets.get('index.html').toString('utf8');
  assets.set('review.html',Buffer.from(html.replace('<title>','<meta name="robots" content="noindex,nofollow"><title>').replace("style-src 'self';", "style-src 'self'; style-src-elem 'self' 'unsafe-inline';")));
}
if(android)assertAndroidWebAssets(assets,sourceAssets);
const staged=await stageBuildFiles(output,assets,{ignore:name=>!android&&name.split('/')[0]==='face-model'});
if(!android)await stageFaceModel();
console.log(`Built ../web/${android?ANDROID_WEB_DIST:'dist'} for ${android?'Android developer tools':'browser review'}: ${staged.files} files, ${staged.changed} changed.`);

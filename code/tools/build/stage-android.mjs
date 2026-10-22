// SPDX-License-Identifier: AGPL-3.0-only
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {collectReleaseNotices} from './release-notices.mjs';
import {collectWebAssets,assertAndroidWebAssets,ANDROID_WEB_DIST} from './web-assets.mjs';
import {collectBuildFiles,stageBuildFiles} from './build-files.mjs';
import {enterAndroidBuildLock} from './android-build-lock.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(process.platform!=='linux'||process.env.NONVERBA_CONTAINER!=='1')throw new Error('Stage Android assets inside non-verba-dev.');
enterAndroidBuildLock();
const assets=new Map();
const webRoot=path.resolve(root,'../web');
const web=await collectBuildFiles(path.join(webRoot,ANDROID_WEB_DIST));
assertAndroidWebAssets(web,await collectWebAssets(webRoot,{target:'android'}));
for(const [name,bytes] of web)assets.set('web/'+name,bytes);
for(const [name,bytes] of await collectReleaseNotices()) {
  assets.set('nonverba-license/'+name,bytes);
}
const buildRoot=process.env.NONVERBA_BUILD_ROOT||'/opt/nonverba-build';
const staged=await stageBuildFiles(path.join(buildRoot,'android/app/build/generated/developer-assets'),assets);
console.log(`Staged Android developer assets and notices: ${staged.files} files, ${staged.changed} changed.`);

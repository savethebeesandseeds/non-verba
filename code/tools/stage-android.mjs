// SPDX-License-Identifier: AGPL-3.0-only
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {collectReleaseNotices} from './release-notices.mjs';
import {isAndroidBrowserOnly} from './android-web-assets.mjs';
import {collectBuildFiles,stageBuildFiles} from './build-files.mjs';
import {enterAndroidBuildLock} from './android-build-lock.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='linux'||process.env.NONVERBA_CONTAINER!=='1')throw new Error('Stage Android assets inside non-verba-dev.');
enterAndroidBuildLock();
const assets=new Map();
for(const [name,bytes] of await collectBuildFiles(path.resolve(root,'../web/dist'),{ignore:isAndroidBrowserOnly}))assets.set('web/'+name,bytes);
for(const [name,bytes] of await collectReleaseNotices()) {
  assets.set('nonverba-license/'+name,bytes);
}
const staged=await stageBuildFiles(path.join(root,'android/app/src/main/assets'),assets);
console.log(`Staged Android developer assets and notices: ${staged.files} files, ${staged.changed} changed.`);

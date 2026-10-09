// SPDX-License-Identifier: AGPL-3.0-only
import {mkdir,readdir,copyFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {collectReleaseNotices} from './release-notices.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function copy(from,to){await mkdir(to,{recursive:true});for(const entry of await readdir(from,{withFileTypes:true})){if(entry.name==='review.html'||entry.name==='face-model')continue;const source=path.join(from,entry.name),dest=path.join(to,entry.name);if(entry.isDirectory())await copy(source,dest);else await copyFile(source,dest);}}
await copy(path.resolve(root,'../web/dist'),path.join(root,'android/app/src/main/assets/web'));
for(const [name,bytes] of await collectReleaseNotices()) {
  const destination=path.join(root,'android/app/src/main/assets/nonverba-license',name);
  await mkdir(path.dirname(destination),{recursive:true});
  await writeFile(destination,bytes);
}
console.log('Staged shared Rust/WASM app and license/source notices into Android assets.');

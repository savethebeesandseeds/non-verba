// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,utimes,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureBuildSources,assertBuildSourcesUnchanged} from '../tools/browser-package-sources.mjs';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'nonverba-package-sources-')),sourceRoot=join(root,'src'),cratesRoot=join(root,'crates');
 await mkdir(sourceRoot);await mkdir(cratesRoot);
 await writeFile(join(sourceRoot,'app.js'),'old');await writeFile(join(cratesRoot,'lib.rs'),'old');
 await writeFile(join(root,'Cargo.toml'),'workspace');await writeFile(join(root,'Cargo.lock'),'locked');
 return {sourceRoot,cratesRoot,cargoRoot:root};
}
test('unchanged bounded source set retains its exact manifest',async()=>{
 const paths=await fixture(),before=await captureBuildSources(paths);
 assert.deepEqual(await assertBuildSourcesUnchanged(before,paths),before);
 assert.equal(Object.keys(before).length,4);
});
test('post-check web source edits reject even when build output is untouched',async()=>{
 const paths=await fixture(),before=await captureBuildSources(paths);
 await writeFile(join(paths.sourceRoot,'app.js'),'changed');
 await assert.rejects(assertBuildSourcesUnchanged(before,paths),/changed during packaging/);
});
test('added and removed eligible source files reject',async()=>{
 for(const added of [true,false]){
  const paths=await fixture(),before=await captureBuildSources(paths);
  if(added)await writeFile(join(paths.sourceRoot,'new.css'),'style');
  else await rename(join(paths.sourceRoot,'app.js'),join(paths.sourceRoot,'app.saved'));
  await assert.rejects(assertBuildSourcesUnchanged(before,paths),/changed during packaging/);
 }
});
test('changed Rust content rejects even with a backdated source mtime',async()=>{
 const paths=await fixture(),before=await captureBuildSources(paths),source=join(paths.cratesRoot,'lib.rs');
 await writeFile(source,'new');await utimes(source,new Date(0),new Date(0));
 await assert.rejects(assertBuildSourcesUnchanged(before,paths),/changed during packaging/);
});
test('source symlink substitution fails closed',async()=>{
 const paths=await fixture(),before=await captureBuildSources(paths),source=join(paths.sourceRoot,'app.js');
 await rename(source,source+'.saved');await symlink(source+'.saved',source);
 await assert.rejects(assertBuildSourcesUnchanged(before,paths),/Invalid source input/);
});

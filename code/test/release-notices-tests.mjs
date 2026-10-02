// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceNotice,collectReleaseNotices} from '../tools/release-notices.mjs';
const revision='a'.repeat(40);

test('dirty source identifies its base without presenting it as matching published source',()=>{
  const notice=sourceNotice({NONVERBA_SOURCE_REVISION:revision,NONVERBA_SOURCE_DIRTY:'1'}).toString();
  assert.ok(notice.includes('modified development snapshot'));
  assert.ok(notice.includes('complete matching source'));
  assert.ok(!notice.includes('/tree/'+revision));
  assert.ok(sourceNotice({NONVERBA_SOURCE_REVISION:revision,NONVERBA_SOURCE_DIRTY:'0'}).toString().includes('/tree/'+revision));
});
test('malformed source metadata cannot enter release notices',()=>{
  for(const environment of [{NONVERBA_SOURCE_REVISION:'HEAD\nmisleading'}, {NONVERBA_SOURCE_DIRTY:'clean'}, {NONVERBA_SOURCE_SNAPSHOT_SHA256:'abc'}]) {
    assert.throws(()=>sourceNotice(environment),/Invalid source/);
  }
});
test('release notices retain license bytes and reject linked notice inputs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nonverba-notices-'));
  await mkdir(join(root,'LICENSES'));
  await writeFile(join(root,'LICENSE'),'project license\n');
  await writeFile(join(root,'LICENSES','third-party.txt'),'independent license\n');
  const notices=await collectReleaseNotices(root,{});
  assert.equal(notices.get('LICENSE.txt').toString(),'project license\n');
  assert.equal(notices.get('LICENSES/third-party.txt').toString(),'independent license\n');
  await symlink(join(root,'LICENSE'),join(root,'LICENSES','linked.txt'));
  await assert.rejects(()=>collectReleaseNotices(root,{}),/Linked license notice/);
});

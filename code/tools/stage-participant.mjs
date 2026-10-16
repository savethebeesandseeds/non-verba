#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Stage only the reviewed participant shell and release notices in Linux caches.
import {access, lstat, mkdir, open, rename, unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {enterAndroidBuildLock} from './android-build-lock.mjs';
import {PARTICIPANT_STAGE, assertUnlinkedDirectory, assertUnlinkedParents, collectParticipantAssets,
  inspectParticipantStage, assertSameParticipantAssets, assertParticipantAssetNames, readBoundedParticipantFile} from './participant-assets.mjs';

const insist = (condition, message) => { if (!condition) throw new Error(message); };
async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function ensureDirectory(path) {
  try { await assertUnlinkedDirectory(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await ensureDirectory(dirname(path));
    await mkdir(path);
    await assertUnlinkedDirectory(path);
  }
}

async function main() {
  insist(process.platform === 'linux' && process.env.NONVERBA_CONTAINER === '1' && await exists('/.dockerenv'),
    'Run only inside managed non-verba-dev; host staging is prohibited.');
  insist(process.argv.length === 2, 'Usage: node tools/stage-participant.mjs (no destination override).');
  enterAndroidBuildLock();
  const assets = await collectParticipantAssets();
  // Check all existing output before any write. Known files may be replaced;
  // stale unknown files, links and directories require an explicit review.
  await ensureDirectory(PARTICIPANT_STAGE);
  const before = await inspectParticipantStage(PARTICIPANT_STAGE, assets, {allowMissing:true, compareBytes:false});
  for (const [name, bytes] of assets) {
    if (before.get(name)?.equals(bytes)) continue;
    const destination = join(PARTICIPANT_STAGE, name);
    await ensureDirectory(dirname(destination));
    await assertUnlinkedParents(destination);
    if (before.has(name)) {
      const info = await lstat(destination);
      insist(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'Participant stage changed: ' + name);
      insist((await readBoundedParticipantFile(destination, 16 * 1024 * 1024)).equals(before.get(name)),
        'Participant stage content changed after preflight: ' + name);
    } else {
      try { await lstat(destination); throw new Error('Participant stage changed: ' + name); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const temporary = join(dirname(destination), '.participant-stage-' + randomBytes(12).toString('hex'));
    let created = false;
    try {
      const transfer = await open(temporary, 'wx', 0o644); created = true;
      try { await transfer.writeFile(bytes); } finally { await transfer.close(); }
      await rename(temporary, destination); created = false;
    } finally {
      // Only this invocation's unfinished transfer file may be removed.
      if (created) await unlink(temporary);
    }
  }
  assertSameParticipantAssets(assets, await collectParticipantAssets());
  await inspectParticipantStage(PARTICIPANT_STAGE, assets);
  console.log(JSON.stringify({staged:true, destination:PARTICIPANT_STAGE, asset_count:assets.size,
    shell_bytes:assertParticipantAssetNames(assets), developer_assets_included:false, native_libraries_included:false}));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

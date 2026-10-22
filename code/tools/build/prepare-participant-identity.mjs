#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Decode the shared workflow's exact synthetic illustrations into self-hosted
// previews. Routine packaging consumes these reviewed files; no raster tool,
// model, remote request or additional runtime dependency is involved.
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SYNTHETIC_ENROLLMENT_MEDIA} from '../../test/fixtures/identity/synthetic-enrollment-workflow.js';
import {assertUnlinkedParents, readBoundedParticipantFile, PARTICIPANT_IMAGE_BUDGET} from './participant-assets.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const reviewedIds = ['document_a', 'document_b', 'face_a', 'face_b'];
const prefix = 'data:image/svg+xml;charset=utf-8,';
const insist = (condition, message) => { if (!condition) throw new Error(message); };

export function participantIdentityPreviews() {
  insist(SYNTHETIC_ENROLLMENT_MEDIA.length === reviewedIds.length
    && SYNTHETIC_ENROLLMENT_MEDIA.every((item, index) => item.fixture_id === reviewedIds[index]),
  'Review a changed synthetic enrollment illustration set before preparing participant previews.');
  return new Map(SYNTHETIC_ENROLLMENT_MEDIA.map(item => {
    insist(item.media_type === 'image/svg+xml' && item.data_url.startsWith(prefix),
      'Expected the shared synthetic SVG illustration format.');
    const bytes = Buffer.from(decodeURIComponent(item.data_url.slice(prefix.length)), 'utf8');
    insist(bytes.length > 0 && bytes.length <= PARTICIPANT_IMAGE_BUDGET,
      'Shared synthetic illustration exceeds the participant 8KiB image bound.');
    return ['web/apps/non-verba/assets/identity/' + item.fixture_id.replace('_', '-') + '.svg', bytes];
  }));
}

export async function prepareParticipantIdentity(mode, root = repositoryRoot) {
  insist(process.platform === 'linux' && process.env.NONVERBA_CONTAINER === '1',
    'Prepare participant identity fixtures only through the managed Debian snapshot launcher.');
  insist(['--write', '--check'].includes(mode), 'Use --write or --check for the prepared synthetic identity illustrations.');
  const outputs = [];
  for (const [name, bytes] of participantIdentityPreviews()) {
    const destination = resolve(root, name);
    let previous;
    try { previous = await readBoundedParticipantFile(destination, PARTICIPANT_IMAGE_BUDGET); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const matches = previous?.equals(bytes) || false;
    insist(mode !== '--check' || matches, 'Prepared participant identity fixture differs from the shared export: ' + name);
    if (mode === '--write' && !matches) {
      await mkdir(dirname(destination), {recursive:true});
      await assertUnlinkedParents(destination);
      await writeFile(destination, bytes, {flag:previous ? 'w' : 'wx', mode:0o644});
    }
    outputs.push({destination:name, bytes:bytes.length,
      sha256:createHash('sha256').update(bytes).digest('hex'), changed:!matches});
  }
  return {mode, source:'SYNTHETIC_ENROLLMENT_MEDIA', outputs};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  insist(process.argv.length === 3, 'Use --write or --check only.');
  console.log(JSON.stringify(await prepareParticipantIdentity(process.argv[2]), null, 2));
}

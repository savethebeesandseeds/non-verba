// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {IDENTITY_INTAKE_NOTICE as notice, IDENTITY_INTAKE_NOTICE_STATUS as status,
  IDENTITY_INTAKE_NOTICE_CONTENT_FORMAT as format} from '../../../web/apps/non-verba/src/identity-intake-notice.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('synthetic review notice pins exact text while preserving historical v1/v2 bytes', async () => {
  assert.deepEqual(Object.keys(notice).sort(), ['notice_id','sha256','text','version']);
  assert.ok(Object.isFrozen(notice));
  assert.equal(notice.notice_id, 'identity-intake');
  assert.equal(notice.version, 3);
  assert.equal(status, 'draft');
  assert.equal(format, 'nonverba-identity-intake-text-v1');
  assert.equal(Buffer.byteLength(notice.text), 5849);
  assert.equal(notice.sha256, 'e53aa71140a8fb50507e3f2330bb6c6ee90976c7a9240b7b12d567f619561ebd');
  assert.equal(digest(notice.text), notice.sha256);
  assert.equal(notice.text.split('\n\n').length, 10);
  assert.equal(/[\r\uFEFF]/.test(notice.text), false);
  assert.equal(notice.text.endsWith('\n'), false);
  assert.match(notice.text, /sends no photo or photo hash/);
  assert.match(notice.text, /validity windows are not storage expiry promises/);
  assert.match(notice.text, /Do not submit real personal information/);
  assert.match(notice.text, /separately authorized synthetic reviewers/);
  assert.match(notice.text, /append-only decision history/);
  assert.match(notice.text, /no real Level 1 or Level 2 verification/);
  assert.match(notice.text, /No retention period or automatic expiry/);
  const historical = await readFile(new URL('../../../docs/legal/identity-intake-v1.txt', import.meta.url));
  assert.equal(historical.length, 3509);
  assert.equal(digest(historical), 'e758daf9412756dd37ea43c79a7ebec21745109fa0dc9e9125fd029adbde8a27');
  assert.match(historical.toString('utf8'), /Synthetic Development Draft - version 1/);
  const historicalV2 = await readFile(new URL('../../../docs/legal/identity-intake-v2.txt', import.meta.url));
  assert.equal(historicalV2.length, 4694);
  assert.equal(digest(historicalV2), 'd39fa9049feb18fc7db8d2ce0731fecba738b3c10fadce09130521c3a270fbca');
  assert.match(historicalV2.toString('utf8'), /Synthetic Development Draft - version 2/);
});

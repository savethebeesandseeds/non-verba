// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertRegisteredTests} from '../tools/test-suites.mjs';

test('every repository Node test has one declared prerequisite group', async () => {
  const files = await assertRegisteredTests(); assert.ok(files.length > 40);
});

test('new tests fail the catalog check until assigned a group', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nonverba-test-catalog-'));
  await writeFile(join(root, 'new.mjs'), "import {test} from 'node:test';\n");
  await writeFile(join(root, 'browser.mjs'), '// Standalone browser harness.\n');
  await assert.rejects(assertRegisteredTests({root, suites: {unit: []}}), /Unregistered: new.mjs/);
  assert.deepEqual(await assertRegisteredTests({root, suites: {unit: ['new.mjs']}}), ['new.mjs']);
  await assert.rejects(assertRegisteredTests({root, suites: {unit: ['new.mjs'], evidence: ['new.mjs']}}), /more than once/);
  await assert.rejects(assertRegisteredTests({root, suites: {unit: ['new.mjs', 'browser.mjs']}}), /Missing\/non-test entries: browser.mjs/);
});

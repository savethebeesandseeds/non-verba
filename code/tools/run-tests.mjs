// SPDX-License-Identifier: AGPL-3.0-only
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TEST_SUITES, assertRegisteredTests} from './test-suites.mjs';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run test groups inside non-verba-dev through code/dev.ps1.');
const root = fileURLToPath(new URL('../', import.meta.url));
const groups = {javascript: ['unit', 'evidence', 'transport'], all: Object.keys(TEST_SUITES)};
const name = process.argv[2], selected = groups[name] ?? (Object.hasOwn(TEST_SUITES, name) ? [name] : null);
if (process.argv.length !== 3 || !selected) throw new Error(`Supply one test group: ${[...Object.keys(TEST_SUITES), ...Object.keys(groups)].join(', ')}.`);
await assertRegisteredTests();
function run(args) {
  const result = spawnSync(process.execPath, args, {cwd: root, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (selected.includes('cooperation')) run(['tools/build-wasm.mjs']);
if (selected.includes('evidence')) run(['tools/build-web.mjs']);
for (const group of selected) {
  console.log(`Running ${group} (${TEST_SUITES[group].length} Node test files).`);
  if (group === 'transport') {
    run(['test/usb-audio-export-guards.mjs', 'tools/usb-device.ps1']);
  } else run(['--test', ...TEST_SUITES[group].map(file => `test/${file}`)]);
}

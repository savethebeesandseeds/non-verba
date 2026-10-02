// SPDX-License-Identifier: AGPL-3.0-only
// Match the sensor core's pinned Rust + wasm-bindgen web target.
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliVersion = '0.2.122';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') {
  throw new Error('Build through code/dev.ps1 in the managed Linux container.');
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || ''}`);
  return (result.stdout || '').trim();
}

// The managed environment provisions the pinned CLI inside the container.
const bindgen = process.env.NONVERBA_WASM_BINDGEN || 'wasm-bindgen';
const version = run(bindgen, ['--version'], true);
if (version !== `wasm-bindgen ${cliVersion}`) {
  throw new Error(`Expected wasm-bindgen ${cliVersion}; found ${version}. See ../README.md.`);
}
run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'nonverba-cooperation']);
await mkdir(path.join(root, 'pkg'), { recursive: true });
run(bindgen, ['--target', 'web', '--out-dir', 'pkg', '--out-name', 'nonverba_cooperation',
  path.join(process.env.CARGO_TARGET_DIR || path.join(root, 'target'),
    'wasm32-unknown-unknown/release/nonverba_cooperation.wasm')]);
console.log('Built pkg/nonverba_cooperation.js and pkg/nonverba_cooperation_bg.wasm.');

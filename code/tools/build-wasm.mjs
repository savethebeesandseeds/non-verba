// Match the sensor core's pinned Rust + wasm-bindgen web target.
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliVersion = '0.2.122';

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || ''}`);
  return (result.stdout || '').trim();
}

// Reuse the already provisioned sensor CLI when this is the sibling checkout.
// Standalone checkouts can set NONVERBA_WASM_BINDGEN or install the pinned CLI.
const sensorCli = path.resolve(root, '../../private-source/code/.tools/wasm-bindgen/bin',
  process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen');
const bindgen = process.env.NONVERBA_WASM_BINDGEN
  || (existsSync(sensorCli) ? sensorCli : 'wasm-bindgen');
const version = run(bindgen, ['--version'], true);
if (version !== `wasm-bindgen ${cliVersion}`) {
  throw new Error(`Expected wasm-bindgen ${cliVersion}; found ${version}. See ../README.md.`);
}
run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'nonverba-cooperation']);
await mkdir(path.join(root, 'pkg'), { recursive: true });
run(bindgen, ['--target', 'web', '--out-dir', 'pkg', '--out-name', 'nonverba_cooperation',
  'target/wasm32-unknown-unknown/release/nonverba_cooperation.wasm']);
console.log('Built pkg/nonverba_cooperation.js and pkg/nonverba_cooperation_bg.wasm.');

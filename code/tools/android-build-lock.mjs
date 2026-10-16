// SPDX-License-Identifier: AGPL-3.0-only
import {fstatSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const shellHelper = fileURLToPath(new URL('./android-build-lock.sh', import.meta.url));

// Executable Node producers call this before shared IO. FD 9 remains open for
// their complete lifetime, including Cargo's post-build bindgen/copy window.
// A Node producer launching another protected entry must pass stdio[9] = 9.
export function enterAndroidBuildLock() {
  let descriptor = false;
  try { fstatSync(9); descriptor = true; }
  catch (error) { if (error.code !== 'EBADF') throw error; }
  const stdio = descriptor
    ? Array.from({length:10}, (_, fd) => fd < 3 ? 'inherit' : fd === 9 ? 9 : 'ignore')
    : 'inherit';
  // The shell always sources env.sh before validating FD 9. Merely setting an
  // environment flag or supplying a different lock descriptor cannot reenter.
  const check = spawnSync('bash', [shellHelper, '--check-inherited'], {stdio, shell:false});
  if (check.error) throw check.error;
  if (check.status === 0) return;
  if (check.status !== 76) process.exit(check.status ?? 1);
  const child = spawnSync('bash', [shellHelper, process.execPath, ...process.argv.slice(1)], {
    stdio:'inherit', env:process.env, shell:false,
  });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

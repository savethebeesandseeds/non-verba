// SPDX-License-Identifier: AGPL-3.0-only
// Publish only the homepage and its assets, never the whole web/ directory.
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const artifacts = path.join(root, 'code', 'artifacts');
const output = path.join(artifacts, 'pages');
const assets = [
  'index.html',
  'index.css',
  'index.js',
  'branding/sprout.svg',
  'branding/waajacu-favicon.png',
  'branding/individual/01-sprout.png',
];

// Read every input before replacing an earlier generated export.
const files = await Promise.all(assets.map(async (name) => [
  name, await readFile(path.join(root, 'web', name)),
]));
files.push(['LICENSE.txt', await readFile(path.join(root, 'LICENSE'))]);
files.push(['licenses/Primer-Octicons-MIT.txt',
  await readFile(path.join(root, 'LICENSES', 'Primer-Octicons-MIT.txt'))]);
files.push(['CNAME', 'non-verba.com\n'], ['.nojekyll', '']);

// The fixed generated directory must remain inside this checkout, including
// when someone has replaced a parent directory with a junction or symlink.
await mkdir(artifacts, { recursive: true });
if (await realpath(artifacts) !== artifacts) {
  throw new Error(`Refusing to export through a linked artifacts directory: ${artifacts}`);
}
const existing = await lstat(output).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
  throw new Error(`Expected an ordinary generated directory: ${output}`);
}
await rm(output, { recursive: true, force: true });
for (const [name, content] of files) {
  const destination = path.join(output, name);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

console.log(`Exported ${files.length} homepage files to ${output}`);

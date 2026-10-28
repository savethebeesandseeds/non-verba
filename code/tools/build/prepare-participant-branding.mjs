#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Explicit, container-only preparation of reviewed shared browser/APK artwork.
// Routine staging and builds consume the prepared files without running Chromium.
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {assertUnlinkedParents, readBoundedParticipantFile} from './participant-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const quality = 0.85, maximum = 8 * 1024;
const targets = Object.freeze([
  {source:'web/site/branding/individual/01-sprout.png', width:1254, height:1254, edge:160,
    destination:'web/apps/non-verba/assets/branding/home-sprout.webp'},
  {source:'web/site/branding/individual/23-succulent.png', width:1254, height:1254, edge:160,
    destination:'web/apps/non-verba/assets/branding/home-succulent.webp'},
  {source:'web/site/branding/waajacu-favicon.png', width:868, height:848, edge:48,
    destination:'web/apps/non-verba/assets/branding/waajacu.webp'},
  {source:'web/apps/non-verba/assets/identity/originals/level-1.png', width:1254, height:1254, edge:128, quality:0.78,
    destination:'web/apps/non-verba/assets/identity/level-1.webp'},
  {source:'web/apps/non-verba/assets/identity/originals/level-2.png', width:1254, height:1254, edge:128, quality:0.78,
    destination:'web/apps/non-verba/assets/identity/level-2.webp'},
  {source:'web/apps/non-verba/assets/identity/originals/unverified.png', width:1254, height:1254, edge:128, quality:0.78,
    destination:'web/apps/non-verba/assets/identity/unverified.webp'},
]);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') {
  throw new Error('Prepare participant branding only through the managed Debian snapshot launcher.');
}
if (process.argv.length !== 3 || !['--write', '--check'].includes(process.argv[2])) {
  throw new Error('Use --write to prepare, or --check to compare the reviewed participant artwork.');
}
const mode = process.argv[2];
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/nonverba-tools/browser-tests/browsers';
const {chromium} = await import(pathToFileURL(resolve(process.env.NONVERBA_PLAYWRIGHT_PATH ||
  '/opt/nonverba-tools/browser-tests/node_modules/playwright', 'index.mjs')).href);
const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  const outputs = [];
  for (const spec of targets) {
    const targetQuality = spec.quality ?? quality;
    const original = await readBoundedParticipantFile(resolve(root, spec.source), 2 * 1024 * 1024);
    const data = await page.evaluate(async ({source, width, height, edge, quality}) => {
      const image = new Image(); image.src = source; await image.decode();
      if (image.naturalWidth !== width || image.naturalHeight !== height) {
        throw new Error('Review a changed canonical artwork size before preparing participant branding.');
      }
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = edge;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      const scale = Math.min(edge / width, edge / height);
      const drawnWidth = width * scale, drawnHeight = height * scale;
      // Contain the complete original, centered; leave its transparency intact.
      context.drawImage(image, (edge - drawnWidth) / 2, (edge - drawnHeight) / 2, drawnWidth, drawnHeight);
      return canvas.toDataURL('image/webp', quality);
    }, {...spec, quality:targetQuality, source:'data:image/png;base64,' + original.toString('base64')});
    if (!data.startsWith('data:image/webp;base64,')) throw new Error('Chromium did not encode the requested WebP format.');
    const bytes = Buffer.from(data.slice('data:image/webp;base64,'.length), 'base64');
    if (bytes.length < 20 || bytes.length > maximum || bytes.toString('ascii', 0, 4) !== 'RIFF'
        || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Invalid or oversized participant artwork: ' + spec.destination + ' (' + bytes.length + ' bytes).');
    const destination = resolve(root, spec.destination);
    let previous;
    try { previous = await readBoundedParticipantFile(destination, maximum); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const matches = previous?.equals(bytes) || false;
    if (mode === '--check' && !matches) throw new Error('Prepared participant branding differs from its canonical artwork and recipe: ' + spec.destination);
    if (mode === '--write' && !matches) {
      await mkdir(dirname(destination), {recursive:true});
      await assertUnlinkedParents(destination);
      await writeFile(destination, bytes, {flag:previous ? 'w' : 'wx', mode:0o644});
    }
    outputs.push({source:spec.source, source_sha256:digest(original), destination:spec.destination,
      original_width:spec.width, original_height:spec.height, edge:spec.edge, format:'image/webp', quality:targetQuality,
      fit:'contain', transparent_background:true, bytes:bytes.length, sha256:digest(bytes), changed:!matches});
  }
  console.log(JSON.stringify({recipe:'Chromium canvas; high-quality smoothing; complete original contained in transparent square',
    mode, outputs}, null, 2));
} finally { await browser.close(); }

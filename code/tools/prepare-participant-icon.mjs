#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Explicit artwork preparation; routine APK builds consume the reviewed PNG.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {enterAndroidBuildLock} from './android-build-lock.mjs';

const code = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Use the managed Debian snapshot launcher.');
if (process.argv.length !== 3 || !['--write', '--check'].includes(process.argv[2])) throw new Error('Use --write to prepare, or --check to compare the reviewed launcher resource.');
enterAndroidBuildLock();
const source = resolve(code, '../web/site/branding/individual/01-sprout.png');
const destination = join(code, 'android/participant/src/main/res/drawable-nodpi/participant_logo.png');
const original = await readFile(source);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/nonverba-tools/browser-tests/browsers';
const {chromium} = await import(pathToFileURL(resolve(process.env.NONVERBA_PLAYWRIGHT_PATH ||
  '/opt/nonverba-tools/browser-tests/node_modules/playwright', 'index.mjs')).href);
const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  const result = await page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    if (image.naturalWidth !== 1254 || image.naturalHeight !== 1254) throw new Error('Review a changed canonical artwork size before preparing the icon.');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 432;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    // The inner 72dp region of a 108dp adaptive foreground preserves the full
    // original square, including its natural transparent character margins.
    context.drawImage(image, 72, 72, 288, 288);
    const preview = document.createElement('canvas'); preview.width = 432; preview.height = 216;
    const p = preview.getContext('2d');
    for (const [left, round] of [[12, true], [228, false]]) {
      p.save(); p.beginPath();
      if (round) p.arc(left + 96, 108, 96, 0, Math.PI * 2);
      else p.roundRect(left, 12, 192, 192, 44);
      p.clip(); p.fillStyle = '#F6F4E8'; p.fillRect(left, 12, 192, 192);
      p.drawImage(canvas, 72, 72, 288, 288, left, 12, 192, 192); p.restore();
    }
    return {icon:canvas.toDataURL('image/png'), preview:preview.toDataURL('image/png')};
  }, 'data:image/png;base64,' + original.toString('base64'));
  const bytes = Buffer.from(result.icon.split(',')[1], 'base64');
  if (bytes.length > 192 * 1024) throw new Error('Prepared icon exceeds its 192KiB artwork budget.');
  let previous;
  try { previous = await readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const matches = previous?.equals(bytes) || false;
  if (process.argv[2] === '--check' && !matches) throw new Error('Prepared launcher resource differs from the canonical image/recipe. Run --write and review it.');
  if (process.argv[2] === '--write' && !matches) {
    await mkdir(dirname(destination), {recursive:true}); await writeFile(destination, bytes);
  }
  const qa = join(code, 'artifacts/qa'); await mkdir(qa, {recursive:true});
  const preview = join(qa, 'participant-launcher-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png');
  await writeFile(preview, Buffer.from(result.preview.split(',')[1], 'base64'), {flag:'wx'});
  console.log(JSON.stringify({source, source_sha256:createHash('sha256').update(original).digest('hex'), destination,
    edge:432, artwork_edge:288, bytes:bytes.length, changed:!matches, preview}, null, 2));
} finally { await browser.close(); }

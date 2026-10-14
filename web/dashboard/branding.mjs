// SPDX-License-Identifier: AGPL-3.0-only
// Standard thumbnails of existing project artwork; originals remain unchanged.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const artworkDirectory = resolve(directory, '../site/branding');
const thumbnailDirectory = resolve(directory, 'branding');
const characters = Object.freeze({
  portrait: '01-sprout.png',
  identity: '02-leafy.png',
  assignments: '14-vine.png',
  priors: '09-mushroom.png',
  disputes: '15-lotus.png',
  union: '13-clover.png',
  incidents: '08-cactus.png',
  workflows: '18-bamboo.png',
  governance: '17-oak.png',
  apk: '21-seedling.png',
  services: '24-multi.png',
});

export const brandingInputs = Object.freeze([
  '../site/branding/sprout.svg',
  ...Object.values(characters).map(file => `../site/branding/individual/${file}`),
  ...Object.keys(characters).map(id => `branding/${id}.png`),
]);

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
async function thumbnail(id) {
  const bytes = await readFile(resolve(thumbnailDirectory, `${id}.png`));
  const edge = id === 'portrait' ? 256 : 144;
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature)
      || bytes.readUInt32BE(16) !== edge || bytes.readUInt32BE(20) !== edge) {
    throw new Error(`Brand thumbnail ${id} must be the prepared ${edge}px PNG.`);
  }
  return {uri: `data:image/png;base64,${bytes.toString('base64')}`, bytes: bytes.length};
}

export async function readBranding() {
  const svg = await readFile(resolve(artworkDirectory, 'sprout.svg'));
  if (svg.length > 4096 || !svg.toString('utf8').includes('<svg')
      || /<(?:script|foreignObject)\b|\b(?:href|onload)\s*=/i.test(svg.toString('utf8'))) {
    throw new Error('The sprout mark must remain a small self-contained SVG.');
  }
  const images = Object.fromEntries(await Promise.all(Object.keys(characters).map(async id => [id, await thumbnail(id)])));
  const total = svg.length + Object.values(images).reduce((sum, value) => sum + value.bytes, 0);
  if (total > 512 * 1024) throw new Error('Prepared branding exceeds its bounded standalone asset budget.');
  const portrait = images.portrait.uri;
  return {
    mark: `data:image/svg+xml;base64,${svg.toString('base64')}`,
    portrait,
    heroes: {sensors: portrait, ...Object.fromEntries(Object.keys(characters).filter(id => id !== 'portrait').map(id => [id, images[id].uri]))},
  };
}

export function brandingScript({mark, portrait, heroes}) {
  // The sensors avatar reuses the intro portrait rather than embedding it twice.
  const {sensors, ...uniqueHeroes} = heroes;
  const data = JSON.stringify({mark, portrait, heroes: uniqueHeroes}).replace(/[<>&\u2028\u2029]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `\n(() => {\nconst branding = ${data};\nbranding.heroes.sensors = branding.portrait;\nObject.freeze(branding.heroes);\nwindow.NonVerbaDashboardBranding = Object.freeze(branding);\n})();\n`;
}

async function optimizeThumbnails() {
  if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') {
    throw new Error('Prepare branding only inside the managed Debian container.');
  }
  const require = createRequire(import.meta.url);
  const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await mkdir(thumbnailDirectory, {recursive: true});
    for (const [id, file] of Object.entries(characters)) {
      const bytes = await readFile(resolve(artworkDirectory, 'individual', file));
      const edge = id === 'portrait' ? 256 : 144;
      const uri = await page.evaluate(async ({source, edge}) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = edge; canvas.height = edge;
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        const scale = Math.min(edge / image.naturalWidth, edge / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        context.drawImage(image, (edge - width) / 2, (edge - height) / 2, width, height);
        return canvas.toDataURL('image/png');
      }, {source: `data:image/png;base64,${bytes.toString('base64')}`, edge});
      const output = Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64');
      await writeFile(resolve(thumbnailDirectory, `${id}.png`), output);
      console.log(`Prepared ${id}.png: ${edge}px, ${output.length} bytes from ${file}`);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--optimize') throw new Error('Use --optimize to prepare standard branding thumbnails.');
  await optimizeThumbnails();
}

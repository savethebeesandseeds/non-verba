// SPDX-License-Identifier: AGPL-3.0-only
// Include the validated project record so file-open needs no adjacent-file access.
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {validateProject} from '../src/model.js';
import {readProject} from './project.mjs';
import {readBranding, brandingScript} from './branding.mjs';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Regenerate the dashboard inside the managed non-verba-dev container.');
const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async file => (await readFile(resolve(directory, file), 'utf8')).replace(/\r\n/g, '\n');
export async function renderStandalone(record) {
  validateProject(record.manifest, record.heroes);
  const [template, model, ui, css, branding] = await Promise.all([
    ...['src/template.html', 'src/model.js', 'src/dashboard.js', 'src/dashboard.css'].map(read),
    readBranding(),
  ]);
  const exports = [...model.matchAll(/^export\s+(?:(?:async\s+)?function|const)\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]);
  if (!exports.length || /^import\b/m.test(model)) throw new Error('The standalone model must have named exports and no imports.');
  const importPattern = /^import\s*\{([^}]+)\}\s*from\s*["']\.\/model\.js["'];?\s*/m;
  const imported = ui.match(importPattern);
  if (!imported || /\bas\b/.test(imported[1])) throw new Error('Dashboard UI needs one simple named model import.');
  const modelCode = model.replace(/^export\s+/gm, '');
  const uiCode = ui.replace(importPattern, '');
  if (/\bimport\s*(?:\(|["'{*])|import\.meta/.test(modelCode + uiCode)) throw new Error('No module imports may remain in the file-open bundle.');
  const scripts = [
    `\n(() => {\n${modelCode}\nwindow.NonVerbaDashboard = Object.freeze({${exports.join(', ')}});\n})();\n`,
    brandingScript(branding),
    `\nwindow.NonVerbaDashboardRecord = ${JSON.stringify(record).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)};\n`,
    `\n(() => {\nconst {${imported[1]}} = window.NonVerbaDashboard;\n${uiCode}\n})();\n`,
  ];
  if (scripts.some(script => /<\/script/i.test(script)) || /<\/style/i.test(css)) throw new Error('Source contains a closing HTML raw-text tag.');
  const hashes = scripts.map(script => `'sha256-${createHash('sha256').update(script).digest('base64')}'`).join(' ');
  const csp = `default-src 'none'; script-src ${hashes}; style-src 'none'; style-src-elem 'unsafe-inline'; style-src-attr 'none'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  for (const marker of ['__DASHBOARD_CSP__', '__BRAND_MARK__', '__BRAND_PORTRAIT__', '<!-- DASHBOARD_STYLE -->', '<!-- DASHBOARD_SCRIPTS -->']) {
    if (template.split(marker).length !== 2) throw new Error(`Template requires exactly one ${marker} marker.`);
  }
  return template.replace('__DASHBOARD_CSP__', csp)
    .replace('__BRAND_MARK__', branding.mark)
    .replace('__BRAND_PORTRAIT__', branding.portrait)
    .replace('<!-- DASHBOARD_STYLE -->', `<style>\n${css.trimEnd()}\n</style>`)
    .replace('<!-- DASHBOARD_SCRIPTS -->', scripts.map(script => `<script>${script}</script>`).join('\n'));
}
export async function updateStandalone(record, {check = false} = {}) {
  const html = await renderStandalone(record);
  const target = resolve(directory, 'index.html');
  if (check) {
    if (await read('index.html') !== html) throw new Error('Standalone HTML is out of date. Run web/dashboard/refresh.ps1 after JSON or interface changes.');
    console.log('Standalone HTML matches the validated Hero JSON and interface sources.');
  } else {
    await writeFile(target, html);
    console.log(`Wrote standalone HTML with ${record.heroes.length} Heroes: ${target}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await updateStandalone(await readProject(), {check: process.argv.includes('--check')});
}

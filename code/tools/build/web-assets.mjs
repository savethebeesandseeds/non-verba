// SPDX-License-Identifier: AGPL-3.0-only
// The catalog owns source membership and stable deployed URLs. No directory copy.
import {lstat, readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {PARTICIPANT_SHELL_SOURCES} from './participant-assets.mjs';

const localPath = value => value && !value.includes('\\') && !value.includes('\0')
  && !value.startsWith('/') && !/^[a-z]+:/i.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..');
const generatedReferences = new Map([
  ['./pkg/nonverba_core.js', ['browser', 'android']],
  ['./face-model/', ['browser']],
]);
export const ANDROID_WEB_DIST = 'dist-android';
export const GENERATED_CORE_ASSETS = Object.freeze([
  'pkg/nonverba_core.js', 'pkg/nonverba_core_bg.wasm',
  'pkg/nonverba_core.d.ts', 'pkg/nonverba_core_bg.wasm.d.ts',
]);
const participantOutputs = new Map(Object.entries(PARTICIPANT_SHELL_SOURCES)
  .filter(([, source]) => source.startsWith('web/'))
  .map(([output, source]) => [source.slice('web/'.length), output]));

function participantOnly(asset) {
  if (asset.consumer === undefined) return false;
  if (asset.consumer !== 'participant' || !asset.source.startsWith('shared/') || !participantOutputs.has(asset.source))
    throw new Error('Invalid participant-only web asset; source must be shared and explicitly packaged: ' + asset.source);
  return true;
}

export function assertAndroidWebAssets(actual, expected) {
  const allowed = new Set([...expected.keys(), ...GENERATED_CORE_ASSETS]);
  const unexpected = [...actual.keys()].filter(name => !allowed.has(name));
  if (unexpected.length) throw new Error('Unexpected Android web assets: ' + unexpected.join(', '));
  for (const name of ['pkg/nonverba_core.js', 'pkg/nonverba_core_bg.wasm'])
    if (!Buffer.isBuffer(actual.get(name))) throw new Error('Missing generated Android web asset: ' + name);
  for (const [name, bytes] of expected)
    if (!Buffer.isBuffer(actual.get(name)) || !actual.get(name).equals(bytes))
      throw new Error('Android web asset differs from current compiled source: ' + name);
}

export async function loadWebAssetCatalog(webRoot) {
  const catalog = JSON.parse(await readFile(path.join(webRoot, 'assets.json'), 'utf8'));
  if (catalog.version !== 1 || !Array.isArray(catalog.sourceRoots) || !catalog.sourceRoots.length
      || !Array.isArray(catalog.assets) || !catalog.assets.length)
    throw new Error('Invalid web asset catalog.');
  const sources = new Set(), outputs = new Set();
  for (const root of catalog.sourceRoots) {
    if (!localPath(root)) throw new Error('Invalid web source root: ' + root);
  }
  for (const asset of catalog.assets) {
    if (!localPath(asset.source) || !catalog.sourceRoots.some(root => asset.source.startsWith(root + '/'))
        || !/^[a-z0-9][a-z0-9.-]*\.(?:html|js|css)$/.test(asset.output)
        || !['.html', '.js', '.css'].includes(path.posix.extname(asset.source))
        || path.posix.extname(asset.source) !== path.posix.extname(asset.output)
        || sources.has(asset.source.toLowerCase()) || outputs.has(asset.output.toLowerCase()))
      throw new Error('Invalid or duplicate web asset: ' + JSON.stringify(asset));
    participantOnly(asset);
    sources.add(asset.source.toLowerCase()); outputs.add(asset.output.toLowerCase());
  }
  for (const target of ['browser', 'android']) {
    const entries = catalog.entries?.[target];
    if (!Array.isArray(entries) || !entries.length || new Set(entries).size !== entries.length
        || entries.some(entry => !entry.endsWith('.html') || !outputs.has(entry)))
      throw new Error('Invalid web entry points for ' + target + '.');
  }
  return catalog;
}

async function sourceFiles(webRoot, sourceRoots) {
  const files = new Set();
  async function visit(relative) {
    const info = await lstat(path.join(webRoot, relative));
    if (info.isSymbolicLink()) throw new Error('Linked web source: ' + relative);
    if (info.isDirectory()) {
      for (const name of (await readdir(path.join(webRoot, relative))).sort())
        await visit(relative + '/' + name);
    } else if (info.isFile()) {
      // Architecture notes may live with a capability; executable/resource files
      // always need a catalog entry, including files in newly added folders.
      if (!relative.endsWith('.md')) files.add(relative);
    }
    else throw new Error('Expected regular web source: ' + relative);
  }
  for (const root of sourceRoots) {
    // Check each ancestor, including the root itself, before following it.
    let parent = '';
    for (const component of root.split('/')) {
      parent = parent ? parent + '/' + component : component;
      const info = await lstat(path.join(webRoot, parent));
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Linked or invalid web source root: ' + parent);
    }
    await visit(root);
  }
  return files;
}

function htmlTags(text) {
  const tags = [];
  const pattern = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  for (const match of text.matchAll(pattern)) {
    if (!match[1]) continue;
    const attributes = [];
    const bodyStart = match[0].indexOf(match[1]) + match[1].length;
    const body = match[0].slice(bodyStart, -1);
    const attribute = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for (const item of body.matchAll(attribute)) {
      const value = item[2] ?? item[3] ?? item[4];
      const offset = value === undefined ? 0 : item[0].indexOf('=') + 1;
      const tail = item[0].slice(offset), valueStart = offset + tail.search(/[^\s]/) + (item[2] !== undefined || item[3] !== undefined ? 1 : 0);
      attributes.push({name:item[1].toLowerCase(), value,
        start:match.index + bodyStart + item.index + valueStart,
        end:match.index + bodyStart + item.index + valueStart + (value?.length ?? 0)});
    }
    tags.push({name:match[1].toLowerCase(), closing:match[0][1] === '/',
      selfClosing:/\/\s*>$/.test(match[0]) || /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(match[1]),
      attributes, start:match.index, end:match.index + match[0].length});
  }
  return tags;
}

function removeInspectionElements(text) {
  const tags = htmlTags(text), removals = [];
  for (let index = 0; index < tags.length; index++) {
    const tag = tags[index];
    if (tag.closing || !tag.attributes.some(attribute => attribute.name === 'data-browser-inspection')) continue;
    let end = tag.end;
    if (!tag.selfClosing) {
      let depth = 1, next = index + 1;
      for (; next < tags.length; next++) {
        if (tags[next].name !== tag.name) continue;
        depth += tags[next].closing ? -1 : tags[next].selfClosing ? 0 : 1;
        if (depth === 0) { end = tags[next].end; break; }
      }
      if (depth) throw new Error('Unclosed browser inspection element.');
      index = next;
    }
    removals.push({start:tag.start, end, value:''});
  }
  return replaceRanges(text, removals);
}

// A small lexer limits rewrites to actual module declarations and new URL calls.
// Comments, ordinary strings, template text and regex literals are opaque.
function javascriptTokens(text) {
  const tokens = [];
  let index = 0;
  function scanCode(interpolation = false) {
    let canEndExpression = false, braces = 0;
    while (index < text.length) {
      const character = text[index], start = index;
      if (interpolation && character === '}' && braces === 0) { index++; return; }
      if (/\s/.test(character)) { index++; continue; }
      if (text.startsWith('//', index)) { index = text.indexOf('\n', index + 2); if (index < 0) break; continue; }
      if (text.startsWith('/*', index)) {
        const end = text.indexOf('*/', index + 2);
        if (end < 0) throw new Error('Unclosed JavaScript comment.');
        index = end + 2; continue;
      }
      if (character === '`') {
        tokens.push({value:'template', type:'opaque', start, end:start + 1});
        index++; let closed = false;
        while (index < text.length) {
          if (text[index] === '\\') { index += 2; continue; }
          if (text[index] === '`') { index++; closed = true; break; }
          if (text.startsWith('${', index)) {
            index += 2;
            tokens.push({value:'interpolation', type:'opaque', start:index - 2, end:index});
            scanCode(true);
            tokens.push({value:'template', type:'opaque', start:index - 1, end:index});
          } else index++;
        }
        if (!closed) throw new Error('Unclosed JavaScript template literal.');
        tokens.push({value:'template', type:'opaque', start:index - 1, end:index});
        canEndExpression = true; continue;
      }
      if (character === '"' || character === "'") {
        index++;
        while (index < text.length && text[index] !== character) index += text[index] === '\\' ? 2 : 1;
        if (index >= text.length) throw new Error('Unclosed JavaScript literal.');
        index++;
        tokens.push({value:text.slice(start + 1, index - 1), type:'string', start:start + 1, end:index - 1});
        canEndExpression = true; continue;
      }
      if (character === '/' && !canEndExpression) {
        index++; let inClass = false;
        while (index < text.length) {
          if (text[index] === '\\') { index += 2; continue; }
          if (text[index] === '[') inClass = true;
          else if (text[index] === ']') inClass = false;
          else if (text[index] === '/' && !inClass) { index++; break; }
          index++;
        }
        while (/[a-z]/i.test(text[index] ?? '') && index < text.length) index++;
        tokens.push({value:'regex', type:'opaque', start, end:index}); canEndExpression = true; continue;
      }
      const word = /^[a-z_$][\w$]*/i.exec(text.slice(index));
      if (word) {
        index += word[0].length;
        tokens.push({value:word[0], type:'word', start, end:index});
        canEndExpression = !/^(?:return|throw|case|delete|void|typeof|instanceof|in|of|yield|await|new)$/.test(word[0]);
      } else {
        if (character === '{') braces++;
        else if (character === '}') braces--;
        index++; tokens.push({value:character, type:'punctuation', start, end:index});
        canEndExpression = /[\w\])}]/.test(character);
      }
    }
    if (interpolation) throw new Error('Unclosed JavaScript template interpolation.');
  }
  scanCode();
  return tokens;
}

function javascriptReferences(text) {
  const tokens = javascriptTokens(text), references = [];
  const add = token => { if (token?.type === 'string') references.push(token); };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index], next = tokens[index + 1];
    if (token.type !== 'word') continue;
    if (token.value === 'import' && next?.value === '(') add(tokens[index + 2]);
    else if (token.value === 'import' && next?.type === 'string') add(next);
    else if ((token.value === 'import' || token.value === 'export' && ['{', '*'].includes(next?.value)) && !['.', '('].includes(next?.value)) {
      for (let cursor = index + 1; cursor < tokens.length; cursor++) {
        const item = tokens[cursor];
        if (item.value === ';' || item.type === 'word' && ['import', 'export', 'const', 'let', 'function', 'class'].includes(item.value)) break;
        if (item.value === 'from' && item.type === 'word' && tokens[cursor + 1]?.type === 'string') { add(tokens[cursor + 1]); break; }
      }
    }
    if (token.value === 'new' && next?.value === 'URL' && tokens[index + 2]?.value === '(') {
      const suffix = tokens.slice(index + 4, index + 11).map(item => item.value).join(' ');
      if (suffix === ', import . meta . url )') add(tokens[index + 3]);
    }
  }
  return [...new Map(references.map(reference => [reference.start, reference])).values()];
}

function references(text, extension) {
  if (extension === '.js') return javascriptReferences(text);
  if (extension === '.html') return htmlTags(text).flatMap(tag => tag.closing ? []
    : tag.attributes.filter(attribute => ['src', 'href'].includes(attribute.name) && attribute.value !== undefined));
  // CSS sources currently have no local resources; support explicit url() and @import.
  const result = [];
  const pattern = /\/\*[\s\S]*?\*\/|\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi;
  for (const match of text.matchAll(pattern)) {
    if (match[0].startsWith('/*')) continue;
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    if (value === undefined) continue;
    const start = match.index + match[0].indexOf(value);
    result.push({value, start, end:start + value.length});
  }
  return result;
}

function replaceRanges(text, ranges) {
  for (const range of [...ranges].sort((left, right) => right.start - left.start))
    text = text.slice(0, range.start) + range.value + text.slice(range.end);
  return text;
}

export async function collectWebAssets(webRoot, {target = 'browser', catalog} = {}) {
  if (!['browser', 'android'].includes(target)) throw new Error('Unknown web build target: ' + target);
  catalog ??= await loadWebAssetCatalog(webRoot);
  const inventory = await sourceFiles(webRoot, catalog.sourceRoots);
  const bySource = new Map(catalog.assets.map(asset => [asset.source, asset]));
  const byOutput = new Map(catalog.assets.map(asset => [asset.output, asset]));
  const unknown = [...inventory].filter(source => !bySource.has(source));
  if (unknown.length) throw new Error('Unregistered web source files: ' + unknown.join(', '));
  const missing = [...bySource.keys()].filter(source => !inventory.has(source));
  if (missing.length) throw new Error('Missing cataloged web source files: ' + missing.join(', '));
  const compiled = new Map(), edges = new Map();
  for (const asset of catalog.assets) {
    const participant = participantOnly(asset);
    let text = await readFile(path.join(webRoot, asset.source), 'utf8');
    if (target === 'android' && asset.output.endsWith('.html')) text = removeInspectionElements(text);
    const dependencies = new Set(), replacements = [];
    for (const reference of references(text, path.posix.extname(asset.source))) {
      const value = reference.value;
      if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) continue;
      if (value.includes('\\') || /[\0\r\n]/.test(value) || value.startsWith('/'))
        throw new Error('Unsupported local asset URL in ' + asset.source + ': ' + value);
      if (generatedReferences.has(value)) {
        if (participant) throw new Error('Participant-only asset depends on a generated developer resource: ' + asset.source + ' -> ' + value);
        // Generated resources intentionally resolve relative to deployed flat URLs.
        dependencies.add(value); continue;
      }
      const [, pathname, suffix] = /^([^?#]*)(.*)$/s.exec(value);
      const source = path.posix.normalize(path.posix.join(path.posix.dirname(asset.source), pathname));
      const dependency = bySource.get(source);
      if (!dependency) throw new Error('Unregistered asset dependency in ' + asset.source + ': ' + value);
      if (!participant && participantOnly(dependency))
        throw new Error('Developer or inspection asset depends on a participant-only asset: ' + asset.source + ' -> ' + dependency.source);
      if (participant) {
        if (!participantOutputs.has(dependency.source))
          throw new Error('Participant-only dependency is not packaged: ' + asset.source + ' -> ' + dependency.source);
        const deployed = path.posix.normalize(path.posix.join(path.posix.dirname(participantOutputs.get(asset.source)), pathname));
        if (deployed !== participantOutputs.get(dependency.source))
          throw new Error('Participant-only dependency does not resolve in its package: ' + asset.source + ' -> ' + value);
      }
      if (asset.source.startsWith('shared/') && !dependency.source.startsWith('shared/'))
        throw new Error('Shared web module depends on an application or inspection: ' + asset.source + ' -> ' + dependency.source);
      if (asset.source.startsWith('apps/non-verba-dev/') && asset.output.endsWith('.js') && dependency.source.startsWith('inspections/'))
        throw new Error('Developer runtime depends on a browser inspection: ' + asset.source + ' -> ' + dependency.source);
      dependencies.add(dependency.output);
      replacements.push({...reference, value:'./' + dependency.output + suffix});
    }
    compiled.set(asset.output, Buffer.from(replaceRanges(text, replacements)));
    edges.set(asset.output, dependencies);
  }
  const selected = new Set();
  function include(output) {
    if (selected.has(output)) return;
    if (generatedReferences.has(output)) {
      if (!generatedReferences.get(output).includes(target)) throw new Error('Browser resource reached Android build: ' + output);
      return;
    }
    if (!byOutput.has(output)) throw new Error('Unknown web entry: ' + output);
    if (participantOnly(byOutput.get(output))) throw new Error('Participant-only asset reached developer build: ' + output);
    if (target === 'android' && (byOutput.get(output).source.startsWith('inspections/')
        || output.endsWith('.html') && !catalog.entries.android.includes(output)))
      throw new Error('Browser inspection or undeclared document reached Android build: ' + output);
    selected.add(output);
    for (const dependency of edges.get(output)) include(dependency);
  }
  for (const entry of catalog.entries[target]) include(entry);
  if (target === 'browser') {
    const unreachable = [...byOutput.keys()].filter(output => !participantOnly(byOutput.get(output)) && !selected.has(output));
    if (unreachable.length) throw new Error('Unreachable cataloged web assets: ' + unreachable.join(', '));
  }
  return new Map([...selected].sort().map(output => [output, compiled.get(output)]));
}

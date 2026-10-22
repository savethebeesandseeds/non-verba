// SPDX-License-Identifier: AGPL-3.0-only
// Browser checks use the managed Linux Playwright installation and Chromium.
// Individual fixtures still own their servers, media arguments and lifecycle.
import {createRequire} from 'node:module';

if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') {
  throw new Error('Run browser checks inside the managed non-verba-dev container.');
}
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/nonverba-tools/browser-tests/browsers';
const require = createRequire(import.meta.url);

export function browserTestUrl() {
  return process.env.NONVERBA_TEST_URL || 'http://127.0.0.1:4173';
}

export function browserDescription() {
  return process.env.NONVERBA_BROWSER_EXECUTABLE ? 'configured executable' : 'playwright chromium';
}

export async function launchBrowser(options = {}) {
  const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH ||
    '/opt/nonverba-tools/browser-tests/node_modules/playwright');
  return chromium.launch({
    headless: true,
    ...options,
    ...(process.env.NONVERBA_BROWSER_EXECUTABLE ? {executablePath: process.env.NONVERBA_BROWSER_EXECUTABLE} : {}),
  });
}

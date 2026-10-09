// SPDX-License-Identifier: AGPL-3.0-only
import {readdir, readFile} from 'node:fs/promises';
import {resolve, relative, dirname, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TEST_SUITES = Object.freeze({
  unit: [
    'authentication-workflow-tests.mjs', 'work-privacy-controller-tests.mjs',
    'registration-workflow-tests.mjs',
    'face-workflow-tests.mjs',
    'android-package-verifier-tests.mjs', 'audio-adapter-tests.mjs', 'audio-demo-export-tests.mjs',
    'audio-worklet-tests.mjs', 'browser-package-source-tests.mjs', 'browser-package-tests.mjs',
    'camera-adapter-tests.mjs', 'camera-app-handoff-tests.mjs', 'camera-offer-stage-tests.mjs',
    'camera-peer-tests.mjs', 'camera-quality-adapter-tests.mjs', 'camera-session-capture-tests.mjs',
    'camera-session-preflight-tests.mjs', 'camera-session-ui-tests.mjs', 'core-client-tests.mjs',
    'device-preflight-tests.mjs', 'fetch-attestation-trust-tests.mjs', 'gps-attempt-adapter-tests.mjs',
    'gps-warmup-ui-tests.mjs', 'key-enrollment-adapter-tests.mjs', 'location-adapter-tests.mjs',
    'location-profile-readiness-tests.mjs', 'location-report-presentation-adapter-tests.mjs',
    'location-verification-input-tests.mjs', 'native-audio-adapter-tests.mjs', 'pairing-import-tests.mjs',
    'release-notices-tests.mjs', 'retained-evidence-ui-tests.mjs', 'screen-awake-tests.mjs', 'test-suites-tests.mjs',
  ],
  evidence: [
    'agent-evidence-guard-tests.mjs', 'audio-controller-tests.mjs', 'audio-pairing-ui-tests.mjs',
    'camera-composed-session-tests.mjs', 'camera-session-tests.mjs', 'image-requester-session-tests.mjs',
    'live-location-session-tests.mjs', 'request-presets-tests.mjs', 'retained-evidence-storage-tests.mjs',
    'sensor-acceptance-lifecycle-tests.mjs',
  ],
  cooperation: ['cooperation.test.mjs', 'wasm.test.mjs', 'simulator-config.test.mjs', 'simulator-model.test.mjs'],
  transport: ['usb-audio-export-guards.mjs'],
  face_model: ['face-model-preparation-tests.mjs'],
});
export const TEST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../test');
// This existing assertion script predates node:test. It still runs in the unit
// group, and must exist as a script rather than silently becoming a stale entry.
const ASSERTION_SCRIPTS = new Set(['audio-worklet-tests.mjs']);

// A new Node test must declare its prerequisites in a group before any group runs.
// Standalone browser/JNI fixture scripts retain their documented, separate setup.
export async function assertRegisteredTests({root = TEST_ROOT, suites = TEST_SUITES} = {}) {
  const declared = Object.values(suites).flat(), seen = new Set();
  for (const name of declared) {
    if (seen.has(name)) throw new Error(`Test registered more than once: ${name}`);
    if (isAbsolute(name) || name.includes('\\') || name.split('/').some(part => ['', '.', '..'].includes(part))) {
      throw new Error(`Invalid test path: ${name}`);
    }
    seen.add(name);
  }
  const discovered = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) {
        const name = relative(root, path).replaceAll('\\', '/');
        const source = await readFile(path, 'utf8');
        if (ASSERTION_SCRIPTS.has(name) || /\bfrom\s*['"]node:test['"]|\bimport\s*['"]node:test['"]|\b(?:import|require)\s*\(\s*['"]node:test['"]\s*\)/.test(source)) {
          discovered.push(name);
        }
      }
    }
  }
  await visit(root);
  const found = new Set(discovered);
  const missing = discovered.filter(name => !seen.has(name)).sort();
  const stale = declared.filter(name => !found.has(name)).sort();
  if (missing.length || stale.length) throw new Error(`Node test catalog mismatch. Unregistered: ${missing.join(', ') || 'none'}. Missing/non-test entries: ${stale.join(', ') || 'none'}.`);
  return discovered.sort();
}

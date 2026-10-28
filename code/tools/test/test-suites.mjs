// SPDX-License-Identifier: AGPL-3.0-only
import {readdir, readFile} from 'node:fs/promises';
import {resolve, relative, dirname, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TEST_SUITES = Object.freeze({
  unit: [
    'unit/web-assets-tests.mjs', 'unit/local-storage-tests.mjs',
    'unit/map-component-tests.mjs',
    'unit/authentication-workflow-tests.mjs', 'unit/work-privacy-controller-tests.mjs',
    'unit/registration-workflow-tests.mjs', 'unit/synthetic-enrollment-workflow-tests.mjs',
    'unit/enrollment-camera-tests.mjs', 'unit/identity-capture-tests.mjs', 'unit/identity-camera-tool-tests.mjs', 'unit/identity-intake-notice-tests.mjs', 'unit/device-attestation-tests.mjs', 'unit/device-attestation-ui-tests.mjs', 'unit/device-attestation-check-tests.mjs',
    'unit/face-workflow-tests.mjs', 'unit/identity-state-tests.mjs', 'unit/identity-review-client-tests.mjs', 'unit/password-manager-sign-in-tests.mjs',
    'unit/android-package-verifier-tests.mjs', 'unit/participant-package-tests.mjs', 'unit/participant-workspace-tests.mjs', 'unit/onboarding-account-tests.mjs', 'unit/participant-account-relay-tests.mjs', 'unit/audio-adapter-tests.mjs', 'unit/audio-demo-export-tests.mjs',
    'unit/audio-worklet-tests.mjs', 'unit/browser-package-source-tests.mjs', 'unit/browser-package-tests.mjs',
    'unit/camera-adapter-tests.mjs', 'unit/camera-set-adapter-tests.mjs', 'unit/camera-app-handoff-tests.mjs', 'unit/camera-offer-stage-tests.mjs',
    'unit/camera-peer-tests.mjs', 'unit/camera-quality-adapter-tests.mjs', 'unit/camera-session-capture-tests.mjs',
    'unit/camera-session-preflight-tests.mjs', 'unit/camera-session-ui-tests.mjs', 'unit/core-client-tests.mjs',
    'unit/device-preflight-tests.mjs', 'unit/fetch-attestation-trust-tests.mjs', 'unit/gps-attempt-adapter-tests.mjs',
    'unit/gps-warmup-ui-tests.mjs', 'unit/key-enrollment-adapter-tests.mjs', 'unit/location-adapter-tests.mjs',
    'unit/location-profile-readiness-tests.mjs', 'unit/location-report-presentation-adapter-tests.mjs',
    'unit/location-verification-input-tests.mjs', 'unit/native-audio-adapter-tests.mjs', 'unit/pairing-import-tests.mjs',
    'unit/release-notices-tests.mjs', 'unit/retained-evidence-ui-tests.mjs', 'unit/screen-awake-tests.mjs', 'unit/test-suites-tests.mjs',
  ],
  evidence: [
    'evidence/agent-evidence-guard-tests.mjs', 'evidence/audio-controller-tests.mjs', 'evidence/audio-pairing-ui-tests.mjs',
    'evidence/camera-composed-session-tests.mjs', 'evidence/camera-session-tests.mjs', 'evidence/image-requester-session-tests.mjs',
    'evidence/live-location-session-tests.mjs', 'evidence/request-presets-tests.mjs', 'evidence/retained-evidence-storage-tests.mjs',
    'evidence/sensor-acceptance-lifecycle-tests.mjs',
  ],
  cooperation: ['cooperation/cooperation.test.mjs', 'cooperation/wasm.test.mjs', 'cooperation/simulator-config.test.mjs', 'cooperation/simulator-model.test.mjs'],
  transport: ['transport/usb-audio-export-guards.mjs', 'transport/usb-app-target-tests.mjs'],
  build_process: ['build/android-build-process-tests.mjs', 'build/android-build-measurement-tests.mjs'],
  face_model: ['models/face-model-preparation-tests.mjs'],
});
export const TEST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../test');
// This existing assertion script predates node:test. It still runs in the unit
// group, and must exist as a script rather than silently becoming a stale entry.
const ASSERTION_SCRIPTS = new Set(['unit/audio-worklet-tests.mjs']);

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

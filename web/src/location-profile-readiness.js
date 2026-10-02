// SPDX-License-Identifier: AGPL-3.0-only
import {locationPlatform} from './location-platform.js';

const profiles = new Set(['browser-or-native', 'native-required', 'native-gnss', 'raw-gnss']);

// Operator preflight only. Reading capabilities neither starts collection nor
// grants permission. API availability does not establish receiver quality,
// measurement availability, a native GNSS fix, or physical location truth.
export function requireLocationProfileReadiness(profile, platform = locationPlatform()) {
  if (!profiles.has(profile)) throw new Error('Select a supported location collection profile.');
  if (!platform || typeof platform.native !== 'boolean') throw new Error('Location collection capabilities are unavailable.');
  if (profile !== 'browser-or-native' && platform.native !== true) {
    throw new Error('This task requires the Android native location collector. Browser location cannot satisfy it.');
  }
  if (profile === 'raw-gnss' && platform.capabilities?.raw_gnss_api_available !== true) {
    throw new Error('This task requires raw satellite measurements on a compatible Android 10+ device. Raw GNSS API availability was not confirmed.');
  }
  return platform;
}

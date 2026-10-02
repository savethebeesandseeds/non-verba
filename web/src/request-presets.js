// SPDX-License-Identifier: AGPL-3.0-only
// New requester UI selections only. Explicit selections remain unchanged;
// imported requests, protocol validation and demos do not use these defaults.
const presets = Object.freeze({
  camera: Object.freeze({mode: 'raw', duration_ms: 2000}),
  'live-camera': Object.freeze({assurance: 'native-correlated', location_profile: 'raw-gnss',
    duration_ms: 2000, hardware_attestation_required: false, independent_position_required: false}),
  location: Object.freeze({profile: 'raw-gnss', duration_ms: 2000, hardware_attestation_required: false, independent_position_required: false}),
  audio: Object.freeze({assurance: 'android-monitored', duration_secs: 10})
});

export function newRequestPreset(kind, selections = {}) {
  const defaults = Object.hasOwn(presets, kind) ? presets[kind] : null;
  if (!defaults || !selections || typeof selections !== 'object' || Array.isArray(selections)
      || Object.keys(selections).some(key => !Object.hasOwn(defaults, key))) throw new Error('Unknown new-request preset selection.');
  const selected = Object.fromEntries(Object.entries(defaults).map(([key, value]) =>
    [key, selections[key] === undefined ? value : selections[key]]));
  if (kind !== 'audio' && selections.duration_ms === undefined) {
    const raw = kind === 'camera' ? selected.mode === 'raw' : (selected.profile ?? selected.location_profile) === 'raw-gnss';
    selected.duration_ms = raw ? 2000 : 10000;
  }
  return Object.freeze(selected);
}

const locationDescriptions = {
  'browser-or-native': 'location proof; browser or Android allowed',
  'native-required': 'native Android location proof required',
  'native-gnss': 'native Android GNSS proof required',
  'raw-gnss': 'native Android GNSS proof with raw satellite observations required'
};
const trustSelection = value => ` Hardware attestation ${value.hardware_attestation_required ? 'required' : 'not required'}; independent position recomputation ${value.independent_position_required ? 'required' : 'not required'}.`;
export function requestPresetSummary(kind, selections = {}) {
  const value = newRequestPreset(kind, selections);
  const seconds = value.duration_ms / 1000;
  const locationDescription = profile => locationDescriptions[profile] ? `${seconds}-second minimum ${locationDescriptions[profile]}` : 'unsupported location profile';
  if (kind === 'camera') return ({
    raw: `Selected: photo plus a separate raw GNSS proof with a ${seconds}-second minimum observation span. Native Android location required; Android uses its native camera. At least three fixes and three raw epochs are required. This is not a completion deadline; startup and usable observations can take longer. Unsupported collection stops.`,
    native: `Selected reduced profile: photo plus a separate ${seconds}-second Android GNSS proof; raw satellite observations are not required.`,
    trace: `Selected reduced profile: photo plus a separate ${seconds}-second location proof; browser or Android observations allowed.`,
    metadata: 'Selected reduced profile: photo with GPS metadata only; no separate location proof.'
  })[value.mode] || 'Select a supported camera request profile.';
  if (kind === 'audio') return `Selected: ${value.duration_secs} seconds; ${value.assurance === 'android-monitored' ? 'native Android monitored microphone recording required' : value.assurance === 'browser-or-android' ? 'reduced recording profile allowing browser or Android' : 'unsupported microphone assurance'}. No recording or speaker test starts until the operator explicitly enables it.`;
  if (kind === 'location') return `Selected: ${locationDescription(value.profile)}.${value.profile === 'raw-gnss' ? ' At least three fixes and three raw epochs. The observation minimum is not a completion deadline; startup and usable observations can take longer.' : ''}${trustSelection(value)}`;
  const camera = value.assurance === 'native-correlated' ? 'native Android camera with correlated capture clock required'
    : value.assurance === 'browser-or-android' ? 'browser or Android camera allowed' : 'unsupported camera assurance';
  const location = value.location_profile === 'metadata' ? 'GPS metadata only; no separate location proof'
    : locationDescription(value.location_profile);
  return `Selected: ${camera}; ${location}.${value.location_profile === 'metadata' ? ' Hardware attestation and independent position recomputation are not required by this image-only profile.' : trustSelection(value)}`;
}

export function installRequestPresetSummary(root, kind, summaryId, fields, readSelections) {
  const update = () => { root.getElementById(summaryId).textContent = requestPresetSummary(kind, readSelections()); };
  for (const id of fields) for (const event of ['input', 'change']) root.getElementById(id).addEventListener(event, update);
  update();
}

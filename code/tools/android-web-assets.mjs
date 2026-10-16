// SPDX-License-Identifier: AGPL-3.0-only
// Shared by developer staging and independent package inspection.
const browserOnly = new Set(['review.html', 'map.html', 'face-model']);
export const isAndroidBrowserOnly = relative =>
  relative.split('/').some(component => browserOnly.has(component.toLowerCase()));

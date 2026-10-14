// SPDX-License-Identifier: AGPL-3.0-only
import {NORWAY_GEOMETRY} from './map-country-data.js';
import {validateGeometry} from './map-geometry.js';

// Initial component configuration, supplied by a deployment authority in the app.
// A provider's list of countries and self-reported registration country are irrelevant.
export const INITIAL_MAP_CATALOG = [{code: 'NO', name: 'Norway', active: true,
  scope: 'Mainland and coastal islands; excludes Svalbard and Jan Mayen',
  draw_boundary: false, geometry: NORWAY_GEOMETRY}];
export function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length > 250) throw new Error('Invalid deployment map catalog.');
  const codes = new Set();
  for (const country of catalog) {
    if (typeof country?.code !== 'string' || !/^[A-Z]{2}$/.test(country.code) || codes.has(country.code)
      || typeof country.name !== 'string' || !country.name.trim() || country.name.length > 120
      || typeof country.active !== 'boolean'
      || (country.draw_boundary !== undefined && typeof country.draw_boundary !== 'boolean'))
      throw new Error('Invalid or duplicated deployment country.');
    validateGeometry(country.geometry); codes.add(country.code);
  }
  return catalog;
}
export function visibleCountries(catalog, {role, enabledCountries = []}) {
  validateCatalog(catalog);
  if (!['requester', 'operator'].includes(role)) throw new Error('Unknown map role.');
  if (!Array.isArray(enabledCountries) || enabledCountries.length > 250
    || enabledCountries.some(code => typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)))
    throw new Error('Enabled map countries require explicit ISO country codes.');
  const enabled = new Set(enabledCountries);
  return catalog.filter(country => country.active && (role === 'requester' || enabled.has(country.code)));
}

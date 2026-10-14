// SPDX-License-Identifier: AGPL-3.0-only
import {INITIAL_MAP_CATALOG, validateCatalog, visibleCountries} from './map-policy.js';
import {containsPosition, validatePosition} from './map-geometry.js';

const textField = (value, name, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid map ${name}.`);
  return value;
};
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
export class MapController {
  #catalog; #access; #visible; #positions = []; #routes = []; #listeners = new Set(); #source = null;
  constructor({catalog = INITIAL_MAP_CATALOG, role = 'operator', enabledCountries = [],
    now = () => Date.now(), maxPositionAgeMs = 60000} = {}) {
    if (typeof now !== 'function' || !Number.isFinite(maxPositionAgeMs) || maxPositionAgeMs < 0)
      throw new Error('Invalid map freshness policy.');
    this.now = now; this.maxPositionAgeMs = maxPositionAgeMs;
    this.#catalog = deepFreeze(structuredClone(validateCatalog(catalog)));
    this.#access = {role, enabledCountries: [...enabledCountries]};
    this.#visible = deepFreeze(visibleCountries(this.#catalog, this.#access));
  }
  #countries() { return this.#visible; }
  #allowed(countryCode, position) {
    const country = this.#countries().find(country => country.code === countryCode);
    return country && containsPosition(country.geometry, position);
  }
  #current(position) {
    const now = this.now();
    return Number.isFinite(now) && position.observed_at_ms >= now - this.maxPositionAgeMs
      && position.observed_at_ms <= now + 5000;
  }
  snapshot() {
    // Once an observation expires, a wall-clock correction must not revive it.
    this.#positions = this.#positions.filter(position => this.#current(position));
    return {countries: this.#countries(),
      positions: [...this.#positions], routes: [...this.#routes]};
  }
  subscribe(callback) {
    if (typeof callback !== 'function') throw new Error('Map subscriber must be a function.');
    this.#listeners.add(callback); return () => this.#listeners.delete(callback);
  }
  #notify() { for (const callback of this.#listeners) callback(this.snapshot()); }
  refresh() { this.#notify(); }
  setAccess({role, enabledCountries = []}) {
    const visible = visibleCountries(this.#catalog, {role, enabledCountries});
    this.#access = {role, enabledCountries: [...enabledCountries]};
    this.#visible = deepFreeze(visible);
    this.#positions = []; this.#routes = []; this.#notify();
  }
  replaceCatalog(catalog) {
    this.#catalog = deepFreeze(structuredClone(validateCatalog(catalog)));
    this.#visible = deepFreeze(visibleCountries(this.#catalog, this.#access));
    this.#positions = []; this.#routes = []; this.#notify();
  }
  setPositions(positions) {
    if (!Array.isArray(positions) || positions.length > 500) throw new Error('Map positions exceed the display limit.');
    const ids = new Set();
    const validated = positions.map(position => {
      validatePosition(position); textField(position.id, 'position ID'); textField(position.label, 'position label');
      textField(position.source, 'position source');
      if (typeof position.country_code !== 'string' || !/^[A-Z]{2}$/.test(position.country_code) || ids.has(position.id)
        || !Number.isFinite(position.accuracy_m) || position.accuracy_m < 0 || position.accuracy_m > 100000
        || !Number.isSafeInteger(position.observed_at_ms) || position.observed_at_ms < 0)
        throw new Error('Invalid or duplicated map position.');
      ids.add(position.id);
      // Copy only display fields: evidence and account records do not enter the renderer.
      return deepFreeze({id: position.id, label: position.label, country_code: position.country_code,
        latitude: position.latitude, longitude: position.longitude, accuracy_m: position.accuracy_m,
        observed_at_ms: position.observed_at_ms, source: position.source});
    });
    this.#positions = deepFreeze(validated.filter(position => this.#allowed(position.country_code, position) && this.#current(position)));
    this.#notify();
  }
  setRoutes(routes) {
    if (!Array.isArray(routes) || routes.length > 100) throw new Error('Map routes exceed the display limit.');
    let total = 0; const ids = new Set();
    const validated = routes.map(route => {
      textField(route.id, 'route ID'); textField(route.label, 'route label');
      if (ids.has(route.id) || typeof route.country_code !== 'string' || !/^[A-Z]{2}$/.test(route.country_code)
        || !Array.isArray(route.points) || route.points.length < 2 || (total += route.points.length) > 10000)
        throw new Error('Invalid or duplicated supplied map route.');
      ids.add(route.id);
      const points = route.points.map(point => {
        validatePosition(point); return {latitude: point.latitude, longitude: point.longitude};
      });
      return {id: route.id, label: route.label, country_code: route.country_code, points};
    });
    this.#routes = deepFreeze(validated.filter(route => route.points.every(point => this.#allowed(route.country_code, point))));
    this.#notify();
  }
  setTileSource(source) {
    if (source !== null && (typeof source?.url !== 'function' || typeof source.attribution !== 'string'
      || !source.attribution.trim() || !Number.isInteger(source.minZoom) || !Number.isInteger(source.maxZoom)
      || source.minZoom < 0 || source.maxZoom > 18 || source.minZoom > source.maxZoom))
      throw new Error('Invalid map tile source.');
    this.#source = source; this.#notify();
  }
  tileSource() { return this.#source; }
  clear() { this.#positions = []; this.#routes = []; this.#notify(); }
}

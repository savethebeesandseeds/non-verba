// SPDX-License-Identifier: AGPL-3.0-only
import {MapController} from '../../shared/map/map-controller.js';
import {createMapView} from '../../shared/map/map-view.js';
import {createOsmPreviewTileSource} from '../../shared/map/map-tiles.js';

const element = id => document.getElementById(id);
const controller = new MapController({role: 'requester', enabledCountries: ['NO']});
let expiryTimer = null, destroyed = false;
const status = element('map-status');
const view = createMapView({canvas: element('map-canvas'), controller, onStatus(result) {
  if (!controller.snapshot().countries.length) status.textContent = 'No supported countries enabled for this user.';
  else if (result.state === 'loading') status.textContent = 'Loading visible street tiles…';
  else if (result.state === 'partial') status.textContent = 'Some street tiles are unavailable. Country outline and overlays remain usable.';
  else status.textContent = result.state === 'ready' ? 'Norway · streets and shared overlays' : 'Norway · country outline';
}});
const cities = {oslo: {latitude: 59.95, longitude: 10.75},
  bergen: {latitude: 60.4, longitude: 5.35}, tromso: {latitude: 69.68, longitude: 18.93}};
function update() {
  if (destroyed) return;
  clearTimeout(expiryTimer); expiryTimer = null;
  const snapshot = controller.snapshot(), hasCoverage = snapshot.countries.length > 0;
  for (const id of ['map-fit', 'map-oslo', 'map-bergen', 'map-tromso', 'map-zoom-in', 'map-zoom-out', 'map-demo'])
    element(id).disabled = !hasCoverage;
  const list = element('map-positions'); list.replaceChildren();
  if (!snapshot.positions.length) {
    const item = document.createElement('li'); item.textContent = 'No positions supplied.'; list.append(item);
  }
  for (const position of snapshot.positions) {
    const item = document.createElement('li'), label = document.createElement('strong'), details = document.createElement('span');
    label.textContent = position.label;
    details.textContent = `${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)} · ±${position.accuracy_m} m · ${position.source} · observed ${new Date(position.observed_at_ms).toLocaleTimeString()}`;
    item.append(label, details); list.append(item);
  }
  element('map-route-note').hidden = snapshot.routes.length === 0;
  if (snapshot.positions.length) {
    const nextExpiry = Math.min(...snapshot.positions.map(position => position.observed_at_ms + controller.maxPositionAgeMs + 1));
    expiryTimer = setTimeout(() => controller.refresh(), Math.max(1, nextExpiry - Date.now()));
  }
}
const unsubscribe = controller.subscribe(update);
const handlers = [];
function listen(target, event, callback) { target.addEventListener(event, callback); handlers.push(() => target.removeEventListener(event, callback)); }
function applyAccess() {
  const role = element('map-role').value, enabled = element('map-country-no').checked;
  element('map-country-no').disabled = role === 'requester';
  element('map-access-note').textContent = role === 'requester'
    ? 'Requesters see every country actively supported by Non-verba.'
    : 'Operators see supported countries enabled for their account.';
  controller.setAccess({role, enabledCountries: enabled ? ['NO'] : []}); view.fit();
}
listen(element('map-role'), 'change', applyAccess);
listen(element('map-country-no'), 'change', applyAccess);
listen(element('map-fit'), 'click', () => view.fit());
listen(element('map-zoom-in'), 'click', () => view.zoomIn());
listen(element('map-zoom-out'), 'click', () => view.zoomOut());
for (const [city, position] of Object.entries(cities)) listen(element(`map-${city}`), 'click', () => view.focus(position, 12));
listen(element('map-osm'), 'change', () => {
  const enabled = element('map-osm').checked;
  controller.setTileSource(enabled ? createOsmPreviewTileSource() : null);
  const attribution = element('map-attribution');
  attribution.hidden = !enabled;
});
listen(element('map-demo'), 'click', () => {
  const observed = Date.now();
  controller.setPositions([
    {id: 'example-oslo', label: 'Example operator · Oslo', country_code: 'NO', ...cities.oslo,
      accuracy_m: 20, observed_at_ms: observed, source: 'synthetic example'},
    {id: 'example-bergen', label: 'Example operator · Bergen', country_code: 'NO', ...cities.bergen,
      accuracy_m: 35, observed_at_ms: observed, source: 'synthetic example'},
  ]);
  controller.setRoutes([{id: 'example-route', label: 'Illustrative Oslo–Lillehammer line', country_code: 'NO',
    points: [cities.oslo, {latitude: 60.2, longitude: 10.9}, {latitude: 60.78, longitude: 10.73}, {latitude: 61.1153, longitude: 10.4662}]}]);
});
listen(element('map-clear'), 'click', () => controller.clear());
listen(document, 'visibilitychange', () => { if (!document.hidden) controller.refresh(); });
function destroy() {
  if (destroyed) return;
  destroyed = true; clearTimeout(expiryTimer); unsubscribe();
  for (const remove of handlers) remove(); view.destroy();
}
listen(window, 'pagehide', event => { if (!event.persisted) destroy(); });
update();

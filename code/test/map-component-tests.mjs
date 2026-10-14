// SPDX-License-Identifier: AGPL-3.0-only
// Pure map geometry, product coverage and data-boundary checks. All overlays
// below are synthetic; none acquire a sensor or imply a verified location.
import test from 'node:test';
import assert from 'node:assert/strict';
import {project, unproject, geometryBounds, containsPosition, tileIntersectsGeometry} from '../../web/src/map-geometry.js';
import {INITIAL_MAP_CATALOG, visibleCountries} from '../../web/src/map-policy.js';
import {MapController} from '../../web/src/map-controller.js';
import {createOsmPreviewTileSource, createSameOriginTileSource} from '../../web/src/map-tiles.js';

const ring = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const polygon = {type: 'Polygon', coordinates: [ring(0, 0, 40, 40), ring(10, 10, 20, 20)]};
const otherPolygon = {type: 'Polygon', coordinates: [ring(-40, -40, -20, -20)]};
const catalog = () => [
  {code: 'NO', name: 'Synthetic Norway coverage', active: true, geometry: structuredClone(polygon)},
  {code: 'SE', name: 'Synthetic second deployment', active: true, geometry: structuredClone(otherPolygon)},
  {code: 'FI', name: 'Synthetic inactive deployment', active: false, geometry: structuredClone(otherPolygon)},
];
const codes = countries => countries.map(country => country.code);
const now = 2_000_000_000_000;
const position = (changes = {}) => ({id: 'operator-1', country_code: 'NO', label: 'Synthetic operator',
  latitude: 5, longitude: 5, accuracy_m: 12, observed_at_ms: now, source: 'synthetic-fixture', ...changes});
const route = (changes = {}) => ({id: 'route-1', country_code: 'NO', label: 'Synthetic route',
  points: [{latitude: 4, longitude: 4}, {latitude: 6, longitude: 6}], ...changes});
const controller = options => new MapController({catalog: catalog(), role: 'operator', enabledCountries: ['NO'], now: () => now, ...options});

test('Web Mercator projection round-trips common positions and preserves tile world size', () => {
  for (const zoom of [0, 3, 12, 18]) {
    const size = 256 * 2 ** zoom;
    assert.deepEqual(project({latitude: 0, longitude: 0}, zoom), {x: size / 2, y: size / 2});
    for (const sample of [{latitude: 59.9139, longitude: 10.7522}, {latitude: 69.6492, longitude: 18.9553},
      {latitude: -33.8688, longitude: 151.2093}, {latitude: 80, longitude: -175}]) {
      const restored = unproject(project(sample, zoom), zoom);
      assert.ok(Math.abs(restored.latitude - sample.latitude) < 1e-8);
      assert.ok(Math.abs(restored.longitude - sample.longitude) < 1e-8);
    }
  }
});

test('polygon membership uses country outlines, includes exterior boundaries and excludes holes', () => {
  assert.deepEqual(geometryBounds(polygon), {west: 0, south: 0, east: 40, north: 40});
  assert.equal(containsPosition(polygon, {latitude: 5, longitude: 5}), true);
  assert.equal(containsPosition(polygon, {latitude: 0, longitude: 20}), true);
  assert.equal(containsPosition(polygon, {latitude: 40, longitude: 40}), true);
  assert.equal(containsPosition(polygon, {latitude: 15, longitude: 15}), false);
  assert.equal(containsPosition(polygon, {latitude: 5, longitude: 41}), false);
  const islands = {type: 'MultiPolygon', coordinates: [[ring(0, 0, 2, 2)], [ring(8, 8, 9, 9)]]};
  assert.deepEqual(geometryBounds(islands), {west: 0, south: 0, east: 9, north: 9});
  assert.equal(containsPosition(islands, {latitude: 8.5, longitude: 8.5}), true);
  assert.equal(containsPosition(islands, {latitude: 5, longitude: 5}), false);
});

test('cached immutable geometry preserves polygon, hole and island membership across latitude bins', () => {
  const freeze = value => {
    if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
    return value;
  };
  const islands = {type: 'MultiPolygon', coordinates: [structuredClone(polygon.coordinates), [ring(45, 5, 47, 7)]]};
  for (const geometry of [polygon, islands]) {
    const mutable = structuredClone(geometry), immutable = freeze(structuredClone(geometry));
    for (let latitude = -5; latitude <= 45; latitude += 2.5) for (let longitude = -5; longitude <= 50; longitude += 2.5) {
      const sample = {latitude, longitude};
      assert.equal(containsPosition(immutable, sample), containsPosition(mutable, sample), JSON.stringify(sample));
    }
    for (const sample of [{latitude: 6, longitude: 46}, {latitude: 10, longitude: 15},
      {latitude: 19.9999, longitude: 15}, {latitude: 20.0001, longitude: 15}, {latitude: 40, longitude: 40}]) {
      assert.equal(containsPosition(immutable, sample), containsPosition(mutable, sample), JSON.stringify(sample));
    }
  }
});

test('tile selection finds small islands and crossing edges and skips tiles wholly inside a hole', () => {
  // At z8, x138/y117 is wholly within the synthetic 10..20 degree hole.
  assert.equal(tileIntersectsGeometry({x: 138, y: 117, z: 8}, polygon), false);
  assert.equal(tileIntersectsGeometry({x: 132, y: 115, z: 8}, polygon), true);
  assert.equal(tileIntersectsGeometry({x: 50, y: 100, z: 8}, polygon), false);
  const island = {type: 'Polygon', coordinates: [ring(1, 1, 2, 2)]};
  assert.equal(tileIntersectsGeometry({x: 0, y: 0, z: 0}, island), true,
    'An island wholly inside a tile must not require a tile corner inside the country');
  const crossing = {type: 'Polygon', coordinates: [ring(-30, -1, 30, 1)]};
  assert.equal(tileIntersectsGeometry({x: 16, y: 15, z: 5}, crossing), true);
  assert.equal(tileIntersectsGeometry({x: 16, y: 12, z: 5}, crossing), false);
});

test('initial supported world is Norway mainland with coastal islands and excludes remote territories', () => {
  assert.deepEqual(codes(INITIAL_MAP_CATALOG.filter(country => country.active)), ['NO']);
  const norway = INITIAL_MAP_CATALOG.find(country => country.code === 'NO');
  for (const sample of [{latitude: 59.9139, longitude: 10.7522}, {latitude: 60.3913, longitude: 5.3221},
    {latitude: 69.6492, longitude: 18.9553}, {latitude: 68.2322, longitude: 14.5686}]) {
    assert.equal(containsPosition(norway.geometry, sample), true, `Mainland/coastal sample ${JSON.stringify(sample)}`);
  }
  for (const sample of [{latitude: 78.2232, longitude: 15.6469}, {latitude: 70.922, longitude: -8.718},
    {latitude: 59.3293, longitude: 18.0686}, {latitude: 55.6761, longitude: 12.5683}]) {
    assert.equal(containsPosition(norway.geometry, sample), false, `Unsupported sample ${JSON.stringify(sample)}`);
  }
});

test('requester coverage follows active deployments and operator coverage requires explicit enabled countries', () => {
  assert.deepEqual(codes(visibleCountries(catalog(), {role: 'requester', enabledCountries: []})), ['NO', 'SE']);
  assert.deepEqual(codes(visibleCountries(catalog(), {role: 'operator', enabledCountries: ['NO', 'FI']})), ['NO']);
  assert.deepEqual(codes(visibleCountries(catalog(), {role: 'operator', enabledCountries: []})), []);
  assert.deepEqual(codes(visibleCountries(catalog(), {role: 'operator', enabledCountries: ['DK']})), []);
  assert.throws(() => visibleCountries(catalog(), {role: 'administrator', enabledCountries: ['NO']}));
  for (const ids of [null, 'NO', ['no'], ['NO', 7], ['../NO']]) {
    assert.throws(() => visibleCountries(catalog(), {role: 'operator', enabledCountries: ids}));
  }
});

test('malformed or duplicate deployment configuration fails closed', () => {
  const malformed = [
    [...catalog(), structuredClone(catalog()[0])],
    [{...catalog()[0], code: 'no'}],
    [{...catalog()[0], active: 'true'}],
    [{...catalog()[0], geometry: {type: 'Point', coordinates: [5, 5]}}],
    [{...catalog()[0], geometry: {type: 'Polygon', coordinates: [[[0, 0], [40, 0], [40, 40]]]}}],
    [{...catalog()[0], geometry: {type: 'Polygon', coordinates: [ring(0, 0, Infinity, 40)]}}],
  ];
  for (const deployment of malformed) {
    assert.throws(() => visibleCountries(deployment, {role: 'requester'}));
    assert.throws(() => new MapController({catalog: deployment, role: 'requester'}));
  }
});

test('positions require supported geometry, scoped access and a recent nonfuture observation', () => {
  const map = controller();
  map.setPositions([
    position(), position({id: 'hole', latitude: 15, longitude: 15}),
    position({id: 'outside', longitude: 50}), position({id: 'disabled', country_code: 'SE', latitude: -30, longitude: -30}),
    position({id: 'unsupported', country_code: 'DK'}), position({id: 'stale', observed_at_ms: now - 60_001}),
    position({id: 'future', observed_at_ms: now + 5_001}),
  ]);
  assert.deepEqual(map.snapshot().positions.map(item => item.id), ['operator-1']);
  const empty = new MapController({catalog: catalog(), role: 'operator', now: () => now});
  empty.setPositions([position()]);
  assert.deepEqual(empty.snapshot().positions, []);
});

test('routes reject whole out-of-coverage lines and retain only enabled country overlays', () => {
  const map = controller();
  map.setRoutes([route(), route({id: 'hole', points: [{latitude: 5, longitude: 5}, {latitude: 15, longitude: 15}]}),
    route({id: 'outside', points: [{latitude: 5, longitude: 5}, {latitude: 5, longitude: 50}]}),
    route({id: 'disabled', country_code: 'SE', points: [{latitude: -30, longitude: -30}, {latitude: -31, longitude: -31}]}),
    route({id: 'unsupported', country_code: 'DK'})]);
  assert.deepEqual(map.snapshot().routes.map(item => item.id), ['route-1']);
});

test('malformed position and route batches leave the previous overlays intact', () => {
  const map = controller(); map.setPositions([position()]); map.setRoutes([route()]);
  const before = map.snapshot();
  for (const changed of [{latitude: NaN}, {longitude: Infinity}, {latitude: 91}, {longitude: -181},
    {accuracy_m: -1}, {observed_at_ms: -1}, {observed_at_ms: now + 0.5}, {id: ''},
    {label: null}, {source: null}, {country_code: 'no'}]) {
    assert.throws(() => map.setPositions([position({id: 'replacement'}), position(changed)]));
    assert.deepEqual(map.snapshot(), before);
  }
  for (const changed of [{points: []}, {points: [{latitude: 5, longitude: 5}]},
    {points: [{latitude: 5, longitude: 5}, {latitude: NaN, longitude: 6}]}, {id: ''}, {label: null}, {country_code: 'no'}]) {
    assert.throws(() => map.setRoutes([route({id: 'replacement'}), route(changed)]));
    assert.deepEqual(map.snapshot(), before);
  }
});

test('revoked access and deployment changes clear overlays immediately and invalid changes are atomic', () => {
  const map = controller(); let notifications = 0;
  const unsubscribe = map.subscribe(() => notifications++);
  map.setPositions([position()]); map.setRoutes([route()]);
  const before = map.snapshot();
  assert.throws(() => map.setAccess({role: 'unknown', enabledCountries: ['NO']}));
  assert.deepEqual(map.snapshot(), before);
  assert.throws(() => map.replaceCatalog([{...catalog()[0], code: 'invalid'}]));
  assert.deepEqual(map.snapshot(), before);
  map.setAccess({role: 'operator', enabledCountries: []});
  assert.deepEqual(map.snapshot().countries, []);
  assert.deepEqual(map.snapshot().positions, []); assert.deepEqual(map.snapshot().routes, []);
  map.setAccess({role: 'requester', enabledCountries: []});
  map.setPositions([position()]); map.setRoutes([route()]);
  map.replaceCatalog(catalog().map(country => ({...country, active: false})));
  assert.deepEqual(map.snapshot().countries, []);
  assert.deepEqual(map.snapshot().positions, []); assert.deepEqual(map.snapshot().routes, []);
  assert.ok(notifications > 0); unsubscribe(); const count = notifications;
  map.setPositions([]); assert.equal(notifications, count);
});

test('snapshot consumers cannot inject or remove overlays before or after controller resets', () => {
  const map = controller();
  const checkIsolation = label => {
    const before = map.snapshot(), exposed = map.snapshot();
    exposed.routes.splice(0, exposed.routes.length, {id: 'unvalidated', country_code: 'SE', points: []});
    exposed.positions.splice(0, exposed.positions.length, position({id: 'unvalidated', country_code: 'SE'}));
    assert.throws(() => exposed.countries.push(catalog()[0]));
    assert.deepEqual(map.snapshot(), before, label);
  };
  checkIsolation('new controller');
  map.setPositions([position()]); map.setRoutes([route()]);
  const populated = map.snapshot();
  assert.throws(() => { populated.positions[0].longitude = 30; });
  assert.throws(() => { populated.routes[0].points[0].latitude = 30; });
  assert.throws(() => { populated.countries[0].geometry.coordinates[0][0][0] = 30; });
  checkIsolation('populated controller');
  for (const [label, reset] of [
    ['clear', () => map.clear()],
    ['access change', () => map.setAccess({role: 'operator', enabledCountries: ['NO']})],
    ['catalog replacement', () => map.replaceCatalog(catalog())],
  ]) {
    map.setPositions([position()]); map.setRoutes([route()]); reset();
    assert.deepEqual(map.snapshot().positions, []);
    assert.deepEqual(map.snapshot().routes, []);
    checkIsolation(label);
  }
});

test('position expiry is evaluated again on snapshots and a refresh emits the fresh display state', () => {
  let clock = now;
  const map = controller({now: () => clock}); map.setPositions([position()]);
  const updates = []; const off = map.subscribe(value => updates.push(value));
  clock += 60_001;
  assert.deepEqual(map.snapshot().positions, []);
  map.refresh(); assert.deepEqual(updates.at(-1).positions, []);
  clock = now;
  assert.deepEqual(map.snapshot().positions, [], 'An expired sample must not reappear after the clock moves backward');
  map.refresh(); assert.deepEqual(updates.at(-1).positions, []); off();
});

test('bounded batches and duplicate IDs cannot replace valid display state', () => {
  const map = controller(); map.setPositions([position()]); map.setRoutes([route()]);
  const before = map.snapshot();
  for (const rows of [[position(), position()], Array.from({length: 501}, (_, i) => position({id: `position-${i}`}))]) {
    assert.throws(() => map.setPositions(rows)); assert.deepEqual(map.snapshot(), before);
  }
  for (const rows of [[route(), route()], Array.from({length: 101}, (_, i) => route({id: `route-${i}`})),
    [route({points: Array.from({length: 10001}, () => ({latitude: 5, longitude: 5}))})]]) {
    assert.throws(() => map.setRoutes(rows)); assert.deepEqual(map.snapshot(), before);
  }
});

test('tile providers are explicit and a self-hosted provider cannot leave its configured origin', () => {
  const map = controller(); assert.equal(map.tileSource(), null);
  const preview = createOsmPreviewTileSource();
  const previewUrl = new URL(preview.url(5, 12, 20));
  assert.equal(previewUrl.origin, 'https://tile.openstreetmap.org');
  assert.match(preview.attribution, /OpenStreetMap/); assert.ok(preview.referrerPolicy && preview.referrerPolicy !== 'no-referrer');
  let changes = 0; const off = map.subscribe(() => changes++); const before = changes;
  map.setTileSource(preview); assert.equal(map.tileSource(), preview); assert.ok(changes > before);
  map.setTileSource(null); assert.equal(map.tileSource(), null); off();
  const local = createSameOriginTileSource({baseUrl: '/tiles/norway/', origin: 'https://non-verba.example', attribution: 'Synthetic fixture tiles'});
  const localUrl = new URL(local.url(5, 12, 20), 'https://non-verba.example');
  assert.equal(localUrl.origin, 'https://non-verba.example'); assert.equal(localUrl.search, ''); assert.equal(localUrl.hash, '');
  assert.equal(localUrl.pathname, '/tiles/norway/5/12/20.png');
  for (const baseUrl of ['https://foreign.example/tiles/', '//foreign.example/tiles/', '/tiles/?token=secret',
    '/tiles/#marker', 'https://user:secret@non-verba.example/tiles/', '/tiles/../private/', '/tiles/%2e%2e/private/']) {
    assert.throws(() => createSameOriginTileSource({baseUrl, origin: 'https://non-verba.example', attribution: 'Fixture'}), baseUrl);
  }
});

// SPDX-License-Identifier: AGPL-3.0-only
// Display geometry only: never an account grant or evidence verifier.
const LIMIT = 85.0511287798066;
const EPSILON = 1e-9;
const compiledCache = new WeakMap();
const ROWS = 64;
export function validatePosition(position) {
  if (!position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)
    || Math.abs(position.latitude) > LIMIT || Math.abs(position.longitude) > 180)
    throw new Error('Map coordinates must be finite WGS84 numbers within Web Mercator.');
  return position;
}
function validateZoom(zoom) {
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 22) throw new Error('Invalid map zoom.');
}
export function project(position, zoom = 0) {
  validatePosition(position); validateZoom(zoom);
  const size = 256 * 2 ** zoom, sin = Math.sin(position.latitude * Math.PI / 180);
  return {x: (position.longitude + 180) / 360 * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size};
}
export function unproject(point, zoom = 0) {
  validateZoom(zoom);
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new Error('Invalid map pixel.');
  const size = 256 * 2 ** zoom;
  return {longitude: point.x / size * 360 - 180,
    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * point.y / size))) * 180 / Math.PI};
}
export function geometryPolygons(geometry) {
  if (geometry?.type === 'Feature') geometry = geometry.geometry;
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error('Map coverage requires Polygon or MultiPolygon geometry.');
}
export function validateGeometry(geometry) {
  const polygons = geometryPolygons(geometry);
  if (!Array.isArray(polygons) || polygons.length === 0 || polygons.length > 5000)
    throw new Error('Invalid map coverage polygons.');
  let vertices = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error('Missing map coverage rings.');
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error('Invalid map coverage ring.');
      for (const coordinate of ring) {
        if (!Array.isArray(coordinate) || coordinate.length !== 2) throw new Error('Invalid coverage coordinate.');
        validatePosition({longitude: coordinate[0], latitude: coordinate[1]});
        if (++vertices > 100000) throw new Error('Map coverage exceeds the vertex limit.');
      }
      const first = ring[0], last = ring.at(-1);
      if (first[0] !== last[0] || first[1] !== last[1]) throw new Error('Coverage rings must be closed.');
      let minLongitude = Infinity, maxLongitude = -Infinity;
      for (const [longitude] of ring) {
        minLongitude = Math.min(minLongitude, longitude); maxLongitude = Math.max(maxLongitude, longitude);
      }
      // Antimeridian countries need deliberately split display geometry.
      if (maxLongitude - minLongitude > 180)
        throw new Error('Split antimeridian coverage before adding it to the map.');
    }
  }
  return geometry;
}
function compiledGeometry(geometry) {
  if (compiledCache.has(geometry)) return compiledCache.get(geometry);
  const value = geometry.type === 'Feature' ? geometry.geometry : geometry;
  let immutable = Object.isFrozen(geometry) && Object.isFrozen(value) && Object.isFrozen(value.coordinates);
  const bounds = {west: Infinity, south: Infinity, east: -Infinity, north: -Infinity};
  const polygons = geometryPolygons(geometry).map(polygon => {
    immutable &&= Object.isFrozen(polygon);
    return polygon.map(ring => {
      immutable &&= Object.isFrozen(ring);
      const area = {west: Infinity, south: Infinity, east: -Infinity, north: -Infinity};
      for (const coordinate of ring) {
        immutable &&= Object.isFrozen(coordinate);
        area.west = Math.min(area.west, coordinate[0]); area.east = Math.max(area.east, coordinate[0]);
        area.south = Math.min(area.south, coordinate[1]); area.north = Math.max(area.north, coordinate[1]);
      }
      bounds.west = Math.min(bounds.west, area.west); bounds.east = Math.max(bounds.east, area.east);
      bounds.south = Math.min(bounds.south, area.south); bounds.north = Math.max(bounds.north, area.north);
      const rows = Array.from({length: ROWS}, () => []);
      const rowFor = latitude => Math.max(0, Math.min(ROWS - 1,
        Math.floor((latitude - area.south) / Math.max(EPSILON, area.north - area.south) * ROWS)));
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i];
        const first = rowFor(Math.min(a[1], b[1]) - EPSILON), last = rowFor(Math.max(a[1], b[1]) + EPSILON);
        for (let row = first; row <= last; row++) rows[row].push([a, b]);
      }
      return {ring, bounds: area, rows, rowFor};
    });
  });
  const compiled = {bounds, polygons};
  // Mutable caller geometry stays uncached; controller-owned geometry is frozen.
  if (immutable) compiledCache.set(geometry, compiled);
  return compiled;
}
export function geometryBounds(geometry) {
  return {...compiledGeometry(geometry).bounds};
}
function onSegment([x, y], [ax, ay], [bx, by]) {
  return Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) < EPSILON
    && x >= Math.min(ax, bx) - EPSILON && x <= Math.max(ax, bx) + EPSILON
    && y >= Math.min(ay, by) - EPSILON && y <= Math.max(ay, by) + EPSILON;
}
function inRing(point, compiled) {
  const bounds = compiled.bounds;
  if (point[0] < bounds.west - EPSILON || point[0] > bounds.east + EPSILON
    || point[1] < bounds.south - EPSILON || point[1] > bounds.north + EPSILON) return 0;
  let inside = false;
  for (const [a, b] of compiled.rows[compiled.rowFor(point[1])]) {
    if (onSegment(point, a, b)) return 2;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 1 : 0;
}
export function containsPosition(geometry, position) {
  validatePosition(position);
  const point = [position.longitude, position.latitude];
  return compiledGeometry(geometry).polygons.some(polygon => {
    const outer = inRing(point, polygon[0]);
    return outer !== 0 && !polygon.slice(1).some(ring => inRing(point, ring) !== 0);
  });
}
function segmentsIntersect(a, b, c, d) {
  if (onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)) return true;
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return (cross(a, b, c) > 0) !== (cross(a, b, d) > 0)
    && (cross(c, d, a) > 0) !== (cross(c, d, b) > 0);
}
export function tileIntersectsGeometry({x, y, z}, geometry) {
  if (!Number.isInteger(z) || z < 0 || z > 22 || !Number.isInteger(x) || !Number.isInteger(y)
    || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return false;
  const nw = unproject({x: x * 256, y: y * 256}, z);
  const se = unproject({x: (x + 1) * 256, y: (y + 1) * 256}, z);
  const corners = [[nw.longitude, nw.latitude], [se.longitude, nw.latitude],
    [se.longitude, se.latitude], [nw.longitude, se.latitude]];
  const bounds = geometryBounds(geometry);
  if (se.longitude < bounds.west || nw.longitude > bounds.east || se.latitude > bounds.north || nw.latitude < bounds.south) return false;
  if (corners.some(([longitude, latitude]) => containsPosition(geometry, {longitude, latitude}))) return true;
  for (const polygon of compiledGeometry(geometry).polygons) for (const compiled of polygon) {
    const bounds = compiled.bounds, ring = compiled.ring;
    if (se.longitude < bounds.west || nw.longitude > bounds.east || se.latitude > bounds.north || nw.latitude < bounds.south) continue;
    for (let i = 1; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      if (lon >= nw.longitude && lon <= se.longitude && lat >= se.latitude && lat <= nw.latitude) return true;
      for (let j = 0; j < 4; j++) if (segmentsIntersect(ring[i - 1], ring[i], corners[j], corners[(j + 1) % 4])) return true;
    }
  }
  return false;
}

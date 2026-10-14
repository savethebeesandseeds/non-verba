// SPDX-License-Identifier: AGPL-3.0-only
function tileCoordinates(z, x, y, min, max) {
  if (!Number.isInteger(z) || z < min || z > max || !Number.isInteger(x) || !Number.isInteger(y)
    || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('Invalid raster tile coordinates.');
}
export function createOsmPreviewTileSource() {
  return Object.freeze({id: 'osm-browser-preview', minZoom: 0, maxZoom: 18,
    attribution: '© OpenStreetMap contributors', attributionUrl: 'https://www.openstreetmap.org/copyright',
    referrerPolicy: 'strict-origin-when-cross-origin',
    url(z, x, y) { tileCoordinates(z, x, y, 0, 18); return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`; }});
}
export function createSameOriginTileSource({baseUrl, origin, attribution, minZoom = 0, maxZoom = 18}) {
  if (!Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || minZoom < 0 || maxZoom > 18 || minZoom > maxZoom
    || typeof attribution !== 'string' || !attribution.trim()) throw new Error('Invalid curated tile source.');
  const host = new URL(origin);
  if (!['https:', 'http:'].includes(host.protocol) || host.username || host.password)
    throw new Error('Map tiles require an HTTP origin.');
  if (typeof baseUrl !== 'string' || !baseUrl || /[?#\\]/.test(baseUrl)
    || /(?:^|\/)(?:\.|\.\.)(?:\/|$)/.test(baseUrl) || /%/i.test(baseUrl)) throw new Error('Invalid tile base path.');
  const base = new URL(baseUrl, host.origin);
  if (base.origin !== host.origin || base.username || base.password || base.search || base.hash)
    throw new Error('Curated tiles must remain on the application origin.');
  const prefix = base.href.replace(/\/$/, '');
  return Object.freeze({id: prefix, minZoom, maxZoom, attribution, referrerPolicy: 'no-referrer',
    url(z, x, y) { tileCoordinates(z, x, y, minZoom, maxZoom); return `${prefix}/${z}/${x}/${y}.png`; }});
}

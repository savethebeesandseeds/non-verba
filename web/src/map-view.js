// SPDX-License-Identifier: AGPL-3.0-only
// Presentation only. The caller supplies country policy, positions and routes;
// opening or moving this view never starts a sensor or requests a route.
import {project, unproject, geometryBounds, tileIntersectsGeometry, containsPosition} from './map-geometry.js';

const TILE_SIZE = 256, CACHE_LIMIT = 96, DOWNLOAD_LIMIT = 4;
const MERCATOR_LIMIT = 85.0511287798066;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const validPoint = point => point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
  && Math.abs(point.latitude) <= MERCATOR_LIMIT && Math.abs(point.longitude) <= 180;
function polygons(geometry) {
  const value = geometry?.type === 'Feature' ? geometry.geometry : geometry;
  if (value?.type === 'Polygon') return [value.coordinates];
  if (value?.type === 'MultiPolygon') return value.coordinates;
  return [];
}

/** A small Canvas viewport with country-clipped, demand-loaded raster tiles.
 * Source and snapshot changes must notify the controller's subscribers. */
export function createMapView({canvas, controller, onStatus = () => {}}) {
  if (!canvas?.getContext || !controller?.snapshot || !controller?.subscribe || !controller?.tileSource)
    throw new Error('A map canvas and controller are required.');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The map canvas is unavailable.');
  let snapshot, source = null, closed = false, frame = null;
  let width = 0, height = 0, ratio = 1, zoom = 0, center = {latitude: 64, longitude: 16};
  let needsFit = true, generation = 0, activeDownloads = 0, lastStatus = '';
  let wanted = new Set(), queue = [], gesture = null, area = null;
  let coveragePath = new Path2D(), coverageBoundaryPath = new Path2D();
  const cache = new Map(), intersections = new Map(), pointers = new Map(), listeners = [];

  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  }
  function report(state) {
    let loaded = 0, failed = 0, pending = 0;
    for (const key of wanted) {
      const tile = cache.get(key);
      if (tile?.state === 'loaded') loaded++;
      else if (tile?.state === 'failed') failed++;
      else pending++;
    }
    const value = {state, loaded, pending, failed, attribution: source?.attribution ?? ''};
    const key = JSON.stringify(value);
    if (key !== lastStatus) { lastStatus = key; onStatus(value); }
  }
  function stopTile(tile) {
    if (tile.state === 'loading') activeDownloads--;
    if (tile.image) {
      tile.image.onload = null; tile.image.onerror = null;
      tile.image.removeAttribute('src');
    }
    tile.image = null;
    tile.state = 'cancelled';
  }
  function clearTiles() {
    generation++;
    for (const tile of cache.values()) stopTile(tile);
    cache.clear(); queue = []; wanted = new Set(); activeDownloads = 0;
  }
  function clearSurface() {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#e8eae2'; context.fillRect(0, 0, width, height);
  }
  function schedule() {
    if (!closed && frame === null) frame = requestAnimationFrame(() => { frame = null; draw(); });
  }
  function rebuildCoverage() {
    intersections.clear(); coveragePath = new Path2D(); coverageBoundaryPath = new Path2D();
    if (!snapshot.countries.length) { area = null; return; }
    const values = snapshot.countries.map(country => geometryBounds(country.geometry));
    area = {west: Math.min(...values.map(value => value.west)), east: Math.max(...values.map(value => value.east)),
      south: Math.min(...values.map(value => value.south)), north: Math.max(...values.map(value => value.north))};
    // Project the boundary once at world zoom zero. Canvas transforms reuse its
    // native Path2D during pan/zoom without walking coastlines on each frame.
    for (const country of snapshot.countries) for (const polygon of polygons(country.geometry)) {
      for (let index = 0; index < polygon.length; index++) {
        const points = polygon[index].map(coordinate => project({longitude: coordinate[0], latitude: coordinate[1]}));
        let signedArea = 0;
        for (let i = 0; i < points.length; i++) {
          const a = points[i], b = points[(i + 1) % points.length]; signedArea += a.x * b.y - b.x * a.y;
        }
        // Consistent outer winding makes overlapping administrative polygons a
        // union under the nonzero rule; opposite holes retain their exclusions.
        // Reverse only this projected copy, preserving the caller's geometry.
        if ((signedArea > 0) !== (index === 0)) points.reverse();
        for (const path of country.draw_boundary === false ? [coveragePath] : [coveragePath, coverageBoundaryPath]) {
          if (!points.length) continue;
          path.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
          path.closePath();
        }
      }
    }
  }
  function limits() {
    return {min: clamp(Math.ceil(source?.minZoom ?? 0), 0, 18), max: clamp(Math.floor(source?.maxZoom ?? 18), 0, 18)};
  }
  function constrainCenter() {
    if (!area) return;
    const nw = project({latitude: area.north, longitude: area.west}, zoom);
    const se = project({latitude: area.south, longitude: area.east}, zoom);
    // A large drag may temporarily move the mathematical center beyond the
    // Mercator world; clamp before sending it back through strict projection.
    const point = project({latitude: clamp(center.latitude, -MERCATOR_LIMIT, MERCATOR_LIMIT),
      longitude: clamp(center.longitude, -180, 180)}, zoom);
    center = unproject({x: clamp(point.x, nw.x, se.x), y: clamp(point.y, nw.y, se.y)}, zoom);
  }
  function fit() {
    if (closed) return;
    if (!area || !width || !height) { needsFit = true; schedule(); return; }
    const nw = project({latitude: area.north, longitude: area.west});
    const se = project({latitude: area.south, longitude: area.east});
    const availableWidth = Math.max(32, width - 64), availableHeight = Math.max(32, height - 64);
    const scale = Math.min(availableWidth / Math.max(1e-6, se.x - nw.x), availableHeight / Math.max(1e-6, se.y - nw.y));
    const range = limits();
    zoom = clamp(Math.floor(Math.log2(scale)), range.min, range.max);
    center = unproject({x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2});
    needsFit = false; schedule();
  }
  function screen(point) {
    const p = project(point, zoom), c = project(center, zoom);
    return {x: p.x - c.x + width / 2, y: p.y - c.y + height / 2};
  }
  function countryTransform() {
    const scale = 2 ** zoom, c = project(center, zoom);
    context.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * (width / 2 - c.x), ratio * (height / 2 - c.y));
  }
  function trimCache(target = CACHE_LIMIT) {
    for (const [key, tile] of cache) {
      if (cache.size <= target) break;
      if (!wanted.has(key) && tile.state !== 'loading') { stopTile(tile); cache.delete(key); }
    }
  }
  function pump() {
    if (closed || !source || document.hidden) return;
    while (activeDownloads < DOWNLOAD_LIMIT && queue.length) {
      const tile = queue.shift();
      if (tile.state !== 'queued' || !wanted.has(tile.key) || !cache.has(tile.key)) continue;
      const heldGeneration = generation;
      let url;
      try { url = source.url(tile.z, tile.x, tile.y); }
      catch { tile.state = 'failed'; schedule(); continue; }
      if (typeof url !== 'string' || !url) { tile.state = 'failed'; schedule(); continue; }
      const image = new Image(); tile.image = image; tile.state = 'loading'; activeDownloads++;
      image.referrerPolicy = source.referrerPolicy ?? 'strict-origin-when-cross-origin';
      const finish = loaded => {
        if (closed || generation !== heldGeneration || tile.state !== 'loading' || cache.get(tile.key) !== tile) return;
        image.onload = null; image.onerror = null; activeDownloads--;
        tile.state = loaded && image.naturalWidth > 0 ? 'loaded' : 'failed';
        if (tile.state === 'failed') { image.removeAttribute('src'); tile.image = null; }
        schedule(); pump();
      };
      image.onload = () => finish(true); image.onerror = () => finish(false);
      image.src = url;
    }
  }
  function tiles() {
    const count = 2 ** zoom, c = project(center, zoom);
    const left = c.x - width / 2, top = c.y - height / 2;
    const visible = [];
    const startX = clamp(Math.floor(left / TILE_SIZE), 0, count - 1);
    const endX = clamp(Math.floor((left + width) / TILE_SIZE), 0, count - 1);
    const startY = clamp(Math.floor(top / TILE_SIZE), 0, count - 1);
    const endY = clamp(Math.floor((top + height) / TILE_SIZE), 0, count - 1);
    for (let y = startY; y <= endY; y++) for (let x = startX; x <= endX; x++) {
      const key = `${zoom}/${x}/${y}`;
      let intersects = intersections.get(key);
      if (intersects === undefined) {
        intersects = snapshot.countries.some(country => tileIntersectsGeometry({x, y, z: zoom}, country.geometry));
        if (intersections.size >= 512) intersections.delete(intersections.keys().next().value);
        intersections.set(key, intersects);
      }
      if (!intersects) continue;
      visible.push({key, x, y, z: zoom, left: x * TILE_SIZE - left, top: y * TILE_SIZE - top});
    }
    // Stay bounded even in an exceptionally large host element. Nearest tiles
    // are most useful; the country outline remains visible beyond the budget.
    visible.sort((a, b) => Math.hypot(a.left + 128 - width / 2, a.top + 128 - height / 2)
      - Math.hypot(b.left + 128 - width / 2, b.top + 128 - height / 2));
    visible.length = Math.min(visible.length, CACHE_LIMIT);
    wanted = new Set(visible.map(item => item.key));
    for (const [key, tile] of cache) if (!wanted.has(key) && ['queued', 'loading'].includes(tile.state)) {
      stopTile(tile); cache.delete(key);
    }
    queue = queue.filter(tile => tile.state === 'queued' && wanted.has(tile.key));
    for (const item of visible) {
      let tile = cache.get(item.key);
      if (!tile) {
        // Even a very large embedding cannot grow the cache beyond this bound.
        trimCache(CACHE_LIMIT - 1);
        if (cache.size >= CACHE_LIMIT) continue;
        tile = {...item, state: 'queued', image: null}; cache.set(item.key, tile); queue.push(tile);
      } else { cache.delete(item.key); cache.set(item.key, tile); }
      if (tile.state === 'loaded') context.drawImage(tile.image, item.left, item.top, TILE_SIZE, TILE_SIZE);
    }
    trimCache(); pump();
  }
  function overlays() {
    context.lineWidth = 3; context.lineJoin = 'round'; context.lineCap = 'round'; context.strokeStyle = '#df633e';
    for (const route of snapshot.routes ?? []) {
      let started = false; context.beginPath();
      for (const point of route.points ?? []) {
        if (!validPoint(point)) { started = false; continue; }
        const p = screen(point);
        if (started) context.lineTo(p.x, p.y); else { context.moveTo(p.x, p.y); started = true; }
      }
      context.stroke();
    }
    for (const position of snapshot.positions ?? []) {
      if (!validPoint(position)) continue;
      const p = screen(position);
      if (p.x < -300 || p.x > width + 300 || p.y < -300 || p.y > height + 300) continue;
      if (Number.isFinite(position.accuracy_m) && position.accuracy_m > 0) {
        const metersPerPixel = 40075016.686 * Math.cos(clamp(position.latitude, -85, 85) * Math.PI / 180) / (TILE_SIZE * 2 ** zoom);
        const radius = clamp(position.accuracy_m / metersPerPixel, 2, 8192);
        context.beginPath(); context.arc(p.x, p.y, radius, 0, Math.PI * 2);
        context.fillStyle = '#415f4520'; context.fill(); context.strokeStyle = '#415f4560'; context.lineWidth = 1; context.stroke();
      }
      context.beginPath(); context.arc(p.x, p.y, 6, 0, Math.PI * 2);
      context.fillStyle = '#304b34'; context.fill(); context.strokeStyle = '#fffdf5'; context.lineWidth = 2; context.stroke();
    }
  }
  function positionLabels() {
    // The overview keeps its full, accessible position list beside the map.
    // At street scale, labels can extend over the neutral canvas background;
    // country clipping still applies to the actual coordinate and accuracy.
    if (zoom <= 6 || width < 48 || height < 32) return;
    const occupied = [], inset = 8, boxHeight = 24;
    const textLimit = Math.min(220, width - inset * 2 - 12);
    context.font = '12px Arial, sans-serif'; context.textBaseline = 'middle'; context.textAlign = 'left';
    for (const position of snapshot.positions ?? []) {
      if (!validPoint(position) || typeof position.label !== 'string' || !position.label) continue;
      const p = screen(position);
      if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) continue;
      let label = position.label;
      if (context.measureText(label).width > textLimit) {
        while (label.length && context.measureText(label + '…').width > textLimit) label = label.slice(0, -1);
        label += '…';
      }
      const boxWidth = context.measureText(label).width + 12;
      const candidates = [
        {x: p.x + 12, y: p.y - boxHeight / 2},
        {x: p.x - boxWidth - 12, y: p.y - boxHeight / 2},
        {x: p.x - boxWidth / 2, y: p.y + 12},
        {x: p.x - boxWidth / 2, y: p.y - boxHeight - 12},
      ];
      let placed;
      for (const candidate of candidates) {
        const box = {x: clamp(candidate.x, inset, width - boxWidth - inset),
          y: clamp(candidate.y, inset, height - boxHeight - inset), width: boxWidth, height: boxHeight};
        if (!occupied.some(other => box.x < other.x + other.width + 4 && box.x + box.width + 4 > other.x
          && box.y < other.y + other.height + 4 && box.y + box.height + 4 > other.y)) { placed = box; break; }
      }
      if (!placed) continue;
      occupied.push(placed);
      context.fillStyle = '#fffdf5ed'; context.fillRect(placed.x, placed.y, boxWidth, boxHeight);
      context.fillStyle = '#293c2c'; context.fillText(label, placed.x + 6, placed.y + boxHeight / 2);
    }
  }
  function draw() {
    if (closed || !width || !height) return;
    if (needsFit && snapshot.countries.length) fit();
    clearSurface();
    if (!snapshot.countries.length) {
      context.fillStyle = '#68735f'; context.font = '14px Arial, sans-serif'; context.textAlign = 'center';
      context.fillText('No enabled countries', width / 2, height / 2); context.textAlign = 'left'; report('empty'); return;
    }
    context.save(); countryTransform(); context.clip(coveragePath, 'nonzero');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#f5f4ed'; context.fillRect(0, 0, width, height);
    if (source) tiles(); else wanted = new Set();
    overlays();
    countryTransform(); context.strokeStyle = '#87917d';
    context.lineWidth = 1 / 2 ** zoom; context.stroke(coverageBoundaryPath); context.restore();
    positionLabels();
    const pending = [...wanted].some(key => !['loaded', 'failed'].includes(cache.get(key)?.state));
    const failed = [...wanted].some(key => cache.get(key)?.state === 'failed');
    report(!source ? 'outline' : pending ? 'loading' : failed ? 'partial' : 'ready');
  }
  function refresh() {
    if (closed) return;
    const value = controller.snapshot(), nextSource = controller.tileSource();
    const countries = value.countries ?? [];
    const changedCountries = !snapshot || countries.length !== snapshot.countries.length
      || countries.some((country, index) => country.code !== snapshot.countries[index].code
        || country.geometry !== snapshot.countries[index].geometry
        || country.draw_boundary !== snapshot.countries[index].draw_boundary);
    if (changedCountries || nextSource !== source) {
      clearTiles(); clearSurface(); // Old coordinates and tiles disappear synchronously.
    }
    snapshot = {countries: [...countries], positions: value.positions ?? [], routes: value.routes ?? []};
    source = nextSource;
    if (changedCountries) {
      rebuildCoverage(); needsFit = true;
      for (const id of pointers.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      pointers.clear(); gesture = null; canvas.classList.remove('map-dragging');
    }
    const range = limits(); zoom = clamp(zoom, range.min, range.max);
    // Overlays are also cleared for ordinary updates, so stale positions never
    // remain visible until an asynchronous tile download or rendering callback.
    clearSurface(); schedule();
  }
  function resize() {
    if (closed) return;
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(0, Math.min(8192, rect.width)), nextHeight = Math.max(0, Math.min(8192, rect.height));
    // Cap both density and total backing-store area for unusually large embeds.
    const nextRatio = Math.min(clamp(globalThis.devicePixelRatio || 1, 1, 2),
      Math.sqrt(16777216 / Math.max(1, nextWidth * nextHeight)));
    if (nextWidth === width && nextHeight === height && nextRatio === ratio) return;
    width = nextWidth; height = nextHeight; ratio = nextRatio;
    canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
    clearSurface(); if (needsFit) fit(); schedule();
  }
  function changeZoom(delta, anchor = {x: width / 2, y: height / 2}) {
    if (closed || !snapshot.countries.length) return;
    const range = limits(), next = clamp(zoom + delta, range.min, range.max);
    if (next === zoom) return;
    const c = project(center, zoom), scale = 2 ** (next - zoom);
    zoom = next;
    center = unproject({x: (c.x + anchor.x - width / 2) * scale - anchor.x + width / 2,
      y: (c.y + anchor.y - height / 2) * scale - anchor.y + height / 2}, zoom);
    needsFit = false; constrainCenter(); schedule();
  }
  function pan(x, y) {
    if (!snapshot.countries.length) return;
    const p = project(center, zoom); center = unproject({x: p.x - x, y: p.y - y}, zoom);
    needsFit = false; constrainCenter(); schedule();
  }
  function focus(position, requestedZoom = 12) {
    if (closed || !Number.isFinite(requestedZoom)) return false;
    try {
      if (!snapshot.countries.some(country => containsPosition(country.geometry, position))) return false;
    } catch { return false; }
    const range = limits(); center = {latitude: position.latitude, longitude: position.longitude};
    zoom = clamp(Math.round(requestedZoom), range.min, range.max); needsFit = false; schedule(); return true;
  }
  function pointOf(event) {
    const rect = canvas.getBoundingClientRect(); return {x: event.clientX - rect.left, y: event.clientY - rect.top};
  }
  function currentGesture() {
    const values = [...pointers.values()];
    if (!values.length) return null;
    if (values.length === 1) return {x: values[0].x, y: values[0].y, distance: 0};
    return {x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2,
      distance: Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y)};
  }
  listen(canvas, 'pointerdown', event => {
    if (event.button !== 0 || pointers.size >= 2) return;
    canvas.focus({preventScroll: true}); pointers.set(event.pointerId, pointOf(event)); gesture = currentGesture();
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('map-dragging'); event.preventDefault();
  });
  listen(canvas, 'pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, pointOf(event)); const next = currentGesture();
    if (gesture && next) {
      pan(next.x - gesture.x, next.y - gesture.y);
      if (next.distance && gesture.distance) {
        const scale = next.distance / gesture.distance;
        if (scale > 1.3 || scale < 1 / 1.3) { changeZoom(scale > 1 ? 1 : -1, next); gesture = next; }
        else gesture = {...next, distance: gesture.distance};
      } else gesture = next;
    }
    event.preventDefault();
  });
  const endPointer = event => {
    pointers.delete(event.pointerId); gesture = currentGesture();
    if (!pointers.size) canvas.classList.remove('map-dragging');
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, type, endPointer);
  listen(canvas, 'wheel', event => {
    if ((!event.ctrlKey && document.activeElement !== canvas) || !event.deltaY) return;
    event.preventDefault(); changeZoom(event.deltaY < 0 ? 1 : -1, pointOf(event));
  }, {passive: false});
  listen(canvas, 'keydown', event => {
    const amount = event.shiftKey ? 160 : 80;
    if (['+', '='].includes(event.key)) changeZoom(1);
    else if (event.key === '-') changeZoom(-1);
    else if (event.key === 'Home') fit();
    else if (event.key === 'ArrowLeft') pan(amount, 0);
    else if (event.key === 'ArrowRight') pan(-amount, 0);
    else if (event.key === 'ArrowUp') pan(0, amount);
    else if (event.key === 'ArrowDown') pan(0, -amount);
    else return;
    event.preventDefault();
  });
  listen(document, 'visibilitychange', () => {
    if (document.hidden) {
      for (const [key, tile] of cache) if (['loading', 'queued'].includes(tile.state)) { stopTile(tile); cache.delete(key); }
      queue = [];
    } else { resize(); schedule(); }
  });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas); listen(globalThis, 'resize', resize);
  const unsubscribe = controller.subscribe(refresh);
  refresh(); resize();
  return {fit, focus, zoomIn: () => changeZoom(1), zoomOut: () => changeZoom(-1), destroy() {
    if (closed) return;
    closed = true; unsubscribe?.(); observer?.disconnect();
    for (const remove of listeners) remove();
    for (const id of pointers.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear(); canvas.classList.remove('map-dragging');
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; clearTiles(); clearSurface();
  }};
}

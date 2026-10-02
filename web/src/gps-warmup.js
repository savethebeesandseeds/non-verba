// SPDX-License-Identifier: AGPL-3.0-only
// Foreground receiver preparation only. Native discards every warm-up fix;
// challenge-bound evidence always uses its own collection session.
const EVENT = 'nonverba:gps-warmup';

export function installGpsWarmupUI({root = globalThis.document, events = globalThis.window,
  bridge = globalThis.NativeGpsWarmup, schedule = globalThis.setTimeout,
  unschedule = globalThis.clearTimeout} = {}) {
  const anchor = root?.getElementById('screen-awake');
  if (!anchor || !bridge || ['state', 'prepare', 'stop'].some(name => typeof bridge[name] !== 'function')) return null;
  const mount = root.createElement('div'), button = root.createElement('button'), text = root.createElement('div');
  const status = root.createElement('p'), note = root.createElement('p');
  mount.id = 'gps-warmup'; mount.className = 'screen-awake';
  button.id = 'gps-warmup-toggle'; button.type = 'button'; button.className = 'secondary';
  button.setAttribute('aria-describedby', 'gps-warmup-note');
  status.id = 'gps-warmup-status'; status.setAttribute('role', 'status');
  note.id = 'gps-warmup-note';
  note.textContent = 'GPS prepares on camera/location pages with existing precise permission. Five-minute foreground limit; uses battery. Warm-up fixes are discarded. Each request collects fresh evidence. Stopping warm-up does not cancel a requested measurement.';
  text.append(status, note); mount.append(button, text); anchor.after(mount);
  let active = false, timer = null, disposed = false, hidden = false;
  function refresh() {
    if (disposed || hidden) return;
    if (timer !== null) { unschedule(timer); timer = null; }
    try {
      const raw = bridge.state();
      if (typeof raw !== 'string' || raw.length > 1024) throw Error('Invalid state');
      const value = JSON.parse(raw);
      if (value?.version !== 1 || value.unsigned !== true || typeof value.active !== 'boolean' ||
          !Number.isSafeInteger(value.remaining_ms) || value.remaining_ms < 0 || value.remaining_ms > 300000 ||
          typeof value.reason !== 'string' || value.reason.length > 120 ||
          (value.active ? value.remaining_ms === 0 : value.remaining_ms !== 0)) throw Error('Invalid state');
      active = value.active; button.disabled = false;
      button.textContent = active ? 'Stop GPS warm-up' : 'Prepare GPS';
      button.setAttribute('aria-pressed', String(active));
      status.textContent = active ? `GPS receiver warm-up active — up to ${Math.ceil(value.remaining_ms / 1000)} seconds remaining. This is not a verified fix.`
        : `GPS warm-up off (${value.reason}).`;
    } catch {
      active = false; button.disabled = true; button.textContent = 'Prepare GPS';
      button.setAttribute('aria-pressed', 'false'); status.textContent = 'GPS warm-up status unavailable.';
    }
  }
  function toggle() {
    if (disposed || hidden || button.disabled) return;
    button.disabled = true;
    // Events only prompt a bridge read; event payloads never establish state.
    timer = schedule(refresh, 2000);
    try { if (active) bridge.stop(); else bridge.prepare(); }
    catch { refresh(); }
  }
  function leave() {
    hidden = true;
    if (timer !== null) { unschedule(timer); timer = null; }
    active = false; button.disabled = true; button.setAttribute('aria-pressed', 'false');
    status.textContent = 'GPS warm-up status will refresh when this page is visible.';
  }
  function enter() { hidden = false; refresh(); }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer !== null) unschedule(timer);
    button.removeEventListener('click', toggle); events?.removeEventListener(EVENT, refresh);
    events?.removeEventListener('pageshow', enter); events?.removeEventListener('pagehide', leave);
  }
  button.addEventListener('click', toggle); events?.addEventListener(EVENT, refresh);
  events?.addEventListener('pageshow', enter); events?.addEventListener('pagehide', leave);
  refresh();
  return {refresh, dispose};
}
if (globalThis.document) installGpsWarmupUI();

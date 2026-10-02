// SPDX-License-Identifier: AGPL-3.0-only
// Foreground Android screen preference only; independent of every sensor workflow.
// Native owns a bounded opt-in lease across restarts. There is no browser wake lock.
const EVENT = 'nonverba:screen-awake';
const UPDATE_TIMEOUT_MS = 2000;

function readState(bridge) {
  const raw = bridge.state();
  if (typeof raw !== 'string' || raw.length > 256) throw new Error('Invalid screen state');
  const state = JSON.parse(raw);
  if (!state || state.version !== 1 || typeof state.enabled !== 'boolean' ||
      typeof state.active !== 'boolean' || (state.active && !state.enabled)) {
    throw new Error('Invalid screen state');
  }
  if ('expires_at_ms' in state || 'remaining_ms' in state) {
    if (!Number.isSafeInteger(state.remaining_ms) || state.remaining_ms < 0 || state.remaining_ms > 7200000 ||
        (state.enabled ? (!Number.isSafeInteger(state.expires_at_ms) || state.expires_at_ms <= 0 ||
          !Number.isFinite(new Date(state.expires_at_ms).getTime()) || state.remaining_ms === 0) :
          (state.expires_at_ms !== null || state.remaining_ms !== 0))) throw new Error('Invalid screen lease');
  }
  return state;
}

export function installScreenAwakeUI({
  root = globalThis.document,
  events = globalThis.window,
  bridge = globalThis.NativeScreenAwake,
  schedule = globalThis.setTimeout,
  unschedule = globalThis.clearTimeout,
} = {}) {
  const mount = root?.getElementById('screen-awake');
  const button = root?.getElementById('screen-awake-toggle');
  const status = root?.getElementById('screen-awake-status');
  if (!mount || !button || !status || !bridge ||
      typeof bridge.state !== 'function' || typeof bridge.setEnabled !== 'function') return null;
  let last = null, pending = null, timer = null, disposed = false;
  mount.hidden = false;
  const note = root.getElementById('screen-awake-note');
  if (note) note.textContent = 'Temporary two-hour session, retained across app restarts and updates. Off cancels it. Android lock settings stay unchanged.';

  function clearPending() {
    if (timer !== null) unschedule(timer);
    timer = null;
    pending = null;
  }
  function render(message) {
    button.disabled = last === null || pending !== null;
    button.setAttribute('aria-pressed', String(last?.enabled ?? false));
    const expiry = last?.enabled && last.expires_at_ms ? ' Session ends at ' + new Date(last.expires_at_ms).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) + '.' : '';
    status.textContent = message ?? (pending !== null ? 'Updating screen setting…' :
      last?.enabled ? (last.active ? 'On — screen stays awake while Non-verba is open.' :
        'On — waiting for Non-verba to return to the foreground.') + expiry : 'Off — normal screen timeout.');
  }
  function refresh() {
    if (disposed) return false;
    try {
      // Read the bridge, not the event payload: events only signal a state change.
      last = readState(bridge);
      if (pending !== null && last.enabled === pending) clearPending();
      render();
      return true;
    } catch {
      last = null;
      clearPending();
      render('Screen setting unavailable. Reopen Non-verba to reset it.');
      return false;
    }
  }
  function toggle() {
    if (disposed || pending !== null || !refresh()) return;
    pending = !last.enabled;
    render();
    timer = schedule(() => {
      timer = null;
      if (disposed || pending === null) return;
      const requested = pending;
      if (!refresh()) return;
      if (last.enabled !== requested) {
        clearPending();
        render('The screen setting did not change. Try again.');
      }
    }, UPDATE_TIMEOUT_MS);
    try { bridge.setEnabled(pending); }
    catch {
      clearPending();
      if (refresh()) render('The screen setting could not be changed. Try again.');
    }
  }
  function leave() {
    clearPending();
    render();
    // Native onPause clears the actual window flag. Navigation must not reset
    // the session preference or alter any evidence-session lifecycle handler.
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearPending();
    button.removeEventListener('click', toggle);
    events?.removeEventListener(EVENT, refresh);
    events?.removeEventListener('pageshow', refresh);
    events?.removeEventListener('pagehide', leave);
    root.removeEventListener('visibilitychange', refresh);
  }
  button.addEventListener('click', toggle);
  events?.addEventListener(EVENT, refresh);
  events?.addEventListener('pageshow', refresh);
  events?.addEventListener('pagehide', leave);
  root.addEventListener('visibilitychange', refresh);
  refresh();
  return {refresh, dispose};
}

if (globalThis.document) installScreenAwakeUI();

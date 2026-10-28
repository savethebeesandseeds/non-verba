// SPDX-License-Identifier: AGPL-3.0-only
// Drafts stay in this document's memory.
const routes = Object.freeze([
  'home', 'requests', 'operations', 'operations/new', 'operations/review', 'services/api', 'services/docs', 'identity/setup',
  'account/create', 'account/terms', 'account/sign-in', 'account/confirm', 'account/recover', 'account/ready', 'account/delete', 'account/delete-retention', 'account/devices',
  'identity/document', 'identity/face', 'identity/review', 'identity/notice', 'identity/status', 'reviewer/cases',
  'requester', 'requester/review', 'requester/agreement', 'requester/progress', 'requester/result',
  'operator', 'operator/work', 'operator/offer', 'operator/review',
  'operator/agreement', 'operator/progress', 'operator/result'
]);
export {routes as PARTICIPANT_VIEWS};

export function createWorkspace() {
  return {
    request: { title: '', description: '', place: '', budget: '' },
    operation: { title: '', description: '' },
    offer: { message: '', price: '' },
    lastRoutes: { requester: 'requester', operator: 'operator' }
  };
}

export function parseView(view) {
  return routes.includes(view) ? view : 'home';
}

// The current validated account contract reports identity verification pending.
// No verified eligibility DTO exists yet; local readiness, photos or device
// proofs must never manufacture authority for either workflow family.
export function workflowAccess(view, accountState = null) {
  if (!routes.includes(view)) return {allowed:false,required:null,redirect:'home',reason:'This screen is unavailable.'};
  const required = view === 'requester' || view.startsWith('requester/') ? 'basic'
    : ['operations/new','operations/review','operator/offer','operator/review','operator/agreement','operator/progress','operator/result'].includes(view) ? 'advanced' : null;
  const prerequisite = accountState?.state === 'signed_in' ? accountState.identity_status?.prerequisites?.[required === 'basic' ? 'requests' : 'operations'] : null;
  const statusReason = typeof prerequisite?.reason === 'string' && prerequisite.reason.length <= 240 ? prerequisite.reason : '';
  const reason = required ? statusReason || (accountState?.state === 'signed_in' ? '' : 'Sign in and ')
    + (required === 'basic' ? 'start Level 1 identity before creating a request.'
      : 'start Level 2 identity before creating or accepting an operation.') : '';
  return {allowed:required === null,required,redirect:required === 'basic' ? 'requests' : required === 'advanced' ? 'operations' : view,
    reason:reason ? reason[0].toUpperCase()+reason.slice(1) : ''};
}

// One shared header control for every participant view and platform. Its
// destination policy stays with the caller's existing navigation handler.
export function mountBackControl(document, onBack) {
  const container = document.getElementById('view-navigation');
  if (!container || typeof onBack !== 'function') throw new Error('Shared view navigation and a Back action are required.');
  const button = document.createElement('button');
  button.id = 'view-back'; button.className = 'back'; button.setAttribute('type', 'button'); button.hidden = true;
  const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '← ';
  const label = document.createElement('span'); label.textContent = 'Back';
  button.append(arrow, label); button.addEventListener('click', onBack);
  container.replaceChildren(button); return button;
}

function describe(control, id, enabled) {
  const ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(value => value && value !== id);
  if (enabled) ids.push(id);
  if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
  else control.removeAttribute('aria-describedby');
}

const statusByRoot = new WeakMap();
const statusKinds = Object.freeze(['error', 'warning', 'pending', 'unknown', 'notification', 'success', 'info']);
const issueKinds = statusKinds.slice(0, 4);
const statusSymbols = Object.freeze({error:'status-error', warning:'warning', notification:'bell',
  pending:'status-pending', unknown:'status-unknown', success:'status-success', info:'status-info'});
const statusId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(value);
let statusDescriptionId = 0;
function statusState(root) {
  if (!root || typeof root.querySelectorAll !== 'function') throw new Error('A status document or element is required.');
  let state = statusByRoot.get(root);
  if (!state) { state = {producers:new Map(), descriptions:new Map()}; statusByRoot.set(root, state); }
  return state;
}
function statusRecord(value) {
  if (!value || !statusId(value.id) || !statusId(value.owner) || !statusKinds.includes(value.kind)
    || typeof value.message !== 'string' || !value.message.trim() || value.message.length > 500
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.message)) return null;
  return Object.freeze({id:value.id, owner:value.owner, kind:value.kind, message:value.message.trim()});
}
function statusSummary(records) {
  const active = records.filter(record => issueKinds.includes(record.kind) || record.kind === 'notification')
    .sort((a,b) => statusKinds.indexOf(a.kind) - statusKinds.indexOf(b.kind) || a.id.localeCompare(b.id));
  const issue = issueKinds.find(kind => active.some(record => record.kind === kind));
  return {kinds:[...(issue ? [issue] : []), ...(active.some(record => record.kind === 'notification') ? ['notification'] : [])],
    messages:[...new Set(active.map(record => record.message))]};
}

// Owners follow the declared DOM tree.
export function reduceStatuses(nodes = [], records = []) {
  const tree = new Map(), invalid = new Set();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || !statusId(node.id) || node.parent != null && !statusId(node.parent)) continue;
    if (tree.has(node.id)) invalid.add(node.id);
    else tree.set(node.id, {id:node.id, parent:node.parent ?? null});
  }
  const paths = new Map();
  for (const id of tree.keys()) {
    const path = [], seen = new Set(); let next = id;
    while (next !== null) {
      if (seen.has(next) || invalid.has(next) || !tree.has(next)) { path.length = 0; break; }
      seen.add(next); path.push(next); next = tree.get(next).parent;
    }
    if (path.length) paths.set(id, path);
  }
  const sources = new Map(), collisions = new Set();
  for (const input of Array.isArray(records) ? records : []) {
    const record = statusRecord(input);
    if (!record || !paths.has(record.owner) || collisions.has(record.id)) continue;
    const previous = sources.get(record.id);
    if (previous && (previous.owner !== record.owner || previous.kind !== record.kind || previous.message !== record.message)) {
      sources.delete(record.id); collisions.add(record.id);
    } else sources.set(record.id, record);
  }
  const collected = new Map([...paths.keys()].map(id => [id, []]));
  for (const record of sources.values()) for (const id of paths.get(record.owner)) collected.get(id).push(record);
  return {sources, summaries:new Map([...collected].map(([id, values]) => [id, statusSummary(values)]))};
}

export function setStatusSources(root, namespace, records) {
  const state = statusState(root);
  if (statusId(namespace)) state.producers.set(namespace,
    (Array.isArray(records) ? records : []).map(statusRecord).filter(Boolean));
  return renderStatuses(root);
}

export function renderStatuses(root) {
  const state = statusState(root), document = root.ownerDocument || root;
  const nodes = [...root.querySelectorAll('[data-status-node]')].map(node =>
    ({id:node.getAttribute('data-status-node'), parent:node.getAttribute('data-status-parent')}));
  if (root.matches?.('[data-status-node]')) nodes.push({id:root.getAttribute('data-status-node'), parent:root.getAttribute('data-status-parent')});
  const model = reduceStatuses(nodes, [...state.producers.values()].flat());
  const hosts = [...root.querySelectorAll('.status-icons[data-status-source], .status-icons[data-status-summary]')];
  if (root.matches?.('.status-icons[data-status-source], .status-icons[data-status-summary]')) hosts.push(root);
  for (const [host, value] of state.descriptions) if (!hosts.includes(host)) {
    if (value.control) describe(value.control, value.element.id, false);
    value.element.remove(); state.descriptions.delete(host);
  }
  for (const host of hosts) {
    const sourceId = host.getAttribute('data-status-source'), summaryId = host.getAttribute('data-status-summary');
    const record = sourceId !== null && summaryId === null ? model.sources.get(sourceId) : null;
    const value = summaryId !== null && sourceId === null ? model.summaries.get(summaryId) : record
      ? {kinds:[record.kind], messages:[record.message]} : null;
    const control = host.closest('button, a, input, select, textarea, [role="button"], [role="link"]') || host.parentElement;
    let description = state.descriptions.get(host);
    if (!description) {
      const element = document.createElement('span');
      do { element.id = 'nonverba-status-description-' + (++statusDescriptionId); } while (document.getElementById(element.id));
      element.hidden = true; element.className = 'status-description'; host.after(element);
      description = {element, control:null}; state.descriptions.set(host, description);
    }
    if (description.control && description.control !== control) describe(description.control, description.element.id, false);
    description.control = control;
    const message = value?.messages.join(' ') || '';
    if (description.element.textContent !== message) description.element.textContent = message;
    if (control) describe(control, description.element.id, Boolean(description.element.textContent));
    const signature = JSON.stringify([value?.kinds || [], host.hasAttribute('data-status-dot')]);
    if (description.icons !== signature) {
      description.icons = signature;
      host.replaceChildren(); host.setAttribute('aria-hidden', 'true');
      for (const kind of value?.kinds || []) {
        if (kind === 'notification' && host.hasAttribute('data-status-dot')) {
          const dot = document.createElement('span'); dot.className = 'status-dot'; dot.dataset.statusKind = kind; host.append(dot); continue;
        }
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'status-icon'); icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
        icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('fill', 'none'); icon.dataset.statusKind = kind;
        const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'use'); symbol.setAttribute('href', '#' + statusSymbols[kind]);
        icon.append(symbol); host.append(icon);
      }
    }
    const disclosure = host.getAttribute('data-status-disclosure');
    const expanded = statusId(disclosure) && document.getElementById(disclosure)?.getAttribute('aria-expanded') === 'true';
    host.hidden = !value?.kinds.length || expanded;
  }
  return model;
}

// Display readiness only; this does not grant posting or operation permissions.
export function renderRoleSetup(root, ready = {}, signedIn = false, prerequisites = {}) {
  const records = [];
  for (const kind of ['requests', 'operations']) {
    const complete = ready?.[kind] === true, link = root.querySelector(`#${kind}-setup-link`);
    const prerequisite = prerequisites[kind], status = prerequisite?.status;
    const awaiting = status === 'awaiting_approval', waitingForLevelOne = kind === 'operations' && status === 'awaiting_prerequisite';
    if (link) {
      link.hidden = !signedIn || complete;
      link.disabled = waitingForLevelOne;
      link.dataset.navigate = awaiting ? 'identity/status' : 'identity/setup';
      const label = root.querySelector(`#${kind}-setup-label`);
      if (label) label.textContent = waitingForLevelOne ? 'Start Level 1 identity first'
        : awaiting ? 'Awaiting review' : ['checking','unknown'].includes(status) ? 'Check identity status'
        : kind === 'requests' ? 'Start Level 1 identity' : 'Start Level 1 identity first';
    }
    if (signedIn && !complete) records.push({id:`identity-${kind}`, owner:kind,
      kind:status === 'awaiting_approval' ? 'pending' : ['checking','unknown'].includes(status) ? 'unknown' : 'warning',
      message:prerequisite?.reason || (kind === 'requests'
        ? 'Start Level 1 identity before posting requests.' : 'Start Level 2 identity before accepting operations.')});
  }
  return setStatusSources(root, 'role-setup', records);
}

// Reading never acknowledges; only producer input changes notifications.
const attentionByRoot = new WeakMap();
export function renderAttention(root, attention = attentionByRoot.get(root) || {}) {
  const state = {}, records = new Map();
  for (const kind of ['requests', 'operations']) {
    state[kind] = Array.isArray(attention?.[kind])
      ? [...new Set(attention[kind].filter(statusId))] : [];
    const ids = new Set(state[kind]);
    for (const item of root.querySelectorAll(`[data-attention-kind="${kind}"]`)) {
      const row = item.closest('li'), id = item.dataset.attentionItem;
      if (row && !row.hidden && ids.has(id)) {
        const source = `attention-${kind}-${id}`;
        records.set(source, {id:source, owner:kind, kind:'notification', message:kind === 'requests'
          ? 'This request requires attention.' : 'This operation requires attention.'});
      }
    }
  }
  attentionByRoot.set(root, state);
  return setStatusSources(root, 'attention', [...records.values()]);
}
function textField(draft, field) {
  return typeof draft?.[field] === 'string' ? draft[field].trim() : '';
}

function validateFields(draft, fields) {
  const errors = [];
  for (const [field, label, limit, required] of fields) {
    const value = textField(draft, field);
    if (required && !value) errors.push({ field, message: `Add ${label}.` });
    else if (value.length > limit) errors.push({ field, message: `Keep ${label} to ${limit} characters or fewer.` });
  }
  return { valid: errors.length === 0, errors };
}

export function validateRequest(draft) {
  return validateFields(draft, [
    ['title', 'a short title', 80, true],
    ['description', 'a description of the work', 1000, true],
    ['place', 'the place', 120, false],
    ['budget', 'the budget', 60, false]
  ]);
}

export function validateOffer(draft) {
  return validateFields(draft, [
    ['message', 'your example offer', 1000, true],
    ['price', 'your price', 60, false]
  ]);
}

export function validateOperation(draft) {
  return validateFields(draft, [
    ['title', 'a name', 80, true],
    ['description', 'a description', 1000, true]
  ]);
}

const workspaceModes = {
  requester:{mark:'branding/home-succulent.webp', next:'operator', label:'Switch to Operator', name:'Requester mode', hint:'Requester'},
  operator:{mark:'branding/home-sprout.webp', next:'requester', label:'Switch to Requester', name:'Operator mode', hint:'Operator'}
};
function storedWorkspaceMode() {
  try {
    const value = localStorage.getItem('nonverba-mode');
    return value === 'requester' || value === 'operator' ? value : '';
  } catch { return ''; }
}
function activeWorkspaceMode() {
  return storedWorkspaceMode() || 'requester';
}
function rememberWorkspaceMode(mode) {
  try { localStorage.setItem('nonverba-mode', mode); } catch {}
}
function routeWorkspaceMode(route) {
  const role = String(route || '').split('/')[0];
  return role === 'requester' || route === 'requests' ? 'requester'
    : role === 'operator' || role === 'operations' ? 'operator' : '';
}
function paintWorkspaceMode() {
  if (typeof document === 'undefined' || !document.documentElement || typeof document.getElementById !== 'function' || typeof document.querySelectorAll !== 'function') return;
  const mode = activeWorkspaceMode();
  const choice = workspaceModes[mode];
  const destination = workspaceModes[choice.next];
  for (const [id, src] of [['brand-mark', choice.mark], ['home-logo', choice.mark], ['mode-from', choice.mark], ['dashboard-mode-mark', destination.mark], ['mode-to', destination.mark]]) {
    const image = document.getElementById(id);
    if (image && image.getAttribute('src') !== src) image.setAttribute('src', src);
  }
  document.getElementById('mode-switch')?.setAttribute('aria-label', choice.label);
  const homeHint = document.getElementById('home-mode-hint');
  if (homeHint && homeHint.textContent !== choice.hint) homeHint.textContent = choice.hint;
  const dashboardSwitch = document.getElementById('dashboard-mode-switch');
  const dashboardName = document.getElementById('dashboard-mode-name');
  const confirmTitle = document.getElementById('mode-confirm-title');
  const changeLabel = 'Change to ' + destination.name;
  if (dashboardSwitch && dashboardSwitch.getAttribute('aria-label') !== changeLabel) dashboardSwitch.setAttribute('aria-label', changeLabel);
  if (dashboardName && dashboardName.textContent !== changeLabel) dashboardName.textContent = changeLabel;
  if (confirmTitle && confirmTitle.textContent !== changeLabel + '?') confirmTitle.textContent = changeLabel + '?';
  const focusId = mode === 'operator' ? 'operations-list-link' : 'requests-list-link';
  for (const id of ['requests-list-link', 'operations-list-link']) {
    const button = document.getElementById(id);
    if (!button) continue;
    if (id === focusId) button.setAttribute('autofocus', '');
    else button.removeAttribute('autofocus');
  }
  for (const section of document.querySelectorAll('[data-workspace-mode]')) section.hidden = section.dataset.workspaceMode !== mode;
}

async function startPreview() {
  const {startOnboarding, ONBOARDING_VIEWS} = await import('./onboarding-ui.js');
  const $ = (selector) => document.querySelector(selector);
  const workspace = createWorkspace();
  let currentRoute = '';
  let modeMotion = false;
  let currentPanel = null;
  let afterPanelClose = null;
  let workflowAccountState = null;
  let homeArrivalPending = true, homeAttentionTimer = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function stopHomeArrival() {
    window.clearTimeout(homeAttentionTimer); homeAttentionTimer = null;
    document.body.dataset.homeAttention = 'off';
    delete document.body.dataset.homeAttentionTarget;
  }
  function startHomeArrival() {
    stopHomeArrival();
    if (!homeArrivalPending || currentRoute !== 'home' || currentPanel || document.hidden) return;
    homeArrivalPending = false;
    if (reducedMotion.matches) return;
    document.body.dataset.homeAttentionTarget = workflowAccountState?.state === 'signed_in' ? 'navigation' : 'options';
    document.body.dataset.homeAttention = 'character';
    homeAttentionTimer = window.setTimeout(stopHomeArrival,6500);
  }
  $('#home-logo').addEventListener('animationend',event => {
    if (event.animationName === 'home-arrive' && document.body.dataset.homeAttention === 'character'
      && currentRoute === 'home' && !currentPanel && !document.hidden && !reducedMotion.matches) {
      document.body.dataset.homeAttention = 'menu';
    }
  });
  for (const selector of ['#navigation-toggle','#options-toggle']) {
    $(selector).addEventListener('animationend',event => {
      if (event.animationName === 'menu-arrival-pulse') stopHomeArrival();
    });
    $(selector).addEventListener('focus',stopHomeArrival);
  }
  document.addEventListener('visibilitychange',() => {
    if (document.hidden) stopHomeArrival(); else if (homeArrivalPending) startHomeArrival();
  });
  window.addEventListener('pagehide',stopHomeArrival);
  reducedMotion.addEventListener('change',() => { if (reducedMotion.matches) stopHomeArrival(); });
  const documentUrl = location.pathname;
  const panels = {
    navigation: {dialog: $('#navigation-panel'), toggle: $('#navigation-toggle')},
    options: {dialog: $('#options-panel'), toggle: $('#options-toggle')}
  };
  mountBackControl(document, onBack);
  const onboarding = startOnboarding(document, {setStatusSources:(namespace, records) => setStatusSources(document, namespace, records),
    closeTerms: onBack, closeIdentityNotice: onBack, closeRetention: onBack,
    workflowAccess,
    onAccountState: state => {
      const previous = workflowAccountState;
      workflowAccountState = state;
      if (previous?.state !== 'signed_in' && state.state === 'signed_in') {
        homeArrivalPending = true;
        if (currentRoute === 'home') startHomeArrival();
      } else if (previous?.state === 'signed_in' && state.state !== 'signed_in') stopHomeArrival();
      if (!currentRoute) return;
      if (previous?.state === 'signed_in' && (state.state !== 'signed_in'
        || ['email','username','recovery_generation'].some(field => previous[field] !== state[field]))) clearWorkflowDrafts();
      refreshWorkflowControls();
      applyWorkspaceMode();
      const access = workflowAccess(currentRoute,workflowAccountState);
      if (!access.allowed) redirectWorkflow(access.redirect);
    },
    setRoleSetup: (signedIn, prerequisites) => renderRoleSetup(document, {}, signedIn, prerequisites),
    setHeading: (title, description, view) => {
      if (view !== currentRoute) return;
      $('#view-title').textContent = title; $('#workspace').setAttribute('aria-label',title);
      $('#view-description').textContent = description; $('#view-description').hidden = !description;
    },
    enterEmailStep: (step = 'code') => {
      if (currentRoute === 'account/sign-in' && history.state?.nonverbaEmailStep !== step)
        history.pushState({...routeState(localIndex()+1),nonverbaEmailStep:step},'',documentUrl);
    },
    navigate: (route, replace = false) => new Promise(resolve => {
    const finish = () => { navigate(route, replace); resolve(); };
    if (currentPanel) closePanel(finish);
    else finish();
  })});
  const navigationLists = ['requests', 'operations'].map(name => ({
    toggle: $(`#${name}-list-link`), content: $(`#navigation-${name}`)
  }));
  function showList({toggle, content}, open) {
    content.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    renderStatuses(document);
  }
  for (const list of navigationLists) {
    list.toggle.addEventListener('click', () => showList(list, list.content.hidden));
  }
  // This page-only demo never calls the key service or creates a credential.
  const keyOptions = $('#api-key-options'), keyResult = $('#api-key-result');
  const keyName = $('#api-key-name'), keyRows = $('#api-key-inventory tbody');
  const keyValue = $('#api-key-value'), keyCopy = $('#api-key-copy'), keyCopyStatus = $('#api-key-copy-status');
  let keyCopyEpoch = 0, keyCopyBusy = false;
  const keyAccess = {read: 'Read only', write: 'Read and write'};
  const keyExpiry = {'1': '24 hours', '7': '7 days', '30': '30 days', '90': '90 days', '365': '365 days', never: 'Never expires'};
  function clearKeyResult() {
    keyCopyEpoch++; keyCopyBusy = false; keyCopy.disabled = false;
    keyCopyStatus.textContent = ''; keyCopyStatus.hidden = true;
    keyValue.value = '';
    $('#api-key-result-summary').textContent = '';
    keyResult.hidden = true;
  }
  function showKeyOptions(open) {
    clearKeyResult();
    keyOptions.hidden = !open;
    $('#api-key-add').setAttribute('aria-expanded', String(open));
  }
  $('#api-key-add').addEventListener('click', () => {
    showKeyOptions(keyOptions.hidden);
    if (!keyOptions.hidden) keyName.focus();
  });
  keyName.addEventListener('input', () => keyName.setCustomValidity(''));
  $('#api-key-done').addEventListener('click', () => {
    clearKeyResult();
    $('#api-key-add').focus();
  });
  for (const event of ['focus','click']) keyValue.addEventListener(event, () => keyValue.select());
  $('#api-key-copy').addEventListener('click', async () => {
    const value = keyValue.value;
    if (keyCopyBusy || !value || keyResult.hidden || currentRoute !== 'services/api') return;
    const captured = keyCopyEpoch;
    keyCopyBusy = true; keyCopy.disabled = true; keyCopyStatus.textContent = ''; keyCopyStatus.hidden = true;
    const current = () => captured === keyCopyEpoch && currentRoute === 'services/api'
      && !currentPanel && !keyResult.hidden && keyValue.value === value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      if (current()) { keyCopyStatus.textContent = 'Copied.'; keyCopyStatus.hidden = false; }
    } catch {
      if (current()) {
        keyValue.focus(); keyValue.select();
        keyCopyStatus.textContent = 'Select and copy the key.'; keyCopyStatus.hidden = false;
      }
    } finally {
      if (captured === keyCopyEpoch) { keyCopyBusy = false; keyCopy.disabled = false; }
    }
  });
  window.addEventListener('pagehide', clearKeyResult);
  keyOptions.addEventListener('submit', event => {
    event.preventDefault();
    const name = keyName.value.trim(), access = $('#api-key-permissions').value;
    const expiry = $('#api-key-expiry').value;
    keyName.setCustomValidity(name ? '' : 'Enter a key name.');
    if (!keyOptions.reportValidity() || !Object.hasOwn(keyAccess, access) || !Object.hasOwn(keyExpiry, expiry)) return;
    const demo = 'nv-' + crypto.randomUUID().replaceAll('-', '');
    const row = document.createElement('tr');
    row.dataset.demoKey = '';
    row.title = keyExpiry[expiry];
    for (const value of [name, demo.slice(0, 13) + '…', keyAccess[access], new Date().toLocaleDateString(), 'Never']) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const expires = document.createElement('small');
    expires.className = 'key-expiry'; expires.textContent = keyExpiry[expiry]; row.children[2].append(expires);
    const marker = document.createElement('span');
    marker.className = 'tag'; marker.textContent = 'Demo'; row.firstElementChild.append(marker);
    const action = document.createElement('td'), revoke = document.createElement('button');
    revoke.type = 'button'; revoke.className = 'text-link'; revoke.textContent = 'Revoke';
    revoke.setAttribute('aria-label', 'Revoke demo key ' + name);
    revoke.addEventListener('click', () => {
      row.remove(); clearKeyResult();
      if (!keyRows.children.length) {
        const empty = keyRows.insertRow().insertCell(); empty.colSpan = 6; empty.textContent = 'Unavailable';
      }
      $('#api-key-add').focus();
    });
    action.append(revoke); row.append(action);
    keyRows.querySelector('td[colspan]')?.parentElement.remove(); keyRows.append(row);
    showKeyOptions(false); keyOptions.reset(); keyName.setCustomValidity('');
    keyValue.value = demo;
    $('#api-key-result-summary').textContent = keyAccess[access] + ' · ' + keyExpiry[expiry];
    keyResult.hidden = false;
    keyValue.focus();
  });
  const requestFields = ['title', 'description', 'place', 'budget'];
  const offerFields = ['message', 'price'];
  const operationFields = ['title', 'description'];
  const draftFields = {request:requestFields, offer:offerFields, operation:operationFields};
  const views = {
    home: ['', 'Home', ''],
    requests: ['', 'Requests', 'Local drafts'],
    operations: ['', 'Operations', 'Local drafts'],
    'services/api': ['Developer services', 'API and MCP keys', ''],
    'services/docs': ['Documentation', 'swagger.platform.non-verba.com', ''],
    ...ONBOARDING_VIEWS,
    'operations/new': ['Operation draft', 'New operation', ''],
    'operations/review': ['Operation draft', 'Review operation', ''],
    requester: ['Request draft', 'New request', 'Describe the work.'],
    'requester/review': ['Your request · Review', 'Does this look right?', 'Check your draft. Nothing has been published or shared.'],
    operator: ['Find work · Preview', 'Work you could do.', 'Explore one made-up request and try writing an offer.'],
    'operator/work': ['Example work · Details', 'Know what is needed.', 'Read the work before deciding what you would offer.'],
    'operator/offer': ['Your offer · Draft', 'How could you help?', 'Try writing an offer for the example work.'],
    'operator/review': ['Your offer · Review', 'Check your offer.', 'This is your draft for the example. Nothing has been sent.'],
    agreement: ['Separate example · Terms', 'A shared understanding.', 'See how the work and its terms could be brought together.'],
    progress: ['Separate example · Progress', 'One clear next step.', 'Explore the steps without starting or agreeing to any work.'],
    result: ['Separate example · Result', 'See what was done.', 'A place for the result, when real work is connected.']
  };
  const fieldHints = { 'request-description': 'request-description-hint', 'offer-message': 'offer-message-hint' };

  function refreshWorkflowControls() {
    for (const [view,id] of [['requester','new-request-prerequisite'],['operations/new','new-operation-prerequisite']]) {
      const access = workflowAccess(view,workflowAccountState), note = $('#'+id);
      if (note) { note.textContent = access.reason; note.hidden = access.allowed; }
    }
    for (const button of document.querySelectorAll('button[data-navigate]')) {
      const access = workflowAccess(button.dataset.navigate,workflowAccountState);
      if (!access.required) continue;
      button.disabled = !access.allowed;
      button.setAttribute('aria-disabled',String(!access.allowed));
      describe(button,access.required === 'basic' ? 'new-request-prerequisite' : 'new-operation-prerequisite',!access.allowed);
    }
    for (const [kind,view] of [['request','requester'],['operation','operations/new'],['offer','operator/offer']]) {
      const access = workflowAccess(view,workflowAccountState);
      for (const control of $('#'+kind+'-form').querySelectorAll('input, textarea, select, button')) {
        control.disabled = !access.allowed;
        describe(control,access.required === 'basic' ? 'new-request-prerequisite' : 'new-operation-prerequisite',!access.allowed);
      }
    }
  }

  function clearWorkflowDrafts() {
    for (const [kind,fields] of Object.entries(draftFields)) {
      for (const field of fields) { workspace[kind][field] = ''; $('#'+kind+'-'+field).value = ''; }
      clearErrors(kind);
    }
    workspace.lastRoutes.requester = 'requester'; workspace.lastRoutes.operator = 'operator';
    updateReviews();
  }

  function redirectWorkflow(destination) {
    if (currentPanel) closePanel(() => navigate(destination,true));
    else navigate(destination,true);
  }

  function requireWorkflowAccess(view) {
    const access = workflowAccess(view,workflowAccountState);
    if (access.allowed) return true;
    refreshWorkflowControls();
    const current = workflowAccess(currentRoute,workflowAccountState);
    if (!current.allowed) redirectWorkflow(current.redirect);
    return false;
  }

  function safeRoute(candidate) {
    const access = workflowAccess(candidate,workflowAccountState);
    if (!access.allowed) return access.redirect;
    if (candidate === 'operations/review' && !validateOperation(workspace.operation).valid) return 'operations/new';
    if (candidate === 'requester/review' && !validateRequest(workspace.request).valid) return 'requester';
    if (candidate === 'operator/review' && !validateOffer(workspace.offer).valid) return 'operator/offer';
    return onboarding.guard(candidate);
  }

  function routeState(index, view = currentRoute) {
    return { nonverbaPreview: true, index, view };
  }

  function localIndex() {
    return history.state?.nonverbaPreview === true && Number.isSafeInteger(history.state.index) && history.state.index >= 0
      ? history.state.index : 0;
  }

  function showPanel(name) {
    if (currentPanel === name) return;
    if (name) stopHomeArrival();
    if (currentPanel) {
      const previous = panels[currentPanel];
      previous.dialog.close();
      previous.toggle.setAttribute('aria-expanded', 'false');
      previous.toggle.focus({preventScroll:true});
    }
    currentPanel = name;
    onboarding.setSettingsOpen(name === 'options');
    document.body.classList.toggle('panel-open', Boolean(name));
    if (name) {
      if (name === 'navigation') {
        for (const list of navigationLists) showList(list, false);
      }
      panels[name].toggle.setAttribute('aria-expanded', 'true');
      panels[name].dialog.showModal();
    }
    renderStatuses(document);
  }

  function closePanel(after = null) {
    if (!currentPanel) return;
    afterPanelClose = after;
    // Android shares this same-document Back history.
    if (history.state?.nonverbaPanel === currentPanel) history.back();
    else {
      showPanel(null);
      afterPanelClose = null;
      after?.();
    }
  }

  for (const [name, {dialog, toggle}] of Object.entries(panels)) {
    toggle.addEventListener('click', () => {
      if (currentPanel) return;
      history.pushState({...routeState(localIndex()), nonverbaPanel:name}, '', documentUrl);
      showPanel(name);
    });
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      closePanel();
    });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not([disabled]), a[href], summary')]
        .filter(control => control.getClientRects().length > 0);
      if (controls.length === 0) {
        event.preventDefault();
        return;
      }
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) closePanel();
    });
  }

  function navigate(route, replace = false) {
    const next = safeRoute(parseView(route));
    if (next === currentRoute && !replace) return;
    const index = localIndex();
    history[replace ? 'replaceState' : 'pushState'](routeState(replace ? index : index + 1, next), '', documentUrl);
    render(next, true);
  }

  function updateReviews() {
    const request = workspace.request;
    $('#request-review-title').textContent = request.title.trim();
    $('#request-review-description').textContent = request.description.trim();
    $('#request-review-place').textContent = request.place.trim() || 'Not added';
    $('#request-review-budget').textContent = request.budget.trim() || 'Not added';
    $('#offer-review-message').textContent = workspace.offer.message.trim();
    $('#offer-review-price').textContent = workspace.offer.price.trim() || 'Not included in this draft';
    $('#operation-review-title').textContent = workspace.operation.title.trim();
    $('#operation-review-description').textContent = workspace.operation.description.trim();
    updateDraftLists();
  }

  function updateDraftLists() {
    for (const kind of ['request', 'operation']) {
      const draft = workspace[kind];
      const hasDraft = Object.values(draft).some(value => value.trim());
      const title = draft.title.trim() || `Untitled ${kind}`;
      for (const [prefix, empty] of [[`navigation-${kind}`, `navigation-${kind}s-empty`],
        [`${kind}-list`, `${kind}s-empty`]]) {
        $(`#${prefix}-row`).hidden = !hasDraft;
        $(`#${prefix}-title`).textContent = title;
        $(`#${empty}`).hidden = hasDraft;
      }
    }
    renderAttention(document);
  }

  function render(route, focus) {
    const access = workflowAccess(route,workflowAccountState);
    if (!access.allowed) {
      route = access.redirect;
      history.replaceState(routeState(localIndex(),route),'',documentUrl);
    }
    const enteredHome = route === 'home' && currentRoute !== 'home';
    if (route !== 'home') stopHomeArrival();
    const [role, page] = route.split('/');
    const example = ['agreement', 'progress', 'result'].includes(page);
    if (route !== currentRoute) { showKeyOptions(false); keyOptions.reset(); keyName.setCustomValidity(''); }
    currentRoute = route;
    document.body.classList.toggle('home-view', route === 'home');
    document.body.classList.toggle('services-view', role === 'services');
    document.body.classList.toggle('compact-account-view', ['account/sign-in','account/create','account/terms','account/delete-retention'].includes(route));
    document.body.classList.toggle('compact-identity-view', role === 'identity');
    $('.workspace-heading').hidden = route === 'home';
    if (role === 'requester' || role === 'operator') workspace.lastRoutes[role] = route;
    const section = role === 'requester' || route === 'requests' ? 'requests'
      : role === 'operator' || role === 'operations' ? 'operations' : 'home';
    for (const link of document.querySelectorAll('[data-section]')) {
      if (link.dataset.section === section) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    for (const screen of document.querySelectorAll('.screen')) {
      const visible = example ? screen.dataset.example === page : !screen.dataset.example && screen.dataset.view === route;
      screen.hidden = !visible;
      if (visible) screen.dataset.view = route;
    }
    const [eyebrow, title, description] = views[example ? page : route];
    $('#workspace').setAttribute('aria-label', route === 'home' ? 'Non-verba home' : title);
    $('#view-eyebrow').textContent = eyebrow;
    $('#view-eyebrow').hidden = !eyebrow;
    $('#view-title').textContent = title;
    $('#view-description').textContent = description;
    $('#view-description').hidden = !description;
    onboarding.render(route);
    $('#view-back').hidden = route === 'home';
    $('#example-progress').dataset.navigate = `${role}/progress`;
    $('#example-result').dataset.navigate = `${role}/result`;
    $('#return-to-workspace').dataset.navigate = role;
    $('#return-to-workspace').firstChild.textContent = role === 'requester' ? 'Back to your draft ' : 'Back to example work ';
    updateReviews();
    refreshWorkflowControls();
    applyWorkspaceMode();
    if (focus) {
      $(route === 'home' ? '#home-screen' : '#view-title').focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    if (enteredHome) startHomeArrival();
  }

  function clearErrors(kind) {
    const summary = $(`#${kind}-errors`);
    summary.replaceChildren();
    summary.hidden = true;
    for (const field of draftFields[kind]) {
      const input = $(`#${kind}-${field}`);
      input.removeAttribute('aria-invalid');
      const hint = fieldHints[input.id];
      if (hint) input.setAttribute('aria-describedby', hint);
      else input.removeAttribute('aria-describedby');
    }
  }

  function showErrors(kind, errors) {
    clearErrors(kind);
    const summary = $(`#${kind}-errors`);
    const introduction = document.createElement('p');
    introduction.textContent = 'A little more detail is needed:';
    const list = document.createElement('ul');
    for (const { field, message } of errors) {
      const input = $(`#${kind}-${field}`);
      const item = document.createElement('li');
      const link = document.createElement('button');
      link.type = 'button';
      link.setAttribute('aria-controls', input.id);
      link.id = `${input.id}-error`;
      link.textContent = message;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        if (input.closest('details')) input.closest('details').open = true;
        input.focus();
      });
      item.append(link);
      list.append(item);
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', [fieldHints[input.id], link.id].filter(Boolean).join(' '));
    }
    summary.append(introduction, list);
    summary.hidden = false;
    summary.focus();
  }

  for (const [kind, fields] of Object.entries(draftFields)) {
    const workflowView = kind === 'request' ? 'requester' : kind === 'operation' ? 'operations/new' : 'operator/offer';
    for (const field of fields) {
      $(`#${kind}-${field}`).addEventListener('input', (event) => {
        if (!requireWorkflowAccess(workflowView)) { event.target.value = workspace[kind][field]; return; }
        workspace[kind][field] = event.target.value;
        if (kind !== 'offer') updateDraftLists();
      });
    }
    $(`#${kind}-form`).addEventListener('submit', (event) => {
      event.preventDefault();
      if (!requireWorkflowAccess(workflowView)) {
        for (const field of fields) $(`#${kind}-${field}`).value = workspace[kind][field];
        return;
      }
      // Read the visible values as well as input events, including browser autofill.
      for (const field of fields) workspace[kind][field] = $(`#${kind}-${field}`).value;
      const result = kind === 'request' ? validateRequest(workspace.request)
        : kind === 'operation' ? validateOperation(workspace.operation) : validateOffer(workspace.offer);
      if (!result.valid) return showErrors(kind, result.errors);
      clearErrors(kind);
      navigate(kind === 'request' ? 'requester/review'
        : kind === 'operation' ? 'operations/review' : 'operator/review');
    });
  }

  function applyWorkspaceMode() {
    const routeMode = routeWorkspaceMode(currentRoute);
    const stored = storedWorkspaceMode();
    if (stored && routeMode && stored !== routeMode) rememberWorkspaceMode(routeMode);
    paintWorkspaceMode();
    const mode = activeWorkspaceMode();
    const other = mode === 'requester' ? 'operation' : 'request';
    const waiting = workflowAccountState?.state === 'signed_in' && Object.values(workspace[other]).some(value => value.trim());
    const note = $('#home-other-draft');
    note.textContent = waiting ? (other === 'request' ? 'A request draft is waiting.' : 'An operation draft is waiting.') : '';
    note.hidden = !waiting;
    if (modeMotion && !reducedMotion.matches) {
      document.body.classList.remove('mode-changed');
      void document.body.offsetWidth;
      document.body.classList.add('mode-changed');
    }
    modeMotion = false;
  }
  function switchWorkspaceMode() {
    const next = workspaceModes[activeWorkspaceMode()].next;
    rememberWorkspaceMode(next);
    modeMotion = true;
    for (const list of navigationLists) showList(list, false);
    const routeMode = routeWorkspaceMode(currentRoute);
    if (routeMode && routeMode !== next) navigate('home');
    else applyWorkspaceMode();
    if (currentPanel === 'navigation') document.getElementById(next === 'operator' ? 'operations-list-link' : 'requests-list-link')?.focus({preventScroll:true});
  }
  function openModePrompt() {
    const dialog = $('#mode-confirm');
    if (!dialog || dialog.open) return;
    if (!reducedMotion.matches) {
      dialog.classList.remove('mode-prompt-arrive');
      void dialog.offsetWidth;
      dialog.classList.add('mode-prompt-arrive');
    }
    dialog.showModal();
  }
  function acceptModePrompt() {
    const dialog = $('#mode-confirm');
    if (dialog?.open) dialog.close();
    switchWorkspaceMode();
  }
  for (const id of ['mode-switch', 'dashboard-mode-switch']) $('#' + id).addEventListener('click', openModePrompt);
  $('#mode-confirm-cancel').addEventListener('click', () => $('#mode-confirm').close());
  $('#mode-confirm-accept').addEventListener('click', acceptModePrompt);
  $('#mode-confirm').addEventListener('click', (event) => {
    const dialog = event.currentTarget;
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });

  document.addEventListener('click', (event) => {
    const link = event.composedPath().find(node => node.matches?.('button[data-navigate]'));
    if (!link || event.defaultPrevented) return;
    const route = link.dataset.navigate;
    if (!routes.includes(route)) return;
    event.preventDefault();
    if (currentPanel) closePanel(() => navigate(route));
    else navigate(route);
  });

  function onBack() {
    if (localIndex() > 0) return history.back();
    const [role, page] = currentRoute.split('/');
    const parent = currentRoute === 'identity/notice' ? 'identity/review' : currentRoute === 'account/delete-retention' ? 'account/delete' : role === 'identity' || role === 'account' ? 'identity/setup' : role === 'operations' ? page === 'review' ? 'operations/new' : page ? 'operations' : 'home'
      : role === 'requester' ? page === 'review' ? 'requester' : page ? 'requester' : 'requests'
      : role === 'requests' || role === 'services' ? 'home' : page === 'review' ? 'operator/offer'
      : page === 'offer' ? 'operator/work' : page ? 'operator' : 'operations';
    navigate(parent, true);
  }

  function onHistoryChange() {
    const entry = history.state;
    const route = safeRoute(parseView(entry?.nonverbaPreview === true ? entry.view : null));
    const normalized = entry?.nonverbaPreview !== true || entry.view !== route
      || Boolean(location.search || location.hash);
    if (normalized) {
      history.replaceState(routeState(localIndex(), route), '', documentUrl);
    }
    const panel = history.state?.nonverbaPanel;
    showPanel(Object.hasOwn(panels, panel) ? panel : null);
    if (!currentPanel && afterPanelClose) {
      const action = afterPanelClose;
      afterPanelClose = null;
      action();
      return;
    }
    const changed = route !== currentRoute;
    if (!currentPanel && !changed) onboarding.restoreEmailStep(entry?.nonverbaEmailStep);
    // Stale or invalid history must pass the same draft checks as a UI action.
    if (normalized || changed) {
      render(route, true);
      if (!currentPanel && changed) onboarding.restoreEmailStep(entry?.nonverbaEmailStep);
    }
  }
  window.addEventListener('popstate', onHistoryChange);
  window.addEventListener('hashchange', onHistoryChange);

  // URLs never select a screen or carry draft state. Reload starts at Home.
  $('#request-form').reset();
  $('#offer-form').reset();
  $('#operation-form').reset();
  history.replaceState(routeState(0, 'home'), '', documentUrl);
  render('home', false);
}

function installTheme() {
  const key = 'nonverba-theme';
  const media = matchMedia('(prefers-color-scheme: dark)');
  const stored = () => {
    try {
      const value = localStorage.getItem(key);
      return value === 'light' || value === 'dark' ? value : 'system';
    } catch { return 'system'; }
  };
  const systemTheme = () => media.matches ? 'dark' : 'light';
  const paint = choice => {
    const theme = choice === 'system' ? systemTheme() : choice;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.themeChoice = choice;
    root.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = theme;
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.setAttribute('aria-label', (choice === 'system' ? 'Theme follows the system, ' : 'Theme is ') + theme + '. Switch theme.');
      button.querySelector('use')?.setAttribute('href', '#' + (theme === 'dark' ? 'moon' : 'sun'));
    }
  };
  paint(stored());
  media.addEventListener('change', () => { if (stored() === 'system') paint('system'); });
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const choice = stored();
    const system = systemTheme();
    const next = choice === 'system' ? (system === 'dark' ? 'light' : 'dark') : choice === system ? 'system' : system;
    try {
      if (next === 'system') localStorage.removeItem(key);
      else localStorage.setItem(key, next);
    } catch { /* the choice still applies for this visit */ }
    paint(next);
  });
}

if (typeof document !== 'undefined') {
  installTheme();
  paintWorkspaceMode();
  startPreview();
}

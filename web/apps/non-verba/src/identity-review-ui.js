// SPDX-License-Identifier: AGPL-3.0-only
// Presentation only. The controller owns permission, service DTOs, media custody,
// decision binding and unknown-operation recovery; callbacks must render each
// subsequent state. No callback result is interpreted as approval or authority.
// render({view:'list'|'case', phase:'ready'|'loading'|'denied'|'unavailable'|
// 'empty'|'conflict'|'unknown'|'saved', busy?, message?, canDecide?, actions?,
// entries:[{key,label,detail?}], selected:{key,title?,facts:[{label,value}],
// photos:[{label?,url}], notice:{label?,text}}}). Photos are document then face.
// key is opaque controller memory, never a DOM attribute or document URL.
// onDecision receives only internal {key,action,reason}; all wire mapping stays
// outside this module. UI bounds are configurable, not service validation.
// clear() drops the draft/DOM; focus('heading'|'status'|'reason'|'check') is
// explicit. The controller owns blob creation/revocation and must clear on exit.
let sequence = 0;
const decisions = Object.freeze([
  ['approve','Approve for test','primary'],
  ['correction','Request correction','secondary'],
  ['reject','Reject','secondary']
]);
const messages = Object.freeze({
  loading:'Loading test submissions…',
  denied:'Identity review is not available for this account.',
  unavailable:'Identity review is unavailable.',
  empty:'No test submissions to review.',
  conflict:'This submission changed. Reload it before deciding.',
  unknown:'The decision outcome is unconfirmed. Check the original operation before taking another action.',
  saved:'Test decision saved.'
});
const string = value => typeof value === 'string' ? value : '';
function bound(value, fallback, maximum) {
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

export function createIdentityReviewView({container,onReload,onOpen,onBack,onDecision,onCheckOriginal,
  maxReasonLength = 500,maxCases = 20,requireReasonFor = ['approve','correction','reject']} = {}) {
  if (!container?.ownerDocument || typeof container.replaceChildren !== 'function') {
    throw new TypeError('A dedicated identity review container is required.');
  }
  const document = container.ownerDocument, prefix = `identity-review-${++sequence}`;
  const reasonLimit = bound(maxReasonLength,500,16384), caseLimit = bound(maxCases,20,200);
  const reasonRequired = new Set(Array.isArray(requireReasonFor) ? requireReasonFor : []);
  let revision = 0, draftKey = null, draft = '', targets = {};
  const node = (tag,text,className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = string(text);
    if (className) element.className = className;
    return element;
  };
  const blobUrl = value => {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try { return new URL(value).protocol === 'blob:' ? value : null; } catch { return null; }
  };
  function clear() {
    revision++; draftKey = null; draft = ''; targets = {};
    container.replaceChildren();
  }
  function focus(target = 'heading') {
    const element = targets[target];
    if (!element || element.disabled || !container.contains(element)) return false;
    element.focus(); return document.activeElement === element;
  }
  function render(model = {}) {
    const captured = ++revision, phase = Object.hasOwn(messages,model.phase) ? model.phase : model.phase === 'ready' ? 'ready' : 'unavailable';
    const selected = model.view === 'case' ? model.selected : null;
    if (phase !== 'ready' || !selected || selected.key !== draftKey) draft = '';
    draftKey = phase === 'ready' && selected ? selected.key : null;
    targets = {};
    const headingText = phase === 'unknown' ? 'Check decision status' : phase === 'saved' ? 'Recorded test decision'
      : selected ? 'Selected test submission' : 'Pending test submissions';
    const panel = node('section'), heading = node('h2',headingText);
    heading.id = prefix+'-heading'; heading.tabIndex = -1; targets.heading = heading;
    panel.setAttribute('aria-labelledby',heading.id);
    panel.setAttribute('aria-busy',String(model.busy === true || phase === 'loading'));
    panel.append(heading,node('p','Synthetic submissions only. Decisions record test feedback; they do not verify a real identity or grant work access.','small-note'));
    const feedback = node('p',string(model.message) || messages[phase] || '','small-note');
    feedback.setAttribute('role','status'); feedback.setAttribute('aria-live','polite');
    feedback.tabIndex = -1; targets.status = feedback; panel.append(feedback);
    const busy = model.busy === true || phase === 'loading';
    let actionPending = false;
    const dispatch = (callback,payload) => {
      if (captured !== revision || actionPending || busy || typeof callback !== 'function') return;
      actionPending = true;
      for (const control of panel.querySelectorAll('button,textarea')) control.disabled = true;
      const failed = () => {
        if (captured === revision) feedback.textContent = 'The review action could not finish. Check the review status before taking another action.';
      };
      try { Promise.resolve(callback(payload)).catch(failed); } catch { failed(); }
      // The controller must now render its result, including unknown writes.
      // Do not unlock decisions or retry from a fulfilled/rejected callback.
    };
    const button = (label,className,callback,payload) => {
      const element = node('button',label,className); element.type = 'button';
      element.disabled = busy || typeof callback !== 'function';
      element.addEventListener('click',() => dispatch(callback,payload)); return element;
    };
    const toolbar = node('div',undefined,'onboarding-actions');
    if (phase === 'unknown') {
      const check = button('Check original operation','primary',onCheckOriginal);
      targets.check = check; toolbar.append(check); panel.append(toolbar);
      container.replaceChildren(panel); return;
    }
    if (typeof onBack === 'function') toolbar.append(button(selected ? 'Back to cases' : 'Back','text-link',onBack));
    if (!['denied','saved'].includes(phase)) toolbar.append(button(phase === 'conflict' ? 'Reload case' : 'Reload','text-link',onReload));
    panel.append(toolbar);
    if (phase === 'saved' && selected) {
      const receipt = node('dl',undefined,'facts');
      for (const fact of selected.facts || []) {
        const row = node('div'); row.append(node('dt',fact.label),node('dd',fact.value)); receipt.append(row);
      }
      panel.append(receipt);
    }
    if (phase !== 'ready') { container.replaceChildren(panel); return; }
    if (!selected) {
      const entries = Array.isArray(model.entries) ? model.entries.slice(0,caseLimit) : [];
      const list = node('ul',undefined,'draft-list'); list.setAttribute('aria-label','Test identity submissions');
      for (const entry of entries) {
        if (!entry || entry.key === null || entry.key === undefined || !string(entry.label)) continue;
        const row = node('li'), open = button('', '',onOpen,entry.key);
        open.append(node('span',entry.label,'user-text'));
        if (string(entry.detail)) open.append(node('span',entry.detail,'small-note'));
        row.append(open); list.append(row);
      }
      if (list.childElementCount) panel.append(list);
      else feedback.textContent = string(model.message) || messages.empty;
      container.replaceChildren(panel); return;
    }
    if (string(selected.title)) panel.append(node('h3',selected.title));
    const facts = node('dl',undefined,'facts');
    for (const fact of Array.isArray(selected.facts) ? selected.facts : []) {
      if (!fact || !string(fact.label)) continue;
      const row = node('div'); row.append(node('dt',fact.label),node('dd',fact.value)); facts.append(row);
    }
    panel.append(facts);
    const media = node('div',undefined,'review-media'), decisionButtons = [];
    let photosLoaded = 0, photoFailed = false;
    const permitted = model.canDecide === true && selected.key !== null && selected.key !== undefined;
    const enableDecisions = () => {
      for (const [element,action] of decisionButtons) element.disabled = busy || actionPending || !permitted || photoFailed || photosLoaded !== 2
        || !string(selected.notice?.text) || Array.isArray(model.actions) && !model.actions.includes(action) || typeof onDecision !== 'function';
    };
    for (let index = 0; index < 2; index++) {
      const photo = selected.photos?.[index], label = string(photo?.label) || (index ? 'Test face photo' : 'Test document photo');
      const figure = node('figure'), url = blobUrl(photo?.url);
      if (url) {
        const image = node('img'); image.alt = label;
        image.addEventListener('load',() => { if (captured === revision) { photosLoaded++; enableDecisions(); } },{once:true});
        image.addEventListener('error',() => {
          if (captured !== revision) return;
          photoFailed = true; feedback.textContent = 'A test photo could not be displayed. Reload before deciding.'; enableDecisions();
        },{once:true});
        image.src = url; figure.append(image);
      } else { photoFailed = true; figure.append(node('p','Photo unavailable.','small-note')); }
      figure.append(node('figcaption',label)); media.append(figure);
    }
    panel.append(media);
    const notice = node('details',undefined,'identity-review-edit');
    notice.append(node('summary',string(selected.notice?.label) || 'Accepted notice'),
      node('div',string(selected.notice?.text) || 'Accepted notice unavailable.','identity-notice'));
    panel.append(notice);
    const field = node('div',undefined,'field'), label = node('label','Reason'), reason = node('textarea');
    // HTML maxlength counts UTF-16 units; allow supplementary characters while
    // enforcing the selected code-point bound before a deliberate callback.
    reason.id = prefix+'-reason'; reason.maxLength = reasonLimit*2; reason.value = draft;
    reason.autocomplete = 'off'; reason.disabled = busy || !permitted; label.htmlFor = reason.id;
    const requiredLabels = decisions.filter(([action]) => reasonRequired.has(action)).map(([,title]) => title);
    const requirement = requiredLabels.length === decisions.length ? 'Required for every decision.'
      : requiredLabels.length ? 'Required for: '+requiredLabels.join(', ')+'.' : 'Optional.';
    const hint = node('p',`${requirement} Up to ${reasonLimit} characters; no line breaks.`,'small-note');
    hint.id = prefix+'-reason-hint'; reason.setAttribute('aria-describedby',hint.id);
    reason.addEventListener('input',() => { draft = reason.value; reason.removeAttribute('aria-invalid'); });
    targets.reason = reason; field.append(label,reason,hint); panel.append(field);
    const actions = node('div',undefined,'onboarding-actions');
    for (const [action,title,className] of decisions) {
      const element = node('button',title,className); element.type = 'button';
      element.addEventListener('click',() => {
        if (element.disabled || captured !== revision) return;
        const value = reason.value.trim();
        const tooLong = [...value].length > reasonLimit, controls = /[\u0000-\u001f\u007f-\u009f]/.test(value);
        if (tooLong || controls || reasonRequired.has(action) && !value) {
          reason.setAttribute('aria-invalid','true'); feedback.textContent = controls ? 'Use a reason without control characters or line breaks.'
            : tooLong ? `Keep the reason within ${reasonLimit} characters.` : 'Enter a reason for this decision.';
          reason.focus(); return;
        }
        dispatch(onDecision,{key:selected.key,action,reason:value});
      });
      decisionButtons.push([element,action]); actions.append(element);
    }
    enableDecisions(); panel.append(actions);
    container.replaceChildren(panel);
  }
  return Object.freeze({render,clear,focus});
}

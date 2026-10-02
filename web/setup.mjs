// SPDX-License-Identifier: AGPL-3.0-only
// Draft-only setup editor. The shared validator checks the complete configuration
// before a synchronous callback can replace the active Rust/WASM simulation.
import { createMoney, validateConfig } from '../code/simulator/config.mjs';

const POLICY_FIELDS = [
  ['policy.decayDays', 'Vote lifetime', 'integer', 'days'],
  ['policy.minimumOperators', 'Minimum distinct Operators', 'integer'],
  ['policy.minimumEffectiveVotes', 'Minimum effective votes', 'integer'],
  ['policy.demandSensitivityBps', 'Demand sensitivity', 'percent', '%'],
  ['policy.maxDemandPremiumBps', 'Maximum demand premium', 'percent', '%'],
];

const ADVANCED_GROUPS = [
  ['Time and agreement', [
    ['clock.startsAt', 'Simulation starts at', 'text', 'UTC · YYYY-MM-DDTHH:mm:ssZ'],
    ['clock.timelineDays', 'Timeline length', 'integer', 'days'],
    ['clock.seedVoteAgeDays', 'Initial vote age', 'integer', 'days'],
    ['policy.validityDays', 'Agreement validity', 'integer', 'days'],
    ['policy.demandMaxAgeSeconds', 'Demand freshness', 'integer', 'seconds'],
    ['policy.quoteLifetimeSeconds', 'Quote lifetime', 'integer', 'seconds'],
  ]],
  ['Agreement scope', [
    ['scope.jurisdiction', 'Jurisdiction', 'text'],
    ['scope.region', 'Region', 'text'],
    ['scope.counterpartyId', 'Purchasing counterparty', 'text'],
  ]],
  ['Starting demand', [
    ['demand.requestedMinutes', 'Requested work', 'integer', 'minutes'],
    ['demand.availableMinutes', 'Available work', 'integer', 'minutes'],
    ['demand.windowMinutes', 'Measurement window', 'integer', 'minutes'],
  ]],
  ['Input limits', [
    ['limits.rateMinorPerHour', 'Maximum hourly R', 'money', 'per hour'],
    ['limits.baselinePriceMinor', 'Maximum baseline price', 'money'],
    ['limits.workMinutes', 'Maximum working time', 'integer', 'minutes'],
    ['limits.demandMinutes', 'Maximum requested or available work', 'integer', 'minutes'],
    ['limits.decayDays', 'Maximum vote lifetime', 'integer', 'days'],
  ]],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function getPath(value, path) { return path.split('.').reduce((record, key) => record[key], value); }
function setPath(value, path, field) {
  const keys = path.split('.');
  const final = keys.pop();
  keys.reduce((record, key) => record[key], value)[final] = field;
}

// Currency changes preserve entered major-unit amounts. Removing only trailing
// decimal zeros allows e.g. 300.00 -> 300 JPY without rounding 1.25 to 1 JPY.
function trimDecimalZeros(value) {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

function percentInput(basisPoints) {
  const value = BigInt(basisPoints);
  return trimDecimalZeros(`${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`);
}

function parsePercent(value, label) {
  value = trimDecimalZeros(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error(`${label} must be a nonnegative percentage with at most two decimal places.`);
  }
  const [whole, fraction = ''] = value.split('.');
  const exact = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} is too large.`);
  return Number(exact);
}

/** Mount an isolated draft editor; only Apply calls onApply and replaces live state. */
export function mountSetup({ config, onApply }) {
  const host = document.getElementById('setup-editor');
  if (!host) throw new Error('The setup editor container is missing.');
  if (typeof onApply !== 'function') throw new Error('The setup editor needs an apply callback.');
  let applied = validateConfig(config);
  let source = applied;
  let currency;
  let form;
  let controls;
  let status;
  let operatorList;
  let taskList;
  let operatorSummary;
  let taskSummary;
  let draftGeneration = 0;
  const usedIds = { operator: new Set(), task: new Set() };

  function feedback(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
    status.hidden = !message;
    if (error) status.focus();
  }

  function button(label, id, action, className = 'secondary') {
    const control = element('button', className, label);
    control.type = 'button';
    if (id) control.id = id;
    if (action) control.addEventListener('click', action);
    return control;
  }

  function field(definition, value, { id, path = definition[0] } = {}) {
    const [, labelText, kind, unit] = definition;
    const wrapper = element('div', 'field');
    const label = element('label', null, labelText);
    const input = element('input');
    // Dots are valid in an HTML id; preserving the full path also avoids
    // collisions between configured identifiers such as "a.b" and "a-b".
    input.id = id || `setup-${path}`;
    input.dataset.setupPath = path;
    input.dataset.kind = kind;
    input.dataset.label = labelText;
    input.required = true;
    label.htmlFor = input.id;
    if (kind === 'money') {
      const currencyLabel = element('span', null, currency.code);
      currencyLabel.dataset.setupMoneyUnit = '';
      label.append(document.createTextNode(' '), currencyLabel);
      if (unit) label.append(document.createTextNode(` ${unit}`));
      input.type = 'number';
      input.min = currency.step;
      input.step = currency.step;
      input.inputMode = currency.digits === 0 ? 'numeric' : 'decimal';
      input.value = currency.toInput(value);
    } else {
      if (unit) label.append(document.createTextNode(' '), element('span', null, unit));
      input.type = kind === 'text' ? 'text' : 'number';
      input.value = kind === 'percent' ? percentInput(value) : String(value);
      if (kind !== 'text') {
        input.min = '0';
        input.step = kind === 'percent' ? '0.01' : '1';
        input.inputMode = kind === 'percent' ? 'decimal' : 'numeric';
      }
    }
    wrapper.append(label, input);
    return wrapper;
  }

  function fields(definitions) {
    const grid = element('div', 'setup-grid');
    for (const definition of definitions) grid.append(field(definition, getPath(source, definition[0])));
    return grid;
  }

  function details(title) {
    const section = element('details', 'setup-section');
    const summary = element('summary', null, title);
    section.append(summary);
    return { section, summary };
  }

  function updateCounts() {
    operatorSummary.textContent = `Operators (${operatorList.children.length})`;
    taskSummary.textContent = `Task categories (${taskList.children.length})`;
  }

  function nextId(kind) {
    let suffix = 1;
    while (usedIds[kind].has(`${kind}-${suffix}`)) suffix += 1;
    const id = `${kind}-${suffix}`;
    usedIds[kind].add(id);
    return id;
  }

  function appendRow(kind, record) {
    const isOperator = kind === 'operator';
    const list = isOperator ? operatorList : taskList;
    const id = record[isOperator ? 'operatorId' : 'taskId'];
    usedIds[kind].add(id);
    const row = element('div', 'setup-row');
    row.dataset[isOperator ? 'setupOperator' : 'setupTask'] = id;
    const definitions = isOperator ? [
      ['name', 'Name', 'text'], ['rateMinorPerHour', 'Hourly R', 'money', 'per hour'],
    ] : [
      ['name', 'Task name', 'text'], ['baselinePriceMinor', 'Baseline price', 'money'],
      ['baselineMinutes', 'Baseline time', 'integer', 'minutes'], ['taskVersion', 'Task version', 'text'],
    ];
    for (const definition of definitions) {
      const key = definition[0];
      const wrapper = field(definition, record[key], { path: `${isOperator ? 'operators' : 'tasks'}.${id}.${key}` });
      wrapper.querySelector('input').dataset.field = key;
      row.append(wrapper);
    }
    const actions = element('div', 'setup-row-actions');
    const remove = button('Remove', null, () => {
      draftGeneration += 1;
      row.remove();
      updateCounts();
      feedback('Draft updated. Apply setup to start a new simulation.');
    });
    remove.dataset.setupRemove = kind;
    remove.setAttribute('aria-label', `Remove ${record.name}`);
    actions.append(remove);
    row.append(actions);
    list.append(row);
  }

  function parseField(input, money) {
    const value = input.value.trim();
    const label = input.dataset.label;
    if (input.dataset.kind === 'text') return value;
    if (input.dataset.kind === 'money') {
      try { return money.parseInput(trimDecimalZeros(value)); }
      catch (error) { throw new Error(`${label}: ${error.message}`, { cause: error }); }
    }
    if (input.dataset.kind === 'percent') return parsePercent(value, label);
    const parsed = Number(value);
    if (!value || !Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error(`${label} must be a nonnegative whole number.`);
    }
    return parsed;
  }

  function readDraft() {
    const candidate = clone(source);
    candidate.currency = form.querySelector('#setup-currency').value;
    candidate.locale = form.querySelector('#setup-locale').value.trim();
    const money = createMoney(candidate);
    for (const input of form.querySelectorAll('input[data-setup-path]')) {
      if (!input.dataset.field) setPath(candidate, input.dataset.setupPath, parseField(input, money));
    }
    for (const [list, key, idField] of [
      [operatorList, 'operators', 'operatorId'], [taskList, 'tasks', 'taskId'],
    ]) {
      candidate[key] = [...list.children].map(row => {
        const record = { [idField]: row.dataset[key === 'operators' ? 'setupOperator' : 'setupTask'] };
        for (const input of row.querySelectorAll('input[data-field]')) record[input.dataset.field] = parseField(input, money);
        return record;
      });
    }
    return validateConfig(candidate);
  }

  function attempt(action) {
    try { action(); }
    catch (error) { feedback(error.message || String(error), true); }
  }

  function download() {
    attempt(() => {
      const candidate = readDraft();
      const blob = new Blob([JSON.stringify(candidate, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = element('a');
      link.href = url;
      link.download = 'union.config.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      feedback('Configuration downloaded. The active simulation is unchanged.');
    });
  }

  async function importFile(input) {
    const file = input.files?.[0];
    if (!file) return;
    const generation = ++draftGeneration;
    try {
      const candidate = validateConfig(JSON.parse(await file.text()));
      if (generation !== draftGeneration) return;
      render(candidate);
      feedback(`Loaded ${file.name} into the draft. Apply setup to start a new simulation.`);
    } catch (error) {
      if (generation !== draftGeneration) return;
      feedback(`Cannot import configuration: ${error.message || error}`, true);
      input.value = '';
    }
  }

  function changeCurrency() {
    attempt(() => {
      currency = createMoney({ currency: form.querySelector('#setup-currency').value, locale: source.locale });
      for (const label of form.querySelectorAll('[data-setup-money-unit]')) label.textContent = currency.code;
      for (const input of form.querySelectorAll('input[data-kind="money"]')) {
        input.value = trimDecimalZeros(input.value);
        input.min = currency.step;
        input.step = currency.step;
        input.inputMode = currency.digits === 0 ? 'numeric' : 'decimal';
      }
      feedback(`Currency changed to ${currency.code}. Numeric amounts stay as entered; no exchange-rate conversion is made. Review decimal precision, then apply setup.`);
    });
  }

  function render(candidate) {
    source = validateConfig(candidate);
    draftGeneration += 1;
    currency = createMoney(source);
    form = element('form');
    form.id = 'setup-form';
    form.noValidate = true;
    controls = element('fieldset');
    controls.id = 'setup-controls';
    controls.disabled = true;
    controls.append(element('legend', 'sr-only', 'Edit the simulation setup'));
    status = element('p', 'notice');
    status.id = 'setup-status';
    status.hidden = true;
    status.tabIndex = -1;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const currencyGrid = element('div', 'setup-grid');
    const currencyField = element('div', 'field');
    const currencyLabel = element('label', null, 'Currency');
    currencyLabel.htmlFor = 'setup-currency';
    const select = element('select');
    select.id = 'setup-currency';
    select.dataset.setupPath = 'currency';
    const names = new Intl.DisplayNames(['en'], { type: 'currency' });
    for (const code of Intl.supportedValuesOf('currency')) {
      const option = element('option', null, `${code} — ${names.of(code)}`);
      option.value = code;
      select.append(option);
    }
    select.value = source.currency;
    select.addEventListener('change', changeCurrency);
    currencyField.append(currencyLabel, select);
    currencyGrid.append(currencyField, field(['locale', 'Number display locale', 'text'], source.locale, { id: 'setup-locale' }));
    controls.append(currencyGrid);

    const operators = details('Operators');
    operatorSummary = operators.summary;
    operatorList = element('div', 'setup-rows');
    operatorList.id = 'setup-operators';
    for (const operator of source.operators) appendRow('operator', operator);
    operators.section.append(operatorList, button('Add Operator', 'setup-add-operator', () => {
      draftGeneration += 1;
      const first = operatorList.firstElementChild;
      const rate = first?.querySelector('[data-field="rateMinorPerHour"]')?.value;
      const operatorId = nextId('operator');
      appendRow('operator', {
        operatorId, name: 'New Operator', rateMinorPerHour: source.operators[0].rateMinorPerHour,
      });
      const row = operatorList.lastElementChild;
      row.querySelector('[data-field="rateMinorPerHour"]').value = rate
        ?? trimDecimalZeros(createMoney(source).toInput(source.operators[0].rateMinorPerHour));
      row.querySelector('[data-field="name"]').focus();
      updateCounts();
    }));
    controls.append(operators.section);

    const tasks = details('Task categories');
    taskSummary = tasks.summary;
    taskList = element('div', 'setup-rows');
    taskList.id = 'setup-tasks';
    for (const task of source.tasks) appendRow('task', task);
    tasks.section.append(taskList, button('Add task category', 'setup-add-task', () => {
      draftGeneration += 1;
      const first = taskList.firstElementChild;
      const taskId = nextId('task');
      appendRow('task', { ...source.tasks[0], taskId, name: 'New task' });
      const row = taskList.lastElementChild;
      for (const key of ['baselinePriceMinor', 'baselineMinutes', 'taskVersion']) {
        const value = first?.querySelector(`[data-field="${key}"]`)?.value;
        if (value !== undefined) row.querySelector(`[data-field="${key}"]`).value = value;
        else if (key === 'baselinePriceMinor') {
          row.querySelector(`[data-field="${key}"]`).value = trimDecimalZeros(
            createMoney(source).toInput(source.tasks[0].baselinePriceMinor),
          );
        }
      }
      row.querySelector('[data-field="name"]').focus();
      updateCounts();
    }));
    controls.append(tasks.section);
    updateCounts();

    const policy = details('Cooperation policy');
    policy.section.append(fields(POLICY_FIELDS));
    controls.append(policy.section);
    const advanced = details('Advanced settings');
    for (const [heading, definitions] of ADVANCED_GROUPS) {
      advanced.section.append(element('h3', 'setup-heading', heading), fields(definitions));
    }
    controls.append(advanced.section);

    const actions = element('div', 'setup-actions');
    const apply = button('Apply setup & start new simulation', 'setup-apply', null, 'primary');
    apply.type = 'submit';
    const discard = button('Discard edits', 'setup-discard', () => {
      render(applied);
      feedback('Draft restored to the last applied setup. The active simulation is unchanged.');
    });
    const fileLabel = element('label', 'secondary', 'Import configuration');
    fileLabel.htmlFor = 'setup-import';
    const fileInput = element('input');
    fileInput.id = 'setup-import';
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.className = 'sr-only';
    fileInput.addEventListener('change', () => { void importFile(fileInput); });
    actions.append(apply, discard, button('Download configuration', 'setup-export', download), fileLabel, fileInput);
    controls.append(actions, element('p', 'hint', 'Setup edits apply only when you start a new simulation. Download the configuration to keep your settings; this page does not save them automatically.'));
    form.append(controls);
    for (const eventName of ['input', 'change']) {
      form.addEventListener(eventName, event => {
        if (event.target.type !== 'file') draftGeneration += 1;
      });
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      draftGeneration += 1;
      attempt(() => {
        const next = readDraft();
        onApply(next);
        applied = next;
        render(next);
        feedback('Setup applied. A new simulation has started.');
      });
    });
    host.replaceChildren(form, status);
    controls.disabled = false;
  }

  render(applied);
  return Object.freeze({
    setConfig(next) {
      const validated = validateConfig(next);
      applied = validated;
      render(validated);
    },
  });
}

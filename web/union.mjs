// UI and display conversions only. The simulator model uses the Rust/WASM core.
const $ = id => document.getElementById(id);
const money = value => currency.format(value);
const duration = seconds => `${Number((seconds / 60).toFixed(2))} min`;
let simulation;
let config;
let currency;
let maximumOffer;
let createSimulation;
let createMoney;
let maximumOfferMinor;
let offerEdited = false;
let approvedEdited = false;

function showNotice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = !message;
}

function integerInput(id, minimum = 0) {
  const value = Number($(id).value);
  if ($(id).value.trim() === '' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error('Enter a whole number within the field’s allowed range.');
  }
  if (!$(id).checkValidity()) throw new Error($(id).validationMessage);
  return value;
}

function priceInput(input, maximum) {
  const minor = currency.parseInput(input.value, maximum);
  if (!input.checkValidity()) throw new Error(input.validationMessage);
  return minor;
}

function configurePriceInput(input, maximum) {
  input.min = currency.step;
  input.step = currency.step;
  input.max = currency.toInput(maximum);
  input.inputMode = currency.digits === 0 ? 'numeric' : 'decimal';
}

// Every scenario value comes from the same validated configuration used by the
// model. Applying setup creates a new instance with its own immutable currency.
function configurePage(view) {
  for (const element of document.querySelectorAll('[data-currency]')) element.textContent = config.currency;
  $('minor-unit').textContent = money(1);
  $('day-offset').max = config.clock.timelineDays;
  $('timeline-end').textContent = `+${config.clock.timelineDays} days`;
  $('decay-days').max = config.limits.decayDays;
  for (const id of ['requested-minutes', 'available-minutes']) $(id).max = config.limits.demandMinutes;
  for (const id of ['baseline-minutes', 'worked-minutes', 'approved-minutes']) $(id).max = config.limits.workMinutes;
  configurePriceInput($('baseline-price'), config.limits.baselinePriceMinor);
  configurePriceInput($('offer-price'), maximumOffer);
  $('minimum-operators').textContent = config.policy.minimumOperators;
  $('minimum-effective-votes').textContent = config.policy.minimumEffectiveVotes;
  const { maxDemandPremiumBps, demandSensitivityBps } = config.policy;
  $('demand-formula').textContent = `min(${maxDemandPremiumBps / 100}%, ${demandSensitivityBps / 100}% × max(0, requested ÷ available − 1))`;
  $('task-select').replaceChildren();
  $('complete-operator').replaceChildren();
  $('quote-operator').replaceChildren();
  for (const task of view.tasks) {
    const option = document.createElement('option');
    option.value = task.taskId;
    option.textContent = task.name;
    $('task-select').append(option);
  }
  $('worked-minutes').value = view.terms.expectedSeconds / 60;
}

function startSimulation(input) {
  // Validate and evaluate the candidate before replacing any active history.
  const candidate = createSimulation(input);
  const view = candidate.view();
  const nextCurrency = createMoney(candidate.config);
  const nextMaximum = maximumOfferMinor(candidate.config);
  simulation = candidate;
  config = candidate.config;
  currency = nextCurrency;
  maximumOffer = nextMaximum;
  offerEdited = false;
  approvedEdited = false;
  configurePage(view);
  render(view);
}

function cell(row, text, className) {
  const element = document.createElement('td');
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  row.append(element);
  return element;
}

function fillOperators(view) {
  $('operators-body').replaceChildren();
  for (const operator of view.operators) {
    const row = document.createElement('tr');
    cell(row, operator.name);
    const input = document.createElement('input');
    input.type = 'number';
    input.id = `rate-${operator.operatorId}`;
    configurePriceInput(input, config.limits.rateMinorPerHour);
    input.value = currency.toInput(operator.rateMinorPerHour);
    input.dataset.operator = operator.operatorId;
    input.setAttribute('aria-label', `Personal hourly rate for ${operator.name} in ${config.currency}`);
    cell(row).append(input);
    $('operators-body').append(row);
  }
  for (const id of ['complete-operator', 'quote-operator']) {
    if ($(id).options.length) continue;
    for (const operator of view.operators) {
      const option = document.createElement('option');
      option.value = operator.operatorId;
      option.textContent = operator.name;
      $(id).append(option);
    }
  }
}

function fillVotes(view) {
  $('votes-body').replaceChildren();
  const names = new Map(view.operators.map(operator => [operator.operatorId, operator.name]));
  for (const vote of [...view.votes].sort((a, b) => b.completedAt - a.completedAt)) {
    const row = document.createElement('tr');
    const age = Math.max(0, view.now - vote.completedAt);
    // Visual explanation of the documented linear decay. Prices and quorum are
    // always taken from Rust's evaluated terms, never from this display value.
    const remaining = Math.max(0, view.policy.decayWindowSeconds - age);
    const weightPercent = 100 * remaining / view.policy.decayWindowSeconds;
    row.classList.toggle('expired', remaining === 0);
    row.dataset.completion = vote.completionId;
    cell(row, names.get(vote.operatorId) || vote.operatorId);
    cell(row, `${money(vote.rateMinorPerHour)} / h`, 'numeric');
    cell(row, duration(vote.workedSeconds), 'numeric');
    cell(row, money(vote.priceMinor), 'numeric');
    const days = Number((age / 86400).toFixed(1));
    cell(row, days === 0 ? 'Just completed' : `${days} ${days === 1 ? 'day' : 'days'}`);
    const weightCell = cell(row, undefined, 'weight-cell');
    const label = document.createElement('span');
    label.textContent = remaining === 0 ? 'Expired · 0%' : `${weightPercent.toFixed(1)}%`;
    const progress = document.createElement('progress');
    progress.max = view.policy.decayWindowSeconds;
    progress.value = remaining;
    progress.setAttribute('aria-label', `${names.get(vote.operatorId)} vote weight`);
    weightCell.append(label, progress);
    $('votes-body').append(row);
  }
  if (!view.votes.length) {
    const row = document.createElement('tr');
    const empty = cell(row, 'No completed-task votes at this point in the simulation.');
    empty.colSpan = 6;
    $('votes-body').append(row);
  }
}

function render(view) {
  const { terms } = view;
  $('task-select').value = view.taskId;
  $('day-offset').value = view.day;
  $('day-label').textContent = `Day +${view.day}`;
  $('requested-minutes').value = view.demand.requestedSeconds / 60;
  $('available-minutes').value = view.demand.availableSeconds / 60;
  $('decay-days').value = view.policy.decayWindowSeconds / 86400;
  $('baseline-price').value = currency.toInput(view.policy.baselinePriceMinor);
  $('baseline-minutes').value = view.policy.baselineSeconds / 60;
  $('collective-price').textContent = money(terms.minimumPriceMinor);
  $('base-price').textContent = money(terms.basePriceMinor);
  $('premium-value').textContent = `${Number((terms.premiumBps / 100).toFixed(2))}%`;
  $('expected-time').textContent = duration(terms.expectedSeconds);
  const fallback = terms.support === 'baseline-fallback';
  const baselineBinds = !fallback && view.policy.baselinePriceMinor >= terms.medianPriceMinor;
  $('support-label').textContent = fallback || baselineBinds ? 'Agreement baseline' : 'Votes set the floor';
  $('support-label').classList.toggle('is-fallback', fallback);
  const mass = Number(terms.weightNumerator) / Number(terms.weightDenominator);
  $('support-detail').textContent = `${terms.activeOperators} active Operators · ${mass.toFixed(2)} effective votes. `
    + (fallback ? 'Not enough recent participation: the agreed price and time apply.'
      : baselineBinds ? 'The protected baseline sets the base price; recent votes determine expected time.'
        : 'Recent completed work determines the task’s price and expected time.');
  $('vote-count').textContent = `${terms.activeVotes} active / ${view.votes.length} recorded`;
  fillOperators(view);
  fillVotes(view);
  const operatorId = $('quote-operator').value;
  const quote = view.quotes[operatorId];
  $('personal-rate').textContent = `${money(quote.rateMinorPerHour)} / hour`;
  $('personal-price').textContent = money(quote.personalPriceMinor);
  $('quote-price').textContent = money(quote.minimumPriceMinor);
  const acceptance = view.acceptance;
  if (acceptance) $('offer-price').value = currency.toInput(acceptance.priceMinor);
  else if (!offerEdited) $('offer-price').value = currency.toInput(quote.minimumPriceMinor);
  $('offer-price').disabled = Boolean(acceptance);
  $('accept-offer').disabled = Boolean(acceptance);
  $('approved-minutes').disabled = !acceptance;
  $('settle-task').disabled = !acceptance;
  if (acceptance) {
    const name = view.operators.find(operator => operator.operatorId === acceptance.operatorId)?.name;
    $('acceptance-status').textContent = `${name} accepted ${money(acceptance.priceMinor)} for `
      + `${duration(acceptance.expectedSeconds)}. These terms stay locked as settings and time change.`;
    if (!approvedEdited) $('approved-minutes').value = (view.approvedSeconds ?? acceptance.expectedSeconds) / 60;
  } else {
    $('acceptance-status').textContent = 'Accept a simulated offer to lock its price and time.';
    if (!approvedEdited) $('approved-minutes').value = terms.expectedSeconds / 60;
  }
  $('settlement-price').textContent = view.settlement === null ? '—' : money(view.settlement);
  $('audit-json').textContent = JSON.stringify(simulation.exportSnapshot(), null, 2);
}

function apply(action, message = '') {
  try {
    render(action());
    showNotice(message);
  } catch (error) {
    render(simulation.view());
    showNotice(error.message || String(error), true);
  }
}

function bindEvents() {
  $('task-select').addEventListener('change', () => {
    offerEdited = false;
    approvedEdited = false;
    apply(() => simulation.setTask($('task-select').value));
    $('worked-minutes').value = simulation.view().terms.expectedSeconds / 60;
  });
  $('day-offset').addEventListener('input', () => {
    offerEdited = false;
    apply(() => simulation.setDay(integerInput('day-offset')));
  });
  for (const id of ['requested-minutes', 'available-minutes']) {
    $(id).addEventListener('change', () => {
      offerEdited = false;
      apply(() => simulation.updateDemand({
        requestedSeconds: integerInput('requested-minutes') * 60,
        availableSeconds: integerInput('available-minutes') * 60,
      }));
    });
  }
  for (const id of ['baseline-price', 'baseline-minutes', 'decay-days']) {
    $(id).addEventListener('change', () => {
      offerEdited = false;
      apply(() => simulation.updatePolicy({
        baselinePriceMinor: priceInput($('baseline-price'), config.limits.baselinePriceMinor),
        baselineSeconds: integerInput('baseline-minutes', 1) * 60,
        decayWindowSeconds: integerInput('decay-days', 1) * 86400,
      }));
    });
  }
  $('operators-body').addEventListener('change', event => {
    const input = event.target;
    if (!input.dataset.operator) return;
    offerEdited = false;
    apply(() => simulation.updateOperator(input.dataset.operator, priceInput(input, config.limits.rateMinorPerHour)),
      'Personal rate updated. Recorded votes keep their original rate.');
  });
  $('completion-form').addEventListener('submit', event => {
    event.preventDefault();
    offerEdited = false;
    apply(() => simulation.complete($('complete-operator').value, integerInput('worked-minutes', 1) * 60),
      'One completed task added one new vote at full initial weight.');
  });
  $('quote-operator').addEventListener('change', () => {
    offerEdited = false;
    render(simulation.view());
  });
  $('offer-price').addEventListener('input', () => { offerEdited = true; });
  $('accept-offer').addEventListener('click', () => {
    approvedEdited = false;
    apply(() => simulation.accept($('quote-operator').value, priceInput($('offer-price'), maximumOffer)),
      'Simulated assignment accepted. Its price and time are now locked.');
  });
  $('approved-minutes').addEventListener('input', () => { approvedEdited = true; });
  $('settle-task').addEventListener('click', () => apply(
    () => simulation.settle(integerInput('approved-minutes', 1) * 60),
    'Settlement calculated from the accepted terms and approved working time.',
  ));
  $('reset-demo').addEventListener('click', () => {
    offerEdited = false;
    approvedEdited = false;
    apply(() => simulation.reset(), 'The fictional scenario has been reset.');
    $('worked-minutes').value = simulation.view().terms.expectedSeconds / 60;
  });
  $('export-snapshot').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(simulation.exportSnapshot(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nonverba-union-${simulation.view().taskId}-simulation.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

try {
  const [model, configuration, { mountSetup }] = await Promise.all([
    import('../code/simulator/model.mjs'), import('../code/simulator/config.mjs'), import('./setup.mjs'),
  ]);
  ({ createSimulation } = model);
  ({ createMoney, maximumOfferMinor } = configuration);
  startSimulation();
  bindEvents();
  mountSetup({ config, onApply: candidate => {
    startSimulation(candidate);
    showNotice(`Setup applied. A new ${config.currency} simulation is ready.`);
  } });
  $('simulator-controls').disabled = false;
  $('runtime').textContent = 'Local engine ready';
} catch (error) {
  $('simulator-controls').disabled = true;
  $('setup-editor').textContent = 'Setup is unavailable until the configuration and local engine can load.';
  $('runtime').textContent = 'Local engine unavailable';
  showNotice(`The simulator could not start. Check union.config.json and the local WASM build, then reload. ${error.message || error}`, true);
}

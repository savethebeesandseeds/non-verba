// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local scenario state for the standalone Operators' union simulator.
 *
 * This module creates fictional, unsigned records. Its verifier checks only
 * their consistency with this in-memory scenario. It authenticates no real
 * person, completion, agreement, approved time, or legal eligibility.
 * Rust/WASM owns every vote, price, quorum, decay and settlement calculation.
 */
import {
  prepareVote, evaluateTask, quoteTask, prepareAcceptance, settlementMinimum,
} from '../protocol/cooperation.mjs';
import { loadConfig, validateConfig, maximumOfferMinor, createMoney } from './config.mjs';

const DAY = 86_400;
const MINUTE = 60;
const defaultConfig = await loadConfig();

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function same(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function patchFields(patch, allowed) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Changes must be an object.');
  }
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !allowed.includes(key))) {
    throw new Error(`Supported changes: ${allowed.join(', ')}.`);
  }
}

function person(state, operatorId) {
  const operator = state.operators.find(item => item.operatorId === operatorId);
  if (!operator) throw new Error('Unknown simulated operator.');
  return operator;
}

function protocolOperator(operator) {
  const { operatorId, currency, rateMinorPerHour } = operator;
  return { operatorId, currency, rateMinorPerHour };
}

function nowAt(state, config) { return Date.parse(config.clock.startsAt) / 1_000 + state.day * DAY; }

function addCompletion(state, task, operatorId, workedSeconds, completedAt) {
  const operator = protocolOperator(person(state, operatorId));
  const id = ++state.serial;
  task.votes.push(prepareVote({
    completion: {
      scope: task.policy.scope,
      completionId: `simulation-completion-${id}`,
      assignmentId: `simulation-performance-${id}`,
      operatorId, workedSeconds, completedAt,
    },
    operator,
  }));
}

function initialState(config) {
  const baseTime = Date.parse(config.clock.startsAt) / 1_000;
  const seedTime = baseTime - config.clock.seedVoteAgeDays * DAY;
  const state = {
    taskId: config.tasks[0].taskId, day: 0, serial: 0,
    operators: config.operators.map(operator => ({ ...operator, currency: config.currency })),
    tasks: Object.create(null),
  };
  for (const definition of config.tasks) {
    const { taskId, taskVersion, name, baselinePriceMinor, baselineMinutes } = definition;
    const baselineSeconds = baselineMinutes * MINUTE;
    const scope = {
      agreementId: `simulation-agreement-${taskId}`, taskId, taskVersion,
      ...config.scope, currency: config.currency,
    };
    const task = {
      name,
      policy: {
        policyId: `simulation-policy-${taskId}`, version: 1, scope,
        validFrom: seedTime, validUntil: baseTime + config.policy.validityDays * DAY,
        baselinePriceMinor, baselineSeconds, decayWindowSeconds: config.policy.decayDays * DAY,
        minimumOperators: config.policy.minimumOperators,
        minimumEffectiveVotes: config.policy.minimumEffectiveVotes,
        demandSensitivityBps: config.policy.demandSensitivityBps,
        maxDemandPremiumBps: config.policy.maxDemandPremiumBps,
        demandMaxAgeSeconds: config.policy.demandMaxAgeSeconds,
        quoteLifetimeSeconds: config.policy.quoteLifetimeSeconds,
      },
      demand: {
        requestedSeconds: config.demand.requestedMinutes * MINUTE,
        availableSeconds: config.demand.availableMinutes * MINUTE,
      },
      votes: [], acceptance: null, approvedSeconds: null,
    };
    state.tasks[taskId] = task;
    for (const operator of state.operators) {
      addCompletion(state, task, operator.operatorId, baselineSeconds, seedTime);
    }
  }
  return state;
}

/**
 * SIMULATION ONLY. Exact comparisons prevent this adapter from accepting
 * omitted or altered scenario records. They are not signatures or identity
 * checks and this adapter must never be reused as a production verifier.
 */
function simulationOnlyVerifier({ task, votes, demand, now }) {
  const visible = new Map(votes.map(vote => [vote.completionId, vote]));
  return {
    verifyPolicy(policy, at) {
      return at === now && same(policy, task.policy);
    },
    verifyBallotSet(received, policy, at) {
      return at === now && same(policy, task.policy) && same(received, votes);
    },
    verifyVote(vote, policy) {
      return same(policy, task.policy)
        && same(vote.scope, task.policy.scope)
        && same(vote, visible.get(vote.completionId));
    },
    verifyDemand(received, policy, at) {
      return at === now && same(policy, task.policy) && same(received, demand);
    },
    verifyAcceptance(acceptance) {
      return Boolean(task.acceptance)
        && task.acceptance.acceptedAt <= now
        && same(acceptance, task.acceptance)
        && same(acceptance.scope, task.policy.scope);
    },
    verifyWorkingTime(acceptance, approvedSeconds) {
      return same(acceptance, task.acceptance)
        && task.acceptance.acceptedAt <= now
        && approvedSeconds === task.approvedSeconds;
    },
  };
}

function derive(state, config) {
  const task = state.tasks[state.taskId];
  const now = nowAt(state, config);
  // Timeline scrubbing changes the evaluation date, not stored history.
  // Expired votes stay in the verified set; future completions are not yet in it.
  const votes = task.votes.filter(vote => vote.completedAt <= now);
  const demand = {
    scope: task.policy.scope, measuredAt: now, windowSeconds: config.demand.windowMinutes * MINUTE,
    ...task.demand,
  };
  const adapter = simulationOnlyVerifier({ task, votes, demand, now });
  const terms = evaluateTask({ policy: task.policy, votes, asOf: now, demand }, adapter);
  const quotes = Object.fromEntries(state.operators.map(operator => [
    operator.operatorId,
    quoteTask({ terms, operator: protocolOperator(operator), at: now }),
  ]));
  const acceptance = task.acceptance?.acceptedAt <= now ? task.acceptance : null;
  const settlement = acceptance && task.approvedSeconds !== null
    ? settlementMinimum({ acceptance, approvedSeconds: task.approvedSeconds }, adapter)
    : null;
  return freeze(clone({
    taskId: state.taskId, taskName: task.name, day: state.day, now,
    scope: task.policy.scope, policy: task.policy, demand,
    operators: state.operators, votes, terms, quotes, acceptance, settlement,
    approvedSeconds: acceptance ? task.approvedSeconds : null,
    tasks: config.tasks.map(({ taskId, name }) => ({ taskId, name })),
  }));
}

/**
 * All inputs use integer minor currency units and seconds. Mutations are atomic:
 * the prospective scenario must pass the real Rust/WASM evaluator first.
 * Personal R is shared across task categories; existing votes retain their R.
 * Policy edits are scenario controls, not enacted collective agreements.
 */
export function createSimulation(input = defaultConfig) {
  const config = validateConfig(input);
  const maxOffer = maximumOfferMinor(config);
  const money = createMoney(config);
  let state = initialState(config);

  function change(edit) {
    const candidate = clone(state);
    edit(candidate, candidate.tasks[candidate.taskId]);
    const result = derive(candidate, config);
    state = candidate;
    return result;
  }

  return Object.freeze({
    config,
    view() { return derive(state, config); },
    setTask(taskId) {
      return change(candidate => {
        if (!Object.hasOwn(candidate.tasks, taskId)) throw new Error('Unknown simulated task.');
        candidate.taskId = taskId;
      });
    },
    setDay(day) {
      return change(candidate => { candidate.day = integer(day, 'Day', 0, config.clock.timelineDays); });
    },
    updateOperator(operatorId, rateMinorPerHour) {
      return change(candidate => {
        person(candidate, operatorId).rateMinorPerHour = integer(
          rateMinorPerHour, 'Personal R', 1, config.limits.rateMinorPerHour,
        );
      });
    },
    updatePolicy(patch) {
      return change((_candidate, task) => {
        patchFields(patch, ['baselinePriceMinor', 'baselineSeconds', 'decayWindowSeconds']);
        for (const [field, value] of Object.entries(patch)) {
          const maximum = field === 'baselinePriceMinor' ? config.limits.baselinePriceMinor
            : field === 'decayWindowSeconds' ? config.limits.decayDays * DAY
              : config.limits.workMinutes * MINUTE;
          task.policy[field] = integer(value, field, 1, maximum);
        }
        task.policy.version += 1;
      });
    },
    updateDemand(patch) {
      return change((_candidate, task) => {
        patchFields(patch, ['requestedSeconds', 'availableSeconds']);
        for (const [field, value] of Object.entries(patch)) {
          task.demand[field] = integer(value, field, 0, config.limits.demandMinutes * MINUTE);
        }
      });
    },
    complete(operatorId, workedSeconds) {
      return change((candidate, task) => {
        integer(workedSeconds, 'Worked time', 1, config.limits.workMinutes * MINUTE);
        addCompletion(candidate, task, operatorId, workedSeconds, nowAt(candidate, config));
      });
    },
    accept(operatorId, priceMinor) {
      return change((candidate, task) => {
        if (task.acceptance) throw new Error('This task already has a simulated acceptance. Reset to start again.');
        integer(priceMinor, 'Accepted price', 1, maxOffer);
        const current = derive(candidate, config);
        task.acceptance = prepareAcceptance({
          assignmentId: `simulation-accepted-${++candidate.serial}`,
          terms: current.terms, operator: protocolOperator(person(candidate, operatorId)),
          priceMinor, at: current.now,
        });
        task.approvedSeconds = null;
      });
    },
    settle(approvedSeconds) {
      return change((candidate, task) => {
        if (!task.acceptance || task.acceptance.acceptedAt > nowAt(candidate, config)) {
          throw new Error('Accept an assignment at or before this simulation day first.');
        }
        task.approvedSeconds = integer(approvedSeconds, 'Approved total time', 1, config.limits.workMinutes * MINUTE);
      });
    },
    reset() {
      const candidate = initialState(config);
      const result = derive(candidate, config);
      state = candidate;
      return result;
    },
    exportSnapshot() {
      return freeze(clone({
        simulation: true, formatVersion: 1,
        configuration: config,
        units: { currency: config.currency, currencyDecimals: money.digits, money: 'minor currency units', time: 'seconds' },
        assumptions: [
          'Fictional, unsigned identities, agreements, completions and approved time; no real authentication or legal eligibility is established.',
          `Calculations use the project Rust/WebAssembly protocol with ${config.currency} minor units and seconds.`,
          'Each hypothetical completion contributes one vote; the current personal R is retained in that vote.',
          'Timeline scrubbing hides future completions and acceptances without deleting stored history.',
          'Policy and personal-setting edits affect the current scenario, not a historical reconstruction; accepted terms remain locked.',
          'Synthetic demand is refreshed at every simulation date; it is not measured market activity.',
          'Policy edits are scenario controls and do not enact or authorize a real collective agreement.',
        ],
        scenario: state,
        current: derive(state, config),
      }));
    },
  });
}

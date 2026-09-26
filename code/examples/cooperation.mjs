// Fictional local simulation. These adapters authenticate NOTHING and must never
// be used in a deployment. Real adapters must satisfy the protocol specification.
import { prepareVote, evaluateTask, quoteTask, prepareAcceptance, settlementMinimum }
  from '../protocol/cooperation.mjs';

const now = 1801000000;
const scope = {
  agreementId: 'example-labour-agreement',
  taskId: 'site-photo',
  taskVersion: '1',
  jurisdiction: 'NO',
  region: 'Oslo',
  counterpartyId: 'example-business-requester',
  currency: 'NOK',
};
const policy = {
  policyId: 'example-site-photo-policy',
  version: 1,
  scope,
  validFrom: now - 86400,
  validUntil: now + 86400,
  baselinePriceMinor: 12000,
  baselineSeconds: 1800,
  decayWindowSeconds: 30 * 86400,
  minimumOperators: 3,
  minimumEffectiveVotes: 2,
  demandSensitivityBps: 2500,
  maxDemandPremiumBps: 5000,
  demandMaxAgeSeconds: 300,
  quoteLifetimeSeconds: 60,
};
const votes = [30000, 32000, 28000].map((rateMinorPerHour, index) => {
  const operatorId = `example-operator-${index + 1}`;
  return prepareVote({
    completion: {
      scope,
      completionId: `example-completion-${index + 1}`,
      assignmentId: `example-assignment-${index + 1}`,
      operatorId,
      completedAt: now - 3600,
      workedSeconds: 1800,
    },
    operator: { operatorId, currency: 'NOK', rateMinorPerHour },
  });
});
const simulationOnlyAdapter = {
  verifyPolicy: () => true,
  verifyBallotSet: () => true,
  verifyVote: () => true,
  verifyDemand: () => true,
  verifyAcceptance: () => true,
  verifyWorkingTime: () => true,
};
const terms = evaluateTask({
  policy,
  votes,
  asOf: now,
  demand: { scope, measuredAt: now, windowSeconds: 3600,
    requestedSeconds: 7200, availableSeconds: 3600 },
}, simulationOnlyAdapter);

// A general personal setting can be reused across task categories in this currency.
const operator = { operatorId: 'example-operator-1', currency: 'NOK', rateMinorPerHour: 50000 };
const quote = quoteTask({ terms, operator, at: now });
const acceptance = prepareAcceptance({
  assignmentId: 'example-next-assignment', terms, operator,
  priceMinor: quote.minimumPriceMinor, at: now,
});
const settlement = settlementMinimum({ acceptance, approvedSeconds: 2400 }, simulationOnlyAdapter);

console.log('SIMULATION ONLY: fictional agreement, identities, votes and approved time.');
console.log(JSON.stringify({
  currency: scope.currency,
  units: 'minor currency units; seconds',
  collectiveMinimum: terms.minimumPriceMinor,
  expectedSeconds: terms.expectedSeconds,
  demandPremiumBps: terms.premiumBps,
  personalMinimum: quote.minimumPriceMinor,
  acceptedPrice: acceptance.priceMinor,
  settlementFor2400Seconds: settlement,
}, null, 2));

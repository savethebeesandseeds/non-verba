# Operator cooperation protocol v1

Status: executable reference specification, 26 September 2026. Not a live
marketplace or a declaration of regulatory compliance. See
[the regulatory boundary](REGULATORY_BOUNDARY.md) before integration.

## Purpose and authority

Operators directly influence the minimum remuneration for a defined task through
their completed work. There is no board and no delegated pricing discretion in the
calculation. Each eligible performance authorizes one ballot with equal starting
weight; its influence then decays with time. Frequent performers have greater
total influence. No weighting by wealth, reputation, bid value or job duration is
added to the ballot weight.

The active collective agreement authorizes this calculation and its policy. The
completion ballots determine the current price/time observations; they do **not**
authorize arbitrary code or policy amendments. Changes to the baseline, decay,
admission rules, task definition, data sources or formula require the agreement's
direct member approval and counterparty amendment process. This library neither
invents that legal process nor allows an administrator's unapproved policy to
stand in for it: `verifyPolicy` must reject an unapproved revision.

A scope is exactly `(agreementId, taskId, taskVersion, jurisdiction, region,
counterpartyId, currency)`. One policy applies to one covered business counterparty.
Unknown scope fields are rejected so restrictions are never silently ignored.
Votes cannot cross scope boundaries. Materially changing a task changes its task
version. Ordinary policy revisions may retain existing ballots in the same scope.
Every participant must use the same normalized work unit; renaming, splitting or
bundling assignments cannot silently redefine that unit or manufacture votes.

## Quantities and records

All timestamps are nonnegative integer Unix seconds. Durations are positive integer
seconds. Money is positive integer minor currency units in one specified currency;
the deployment must agree on that currency's minor-unit convention. No floating
money, conversion or implied exchange rate is used. Individual inputs and outputs
must fit JavaScript safe integers so native and web participants use the same
range. Rust uses exact `u128` intermediate monetary and voting arithmetic;
unsupported output ranges return errors rather than lose precision.

`priceMinor` means labour remuneration retained before personal tax, **after**
platform/service deductions. Reimbursed expenses and taxes are outside this labour
amount. Price and time are the only working-condition quantities represented here;
safety, leave, insurance and other applicable rights still require contractual and
legal treatment. The protocol does not price away those obligations.

The Operator's general setting is:

```js
{ operatorId: 'operator-1', currency: 'NOK', rateMinorPerHour: 30000 }
```

This is R = 300 NOK/hour, reusable across compatible tasks. Changing it affects
future ballot candidates and quotes. A previously authorized ballot or accepted
assignment is never recalculated from a later personal setting. Personal settings
are not a public directory of reservation prices.

An authenticated completion contains `scope`, `completionId`, `assignmentId`,
`operatorId`, `completedAt` and `workedSeconds`. Time includes all work covered by
the agreement, including required preparation and evidence production. It must be
approved or resolved under the agreement's dispute process, not inferred from a
photo timestamp or accepted solely at one party's discretion.

`prepareVote({completion, operator})` creates an **unsigned candidate** with those
fields plus `version: 1`, `rateMinorPerHour` and `priceMinor`. The Operator must
authorize the complete record, directly or through a previously authorized
automatic-casting setting. Completion grants a vote; it does not authorize a
Requester to speak for the Operator. A completion can be left without a ballot.
Recorded ballots are immutable in v1; a dispute must resolve admission before a
ballot enters a certified snapshot. Completed time determines age even if the
ballot is submitted later, so late submission cannot refresh its weight.

## Calculation

For ballot i, with personal rate R_i and measured duration T_i:

```text
proposed_price_i = ceil(R_i * T_i / 3600)
weight_i = max(0, H - (asOf - completedAt_i))
```

H is the policy's decay window. Normalized weight is `weight_i / H`: 1 at
completion, 0.5 halfway through the window, and 0 at expiry. Integer weights give
exactly the same median without floating-point rounding. Future completions fail
validation. Duplicate completion IDs and duplicate `(assignmentId, operatorId)`
pairs are rejected, even if the repeated ballot has expired.

When the active ballots meet **both** the distinct-Operator threshold and the
minimum effective vote mass:

```text
voted_price = upper_weighted_median(proposed_price_i, weight_i)
expected_time = upper_weighted_median(T_i, weight_i)
base_price = max(agreed_baseline_price, voted_price)
```

The upper weighted median is the first ordered value whose cumulative weight is
strictly greater than half the total. An exact half-weight tie selects the higher
value. Prices and durations are aggregated separately; they need not originate
from the same ballot. The result is a collective task floor and an expected time,
not a claim that every Operator has the same hourly rate.

Effective vote mass is `sum(weight_i) / H`. For example, four half-aged votes have
mass 2. `minimumEffectiveVotes` is an integer threshold on that normalized mass;
`minimumOperators` counts distinct Operators with nonzero weight. These thresholds
do not alter individual ballot weights. If support is insufficient, **both** price
and expected time use their agreement-approved baseline values. There is no zero
price/time fallback. A new task version starts with these baselines.

Decay weakens relative influence, not monetary value. A median can change in
steps; this is not price smoothing. Missing support may lower the current price to
the approved baseline. The baseline itself never decreases through demand, expiry
or a new ballot. It can change only through an authenticated policy amendment.

### Optional demand response

The only demand inputs are requested labour-seconds D and available labour-seconds
A, measured over the same task scope and time window. With sensitivity alpha and
cap expressed in basis points (10,000 bps = 100%):

```text
premium_bps = min(cap_bps, floor(alpha_bps * max(0, D - A) / A))
collective_minimum = ceil(base_price * (10000 + premium_bps) / 10000)
individual_minimum = max(collective_minimum, ceil(personal_R * expected_time / 3600))
```

If D and A are zero, the premium is zero. If D > 0 and A = 0, it is the cap.
Zero sensitivity disables the premium, including at zero capacity. v1 caps demand
premiums at 100%; a larger model requires a reviewed protocol revision.

A verified missing or stale demand snapshot produces no premium and reports that
state. When demand is enabled, the adapter must attest true unavailability for a
missing snapshot, and must reject an omitted or stale snapshot if a newer eligible
one exists at the cutoff. A caller cannot opt out of a premium by omitting its data.
An invalid or unauthenticated supplied snapshot is rejected. Missing demand must
not be displayed as measured zero demand. Quotes cannot outlive the current demand
snapshot's freshness window. Low demand removes only the premium.

The deployment must define the demand window, smoothing, source and normalization
in the approved agreement, and enforce them in `verifyDemand`. Use funded,
deduplicated requests and corroborated capacity; raw self-declared availability
is not trustworthy. Self-dealing jobs and synthetic demand need admission controls.
This deterministic calculator does not claim those measurements are manipulation
proof. The feature may be disabled until credible data exists.

## Policy fields

No production policy values are supplied by default. The example uses fictional
values, including 30-day linear decay; these are not recommended market prices.

| Field | Meaning |
| --- | --- |
| `policyId`, `version`, `scope` | Identity, positive revision, exact covered scope |
| `validFrom`, `validUntil` | Inclusive start, exclusive expiry |
| `baselinePriceMinor`, `baselineSeconds` | Protected task floor and fallback duration |
| `decayWindowSeconds` | H, the positive linear decay window |
| `minimumOperators` | Distinct recent performers needed for ballot-based terms |
| `minimumEffectiveVotes` | Required normalized vote mass |
| `demandSensitivityBps`, `maxDemandPremiumBps` | Response strength and cap; zero disables |
| `demandMaxAgeSeconds` | Exclusive demand-snapshot freshness limit |
| `quoteLifetimeSeconds` | Maximum time before a calculated offer must be refreshed |

## API and verification contract

`evaluateTask({policy, votes, asOf, demand?}, adapter)` returns a deeply frozen,
JSON-serializable result containing the exact scope, policy version, timestamp,
validity, support status, vote/operator counts, exact weight fraction, median
price, base price, expected time, premium and final collective minimum.

The complete JSON record inputs are copied and frozen before calling the adapter.
Required adapter methods must synchronously return **exactly true** after checking
their facts; absent, false, truthy strings and Promise results are rejected. They
can consult previously authenticated data. If signature or registry verification
is asynchronous, complete it upstream before calling the calculator.

| Adapter method | What the deployment must authenticate |
| --- | --- |
| `verifyPolicy(policy, asOf)` | Reviewed qualifying labour scope, covered counterparties, member approval, counterparty assent, active and authorized version; reject arbitrary backdating |
| `verifyBallotSet(votes, policy, asOf)` | Complete eligible ballot snapshot at the agreed cutoff; no omitted high or low votes, fabricated empty sets or suppressed submissions |
| `verifyVote(vote, policy)` | Real eligible worker, actual unique completion, approved time, Operator authorization of the rate/price snapshot, no replay or wash task |
| `verifyDemand(demand, policy, asOf)` | Latest eligible snapshot at the cutoff, source, same scope/window, approved measurement method and exclusions; for null, attest true unavailability. Required for supplied snapshots and for missing data when sensitivity and cap are both nonzero |
| `verifyAcceptance(record)` | Both parties' authorization of the exact accepted assignment and terms, including proportional overruns |
| `verifyWorkingTime(record, approvedSeconds)` | Final agreed or adjudicated total covered time, not unilateral device telemetry |

The calculator rejects duplicates in the supplied batch. A durable upstream ledger
must also prevent reuse across batches/devices and certify snapshot completeness.
Cryptographic key control is not proof of one human, legal eligibility, physical
completion or truthful elapsed labour. The camera's existing evidence signatures
cannot fill those roles by themselves. Do not copy the always-true **simulation**
adapter into an application.

### Rust, WASM and host boundary

The authoritative code is `code/crates/nonverba-cooperation`. It builds as both a native
Rust library and a `wasm32-unknown-unknown` module using Rust 1.96.0 and
`wasm-bindgen` 0.2.122, matching the sensor core. The JSON field names, formulas,
money units, tie rule and verification requirements remain protocol v1.

`cooperation_plan(operation, input_json)` validates the input and returns JSON
`{value, checks}`, where each check is `{method, paths}`. Paths select arguments
from the exact input snapshot (an absent optional demand field resolves to null).
These compact descriptors avoid copying full policy/proof metadata for each vote.
Its value is **provisional**.
The plan is a transport boundary, not a signed admission certificate. Public
callers must not treat it as authorized terms or skip its required checks.

The JavaScript host wrapper preserves the six public functions above. It loads the
compiled WASM, rejects non-integral/non-finite or unsafe numeric transport values,
freezes the input snapshot and returned record graph, resolves check arguments
against that same snapshot, and executes every required adapter check.
It returns the result only after all checks return exactly true. Calculations,
validation of protocol fields and selection of required checks live in Rust.
There is no JavaScript numerical fallback. Input JSON is limited to 64 MiB before
parsing; the ballot-count limit is 100,000.

For native integrations, `execute_json(operation, input_json, verifier)` performs
the same plan and requires the supplied verifier to approve each check before
returning the value. Verification failures stop execution without releasing an
authorized result. Constructors and price arithmetic require no admission checks;
evaluation and settlement retain the full verification requirements above.

Full JSON metadata on policies, votes, demand, terms and acceptances is preserved
for verification; unknown scope fields are still rejected. Signatures must use the
deployment's defined canonical encoding, not assume JSON object-key ordering.
The JSON API accepts JSON data, not functions or JavaScript object prototypes.

Browser and module-Worker imports fetch the generated WASM from the same origin;
Node reads the same binary from disk. Callbacks cannot cross a Worker message
boundary. Keep them with their authenticated data, or install the real adapters
in the Worker. Android's WebView can use the same web build; this repository does
not change or rebuild the separate sensor application's APK.

## Offers, acceptance and settlement

`quoteTask({terms, operator, at})` uses a locally computed evaluation result, or an
equivalent authenticated upstream result. It rejects stale terms and incompatible
currency. It returns the greater of the collective minimum and personal R applied
to expected time. **Never feed arbitrary remote JSON into this trusted-terms API.**
The calculator supplies price validation, not network-message authentication.

`prepareAcceptance({assignmentId, terms, operator, priceMinor, at})` rejects a price
below that individual minimum. Higher prices remain unrestricted. Its immutable
result is a candidate for both parties to authorize, not a signature, legal
contract, binding vote or transferred payment. The agreement must expressly
authorize the quote-validity window and prospective amendment behavior.

`settlementMinimum({acceptance, approvedSeconds}, adapter)` checks authenticated
acceptance and final working time. It never looks at newer votes or current R:

```text
minimum_settlement = max(accepted_price,
                        ceil(accepted_price * approved_seconds / accepted_expected_seconds))
```

Faster work retains the accepted task price. Approved overruns preserve at least
the accepted effective rate (and thus personal R). This proportional rule must be
visible before acceptance. Unapproved scope changes require agreement or dispute
resolution; an Operator's unverified time claim is not automatically payable.
Cancellation, partial completion and expenses need separate agreed terms in v1.
A payment integration must ensure retained labour payment meets this returned
minimum; this module does not execute payment or collect debts.

## Privacy and operational limits

Publish aggregate calculation receipts and the approved policy, not a public list
of identities, personal R settings or individual ballots. Price/time pairs can
reveal R even if its explicit field is removed. A trusted audit mechanism needs
controlled access to authenticated records to verify completeness and reproduce
calculations. Set retention periods and access controls separately from vote decay;
expired economic influence does not automatically delete personal data.

This implementation does not supply a ballot service, member enrollment, policy
amendment ballot UI, requester-assent service, cryptographic transport, persistence,
task taxonomy authority, identity recovery, independent dispute body or payment
processor. Those are explicit integration boundaries. A deployment cannot certify
itself lawful by returning true in a verifier. It also cannot enforce a union floor
against nonparticipating work outside the covered agreement.

## Maintenance and verification

The Rust core has no network, filesystem, wall-clock, randomness or database
access; the host wrapper only loads the compiled asset and invokes supplied
verifiers. Callers provide time explicitly. Rust dependency versions and the
toolchain are pinned; no npm runtime dependencies are required. Tests use
synthetic records and clearly identified trust stubs.
Run `cargo test --locked --workspace`, `node tools/build-wasm.mjs`,
`node --test test/cooperation.test.mjs test/wasm.test.mjs`
and `node examples/cooperation.mjs` from the repository's `code/` directory.
The optional browser check is `node test/browser-smoke.mjs`. The WASM suite retains
the original behavior tests and adds real-binary and boundary regression checks.
Changes to the formulas, tie rule, work unit, decay semantics or settlement rule
require versioned specification changes and regression tests. Admission decisions
and source verification belong in adapters, not scattered around the arithmetic.

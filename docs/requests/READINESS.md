# Limitations and production readiness

30 September presentation increment: `report-analysis` now provides a readable
case review before the full independent inspection. The separate
[lifecycle specification](DISPUTE_LIFECYCLE.md) records consent requirements and
open process decisions; it adds no executable closure or escalation mechanism.
The implementation and validation record (local review record, not included in this source release)
records **78 passing deterministic companion tests, 2 opt-in model tests ignored**,
formatting and strict Clippy. This increment changes no core financial rule,
signed schema, model or prompt and performs no model-quality experiment.

The separate [dispute-priority analysis companion](DISPUTE_PRIORS.md) has completed
DP-2 as a **synthetic workflow-integration increment**, under the
owner's closeout scope (local review record, not included in this source release).
Workflow acceptance does not establish model-quality acceptance. Existing
experiments and their negative findings remain retained; the current local Qwen
model remains a workflow test component. Mode is `ANALYSIS_ONLY`, financial
authority `NONE`, and settlement policy `UNSPECIFIED`.

The retained DP-2 evidence records 176 passing core tests, 72 distinct companion
checks (71 in the full suite plus one later regression), and 40 validated portable
replays. These are previous execution results, separate from the presentation
increment above. They do not establish reliable reasoning, factual truth or
fair settlement. The DP-1 record (local review record, not included in this source release)
and older validation records below remain historical evidence.

The current implementation is a **protocol-2 prototype, package 0.2.1**. It is not a deployed
marketplace, financial guarantee, security proof, legal contract review or
jurisdiction-specific compliance determination. The constitutional principle and
the exact corrective non-retraction clause appear in [the specification](SPECIFICATION.md).

[Participant notes](PARTICIPANT_NOTES.md) explain this boundary in plain language.
[Agreement notes AN-2](AGREEMENT_NOTES.md) map proposed wording to the code, separate
signed commitments from executable rules, and retain the remaining deployment
decisions. They are documentation for review, not adopted terms or new guarantees.

The AN-2 acceptance record (local review record, not included in this source release)
closes the documentation and consent clarification pass for synthetic development.
Its review scope is separate from executed checks below. The participant
walkthrough is explicitly deferred; no comprehension or live-participant result
is claimed. Subsequent documentation maintenance changes navigation and clarifies
existing limits; the accepted export retains the exact reviewed bytes.

## Corrective boundary

The earlier protocol-1 suite passed 83 tests and ten native/WASM parity cases.
Subsequent review reconstructed six additional cases and all six failed against
that baseline: mediator receipt-slot poisoning, payee equivocation, unordered
overpayment, a mediator stream fork affecting an otherwise authenticated claim,
use of a retired artifact rule, and incomplete manifest-integrity reporting.
Those earlier pass counts are historical evidence, not current safety assurance.
During correction, five further regressions were reproduced as failing before
their fixes: three contextual-dependency/expense cases and two signed-frontier
cases that could replace accrued work/fee due conditions. These cases are now
part of the passing suite below; they do not turn that suite into a security proof.

Protocol 2 changes the financial authorization model. Signed receipts/releases
name exact minor-unit intervals on immutable obligation principals. Credit and
release grants retain independent identities and count overlapping coverage once.
A contradiction cannot revoke another party's established coverage. All-party
reversal targets only the identified grant's named units. Reports expose grant
provenance and overlap instead of resolving financial rights by event/hash order.

Amendments sign an observed causal frontier, preserved claims and exact
grandfathered actions. Positive knowledge of a successor prevents fresh exercise
of retired powers; unknown ordering preserves an old claim as unresolved.
Existing milestone principals and identities remain fixed. The protocol does
not use a server clock or omitted history as proof of consent, expiry or waiver.
The full signed-frontier ancestry preserves established work/fee due conditions
even when unrelated dependencies make an older proof deeper than a successor's.
That ordering protection remains separate from authority to exercise a rule.

An ambiguous omitted frontier or conflict between jointly authorized expense
claims can prevent a single active projection. `PARTIAL_UNRESOLVED_V2` reports
each individually validated proof in `unresolved_rights`, including conditional
principal, discharge and release amounts. These alternatives are not additive,
zero debt or a new effect of retired authority. Receipts on established historical
obligations stay active; conditional receipts retain their numeric credit without
inventing an active entitlement.

Original protocol-1 signatures are not regenerated or upgraded. Legacy inspection
authenticates the original Request, quote, Agreement, action and event contexts
and retains their proofs. Its report says `financial_projection:
LEGACY_UNRESOLVED`, exposes `recognized_legacy_proofs`, and supplies no aggregate
obligations/payments/effects or readiness. An empty legacy obligation list means
**no supported aggregate projection**, never zero debt or extinguished claims.
No automatic migration or renewed consent is inferred.

## NV2-01 follow-up

The follow-up review identified a further counterexample in protocol 2: late
delivery or completion of unrelated R/O expense authorizations could cause
ancestor replay to reject an independently established M service fee. This
required a focused validation-boundary correction, retaining protocol 2's grants,
scoped reversals, cutover and evidence-integrity model.

The supplied attachment contained only the review text. Its advertised evidence
archive, proposed Rust tests and independent verification scripts were absent.
The two regression tests and synthetic vectors were reconstructed locally from
that description; they are not copies of unavailable reviewer artifacts. Before
changes, all 105 workspace entries in the 107-file inspection export matched
their SHA-256 and byte counts, including all 49 protocol/package/document files.
The other two export entries are embedded source briefs.

The actual native baseline (local review record, not included in this source release)
records **two failing tests** after all setup assertions passed. Both prefixes
passed honest M pre-signing and established the exact activation with fee
principal/balance 500. Appending the expense records or completing their O
signatures changed the activation to `REJECTED` with `EXPENSE_CAP`, with no active
fee or conditional entry. Append, both merge directions and reversed delivery
were evaluated. The preserved baseline vectors (local review record, not included in this source release)
contain the original inputs, real pre-fix reports and checksums.

The correction separates authenticated causal knowledge from closed, typed
required-effect proof. Partial proposals need a valid shape and at least one
actual pinned signature to contribute attributed knowledge; financial admission
still requires complete rule-specific authority. Unrelated expenses cannot veto
service activation, acknowledgment or artifact invocation. Same-category expense
caps and actual named obligation/grant proofs remain required. Full knowledge is
retained for successor/cutover checks. The independently established fee must
remain active; merely marking it conditional does not resolve NV2-01.
The patch version identifies this validation correction without changing the
protocol-2 wire version. Applied effects expose their finite financial witness
references separately from generic context in `effects[].proof_references`.

A further executed follow-up regression exposed due-condition substitution across
three revisions: a later duplicate acknowledgment could carry prospective terms
into a conditional projection despite the original debt already having accrued.
The correction retains validated, nonconditional establishment witnesses for the
same stable obligation, preserving original due terms without replaying unrelated
financial context. Conditional old claims remain conditional. Final validation
below includes this case as well as the late-context variants.

The corrected prefix, partial-authorization prefix and full extension retain F
as `APPLIED`, with active fee principal/balance 500. The extension separately
reports the two expenses as `CONFLICTED`; F is not moved to `unresolved_rights`.
Negative controls retain rejection of absent M authority, unsupported service
prerequisites, wrong commitment IDs, missing obligation proofs and fresh retired
rules with demonstrated successor knowledge. Existing conditional historical
claims retain their separate semantics. These are tested cases, not an assertion
that every possible history is safe.

## Supported local scope

The shared Rust package provides strict versioned records, P-256/SHA-256
signatures, pinned role keys/policy, deterministic verification, attributed
per-author streams, exact artifact/commit–reveal checks, itemized financial grants,
nonfinancial assurance commitments, and a local signing/export-verification CLI.
Requester and Operator are roles; agents and embodied robots can use the same
records under an independently established authority.

R's signed Request accepts its embedded platform terms. O's signed quote accepts
their exact hash. These are separate from the R/O/M Assignment signatures. No
account-enrollment database or independently established legal identity is implied.
No command moves task funds, charges a commission or gives M refund/payment power.

[Settlement handling](SETTLEMENT_HANDLING.md) distinguishes the implemented scoped
R/O release from model analysis and future settlement policy. The enabled core
action releases exact units of existing R-to-O compensation/expense entitlements
with both parties' signatures and required proof. It does not create new payment
or amendment authority, release M's rights, or establish bank settlement. No
automatic model-to-Action bridge exists. A model's interpretation of evidence or
question disposition is not a verified fact or contractual authority.

The companion's preflight path reviews exact signed profiles and analysis settings
before base endorsement. Its local acceptance record is unsigned workflow
evidence. The base and all-party annex form separately, and failure to complete
extended setup does not retract base rights. These controls establish the checked
workflow behavior; they do not establish comprehension or reliable reasoning.

Ordinary completion, supplementary and reveal manifests receive separate
attachment-integrity reports. Missing bytes, incorrect digest/length, signature
authenticity, commitment opening, metadata declarations and physical truth remain
different findings. Missing evidence is not an automatic forfeiture rule.

Assurance enables only an explicit nonfinancial M service with
`financial_compensation: false`. Activation is an undertaking, not proof of
performance, solvency or coverage. Any protection fee is a separate identified
obligation; it is never deducted from O compensation. Each changed Agreement
requires a fresh supported service activation. Unsupported payment preconditions
block readiness; unsupported service prerequisites prevent activation.

The native client supports exact preview/digest confirmation, encrypted software
keys, signed input/output, encrypted immutable import/merge snapshots and explicit
plaintext export. Snapshot plaintext is limited to 2 MiB; protocol JSON permits
4 MiB. Vault backups must include their sibling signing-guard directory.
Windows/filesystem access, guard rollback, passphrase input and distribution still
need production review. The client does not provide hardware monotonic storage,
account reset, trusted web delivery or a form-building marketplace UI.

## Validation evidence

All new build/test execution is confined to the approved managed Debian container.
Use the [container procedure](../development/CONTAINER_PLAN.md) and package-specific commands
in [the package README](../../code/requests/README.md). Do not fall back to a host
Rust, Node, wasm-bindgen or Java toolchain.

The historical package-0.2.1 core run on **28 September 2026** passed **152 native tests,
0 failures, 0 ignored**, including the explicitly enabled Node interoperability
test and independent software-vault CLI lifecycle. Formatting, all-target Clippy
with warnings denied, the release WASM build and binding generation, and **21
native/WASM parity cases** passed. Tool versions were Rust/Cargo 1.96.0 (rustc
`ac68faa20`, 25 May 2026), Node 22.23.3 and wasm-bindgen 0.2.122.

| Native test group | Passed |
| --- | ---: |
| Coalitions | 14 |
| Amendment cutover | 10 |
| Typed effect dependencies and accrued provenance | 8 |
| Evidence integrity | 9 |
| Historical/contextual rights | 3 |
| Authenticated causal knowledge | 3 |
| Immutable legacy compatibility | 5 |
| Lifecycle | 12 |
| Local signing/storage/CLI | 10 |
| Cryptographic/encoding primitives | 8 |
| NV2-01 late context and negative controls | 7 |
| Original review regressions | 6 |
| Financial unit grants | 10 |
| Transcript | 33 |
| Verifier edge cases | 14 |
| **Total** | **152** |

The native test log (local review record, not included in this source release),
build-check log (local review record, not included in this source release) and
runtime-parity log (local review record, not included in this source release) retain the actual
results. The build log preserves an initial test-helper Clippy failure and its
subsequent corrected passing run; that earlier failure is not hidden.

The previous package-0.2.0 snapshot passed 134 native tests and 18 parity cases;
those preserved runs predated NV2-01. The current suite retains those tests and
adds 18 across knowledge, late-context and typed-dependency coverage. Legacy
evidence remains authenticated without invented balances or migration. Prior
snapshots, baseline inputs and pre-fix reports remain unchanged.

The final vectors (local review record, not included in this source release) retain
byte-identical inputs from seven earlier corrected cases and three locally
reconstructed NV2-01 cases, with fresh 0.2.1 native reports and explicit provenance.
The parity run compares these ten vectors plus eleven built-in cases, including
historical v1 inspection. Original native reports were not overwritten.

Current build/test reproduction commands are in
[the package README](../../code/requests/README.md) and
[integration guide](INTEGRATION.md). The historical command below records the
container used on 28 September; that container is now preserved and stopped.
Use the inspected active container from [the container procedure](../development/CONTAINER_PLAN.md)
for new work; do not start the old container alongside it.

```text
docker exec 88253aa2f41822b2160155831f2a5237d382b7778e79bd6ce55d16da0fc1f6a6 bash /workspace/code/dev.sh exec cargo test --locked --manifest-path requests/Cargo.toml --all-targets -- --include-ignored
```

The parity run compares actual Rust native and WASM reports on signed lifecycle,
historical v1 and adversarial vectors. Synthetic receipts move no funds. Bounded authorization enumeration,
seeded property tests and runtime parity establish only their tested cases;
none is a formal proof of all histories, physical truth or real-world fairness.

## Adapter-1 integration milestone

The [guided terminal integration](INTEGRATION.md) adds a bounded development
adapter around the accepted protocol-2 core. It provides editable synthetic
drafts, exact retained signing reviews, owner-operated signing and readable core
inspection with separate active/conditional rights. Its four binary-module files
add no new contractual authority. All 18 recorded core source/Cargo hashes match
the prior NV2-01 snapshot. Separate owner directories in one development container
remain logical contexts, not operating-system isolation or a central R/O vault
service.

On **28 September 2026**, integration validation passed **168 native tests,
0 failures, 0 ignored**: the 152 core tests above, 13 adapter unit tests and three
real workflow acceptance tests. Both binaries, formatting, all-target Clippy with
warnings denied, release WASM and binding generation passed. **27 native/WASM
parity cases** passed: eleven built-in, ten prior NV2-01 and six new actual adapter
captures. See the native log (local review record, not included in this source release),
build log (local review record, not included in this source release) and
parity log (local review record, not included in this source release).

The completed-lifecycle inspection (local review record, not included in this source release)
and late-context inspection (local review record, not included in this source release)
show real adapter output over synthetic records; the latter retains the active M
fee and separate conditional expenses. Partial formation, physical dispute,
settlement and reversal are also captured. The prior 152/21 results remain the
NV2-01 core baseline. The new adapter has not thereby acquired the earlier
reviewer's approval or production readiness. The guide records exact commands,
capture provenance and limits without overwriting prior snapshots.

## AN-2 documentation and consent clarification

The AN-1 documentation reviewer checked the three embedded document hashes and
wording. That review did not inspect the linked implementation export/logs or
execute the adapter. Its recommendation to retain the notes is not approval of
the adapter, adopted legal terms or production deployment.

AN-2 adds exact-object signing consequences and limited readiness/payment labels
to the guided terminal, plus requester-funded product-policy notes and an
unadopted service worksheet. On 28 September 2026, **24 focused native tests passed,
zero failed or ignored**: 20 adapter unit tests and four workflow tests. Formatting,
all-target strict Clippy and both native binary builds passed in the existing
managed container. See the executed native log (local review record, not included in this source release)
and build log (local review record, not included in this source release). No full core suite or
WASM/parity run was repeated for this pass; the earlier 168/27 results are historical.

In the retained AN-2 snapshot, 45 package files outside the three changed adapter
modules and workflow test were byte-identical to AN-1, including core rules,
schemas, fixtures and draft defaults. That comparison describes the snapshot,
not later edits to live documentation such as the package README. Six inspection
captures from that pass retain the same core JSON results for
the old signed inputs. Four synthetic signing reviews were cancelled before any
vault was opened or signature produced. These checks establish the described
presentation behavior, not service fulfillment, legal validity or operational
robot readiness. See AN-2 captures (local review record, not included in this source release)
and [the updated notes](AGREEMENT_NOTES.md).

## Unsupported or unreviewed capabilities

Reliable reasoning and an agreed interpretation of priors into settlement remain
separate future work. They do not reopen DP-2 or block its accepted workflow scope.
No settlement formula, payout, forfeiture or economic fallback has been selected;
an unresolved outcome can leave the parties bearing different economic losses.

| Area | Limit |
| --- | --- |
| Signing custody/distribution | Software keys are available to the unlocked local process; independent release/update, consent UI and recovery review remain necessary |
| Legacy semantics | Original signatures remain evidence; v1 aggregate rights are not reinterpreted through v2 grants |
| Identity/delegation | Independent role-key binding is an input assumption; arbitrary delegated signing and account-based key recovery are unsupported |
| Time/notice | No default consent, forfeiture, debt cancellation or denial from silence or M's clock |
| Payments | No provider-signed payment adapter or irreversible bank-finality proof; payee receipts are attributed acknowledgments |
| Protection | No financial coverage, insurer, funding pool, enforcement mechanism or payment guarantee |
| External adjudication | No final ruling from uploaded files or mediator opinion |
| Analysis and priors | Model interpretations and question dispositions are non-authoritative; reliable reasoning and any priors-to-settlement policy remain future work |
| Sensor truth | Sensor implementation is unchanged; authentic artifacts do not establish physical performance |
| Hosting/privacy | Local authenticated encryption exists; hosted access control, secure exchange, retention/deletion and rollback protection require integration |
| Historical completeness | A bundle cannot prove that hidden records, forks, assignments or communications do not exist |
| Liveness | Participants can withhold signatures, reveals, messages and receipts; unresolved disputes are legitimate |

Before real-money/protection deployment, review the actual consent and identity
flow, service/employment/consumer classification, payment-control arrangement,
protection/insurance implications, privacy/retention and enforceability for the
selected launch jurisdiction. This is a deployment work item from the brief, not
a determination of any jurisdiction's law. Complete independent implementation,
dependency, storage/crash, key-custody and distribution/update review before
advertising complete mediator resistance.

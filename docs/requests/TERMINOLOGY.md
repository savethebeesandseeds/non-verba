# Terminology

Living vocabulary for the Assignment protocol and dispute-resolution discussion.
Updated 2 October 2026.

This is the separate home for naming conventions. It distinguishes agreed working
language, proposed terms still under discussion, and existing implementation names.
Definitions can be refined as the design develops. Naming conventions do not
select a settlement mechanism, legal classification or implementation state machine.

## Working conventions

### Cooperation and parties

| Term | Working meaning |
| --- | --- |
| Requester | The party requesting the service |
| Operator | The party offering and undertaking the service |
| Mediator | Non Verba's identified party, with the duties and authority specified for it |
| Request | The Requester's description of the service wanted |
| Quote | The Operator's offer of scope, compensation, expenses and conditions |
| Assignment | The particular work instance linking a Request, selected Quote and its terms |
| Assignment Contract | The agreed working name for the instrument intended to establish the parties' obligations for an Assignment; Contract is the short form |
| Bound | The protocol formation state in which the required parties have authorized the same exact terms |

**Assignment Contract** is the naming convention agreed on 2 October. Current
documentation, source types and participant-facing reviews use this term.
Versioned records retain their original encoding; the mapping below identifies
the older names that remain for compatibility.

The product aim discussed is simple task requesting and independently provided
services, with appropriate Operator business costs reflected in pricing. Legal
enforceability, employment classification and tax, insurance or other statutory
responsibilities remain questions for separate review.

### Priors and the three research questions

| Term | Working meaning |
| --- | --- |
| Priors | Defined terms through which a party expresses the considerations or commitments it wants represented in dispute resolution |
| Catalog of priors | The shared vocabulary of priors and their meanings |
| Declared priors | A party's expression using that shared vocabulary |
| Derivation | Developing and defining the priors; the earlier notes use selection for this question |
| Incorporation | Bringing each party's declared priors into resolution and exploring how processing uses them with the Contract, claims and evidence |
| Evaluation | Examining the automatic dispute-resolution system, including the priors, their incorporation and resulting resolutions |

Catalog and declaration are a practical distinction within priors, not additional
layers of priors. Processing is considered alongside incorporation for now;
its method remains open.

The working role framing reads Requester priors as a **warranty of conduct**
and Operator priors as a **standing offer of treatment**. The latter concerns
how the Operator proposes to be treated. The shared prior retains a recognizable
meaning, while interpretation takes the declaring party's role into account.
The obligations or consequences of this framing have not been selected.

## Dispute vocabulary under discussion

The 2 October discussion uses Dispute for payment disagreements and chooses
Catastrophe management as the working name for the separate route involving
assurance and a process for taking a case to court. Its precise scope remains
open. The other wording below remains under discussion; these names do not
establish implemented resolution rules.

| Term | Working or proposed meaning |
| --- | --- |
| Dispute | A raised disagreement over an Assignment's payment, addressed through the automatic payment procedure the parties accepted |
| Catastrophe management | Working name for the separate route concerning serious harm, including injury or asset loss; involves assurance and a process for taking the case to court, with its precise definition left for later |
| Scrutiny package | Information needed for scrutiny that participants should be able to download at any point; the parties' private formal identification information is not automatically included |
| Dispute case | The organized record of identified disputed matters, claims, evidence and review history |
| Claim | What a party asserts happened or is owed; the assertion alone does not establish it |
| Evidence | Material that may support or challenge a claim |
| Analysis | An interpretation of the available material; its authority is separate from its content |
| Proposed resolution | A suggested way to address disputed matters, identifying scope and intended consequences |
| Negotiated settlement | A resolution whose exact scope and consequences receive the required parties' authorization |
| Rule-based resolution | A rule accepted beforehand produces its specified consequence when its required conditions and proof are satisfied |
| Determination under an agreed procedure | An authorized process decides identified disputed matters; the general procedure remains to be designed |

The platform should hold the necessary formal identification information.
The scrutiny package's contents, privacy safeguards and circumstances for
disclosing identification information remain to be defined.

The current core's **bilateral settlement** operation is a specific, limited
release of identified claims. It does not implement every outcome described by
the broader proposed phrase negotiated settlement. See [settlement handling](SETTLEMENT_HANDLING.md).

### Stages and outcomes under discussion

These are candidate labels, not one required sequence or new executable states.

| Area | Term | Proposed meaning |
| --- | --- | --- |
| Cooperation | Draft | Terms are being prepared or reviewed |
| Cooperation | Active | Work under the Contract is underway |
| Performance | Completion claimed | The Operator states that identified work is complete |
| Performance | Completion accepted | The Requester accepts identified work under the applicable terms |
| Cooperation | Fulfilment | The ordinary path in which the work and applicable obligations are satisfied |
| Dispute | Open | An identified disagreement has been raised |
| Dispute | Under review | Claims, evidence and possible resolutions are being considered |
| Assignment or matter | Disputed | At least one identified matter is contested; this does not describe every other matter |
| Dispute | Resolved | An authorized outcome addresses the stated scope |
| Dispute | Closed | The case is marked concluded under defined closure conditions; those conditions, finality and reopening remain open |
| Claim outcome | Upheld / partly upheld / not upheld / unresolved | Proposed descriptions of the result for a particular claim, rather than a single winner for the entire Assignment |

An Assignment could be active with an open dispute. Completion could be accepted
while payment remains outstanding. A scoped resolution need not resolve every
claim, and authorizing a remedy is distinct from carrying it out.

The companion currently has only open and under-review case states. General
resolution and closure are not implemented. Analysis that supports a claim does
not itself supply an authorized outcome upholding it. The
[lifecycle specification](DISPUTE_LIFECYCLE.md) retains the implementation boundaries.

### Timing under discussion

| Term | Proposed meaning |
| --- | --- |
| Declared | When a party states particular terms, priors or a proposal |
| Authorized | When the required consent to the exact identified object is established |
| Effective | When the applicable conditions make a stated consequence take effect |
| Carried out | When the relevant performance, payment or remedy actually occurs |

These moments may differ. A definition of authorization does not select a new
effective-time rule, deadline or consequence of silence.

## Development and maintenance note

Use this file as the shared vocabulary reference and keep it updated when
discussion clarifies a term or agrees a convention. Retain the distinction
between agreed wording, proposals and current implementation behavior.

**Development practice:** inspect code, interfaces and documentation for
inconsistent naming, and reflect agreed terminology clearly when changing them.
Review compatibility before changing stored records, schema names, signatures
or public interfaces. Record the mapping where an existing name must remain.
The 2 October alignment updates the public Assignment/disputes packages, their
terminal presentation and related docs. It does not implement the proposed
dispute stages, choose a settlement mechanism or determine legal classification.

Research notes should link here for terminology and retain the reasoning behind
the ideas. Future development changes can update this glossary alongside the
affected documentation and code.

## Current implementation vocabulary

The glossary below describes existing behavior using the working language.
The following compatibility names refer to those same records and operations:

| Working/source name | Retained compatibility spelling |
| --- | --- |
| `contract` module; `AssignmentContract`, `ContractCertificate`, `ContractResult` | Rust aliases `agreement`, `AssignmentAgreement`, `AgreementCertificate`, `AgreementResult` |
| `validate_contract`, `verify_contract`, `known_contract`, `verify_events_for_contracts` | Earlier Rust entry points remain aliases |
| Contract and its revision hashes | JSON fields `agreement`, `agreement_hash`, `previous_agreement_hash`, `basis_agreement_hash`, `current_agreement_hash`; the existing `AmendAgreement` / `AMEND_AGREEMENT` action and signing purposes |
| `draft-contract`, `review contract` | CLI aliases `draft-agreement`, `review agreement`; retained adapter-1 review kind `agreement` |
| `PriorV1`, `PriorsCatalogV1`, `DeclaredPriorsV1`, `SignedDeclaredPriorsV1` | Rust aliases `DimensionV1`, `DictionaryV1`, `PartyProfileV1`, `SignedProfileV1`; JSON `dictionary`, `profile`, `dimensions` and related field names |
| `catalog`, `draft-priors`, `validate-priors`, `verify-priors`, `review priors` | CLI aliases `dictionary`, `draft-profile`, `validate-profile`, `verify-profile`, `review profile` |

Exact pinned catalog definitions, versioned prompts, signed fixtures and machine
diagnostics retain their original vocabulary. They are compatibility artifacts,
not additional naming conventions. Changing their meaning or encoding requires
separate versioning and review; this alignment does not reinterpret them.

Use **Requester**, **Operator**, and **Mediator** consistently in protocol,
interfaces and product copy. The abbreviations R, O and M identify those roles;
they do not identify kinds of person or hardware.

| Term | Meaning |
| --- | --- |
| Party | Identified participant undertaking the obligations attributed to it |
| Requester (R) | Requests a service and accepts or rejects an Operator-authored quote |
| Operator (O) | Authors the quote and undertakes the agreed service |
| Mediator (M) | Non Verba's identified party, undertaking the Contract's mediation and explicitly supported assurance duties |
| Signing authority | A pinned key and its defined permission to sign for a party in a role |
| Principal | Party granting an agent a stated bounded authority; an account login is not this grant |
| Execution resource | Person, embodied robot, software agent, device or team that performs work; distinct from contractual identity |
| Platform | Hosting, discovery, relay and operational services; their database is not contractual authority |
| Request | R's versioned description of desired service; publication alone imposes no obligation on O or M |
| Quote | O's signed offer of exact scope, compensation, expenses and conditions |
| Assignment | Work instance linking an exact Request revision, selected quote and R/O/M Contract |
| Assignment Contract | Immutable exact terms, pinned policy, identities and key bindings signed by R, O and M |
| Contract certificate | The Contract and complete valid R/O/M authorizations on the same digest |
| Amendment | A prospectively effective replacement of permitted terms with R/O/M authorization and an exclusive parent/version |
| Claim | An author's attributed assertion, including completion, rejection or alleged nonpayment; not a judgment |
| Evidence | Exact bytes or a manifest with content digests and provenance; not necessarily truthful or complete |
| Evidence commitment (current protocol: Commitment) | A signed, salted cryptographic commitment to later reveal exact evidence content; distinct from a declared prior |
| Receipt acknowledgment | A recipient's acknowledgment of identified bytes; no consent to their substance |
| Completion acknowledgment | R's scoped acceptance of O's identified completion under pre-agreed consequences |
| Rule invocation | Proof-based application of an enumerated rule already authorized in the Contract |
| Contractual effect | A derived change authorized by a verified certificate or pre-agreed supported rule |
| Causal knowledge | Authenticated references and order evidence used for provenance/cutover; a referenced transaction is not automatically a financial prerequisite |
| Required-effect proof / constitutive proof | The finite evidence, authority and named financial basis demanded by the closed rule to establish that effect |
| Obligation / receivable | Stable itemized record of debtor, creditor, amount, contractual basis, due conditions and unresolved balance |
| Payment observation | Evidence or a statement about an external payment; its authority depends on its source |
| Payee receipt | Payee-signed acknowledgment that discharges only the identified amount under the supported rule |
| Reconciliation | Applying a specifically authorized payment/reversal rule; not silently deleting a debt |
| Unit allocation | Exact half-open minor-unit interval on an identified obligation's immutable root Contract basis |
| Credit grant | One payee-authorized receipt's independent allocated discharge rights; contradiction alone does not revoke it |
| Release grant | One scoped R/O settlement's identified released units; distinct from receipt coverage |
| Scoped revocation | R/O/M-authorized reversal of named intervals on one exact credit grant; other coverage survives |
| Cutover frontier | All-party-signed observed causal context for a prospective amendment, not a globally complete history |
| Legacy unresolved projection | Original signatures inspected without executing v1 aggregation or inventing v2 consent/allocations; an empty aggregate is not zero debt |
| Conditional right | An independently valid causal financial proof whose joint cutover/cap applicability remains unresolved; its principal/discharge/release is retained, not added to competing alternatives or zeroed |
| Mediation proposal | M's recommended settlement; no independent adjudicative effect |
| Bilateral settlement | When enabled by the signed policy, R/O-authorized release of exact units of existing R-to-O compensation or expense entitlements; not payment, a price amendment or authority over M's rights |
| Declared priors | A party's signed allocations across the pinned catalog of priors; neither a payout percentage nor authority to change rights |
| Analysis annex | Separately endorsed R/O/M record binding the exact base Contract, profiles, catalog and analysis settings; currently `ANALYSIS_ONLY`, with financial authority `NONE` and settlement policy `UNSPECIFIED` |
| Preflight decision | Unsigned local acceptance or decline of the full retained profile/settings review digest; not another party's authenticated consent or a Contract signature |
| Model interpretation | Generated reading of attributed material, including comparisons and proposed alternatives; structural acceptance does not make it a verified fact |
| Question disposition | Model interpretation marking a prior question open, answered from source, unnecessary or superseded; the label and cited source do not verify the answer or acquire contractual authority |
| Settlement policy | Rules for deriving a settlement outcome; the companion has selected none, and its research metadata does not implement such a policy |
| Assurance | Explicit separate provider undertaking with scope, prerequisites, limitations, claim path and funding dependency where relevant |
| Assurance assessment | M's attributed opinion about a claim; not automatic extinction of beneficiary rights |
| Unresolved | The available authority/evidence does not establish a definitive consequence; records and claims remain available |
| Transcript | Signed per-author streams and causal certificates visible in a supplied bundle |
| Equivocation | Incompatible signed statements in the same author stream slot or defined exclusive authorization slot |
| Incomplete | Referenced history or required proof is missing; identify which relation is incomplete, and never invent missing authority |
| Conflicted | Known incompatible records prevent the affected projection from having one supported result |

## Distinctions that interfaces must preserve

- Platform terms acceptance is separate from consent to one Assignment.
- Base Contract formation, local preflight acceptance and all-party analysis
  annex formation are separate. A failed extended setup does not retract base
  rights; base and annex signing is not atomic.
- A valid signature authenticates a pinned key's message, not a human identity,
  free consent, sensor truth or legal enforceability.
- A complete certificate makes a Contract bound in a verifier's local view.
  Each participant still needs its own retained copy before readiness.
- Completion claimed, completion accepted, payment observed, and amount discharged
  are separate facts. An accepted Assignment may have an unpaid balance.
- Rejecting a completion is a claim/dispute. It does not erase entitlement already
  established by another valid rule.
- Administrative closure, moderation or suspension affects platform operations,
  not past signed obligations.
- A protection field, signed promise or cap does not establish active coverage,
  funding, provider solvency or a right to control task money.
- An authenticated contradiction is evidence of misconduct or uncertainty; it is
  not, by itself, authority to revoke a right previously established for another
  party. Grant overlap is explicit and never double-counted.
- A scoped signed release, a payee receipt and a model-generated alternative
  have different consequences. The companion constructs no core Action; use the
  exact authority and proof requirements in [settlement handling](SETTLEMENT_HANDLING.md).
- DP-2's accepted synthetic workflow scope is separate from model quality. The
  local model remains a workflow test component; reliable reasoning and a policy
  interpreting priors into settlement are future work, not completed capabilities.

No UI should replace these distinctions with `work_verified=true`, a majority
vote, an administrator-set `paid` status, or an unexplained guarantee badge.

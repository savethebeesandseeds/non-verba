# Terminology

Use **Requester**, **Operator**, and **Mediator** consistently in protocol,
interfaces and product copy. The abbreviations R, O and M identify those roles;
they do not identify kinds of person or hardware.

| Term | Meaning |
| --- | --- |
| Party | Identified participant undertaking the obligations attributed to it |
| Requester (R) | Requests a service and accepts or rejects an Operator-authored quote |
| Operator (O) | Authors the quote and undertakes the agreed service |
| Mediator (M) | Non Verba's identified party, undertaking the Agreement's mediation and explicitly supported assurance duties |
| Signing authority | A pinned key and its defined permission to sign for a party in a role |
| Principal | Party granting an agent a stated bounded authority; an account login is not this grant |
| Execution resource | Person, embodied robot, software agent, device or team that performs work; distinct from contractual identity |
| Platform | Hosting, discovery, relay and operational services; their database is not contractual authority |
| Request | R's versioned description of desired service; publication alone imposes no obligation on O or M |
| Quote | O's signed offer of exact scope, compensation, expenses and conditions |
| Assignment | Work instance linking an exact Request revision, selected quote and R/O/M Agreement |
| Assignment Agreement | Immutable exact terms, pinned policy, identities and key bindings signed by R, O and M |
| Agreement certificate | The Agreement and complete valid R/O/M authorizations on the same digest |
| Amendment | A prospectively effective replacement of permitted terms with R/O/M authorization and an exclusive parent/version |
| Claim | An author's attributed assertion, including completion, rejection or alleged nonpayment; not a judgment |
| Evidence | Exact bytes or a manifest with content digests and provenance; not necessarily truthful or complete |
| Commitment | A signed, salted cryptographic commitment to later reveal exact evidence content |
| Receipt acknowledgment | A recipient's acknowledgment of identified bytes; no consent to their substance |
| Completion acknowledgment | R's scoped acceptance of O's identified completion under pre-agreed consequences |
| Rule invocation | Proof-based application of an enumerated rule already authorized in the Agreement |
| Contractual effect | A derived change authorized by a verified certificate or pre-agreed supported rule |
| Causal knowledge | Authenticated references and order evidence used for provenance/cutover; a referenced transaction is not automatically a financial prerequisite |
| Required-effect proof / constitutive proof | The finite evidence, authority and named financial basis demanded by the closed rule to establish that effect |
| Obligation / receivable | Stable itemized record of debtor, creditor, amount, contractual basis, due conditions and unresolved balance |
| Payment observation | Evidence or a statement about an external payment; its authority depends on its source |
| Payee receipt | Payee-signed acknowledgment that discharges only the identified amount under the supported rule |
| Reconciliation | Applying a specifically authorized payment/reversal rule; not silently deleting a debt |
| Unit allocation | Exact half-open minor-unit interval on an identified obligation's immutable root Agreement basis |
| Credit grant | One payee-authorized receipt's independent allocated discharge rights; contradiction alone does not revoke it |
| Release grant | One scoped R/O settlement's identified released units; distinct from receipt coverage |
| Scoped revocation | R/O/M-authorized reversal of named intervals on one exact credit grant; other coverage survives |
| Cutover frontier | All-party-signed observed causal context for a prospective amendment, not a globally complete history |
| Legacy unresolved projection | Original signatures inspected without executing v1 aggregation or inventing v2 consent/allocations; an empty aggregate is not zero debt |
| Conditional right | An independently valid causal financial proof whose joint cutover/cap applicability remains unresolved; its principal/discharge/release is retained, not added to competing alternatives or zeroed |
| Mediation proposal | M's recommended settlement; no independent adjudicative effect |
| Bilateral settlement | When enabled by the signed policy, R/O-authorized release of exact units of existing R-to-O compensation or expense entitlements; not payment, a price amendment or authority over M's rights |
| Dispute-priority profile | A party's signed allocations across the pinned priority dictionary; neither a payout percentage nor authority to change rights |
| Analysis annex | Separately endorsed R/O/M record binding the exact base Agreement, profiles, dictionary and analysis settings; currently `ANALYSIS_ONLY`, with financial authority `NONE` and settlement policy `UNSPECIFIED` |
| Preflight decision | Unsigned local acceptance or decline of the full retained profile/settings review digest; not another party's authenticated consent or an Agreement signature |
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
- Base Agreement formation, local preflight acceptance and all-party analysis
  annex formation are separate. A failed extended setup does not retract base
  rights; base and annex signing is not atomic.
- A valid signature authenticates a pinned key's message, not a human identity,
  free consent, sensor truth or legal enforceability.
- A complete certificate makes an Agreement bound in a verifier's local view.
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

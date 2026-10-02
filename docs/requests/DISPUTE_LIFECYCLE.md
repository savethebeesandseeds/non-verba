# Dispute lifecycle and settlement consent

Process specification · 30 September 2026

This document turns the owner's [mutual closure and escalation notes](research/DISPUTE_SETTLEMENT_NOTES.md#mutual-closure-and-escalation)
into a reviewable workflow. It separates implemented records from requirements
for a future negotiation interface. It does not add executable states, a new
signature format, a settlement formula or an escalation procedure.

**A party can raise a dispute without the other's permission. A negotiated
settlement requires both Requester and Operator to authorize the same exact
resolution and its stated consequences.** Silence, inactivity and refusal are
not consent. The roles remain open to people, organizations, agents and embodied
robots acting through established signing authority.

## Existing records and their limits

| Record or operation | Implemented meaning |
| --- | --- |
| Core signed `DisputeOpened` event | Attributed unilateral dispute opening with a dispute ID, subject ID and reason; it does not establish the claim's truth, receipt of notice or settlement authority |
| `DisputeCaseV1` | Agreement-bound case, local supplied-history frontier, scope, evidence and hash-linked revisions; its envelope has no author signature |
| `CaseLifecycleV1` | Only `OPEN` and `UNDER_REVIEW`; neither is a contractual decision, and there is no executable closed or escalated state |
| Signed submission or challenge | Attributes exact content to a participant; it does not establish factual truth or authorize settlement |
| Analysis and question dispositions | Model interpretations to inspect against sources; `ANALYSIS_READY` does not mean the dispute is resolved |
| Core `ActionProposal` and `ActionCertificate` | Exact proposed effect and required authorizations, independently checked against the Agreement, proof and permitted scope |
| `BILATERAL_SETTLEMENT` | Existing, independently authorized R/O release of specified compensation or expense debt units; not general case closure |

The core already supports an authenticated `DisputeOpened` event, as described
in the [dispute workflow](WORKFLOW.md#dispute-path). Preparing the companion's
local case does not obtain, or require, the other party's settlement consent.
Its unsigned envelope does not itself authenticate who opened the dispute or
prove that another party received notice. The companion has no dedicated binding
from its case identity to an exact signed opening event and any applicable notice
evidence; specifying that connection remains future work, not inventing a new
signed-opening capability. Existing event and acknowledgment records retain
their own meanings.

## Review and negotiation interface

The following is a **process design**, not a new wire schema or signing API.
A future interface should keep these items visible together:

| Review item | Required distinction |
| --- | --- |
| Case reference | Exact Assignment, Agreement, case revision/hash and supplied frontier; no claim of globally complete history |
| Disputed matters | Attributed claims, accessible evidence, missing or contested material and participant challenges |
| Analysis | Exact attempt and source references; keep model conclusions and question dispositions separate from verified record checks |
| Proposal reference | Stable discussion identity, explicit revision and exact content digest; keep earlier versions inspectable |
| Resolution and consequences | Identify each affected claim, obligation, amount/unit range and proposed action; state what remains outside the resolution |
| Authorization record | Show whose authorization exists, its exact target, and whether the core accepts the resulting certificate; a local review acknowledgement is not authorization |
| Remaining matters | List known unresolved claims and remaining balances without inferring waiver, payment or case closure from omission |

1. **Raise and inspect the disagreement.** Retain the exact case and sources.
   Separate what a participant says from what record verification establishes.
   Opening the discussion does not pause or cancel existing obligations.
2. **Exchange proposals.** R, O or M may propose a resolution. Neither task party
   must accept it. A suggested remedy or model interpretation creates no new
   obligation. Keep each discussion revision and its stated consequences distinct.
3. **Review one exact candidate.** Make partial scope, preserved rights and any
   unsupported requested effects explicit. A revision must receive its own review;
   consent to one digest cannot authorize another.
4. **Use the applicable authorization path.** For a supported release, each of R
   and O independently authorizes the exact core proposal. The verifier must also
   accept its policy, entitlement basis and scope. Two signatures alone cannot
   authorize an unsupported effect or alter M's rights. Other effects require
   their own supported action and required authorizers.
5. **Record what actually changed.** Retain the accepted certificate and resulting
   core inspection. Keep remaining claims, balances and unresolved discussion
   visible. A release, a payment observation and a payee receipt are separate
   records; none is automatically a certificate closing the entire case.

Discussion revision numbers must not be substituted for the core's
`scope_version`: settlement actions currently use a stable scope at version `0`.
Changing an action changes its digest, so its previous signatures do not authorize
the changed action. It does **not** revoke a signature or certificate on the old
action. Existing exclusive signing slots and conflict checks remain in force;
this design supplies no withdrawal, replacement or revocation mechanism for an
already signed proposal.

## Partial settlement, existing rules and unresolved cases

The existing release path is limited to established R-to-O `COMPENSATION` or
`EXPENSE` obligations when the signed policy permits it. It names exact debt
units, preserves other rights and cannot change M's fees, duties or protection
claims. Release coverage is irrevocable within that action model. It does not
move funds or create a new payment obligation. See [settlement handling](SETTLEMENT_HANDLING.md)
for the exact limits and the separate amendment, payment and receipt paths.

Resolving one identified claim does not establish that every claim was resolved.
The current code has no general closure certificate or reopening mechanism;
closure scope, finality and reopening rules remain explicit future decisions.

Failure to agree is not a veto over a deterministic consequence already accepted
in the Assignment. The current core can apply an authorized artifact rule when
its required proof is satisfied, without fresh R/O agreement. This is the rule's
predefined effect, not newly granted discretion to a model or Non Verba.

The intended next route after failed negotiation is the procedure the parties
authorized before cooperation. That general escalation procedure is currently
**UNSELECTED**: no default adjudicator, deadline, fallback award, automatic
closure or new settlement authority follows from this document. Until such a
procedure exists, an interface must show the absence rather than invent a route.
Existing obligations and independently supported effects continue under their
own rules; unresolved status is not a payment instruction or an assumption that
the parties bear equal economic consequences.

A future procedure must make its applicable rule, evidence, computation, result
and challenge path inspectable. External oversight, governance or meaningful
stakes that hold Non Verba accountable remain separate open design work.

## Implementation boundary and source references

DP-2 remains closed as accepted synthetic workflow integration. The companion
remains `ANALYSIS_ONLY`, financial authority `NONE`, settlement policy
`UNSPECIFIED`. Reliable reasoning, new priors, their incorporation into settlement
and the evaluation design remain separate future work. This specification changes
no signed terms, existing records, model configuration or retained findings.

Sources: [case records](../../code/disputes/src/case.rs),
[case revision command](../../code/disputes/src/commands.rs),
[signed dispute events and acknowledgments](../../code/requests/src/transcript.rs),
[core action types](../../code/requests/src/model.rs),
[exact authorizations and scope versions](../../code/requests/src/actions.rs),
[effect and entitlement checks](../../code/requests/src/bundle.rs),
and [open settlement decisions](DISPUTE_PRIORS_DECISIONS.md).

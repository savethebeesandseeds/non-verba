# Assignment Contract

Note revision AN-2 · 28 September 2026 · package 0.2.1 · protocol 2 · terminal adapter 1

This is a protocol record specification and proposed drafting input. It is not
adopted legal terms or a jurisdiction-specific determination of enforceability.

For the plain-language explanation, read [the participant notes](PARTICIPANT_NOTES.md).
[The detailed implementation record](CONTRACT_NOTES.md) distinguishes executable
rules from signed descriptions and commitments, and records unresolved deployment
decisions against the current code.

## DP-1 / DP-2 companion annex — 29 September 2026

The base Contract schema and formation rules below are unchanged. The companion
extension uses a version-1 typed companion annex. R and O author separate profiles
against the authenticated Request and quote. R/O/M then endorse the same exact
formed Contract digest, catalog, profiles and analysis specification. The
annex is `ANALYSIS_ONLY`, with settlement policy `UNSPECIFIED` and financial
authority `NONE`. This is the companion's boundary; it does not remove R/O's
existing authority to sign a permitted core release. Base formation and annex
formation are reported separately.

The DP-2 guided path reviews both signed profiles and exact analysis settings
before base endorsement. Each participant's acceptance or decline is an unsigned
local decision bound to that full review. Guarded signing and setup completion
check the reviewed material against the base and annex. This does not supply
someone else's consent, make exchange atomic or amend existing formation rules.

Missing or unsupported annexes supply no guessed profiles and erase no base
rights. The signer reserves one context per exact Contract; changed accepted
content needs the documented new-context path and old cases retain their context.
See [exact consent and compatibility](DISPUTE_PRIORS.md#exact-consent-and-compatibility).
This note does not retroactively incorporate an annex into existing Contracts.

DP-2 is closed and accepted as synthetic workflow integration. The local Qwen
model remains a workflow test component; negative reasoning results are retained.
Reliable reasoning and interpreting priors into settlement are separate future
work. Model interpretations, including question dispositions, are neither verified
facts nor contractual authority; see the owner closeout (local review record, not included in this source release).

## Signed content

All three parties sign the same immutable Contract digest. Each authorization
binds the Contract's identity/context, digest, role, key ID, purpose, protocol
version and deployment domain. Keys must match the pinned role registry and the
verifier's independently established identity/key bindings. A public key supplied
by an action cannot enroll itself.

| Section | Required substance |
| --- | --- |
| Identity | Distinct Request/Assignment IDs; exact Request revision; R/O/M parties and role keys; any explicitly supported delegation |
| Versioning | Protocol/schema versions, deployment domain and exact policy ID/version/digest |
| Service | Deliverable, boundaries, location where needed, exclusions, prerequisites, access/materials and safety/stop conditions |
| Quote | O's exact signed quote, currency/exponent, compensation, authorized expense categories and cap, applicable milestones |
| Acceptance | Pre-agreed criteria, mechanical versus judgment-based checks, required proof, and exact consequence of each supported rule |
| Timing | Work/review windows, notice requirements, grace/extension policy, declared time and delivery assumptions |
| Payments | Direct R-to-O relationship, exact bound destination, rail, entitlement/receipt and reversal rules |
| Mediation | Free service, proposal-only authority and precise service/availability commitments |
| Assurance | Explicit disabled/enabled state, provider, beneficiaries, obligations, fee/payer, limits, activation, exclusions, evidence and challenge path |
| Remedies | Cancellation, interruption, expenses, partial completion, disputes, permitted settlement scope and unresolved/accrued claims |
| Privacy | Recipients/purposes, access/disclosure, exact retention/deletion policy and export rights |
| Legal/consent | Identification records, displayed exact text/version, mandatory-rights reservation and only actually selected law/jurisdiction |

This table describes drafting requirements, not a claim that every item is
semantically validated or delivered by the prototype. Timing, physical safety,
mediation availability, privacy and other narrative commitments remain signed
text. The verifier executes only its supported rules; it does not establish
real-world fulfillment or legal sufficiency of that text.

Reference exact retained text and policy bytes, not a mutable remote URL labeled
"current terms." The preview identifies their digests and displays the signed
terms. Changing a website or policy database never changes an existing Contract.

Money uses bounded canonical decimal strings of integer minor units together with
currency and exponent. Compensation, authorized expenses, and any separately
priced protection have distinct lines and payment records. Non Verba receives no
commission and may not deduct protection charges from O's compensation. A cap
authorizes at most its defined scope; it is not proof of expenditure or solvency.

The commercial policy is requester-funded platform charges, free Operator
registration and free mediation. The generic service-fee record's ability to
name R or O as payer is a protocol capability, not approval of an Operator-funded
offering or default. A Request-creation charge is separate from an optional
nonfinancial service fee; its amount, charging event and operational
implementation remain **UNSELECTED**. No Request-creation billing mechanism is
implemented here. These drafting clarifications do not change an existing signed
fee, the payer schema or historical records.

An obligation's principal and outstanding amount are distinct from fulfillment
of its payment conditions. The current verifier retains narrative due conditions
without generally interpreting them. Recording a service fee on activation does
not itself establish service delivery or satisfaction of those conditions.

## Formation and readiness

R and O accept the exact applicable platform terms separately from signing the
Assignment. R publishes a Request. O issues the quote. R may accept/reject that
quote or clarify scope; R does not author a price through the quote API. A scope
change requires a new O quote and, after binding, a valid amendment.

In the implemented local profile, R's signed Request includes
`accepts_platform_terms: true` and the exact terms artifacts. O's signed quote
includes `accepted_terms_hash`, which must equal the digest of those artifacts.
These role-specific assent records precede and remain distinct from the three
Contract signatures. The Contract retains the original terms in
`legal.artifacts`. There is no invented account-enrollment database or remote
terms-acceptance service.

There is no required signature order. `AGREEMENT_BOUND` requires all three valid
authorizations for the same Contract. Partial drafts do not authorize performance
charges, penalties or unilateral activation. The last signer can withhold a
signature; the protocol does not pretend exchange is atomic.

Each client is responsible for retaining a complete valid certificate and
checking the agreed payment/service preconditions. A server's statement that
everyone signed is insufficient. Complete local possession does not establish
that every other participant has obtained the same certificate.

Durable retention is a client responsibility. The current `ready_to_start` result
checks the supplied certificate, supported payment/service conditions and
specified unresolved/conflicted action states. It does not attest durable
storage, service prerequisites, site safety, supplied materials or other parties'
receipt of the certificate.

Display a true local result as **Protocol record checks passed — operational
readiness not assessed**, while retaining the `ready_to_start` machine field.
The flag alone must not actuate a robot or approve site safety. A separately
defined operating process must address practical starting conditions; its stop
or an open dispute does not erase independently established financial rights.

Signing explanations must derive from the exact retained object and verified
context. A milestone acknowledgment identifies its Contract, milestone and
compensation without describing an already established amount as another charge.
A payee receipt distinguishes its stated amount, exact allocated units, overlap
and unallocated excess. A scoped settlement identifies only its released claims
and preserves M's separate rights. Evidence availability/integrity remains
separate from these consequential authorizations. Explanatory display text is
not an additional signed authorization or an unstated waiver of remedies; see
[the display contract](CONTRACT_NOTES.md#consequential-signing-display).

## Amendment and settlement

Every root-Contract amendment requires R, O and M in protocol 2, an exact parent and an
exclusive version. It retains prior records and cannot silently erase accrued
obligations. Honest signing clients must durably refuse incompatible authorizations
for one exclusive slot, including across restart.

The executable amendment profile retains the same Request ID, party/key bindings,
milestone IDs and their existing principals/currency. A new revision of that
Request is allowed; new work-unit IDs require a new Request. Scope changes still
need an exact O quote and all three amendment signatures. Existing units cannot be
repriced by this profile; novation requires a future explicit policy. A new nonfinancial
service revision requires a new explicit R/O/M activation. Prior activation is
bound to its exact Contract digest and cannot activate changed terms.

The amendment also signs an authenticated observed frontier, preserved historical
claims and any exact grandfathered action. Positive causal knowledge of a
successor prevents fresh use of retired powers; absence of global history cannot
erase an omitted old claim. See [cutover and grants](SPECIFICATION.md).

A separate R/O settlement releases only identified, established R-to-O
compensation or expense units under the enabled policy. Both parties review and
sign the exact core action, including its entitlement certificate, amount and
allocations. Analysis or a proposal can inform that review but cannot supply the
action's authority. Release and payment credit remain distinct and their overlap
counts once; a release is not a transfer, new debt or general dispute closure.
It cannot create M duties, expand M exposure, remove M defenses, change assurance
triggers, or waive a separate vested assurance benefit. A narrative assertion such
as "the mediator should pay" creates no authority. Settlement is not a generic
patch to Contract JSON and is not a two-of-three majority decision.

No automatic analysis-to-settlement conversion is implemented or adopted. Work
changes retain the separate amendment requirements; actual payments and payee
receipts retain their own path. The companion's `UNSPECIFIED` settlement policy
does not choose a formula or fallback and does not prevent an independently
authorized release within the existing core policy. See
[settlement handling](SETTLEMENT_HANDLING.md) for the end-to-end distinction.

Key replacement, account recovery and delegated powers must be explicitly
supported and authorized before use. The intended operational restriction is to
stop new signing when recovery would require unsupported authority, preserving
historical signatures and obligations. This prototype supplies no account-recovery
or administrative freeze workflow; it must not be presented as a recovery service.

## Core clause for legal review

Preserve this proposed drafting input exactly in generated terms. It is not a
ready-to-deploy legal clause:

The current generated template retains this wording. Schema validation requires
the accepted exact terms to be retained, but does not require this particular
prose in every possible input. Executable authority restrictions come from the
closed policy and authorization rules, not interpretation of this paragraph.

> No combination of parties gains authority over another party merely by agreeing with one another. Within the Assignment Protocol, an effect on a party's protected rights must be supported by that party's authorization or by a specific rule previously accepted by that party and applied with its required proof. Mediation proposals and unsupported assertions do not themselves change obligations. Amendments and settlements have only the scope authorized in the Assignment Record. This does not exclude mandatory legal rights or the authority of competent external bodies.

**The protocol does not certify virtue. It makes authority explicit, limited, attributable, and independently checkable.**

The corrective clause is also preserved exactly:

> An authenticated contradiction is evidence of misconduct or uncertainty; it is not, by itself, authority to revoke a right previously established for another party.

See [the specification](SPECIFICATION.md) for effect authorization and
[readiness](READINESS.md) for limitations on protection and deployment.

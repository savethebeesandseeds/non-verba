# Protocol specification: corrective protocol 2

This document defines the authorization requirements. The Rust implementation is
the executable profile; [readiness](READINESS.md) records its limits and validation
evidence. Neither document is a security proof or a deployed legal contract.
Protocol 1 financial aggregation is withdrawn from current execution. Original
signed records remain available through authentication-only legacy inspection;
they do not acquire new consent or zero-valued balances.

## Constitutional invariant

> **No coalition of two parties can create a valid contractual state that improperly alters the third party's rights.**

For every affected party P, an accepted effect must have either P's scoped
authorization for that exact effect or a specific rule P previously accepted,
applied only with its required verified proof. Agreement of the other two parties
cannot create a new permission. A generic mediator override does not satisfy this
invariant. The signed Agreement, not an administrator or majority vote, is the
source of protocol authority.

The corrective non-retraction clause is:

> An authenticated contradiction is evidence of misconduct or uncertainty; it is not, by itself, authority to revoke a right previously established for another party.

This clause forbids treating an appended fork, duplicate payment ID, contradictory
receipt or unrelated missing parent as a revocation. Any permitted reversal must
carry its own exact, previously authorized scope and evidence.

No excluded party may acquire an unauthorized obligation, waiver, liability,
destination change, evidence requirement or adjudication power. Existing
obligations survive unsupported rejection, account suspension, database edits,
policy changes and administrative closure. Uncertainty and silence remain
uncertainty and silence. Safety does not promise completion.

## Records and projections

Keep the following records distinct:

1. Exact platform terms, role-specific acceptance, signed Request and O quote.
2. Immutable R/O/M Agreement certificate and authorized amendment history.
3. Per-author signed claims, evidence, commitments/reveals, receipts and proposals.
4. Verified effects with rule, authority, proof and affected-obligation explanations.
5. Itemized receivables and observations of actual external payments.
6. Mediation/assurance cases and transcript diagnostics.

An obligation has a stable ID, debtor/creditor, money, contractual basis, supporting
certificate references, due conditions, disputed amount, confirmed discharged
amount and unresolved balance. Do not net compensation, expenses, protection fees
or unrelated claims. Completion claimed is not acceptance; acceptance is not
payment. An unsupported rejection may open a dispute but cannot remove a valid
pre-existing entitlement.

The reducer is deterministic over explicit verified objects. It makes no network
request and reads no wall clock. Operational labels or caches may be rebuilt from
records and must never acquire independent authority.

## Closed authorization matrix

| Operation | Required authority | Maximum permitted consequence |
| --- | --- | --- |
| Create Request | R | Attributed Request publication; no O/M obligation |
| Issue quote | O | Exact offer of scope, compensation and expenses |
| Bind Agreement | R + O + M | Exact signed terms only |
| Amend root Agreement | R + O + M | Supported prospective terms; retain accrued obligations and history |
| Submit claim/evidence | Author | Add attributed information |
| Acknowledge receipt | Recipient | Acknowledgment of specified bytes, not substantive consent |
| Acknowledge completion | R | Consequences already agreed for O's exact completion/milestone |
| Invoke deterministic rule | Any submitter, with required proof | Only that rule's pre-authorized limited effect |
| Open dispute | R, O or M for its relevant role/rights | Record case/contested claim; no seizure or erasure |
| Propose settlement | R, O or M | Proposal only |
| Settle exclusively R/O claims | R + O | Allowlisted identified R/O balances/releases; no M or separate assurance rights change |
| Change assurance/M duties | R + O + M | Supported explicit amendment; no silent reduction of vested benefits |
| Submit assurance assessment | M | Attributed position, not binding denial or confiscation |
| Send stop/cancellation notice | Notifying party | Notice and only enumerated pre-agreed operational consequences |
| Confirm payment receipt | Payee | Discharge identified supported amount once |
| Use independent payment proof | Supported adapter and agreed rule | Only authenticated supported payment consequence; unavailable unless implemented |
| Record external outcome | Supported authenticated external authority | Only previously accepted scope; unavailable unless implemented |

No generic JSON patch, unreviewed field-diff heuristic, AI classification or
arbitrary policy script can broaden this table. Unknown action types, algorithms,
versions and fields fail closed. Interfaces may record unsupported external
assertions as attributed observations without turning them into authority.

The executable effect allowlist is `ACKNOWLEDGE_COMPLETION`,
`INVOKE_ARTIFACT_RULE`, `AUTHORIZE_EXPENSE`, `BILATERAL_SETTLEMENT`,
`PAYMENT_RECEIPT`, `RECONCILE_REVERSAL`, `AMEND_AGREEMENT` and
`ACTIVATE_PROTECTION_SERVICE`. Expense authorization requires R/O within the
quoted cap; reversal reconciliation and nonfinancial protection activation require
R/O/M. Artifact invocation still has an authenticated submitter although its
authority comes from the pre-agreed rule. Claims, notices, receipt acknowledgments
and recommendations are transcript events, not arbitrary additional effect types.

## Cryptographic profile

The profile retains the project's existing P-256 ECDSA/SHA-256 algorithm family.
It does not migrate or enroll sensor keys. Agreement role keys are independently
pinned. A message cannot negotiate a weaker algorithm or supply its own trusted
registry. Use maintained cryptographic and RFC 8785 JCS libraries; byte-level
constants, key/signature encoding, bounds and rejection cases belong to the
package's checked fixtures/tests.

Structured signed objects use UTF-8 RFC 8785 JSON Canonicalization Scheme. Reject
duplicate properties before ordinary deserialization can discard them, invalid
Unicode, unknown fields and unsupported numeric forms. Preserve exact signed text;
do not normalize Unicode or rewrite agreed wording. Money, counters and other
bounded integer fields use canonical decimal strings where defined by the schema.
No floating-point money arithmetic is permitted. SHA-256 hashes identify exact
content and canonical structures. These choices follow the encoding guidance in
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785), not a custom key-sorting format.

Each signature binds an unambiguous domain-separated statement containing the
object digest and role/key/purpose, with the protocol/deployment/assignment context
bound by the signed object. Distinct signing purposes cannot be substituted. The
signature scheme authenticates a key's message; external onboarding establishes
whether that key represents the intended party. The existing P-256 choice avoids
an unnecessary client/device migration; it does not claim a review of every
sensor signer or a reviewed production client release.

## Action certificates

Every state-changing action has immutable protocol/deployment context,
Assignment ID, Agreement/policy hashes, a closed action type, exact scope,
causal parent certificate references, bounded scope version, fresh nonce and a
strict action-specific payload. Authorizations bind the proposal hash and exact
role/key/purpose. The trusted registry is the relevant signed Agreement, anchored
by the verifier's independent key bindings.

Validate bounded input/schema, supported context, canonicalization/digests,
signatures/key authority, required authorizers, action preconditions, exact
required proofs and applicable conflict/replay constraints before deriving
effects. Missing required proof yields pending/incomplete diagnostics. Incomplete
generic context is a separate history finding; it does not by itself supply or
remove effect authority. Malformed or unauthorized data creates no financial
best guess.

Every accepted effect explains its rule ID, authorization certificates, proof
references and exact affected obligations. Repeated identical certificates are
idempotent. Storage must use uniqueness and atomic expected-state updates; these
are operational protections against accidents, not protection against a malicious
M rewriting its own database.

Invalid additional signature encodings remain diagnostics and confer no authority,
but cannot revoke an otherwise complete valid R/O/M certificate or action. An
invalid signed wrapper around an identical Request body cannot shadow a valid
signed copy. Consumers must distinguish diagnostic records from effective
authority rather than treat every extra malformed record as a veto.

## Knowledge and required proof

Keep two distinct relations. **Causal knowledge** retains authenticated references
for provenance, amendment frontiers, successor knowledge and conflicting histories.
A shape-valid action proposal with at least one actual, independently pinned
signature can establish attributed knowledge before it has all signatures needed
for a financial effect. Completing its signatures later must not newly turn its
existing context into an authority condition. A partial amendment remains a
proposal and cannot introduce an active successor Agreement.

**Required-effect proof** contains only the financial basis and evidence demanded
by the closed action rule. Derive that finite basis from the action's type and
named scope, rather than replaying every transaction reachable through its
context. A contextual hash is not consent to make the referenced transaction a
condition of an otherwise independent promise.

| Effect | Required basis and checks |
| --- | --- |
| Service activation and separate M fee | Exact supported Agreement service/fee, supported prerequisites, exact commitment ID and R/O/M authorization; preserve any established same-fee provenance |
| Completion acknowledgment | Exact scoped O completion proof, applicable Agreement and R authorization; preserve any established same-obligation provenance |
| Artifact-rule invocation | Applicable supported rule, exact required artifact/completion proof and valid cutover authority; preserve any established same-obligation provenance |
| Payment receipt | Identified established obligation, actual creditor authorization and exact signed unit allocations |
| R/O release | Identified permitted R/O obligations, release policy, R/O authorization and exact allocations |
| Reversal | Named receipt grant, its applicable obligation/unit ranges and required R/O/M authorization |
| Expense authorization | Identified evidence, expense/category/amount, R/O authorization and the applicable same-category cap state |

For receipts and releases, `parent_certificate_ids` must name an admitted
financial certificate whose proof establishes the identified obligation. The
selected certificate's own required-effect dependencies are included; merely
finding an unrelated record through a contextual ancestor is insufficient. A
reversal names the actual receipt certificate and includes its required basis.
Expenses include relevant previously authorized same-category principals and
claims sharing the expense identity. An expense identity cannot move categories;
payments/releases do not restore its authorized cap. Compatible repeated expense
identities count once, while incompatible claims remain explicit conflicts.

For service activation, acknowledgment and artifact invocation, known prior
establishments of the same stable obligation also preserve its accrued due
conditions. Select only validated, nonconditional establishment witnesses from
authenticated knowledge and their own finite required proof. This prevents a
later duplicate establishment from substituting prospective payment terms in a
conditional projection across further amendments. An unresolved historical
establishment is not promoted into active provenance by this selection. These
same-obligation witnesses do not import arbitrary financial context or unrelated
expense prerequisites.

Service activation, completion acknowledgment and artifact invocation do not
replay unrelated expenses as financial prerequisites. Expense-cap checks remain
in force; incompatible expense claims are reported separately. Receipts, releases
and reversals still require the actual named financial basis. An invalid proof
cannot be rescued merely by classifying it as context.

Once complete constitutive proof establishes an effect, later delivery or
authorization of unrelated context cannot withdraw it. Apply this boundary
consistently in pre-signing, verification, import/merge and offline export
verification. In the NV2-01 case, the independently authorized M service fee stays
active while R/O expense-cap conflicts remain separate; moving that fee into a
conditional or zero-valued projection is not the required preservation.

Retain full authenticated knowledge for cutover and provenance even when a
contextual record's own financial effect is invalid, partial or unresolved.
Positive successor knowledge still prevents fresh use of retired powers. This
separation does not relax a required proof, invent global completeness, change
unit-grant semantics or reinterpret protocol-1 signatures.

For applied effects, `EffectAudit.proof_references` combines exact event/artifact
references with the finite financial witness closure, sorted and deduplicated.
This makes the selected basis inspectable separately from generic causal parents.
The report is a projection of verified records, not a new authorization or a proof
of global history completeness. Conditional rights retain their separate
certificate, reason and numeric proof state.

## Streams, causality and conflict

Use separate signed append-only streams per author/key epoch, not a global slot
that serializes all three authors. Envelopes bind protocol/domain, Assignment and
Agreement, author/key/epoch, sequence, prior event hash, closed type/body, nonce,
causal references and any explicitly *claimed* creation time.

Independent R/O events sharing a parent are normal concurrency. Two different
signed bodies in one `(assignment, author, keyEpoch, streamSequence)` slot, or
incompatible authorizations in one exclusive decision slot, are conflicting
evidence. Keep both. Byte-identical retransmission is not equivocation. Invalid
signatures must not become evidence that an honest author equivocated.

Amendments use an exclusive parent/version with all three signatures. Honest
signers durably refuse incompatible authorizations for a previously signed slot.
Known contradictions remain attributable evidence. They do not erase an
independently authenticated completion claim, a Requester acknowledgment, or an
existing credit/release grant. Transcript ordering and exact proof validity are
separate projections. The financial rule checks its own exact role/body/Agreement
proof using authenticated proof records, even when unrelated stream ancestry is
conflicted. Missing required proof still cannot create a new effect.

Non-amendment exclusive slots span Agreement revisions; an amendment cannot reset
a previously reserved expense/payment/settlement slot. Protection activation uses
the Agreement revision as its scope version, and must be newly authorized for
changed service terms.

## Explicit financial grants

Protocol 2 receipts, bilateral releases and reversals sign exact minor-unit
allocations. Each allocation names an obligation, its immutable root Agreement
basis and a half-open interval `[start, end)` within that principal. The amount and
currency must match the applicable supported rule. No allocation is guessed from
arrival order, a remaining balance, an unsigned status or a v1 receipt.

Every receipt creates its own attributable credit grant. Every bilateral release
creates its own release grant. A supplied duplicate is idempotent. Overlapping
grants retain their independent certificates; coverage is the union of their
intervals, counted once. Reports expose credited coverage, released coverage and
their overlap separately. A contradictory or excessive later statement cannot
make earlier coverage disappear or reopen debt automatically. Excess received
money is recorded separately from allocation to this obligation.

A reversal requires R/O/M authorization and names the exact earlier credit grant
and intervals it revokes. It cannot revoke another receipt's independent coverage,
a bilateral release, or units outside the named grant. Repeated/overlapping
reversals cannot revoke the same unit twice. This is scoped revocation of a grant,
not an administrator's recomputation of who should owe money.

## Prospective amendment cutover

All three parties sign an amendment's `cutover`: an authenticated observed
`frontier`, identified `preserved_claims`, and exact `grandfathered_actions`.
Preserved/grandfathered references must appear in the frontier, which is explicit
causal context. A frontier records demonstrated knowledge and ordering; it does
not declare that a local view is globally complete or waive omitted claims.

The successor causally follows the full authenticated ancestry of that frontier.
Established work and fee due conditions survive a later revision even when
unrelated dependencies give their earlier proof greater depth. Preserving that
accrual order does not make every contextual ancestor an effect-authority gate;
the effect still needs its own exact authorization and required proof.

Fresh exercise of a retired rule cannot create debt when its causal context
positively establishes knowledge of the successor Agreement. A proved pre-cutover
claim or explicitly grandfathered exact action follows its authorized scope.
When old-policy timing/order is not established, retain the historical claim as
unresolved rather than invent a clock, infer consent, erase it, or execute a new
effect under retired authority. Historical receipts, releases and authorized
reversals continue to address their preserved obligations.

When an omitted cutover frontier or conflicting joint expense claims prevents a
single active projection, `unresolved_rights` retains each independently valid
causal proof with its reason and conditional obligation amounts, including its
principal, discharge and release. These alternatives are **not additive** and
must not be presented as zero debt. The report identifies
`financial_projection: PARTIAL_UNRESOLVED_V2`. Fresh retired authority creates no
active obligation; a receipt on an ambiguous historical entitlement keeps its
conditional numeric credit. Receipts on established historical obligations remain
active. Exact references and proof states remain available for later resolution.

Protocol 2 freezes existing milestone IDs and principals through amendments, and
keeps the same Request ID and party/key bindings. An existing protection-fee ID
retains its principal and parties; changed fees need a new identity. Novation of
existing units requires a future explicit policy. Pre-signing uses the same
counterfactual validation boundary without fabricated authorizations.

A hash chain can expose conflicting supplied histories; it cannot reveal every
withheld branch or ensure one universally shared view. The offline report says
what follows from the supplied bundle and always keeps historical completeness
and latest-state knowledge separate. The log-comparison discussion in
[RFC 9162](https://www.rfc-editor.org/rfc/rfc9162) is background; this protocol does
not implement Certificate Transparency or distributed consensus.

## Evidence and commit–reveal

Evidence bytes, manifests, provenance, commitments and assessment are separate
objects. A manifest binds exact digest/length/media type and relevant capture or
challenge references. A supplied attachment must match its declared manifest.
Manifest integrity is not physical truth, and a hash does not provide privacy.

Each ordinary completion, supplementary submission and reveal receives an explicit
attachment-integrity report: exact digest, declared versus supplied byte length,
missing bytes and invalid supplied bytes remain separate. Media type is a signed
declaration, not verified content semantics. A commitment opening and a valid
signature do not substitute for these byte checks. Missing or malformed evidence
does not automatically forfeit an already established right.

For an initial dispute round each author generates a fresh secret 32-byte salt:

```text
manifestDigest = SHA256(JCS(manifest))
message = JCS([
  "NONVERBA:DISPUTE-COMMIT:v1", deploymentDomain, assignmentId,
  agreementHash, disputeId, roundId, authorRole, manifestDigest
])
commitment = HMAC-SHA256(secretSalt, message)
```

The commitment event is signed. Reveal supplies the secret salt and exact manifest;
the verifier recomputes the commitment and checks supplied attachments. Do not send
M the honest party's plaintext early and then describe it as hidden from M's
coalition. Keep the salt and sensitive manifest digest private before reveal.
Use a maintained HMAC implementation. The construction's purpose and limitations
follow the randomized commitment discussion in
[ZKDocs](https://www.zkdocs.com/docs/zkdocs/commitments/).

Rounds distinguish committed, revealed and incomplete. Premature disclosure is
recorded as a weakened secrecy property, not undone. Missing reveal proves neither
fault nor consent and creates no confiscation. Supplementary rounds preserve later
evidence without altering old commitments. Commitment does not prevent side
channels, lies, refusal to reveal or selective withholding.

The implemented initial-round profile expects commitments/reveals from R, O and M
for a complete round. Other authentic records can still be retained while a round
is incomplete. An early-reveal warning describes missing causally known
commitments in the supplied view; it cannot detect every off-protocol disclosure.

Existing sensor records retain their own verifier/trust model. Report signature
validity, metadata policy, supported freshness and physical assessment separately.
A supported artifact rule proves its artifact predicate and only its authorized
consequence; it must not label physical work universally verified.

## Time, money and assurance boundaries

A participant timestamp is a claim. Without an implemented independent time/notice
mechanism, deadlines support reminders/escalation only. M's clock or absence of a
complaint in M's database cannot prove lateness, receipt, consent or forfeiture.

Task money moves directly from R to O. M receives no discretionary payment/refund
credentials and takes no commission. A payer statement, screenshot or webhook
authenticated using a secret held by M is not independent discharge proof against
R+M. The strict local profile uses a payee-signed receipt; additional provider proofs
must have a supported authenticated adapter and an explicit trust model. A payee
can withhold acknowledgment after actual payment, leaving evidence to resolve.

Retain partial payments, excess amounts, disputes and reversals distinctly. A
reversal observation is not automatic permission to change a balance. Only an
agreed supported reconciliation rule may do so. Do not equate payment instruction,
authorization, capture, settlement and irreversible finality.

Assurance is a separate explicit undertaking. Mediation remains free; separately
priced protection specifies its own provider, payer, price and payment record.
Financial protection additionally requires real funding/enforcement and product
review. Unsupported products remain disabled/unavailable. A signature establishes
a stated promise, not solvency. M's disputed refusal is an attributed position.
R/O settlement cannot increase M exposure or erase separate vested benefits.

## Verification and integration

One shared validation boundary must serve all adapters, admin/background paths and
the independent verifier. A bundle report separates valid signatures, authorized
effects, assumptions, known conflicts, missing references, unresolved claims,
observed payments and unknown history completeness. Machine error codes and human
explanations refer to the same checks.

Export/import uses portable signed files with access appropriate to each
recipient; M's permission is unnecessary for participants to exchange their own
entitled records. There is no requirement to build a new peer-to-peer network.

Examples, adversarial tests, randomized/state-machine tests and a small bounded
authorization model exercise this profile. A bounded model establishes only the
modeled finite cases; code tests and primitive vectors are not proof of fairness,
physical truth or all possible protocol executions. See [readiness](READINESS.md)
for the actually executed checks and remaining review.

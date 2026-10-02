# Workflow and interface contract

Human and machine clients use the same verified records and effect rules.
Requester and Operator workflows must remain usable by agents and embodied robots
under explicit authority. The Rust package supplies the shared protocol;
the existing sensor pages are not the marketplace interface.

## Normal path

1. **Terms and keys:** each participant establishes independently trusted role/key
   bindings. R and O accept the exact platform terms. Keep key material under the
   participant's control; account authentication alone does not authorize signing.
2. **Request:** R signs a versioned service description. Publication/discovery is
   operational metadata and imposes no obligation on O or M. A Request initially
   selects one Assignment; the service adapter must enforce admission consistently.
3. **Quote:** O signs scope, compensation, expense limits and conditions. R accepts
   or rejects this quote. Scope clarification produces a new O quote when needed.
4. **Preview:** show the exact Request/quote, R/O/M identities, key IDs, pinned
   policy/text digests, price/destination, acceptance consequences, deadlines,
   cancellation/remedies, privacy and assurance exclusions. Clearly distinguish
   mechanical artifact checks from judgment of physical work.
5. **Sign and exchange:** participants independently sign one Contract, then
   exchange/import authorizations. A local client verifies and retains the full
   R/O/M certificate. Partial signatures remain visibly unbound.
6. **Readiness:** verify local possession and all actually supported agreed
   preconditions. Show unavailable or unsupported protection as unavailable.
   In this profile, nonempty payment preconditions block readiness because no
   independent proof adapter exists. Nonfinancial service activation requires
   all three parties and no unsupported prerequisites; it certifies the stated
   undertaking, not performance or financial coverage.
   The local readiness flag does not check physical safety, service prerequisites,
   access/materials, durable storage or everyone else's receipt of the certificate.
   Present a true result as **Protocol record checks passed — operational readiness
   not assessed.** Keep `ready_to_start` as the existing machine field; it alone
   must not trigger robot actuation. An operational stop does not erase financial rights.
7. **Performance:** O may claim start/completion and submit attributed evidence.
   A cancellation/stop notice is a notice with only the supported pre-agreed
   operational consequences. Neither it nor a missed reminder creates a penalty.
8. **Acceptance:** R acknowledges the exact completion or an authenticated R/O/M participant submits proof
   for an enumerated pre-agreed rule. Record the exact rule/certificates supporting
   each created obligation. A unilateral completion claim alone creates no debt.
9. **Direct payment:** generate/reference the exact agreed R-to-O destination.
   Record payer statements separately from verified payee receipts. Discharge only
   signed unit intervals on the exact obligation/root basis; overlapping grants
   count coverage once. Retain partial/unresolved/overpaid/reversed records. A
   reversal names the exact earlier grant and requires all three authorizations.
10. **Export:** each entitled participant keeps its Contract, authorizations,
    certificates, evidence and receipts in a portable signed bundle. Independent
    verification needs no approval or continued availability from M.

## Companion review before cooperation

The DP-2 guided path adds review of the separately signed R/O prior profiles
and exact proposed analysis settings before base endorsement. Each participant
records its own acceptance or decline against the full review digest. This is
unsigned local workflow evidence, not another participant's consent. The guarded
signing path rejects changed reviewed material. After separate base and all-party
annex formation, setup completion checks both against that earlier review.

Base formation remains independent: a missing annex or failed setup check does
not invalidate a formed Contract or erase accrued rights. Existing signing
paths retain their rules. See the [companion guide](../../code/disputes/README.md)
for the exact commands and [integration guide](INTEGRATION.md) for core signing.

## Dispute path

A party opens a dispute concerning its role/rights and identifies the claim or
obligation. The dispute flags contested amounts without erasing independently
established receivables. M can review authorized evidence and issue attributed
assessments or settlement proposals; none is an adverse judgment.

Where fixed initial submissions help, create a named commit–reveal round. Each
author locally creates a fresh secret 32-byte salt and signs a commitment. The
salt and sensitive manifest stay private until reveal. Reveals open the exact
commitment and supplied attachments are checked against its manifest. Premature
reveal records weakened secrecy; non-reveal leaves an incomplete round. Later
material evidence belongs in a labeled supplementary round.

The supported outcomes are an authorized scoped settlement, a limited consequence
under a pre-agreed rule, or an unresolved factual dispute. No majority override,
mediator deadline assertion, account suspension or silence supplies missing
authority. An independent adjudicator needs a separately supported authenticated
adapter and an explicitly accepted scope; uploading a PDF does not create one.

Contradictory later statements remain evidence and cannot retract another party's
independently established grant. Ordinary completion, reveal and supplementary
manifests separately report missing/invalid attachments, length and digest checks.
Incomplete evidence is not an automatic forfeiture outcome.

### From analysis to an authorized outcome

The companion records analysis, source references and question dispositions
separately from verified protocol facts. A question marked answered, unnecessary
or superseded is a model interpretation, not a finding of truth or a release.
`ANALYSIS_READY` reports structural status, not semantic approval or permission
to act. Keep `ANALYSIS_ONLY`, financial authority `NONE` and settlement policy
`UNSPECIFIED` visible alongside analysis.

Participants can inspect the original evidence and consider an attributed
proposal. If R and O agree a release permitted by the existing core policy, they
independently review and sign a separate `BilateralSettlement` action identifying
the established compensation/expense obligation and exact release. Core
verification determines its supported effect. No model output supplies either
signature, changes M's rights or duties, establishes payment or closes unrelated
disputes. See [settlement handling](SETTLEMENT_HANDLING.md) for the exact review
requirements and example.

Keep a work change on the all-party amendment path, an actual transfer on the
direct-payment path, and payment acknowledgment on the payee-receipt path. The
companion's lack of financial authority does not disable these existing core
paths. An unresolved analysis selects no forfeiture, payout or default economic
outcome; existing active and conditional rights remain separately visible.

DP-2 is accepted and closed for synthetic workflow integration. The current local
Qwen model is retained as a workflow test component; its negative reasoning
findings remain in the retained evidence (local review record, not included in this source release).
Reliable reasoning and interpreting priors into settlement are separate future
work, not blockers to this closure.

## Local interface state

Display independent projections rather than one mutable Assignment status:

| Projection | What it communicates |
| --- | --- |
| Formation/readiness | Draft/partial/complete supplied certificate and supported record conditions; client retention must be checked separately |
| Performance | Not started, start claimed, completion claimed, accepted or disputed |
| Obligations | Exact compensation/expense lines, contractual basis, disputed/discharged/unresolved amounts |
| Grants | Exact credit/release unit intervals, certificate provenance, overlap and explicitly revoked units |
| Conditional rights | Individually valid causal proofs with unresolved cutover/cap applicability; principal/discharge/release retained separately, never summed as active obligations |
| Payments | Source and trust of observations; receipts; partial payments and reversals |
| Mediation | Open case, attributed proposals/assessments, agreed settlement or unresolved facts |
| Analysis | Execution provenance, interpreted claims and question dispositions; separate structural status and financial authority `NONE` |
| Assurance | Disabled/unavailable or precise supported undertaking; separate claims and assessments |
| Transcript | Valid signatures, authorization, missing dependencies, known conflicts and unknown latest-history completeness |

Receipt acknowledgment means identified bytes were acknowledged, not accepted.
Receiving evidence does not require three receipt signatures. A notice remedy
requires its own supported proof, not M's assertion of delivery.

Show incomplete contextual history separately from missing required-effect proof.
A late record or newly completed signature can add knowledge or reveal a conflict
without withdrawing an independently established effect. For example, conflicting
R/O expenses leave an unrelated, fully authorized M service fee active. Its
constitutive proof has not become uncertain merely because those expenses conflict.
Conversely, a payment receipt without its actual obligation proof cannot create
credit. Pre-signing and imported/merged views must enforce the same distinction.
Applied `effects[].proof_references` identifies the selected financial witnesses
and exact event/artifact proofs. Show this basis with the affected obligation;
keep arbitrary context and history-completeness diagnostics distinguishable.

## Adapter boundary

The same validator/reducer must gate all authoritative writes, including admin,
background-job, migration and payment-adapter paths. A future hosted store must
define atomic revision and uniqueness/idempotency checks to prevent accidental
double application. The current implementation provides local immutable records,
signing guards and encrypted snapshots; it does not implement that hosted store.
Independent certificate verification constrains which server-supplied effects a
client accepts under the declared trust assumptions. Hosted access control is
also future integration work; it cannot confer authority to rewrite obligations.

Signing and verification must remain usable outside an M-delivered web page.
The local CLI/export format is the first independent interface. A production
participant needs a protected signer, reviewed distribution/update channel, exact
preview/consent UX and durable storage. Those integrations are separately listed
in [readiness](READINESS.md).

The [native client](../../code/requests/README.md) exposes Request, quote, event,
Contract and action signing with exact reviewed digests. Import/merge encrypts
local snapshots, while plaintext exports are explicit. The report can include
rejected or incomplete records; a zero exit code means report generation, not
universal validity. Machine clients must inspect formation, effect and transcript
diagnostics rather than infer success from storage or process exit alone.

For `PARTIAL_UNRESOLVED_V2`, display `unresolved_rights` with each certificate,
reason and conditional amounts. A historical claim may remain unresolved without
losing its receipt's numeric credit. These alternatives are not additive and an
absent active line does not mean zero debt.

For historical v1 input, show `LEGACY_UNRESOLVED` prominently and retain recognized
signed proofs. An absent aggregate balance is unknown/unprojected, not zero.
Creating v2 future work is an explicit new choice; it never silently waives or
re-signs the older record.

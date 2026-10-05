# Contract notes and implementation record

**Drafting record AN-2 — 28 September 2026.** Applies to
`nonverba-requests` **0.2.1**, protocol/schema/policy **2**, guided terminal
adapter **1**. Read [the participant notes](PARTICIPANT_NOTES.md) first for the
short explanation. [The Contract specification](../../requests/CONTRACT.md) describes the
signed record; this document explains the promises that record can support today.

## Status and purpose

These notes record our present understanding of the implementation and the
decisions still needed for an actual service. They are **explanatory drafting
material, not adopted platform terms, a new signed Contract, or a finding of
legal enforceability**. No existing consent, signed text, policy, fixture or
financial authorization is changed by publishing these notes.

The distinction matters in both directions: code cannot make an unsupported
promise true, and the absence of an automatic code effect does not decide whether
a promise, claim or duty exists outside the protocol. These notes do not introduce
a liability waiver, damages cap, indemnity, arbitration requirement or exclusion
of mandatory rights. Those would require explicit decisions and legal review for
the actual parties, services and jurisdiction.

Current examples use synthetic identities, work and payment records. The guided
workflow is a development tool. Its templates are not production agreements.

### DP-1 / DP-2 analysis and settlement addendum — 29 September 2026

The live notes also cover the separate `nonverba-disputes` 0.1.0 companion.
The accepted AN-2 snapshot remains unchanged.
[The companion specification](../../requests/DISPUTE_PRIORS.md) maps the new records to code;
[open decisions](../../requests/DISPUTE_PRIORS_DECISIONS.md) record what is
still needed before priors could determine settlement. This addition does
not amend signed terms or activate a service.

DP-2 is closed and accepted for synthetic workflow integration, as recorded in
the owner closeout (local review record, not included in this source release).
The current local Qwen model remains a workflow test component. Retained negative
reasoning findings are unchanged; reliable reasoning and interpreting priors into
settlement are separate future work, not conditions for this increment's closure.

**Proposed explanation:** “Requester and Operator separately declare priors
using the exact accepted catalog and their own point budgets. The three parties
review both signed profiles and exact analysis settings before cooperation, then
acknowledge the same exact analysis context. Profiles support experimental
qualitative analysis; no settlement formula has been selected. Analysis, questions
and challenges do not themselves change obligations or authorize financial action.”

**Enforced boundary:** signatures bind the catalog, source profiles, formed
Contract and analysis specification. Independent trust, full-review digest
confirmation and local signing guards apply. The analysis module submits no core
Action. Financial reports are recomputed separately, including when analysis is
invalid. Failure, silence and compute exhaustion introduce no payment consequence.
Existing releases still need the right holder's proper authorization and are not
a general new-debt or dispute-closure mechanism.

The companion remains `ANALYSIS_ONLY`, with financial authority `NONE` and
settlement policy `UNSPECIFIED`. That boundary applies to the companion, not to
the existing core's independently authorized R/O release action. A model's
interpretation, including a question marked answered, unnecessary or superseded,
is not a verified fact or authority to release a claim. Structural validation and
`ANALYSIS_READY` do not certify reasoning or establish that a cited source
supports an interpretation.

The pre-cooperation workflow records each participant's unsigned local decision
against the complete review digest and checks for source/settings substitution
on its guarded signing path. Base and all-party annex formation remain separate;
extended setup checks their match to that review. This is not atomic exchange,
new consent on another party's behalf or a retroactive base-formation condition.

**Remaining limits:** shared manifests do not deliver evidence or establish its
truth. Runtime observations are not execution attestation. Structural tests do
not establish model competence or fairness. A sponsor budget is a development
counter, not commercial activation, billing, insurance or a funded service promise.
Prices, response commitments, operational privacy and appeal policy remain open;
the service worksheet stays unselected. No liability waiver or new remedy is
inferred from these explanatory notes.

## Three kinds of statement

| Kind | Meaning in this record | Example |
| --- | --- | --- |
| Enforced protocol rule | The verifier checks specified authorization and proof before recognizing its defined effect in the supplied records. | A task-payment receipt needs O's valid signature and an established obligation. |
| Signed commitment or description | Exact text is retained and covered by signatures; its meaning or real-world fulfillment is not generally computed. | A promised response time, a safe stopping condition, or a retention policy. |
| Missing service or unresolved decision | A schema field or proposed wording does not supply the capability. | Identity enrollment, funded protection, a bank adapter, production deletion, or selected governing law. |

“Verified”, “bound”, “accepted”, “active” and “ready” must always be explained in
their specific protocol sense. None is a general certification of lawful,
safe, truthful or fully performed work.

## Commercial policy and technical capability

The generic protocol can represent a separately authorized service fee with
either Requester or Operator as payer. This technical capability does not
establish Non Verba's commercial policy. The **requester-funded platform model**
keeps **Operator registration free, mediation free, and Operator compensation
free of commission or platform deductions**. Operator-funded services are not an
approved offering or product default in this drafting record.

A **Request-creation charge** and an **optional nonfinancial service fee** are
distinct commercial items. The Request-creation charge's amount, charging event
and operational implementation remain **UNSELECTED**. There is no implemented
Request-creation billing mechanism in this prototype. Optional-service terms
also need an explicit selection and a real operating process; activating that
service must not silently stand in for charging for a Request.

These clarifications do not retrospectively invalidate an authorized fee or
reinterpret a signed record. The generic payer schema and historical fixtures
remain unchanged. A future product/template default must implement the selected
commercial policy explicitly; a representable payer is not an adopted offering.

## Proposed Contract wording, with its present boundary

The following passages are drafting notes for review, not text automatically
incorporated into any record. A future terms release must retain exact versioned
text, display it, obtain the applicable signatures and match the executable
policy. Merely linking to these notes is not that process.

### 1. Parties and authority

**Proposed explanation:** “The Requester asks for the work. The Operator offers
and carries out the agreed work. Non Verba participates as Mediator, with only the
authority and service commitments stated in this Contract. Requesters and
Operators may use people, organizations, software agents or embodied robots.
The Contract identifies the responsible party, its signing authority and any
resources used to perform the work.”

**Current boundary:** The records distinguish a party/key binding from
`service.execution_resources`. A robot is not required to be operated manually,
but listing a robot does not establish its legal personality, its owner's
responsibility or its authority to bind another party. Independently established
role-key bindings are an input assumption. No general delegation, identity
enrollment, key rotation or account recovery service is implemented. The terminal
trust helper produces a synthetic template; it does not verify identities.

### 2. Scope, price and acceptance

**Proposed explanation:** “The Requester describes the required result and the
inputs, access and constraints it will provide. The Operator supplies its own
quote for that exact Request. Before signing the Assignment, each party reviews
the deliverables, exclusions, milestone prices, expenses and acceptance rules.
An acknowledgment of a milestone can establish its agreed compensation. A
pre-agreed digital artifact rule establishes only the consequence stated for
those exact bytes.”

**Current boundary:** The code binds the Request, Operator quote and Contract
to exact digests and checks milestone amounts and rule scope. It cannot decide
whether a physical result is satisfactory or a description is safe, complete or
lawful. An Operator's completion claim alone does not establish compensation.
The Requester's acknowledgment is a consequential authorization, not a casual
“message received” button. The signing display must explain that consequence
from the exact object being reviewed, as specified below.
It can establish the milestone amount without all attachments being available
or valid; checking the evidence remains distinct from choosing to acknowledge.

### 3. Consent and formation

**Proposed explanation:** “The Requester accepts the exact platform terms in its
signed Request. The Operator accepts those same terms in its signed quote.
The Assignment is bound in the protocol when R, O and M have each authorized the
same Contract. Each participant should retain and verify its complete copy.”

**Current boundary:** The current flow does not include separate account signup
or a general terms-acceptance registry. The embedded Request terms are retained
in the Contract; additional Contract text is covered by its separate R/O/M
signatures. No signing order is required. A participant can withhold its signature
or the resulting record. Viewing a draft or a digest creates no signature.

“Bound in the protocol” is a technical result, not a conclusion about contract
formation under applicable law. `ready_to_start` is a separate, limited check
of the supplied records. It does not certify site safety, service prerequisites,
payment capacity, legal permissions or delivery of the certificate to everyone.
Use **Protocol record checks passed — operational readiness not assessed** for
a true local result, keeping `ready_to_start` as the machine field. Durable
certificate retention is a client responsibility, not an attestation made by
that boolean. It must not by itself actuate a robot or serve as site-safety
approval. A separately defined operational process decides practical readiness;
an operational stop or open dispute must not erase established financial rights.

### 4. Payment and expenses

**Proposed explanation:** “Task payment is direct from Requester to Operator.
Non Verba takes no commission and has no protocol authority to hold, divert,
refund or release task funds. Work compensation, authorized expenses and any
separately agreed nonfinancial service fee remain distinct. A payment receipt
acknowledges only the exact obligation and amount it names.”

**Current boundary:** No command transfers money. A payer statement is an
attributed claim, not discharge of the debt. The actual payee's signed receipt
can discharge the exact authorized units in the protocol, but does not prove
bank settlement or finality. A payee can withhold a receipt. There is no forced
receipt, escrow, automatic refund, collection service or payment guarantee.

Expenses require supported category/cap rules, R/O authorization and the required
evidence reference. Evidence integrity does not prove that an expense was
necessary or truly incurred. Paying or releasing an authorized expense does not
replenish that category's cap. Receipt/release overlaps count once; the same
covered units cannot be counted as two payments.

The stated receipt amount, allocated coverage, overlap with prior grants and
unallocated excess are different quantities. A receipt explanation must not
promise that the whole stated amount reduces the balance. The exact obligation
and allocated units govern the supported credit; there is no generic “paid”
override.

An obligation's principal or outstanding amount also does not establish that all
conditions for payment have occurred. The report retains due-condition wording;
the verifier does not generally interpret narrative payment conditions. The
parties need a process for establishing their fulfillment. For example, a
**hypothetical, unselected** service fee payable after delivery of a report would
not become proof of that delivery merely because activation recorded its
principal. This illustrates the drafting boundary, not a reproduced defect or an
adopted fee policy. No due-date evaluator, automatic demand, forfeiture, refund,
penalty or cancellation effect is introduced by this explanation.

### 5. Mediation and optional service

**Proposed explanation:** “Mediation is free and produces proposals. A proposal
does not itself change anyone's rights. Any additional service must identify its
provider, beneficiaries, scope, response commitment, limits, exclusions, claim
and challenge routes, and any separate fee before activation.”

**Current boundary:** Only an explicit nonfinancial M service is supported.
All three parties must authorize activation for the exact Contract. Activation
records an undertaking; it does not establish that the service was delivered.
`financial_compensation` must be false. The code creates no insurer, reserve,
funding pool or compensation obligation for failed work. The generic record can
have R or O as its explicit payer and M as payee; it is not netted from task pay.
The O-payer capability is not an approved Non Verba offering or default: the
requester-funded policy above governs product decisions. Any fee is separate
from a Request-creation charge. Its due-condition text is retained, not
interpreted as an arbitrary payment rule.

“Protection” and “assurance” are existing schema names. Participant language
should say **nonfinancial service commitment** and describe the particular
service. No unqualified “insured”, “guaranteed payment”, “funds secured” or
“protected against loss” claim is supported by this build.
This present limitation does not preclude a separately developed future
assurance product. It does not supply such a product or select its terms.

### 6. Change, interruption and disagreement

**Proposed explanation:** “A proposed change, cancellation notice, rejection or
dispute is retained as the relevant party's statement. It does not automatically
erase an established claim or create a penalty. Amendments require the supported
R/O/M authorization. A Requester/Operator settlement releases only the specific
supported R/O claims it identifies and preserves other parties' rights.”

**Current boundary:** A root amendment must satisfy the protocol's restricted
change rules and signed history references. It cannot arbitrarily reprice an
existing milestone or replace party keys. Except for an exact action explicitly
preserved by the signed amendment, fresh use of a retired rule is not permitted
when authenticated causal context demonstrates knowledge of its successor.
That knowledge is separate from the proof required for the financial effect.
Uncertain ordering may leave a historical claim conditional instead of erased.

R/O settlement cannot waive M's separate fee, impose new duties on M or expand
its service exposure. The implemented `BilateralSettlement` action requires both
R and O and releases only identified, established R-to-O compensation or expense
units under the enabled policy. It names the entitlement certificate and exact
allocations, retains other rights, and counts overlap with payment credit once.
It does not create debt, certify payment or resolve unrelated claims.

Analysis and attributed proposals may inform review, but there is no automatic
conversion into that action. R and O must independently inspect the exact core
proposal and its financial consequence before authorizing it. A work change uses
the supported all-party amendment path; payment remains direct and its protocol
credit requires the payee's receipt. An interpretation of priors is not a
substitute for any of these authorizations. No settlement formula or monetary
fallback is selected by these notes. [Settlement handling](../../requests/SETTLEMENT_HANDLING.md)
connects these steps and records their code boundaries.

All-party reversal reconciliation names an exact receipt
and its exact units; it does not claw back unrelated grants or move bank funds.
There is no automatic cancellation payment, missed-deadline penalty, silence-as-
acceptance rule, or general dispute judgment. External lawful remedies are not
decided by the verifier, and an uploaded ruling has no implemented automatic
adjudication effect.

### 7. Evidence, records and privacy

**Proposed explanation:** “Keep the exact Contract, applicable terms, signatures,
changes, evidence and payment records needed to understand the Assignment. A
signature identifies authorized content relative to trusted keys; an integrity
check identifies matching bytes. These checks do not establish that a recorded
physical event occurred as described.”

**Current boundary:** Local vaults and retained snapshots support authenticated
encryption. Reviews, ordinary exchange files and explicit exports can contain
plaintext; encryption is not a system-wide privacy guarantee. The code does not
enforce the declared recipient list, disclosure purposes, retention period or
deletion promises. It cannot delete another participant's exported copy.

The production retention period, responsible data-handling parties, permitted
recipients, secure transport, access procedures and treatment of disputes remain
to be selected. Records should be scoped to their actual purpose; the examples
do not authorize real personal or sensitive data collection. The historical AN-1
notes packet contains documentation only. The referenced implementation packet includes
public key bindings and explicitly synthetic test keys/passwords; real private
signing material, live credentials and private vault files are excluded.

## Consequential signing display

The AN-2 display clarification uses the exact retained object under review and
the existing verifier. It does not create another authority engine, change
wire fields, amend signed terms or supply a new authorization record. Generated
parties, amounts, scope and digests must come from that object and its verified
context, not from an editable summary or a previously viewed draft.

| Review object | Consequence the display must make clear | Distinctions it must retain |
| --- | --- | --- |
| Requester milestone acknowledgment | Identify the completion, milestone, Contract digest and agreed compensation that acknowledgment can establish. | Ordinary message/file receipt is not milestone acceptance. A previously established obligation is not another charge. Evidence availability/integrity is separate; missing bytes were not inspected. No unstated release of remedies is added. |
| Payee receipt | Identify the payee, stated receipt amount, obligation and exact allocated credit units/ranges. | Stated amount, allocated amount, overlap and unallocated excess remain separate. A payer claim cannot substitute for the payee's signature. The action moves no funds and does not independently verify bank settlement. |
| Scoped R/O settlement | Identify only the obligations and units released. | No release of unrelated claims or alteration of M's separate fee/service obligations. No generic Contract patch or “paid” override. |
| Formation and readiness | Keep partial signers visibly incomplete. For a true local readiness result, say “Protocol record checks passed — operational readiness not assessed.” | Formation, performance, payment, financial projection, dispute and readiness remain independent; no physical actuation or durable-retention attestation follows from the flag. |

The focused AN-2 run checked two-signature incompleteness, message receipt versus
milestone acceptance, the actual acknowledgment amount, payer versus payee,
overlapping credit, a physical dispute beside local readiness, and M's separate
fee beside an unrelated expense conflict. The execution scope and logs are
identified under provenance below; they are distinct from this display contract
and from delivery of any operational service.

## Code and evidence map

Paths below identify the implementation reviewed for this note. Function names
are used instead of movable line numbers. The dated source manifest records exact
bytes; a changed source file requires reassessing the corresponding statement.

| Claim or boundary | Current implementation | Supporting evidence |
| --- | --- | --- |
| Roles are R/O/M; execution resources are separate from party authority | [model.rs](../../../code/requests/src/model.rs): `Role`, `PartyBinding`, `Service`; [contract.rs](../../../code/requests/src/contract.rs): `validate_trust` | `coalitions.rs`: `administrator_key_replacement_cannot_change_existing_agreement_authority` |
| R accepts embedded terms; O accepts their exact digest and supplies the quote | `contract.rs`: `verify_request`, `verify_quote`, `validate_contract` | `coalitions.rs`: `requester_cannot_change_an_operator_quote_even_if_all_root_signatures_are_new` |
| Same Contract requires all three roles; terms remain exact | `contract.rs`: `verify_contract`; [crypto.rs](../../../code/requests/src/crypto.rs): `signing_bytes`, `verify` | `coalitions.rs`: `a_new_platform_policy_or_terms_artifact_cannot_rewrite_old_signatures`; retained partial capture |
| One Assignment per Request is an honest local signing guard, not global uniqueness proof | [nonverba-assignment.rs](../../../code/requests/src/bin/nonverba-assignment.rs): `endorse`, `request-assignment` slot; [local.rs](../../../code/requests/src/local.rs): `reserve_signing_slot` | `local.rs` tests: `durable_guard_refuses_conflicts_and_partial_crash_records`; rollback/hidden history remain unsupported |
| Exact preview and participant authorization; current templates remain synthetic | [review.rs](../../../code/requests/src/bin/nonverba-workflow/review.rs): `Review::validate`, `render`; [drafts.rs](../../../code/requests/src/bin/nonverba-workflow/drafts.rs): `request`, `contract` | Adapter tests `preview_covers_exact_scope_quote_destinations_exclusions_and_policy`, `formatting_and_later_source_changes_do_not_rewrite_retained_terms` |
| Consequence display authenticates exact context before confirming an amount; repeated acknowledgment is not another charge | `review.rs`: `render_verified`, `action_consequences`, `completion_evidence`; `bundle.rs`: `known_agreement`, `validate_unsigned_action` | Adapter tests `verified_ack_explains_duplicate_amount_and_separates_missing_or_invalid_evidence`, `missing_exact_agreement_never_borrows_root_price_and_partial_formation_stays_incomplete` |
| Receipt prose separates stated amount, exact allocated coverage, overlap and excess | `review.rs`: `action_consequences`, `existing_grants`; `rights.rs`: `allocation_amount` | Adapter test `receipt_review_separates_statement_coverage_excess_and_existing_grants`; `workflow.rs`: `consent_display_keeps_message_acknowledgment_and_overlapping_receipts_distinct` |
| Readiness checks only specified record conditions | [bundle.rs](../../../code/requests/src/bundle.rs): `verify_assignment_bundle`, readiness construction | Partial and late-context captures; physical-dispute capture is still locally ready |
| Only a closed set of actions creates effects; no arbitrary text interpreter | [actions.rs](../../../code/requests/src/actions.rs): `required_authorizers`, `validate_authorizations`, `prepare_action_signature`; `bundle.rs`: `apply` | `coalitions.rs`, `effect_dependencies.rs`, `review_late_context.rs` |
| Task entitlement needs R acknowledgment or a valid pre-agreed artifact rule | `bundle.rs`: `apply`, acknowledgment/artifact branches; `contract.rs`: artifact criterion checks | `lifecycle.rs`: `requester_rejection_cannot_erase_preagreed_exact_artifact_entitlement`, `changed_attachment_bytes_never_satisfy_an_exact_artifact_rule` |
| Exact payee receipts, releases and scoped reversals; no transfer of funds | `actions.rs`: authority matrix; [rights.rs](../../../code/requests/src/rights.rs): `grant`, `revoke`, `refresh` | `rights.rs`, `verifier_edges.rs`; settlement and reversal captures |
| Expense caps cover authorized principal; receipts do not restore the cap | `bundle.rs`: expense application and typed effect dependencies | `effect_dependencies.rs`: `paid_and_released_expenses_still_consume_the_same_category_cap`, `repeated_compatible_expense_certificates_consume_the_cap_once_per_identity` |
| Financial assurance unsupported; explicit service activation needs R/O/M | `contract.rs`: `validate_contract`, assurance branch; `bundle.rs`: activation branch | `review_late_context.rs`: `service_authority_scope_and_supported_prerequisites_remain_required` |
| Unrelated contradictory context cannot itself revoke an independent established right | `bundle.rs`: authenticated knowledge and required-effect projection; `rights.rs`: independent grants | `review_late_context.rs`, `effect_dependencies.rs`; late-context capture retains M fee separately |
| Evidence checks distinguish authenticity, integrity, missing bytes and claims | [evidence.rs](../../../code/requests/src/evidence.rs): `index_attachments`, `validate_manifest`, `event_reports`; [transcript.rs](../../../code/requests/src/transcript.rs) | `evidence_integrity.rs`, `transcript.rs`, physical-dispute capture |
| Narrative timing, safety, remedies, privacy and legal choices do not become executable authority | `model.rs`: respective record fields; `contract.rs`: text/shape checks; `bundle.rs`: closed effect branches | Closed action matrix and source inspection; no legal, safety, deletion or deadline enforcement adapter exists |
| Encrypted retention and immutable writes are local capabilities | `local.rs`: `seal_evidence`, `write_immutable`, `store_encrypted_snapshot`, `merge_bundles` | `local.rs` tests: `evidence_bundle_defaults_to_authenticated_encrypted_retention`, `bundle_merge_combines_partial_signatures_and_preserves_conflicting_records` |
| Reports preserve independent statuses and conditional claims | `bundle.rs`: `BundleReport` construction; [inspection.rs](../../../code/requests/src/bin/nonverba-workflow/inspection.rs): `render` | `workflow.rs`: `disputed_and_scoped_fixture_views_preserve_every_core_distinction` |

Test names in this table refer to files under
[`code/requests/tests`](../../../code/requests/tests), except the adapter unit tests
in the linked binary modules. The existence of a test name is not itself a pass
claim; preserved execution evidence is identified below.

### Signed fields that require operational follow-through

| Field group | What the current code does | What cannot be advertised as already provided |
| --- | --- | --- |
| `service.prerequisites`, `requester_inputs`, `safety_stop_conditions`, location and resources | Retains signed scope and performs bounded shape/text checks. | Site inspection, physical interlocks, safe task classification, access delivery, robot certification or permission to start work. |
| `timing.*`, `policy.time_rule` | Retains timing text; supported time policy is `REMINDERS_ONLY`. | Trusted clock, delivered notices, automatic scheduler, deadline adjudication, default consent or penalties. |
| `payments.due_conditions`, `reversal_treatment` | Retains due wording with established obligations and uses explicit supported grant/reversal rules. | A general interpreter of “net 30”, bank clearing, chargebacks or arbitrary due conditions. |
| `payments.preconditions` | Any nonempty list blocks local readiness because proof adapters are unsupported. | Verified deposits, advance funding or credit checks. |
| `mediation.obligations`, availability and escalation | Retains promises; requires free, proposal-only mediation. | A staffed help desk, response SLA or binding adjudication. |
| `assurance.*` service descriptions, triggers, claim/challenge routes and limits | Restricts product type and authorization; nonempty prerequisites prevent activation. Creates the defined service undertaking and any separate fee through supported activation. | Actual service fulfillment, automated trigger adjudication, funded protection or enforcement of every written service condition. |
| `remedies.*` | Retains text and requires accrued-claim preservation. | Automatic refunds, cancellation charges, damages calculations or comprehensive partial-work remedies. |
| `privacy.*` | Retains declared policy; local storage/export mechanisms exist separately. | End-to-end access enforcement, hosted retention/deletion, recipient compliance or deletion of shared copies. |
| `legal.*`, identity record | Retains exact terms and requires mandatory-rights reservation. Law and jurisdiction can be unset. | Established legal capacity, verified representative authority, selected forum, compliant consent or legal enforceability. |

## Historical illustrations from the retained integration run

These are the **preserved pre-AN-2 synthetic captures**, not transactions or
claims about a customer. Their original display text is unchanged. EUR amounts
below translate the captured integer minor units using exponent 2; the inspection
report preserves the original integers.

| Captured case | What the report shows | Drafting implication |
| --- | --- | --- |
| Partial formation (local review record, not included in this source release) | Two Contract signers; unbound and not ready. | A partial certificate is not the all-party Assignment result. |
| Completed lifecycle (local review record, not included in this source release) | A EUR 100 entitlement with EUR 100 covered by O's receipt. The workflow separately exercises a payer observation with no discharge effect. | Say “payee receipt verified”; do not claim observed or irreversible bank payment. |
| Physical disagreement (local review record, not included in this source release) | EUR 100 established under an exact artifact rule remains disputed; local readiness is true. | Neither byte integrity nor readiness resolves physical quality or safety. An unrelated rejection does not erase the accepted rule's effect. |
| R/O settlement (local review record, not included in this source release) | EUR 25 released from EUR 100 task compensation, leaving EUR 75; M's separate EUR 5 fee remains. | Describe exactly which claim is released and whose rights are untouched. |
| Scoped reversal (local review record, not included in this source release) | EUR 20 of one receipt's coverage is reversed; remaining discharge is EUR 80 and balance EUR 20. | No general “mark unpaid” control; the other receipt survives. |
| Late conflicting context (local review record, not included in this source release) | Active M fee EUR 5, two separately conditional EUR 15 expenses, and readiness false. | Failed readiness is not zero debt. Conditional alternatives must not be added into a total or used to remove M's fee. |

### AN-2 inspection and consent captures

The new inspection captures show the revised readiness and due-condition
explanations for completed work (local review record, not included in this source release),
partial formation (local review record, not included in this source release),
physical disagreement (local review record, not included in this source release),
settlement (local review record, not included in this source release),
reversal (local review record, not included in this source release)
and late conflicting context (local review record, not included in this source release).
Their bundle/trust input bytes match the corresponding historical inputs, and
their core report JSON is unchanged. Only the inspection presentation changes.

Four additional captures exercise `authorize` with a **blank digest**, cancelling
before vault opening or passphrase use. They contain no newly created signatures
and do not execute the proposed financial effects:

| Actual consent display | What is visible |
| --- | --- |
| Duplicate milestone acknowledgment (local review record, not included in this source release) | Exact milestone, completion and Contract; already established compensation is not another charge. |
| Overlapping receipt (local review record, not included in this source release) | Unsigned stated amount 4000 EUR minor units, allocation `[5000,8000)`, coverage 3000 and unallocated excess 1000. Existing grants are shown; no resulting balance is predicted. |
| Scoped settlement (local review record, not included in this source release) | Named releases and exact units, with M's separate rights and unrelated claims preserved. |
| Payer observation (local review record, not included in this source release) | A proposed payer statement grants no payee credit or release and moves no money. |

## Decisions needed before adopting real terms

Keep this list as explicit unresolved work. A developer must not fill it with
plausible defaults and then present those defaults as agreed commercial terms.

| Decision | Needed outcome | Current position |
| --- | --- | --- |
| Service provider and responsible parties | Actual legal names, notices/contact routes, authority checks and relationship of machine execution to the party. | Synthetic identities; no production enrollment. |
| Launch jurisdiction and audience | Selected legal review for the intended locations, consumer/business use, work categories and automated execution. | No launch jurisdiction selected in these notes; fixture law/forum are unset. |
| Work and stopping responsibility | Clear R inputs/access, O scope/capability, safe stopping and interruption handling for each task. | Signed fields exist; physical controls and request hardening are separate work. |
| Acceptance and payment conditions | Task-specific criteria; precise explanation of acknowledgments, artifact rules, expenses and receipt consequences. | Bounded rules exist; arbitrary narrative conditions are not executable. |
| Cancellation, nonperformance and liability | Agreed treatment of incurred work/costs, breach, loss and outside remedies, reviewed against mandatory obligations. | No blanket waiver, automatic cancellation fee, indemnity or damages cap adopted here. |
| Mediation and optional service | What Non Verba can actually staff/deliver, through which channel and within what time; any fee and due conditions. | No production availability promise or funded product. |
| Request-creation billing | Requester-funded commercial terms and an actual charging process, separate from optional service fees. | Amount, charging event and implementation UNSELECTED; no implemented Request-creation billing. |
| Data and retention | Actual purposes, recipients, lawful handling, retention/deletion process, access/export and dispute preservation. | Local mechanisms only; fixture text is not a production privacy notice. |
| Key and software operations | Independent enrollment, trusted distribution, backup/guard continuity, compromise and recovery procedure. | Software vaults and local guards; no complete production recovery or rollback defense. |
| Complete user consent | Accessible display of exact text and consequences, delivery/retention of the complete certificate, and a tested automated-agent authorization policy if used. | Manual guided terminal review; arbitrary delegated agent consent is not implemented. |

### Unadopted service decision worksheet

Complete one worksheet for each proposed Non Verba service before offering it.
This is not a prefilled contract. **UNSELECTED** means no actual value is adopted
by these notes; a fixture or signed schema field does not fill the blank. The
requester-funded policy, free Operator registration and free mediation remain
the product direction while individual service terms are unresolved.

| Item | Decision required before an offering | Actual selected value |
| --- | --- | --- |
| Service and beneficiary | Concrete help provided and the parties entitled to receive it. | **UNSELECTED** |
| Trigger and prerequisites | What starts the undertaking and what must already be available; distinguish narrative promises from supported activation rules. | **UNSELECTED** |
| Responsible provider | Actual responsible party; the schema's M role alone does not identify a legal service provider. | **UNSELECTED** |
| Operating owner and contact | Person/team accountable for delivery and a channel that actually operates. | **UNSELECTED** |
| Response commitment | A response window the provider chooses and can support, with a process for observing it. | **UNSELECTED** |
| Delivery evidence | Record showing the promised help was provided and who can inspect it. | **UNSELECTED** |
| Optional-service fee | Explicit payer, amount, charging event and due conditions within the product policy; separate from task compensation and Request-creation charges. | **UNSELECTED** |
| Failure or disagreement | Contact/challenge route and any expressly selected treatment; no inferred automatic refund, penalty or waiver. | **UNSELECTED** |
| Data handling | Actual recipients, access, retention, export and deletion processes, including dispute preservation. | **UNSELECTED** |

No operating owner, response window, service availability or remedy is invented
to make this worksheet look complete. Recording an undertaking or a fee is not
evidence that the operating process exists or that its payment conditions have
been fulfilled.

An official starting point for counsel considering machine-to-machine contracting
is the [UNCITRAL Model Law on Automated Contracting (2024)](https://uncitral.un.org/en/mlac).
It addresses recognition and attribution of automated transactions and complements
other law; it is not a determination of the law applicable to Non Verba. This
reference does not select a jurisdiction or confer legal personality on a robot.
Source consulted 28 September 2026.

## Provenance and updating this record

The historical source baseline is the retained
integration review export (local review record, not included in this source release),
SHA-256 `ee8907908f2d439c27dfbb93a6ab9377998262c49ddb267b8f5039af13b12626`.
Its 206 entries preserve the earlier reviewed core and the added terminal adapter.
AN-1 followed that export; AN-2 responds to the subsequent documentation review
and adds focused adapter presentation work. Neither these notes nor the adapter
inherit any earlier reviewer's approval. AN-2 does not change protocol 2, the
core payer schema or historical signed fixtures.

The native log (local review record, not included in this source release) records
168 passing tests, no failures and no ignored tests. The
parity log (local review record, not included in this source release) records 27
native/WASM comparisons. The
build log (local review record, not included in this source release) records format,
lint, native and WASM build checks. These are prior executed results for the
identified historical code, not a fresh execution for AN-2 or a proof of
all possible histories. No sensor implementation or validation claim is included.

The preserved AN-1 source manifest (local review record, not included in this source release)
and AN-1 packet (local review record, not included in this source release)
identify the earlier documentation revision. The supplied AN-1 review of
28 September 2026 reports reconstructing its three embedded documents and
matching their declared byte counts and SHA-256 hashes. That review did not
inspect the linked integration export, source or logs and did not execute Rust,
WASM, adapter or deployment tests. Its retention recommendation is not approval
of the unseen adapter, adopted terms or production readiness.

The new AN-2 source manifest (local review record, not included in this source release)
and AN-2 packet (local review record, not included in this source release)
record this revision, the inspected source and its separately reported validation.
Of the 49 recorded package files, **45 are unchanged**. The four changed files are
the adapter's `review.rs`, `main.rs`, `inspection.rs` and `tests/workflow.rs`.
The protocol core, schema, draft templates and signed fixtures remain unchanged.

The fresh AN-2 native log (local review record, not included in this source release) records
**24 passing tests, 0 failures and 0 ignored**: 20 adapter unit tests and four
workflow tests. The exact focused command was:

```text
docker exec 88253aa2f41822b2160155831f2a5237d382b7778e79bd6ce55d16da0fc1f6a6 bash /workspace/code/dev.sh exec cargo test --locked --manifest-path requests/Cargo.toml --bin nonverba-workflow --test workflow
```

The AN-2 build-check log (local review record, not included in this source release) records
passing formatting checks, all-target Clippy with warnings denied and builds of
both native binaries. **No fresh full core test suite, WASM build or native/WASM
parity run was performed for AN-2.** The prior 168/27 results remain historical;
they are not substituted for this focused validation.

Documentation hashes, inspected source, executed checks and delivered operational
services are different claims. Hashes identify bytes; they do not notarize a
date, prove delivery, show acceptance or create legal privilege.

For each future change:

1. Identify the affected promise, rule, source file and test or operational proof.
2. Update the participant explanation and this detailed map together. Do not
   describe a planned service as available.
3. Decide explicitly whether signed terms, executable policy, wire version or
   consent flow changes. Documentation alone cannot change existing assignments.
4. Retain prior terms, records, review findings and snapshots. Create a new dated
   evidence record; do not overwrite historical exports to make old claims appear
   current.
5. Validate the changed behavior and consent display, obtain the appropriate
   review for real deployment, and only then make corresponding service claims.

The exact core and non-retraction clauses remain in
[the Contract specification](../../requests/CONTRACT.md#core-clause-for-legal-review). These
notes neither replace their wording nor turn their design aims into an absolute
guarantee of outcomes.

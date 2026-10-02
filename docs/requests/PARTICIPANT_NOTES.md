# Notes for participants reviewing an Assignment

28 September 2026 · note revision AN-2 · package 0.2.1 · protocol 2 · terminal adapter 1

These are explanatory drafting notes for the development prototype, not adopted
legal terms. They do not change any signed Agreement or create a new promise.
The exact retained Agreement, its policy and the authorized records are what
the verifier checks.

## DP-1 / DP-2 addition: priorities and settlement review

29 September 2026. The accepted AN-2 snapshot retains its original bytes; this
addition is explanatory and creates no newly adopted terms.

These priorities describe what each participant wants the dispute-resolution
process to consider if cooperation leads to disagreement.

The Requester and Operator can each allocate **250 points** across **result,
effort, reliance, responsibility and remedy**, using 0–100 whole points each.
Both profiles remain separately visible. Zero waives no right; 100 is not 100%
of the payment. A balanced draft is only a draft. Non Verba has no third profile.

Each owner signs its profile. The guided pre-cooperation path lets participants
review both signed profiles and the exact analysis settings before signing the
base Agreement, and record a local acceptance or decline. That local decision is
not another party's consent. R, O and M separately endorse the same annex,
binding the exact formed Agreement, both profiles and those settings. Extended
setup requires the complete base Agreement and all three annex endorsements,
matching the earlier review. An incomplete annex does not undo a formed Agreement.

The experimental analysis is intended to organize claims, missing evidence and
priority tradeoffs. **How points become settlement remains undecided.** Analysis cannot
award money, confirm payment, waive a claim or authorize robot actuation. Missing
evidence, silence, cancellation, unavailable computation or an exhausted budget
does not mean anyone lost the dispute. Existing rights and conditional or unknown
claims retain their separate meanings. Voluntary repair is not a new duty to do
unpaid or indefinite work.

Questions propose evidence. A model's label that a question is answered,
unnecessary or superseded is still its interpretation: it does not establish a
fact, close a dispute or waive anyone's rights. An answer is an attributed signed
submission; inspect the original file as well as its digest, length and media type
in the review. The text model does not see photos or hear audio. A challenge stays
alongside the earlier analysis and never reverses a right. Plaintext exports can be replayed
against independently trusted keys; consistent records do not prove honest model
execution or correct reasoning. No funded assurance service has been activated.

DP-2 is closed as an accepted synthetic workflow-integration increment. The local
Qwen model remains a workflow test component; its recorded reasoning failures
remain failures. Reliable reasoning and the translation of priorities into
settlement are separate future work. See [the current explanation](DISPUTE_PRIORS.md)
and retained closeout (local review record, not included in this source release).
The optional participant walkthrough remains deferred.

## What the protocol is designed to protect

> **No coalition of two parties can create a valid contractual state that improperly alters the third party's rights.**

In the supported protocol, an effect on your protected rights needs your scoped
authorization or an exact rule you previously accepted, applied with its required
proof. The other two parties agreeing is not new authority over you. This is a
design requirement under the stated key, software, policy, and evidence
assumptions—not a guarantee of physical performance, payment collection, or the
absence of private collusion.

## Who takes each role

The **Requester** describes the service wanted and accepts or rejects the
Operator's quote. The **Operator** sets that quote and undertakes the agreed
service. Neither role requires a human to perform the work: an embodied robot,
software agent, person or team can be the execution resource.

Keep the executing robot separate from the **principal** for whom it acts.
For a real deployment, identify the legally responsible principal, which key may
sign for that party, and the permitted scope of that authority. A robot's device
identity or an account login does not answer those questions. Do not assume
that its owner, manufacturer or controller is automatically the responsible
party. The current verifier checks supplied, independently trusted key bindings;
it does not establish legal identity, capacity or general delegated authority.

The **Mediator** is Non Verba's identified party to the Agreement. Mediation is
free and proposal-only. The Mediator can help the Requester and Operator find a
settlement, but its opinion does not itself decide payment or change their
obligations. A separately agreed service, if present, has its own scope and fee.

The product policy is **requester-funded platform charges, free Operator
registration, free mediation, no commission and no platform deduction from
Operator compensation**. A generic service record can name an Operator as payer,
but that capability is not an approved Non Verba offering or default. A
Request-creation charge is separate from an optional nonfinancial service fee.
Its amount, charging event and operating implementation remain **UNSELECTED**;
this prototype does not implement Request-creation billing. These explanations
do not change or invalidate an existing signed fee.

## Before anyone signs

The Requester signs a Request that includes the exact platform terms being
accepted. The Operator signs its quote and acceptance of those same terms.
Posting a Request alone does not assign work or bind an Operator. The first
version supports one Assignment per Request; the local signing guard is not a
global registry of every Assignment.

All three parties then review the same Assignment Agreement. Check:

- Who is responsible, whose keys are authorized, and which Request and quote
  this Agreement covers.
- The work, exclusions, acceptance criteria, prerequisites, safety and stop
  conditions, and what counts as completion.
- The currency, compensation, expense limits, due conditions and exact payment
  destination; keep any separate service fee visible.
- Which evidence and signatures can establish a recorded obligation, acknowledge
  payment, release an amount or reverse a named receipt.
- Any separate service's activation, limits and claim process, plus the exact
  retained terms and intended recipients of evidence.

If those details are unclear, clarify the draft before signing. A cap is a
limit, not proof of spending, available funds or guaranteed reimbursement.

## Signing and retaining the Agreement

Initial formation requires valid Requester, Operator and Mediator signatures
on the same exact Agreement. Platform-terms acceptance and Assignment consent
are separate records. Two signatures do not substitute for the third.

The terminal workflow displays the retained content, signing context, supplied
trust bindings and full content digest. Review the substance before typing the
complete digest and entering the local passphrase. The digest identifies the
reviewed bytes; it does not explain them. A valid signature attributes those
bytes to a trusted key and authorizes only the supported action and scope.

For consequential actions, check the explanation against that exact object:

- **Milestone acknowledgment:** identify the milestone, Agreement digest and
  agreed compensation. This can establish that compensation; another
  acknowledgment of an already established obligation is not another charge.
  Evidence availability and integrity must be shown separately.
- **Payee receipt:** distinguish the stated receipt amount from the exact
  obligation and units credited. Overlap with prior coverage and unallocated
  excess mean the whole stated amount may not reduce the outstanding balance.
- **R/O settlement:** identify only the obligations and units released. It does
  not release unrelated claims or change Non Verba's separate fee or service
  obligations.

These explanations do not replace the signed object or add a waiver of remedies.

Each participant uses its own vault and passphrase and retains its own complete
certificate. Keep the vault's signing-guards directory with it during backup
and restoration. Non Verba should not hold the Requester's or Operator's vault
or passphrase. Separate folders in the shared development container are only
logical owner contexts; they do not provide operating-system isolation.

Treat a true local `ready_to_start` result as **Protocol record checks passed —
operational readiness not assessed.** It checks the supplied certificate and
supported record conditions. It does not attest successful durable storage or
prove that everyone else has retained a copy, money is available, or performance
is safe. It does not check site access, materials or safe stopping. Do not use
this flag alone to actuate a robot; practical start decisions need a separately
defined operating process. An incomplete certificate remains incomplete even
if the platform says everyone agreed. An operational stop or open dispute must
not hide independently established financial rights.

## Work, evidence and payment

An Operator's “I have finished” claim alone does not establish compensation.
The Requester's completion acknowledgment can establish the agreed milestone
amount, even without every attachment being available or valid. Review the work
and the consequence before signing that acknowledgment. A rule agreed in advance
can also establish compensation for exact digital evidence, with that rule's
required proof. Simply acknowledging receipt of a message or file is different.

Signatures and content checks attribute content to a trusted key and detect changes.
They do not establish that a photograph, sensor reading or account of physical
work is true or complete. Missing evidence, a dispute or silence does not
automatically prove fault or forfeit an existing entitlement.

Task payment is directly between Requester and Operator. Non Verba takes no
commission and holds no task funds. The prototype moves no money. A signed
payee receipt acknowledges the identified amount and gives it the supported
effect on the named obligation; it is not independent bank confirmation or
proof of irreversible payment. Performance accepted, payment acknowledged and
balance remaining are separate facts.

The report can record an obligation and its outstanding amount while retaining
payment conditions as text. An outstanding amount alone does not establish that
every condition for payment has occurred. Check the agreed due conditions and
the process used to establish their fulfillment. The current verifier does not
generally interpret narrative payment conditions.

For example, if the records establish EUR 100 for a milestone, a Requester's
“I paid EUR 40” statement leaves the protocol balance unchanged. An Operator's
valid receipt covering EUR 40 of that obligation leaves EUR 60 uncovered, assuming
no other receipts or releases. Neither action moves money through Non Verba.

Read the itemized inspection report accordingly. Active obligations and
conditional claims are separate; conditional alternatives must not be added
together or treated as zero. A historical version-1 record may authenticate
successfully while its financial result remains unresolved. A local bundle
cannot prove that no other records exist.

## Changes, disputes and the limits of protection

The analysis companion is `ANALYSIS_ONLY`, with financial authority `NONE` and
settlement policy `UNSPECIFIED`. This does not remove the Requester's and
Operator's existing ability to agree a permitted release. They must independently
review and sign the exact core settlement action: which established compensation
or expense obligation, how much, and which units are released. A suggestion or
model report is not that action. A release reduces the identified claim; it does
not mean money was paid, create a new debt or close every dispute.

An amendment requires all three parties. The supported amendment profile does
not reprice existing work units or erase accrued amounts. A Requester/Operator
settlement can affect only its identified, permitted claims; it cannot impose
a new duty on the Mediator or remove the Mediator's separate rights. Reversing
a receipt requires all three parties and identifies the exact receipt and
amount covered. Cancellation or stop notices alone do not impose a penalty or
erase a balance in this profile.

Keep any agreed work change on the amendment path and any actual payment on the
direct-payment and payee-receipt path. Neither a model interpretation nor a
settlement proposal can substitute for those separate authorizations.
See [settlement handling](SETTLEMENT_HANDLING.md) for the full path and an example.

The protocol's protection is bounded authorization: an unrelated allegation or
later disagreement is not authority to revoke an established right. Contradictions
remain evidence, and some conflicts remain unresolved. The Mediator cannot
turn a proposal into a ruling. Participants can still withhold signatures,
evidence or receipts and prevent progress.

The only supported optional **nonfinancial service commitment** requires
explicit activation by all three parties. Activation is not proof of coverage,
funding or service delivery. A new service revision requires fresh activation.
There is no implemented escrow, insurance, financial compensation guarantee or
guaranteed collection of an unpaid amount.

The actual service owner, contact, response commitment, delivery evidence, fee,
data process and treatment of failure still need explicit decisions. The
[unadopted service worksheet](AGREEMENT_NOTES.md#unadopted-service-decision-worksheet)
keeps these blanks visible; signed service text alone does not staff the service.

## What this prototype is ready for

The guided terminal workflow supports development review and exchange of
synthetic signed records. It is not ready for a real-money service launch.
Participant identity and delegated authority, independent signing-software
distribution and recovery, secure evidence exchange and retention, payment
provider proof, and the actual launch terms still need deployment-specific
implementation and review. Passing protocol tests does not settle those tasks.

Encrypted local storage does not make every file private. Signing reviews and
explicit exchange/export files can contain readable evidence and terms. The
prototype does not enforce recipient lists, retention periods or deletion of
other parties' copies; those promises need an actual operating process.

See the [terminal guide](INTEGRATION.md) for the actual steps,
[detailed agreement notes](AGREEMENT_NOTES.md) for promises and code evidence,
[Agreement drafting specification](AGREEMENT.md) for the signed content, and
[readiness record](READINESS.md) for verified checks and remaining limits.

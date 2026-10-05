# Dispute resolution notes

**Status:** Working research and discussion notes  
**Discussion history:** 29 September to 2 October 2026  
**Organized by subject:** 4 October 2026

These notes develop the operational and legal side of handling contractual
disagreement: opening a case, preserving evidence, applying an agreed procedure,
identifying consequences, obtaining the required authorization and supporting
challenge and scrutiny. They retain the intended destination of explainable
settlement while distinguishing that destination from the current analysis-only
companion.

The [priors notes](DISPUTE_PRIORS_NOTES.md) develop derivation, inclusion,
processing and evaluation of the reasoning system. The
[incident handling and insurance notes](INCIDENT_HANDLING_AND_INSURANCE.md) cover
significant harm, safety and external assistance. A single Assignment can involve
both routes. These documents preserve research directions without adopting a
settlement rule, legal characterization or enforcement power.

## Relationship to the three party Contract

The broader Request–Quote–Assignment Contract defines the cooperation, explicit rights, and supported authorizations. The dispute-priors extension is a separately endorsed companion context bound to the exact Contract. It does not replace the broader protocol.

Preserve the foundational rule:

> No coalition of two parties can create a valid contractual state that improperly alters the third party's rights.

And its companion:

> An authenticated contradiction is evidence of misconduct or uncertainty; it is not, by itself, authority to revoke a right previously established for another party.

The new research must not silently give the model or Non Verba authority to change financial rights. A future binding settlement process needs its own explicitly accepted rule and scope. The current mode remains **ANALYSIS_ONLY**, financial authority **NONE**, and settlement policy **UNSPECIFIED**.

An unresolved result is possible, but it is not necessarily economically neutral: a Requester retaining funds and an Operator who has already spent labor can face different losses. That concern belongs in the eventual design and evaluation; it is not answered merely by allowing either party to retain future resources.

The proposed assurance mechanism finances dispute-analysis computation, not compensation payouts. Compute sponsorship must not become purchased influence over the declarations or outcome. This note does not activate a commercial service.

## Mutual closure and escalation

A dispute may be **opened unilaterally**, but it should not be **closed by negotiated settlement unilaterally**. Requester and Operator must both explicitly authorize the **same exact resolution and its stated consequences**. Silence, inactivity, or refusal to respond is not consent.

Neither party is required to accept the other party’s proposed settlement. If they do not reach mutual agreement, the dispute remains open and proceeds to the **pre-agreed dispute-resolution procedure**. The distinction matters: the parties are not forced to *agree*; they may instead be bound by whatever resolution mechanism they authorized before cooperation, once that mechanism is specified.

A deterministic rule already accepted in the Assignment may still produce its predefined consequence when its required proof is satisfied, without requiring fresh agreement afterward.

Non Verba should not gain authority merely because the parties disagree. Its dispute mechanisms should be transparent and inspectable, including the applicable procedure, evidence, computation, result, and challenge path. **How Non Verba itself is held accountable—external oversight, governance, or meaningful stakes—remains a separate design question to develop later.**

## Legal review and operational routes

**Agreed working direction for payment resolution:**

> The platform follows the automatic payment procedure the parties accepted, while providing the records for external scrutiny.

Participants should feel confident that, at any point, they can download a package of the information needed for scrutiny, containing the records available at that point. The platform should hold the necessary formal identification information, while the downloadable package need not disclose the parties' private identifying information. The package contents, privacy safeguards and circumstances for disclosing identification information remain to be defined.

The discussion suggests three routes for an Assignment:

- **Ordinary fulfilment:** performance and payment proceed under the Contract without a dispute.
- **Payment dispute:** either party could raise a disagreement over payment. The proposal is that the parties commit in the Contract to resolving this category through the agreed automatic procedure, using the Contract, evidence and declared priors. This is the intended route for ordinary payment disputes; the procedure and its authority remain to be defined.
- **Material incident procedure (preferred provisional term, replacing catastrophe management):** the separate route concerning significant harm, including injury, theft or substantial property damage. The later discussion favors immediate safety, evidence preservation and appropriate medical, insurance, authority or legal channels, without Non Verba determining civil or criminal blame. Scope, notice handling and any materiality gate remain open.

The central aim is a credible commitment to automatic resolution of payment disputes. Dissatisfaction with the result is not intended to create a general contractual opt-out that routes small payment disagreements to insurers or courts. Research must establish how this commitment can be effective and which legal review rights and safeguards still apply. Those requirements are a separate question from offering a routine choice to abandon the agreed procedure.

These are working proposals, not adopted closure states. An Assignment may give rise to separate payment claims and claims involving harm; the scope of a payment settlement would need to be clear. Any optional human mediation, insurance assistance and access to external remedies require their own scope and conditions. Access to applicable legal remedies should not depend on having insurance.

Possible funding ideas include a contribution reflecting an Assignment's risks and insurance-funded human mediation or review. Coverage, pricing, insurer arrangements, legal responsibility and any recovery from another party remain open. We have not selected an insurance model.

The [incident handling and insurance notes](INCIDENT_HANDLING_AND_INSURANCE.md)
adds a possible initial path through existing professional coverage for eligible
task classes, rather than requiring Non Verba to become an insurer. This is a
conditional deployment hypothesis, not a finding that launch or hazardous work
is authorized. It also develops the privacy and evidentiary limits of the scrutiny
package and treats a material incident and payment dispute as potentially
overlapping claims within one Assignment.

Keep the following sources for later legal review and scenario research; their applicability to Non Verba remains to be established:

- **[GDPR, Article 22](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679):** for qualifying solely automated decisions using personal data with legal or similarly significant effects, the contract-necessity and explicit-consent exceptions require safeguards including human intervention and the ability to contest the decision.
- **[EU consumer ADR Directive, Article 10](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32013L0011):** a pre-dispute ADR agreement cannot bind a consumer if it deprives them of their right to bring the dispute before a court.
- **[UNCITRAL Arbitration Model Law, Articles 34 and 36](https://uncitral.un.org/en/texts/arbitration/modellaw/commercial_arbitration):** provides limited grounds for setting aside awards or refusing enforcement; operation depends on national law. Whether an LLM output could qualify as an award requires separate review.
- **[Singapore Convention on Mediation, Articles 2, 4 and 5](https://www.singaporeconvention.org/node/27):** addresses assisted settlements, evidence of agreement and specified grounds for refusing enforcement. Its scope covers certain international commercial settlements and excludes consumer and employment settlements; its mediator has no authority to impose a solution.

These texts and related decisions, including [UNCITRAL's CLOUT collection](https://uncitral.un.org/en/case_law), could inform derivation, the limits of incorporation and adversarial evaluation scenarios. Court access, legal assistance, cost, delay and judicial workload remain research questions. No court-filing channel or insurer-backed review process is implemented by these notes.

## Launch jurisdiction and authority of the resolver

Choosing an initial jurisdiction is part of reducing the problem's scope. The
discussion favors assessing stable institutions, predictable law and courts,
low corruption, reliable emergency infrastructure, understandable insurance
markets, social trust and clear treatment of independent professional work.
**Norway is a candidate to study, not a selected or validated launch country.**

An initial restriction to professional Operators, narrow task classes and one
jurisdiction is a possible research and deployment strategy. It would not by
itself establish independent-contractor status or make every Requester a business.
Employment, consumer protection, tax, insurance, safety, privacy, automated
decisions and dispute-resolution law remain part of reviewing the actual service.
The existing [regulatory boundary](../../cooperation/REGULATORY_BOUNDARY.md) concerns
the distinct remuneration protocol; it does not approve this resolver.

The discussion also distinguishes executing an already agreed condition from
judging competing accounts of what happened. A rule that applies a defined
consequence after verified proof has a different design burden from a model that
interprets contested facts. Calling the latter "contract execution" does not
settle its legal characterization as arbitration, ADR or another process.

Precommitment may support a legitimate contractual mechanism for matters the
parties can lawfully submit to it. It does not give Non Verba state coercive
powers, criminal jurisdiction, power to seize property or compel testimony, or
permission to override mandatory rights. The intended ordinary resolution path
remains the procedure accepted beforehand; exporting evidence is not a newly
invented contractual opt-out whenever an outcome is disliked. Which external
review, human intervention and non-waivable remedies apply remains a legal design
question. The [existing legal research references](DISPUTE_RESOLUTION_NOTES.md#legal-review-and-operational-routes)
retain that question without declaring an LLM result a legally enforceable award.

## Evidence access and privacy

At any point in the proposed process, each party should be able to obtain the
relevant scrutiny package as it exists then. It could support a lawyer, insurer,
authority, independent expert or lawful defense outside the platform. An early
export would identify its available frontier and missing material, rather than
claim to contain future evidence or a globally complete history.

The discussion favors keeping necessary formal identification under controlled
platform custody and omitting unnecessary private identifiers from routine
packages. Lawful disclosure to authorities would follow defined conditions.
Which identity information is necessary, who holds it, retention, access and
disclosure rules remain open; this is not an implemented identity service.

Omitting an identity field is not enough to protect privacy: photographs, voices,
addresses, location, messages and metadata may identify people. A candidate design
would distinguish preserved originals from scoped or redacted export copies,
documenting omissions and their evidentiary effect. Preservation or sealing would
retain an inspectable version while allowing later attributed evidence and
corrections to be added. It would not freeze one party's account as the whole case.
The [current privacy threat model](../../requests/THREAT_MODEL.md#privacy-and-sensitive-evidence)
already warns that raw exports may reveal sensitive material. Existing portable
local replay is not the production privacy-preserving package proposed here.

## Symmetric evidence and resistance to gaming

Both parties should be able to contribute contemporaneous evidence. An Operator
arriving at pre-existing dirt, damage, a broken fixture or unsafe conditions could
record an image, available time and provenance, and a short condition-on-arrival
note. A Requester's later allegation would then be assessed with that account
visible. Each addition is attributed; changing the corpus means adding evidence,
not rewriting or deleting the other's history. A timestamp or device signature
does not by itself establish when damage occurred or that the scene is truthful.

Unpredictable challenges could also request fresh observations during work.
The emerging principle is **open rules, unpredictable observations**: rights,
priors, the procedure and harness can be public while challenge timing, nonces
and observation requests resist advance staging. A nonce can help bind a response
to a challenge; it does not prove the physical scene. Cross-sensor consistency is
a candidate check, not a guarantee against a fabricated world.

Research should examine whether an interactive test interface reveals a useful
recipe for fabricating evidence. That concern does not select secret rules or
restrictions on publishing the open harness. Timing, challenge limits, burden,
accessibility, technical failures and selective evidence presentation need testing
for both roles. The proposed protections should not assume the Requester controls
the history or make a missed challenge automatically establish Operator fault.

## An explanation with an explicit consequence

The desired result states what was supported, what remained uncertain, which
clauses and priors mattered, and why a particular contractual consequence follows.
Where payment is in scope, it would also state the amount or percentage to be
paid, identifying the obligation and monetary basis. An explanation alone is not
the intended destination, and a bare requester/operator split is insufficient.
Evidence citations and a concise account of reasoning are inspectable claims,
not proof that the model's private internal computation followed that account.

Fast closure matters because delay can leave performed labor unpaid. Speed,
accuracy, actual impartiality and appropriate challenge remain evaluation goals;
a plausible explanation or appearance of fairness is not a substitute for them.
No latency promise, payout formula or fallback allocation is selected.

The first list also emphasizes consequences that make deception expensive and
honoring commitments cheap. Possible penalties or other deterrents for either
party remain important research, but their trigger, evidence, proportionality,
authorization and challenge path are undefined. Losing a dispute would not by
itself prove deception. The [earlier deterrent candidates](DISPUTE_RESOLUTION_NOTES.md#candidate-deterrents-outside-the-payment-flow)
remain possible approaches, not a selected answer. None gives Non Verba custody
of task money or authority to impose deductions. An authorized contractual
outcome, its execution, external payment and receipt remain separate events.

Deterrent research concerns either Requester or Operator. A lost dispute, honest
incident report or technical failure would not alone establish dishonesty. No
penalty or payment deduction has been selected by these notes.

## Candidate deterrents outside the payment flow

These proposals connect to the [commitment and credibility questions](DISPUTE_PRIORS_NOTES.md#declarations-and-commitments).
Their operational mechanisms belong here; declaring a prior does not activate
them or establish misconduct.

**Status: proposed research mechanisms, not selected or implemented rules.**
The challenge is to make dishonest conduct costly without taking a cut of an
assignment's payment. The proposed boundary keeps deterrents outside the payment
flow: no commission, withholding, redirection or automatic reduction of an
established compensation claim by Non Verba.

This is a design constraint, not a conclusion that avoiding payment deductions
eliminates employment or money-transmission obligations. Classification depends
on the actual arrangement and applicable jurisdiction; access restrictions and
control over future work also need consideration. See the
[regulatory boundary](../../cooperation/REGULATORY_BOUNDARY.md).

Three candidates, in order of proposed simplicity:

1. **Time.** Between tasks, an Operator would wait for a period that decreases
   as an independently supported history of reliable conduct grows. New
   Operators would wait longer; established Operators would wait less. The aim
   is to impose an opportunity cost without a monetary fee or a compute puzzle.
   Elapsed time cannot simply be invented if it is checked independently, but
   enforcement still needs a credible clock, retained history and an admission
   mechanism. Identity resets and parallel identities could bypass a cooldown.
   Whether this can work without a coordinating service remains open; a long
   wait is not evidence that a newcomer is dishonest.

2. **Useful compute.** Instead of a meaningless hash puzzle, a participant
   could perform independently checkable work on other participants' dispute
   analyses. The aim is to help fund the network's dispute computation and reduce
   central operating costs. What useful work can be verified cheaply enough,
   without exposing private dispute evidence, remains unresolved. A model
   analyzing a resolution is not automatically verifying its correctness.
   Publishing a hash of the selected model weights before a dispute is processed
   could bind the process to fixed weights and expose later substitutions. The
   commitment does not prove that the weights are honest, that those weights
   were actually executed, or that the result is sound. Inputs, settings and
   execution evidence would need their own inspectable binding.

3. **Hybrid.** Time could provide a baseline admission cost, with useful compute
   as an additional requirement for higher-stakes tasks. Any extra assurance
   would need to justify battery, accessibility and verification costs. The
   trigger, accepted terms, challenge process and proportionality remain open.

**Calibration is the central open question.** Expected costs would need to
outweigh the expected benefit of successful deception while remaining tolerable
for honest participants. That depends on detection, identity-reset costs, task
value and the participant's alternatives. Representative dispute data and
controlled experiments could guide later calibration; no ratio is selected
here. Evaluation must include newcomers, false accusations, legitimate
disagreement and unequal access to time or compute.

These proposals introduce no authority to alter existing financial rights.
The current companion remains `ANALYSIS_ONLY`, with financial authority `NONE`
and settlement policy `UNSPECIFIED`.

## Open operational and legal questions

- The resolver's legal characterization, authority, permissible consequences,
  human review, challenges and treatment of inconclusive results.
- Materiality criteria, notice handling, preservation, overlap with payment
  claims, response responsibilities and accountability.
- Initial jurisdiction, participant relationships, task classes, qualification
  checks and coverage requirements.
- Privacy and identity custody, scoped evidence export, lawful disclosure,
  retention, model-provider access and any underwriting reuse.
- Model/provider choice, audit guarantees, costs, response times and acceptable
  variation between runs.
- Deterrents for dishonest conduct by either party, including their evidence,
  proportionality and effects on honest newcomers or technical failures.

The priors' meanings, inclusion, processing and evaluation remain open in their
[research note](DISPUTE_PRIORS_NOTES.md). Incident classification, coverage and
insurance development remain open in the [incident note](INCIDENT_HANDLING_AND_INSURANCE.md).
The surrounding service still needs defined responsibility for notices, review,
access to records, authorized effects and challenge.

The architecture to build toward retains the three-party Contract: R, O and M
authorize its exact terms, with both task parties' prior declarations bound in the
appropriate accepted context. Evidence accumulates from both sides. An ordinary
dispute would use the agreed, scoped resolution procedure; a material incident
would preserve evidence and connect to external assistance. Either party could
obtain the relevant scrutiny record. Authorized contractual effects, payment and
case closure would each retain their own proof and scope.

The motivating idea is to make trust explicit, precommitted, evidenced and
inspectable. Sensors contribute observations, the Contract states promises,
priors express how participants ask ambiguity to be interpreted, and the harness
connects them under an agreed procedure. None of those ingredients alone proves
truth, lawful authority or a fair outcome.

## Discussion history and development boundary

The small local model running through llama.cpp is a workflow test component, not the final resolver. Its weak reasoning is expected at this stage. This discussion does not reopen the integration milestone, request a model change, or ask for more prompt tuning. Retain observed failures honestly while keeping workflow integration, model competence, and settlement-policy research distinct.

These notes retain the operational and legal threads from the owner's
29 September handoff, the 30 September commitment ideas incorporated on
1 October, and the 2 October summaries. The original four commitment seed lines
are preserved in the priors note. Time, useful-compute and hybrid candidates
remain proposed research, including their calibration and access concerns.

The two fuller 2 October summaries connect the ordinary resolution route to
material incidents, insurance, symmetric evidence and a bounded expert system.
The first preserves emphasis on an explicit payment amount or percentage and
undefined deterrents; the second provides the fuller architecture. Absolute
launch or authority claims were not adopted as rules.

The legal references and CLOUT research were explored while incorporating the
2 October discussion. Their applicability to Non Verba and any selected
jurisdiction remains unassessed. Keeping them here does not supply a legal
opinion or turn an LLM result into an enforceable award.

The [implementation decisions](../../requests/DISPUTE_PRIORS_DECISIONS.md) retain
DP-2's closed workflow scope, the local model and its negative findings.
The [lifecycle specification](../../requests/DISPUTE_LIFECYCLE.md) develops a
proposed review interface, and [settlement handling](../../requests/SETTLEMENT_HANDLING.md)
describes the existing independently authorized release path. This reorganization
changes no code, signed terms, retained review artifact or financial authority.

Return to [all research notes](README.md) or [all notes](../README.md).

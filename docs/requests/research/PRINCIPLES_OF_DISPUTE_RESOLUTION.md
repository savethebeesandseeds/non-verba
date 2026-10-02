# Notes on declarations, commitments and dispute resolution

Research notes · incorporated 1 October 2026 · wording refined 2 October 2026

These notes belong to the [dispute-priors discussion](DISPUTE_SETTLEMENT_NOTES.md).
The owner clarified that **catalog** means the catalog of priors and
each party's declared selections.

**Status: discussion notes.** The three seed ideas are preserved below.
Their elaborations remain suggested interpretations and open questions.
The separate [terminology document](../TERMINOLOGY.md) records the working conventions.
No implementation details, settlement formula, credibility score or enforcement
mechanism have been selected here.

## Original seed notes

The original wording from 30 September is retained as an early expression of
the ideas, not as adopted rules:

> Make honest declaration cheap to honor and expensive to fake.
> 1. a requester who disputes on a value he dint request earns nothing
> 2. a worker who track records matches their declared values earns credibility over time.
> 3. the catalog it self becomes a commitment not just a signal

The connecting idea is that declaring a value before cooperation could carry
meaning when things go wrong, including when honoring it becomes inconvenient.
How to achieve that is still open. We have not established that any proposed
mechanism makes declarations honest or prevents strategic behavior.

## 1. Shifts in what counts as valuable

One possible reading concerns a Requester changing the basis of evaluation
after seeing the result. We might want to distinguish a newly introduced
preference from a concern that was already part of the cooperation. Whether
and how that distinction should affect a possible resolution remains open.

There are two related questions here:

- **What was requested?** The deliverable, scope, quality, timing and acceptance
  conditions agreed before the work.
- **What was valued for resolving disagreement?** The separately declared
  priors, such as the weight given to reasonable effort or a usable outcome.

To explore the distinction, we could compare dissatisfaction with an unagreed
presentation style against an actual failure to meet an agreed requirement.
The cases may call for different treatment, even if both parties describe
them using the same broad value, such as Result. This example does not select
a general rule for either case.

The existing priors specification says that zero points do not waive a right.
So "earns nothing" needs refinement before it could become a rule: no extra
advantage from a newly introduced value need not mean losing an otherwise
valid claim, canceling existing obligations or ignoring new evidence.

Questions to retain: what counts as an unrequested value, a reasonable
implication of the Contract, or a legitimate clarification? How could an
earlier prior constrain a later argument without suppressing a valid
challenge? The same question could be explored for an Operator who invokes
unagreed extra work or unsupported effort, while recognizing that the parties'
roles and losses differ.

## 2. Credibility and consistency over time

The second idea is that an Operator's declaration might become more credible
when its relevant conduct repeatedly matches it. That suggests exploring
something beyond whether someone won a dispute or obtained the outcome they
wanted. We have not yet settled what would count as matching a declaration.

A possible discussion example is a party that emphasizes reasonable effort:
does it still recognize relevant, substantiated effort when doing so favors
the other party? For remedy, does the party take a practical opportunity to
correct a shortfall seriously? Neither example settles what is owed or
requires accepting an unsupported proposal or unlimited unpaid work.

There are at least two different questions:

| Question | What it concerns |
| --- | --- |
| Were the factual claims supported? | Reliability of an account of what happened |
| Did the conduct fit the declared value? | Consistency between a declaration and how the party approached the disagreement |

A declaration does not prove that effort occurred or that a result was
delivered. Likewise, failure to deliver does not by itself prove the
declaration was dishonest. Uncertainty, missing evidence and legitimate
disagreement complicate any interpretation of a track record.

Questions to retain: which conduct would actually demonstrate commitment?
Could the same idea apply to Requesters? How would a newcomer, partial history
or a change of priors for future cooperation be understood? What would
credibility mean in practice, and could an assessment itself be challenged?
We have not chosen how to record, measure, publish or use it.

## 3. The catalog as a possible commitment

Here, catalog refers to the priors and each party's declared
selections. The seed idea is that a selection could carry an expectation of
consistency when disagreement arises. The meaning and strength of that
commitment remain to be explored; we have not decided what declaring a prior
would oblige a party to do.

A useful way to explore a candidate prior might be to describe:

- What it means, and how it differs from neighboring priors.
- A circumstance in which honoring it helps its declarer.
- A circumstance in which honoring it favors the other party.
- What evidence could distinguish consistency from an unsupported assertion.

These are discussion prompts, not requirements for a new data structure.
Declaring a prior that serves one's interests remains a legitimate choice;
the existing research already distinguishes that from exploiting ambiguity
or misrepresentation. We are not trying to infer a participant's private
"true values."

Stable meanings and an inspectable history could help make declarations
credible. They do not by themselves explain why faking a declaration would
be disadvantageous. That is the unresolved incentive question behind
"expensive to fake." It does not yet imply money penalties, deposits,
automatic payment changes or a platform-wide reputation score.

### Precommitment and competition through values

The later [2 October discussion](RESOLUTION_INCIDENTS_AND_PRIORS.md#priors-as-principles-for-interpreting-ambiguity)
sharpens the idea: priors could express principles for interpreting cooperation
under uncertainty, chosen and visible before the disputed event. Counterparties
could compare those commitments when deciding whether to cooperate. Their meaning
would be demonstrated partly by situations in which applying them favors the
other party. This is the proposed competition through values, not a selected
credibility score or proof of private intentions.

Priors are not participant-selected reliability weights for sensor types, and a
declaration does not establish a factual claim. The clarification leaves open
how principles affect ambiguity, established shortfalls and remedies. Today's
discussion also retains deterrents for either Requester or Operator as important
research. A lost dispute, honest incident report or technical failure would not
alone establish dishonesty. The candidates below remain unselected; the newer
notes do not define a penalty or authorize payment deductions.

## 4. Candidate deterrents outside the payment flow

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

## Connection to the priors research

These ideas concern the catalog and the way it is used together. They are
not automatically additional dimensions in the catalog.

| Existing research question | What these notes add |
| --- | --- |
| Derivation | Can a candidate prior express an understandable commitment? |
| Incorporation | How might earlier declarations influence later arguments and possible resolutions? |
| Evaluation | Does honoring a declaration remain practical, and can misrepresentation obtain an advantage? |

A later discussion could use one value in two contrasting situations: one
where it helps its declarer and one where it favors the other party. That
could clarify what commitment means before choosing any mechanism.

The three threads might also turn out to need different treatment: relevance
to a particular dispute, confidence built across earlier cooperation, and the
meaning of a declaration are related questions, but we have not decided to
combine them into one mechanism.

The [open decision record](../DISPUTE_PRIORS_DECISIONS.md) and
[current priors specification](../DISPUTE_PRIORS.md) retain the implementation
boundary: `ANALYSIS_ONLY`, financial authority `NONE`, settlement policy
`UNSPECIFIED`. The current companion does not implement credibility
assessments or consequences from these notes. The
[lifecycle discussion](../DISPUTE_LIFECYCLE.md) retains the separate questions
of mutual settlement, an accepted escalation procedure and accountability.

## Terminology

The working-language conventions from 2 October have their separate home in
[Terminology](../TERMINOLOGY.md). That document records the priors vocabulary,
the agreed name Assignment Contract, proposed dispute terms, and the later
development follow-up to align documentation and code. These research notes
retain the reasoning behind the ideas rather than duplicate the glossary.

## Provenance

The original four lines were moved from
`private-source/PRINCIPLES_OF_DISPUTES_RESOLUTION_notes.md`. On 1 October 2026,
the owner identified them as unincorporated notes from the previous day,
confirmed the meaning of catalog, and emphasized that these remain notes
rather than implementation decisions. The expansion preserves the ideas and
offers interpretations for future discussion. No code, signed terms, retained
review artifact or implemented rule was changed; no experiment was run.
On 2 October, the owner reiterated that the ideas are still being organized.
The explanatory wording was softened accordingly; the seed wording remains
unchanged for reference.
Also on 2 October, the owner supplied the time, useful-compute and hybrid
deterrent note. It is retained above as candidate research, with qualifications
about legal classification, enforceable waiting, identity resets and the limits
of model commitments. No mechanism was adopted, implemented or experimentally
validated by adding this note.

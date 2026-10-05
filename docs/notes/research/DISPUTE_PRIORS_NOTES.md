# Dispute priors notes

**Status:** Working research and discussion notes  
**Discussion history:** 29 September to 2 October 2026  
**Organization and framework clarified:** 4 October 2026

These notes develop the priors used in resolving contractual disagreement. They
bring together the catalog, participant declarations, commitments and reasoning
research in one place. The four research stages are **derivation, inclusion,
processing and evaluation**. Their purpose is to develop understandable influence
over disagreement, ultimately toward an explainable resolution.

The [dispute resolution notes](DISPUTE_RESOLUTION_NOTES.md) cover the surrounding
operational procedure, settlement authority, legal review and accountability.
The [incident handling and insurance notes](INCIDENT_HANDLING_AND_INSURANCE.md)
cover significant harm and its separate response. These notes select no new
catalog, processing method, settlement formula or credibility mechanism.

## Participant agency and intended outcome

Before cooperating, the Requester and Operator should each be able to declare, in a small and understandable vocabulary, what they want the resolution process to consider when a disagreement arises. Both should see the other's declaration before deciding to enter the arrangement.

The priors are **priors for resolving disagreement**, not a general description of labor, a personality assessment, or a substitute for the agreed work and acceptance conditions.

The central question is:

> When cooperation goes wrong, which competing considerations should people be able to ask the resolution process to respect?

The eventual purpose is an explainable route toward settlement, potentially including an amount to be paid or a bounded remedy under a procedure accepted beforehand. The current implementation is analysis-only. That is the present development boundary, not a decision to abandon settlement as the destination.

## Priors as principles for interpreting ambiguity

The conceptual clarification is that **priors are precommitted considerations or
principles of cooperation and interpretation**, rather than participant-selected
reliability weights for GPS, photographs or audio. Trust, good faith, reasonable
effort, reliance, proportionality, charitable interpretation, ambiguity in
requirements and burdens under uncertainty are candidate concepts, not a new catalog.

A participant's preference for an easily forged sensor would be a poor substitute
for a principle governing disagreement. Evidence quality still needs assessment,
and agreed evidence expectations may belong in the Contract, but selecting a prior
would not establish the credibility of a factual claim or attestation.

The declarations are chosen before the disputed event and reviewed before
cooperation. This connects to [the catalog as a possible commitment](DISPUTE_PRIORS_NOTES.md#the-catalog-as-a-possible-commitment):
choosing a value could have meaning when applying it favors the other party.
Counterparties could compare these commitments, creating **competition through
values**. Their duties and credibility consequences remain to be designed; a
declaration would not certify someone's inner motives or general trustworthiness.

The proposed discipline is that facts constrain interpretation and priors explain
choices where the facts and agreed terms leave room. Authentication establishes
provenance, not physical truth. A prior cannot turn an unsupported story into an
established fact, silently rewrite requirements or override protected rights.
Whether some priors also affect treatment of established shortfalls or remedies,
as contemplated by the current Result and Effort dimensions, needs clarification;
the ambiguity framing does not silently narrow those signed definitions.

## Four research stages

The 29 September discussion named derivation, incorporation and evaluation.
On 4 October, the owner clarified inclusion and processing as distinct research
stages. Inclusion asks how definitions and declarations enter the context;
processing asks how the resolver actually uses that context. Earlier references
to incorporation often span both questions. This distinction refines the research
framework without changing current signed profiles or runtime behavior.

| Stage | Research question | Intended research output |
| --- | --- | --- |
| Derivation | What considerations can participants express, and what do they mean? | A candidate catalog with shared meanings and contrasts |
| Inclusion | How do the definitions and both parties' declarations enter the case context? | An explicit representation and rules for supplying that context |
| Processing | How does the resolver use the Contract, claims, evidence and priors together? | A candidate reasoning mechanism and inspectable outcome |
| Evaluation | Do the catalog, inclusion method and processing mechanism serve their purpose together? | Findings that can refine any of the earlier stages |

Derivation develops the vocabulary outside an individual case. Inclusion and
processing concern its use in cases. Evaluation is a continuing research activity,
rather than merely the final action in handling a live dispute. It studies the
priors' role and the wider reasoning system together; operational and legal
assessment also belongs in the linked dispute and incident notes.

## Derivation of the priors catalog

Derivation develops the catalog: its dimensions, their definitions, and their number. Its output is a set of candidate considerations with understandable meanings and contrasts—not participant allocations or settlement amounts.

The current five dimensions are a starting proposal, not a fixed answer. We have not agreed that the final catalog must contain five dimensions or that new ideas must fit within the existing five.

Research can assist discovery. Waku proposed studying a corpus of disputes and published resolutions, embedding relevant material, and looking for clusters that could suggest recurring considerations. This remains a proposed research route, not an executed study or an adopted selection algorithm. The number of clusters need not be fixed at five. Giving a cluster a clear, useful meaning is itself an interpretive step.

Such methods may propose candidates; they do not automatically choose Non Verba's normative vocabulary. A frequently occurring pattern is not, by that fact alone, a principle we should adopt. Candidate selection remains an explicit design effort outside the operation of an individual assignment contract.

The aim is a compact, expressive vocabulary ordinary participants can understand.
The discussion's small constitutional core is an analogy for readable commitments,
not a claim that optional priors replace law or the three-party rights invariants.
Embeddings could support retrieval, evidence organization, analogous-contract
search and candidate discovery. A vector geometry that reliably determines
contractual judgment has not been specified or validated.

### Current starting catalog

These are the five implemented starting dimensions described in the supplied project records. They are retained here for reference, not endorsed as the final selection.

| Prior | Current meaning | Existing boundary |
| --- | --- | --- |
| **Result** | Emphasis on the usable result and conformity to agreed scope, quality, and timing. | Does not rewrite the agreed standard after performance. |
| **Effort** | Emphasis on reasonable, diligent work actually undertaken within the agreed scope. | Does not reward invented hours, avoidable inefficiency, or unauthorized extra work. |
| **Reliance** | Emphasis on reasonable commitments, reserved resources, and unrecovered costs incurred because of the Contract. | Applies to either party; does not double-count recognized expenses or create uncapped liability. |
| **Responsibility** | Emphasis on who could reasonably control, prevent, communicate, or mitigate the cause of a shortfall. | Requires relevant evidence; is not a character score, criminal verdict, or presumption of Operator fault. |
| **Remedy** | Emphasis on a practical, proportionate opportunity to correct, complete, replace, or otherwise resolve a deficient outcome. | Does not require indefinite work, unilateral scope expansion, or automatic unpaid rework. |

The allocation rule gives **each party independently fifty points per catalog dimension in total**. With the initial five dimensions, that is **250 points for the Requester and 250 for the Operator**, with integer values from zero to 100 per dimension in the initial implementation.

The budgets are separate, not pooled. Non Verba has no third preference vector in this version. The balanced fifty-per-dimension profile is an editable draft, not inferred consent. Zero does not waive a right; 100 is not a payment percentage. These points are declared priors, not probabilities of honesty or proof of a person's actual intentions.

Changing the catalog in a future design must not silently change the meaning of an earlier signed profile.

### Candidate refinements

Waku emphasized that the vocabulary must describe **considerations for the outcome of a disagreement**, rather than merely identify desirable properties of work.

A broad noun such as “Result” may be too general. It currently includes both practical usefulness and conformity to what was requested. Those can express different concerns. We have identified a question to investigate, not decided to split or remove the dimension.

The discussion moved toward declarations such as:

- **Value the effort:** “When an outcome falls short, reasonable work genuinely undertaken should still matter in deciding how to resolve the disagreement.”
- **Value the outcome:** “When effort was undertaken but the agreed benefit was not delivered, that missing benefit should matter in deciding the resolution.”
- **Value the intention:** a candidate requiring clarification before it becomes a dimension.

These statements are discussion candidates, not replacement definitions or rules that determine compensation.

#### Intention and profit remain open candidates

“Intention” could mean the purpose of entering the cooperation, or the intention behind the disputed conduct. A profit-oriented purpose is different from distinguishing a mistake from deliberate disregard.

Waku wants the economic purpose of cooperation, including profit orientation, to be visible. We have not yet decided whether that belongs in the priors catalog, a separate declaration, or another part of the Contract context. Nor have we selected what financial consequence, if any, it should have in a dispute.

A declared purpose must remain distinguishable from evidence about conduct. Saying “my intentions were good” must not silently become proof that a factual account is correct.

### Meaning and contrast

Before choosing replacements or adding dimensions, make each candidate's **meaning and contrast** explicit.

For each candidate, write a plain-language declaration answering:

> Given the same facts, what meaningful difference should higher rather than lower emphasis on this consideration express?

Then identify its nearest possible confusion with another dimension. Keep these three meanings separate:

| Kind of statement | Example |
| --- | --- |
| Factual claim | “Substantial effort occurred.” |
| Declared prior | “Substantial effort should carry considerable weight in resolving this disagreement.” |
| Settlement consequence | “Therefore, this amount is owed.” |

The first needs evidence. The second belongs to the participant's declaration. Connecting them to the third requires an incorporation and settlement rule; that connection has not been selected.

A later discussion can use a recognizable disagreement and a contrasting situation to examine whether a candidate expresses a principle that can apply to either party, rather than merely “favor me.” No worked cases, payout targets, or selected formulas are introduced by this note.

New candidates should be considered on equal terms with the original five. The next conversation can begin with Waku's ideas rather than treating the existing catalog as a constraint.

### Discovering candidate priors from contracts

consider a large contract corpus to explore candidate priors. Stanford's [Material Contracts Corpus](https://mcc.law.stanford.edu/) is the source identified in this discussion, alongside the possibility of other sources: its [2025 announcement](https://news.stanford.edu/stories/2025/04/law-school-dataset-sec-material-contracts-corpus) describes more than a million SEC-filed corporate contracts. Its relevance to our disputes and permitted use still need checking.

Stanford's **Material Contracts Corpus** is a substantial source of prospective
contractual language. Its April 2025 paper reports **1,038,766 unique contract
URLs**, collected from SEC filings dated 1 January 2000 through 21 March 2023.
Deduplication was by URL, not by contract text. That is a reported historical
dataset size, not an asserted current website count. See the
[paper's collection method](https://arxiv.org/html/2504.02864v1#S2.SS1).

The corpus site, checked on 2 October 2026, says it updates quarterly, warns that machine-generated
parties and labels may be inaccurate, and lists **CC BY-NC-SA 4.0**, with commercial
use inquiries directed to its maintainers. Permitted use and compatibility with
the proposed research outputs or commercial integration need review before use;
no download, training or redistribution is authorized by filing these notes.
See [the corpus description and license](https://mcc.law.stanford.edu/).

The proposed first experiment is:

```text
relevant contract sample
  -> clauses or semantic units with source context
  -> embeddings and clusters
  -> recurring conceptual families and synonymous formulations
  -> human interpretation
  -> candidate priors in ordinary language
```

Clusters generate hypotheses. They would not become priors automatically, and
the number of clusters need not equal the current five dimensions. The purpose
is to discover recurring ideas beneath legal language, not to copy corporate
boilerplate into small assignments. Corporate SEC filings are a particular sample
of cooperation, not representative evidence of every kind of work.

**Frequency is not fairness.** Copying, repeated filings, bargaining power,
regulation and convention can all make a clause common. Candidate discovery needs
separate normative and behavioral evaluation. A possible small first study would
retain clause context and provenance, check textual repetition, and compare
candidate meanings with recognizable assignment disagreements before scaling.
Sampling, segmentation, embedding model, clustering and selection criteria remain
open. Disputes and published resolutions remain complementary sources proposed
in the earlier notes; the contract corpus does not replace them.

### Clarity agency and trust

The desired experience is not simply that the interface looks fair. Each participant should be able to recognize:

> This lets me protect something that matters to me before I take the risk of cooperating.

A useful distinction from the conversation is:

> The preference can be personal; the meaning should be shared.

Different participants may legitimately place different emphasis on effort, outcome, or another consideration. The aim is to avoid the same label meaning different things to different people, or its meaning shifting according to whom an interpretation favors.

Choosing priors that serve one's interests is not automatically gaming. Providing meaningful choice is part of the design. The concern is advantage obtained through ambiguous wording, unsupported claims, hidden features of the incorporation mechanism, or other exploits—not the mere fact that someone makes a deliberate choice.

The intended basis for trust is:

> I understand when my choice could help me, what it does not guarantee, and how the other party's choices will also be considered.

Equal point budgets do not by themselves establish fair outcomes. A middle value does not certify trustworthiness. The prototype does not yet guarantee the meaningful settlement influence described here; that requires the still-open incorporation design.

### Declarations and commitments

The following seed ideas were supplied on 30 September and incorporated on
1 October. They remain early expressions of the research aims, with suggested
interpretations and open questions rather than adopted rules.

#### Original seed notes

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

#### Shifts in what counts as valuable

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

#### Credibility and consistency over time

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

#### The catalog as a possible commitment

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

The associated [deterrent proposals](DISPUTE_RESOLUTION_NOTES.md#candidate-deterrents-outside-the-payment-flow)
concern the surrounding system. They do not add dimensions to the catalog or
select a credibility score.

## Inclusion of priors in the case context

Inclusion specifies how the exact definitions and each party's precommitted
declarations appear alongside the Contract, claims, evidence and procedure.
The declarations remain attributable to their owners and understandable before
cooperation. Supplying them to a model does not by itself establish their effect.

Incorporation determines how the selected definitions and each party's allocations enter the dispute process alongside the Contract and evidence.

Possible approaches mentioned in the conversation include supplying the profiles as model context, defining operations in an embedding space, or combining approaches. These are possibilities, not selected settlement methods. Merely naming vector algebra or embeddings does not specify what a prior should do.

For an initial research prototype, definitions and declarations could enter the
model as explicit text alongside the Contract, evidence and procedure. The model
could explain the effect of each relevant prior and be compared with a version
without it. This makes incorporation more concrete without selecting how separate
R/O profiles are combined, how conflicts are resolved, or how text creates a
binding payment amount. The existing two-pass workflow is an experimental starting
point, not proof that this design works.

The earlier incorporation question remains open across inclusion and processing:
we have not selected how declared priors should influence a proposed resolution,
how separate profiles are combined or how their conflicts are treated.

## Processing the context toward a resolution

Processing studies how the resolver reasons with the supplied context and what
the priors actually change. This includes distinguishing facts from declarations,
handling uncertainty and relating relevant principles to possible outcomes. The
research extends to the whole reasoning mechanism, while remaining separate from
the operational authority to adopt or execute a consequence.

This procedure must eventually explain what the priors influence: the analysis of competing considerations, which alternatives are considered, how alternatives are assessed, or a proposed settlement. The rule must also explain how the two separate profiles are treated when they differ.

The prototype has one experimental incorporation path: an evidence-oriented first pass without numeric profiles, followed by a second pass that receives both profiles and the first interpretation. This supports qualitative analysis. It does not settle how points become a payment amount or other binding consequence.

### A public multimodal reasoning harness

The candidate resolver is a reasoning harness around a capable multimodal model,
presented as a bounded expert system rather than a lawyer or court. Legal theories
may help organize its reasoning without conferring legal authority. Its inputs
could include images, video, audio, GPS and other sensors, timestamps, attestations,
messages, task requirements, both parties' notes and challenge responses. This is
a proposed evidence range, not a claim that the current runner processes every modality.

Non Verba could maintain the evidence formats, priors catalog, prompts, tools,
procedure, reports, validation and audit trail while obtaining inference through
an external model API. Open-weight models on rented infrastructure are another
possible later path. Owning GPUs or securing a large technology partner need not
be prerequisites for researching the harness. Provider choice, confidentiality,
cost, availability and reproducibility still need assessment; the retained local
model has not been replaced or accepted as this resolver.

The second list develops a candidate reasoning discipline:

1. Read the exact Contract and identify questions relevant to the claimed effect.
2. Separate supported observations, disputed claims, contradictions and unknowns.
3. Examine the strongest reasonable account from each party, using tools to inspect
   relevant evidence and its provenance.
4. Apply the pinned prior definitions and both precommitted declarations; identify
   where they affect interpretation and where they are irrelevant.
5. Check role consistency, contractual conditions and the consequence's scope.
6. Produce a concise explanation and preserve the inputs, tool results and outputs
   needed to inspect the attempt.

The discussion calls this defeasible reasoning: conclusions may need revision
when stronger evidence defeats their premises. It does not select a formal logic,
reopening rule or automatic overwrite of an earlier authorized consequence.
Evidence and messages would be treated as case material, including hostile
instructions embedded in them, rather than as instructions controlling the harness.

The intended [explanation and explicit consequence](DISPUTE_RESOLUTION_NOTES.md#an-explanation-with-an-explicit-consequence)
belongs to the dispute process. Research on how reasoning reaches that result
belongs here; an inspectable result and authority to apply it remain distinct.

### Reproducibility and accountable judgment

Temperature zero alone does not guarantee identical inference outputs across
execution conditions. For example, vLLM documents additional deterministic
kernels and numerical controls for batch invariance. The research implication is
to record and evaluate execution conditions rather than infer reproducibility
from one sampling parameter. See [vLLM's implementation details](https://docs.vllm.ai/en/stable/features/batch_invariance/#implementation-details).

A candidate audit record would retain the model identity and available snapshot,
harness, prompt and tool versions, exact Contract and priors, evidence hashes and
accessible source bytes, parameters and seed where supported, timestamps, tool
interactions, structured intermediate outputs and the final result. Hashes bind
bytes; they do not recover unavailable evidence or prove that an asserted model
was actually executed. Provider details that cannot be pinned would be stated as
limits. The current runner's unsigned provenance claims retain their existing limits.

Inspection of a retained attempt, a fresh rerun and bit-for-bit reproduction are
different capabilities. Multiple samples may expose instability at extra cost;
they do not establish fairness or consensus authority. Probabilistic interpretation
followed by deterministic contractual consequences is a possible architecture,
not a selected requirement. The existing deterministic verifier remains distinct
from this proposed judgment process.

## Evaluation of the priors and reasoning process

Evaluation examines **the dimensions, the incorporation mechanism, and their interaction**.

Some questions concern the catalog directly: can people understand a term, distinguish it from neighboring terms, and describe what different emphasis means? Other questions concern behavior under a particular mechanism: does it introduce unexplained asymmetry, react to irrelevant presentation changes, or permit an exploitable advantage?

A result that drifts could arise from an ambiguous dimension, an incorporation rule, the model's interpretation, or an interaction between them. Evaluation should make those possibilities distinguishable rather than attribute every failure to the priors.

The object of design is what people can express and how that expression is used. **It is not an effort to secretly optimize the values participants choose.** Sampling allocations for an explicitly labeled test is different from choosing or changing someone's actual declaration.

A proposed adversarial evaluation could hold a task, Contract and evidence fixed while sampling or searching over test declarations, including concentrating weight on one prior. We would look for advantages inconsistent with the intended meanings, rather than treat every changed outcome as gaming. Such findings could prompt refinement of the catalog's definitions, while also checking whether incorporation caused the advantage. Searching over weights here is an evaluation exercise; actual participants still choose their own weights. The test and criteria remain to be designed.

A research addition from 2 October proposes that we explore an adversarial setup with agents taking proposing and challenging roles, possibly through training or fine-tuning. The aim would be to discover ways participants could game the platform and test possible mitigations. The roles, training approach and evaluation criteria remain open.

Evaluation feeds findings back into derivation, inclusion and processing.
A change in an outcome is not automatically a failure: the question is whether
that change follows the declared meaning, evidence and agreed scope.

### A distinct inspection and evaluation harness

The resolver would analyze cases; an inspection harness would challenge its
behavior. This develops the earlier evaluation thread into a separate research
artifact. It could compare candidate catalogs, incorporation methods and resolver
versions together, using synthetic cases with known constructed facts, adversarial
cases, lawfully available historical disputes and blinded human assessment.
Historical outcomes and human ratings are comparison material, not automatic
ground truth about fairness.

| Probe | Question |
| --- | --- |
| Identity blinding and substitution | Do irrelevant identities, demographic cues or prestige change interpretation? |
| Role reversal | Does the same principle apply coherently when comparable facts favor the other role, while preserving different contractual duties? |
| Paraphrase and evidence order | Does equivalent content receive materially different treatment? |
| Prior changes and removal | Does a prior affect the situations its stated meaning addresses, and does the explanation match that effect? |
| Contradictions and missing evidence | Does uncertainty remain visible instead of becoming invented facts or automatic fault? |
| Fabrication and embedded instructions | Can forged material, prompt injection or selective presentation steer the outcome? |
| Repeated attempts and model changes | How much does the result vary, and does a new model or harness introduce drift? |
| Challenges and incident reports | Can observation patterns or the materiality gate be exploited, or burden honest participants unequally? |

Model variation can confound a comparison with and without a prior; controls and
repeated attempts would need to distinguish it from the prior's intended effect.
Equal role labels or identical payment splits are not by themselves symmetry.
The inspection process could use proposing and challenging agents, as mentioned
in the earlier discussion, but no agent training, fine-tuning or evaluation method
has been selected or performed. Passing a finite case set would establish its
observed results, not universal fairness or resistance to gaming.

### Commitments credibility and the research questions

These ideas concern the catalog and the way it is used together. They are
not automatically additional dimensions in the catalog.

| Research stage | Commitment question |
| --- | --- |
| Derivation | Can a candidate prior express an understandable commitment? |
| Inclusion | Is the exact earlier declaration present with its shared meaning and role? |
| Processing | How does that declaration influence later arguments and possible resolutions? |
| Evaluation | Does honoring the declaration remain practical, and can misrepresentation obtain an advantage? |

A later discussion could use one value in two contrasting situations: one
where it helps its declarer and one where it favors the other party. That
could clarify what commitment means before choosing any mechanism.

The three threads might also turn out to need different treatment: relevance
to a particular dispute, confidence built across earlier cooperation, and the
meaning of a declaration are related questions, but we have not decided to
combine them into one mechanism.

The [open decision record](../../requests/DISPUTE_PRIORS_DECISIONS.md) and
[current priors specification](../../requests/DISPUTE_PRIORS.md) retain the implementation
boundary: `ANALYSIS_ONLY`, financial authority `NONE`, settlement policy
`UNSPECIFIED`. The current companion does not implement credibility
assessments or consequences from these notes. The
[lifecycle discussion](../../requests/DISPUTE_LIFECYCLE.md) retains the separate questions
of mutual settlement, an accepted escalation procedure and accountability.

## Open research questions

- The priors' meanings, size, mathematical representation, separate-role treatment
  and intended effects on ambiguity, remedies and payment.

- Model/provider choice, audit guarantees, costs, response times and acceptable
  variation between runs.
- Corpus permissions and the derivation and adversarial evaluation methodology.

Resume with these points intact: the dimensions are open to refinement; five is not mandatory; the parties retain separate equal budgets; incorporation is a separate unresolved design question; evaluation examines the catalog and mechanism together; and the purpose is understandable influence over disagreement, ultimately toward settlement.

The catalog's size, precise meanings, representations, separate-role treatment,
model choice and acceptable variation remain open. The operational response to
inconclusive results and any authority for payment are developed in the
[dispute resolution notes](DISPUTE_RESOLUTION_NOTES.md).

## Discussion history and implementation boundary

The foundation is the owner's 29 September handoff about disagreement-specific
priors, agency and trust. The original three research fronts were clarified into
four on 4 October. The 30 September seed notes about honest declaration,
consistency and commitment were incorporated on 1 October. The same discussion
also proposed time, useful computation and hybrid deterrents; those mechanisms
now live in the operational dispute note.

The two fuller owner-supplied summaries from 2 October added the public
multimodal resolver, inspection harness, evidence principles and contract-corpus
experiment. The second, thirty-part list supplied the main structure; the first
retained emphasis on explicit payment percentages, undefined deterrents and a
bounded expert system. Their strong wording remains research aims or hypotheses.

The original seed wording had been recorded in
`private-source/PRINCIPLES_OF_DISPUTES_RESOLUTION_notes.md` before its earlier
incorporation. That is discussion provenance, rather than a current source
location.

The source packet includes the DP-1 colleague review, DP-2 pre-cooperation and
local-analysis evidence, and the broader three-party protocol handoff. The
[current priors specification](../../requests/DISPUTE_PRIORS.md),
[open decisions](../../requests/DISPUTE_PRIORS_DECISIONS.md) and
[protocol context](../../requests/CONTEXT.md) retain the implementation boundary.
DP-2 remains closed as accepted synthetic workflow integration. The local model
remains a workflow test component, with its negative findings preserved.
The companion remains `ANALYSIS_ONLY`, financial authority `NONE` and
settlement policy `UNSPECIFIED`.

The linked corpus, research and inference references were checked while
incorporating the 2 October discussion. Their historical dates, dataset counts,
source limitations and license qualifications remain attached to the relevant
passages. No corpus analysis, model training or model-quality experiment was
performed for those additions. The 4 October reorganization adds no such result,
changes no signed record and selects no mechanism.

Use [Terminology](../../requests/TERMINOLOGY.md) for shared names and
[all research notes](README.md) for the three connected subjects.

# Dispute resolution material incidents insurance and priors

Working research notes · 2 October 2026

Today's discussion connects the assignment protocol to a more concrete research
direction: ordinary contractual disagreements could use an inspectable reasoning
harness, while serious harm would use a separate incident procedure and external
institutions. Existing professional insurance may support some initial task
classes without Non Verba becoming an insurer. That possibility leaves room to
develop the central question: **can strangers choose a small, understandable set
of principles, before cooperating, for interpreting ambiguity between them?**

These are discussion directions and hypotheses. Strong wording in the supplied
notes expresses an aim, not a newly adopted requirement or a claim of readiness.
The [current companion](../DISPUTE_PRIORS.md) remains `ANALYSIS_ONLY`, with financial
authority `NONE` and settlement policy `UNSPECIFIED`. Its accepted local workflow
and recorded model limitations stand. The proposals below add no implementation.

## Relationship to the earlier research

The [earlier discussion](DISPUTE_SETTLEMENT_NOTES.md) separates derivation,
incorporation and evaluation. This addition develops all three without fixing the
final vocabulary, number of priors or settlement mechanism.

| Existing thread | What today's discussion adds | Standing |
| --- | --- | --- |
| Separate ordinary disputes from serious harm | Material incident terminology, preservation and a candidate materiality gate | Refined working direction; thresholds and procedure open |
| Assurance and incident funding | External coverage as a possible initial path; a separate insurer as a future branch | Conditional deployment hypothesis |
| Declarations as commitments | Priors concern cooperation and interpretation under uncertainty, rather than trust weights for sensor types | Conceptual clarification; definitions and consequences open |
| Incorporation | A public multimodal harness receiving the Contract, evidence and both declarations | Candidate architecture beyond the current local analysis workflow |
| Derivation | Clause extraction, embeddings and clustering to suggest a compact vocabulary | Proposed experiment; no corpus analysis performed |
| Evaluation | A distinct inspection harness testing bias, gaming, relevance and stability | Research proposal; fairness has not been established |

## Ordinary disputes and material incidents

An **ordinary dispute** concerns the Assignment's contractual questions: what was
requested, what was performed, whether requirements were met, and what payment or
bounded remedy follows. A **material incident** concerns significant harm with
consequences beyond that payment disagreement, such as injury, a serious accident,
theft, destruction or substantial property damage. Incident describes an event
without deciding fault. Material is a provisional distinction whose threshold
still needs definition.

Material incident replaces catastrophe as the preferred provisional term in this
discussion. **Material incident notice** and **material incident procedure** are
candidate associated terms, recorded in the [glossary](../TERMINOLOGY.md).

The proposed incident direction is:

1. Attend to safety and emergency assistance immediately.
2. Record the notice and preserve the available assignment evidence.
3. Identify relevant medical, insurance, police, regulatory or legal channels.
4. Make appropriately scoped records available and cooperate under defined rules.

Medical assistance and legally required reporting would not wait for a platform
form or an internal classification. Non Verba's role would be preserving the
record and supporting the appropriate process. An incident report would not
establish guilt, negligence, liability or entitlement to insurance benefits.
The proposed resolver would not determine civil or criminal blame for that harm.

### A possible materiality gate

The second supplied list proposes easy reporting followed by a **materiality
gate**: a notice would not automatically activate every incident consequence.
Substantial harm or legally reportable events are possible qualifying grounds;
ordinary dissatisfaction could remain in the contractual dispute route.

Who assesses the gate, what happens under uncertainty, how a classification is
challenged, and appropriate response times remain open. Preservation and urgent
external assistance should not depend on passing it. The discussion aim is to
protect honest reporting, including mistaken reports, while examining how knowingly
fabricated reports could be addressed as misconduct. An unsupported or unconfirmed
notice alone would not demonstrate fabrication.

One Assignment could have both a payment dispute and a material incident. The
routes therefore concern the scope of particular claims, rather than assigning
the entire job one exclusive label. Classifying an incident would not by itself
cancel payment rights, settle harm claims or give Non Verba new authority.

## External insurance as a possible initial path

The useful architectural discovery is a possible separation of dependencies:
**supporting assignments need not inherently require Non Verba to underwrite
their risks itself.** An independent professional may already have relevant
ongoing coverage. For a narrowly chosen task class, that coverage could be checked
before formation. Some low-risk classes might need no additional platform-provided
insurance, subject to the actual work and applicable law.

A candidate admission sequence is to classify the work, define any required
coverage, verify qualifying existing coverage, then allow the relevant Assignment
to form. If required protection is absent or cannot be verified, the proposal is
to withhold admission to that task class. It is not a reason to erase an already
formed Contract. This is a proposed gate, not existing enforcement.

Suitable coverage is more than possession of a policy document. Review would
need to establish the insured party, activities, location, period, limits,
deductibles, exclusions and verification method. A policy may not cover the
particular event or all parties' losses. External coverage also does not establish
safe operations or satisfy unrelated platform obligations.

The claim is consequently narrower than "insurance does not block launch": an
insurer partnership, underwriting capital and Non Verba's own insurance product
may be avoidable initial dependencies for eligible work. Whether the actual
service needs insurance-related authorization still depends on what it does.
Norway's regulator distinguishes insurance activity from insurance intermediation
and identifies licensing requirements for insurance activity. Checking external
coverage is not assessed here as exempt from regulation. See
[Finanstilsynet's overview](https://www.finanstilsynet.no/tema/fintech/fintech-regelverk-og-konsesjon/forsikringsvirksomhet/).

### A separate future insurance institution

Insurance remains a possible future branch. Task definitions, qualifications,
timelines, evidence quality, incidents and observed outcomes might become useful
risk information. Their underwriting value is a hypothesis; signatures and rich
records alone do not establish actuarial quality, representative loss data or
accurate physical observations.

Possible branches include a carrier partnership, underwriting technology, an
MGA arrangement involving delegated insurance functions, or eventually a separate
insurer. MGA means managing general agent; the [NAIC model act](https://content.naic.org/sites/default/files/model-law-225.pdf)
provides a US regulatory definition. Responsibilities and authorization elsewhere
would depend on the jurisdiction and arrangement. These are alternatives to
investigate, not a promised sequence. Non Verba would handle the assignment,
evidence and contractual protocol; the insurer would handle its covered risk,
claims and regulated responsibilities.

The economic interest is also preserved: protection can be useful work, funded by
managing risk rather than taking a commission from labor. If a future pool
performs well, some savings might lower the cost of protection. This connects to
[profit and surplus in the draft governance principles](../../../GOVERNANCE.md#4-profit-and-surplus).
No pricing rule, pool, reserve policy or legal entity has been chosen. Access to
case evidence for scrutiny would not automatically authorize underwriting reuse;
purpose, lawful access, minimization and incentives need separate consideration.

### Software licensing and institutional separation

Project-owned software is currently AGPL-3.0-only. A separate insurer's software
would not automatically become covered merely because the institution uses an
interface. The relevant question is whether it uses or creates a covered or
combined work, rather than whether the companies are legally separate. The
[repository license](../../../LICENSE), especially sections 0, 5 and 13, defines
covered works, independent aggregation and obligations for modified software
used over a network. **An API boundary alone is not a blanket licensing exemption.**
The proposed separation is plausible, but a concrete integration needs review.

## Launch jurisdiction and the authority of the resolver

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
question. The [existing legal research references](DISPUTE_SETTLEMENT_NOTES.md#proposed-routes-and-legal-challenge-mechanisms--2-october-2026)
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
The [current privacy threat model](../THREAT_MODEL.md#privacy-and-sensitive-evidence)
already warns that raw exports may reveal sensitive material. Existing portable
local replay is not the production privacy-preserving package proposed here.

## A public multimodal reasoning harness

The candidate resolver is a reasoning harness around a capable multimodal model,
presented as a bounded expert system rather than a lawyer or court. Legal theories
may help organize its reasoning without conferring legal authority. Its inputs
could include images, video, audio, GPS and other sensors, timestamps, attestations,
messages, task requirements, both parties' notes and challenge responses. This is
a proposed evidence range, not a claim that today's runner processes every modality.

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

### An explanation with an explicit consequence

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
itself prove deception. The [earlier deterrent candidates](PRINCIPLES_OF_DISPUTE_RESOLUTION.md#4-candidate-deterrents-outside-the-payment-flow)
remain possible approaches, not a selected answer. None gives Non Verba custody
of task money or authority to impose deductions. An authorized contractual
outcome, its execution, external payment and receipt remain separate events.

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
cooperation. This connects to [the catalog as a possible commitment](PRINCIPLES_OF_DISPUTE_RESOLUTION.md#3-the-catalog-as-a-possible-commitment):
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

For an initial research prototype, definitions and declarations could enter the
model as explicit text alongside the Contract, evidence and procedure. The model
could explain the effect of each relevant prior and be compared with a version
without it. This makes incorporation more concrete without selecting how separate
R/O profiles are combined, how conflicts are resolved, or how text creates a
binding payment amount. The existing two-pass workflow is an experimental starting
point, not proof that this design works.

The aim is a compact, expressive vocabulary ordinary participants can understand.
The discussion's small constitutional core is an analogy for readable commitments,
not a claim that optional priors replace law or the three-party rights invariants.
Embeddings could support retrieval, evidence organization, analogous-contract
search and candidate discovery. A vector geometry that reliably determines
contractual judgment has not been specified or validated.

## Discovering candidate priors from contracts

Stanford's **Material Contracts Corpus** is a substantial source of prospective
contractual language. Its April 2025 paper reports **1,038,766 unique contract
URLs**, collected from SEC filings dated 1 January 2000 through 21 March 2023.
Deduplication was by URL, not by contract text. That is a reported historical
dataset size, not an asserted current website count. See the
[paper's collection method](https://arxiv.org/html/2504.02864v1#S2.SS1).

The live corpus site says it updates quarterly, warns that machine-generated
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

## A distinct inspection and evaluation harness

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

## What remains open

The connected architecture is useful for continued research, while several
questions can still block a particular implementation or live deployment:

- The priors' meanings, size, mathematical representation, separate-role treatment
  and intended effects on ambiguity, remedies and payment.
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
- Corpus permissions and the derivation and adversarial evaluation methodology.
- Deterrents for dishonest conduct by either party, including their evidence,
  proportionality and effects on honest newcomers or technical failures.

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

## Provenance

This note incorporates the owner's two supplied discussion summaries from
2 October 2026. The second, thirty-part list is the main structural source; the
first also preserves emphasis on payment percentages, undefined deterrents and
the resolver as an expert system. Conversational flourishes and absolute launch
claims were not adopted as rules. Qualifications about mixed claims, gate safety,
privacy, dataset use and existing authority connect the ideas to the live project.

The linked primary corpus and inference references and the insurance-regulator
overview and MGA model act were checked while incorporating the discussion. The AGPL boundary was
read against the repository license. No jurisdiction was approved, corpus analyzed,
model changed, experiment run, signed record altered or implementation added.

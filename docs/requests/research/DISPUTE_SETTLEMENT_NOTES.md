# Non Verba — Dispute priors: selection, incorporation, and evaluation

**Discussion handoff · 29 September 2026**

**Purpose:** preserve the conceptual decisions from this conversation so that another session can continue refining the priors without losing their intended role.

**Status:** a research and discussion note, not a new implementation instruction, signed agreement, selected settlement rule, or replacement for retained project records.

## 1. The idea we are preserving

Before cooperating, the Requester and Operator should each be able to declare, in a small and understandable vocabulary, what they want the resolution process to consider when a disagreement arises. Both should see the other's declaration before deciding to enter the arrangement.

The priors are **priorities for resolving disagreement**, not a general description of labor, a personality assessment, or a substitute for the agreed work and acceptance conditions.

The central question is:

> When cooperation goes wrong, which competing considerations should people be able to ask the resolution process to respect?

The eventual purpose is an explainable route toward settlement, potentially including an amount to be paid or a bounded remedy under a procedure accepted beforehand. The current implementation is analysis-only. That is the present development boundary, not a decision to abandon settlement as the destination.

## 2. Three separate procedures

### A. Selection: what can a participant express?

Selection determines the dictionary: its dimensions, their definitions, and their number. Its output is a set of candidate considerations with understandable meanings and contrasts—not participant allocations or settlement amounts.

The current five dimensions are a starting proposal, not a fixed answer. We have not agreed that the final dictionary must contain five dimensions or that new ideas must fit within the existing five.

Research can assist discovery. Waku proposed studying a corpus of disputes and published resolutions, embedding relevant material, and looking for clusters that could suggest recurring considerations. This remains a proposed research route, not an executed study or an adopted selection algorithm. The number of clusters need not be fixed at five. Giving a cluster a clear, useful meaning is itself an interpretive step.

Such methods may propose candidates; they do not automatically choose Non Verba's normative vocabulary. A frequently occurring pattern is not, by that fact alone, a principle we should adopt. Candidate selection remains an explicit design effort outside the operation of an individual assignment contract.

### B. Incorporation: how does a declaration influence resolution?

Incorporation determines how the selected definitions and each party's allocations enter the dispute process alongside the agreement and evidence.

Possible approaches mentioned in the conversation include supplying the profiles as model context, defining operations in an embedding space, or combining approaches. These are possibilities, not selected settlement methods. Merely naming vector algebra or embeddings does not specify what a priority should do.

This procedure must eventually explain what the priors influence: the analysis of competing considerations, which alternatives are considered, how alternatives are assessed, or a proposed settlement. The rule must also explain how the two separate profiles are treated when they differ.

The prototype has one experimental incorporation path: an evidence-oriented first pass without numeric profiles, followed by a second pass that receives both profiles and the first interpretation. This supports qualitative analysis. It does not settle how points become a payment amount or other binding consequence.

### C. Evaluation: do the dictionary and mechanism serve their purpose?

Evaluation examines **the dimensions, the incorporation mechanism, and their interaction**.

Some questions concern the dictionary directly: can people understand a term, distinguish it from neighboring terms, and describe what different emphasis means? Other questions concern behavior under a particular mechanism: does it introduce unexplained asymmetry, react to irrelevant presentation changes, or permit an exploitable advantage?

A result that drifts could arise from an ambiguous dimension, an incorporation rule, the model's interpretation, or an interaction between them. Evaluation should make those possibilities distinguishable rather than attribute every failure to the priors.

The object of design is what people can express and how that expression is used. **It is not an effort to secretly optimize the values participants choose.** Sampling allocations for an explicitly labeled test is different from choosing or changing someone's actual declaration.

The framework in one sentence:

> Selection defines what can be expressed; incorporation defines how it influences the process; evaluation examines both and their interaction.

## 3. The current starting dictionary

These are the five implemented starting dimensions described in the supplied project records. They are retained here for reference, not endorsed as the final selection.

| Prior | Current meaning | Existing boundary |
| --- | --- | --- |
| **Result** | Emphasis on the usable result and conformity to agreed scope, quality, and timing. | Does not rewrite the agreed standard after performance. |
| **Effort** | Emphasis on reasonable, diligent work actually undertaken within the agreed scope. | Does not reward invented hours, avoidable inefficiency, or unauthorized extra work. |
| **Reliance** | Emphasis on reasonable commitments, reserved resources, and unrecovered costs incurred because of the agreement. | Applies to either party; does not double-count recognized expenses or create uncapped liability. |
| **Responsibility** | Emphasis on who could reasonably control, prevent, communicate, or mitigate the cause of a shortfall. | Requires relevant evidence; is not a character score, criminal verdict, or presumption of Operator fault. |
| **Remedy** | Emphasis on a practical, proportionate opportunity to correct, complete, replace, or otherwise resolve a deficient outcome. | Does not require indefinite work, unilateral scope expansion, or automatic unpaid rework. |

The allocation rule gives **each party independently fifty points per dictionary dimension in total**. With the initial five dimensions, that is **250 points for the Requester and 250 for the Operator**, with integer values from zero to 100 per dimension in the initial implementation.

The budgets are separate, not pooled. Non Verba has no third preference vector in this version. The balanced fifty-per-dimension profile is an editable draft, not inferred consent. Zero does not waive a right; 100 is not a payment percentage. These points are declared priorities, not probabilities of honesty or proof of a person's actual intentions.

Changing the dictionary in a future design must not silently change the meaning of an earlier signed profile.

## 4. The refinement made in this conversation

Waku emphasized that the vocabulary must describe **considerations for the outcome of a disagreement**, rather than merely identify desirable properties of work.

A broad noun such as “Result” may be too general. It currently includes both practical usefulness and conformity to what was requested. Those can express different concerns. We have identified a question to investigate, not decided to split or remove the dimension.

The discussion moved toward declarations such as:

- **Value the effort:** “When an outcome falls short, reasonable work genuinely undertaken should still matter in deciding how to resolve the disagreement.”
- **Value the outcome:** “When effort was undertaken but the agreed benefit was not delivered, that missing benefit should matter in deciding the resolution.”
- **Value the intention:** a candidate requiring clarification before it becomes a dimension.

These statements are discussion candidates, not replacement definitions or rules that determine compensation.

### Intention and profit remain open candidates

“Intention” could mean the purpose of entering the cooperation, or the intention behind the disputed conduct. A profit-oriented purpose is different from distinguishing a mistake from deliberate disregard.

Waku wants the economic purpose of cooperation, including profit orientation, to be visible. We have not yet decided whether that belongs in the priors dictionary, a separate declaration, or another part of the agreement context. Nor have we selected what financial consequence, if any, it should have in a dispute.

A declared purpose must remain distinguishable from evidence about conduct. Saying “my intentions were good” must not silently become proof that a factual account is correct.

## 5. Clarity, agency, and trust

The desired experience is not simply that the interface looks fair. Each participant should be able to recognize:

> This lets me protect something that matters to me before I take the risk of cooperating.

A useful distinction from the conversation is:

> The preference can be personal; the meaning should be shared.

Different participants may legitimately place different emphasis on effort, outcome, or another consideration. The aim is to avoid the same label meaning different things to different people, or its meaning shifting according to whom an interpretation favors.

Choosing priorities that serve one's interests is not automatically gaming. Providing meaningful choice is part of the design. The concern is advantage obtained through ambiguous wording, unsupported claims, hidden features of the incorporation mechanism, or other exploits—not the mere fact that someone makes a deliberate choice.

The intended basis for trust is:

> I understand when my choice could help me, what it does not guarantee, and how the other party's choices will also be considered.

Equal point budgets do not by themselves establish fair outcomes. A middle value does not certify trustworthiness. The prototype does not yet guarantee the meaningful settlement influence described here; that requires the still-open incorporation design.

### Later notes: declarations and commitments · 1 October 2026

The owner's short notes from 30 September are now preserved in
[notes on declarations, commitments and dispute resolution](PRINCIPLES_OF_DISPUTE_RESOLUTION.md).
They add the aim of making honest declaration cheap to honor and expensive to
fake, the possibility of credibility from conduct matching declared values, and
the possibility that the catalog of values and selections could carry a commitment.
Suggested interpretations and open questions are labeled as discussion material;
no implementation details or mechanism have been decided by this addition.

## 6. A first discussion exercise, not new implementation work

Before choosing replacements or adding dimensions, make each candidate's **meaning and contrast** explicit.

For each candidate, write a plain-language declaration answering:

> Given the same facts, what meaningful difference should higher rather than lower emphasis on this consideration express?

Then identify its nearest possible confusion with another dimension. Keep these three meanings separate:

| Kind of statement | Example |
| --- | --- |
| Factual claim | “Substantial effort occurred.” |
| Declared priority | “Substantial effort should carry considerable weight in resolving this disagreement.” |
| Settlement consequence | “Therefore, this amount is owed.” |

The first needs evidence. The second belongs to the participant's declaration. Connecting them to the third requires an incorporation and settlement rule; that connection has not been selected.

A later discussion can use a recognizable disagreement and a contrasting situation to examine whether a candidate expresses a principle that can apply to either party, rather than merely “favor me.” No worked cases, payout targets, or selected formulas are introduced by this note.

New candidates should be considered on equal terms with the original five. The next conversation can begin with Waku's ideas rather than treating the existing dictionary as a constraint.

## 7. Relationship to the three-party agreement

The broader Request–Quote–Assignment Agreement defines the cooperation, explicit rights, and supported authorizations. The dispute-priors extension is a separately endorsed companion context bound to the exact Agreement. It does not replace the broader protocol.

Preserve the foundational rule:

> No coalition of two parties can create a valid contractual state that improperly alters the third party's rights.

And its companion:

> An authenticated contradiction is evidence of misconduct or uncertainty; it is not, by itself, authority to revoke a right previously established for another party.

The new research must not silently give the model or Non Verba authority to change financial rights. A future binding settlement process needs its own explicitly accepted rule and scope. The current mode remains **ANALYSIS_ONLY**, financial authority **NONE**, and settlement policy **UNSPECIFIED**.

An unresolved result is possible, but it is not necessarily economically neutral: a Requester retaining funds and an Operator who has already spent labor can face different losses. That concern belongs in the eventual design and evaluation; it is not answered merely by allowing either party to retain future resources.

The proposed assurance mechanism finances dispute-analysis computation, not compensation payouts. Compute sponsorship must not become purchased influence over the declarations or outcome. This note does not activate a commercial service.

### Mutual closure and escalation

A dispute may be **opened unilaterally**, but it should not be **closed by negotiated settlement unilaterally**. Requester and Operator must both explicitly authorize the **same exact resolution and its stated consequences**. Silence, inactivity, or refusal to respond is not consent.

Neither party is required to accept the other party’s proposed settlement. If they do not reach mutual agreement, the dispute remains open and proceeds to the **pre-agreed dispute-resolution procedure**. The distinction matters: the parties are not forced to *agree*; they may instead be bound by whatever resolution mechanism they authorized before cooperation, once that mechanism is specified.

A deterministic rule already accepted in the Assignment may still produce its predefined consequence when its required proof is satisfied, without requiring fresh agreement afterward.

Non Verba should not gain authority merely because the parties disagree. Its dispute mechanisms should be transparent and inspectable, including the applicable procedure, evidence, computation, result, and challenge path. **How Non Verba itself is held accountable—external oversight, governance, or meaningful stakes—remains a separate design question to develop later.**

## 8. Development boundary and how to resume

The small local model running through llama.cpp is a workflow test component, not the final resolver. Its weak reasoning is expected at this stage. This discussion does not reopen the integration milestone, request a model change, or ask for more prompt tuning. Retain observed failures honestly while keeping workflow integration, model competence, and settlement-policy research distinct.

Resume with these points intact: the dimensions are open to refinement; five is not mandatory; the parties retain separate equal budgets; incorporation is a separate unresolved design question; evaluation examines the dictionary and mechanism together; and the purpose is understandable influence over disagreement, ultimately toward settlement.

### Basis and provenance

This note consolidates the conversation with Waku on 29 September 2026. The three-procedure framework, the disagreement-specific framing, and the emphasis on agency and trust are conversation decisions and discussion aims.

The implemented starting dictionary and analysis-only boundary are described in the supplied **DP-1 colleague review packet**, particularly `docs/requests/DISPUTE_PRIORS.md`, `DISPUTE_PRIORS_DECISIONS.md`, and `code/disputes/src/binding.rs`. The supplied **DP-2 — pre-cooperation review and local-analysis evidence** handout describes the later workflow and its remaining limitations. The original **Non Verba — context for the next protocol extension** handoff supplies the broader three-party baseline.

No new code inspection, test execution, external corpus study, legal research, or model-quality experiment was performed to produce this note. It records the current discussion without upgrading proposals into implemented or authorized behavior.

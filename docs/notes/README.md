# Notes and research

This is the starting point for Non Verba's research discussions, operators union
development, assignment explanations and sensor proposals. The note files
are grouped by purpose.
Each document retains its own dates, status and distinction between ideas,
implemented behavior and open questions.

| Folder | Purpose |
| --- | --- |
| `research/` | Developing dispute resolution, priors, incident handling and insurance |
| `cooperation/` | Developing the operators union and connecting its calculations to membership and collective decisions |
| `assignments/` | Explaining the Assignment Contract and the participant experience |
| `sensors/` | Exploring evidence quality and fair handling of sensing failures |

## Research

The three research notes are organized by subject:

1. [Dispute resolution](research/DISPUTE_RESOLUTION_NOTES.md) covers operational
   handling, contractual consequences, consent, legal review, evidence access,
   challenges and accountability.
2. [Priors](research/DISPUTE_PRIORS_NOTES.md) develops the catalog and commitments
   through four research stages: derivation, inclusion, processing and evaluation.
3. [Incident handling and insurance](research/INCIDENT_HANDLING_AND_INSURANCE.md)
   covers significant harm, safety, reporting, preservation, external assistance,
   existing coverage and a future insurance institution.

Priors are part of dispute resolution and have a research program of their own.
The dispute note develops the surrounding operational and legal procedure; the
incident note covers a different scope of harm. An Assignment may involve both
an incident and a payment dispute. These files contain working ideas and research
questions; their inclusion here does not adopt a settlement, incident or
insurance rule.

### Research stages and discussion history

The owner's 4 October 2026 clarification distinguishes four connected stages:

- **Derivation:** develop and define the catalog.
- **Inclusion:** supply the exact definitions and both parties' declarations in
  the case context.
- **Processing:** study how the resolver uses the Contract, claims, evidence and
  priors together.
- **Evaluation:** test those stages and their interaction, feeding findings back
  into their design.

Earlier notes used derivation, incorporation and evaluation; incorporation
covered what is now explicit as inclusion and processing. This clarification
changes no signed profile, legal authority or runtime. The
[priors note](research/DISPUTE_PRIORS_NOTES.md#four-research-stages) develops the
stages and their relationship to the wider reasoning system.

The notes retain the 29 September handoff about disagreement, agency and
understandable declarations; the 30 September seed ideas incorporated on
1 October; and the two fuller 2 October summaries. Original seed wording about
honesty, consistency and commitment remains in the priors note. Candidate time,
useful-compute and hybrid deterrents remain in the dispute note. The summaries
connect the resolver and inspection harness to symmetric evidence, material
incidents, external coverage and a possible future insurance institution. The
contract-corpus experiment remains a proposed derivation route. Material incident
is the preferred provisional successor to catastrophe; gates, coverage,
consequences, legal authority and evaluation methods remain open.

The 4 October subject split replaced grouping by successive discussions. Dates,
sources, original wording and qualifications remain in the subject notes. It
adopts no catalog, settlement rule, credibility score, incident gate or insurance
arrangement. [Mutual closure and escalation](research/DISPUTE_RESOLUTION_NOTES.md#mutual-closure-and-escalation)
retains the exact-consent boundary; the [lifecycle specification](../requests/DISPUTE_LIFECYCLE.md)
develops a proposed interface around current implementation limits. Shared names,
role framing and research stages remain in [Terminology](../requests/TERMINOLOGY.md).

### Current implementation boundary

The [current priors implementation](../requests/DISPUTE_PRIORS.md) uses five
dimensions and 250 points per party. Exploring a different catalog does not
change signed profiles; a later implemented revision needs explicit versioning
and consent. Requester and Operator remain roles open to people, organizations,
agents and embodied robots under established signing authority.

DP-2 remains closed as accepted workflow integration. The local model remains a
workflow test component and its negative findings stand. The companion remains
`ANALYSIS_ONLY`, with financial authority `NONE` and settlement policy
`UNSPECIFIED`. Priors are not sensor reliability weights. Use
[open decisions](../requests/DISPUTE_PRIORS_DECISIONS.md),
[settlement handling](../requests/SETTLEMENT_HANDLING.md) and
[protocol context](../requests/CONTEXT.md) when resuming this work. Keep factual
claims, declared priors, model interpretations and authorized consequences distinct.

## Operators union

- [Operators union notes](cooperation/OPERATORS_UNION_NOTES.md) connect the
  remuneration protocol and simulator to the larger union idea. They preserve
  questions about membership, member decisions, task definitions, privacy and
  integration with Assignments and disputes.

Use the [cooperation protocol](../cooperation/COOPERATION_PROTOCOL.md) for the
current reference behavior and the [simulator guide](../cooperation/SIMULATOR.md)
for fictional scenarios. The union notes guide further development without
adopting an institutional or voting mechanism for the unfinished parts.

## Assignment explanations

- [Participant notes](assignments/PARTICIPANT_NOTES.md) explain reviewing,
  signing, performing and disputing an Assignment in ordinary language.
- [Contract notes and implementation record](assignments/CONTRACT_NOTES.md)
  explains proposed wording, implemented rules, supporting code and decisions
  needed before adopting real terms.

These are explanatory drafting documents. The specifications and implementation
records remain in [the Assignment documentation](../requests/README.md).

## Sensor proposals

- [Sensor quality notes](sensors/SENSOR_QUALITY_NOTES.md) explore camera,
  audio and location usability, device limitations, attributed evidence and
  inspectable failed attempts.
- [Private video embedding validation](sensors/PRIVATE_VIDEO_EMBEDDING_VALIDATION.md)
  explores compact representations of long recordings, questions private from
  the Operator and app, cryptographic commitments and homomorphic comparison.
  Representation and validation methods remain open research choices.
- [Open face authentication research](sensors/OPEN_FACE_AUTHENTICATION_RESEARCH.md)
  reviews face verification reliability, concrete model sizes and phone costs,
  model licensing, liveness and capture integrity for possible authentication use.

Use [sensor status](../sensors/STATUS.md) for the implementation boundary and
[the sensor guide](../sensors/README.md) for the current workflows.

## Related references

| Reference | Use |
| --- | --- |
| [Terminology](../requests/TERMINOLOGY.md) | Shared meanings and provisional names |
| [Dispute priors and local analysis](../requests/DISPUTE_PRIORS.md) | Current profiles, consent and analysis workflow |
| [Open settlement decisions](../requests/DISPUTE_PRIORS_DECISIONS.md) | Selected implementation scope and unresolved policy |
| [Settlement handling](../requests/SETTLEMENT_HANDLING.md) | Existing independently authorized settlement path |
| [Governance principles](../../GOVERNANCE.md) | Draft institutional purpose, rights and economics |

Return to [all documentation](../README.md) for specifications, development
procedures and validation records.

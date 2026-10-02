# Dispute settlement research notes

Discussion material for future extensions of the Assignment protocol.

## Preserved discussion

[Dispute settlement notes](DISPUTE_SETTLEMENT_NOTES.md)
retain the original user-supplied discussion handoff and subsequent owner additions.
They keep three design questions separate:

- **Selection:** what considerations a participant can express.
- **Incorporation:** how each party's declaration influences the resolution process.
- **Evaluation:** whether the vocabulary and mechanism serve their purpose together.

The vocabulary and its size remain open to refinement. The aim is understandable
influence over disagreement, building toward settlement. These notes are input
for later discussion, not an implementation task or an adopted settlement rule.

The [mutual closure and escalation addition](DISPUTE_SETTLEMENT_NOTES.md#mutual-closure-and-escalation)
records the intended consent and escalation boundary. The general escalation
procedure and Non Verba's accountability remain future design questions.
The [lifecycle specification](../DISPUTE_LIFECYCLE.md) develops those consent
boundaries into a proposed review interface while identifying the existing code's
limits. It does not select an escalation mechanism or alter the preserved notes.

[Notes on declarations, commitments and dispute resolution](PRINCIPLES_OF_DISPUTE_RESOLUTION.md)
incorporate the owner's short notes from 30 September: make honest declaration
cheap to honor and expensive to fake; consider an Operator's record of honoring
declared values; and explore the catalog of values and selections as a possible commitment.
The expansion offers possible interpretations and open questions. It selects no
implementation details, settlement rule or credibility mechanism.

## Connection to the current work

The [current implementation](../DISPUTE_PRIORS.md) still uses five dimensions and
250 points per party. Exploring a different dictionary does not change existing
signed profiles; any later implemented revision needs explicit versioning and
consent. Requester and Operator remain roles open to people, organizations,
agents and embodied robots under established signing authority.

DP-2 remains closed as accepted workflow integration. The local model remains a
workflow test component, and its recorded negative findings stand. The companion
remains `ANALYSIS_ONLY`, with financial authority `NONE` and settlement policy
`UNSPECIFIED`.

Use [open decisions](../DISPUTE_PRIORS_DECISIONS.md) for the current decision
boundary, [settlement handling](../SETTLEMENT_HANDLING.md) for the existing
independently authorized release path, and the [protocol context](../CONTEXT.md)
for the broader foundation. Keep factual claims, declared priorities, model
interpretations and authorized consequences distinct when resuming the discussion.

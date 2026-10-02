# Protocol and evidence integration context

Non-verba lets a Requester describe work, an Operator offer to perform it, and
the parties retain exact signed terms and independently inspect their consequences.
Requester and Operator are roles, usable by people, organizations, agents and
robots under established signing authority. The resource performing work, the
responsible party and the key authorized to sign are separate concepts.

The repository unifies several components without changing their authority:

| Component | Current role |
| --- | --- |
| [`code/requests/`](../../code/requests/README.md) | Contract formation, scoped authorization, retained evidence references and financial projection |
| [`code/disputes/`](../../code/disputes/README.md) | Local analysis, prior profiles and readable reports; analysis has no financial authority |
| [Sensor application](../sensors/README.md) | Attributed camera/audio/location evidence and requester observations under explicit policies |
| [Cooperation protocol](../cooperation/COOPERATION_PROTOCOL.md) | Separate remuneration calculations and fictional simulator scenarios |

The assignment baseline remains protocol 2, package 0.2.1 and terminal adapter
format 1. The sensor package remains 0.7.0. The cooperation package remains 0.1.0.
A common repository does not implement hosted discovery, payments, shared
identities, global completion history or a production marketplace.

## Authority and verification

The [threat model](THREAT_MODEL.md) states the core requirement: no coalition of
two parties can create a valid contractual state that improperly alters the third
party's rights. This concerns the verifier under its declared trust and software
assumptions; it does not prove physical truth, solvency, freedom from collusion or
legal enforceability.

An authenticated contradiction is evidence of misconduct or uncertainty. It is
not, by itself, authority to revoke a previously established right. Amendments,
releases and other effects require the exact authorizers and proof specified by
the accepted policy. Proposal text and mediation do not create authority.

Read [the Contract](CONTRACT.md), [specification](SPECIFICATION.md) and
[settlement guide](SETTLEMENT_HANDLING.md) for executable scope. The explanatory
[participant notes](PARTICIPANT_NOTES.md) and [detailed notes](CONTRACT_NOTES.md)
remain drafting material, not adopted production terms.

## Sensor evidence is a separate boundary

| Observation | What it does not automatically establish |
| --- | --- |
| Sensor requester receipt or local acceptance | An Assignment milestone acknowledgment or payment authorization |
| Valid signature or hardware-key enrollment | Physical truth, responsible Operator identity or delegated contractual signing authority |
| Evidence unavailable, below policy or timed out | Operator fault, a penalty, forfeiture or erasure of an accrued right |
| Task completion accepted | Payment observed or payee credit granted |
| Outstanding amount reported | Satisfaction of every narrative payment condition |

Bind a deliberate integration to the exact Assignment, accepted sensor request,
artifacts, evidence policy and independently trusted identities. Preserve legacy
signed records and the closed authority model. Sensor acquisition and workflow
integration remain distinct from deployment assurance.

The [sensor status](../sensors/STATUS.md), [security model](../sensors/SECURITY.md)
and [acceptance checklist](../sensors/DEVICE_ACCEPTANCE.md) describe the remaining
limits. [Sensor quality notes](../sensors/SENSOR_QUALITY_NOTES.md) propose additional
task-specific metrics and attribution; proposal text is not an implemented quality
guarantee or an agreed contractual consequence.

## Development and remaining work

Use [the managed container procedure](../development/CONTAINER_PLAN.md) and
[checkout migration guide](../development/CONTAINER_MIGRATION.md). Build and test
toolchains stay inside Debian. No phone or sound operation is required to inspect
the protocol or reorganize its documentation.

Production participant enrollment and delegated contractual authority, discovery,
access control, payment providers/finality, recovery and rollback protection,
privacy/retention and jurisdiction-specific adopted terms remain separate work.
The [service decision worksheet](CONTRACT_NOTES.md#unadopted-service-decision-worksheet)
is unselected until actual decisions are made.

Earlier local handoffs and review journals are preserved outside this public
source import. Use [the current validation record](../development/VALIDATION.md)
for checks actually executed on the unified checkout.

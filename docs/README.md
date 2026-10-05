# Non-verba documentation

Non-verba brings cooperation calculations, three-party assignments, dispute
analysis and sensor evidence into one source repository. These modules retain
their own verification boundaries; placing them together does not turn the
prototype into a deployed marketplace or make sensor claims physically true.

| Area | Start here | Scope |
| --- | --- | --- |
| Notes and research | [Notes index](notes/README.md) | Research discussions, operators union development, assignment explanations and sensor proposals grouped by purpose |
| Security design | [Security properties and design record](SECURITY_DESIGN_RECORD.md) | CIA triad, authentication, authorization, non-repudiation, accountability and assumption failures |
| Cooperation | [Union notes](notes/cooperation/OPERATORS_UNION_NOTES.md), [protocol](cooperation/COOPERATION_PROTOCOL.md), [simulator](cooperation/SIMULATOR.md) | Union development questions, deterministic remuneration calculations and fictional simulations |
| Assignments | [Assignment guide](requests/README.md), [specification](requests/SPECIFICATION.md) | Exact Contract terms, scoped authority, evidence and protected rights |
| Disputes | [Priorities and local analysis](requests/DISPUTE_PRIORS.md), [settlement handling](requests/SETTLEMENT_HANDLING.md) | Analysis and reports; binding settlement requires its separate authorization |
| Sensors | [Evidence app](sensors/README.md), [security](sensors/SECURITY.md), [status](sensors/STATUS.md) | Camera, microphone, location, enrollment and requester verification |
| Development | [Managed container](development/CONTAINER_PLAN.md), [checkout migration](development/CONTAINER_MIGRATION.md), [repository cleanup](development/REPOSITORY_CLEANUP.md), [validation](development/VALIDATION.md) | Reproducible development procedures and the checks for this unification |
| Homepage | [Deployment](development/HOMEPAGE_DEPLOYMENT.md) | A static, allowlisted export of `web/site/` |

The assignment [threat model](requests/THREAT_MODEL.md) and the sensor
[security boundaries](sensors/SECURITY.md) describe different assumptions.
Read both before combining contractual verification with sensor evidence.

Some imported technical documents contain dated observations from earlier
development. Personal captures, signing vaults, device exports, machine logs and
review journals are not part of this source release. References to those local
records are marked as such. Historical observations are not new validation of
this checkout; use the [current validation record](development/VALIDATION.md).

Generated builds, release archives and local acceptance results remain ignored.
Reviewed synthetic vectors required by tests are retained with their corresponding
source packages. The repository's [license](../LICENSE) applies to project-owned
materials; third-party notices remain separate.

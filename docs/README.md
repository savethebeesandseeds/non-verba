# Non-verba documentation

Non-verba brings cooperation calculations, three-party assignments, dispute
analysis and sensor evidence into one source repository. These modules retain
their own verification boundaries; placing them together does not turn the
prototype into a deployed marketplace or make sensor claims physically true.

| Area | Start here | Scope |
| --- | --- | --- |
| Security design | [Security properties and design record](SECURITY_DESIGN_RECORD.md) | CIA triad, authentication, authorization, non-repudiation, accountability and assumption failures |
| Cooperation | [Protocol](cooperation/COOPERATION_PROTOCOL.md), [simulator](cooperation/SIMULATOR.md) | Deterministic remuneration calculations and fictional simulations |
| Assignments | [Assignment guide](requests/README.md), [specification](requests/SPECIFICATION.md) | Exact Contract terms, scoped authority, evidence and protected rights |
| Disputes | [Priorities and local analysis](requests/DISPUTE_PRIORS.md), [settlement handling](requests/SETTLEMENT_HANDLING.md) | Analysis and reports; binding settlement requires its separate authorization |
| Sensors | [Evidence app](sensors/README.md), [security](sensors/SECURITY.md), [status](sensors/STATUS.md) | Camera, microphone, location, enrollment and requester verification |
| Development | [Managed container](development/CONTAINER_PLAN.md), [checkout migration](development/CONTAINER_MIGRATION.md) | Reproducible development in the preserved Debian environment |
| Homepage | [Deployment](development/HOMEPAGE_DEPLOYMENT.md) | A static, allowlisted export of `web/site/` |

## Planned work and open decisions

The [notes index](notes/README.md) is the shared home for research and drafting.
These directions remain active even where a related implementation milestone is
complete. They are proposed work, not deployed features or adopted policy.

| Direction | Roadmap or decision record |
| --- | --- |
| Authentication and work privacy | [Isolated development requirements](development/AUTHENTICATION_AND_WORK_PRIVACY.md) for Requester/Operator authentication, account-wide hold and clock-out, and registration identity verification |
| Registration | [Operator and Requester pipelines and remaining account services](development/REGISTRATION_PIPELINES.md) — local drafts, private accessibility needs, self-reported certifications and explicit sharing choices |
| Operator face continuity | [Selected model, private enrollment and comparison](development/OPERATOR_FACE_PIPELINE.md) — isolated browser components; liveness, trusted capture and production threshold evaluation remain unresolved |
| Agent access and durable workflows | [MCP implementation gates](development/AGENT_WORKFLOWS_MCP.md#implementation-gates-for-later-work) |
| Operators union | [Membership, collective decisions and next research steps](notes/cooperation/OPERATORS_UNION_NOTES.md#possible-next-research-steps) |
| Assignment launch and service terms | [Decisions before adopting real terms](notes/assignments/CONTRACT_NOTES.md#decisions-needed-before-adopting-real-terms), [production readiness](requests/READINESS.md#unsupported-or-unreviewed-capabilities) |
| Dispute resolution and settlement authority | [Open settlement decisions](requests/DISPUTE_PRIORS_DECISIONS.md), [operational and legal research](notes/research/DISPUTE_RESOLUTION_NOTES.md#open-operational-and-legal-questions), [dispute lifecycle](requests/DISPUTE_LIFECYCLE.md) |
| Priors and the reasoning system | [Derivation, inclusion, processing and evaluation](notes/research/DISPUTE_PRIORS_NOTES.md#four-research-stages) |
| Material incidents and insurance | [Incident handling and future insurance institution](notes/research/INCIDENT_HANDLING_AND_INSURANCE.md) |
| Sensor quality and failure reporting | [Quality proposals](notes/sensors/SENSOR_QUALITY_NOTES.md#proposed-quality-contract), [current status and remaining limits](sensors/STATUS.md), [live camera physical gates](sensors/CAMERA_SESSIONS.md#remaining-physical-gates) |

## Validation and historical records

The assignment [threat model](requests/THREAT_MODEL.md) and the sensor
[security boundaries](sensors/SECURITY.md) describe different assumptions.
Read both before combining contractual verification with sensor evidence.

Some imported technical documents contain dated observations from earlier
development. Personal captures, signing vaults, device exports, machine logs and
review journals are not part of this source release. References to those local
records are marked as such. Historical observations are not new validation of
this checkout. Use [development validation](development/VALIDATION.md),
[sensor validation](sensors/VALIDATION.md) and
[cooperation validation](cooperation/VALIDATION.md) for dated results and limits.
The completed repository consolidation is recorded within development validation.

Generated builds, release archives and local acceptance results remain ignored.
Reviewed synthetic vectors required by tests are retained with their corresponding
source packages. The repository's [license](../LICENSE) applies to project-owned
materials; third-party notices remain separate.

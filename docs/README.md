# Non-verba documentation

Non-verba brings cooperation calculations, three-party assignments, dispute
analysis and sensor evidence into one source repository. These modules retain
their own verification boundaries; placing them together does not turn the
prototype into a deployed marketplace or make sensor claims physically true.

| Area | Start here | Scope |
| --- | --- | --- |
| Security design | [Security properties and design record](SECURITY_DESIGN_RECORD.md) | CIA triad, authentication, authorization, non-repudiation, accountability and assumption failures |
| Legal documents | [Legal document register and upkeep](LEGAL_DOCUMENT_REGISTER.md) | Canonical drafts/notices/licenses, versions, pending decisions and continuing Hx02 stewardship |
| Cooperation | [Protocol](cooperation/COOPERATION_PROTOCOL.md), [simulator](cooperation/SIMULATOR.md) | Deterministic remuneration calculations and fictional simulations |
| Assignments | [Assignment guide](requests/README.md), [specification](requests/SPECIFICATION.md) | Exact Contract terms, scoped authority, evidence and protected rights |
| Disputes | [Priorities and local analysis](requests/DISPUTE_PRIORS.md), [settlement handling](requests/SETTLEMENT_HANDLING.md) | Analysis and reports; binding settlement requires its separate authorization |
| Sensors | [Evidence app](sensors/README.md), [security](sensors/SECURITY.md), [status](sensors/STATUS.md) | Camera, microphone, location, enrollment and requester verification |
| Development | [Development guide](development/README.md) | Current environment, client implementation and operational instructions, with separate dated validation |
| Homepage | [Deployment](development/HOMEPAGE_DEPLOYMENT.md) | A static, allowlisted export of `web/site/` |

## Planned work and open decisions

Start with [Non Verba workstreams](notes/WORKSTREAMS.md) for the broad work
categories and task boundaries, including APK buildout and server side services.

Use the private workspace's
[project dashboard](../../private-source/web/dashboard/README.md) to inspect
Heroes, Goals and Milestones, with color-coded progress and evidence. Its
[schema](../../private-source/web/dashboard/SCHEMA.md) defines updates to one JSON
per Hero. These local links require the sibling private checkout.

The [notes index](notes/README.md) is the shared home for research and drafting.
These directions remain active even where a related implementation milestone is
complete. They are proposed work, not deployed features or adopted policy.

| Direction | Roadmap or decision record |
| --- | --- |
| Authentication and work privacy | [Isolated development requirements](development/AUTHENTICATION_AND_WORK_PRIVACY.md) for Requester/Operator authentication, account-wide hold and clock-out, and registration identity verification |
| Registration | [Operator and Requester pipelines and remaining account services](development/REGISTRATION_PIPELINES.md) — local drafts, private accessibility needs, self-reported certifications and explicit sharing choices |
| Maps | [Shared map component and country pipeline](development/MAP_COMPONENT.md) — Norway overview, country visibility, supplied positions and routes; production tile and tracking services remain separate |
| Operator face continuity | [Selected model, private enrollment and comparison](development/OPERATOR_FACE_PIPELINE.md) — isolated browser components; liveness, trusted capture and production threshold evaluation remain unresolved |
| Agent access and durable workflows | [MCP implementation gates](development/AGENT_WORKFLOWS_MCP.md#implementation-gates-for-later-work) |
| Operators union | [Membership, collective decisions and next research steps](notes/cooperation/OPERATORS_UNION_NOTES.md#possible-next-research-steps) |
| Assignment launch and service terms | [Decisions before adopting real terms](notes/assignments/CONTRACT_NOTES.md#decisions-needed-before-adopting-real-terms), [production readiness](requests/READINESS.md#unsupported-or-unreviewed-capabilities) |
| Dispute resolution and settlement authority | [Open settlement decisions](requests/DISPUTE_PRIORS_DECISIONS.md), [operational and legal research](notes/research/DISPUTE_RESOLUTION_NOTES.md#open-operational-and-legal-questions), [dispute lifecycle](requests/DISPUTE_LIFECYCLE.md) |
| Priors and the reasoning system | [Derivation, inclusion, processing and evaluation](notes/research/DISPUTE_PRIORS_NOTES.md#four-research-stages) |
| Material incidents and insurance | [Incident handling and future insurance institution](notes/research/INCIDENT_HANDLING_AND_INSURANCE.md) |
| Identity validation language and liability | [Owner direction and current copy gap](notes/legal/IDENTITY_VALIDATION_AND_LIABILITY.md) |
| Sensor quality and failure reporting | [Quality proposals](notes/sensors/SENSOR_QUALITY_NOTES.md#proposed-quality-contract), [current status and remaining limits](sensors/STATUS.md), [live camera physical gates](sensors/CAMERA_SESSIONS.md#remaining-physical-gates) |

## Validation and historical records

Keep a current guide authoritative for its declared component. Specifications in
`cooperation/` and `requests/` define protocol behavior; `sensors/README.md`,
`sensors/STATUS.md` and focused sensor guides describe the evidence applications.
`development/` owns environment procedures and implementation/integration guides.
The [web source map](../web/README.md) and [Android guide](../code/android/README.md)
own application placement and native packaging. Cross-cutting decisions should
link to those owners instead of copying their commands or source maps.

Record a check's date, exact scope, outcome and limits in its validation record.
An old successful command or device observation does not supersede the current
guide. Preserve earlier evidence and its anchors when updating instructions.
Research proposals stay in `notes/`; experiment checkpoints stay with the
experiment. The [paused priors study](../code/disputes/prototypes/priors-derivation/study-v0.2/README.md)
separates its current stop state from its detailed history.

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

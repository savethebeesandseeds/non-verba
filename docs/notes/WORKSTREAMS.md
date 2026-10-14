# Non Verba workstreams

Working outline, 14 October 2026. These eleven Heroes organize the work ahead so
we can refine their Goals and divide work into Milestones. Their numbers identify
Heroes; priority, ownership and implementation order remain to be decided.

Use the [project dashboard](../../web/dashboard/README.md) for the hierarchy of
Heroes, Goals and Milestones, color-coded states, dependencies and evidence.
One JSON per Hero beside the HTML holds its progress; the
[schema](../../web/dashboard/SCHEMA.md) defines ordinary edits. After updating a
Hero, run `./web/dashboard/refresh.ps1` from the repository root to validate and
refresh the standalone HTML through the existing managed container. Open the HTML
directly to see that snapshot; JSON edits appear only after refresh. This outline
defines the Hero boundaries.

The table describes broad directions. The dashboard keeps a partial record of
confirmed tasks and evidence-backed checkpoints; empty Heroes await a confirmed
breakdown. Add checkable Milestones when their scope is agreed, preserving the
limits of local prototypes and bounded validation results.

Several areas already have working prototypes. Component documentation records
their completed milestones and validation; the scopes below describe further
hardening, research, integration and institutional development.

## Heroes

| Number | Hero | Work ahead |
| --- | --- | --- |
| 1 | [Sensor hardening and evidence quality](../sensors/STATUS.md) | Reliable camera, microphone and GPS acquisition; cancellation and recovery; inspectable failed attempts; calibrated quality requirements; physical-device validation and resistance to replay or substitution. |
| 2 | [Identity, authentication and work privacy](../development/AUTHENTICATION_AND_WORK_PRIVACY.md) | Verified account enrollment, key ownership and recovery, device authorization, face continuity and liveness, and enforceable hold/clock-out across devices. Protect sensitive information throughout. |
| 3 | [Assignments and participant experience](assignments/PARTICIPANT_NOTES.md) | Connect registration, discovery, maps, task requests, exact Contract review/signing, evidence collection, completion and notifications into a usable Requester/Operator journey. |
| 4 | [Priors and the reasoning system](research/DISPUTE_PRIORS_NOTES.md) | Develop understandable prior definitions, complete and audit the corpus research, specify how declarations enter case context, and study how they influence reasoning. Evaluate comprehension, consistency, bias, uncertainty and gaming. |
| 5 | [Dispute procedure and settlement](research/DISPUTE_RESOLUTION_NOTES.md) | Define claims, responses, evidence access, challenges, mutual closure, escalation and inconclusive outcomes. Establish the consent and authority needed to turn a proposed resolution into contractual consequences and payment. |
| 6 | [Cooperation and the Operators union](cooperation/OPERATORS_UNION_NOTES.md) | Extend the remuneration calculator into genuine membership, authenticated completion ballots, collective decisions, approved policy amendments and integration with signed Assignments. |
| 7 | [Material incidents and insurance](research/INCIDENT_HANDLING_AND_INSURANCE.md) | Define significant-harm reporting, immediate response, evidence preservation, external assistance and coverage verification. Research partnerships and the possible future insurance institution. |
| 8 | [Durable infrastructure and agent access](../development/AGENT_WORKFLOWS_MCP.md) | Define and implement authenticated workflow transport, synchronization, retries, cancellation, recovery and acceptance semantics across devices. Expose complete authorized workflows through MCP and other agent interfaces. |
| 9 | [Governance and launch readiness](../../GOVERNANCE.md) | Translate draft principles into accountable institutions, service responsibilities, sustainable economics and reviewed terms for a chosen pilot scope and jurisdiction. Complete independent security, privacy and release review. |
| 10 | [APK buildout](../../code/android/README.md) | Build out the existing Android APK into the complete phone experience: navigation, integrated participant workflows, native permissions and lifecycle, protected local storage, service connectivity and offline behavior. Validate device compatibility, packaging, signing, distribution and updates. |
| 11 | [Server side services](../development/REGISTRATION_PIPELINES.md#what-is-still-missing-and-why-it-matters) | Implement account/device sessions, enrollment and profile services, discovery and task coordination, notifications, authenticated evidence exchange, durable acceptance records and dispute records. Define service access controls, retention, backups, recovery, monitoring and deployment; integrate payment or coverage providers under separately agreed authority. |

## Boundaries between workstreams

Assignments and participant experience defines the complete participant journey.
APK buildout implements that journey on Android, using the existing shared UI and
native adapters. Server side services supplies the persistent account, task and
record services needed across devices.

Durable infrastructure and agent access defines workflow behavior and its agent
interfaces. Server side services implements the hosted persistence and service
operations supporting that behavior. Shared protocol, policy and verification
logic remains in the existing Rust packages.

Priors and reasoning research develops interpretation. Dispute procedure and
settlement defines who may authorize a consequence and under what consent. The
current analysis companion remains analysis only, with no financial authority;
its workflow milestone does not establish reliable reasoning or an adopted
settlement policy. Sensor evidence needs both artifact integrity and practical
usability, with responsibility for failures assessed separately.

Security, privacy, accessibility, usability and independent verification apply
across all workstreams.

## Dividing work into tasks

Group concrete outcomes as Goals under the appropriate Hero. Divide each Goal
into checkable Milestones with their own states, acceptance criteria and evidence.
Add owners and dependencies where useful. Work spanning Heroes should name its
primary Hero and the Milestones it depends on.

Use proposed, ready, in progress, blocked or done for individual task status.
Completion is assessed against the task's agreed acceptance criteria, including
physical validation where required.

Return to the [notes index](README.md) or [all documentation](../README.md).

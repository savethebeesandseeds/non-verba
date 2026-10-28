# Non Verba workstreams

Updated 27 October 2026 so Hero 4 builds inclusion and the counterfactual
reasoning engine on the signed catalog, and leaves corpus derivation as later
refinement. The 22 October note added reusable attestation-tool hardening
alongside sensor tools in Hero 1. The 16 October cross-Hero audit retained all eleven
Heroes, with the domain boundaries and handoffs below. Their numbers are
stable identifiers; task ownership, priority and implementation order still need
to be agreed as Goals are divided into Milestones.

Use the private workspace's
[project dashboard](../../../private-source/web/dashboard/README.md) for the
hierarchy of Heroes, Goals and Milestones, color-coded states, dependencies and
evidence. One JSON per Hero in `private-source/web/dashboard/heroes/` holds its
progress; the [schema](../../../private-source/web/dashboard/SCHEMA.md) defines
ordinary edits. These local links require the sibling private checkout. After
updating a Hero, run `./web/dashboard/scripts/refresh.ps1` from the
`private-source/` repository root to validate and refresh the standalone HTML
through the existing managed container. Open the HTML directly to see that
snapshot; JSON edits appear only after refresh. This outline defines the Hero
boundaries.

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
| 1 | [Tool hardening and evidence quality](../sensors/STATUS.md) | Reusable sensor and device-attestation tools; reliable camera, microphone and GPS acquisition; cancellation and recovery; inspectable failed attempts; calibrated quality requirements; physical-device validation and resistance to replay or substitution. |
| 2 | [Identity, authentication and work privacy](../development/AUTHENTICATION_AND_WORK_PRIVACY.md) | Account enrollment, key ownership and recovery, device authorization, face continuity and liveness, and enforceable hold/clock-out across devices. Protect sensitive information. Do not call a person verified or real without an issuing-body check. |
| 3 | [Assignments and participant experience](assignments/PARTICIPANT_NOTES.md) | Connect registration, discovery, maps, task requests, exact Contract review/signing, evidence collection, completion and notifications into a usable Requester/Operator journey. |
| 4 | [Priors and the reasoning system](research/DISPUTE_PRIORS_NOTES.md) | Use the signed five-dimension catalog as the working vocabulary. Specify how declarations enter case context, build the counterfactual reasoning engine, and study how declarations change reasoning. Refine the catalog after that machinery and the dispute procedure exist. The corpus study stays a conditional later refinement. |
| 5 | [Dispute procedure and settlement](research/DISPUTE_RESOLUTION_NOTES.md) | Define claims, responses, evidence access, challenges, mutual closure, escalation and inconclusive outcomes. Establish the consent and authority needed to turn a proposed resolution into contractual consequences and payment. |
| 6 | [Cooperation and the Operators union](cooperation/OPERATORS_UNION_NOTES.md) | Extend the remuneration calculator into genuine membership, authenticated completion ballots, collective decisions, approved policy amendments and integration with signed Assignments. |
| 7 | [Material incidents and insurance](research/INCIDENT_HANDLING_AND_INSURANCE.md) | Define significant-harm reporting, immediate response, evidence preservation, external assistance and coverage verification. Research partnerships and the possible future insurance institution. |
| 8 | [Durable infrastructure and agent access](../development/AGENT_WORKFLOWS_MCP.md) | Define and implement authenticated workflow transport, synchronization, retries, cancellation, recovery and acceptance semantics across devices. Expose complete authorized workflows through MCP and other agent interfaces. |
| 9 | [Governance and launch readiness](../../GOVERNANCE.md) | Translate draft principles into accountable institutions, service responsibilities, sustainable economics and reviewed terms for a chosen pilot scope and jurisdiction. Complete independent security, privacy and release review. |
| 10 | [APK buildout](../../code/android/README.md) | Build out the existing Android APK into the complete phone experience: navigation, integrated participant workflows, native permissions and lifecycle, protected local storage, service connectivity and offline behavior. Validate device compatibility, packaging, signing, distribution and updates. |
| 11 | [Server side services](../development/REGISTRATION_PIPELINES.md#what-is-still-missing-and-why-it-matters) | Implement account/device sessions, enrollment and profile services, discovery and task coordination, notifications, authenticated evidence exchange, durable acceptance records, dispute and material-incident records, and collective participation/ballot/calculation records. Define service access controls, retention, backups, recovery, monitoring and deployment; integrate payment or coverage providers under separately agreed authority. |

## Boundaries between workstreams

### Participant journey, workflow, Android and hosting

Hero 3 defines participant actions, domain meaning, exact consent and the complete
Requester/Operator journey. Hero 10 implements that journey on Android, including
navigation, permissions, lifecycle, local storage, connectivity and updates.
Hero 8 defines operation identities, transport and agent interfaces, retries,
idempotency, synchronization, cancellation, recovery and acceptance semantics.
Hero 11 implements the selected hosted records, atomic transactions, exchange,
access enforcement and operating recovery. Shared protocol, policy and
verification logic remains in the existing Rust packages.

These responsibilities remain separate even when one feature needs all four
Heroes. A local component, development APK, browser store or preview server does
not establish an integrated participant service or a deployed backend.

### Identity, work privacy and permission to act

Hero 2 defines principal/key/device authority, enrollment, authentication,
delegation, recovery and account work/privacy policy. The
[identity validation note](legal/IDENTITY_VALIDATION_AND_LIABILITY.md) limits
public language: an ID photo and a face photo may be described as validating
an account, and must not be described as proof that a person is verified or
real unless an issuing body was actually checked. Hero 8 defines how scoped
grants, revocation, cancellation and observed shutdown are represented and
propagated. Hero 11 implements selected hosted authority and enforcement; Hero 10
implements native key, permission and sensor controls. Hero 1 owns reusable
attestation-tool hardening, generic sensor capture provenance and substitution
evaluation; Hero 2 owns enrolled-key and
face-authentication assurance requirements.

The shared grant interface must bind principal, device, operation, authoritative
account work-state revision, purpose, sensors, recipients, explicit consent and
validity. A deliberate authentication-camera exception is scoped to its initiating
device/operation and current revision; authentication or reconnect grants no work
resumption. Actual authority provenance, offline limits, conflicts, sign-out
invalidation and shutdown acknowledgments remain open design decisions.

Login or delegated account access does not itself authorize Contract signing,
settlement, union membership or ballot casting. Each domain defines those
additional permissions. Private registration/authentication media and member
records require their own access and lifecycle rules; evidence scrutiny or
insurance research grants no automatic access or reuse authority.

### Reusable tools, sensor evidence, lifecycle and failed attempts

Hero 1 defines reusable sensor and attestation tool boundaries, collector-specific
evidence and failure formats, quality policy, verification and physical assurance.
Hero 2 supplies identity/enrollment policy. Hero 10 owns app-wide lifecycle and
permission integration and invokes collector cleanup. Hero 8 exposes operation,
cancel, status and recovery semantics; Hero 11 retains and exchanges the selected
artifacts and records. Heroes 3, 5 and 7 define participant, dispute and
material-incident uses of those records.

Preserve the distinctions between a complete artifact, partial/failed collection,
unavailable or unassessable quality, signed/unsigned/absent reports and the original
request/policy context. Cleanup must distinguish confirmed shutdown, retained
ownership or failed cleanup, and unknown release. Cancellation acknowledgment or
lease expiry alone cannot prove that an unreachable device stopped. Integrity,
practical usability and responsibility for a failure are separate questions.

Any service distribution of navigation or attestation inputs remains conditional
on separately selected independent sources, freshness, provenance and verifier
trust policy. Hosting an input does not establish its authority.

### Action meanings, formation and durable records

Hero 3 defines Assignment formation and completion meanings, including the
first-version one-Assignment-per-Request rule. Hero 5 defines the consent, scope
and finality of supported settlement effects and case closure. Hero 8 defines
operation/retry/conflict/lookup behavior; Hero 11 implements any selected
authoritative coordination and record transactions.

The shared action vocabulary must distinguish evidence-ledger acceptance,
Assignment formation, exact proposal/Contract signatures, completion
acknowledgment, ballot authorization/admission, collective policy approval,
settlement effects, payment and case closure.
Storing or delivering a record establishes none of the other effects by itself.
Retry or lost-response lookup must preserve the original action and context,
without creating another signature, renewing a challenge or inventing closure.
Global formation concurrency, registry/ledger authority, replay scope, certificate
custody and expanded consequential agent permissions remain to be selected.

### Union participation and remuneration

Hero 6 defines membership/eligibility, qualifying work and approved-time inputs,
ballot authorization/admission/correction, effective collective policy and
reproducible remuneration calculations. Hero 3 composes the exact terms and policy
versions into participant review and signed Assignments. Hero 2 supplies the
selected identity/key assurance; Hero 8 supplies submission/retry/status semantics;
Hero 11 supplies access-controlled participation, ballot and calculation records.

Hero 5 develops the dispute procedure and defines the required authority for
consequences involving contested time, scope, cancellation and other contractual
claims. Preserve original claims,
approved/disputed inputs, authority references and policy versions so an input
correction is distinguishable from a new contractual effect. Evidence acceptance
or completion acknowledgment does not authorize a ballot or payment. Membership
methods, post-admission corrections and actual payment authority remain open.
Hero 9 owns the selected legal/accountable relationship between the union and
Non Verba; union participation rules do not supply default institutional voting
or launch authority.

### Disputes, material incidents and institutional responsibility

Hero 5 owns contractual claims, dispute procedure, exact settlement consent and
closure scope. Hero 7 owns Assignment-related significant harm, materiality,
immediate response, preservation, scoped disclosure, external assistance and
coverage requirements. Use shared evidence/case interfaces with domain-specific
views rather than duplicate case systems. Hero 3 owns participant presentation
and consent; Hero 8 owns generic workflow semantics; Hero 11 owns selected hosted
records and exchange. Urgent assistance and evidence preservation must not await
final incident classification. Coverage admission needs Hero 7's requirements,
Hero 3's pre-formation presentation and any selected Hero 11 enforcement.

Hero 7 owns insurance-specific risk, pricing and reserve research. Hero 9 owns
provider/resolver accountability, overall Non Verba economics, institutional
arrangements, independent review and actual adoption. Technical service outages
and security-event operations belong to Hero 11; Assignment material harm belongs
to Hero 7, with cross-references where both occur.

Notification delivery, reading, sufficient dispute notice, acknowledgment and
consent are distinct. Silent clock-out/sign-out behavior must be reconciled with
domain notice requirements without resuming sensing. Provider/resolver challenge
and accountability, operating commitments, pilot scope/jurisdiction, launch
authority and launch criteria remain unresolved; this ownership outline adopts
none of those arrangements. Institutional adoption does not itself grant a
participant's contractual consent or authorize a settlement/payment effect.

### Reasoning and cross-cutting assurance

Priors and reasoning research develops interpretation. Dispute procedure and
settlement defines who may authorize a consequence and under what consent. The
current analysis companion remains analysis only, with no financial authority;
its workflow milestone does not establish reliable reasoning or an adopted
settlement policy. Active priors work is inclusion and the counterfactual
reasoning engine on the current catalog. Corpus derivation stays deferred, and
these boundaries do not adopt a settlement policy or grant the engine authority.

Security, privacy, accessibility, usability and independent verification apply
across all workstreams.

Validation has distinct responsibilities:

| Hero | Validation responsibility |
| --- | --- |
| 1 | Reusable sensor/attestation-tool validation, physical measurement, evidence quality and independent requester assurance. |
| 2 | Identity/authentication assurance and work/privacy policy correctness. |
| 3 | Participant comprehension, exact consent and the integrated journey. |
| 5, 6, 7 | Their respective procedure, participation/calculation and incident/coverage requirements. |
| 8 | Workflow/agent software conformance, retry, cancellation and recovery semantics. |
| 10 | Android permissions, lifecycle, device behavior, accessibility and updates. |
| 11 | Hosted transactions, access enforcement, retention, backup and restore. |
| 9 | Independent review remit, institutional adoption and any agreed launch decision. |

Joint validation should identify the contributing Heroes and record each scoped
result without duplicating a completion claim or treating a component check as
end-to-end, physical, deployment or institutional acceptance.

## Dividing work into tasks

Group concrete outcomes as Goals under the appropriate Hero. Divide each Goal
into checkable Milestones with their own states, acceptance criteria and evidence.
Add owners and dependencies where useful. Work spanning Heroes should name one
primary Hero, the contributing Heroes, the interface/output each supplies, the
Milestones it depends on and the shared acceptance evidence.

Keep proposed Goals with empty Milestone lists until their steps are scoped. A
bounded end-to-end participant journey is the recommended next integration target;
its exact scenario, devices, authority, service scope and acceptance criteria have
not yet been selected. The boundary agreement does not start implementation or
assign priorities. Proposals to add, merge or reassign Heroes return to the parent
coordination session and the owner for discussion and decision.

Use proposed, ready, in progress, blocked or done for individual task status.
Completion is assessed against the task's agreed acceptance criteria, including
physical validation where required.

Return to the [notes index](README.md) or [all documentation](../README.md).

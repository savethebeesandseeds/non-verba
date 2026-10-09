# Authentication and work privacy requirements

Owner decisions agreed on 8 October 2026, with the selected Operator face encoder
added on 9 October 2026. This document records those decisions and the
implementation constraints needed to preserve them. Methods and policies listed
under open decisions are not selected. These are requirements for later app
integration. The isolated implementation below exercises them without providing
deployed account authentication, legal identity verification, account-wide sensor
shutdown or notification delivery.

The current app is a developer inspection surface. Keep quick access to its
existing functionality. Develop the components below independently and combine
them only when building the actual app is explicitly requested. This document
does not request that integration, a deployment or physical sensor collection.

Read alongside the [agent workflow requirements](AGENT_WORKFLOWS_MCP.md),
[security design record](../SECURITY_DESIGN_RECORD.md),
[sensor boundaries](../sensors/SECURITY.md) and
[participant roles](../notes/assignments/PARTICIPANT_NOTES.md#who-takes-each-role).

## Developer inspection implementation

The shared Rust core now contains independent
[authentication](../../code/crates/nonverba-core/src/authentication.rs) and
[work privacy](../../code/crates/nonverba-core/src/work_privacy.rs) policy modules,
plus a separate [Operator face policy](../../code/crates/nonverba-core/src/face_identity.rs).
JSON/WASM operations create and transition authentication workflows, assess reuse,
transition work state, assess sensor access, enroll a face reference and compare
face features. Genuine authentication and
deployed account protection remain false in every result. Simulated success is
usable only when the inspection requirement explicitly permits simulation.

The [browser inspection entry](../../web/src/authentication-privacy.html) uses
these policies through the existing Rust Worker. Its independent workflow and
privacy controller own cancellation, local resource cleanup, lease expiry,
callback fencing and simulated linked devices. Synthetic profiles and notification
dispositions exercise the agreed behavior without a discovery or push service.
Inspection work state is retained locally; active operations and sensor grants
are never restored on reload.

Synthetic capture is the default and supplies no face image or genuine face
result. An optional browser photo adapter implements the explicitly started
camera sequence: camera only, a disclosed illustrative 30-second bound and no
upload or export. Capture closes the camera before local inference; new checks,
cancellation, work stops and lifecycle loss discard transient media and features.

The selected Operator adapter performs local face detection, alignment and
128-dimensional MobileFaceNet feature comparison. It requires an intentionally
retained, account-bound reference from the separate Operator registration step.
That reference is encrypted in device-local browser storage and has explicit
replacement and deletion actions; transient cleanup does not delete it.
Requester paths instantiate no face model or face store. The default comparison
threshold is unset, calibration is unresolved, and neither a match nor enrollment
establishes legal identity, liveness, trusted capture or genuine authentication.
See [Operator face implementation and limits](OPERATOR_FACE_PIPELINE.md).

These inspection pages are browser-only; their navigation links are omitted in
the native developer app and they invoke no native sensor bridge. The local model
runtime is excluded from native staging.

Thirty-second sensor leases and five-minute authentication validity are fixtures,
not selected production policies. Multi-device coordination is simulated within
the inspection controller; it does not block other developer tools or real
linked phones. Existing tools remain directly accessible.

Run focused checks inside the managed container through the documented snapshot
launcher: `node --run test:authentication-privacy` for Rust policy and adapter
checks, or `node --run test:browser:authentication-privacy` for a web build and
compiled-WASM browser checks. The latter uses the existing Playwright installation
via `NONVERBA_PLAYWRIGHT_PATH` and `PLAYWRIGHT_BROWSERS_PATH`, as documented in the
[development guide](../../README.md#development). Automated camera checks use
synthetic streams rather than physical sensors.
The additional `node --run test:operator-face` and
`node --run test:browser:operator-face` commands cover the selected face
components. Missing local model assets remain an explicit unavailable state.

## Purpose and separate concepts

An Operator must be able to end work and trust that Non-verba has stopped using
their device's sensors. The protected state needs actual enforcement and truthful
confirmation. It must support returning to private life without disappearing
from searches. Requesters receive the same sensor privacy boundary.

| Concept | Meaning and boundary |
| --- | --- |
| Account authentication | Establish who is using the account at login or another required check. |
| Registration identity verification | Establish the identity behind the account during registration. Keep its evidence, decisions and lifecycle separate from recurring authentication. |
| Authorization | Permit a particular action, role or delegated operation. Account authentication alone does not establish contractual signing authority. |
| Work state | Express whether the account is available, on hold or clocked out. Availability alone never permits sensing. |
| Sensor consent | Authorize particular sensors for a bounded purpose, operation and recipient. An OS permission alone does not supply this consent. |

Signing keys, device enrollment and hardware attestation are separate inputs;
none alone proves that the expected person is using the account now.

Operator and Requester registration has a separate
[local draft pipeline and account-services roadmap](REGISTRATION_PIPELINES.md).
Preparing its record does not satisfy authentication, establish verified identity
or change work state. Its accessibility details and certifications remain private
and self-reported under explicit future sharing preferences.

Keep authentication sessions and the shared work/privacy state as separate axes.
An authenticated session can coexist with hold or clock-out. Session renewal or
another device logging in must not change that shared state. Sign-out requests
the account-wide sensor block even if other devices still have login sessions;
the exact session-invalidation policy remains open.

## Reusable authentication pipeline

Provide one reusable workflow with two explicit modes: **Operator** and
**Requester**. They serve the same authentication purpose but have different
steps and requirements. Do not silently treat a Requester result as sufficient
for an Operator requirement.

The workflow can be invoked at login, clock-in or before a task that requires
authentication. Do not hard-code authentication for every task or impose a daily
check merely because daily authentication was discussed. Avoid unnecessary
interruptions: reuse a still-valid authentication result where the applicable
policy permits it; a task can require a fresh check before starting.

Keep the caller's context, required mode, policy and result explicit. A task
requiring authentication cannot proceed merely because its capture step
completed. Authentication completion does not automatically accept a task,
resume work or authorize any work sensor.

Bind a validated result to the intended account/principal, mode, applicable
policy, completion time, validity and allowed reuse scope. Device, session and
task restrictions must be explicit where required by that policy. An account
login result can serve multiple tasks if its scope and their policies permit;
a task-bound result is not automatically reusable elsewhere. Revoked results,
caller-supplied timestamps and imported claims cannot satisfy a requirement
without the policy's validation. Do not choose validity periods or trust a
photo's metadata as authoritative authentication time in this phase.

Keep capture completion, validation pending/unimplemented, validated success,
denial, cancellation, expiry and failure distinguishable. Simulated results carry
an explicit simulation marker through every caller and cannot become genuine
validated success merely because an adapter removes a UI label.

### Operator mode

The selected isolated Operator check captures a fresh photo, extracts features
with the pinned Qualcomm/foamliu MobileFaceNet 128D pipeline and compares them
with the current enrolled account reference. Enrollment establishes continuity
with the person captured at registration; it does not establish that person's
claimed legal identity. Missing enrollment, unavailable inference, bad acquisition
and incompatible model versions remain distinct failure or pending states.

Keep account credentials, face comparison, liveness and capture integrity as
separate inputs. Liveness, face movement analysis and trusted capture remain
unresolved. The comparison threshold is an optional evaluation input with no
selected production default. Report **Face comparison performed; liveness and
trusted capture unresolved**, alongside the actual comparison outcome. Never
equate photo capture, an embedding match or a simulated verdict with validated
authentication. A future video or movement flow needs its own explicit policy
and evaluation.

### Requester mode

Provide its own configurable steps and result requirements. Its concrete
authentication method is not selected. Requester registration and authentication
have no face capture, enrollment, comparison or liveness requirement. They do
not instantiate the Operator face model or local biometric store.

Both modes remain distinct from registration identity verification. Deciding how
recurring checks reference a verified registration identity is future work.

## Work state, notifications and discovery

**On hold** pauses work while notifications continue. **Clock out** ends the
working day with silent notifications. Keep **Sign out** as a separate action
that closes an account session; clocking out need not prevent reviewing messages,
records or account controls while signed in.

| State or action | Sensor boundary | Notifications | Published profile in searches |
| --- | --- | --- | --- |
| Clocked in / available | No sensing merely from availability; work sessions require explicit scoped authorization. | Normal | Remains visible |
| On hold | All app sensor access blocked account-wide, except explicit authentication camera use below. | Continue under the user's existing notification settings | Remains visible |
| Clocked out | All app sensor access blocked account-wide, except explicit authentication camera use below. | Silent | Remains visible |
| Signed out | All app sensor access blocked account-wide, except explicit authentication camera use below; account access requires authentication. | Silent | Remains visible |

The only sensor exception in a stopped state is the explicitly started,
temporary authentication camera workflow described below. Silent notifications
must not generate audible or vibrating work alerts; delivery, badges and inbox
presentation still need definition.

Search must use deliberately published profile information. It must not activate
sensors or query the device for fresh location merely to keep the profile
discoverable. Public presence indicators and availability disclosure are separate
open decisions. Hold, clock-out and sign-out do not delete the profile. Facial
authentication media and validation details are not public profile content and
must not be exposed through search, task evidence or ordinary requester access.

## Temporary authentication camera workflow

The same deliberate camera restrictions apply at login, clock-in, task-start
checks and the isolated Operator registration enrollment step. Registration uses
the same bounded camera authority and does not grant a broader sensor exception.
When entered from hold, clock-out or sign-out, use this sequence:

1. Present the authentication requirement without opening a sensor. A task,
   notification or remote agent may request a check but cannot start the camera.
2. The Operator deliberately selects **Start authentication**. Explain the
   camera purpose and the intended handling of the captured media.
3. Enter a temporary authentication operation on the initiating device. Permit
   only the camera required by this operation. Microphone, location, other
   sensors and work collection remain blocked. Other devices receive no sensor
   exception.
4. Capture only within the operation's explicit limits. Face movement does not
   authorize motion-sensor collection. Do not use an evidence preset that
   silently adds GPS metadata, location collection or requester media transport.
5. Close the camera and revoke its temporary app authorization when capture completes
   or the operation is cancelled, interrupted, expired or fails. Validation may
   continue without keeping the camera open. Late callbacks cannot reopen it.
6. Report capture and validation outcomes separately. Failure or cancellation
   leaves the original protected state in place. Success also leaves work stopped
   until the user deliberately resumes it.

Authentication is an operation, not a replacement for the account's persistent
work state. A clock-in action can call this pipeline and, after satisfying its
policy, complete the user's explicit request to resume work; the pipeline itself
does not perform that transition. An authentication-only action cannot clock in.
Any combined clock-in flow must make the requested resumption explicit and
recheck the latest shared state before completing it. A newer hold, clock-out or
sign-out invalidates an older pending resumption; a late validation result must
not undo it. An otherwise reusable authentication result does not itself override
that privacy decision.

Restart or reconnection never resumes capture without a new deliberate action.
A new hold, clock-out or sign-out action cancels an active authentication camera
exception. An expiry or revocation of that exception must stop an already open
camera, not merely refuse the next capture. Its media purpose, recipients and
retention must remain explicit. The inspection policy permits local inference,
discards the photograph and requires a separate deliberate review and consent to
retain an encrypted local feature reference. It permits no biometric upload.
Product recipients, retention periods, recovery and deletion across devices still
need definition before actual-app integration.

For a check requested while already clocked in, keep the pending task blocked
until its authentication requirement is met. Do not silently borrow an existing
work camera stream or interrupt unrelated tasks to obtain facial media; the
concurrent-task policy remains open.

## Enforcing the account-wide privacy boundary

The intended block covers every linked device and every app entry path, including
future agent/MCP access. Enforce it at the controller that can activate the
sensor, including native acquisition, rather than only by disabling a UI button.

- Stop active collection and prevent new sensor access, including previews,
  preparation, GPS warm-up, calibration and diagnostics. A work request, existing
  OS permission or previously issued grant cannot override a stopped state.
- Revoke operation authority so queued callbacks, retries, workers and late
  asynchronous results cannot continue collection or revive a cancelled session.
  Confirm that sensor resources have actually stopped before declaring shutdown
  complete. Expose pending cleanup or failure truthfully.
- Persist the privacy decision. Login, successful authentication, navigation,
  restart, reconnection, incoming requests and notification handling cannot
  silently restore app sensor access. Clocking back in does not revive cancelled
  operations or old grants; subsequent work sensing requires new operation
  authority under the current state and applicable task consent.
- Propagate and reconcile the shared decision across linked devices. Define
  authorization validity and offline behavior before integrating the actual app.
  Set a bounded validity for ongoing collection authority, enforced locally;
  missing renewal or lost control connectivity must terminate collection within
  the selected bound. Apply expiry to active operations, not only new starts.
  The duration and transport are open decisions. Refuse new work sensing when
  authority is absent, expired or unknown, including at startup.
- Distinguish the requested account state from confirmed device shutdown. Do not
  claim that every device has stopped while an unreachable device's state is
  unknown or cleanup has failed. Stop the initiating device locally without
  waiting for propagation; show the remaining devices as pending or unconfirmed.
  Expiry alone is not an observed remote shutdown acknowledgment. Account-wide
  shutdown timing and confirmation remain an integration requirement, not a
  capability of the current local developer app.
- Restrict state changes to the account's authorized controller. Search traffic,
  Requesters, remote task content and notification handlers cannot clock an
  Operator in. Reject stale resume commands; unresolved conflicting state keeps
  work sensor access blocked until a new authorized decision resolves it.

Stopping sensors is separate from retaining or delivering data already captured.
Do not imply that clock-out deletes previously shared evidence or automatically
authorizes new delivery. Define unfinished capture/upload handling before
integration, without restarting sensors. Preserve assignment records and accrued
rights; permission to stop sensing is not conditional on settling an assignment.

## Isolated development instructions

Develop independent components for recurring authentication, work state and
notification policy, and sensor-access enforcement. Define a separate boundary
for registration identity verification; this phase does not select or require
implementing that verification process. Use explicit interfaces so future UI,
task and agent adapters can call the same policy. Follow the existing Rust core /
platform adapter responsibilities.

Give each component a separate developer inspection surface or harness. Permit
synthetic accounts, simulated validators and simulated multi-device coordination,
with visible simulation labels. They cannot issue real authentication claims or
establish account-wide protection. Use synthetic media by default. The optional
local photo adapter and deliberate encrypted reference retention have the limited
inspection scope above; remote validation, central storage, other recipients and
collection outside that scope require separately defined handling before
implementation.

Do not add login, facial capture, registration or clock-in prerequisites to the
current developer app. Preserve its direct functionality inspection and existing
sensor/lifecycle gates. Prototype a privacy controller through a deliberately
selected inspection workflow; do not present it as a global account control when
the developer app's other paths have not been integrated with it.

Keep simulated authentication out of the future actual app's security decisions.
Combine these components with discovery, task orchestration, notification delivery
and all sensor paths only in a separately requested actual-app integration.
All implementation builds and tests stay inside the documented managed Linux
container. This document requires no build, APK or physical-device operation.

## Future validation requirements

When each component is implemented, validate its behavior independently:

- Both authentication modes can be invoked from different callers; task policy
  distinguishes reusable authentication from a required fresh check. Missing,
  expired, revoked, wrong-account, wrong-mode, out-of-scope and simulated results
  cannot satisfy real requirements. Removing a display label cannot turn a
  simulated result into genuine success. A policy allowing reuse accepts the
  same valid result for multiple eligible tasks without another capture.
- Operator capture completion remains distinct from validation. Cancellation,
  lifecycle loss, failure and expiry close the camera, and late results cannot
  enable work. The authentication path activates no microphone, GPS or other
  sensor.
- Hold, clock-out and sign-out stop active sensor operations and block every
  integrated start path. An explicit authentication camera exception is bounded
  to its initiating operation and device; cancelling, expiring or revoking it
  stops its active camera and removes the exception. Authentication-only success
  does not clock in. A late result or older clock-in command cannot undo a newer
  stop decision; resuming work does not resurrect cancelled sensor sessions.
- Multi-device simulations exercise propagation, disconnection, stale grants,
  acknowledgment loss, cleanup failure, reconnect, restart and conflicting state
  changes. Active collectors stop when local authority expires, and unknown
  authority blocks new starts. Report uncertain shutdown rather than a false
  global confirmation. A remote request cannot resume work or activate
  authentication capture without the required deliberate action.
- Hold preserves normal notifications, while clock-out and sign-out suppress
  sound/vibration. Profiles remain discoverable without sensor acquisition or
  disclosure of facial authentication media.
- The current developer app remains directly accessible. Future actual-app
  assembly must separately prove that every sensor path uses the common boundary.

Software simulations establish component behavior, not physical sensor shutdown,
facial identity, liveness or deployed account-wide protection. Record those limits.

## Decisions still open before actual-app integration

- Requester authentication method; Operator production capture policy, calibrated
  comparison threshold, liveness and trusted capture validation.
- Authentication validity, daily/clock-in policy if any, task freshness rules,
  recovery and reference binding to registration identity verification.
- Account/device session invalidation on sign-out; shared state transport,
  offline limits, shutdown timing, acknowledgments and conflict handling.
- Product facial media recipients, protected account storage, retention periods,
  deletion, recovery and validation privacy beyond this local inspection store.
- Notification inbox/badge behavior and any public availability indicators.
- Interrupted task/evidence handling and authentication during concurrent tasks.
- Authentication and delegated authority for organizations, teams, software agents
  or robots; the human facial workflow does not define these cases.

Resolve these without making operators repeat checks unnecessarily or weakening
the deliberate, enforceable boundary between work and private life.

# First account and identity-enrollment slice

Owner direction recorded 21 October 2026 through Hero 10. This is the bounded
implementation handoff, not a record of a functioning integrated application.
The owner requests email/password account entry and deliberate identity-document
and guided face-picture enrollment with selected persistence. Implementation and
checks use synthetic contacts, documents and media. No real participant data has
been supplied or authorized for this development slice.

Hero 10 owns the participant application's shared browser/APK screens,
navigation, packaging, native permissions, capture/file selection and protected
platform storage. Hero 2 owns the shared identity requirements, policy/component
contract and assurance/data-lifecycle distinctions. Hero 11 owns credential
handling, private service implementation and selected hosted custody. Hero 8
owns operation/grant/retry semantics. This handoff changes none of those owners.
The participant shell's network/camera/file/storage capabilities and runtime
budget need Hero 10's explicit integration work; this document does not weaken
its existing guards or add runtime assets.

## Existing capability and actual gaps

Read the [account lifecycle checkpoint](SERVICE_ACCOUNT_LIFECYCLE_CHECKPOINT.md)
and [participant records checkpoint](SERVICE_PARTICIPANT_RECORDS_CHECKPOINT.md),
plus the newer [email sign-in/current-context checkpoint](SERVICE_SIGNIN_CONTEXT_CHECKPOINT.md).
They establish local synthetic HTTP acceptance, not production verification.

- Enrollment already accepts a password and one normalized email account can
  declare both roles. IDs are opaque service-issued account/principal values.
  Confirmation is separate from identity assurance and role/signing permission.
- The development OIDC login now accepts exactly one email or legacy opaque
  username selector within the existing authorization-code/S256 PKCE flow.
  Email resolution stays inside the credential boundary, against the confirmed
  local account/issuer/subject binding. It performs no provider linking, alias
  folding, email lookup or password grant. Hx11 reports completed local validation;
  this does not establish application connectivity or actual contact delivery.
- Authorization-code/PKCE login, renewal, session/device revocation, work-state
  retention and bounded lost-device recovery exist locally. Confirmation uses a
  privileged synthetic outbox, not actual mailbox delivery. Recovery currently
  requires a single-use recovery code plus a separate contact challenge.
- Private per-role registration revisions, exact notice acknowledgments and
  explicit limited profile publication exist locally. They authorize no document,
  photograph or face-feature upload. Their retained history/backups are not an
  implemented real-data deletion policy.
- The participant UI is not connected to these capabilities. Identity-media
  custody, submission/status/decision APIs and a trustworthy identity validator
  are not established by either checkpoint.

## Account entry in the first slice

Provide email/password registration, confirmation/pending status, sign-in,
sign-out and recovery entry. Keep the surface small: no other login methods or
apparently functioning provider buttons. Google, X and Apple are future linking
directions only. Preserve the internal account/principal IDs and explicit
issuer/subject bindings; matching email text never silently links or merges
accounts. A document submission, face picture or confirmed email is not a
provider binding or a verified-identity decision.

Account creation precedes identity validation. One onboarding journey may join
the stages, but identity evidence must bind to an already-created account, never
a role label, identity display flag or a merely pending enrollment operation.
The current service requires confirmation before account creation and confirmed
login for private participant APIs; preserve that dependency unless Hero 11's
contract explicitly changes. Obtain current account/principal authority before
retaining/submitting identity evidence. The current disconnected application's
warnings, Settings > Account > Create account entry and account-first sequence
are navigation work, not credential submission, account readiness or retention.

The app passes credentials only to the selected credential boundary. Passwords
are transient input, never part of a draft, persisted envelope, analytics, URL,
log, retry queue or identity-media record. Clear app-owned input/references on
completion, cancellation and navigation; do not claim secure memory erasure.
Password validation must reflect the service's versioned contract (the present
synthetic contract accepts 16-1024 UTF-8 bytes), not a second client policy.
Passwords are hashed/verified by the backend, not by a UI flag or local account
list. Session proof comes from current service responses and protected session
handling. The existing development issuer uses authorization-code + PKCE, not a
password token grant. Hero 10 and Hero 11 must agree browser/APK callback,
origin, transport and token-storage handling before connecting it.

Reuse these existing API capabilities against Hero 11's current versioned
OpenAPI; this list is an integration map, not a new endpoint implementation:

| Capability | Existing boundary and required treatment |
| --- | --- |
| Register/confirm | `POST /v1/accounts/enrollments`, `/status`, `/confirm`; reviewed revision, deliberate action, original operation ID/secret and exact retry inputs. Pending is neither delivery nor confirmation. |
| Login/renew | Development issuer discovery, `/dev-oidc/authorize` and `/dev-oidc/token`; exactly one email or legacy username selector, existing PKCE/state/CSRF/cookie/origin checks and registered callbacks. No password grant or client email lookup. |
| Current account/session | Prefer `GET /v1/account/context`: flat current account/principal, declared roles, recovery generation, work state and presented-session context in one authenticated snapshot. It accepts initial unbound login and avoids inventory-cap inference. |
| Sign out | `DELETE /v1/auth/session` accepts an unbound login and revokes that session while persisting signed-out work for controlling accounts. `/dev-oidc/revoke` and `/v1/account/sessions/revoke` revoke authority without changing work state; they are not equivalent sign-out. Failed/offline requests are unconfirmed, not successful sign-out. |
| Recover/reset | `POST /v1/accounts/recovery/start`, `/status`, `/finish`; preserve the current recovery-code-plus-contact contract. No email-only reset is selected. Generic start/status errors must not become account-existence lookups. |
| Private role records | `/v1/participant/notices`, `/v1/participant/records` and role/history/operation reads; use exact current notices and server revisions. These records are not a media store. |

Recovery rotates credentials and revokes prior sessions/key authority; replacement
signing keys still need separate approval. It preserves attributed history and
does not recover a lost private key, verify identity or resume work. A reset UI
must expose the currently supported recovery factors, unavailable/expired states
and incomplete delivery honestly. An email-only forgotten-password flow needs an
explicit policy decision and service work; do not silently weaken recovery.

## Deliberate document and face-picture enrollment

1. Resolve the current authenticated account/principal and selected declared
   role. A synthetic fixture binding must remain explicitly synthetic and cannot
   stand in for a service-authenticated account.
2. Explain the purpose, selected storage destination, recipients and exact items
   to retain. Obtain processing consent separately from retention consent.
3. Select an identity-document image or deliberately start an authorized
   document-camera operation. The bounded first contract selects one front image;
   additional pages/sides require an explicit later scope. Review, replace or
   remove the selected image. Never open a sensor merely by entering the screen.
4. Show up/down/side visual guidance and return to a frontal capture position.
   Retain one deliberately captured frontal still after review. Display
   `movement_check: not_performed` and `liveness: not_evaluated`; an animation
   finishing is not a successfully checked challenge. An accessibility skip or
   interrupted sequence cannot secretly become a passed check.
5. Review the exact selected images, binding, notice versions, destination and
   retention choices. Retake/edit invalidates review. Submit only that reviewed
   revision after a separate deliberate action. Cancel closes resources and
   discards transient/uncommitted selections; it does not silently erase an
   earlier retained or submitted record.
6. Display the acknowledged submission/status and any actual decision with its
   scope. If no authorized validator exists, state that verification is pending
   and not configured; do not imply an active human review or fabricate approval.

No OCR, document authenticity check, face/document comparison, embedding
generation, movement video or movement-frame retention is included. The existing
Operator 128D feature-reference store is a different component with separate
consent, model binding and recovery limits. Never use an old feature reference as
the requested photograph, or enroll a new reference merely because a photograph
was retained. No model download or added face-runtime budget is required for this
capture/review contract.

Requester reconciliation is explicit: the earlier inspection and recurring
Requester authentication have no face-model/reference requirement. The new
picture is initial identity-enrollment evidence, not recurring authentication.
The policy must support either role, but whether initial document/face submission
is required for Requesters, Operators or both remains an owner decision. Until
then the synthetic demonstrator may exercise both role branches without making
either a condition of real account creation, sign-in or task access. Requester
picture handling must not instantiate the Operator biometric model/store.

Camera authority is purpose/device/operation/revision bound, camera-only, starts
deliberately and expires within the selected bound. Capture must stop the camera
before review, inference or transfer; cancellation, lifecycle loss and a newer
stop decision fence late results. Report failed/unknown cleanup honestly. No
audio, location, work grant, task acceptance or signing authority accompanies it.
The 30-second inspection lease is a fixture, not a production selection.
Document capture must not be relabeled authentication to inherit the existing
stopped-state exception. Existing stopped rules remain in force unless a new
enrollment exception is explicitly selected; file selection can remain available
without clocking in. Extending an enrollment camera exception, including to a
Requester picture, requires an explicit policy decision, not a screen flag.

## Selected retention contract and unresolved real-data custody

The immediately buildable storage adapter is **synthetic-only** and explicitly
names its destination. Local fixture persistence demonstrates reload/review and
does not claim a hosted submission, an account vault or cross-device recovery.
The service path requires Hero 11's separately agreed media capability. Do not
send images or unsupported fields to participant-record/evidence endpoints.

| Data | Retain in the selected synthetic enrollment envelope | Custody and lifecycle |
| --- | --- | --- |
| Document image | Only the explicitly selected front image, encoded type, byte length, digest, client acquisition source and current item revision | Private account-scoped fixture store; no public URL, discovery, counterparty or ordinary task-evidence access. Real custodian/recipients remain unselected. |
| Frontal photograph | Only the reviewed frontal still with the same metadata and binding | Separate from the existing local 128D reference. No movement frames, video, microphone data or automatic derived features. |
| Extracted fields | None automatically | Existing deliberately supplied registration details remain their own private per-role record. OCR/document numbers are outside this slice; adding them needs an itemized purpose/retention decision. |
| Consent/notices | Exact synthetic notice ID/version/text digest and text snapshot, purpose, selected items/digests, destination/recipients, processing and retention actions, actor/binding and reviewed revision | Bound to the actual operation; no inherited inspection acknowledgment or prechecked general consent. Synthetic notices are not adopted product terms. |
| Status/receipts | Attempt/revision, operation ID, immutable submission digest/receipt, authoritative status scope, pending reason and an actual decision record if supplied | Keep historical submission distinct from current status, publication, authentication and permissions. No password, access/refresh token, recovery factor or raw image in a status/log record. |
| Existing face features | No copy, upload or implicit new enrollment | Existing store retains its own explicit replace/delete semantics; this flow does not alter it. |

Transient selections live only until review/retention/cancel. Persist only items
with explicit retention consent; do not save every retake. Remove object URLs,
capture handles and obsolete uncommitted media on replacement/cancel. Resetting a
form is separate from deliberately deleting an already committed fixture record.
The local adapter must expose deletion success/failure; on sign-out it must close
access and clear transient media, never promise that logout erases submitted data.
Use account/principal namespaces and current authorization on reopen; account
switching cannot reveal another account's media. Browser-origin encryption can
reuse the existing local pattern but its key shares the origin trust boundary;
it is neither a protected backend vault nor an Android storage decision.

For real data, select the custodian and any reviewer, least-purpose access,
retention/expiry, correction and deletion of originals/derived copies, backup
expiry/restore suppression, and lost-device/account recovery before enabling
retention or upload. An account recovery receipt is not a biometric decryption
key or authorization to expose former media to a replacement device. A deletion
request, denied future access, deleted current object and completed deletion from
backups/shared copies are distinct states. No indefinite retention, immediate
erasure guarantee, central biometric store or production backup method is chosen
here. Existing backend role-record history must not be described as deletable
merely because a draft can be cancelled.

## Reusable component and service seams

The synthetic shared component below now implements fixture orchestration. Real
service, camera and protected-storage seams remain integration contracts:

| Seam | Inputs and results |
| --- | --- |
| Account/session adapter (Hx10/Hx11) | Register/confirm/sign-in/current/sign-out/recover through versioned services; explicit pending/expired/refused/unknown results. Only service proof establishes current authentication. |
| Enrollment policy/workflow (Hx02) | Current account/principal/role, session/recovery generation, operation/device, work-state revision, selected item descriptors, notice/consent snapshots and monotonically increasing draft revision. Commands: select/remove, review, retake, cancel, retain, submit and inspect status. Edits or binding/notice changes invalidate review; stale callbacks cannot resurrect it. |
| Capture adapter (Hx10) | Explicit authorized camera-only operation or deliberate file selection; return exact media/metadata and honest cleanup outcome. Guidance state carries no liveness verdict. No UI/Android implementation moves to Hx02. |
| Storage adapter (Hx10/Hx11) | Commit/read/delete selected private records with binding, expected revision and cancellation. Return the actual custody scope and receipt; a local fixture receipt cannot masquerade as a hosted receipt. |
| Submission/status adapter (Hx11 with Hx08 semantics) | Exact immutable reviewed envelope plus operation/idempotency context; private media transfer, commit/status lookup and later scoped decision. Endpoint names, upload bounds, object access and validator authority remain service work, not invented routes. |

The logical envelope is versioned and binds account/principal, role, operation,
device, session/recovery generation and expected work-state revision to selected
media digests/length/types, review revision and exact consent/notice records.
Sensitive bytes travel through the selected private media adapter; metadata
alone cannot imply a stored object. The server must independently enforce the
account and revision binding, content/size limits, access and permitted changes.
Caller-supplied IDs or timestamps establish neither authority nor trusted time.

Keep `incomplete`, `reviewed`, `submitting`, `submitted`, `pending`, `decision`,
`cancelled`, `failed` and `submission_unknown` distinguishable. `submitted`
requires an exact durable receipt in its stated custody scope; `pending` requires
an explicit reason, not inferred queue admission. A lost response is
`submission_unknown` until original-operation lookup resolves it. Same operation
and bytes return the original receipt; changed bytes conflict, not overwrite.
Cancellation after a possibly committed submit requires status lookup and a
separate deletion/withdrawal action, never an assurance that nothing was stored.
A replacement creates a new reviewed attempt and preserves prior attribution.

A decision contains outcome, authority/validator, policy/version, evidence
revision/digests, scope, time provenance and reason. Without a selected and
authenticated validator, the real decision remains absent. Synthetic decision
fixtures remain marked synthetic and cannot set genuine identity/authentication
or permission flags. Neither successful capture, a photograph, an embedding
match, submitted/pending state nor an asserted client approval grants verified
identity, liveness, task acceptance, signing, clock-in or work/sensor resumption.

Hero 11 coordination requirements are therefore: consume the finalized email
credential and current-context interfaces; agree registered browser/APK login
callbacks and secure session/sign-out composition;
explicit confirmation delivery and recovery-factor behavior; and a separately
authorized private media/notice/receipt/status lifecycle with limits, exact retry,
conflict, cancellation/unknown-commit handling, access/deletion and restore
semantics. Do not reuse evidence acceptance as identity approval or general
participant revisions as an undocumented media store. This document does not
authorize editing the backend or sending other sessions messages.

## Work that can proceed and decisions still needed

Hero 2 has implemented the synthetic shared workflow described below. Hero 10
has validated the sample account/enrollment screens and their composition with
this workflow, using memory-only synthetic accounts and bundled illustrations.
That application remains disconnected from the account service. Connecting the
real service/session adapter, selecting real-data custody and implementing
identity verification remain separate scope; a completed sample journey is not
a genuine service login or an identity verdict.

The smallest owner decisions before widening that scope are:

1. **Role and stopped-camera rule:** who must supply initial document/face
   evidence, when it becomes required, and whether an explicit enrollment camera
   exception is allowed while work is stopped. This does not introduce recurring
   Requester face authentication.
2. **Real-data custody and decision authority:** who stores/sees the selected
   document/photo, retention/deletion/backup/recovery treatment, applicable notices
   and who may make what identity decision. Capture can remain functional and
   verification pending without choosing a provider or reviewer now.
3. **Account recovery/delivery:** retain the existing recovery-code-plus-contact
   policy for the first connected release or explicitly select a different
   forgotten-password policy; select actual confirmation delivery before using
   real mailboxes. No email-only reset or delivery provider is selected here.

Service API/callback/adapter choices must be agreed by Hx10/Hx11; they do not
require adding more owner login methods. Future Google/X/Apple work must define
explicit linking, collision, unlinking and recovery consent against stable
issuer/subject bindings before any provider appears functional.

Proposed evidence for the implementation handoff: synthetic account registration,
email-login success/refusal, confirmation pending/expiry, sign-out and existing
recovery; both role branches; explicit camera/file starts and stopped-state
denial; review invalidation/retake/cancel/late replies; reload of only selected
retained items; account isolation; wrong/stale authority and unknown submit;
exact receipt retry/conflict; deletion failure; and absence of all forbidden
assurance/permission claims. Component, browser, native, hosted and real-person
results must be recorded separately. Run project checks only inside the existing
managed Debian environment. No APK build, phone operation, real-data collection,
provider integration or deployment is performed by this handoff.

## Shared synthetic workflow implemented - 21 October 2026

The [shared module](../../code/test/fixtures/identity/synthetic-enrollment-workflow.js)
exports `SyntheticEnrollmentWorkflow`, `createSyntheticEnrollmentStore`,
`SYNTHETIC_ENROLLMENT_MEDIA`, `SYNTHETIC_ENROLLMENT_NOTICE` and
`ENROLLMENT_GUIDANCE`. It is a small DOM-independent orchestration adapter with
no new dependency, cryptographic protocol or identity-verification engine. The
existing Rust registration/face policies and Operator reference store are unchanged.

Construct the workflow with `{getAccount, store, onChange}`. The trusted
`getAccount({signal, expected})` adapter must resolve/revalidate current
authenticated authority; it must not return the participant UI's display flags,
a cached enrollment/recovery receipt or caller-authored account identifiers.
Hx10 and Hx11 reviewed the following mapping. The final single-context endpoint
supersedes the initial two-read fallback for future connected adapters:

- Use authenticated `GET /v1/account/context` for `account_id`, `principal_id`,
  `confirmed`, `roles: ["R", "O"]` and `recovery_generation`. The workflow selects
  only a declared role, maps R/O to requester/operator and rejects unsafe
  JavaScript recovery-generation numbers instead of rounding them.
- The response already supplies flat `current_session_id` and
  `session_active:true`, plus `session` metadata about the presented access
  credential. Feed those fields to `getAccount` without inventing a generation
  or deriving authority from inventory. The authenticated request must succeed;
  handle 401 as unavailable/expired/revoked authority and typed 409
  `account_context_counter_out_of_range` without rounding/clamping counters.
- The response is point-in-time authority, not a continuing lease. Keep the
  workflow's before/after revalidation and abort fences. A previously unbound
  token remains unbound after a stored-session upgrade until an appropriate new
  credential is obtained. `identity_verification` remains `pending`; declared
  roles, contact confirmation and `can_control_work` do not authorize Contract
  signing, sensing or work resumption. Legacy inventory APIs remain compatible,
  but a missing current item in their capped result must never mint authority.
- The initial login may be unbound. Do not require `GET /v1/auth/session`, which
  is stricter and requires an approved device/key binding. Declared account roles
  are separate from a session's signing role. Descriptive scope text is not an
  authorization capability. Account/session/generation changes invalidate the
  live review and fence late responses.

`createSyntheticEnrollmentStore(storage)` takes explicitly supplied
`getItem`/`setItem`/`removeItem` string storage. It opens no global storage,
network, existing origin database or native vault. It persists the selected
fixed illustrations and exact synthetic notice/review bytes, not arbitrary
uploaded media. These fixture strings are not encrypted: this is deliberately
not a real identity-media store. Both roles can exercise the same state flow
without introducing a real role requirement or Requester face model.

| Workflow call | Scoped result |
| --- | --- |
| `begin(role)` / `restore(role)` | Resolve current account/session and isolate selections by account/principal/role/recovery generation. Reopened unsubmitted selections require fresh review. |
| `setConsent({processing, retention})`, `select(kind, fixtureId)` | Separate explicit choices; only the four bundled synthetic document/face illustrations are accepted. A caller's synthetic label cannot admit arbitrary bytes. |
| `review({deliberate:true})` | Bind the exact selected images, notice, consents, account and revision; retakes/edits invalidate review. |
| `retain({deliberate:true})` | Save only that reviewed selection; an expected retained digest rejects replacing a known newer selection. |
| `submit({deliberate:true})`, `refreshStatus()` | Return explicit local-fixture receipt/status. Lost/late results remain `submission_unknown` until original-operation lookup resolves them. Exact replay preserves the receipt; changed bytes conflict. Verification stays pending and unconfigured. |
| `cancel()` / `deleteRetained({deliberate:true})` | Cancel transient work without erasing committed data. Explicit deletion checks the known retained digest; media-free historical fixture receipts remain. Storage failure is an error, not successful deletion. |
| `snapshot()` / `preview(kind)` | Snapshot/callback contains descriptors, revision, scope, account blocker and receipt, without raw media or credentials. Preview is separate. Guidance never produces checked movement or liveness. |

This fixture adapter supplies neither cross-tab atomic transactions nor a hosted
ledger, account-authentication service, real camera or protected recovery. The
account adapter remains the trust boundary; the shared workflow never mints
authority. A future real-media adapter requires the pending custody/role/camera
decisions and service-side enforcement, not just removing the fixture checks.

[Focused component checks](../../code/test/unit/synthetic-enrollment-workflow-tests.mjs)
passed in managed Debian: 17 workflow checks plus two existing test-catalog
checks. Reopening was exercised by reconstructing workflows against shared
key/value fixture storage, not a browser/Android storage acceptance claim. See
[the dated validation](VALIDATION.md#synthetic-account-first-enrollment-workflow--21-october-2026).

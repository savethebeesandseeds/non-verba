# Android applications

## Two applications, one web UI source per application

The owner selected a branded participant shell and APK separation as the first
increment on 16 October 2026. Keep these two applications separate:

| Application | Browser/APK UI source | Android module / package ID | Purpose |
| --- | --- | --- | --- |
| Non-verba-dev | `web/apps/non-verba-dev/src/` | `app` / `org.nonverba.camera` | Existing developer sensor, evidence, enrollment and diagnostic tools. Its package identity, version sequence, private data and established debug signer are preserved. |
| Non-verba | `web/apps/non-verba/src/` | `participant` / `org.nonverba.participant` | The Requester/Operator application. Workspace drafts remain nonbinding. Local accounts, mock confirmation and memory-only document/frontal-photo capture are implemented; publication, signatures, protected media custody and identity decisions remain separate. |

Each app has one HTML, CSS and JavaScript UI source for browser and APK. Android
bundles that UI in a WebView; `code/android/app/` and
`code/android/participant/` contain the respective native hosts. Platform
adapters isolate browser and Android capabilities. See the
[web architecture guide](../../web/README.md) for source and packaging boundaries.

Different package IDs let the apps coexist with separate Android-private data,
permissions and updates. Workspace drafts and navigation use memory only; a reload
clears drafts. Drafting creates no identity, account, published task or signed record.
There is no migration or automatic sharing of developer keys, evidence or grants.
Neither a debug APK nor the participant name establishes release readiness.

The participant source lives in `web/apps/non-verba/src/`; canonical artwork lives
in `web/site/branding/` (there is no separate `src/branding` directory in this
checkout). The shared UI stages `sprout.svg` and two bounded prepared WebP
artwork files for Home and the Waajacu credit. Account-first onboarding adds two
app modules and an isolated account transport. Camera acquisition and memory-only
review use shared identity modules. The current fifteen-file closure includes
the reusable attestation tool, its browser-key module, versioned account terms and recovery export, as described
below; synthetic illustrations remain source fixtures outside this runtime. The original
artwork recipe, About layout and narrow author-link handoff are recorded in
[the participant UI guide](../../web/apps/non-verba/README.md#quiet-home-about-and-author-credit).
The participant APK launcher uses the
owner-selected `individual/01-sprout.png`, preserving the complete transparent
character over the cream app background. Its reviewed 432px PNG foreground keeps
the original square within the inner 72dp region of the 108dp adaptive layer;
regular and round launcher masks use that same resource. The canonical image
remains unchanged.

Regenerate this small resource explicitly with
`node tools/build/prepare-participant-icon.mjs --write` through the managed snapshot
launcher, then review its circular/rounded preview; `--check` compares the
prepared resource with the canonical artwork and recipe. Normal APK builds use
the prepared source resource and add no Chromium preparation dependency.

### Participant launcher artwork — 16 October 2026

The owner selected `web/site/branding/individual/01-sprout.png` for the user APK.
The original 909,703-byte image is unchanged; the prepared transparent foreground
is 81,246 bytes. Both circle and rounded-square masks were visually reviewed.
Managed participant assembly/lint, retained-signer package inspection and
compiled resource checks passed. Regular and round manifest icons resolve to
the same adaptive resource, and the packaged foreground PNG is byte-identical
to the reviewed source derivative.

The updated debug APK is 2,569,334 bytes, an explicitly reviewed 134,645-byte
increase over the earlier measured participant APK for the selected artwork and
its compiled resources. It remains below the existing 8 MiB guard; the earlier
measurement report is preserved rather than rewritten. The four web-shell
assets remain unchanged. This change applies to the participant launcher only;
no phone installation was performed.

### Developer launcher artwork — 21 October 2026

The owner selected `web/site/branding/individual/07-bonsai.png` for
**Non-verba-dev**. The original 1,011,022-byte artwork is unchanged. Its reviewed
transparent 432px foreground is 81,010 bytes, with the full original square in
the same adaptive safe region as the participant icon. Circle and rounded-square
masks were visually reviewed over the cream background.

Developer-only managed assembly/lint and retained-signer inspection passed.
Compiled regular and round icons resolve to the same adaptive resource; the
packaged foreground PNG matches the prepared source bytes exactly. The debug
APK is 33,792,810 bytes. Its application label, package, version, permissions and
debug signer remain unchanged. The approved USB helper installed this developer
update with data-preserving replacement and verified the exact installed APK
hash. No app launch or collection test was needed for this launcher-only update.

Both icons now use one explicit preparation entry point:
`node tools/build/prepare-launcher-icon.mjs developer --write` or
`node tools/build/prepare-launcher-icon.mjs participant --write`. Use `--check` to
compare the prepared source with its canonical artwork and recipe. The existing
`prepare-participant-icon.mjs --write|--check` remains a compatibility entry.
Both byte comparisons passed; the participant foreground is unchanged. These
commands remain optional artwork maintenance, outside routine APK builds.

## Next participant outcome and Hx11 integration — 21 October 2026

The next Goal is a usable participant workspace carrying one
selected Requester/Operator journey from its first action through an exact
agreement and a clearly reported result. The present role introduction is the
installed foundation. The owner requested pursuit of the next Goal after the
simplicity review. The bounded preview selected below advances the interface
while retaining the separate backend and participant-comprehension work.

The first visible increment should show the participant's work and one clear
next action. Choose the fewest views needed for that journey, keeping work
details and account controls available when relevant. The roadmap's engineering
steps do not prescribe a separate screen for every backend operation or state.
Review the flow before implementing it, then make the phone layout, back/re-entry,
readability and empty/loading/error states coherent. Use clearly labelled
synthetic preview data while service-dependent actions remain unavailable.
Keep these states separate from real account creation, publication, signatures,
sensor operations or accepted work. This UI work can advance while backend
provisioning proceeds; its selection/review checkpoint does not require a live API.

### Participant simplicity requirement

Owner direction, 21 October 2026: both Requesters and Operators should find the
app straightforward. The developer APK carries technical diagnostics and controls.
The participant experience should answer: what is happening, what do I need to
do next, and what did my action achieve?

Candidate user flows are: Requester describes the work, reviews an offer and its
terms, confirms the agreement and follows progress; Operator finds or receives
work, reviews the terms, confirms the agreement and carries out/reports the work.
Select the precise scenario without turning each phrase into a required screen.

Use one clear primary action, short everyday language and only the information
needed at that point. Reuse known details under the agreed privacy policy and
reveal optional detail when relevant. Keep account/settings secondary. The usual
journey must not require protocol vocabulary, hashes, key management, manual
pairing or diagnostic reports. Exact agreement and record details remain
inspectable; explain relevant terms, cost, recipients and sensor purpose before
a consequential action and retain deliberate review/consent.

Checks, storage and safe retry/status handling belong behind that interaction.
Explain what was saved, what is awaiting confirmation and the available next
step in plain language. An uncertain result cannot appear complete, and automatic
recovery cannot create another signature or resume collection. Review success
by whether a participant understands the work and next action without developer
knowledge; retain Hero 3's separate comprehension/consent responsibility.

The client review on 21 October confirmed that Hero 11's private environment and
local-parity foundation are complete. Its versioned API now supplies synthetic
account/device sessions, seeded Assignment originals, one initial Operator
completion and a scoped recipient inbox. A bounded read-only check inside its
managed container confirmed the current versioned API and mounted OpenAPI
contract. Exact versions, source/document pins and endpoint details are retained
privately. This is a local development boundary. In a subsequent owner scope
correction, Hx11 removed its authored private APK harness and phone gate; it now
validates services with container-only signed clients. APK integration belongs
to Hx10. Its removal of APK-validation metadata supersedes the earlier exact
contract pin, which remains retained historically while a final service pin is
pending. Existing APK/capture/device data is preserved. See the
[sanitized backend checkpoint](../../docs/development/SERVICE_BACKEND_CHECKPOINT.md).

The available API does not publish free-form Requests/quotes or list marketplace
work. Our two-field request and optional textual budget are preview inputs,
not signed protocol records. Connected action review must first supply the
independently pinned parties/domain, exact terms and assent, deliverables,
revision and structured compensation required by the unchanged Rust protocol.
Do not silently fill those choices or turn Publish/Send on against seeded
Assignment endpoints. Keep private implementation, API schemas and operating
details private while the selected client handoff is reviewed.

The Android sequence under the existing service/offline Goal is:

1. Agree the selected journey's versioned API, data/error/status shapes,
   account/device/key authority, environment and operation/retry contract with
   Hx11 and the Identity/Workflow owners. Resolve the choices needed for this
   scenario and retain the remaining questions explicitly.
2. Implement the narrowly scoped Android service/session/signing adapter. Keep
   participant keys on the device, use the shared Rust verifier and preserve
   the selected protected-storage, revocation and work-privacy rules. Choose
   the endpoint allowlist and Android network/credential boundary deliberately;
   the current bundled-only WebView is not already a service client.
3. Prove one real APK/backend round-trip with exact reviewed/signed records,
   authorized original-evidence transfer and independent verification after
   retrieval. A candidate sequence is Request, quote, exact agreement, selected
   evidence and status; the owner/domain review must choose its actual scope.
4. Prove interruption, timeout/lost-response, duplicate/conflict, offline and
   revoked-session behavior for that same journey. Show pending, unknown,
   rejected and committed results accurately; reconnect must not create another
   signature, renew a challenge or reactivate sensors. Add notification UI only
   after its channel, content and silent-work-state rules are selected.

Hero 11's local-parity/OpenAPI checkpoint supplies the backend foundation.
Its device-session and signed-APK Milestones are joint integration counterparts:
the Android contribution must not depend on its own joint demonstration already
being completed. Keep Android, backend, physical collector and participant
comprehension results separately scoped within the shared exercise. Hosted
outbox/access/restore work stays with Hx11; Android owns the corresponding
client behavior once its interface and cases are agreed.

Hero 10's first bounded client handoff is agreed and its generic Rust foundation
has passed the focused software checks under the owner's direction to continue
without the phone. The later session/signing adapter, real APK round-trip and
interruption acceptance remain separate future work,
preserving their existing Goal and Milestone IDs. Private development identity
choices do not select a participant production provider, deployment endpoint,
notification channel or rollout. The workspace preview below remains a separate
completed checkpoint. Retain the small shared UI, thin Kotlin platform adapters
and shared Rust rules; revisit runtime/APK budgets explicitly when real features
require additional payloads.

See the private workspace's
[Hero 10](../../../private-source/web/dashboard/heroes/10-apk.json) and
[Hero 11](../../../private-source/web/dashboard/heroes/11-services.json)
(local links requiring the sibling private checkout),
[Hero responsibilities](../../docs/notes/WORKSTREAMS.md#participant-journey-workflow-android-and-hosting)
and the [account-lifecycle limits](../../docs/development/REGISTRATION_PIPELINES.md#what-is-still-missing-and-why-it-matters).

### Participant client integration foundation — 21 October 2026

The owner asked to continue backend integration while the phone is disconnected.
The first supported increment is a transport-independent operation core in the
existing `nonverba-requests` Rust package. It establishes client bookkeeping for
one exact prepared operation; it does not connect the participant preview to the
private service or copy the private OpenAPI schema, routes or server code into
the public repository. Its model is independent of the eventual HTTP adapter.

Prepared material retains the original opaque ID, principal/key context,
Assignment, operation kind, labelled expected hashes and exact body bytes.
Dispatch changes local state to unconfirmed before returning those same bytes.
Lost responses, unavailable service and missing status cannot create success or
rearm dispatch. Matching pending observations remain pending; matching accepted
observations record only attributed service handling. Complete-binding mismatches
fail without changing state. Duplicate observations are idempotent, accepted
state does not regress to pending, and explicit conflicts remain visible while
retaining any earlier matching acceptance observation. No signature or sensing
operation can be triggered by this core.

The core calls the existing Rust identifier/digest/raw-hash functions. Exact
SignedEvent byte hashes stay distinct from canonical envelope/protocol hashes.
Its raw-byte helper does not verify a signature or adopt a server's trust: the
existing protocol verifier and independently selected bindings still govern
retrieved originals. The initial opaque-body budget is 4 MiB, not a promise to
support the backend's largest encoded evidence upload. There is no new crate,
dependency, Java source, APK library, UI asset, bridge or permission.

This is an in-memory guard, not a durable queue or global at-most-once guarantee.
The eventual host must reserve/journal the exact ID, context, bytes and dispatch
intent before I/O, and retain uncertain outcomes across restart. No retry/reset
API is exposed: retention, idempotency-window and explicit exact-resubmission
rules must first be agreed. HTTP adapter/authentication, protected session and
operation storage, Keystore signing and single-flight refresh/recovery remain
future work. Authentication alone supplies no exact-action consent or renewed
work/sensor authority. The separate developer JNI library pulls in sensor/C2PA
dependencies and is not selected as a participant packaging shortcut.

Managed Debian validation passed all 18 focused Rust integration tests and
`rustfmt --edition 2024 --check` for the new module/tests. Clippy passed for the
library and focused test with `-D clippy::all`. The initial stricter `-D warnings`
run stopped on two deprecations of `Nonce::from_slice` in the unchanged local
vault module; those warnings remain visible, with no suppression or dependency
upgrade in this increment. Checks used one formatted source snapshot and the
existing workspace lockfile. The earlier formatting invocation used a login
shell that reset the managed PATH; it was corrected to the documented non-login
execution, without installing tools. Independent source review found no
actionable issue in binding checks, sticky acceptance/conflict or scope limits.
No APK build/export, service mutation or physical-device acceptance is claimed
by these Rust checks.

One owner-authorized Hx11 handoff confirmed the first participant connection:
authenticate the participant app's own
approved key-bound session, read durable work state and retrieve/reverify one
known seeded Assignment original against independently supplied trust. Explicit
provisioning must supply that app's own account/key, membership, Assignment and
trust; the private harness identity must not be reused. No enrollment, identity
search or Assignment discovery is supplied. Exact contract bytes, independently
checked source/document hashes, debug transport and the agreement are retained
in ignored private records; none is embedded in the public client model. A later
direct owner scope correction removed Hx11's private-APK prerequisite and
harness. The old contract pin is historical after APK-status metadata changed;
Hx11 will retain the final pin after its server-only acceptance checks. Hx10
continues to own all APK work and its independently scoped phone acceptance.

The later adapter must preserve Hold/clock-out on reconnect and serialize token
refresh with atomic replacement-token persistence. Refresh replay can revoke a
session; this increment supplies no refresh or crash-recovery implementation.
No retention/garbage-collection/immutability or general resend-window commitment
was selected. The approved debug transport requires a scoped participant-host
review before any network permission/helper/bridge extension, and selects no
release cleartext exception. Marketplace publication/discovery and conversion of
preview drafts into real Requests/quotes remain separate service and consent
work. Physical signing, APK/backend exchange and restored replay remain with
their respective device checkpoints; no Hx10 device operation was performed in
this increment. The participant preview's Publish and Send controls remain
disabled.

### Participant workspace preview scope — 21 October 2026

The selected example is a **garden photo check**, with no payment amount implied.
Requester starts with a title and description; place and budget are optional. Review shows
the entered details with surrounding whitespace trimmed and supports editing. Operator starts with one explicitly
synthetic work card, reads its detail, then drafts and reviews an offer. Neither
role must complete onboarding, choose sensors or understand protocol terminology
to try this preview. No loading or remote-error simulation implies a connection.

Separate fixed examples explain proposed terms, progress and a result. Every
example stays labelled and independent of entered drafts: switching roles cannot
create a counterparty response, agreement or completion. Publishing, sending,
agreeing, collection and completion are unavailable, with a short explanation.
No account, signature, evidence, backend call or persistent record is created.
Preview terms do not select the eventual service or legal contract.

Back, editing and role switching retain each role's own draft in memory. Reload
returns Home with empty drafts. Draft-management controls are deferred. App
views and drawer state stay in memory and same-URL history, never in a URL path,
query or fragment. The Android host accepts only its plain bundled document
for document navigation, rejects queries and fragments, and uses WebView history
for Back. Runtime assets retain the exact allowlist for the selected feature set.
API 33+ registers its platform Back callback only while internal history exists;
older devices use the legacy Back override. This follows the
[Android Back guidance](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture)
without adding a UI runtime or native bridge.

The runtime remains three authored HTML/CSS/JavaScript files plus the existing
SVG, within the 64 KiB source guard. No new dependency, model, font, Rust/WASM
payload, authored Java source, storage authority or network permission is needed. Kotlin
continues to provide the thin Android/WebView boundary. All builds and checks
remain in managed Debian. Browser interaction, package inspection, physical
phone behavior and eventual participant comprehension are separate evidence.

The selected preview can finish before services are ready. The integrated Goal
still needs a reviewed Hx11 client contract, real end-to-end records and recovery,
plus Hero 3's participant comprehension/consent review. This preview does not
establish any of those outcomes.

### Workspace and screen-awake build validation — 21 October 2026

The final managed Debian snapshot passed 60 focused build, source-boundary,
participant, GPS-panel and screen-awake checks plus ten USB helper guards.
Nine intercepted Chromium groups passed request/offer validation, review/edit,
role isolation, Back/history, reset/reload, invalid-route recovery, literal markup,
unavailable consequential actions and zero service/storage/native calls. Layout
checks covered 320, 390, 900 and 1280px widths and 200% text scaling; phone-sized
request, operator, review and enlarged-text screenshots were visually reviewed.

The canonical explicit `all --export --baseline-report PATH` build assembled and
linted both APKs, then inspected each against the independently retained debug
signer. The developer inspector reported no current-build gaps; participant
inspection retained its narrower asset/manifest/signature scope. The exact
bounded USB export copies passed those unchanged inspectors again. Both
generated BuildConfig constants are true. No Windows Java/toolchain was used.

| Output | Bytes | SHA-256 |
| --- | ---: | --- |
| Developer APK | 33,790,989 | `b7a88e4d9d8d6e764b50bb62b727fe2b8e1b90f1576afa73cf527d98ab192df4` |
| Participant APK | 2,569,334 | `dfd7735e5f28ba8f150979b02ce687ac5ef1495950cf23aa29dec96cd0e45689` |
| Four participant runtime assets | 34,587 | Within the unchanged 65,536-byte source and 8 MiB APK guards |

The combined Gradle phase took 55 seconds: 41 tasks executed and 60 were up to
date. Each cached Rust preparation finished in under one second. These are
observations from this build, not cold-cache or reproducibility benchmarks.
Earlier failing browser and lint records remain retained: invalid-route focus
was corrected, fresh-document boot tests were corrected, and the legacy Back
override received a narrow documented lint annotation because API 33+ already
uses the platform dispatcher. Lint passed afterward without disabling the check
globally or adding a new activity dependency.

The build and authentic inspection records remain private. Physical phone
observations are recorded separately below; no hosted integration, exact signed
workflow, participant comprehension or wider device acceptance follows from
these software/package checks.

Both updates were installed for user 0 on the existing Cat S62 Pro, Android
11/API 30. Installed-hash readback matched each row above. Bounded own-window
observations reported `KEEP_SCREEN_ON=true` separately for both Activities, and
the developer screenshot showed the removed toggle. Its existing permitted GPS
warm-up appeared on launch; this was not a new collection/verification test.
Switching to the participant app leaves the developer Activity's normal pause
cleanup in force. Manual locking, unattended duration, API 33+ Back and other
devices remain outside this physical checkpoint.

The concurrent source reorganization placed the shared browser/APK UIs under
`web/apps/non-verba-dev/src/` and `web/apps/non-verba/src/`. All four current
participant inputs were independently compared with the authentic installed-APK
inspection hashes and match. The retained APK reports keep their original
pre-move snapshot metadata; none was rewritten. See the separate
[named-source validation](../../docs/development/VALIDATION.md#named-application-ui-sources--21-october-2026)
for the source-only rename checks.

Phone automation exposed helper-only viewport issues: an inert WebView on a
short page was filtered out, and this phone sometimes exposes nested host and
document WebViews with identical bounds. The parser now retains the selected
package's structural host and omits only its enabled, identical-bounds nested
WebView wrapper, preserving descendant controls. Siblings or different bounds
remain ambiguous. Node caps, bounds, focus, observed-scrollability and exactly
one enabled viewport requirements remain enforced. Refusals now classify fixed
project apps, system overlays or another window without disclosing unknown app
names or sending input. Thirteen USB guards passed, along with 34 repeated
participant/source/flag checks and all nine browser groups against the named
source paths: 73 distinct focused checks across the build and follow-up runs.
These helper/source-path corrections did not change APK runtime bytes or require
another Android build.

The phone's participant start and request-review screens were visually reviewed.
An empty request showed field errors; semantic batches entered public synthetic
title/details and the review displayed both exactly, with publishing disabled
and the keyboard dismissed. One initial screenshot/tap fallback was needed for
the root-only hierarchy; subsequent form interactions used semantic selectors.
After restored own-app focus, a controlled Requester edit → review → Android
Back returned to the form with the exact title and description retained. The
Operator flow opened the synthetic garden work, accepted a public offer message
and displayed it exactly on review, with Send unavailable and no invented price.
Its form, keyboard and review were visually checked; one Android Back dismissed
the keyboard, and a separate Back from review returned to the offer form with
its exact message retained. Returning to Requester and reviewing again preserved
both original request fields, with publishing still disabled. These are
resulting-state checks, not merely input acknowledgments. Earlier focus failures
stopped input; a redacted diagnostic
identified a system overlay, which the owner dismissed. No other window was
inspected or controlled. A final read-only window recheck refused after the
separate private integration test APK took the foreground; no further input was
sent. The earlier independent positive screen-awake observations remain scoped
as recorded above. This completes the selected single-phone workspace preview
checks; human comprehension, API 33+ Back and hosted integration remain separate
open outcomes.

## Synthetic onboarding asset boundary — 21 October 2026

This is the earlier fixture checkpoint. The later current capture boundary below
supersedes its fourteen-file selection, DOM storage and camera exclusions.

The participant collector, preview, Gradle preflight, native resource guard and
APK inspector use the same closed fourteen-file runtime: six application UI/client
files, one shared enrollment workflow, the three existing branding assets and
four synthetic SVG illustrations. The app source directory permits exactly
`index.html`, `participant.css`, `participant.js`, `onboarding-ui.js` and
`onboarding-account.js`, plus `account-transport.js`; it cannot silently package
another screen or helper.
The shared module is staged from
`code/test/fixtures/identity/synthetic-enrollment-workflow.js` (its current location), without copying its rules
into the app or Kotlin.

The explicit managed producer decodes the authoritative shared
`SYNTHETIC_ENROLLMENT_MEDIA` export byte for byte into
`web/apps/non-verba/assets/identity/{document-a,document-b,face-a,face-b}.svg`.
It creates no photographs, document scans, raster conversion, downloaded model
or runtime dependency. Run inside managed Debian:

```sh
node tools/build/prepare-participant-identity.mjs --write
node tools/build/prepare-participant-identity.mjs --check
```

Routine packaging consumes those four prepared files. The focused package check
compares them with the shared export and rejects extra identity illustrations.
The reviewed total runtime bound is 296 KiB for device proof and session inventory,
compact email-code entry, centered signup, terms review, fixed username prefix,
recovery-code export and the account/API-key UI;
each SVG/WebP retains an 8 KiB bound. Notices remain outside the runtime count,
and the APK's separate 8 MiB limit is unchanged. This deliberately supersedes the
initial shell's 64 KiB and synthetic onboarding's 128 KiB allowances; it grants
no open-ended asset directory.

The WebView enables DOM storage for the explicit synthetic fixture adapter. Its
shared UI restricts persistence to the synthetic enrollment key prefix; no real
credential, account session token or selected personal media belongs there. This
is development fixture storage, not a protected account vault. Bundled previews
use self-hosted image assets, keeping `img-src 'self'` without `data:`. Network
loads, file/content access, geolocation and native media permissions remain
unavailable. Native resource/document URL guards retain their exact paths and
reject queries/fragments. The debug account transport below is the only added
native message channel; real identity capture and protected custody remain separate.

## Current capture asset boundary — 21 October 2026

The selected runtime now has eleven files: six app UI/client files, the shared
`identity/enrollment-camera.js` and `identity/identity-capture.js`, and three
branding assets. It totals 164,069 bytes under the unchanged 192 KiB guard.
The new `participant-capture-assets-v1` stage leaves the old fixture stage intact;
Gradle and independent inspection retain exact-file/byte guards. DOM storage is
disabled and actual photos remain in memory, with no fixture persistence/upload.

CAMERA is the only added main-manifest permission; hardware camera features are
optional. WebView permission requires the exact bundled origin/document, video
only, current OS permission and foreground Activity. Cancellation/backgrounding
stop tracks and fence late permission/encoder results. Own-origin camera and blob
previews are allowed by the selected CSP/Permissions-Policy; microphone,
geolocation, file/content access and remote WebView resources remain blocked.
Email confirmation is explicitly mock-only until the last mile. No identity or
liveness result follows from capture. See [the capture contract and checks](../../docs/development/PARTICIPANT_CAPTURE.md).

### Explicit local account transport

The participant preview relay is disabled by default. Opt in only in the managed
preview process with `NONVERBA_ACCOUNT_RELAY=local`; no caller-selected upstream
URL is supported. The existing preview binding stays on port 4173, published on
host loopback. The relay connects to the verified Docker Desktop host route on
port 8080 while retaining the account service's canonical loopback issuer. It
does not start a service, create a container or configure a phone.

The browser uses same-origin `/account-api/config` and `/account-api/transport`.
Transport POSTs require the exact loopback Host and Origin, JSON content type
and the app's custom header. Requests have a closed account/enrollment/recovery/
development-OIDC route, method, field and header allowlist. No CORS exception,
arbitrary proxy, redirect following or user cookie forwarding is supplied.
The relay bounds requests to 16 KiB, serialized responses to 64 KiB, concurrent
exchanges to four, traffic to 120 requests per minute and upstream waits to seven
seconds. Responses are `no-store`; exception text and account material are not
logged. Credentials and bearer tokens pass only with the current request.

Development OIDC sign-in uses the existing client and exact loopback callback,
with PKCE/state/nonce verified by the shared client. The relay retains only the
service's exact CSRF cookie in a bounded, random-flow-specific memory jar, expiring
at five minutes even when idle. Each authorization POST attempt consumes its jar
entry, including refused or failed attempts. No Set-Cookie reaches the browser or
APK, and the relay retains no ambient bearer or persistent account session.

The debug APK installs `NonverbaAccount` through AndroidX's origin-scoped web
message listener when that capability exists. It accepts only the main frame
of the exact bundled document, uses a bounded worker queue and sends to the
fixed numeric-loopback relay on port 4173. Activity stop/destroy cancels workers,
disconnects the current exchange and discards late replies; an interrupted
server-side operation can still have an unknown outcome. The existing approved
USB reverse for 4173 supplies the physical-phone route when explicitly configured.
The browser and APK use the same account client and request envelope.

Only the debug manifest requests `INTERNET`, with cleartext allowed exclusively
for numeric `127.0.0.1`. The release manifest requests no network permission and
installs no account bridge. WebView network loads and cookies remain blocked;
native CSP still forbids direct connections. Browser CSP allows same-origin
connections only. This is a local development connection, not production
credential custody, provider selection, deployment or physical-device acceptance.
Account credentials/session tokens remain in memory; only explicitly synthetic
identity fixtures use their existing storage namespace. The package inspector
accepts the debug network permission and rejects camera, location, storage and
other unselected permissions; its release-mode permission check rejects INTERNET.

## Recovery-code text download

The shared recovery screen's Download recovery codes action uses a dedicated
origin-scoped WebMessageListener on Android. It accepts only the fixed text
format containing eight distinct canonical recovery tokens, keeps pending bytes
in memory for at most two minutes and opens the system Create document picker
for `non-verba-recovery-codes.txt` with MIME type `text/plain`. It adds no storage
permission, arbitrary URL/path access, app cache, retained URI grant or network
download service. Existing WebView file/content access remains blocked.

The picker itself may pause/stop the Activity, so only that bounded owned picker
round trip retains the pending bytes. Writing waits for the same bundled
document to resume; cancellation, navigation, ordinary background writes,
expiry and destruction clear the lease and fence stale results. The bridge
reports saved only after the chosen stream writes and closes successfully.
Worker plaintext is leased as well: it is copied only after provider open and a
fresh state check, and cancellation or expiry zeroes it before provider cleanup.
Potentially blocking cancellation-close runs off the UI thread; unresolved owned
cleanup refuses another save rather than accumulate stalled provider streams.
Browser download acknowledgement cannot prove disk completion; Android provider
and physical lifecycle acceptance remain distinct from the software checks.
The save flow follows Android's
[Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files);
the resume fence follows the documented
[Activity result ordering](https://developer.android.com/reference/android/app/Activity#onActivityResult(int,int,android.content.Intent)).

## Development notes: keep the participant APK small and clear

- Keep shared validation, policy, cryptography, evidence and protocol rules in
  the existing Rust workspace. Use `rustc` through Cargo and the managed Linux
  toolchain when a feature needs them; do not clone these rules into Kotlin or
  JavaScript. The static shell has no such operation, so it ships no unused Rust
  native library or WASM engine yet.
- Add no project `.java` sources. Keep Kotlin limited to Android framework
  integration such as Activity/WebView lifecycle, permissions, Keystore and
  platform callbacks. Kotlin compiles to managed Android bytecode; it is not a
  promise of a JVM-free application. JDK/Gradle remain Linux build tools, never
  Windows development tools. Preserve the existing bounded C++ AAudio callback
  adapter rather than reimplementing collectors as part of this split.
- Use the system WebView and small bundled HTML/CSS/JavaScript with system fonts.
  Do not add another embedded browser, UI runtime, dependency or model merely
  for the shell. The initial four-file shell used a 64 KiB bound. The selected
  synthetic onboarding increment reviewed 128 KiB; the selected local account
  client/capture and API-key dashboard preview now have a fifteen-file runtime bound
  of 296 KiB including device proof, session inventory, terms review, the fixed username prefix and recovery-code export, retaining 8 KiB per
  image and the 8 MiB debug APK guard.
- Keep developer pages, unselected inspection demos, diagnostics, raw sensor controls and
  models out of participant staging. `participant` is a separate application
  module, not a hidden developer menu or a role flag over all existing bridges.
  Its main/release manifest requests CAMERA only. The debug-only account
  channel is scoped above; it adds no file picker, persistent real account
  storage or remote WebView resource loading.
- Keep native access opt-in and scoped when actual workflows are added. Opening
  the app or selecting a role must not warm GPS, activate a camera/microphone,
  enroll a key or resume work. Hero 2 supplies policy, Hero 8 the grant/workflow
  contract, Hero 1 collector semantics and Hero 11 hosted records; Android
  implements their selected interfaces, not new authority inferred from UI.
- Keep asset lists closed and independently inspect both APKs. Generated
  participant assets stay in the managed module build directory, not authored
  source. Include current license/source notices. Preserve the strict bundled
  origin, CSP and native-bridge boundaries as connectivity is designed.
- Add one scoped participant workflow at a time after its meaning and service
  contracts are agreed. Keep software/browser, package, physical-device,
  participant-comprehension and release acceptance as separate results. Size,
  startup, memory and battery claims need measurements for the actual feature.

Production participant signing, distribution channel and update acceptance still
need review. Development builds reuse the retained debug signer without creating
another key. Do not distribute them as an operational participant service; dirty
builds also require their complete corresponding source, as recorded in the
bundled source notice.

## Two-APK foundation validation — 16 October 2026

The selected shell/separation increment passed these managed-Debian checks:

| Check | Recorded result |
| --- | --- |
| Focused packaging/catalog checks | 25 passed, including closed asset sets, budgets, linked inputs, native/model/developer exclusion, real compiled permission metadata and retained signer checks. |
| Shell browser checks | Seven groups passed against exact bundled assets at widths 320, 390, 900 and 1280: brand loading, pointer/keyboard selection, truthful preview notice, no bridge or retained role, responsive layout, reload and unexpected-resource/JavaScript-error checks. Phone/desktop screenshots were inspected. |
| Developer build | Rust/WASM and both native Rust ABIs built; Android assembly and lint passed. Existing package/version identity and export filename remain unchanged. |
| Participant build | Assembly and lint passed, including the final participant-only build. Its four runtime assets total 9,302 bytes; no Rust/WASM/native libraries or models are packaged. |
| Independent APK inspection | Both passed against the independently retained debug-signer baseline. The participant inspector verifies actual compiled manifest permissions; the only permission is AndroidX's own signature-protected receiver permission, not sensor, storage or network access. |
| Local handoff | The 33,738,633-byte developer APK and 2,434,689-byte participant APK were copied to ignored local artifacts; both size/SHA-256 comparisons matched their authentic inspection reports. |

The initial developer inspection exposed a pre-existing disagreement: staging
excluded browser face models while inspection expected them. The shared exclusion
rule corrected this; the unchanged APK then passed inspection with byte-checked
current inspection helpers. The initial participant inspector assumed a different
`aapt` permission-summary format. It now cross-checks the actual summary against
the compiled manifest's typed signature-protection attribute, with negative
regression fixtures. Failed and corrected reports remain separately retained;
neither correction rewrote an APK or report. A participant-only rebuild included
the final preview wording, without rebuilding the developer native libraries.

Original source/build provenance and private QA records remain in their separate
snapshots; the two delivered debug APKs need not have the same snapshot digest.
The local handoff records each original path and hash. Existing SDK XML-version
and future Gradle-9 deprecation warnings remain in the build logs.

No phone installation, observed co-installation, sensor run, update migration,
connected account/task journey or release distribution was performed. Package
identity/data isolation is configured, not a new physical-device acceptance
claim. This checkpoint completes the separate-app shell foundation only.

## Two-APK USB preview — 21 October 2026

Both debug APKs were assembled and linted in the preserved managed Debian
container, independently inspected against the retained debug signer, copied
through the bounded export bridge and installed on the same Android 11/API 30
phone for user 0. Each installation's exact APK hash matched its inspected
export. The developer update used data-preserving replacement; the participant
package was newly installed alongside it. Authentic reports and installation
readbacks remain private.

Both fixed activities then returned Android launch status `ok`. One focused
own-app screenshot per application confirmed the developer home with its local
engine ready and the complete branded participant preview. The participant app
was left in the foreground. Both semantic dumps exposed only three root nodes,
so these screenshots establish visual rendering, not successful semantic
navigation or a new phone test of the role buttons. The developer screenshot
also showed its existing foreground GPS warm-up under an already granted
permission; no evidence challenge or collection acceptance was performed.

The initial developer launcher in this checkpoint was named **Non-verba-dev**
with a dark copper N icon; its later bonsai update is recorded above. The
participant launcher is **Non-verba** with the selected sprout
adaptive icon. Compiled launcher labels and distinct resources were checked,
and the participant APK's foreground PNG matched the prepared source bytes.
The developer APK is 33,792,641 bytes; the participant APK is 2,569,334 bytes.
This establishes bounded co-installation, not wider device acceptance,
account/task services, production signing or release distribution.

The approved original USB helper accepts an explicit fixed application target
for status, verified installation, launch and own-app UI inspection. The later
workspace extension also selects routine guarded own-app input. Developer
remains the default; sensor, native-camera, share, restart and export actions
remain developer only. See the
[USB procedure](../../docs/development/USB_DEBUGGING.md).

### Cargo freshness correction

The first export inspection correctly stopped rather than installing an APK
with an unresolved freshness check. Its broad workspace scan had treated a
newer, uncompiled Rust example as an input to the cached WASM library. Inspection
now reads each WASM/JNI artifact's Cargo dep-info, requires the exact output and
current source snapshot, and retains workspace/package manifests, lockfile,
toolchain, configuration and build scripts as freshness inputs. Actual compiled
modules and included non-Rust bytes still invalidate older outputs; examples,
test-only modules and unrelated crates do not. Missing, malformed, foreign or
linked dependency inputs fail closed. No output timestamps or reports were
rewritten, and the failed export was preserved.

Forty-five focused checks passed in Debian: 18 developer-inspector tests
(including six Cargo regressions), 11 participant-package tests, two catalog
checks and 14 transport checks (including five fixed-application guards).
The subsequent combined build/lint and both snapshot and bounded-copy package
inspections passed. These checks establish build/package behavior; collection
and workflow acceptance remain separate.

## Existing developer host

This APK packages the shared web UI and Rust WebAssembly module, plus the same
Rust sensor/provenance core as an Android native library. Thin Kotlin adapters own
Android location and Camera2 sessions, AAudio lifecycle, Keystore access,
document selection, direct file saving, and encrypted identity storage. There are no
project Java sources. Rust validates evidence and implements provenance,
cryptography, and watermark logic.

Version 0.4.0 added mandatory raw GNSS, native camera capture and native AAudio
recording. Version 0.5 adds preserved challenged-key generations, independent
Android enrollment verification, and a separate GPS L1 C/A position/clock
verifier using requester-pinned navigation data. See `docs/sensors/NATIVE_CAMERA.md`,
`docs/sensors/NATIVE_AUDIO.md`, `docs/sensors/LOCATION.md` and `docs/sensors/NATIVE_KEY_ENROLLMENT.md`
from the repository root. Current native audio requires API 29 plus a
confirmed unprocessed built-in route and observation of the exact recording
client's silencing, source, format and effect state; API 30+ also requires confirmed
privacy-sensitive capture. Raw GNSS requires supported API 29+ measurements.
Unsupported required capabilities fail rather than falling back to WebView capture.

## Development screen-awake build flag

Owner direction, 21 October 2026: both APKs keep the display on automatically
while their Activity is resumed. There is no toggle or two-hour expiry. The
developer preference/lease bridge, timer and JavaScript control were removed;
the participant app needs no new bridge. Old private lease preferences are left
untouched and unused. A hidden developer-page anchor remains solely for the
existing GPS preparation panel.

One reviewed property, `nonverba.keepScreenAwake=true` in
`android/gradle.properties`, supplies `BuildConfig.KEEP_SCREEN_AWAKE` to both
modules. Both parse a strict boolean and default to false when absent. Set that
property to false and rebuild when this development convenience is no longer
needed; no installation flag or user setting is required. The canonical build
copies this shared input and package verification includes the current sources.

Each host applies Android's `FLAG_KEEP_SCREEN_ON` on start and reasserts it on
resume, preserving it while paused but still visible. Stop/destruction clears
it in both hosts. Opening or returning to the app restores the configured
behavior, including after restart or update. This
uses no wake-lock permission, service, background lock or Android timeout change.
Manual locking remains available and sensor authorization/lifecycle stays
separate. See the [Android screen-on guidance](https://developer.android.com/develop/background-work/background-tasks/awake/screen-on).

The initial implementation cleared the flag on pause, which was narrower than
the owner's visible-app requirement: Android can leave a paused Activity visible
under a translucent Activity or in multi-window mode. The 21 October correction
removes only that screen-flag cleanup from pause; all sensor, permission, pairing
and WebView pause cleanup remains. This closes a source-level lifecycle gap,
without establishing which screen caused the owner's reported timeout. See
[Android's pause/visibility distinction](https://developer.android.com/guide/components/activities/activity-lifecycle#onpause).

### Visible-window screen-awake correction — 21 October 2026

The six updated screen-awake guards and 17 bounded transport/parser groups
passed in the managed container. Both APKs passed canonical assembly/lint and
retained-signer inspection, including the exact bounded USB copies. Gradle took
46 seconds with 35 tasks executed and 66 up to date; this is one warm-build
observation, not a benchmark. No runtime dependency, permission, model or UI
asset was added. Sensor and permission pause cleanup remains unchanged.

| Corrected installed output | Bytes | SHA-256 |
| --- | ---: | --- |
| Developer APK | 33,791,366 | `395217b389770e89f13043cc8f4a506a63e72d3a80e0e6bf15b1478c1732efac` |
| Participant APK | 2,569,334 | `3ee1e264a65cdc2213870b3734d81ff778690102fe2eac1cce02dd5d6ab0cfa5` |

Both updates were installed with exact hash readback and preserved application
data. Before updating, the installed sprout Activity reported KEEP_SCREEN_ON,
and both old APK hashes matched their earlier verified exports. The owner could
not identify which screen had timed out; the exact reported cause remains
unconfirmed. The confirmed lifecycle gap above was corrected independently.
The USB guard later classified a system overlay and stopped app observation;
it did not inspect or dismiss that overlay. After the owner unlocked the phone,
each corrected app passed a bounded idle check against the unchanged 60-second
screen-off timeout. The sprout app remained focused with KEEP_SCREEN_ON,
wakefulness Awake and display state ON after 215.9 seconds; the developer app
reported the same after 125.6 seconds. The helper sent no input during either
interval. The sprout app was then brought back to the foreground and again
reported the flag, Awake and ON.

These are timed endpoint observations on one Android 11 phone. Source guards
and native build checks cover the lifecycle correction; physical paused-visible,
multi-window, manual-lock and indefinite-duration behavior were not exercised.

## Build contract

All development tools execute in the managed Debian container `non-verba-dev`.
The Windows launcher only invokes Docker; installing or running Java on Windows
is prohibited. See [the authoritative container procedure](../../docs/development/CONTAINER_PLAN.md).

From the unified checkout with the preserved container already running:

```powershell
./code/dev.ps1 -Snapshot -Action Status
./code/dev.ps1 -Snapshot -Action Test
./code/dev.ps1 -Snapshot -Action Build -Command @('participant')
```

`Build` requires an explicit target. Each path assembles and lints only its
selected modules; use `all` deliberately when both APKs need validation:

```powershell
./code/dev.ps1 -Snapshot -Action Build -Command @('developer')
./code/dev.ps1 -Snapshot -Action Build -Command @('participant')
./code/dev.ps1 -Snapshot -Action Build -Command @('all')
```

| Target | Preparation before selected Android assembly/lint |
| --- | --- |
| `participant` | Fifteen selected UI/client/capture/attestation/terms/export/branding files and current notices, within the reviewed 296 KiB runtime bound. No Cargo, WASM, native developer libraries, browser model or cooperation build. |
| `developer` | Locked `nonverba-core` WASM with pinned bindgen, current web assets/notices, and locked `nonverba-android` Rust for both ABIs. No cooperation WASM, browser face-model preparation or local review-page generation. |
| `all` | Both preparations once, then both modules in one Gradle invocation. |

`code/dev.sh build` and `tools/build/build-android.sh` use this same pipeline; avoid
adding a second build recipe. Gradle loads only the selected application projects
via `nonverba.target` (an IDE without that property can load both). Keep shared
Gradle/plugin/toolchain pins in their existing declarations. All generated
assets, Java, compilers and caches remain inside Debian.

Authored Android inputs stay under each module's `src/main/`. Generated developer
web assets and release notices are staged directly under
`/opt/nonverba-build/android/app/build/generated/developer-assets/`; Rust JNI
libraries use the sibling `developer-jniLibs/` directory. Gradle explicitly uses
these generated roots. Participant assets already follow the same pattern in
`participant/build/generated/participant-capture-assets-v1/`. The earlier
illustration stage is preserved and excluded from current builds. Retained legacy
`src/main/assets/` and `src/main/jniLibs/` staging is preserved and excluded from
developer source sets; it is not copied or merged into new packages.

Pure Kotlin Android platform harnesses belong to
[`tests/platform`](tests/platform), with their shared container environment and
commands documented in [the Android test guide](tests/README.md). Real JVM-to-Rust
JNI integration checks remain in
[`nonverba-android/tests`](../crates/nonverba-android/tests).

Routine builds keep APKs in `/opt/nonverba-build/android/<module>/build/outputs/`
and create no handoff copies. To request an export, supply an independently
retained debug-signer report already available inside the container:

```powershell
./code/dev.ps1 -Snapshot -Action Build -Command @('participant', '--export', '--baseline-report', '/absolute/container/path/retained-debug-report.json')
```

The same flags apply to `developer` and `all`. Export assembles/lints first, copies
the selected APKs and lint reports into an exclusively created
`code/artifacts/container-builds/<UTC timestamp>/`, and independently inspects
each exact exported APK against current source/assets and the supplied signer
baseline. The source snapshot and its metadata remain attached throughout.
Only a successful run gets `build-manifest.json`. A failed export preserves
`INCOMPLETE.txt` and partial outputs for diagnosis; do not treat that directory
as a completed handoff. Production signing and distribution remain separate.

Every admitted run gets a unique `code/artifacts/qa/android-build-*.json` record
and adjacent stage logs inside its source snapshot. Records include target,
source revision/dirty/archive digest, performed and skipped stages, durations,
failure status, observed Gradle `UP-TO-DATE` count and selected APK sizes/hashes.
Records also retain individual task outcomes and Gradle's actionable-task summary,
so regression checks can identify unnecessary compilation or packaging.
The up-to-date counter counts matching task log lines, including aggregate
tasks; Gradle's actionable-task summary has a narrower denominator. These records
describe observed work, without certifying a speedup or reproducibility.
Use the printed record path; a fresh snapshot has a different provenance notice
and is not an identical-input performance sample.

A nonblocking container-wide producer lock covers preparation through export
because snapshots share the Android/Cargo caches. The supported standalone
web/native builders and both asset stagers take the same lock. Canonical child
stages reuse the real inherited file descriptor, validated against the managed
lock path and kernel lock; an environment marker cannot claim ownership.
Contention exits 75 before preparation;
retry after the admitted build finishes. Missing targets/invalid flags exit 2.
The existing `/root/.android/debug.keystore` must be present; the pipeline never
searches for a substitute or generates a new signer. Sync refreshes the shared
Gradle files and both small module build declarations for inspector consistency;
only selected modules' runtime sources are copied. The unselected module's
runtime sources, staged payloads and caches are preserved.

Use the canonical build entry point for packaging. The lock protects the supported
project commands; raw Cargo/Gradle invocations are not a second packaging recipe.

Web/native staging compares bytes before replacing generated files, preserving
unchanged timestamps. Unexpected generated files are reported and preserved;
review them before retrying instead of deleting a cache tree. Repeated builds
still perform the selected Cargo/Gradle freshness checks and lint. They do not
skip correctness checks based solely on a previous success.

The pinned toolchain uses Rust 1.96.0, wasm-bindgen 0.2.122, Gradle 8.14.3,
Android Gradle Plugin 8.11.1, Kotlin 2.2.20, JDK 17, CMake 4.3.3 and Android
NDK r30 (30.0.16248370). Android compile/target SDK is 36 and minimum SDK is 26.
AndroidX WebKit 1.14.0 supplies the asset loader and AndroidX Core 1.16.0 supplies
FileProvider, window insets and GNSS callback compatibility.

`code/setup.sh` installs dependencies only. Toolchains reside in
`/opt/nonverba-tools`, with build caches and an isolated Gradle/CMake build tree
in `/opt/nonverba-build`. The existing development signing key is preserved.
Explicit verified debug exports are retained under
`code/artifacts/container-builds/<UTC timestamp>/`. Existing release files and
Windows intermediate outputs are preserved, but are not the Linux build directory.

The legacy developer filename stays `nonverba-debug.apk` for compatibility with
the existing bounded installation helper. The participant output is
`nonverba-participant-debug.apk`; it is not an authorized phone installation or a
production release. Inspect it with `tools/build/verify-participant-package.mjs`, using
the exact `--apk` and independently retained debug `--baseline-report` paths in
the same snapshot. The existing `tools/build/verify-android-package.mjs` remains the
developer inspector. Reports are separate and never rewritten. Package/source
metadata must be preserved through follow-up commands in that snapshot.

Focused split checks, also through the managed snapshot launcher:

```powershell
./code/dev.ps1 -Snapshot -Action Exec -Command @('node', '--test', 'test/unit/participant-package-tests.mjs', 'test/unit/android-package-verifier-tests.mjs', 'test/unit/test-suites-tests.mjs')
./code/dev.ps1 -Snapshot -Action Exec -Command @('node', 'test/browser/participant-browser-check.mjs')
```

The browser check uses the existing managed Chromium runtime and intercepts only
the bundled shell URLs; it starts no webserver and contacts no service. Its
screenshots/results are ignored QA outputs, separate from Android-device checks.
Staging and the developer inspector share the browser-only asset exclusion rule,
including the entire face-model directory; those model files remain browser
inspection inputs rather than a hidden Android dependency.

The developer build rebuilds WebAssembly, stages shared assets, compiles Rust for arm64-v8a
and x86_64, and assembles/lints the APK. Native code targets API 26 with 16 KiB ELF
load alignment. This app requires 64-bit Android. C++ audio callbacks use
preallocated buffers without JNI, allocation or cryptography.

The historical Windows-Java package verifier and Kotlin/JNI smoke launchers are
disabled with directions to maintained Linux inspectors and shell harnesses.
Explicit exports verify APK signatures with Linux apksigner and independent
package inspectors; routine builds run Android lint. `code/dev.ps1 Test` runs
Rust and JavaScript unit/adapter tests. These are
software checks and do not replace physical Android acceptance testing.

## Build curation — 16 October 2026

Hero 10 tracks build curation as its own Goal. The initial review identified an
implicit combined build, unrelated cooperation/model preparation, unconditional
handoff copies, shared mutable outputs without an orchestration lock, and asset
copies that reset timestamps. The canonical pipeline above addresses these
sources of avoidable work and makes selected work and failures observable.

Keep this contract small as features grow: add a dependency to the target that
actually uses it, retain one preparation path, preserve package inspection at
export, and use recorded stage costs to justify optimization. A representative
performance baseline and regression thresholds are covered by the repeatable
checks below. No cold-cache cleanup or numerical speed claim is implied.

Focused pipeline checks run in their own prerequisite group:

```powershell
./code/dev.ps1 -Snapshot -Action Exec -Command @('node', 'tools/test/run-tests.mjs', 'build_process')
```

The full `Test` command also includes this synthetic regression group. The
measured ten-build workload remains an explicit operation.

The curation increment passed these managed-Debian checks:

| Check | Recorded result |
| --- | --- |
| Focused source checks | 40 distinct checks passed: 15 build-process cases, 12 developer-package parser cases, 11 participant-package cases and two test-catalog cases. The orchestration harness runs the actual scripts against isolated synthetic tools, including lock contention, invalid flags, missing retained signer, stage/inspection failures, exact export paths, stale-file refusal and unchanged timestamps. |
| Participant routine and repeat | Both assembled/linted without exports or Rust preparation, using the same source snapshot and existing shared caches. Total recorded durations were 20.4 s and 8.8 s. Gradle reported 38 then 43 of 45 actionable tasks up to date. The APK SHA-256 was identical across the pair. These are observed samples, not an agreed performance baseline. |
| Current combined build | Both Rust native ABIs, core WASM and both Android assembly/lint tasks passed. All ten pipeline stages passed; total recorded duration including export/inspection was 45.7 s, with 38.9 s in Gradle. No cooperation WASM or browser model/review preparation ran. |
| Explicit verified export | Both exact exported APKs passed current package/assets/notices and independently retained debug-signer checks. Developer inspection reported no errors or current-build gaps. The completed manifest matches the run and there is no incomplete marker. APK sizes were 33,790,113 bytes for developer and 2,434,689 bytes for participant. |
| Real failure observations | Earlier combined attempts stopped at camera-adapter API/permission lint findings, retained failed run records and created no export. The camera workstream's current source guards then passed; the build pipeline kept lint required. |

The existing SDK XML-version and Gradle-9 deprecation warnings remain. Source-only
review found no blocking curation issue under the documented concurrency limit.
No phone, production-signing or release-distribution acceptance is implied.

## Repeatable build-cost checks

The build-curation Goal includes a retained workload suite, not only individual
successful builds. Run it through the managed snapshot launcher:

```powershell
./code/dev.ps1 -Snapshot -Action Exec -Command @('node', 'tools/build/benchmark-android-builds.mjs')
./code/dev.ps1 -Snapshot -Action Exec -Command @('node', 'tools/build/benchmark-android-builds.mjs', '--baseline', '/absolute/container/path/retained-benchmark.json')
```

Schema 1 defines one fixed warm workload for each APK: one preparation build,
two measured unchanged builds, one CSS comment change and one restoration build.
The suite holds the shared producer lock throughout. It uses existing caches
without resetting them and makes no per-iteration handoff exports. It refuses
host binds and runs only inside a launcher-verified `/tmp` source snapshot.

Only that snapshot's participant CSS and developer CSS are temporarily changed.
The report retains the exact original file backups and variant hashes; normal
completion and failure restore the original source bytes. If execution is
forcibly killed, the unique QA files retain those specific originals for recovery.
Workload children explicitly omit the original source-archive digest and declare
modified inputs, so synthetic changes cannot claim the unchanged archive's
provenance. The original snapshot digest remains clearly labelled as the origin
in the suite report. Do not distribute workload packages as operational builds.

Hard checks require the correct target graph, assembly/lint success, identical
unchanged APK bytes, stable runtime bytes/timestamps, and no repeated Kotlin/Java,
asset packaging, DEX or lint-analysis work on unchanged builds. CSS-only changes
also refuse unrelated application compilation and DEX work. Every CSS variant
must appear exactly in its selected APK; every build preserves the other app's
runtime inputs and cached APK. Source restoration must restore all unsigned APK
entry names and uncompressed payload bytes. Full archive/signing bytes after an
edit-and-restore may differ and are recorded separately; reproducible packaging
is not claimed. Required verifiers and CMake/Ninja freshness checks may still run.

Reports retain toolchain versions, architecture, Cargo.lock digest, cache policy,
stage durations, task outcomes, APK sizes/hashes, payload digests and restoration
results. Retained baselines must use the same workload schema. Toolchain,
platform, architecture, dependency-lock or sample-policy differences are reported
as non-comparable instead of silently applying time/size limits.

With only two warm samples, timing is an advisory review signal. The initial
threshold is the larger of twice the observed maximum and that maximum plus
10 seconds, allowing JVM startup and scheduling variation. Any APK growth against
a comparable retained baseline requires review; unchanged-input growth remains a
hard failure. The earlier shell used a 64 KiB runtime guard, synthetic onboarding
reviewed 128 KiB, the selected local account client used 192 KiB, the static key
dashboard used 196 KiB, the editable demo used 200 KiB, simple sign-in used 204 KiB, email-first routing used 208 KiB, compact code entry used 212 KiB, and device proof/inventory now uses 240 KiB, retaining the
8 MiB debug APK limit. After an intentional feature/toolchain change, retain a new reviewed
baseline and its reason rather than quietly widening limits. This suite covers
warm and CSS-change costs, not cold-cache or Rust/Kotlin compilation performance.

### Recorded Goal completion — 16 October 2026

The complete ten-build workload passed in one managed-container snapshot, with
existing caches and no measurement exports. The normal focused dispatcher passed
31 regression cases; test-catalog checks also passed. All four real CSS-change
and restoration observations additionally passed the CSS-only compilation/DEX
reuse rule. The following retained baseline applies to this warm workload:

| Application | Unchanged range | Median | Advisory review above | Debug APK bytes |
| --- | --- | --- | --- | --- |
| Participant | 8.158–8.249 s | 8.204 s | 18.249 s | 2,434,689 |
| Developer | 12.022–12.911 s | 12.467 s | 25.822 s | 33,790,113 |

The measured CSS-change/restoration builds took 14.766/15.604 s for participant
and 35.326/35.430 s for developer. Both apps preserved the other application's
runtime files and cached APK throughout. All unchanged samples retained their
exact APK bytes and runtime timestamps; all CSS variants reached the selected
APK, and both restorations returned every unsigned payload to its baseline.
The developer's full restored archive differed despite identical unsigned
payloads. The exact archive/signing difference was not diagnosed; this result
does not establish reproducible packaging.

After restoring source, the same snapshot's combined build/lint and both exact
exported-APK inspections passed with the retained debug signer, current assets,
license/source notices and alignment checks. The completed manifest was retained.
The 86,609-byte measurement report and final manifest were copied unchanged into
ignored local QA artifacts and hash-checked. Raw operational paths remain out of
the dashboard; this authored record is its public evidence.

This completes the requested curated-and-measured debug-build Goal. Continue
using its single target contract, regression group, explicit workload suite and
reviewed baseline policy as features change. Device acceptance, production
signing/distribution and any broader reproducibility study keep their separate
Goals and evidence requirements.

## Shared JavaScript integration

The application starts at
`https://appassets.androidplatform.net/assets/web/index.html` and also permits
the bundled `/assets/web/audio.html`, `/assets/web/location.html` and
`/assets/web/live-location.html` and `/assets/web/key-enrollment.html` documents. Relative script,
style and WASM URLs work under this directory. A strict response CSP requires
external scripts/styles and permits WASM compilation. No remote pages, remote
resources, frames, inline scripts, or arbitrary file URLs are loaded. Bundled
same-origin workers are permitted for the Rust engine; AudioWorklet modules must
also use bundled external files. WebView HTTP(S) resource loading and navigation
are restricted to bundled assets, with network loads disabled. The native bridge
is available only to bundled application code. The shared audio app's WebRTC
datachannel uses its own direct peer transport, described below.

The audio page's **Try demo** button uses a bundled same-device requester module
without an operator ID or peer pairing. It shares the existing microphone,
playback, lifecycle, and export integration. Signed demo recordings and receipts
are labelled as local demos with no independent requester; no additional Android
permission or native bridge is needed.

The shared app may use `window.NativeVault` when present:

```js
const saved = NativeVault.loadIdentity();
const error = NativeVault.lastError();
if (error) throw new Error(error); // Do not silently create a replacement identity.
// On first use only: generate the identity with Rust, then persist before capture.
if (!saved && !NativeVault.saveIdentity(newIdentityJson)) {
  throw new Error(NativeVault.lastError() || 'Identity persistence failed');
}

// Call from an explicit export action. Saves an exact copy without a share sheet.
const savedArtifact = NativeVault.saveArtifact(filename, mimeType, base64Bytes);
if (!savedArtifact) throw new Error(NativeVault.lastError() || 'Saving failed');
```

`loadIdentity()` returns a JSON string or `null`. `null` with no error means first
run. An existing identity cannot be silently replaced. Identity data is sealed
with an AES-256-GCM key in Android Keystore and stored in app-private no-backup
storage; cloud backup and device transfer are disabled. This protects software
signing material **at rest**. Signing material is accessible to trusted Rust/WASM
code while in use. This is **not hardware-backed signing or device attestation**.
Clearing app data or uninstalling loses the identity. There is no identity export
or reset UI.

Exports accept `image/jpeg`, `application/json`, `application/c2pa`,
`application/octet-stream`, or `text/plain`, up to 32 MiB decoded. WAV MIME types
(`audio/wav`, `audio/x-wav`, `audio/wave`, `audio/vnd.wave`) have a smaller 8 MiB
decoded limit and require a `.wav` filename. Filenames are sanitized. Each
artifact is retained in a unique app-private cache directory for bounded USB
retrieval. Android 10+ also saves an exact, hash-checked copy into
`Downloads/Non-verba`; API 26-28 uses a unique app-specific external Documents
folder, which Android removes on uninstall. Existing files are preserved. A
`true` result confirms the local save, not delivery to a requester. No share sheet
opens and no broad storage permission is needed. The OS may reclaim cached
exports; callers should retain evidence until the intended recipient receives it.
The API30 public-download path has physical coverage; the older fallback remains
untested on a physical device.

Use `<input type="file" accept="application/json">` for challenge/signaling import,
`accept="image/jpeg"` for photo verification, and the WAV MIME types for audio
verification. These open the system document picker; they must not supply live
capture input. The shared UI checks file size before reading and validates the
contents with Rust. It must reject WAV files above 8 MiB; native file selection
returns a content URI without parsing audio or trusting its claimed MIME type.

`getUserMedia({video: ..., audio: false})` requests camera access, while the shared
audio app requests microphone access. Only exact nonempty sets of WebView's
`RESOURCE_VIDEO_CAPTURE` and `RESOURCE_AUDIO_CAPTURE` are accepted, from the
bundled origin with a visible, resumed app document. Unknown resources, duplicate
resources, and partial OS grants are rejected. Android `CAMERA` and `RECORD_AUDIO`
permissions are requested only when needed. The normal `MODIFY_AUDIO_SETTINGS`
permission supports Chromium's audio-device paths; the shell does not change
volume or select a communication device. Microphone and camera hardware are
optional, so requester/verifier devices can install without them. There is no
background recording service.

Stop and clear streams, AudioWorklets, and playback on `visibilitychange`,
`pagehide`, and the `nonverba:pause` window event. The native host also pauses
attached audio/video elements and stops their tracks on Activity pause. The audio
page receives `nonverba:pause` during other permission overlays because its
microphone stream may have no media element. The initial native microphone
permission step has a narrow exception while no recording has begun; a full
Activity stop still cancels that session.
The shared UI must discard late permission/capture results after interruption.
The first attempt may need an explicit retry after the OS grants permission.
Resuming does not silently reopen either capture device. File picker/share-sheet
pauses must stop capture without needlessly losing imported pairing state.

Foreground `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` are requested
together. Android 12+ may grant precise or approximate access. WebView's generic
geolocation grant accepts either; the native evidence profile specifically
requires precise access and rejects an approximate-only grant. There is no
background location permission or foreground service. Location hardware is
optional so requester/verifier devices can install without it.

Only the bundled HTTPS origin in the foreground application document may obtain
a WebView location grant. Grants use `retain: false`; current Android permissions
are checked before granting, and stored origin grants are cleared. Android
remains authoritative if an OS permission is revoked. Camera, microphone, and location share
one runtime permission dialog slot: an overlapping web request is rejected, not
allowed to overwrite the pending callback. Permission results received while the
Activity is paused wait for resume. A normal pause disables geolocation; the
app's own runtime permission overlay may finish its pending request on resume.
A full stop/destroy always disables geolocation and cancels pending web grants.

`getCurrentPosition` has no cancellation API. The shared UI must discard late
location callbacks after `visibilitychange`, `pagehide`, or `nonverba:pause`
using its capture/lifecycle generation check. A system permission overlay can
affect page visibility differently across WebView versions; if it cancels a
capture attempt, explicitly retry after granting permission. Changing from
precise to approximate access in Android settings may restart the app process.
The browser profile remains explicitly distinct from native Android evidence.

## Native location evidence

The bundled pages can call `NativeLocation.capabilities()`, `begin(requestJson)`,
`status(sessionId)`, `cancel(sessionId)`, and `finalize(sessionId, jpegBase64)`.
Each method returns a JSON string. Collection and finalization are asynchronous;
the UI polls `status`, and supplies an empty JPEG string for standalone proofs.
No bridge accepts coordinates, observation timestamps, provider/mock claims,
arbitrary data to sign, or a caller-supplied image hash. Native failures do not
fall back to browser evidence.

Android owns each session's challenge anchor, observations, provider, simulated
location flag, fix time, callback receipt time, and permission state. GPS is
preferred; fused/network providers are permitted only by an `any` provider
policy. Cached, duplicate, delayed, and over-policy-accuracy fixes do not count.
A mock-marked fix fails the session. At least three distinct acceptable fixes
must span ten seconds; warm-up and collection have a sixty-second ceiling.
Horizontal accuracy is labelled with Android's 68% uncertainty semantics. Rust
enforces the request policy, monotonic and wall-clock consistency, sample
freshness, provider requirements, and plausible movement.

At `ready`, the trace freezes and a read-only selected fix is available to the
shared camera workflow for EXIF. The current APK obtains its image through
Camera2 and seals it with the selected native media key; browser capture uses
its browser path and software identity. Location finalization receives the exact
final JPEG bytes, computes their SHA-256 natively, and produces a separate COSE
Sign1 ES256 proof. Standalone location evidence has no JPEG binding. The location
proof records an application submission interval; native camera timing belongs
to the separately verified Camera2 acquisition assertion.
The selected fix must still satisfy the default five-second freshness limit at
final signing; slow capture/C2PA work fails closed and requires a new challenge
and collection attempt. Precise permission is checked again before finalization,
before signing, and before returning a completed proof, so a revoked grant cannot
finish a prepared session.

The native location key is a separate non-exportable Android Keystore P-256 key.
Its public identity is the SHA-256 fingerprint of its DER SubjectPublicKeyInfo.
An app-private public-key record prevents silently generating a replacement if
the previously provisioned Keystore key becomes unavailable or changes.
The location capture freezes its selected legacy or enrolled-generation key pin
at session start; enrollment and selection never replace older keys. Rust builds
the complete COSE signing input and verifies the returned Keystore signature
before exposing proof bytes. The Keystore adapter is not a JavaScript bridge.
The public native proof is transported in the shared JSON export envelope.

An app-private atomic replay ledger reserves a challenge ID before signing.
Cancellation or a failed signing attempt can consume that challenge; it cannot
be retried for a second proof. The ledger fails closed if corrupt or full
(4,096 entries); no silent pruning or reset is performed. Uninstalling or clearing
app data removes the ledger and key. Replay protection across reinstalls/devices
also requires requester/verifier state. Precise traces remain in session memory
until replaced or the process ends; they are not written into this ledger.

Pause/navigation cancels an unfinished session and removes location listeners;
an own native permission overlay may finish on resume, while a full stop always
cancels. A per-finalization signing capability checks that the session is still
active. Late worker results after cancellation are discarded. A page receiving
`nonverba:pause` must cancel its prepared session while C2PA sealing is pending.

This is an application-level boundary. It rejects injected coordinates from the
page and ordinary mock-provider locations, but is not hardware-attested
collection, trusted-clock evidence, proof of authentic satellite signals,
requester authentication, or resistance to a compromised OS/app. The base report
explicitly leaves hardware, collection, and camera-exposure attestation false.
Separate enrollment context can establish hardware key-generation claims bound
to the actual artifact signer; it does not establish the current collection path.
Verification must pin the expected native location public key independently.

### Optional raw receiver profile

The requester can require raw satellite measurements for standalone location or
the existing photo-plus-location workflow. `policy.raw_gnss` is absent from legacy
requests. When present it requires `profile: "native-required"` and
`required_provider: "gnss"`; the operator cannot downgrade this requirement.

`RawGnssCollector.kt` owns Android `GnssMeasurementsEvent` registration and field
extraction. `NativeLocation.kt` owns the session and its observation arrays; it
uses `NativeLocationCore.rawGnssProgress()` to ask the shared Rust validator
whether retained epochs are admissible and sufficiently complete. The collector
is not a JavaScript interface. The page cannot submit satellite fields, choose
which native events pass policy, or invoke the Keystore signer directly.

The base APK remains API 26-compatible. Raw evidence requires API 29+ and actual
receiver full-bias, elapsed-realtime and elapsed-time-uncertainty fields. An API
version alone is not a verified hardware capability. Android 10/11 registration
uses the existing AndroidX compatibility implementation to avoid the documented
Android R pre-QPR1 callback crash. API 31+ requests full tracking, and API 33+
also requests a one-second callback interval. `full_tracking_requested` is an
explicit request claim; full tracking is not assumed on older platforms or
asserted to have occurred. The adapter retains a one-second target cadence with
a version-defined 50 ms tolerance on every supported raw platform.

Native callback and receiver elapsed times share the location session's anchor.
Nanosecond integers are serialized as exact decimal strings, including signed
receiver time/full bias; they never pass through JavaScript floating-point
numbers. Satellite synchronization states, received time, pseudorange rate,
signal strength and available frequency/code/phase/gain fields remain native
observations. Optional receiver `timeUncertaintyNanos` is preserved as null when
absent; full bias and elapsed alignment uncertainty are mandatory.

Before the first admitted epoch, incomplete receiver warmup or insufficient
qualifying satellites increments a signed rejection count. GPS fixes do not
start the required coordinate window until raw acquisition is admitted. Once
started, lost mandatory fields, inadequate qualifying satellite counts or
clock discontinuities terminate the session. Rust checks actual duration,
satellite identity/quality, gaps, clock continuity, callback delay and alignment,
coverage of the coordinate window, and raw freshness at final sealing. Default
requirements include at least four distinct qualifying satellites per epoch,
at least three epochs spanning ten seconds and gaps no larger than 2.5 seconds.

The adapter keeps at most 64 epochs and 128 signal observations per epoch, with
4,096 warmup rejections and a 2 MiB trace/evidence JSON cap. COSE bytes have a
2 MiB plus 16 KiB cap. Overflow fails; data is not silently truncated. Ready,
cancel, error, timeout, pause and destroy paths unregister raw measurements as
well as location callbacks. No background service or extra location permission
is introduced. The existing key identity and replay ledger remain in use.

This base raw profile adds verifiable consistency checks. It does not collect
navigation messages, authenticate satellites or recompute position; those report
fields remain unverified. Version 0.5 separately provides
`verify_location_position` in Rust/WASM. Given independently retained navigation
JSON and a policy that pins its exact byte digest, it recomputes GPS L1 C/A
position and receiver clock bias and checks every retained epoch and reported
fix, including geometry and residual limits. It does not solve velocity,
authenticate navigation transport or radio signals, or provide a trusted clock.
There is no automatic navigation fetcher or RINEX importer. The verifier must
maintain the navigation input and GPS/UTC offset. Physical receiver tests remain
pending. See the [location policy](../../docs/sensors/LOCATION.md) and
[independent position profile](../crates/nonverba-core/src/location_proof/position/README.md).

## Challenged signing-key enrollment

The bundled enrollment page creates requester-bound media or location keys
through `NativeKeyEnrollment`. Every new challenge creates a separate immutable
v3 generation; its digest determines the alias/record name. Existing v1 capture
keys and original v2 enrollments remain intact. Repeating a challenge resumes or
exports its existing generation. Each purpose has 32 preserved slots, counting
pending records and orphaned aliases; no automatic deletion or replacement is
performed. Creating an enrollment does not select it for captures.

Capabilities list the public generations. `selectProfile` requires an exact key
pin, and `exportEnrollmentForKey` exports only that generation. Each capture
freezes its selected pin at start, including when another key is selected later.
Generation requires the foreground enrollment document; lifecycle cancellation
preserves any generated key and recovery record. The bridge cannot sign arbitrary
payloads. See the [native enrollment contract](../../docs/sensors/NATIVE_KEY_ENROLLMENT.md).

The requester independently verifies the attestation chain, original challenge,
arrival window, roots, current revocation snapshot and app/hardware policy with
the shared Rust/WASM verifier. Agent appraisal with context additionally binds
that enrollment to the actual evidence signer; composition requires both media
and location keys when requested. A passing supported hardware profile describes
the key and device claims at generation. It does not attest current OS/app state
or a later camera, microphone or GPS sample. Private test chains always leave
hardware trust false. Actual device chains and lifecycle behavior still require
physical validation; see [key attestation verification](../../docs/sensors/KEY_ATTESTATION_VERIFIER.md)
and [agent evidence appraisal](../../docs/sensors/AGENT_EVIDENCE.md).

## Audio host integration

Audio capture starts from an explicit operator action. The APK's native adapter
owns 48 kHz AAudio recording/playback and keeps the original PCM through Rust
verification and Keystore signing. Permission, foreground lifetime, built-in
routes, the pilot, sequential challenges and clock/frame continuity are checked
without accepting replacement PCM from JavaScript. An unavailable native profile
fails instead of falling back. Browser capture uses a user-gesture-resumed 48 kHz
AudioContext. Both paths bound recording to 30 seconds and preserve the same
requester protocol. Live device behavior and acoustic claims still require
physical testing; see [native audio](../../docs/sensors/NATIVE_AUDIO.md).

Manual offer/answer JSON pairs an ordered, reliable WebRTC datachannel. An empty
`iceServers` list supplies no STUN/TURN fallback: the peers need a working direct
network route, usually the same LAN. Client isolation, mDNS handling, host ICE
candidate exposure, and installed WebView versions can prevent pairing. No
native signaling or remote HTTP endpoint is added. Android's current target-SDK
36 policy grants local network access through `INTERNET`; upgrading the target
to 37 requires revisiting the new local-network permission. Browser peer tests
do not establish that the same ICE path works on physical Android WebViews.

## Device acceptance checks

Physical Android camera, location, microphone, and two-device acoustic tests are
pending. The APK build/lint does not substitute for these device checks:

1. Install the APK on Android 8+ with an updated Android System WebView; launch
   offline and confirm the Rust WASM module initializes.
2. Create/import a challenge. Deny camera permission and confirm capture stays
   disabled; retry with permission granted and capture from the rear camera.
   Also deny location, turn location services off, allow only approximate location,
   allow precise location, and change precision in settings. Capture must require
   a fresh native trace, reject approximate-only permission for that profile,
   and retain Android's reported accuracy and uncertainty semantics.
3. Background the app, open the system picker;
   confirm that camera use stops. Resume and explicitly restart preview.
   Background during the location permission prompt and during an outstanding
   location fix; verify no late callback enables capture or adds stale metadata.
4. Save the signed JPEG and verify the saved bytes with the browser verifier.
   On Android 10+ use Downloads/Non-verba; on Android 8-9 use the app-specific
   Documents/Non-verba folder (removed on uninstall). Save opens no share chooser.
   Confirm editing the JPEG invalidates verification.
5. Force-stop/relaunch and confirm the public identity fingerprint is stable.
   Confirm no identity plaintext is written to app files or shared exports.
6. Import a malformed/oversized challenge and JPEG; confirm an understandable
   rejection without changing the current identity.
7. Check portrait/landscape, keyboard, status/navigation bars, denied camera
   permission, absent camera hardware, and cancellation of the picker.
8. Open the audio page, deny microphone permission, grant it, and explicitly retry.
   Check an absent microphone, OS microphone privacy toggle, and a permission
   prompt interrupted by backgrounding. No late result may restart recording.
9. Pair two physical devices through the manual offer/answer files on the same
   LAN. Test the complete acoustic challenge, playback gesture, actual sample
   rate, WAV saving, and independent verification; test failed direct pairing
   without silently adding external signaling or relay services.
10. Background during audio playback/recording and open the system picker.
    Microphone tracks, worklets, and playback must stop. Import malformed and
    oversized WAV files and confirm a clear rejection without identity changes.
11. Collect outdoors on both supported ABIs, verify at least three distinct fixes
    span ten seconds, and inspect a standalone proof independently. Test cached
    fixes, provider disable, airplane mode, poor accuracy, and a mock provider.
    Mock-marked observations must fail rather than be omitted from a signed trace.
12. Cancel during collection, after ready, during C2PA sealing, and during native
    signing. Test timeout, concurrent sessions, replay after restart, and changed
    permissions. No cancellation may deliver a late proof or restart collection.
13. Capture a C2PA JPEG plus native sidecar and verify the pinned location key,
    request, selected EXIF fix, and exact JPEG hash. Change either artifact and
    confirm rejection. Deliberately delay finalization beyond five seconds and
    confirm failure. Upgrade from 0.2.1 and verify the photo/audio identity is
    unchanged while the native location key persists across relaunches.
14. Request raw satellite evidence on API 26-28, in a browser, without precise
    permission, and with GPS disabled. Confirm explicit refusal and no fallback
    to a coordinate-only proof. On API 29/30 and API 31+ phones, collect outdoors;
    inspect exact nanosecond strings, receiver capabilities, full-tracking request
    flag and the independent verifier's detailed results. An unsupported clock
    field or duty-cycled receiver must fail rather than invent that field.
15. Exercise cold receiver warmup and poor sky view. Confirm no GPS fix counts
    before the first admitted raw epoch, rejected warmup is counted, and both
    traces span the full requested duration. Then obstruct signals, disable GPS,
    revoke precision, background or cancel at each phase. Verify callbacks stop
    and a lost stream, broken clock continuity or insufficient coverage cannot
    produce a completed raw proof. Check nominal 1 Hz callback jitter without
    shortening the required ten-second span.
16. Verify raw standalone and photo-bound proofs after export to another device.
    Modify a satellite timestamp, sequence, signal or policy and confirm failure.
    Delay finalization until the last raw epoch is stale and confirm refusal.
    Exercise epoch/signal/JSON limits using controlled fixtures; confirm bounded
    rejection and unchanged key identity. These fixture checks do not replace
    physical receiver, lifecycle and replay testing.
17. Enroll media and location keys from independently retained requester
    challenges, verify their real certificate chains with independent trust
    settings, and explicitly select each exact pin. Restart the app and confirm
    the selection persists. Enroll another challenge and confirm prior keys,
    exports and any already prepared session retain their exact identities.
    Test cancellation during generation, resume of the same challenge, missing
    records and full capacity without silent replacement or deletion.
18. Run the separate position verifier on physical raw GPS L1 C/A proofs using
    independently acquired, pinned LNAV data and the capture-date GPS/UTC offset.
    Check every fix/epoch, stale navigation, poor geometry and deliberate input
    changes. Passing synthetic solver tests does not establish receiver support
    or authentic physical location.

Version compatibility references: [Kotlin Gradle compatibility](https://kotlinlang.org/docs/gradle-configure-project.html),
[AndroidX WebKit releases](https://developer.android.com/jetpack/androidx/releases/webkit),
[AndroidX Core releases](https://developer.android.com/jetpack/androidx/releases/core).

Location permission references: [Android runtime location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions/runtime),
[WebView geolocation callback retention](https://developer.android.com/reference/android/webkit/GeolocationPermissions.Callback).

Raw GNSS references: [Android raw measurements](https://developer.android.com/develop/sensors-and-location/sensors/gnss),
[receiver clock fields](https://developer.android.com/reference/android/location/GnssClock),
[measurement fields](https://developer.android.com/reference/android/location/GnssMeasurement),
[full tracking request](https://developer.android.com/reference/android/location/GnssMeasurementRequest.Builder),
[AndroidX callback compatibility](https://developer.android.com/reference/androidx/core/location/LocationManagerCompat).

Audio/network references: [WebView permission resource allowlisting](https://developer.android.com/reference/android/webkit/PermissionRequest),
[Chromium Android audio manager](https://chromium.googlesource.com/chromium/src/media/+/master/base/android/java/src/org/chromium/media/AudioManagerAndroid.java),
[Android local network permissions](https://developer.android.com/privacy-and-security/local-network-permission).

# Unified repository validation

## Sign-in devices and attestation integration — 22 October 2026

The participant sends a fresh account/session-bound device possession proof at
sign-in. Android supplies a dedicated Keystore attestation chain, while the
browser supplies an explicitly unverified in-memory WebCrypto key. The shared
Settings → Devices inventory includes unknown-device sessions and individual
server-side session sign-out. The existing work-key tuple remains unchanged.
See [the feature contract](PARTICIPANT_SIGNIN_DEVICES.md).

This initial checkpoint used document-memory browser keys. The later
[automatic browser continuation](#automatic-browser-attestation-effort--22-october-2026)
below records the owner-selected persistent-key improvement and its own checks.

Managed checks passed: 91 public account/relay/workspace/package unit cases,
15 connected and 16 shell Chromium groups, the pure Kotlin challenge/DER/JCA proof harness,
participant assembly/lint and actual APK signature verification. The private
backend passed six retained-fixture database tests, four focused unit cases,
its locked regression suite and warning-denied all-target Clippy. Runtime is
235206 bytes across the same eleven files, under the reviewed 240 KiB guard;
image and APK limits are unchanged. No new dependency was added to the app.

The running service was migrated and only its API/worker reloaded, preserving
the database, object storage, viewer, tunnel and retained records. The owner
approved a separately pinned development attestation policy. The live shared
client/relay test registered a real browser key, grouped two sessions under that
key, revoked the other session and confirmed that it lost access. Existing
synthetic confirmation, password, sign-out and recovery regressions passed.
Readiness checks and the protected tunnel remained available afterward.

The policy and verification path are active; no phone was installed or used to
claim successful hardware attestation. Browser tests and synthetic chains do
not establish hardware, current OS/process state, physical identity, real
mailbox delivery or production readiness. Email delivery remains mocked.


The consolidation was prepared from the current source working trees on
2 October 2026. It retains the public Git history and imports reviewed application
source without private Git history, personal captures, operational journals,
credentials, or build artifacts. Canonical synthetic regression inputs are
retained separately with byte-length and SHA-256 provenance.

Checks run inside the existing managed Debian development container. Its
immutable identity, image, original bind mount, named volumes, loopback ports,
GPU configuration, and restart policy were preserved. Unified source runs from
an explicit snapshot rather than the original private checkout. No Windows
compiler, Java runtime, phone install, or physical sensor capture is part of
these checks.

## Shared map component — 10 October 2026

Added an isolated shared map controller, geometry/access policy, tile-source
port and Canvas viewport, with a browser inspection entry. Initial coverage is
Norway mainland/coastal municipalities, including administrative coastal waters;
Svalbard and Jan Mayen are excluded. Kartverket's simplified illustration
snapshot is attributed and recorded with its source digest. It is display
geometry, not an exact border, account authorization or evidence verification.

Focused checks ran in the preserved managed Debian container using the public
source snapshot bridge:

- 14 map component tests passed: projection, holes/islands, cached containment,
  Norway coastal locations and remote exclusions, active-deployment/requester
  policy, explicit operator grants, atomic input rejection, access revocation,
  permanent position expiry after backward clock changes, bounded inputs and
  explicit same-origin/provider URL rules.
- 2 test-catalog checks and 11 existing Android package-parser checks passed.
  Android staging and verification source exclude the browser-only map entry;
  no APK build or package verification was performed for this component task.
- 8 real Chromium checks passed against the source entry: no default provider
  or sensor requests, synthetic overlays and access changes, pan/zoom/keyboard,
  opt-in OSM request scope/attribution/Referer, mobile layout and strict CSP,
  actual browser HTTP cache reuse, mixed-winding polygon union/true holes,
  pending-source cancellation and idempotent teardown.
- Desktop and mobile screenshots were visually inspected. Geographic data,
  controls, positions and attribution render without overflow; overview labels
  are omitted and detailed labels remain readable outside the country clip.
- Whitespace checks passed; the private reserve was unchanged.

Browser tile responses were synthetic local fixtures; the checks contacted no
external tile provider and acquired no physical sensors. The inspection page
opens offline coverage by default, with deliberate browser-only OSM streets.
There is no deployed curated tile service, continuous operator tracking feed,
routing engine, Android map route or exact operational coverage mask. See
[the composition and country pipeline](MAP_COMPONENT.md) for these boundaries.

## Private reserve and recovery record

The completed consolidation made this public repository the active home of the
protocol, sensor core, Android application, browser UI, tests, tools and docs.
The five Rust packages share the workspace and lockfile while retaining their
interfaces. The simulator browser interface and JavaScript model use the same
cooperation core; their folders are parts of one simulator.

The sibling private reserve tracks `README.md`, `.gitignore` and `.gitattributes`.
Its original Git history remains intact; future authored private work remains
trackable. Ignored compatibility files and existing records stay at their
original paths: the limited `code/dev.ps1` bridge, four approved USB/staging
helpers with the verified Google transport files, and `code/artifacts/` evidence,
signer reports and older packages. The reviewed
[compatibility bridge](../../code/container/private-repository-bridge.ps1) accepts
only `Up` and `Status` for the pinned existing container. Development uses the
[public snapshot procedure](CONTAINER_MIGRATION.md).

Three stale private research drafts matched existing recovery copies and were
removed from the live private checkout; their newer public versions were
preserved. Concurrent public terminology work remained outside the consolidation
commits. The original container, bind, image, volumes, loopback ports, GPU
configuration and signer were preserved. Compatibility copies extend no phone,
wireless or Windows toolchain authorization.

The dated local recovery archive retains authored source, private notes,
working-change patches, signing/user files and original inventory records. At the
owner's explicit request, 22.1 GB of reproducible outputs, obsolete host
SDKs/toolchains, caches and old generated packages were deleted; about 88.5 MB
remained after that pruning. Its `cleanup-record.json` identifies intentionally
removed paths. The original manifest and verification describe the earlier
complete inventory. Those measurements and deletions are historical, not new
checks or cleanup performed by documentation curation.

The archive remains private recovery data, not an active checkout or publication
input. Do not expand it, execute obsolete tools or restore stale drafts over
concurrent work. The [working boundaries](../../AGENTS.md) retain the current
source, artifact, container and itemized-cleanup rules. No physical sensor testing
or package export was part of the final repository cleanup below.

## Initial source-unification checks — 2 October 2026

| Check | Result |
| --- | --- |
| Main Rust workspace | Offline locked metadata and tests passed: cooperation, evidence core and Android JNI crate |
| Assignment and dispute workspaces | Offline locked tests passed; the independent Rust/Node signature and HMAC interoperability test also passed when explicitly enabled |
| Rust formatting | All three workspace checks passed |
| JavaScript syntax | Published JavaScript modules passed `node --check` |
| Cooperation WASM and example | Real compiled module, 88 JavaScript tests and the runnable example passed |
| Evidence WASM and Linux JNI | Build, synthetic JNI camera/audio/GNSS harness and native/WASM checks passed |
| JavaScript integration | 443 adapter, storage, session, policy, packaging and release-notice tests passed |
| Assignment WASM | Build and all 27 native/WASM parity cases passed |
| Cooperation browser and simulator | Real Chromium/module Worker checks and simulator checks passed |
| Camera browser | All 25 real Chromium checks passed, including location-only permission revocation, media-track shutdown, expiry, cancellation and replay refusal |
| Location browser | Passed against the built evidence application |
| Homepage export | Exact ten-file export and byte-identical AGPL/Primer notices verified |
| Browser release package | Archive contents and license/source notices verified |
| Android | Web assets staged; native libraries built for arm64-v8a and x86_64; `assembleDebug` and `lintDebug` passed |
| APK inspection | Libraries, assets, version, source/license notices and independently retained debug signer baseline verified |
| Publication review | Source namespaces, Markdown targets and source/key/artifact exclusions checked; all 49 migrated synthetic fixture hashes and lengths matched |
| Original checkout | Imported source hashes unchanged; original private checkout, Git history and uncommitted work preserved |

The camera suite initially stalled because `clearPermissions()` revoked camera
permission as well as location, ending the live track and disabling capture.
The test now checks that shutdown separately and uses an isolated Chromium
permission override to exercise location-only refusal. Both paths retain the
no-signing and unused-challenge assertions. The production capture code was
unchanged.

Three optional Rust checks were not run: the complete external IGS daily archive
import and two opt-in real-model dispute probes. They require separately
retained data or a provisioned pinned model/runtime. Synthetic importer and
mock-runtime tests passed; this is not a claim that a real dispute model was
validated. Android lint/build also reports existing Gradle deprecations for a
future Gradle 9 migration.

## Single Cargo workspace and final cleanup — 2 October 2026

The five Rust packages now share `code/Cargo.toml` and `code/Cargo.lock`.
Focused checks reused one public-source snapshot in the same managed container
and its existing build cache. The snapshot also captured concurrent assignment
terminology edits; those edits remain outside the consolidation commits.

| Check | Result |
| --- | --- |
| Workspace metadata | Offline locked metadata resolved all five members in one workspace |
| Native Rust tests | `cargo test --offline --locked --workspace` passed for all five members; optional checks remained opt-in |
| Historical prompt replay | The existing version-1 failed-record replay passed with combined workspace dependency features |
| Retained signing review | All five workflow acceptance tests passed with `serde_json/preserve_order` explicitly enabled |
| WebAssembly libraries | Offline locked `--lib` checks passed for core, cooperation and requests on `wasm32-unknown-unknown`; terminal binaries are native |
| Rust formatting | `cargo fmt --all --check` passed in the shared workspace |
| Dependency pins | Existing root-lock dependency versions and checksums were preserved; the separate protocol packages and required dependencies were added |
| Private reserve | Clean index with only README, ignore rules and text attributes; original history and ignored operational files retained |
| Documentation | Reviewed local Markdown targets resolve against the publication index and the new GPS preparation guide; scoped whitespace checks passed |

Combined dependency features exposed JSON key-order changes in historical
dispute prompts and terminal consent previews. Local formatting now sorts object
keys explicitly, preserving the original presentation while leaving signed
content, canonical hashes, schemas and fixtures unchanged. Existing assertions
continue to check historical replay and that retained content was displayed.

The optional external-data, real-model and interoperability probes retain their
explicit opt-in behavior. Existing `generic-array` deprecation warnings remain.
This final cleanup did not build Android, export packages, install an APK or
capture physical sensor data. The initial broader checks above are historical
evidence, not repeated checks for this workspace change.

## Architecture cleanup — 8 October 2026

Completed the five priorities from the architecture review while interface work
and physical two-device trials remain deferred:

- Android lifecycle cleanup revokes all native authority before independently
  releasing resources and always reaching framework lifecycle completion. Failed
  camera, location and GNSS releases retain ownership for retry; delayed Camera2
  callbacks enter the same cleanup path. Optional GNSS status startup still does
  not refuse a proof. Cleanup diagnostics remain unsigned.
- `web/shared/audio/audio-controller.js` owns the live audio protocol without DOM,
  storage or platform imports. The page supplies capture, transport, persistence,
  clock, lifecycle and rendering adapters. Challenge ordering, immediate arrival
  timestamps, deadlines and guarded acceptance retain their existing behavior.
  Disposal attempts every resource even after individual release failures.
- Sensor verification, appraisal and evidence-session composition use typed
  Rust reports. Existing JSON/WASM/JNI presentation boundaries and signed formats
  remain compatible, including optional fields and report key ordering.
- Camera now uses the shared worker client. Terminal worker failures and disposal
  reject pending and future calls; individual operation errors remain recoverable.
  A failed message dispatch removes its pending entry.
- The explicit Node catalog covers 45 files: 44 `node:test` harnesses and the
  existing AudioWorklet assertion script. It rejects missing, duplicate and
  unregistered tests. Default testing now includes the 28 previously omitted Node
  harnesses, with evidence/cooperation WASM prerequisites and explicit USB guard
  arguments. Session JPEG input is a reviewed unsigned source fixture.

Related checks reused the preserved managed container and one source snapshot,
`/tmp/nonverba-unified-source/011c3db4985d4c61847203d0352a8f15`.
Only the task's subsequent source fixes were synchronized into that snapshot.
Logs are under its `code/artifacts/qa/architecture-cleanup-20261008/`; camera
browser artifacts are under its `code/artifacts/qa/`.

| Check | Result |
| --- | --- |
| Rust workspace | 556 tests passed; four existing opt-in checks remained ignored |
| Core and Android Clippy | All targets passed with warnings denied |
| Evidence and cooperation WASM | Release builds passed with the existing locked dependencies |
| Registered Node groups | 970 tests passed: 758 unit, 115 evidence, 88 cooperation and nine transport guards |
| Android source compilation | `compileDebugKotlin` passed after final GNSS ownership changes; native/assets packaging prechecks were excluded for this source-only compilation |
| Native lifecycle helpers | 58 cleanup/retry checks, 56 microphone lifecycle checks and 699 existing session/diagnostic checks passed |
| Real Chromium audio | All 24 WebRTC/AudioWorklet/Rust/C2PA checks passed with a synthetic acoustic loopback |
| Real Chromium camera | All 25 capture/verification/acceptance checks passed with synthetic video and geolocation |
| Real Chromium audio acceptance | Six signed-audio/IndexedDB cancellation, race, reload and replay checks passed |
| Scoped Rust formatting and whitespace | Task-owned Rust formatting and source whitespace checks passed; existing formatting differences in `location_attempt.rs` and `location_attempt_tests.rs` were preserved |

Expanded testing exposed an outdated camera page-test dependency and an audio
pairing wait bounded by polling count rather than elapsed time; both harnesses
were corrected. Real browser validation also caught the extracted default clock
calling platform timers with the wrong receiver. Timer adapters now preserve the
platform invocation, with a focused regression test. Failed first-run logs remain
alongside the passing follow-up checks; only the affected groups were repeated.

This is software validation. Synthetic browser input and Linux JVM helpers do
not establish physical sensor operation or complete the deferred two-device
requester/operator trials. No APK installation or physical capture was needed.

## Running related checks

Run commands from `code/` inside one managed source snapshot. See
[the migration guide](CONTAINER_MIGRATION.md) for preserving generated outputs
between related commands. The aggregate `node --run test` covers the Rust
workspace and every registered Node test group below. Extended native/WASM checks
need synthetic fixture generation first:

```sh
node tools/build/build-web.mjs
bash crates/nonverba-android/tests/run-jni-smoke.sh
node test/integration/native-wasm-node-tests.mjs
```

The Node catalog is explicit in `code/tools/test/test-suites.mjs`. Every Node test
must belong to exactly one prerequisite group; running any group rejects a new
unregistered test or a missing catalog entry. The existing AudioWorklet assertion
script is also registered. Individual groups can be run inside the same snapshot:

| Command | Prerequisites and scope |
| --- | --- |
| `node --run test:unit` | Source-only adapters, page orchestration, worker lifecycle, package guards and test catalog |
| `node --run test:evidence` | Builds the evidence WASM/web assets; sensor sessions, requester storage, acceptance guards and headless audio controller |
| `node --run test:cooperation` | Builds cooperation WASM; protocol and simulator model checks |
| `node --run test:transport` | Runs reviewed USB shell-template guards against synthetic Linux files; no ADB or device access |
| `node --run test:javascript` | Unit, evidence and transport groups, including their prerequisites |

Camera session Node tests use the reviewed unsigned RGB ramp in
[`code/test/fixtures`](../../code/test/fixtures/README.md), signing fresh evidence
in Rust/WASM. They do not require ignored JNI output. Standalone browser tests,
JNI cross-runtime fixture scripts and physical-device trials keep their separate
documented setup; they are not silently included in the source-only group.

Browser checks use the managed Playwright installation and a running preview
of the built application:

```sh
export NONVERBA_PLAYWRIGHT_PATH=/opt/nonverba-tools/browser-tests/node_modules/playwright
export PLAYWRIGHT_BROWSERS_PATH=/opt/nonverba-tools/browser-tests/browsers
export NONVERBA_TEST_URL=http://127.0.0.1:4173
# Keep this running in another shell in the same snapshot:
NONVERBA_BIND=127.0.0.1 NONVERBA_PORT=4173 node tools/preview/serve.mjs
# Then run the browser checks from that snapshot's code directory:
node test/browser/browser-tests.mjs
node test/browser/location-browser-tests.mjs
```

These checks created synthetic artifacts and development packages only in
ignored container scratch storage. No APK was installed on a phone or released
as a binary. Development package source notices identify the base revision,
dirty state and source-snapshot digest; distribution requires complete
corresponding source for the exact package. Signing vaults and the independently
retained signer report were not imported into public source.

Software tests do not establish physical sensor authenticity, model reasoning
quality, fairness, payment finality, or a deployed multi-party service. Read
[sensor limits](../sensors/SECURITY.md),
[assignment assumptions](../requests/THREAT_MODEL.md), and the
[physical-device checklist](../sensors/DEVICE_ACCEPTANCE.md).

## Isolated authentication and work privacy — 8 October 2026

Implemented the [independent developer components](AUTHENTICATION_AND_WORK_PRIVACY.md#developer-inspection-implementation)
without adding login prerequisites to the existing inspection app. Facial
recognition, liveness validation, registration verification and real account
coordination remain deferred. The browser-only inspection defaults to synthetic
capture and offers a separately selected, temporary local camera photo adapter.

Checks ran in the preserved managed Debian container, using a unified source
snapshot and bounded updates of the task's inspection script and browser test:

- Formatting checks passed for the two new Rust policy modules. The focused
  Cargo filters passed all 12 distinct authentication/privacy tests; the
  authentication camera test is selected by both filters.
- Focused Node checks passed 29 cases: 16 authentication/camera lifecycle cases,
  11 privacy controller cases and two test-catalog checks. These exercise pending
  acquisition, late callbacks, duplicate operations, expired authority, failed
  cleanup, stale resumes and replacement of terminal authentication results.
- The web build passed. Ten Chromium scenarios used the actual Rust/WASM Worker
  and inspection UI. They exercised both authentication modes, permitted reuse,
  fresh/wrong-account/simulation rejection, camera-only exceptions, disconnected
  device uncertainty, normal/silent notification policy, photo cleanup, mode
  changes, reload without restored operations and browser-only navigation.
- Optional camera checks used a canvas-generated MediaStream; no physical
  camera, microphone, GPS, phone operation, face recognition or deployed account
  service was used. Desktop and narrow browser layouts had no horizontal overflow.

The final browser check waits for asynchronous notification results before
asserting their disposition. Inspection clock offsets persist with work state,
so an explicit resume after advancing fixture time and reloading remains usable
without reviving prior grants. No APK or release archive was produced.

These checks establish isolated policy and orchestration behavior. They do not
establish identity authentication or global sensor blocking in the existing
developer app. Actual-app integration, native enforcement and real multi-device
transport need their separately scoped implementation and validation.

## Isolated registration pipelines — 9 October 2026

Implemented the [Operator and Requester registration inspection](REGISTRATION_PIPELINES.md)
as a separate reusable workflow, preserving direct access to developer tools.
Personal details, optional private disability/accessibility support information,
self-reported certifications and privacy choices prepare a page-memory record
only. Account creation, authentication, identity/certification verification,
publication and account/device services remain unimplemented.

Checks ran in the preserved managed Debian container using source snapshot
`/tmp/nonverba-unified-source/c38c39d5bf604abd9b66c50c32b4c76f` and one bounded
browser-harness correction in that snapshot:

- Six Rust policy tests passed for both roles, optional information, review and
  deliberate preparation, acknowledgments, public field allowlisting, bounded
  field/date validation and rejection of imported verification claims. The new
  Rust module was formatted inside Debian and copied back as that exact file.
- Sixteen Node checks passed: fourteen adapter cases and two test-catalog cases.
  They cover review invalidation, copy-only draft access, reset, current failures,
  late success/rejection and concurrent replies. No synthetic adapter verdict is
  treated as an actual identity decision.
- The web build and eleven compiled-WASM Chromium scenarios passed. They cover
  both guided roles, skipped optional information, malformed personal details,
  privacy defaults and public projection, imported trust claims, safe rendering,
  re-review after editing, reset across delayed real Worker replies, departure/
  return, reload, native exclusion and narrow layouts. The first run completed
  every scenario but exposed a harness initialization error on `about:blank`;
  guarding absent browser APIs corrected that error. The final run had no page
  errors or external requests.
- Ten authentication/privacy browser regression scenarios passed against the
  same built Worker, including the updated developer navigation. Camera checks
  used synthetic canvas streams, not physical sensors.
- The tested snapshot now serves registration and the existing tools through
  the documented loopback-only preview on port 4173. Desktop and mobile form
  screenshots using synthetic details were visually inspected. No APK, release
  archive, provider connection, personal capture or phone operation was produced.

Independent source review found and corrected a reset race: an older action's
completion cannot decrement the busy state or replace the status of a new action.
Discarded requests cannot restore private details or a prepared result. Page
departure clears the draft and DOM and closes its Worker; browser cache restoration
starts a new empty workflow. No personal browser storage or sensor calls occurred
in registration checks. Local component readiness does not establish the future
account services listed in the roadmap.

## Selected Operator face components — 9 October 2026

Implemented the isolated [Operator enrollment and comparison pipeline](OPERATOR_FACE_PIPELINE.md).
Operator registration has a sixth, deliberate face reference step; Requesters
retain five steps and use no face model, camera or biometric reference store.
Registration identity verification, account authentication and work authorization
remain separate. Existing developer tools still require no registration/login.

Validation used the preserved managed Debian container and source snapshot
`/tmp/nonverba-unified-source/ab75200133a641caabd2b29922c3291b`, with bounded
task-file corrections in that same snapshot. An initial archive attempt refused
a concurrently changing test file before creating a source snapshot. The new
model manifest initially fell outside the source allowlist; the launcher now
includes that exact authored JSON file, without copying model/dependency caches.

- All 26 distinct focused Rust tests passed: six face policy, six authentication,
  seven registration and seven work privacy cases. The authentication filter also
  selects one work privacy case. The three task-owned Rust modules were formatted
  inside Debian and copied back individually.
- All 78 workflow/catalog Node tests passed: 22 authentication/camera, 19 face
  workflow/geometry/runtime cleanup, 24 registration, 11 privacy controller and
  two catalog cases. Review corrected stale comparison retention and model-load
  generation races. Additional checks reject a changed reference or cancelled
  authentication while a requirement assessment is pending.
  Final focused face checks also cover changed references after capture review,
  another deliberate deletion action after a changed displayed reference, and
  delayed deletion lookups after a newer operation.
- Three real-cache preparation tests passed. All 16 source/model/runtime/notice
  files matched pinned sizes and SHA-256; the npm archive also matched SHA-512.
  Deterministic external-data inlining and the separate YuNet 640-to-320 metadata
  transformation reproduced their pinned bytes and graph interfaces.
- Actual ONNX Runtime Web 1.23.2, single-thread CPU WASM inference showed zero
  difference on synthetic tensors for source external-data versus inline encoder,
  and each paired output versus its duplicated single-image input. The retargeted
  detector returned all 12 finite outputs at the expected stride counts.
  This is not independent reproduction of the PyTorch checkpoint export.
- The web build and 32 Chromium scenarios passed: eight selected-model checks,
  12 registration scenarios and 12 authentication/privacy regressions. They use
  the real Rust/WASM Worker and, in the selected-model suite, the real pinned
  CPU encoder/detector. Synthetic inputs exercised encrypted reference retention,
  exact-ID deletion, unreadable ciphertext recovery, missing model/reference,
  match/nonmatch/unset threshold, role separation and camera cleanup on all stop
  actions and lifecycle pause. A browser fetch receiver binding and a stale test
  selector were corrected during these checks.
- The maintained localhost preview serves the tested registration route and
  pinned runtime module with HTTP 200. Runtime `.mjs` responses have JavaScript
  MIME and `nosniff`; production script/style CSP remains strict.
  Chromium also loaded the real encoder through that maintained preview and
  produced 128D features from a synthetic constant tensor with no page errors.
  Desktop and narrow Operator enrollment screenshots were visually inspected;
  no horizontal overflow or clipped controls were found.

All camera streams and model inputs used synthetic data. No real person,
physical camera/microphone/location, phone operation, account service, APK or
release archive was involved. Features matching do not establish legal identity,
liveness, trusted capture, genuine authentication or work authority. Threshold
calibration, low false-match reliability, accessibility coverage, older-phone
latency/RAM/battery and actual-app privacy enforcement remain unmeasured.

## Web source and packaging boundaries — 21 October 2026

The owner requested an aggressive source reorganization before further web
work. All 82 files formerly in the flat browser source directory now live in
`web/apps/non-verba-dev/src/<feature>/`, `web/shared/<capability>/` or
`web/inspections/<feature>/`. Participant, simulator, homepage and dashboard
remain separate interfaces. The web architecture guide and local instructions
record placement and maturity boundaries; imports, package/build consumers,
tests, licensing references, documentation and dashboard evidence links follow
the new source paths.

`web/assets.json` explicitly maps sources to the existing flat runtime URLs.
The build validates source coverage, local dependencies and application
boundaries. Android uses `web/dist-android/` and the closure of its six supported
developer documents; unmarked inspection links cannot expand that document set.
The obsolete Android exclusion-list helper was removed. Staging still preserves
and reports unexpected generated files. Browser packaging and independent
verification now reject unknown outputs and incomplete/altered pinned model
assets or notices; a wholly absent model remains a supported unavailable state.

Validation ran in the preserved managed Debian container:

- Final JavaScript groups: 880 unit, 115 evidence, 17 transport and 31 build-process
  checks passed (1,043 total). Three additional selected-model preparation checks
  passed against the existing pinned dependency cache.
- Browser and Android web builds passed with the existing Rust/WASM toolchain.
  Exact Android staging passed. Browser selection contains 82 authored assets;
  Android selection contains 58, excluding 24 browser-only assets. The emitted
  authored content is 858,219 bytes for browser and 565,474 bytes for Android,
  about 293 KB less authored content in the Android selection. These are web
  asset measurements, not APK size measurements.
- Final emitted source assets for both targets were byte-identical to the
  earlier browser-tested source snapshot. The complete real browser output,
  including pinned model/runtime files and notices, passed the export closure
  assertion without creating a release archive.
- Real Chromium checks passed for camera (25), audio (24), audio acceptance,
  location, live location, registration (12), authentication/privacy (12),
  selected Operator face components (8) and maps (8). Sensor/camera/audio inputs
  were synthetic. The live-location harness now uses the installed Chromium
  or an explicitly supplied browser executable instead of assuming Windows Edge.
- Maintained regressions exercise unknown/missing/orphan sources, forbidden
  dependencies, stable URL rewriting, an accidentally unmarked inspection link,
  Android exact assets, source freshness and unknown/partial/tampered browser
  export contents. Whitespace checks passed.

No dependency installation, new container, cache cleanup, APK assembly/export,
phone operation, backend integration or release deployment was part of this
source/asset-boundary checkpoint. Existing concurrent Android and dashboard work
was preserved. The dashboard was refreshed after updating its evidence paths
and recording this scoped milestone.

## Named application UI sources — 21 October 2026

The owner asked to make the distinction between application identity and
platform packaging explicit. The live developer and participant UI sources
were moved to `web/apps/non-verba-dev/src/` and `web/apps/non-verba/src/`.
Each named application has one HTML/CSS/JavaScript UI source for browser and
bundled Android WebView use. Its Android host stays in `code/android/app/` or
`code/android/participant/`; this reorganization creates no parallel native UI,
new participant service or deployed web client. `web/shared/`, inspections,
simulator, homepage and dashboard retain their separate responsibilities.

Current Hx10 edits were preserved. A pre-move managed source snapshot captured
emitted asset fingerprints after the concurrent automatic-screen-awake source
change. The follow-up snapshot proved exact output-name and SHA-256 equality
for all 81 browser assets, 57 developer Android assets and four authored
participant assets. The changed counts from the earlier cleanup reflect Hx10's
removal of the developer screen-awake JavaScript UI, not lost source during
this folder move. Generated license/source notices were excluded from that
cross-snapshot byte comparison because their provenance intentionally differs.

Validation in the preserved managed Debian environment passed:

- 879 unit checks and 31 build-process checks, including source coverage,
  dependency direction, source/package freshness, participant workspace and
  exact asset selection. Fixtures and source imports use the named app paths.
- Both browser and developer Android web builds; exact developer and participant
  asset staging. The current participant workspace bytes remain unchanged.
- The participant browser check groups and all nine developer/inspection entry
  pages in Chromium, with no uncaught errors or failed requests.
- Documentation link checks across 15 architecture/source documents, no old
  application source directories or consumer paths, and whitespace checks.

App/source/Android-host mappings are documented in `web/apps/README.md`, the
web/root guides, local instructions and the Android guide. Runtime URLs,
Android package IDs, native host modules, production CSP, existing build
outputs/caches and Hx10's separate APK/phone work remain preserved. This task
performs no APK assembly/export, phone operation or deployment. The dashboard
was regenerated after updating its source evidence and this scoped record.

## Source ownership and maintenance cleanup — 21 October 2026

The owner authorized the wider structural cleanup after reviewing the source
audit. The implementation map is now `code/README.md`; current development
procedures are indexed separately from dated evidence in
`docs/development/README.md`.

- Moved 49 public tools into build, device, evidence, preview, provision and
  test directories, and 96 formerly top-level test/support files into explicit
  prerequisite/browser/integration owners. Package scripts, imports, launchers,
  publication helpers, fixture copies and current documentation/evidence links
  follow the new paths. The approved original private USB transport stays at its
  existing path.
- Moved pure Kotlin platform harnesses under `code/android/tests/platform/`;
  actual JNI integrations remain with their Rust crate. Developer assets and
  JNI libraries now stage into managed `app/build/generated/` source sets.
  Retained legacy generated source directories are preserved and excluded from
  packaging. The snapshot launcher explicitly includes the two authored
  `tools/build` and `test/build` directories while excluding generated builds.
- Split runtime database/byte primitives, encrypted identity vault, capture
  reservation/acceptance, unsigned location diagnostics and verified location
  presentation by owner. The deployed `nonverba-camera-v1` database remains at
  version 2 with the same stores, records and encryption keys. Audio/camera no
  longer import location for generic codecs. The catalog now covers 86 browser
  authored assets and a 62-asset developer Android closure, with stable app URLs.
- Centralized Chromium/package/executable selection and preview URL defaults in
  `code/test/browser/harness.mjs`. Specialized media/server fixtures remain
  independent. Corrected the combined camera/location cancellation fixture to
  observe concurrent acquisition rather than wait for sequential-only status
  text; the test holds real geolocation delivery before checking cancellation.
  Reformatted the compressed common and registration CSS with whitespace-only
  edits.
- Replaced the 3,484-line priors-study entry with a 99-line paused-status and
  ownership guide. The entire previous body is preserved byte-for-byte in the
  same-directory `HISTORY.md`, SHA-256
  `425b854298aa4b91060b740f040ce63c6139c61f30794c1846df7d5acb47355a`.
  All 48 previous section anchors and 25 Hero 4 evidence fragments remain
  reachable. Frozen experiment files, lineage and owner-pause state stay intact.
- Corrected current screen-awake guidance/evidence and public/private ownership
  overviews. The active private backend remains private and has its separately
  authorized workspace/environment.

Validation used the preserved managed Debian container, principally source
snapshot `/tmp/nonverba-unified-source/548d10e418924c9797e41755c6cefa9b`.
The narrow camera/location test correction and optional GPS runner preflight
were copied into that same snapshot for their focused follow-up checks.

Passed: syntax for all JavaScript test/tool modules; registered unit, evidence,
transport, build-process, cooperation and face-model groups; all ten moved Kotlin
platform runners; 71 self-contained JNI smoke checks; both browser/Android web
builds; both APK assembly/lint targets. The exact closed APK asset sets matched
managed staging byte-for-byte: 74 developer files and 12 participant files,
including notices, with no extra legacy staged assets.

Twenty Chromium scripts passed: camera, audio, atomic audio acceptance,
location, live location, enrollment, trust, evidence sessions, combined camera/
location, raw GNSS, JNI camera/audio verification, RINEX import, map,
registration, authentication/privacy, face pipeline, participant workspace,
cooperation browser/worker smoke and simulator. These use synthetic inputs and
do not establish physical acquisition, hardware trust or connected services.

The existing public trust-fixture Rust export prepared enrollment inputs.
The optional GPS-attempt JNI success flow needs an existing raw snapshot and has
no maintained generator; its missing/extra-argument and missing-file refusal
guards passed without compiler setup. No success claim is made for that optional
fixture-dependent flow.

Documentation review resolved 766 local file links and 136 fragment links across
107 non-frozen Markdown files. Research history hash/anchor checks and whitespace
checks passed. Current instructions enforce the new ownership boundaries.
Routine Android build records stay inside the managed snapshot; no package was
exported, installed or deployed, and existing local data/caches remain preserved.

## Participant navigation without URL state — 21 October 2026

The participant UI now uses navigation buttons and same-document history state.
Views, drawers and drafts do not enter URL paths, queries or fragments. Startup
ignores and removes incoming query/fragment values and reload opens Home with
empty drafts. Android removed its document-fragment exception and accepts only
the plain bundled document; the shared six-asset runtime remains closed.

In the managed Debian container, 22 focused package/workspace checks and 13
Chromium groups passed, including unchanged URLs during draft/review actions,
drawer dismissal, Back/Forward, reset and reload. Browser coverage combines
actual controls for current draft actions with explicit synthetic history
restoration for legacy list/example views without a current menu entry.
Participant assembly/lint passed in 27 seconds (15 tasks executed, 32 up to date).
The runtime totals 60,847 bytes under its unchanged 64-KiB guard. No export,
installation, phone navigation or connected service acceptance is claimed.

The following shared-UI drawer review adds centered Dashboard/Settings headings,
matching section dividers, bold list labels and native hover titles. It removes
both close buttons with static Settings keyboard focus, makes About the final visible version
section and removes the deferred draft-management controls and unused code.
Twenty-two focused package/workspace checks and 13 Chromium groups passed,
including text scaling, draft retention and the plain URL. The runtime is 58,567
bytes; no APK build, export or phone installation was performed for this review.

## Participant attention projection — 21 October 2026

The shared UI projects explicit item IDs into a blue menu bell, matching
Request/Operation section bells and right-aligned item dots. Startup has no
attention. Only present item rows contribute; collapsed ancestors and navigation
do not clear flags. Ordinary draft typing creates no alert, and the renderer
adds accessible attention descriptions. Backend event authority and clearing
rules remain for the future service adapter.

Twenty-two focused package/workspace checks and 14 Chromium groups passed in
managed Debian, including synthetic attention fixtures, unknown/malformed IDs,
input copies, exact clearing, row removal and 320px/200% layouts. One browser
fixture was corrected to open optional fields before clearing them and rerun in
the same snapshot. Runtime size is 62,156 bytes within the unchanged 64-KiB guard.
The labelled example screenshots use the actual renderer with synthetic inputs;
they are not backend events or real requests/operations. No APK build, export,
phone installation or connected-service acceptance is claimed.

The following compact branding review adds the website's `Facta, non verba.`
motto below the app name and slightly enlarges the author credit. Fourteen
package checks and fourteen Chromium groups passed, including narrow headers,
footer bounds and 200% text. The same six assets total 62,569 bytes; no new font,
image, dependency, APK build or phone installation was needed.

## Participant role setup UI — 21 October 2026

The header now shows the sprout and the sole visible wordmark `Facta, non verba.`.
Both Dashboard role labels show identity-setup triangles by default; expanded
sections link to the informational `identity/setup` view. Navigation keeps the
plain URL, and Back preserves drafts. Per-role readiness changes only the
warning/link display and composes identity and attention descriptions. The
disconnected verification action stays disabled, with no ID/camera inputs,
network calls, permissions or posting/acceptance authority added.

In managed Debian, 22 focused package/workspace checks and 15 Chromium groups
passed, including both entry points, retained drafts and 320–1280-pixel layouts
plus 200% text. The shared six-asset runtime is 64,560/65,536 bytes. No APK build,
export, installation, physical-device validation or backend acceptance is claimed.

The 21 October warning-placement refinement passed 22 focused package/workspace
checks and 15 Chromium groups in managed Debian. Collapsed role warnings align
right; expansion moves the same SVG before a blue setup action in indented rows.
Setup, empty and draft rows reuse the warning, circle/slash, feather and hammer
icons. Checks include composed accessible hints and separate bottom-right setup
and top-right attention menu indicators at 320px and 200% text. The shared
six-asset runtime is 65,470/65,536 bytes. No APK build, export, installation,
physical-device validation or backend acceptance is claimed for this refinement.

The follow-up triangle-click correction passed the same 22 package/workspace
checks and 15 Chromium groups, including real clicks on both collapsed warning
icons. Each expands its list without changing the view or URL; the explicit setup
link still opens identity setup. The six-asset runtime is 65,499/65,536 bytes.
No APK build, installation, physical-device or connected-service result is claimed.

The 21 October account-entry refinement passed 22 focused package/workspace
checks and 15 Chromium groups in managed Debian. Coverage includes distinct
yellow warning icons and blue action text, Settings and both role links entering
the account-first flow, keyboard modal behavior, 320px/200% layouts, Back/draft
preservation, the plain URL and the collapsed-triangle click regression. Sharing
identical button reset declarations keeps the same six assets at 65,498/65,536
bytes under the unchanged budget guard. This review collected no credentials
or media, added no service integration and performed no APK build, export,
installation or physical-device operation.

## Synthetic account-first enrollment workflow - 21 October 2026

Current source location: [`code/test/fixtures/identity/synthetic-enrollment-workflow.js`](../../code/test/fixtures/identity/synthetic-enrollment-workflow.js).
It was moved unchanged on 22 October 2026; the historical source path and executed
results below remain as recorded.

The shared `web/shared/identity/synthetic-enrollment-workflow.js` component passed
17 focused Node checks plus both existing test-catalog checks in the preserved
managed Debian container. The command was `node --test
test/unit/synthetic-enrollment-workflow-tests.mjs
test/unit/test-suites-tests.mjs`, in a launcher-verified public source snapshot.
All 19 checks passed with no failures or skipped checks.

Coverage includes both R/O roles with an unbound initial account, rejection of
pending/flag-only accounts and unsafe recovery generations, independent
processing/retention consent, fixed-fixture-only media, exact review invalidation,
selected retention and reopening, account/role/generation isolation, session
invalidation, delayed account/submit cancellation, account switching after a
possible commit, original-operation lookup after a lost response, exact receipt
replay versus changed-byte conflict, notice/media tampering, refused fabricated
verification decisions, storage deletion failure, stale retained-view conflicts
and omission of arbitrary account-adapter secrets from saved data.

Hx10 and Hx11 reviewed the account-first interface: current account plus current
session inventory are sufficient without approved signing-key binding. Historical
enrollment/recovery receipts and descriptive scope are not session authority.
Email-address sign-in adaptation and actual contact delivery remain service gaps;
session revocation alone is distinct from stopped-state sign-out.

The component uses fixed synthetic illustrations and explicitly injected string
storage. Reopening is tested with shared in-memory key/value storage; browser
persistence, platform capture/cleanup, APK integration and hosted submission are
not established. Ordinary snapshots contain descriptors, not media bytes or
credentials. Fixture receipts state local custody; identity verification remains
pending and unconfigured, with no movement/liveness, signing or work-resumption
claim. No Rust policy/model asset, application UI, Android host, backend or
real-data store was changed by this component checkpoint.

## Account-first sample onboarding — 21 October 2026

Hero 10 implemented the owner-selected shared browser/APK onboarding milestone,
composing Hx02's selected synthetic enrollment workflow. Fixed `.invalid` sample
account creation/sign-in, confirmation, sign-out and recovery-code plus contact
confirmation precede illustrated document/frontal-photo selection, manual
up/down/side/front guidance, separate consent, review, retake, explicit retention,
cancel, original submission lookup and pending sample receipts. The sample
account/session/credentials are memory-only. Only bundled illustrated fixture
records and media-free receipts persist; reload resets the fixed sample account,
including recovery generation. No real authentication or durable recovery
revocation is established.

Validation used the existing managed Debian container and one related-check
snapshot. All 49 focused account, shared-workflow, workspace, package and catalog
checks passed, as did the prepared-SVG byte check, 15 existing participant
Chromium groups and eight onboarding groups. Checks cover account-first history
guards, review invalidation, retention/reload without restoring a session,
account/session/recovery binding isolation, unknown submission/replay behavior,
credential-free fixture records, preserved drafts after a late restore and Back,
plain URLs, labelled keyboard controls and 320px/200% text. The new browser suite
initially expected title focus when sign-out stayed on the same gateway; its
fixture was corrected to assert the existing Settings-toggle focus return and
the full suite reran successfully. No unexpected requests or browser errors were
observed.

Participant assembly/lint passed (55 seconds; 16 tasks executed, 31 up to date).
The exact selected runtime is 13 files and 121,371/131,072 bytes, with the 8 KiB
per-image bound unchanged. Collector, Gradle, native allowlist and package checks
agree; four prepared SVGs match Hx02's fixture export byte-for-byte. Android DOM
storage is enabled for the restricted synthetic fixture adapter; strict CSP,
network/sensor/file-access restrictions and absence of native JavaScript bridges
remain. Existing SDK XML/Gradle deprecation warnings remain nonblocking.

The live in-app preview completed the fixed sample account/confirmation,
document, five-direction guidance, frontal illustration, explicit review/save
and pending sample submission sequence. No camera or real document/face was
used. No APK export/install, new physical-device check, real account service,
confirmation email, sensitive-media custody, identity reviewer, movement/liveness
check or real-person assurance is claimed. Hx11's email sign-in/account context
work and real platform/service integration remain separate from this UI outcome.
See the [shared UI guide](../../web/apps/non-verba/README.md#account-first-sample-onboarding)
and [Hx02 handoff](IDENTITY_ENROLLMENT_SLICE.md).

## Connected participant account service — 21 October 2026

The shared browser/APK account interface now uses the selected local account
service through a fixed, explicitly enabled development relay. It replaces the
fixed account fixture with reviewed minimal enrollment, pending confirmation,
one-time recovery-code reveal, email authorization-code/S256 PKCE, verified
ES256 issuer/audience/nonce/state, coherent current account/session reads,
serialized refresh, explicit server sign-out and two-factor recovery. Current
service authority gates only the separately illustrated identity workflow;
identity verification, signing-key approval and work/sensor authority stay pending.
No external provider or real contact/media path was added.

All 65 focused unit/workflow/package/catalog checks and 23 Chromium groups passed
in the existing managed application container. Browser checks include hostile
redirect/token/context refusals, late response and cancellation fences, review
freshness, unknown sign-out, recovery rotation, secret-free URL/history/storage,
keyboard and 320px/200% text. A real asynchronous checkbox timing issue was fixed;
the keyboard fixture also now waits for account validation before its next action.

The final participant build assembled/linted in 17 seconds (7 tasks executed,
40 up to date), following the native transport build in 42 seconds. Actual compiled
manifest permissions, exact asset bytes, debug signature against an independently
retained baseline and package inspection passed. Runtime closure is 14 files and
155,640/196,608 bytes. Debug alone adds INTERNET and numeric-loopback cleartext for
the restricted WebMessage/USB port 4173 relay; WebView networking/cookies remain blocked.
Release has no account bridge/network permission. Image 8 KiB and APK 8 MiB bounds
remain unchanged. No APK export/install or phone connection was performed.

The final standalone live shared-client check passed against the running local
service: discovery, owned .invalid enrollment/status, private operator-supplied
confirmation without login, actual email PKCE/CSRF/signed ID-token/current context,
server sign-out, two-factor recovery, old-password refusal, fresh login and
recovery-generation change. The app and relay cannot read the privileged local
mail sink. Challenge factors travelled only between managed containers through
private, atomic test handoffs; they were never displayed in the browser/console
or stored on Windows. Earlier live harness attempts exposed a partially written
transfer-file race and were retained; atomic transfer and minimum-length waiting
corrected the harness. No server fixture/data cleanup was performed.

The refreshed in-app browser shows the available local account service and its
new form. Real mailbox delivery, production credential custody/deployment,
real document/face capture and retention, identity/liveness validation, physical
Android bridge/HTTP/lifecycle and USB acceptance remain separate unverified work.
See [the application integration record](PARTICIPANT_ACCOUNT_INTEGRATION.md).

## Mock confirmation and document/face capture — 21 October 2026

The owner selected no real email until the last mile. The shared browser/debug
APK now uses an explicit operation-bound mock inbox for reserved test contacts;
opening/using a code remains separate from deliberate confirmation. The running
local service reports mock mode with real email disabled. No provider/sender was
configured and no real message sent. The actual shared client passed mock
enrollment confirmation, PKCE/current context, sign-out and recovery with
old-password refusal, fresh login and generation change. Test records remain
retained; API/worker updates preserved database/object/viewer services and data.

The product now acquires a rear-camera document-front JPEG and guided frontal
JPEG, with a browser-only bounded document-file option. Current account binding,
processing consent, ordered or explicit skipped guidance, exact review, retake,
remove/discard and memory-only custody are implemented. Camera stops before
encoding/review; cancellation, native/background lifecycle, track loss and the
bounded local lease fence late results. Account/session/recovery changes clear
media. Object URLs are revoked, and Android DOM storage is disabled. No real
image enters the old synthetic store, a submission endpoint or a verification
decision. Movement/liveness, OCR and document/face comparison remain unperformed.

All 77 focused unit/workflow/account/relay/package/catalog checks, 22 Android
build-process checks and 25 Chromium groups passed in the existing managed
application container. Browser checks used synthetic Chromium cameras and image
fixtures, including JPEG decode, file refusal, retakes, exact review, late
permission completion, background/navigation cleanup, no persistent media or
unexpected egress, mock confirmation/recovery and 320px/200% keyboard use. The
fixture was corrected for intentional setup navigation on interruption and
retained checkbox focus; the complete suite then passed.

Participant assembly/lint and actual compiled permission/assets/retained-signer
inspection passed. The selected runtime is eleven files/164,069 bytes within the
unchanged 192 KiB bound. A first build safely refused obsolete fixture files in
the earlier stage; a new versioned capture stage preserves that entire previous
stage and the strict preflight. CAMERA is the only new main permission; debug
alone retains the existing account INTERNET exception. No APK was exported or
installed. Physical camera, Android permission/lifecycle/USB, personal identity
data, protected persistence/upload and identity verification remain untested or
unimplemented as scoped in [the capture record](PARTICIPANT_CAPTURE.md).

## Test-account deletion and phone update — 22 October 2026

The shared UI now offers deliberate deletion of the current local mock test
account, requiring its typed email and current password. The service closes only
that account, revokes old authority and frees its email for fresh IDs; historical
attribution and backups remain. A contact-generation fence prevents older pending
enrollment from claiming the reused email. Lost replies resolve by original
secret-bound status after revocation, without a blind deletion retry.

All 56 focused account/relay/workspace/package checks and 27 Chromium groups
passed in one managed application snapshot. Actual local-service acceptance
passed mock confirmation, sign-in/recovery, owned test deletion with an
intentionally lost reply, original status and same-email registration with fresh
account/principal IDs. Dedicated backend static/regression and retained database
checks passed, with unrelated records preserved and real mail disabled.

The initial participant assembly/lint passed in 36 seconds (15 executed and 32
up-to-date tasks). Final review corrected stale signed-in presentation after an
authoritative deletion 401; wrong-password 403 still permits corrected review.
All 17 account and 39 relay/workspace/package checks passed on that correction.
The browser fixture's wrong-password status was corrected to the actual 403
contract after its earlier 401 caused the expected signed-out behavior. All 12
onboarding Chromium groups then passed again, including a separate expired-session
401 check followed by fresh sign-in and deliberate deletion.
Final assembly/lint passed in 22 seconds (7 executed and 40 up-to-date tasks).
The eleven-file runtime is 172,328/196,608 bytes. Export inspection passed,
then the final 2,611,782-byte APK was copied through the bounded installation
bridge and independently inspected again against the retained signer. The first
transfer invocation lacked the managed runtime PATH; no APK was copied by that
attempt. It was corrected to the managed Node environment, preserving the failed
inspection record and all existing outputs. No toolchain was installed on Windows.

The original approved USB helper installed the update with data preserved and
read back the same installed APK hash. The documented USB-only 4173 reverse was
enabled for the local debug account relay. Home and Settings displayed on the
phone; account entry and an explicit connection retry exposed connected mock
service status and enabled account creation/sign-in through semantic control IDs.
Home initially exposed only its WebView, so one screenshot/tap fallback opened
Settings before semantic access resumed. Installation is separate from physical
camera/onboarding acceptance; no credentials, personal identity media or automatic
camera permission grant was involved. After the final replacement, the own-app
focus guard refused further inspection because Android displayed a system overlay;
no overlay was controlled. See [the scoped record](PARTICIPANT_ACCOUNT_DELETION.md).

## Shared status propagation and server feedback — 22 October 2026

Replaced the separate role-warning and attention-badge aggregation with one
declared owner/parent tree. Sources drive local icons and every ancestor,
including both Dashboard and Settings buttons. Summaries deduplicate sources,
select the highest issue and retain an independent notification bell. Expanding
a branch reveals its source icons without acknowledging anything; success and
neutral information remain local. Literal descriptions and static control names
are retained, and malformed ownership, cycles, removed hosts and stale sources
cannot leak into another branch. The reusable rule is documented in the
[participant guide](../../web/apps/non-verba/README.md#status-icons-and-propagation).

Settings now checks fresh API discovery and the existing local service-readiness
response on opening or explicit refresh. Authenticated current-context and bounded
device-inventory reads produce key counts and current session-binding feedback;
no IDs, public-key inventory or credentials enter the UI snapshot. Incomplete,
malformed, foreign or stale responses cannot become an empty or healthy key list.
A delayed inventory cannot restore claims after a concurrent session denial or
unknown account result. Pending setup includes proof and approval stages; an
approved mapping does not prove private-key possession. Key creation/binding and
budget reporting are not connected in this interface. There is no polling,
automatic key action, new backend endpoint or general-purpose network route.

All 75 focused account/relay/workspace/package groups and 29 Chromium groups
passed in the existing managed application container. Browser checks include a
new nested owner without custom ancestor logic, root isolation, severity plus
notification coexistence, removal/resolution, disclosure, accessible descriptions,
live-readiness failure/recovery, malformed/incomplete key inventories, and narrow
320px/200% layouts. The initial browser geometry assertion measured a single
warning within a warning/bell group; measuring the whole group corrected that
fixture and the full suite passed. The final account changes also fence delayed
inventory after authoritative 401 and unavailable-context responses.

Participant assembly/lint passed in 33 seconds (15 executed, 32 up-to-date tasks).
The unchanged eleven-file runtime is 194,449/196,608 bytes. Actual compiled APK
inspection passed permissions, exact asset bytes, notices, alignment and retained
debug signer. No APK was exported or installed for this status increment.

The existing local review preview was refreshed and inspected through its DOM
and visible Settings. The actual service returned API responding and local
services ready; key inspection correctly required sign-in and budgets remained
unreported. The readiness check covers its declared persistence dependencies,
not every background service, mailbox delivery, identity verification or work
authority. No credentials or personal media were entered, and no physical-device
status/permission or production/staging acceptance is claimed.

The owner's presentation follow-up groups API, Services, Keys and Budgets into
compact rows under API access, with optional Key details. Header issues now sit
at Dashboard's lower-right and Settings' lower-left; simultaneous notification
bells remain above. The shared propagation engine and readiness reads are
unchanged. All 19 package checks and 29 Chromium groups passed, including grouped
ownership, both corner positions, keyboard disclosure/focus trapping and
320px/200% layouts with expanded details. The unchanged eleven-file runtime is
195,905/196,608 bytes. The refreshed local preview visibly confirmed the compact
list and both warning corners; API and local services responded successfully.
No Android rebuild, export or installation was performed for this presentation
follow-up.

The next owner follow-up removes the manual refresh row. Opening Settings now
checks immediately, then schedules the next read five seconds after completion
while the drawer is visible. Closing, backgrounding or pagehide stops scheduling;
visibility/pageshow resume an open drawer immediately. A generation fence and
shared in-flight promise prevent overlap across repeated open/close transitions.
An existing bounded read may finish after dismissal. Account actions pause new
reads. The API configuration disclosure is a labelled mockup with disabled,
empty server-address and API-key fields, outside any form and unused by transport.
The signed-out account entry reads Log in / Sign up. Dashboard identity prompts
and their propagated warnings now require a signed-in account and clear on
sign-out; the current local service still reports identity verification pending.

All 38 workspace/package checks and 29 Chromium groups passed. Controlled browser
time covers cadence, delayed-read nonoverlap, close/hidden suspension and
visibility/pagehide/pageshow recovery; connected fixtures cover sign-in/sign-out
warning changes. Keyboard containment and narrow/200% layouts include the API
mockup. The actual local preview visibly confirmed the new account entry,
automatic readiness feedback, mock fields and signed-out warning suppression.
The same eleven-file runtime is 195,936/196,608 bytes. No Android build, APK
export/installation, API configuration action or real identity capture occurred
for this follow-up.

The owner then reported polling flicker. Scheduled checks now run ten seconds
after completion and retain the last displayed feedback while reading. Quiet
health/context/inventory reads still replace failures with unavailable/unknown
results and clear invalid key authority; they do not preserve success after an
actual failure. Unchanged text and status glyph nodes are retained. Initial
opening checks still expose their pending state. Settings now groups Network,
API, Server and Keys under Services, with Budgets as a separate section and a
Sign in entry. Network uses the platform's online/offline hint; it does not prove
internet reachability, and no external connectivity endpoint or allowlist was
added. Server readiness remains the actual bounded service response.

Configure API access now closes Settings and opens a main-workspace API access
mockup with a Non-verba API panel, disabled labelled fields, shared Back/focus
behavior and the unchanged plain URL. All 66 adapter/workspace/package checks
and 29 Chromium groups passed, including quiet delayed failures/recovery,
session-denial races, stable glyph nodes, no poll at five seconds, ten-second
cadence, network online/offline changes, lifecycle pauses, separate Budgets and
320px/200% mockup layouts. The first connected browser run found one obsolete
dropdown interaction in its fixture; removing that line let the complete suite
pass. The refreshed actual preview visibly confirmed both Settings and the main
API workspace. The unchanged eleven-file runtime is 196,591/196,608 bytes.
No Android build/export/install, real API configuration or independent internet
reachability acceptance is claimed for this follow-up.

## API key dashboard preview — 22 October 2026

Corrected the owner-identified product model: first-party API access should issue
and manage keys, rather than ask participants for a deployment address or an
existing secret. Reviewed Stripe and Cloudflare's official dashboard guidance;
the [participant guide](../../web/apps/non-verba/README.md#api-key-management-preview)
records the source links and intended create/name/permissions/expiry, one-time
secret and masked-inventory/revoke/rotate pattern.

The main workspace now has a disabled Generate API key button, expandable named
key options and a six-column Active keys management layout. The unknown inventory
is explicitly unconnected; no fake active key or working credential is shown.
Backend issuance, secret delivery and key actions remain unconnected. Device
signing keys are explicitly named separately in Settings and are not used as
this API-key inventory. Deployment configuration is absent from the user form.

All 39 workspace/package checks and 29 Chromium groups passed in the same managed
snapshot, including labelled disabled controls, expanded options and bounded
keyboard-accessible inventory at 320px/200%, Back/focus/plain URL behavior and
unchanged account/polling regressions. Fixtures were corrected to exceed the
configured size limit and to expect Device keys. The refreshed local preview was
inspected through its DOM and visible key dashboard.

The reviewed runtime guard increases from 192 to 196 KiB to accommodate this
requested dashboard: 198,613/200,704 bytes, an actual 2,022-byte increment, with
the same eleven files and no new runtime dependency. The per-image 8 KiB and APK
8 MiB guards are unchanged. No Android build/export/install, bearer API-key
creation/revocation, new endpoint or real credential collection was performed.

The owner's compact-copy follow-up consolidates the key controls and inventory
into one panel. Removed the visible Preview badge, main introduction, explanatory
paragraphs and implementation-status prose. Key options now use compact labels,
short placeholders and a responsive three-field row that stacks when needed;
the inventory's unknown state reads Unavailable. The disabled generation action
retains a concise hidden accessible reason. No key capability changed.
All 19 package checks and 29 existing Chromium groups passed, including one-panel
structure, absence of visible explanatory prose, keyboard disclosure, and
expanded 320px/200% options/table layouts. The refreshed local preview was
visually inspected with options expanded. Runtime is 198,572/200,704 bytes,
with the same eleven files and bounds. No Android build/export/install occurred.

The next owner interaction follow-up makes Generate API key an enabled disclosure
that reveals the options, replacing the separate disclosure label. The fields
remain disabled and no key issuance or service request occurs. Route changes
collapse the options. The owner-specified Developer services eyebrow and
platform.non-verba.com - API and MCP keys heading now wrap within the shared
workspace; they add no hosted endpoint, publication or MCP authentication.
`mountBackControl(document, onBack)` now owns the shared native header Back
markup/click binding. It mounts once for all participant routes and both
platforms, preserving the existing history/fallback policy and common style.

All 40 workspace/package checks and 29 Chromium groups passed, including the
reusable Back control, Enter/click disclosure, route reset, no disclosure-induced
service calls, plain URL and wrapped 320px/200% heading/options. One fixture's
eyebrow comparison was corrected to inspect source text rather than CSS uppercase
rendering. The actual refreshed preview visibly confirmed the headings and
Generate behavior. Runtime is 199,753/200,704 bytes in the same eleven-file
closure; no bound or dependency changed. No Android build/export/install or
real API/MCP key generation occurred.

The editable-demo follow-up replaces the top action with an accessible **+**
disclosure and puts **Generate API key** below the enabled required fields.
Permissions offer Read only / Read and write; expiration offers 30 days,
90 days and Never expires. Native validation and a trimmed-name check precede
page-only demo generation. Results are marked Demo key with an unusable `demo_`
value, and list rows retain masked prefixes, access and visible expiration.
Done, closing the options or changing routes clears the full value; route exit
also resets unfinished fields. Demo metadata lasts only in the current page,
and Revoke removes only a demo row. No service request, persistent storage,
real credential or API/MCP authority is involved. Real inventory remains unknown.

All 40 workspace/package checks and 29 Chromium groups passed in the same
managed snapshot. Existing groups now cover actual editing and selects,
required/blank-name validation, all permission/expiry choices, keyboard
generation, safe literal names, masked rows, clearing, fresh-page isolation,
revocation, plain URLs and unchanged authority/storage/network boundaries.
The 320px/200% layout and account/capture regressions pass. The refreshed local
preview was visually checked with the editable form and demo result.

Reviewed the runtime allowance from 196 to 200 KiB for this interaction:
203,820/204,800 bytes, a 4,067-byte increment from the prior dashboard, with the
same eleven files and no dependency. The 8 KiB image and 8 MiB APK guards remain
unchanged. No Android build/export/install or real backend key lifecycle was
performed.

The next owner follow-up adds 24 hours, 7 days and 365 days to the existing
30/90-day and Never expires choices, aligns Generate API key to the right below
the fields, and shortens the workspace heading to API and MCP keys. The compact
swagger.platform.non-verba.com entry below the panel opens an empty local
documentation view through the shared Back/navigation controls. It does not
provision a subdomain, load Swagger UI, invent API/MCP operations or contact
an external host.

All 40 workspace/package checks and 29 Chromium groups passed, including
generation with each of the six expiry choices, action alignment, keyboard
documentation navigation/Back, plain URLs and 320px/200% layouts. The initial
documentation fixture treated an empty zero-height section as visibly sized;
it now asserts the active hidden state. The final preview was inspected and
captured. Runtime is 204,441/204,800 bytes with the same eleven-file closure,
no new dependency and unchanged image/APK bounds. No Android build/export/install
or hosting change was performed.

The Settings visibility follow-up centers the documentation entry, including
wrapped text, with 24px of space above it. Manage API keys and Budgets start
hidden and appear only for the current signed-in account state. They hide on
sign-out, session loss and uncertain/deleted account outcomes; a focused API
entry returns focus to Account before hiding. Removed the Device keys row,
label rendering and status source, so it cannot propagate an orphan warning.
The bounded account-adapter diagnostics and inert demo history routes remain.

All 40 workspace/package checks and 29 Chromium groups passed, covering
anonymous/signed-in visibility, session denial/expiry, deletion/unknown states,
focus recovery, quiet status checks and centered 320px/200% layouts. Updated
older anonymous fixtures for one remaining focus target and actual API status
instead of text from the removed budget section. The signed-out preview and
centered documentation capture were inspected. Runtime is 203,835/204,800 bytes
in the same eleven files, with unchanged dependencies and image/APK bounds.
No Android build/export/install, hosting or backend authority change occurred.

## Simple participant sign-in — 22 October 2026

The owner selected simple sign-in first and deferred automatic existing/new-email
routing. Settings now opens Sign in directly, with Email, Password, Sign in and
a small Recover account link. The ready view has no signup-choice menu, identity
steps, development notice or explanatory introduction. Its accessible region
label also follows the account view. Password success returns Home; sign-out
and local forgetting return to Sign in. Identity capture remains separate.

An already signed-in page offers Continue as email and Use another account.
Continue performs a fresh current-account read through the existing adapter,
which handles bounded refresh and checks principal/current-session binding.
Delayed revalidation disables both controls; refusal stays on Sign in without
restored authority. Account switching performs server sign-out first. Unknown
sign-out and local forgetting remain distinct. Successful account switching
clears the previous email and focuses the revealed Email field. No email-existence lookup,
registration after password failure, persistent device-login record or credential
storage is added. The password field retains its password-manager autocomplete.

All 40 workspace/package checks and 29 Chromium groups passed in the managed
snapshot. Coverage includes the minimal ready screen, direct Settings entry,
Home on success, keyboard/Back/plain URLs, delayed and refused session reuse,
server session switching, generic login failures, expiry and existing account /
recovery/deletion/capture regressions, including 320px with 200% text. Older
fixtures were updated for the intended generic email/password error text.
The actual refreshed local sign-in page was visually inspected and captured.

Reviewed the shared runtime allowance from 200 to 204 KiB for sign-in/session
reuse: 205,416/208,896 bytes, a 1,581-byte increment, with the same eleven-file
closure and no dependency. Image/APK limits remain 8 KiB / 8 MiB. No private
backend, transport allowlist, real mail, hosting, persistent SSO or Android
build/export/install changed.

## Email-first participant entry — 22 October 2026

The follow-up starts with only Email and Continue. A uniform email-code
challenge precedes routing: confirmed existing contacts see Password, Sign in
and Forgot password; confirmed new contacts continue to deliberate account
creation with a read-only prefilled email. Change email clears the proof and
secret controls. A password refusal stays on the existing-account path and
never starts registration. The current in-page session reuse, separate identity
capture and plain app URL remain intact.

The adapter and exact browser/native allowlists add only bounded entry start
and confirmation requests. Start acknowledges both branches identically;
confirmation returns only the next screen, with no account identifiers, session
or enrollment authority. Operation ownership, expiry, attempt limits and stale
response fences remain enforced. Mock mode exposes a test code only for owned
reserved synthetic contacts, fills it without confirming it, and visibly says
no email was sent. SMTP mode hides that control. This tests routing, not real
mailbox ownership or delivery; no mail configuration was enabled.

All 85 focused public unit checks passed (40 workspace/package and 45 account
adapter/relay), plus 30 Chromium groups (16 shell and 14 connected synthetic
account groups). Coverage includes invalid email before network, wrong/expired
codes, no account branch or recovery link before confirmation, new-account
prefill, Change email/focus/secret clearing, late confirmation after Back,
password denials, current-session reuse, SMTP mock-control exclusion, existing
recovery/deletion/capture regressions and 320px/200% layout.

The eleven-file shared runtime measures 210,234 bytes, a 4,818-byte increment.
Its reviewed guard moves from 204 to 208 KiB (212,992 bytes), retaining the
8 KiB image and 8 MiB APK limits and adding no dependency. No Android build,
export, installation, persistent device login or real mailbox check is claimed.

Private backend validation passed 33 nonignored library tests, two focused
retained-fixture database/worker checks, formatting, shell syntax and
warning-denied Clippy. The additive entry migration was applied and only the
existing API/worker reloaded. Post-reload readiness and protected-tunnel checks
passed; the database, storage and tunnel were preserved. The actual local
browser completed the new-contact challenge and reached account creation
without creating an account, then returned to the email-only first step for
visual inspection. The existing-account branch was checked with synthetic
service/browser fixtures. No real email, external sign-in or phone acceptance
is claimed.

## Compact email confirmation — 22 October 2026

The email-code step now says Confirm email and explains that account detection
follows confirmation. Existing contacts see Account found and a password form;
password authentication remains required. The redundant Change email control
is removed. Shared header, browser and native Back return from the code/password
step to Email, clear the previous proof and secret controls, and cancel a
pending password sign-in so late context replies cannot restore its authority.
The new-account continuation replaces that intermediate history step.

The active backend generates eight uppercase hexadecimal characters and accepts
lowercase confirmation. Operation secrets and enrollment/recovery factors keep
their previous format. Ownership, five-attempt exhaustion, expiry/rate bounds
and routing-only authority remain enforced. Eight visible code slots share one
labelled input with one-time-code autocomplete, typed/pasted normalization,
selection and deletion. Continue requires a complete code. The mock helper is
inside a labelled Email preview with an explicit no-email-sent message; opening
it does not fill or confirm a code. SMTP mode hides the preview.

All 85 public unit checks, 16 shell Chromium groups and 14 connected Chromium
groups passed. Coverage includes formatted paste, invalid characters,
backspace, incomplete-code submission, eight visible slots with a single input,
Back/focus/secret clearing, late confirmation and password-context cancellation,
password sign-in, account creation, recovery/deletion/capture regressions and
320px/200% code layout. The backend passed two focused entry unit checks, one
mail-format check, two retained-fixture database/worker checks, formatting and
warning-denied Clippy.

The guarded existing API/worker reload completed; readiness and protected-tunnel
checks passed. The actual browser retrieved an eight-character code from the
running backend and confirmed a synthetic contact into the new-account path,
without creating an account. The updated code screen was visually inspected.
Real email delivery, external sign-in and Android device acceptance remain
separate. Runtime is 215,368 bytes, 5,134 above the initial email-routing
checkpoint. The reviewed guard moves from 208 to 212 KiB (217,088 bytes) with
the same eleven files, no dependency and unchanged 8 KiB image/8 MiB APK limits.

## Centered signup and account terms — 22 October 2026

The shared browser/APK account UI now centers its bounded 440px column for Sign
in, Confirm email and Create account. Preview code copying has explicit success,
refusal/manual-copy fallback and cancellation coverage. Signup uses a unique
canonical username, readonly confirmed email, a five-level color password meter
requiring level 2, and both account roles without a role chooser.

Hero 2 authored account-only draft `nonverba-account-terms`, version
`0.1.0-draft.1`. Complete terms remain available before unchecked deliberate
agreement; opening the document and Back preserve the in-memory signup draft.
The shared client pins full canonical text and SHA-256 against the service.
The running private service enforces email-entry binding, atomic username claims,
password policy and immutable exact terms/acceptance retention. Historical
operations and existing-password authentication retain compatibility. Countries,
operator, eligibility and legal adoption remain unresolved; this draft supplies
no identity, work-contract, payment or sensor authority.

One managed Debian source snapshot supplied all related public checks. All 74
focused client/relay/package unit checks, 16 connected onboarding Chromium groups
and 16 participant shell groups passed. Coverage includes wrong-email proof,
changed terms, username refusal/corrected retry, all password levels, copy
success/refusal/stale completion, complete terms/Back, keyboard access, 320px and
200% text, and existing account/device/recovery/deletion/capture behavior.
The current thirteen-file runtime is 265875 bytes under the reviewed 272 KiB
bound, including the concurrently integrated shared attestation tool. The new
terms module is part of the exact collector/Gradle/native document allowlists.
Image and APK guards remain 8 KiB per image and 8 MiB. Participant assembly and
lint passed without an APK export or installation. Existing SDK metadata and
Gradle deprecation warnings remain; no warning-free toolchain claim is made.

Private managed checks passed formatting, all-target warning-denied Clippy and
51 ordinary tests, plus 7 retained account/signup groups, 2 deletion groups and
3 mock/fake-mail groups. These cover email substitution, immutable terms,
username races/reservation expiry, password refusals and retained-operation
compatibility. The signup migration was then applied to the live local service,
and only the API and outbox worker were reloaded, preserving the database,
objects, viewer and protected tunnel.

The live shared client created one owned synthetic account using operation-bound
mock email and completed enrollment/status, deliberate confirmation without
login authority, PKCE/CSRF and signed-token verification, separate browser device
proof/session grouping/revocation, sign-out, recovery, old-password denial and
fresh sign-in with changed recovery generation. Direct app review confirmed the
centered layouts, successful code copy, readonly email and full draft document.
No real mailbox delivery, real-person verification, personal media upload,
physical Android attestation or phone installation was performed.

See [the maintained signup record](PARTICIPANT_SIGNUP.md) and
[Hero 2's draft/adoption review](ACCOUNT_TERMS_REVIEW.md).

## Attestation tool extraction and account migration — 22 October 2026

The owner selected review, extraction, hardening and replacement of the account
consumer as Hero 01's reusable attestation-tool work. The
[tool contract](../sensors/ATTESTATION_TOOL.md) records the resulting boundary.
The shared web tool has no account HTTP/UI dependency; shared Android source
owns the existing key/proof mechanism and pure lifecycle helpers. The private
assessor accepts independent original enrollment context, policy/trust and
expected key inputs while reusing the existing public Rust verifier. Sign-in
keeps its account/session protocol and consumer policy.

Review produced targeted improvements: synchronous challenge snapshots;
closed, bounded inputs/results; operation-specific cancellation on abort,
timeout, invalid response and disposal; interruptible authority-aware lock
waits; explicit error/capability categories; and recreation of a closed tool on
restored pages. Direct private assessor inputs are bounded before JSON
construction, shared chain checks preserve HTTP error compatibility, and
arbitrary trust diagnostic text is replaced by a fixed category. Existing key
aliases/records, original challenges/chains, the narrow StrongBox fallback and
the approved development policy are preserved. No renewal/deletion workflow or
new attestation cryptography is introduced.

Managed public validation used retained source snapshots. The final unit/build
run passed 145 of 146 cases, including fourteen standalone attestation cases,
account regressions, package byte/allowlist checks, four participant-consumer
catalog checks and shared-source staging. Its single failing broader catalog
case finds the unrelated uncataloged
`web/shared/identity/synthetic-enrollment-workflow.js`; that source and the
registration guard were preserved. The catalog now explicitly validates
participant-only shared sources against the canonical participant package,
rejecting developer/inspection dependencies into them and checking their own
packaged dependency paths.

The unchanged synthetic reference was subsequently relocated to
`code/test/fixtures/identity/synthetic-enrollment-workflow.js` on 22 October 2026.
The earlier catalog failure above remains part of the executed record.

Both actual Chromium workflows passed sixteen groups each. The connected
fixture verifies real WebCrypto signatures in the account flow, browser
hardware-unavailable labeling, cancellation/authority regressions and a fresh
proof after persisted page lifecycle events. The shell/browser checks retain
exact packaged source bytes and interaction coverage. Shared runtime is
266,246 bytes within the unchanged 272 KiB guard. Native transcript/challenge,
DER/JCA and operation-ticket/lock-contention harnesses passed. Participant
assembly and lint passed, compiling the shared native source through the normal
managed build; no APK export or installation was requested.

Final private focused tests passed eleven cases with one database test ignored
and no warnings; scoped rustfmt passed. A broader library run passed 42 and
failed four unrelated OpenAPI checks for the concurrent missing
`AccountTermsAcceptance` component, with 33 ignored. Whole Clippy/format checks
also encountered unrelated concurrent account/client issues. Those paths were
preserved; this record does not claim an entirely green project regression run.

Logs and browser result records remain in the managed source snapshots; no
personal capture, credential or private backend implementation is published in
this record. No service reload, migration, live account operation, key change or
phone operation was performed by this task. Physical Android Keystore/chain
compatibility, actual restart/interrupted-generation behavior, deployment and
production readiness remain separate from this software checkpoint.

### Signup presentation follow-up

The owner selected a quieter signup form: removed the visible strength-level
readout, strengthened the five meter colors and placed the underlined account
terms link inside the sentence beside the checkbox. The standalone signup
version line is removed; full terms still show Draft and the exact version.
Loading/refusal feedback remains visible only when needed. Opening the link
cannot toggle consent. The accessible meter keeps its value and descriptive
strength, and the minimum accepted password level is unchanged.

All 16 existing connected onboarding Chromium groups passed after this change,
including five distinct meter colors, inline terms navigation with both checked
and unchecked consent, Back/draft preservation, keyboard use and narrow/200%
layouts. The shared runtime is 266587 bytes under the unchanged 272 KiB guard.
No account terms bytes, version, digest, server acceptance binding or backend
service changed; this UI-only follow-up required no APK rebuild or installation.

### Eight-character password minimum

At the owner's request, new enrollment and recovery passwords now require at
least 8 Unicode characters. Level 2 covers 8–19 characters; higher levels, the
1024-byte cap and existing common/pattern/context refusals remain. Login and
deletion shape gates admit the new shorter passwords while preserving historical
multibyte credentials; authentication still requires a server hash match.

All 40 focused client unit checks and 16 connected Chromium groups passed,
including seven/eight-character ASCII and Unicode boundaries, eight-character
signup/login/recovery/deletion, maximum UTF-8 size and legacy multibyte login.
Private managed formatting, strict Clippy and five focused policy/router groups
passed. The API and worker were reloaded while preserving existing services and
data; no schema migration was required by this change. The live shared-client
harness with `--mock-mail --minimum-password` successfully enrolled and
recovered one owned synthetic account using exactly eight-character CSPRNG
passwords, rejected the old password after recovery and completed fresh sign-in.
No real mailbox delivery, real identity data or phone action was involved.

Current shared runtime is 266583 bytes under the unchanged 272 KiB guard. The
account terms bytes/version/acceptance binding are unchanged. This validation
change required no Android host rebuild or APK installation.

## Developer APK attestation-tool validation — 22 October 2026

The owner selected Non-verba-dev for the physical continuation. Its new device
attestation screen consumes the same shared tool and native bridge as the account
adapter, with an additional synthetic-scope restriction. It performs no account
request or sensor operation itself. The independent requester retains the original
eight-field request before returning its compact NVAT1 token; the checker uses
real P-256 possession verification and the existing compiled Rust/WASM generation
verifier. Original enrollment and later possession contexts remain distinct.

Managed Debian checks passed 61 focused JavaScript cases across the tool,
developer UI, independent checker, package inspector and asset catalog. Four
Chromium checks passed: browser native-unavailable labeling, a real signature
through a synthetic native bridge, cancellation of a delayed result and restored
page discovery. These browser checks do not exercise Android Keystore. Native
transcript/JCA, operation/lock, developer-profile and exact-document admission
harnesses passed. Review found and fixed a developer discovery race: navigation
revokes old tickets immediately while an exact foreground document can discover
capabilities before page-finished. Pause/stop/destruction still revoke access.
The bounded USB public-export helper passed 47 synthetic host-orchestration
checks, and 75 viewport-parser cases passed. Eighteen managed Node checks passed
for the reviewed USB source, target selection and guards. These software checks
issued no ADB commands.

The earlier asset-catalog failure was resolved by moving the unchanged synthetic
identity workflow into the test fixtures and updating its consumers/references.
Its SHA-256 remained unchanged. This focused rerun does not establish that all
concurrent project regressions pass.

The final developer assembly/lint and authentic schema-2 Linux package inspector
passed, including shared native sources, retained debug signer, current compiled
inputs and no inspection gaps. The single APK was transferred through the
documented bounded export bridge and installed as a data-preserving update to
`org.nonverba.camera` version 0.7.0/code 9. The phone-side APK SHA-256 matched
`d3f8a90b95749424af3235f90c049d21a1928a08060c6a4b0501a6bbdd3130d7`.
No participant APK was installed and no service policy was changed.

After the owner reconnected the phone, two actual native proofs were explicitly
saved, retrieved through the original approved USB helper and checked
independently. Real P-256 possession verification passed for both. The checker
loaded the actual compiled Rust/WASM generation verifier, whose bytes also match
the installed APK's packaged module.

| Observation | First proof | After process restart |
| --- | --- | --- |
| Complete proof arrival after original issue | 79 seconds of 120 | 80 seconds of 120 |
| Independent possession signature | Valid | Valid against the first public-key pin |
| Public key and four DER certificates | Retained baseline | All bytes identical to baseline |
| Generation-policy result | Below requester OS/patch policy | Same refusal |

The restart record verifies the old process stopped, a new process started under
the same Android user and the installed APK hash remained unchanged. No app data
was cleared or settings changed. A fresh independently retained request was
issued after restart. Its signature and nonce differ from the first proof, while
the public key and complete original certificate chain persist.

The first actual generation request is retained as `request-04.json`, with its
first complete-arrival timestamp. The second check uses `request-05.json` only
for fresh possession; it retains request 04 and that first arrival for generation
assessment. Neither original enrollment context nor its freshness was renewed.
Earlier unused requests and observed refusals remain preserved. Each assessment
uses its own freshly fetched public trust snapshot, with separate metadata for
the fixed Google HTTPS endpoints and default TLS certificate/hostname checks.
The checker correctly leaves its JSON-only transport-authentication claim false;
the retained fetch metadata supplies the separate transport provenance.

Both generation checks returned
`Attested OS or patch state is below requester policy`. The phone reports Android
11 and security patch 2023-03-01. The selected developer policy preserves the
approved October 2026 patch floors and retained signer, with only the explicitly
selected developer package/version expectations. No floor was lowered to obtain
an accepted result. The verifier checks the patch floor before attested
application package/signer acceptance, so this refusal does not establish full
attested application identity acceptance. Independent APK inspection separately
confirmed the expected package, version and signer.

Two actual expiry paths were observed: loading an expired token refused it with
proof creation disabled; invoking Prove for a previously loaded, now-expired
request returned `The attestation request is invalid.` The retained UI records
show SaveProof disabled after that invocation. Native cancellation and interrupted
key generation were not forced on the phone; cancellation and late-result
suppression remain software-tested only. The bounded physical negative case is
the observed refusal.

Earlier launch-wait, overlay/focus and disconnected-USB refusals are retained.
The camera home page initially exposed only its WebView root, so targeted
screenshots and observed navigation links were used before rechecking semantic
controls on the attestation page. Real-device review also exposed nested WebView
scrollability and host/document inset differences. The helper now retains
observed descendant scrollability and admits only a proven, strictly contained
document with an inert host. Its narrow Android bar-decoration exception accepts
only fixed, unlabelled, inactive leaf decorations with empty bounds or bounds
wholly outside the host. Ambiguous documents, active/outside controls, malformed
bounds and changed focus remain refused. Bounded diagnostics expose structural
counts/reasons without raw XML or other-window content. No wireless fallback,
arbitrary ADB/JavaScript, global accessibility change or repeated installation
was used. The existing automatic GPS warm-up was visible on camera-home startup;
this incidental observation establishes no sensor-acceptance or capture result.

Original requests, exact public proof exports, receipt manifests, trust snapshots,
independent reports and restart/refusal records remain private. One dedicated
synthetic scope was used, without rotating or deleting an existing key. This
completes the selected developer-phone validation, including an honest negative
generation-policy result. It establishes no accepted hardware enrollment,
current device state, live presence, physical sensor truth or committed workflow
acceptance. Eligible-hardware admission, physical cancellation, participant
installation and live account/service deployment remain separate.

## Automatic browser attestation effort — 22 October 2026

The owner selected a practical, automatic browser effort with no extra setup or
prompts. The shared tool now tries to retain a nonextractable P-256 key in a
dedicated origin-local IndexedDB store, scoped to the fixed sign-in purpose and
account. Reloads and concurrent tabs can prove possession of the same retained
browser-profile key. Every proof still signs the existing exact account,
current-session, recovery-generation, random-challenge and expiry transcript.
Recovery changes that context without silently rotating the key.

Missing, blocked or unusable storage chooses a bounded document-memory fallback
and reports that local capability explicitly. Retained records have closed
schemas, expected key algorithms/usages/nonextractability and an actual
signature/verification check of the key pair. Malformed or mismatched records
are refused without replacement. A serialized readwrite transaction selects
the committed first-use winner across tabs; the store has a 32-account cap and
performs no eviction or key rotation. Cancellation, expiry and page exit fence
late publication and abort pending transactions where possible. A commit that
preceded revocation is preserved, with no promise of automatic key deletion.

The participant account consumer uses this same tool without a new proof
protocol or backend policy. Its exact packaged dependency set, Android resource
allowlists and source-catalog closure include the new helper. Browser hardware
attestation remains unsupported/unverified. Neither retained keys nor valid
signatures establish a genuine browser implementation, unique physical device,
current OS state or hardware protection. No browser-fingerprint traits,
biometrics, passwords or login tokens are added to this store. WebAuthn, biometric
prompts, extensions and permission requests are not introduced. DBSC would need
a distinct cookie/refresh transport; the existing account channel uses explicit
bearer authorization through its JSON relay.

Managed Debian validation passed 127 focused Node cases for the shared tool,
account consumer/relay, participant package/workspace, source catalog and test
registry. All 16 existing account Chromium groups passed, including a fresh
authenticated sign-in after actual document reload that verifies the same
retained public key under a new session. Reload restores no login authority or
token. The canonical participant runtime is 277362 bytes within the unchanged
278528-byte (272 KiB) guard. No entirely green project regression run is claimed.

All 13 dedicated Chromium continuity checks passed using real IndexedDB and
WebCrypto through the canonical packaged modules. Independent Node verification
checked the actual signatures. Cases cover reload/tool closure, account/origin
separation, recovery-context substitution, same-account first-use races,
malformed/mismatched records, missing/denied/write-failed/actually blocked storage
fallbacks, and delayed cancellation/expiry/closure. A real 31-row store admitted
exactly one of two distinct accounts racing for slot 32; the loser and a further
account received `attestation_store_full`, the row count stayed 32, and the first
key still signed a fresh challenge unchanged. The fixture observed no unexpected
network requests, dialogs, credential/permission calls or fingerprint APIs.
These actual browser checks used managed Chromium 145.0.7632.6, not every browser
or operating system. Test reports and logs remain in the managed source snapshots
and selected private evidence records; no real identity or account was used.

Final review also reproduced a cancellation race: an immediate retry could adopt
the cancelled storage-open promise. The opening now has a revocable identity
lease, so cancellation releases it immediately and stale cleanup cannot clear a
retry's lease. The added regression passes for fresh proof creation, late-open
connection closure and timer cleanup. The complete focused and Chromium/account
checks above passed again after this fix; earlier run records are preserved.

The [storage contract](../sensors/ATTESTATION_TOOL.md#automatic-browser-continuity)
and [account consumer record](PARTICIPANT_SIGNIN_DEVICES.md) describe retention,
fallback, site-data clearing and assurance limits. The legal register records
the storage change and pending Privacy Notice coverage without changing exact
Account Terms bytes, version, digest or earlier acceptance records. This is
shared-source/browser-fixture validation; this continuation performs no live
account operation, backend deployment, APK build/installation or phone action.

### Email-first form and agreement from the terms view

The confirmed email is now first, with a muted gray readonly style, followed by
Username and Password. It stays selectable and keyboard accessible. A labelled
checkbox after the complete terms synchronizes signup consent and uses the same
Back action to return to the form. Opening/ordinary Back does not accept terms;
unchecking withdraws agreement while leaving the document open. It is disabled
without loaded pinned terms and a current confirmed enrollment entry. Agreement
alone does not create an account or write an acceptance record to the backend.

All 16 existing connected onboarding Chromium groups passed, including field
order, readonly versus disabled behavior, distinct styling, Tab/Space access,
checkbox synchronization, no agreement on Back, and preservation of the
in-memory eight-character password draft. Direct live-preview review confirmed
the email treatment and the agreement checkbox at the end of the document.
The final asset closure is fourteen files and 278298 bytes within the unchanged
272 KiB bound, including the separately integrated browser-key module. Unused
styles for the removed signup role chooser were removed; no budget was raised.
Terms bytes/version/hash and backend behavior are unchanged. No backend reload,
APK build, installation or external mail was needed for this UI-only follow-up.

### Signup terms review gate and fixed username prefix

Activating the signup agreement checkbox now opens the complete terms without
changing its checked state. Mouse, Space and associated label follow this same
path. Only deliberate agreement at the end returns with signup checked;
ordinary Back preserves the draft without accepting. Reopening an already
agreed checkbox preserves that choice. Missing terms or enrollment proof still
disable agreement, and account-detail edits invalidate the prior choice.

The username field has one fixed visible `@`, including while empty. Typing or
pasting a leading `@` removes the duplicate without moving the caret to the end;
the request still sends the existing bare canonical name, preserving server
uniqueness and existing accounts.

All 16 focused onboarding Chromium groups passed after the caret fix, including
mouse/Space/label review, ordinary Back, explicit end agreement, reopening,
typing/paste/Home edits, canonical request names and existing account/device/
recovery/deletion journeys. All 19 participant package unit checks passed.
These tests use synthetic service fixtures. Direct live-preview review also
confirmed the fixed prefix and unchecked terms opening with a reserved synthetic
contact; no account was created or agreement accepted during that visual check.

The runtime is fourteen files and 279490 bytes. The shared collector and Gradle
guard now explicitly allow 280 KiB, up from 272 KiB; no asset or dependency was
added, and image/APK guards remain unchanged. Terms content, version, hash and
backend behavior are unchanged. No backend reload, APK build or phone action was
required. The legal register records the agreement-flow change without adoption.

### Preserve signup agreement and explain Create account validation

At the owner's request, editing username or password now retains agreement to
the same terms. A rejected username submission also keeps that choice while
clearing the submitted password. This supersedes the earlier detail-edit
invalidation behavior. Explicit withdrawal, changed/unavailable terms and leaving
the signup/terms context still reset agreement. A terms-change response reloads
the authoritative document and refuses stale agreement.

The reported inactive Create account button was disabled by a hyphenated
username, which both client and backend reject. Once service, confirmed entry
and pinned terms are ready, the button now stays available: a click focuses the
invalid field and supplies specific inline guidance without sending enrollment
or clearing the draft. Hyphens explicitly suggest underscores. Valid details
without agreement open full terms; only a subsequent deliberate submit creates
an enrollment request.

All 16 focused Chromium groups pass with the final shared runtime. Added checks
cover terms surviving username/password edits and server username refusal,
password and hyphen feedback through actual button clicks, no request on local
refusal, successful enrollment after correction, and submit-time changed terms
clearing consent and blocking signup until a fresh document/agreement. The
fourteen-file runtime is 280790 bytes within the existing 280 KiB guard.

Live local-preview review used a reserved synthetic contact, confirmed that the
button focuses the invalid username and displays its correction, and left the
owner's filled original tab untouched. No account was created or agreement
accepted during that UI review. Backend contracts, terms bytes/version/digest,
asset count and dependencies are unchanged; no backend reload or APK/phone
operation was required.

### Original preview refresh, password guidance and live signup check

The owner reported Create account still inactive after the preceding fix. Direct
inspection found two previews: the preserved original tab still ran the earlier
code, while the temporary tab had the actionable button. The original had no
password entered when refreshed. It now runs the current shared assets; the
temporary tab was closed, leaving one app tab. Its development contact was
restored and the sample username used underscores. A button click focused the
empty password and displayed its guidance. No user password or agreement was
entered by that UI check.

Password feedback now distinguishes short, common, repeating, sequential and
username/email-derived choices. The inline message gives a concrete correction
and suggests unrelated words, with polite accessibility announcements. It keeps
the same accept/reject policy, eight-character floor and five levels; it adds no
mandatory character classes or entropy claim.

All 40 account client unit cases and all 16 onboarding Chromium groups passed.
The browser checks verify each reason-specific hint, continued agreement while
editing, local refusal without requests and corrected button-click enrollment.
The fourteen-file runtime is 281265 bytes within the existing 280 KiB guard.

A separate managed live check used the current public account adapter and
transport against the active local backend. Owned synthetic contacts completed
entry proof, enrollment with a generated eight-character password, mock email
confirmation, PKCE sign-in/current context, browser proof and device listing.
The final fixture session signed out successfully; browser possession remained
unverified. A preliminary harness expectation incorrectly used unsupported
instead of unverified after successful sign-in; correcting that QA assertion
produced the final passing result. The synthetic records remain preserved.
No user account, backend implementation/deployment, APK or phone was changed.

## Eight recovery codes and explicit text download — 22 October 2026

The owner selected eight independent single-use recovery codes. The shared UI
shows two columns and four rows of labelled readonly controls, reveals the same
set repeatedly, and downloads those exact eight in a text file. No saved-code
checkbox, download acknowledgment or separate-sign-in explanation remains.
Continue is available independently of export. Navigation clears the released
set and controls; history cannot restore it.

All 66 focused account/package unit checks passed, covering eight canonical
distinct random codes, defensive copies, stable uncertain retries, no factor leakage through snapshots,
exact export text, malformed/duplicate refusal, native save/cancel/failure,
wrong/malformed/late replies, cancellation and missing native bridge refusal.
All 16 connected Chromium groups passed, including two-column/four-row layout,
actual browser `.txt` download bytes/name, honest failure and retry, Blob URL
revocation, repeat reveal and clearing after Continue/history. The screenshot
uses synthetic fixture codes. Browser fixtures do not use the native APK origin.

The native pure Kotlin harness passed format, lease, expiry, stale-ticket and
cancellation checks, including zeroing the tracked worker copy on expiry and
refusing a copy after blocked provider-open expiry. Android 36/pinned WebKit
compilation, participant debug assembly and lint passed in managed Debian. The
collector selects fifteen runtime assets totaling 286867 bytes within the
explicitly reviewed 296 KiB guard; per-image and APK bounds remain 8 KiB and
8 MiB. APK-origin export requires the native picker bridge
and cannot claim success through an unsupported Blob fallback. No phone picker,
physical write, APK installation or distribution is claimed.

The private backend's focused parser/commitment tests, all nine account router
groups, formatting and strict all-target Clippy passed. Its additive migration
and API/worker reload preserved the live database, objects, tunnel and viewer.
Legacy single factors remain valid without silent rotation. A live owned
synthetic account completed eight-code enrollment and recovery through the shared
adapter. All eight old members were refused, including seven with valid email
proofs obtained before rotation. Old password, session and refresh authorization
failed; the new eight-character password, generation-bound browser device proof
and final fixture sign-out succeeded. The owner's open legacy recovery page and
factor were left untouched. Mail remains mocked and browser proof unverified.

Codes are memory-only until cleared, with no persistent web storage. The browser
revokes its temporary Blob URL; Android holds pending export bytes for at most
two minutes and writes only to the user-selected document. The selected plaintext
file persists under the user's storage controls. The service retains hashes and
retry commitments, never plaintext codes. Account Terms bytes, version, digest
and historical agreements are unchanged; Privacy Notice adoption remains pending.

## Compact Settings and API key copy — 22 October 2026

The owner requested distinct verification labels, compact separate Settings
actions, an available-network check and selectable/copyable `nv-` API key values.
Requests retain plain identity verification; Operations now say **Set up advanced
identity verification**, including the accessible warning. This changes labels,
not verification implementation or authority.

Devices, Sign out, Delete test account and the conditional local-session action
use separate compact rows with 44px targets. Online network indication uses a
success check, offline uses a warning and indeterminate uses unknown. Network
availability still does not establish internet reachability; no new probe exists.

The page-only key prototype generates `nv-` plus 32 hexadecimal characters and
retains its Demo marker. A labelled Copy button reports **Copied.** only after
clipboard success. Refusal or absence of clipboard access focuses/selects the
readonly field for manual copying. Clicking/focusing the field selects its full
value. Delayed UI results are fenced after Done, new generation, revoke, route
leave or page exit. Copy feedback has its own polite status; the generated result
is a labelled group, so feedback does not reannounce the entire secret.
There is no real API/MCP credential issuance, key-service request or persistent
full-key storage.

All 41 focused workspace/package unit checks and 32 Chromium groups passed.
Coverage includes distinct role warnings, online/indeterminate glyphs, separate
signed-in action rows without collisions at 320px and 200% text, usable targets,
key prefix/selection, copy success/refusal and delayed-result fencing. The exact
fifteen-asset runtime totals 289074 bytes within the unchanged 296 KiB guard;
per-image/APK limits and dependencies are unchanged. Synthetic Settings proof was
visually inspected. The live preview now serves these assets while the owner's
already-signed-in tab remains untouched; refresh requires another sign-in.
No backend, legal agreement, Android host, APK build/export or phone was changed.

## Email or username sign-in — 22 October 2026

The first field now accepts email or the public unique account handle, with an
optional leading @ and ASCII case normalization. It submits exactly one canonical
selector. A username routes the same eight-character code privately to its
current confirmed contact; the UI shows @handle without its email before proof.
Valid proof returns only the password step and the bound contact/username, then
uses the existing email/password PKCE and device-registration flow. Unknown
handles keep generic pending/code behavior, expose no contact and cannot create
an account. New-account enrollment still starts from a confirmed email.

All 84 focused account/relay/package unit cases and 17 Chromium groups passed.
Coverage includes optional-@/case parsing, malformed and mixed selectors, stable
retries after a lost proof response, contact disclosure only after proof,
malformed/mixed service response refusal, unknown-user privacy, and cancellation
across selector changes. Existing email signup, password, terms, recovery and
deletion regressions remain covered. The exact fifteen-asset runtime is 290709
bytes within the unchanged 296 KiB guard, with no new dependency, native bridge
or permission. No APK build/export or physical device change was required.

Managed backend checks passed 2 selector unit groups, 4 username/SMTP binding
groups, 12 retained signup/account groups and 3 deletion/reuse groups, plus
formatting and strict all-target Clippy. They cover explicit null/mixed refusal,
unknown/no-mail operations, one-connection-pool routing, exact retries, renamed,
disabled, deleted or reused bindings, signup-proof refusal and worker revalidation.
The additive selector-binding migration and API/worker reload then succeeded,
preserving the database, objects, viewer, protected tunnel and existing accounts.

One owned synthetic live fixture proved email enrollment, bare and @UPPERCASE
username retries with the same operation, real development-code contact
resolution, password PKCE/current context and browser device proof/listing.
An unknown username returned identical pending202, no mock code and refused proof
with email still absent. The fixture session signed out and its record remains.
No user account was inspected or changed. Email remains mocked and browser
attestation unverified; no external delivery or physical Android claim is made.

The actual signed-out app tab was safely refreshed, visually inspected and left
on the new form with its typed identifier restored, without submitting it.
Account Terms bytes/version/digest are unchanged; the legal register records
alias routing and pending Privacy Notice coverage.

## Workflow identity prerequisites — 22 October 2026

Owner-requested prerequisite checks now disable New request until basic identity
verification and New operation/offers until advanced verification. One shared
policy covers the native controls, navigation, rendering, history restoration,
form input and submission before workflow draft mutation. Read-only lists and
the example work remain accessible. Account loss/change clears workflow-only
draft/review state; ordinary denied actions preserve inert drafts.

The account adapter's validated service contract currently reports only pending
identity. There is no accepted basic/advanced eligibility record, so all current
accounts remain locked. Email confirmation, roles, reviewed photos, device
possession/attestation, display readiness, DOM changes and history claims cannot
grant eligibility. Private coordination authorization was inspected: it does not
yet enforce this person-verification distinction. No work mutation is connected
from these preview forms, and no backend verification policy, endpoint, identity
decision or account promotion was added. Authoritative eligibility and its
server-side enforcement are required before connected work actions are enabled.

All 43 focused workspace/package unit cases and 31 Chromium groups passed in
managed Debian: 13 shell/history groups and 18 account/capture groups. They
exercise every protected route, native disabled mouse/keyboard behavior,
delegated-route and Back/Forward tampering, blocked hidden-form input and
programmatic submissions without draft changes or service dispatch, signed-in
pending accounts, unsupported capability claims, reviewed local photos and
current-session revocation. Existing account/signup/recovery, API prototype,
capture, status, 320px/200% layout and strict-CSP/package-parity checks remain.
Two initial browser failures were corrected test selectors (the hidden draft
row rather than its child button, and an unambiguous visible screen); the same
behavior assertions then passed. Independent static review found no additional
bypass or initialization/reentrancy issue.

The fifteen-asset runtime totals 296073 bytes under the unchanged 296 KiB guard;
image/APK bounds, dependencies, native interfaces and permissions are unchanged.
Only the exact participant preview process was restarted from the reused source
snapshot. The actual review tab was reloaded after confirming it held no draft
or secrets, resetting its in-memory sign-in, and left with the visibly disabled
creation controls. No user account records, terms bytes, backend service, APK
build/export or physical device were changed.

## Signed-in Account details — 22 October 2026

Settings → Account now opens a centered Account page for the current signed-in
session. It shows selectable email, public @username and pending identity
verification details from the validated account snapshot. Signed-out entry still
shows Sign in and the existing email/username flow. No new route, server field,
credential storage or identity decision was introduced.

Devices, Sign out and Delete test account moved from Settings to that page.
Identity verification revalidates current account/session authority before
opening the separate setup journey. Confirmed server sign-out clears displayed
details and the old identifier, then focuses the sign-in field. An unknown
sign-out still exposes local forgetting without claiming revocation. Pending
deletion keeps its status/retry flow. Account loss clears details immediately;
losing authority with Devices focused moves focus to the visible heading,
including when a delayed Settings check returns after its drawer was closed.

All 20 focused package/parity cases and 31 Chromium groups passed in managed
Debian: 13 shell/Settings groups and 18 account/capture groups. They cover action
placement, exact safe details and selection, independent signed-out entry,
current-account revalidation, successful/uncertain sign-out, device-session
revocation, deletion/reuse, background authority loss, keyboard behavior and
320px/200% text layout. One initial browser expectation was updated to recognize
the sign-in field's deliberate focus after confirmed sign-out. Independent
review found the moved Devices control's hidden Settings focus target; the
visible-heading fix and natural delayed-response regression passed.

The fifteen-asset runtime is 297309 bytes under the unchanged 296 KiB guard.
Normal and large-text Account screenshots with synthetic fixture data were
visually reviewed. Only the exact local preview process was restarted to serve
the new assets. The owner's signed-in tab was preserved; a future reload clears
its memory-only session and requires sign-in again. No real user account
mutation, terms change, backend change, APK build/export or device action was
performed.

## Password-first sign-in and account action icons — 23 October 2026

Existing-account entry now accepts email or public @username locally and opens
the password step without an account lookup, email challenge or contact
disclosure. The separate Create account action starts email-only signup and
still requires confirmed contact proof before reviewed enrollment. Recovery
retains its independent recovery-code and email-proof requirements. Password
authentication preserves S256 PKCE, issuer/client/callback/nonce binding,
validated token/current-account context and subsequent device possession proof.
The public account_username selector remains distinct from the legacy opaque
username namespace; context must match the submitted email or public handle.

Account now shows email and @username without the duplicate Identity
verification/Pending row. Devices and Sign out have matching line icons;
Delete account is red with a trash icon. The existing warning appears beside
Identity verification only when the current signed-in account requires it,
with an accessible description. Pending deletion changes its label without
removing the icon. Sign-out uncertainty, local forgetting, deletion review,
authority loss and basic/advanced workflow prerequisites remain enforced.
Identity remains pending under the current validated service contract.

All 111 focused public unit/package cases, 13 shell Chromium groups and 18
account Chromium groups passed in managed Debian. Coverage includes direct
email/optional-@/case-normalized password entry without mail calls, selector
and context mismatches, generic credential denial, explicit signup, terms,
recovery, cancellation, session/device revocation, deletion/reuse, keyboard
focus and 320px/200% text. Browser checks caught and verified fixes for a hidden
warning description and signup Back restoration across route changes. The
delayed Devices regression observes the exact request's completion or deliberate
cancellation with bounded waits and verifies that a late reply cannot replace
Back navigation. The fifteen-asset runtime totals 302138 bytes under the
unchanged 296 KiB guard; no dependency, native interface or permission changed.

Private managed validation passed 2 OIDC unit cases and 6 retained-database
groups, 2 username-entry unit cases and 4 database groups, 12 signup groups,
3 deletion groups and 1 OpenAPI contract case, plus formatting and strict
all-target Clippy. These groups overlap and are not a unique aggregate count.
They include alias/principal locking and stale-binding rechecks. The documented
API/worker application reload and service verification passed with existing
database, objects, viewer, tunnel and policies preserved; no migration was added.
One owned synthetic live fixture authenticated by email and optional-@ uppercase
username through password/PKCE to the same account context. Both sign-ins made
no entry/start/confirm/mock-mail call and left its mail-outbox count unchanged;
their temporary sessions were revoked. No user account was inspected or mutated.

Synthetic normal/large-text Account screenshots were visually reviewed. The
actual signed-out review tab was safely refreshed and advanced with its public
handle to the new password step, leaving the password blank and submitting no
authentication. Exact Account Terms bytes/version/digest remain unchanged;
the legal register records the flow change and pending notice coverage. Email
delivery remains mocked in the live local proof. No APK build/export, physical
Android action, hardware-attestation or completed identity-verification claim
is made.

## Compact identity stamps and Account copy — 23 October 2026

Owner-selected sage Level 1 and mahogany Level 2 stamps now appear as small
identity targets: 48px on setup and 40px on the document/photo/review steps.
Adjacent text identifies Requests/Operations and explicitly says Not verified.
The capture indicator follows the immutable bound role after preparation begins.
Account and its Settings entry include 32px earned-stamp strips controlled by
the same workflow-access policy as the corresponding protected actions. The
current validated pending-only service contract unlocks neither, so these
strips remain hidden. No new local verified flags or service authority were
accepted; confirmed email, photo review, device proof and restored history
cannot grant a stamp or enable work.

Settings now links directly to Identity verification, including before sign-in;
signed-out photo preparation remains disabled. Account/identity copy uses short
literal headings and labels, without internal prompts, promotional questions
or repeated status blocks. Photo consent still precedes collection; page-only
storage and clearing on close/reload are explained before capture. Unsubmitted,
unverified and unchecked-liveness states, terms review, recovery factors,
unknown sign-out and deletion consequences remain explicit. The final photo
screen has one discard action. No exact Account Terms bytes, version, digest,
acceptance record, backend policy or actual identity status changed.

All 111 focused account/relay/workspace/package unit cases, 13 shell Chromium
groups and 18 account/capture Chromium groups passed in managed Debian. Final
package checks also passed after the copy cleanup. Coverage includes exact
browser/APK asset closure and production/review CSP separation; pending/forged
claims, photo review, history and authority loss cannot earn badges; Settings
navigation/Back, bound-role indicators, decode/size, keyboard targets and
320px/200% text remain covered. A stale pending-confirmation wording assertion
was updated without changing its proof/state checks. Independent review caught
and verified restoration of the pre-capture photo-lifetime notice; visual QA
also removed duplicate final-screen copy and discard controls.

The approved transparent PNG masters are preserved outside the runtime closure.
The managed branding recipe prepares 128px WebPs at quality 0.78, exactly 6320
and 7096 bytes; its subsequent --check matched both. The individual 8 KiB image
guard remains. The seventeen-asset runtime is 317252 bytes within the explicit
320 KiB feature bound, replacing the previous fifteen-asset 296 KiB bound for
these two stamp assets and compact interface. Native changes only extend the
exact static-asset allowlist and matching size check; no interface, permission,
dependency, APK build/export or physical-device action was added.

Normal and enlarged-text setup plus synthetic photo-step screenshots were
visually inspected. A new review tab shows the updated identity menu while the
owner's existing signed-in tab remains untouched. No real credentials, photos
or user account mutations were used to review this change. The private progress
record covers this presentation milestone only; authoritative verification and
connected-work service enforcement remain open.

## Sequential identity pipelines and unverified stamp — 23 October 2026

The owner's follow-up replaces the level selector with fixed Level 1 and
Level 2 entry points. Level 1 binds the requester capture role; Level 2 binds
the operator role and requires canonical Level 1 eligibility before any
dispatch, after current-account revalidation, throughout capture and on
restored navigation. Eligibility loss cancels an advanced capture. Disabled
controls are backed by handler/route checks; DOM changes, history flags and
local photo review cannot satisfy the prerequisite. The pending-only account
contract still grants no verified level, so Level 2 remains locked. This adds
no verification service or advanced identity decision.

Signed-in pending accounts now show a small gray Unverified stamp and caption
in Account and Settings, instead of an empty badge area. Signed-out views show
no account stamp. Earned Level 1/2 remain policy-gated, and Level 2 additionally
requires Level 1. The gray artwork has no checkmark or level number. Its
1254px transparent master is preserved; the exact managed 128px/0.78 WebP is
5858 bytes. The recipe --check passed with the earlier four artwork targets
unchanged. All eighteen runtime assets total 325590 bytes inside the retained
320 KiB bound, with every image below the retained 8 KiB limit.

Demo/availability and page-lifetime notes now sit below the identity actions.
The document processing choice still explains page-only use before collection;
photos remain unsubmitted and clear on close/reload, discard or authority loss.
Exact terms, recovery factors, device/person-verification separation and
unknown sign-out/deletion handling are unchanged. No backend or account state,
permission, native interface, dependency, APK or physical device was changed.

All 111 focused public unit cases, 13 shell browser groups and 18 account/capture
groups passed in managed Debian. They cover gray-badge session loss, absent
selector, fixed Level 1 binding, native disabled behavior, programmatic/DOM-
enabled Level 2 refusal with no service/camera/photo mutation, forged history,
reviewed photos without promotion, footer ordering and 320px/200% text. All
photo regressions use the eligible Level 1 preparation path. Independent review
found no additional bypass or reentrancy issue. Normal and enlarged pipeline
screens plus synthetic gray Account proof were visually inspected. The live
review tab was refreshed to the new menu without changing the owner's separate
signed-in tab, entering credentials or mutating user accounts. The private
presentation milestone and legal register reflect the refinement; actual
verification authority and server-side work eligibility remain open.

## Identity details and gated private intake — 23 October 2026

The shared Account view now places the current identity stamp beside its heading,
orders username before email and keeps compact actions at the bottom. Signed-in
identity entry opens the Level 1 document form directly. The capture header uses
a faint decorative target-level stamp; no target stamp is an earned verification.
The form collects document type, full name, city of birth, nationality and age.
Review shows those values alongside both processed photos.

The bounded image adapter accepts JPEG/PNG phone photos up to 32 MiB and
64 megapixels, preserves orientation, and emits JPEGs of at most 2 MiB each.
Maximum output edges are 2400 pixels for documents and 1280 for faces. It removes
nonessential metadata before and between scans while preserving encoded image
bytes. Actual Chromium checks exercised a 48 MP JPEG, EXIF orientation, PNG
conversion and the encoder's ICC block. The private intake independently rejects
hidden metadata, including an authenticated caller bypassing client preparation.

Hx02 supplied the exact 3509-byte synthetic Identity Intake Notice, version 1,
SHA-256 `e758daf9412756dd37ea43c79a7ebec21745109fa0dc9e9125fd029adbde8a27`.
The bundled client pins the full text and digest, opens a complete notice view,
requires deliberate agreement at its end, and submits only on a separate action.
Photo/field changes invalidate review and agreement. A fresh notice check before
writing preserves authentication fences and handles availability changes. Account
Terms and historical acceptance bytes are unchanged.

The authenticated private service binds intake to the current account, principal,
session and recovery generation. Synthetic tests verify durable image readback,
exact notice acceptance, concurrent idempotency, replay/conflict, cross-account
and stale/revoked-session denial, and receipt lookup. Only an acknowledged receipt
produces Saved status. Interrupted writes keep the original operation for status
checks, without automatic resubmission or an invented verification result.

Executed checks in the existing managed Linux environments:

- All 156 focused public unit/package/workspace/account/relay/capture/camera cases
  passed, including definite pre-write failures versus unknown writes and the
  Account-to-Level-1 notice-reset regression.
- The shell Chromium suite passed all 13 groups. Android participant assembly and
  lint passed using the documented pipeline; no phone action or APK export ran.
- Private checks passed 3 image/notice units, 3 durable database/object-storage
  groups, 6 OpenAPI checks, strict all-target Clippy and formatting. Six live guard
  groups and readiness/readback checks passed after the gated service reload;
  private tables remain inaccessible to the ordinary viewer.
- Nineteen runtime assets total 360593 bytes within the explicitly reviewed
  384 KiB intake-client budget. Individual images retain their 8 KiB bound and
  the APK retains its 8 MiB bound. Native asset lists and debug-only closed
  transport paths include the notice and bounded intake request; production CSP,
  network isolation and release asset exclusions remain intact.

The live service reports intake unavailable and refuses uploads before reading
photo payloads. Durable storage was tested with synthetic fixtures only. Real-ID
collection remains closed pending the custody, retention, reviewer access,
delete/backup and adoption decisions in the
[Hx02 notice contract](IDENTITY_INTAKE_NOTICE_REVIEW.md). No real identity data was
uploaded, identity approved or work eligibility granted. These results establish
the scoped software behavior, not compliance or production readiness.

The final account/capture Chromium suite passed all 20 groups against the same
360593-byte runtime. Its new groups cover durable-receipt UI fixtures, unknown
POST outcomes with status-only recovery, known rejection, unavailable/changed
notice, forged verified receipts and actual 48 MP JPEG/PNG normalization. Existing
account, recovery, session/deletion, camera lifecycle, stale-result, keyboard and
320px/200% text cases remain green. Normal Account, direct Level 1, saved synthetic
receipt and enlarged form/notice screenshots were reviewed. Intercepted service
fixtures establish browser behavior; separate private service tests establish the
storage boundary. Neither substitutes for phone-camera acceptance or real-person
identity review.

## Identity controls in Account — 23 October 2026

The follow-up layout review removes the identity-verification link and status
badge from Settings for both signed-out and signed-in accounts. Settings retains
only Sign in or Account in that section. The current stamp and identity entry
remain on the Account page. The form starts with Full name across the full row,
then City of birth/Nationality, then Age/Document type. Narrow layouts stack in
the same DOM and keyboard order. The global Discard photos link is removed;
individual replacement controls and the existing status action are unchanged.

All 43 focused package/workspace cases, 13 shell Chromium groups and 20
account/capture Chromium groups passed in the existing managed container. The
browser cases assert absent Settings controls in both account states, retained
Account status, form reading/keyboard/visual order, and 320px/200% text layout.
A selected document and filled details clear on visible Back to Account; existing
browser-Back/late-permission cases still prove stale capture cannot return.
Normal Settings, normal form and enlarged form screenshots were reviewed.

Nineteen runtime assets now total 359432 bytes under the unchanged 384 KiB bound.
This refinement changes shared presentation only; no Android build, phone action,
backend reload or storage/authority change was needed. Hx02's completed notice
review was checked: its canonical version, exact text and digest already match
the integrated draft. No agreement or retention decision changed.

## Direct face photo capture — 23 October 2026

The participant Face photo screen now uses a single frontal-still flow. Start
camera opens one preview with an oval positioning guide; Take photo is enabled
when the live frame is ready. Capture stops the sensor before encoding and shows
the selected photo, Retake photo and Review details. Retake from either capture
or review clears the old image and review/notice agreement, then opens the camera
for a new deliberate still. Stop camera returns to the idle card. Focus follows
Start, Take and Review after controls become enabled.

The five-position movement menu and skip link are removed from the participant
interface. It selects the existing frontal-only capture mode without collecting
movement frames or asserting liveness, matching the same one-photo custody and
pending-review contract. Shared optional guidance APIs remain for other consumers.
The capture lease, account/session validation, image preparation, foreground,
cancellation, late-result and sensor-cleanup fences remain in place. Route/epoch
checks precede permission acquisition, including after an interrupted retake.
A delayed review-retake account check cannot open the camera after Back has
returned to the Face photo screen.

The Account stamp is 112px, with a 96px size on narrow screens. A wrapping heading
layout reserves space for the title and badge, including enlarged text; the existing
128px prepared artwork and individual image bound are unchanged.

All 83 focused package/workspace/capture/camera tests and 13 shell plus 20
account/capture Chromium groups passed. Browser cases cover idle/live/selected
states, frame-ready capture, Stop/Take keyboard focus, immediate retake and old
URL cleanup, a single still rather than movement recording, stale permission and
navigation, pending identity authority, and 320px/200% text without badge overlap
or horizontal overflow. Normal Account and idle/live/selected face views plus
enlarged-text proofs were visually reviewed. Nineteen runtime assets total
360641 bytes under the unchanged 384 KiB budget. No Android build, phone-camera
acceptance, new identity decision, backend or notice/retention change is claimed.

## Compact identity submission — 23 October 2026

Continue from the selected face photo now performs the deliberate exact-revision
review and opens Submit identity. The final step omits the repeated photo
confirmation and keeps fields, photos and editing inside a closed Review or
change details disclosure. Opening or closing that disclosure changes no review
or agreement. Missing metadata in restored history returns directly to the
document form, with continuation disabled and selected media retained.

The final checkbox, associated label and notice link open the complete pinned
document without agreeing. Available Submit before agreement opens that same
document without posting. Only the checkbox at the document end accepts it,
returns through Back and checks the final choice. Changes to metadata or either
photo clear review and notice agreement. Unavailable intake shows one status
instead of a disabled Submit. Unknown submissions hide editing/agreement and
offer only status lookup for the original operation.

All 83 focused package/workspace/capture/camera checks and 13 shell plus 20
account/capture Chromium groups passed on the final source. Browser cases cover
checkbox click, Space, associated label, link and Submit; full canonical text
and agreement ordering; Back without acceptance or upload; metadata/photo
invalidation; delayed-retake cancellation; incomplete metadata through Back and
restored status routes; unavailable/invalid notices; original-operation lookup;
and disclosure/notice keyboard access at 320px with 200% text. Compact,
unavailable, expanded and enlarged-text views were visually reviewed using
synthetic fixtures. The 19 runtime assets total 362500 bytes under the unchanged
384 KiB limit. Both repository whitespace checks passed.

The local preview serves the updated source. The private progress dashboard was
refreshed through its documented managed-container procedure. This shared UI
refinement changes no notice or Account Terms bytes/version/digest, stored data,
backend, identity award, custody gate or adoption decision. No new APK build or
physical-camera acceptance is claimed.

## Home arrival and test-intake guidance — 23 October 2026

The shared participant Home now gives a bounded arrival cue: the character
rises/settles over 900ms, followed by three 1400ms navigation-button background
pulses. The menu icon stays visible. Initial visible entry and a fresh sign-in
start the sequence; ordinary Home revisits and status probes do not replay it.
Menu focus, opening a panel, leaving Home, hidden/page-exit state and a reduced
motion preference stop or suppress it. A 6500ms fallback bounds the sequence.
It changes no focus, menu state, status authority or sensor permissions.

Document Try again has a trash icon, revokes the selected preview, preserves
entered fields and returns focus to the enabled camera action without sensor
acquisition. The final review disclosure precedes notice agreement in both DOM
and keyboard order. Its pending-status copy distinguishes private test intake
from document checks and account validation that are still being developed.

All 83 focused package/workspace/capture/camera checks, 20 account/capture and
14 shell Chromium groups passed on the final 365720-byte, 19-asset runtime under
the unchanged 384 KiB bound. Browser checks cover the natural animation sequence,
fixed durations/repeat count, bounded cancellation and initially hidden/reduced
motion cases; fresh sign-in and unchanged status updates; retry URL cleanup,
focus and no automatic camera; review ordering; exact notice/receipt/unknown
write guards; and 320px/200% text. Animation frames, document retry and final
review views were visually checked with synthetic/anonymous fixtures only.
The participant preview was refreshed while preserving the existing user tabs.

The owner explicitly chose test-data submissions under unchanged synthetic-only
notice v1. Hx10 owns the client changes above; Hx11 owns review, completion,
service admission/activation and live service evidence. Hx02 owns notice/custody
records and the pending real-user proposal. At this UI checkpoint, prepared
default-off test-policy changes were handed to Hx11 before any runtime policy,
account selection, reload or activation. No real-ID scope, successor notice,
reviewer, processing-time promise or identity award is established here.
No new APK build or physical-camera acceptance is claimed.

Hx11 subsequently completed the [selected test-only service activation](SERVICE_IDENTITY_INTAKE_CHECKPOINT.md).
Exactly two existing confirmed synthetic accounts, including the current client
review account, were selected. Nine focused policy/image and retained
database/object-store cases, startup/readiness/lint checks and eleven enabled
live groups passed for the activated v1 scope. Synthetic submission, exact retry,
conflicting retry refusal, original receipt lookup, private exact-byte readback
and unchanged pending identity/work context were verified. Hx11's checkpoint
owns the service evidence and its limits; no client uploads of real user photos
or credentials were performed here.

The participant preview retains the tested 365720-byte v1 runtime from
`/tmp/nonverba-unified-source/de2bed58e1c74b5082105ff96ffe2d6a`.
Separately ongoing camera-proof and v2 notice/parser source changes were found
in the shared checkout after these checks. They were preserved and left out of
the served snapshot. The successful client and server results above describe
the verified v1 runtime, rather than a clean-check or deployment claim for that
later working tree.

## Identity camera tool and independent proof verification — 23 October 2026

The owner requested the hardened camera path for identity-document and frontal
photos. The current source now shares the actual native Camera2 controller
between the developer and participant profiles. Identity requires rear/front
respectively, acquires no location, normalizes a bounded metadata-free JPEG
before signing, uses a separate account capture key, and preserves those exact
bytes through review and intake. The browser signs its normalized photo with a
separate nonextractable document key and reports only observed/unknown lens
information. File import remains unverified. The
[tool contract](IDENTITY_CAMERA_TOOL.md) records the wire format and assurance
limits; private account challenge/storage implementation remains private.

Executed checks in the existing managed Linux containers:

- **178 focused Node cases passed**, covering capture, proof and exact-byte
  workflow, notices/history, account/relay, asset/catalog and APK inspection
  boundaries. Rust-generated native/browser proofs and an actual JCA-generated
  proof were independently verified by WebCrypto against exact transcripts and
  JPEGs. **8 core Rust cases passed**, with only the explicitly opt-in synthetic
  fixture generator ignored. Public-core library Clippy passed with warnings
  denied. Private checks passed **5 unit and 7 retained synthetic database/object
  cases**, plus private-library Clippy with warnings denied. They cover original
  authority/context, proof mutation, retry/replay, expiry, both-photo rollback
  and atomic consumption, quotas, historical v1 retry and viewer denial.
- **20 Chromium workflow groups passed** against exact packaged client bytes,
  intercepted account HTTP/OIDC and synthetic browser camera frames. The new
  cases verify no image/hash in challenge requests, proof-bearing final JPEGs,
  no sensor/result when challenge policy is unavailable, and no media upload
  when availability disappears after capture. Screenshots were retained and the
  compact submission page was visually checked. No real service, mailbox,
  physical camera or identity data was used by this browser run.
- The final production Kotlin protocol/JPEG/lens/document-access/queue harness
  passed real JCA signature and refusal checks. An independently retained JCA
  fixture is verified by both Rust and WebCrypto. The five moved-helper runners
  also passed **744 deterministic checks** across timing, session/recording,
  diagnostics, cleanup and main-thread guards. They do not emulate Camera2 or an
  Android permission dialog. Review found and fixed a permission-pause race:
  identity authority now always revokes on pause; only scoped cancellation is
  accepted while paused. If a camera-permission dialog pauses the Activity, the
  attempt cancels and its grant requires a fresh deliberate Start. The signing worker permits one
  running and one queued JPEG; excess work refuses with cleanup.
- The documented **all-target Android build passed** developer native output
  for arm64-v8a/x86_64, assembly and lint for both apps. Developer APK inspection
  passed schema 2, retained signer, package/current-Linux-source checks with no
  errors or gaps. A subsequent inspector change permits only the explicit
  reviewed shared camera classes while still refusing developer host/JNI/sensor
  classes and unknown classes; **20 package cases passed**, followed by a
  participant build/lint and schema-1 package inspection. Its APK is **2,825,994
  bytes**, runtime **390,277 bytes**, within the unchanged 8 MiB/384 KiB bounds.
  It has no JNI/model/WASM payload and adds no location or microphone permission.
  The inspector's legacy `developer_class_prefix_excluded` result denotes the
  excluded developer classes with this explicit shared-controller exception.

Initial checks exposed a stale source assertion (158/159 passed) and a browser
fixture that requested capture while policy was deliberately unavailable. The
assertion was updated for the new native bridge, and the fixture now tests that
refusal plus a separate pre-write availability loss. The product gate was not
relaxed and no timeout was increased to hide the failure.

The combined source snapshot was
`/tmp/nonverba-unified-source/5703a70d9df84f5ba6795c9c3abbec35`, base
`44dfbb0c413cc450d78065cf92874e1f77b20c11`, dirty source, archive SHA-256
`8b2cb4953937d3f110bb87a9c004fdc6bfcbf93f7e444689ddcae85df81e992b`.
The focused package-tool continuation used
`/tmp/nonverba-unified-source/50e3135fc9af4e6f9e9fadd64922e145`; recursive source
comparison confirmed identical shared web, participant UI, native app/shared/
participant and core source before its build. Existing snapshots were not
patched in place. Selected authentic logs, reports and synthetic screenshots
remain private. Private test outcomes above are supported by their execution
transcript and authored private checkpoint, not a fabricated raw-log export.

The synthetic-only notice successor v2 is 4694 UTF-8 bytes, SHA-256
`d39fa9049feb18fc7db8d2ce0731fecba738b3c10fadce09130521c3a270fbca`;
v1 remains exactly preserved, with Account Terms unchanged. No live migration,
API/worker reload, protected policy change, preview replacement, APK export,
phone installation or personal capture was performed. The selected v1 runtime
and preview described above remain separate from this validated source.
Physical front/rear selection, orientation and permission/lifecycle acceptance
remain untested. A valid proof establishes byte/context integrity and possession
of the selected key; it supplies no trusted native/browser origin, uncompromised
device, document authenticity, liveness or identity award.

## Account-aware Home cue — 23 October 2026

The Home arrival now directs its menu cue to Options while signed out and
Navigation while signed in. Only the selected button pulses after the character
settles. The stronger peak uses `#7c4334`, sampled from the canonical character's
book, a cream glyph and an eight-pixel red-brown halo at 28% opacity. The icon
stays visible. Existing 900ms character motion, three 1400ms pulses, 6500ms safety
bound, focus/panel/navigation/lifecycle cancellation, reduced-motion suppression
and ordinary-revisit/status-update no-replay behavior remain.

The retained v1 preview snapshot
`/tmp/nonverba-unified-source/de2bed58e1c74b5082105ff96ffe2d6a` received only
`participant.js` and `participant.css`, plus the two browser test scripts.
All 83 focused participant package/workspace/capture/camera checks, 20 account
and 14 shell Chromium groups passed. The 19 runtime assets total 366117 bytes,
within the unchanged 384 KiB limit. Anonymous/synthetic midpoint screenshots
were visually checked for both targets, with no simultaneous pulse. Tests also
cover target-focus cancellation and the existing timing, lifecycle, reduced
motion and no-replay guards.

The account report confirms notice version 1 and no camera-proof assets.
Browser fixtures retain the separate v2 challenge/proof cases, selecting the
availability scenario from the collected asset closure; this run exercises the
retained v1 runtime. Only the owned participant preview was restarted. User tabs,
the selected v1 live service, protected policy and migrations were preserved.
Camera-proof/v2 source remains separate and undeployed. No APK build, phone
installation, physical-camera acceptance or real-ID submission was performed.

The owner subsequently found the red-brown cue too harsh. The shared pulse now
uses warm beige `#dfc2a4`, sampled from the canonical monk's robe at (580,760),
with the sage icon retained and an eight-pixel `#c19664` tan halo at 16% opacity.
The color-only follow-up passed all 14 shell Chromium groups on the retained v1
snapshot; the 19 assets total 366125 bytes. Its natural Options midpoint was
visually reviewed. Auth-selected targeting, timing, cancellation, reduced motion
and no-replay checks passed unchanged. The earlier account and unit suites were
not repeated for this stylesheet refinement. The preview was refreshed with
only this stylesheet; the v1 service and separate v2 source boundary remain.

## Account identity state and saved-password sign-in — 23 October 2026

The account adapter now owns a separate immutable identity submission state
machine. Generic pending verification, photographs, roles and device proof do
not establish a received submission. Exact authenticated receipts and the
current-account status read distinguish unverified, checking, awaiting approval
and unavailable states. Every observation is fenced by account, principal,
recovery generation and session. Status tokens prevent a delayed empty result
from replacing a newer receipt or account. Cancellation settles its matching
request to unavailable and notifies the UI; it cannot leave Checking stuck or
erase a newer accepted result. No client status is stored as authority.

The account's gray stamp carries an Awaiting approval overlay for a received
Level 1 submission. Requests show the waiting clock; Operations retain their
Level 1 prerequisite warning. Neither family unlocks. Done is a green primary
button and clears local capture state. Account identity actions reopen the
read-only saved status. An unresolved original write retains its original
status-check path even when the account also has a known submission.

Identifier Continue progressively uses an origin-bound PasswordCredential only
on that explicit action and only for a matching canonical identifier. It calls
the existing sign-in adapter. Unsupported, cancelled, refused or mismatched
results retain the password step. No visible password field was added to the
identifier step, and no hidden password bait, passive manager request,
credential store or credential logging was introduced. Browser/third-party
manager support is variable. All executed manager checks use synthetic stubs,
with the native manager API disabled in ordinary browser fixtures.

Across focused runs in the managed Linux source candidate, 142 Node checks
passed: 78 state/helper/workspace/relay/package checks and 64 account-adapter
checks. These include strict DTOs, current-owner binding, malformed/foreign/
unsupported receipts, 401 clearing, historical receipt discovery, direct POST
and original-operation receipts, overlapping reads and current-session/recovery
changes. The cancellation regression covers explicit abort and entry reset,
with and without a newer accepted receipt. Source package checks caught a
missing native allowlist entry and the first native build caught its remaining
384 KiB guard. Both were corrected; a new parity assertion requires the native
and browser budgets to agree at 400 KiB. Per-image and APK bounds remain 8 KiB
and 8 MiB. Participant assembly and lint then passed on the final frozen source.
The managed build retained its signer and created no export or phone install.

The combined source candidate is
`/tmp/nonverba-unified-source/e57dbffd626643e68779da7f24111ace`.
Its 23 runtime assets total 406205 bytes. The source-only camera-proof/v2 path
remains separate from the selected v1 preview. The isolated v1 UI candidate is
`/tmp/nonverba-v1-status-source-SvcnSj`: its 21 runtime assets total 381715 bytes,
with the exact v1 notice and no camera-tool/proof assets. It copies only the
explicit retained v1 runtime catalog, required notices, builder/preview helpers
and browser harness; known v2 camera-only source hunks are excluded from the
shared account/UI changes. No generated-output or cache tree was copied.

Hx11 owns the [status service and v1 release evidence](SERVICE_IDENTITY_INTAKE_CHECKPOINT.md).
The authenticated summary is live under its explicit v1 build selector. It
preserves notice v1, the same two-account synthetic intake policy and migrations
1–18. Fourteen live status checks and twelve v1 submission checks passed there,
including receipt restoration across fresh sign-ins. No approval authority or
real-ID intake was selected by this client work.

Final Chromium runs passed 22 account/capture and 14 shell groups on each frozen
candidate. The v1 reports confirm notice version 1 and no camera-proof assets;
the v2 reports confirm version 2 and its separate proof assets. Cases include
synthetic saved-password selection and fallback, late chooser results after
navigation/input changes, restored pending status, foreign/stale/malformed
observations, unknown original writes and narrow layouts with 200% text.
The browser fixtures exercise intercepted account HTTP, not the live backend.
Hx11's live service checks above retain their separate scope.

The green Done button, Awaiting approval stamp overlay and waiting navigation
icon were visually reviewed at normal size and at 320px with 200% text. The
managed browser's font configuration resolves system UI and serif fallbacks to
Liberation Mono; these captures do not establish Windows font rendering or
physical-device acceptance. No real password manager or physical camera was
used in these checks.

Only the owned participant preview process was replaced with the validated
isolated v1 candidate. HTTP checks confirmed the noindex review entry, new state
model and saved-password helper, exact v1 notice digest and a 404 for the v2
camera-tool asset. An initial verification assertion used a nonexistent notice
version export; it was corrected to inspect the exported notice object and hash
the exact notice text. User tabs and drafts were left untouched. The combined
v2 source remains undeployed, and the existing managed container and service
data were preserved.

## Silent saved-password retrieval — 23 October 2026

The owner observed an extra browser account chooser in the initial shortcut.
That implementation used optional mediation, which allows a browser prompt.
The helper now requests only `mediation: 'silent'` on explicit Continue. It uses
an exact matching password if the browser can release one without user
mediation; otherwise it returns to the existing password step without an
interactive retry. A username-only autofill does not expose a password, and
this does not provide arbitrary access to a third-party password vault. The
browser may still display its own automatic sign-in status indicator. See the
[published mediation contract](https://www.w3.org/TR/credential-management-1/#mediation-requirements).

All eight focused helper cases passed in managed Linux. The browser fixture
requires silent mediation on the direct shortcut and on null, refused and
mismatched fallbacks. Existing account matching, cancellation, navigation,
identifier-change and signup-bypass guards remain. Runtime catalog checks pass
at 381798 bytes for the 21-asset v1 preview and 406288 bytes for the separate
23-asset v2 source, within the unchanged 400 KiB bound. No visible or hidden
password field was added to the identifier form, and no real password manager
or user credential was accessed during validation.

All 22 v1 account/capture Chromium groups then passed, including the explicit
no-interactive-retry assertions. Only the owned v1 participant preview process
was restarted. Its served helper was checked for silent mediation and absence
of optional mediation; its v1 notice remained exact. User tabs were not reloaded.
The account adapter, backend and capture routes were unchanged. Earlier shell,
v2 browser and Android build/lint results remain historical; those broader
checks were not repeated for this helper-only correction.

## One preview from main — 23 October 2026

The owner requested one preview matching main after the retained v1 client
caused version confusion. The older owned participant process was stopped.
The authoritative `code/dev.ps1 -Snapshot -Action Exec` launcher copied the
unmodified main working tree and started its `serve:participant` command in the
same managed container, at the same port and URL. The new source snapshot is
`/tmp/nonverba-unified-source/b7f27cf4b6c2466d8851069f294fbafc` with 1605 reviewed
namespace files. Runtime source files received no selective patches. The
existing snapshot transport keeps toolchains and services in managed Debian;
it is not a separately maintained UI version.

README and repository instructions now require a single preview from a fresh
main working-tree snapshot after edits. The review entry shares the ordinary
application assets; its only HTML differences support local annotations and
noindex. No new port, tab, container or service-policy selection was introduced.

Main contains the current v2 synthetic notice and challenge/proof camera client.
The selected live service remains v1 with its existing policy and migrations.
Sign-in and own retained submission-status reads remain compatible. New camera
capture and submission require the current service contract and remain
unavailable against that older service. The preview does not replace notice
bytes, reinterpret agreement or fall back to the older capture client. This
source alignment does not activate v2 service intake or real-data collection.

HTTP verification matched all 31 canonical catalog assets byte-for-byte,
including the generated source notice under the launcher's three whitelisted
source-provenance values. Every response uses no-store. The review entry matched
the exact expected CSP/noindex transformation, and process inspection found one
participant server at the new main snapshot. Its 23 runtime assets total 406288
bytes within 400 KiB. An initial verification attempt omitted source-provenance
environment values when regenerating the source notice; supplying exactly the
launcher values resolved that harness mismatch without changing runtime files.

All 22 main-source account/capture Chromium groups passed. The existing
availability group now also serves exact historical public v1 notice bytes and
a 404 capture-challenge response to the current client. It confirms no camera
permission/media call, selected image/object URL, identity POST, legacy capture
retry or v1 notice acceptance, while authenticated account status remains
unverified. Silent-password and saved pending-status journeys also pass. These
are intercepted protocol fixtures; no live identity upload or user credential
was used. Runtime files were unchanged during verification. No shell suite,
Android build, export or phone acceptance was repeated for this launch change.

## Root-only local application URL — 23 October 2026

The owner selected `http://127.0.0.1:4173/` as the sole local participant document
URL. The server now serves the application directly at root. Former index/review
document paths redirect to `/` without copying their queries; root queries are
also canonicalized. GET and HEAD share that behavior while unsupported write
methods retain their refusal. No alternate HTML page version is served.

Root-relative styles, modules, branding and identity images resolve through the
same closed participant catalog, with exact resource bytes. Existing prefixed
resource paths remain compatible. No base tag or product HTML rewrite is added.
Only the existing local annotation CSP/noindex transformation is applied to the
in-memory root HTML; strict package HTML and Android document paths remain
unchanged. The server's startup message, README, container guide and repository
instructions now direct local use to the root URL.

All 21 focused participant package/routing groups passed in fresh main snapshot
`/tmp/nonverba-unified-source/bfea678b99f242b2aee4403163c71ce4`. They verify direct
root GET/HEAD, fixed legacy/query redirects, exact root/prefixed resource bytes,
no-store/security headers, unknown-page and write-method refusal, strict APK
HTML and exclusion of local annotation markup. The owned prior process was
replaced with that tested server. The user's existing tab was navigated to root
and its URL and Home state confirmed; no additional tab was opened. Runtime
assets and Android document paths are unchanged. No APK build or service-policy
change was needed.

A fresh headless browser against the live root server loaded the stylesheet,
module-driven Home and all nine static images. Home, Options, Sign in and Back
retained the exact root URL with no page errors or failed local assets. Root
returned 200 without a Location header and the former HTML aliases redirected
to root. No form was submitted and no credential or camera was used; the test
context was closed. The first smoke assertion incorrectly required an opaque
body background, while source applies that color to the root element. Correcting
that harness assertion required no application change. No broader account,
capture or Android suite was repeated for this server-routing change.

## Pending identity wording and Level 2 prerequisite — 23 October 2026

The owner requested copy matching the received, awaiting-approval state. The
Requests setup action now says Awaiting Level 1 approval and opens saved status.
Operations instead displays an inactive Level 1 approval required statement,
without link styling. It cannot start Level 2 while Level 1 is pending. Before
submission its Level 1 prerequisite action remains available. The existing
authenticated state model and authoritative workflow gates are unchanged.

A received status page now uses Awaiting approval for its heading and accessible
level description, with: Your details have been received. Level 1 approval is
pending. It retains the green Done action. No active reviewer, approval time or
completed identity check is asserted. An uncertain original submission retains
Identity submission and Submission unconfirmed rather than borrowing the
account's saved receipt presentation. Notice bytes, agreement and service
admission are unchanged.

All 45 focused workspace/package checks passed in the fresh main-source
snapshot `/tmp/nonverba-unified-source/78bf0e148e8548a295fc274daef7cae6`. The
transition regression covers pending, unverified, checking, unavailable and
signed-out labels, destinations and disabled-state reset while preserving icon
hosts, input prerequisite records and workflow denial. Package checks retain
the root URL, closed asset catalog, 400 KiB bound and local-CSP isolation.

All 22 account/capture Chromium groups then passed on that frozen main source.
They cover the received title/body and accessible label, saved-status navigation
without sensor access or resubmission, inactive Operations while waiting,
unverified Level 1 entry, and unchanged original-operation uncertainty. Normal
and 320px/200% screenshots of the status and expanded menu sections were visually
reviewed without clipping; the previously recorded container-font fallback
limitation remains. Its 23 runtime assets total 407313 bytes within 400 KiB.

Only the owned root app server was replaced with that tested snapshot. HTTP
checks confirmed direct root HTML and the updated script/style bytes, with old
document URLs still redirecting to root. Existing user tabs were left loaded so
their session state was preserved. No service change, identity upload, APK build
or physical-device acceptance was performed for this presentation update.

## Synthetic reviewer client and aligned service journey — 23 October 2026

The owner authorized a small audited synthetic review pipeline through Hx02.
Hx10 added the reviewer interface to the existing shared participant app; Hx11
owns the private decision service and selected activation, and Hx02 owns review
policy and exact notice version 3. Ordinary accounts receive no reviewer entry.
Fresh positive server permission, a separate current reviewer binding and exact
case/revision/hash pins control each read and deliberate decision. The interface
loads only the selected case, renders retained notice/details literally, and
releases media on departure, backgrounding, logout or authority loss.

Approve for test, Request correction and Reject for test each require a reason.
A conflict requires explicit reload. A lost decision reply keeps its original
immutable operation for GET lookup only; a historical result never supplies a
current case or subject outcome. The subject's separate authoritative read
displays the three synthetic outcomes without changing pending genuine identity
assurance or enabling Requests, Operations, Level 2, signing, payment or sensors.
A completed test outcome can start a fresh package with empty details, new media
and new notice agreement. Missing, invalid or stale responses remain unavailable.

All 163 focused state/client/relay/package checks and all 27 account/capture
Chromium groups passed on unmodified main-source snapshot
`/tmp/nonverba-unified-source/79c81afff1d744a9b1ce558f5f329e4b`, based on
`44dfbb0c413cc450d78065cf92874e1f77b20c11` with current working changes. The five
added browser groups cover ordinary-account denial, all three decisions and own
status labels, fresh correction, unknown operation lookup, revision conflict and
late media/sign-out fencing. These browser service responses are controlled
synthetic fixtures. Normal and 320px/200%-text reviewer views were inspected;
the existing container font fallback limits typography assessment.

Participant assembly and lint passed in the same managed snapshot. The build
record is `android-build-2026-10-23T17-31-27-231Z-83ff80b0b1c8.json` in its private
QA output. No APK export, independent APK inspection, phone installation or
physical-camera acceptance was performed for this checkpoint. Closed asset and
native/relay parity checks retain strict package CSP and route/body boundaries.
The reviewed runtime ceiling is 448 KiB; the image and APK ceilings are unchanged.
The 25 runtime assets total 454917 bytes. The running root app matched all 24
non-HTML runtime assets byte for byte with no-store. Root returned 200; the old
review-document URL returned 308 to `/`. No second app version is served.

The first actual-service check exposed an older custody reader requiring this
client's generated operation-token format. The published retained receipt uses
an opaque 1–128-character identifier. Both receipt readers now accept that exact
grammar while preserving closed fields, owner/session binding, pending
verification, exact own-write receipts and original-operation retry rules.
Regression checks reject invalid identifier characters and length. This required
no fixture rewrite, older notice substitution, admission change or backend edit.

Actual aligned-service acceptance completed in linked normal-UI phases. The
first subject session submitted invented details and two synthetic Chromium
camera captures under exact notice v3 through the current challenge/proof
client. It selected no image file and used no real ID/face or physical camera.
A subsequent reviewer session selected that current package by its exact
submission, subject, receipt and both hashes, viewed retained details/notice and
both photos, and deliberately recorded one approval for test. The immutable
decision pins were kept only in protected private evidence.

The final isolated subject session used normal password/PKCE forms and a new
server session, then matched the same subject, current submission, complete
receipt, both hashes and recorded decision/revision. Its report passed with all
three match flags true, Approved for test visible, work creation still disabled,
no earned identity stamp, root URL unchanged, media released and session signed
out. No new intake or decision was made for that final read. The successful
reviewer write and its cleanup were completed before the isolated read; earlier
failed helper attempts are retained as failures. A premature Account-menu
transition could cancel the foreground password action. Waiting for that
action's own completion fixed the private helper without a product change or
authentication bypass.

The same snapshot retains sanitized reports
`identity-review-client-live-20261023-5d52a9b06f8e4526bc3c470b13d5973b.json`,
`identity-review-client-live-20261023-review-current-pending-5f347d9eb6e943e1b68422a219e24875.json`
and `identity-review-client-live-20261023-subject-read-fcc9d3f865bf4f5390e62697378a872e.json`
for the accepted intake, completed reviewer phase and passing fresh read. The
first two reports remain whole-run failures at their later procedural stages;
the acceptance claim links their completed phases by exact private pins. This
actual UI exercise covers approval only. Other decisions and race/replay cases
retain their controlled browser and Hx11 service-matrix scopes.

See [the client checkpoint](PARTICIPANT_IDENTITY_REVIEW.md) and
[Hx11's closed service contract](SERVICE_SYNTHETIC_IDENTITY_REVIEW_CHECKPOINT.md).
Real-data intake, legal adoption, custody/retention decisions, actual reviewer
appointments and genuine identity/work authority remain outside this test slice.

## APK roundtrip

Reserved 28 October 2026. This heading is the place for retained artifacts and
verifier results from one real-device signed Assignment and evidence
round-trip. No round-trip has been run. No originals, receipts, or verifier
results are stored here. Work creation stays locked. This note does not
promote synthetic approval to real authority.

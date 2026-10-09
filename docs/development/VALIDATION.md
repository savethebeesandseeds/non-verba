# Unified repository validation

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
- `web/src/audio-controller.js` owns the live audio protocol without DOM,
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
node tools/build-web.mjs
bash crates/nonverba-android/tests/run-jni-smoke.sh
node test/native-wasm-node-tests.mjs
```

The Node catalog is explicit in `code/tools/test-suites.mjs`. Every Node test
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
NONVERBA_BIND=127.0.0.1 NONVERBA_PORT=4173 node tools/serve.mjs
# Then run the browser checks from that snapshot's code directory:
node test/browser-tests.mjs
node test/location-browser-tests.mjs
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

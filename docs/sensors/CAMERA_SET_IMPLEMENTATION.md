# Camera-set implementation and phone checkpoint

16 October 2026. This developer collector belongs to **Non-verba Dev**
(`org.nonverba.camera`), separate from the participant application. Existing
single-image records retain their original verification rules.

## Implemented path

Open **Front/back camera-set trial** from the developer camera home. Inspect the
device inventory and review the explicit camera IDs/facings and timing mode before
making a fresh request. The default front/back trial is explicitly sequential:
rear, then front. Concurrent mode requires a selected exposure-start tolerance.
Discovery does not grant
collection authority. Additional listed cameras remain required; the set is never
automatically reduced.

Retain the original request and an independently established **media certificate
SHA-256** before capture. This existing media pin differs from SPKI hashes used by
some other collectors. Copying the displayed device pin permits only local
consistency checking. The tool saves/imports requests and camera-set JSON files.
Capture does not imply receipt, acceptance or Assignment completion.

Android resolves location permission before opening a native preview dialog.
One native shutter requests a fresh fix. Sequential capture acquires each declared
camera in profile order, matches its JPEG/result, requests independent resource
cleanup and waits for both session/device close confirmations before opening the
next camera. The next camera produces a preview result before its automatic still
request; this is readiness, not a focus/exposure quality guarantee. Concurrent
mode dispatches still captures while all declared devices are open.
Each JPEG must match its native capture-result sensor
timestamp. Pixels and acquisition metadata stay native until Rust signs them;
there is no WebView endpoint for replacement pixels or exposure timestamps.

In concurrent mode all devices open before any session is configured, following the
[Android CameraManager concurrency contract](https://developer.android.com/reference/android/hardware/camera2/CameraManager#getConcurrentCameraIds()).
The adapter checks the advertised combination and the exact preview/JPEG session
configuration. Unsupported configurations fail explicitly. Dispatch to concurrently
open devices does not itself establish synchronized exposures: verification uses
returned exposure metadata and the requested tolerance.

This adapter needs Android 9+ for single/sequential capture and Android 11+ for concurrency. It
supports at most four named cameras and selects the largest advertised preview
and JPEG sizes with minimum dimensions 256 and at most 1280 × 720 pixels by area.
A camera without that stream profile is explicitly unsupported. Limits are 8 MiB
per acquired JPEG, 32 MiB acquired total and 32 MiB final exported JSON. These are
adapter resource choices, not general Camera2 limits or quality guarantees.
Preview rotation/framing and real quality still need physical validation.

The browser route supports an explicit single camera. Temporary discovery streams
are stopped; capture requires the selected `deviceId` exactly. Its trial software
identity lives in page memory and its pin is displayed before capture. Browser
acquisition cannot satisfy a native Camera2 or concurrent front/back request.
Browser camera IDs, facings and software signatures are supplied claims rather
than authenticated sensor identity.

## Signed format

[`camera_set_evidence.rs`](../../code/crates/nonverba-core/src/camera_set_evidence.rs)
defines strict version-1 requests, member bindings and transport. Requests bind
the original challenge, complete camera profile and selected `native-camera2` or
`browser` acquisition. Unknown fields, including an unsupported `location_request`,
are refused; requests are bounded to 32 KiB.

Each JPEG has C2PA credentials and a unique exact `org.nonverba.camera.set`
assertion binding the full original request, attempt UUID and member camera ID.
Native acquisition metadata must agree with that attempt, camera and facing.
The existing selected native media key signs through a session-scoped JNI
capability. This feature neither replaces the key nor adds a generic signer.

The JSON index is unsigned. `verify_camera_set` reruns shared image verification
over every exact JPEG, checks the independently retained request and pin, and
requires unique exact camera membership and one common attempt. It returns JPEG
SHA-256 values and full per-image reports. Omission, duplicates, camera swaps,
changed bytes/request/key/attempt and legacy images lacking the set assertion
cannot become complete evidence. Transport is bounded to 48 MiB and decoded
JPEGs to 32 MiB total; the native adapter applies its smaller export limit before
publishing a result.

Sequential and concurrent timing use exact decimal nanosecond sensor counters only when every
verified native member reports the realtime Android timestamp source in this
device/key/attempt. Unknown clocks remain unassessable; no callback-time substitute
or universal tolerance is invented. Exceeded or unassessable timing prevents set
verification even when every individual signature passes. Sequential verification
requires strictly increasing exposure starts in the signed profile's order and
reports the exact exposure-start span separately from a simultaneity tolerance.
Sequential evidence cannot satisfy a retained concurrent request. Single-camera timing
is not-required. Retained evidence may be reverified after expiry; acquisition
and native signing still had to occur within the original request window.

C2PA and metadata consistency do not prove physical simultaneity, honest cameras,
freshness, hardware attestation or GPS authenticity. This version includes only
existing submitted GPS metadata. Separate raw-GNSS camera/location composition,
motion/gyro evidence, quality-policy acceptance, work/privacy grants and requester
receipts are unfinished. One image's location proof is never promoted to cover
all images; the existing composed workflow remains separate.

## Lifecycle and remaining failure retention

Native attempts freeze request, key, monotonic/wall anchor and 60-second deadline.
A ledger reserves the challenge before exposure; failed attempts require a fresh
request. Foreground, permission, expiry, clock continuity and per-image processing
freshness gates run before signing, inside its key capability and before delivery.
Navigation and Activity pause/stop/destruction revoke authority before independent
cleanup. The legacy collector is excluded from the set tool's foreground route;
the set collector can start only on this route.

Late open/configure callbacks retain returned resources and request cleanup rather
than restarting capture. Device/session close callbacks confirm release; pending
callbacks remain unknown. Failed releases retain ownership for retry, including
preview listeners. Unsigned status distinguishes each member's outcome/signature
availability and confirmed, failed-retained or unknown cleanup. Collector complete
means all JPEGs were signed; verification must still evaluate requested timing.

Cancellation/failure discards unsigned raw buffers and records that outcome.
Already signed members remain in attempt memory; this UI exports complete bundles
only. **Durable partial-image retention/export and the signed failure/storage
report policy remain unfinished.** A new attempt or process loss does not preserve
those partials. No crash, power-loss, hosted retention or remote-stop guarantee is
made. A failed complete-set export leaves the set in the page for retry, without
claiming it was saved or delivered.

## Software checks

Executed in the existing managed Debian container without a phone:

- 20 focused Rust camera-set tests passed: the original 12 profile checks plus
  real C2PA native/browser round trips, changed/omitted/duplicated/swapped members,
  wrong request/key/attempt, legacy refusal, signed out-of-policy timing, unknown
  clock and duplicate signed assertion cases.
- 13 existing native-camera regressions passed, including single-image and
  camera/location composition behavior.
- The real Linux JVM → production Rust JNI smoke harness passed 69 checks,
  including both set members and different-attempt, expiry and revoked-callback
  refusals. JVM keys/pixels were synthetic; no Android Camera2/Keystore ran.
- Eight adapter scenarios passed as one Node test: completion, premature
  completion, failed/changed/unknown state, abort before capture and deadline.
  Node test catalog checks also passed.
- Nine Chromium worker/WASM/UI cases passed: production JNI set verification;
  missing/duplicate/swapped/tampered member, wrong pin and changed request refusal;
  file import with separate verifier inputs; and the browser shutter flow using
  Chromium's fake camera and explicit synthetic GPS.
- Existing pure Kotlin session/enrollment/finalization/location-selection and
  lifecycle cleanup harnesses passed. They exercise fake gates/resources, not
  physical Camera2 callback order or resource release.
- Developer Kotlin compilation passed after staging generated libraries/assets.
  Final package/lint inspection is recorded below once completed.

Initial development failures remain distinct: a `Debug` derive did not support
the legacy image report and was removed; isolated Kotlin compilation initially
lacked generated JNI libraries and then web assets, supplied by the documented
build/staging steps. An adapter regression found optional observer argument
evaluation could skip cancellation; cancellation now executes independently.
Review added retained preview listeners to the cleanup gate and checked the
native final export size before publishing its result. The pending superseded
package command was stopped and is not counted as a passing export. A repeated browser run exposed a harness readiness race between inventory display and key-pin generation; waiting for both restored the nine passing cases. Review also serialized image-reader acquisition with cleanup, ignored stale image listeners after capture, and ignored late sequence-abort callbacks after a completed result. A direct
container `python3` lookup was unavailable; the existing managed Node runtime
performed that bounded orchestration without installing a runtime.

Android lint initially rejected the concurrency API call because it could not infer the version check through Kotlin `check`. An explicit Android-version failure branch now precedes the API call; the guard was made inspectable rather than suppressing the API-level check.

A repeated lint run inspected an older `NativeCameraSet.kt` restored in the shared
Gradle tree by an overlapping source sync; snapshot and staged snippets confirmed
the mismatch. Final export uses the current authoritative launcher build lock
through preparation, synchronization, build and inspection. Automatic approval
review declined a request to pause the other chat; no pause was sent or performed.

## Final package checkpoint

The corrected developer APK passed the guarded build/export on 16 October:
`:app:assembleDebug` and `:app:lintDebug` succeeded. Independent inspection reported
`passed`, `package_checks_passed` and `current_linux_build_verified` true, with
empty errors/current-build gaps and the independently retained debug signer.
The exported APK is 33,790,113 bytes. Its SHA-256 is
`c2df29668a93add18b691aba24b983bee91e35e5dc4e0445d5802d12469381a9`.
The final snapshot also passed the 69-check JNI harness and all nine browser
worker/WASM/UI cases after export. APK and authentic reports are retained under
ignored local artifacts; this record publishes no phone identifier or capture.
This was a dirty development build with source-snapshot notices, not a release or
reproducible-build claim. Installation and physical acceptance had not run at that
package-only checkpoint; subsequent phone observations are recorded below.

## First phone discovery and correction

On 16 October, the approved USB connection became authorized after the user
matched and approved the existing computer ADB-key fingerprint. The existing
public key bytes were unchanged through a dedicated-server retry. The inspected
developer APK was installed with app data retained, and installed-hash readback
matched the package checkpoint above. These are transport/install results only.

The home page exposed only its root through accessibility; one targeted visual
fallback opened the camera-set page. That page exposed 19 semantic nodes.
`AppUiBatch` and saved text state then revealed a genuine discovery failure:
the JavaScript bridge called a WebView method on `JavaBridge` instead of the
Android main thread. No camera exposure occurred.

The correction routes the camera-set capability/begin foreground lookups through
a bounded main-thread read. Reads already on main execute directly. Refused posts,
errors and timeouts fail closed; a timed-out queued lookup is cancelled so it
cannot execute later. The native session still rechecks foreground, permission,
generation and request authority at its existing capture/signing gates. A focused
JVM dispatcher regression covers thread placement, false results, original error
propagation, bounded waiting and cancelled late execution. The updated package
and actual phone discovery result are recorded after verification below.

## Corrected phone preflight result

The main-thread correction passed ten focused JVM dispatcher checks, the 69-check
production JNI harness and all nine worker/WASM/browser cases. Developer build,
lint and independent package inspection passed for both the snapshot export and
the bounded original-bind copy, with no errors/current-build gaps and the retained
signer. The corrected APK SHA-256 is
`8560c14cb1f3d6c2676f899bddbfee1f18eecc7430062127fd8023d479e5b7c6`.
Installation preserved app data and exact installed-hash readback matched.

Actual phone discovery then succeeded. The complete, nontruncated 422-character
inventory was read from the saved semantic `inventory` node and parsed locally:
the native adapter reported available, camera permission granted, front and back
cameras present, and **an empty advertised concurrent-set list**. Private records
retain the inventory, source state and installation record with their hashes;
device/key identifiers are not included in the dashboard.

This is a real capability-discovery checkpoint, not a simultaneous photo result.
The selected collector requires an advertised combination, so this phone cannot
advance that route. An empty list does not prove that every possible hardware or
vendor-specific mode is incapable of concurrency. No camera exposure, camera-set
artifact, exact-stream configuration, timing, failure/cleanup physical matrix or
independent requester acceptance was tested. No single-camera or sequential pair
was silently substituted. A compatible device or an explicitly selected separate
sequential profile is needed for the next capture checkpoint.

After the one home-navigation fallback, discovery, error diagnosis and the final
capability result used semantic controls and saved text, with no screenshot round
trip needed to read the inventory. This confirms the text-first control path on
the camera-set page; the home-page accessibility limitation remains documented.

## Owner-selected sequential continuation

After the empty concurrency preflight, the owner explicitly agreed to one action
retrieving rear then front sequentially. The new mode preserves both required
members, full original-request/attempt binding and timestamps. Concurrent mode
remains strict and never silently switches. Camera-list order is authoritative;
the unsigned transport index cannot change it. Unknown clocks receive no measured
exposure gap or order credit. Existing bounds remain, including a fresh submitted
GPS fix within five seconds of each acquisition; a slow switch must fail that
bound rather than certifying stale GPS. This remains metadata-only GPS.

The Android handoff gate waits for independent session/device close callbacks,
rejects duplicate/out-of-order advancement and cannot advance after cancellation.
Resource-release failures retain ownership and stop handoff. The developer UI
exposes mode/tolerance controls and a short semantic verification summary with
the exact gap, avoiding arbitrary JSON insertion or screenshots for normal control.
Validation and the actual sequential phone outcome are recorded below.

## Sequential software and phone checkpoint — paused by owner

16 October 2026. The owner asked to close with handoff notes and continue later.
No further phone trial or diagnostic implementation was started after that request.

The sequential implementation passed 23 focused Rust camera-set tests, 13 legacy
native-camera tests, 45 pure Kotlin handoff checks, ten main-thread checks, eight
transport scenarios and 71 production JVM/Rust JNI checks. The corrected browser
harness passed all 12 worker/WASM/UI cases, including sequential JNI evidence,
exact gap display and explicit mode selection. Its first run failed because the
new assertion referenced `textContent` without calling it; correcting that harness
call required no APK rebuild. A separate native Rust command-line verifier was
added. With the real current clock it correctly refused the deliberately
future-dated synthetic JNI fixture; the browser cases use their explicit synthetic
clock. Successful CLI verification of a real phone set is still pending.

Developer assembly, lint, export and independent inspection passed. The exact
original-bind copy passed inspection too, retaining the signer and reporting no
errors or current-build gaps. The installed APK SHA-256 readback matched
`6b834db404b587739a803e6cddf506fa912ce68c2dbd2db6c5c294652a87bedd`.
App data and media key were preserved. The build/source snapshot is
`4cfab0cb32844543bf2121fa949a85ba`; corrected browser/CLI harness source was
snapshotted separately as `ab0302a847f8483c9ac8158d2fdb282e`, using the retained
first snapshot's produced assets and JNI fixtures. The APK was not rebuilt for
the test-only correction.

The real phone exposed the explicit rear-then-front mode. One targeted screenshot
opened the home link absent from accessibility; discovery, request/save controls
and the native shutter then used semantic batches. A fresh request was created
and saved before capture, and the earlier observed media pin was retained privately
for local consistency checking. That pin is not independent requester authority.
The narrow original USB helper now supports the exact camera-set native heading
and shutter/cancel labels, plus bounded read-only public camera-set exports; its
source and deployed helper/module hashes match. Export functionality has not yet
been exercised on a complete phone set.

The native shutter was submitted once. The attempt reached its 60-second deadline.
The retained terminal text reports the rear member as `image-discarded-unsigned`
and the front member as `pending`, with no signatures available. This establishes
arrival of rear image bytes, not successful result pairing, front exposure,
completed handoff or a verified pair. The diagnostic excerpt is explicitly
truncated; it must not be treated as the complete native report. No signed camera
set, measured phone gap or complete-set export was produced.

A retry created/saved a fresh request, but begin refused with **Previous camera-set
cleanup is still pending; cancel to retry**. Its subsequent native-button step was
correctly refused because the app was still a WebView, so no second shutter was
sent. Initial window-token transitions were discarded rather than reusing stale
state. The exact unreleased resource/callback and cause remain unknown; do not
assume either a proven hardware limit or confirmed camera shutdown. The app was
left on the camera-set page with no new attempt running. No process restart,
permission change, ADB/key change or release-guard bypass was performed.

Resume with precise, bounded per-camera state/callback diagnostics, including
image/result pairing and retained device/session/reader/preview ownership. Expose
terminal cleanup refresh/retry through the developer UI using semantic controls;
neither this richer instrumentation nor those controls are implemented yet. Identify
and fix the actual missing release/handoff, retain both failures, then retry with
a fresh saved request and prompt shutter. Retrieve both exact JPEGs and reverify
the original, existing expected pin, signed sequential mode/order and real gap
with the shared Rust CLI. Do not extend deadlines or forget owned resources merely
to turn the failure into a success. Durable partial retention, the physical failure
matrix, real computer single-camera validation and independent requester acceptance
remain unfinished. Screenshot evidence collection remains proposed and unimplemented.

## Additional concurrent-device checkpoint

Use the corrected inspected Non-verba Dev APK with its existing package/signer.
USB access, installation and discovery have now run; successful concurrent capture
remains pending. The retained bounded plan for a compatible phone is:

1. Connect the intended phone through the approved USB helper and inspect this
   app's inventory and concurrent sets. Keep device IDs/captures private.
2. If front/back is advertised, retain the exact original request and independent
   media pin, select a documented trial skew tolerance, and test the exact
   preview/JPEG configuration. Unsupported hardware is recorded without fallback.
3. Press the native shutter once; save/retrieve the set and independently rerun
   shared verification over both exact JPEGs and their actual timestamps/timebase.
   Retain failures as well as successes.
4. Observe cancellation, background/navigation, selected permission loss, retry,
   camera indicators and actual cleanup callbacks. Transport acknowledgement
   alone does not establish physical release.

Real single-camera computer validation, durable partial retention, a wider native
callback/storage failure harness and independent requester receipt/acceptance
remain separate. Screenshot retrieval is another planned goal; debugging screenshots
do not implement that screen-evidence feature.

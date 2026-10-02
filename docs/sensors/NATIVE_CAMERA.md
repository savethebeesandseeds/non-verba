# Native Android camera acquisition

This module moves JPEG acquisition and C2PA signing into an Android-owned
session. The platform adapter is `NativeCamera.kt`; it uses Camera2, an owned
preview surface and an owned JPEG `ImageReader`. Rust validates the request,
location metadata and capture record, normalizes JPEG orientation, adds the
existing watermark/EXIF/C2PA records, and checks the external key's signature.

MainActivity and the web camera workflow now use this native adapter on Android.
Shared Rust tests, host JNI tests and browser verification of native synthetic
artifacts cover the integrated path. Final APK packaging verification is tracked
in [VALIDATION.md](VALIDATION.md). Physical acceptance is partial: two user-triggered Cat S62 Pro images have now
passed the Rust verifier, while independent requester timing and
other device gates remain incomplete. A later own-app Back test observed native preview cancellation; broader cancellation/background/retry coverage is still pending. See the dated reports in VALIDATION.md.

## Ownership and API

Only bundled application code receives the `NativeCamera` bridge.
The internal `NativeCameraCore` JNI object and `NativeMediaEvidenceSigner` must
never be installed as JavaScript interfaces.

| Bridge call | Result and boundary |
| --- | --- |
| `capabilities()` | Reports availability, separate native certificate pin, local Keystore security level and camera permission; no sensor attestation |
| `begin(challengeJson, locationRequestJson)` | Validates and retains the immutable original request, then requests camera permission and opens native preview; empty/JSON-null location request means metadata-only composition |
| `status(sessionId)` | Returns bounded state/error fields; completed sessions include the final signed JPEG in `result.image_base64` and its certificate fingerprint |
| `capture(sessionId, locationJson)` | Accepted only after the operator's native shutter entered `awaiting-location`; validates supplied GPS metadata and starts a single native exposure |
| `cancel(sessionId)` | Cancels an unfinished session and releases its resources |

No call accepts image bytes, exposure timestamps, sensor results, caller-provided
image hashes or arbitrary signing payloads. The final image is exposed only
after Rust has sealed the JPEG acquired by that session.

The expected sequence is:

1. The web coordinator performs its location-permission preflight, stops any
   WebView camera stream, and begins the native camera session.
2. The operator frames the scene in the native preview and presses **Take photo**.
3. Native state becomes `awaiting-location`; the coordinator polls that state,
   obtains the requested location fix/proof window and calls `capture` once.
4. Native acquires and correlates the JPEG and Camera2 capture result, then
   automatically seals the retained image. States progress through `capturing`,
   `sealing` and `complete`, or fail explicitly.
5. For composition, the existing location module signs a sidecar binding the
   exact final C2PA JPEG. Both original requests and both enrolled pins remain
   necessary for verification.

GPS supplied to this adapter remains explicitly labelled
`caller-submitted-device-geolocation`. Camera acquisition does not authenticate
that coordinate. The native signer and independent verifier require the signed
fix to be no more than 5,000 milliseconds old at the recorded acquisition time.
A future fix is permitted only within that acquisition time's same Unix second,
preserving the shared photo timestamp's fractional-second tolerance. The older
browser profile retains its existing thirty-second limit. The separate location
proof verifies its own native/raw policy and binds the exact image and selected
GPS when the requester requires it.

## Exposure records

The native session records the chosen camera ID and lens, frame number, original
image dimensions, requested JPEG orientation, optional exposure duration/ISO/
focal length, camera timestamp source, native session/shutter/receipt times,
sensor exposure timestamp and JPEG image timestamp. These become the signed
`org.nonverba.camera.acquisition` assertion.

The JPEG timestamp must exactly equal `CaptureResult.SENSOR_TIMESTAMP`. When the
camera reports the `REALTIME` timestamp source, exposure must start after this
session submitted its shutter request and before both image and result receipt.
When exposure duration is present, its checked integer sum with that first-row
exposure timestamp must be no later than image receipt; equality is permitted.
The duration does not impose an additional result-callback ordering requirement.
This follows Android's [timestamp](https://developer.android.com/reference/android/hardware/camera2/CaptureResult#SENSOR_TIMESTAMP)
and [exposure-duration](https://developer.android.com/reference/android/hardware/camera2/CaptureResult#SENSOR_EXPOSURE_TIME)
semantics, and checks consistency of signed claims rather than physical truth.
Its wall-clock estimate uses the session's wall/elapsed anchor; wall and monotonic
clock divergence beyond one second fails. When the timestamp source is `UNKNOWN`,
cross-subsystem clock comparison is unavailable: exact image/result matching is
retained and the reported wall time is explicitly the callback receipt time.
Unknown timebases and absent optional exposure durations retain their previous
validation; a present duration still has to satisfy the existing positive range.
Nanosecond values are canonical decimal strings so JavaScript cannot round them.

Session-ID generation finishes before the adjacent wall/elapsed clock samples;
UUID/entropy work must not bias the exposure mapping backwards. Before submitting
Camera2's real exposure request, the native adapter compares the unchanged selected
GPS timestamp with that mapping. If the fix is ahead by at most the existing
one-second native clock-alignment bound, it defers the actual exposure until the
mapped clock reaches the fix. It rechecks the original request window, current
session, foreground permission and clock agreement on every dispatch. A larger
future mismatch or a fix already older than five seconds fails. The original
session deadline and replay reservation stay in place; no timestamp is rewritten,
no failed nonce is retried and Rust's five-second/same-second checks are unchanged.
This avoids a second-boundary scheduling race; it does not attest either clock or
guarantee success with an unknown camera clock, a clock jump or delayed callbacks.
The deterministic production-helper regression runs with
`bash crates/nonverba-android/tests/run-native-camera-timing.sh` inside Debian.

Rust assigns the finalization timestamp when sealing begins. It must fall at or after
acquisition and both image/result delivery times, within thirty seconds of acquisition, and inside the original
challenge window. The independent verifier repeats these timing checks, requires
the signed photo capture time to agree with the acquisition record, and checks
the native GPS freshness limit. A valid C2PA signature cannot bypass a malformed
or stale native acquisition assertion. Historical verification preserves these
checks without treating an expired request as authorization for a new action.
The native authority gate checks the request window again after waiting for the
key, through signing callbacks and before publishing the result; a delayed key
operation cannot carry an earlier valid window forward.

The manual camera verifier retains private copies of the original JPEG, optional
location proof, request and trusted pins. Acceptance re-verifies those bytes,
then checks unchanged UI authority and the original expiry inside the queued
IndexedDB write. If its verification second changes before that write, it retries
verification at most three times. The atomic add still prevents duplicate local
acceptance. This manual flow does not claim a signed requester arrival observation;
agents requiring one use the separate evidence-session protocol.

Requests explicitly disable zero-shutter-lag and sensor test patterns. Available
capture-result fields are recorded independently. A reported enabled ZSL mode or
nonzero test-pattern mode fails; absent result fields remain unknown. There is
no reprocessing input stream, gallery import or caller-controlled capture buffer.

The native callback and Rust verifier enforce the same acquisition record
structure. A matching record is a signed application claim; camera hardware,
device/app state, physical scene truth and clock authenticity are not remotely
attested. Reports continue to leave the corresponding attestation/freshness
claims false.

## Key identity and lifecycle

Native media uses a new P-256 Android Keystore key and a persisted local
C2PA-compatible certificate chain created around its SPKI by Rust. Its visible
pin is the SHA-256 of that exact leaf certificate. The Android-generated default
Keystore certificate is not used as the C2PA credential. Existing web
photo/audio identities and the separate native location key remain unchanged.

On API 28+ with the StrongBox feature, provisioning requests StrongBox. A
`StrongBoxUnavailableException` permits a recorded fallback only if no partial
alias exists. Other errors do not trigger replacement. The actual `KeyInfo`
security level is inspected: API 31+ can distinguish StrongBox, trusted
environment, software and unknown levels; older APIs report only software or
hardware of an unspecified type. These local claims are included in capture
metadata while remote `hardware_attested` remains false.

The public identity record is atomic, versioned and bounded. A saved identity
with a missing/different key fails. An existing key with a missing certificate
record also fails, because issuing another certificate could silently change an
enrolled pin. A shared process lock protects enrollment when more than one
native media adapter uses the key.

The native camera ledger atomically reserves the request nonce before exposure;
a failed exposure/signing attempt cannot reuse it. The ledger has a 4,096-entry
ceiling and no automatic pruning. Camera sessions retain their sixty-second total
budget and fifteen-second matching image/result delivery bound. The superseded
phase-split draft was removed. New concurrent camera requests start GPS with the
preview and select a fresh retained observation for exposure; the independent
location collector completes its remaining window afterward. Camera metadata
remains version1 with its original request and exposure clocks. Selected images
are at most
12 million pixels and 32 MiB. The C2PA signing capability is available only to
the still-active foreground session and is rechecked before delivering a result.

Cancel, error, timeout, backgrounding, navigation and destruction release camera
sessions/devices, the JPEG reader and preview surfaces. Late callbacks and
signing results cannot complete a cancelled session. Completed public evidence
can still be exported. An owned initial camera permission overlay can resume the
pending permission step; another permission overlay after preview starts
requires an explicit retry rather than retaining a paused capture.

Finalization failures now identify the checked sensor, signing stage and observed
age/limit. Native status also retains bounded unsigned phase durations; these do
not alter the signed evidence or any freshness/deadline gate. See
[NATIVE_FINALIZATION_DIAGNOSTICS.md](NATIVE_FINALIZATION_DIAGNOSTICS.md) for field
semantics, callback failure preservation and the physical follow-up procedure.

## Physical acceptance still required

- Test permission denial, initial grant, camera privacy toggle, revoked permission,
  backgrounding, rotation/navigation and cancellation at every asynchronous step.
- Test Camera2 legacy/limited/full devices and both supported ABIs, including a
  device with an unknown sensor timebase. Unsupported capabilities must be
  represented explicitly or fail; never invent a real-time exposure mapping.
- Verify portrait/landscape/front/rear preview and final JPEG orientation, focus,
  exposure and image quality. Confirm image/result timestamps refer to the same
  capture and ZSL/test-pattern result values are handled correctly.
- Test matching callbacks arriving in either order, camera disconnect, delayed
  result/image, duplicate callbacks and surface destruction. Every failed path
  must release resources without returning late evidence.
- Verify native standalone and photo/location composition using independently
  retained requests and pins. Tamper with JPEG pixels, acquisition metadata,
  GPS or either composed artifact and confirm rejection.
- Confirm the new native pin persists across restart/upgrade, old pins remain
  unchanged, missing/corrupt identity state does not regenerate credentials, and
  actual StrongBox/fallback/security-level claims match device observations.
- Measure processing latency on real phones, especially against the location
  module's final freshness deadline and the native camera's five-second GPS
  acquisition limit. Existing synthetic crypto/JNI/browser tests do not establish
  acquisition performance or resistance to physical replay.

Platform references: [Camera2 sensor timestamp](https://developer.android.com/reference/android/hardware/camera2/CaptureResult#SENSOR_TIMESTAMP),
[camera timestamp sources](https://developer.android.com/reference/android/hardware/camera2/CameraCharacteristics#SENSOR_INFO_TIMESTAMP_SOURCE),
[image timestamps](https://developer.android.com/reference/android/media/Image#getTimestamp()),
[Keystore security levels](https://developer.android.com/reference/android/security/keystore/KeyInfo#getSecurityLevel()),
[StrongBox availability](https://developer.android.com/reference/android/security/keystore/StrongBoxUnavailableException).


### Composed request JSON boundary

Native admission and composed verification compare the complete original request structurally. The WebView may serialize a Rust floating-point policy value such as `100.0` as `100`. These lossless spellings compare equally only when the integer is within JavaScript's exact safe range. Fields, types other than that numeric spelling, array ordering, optional-field presence and all actual values remain binding. No policy is substituted and the native signature retains the original request. A physically observed rejection exposed both boundaries; actual native C2PA plus separately keyed COSE regression fixtures cover four profiles, exact originals and substitution/tampering failures. See [the dated checkpoint](VALIDATION.md).

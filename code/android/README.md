# Android host

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

## Temporary foreground screen-awake preference

The opt-in **Keep screen awake** control now grants a two-hour development lease.
The lease survives Activity/process restarts and APK updates on the same boot;
its expiry appears beside the control. Off clears it. Expiry, reboot or inconsistent
wall/monotonic clocks revoke it. Leaving the foreground clears the window flag,
and returning rechecks the unexpired lease. It never wakes or unlocks the phone,
changes Android lock settings, or changes sensor lifecycle rules.

Software harnesses cover native clock/storage guards and UI behavior. Physical
restart, expiry, reboot and update checks remain separate device acceptance
work; see the [validation limits](../../docs/sensors/VALIDATION.md).

## Build contract

All development tools execute in the managed Debian container `non-verba-dev`.
The Windows launcher only invokes Docker; installing or running Java on Windows
is prohibited. See [the authoritative container procedure](../../docs/development/CONTAINER_PLAN.md).

From the unified checkout with the preserved container already running:

```powershell
./code/dev.ps1 -Snapshot -Action Status
./code/dev.ps1 -Snapshot -Action Test
./code/dev.ps1 -Snapshot -Action Build
```

The pinned toolchain uses Rust 1.96.0, wasm-bindgen 0.2.122, Gradle 8.14.3,
Android Gradle Plugin 8.11.1, Kotlin 2.2.20, JDK 17, CMake 4.3.3 and Android
NDK r30 (30.0.16248370). Android compile/target SDK is 36 and minimum SDK is 26.
AndroidX WebKit 1.14.0 supplies the asset loader and AndroidX Core 1.16.0 supplies
FileProvider, window insets and GNSS callback compatibility.

`code/setup.sh` installs dependencies only. Toolchains reside in
`/opt/nonverba-tools`, with build caches and an isolated Gradle/CMake build tree
in `/opt/nonverba-build`. The existing development signing key is preserved.
New APKs and lint/signature reports are exported under
`code/artifacts/container-builds/<UTC timestamp>/`. Existing release files and
Windows intermediate outputs are preserved, but are not the Linux build directory.

`Build` rebuilds WebAssembly, stages shared assets, compiles Rust for arm64-v8a
and x86_64, and assembles/lints the APK. Native code targets API 26 with 16 KiB ELF
load alignment. This app requires 64-bit Android. C++ audio callbacks use
preallocated buffers without JNI, allocation or cryptography.

The historical Windows-Java package verifier and Kotlin/JNI smoke launchers are
disabled with directions to maintained Linux inspectors and shell harnesses.
The container build verifies APK signatures with Linux apksigner and runs Android
lint. `code/dev.ps1 Test` runs Rust and JavaScript unit/adapter tests. These are
software checks and do not replace physical Android acceptance testing.

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

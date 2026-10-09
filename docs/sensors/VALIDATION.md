# Sensor validation boundaries

The source tree includes Rust unit/integration tests, JavaScript adapter and
workflow tests, real WASM tests, browser tests and native Android guard checks.
Their presence is not a claim that all checks passed in this checkout. The
[unification validation record](../development/VALIDATION.md) records the checks
actually executed, including failures or environmental limits.

Run project builds and checks through the managed Debian environment described
in [the container guide](../development/CONTAINER_PLAN.md). Toolchains, Java and
dependency caches stay inside the managed container and its named volumes.

Software validation should cover request equality, independently supplied trust,
strict policy failure, challenge reservation, expiry, cancellation, signing gates,
artifact binding, requester receipt and local duplicate acceptance. Test fixtures
are synthetic inputs; accepting one does not establish physical sensor truth.

Native session guards are tested by the suites in
[`code/crates/nonverba-android/tests`](../../code/crates/nonverba-android/tests).
Browser and adapter suites are under [`code/test`](../../code/test), and the core
Rust tests remain alongside their modules in
[`nonverba-core`](../../code/crates/nonverba-core).

## Physical acceptance

Physical acceptance remains partial. A clean build, browser simulation, JNI test
or software attestation fixture does not demonstrate Camera2 exposure behavior,
AAudio recording support, actual raw-GNSS delivery, Keystore behavior, device
latency or resistance to a compromised sensor stack. Use a fresh physical request
and the [acceptance checklist](DEVICE_ACCEPTANCE.md) for those observations.

Earlier local device captures, review logs, QA outputs and binary releases are
preserved outside this public source import. Technical documents may describe
their historical conclusions, but the original private records are not provided
as public evidence here. The folder reorganization performed no physical sensor
run. The separately authorized follow-up below records its own limited checks.

Detailed operational evidence remains in ignored private QA records. This public
record retains procedures, reviewed results and limits; device identity pins,
real-session identifiers, capture filenames/hashes and private screenshot or
retrieval locations are omitted.

## GPS attempt-report follow-up — 4 October 2026

The owner resumed the paused GPS task and authorized one quiet stationary retry.
The report exported on 1 October was verified first, before new collection, using
the independently saved pre-collection request and previously trusted location
key pin. Its verified outcome is `raw-gnss-no-callback-timeout`, with reasons
`COLLECTION_TIMEOUT` and `RAW_GNSS_NO_CALLBACKS`. Signed terminal elapsed time is
60,047 ms; raw callbacks, admitted raw epochs and eligible fixes are zero, with
39 rejected fixes. This is a signed failed-attempt duration, not a completed
measurement time, observation span or demonstrated speedup. Wall time, collector
status and timing remain reporting-device claims.

The resumed software checks used public source revision
`f83761cf11f3b971083fc29c8c4771e0c1406ed1` in one documented container snapshot.
The preserved `non-verba-dev` instance was started through its compatibility
launcher; its identity, image, bind, named volumes, ports and signer were kept.
Shared build caches were reused. No Android build, APK installation, binary
package export, host Java or dependency installation was performed for this
follow-up. The phone retained its 1 October APK, SHA-256
`551a1caedf320a60f7f1faf1b730be79e91a851836c54196c82f85c92575c808`.
The public-source WASM verifier SHA-256 was
`5c4a4b21e7a3813e3130e7d9c2de6e1013e7440c531c6085f2ca824340f4e9af`.

| Check | Result and scope |
| --- | --- |
| Focused Rust attempt-report tests | 12 passed: both covered outcomes, request/key binding, tampering, artifact substitution, terminal bounds, late reporting, unsupported snapshots and signer failures |
| Native terminal/journal/eligibility harness | 21 passed with synthetic clocks and real Linux files; includes freezing, retry/reopened-journal retention, commit failure, bounds and early-timeout refusal |
| Real phone report → current public WASM | Passed signature integrity, independent request/key binding and claim consistency; wrong key/request and changed bytes failed |
| Successful-measurement separation | The failure report was refused by successful-location verification. An independently retained historical successful raw-GPS proof still verified and was refused by the attempt-report verifier. Historical verification did not renew freshness |
| Initial direct Downloads copies | The failure envelope and exact native request matched the independently retrieved bytes. The broad manifest had 24 matching paths and two ambiguous repeated filenames for an older request; it was not an all-files pass |
| Native retry retention | Passed after a fresh native session replaced the original session: Save-all produced a fresh export with the original signed report and exact request bytes unchanged |
| Native page reload retention | Passed after normal home/Location navigation, refresh and another Save-all: report/request hashes, 60,047 ms terminal time and counters remained unchanged |
| Unsupported retry | Android reported raw-GNSS receiver status `not-supported (0)` before any fixes or raw callbacks. No new signed report appeared, as required by the bounded scope; the original report remained retrievable |

The fresh retry's original was independently saved before collection. The phone
stayed in its current position; Keep screen awake was checked with a fresh lease.
No microphone recording, tones, playback or calibration ran. Native preparation
and successful evidence requirements were not weakened. The retry's exact
terminal duration was not independently extracted; its visible unsigned terminal
diagnostic text remained unchanged on later inspection. It is not a second signed
timeout report, and receiver status alone does not identify physical cause.

The signature authenticates the key and unchanged claims. Physical collection,
weather, human effort, fault, responsibility and trusted clock assurance remain
unproven. Successful measurement, successful acceptance, fresh-action and
independent-receipt eligibility remain false. Compensation and penalties remain
separate. The unsigned 30 September logs were not submitted for native signing.

Real-phone production of a raw-GNSS policy-rejection report remains unverified;
that signing path passed software/JNI/WASM checks previously. Arbitrary process
death, a full journal and Android-specific signing/storage fault injection were
not physically tested. Page reload and Linux journal reopening do not establish
those properties. Repeated Save-all creates repeated public filenames; only the
initial exact Downloads paths were compared, not subsequent suffixed copies.

Local verification results and failed-access observations remain private under
the existing artifact area. Public documentation includes reviewed conclusions,
without captures, trust records or machine logs. This task generated one 40.5 MB
source snapshot, small checks and three bounded USB retrievals totalling
1,340,616 bytes of artifact data. No cache inventory, archive expansion or broad
cleanup was performed. Concurrent documentation edits were preserved.

## GPS callback diagnosis — 4 October 2026

The owner requested investigation of the GPS delay. The earlier 60,047 ms run
received 39 ordinary GPS updates, but the raw-epoch guard excluded all of them
before accuracy/freshness evaluation. Its raw callback counter was zero, so
neither the Rust satellite filter nor Android clock-field admission explains
that absence. The minute was the application's failure deadline.

A fresh quiet stationary request was independently retrieved before collection
on the unchanged 1 October APK. It stopped with Android raw receiver status 0,
before any fixes, satellite-status callbacks or raw callbacks. Its exact terminal
duration was not extracted, and no successful measurement or speedup is claimed.
This failure remains outside the bounded signed-attempt scope.

The new read-only USB diagnostic first returned no matching flags/logs; an
adjustment for the vendor's dump format then obtained `mStarted=true` and
`mTopHalCapabilities=0x823`. Under the Android 11 AOSP top-level HAL layout,
the raw-measurement flag is `0x40`, which this mask omits. This current OS
advertisement is consistent with rejection, but does not establish permanent
hardware incompatibility or explain the older successful raw trace. No matching
measurement errors were retained from the bounded framework/vendor log read.
Developer options were enabled; full tracking was unset. No setting was changed.

Android 11 AOSP maps internal measurement-start errors, unavailability and lack
of support to `STATUS_NOT_SUPPORTED (0)`. The collector's error text was corrected
to leave cause unknown; timeout text now distinguishes zero raw callbacks when
GPS updates arrived. Collection policy, timeout and successful acceptance were
unchanged. See the primary [status mapping](https://android.googlesource.com/platform/frameworks/base/+/c0a892456b007ecaa9172a31fab91ee0edb55743/services/core/java/com/android/server/location/gnss/GnssMeasurementsProvider.java)
and [capability flags](https://android.googlesource.com/platform/frameworks/base/+/d1008f8339c044dc28fff3695e345d7eed16931f/services/core/java/com/android/server/location/GnssLocationProvider.java).

Forty-nine focused native diagnostic checks passed, and the actual raw collector
compiled against SDK 36 and pinned AndroidX Core 1.16.0 in the preserved Debian
container. The first compile precondition failed because the local check script
used the wrong Gradle-cache path and annotation version; it was diagnosed and
the compile-only retry passed using existing dependencies. Full Android Kotlin
module compilation passed offline in 24 seconds, reusing the existing build
tree. Packaging-only asset/native-library checks were excluded for this compile
target; no package acceptance is implied. Protected generated assets caused a
source-mirror nonempty-directory warning, and Gradle retained an SDK XML-version
warning; neither prevented the Kotlin compile. This is source
validation, not a new APK installation or proof of GPS recovery. Private records
remain in the existing ignored artifact area. One 40.5 MB source snapshot was
used; no cache archive, package export, dependency installation or Docker
deletion was performed. Receiver recovery and its cause remain unverified.

## GPS restart comparison — 4 October 2026

The owner restarted the phone and returned it to unlocked, authorized Non-verba
without moving it. Before new collection, the fixed read-only diagnostic showed
`mTopHalCapabilities=0x863`, restoring the `0x40` raw-measurement flag absent
before restart. GPS preparation and a fresh Keep screen awake lease were already
active and checked. Developer/full-tracking settings and the installed APK hash
were unchanged. The source message corrections were not installed.

One fresh two-second raw-GNSS request was created, explicitly saved and retrieved
before collection. The same installed collector received raw callbacks with
receiver status ready, then produced a signed location proof. Independent
public Rust/WASM verification in the existing Debian container passed the exact
pre-collection request, previously trusted key, signature and every requested
location/raw-GNSS policy check. This is a successful proof verification, not an
independent requester receipt or a recorded workflow acceptance.

| Signed observation | Result |
| --- | --- |
| Native session duration, including acquisition | 5,713 ms |
| Fixes and qualifying fix span | 3 fixes; 2,001 ms |
| Raw epochs and observed span | 4 epochs; 3,009 ms |
| Minimum qualifying satellites across epochs | 10 |
| Rejected startup epochs | 1 |
| Delay from collection end to sealing | 89 ms |

Tampered bytes, wrong key and wrong request were refused. The successful proof
was refused by the failed-attempt verifier. Previously exported failure reports
retained their exact bytes, still verified as failures and were refused as
successful location evidence. This last read checked existing public exports;
it did not separately retest native journal recovery after reboot. The new
proof's exact Downloads path matched its independently retrieved bytes. Two
saves of the original request created an ambiguous repeated export name, so the
broad Downloads manifest was not an all-files pass; both retrieved originals
were byte-identical to the independently saved pre-collection original.

The positive proof check does not attest physical collection, satellite signals,
physical position, trusted clocks, effort, weather or responsibility. The restart
restored acquisition in this attempt, but the failure's root cause and recurrence
are unknown. This is not a demonstrated permanent software repair, preparation
speedup or general guarantee of a 5.713-second completion time. The earlier
60.047-second failure and unsigned observations retain their original meaning.

The existing built public WASM verifier was reused without a build, new APK,
dependency installation or cache copy. The launcher created one additional
40.5 MB source snapshot; the related verifier follow-up reused that snapshot.
Two bounded USB retrievals contained 951,351 bytes total. The initial QA summary
used a nonexistent sample timing field for an ancillary span and recorded null;
that report was preserved, the field was corrected and the follow-up passed
with the signed 2,001 ms span. Captures, originals, proof, hashes and both QA
results remain private. Concurrent edits were preserved. GPS preparation,
screen-awake testing and the dedicated USB helper were closed; no audio ran.

## GPS startup and reporting validation — 4 October 2026

The next bounded implementation covers Android raw-GNSS startup status 0 before
measurements. Rust requires collecting stage, recorded fine permission, a
registered native collector, the frozen status/code pair and consistent empty
raw callbacks/epochs and eligible fixes. The separately signed outcome has
structured startup/no-callback reasons and unknown physical cause. It cannot
pass successful location verification or measurement acceptance. No historical
unsigned logs were signed. Terminal timing freezes before report finalization.

Seventeen focused Rust tests passed, including startup tampering, wrong request
and key, contradictory snapshots, signer errors and cross-artifact substitution.
The native harness passed 40 terminal/journal checks and 27 debug validation
checks; these use synthetic clocks/signing and Linux files, not Android hardware.
Forty-nine diagnostic checks, four adapter tests, five JNI checks, five
JNI-to-public-WASM checks and seven Chromium/WASM checks passed. Android native
libraries, packaging and lint passed. Retained Gradle SDK XML/deprecation warnings
did not prevent the build. The signing fault deliberately discards a completed
Android Keystore signature; storage faults interrupt and roll back actual
AtomicFile writes. These fixed debug-only modes test error handling, not genuine
hardware outages, and accept no caller-supplied observations or signing payload.

Build `20261004T173303Z` was inspected in the existing Debian container against
the independently retained package signer. One 33,704,222-byte APK was exported
through the reviewed original bind boundary, inspected there with the same
public-source inspector, and installed through the unchanged `InstallVerified`
guards. Its installed SHA-256 is
`9f74bc64694e036a3e0f3876be7973bbfc36decf1636ab51e18da4d2fc12a324`.
The corrected diagnostic messages are now installed. Existing app data and keys
were preserved; no container or signing identity was replaced.

The stationary phone's pre-test read-only diagnostic still advertised raw
measurements (`0x863`). The new normal request was independently saved/retrieved
before collection. Its proof passed current public Rust/WASM verification using
the previously trusted key and every requested location/raw policy check. The
signed native collection duration was 5,990 ms, with four fixes and four raw
epochs; the minimum qualifying fix span was 2,989 ms. Signature tampering, wrong
key/request and substitution into the failure verifier were refused. This is
one recovery observation, not a general completion guarantee or demonstrated
preparation speedup.

A separate fresh debug validation request explicitly required at most 1 ns
reported alignment uncertainty and 1 ms delivery delay. Actual native
observations caused Rust policy rejection. Its phone-signed failure report
verified against the independently pre-collected original and trusted key. The
frozen terminal duration was 2,141 ms, with one retained raw epoch and no
eligible fixes. Structured reasons include clock fields/alignment and
insufficient epoch/count/coverage evidence. Every successful-measurement and
acceptance flag remained false. Wrong request/key, tampering and successful
location substitution were refused. The strict test does not characterize
natural reception or alter normal request presets.

All three fixed reporting-fault modes were then exercised after real native
policy rejection. Their exported outcomes passed the prepared checks:

| Simulated reporting fault | Exported outcome | Frozen attempt duration |
| --- | --- | --- |
| Signing | `unsigned-signing-failed`; no report signature | 1,133 ms |
| Initial storage | `unsigned-storage-failed`; current-memory export only; no signing | 944 ms |
| Final storage | `signed-storage-failed`; verified memory report; earlier durable pending record | 1,144 ms |

These durations describe failed attempts, not successful measurements. The
signing check discards an actual Keystore signature; storage checks interrupt
and roll back AtomicFile writes. Errors and retained diagnostics explicitly
mark simulation. Initial-storage failure was exported before the next retry
replaced its memory fallback. No hardware signing outage or full storage was
demonstrated.

After preparation and awake controls were visibly off and Cancel was disabled,
the guarded helper verified an actual user-0 app-process stop/relaunch, new
process IDs, unchanged installed APK and retained app data. Fresh native
Save-all exports retained the old timeout, ordinary rejection and unsigned
signing-failure records byte-for-byte. The initial-write failure was absent from
the four freshly exported journal records. Final-write failure recovered its
earlier `unsigned-pending` record, with no signature or invented completed
outcome. This was a controlled restart after finalization, not a crash during
collection/signing/writing or a power-loss durability test.

The strict comparison between the final-write attempt's signed memory snapshot
and recovered pending snapshot failed on one raw pseudorange-rate value. The
original failed comparison and all bytes remain preserved. Diagnosis reproduced
the same one-bit binary64 change in the existing Rust/WASM JSON parser before
signing; it did not originate in restart recovery. All terminal integers and
diagnostic fields matched. The earlier signature still verifies its encoded
claim; it is not relabeled as an exact native numeric copy or re-signed.

The pinned `serde_json` dependency now enables `float_roundtrip`. A regression
requires exact observation and policy bits, including negative zero, exact
original-request binding and refusal of an adjacent-value wrong request; no
tolerance was widened. The corrected snapshot passed 245 core tests with one
external-archive test explicitly ignored, five JNI checks, five JNI/WASM checks
and five compatibility cases. Existing signed success/failure bytes remain
verifiable without renewed freshness or success promotion. Both earlier normal
phone proofs also passed the corrected public verifier, retaining their original
5,990 ms and 6,154 ms collection durations and every requested policy check.
The second normal proof was collected after the controlled app restart.

Corrected build `20261004T191156Z` passed both Android native ABI builds,
packaging and lint in the same new source snapshot. Its one exported APK is
33,728,278 bytes, with SHA-256
`12363505c3dc9206d02b23c6855a1b954118bbb6af3441206646a54202484c47`.
Full Linux package inspection passed against the independently retained signer,
with current assets/libraries and no build gaps. The initial inspection omitted
the launcher's source metadata and correctly rejected the expected `SOURCE.txt`;
that failed report is preserved. Reinspection used the original recorded source
metadata on the unchanged APK, without another build/export or report editing.
At the 4 October checkpoint, this corrected APK had not been installed on the
phone; the last verified installed build was `20261004T173303Z`. Installation
and the exact physical recheck subsequently passed in the
[5 October record](#gps-exact-retention-recheck--5-october-2026).

At that checkpoint, the corrected APK's installation and affected exact physical
storage/restart comparison remained unverified because the owner disconnected
the phone while conserving computer battery. No additional normal phone run was
needed for that checkpoint.
The last verified phone state showed preparation expired, awake off and Cancel
disabled; the dedicated USB helper was then stopped. Android startup-status
report production on this phone also remains unverified unless that status
recurs naturally. The original receiver cause and permanence of recovery remain
unknown. Guarded UI/focus interruptions, failed harness/comparison results and
all private originals, reports, hashes and QA records are preserved outside
public source. No audio ran.

## GPS exact retention recheck — 5 October 2026

The owner reconnected the stationary phone, authorized USB and returned to
unlocked Non-verba. The existing Debian container and corrected source snapshot
were reused. The unchanged, previously inspected build `20261004T191156Z` was
installed through the original private USB helper's `InstallVerified` guards.
Installed-byte readback matched the corrected APK hash recorded above. Existing
app data and signing keys were retained. No new build, package export, source
snapshot, dependency installation or cache copy was needed for this recheck.

The check was prepared before creating a fresh, intentionally strict debug
request, which was saved and independently retrieved before collection. Actual
native observations caused raw-GNSS policy rejection. The one-shot simulated
final-storage fault left a signed report in memory and its earlier durable
unsigned pending record. Public Rust/WASM verification in Debian passed the
exact pre-collection request, independently trusted key, signature and claim
consistency. Tampering, wrong request/key and substitution into successful
location verification were refused; successful-measurement and acceptance
flags remained false.

The signed failed attempt's terminal duration was frozen at 5,514 ms, with one
raw callback, one retained raw epoch and zero eligible fixes. This duration is a
failed attempt, not a successful measurement time. The debug marker explicitly
identifies a simulated report-finalization fault; it does not establish real
storage failure or characterize ordinary GPS reception. Normal request presets,
the two-second observation minimum and the 60-second collection timeout remain
unchanged.

After preparation and awake controls were visibly off and Cancel was disabled,
the helper verified an actual user-0 app-process stop/relaunch, changed process
IDs and the same installed APK. Fresh native Save-all exports after that restart
contained five retained attempts and their originals, yielding ten new export
sources. The new attempt recovered as `unsigned-pending`, without a signature
or invented completed outcome. Its complete frozen snapshot matched the
pre-restart signed snapshot exactly, including floating-point values and the
original request. The four older journal records retained their exact bytes,
timing and counters. The initial-write-failed memory-only outcome remained
absent from fresh journal exports; its earlier cached export was preserved.

Both the exact retention comparison and the chronological restart/export check
passed. No numeric tolerance was introduced. The original 4 October one-ULP
failure, diagnosis and signed bytes remain unchanged; the new result validates
the corrected parser on a new attempt. No additional normal GPS run was needed;
the earlier normal proofs had already passed the corrected verifier.

This was a controlled process restart after reporting finished. Recovery from a
crash during collection, signing or writing, power loss, a genuine signing
hardware outage or full storage remains unverified. Naturally occurring
startup-status-0 report production on this phone was not observed. The original
receiver cause, recurrence and permanent recovery remain unknown. A signature
authenticates the reporting key and unchanged claims; it does not alone prove
physical collection, effort, weather, hardware fault or responsibility. Earlier
unsigned logs remain unsigned, and compensation and penalties remain separate.

The final phone state showed GPS preparation off (expired), Keep screen awake
off, Cancel disabled and no active collection. The dedicated USB helper was
stopped. No audio ran and no test session remains running. Private original
requests, reports, manifests, installation/restart/UI records and the three
passing QA reports are retained in the existing ignored artifact area; a new
completion checkpoint references their exact hashes without overwriting the
4 October handoff or failed evidence. Concurrent source and documentation edits
were preserved.

## Camera quality guidance — 5 October 2026

The owner prioritized the first Rust resolution, exposure and regional sharpness
module, then requested as much functionality testing as possible outside the
phone. This version analyzes supplied delivered JPEGs through native Rust or the
shared WASM Worker. Its optional subject region uses oriented pixel coordinates;
the resulting image/profile-bound record is unsigned guidance. Signed camera
requests, existing capture policy and successful acceptance are unchanged.

Twenty-two focused Rust tests passed. Analytic ramp and step oracles checked
Sobel sums and sample denominators; other cases covered integer luminance and
box rounding, regional isolation, clipping, texture/scale aliasing, all eight
orientation mappings, little/big-endian EXIF, duplicate/wrongly typed metadata,
profile/region bounds, tiny windows, byte limits and header dimension bombs.
Sixteen adapter tests passed input/read bounds, state invalidation, stale results
and errors, immutable export, invalid report claims and honest save failure.

One native-generated synthetic corpus contained 24 image/profile cases: 20
measured JPEGs and four intentionally rejected inputs. It included grayscale,
clipped regions, sharp and blurred texture, a flat subject against a detailed
background, eight EXIF orientations, odd-size high-frequency color, progressive
4:2:0 JPEG with restart markers, one-pixel input and an actual software-signed
C2PA delivered JPEG. The upstream 479-byte progressive fixture retains its
provenance and selected Zlib notice. Synthetic signing material stayed in memory;
no phone key or physical sensor observation was used.

All 24 complete native/WASM reports or errors matched exactly, without numeric
tolerance. A further check verified the actual delivered C2PA JPEG with the
existing image verifier and refused unsigned quality JSON as a substitute for
that signed photo. This confirms compatibility and separation on the tested
corpus, not a universal JPEG-decoder or physical-authenticity guarantee.

Six headless Chromium checks passed against the built application and actual
Rust/WASM Worker: independent inspection without a challenge/key, exact unsigned
export, subject-region isolation and invalidation, suppression of an obsolete
real Worker response after a file change, malformed-image failure and no sensor,
signing or successful-acceptance operation. The test delayed delivery of one
request to reproduce the stale response; it did not replace Rust measurements.
The owned server and browser closed in the test's cleanup path.

All execution used the preserved Debian container through the documented
launcher. One reviewed source snapshot and existing caches were reused for
focused tests, fixture generation, one WASM/web build and follow-up checks. Only
the two already locked JPEG decoder packages became direct core dependencies;
no package version changed. No dependency download, APK build/export or phone
installation was needed. Small QA logs and JSON results remain private; source,
synthetic fixture definitions and license notices are public. No older evidence,
cache, snapshot, Docker object or concurrent authored change was removed.

The pixel rules are versioned and post-decode arithmetic is integer. The pinned
decoder may use architecture-specific optimizations; other architectures,
unrepresented JPEG forms and phone deployment remain unverified. Input/dimension
limits are not a strict total-memory cap. Task/device calibration, enforced
quality requirements in signed requests, motion/gyro evidence, simultaneous
multi-camera acquisition and audio quality remain future work. No phone or
physical audio testing ran, and no test session remains running. See
[CAMERA_QUALITY.md](CAMERA_QUALITY.md) for the API, metric semantics and limits.

## One-photo camera quality compatibility — 5 October 2026

After the off-device checks, the owner authorized one brief quiet camera check.
The already verified installed build `20261004T191156Z` was reused; no new APK,
package export, installation or source snapshot was needed. All quality analysis
and signature verification ran in the same Debian snapshot as the earlier tests.
The phone stayed in place and no audio ran.

A fresh metadata-only diagnostic challenge was generated by Rust/WASM and saved
before exposure. The USB helper verified exact field insertion. This bare
challenge does not establish authenticated requester delivery or a receipt, and
does not request raw-GNSS proof or successful-measurement acceptance. Existing
native camera GPS-metadata requirements were retained.

One native shutter input produced one signed 3000 × 4000 JPEG, 2,675,434 bytes.
The file was saved once and retrieved through the original USB helper. Both
native Rust and WASM image verification passed the exact retained original
challenge, capture-window, C2PA integrity, previously trusted camera-key,
native-camera-metadata and GPS-metadata checks. The trusted camera pin came from
independently retained September records, not from this new image. A signature
authenticates unchanged claims from that key; it does not independently attest
the physical scene, capture time or location.

Native Rust and WASM produced exactly equal complete quality JSON on those same
JPEG bytes and the default versioned profile, without numeric tolerance. The
quality image hash matched the USB retrieval hash. Wrong request/key and
unsigned-quality-record substitution were rejected. The quality record remains
unsigned guidance with authenticity and successful-measurement claims false;
no successful acceptance was invoked. This validates compatibility with one real
Camera2 JPEG, not usability thresholds, general decoder agreement, raw-GNSS
acceptance, calibration or deployment of the new quality UI on the phone.

Two helper batches stopped during window transitions into and out of the native
camera preview. Their retained records show each intended input was sent once;
fresh owned-app observations confirmed the preview and then the successful
signed result. Neither opening nor shutter input was repeated. These guard stops
remain preserved alongside the successful evidence.

The helper's bounded camera retrieval includes earlier public camera exports;
it was run once and those copies remain private. Exact original request, JPEG,
retrieval manifest, native/WASM comparison, small inspection drivers and closure
checkpoint remain under private device-acceptance/QA artifacts. No previous
evidence or cache was removed. At closure the camera preview had ended, GPS
preparation and Keep screen awake were off, and the dedicated USB helper was
stopped. A bounded container process-name check found no remaining project
test/service processes; the preserved development container stays available.

## Delivered-photo browser quality checks — 5 October 2026

The owner authorized continued testing and asked whether phone movement was
needed. The preceding saved 12-million-pixel JPEG was reused entirely off device;
no new photo, phone operation, installation or source snapshot was needed.
The already built quality panel and actual Rust/WASM Worker ran in headless
Chromium inside the preserved Debian container.

Nine checks passed. Full-image metrics matched the retained native report and
the displayed resolution was correct. A 1500 × 2000 geometric selection matched
new native expectations and the same fixed-grid tile exactly; adding the region
left whole-image and other grid measurements unchanged. The final one-pixel
image edge had one exposure sample and explicit insufficient-data sharpness at
scales 1, 2 and 4, matching native results. Changing a region invalidated prior
guidance; a region extending outside the image cleared the result and disabled
export. The geometric selection does not identify a meaningful scene subject or
calibrate its usability.

Both whole-image and selected-region downloads matched the displayed JSON
bytes exactly, with the expected image-hash filename and JSON MIME type. Image
hashes stayed fixed while profile hashes changed with the selection. The saved
original JPEG retained its exact bytes after all analysis and exports. Only the
two quality Worker methods ran; sensor/audio/WebCrypto-signing guards observed
no calls, verification stayed inactive and successful acceptance stayed disabled.
This browser run did not repeat signature verification; its original-challenge
and trusted-key results remain in the preceding separate check.

The reusable source driver is `code/test/camera-quality-delivered-browser.mjs`.
Native expectations, browser report and log remain in the private camera-quality
QA directory with separate hashes/checkpoint; earlier results were not replaced.
A small native expectation driver used existing caches; there was no WASM/web
or APK rebuild, dependency download, cache copy, image copy or deletion. The
owned Chromium context and loopback server closed in the driver's cleanup path,
and a bounded process-name check found no remaining project test/service
processes. Calibration and installation of the new phone quality UI remain
unverified. No phone movement was required for these software checks.

## Camera quality phone deployment preparation — 5 October 2026

The owner requested continued work. The next bounded deliverable is installation
of the tested quality panel and analysis/export of the already saved JPEG in
Android's WebView. No new capture, phone movement, audio or threshold calibration
is part of this check. The current source was copied once through the documented
snapshot launcher so the package has freshly recorded source provenance; earlier
snapshots, captures and all prior evidence were preserved.

One Linux build produced `20261005T113606Z`, version 0.7.0, 33,728,352 bytes.
Android assembly and lint passed. The documented exclusive bounded export copied
only the APK to the original private container-builds bind; its bytes matched the
snapshot output. The unmodified package inspector verified the retained signer,
current staged assets/native outputs and license/source notices, with no reported
build gaps. Its authentic report was copied unchanged into private QA. Six
quality UI/engine assets matched the earlier tested output exactly. The build is
explicitly dirty; this is package inspection, not reproducible-build certification
or physical sensor validation. Installation remains unperformed at this checkpoint.

A separate `ExportCameraQuality` action was added to the original-path USB helper.
It retrieves only explicitly exported `nonverba-camera-quality-<image-hash-prefix>.json`
files from the existing owned export cache, with 128 KiB/report and the existing
128-file inventory limit. Exact filename/image-prefix, UTF-8, report type/version,
guidance-only flags, bounded region count and root JSON shape are checked before
retention. Existing camera and Downloads allowlists were preserved. The retrieval
manifest explicitly has no authenticity, metric-verification or successful
acceptance authority. No native file-import/signing API or wider phone command
was introduced; Android's existing document picker will import the saved JPEG.

PowerShell syntax was inspected as host integration. PowerShell-specific parser
negative tests were authored but not executed: the preserved Debian environment
has no `pwsh`, and no runtime/dependency was installed or host project test run.
Live positive parser/retrieval coverage also remains pending phone access.
Seventeen independent off-device comparison cases passed against the exact
comparison code prepared for the phone export: correct report, changed image or
profile hashes, altered histogram/sharpness, changed region, forbidden claims,
cross-artifact type, duplicate/trailing JSON, changed bytes, size limit, wrong
filename/checksum/classification and signing claim. Tightening validation before
file reads was followed by a passing recheck; both result files remain retained.
These cases do not pretend to execute the PowerShell parser or originate on a
phone.

The verified package, authentic inspection, source metadata, comparison drivers
and results remain private in camera-quality QA. The short physical check awaits
a fresh unlocked/connected device-readiness reply and one manual saved-JPEG
selection. The helper does not operate Android's DocumentsUI. No phone session,
sensor or USB server was started during this preparation.

## Phone quality panel and saved-JPEG export — 5 October 2026

The owner authorized continuation with the connected phone. The existing
prepared build `20261005T113606Z` was installed through the original approved
USB helper; the installed APK SHA-256 matched
`da0f401d63974bc97bd40c1f5a1f5ee028f5e1ea56756147b128623db66d6e9b`.
No new build, source snapshot, dependency installation or package copy was
needed. Initial unauthorized USB checks, cold-start loading observations and
guarded navigation interruptions were retained rather than reported as completed
camera measurements.

The owner manually selected the previously saved JPEG in Android DocumentsUI.
The helper stopped on that expected external-window transition and sent no input
in the picker. The installed quality panel then analyzed the default whole-image
profile, displayed 3000 × 4000 dimensions and explicitly guidance-only status,
and saved its separate unsigned record once. No new camera capture, microphone
operation, evidence signing or successful-measurement acceptance was invoked.
Historical signature verification remains the earlier independent check; it was
not repeated or relabeled as a fresh capture during this inspection.

`ExportCameraQuality` retrieved one 27,679-byte report. The original JPEG and
exported report matched their independently retained hashes. The public default
profile hash was
`5bb674eb8ef30a65518e84bc1e5dda09af13e7908c44a1559553bffa5bc74339`.
The prepared `verify-phone-quality.mjs` ran through the existing validated
Debian snapshot and passed complete report equality with retained native Rust
and independently recomputed WASM results, plus exact exported JSON byte,
length, checksum, filename and guidance-classification checks. The detailed result
is retained in ignored private QA records.

The exact retrieval manifest and its checksum remain private inspection/transport
records, not signed evidence or requester-arrival witnesses. The live successful
export exercises the
PowerShell parser's positive path. Its separately authored negative tests remain
unrun because Debian has no PowerShell runtime. Physical selected-region UI
checks, broader-device agreement and reading-fidelity calibration were not added
to this bounded check; the earlier off-device region tests remain valid.

GPS warm-up was observed on app launch/resume and stopped through its own
control. It appeared again during cleanup; the helper stopped when Non-verba
lost focus, and the owner returned to the app. The final exact active-button
stop and awake-off actions verified both leases off in the retained private UI
record. The dedicated USB server was then stopped; its output remains in private
QA. The existing code allows a new
bounded preparation lease after Activity resume; these observations do not
identify the exact trigger of every focus transition or constitute a new GPS
proof. No new camera or audio session was left running. The comparison process
completed; a process inspection found only the preserved container's `sleep`
and five pre-existing defunct browser entries, with no live test/browser service.
Those entries and all prior source/evidence were preserved.

The private completion checkpoint references 14 pass/interruption/closure records
and confirms no listener on the dedicated USB port. Their exact identities and
checksums remain in the ignored QA records.

The owner deferred blur implementation and left algorithm selection open. The
[hardening notes](../notes/sensors/SENSOR_QUALITY_NOTES.md) record the intended
single requester-facing value; no blur cutoff or quality acceptance rule was
introduced by this phone check.

## Microphone lifecycle and assertion hardening — 6 October 2026

The owner requested microphone hardening before connecting the phone for device
checks. This checkpoint used synthetic inputs exclusively in the preserved
`non-verba-dev` container. No phone access, physical microphone recording,
speaker output, calibration, new photo or GPS collection occurred.

Browser setup cancellation now settles while context resume, permission or
worklet loading remains unresolved; late granted tracks are stopped and fresh
setup can proceed. Native work tracks queue ownership and handles rejected
submissions, freezes unsigned terminal elapsed time, and enforces the earlier
original request expiry or existing inclusive 150,000 ms session lifetime.
Existing acquisition/freshness limits were unchanged. Teardown wipes unsigned
media despite release exceptions and preserves unresolved cleanup ownership.
Recording callbacks remain revoked while failed OS unregistration is retried.
No signed microphone failed-attempt report was introduced.

The pinned C2PA assertion lookup selects by prefix. The Rust audio verifier now
selects the exact assertion directly and requires uniqueness. Eight deliberately
signed synthetic WAV cases retain genuine C2PA integrity while testing duplicate
instances, misleading prefix labels, conflicting exact claims and allowed
unrelated assertions. Against the preserved earlier WASM, four cases incorrectly
passed that the hardened verifier refuses; two valid cases previously refused
now pass. Native duplicate rejection and historical audio without native metadata
remain consistent. Historical audio receives no native-monitoring credit.

| Check | Result |
| --- | --- |
| JavaScript audio capture/transport, native adapter and worklet regressions | 76 passed |
| Rust audio verification/signing regressions | 27 passed, including the eight signed assertion cases |
| Final production Kotlin lifecycle/callback cleanup helper | 45 deterministic checks passed; earlier 36-check result retained |
| Native observation-queue fence | 19 passed |
| Real Linux JVM/JNI signing and rejection harness | 52 passed; includes camera/location compatibility and synthetic audio |
| Exact native/WASM assertion-case verdicts and checks | Eight matched, with authentic signatures and no audio I/O |
| Actual Chromium JNI-to-WASM audio verification/appraisal | Six passed |
| Actual DOM cancellation and fresh retry with unresolved old permission | Passed; separate no-uncaught-errors check passed; synthetic input and null sink |
| Corrected Android arm64/x86_64 package and lint | Passed |
| Independent Linux package inspection | Passed, no gaps; retained signer and exact tested UI/WASM assets |

The full synthetic browser demo did not complete. Its recorder observed frame
249,600 where 249,728 was required, refused the repeated render quantum and
closed its context. No completed WAV or receipt resulted. The cause remains
unresolved; no continuity requirement was relaxed and this is not a finding
about phone hardware. Its failed result was preserved before running the focused
cancellation test. A separate initial browser launch selected an absent full
Chromium executable; the diagnosed retry used the already installed headless
shell, without installing dependencies. A final callback-change Android build
failed Kotlin recursive type inference; adding an explicit Boolean type fixed
compilation. That failed build and the earlier successful pre-correction package
remain retained, with neither installed on the phone.

Private evidence remains in the ignored QA area. The initial checkpoint includes
42 logs/reports/synthetic fixture files, 3,844,303 bytes before its index; exact
host readback hashes matched. The 45-check result, failed compilation, final
build/export and authentic package report remain preserved there.
Existing evidence, caches, volumes and unrelated work were preserved.

The final package is build `20261006T145710Z`, version 0.7.0, 33,728,352 bytes,
SHA-256 `c79402dc520a5038aca953ae45751bc184340b118838d29a767a831cfab211a6`.
Its established APK signer is unchanged. The exact exported APK and authentic
package-verification report remain in the original ignored installation/QA areas.
Final source snapshot:
`/tmp/nonverba-unified-source/a8e5673188b64fdca162dd1461c4b2f8`, base
`8c383bf3450c5d629d384a4e469acb524553d33b`, dirty, archive SHA-256
`a12ffbe2818d391708dc8d8a33830fed17ae2f49242936494dc18f0277031c3c`.
The first tests and additional callback check retain their respective source
snapshots and logs; final assets/helper were compared with the tested bytes.

At this software checkpoint, installation and physical microphone support were
unverified. The first
planned phone gate is capability/setup and at most one two-second acoustic pilot
plus four-second native local demo. Playback uses the existing high-frequency
probes; inaudibility is not guaranteed. Refusal must remain explicit and retained,
without a weaker profile or repeated physical attempts. A local demo cannot
establish independent requester evidence. Full route/privacy, independent pairing,
long-duration, concurrent-recorder and crash/restart acceptance remain separate.
The unresolved synthetic full-demo interruption also remains open.

All test cells finished and temporary preview servers/browsers closed. Final
container process inspection found no active test/build/browser/preview process;
defunct child entries under its existing `sleep infinity` PID 1 were left alone.
The USB helper was never started for this checkpoint. Blur algorithm selection
and implementation remain deferred.

## Microphone phone readiness rejection — 6 October 2026

The owner subsequently connected the phone and authorized the bounded local
microphone/speaker check. The documented original USB helper initially found
Android unauthorized; the owner approved debugging and returned to Non-verba.
The verified `20261006T145710Z` update installed without clearing app data or
changing the retained APK signer. The helper's installed-byte readback matched
`c79402dc520a5038aca953ae45751bc184340b118838d29a767a831cfab211a6`.
The phone remained in place. Its current awake lease was checked active and
retained across installation; GPS preparation was stopped before audio setup.

One local-demo start was attempted. The app displayed:

> Unmute the microphone and media speaker before the acoustic pilot

and the terminal status was:

> Session stopped. No requester-verified evidence was completed.

Source review identifies the guard as positive `STREAM_MUSIC` volume and an
unmuted Android microphone flag. The combined error does not identify which
condition failed. This guard precedes audio-focus acquisition, recording monitor
registration, AAudio stream creation and pilot generation/playback. The attempt
therefore opened no audio streams, retained no microphone PCM and reserved no
challenge nonce. No signed WAV or receipt resulted. This is a pre-acquisition
readiness rejection, not evidence of a microphone/speaker fault, acoustic
support, physical collection or successful measurement. Frozen native terminal
timing and resource teardown after actual acquisition remain physically
unverified. No second recording attempt or weaker profile was used.

The start input's immediate readback reported `mCurrentFocus=null`; the later
guarded own-app screenshot captured the refusal. Further input was stopped and
the owner was asked to return to Non-verba for cleanup. Private app-status and
pre-acquisition records reference the original screenshots and UI snapshots in
the ignored evidence area. These are unsigned USB
and operator-side observations, not native-signed attempt reports. Earlier
software results and failed-test evidence remain preserved.

Physical capture, high-frequency speaker support, exact WAV export/independent
verification and the full native audio acceptance checklist remain pending.
The existing helper has no audio retrieval action; successful audio verification
must use a separately reviewed bounded retrieval before claiming exact exported
WAV acceptance. A future check first needs positive media volume and an unmuted
microphone, with fresh owner readiness and a bounded acoustic attempt.

The dedicated USB helper was then stopped; the read-only host check found zero
listeners on port 5038. The private helper-stop record retains that result.
The audio attempt was already terminal, with no acquisition started. Final
phone cleanup remains unverified while the visible-app confirmation is pending:
Keep screen awake was last observed on with a bounded expiry, and GPS
preparation was last observed stopped before entering the audio page. Do not
read this checkpoint as confirmation that both phone controls were turned off.

## Microphone format rejection on owner-authorized retry — 6 October 2026

The owner asked to consider headphones and retry. Code review confirmed that
the native adapter explicitly selects built-in microphone/speaker IDs; C++
checks the actual stream IDs before starting streams and during acquisition.
There is no silent wired, USB or Bluetooth headset fallback. Accessory presence
alone does not establish the actual selected route. Headset support and
connection/disconnection acceptance remain pending in the sensor hardening
notes. The installed verified build was reused; no rebuild was needed for this
retry.

After USB authorization, the owner confirmed Non-verba visible, non-zero media
volume, an unmuted microphone and disconnected headphones. The awake lease was
checked active. One fresh local demo was prepared and started. Its own-app
terminal screenshot showed:

> Microphone client format differs from the AAudio contract

and no requester-verified evidence completed. This error comes from the Android
recording-configuration policy, which requires a reported 48 kHz, mono, float
client format. The actual observed rate, channels, numeric encoding and mapped
encoding were not preserved by the message. Code review found no obvious
Android/AAudio encoding-enum substitution. That does not establish a cause or
show that the phone's hardware cannot support the profile.

Unlike the earlier pre-acquisition refusal, readiness streams may have started
on this path. The monitor's first bad observation prevents pilot generation, but
a later bad observation could follow an earlier clean poll. Because stopping
phase and previous observations were not retrieved, pilot/probe activity and
the precise amount of unsigned acquisition are unverified. The terminal result
was refused and no signed WAV or receipt completed. No additional attempt or
weaker profile was used. A future diagnostic must retain bounded actual Android
and AAudio format values and the stopping phase before changing this policy.

Android Back closed the app rather than navigating to the camera page. The
helper then correctly refused an external-launcher screenshot; no screenshot
of that other app was retained. The owner reopened Non-verba. GPS preparation,
renewed on the camera home page, was stopped; Keep screen awake was turned off.
The guarded final screenshot confirms both controls off. The dedicated USB helper
was stopped and port 5038 had zero listeners.
This completes the phone cleanup left pending by the earlier checkpoint.

Private evidence retains a checkpoint and exact hashes/references for the
original own-app screenshots in the ignored evidence area. The records are
unsigned, with no native
attempt-report signature, completed measurement time or independent audio
acceptance claimed. Existing successful and failed software/device evidence is
preserved. No microphone/speaker, phone-input or helper test session remains
running.

## Microphone input-format correction — 6 October 2026

The owner asked to fix the client-format refusal. Review of the pinned Android
11 AAudio legacy input implementation found that a low-latency float input can
open an underlying PCM16 recording client and convert callbacks to float. An
explicit positive input session selects that legacy path. This is a plausible
app-selected conflict with the strict float client guard, not proof of the
unrecorded values from the earlier failed phone attempt.

The correction requests standard input performance and keeps output low latency.
The successful metadata schema and all sample-format, route, source, privacy,
observation, timestamp, xrun and acoustic-challenge requirements are unchanged.
Snapshot rate/channel claims use AAudio getters. Separate mute/volume errors and
bounded unsigned failure diagnostics preserve last observed Android client/device
formats and AAudio values, stream phase and frozen attempt timing. They are
retained across retries in the open page and can be saved as separate JSON;
missing diagnostics and saving failures remain visible. They never enter WAV
signing, successful verification or requester acceptance.

Focused checks in the same source snapshot passed:

- 32 native JavaScript adapter checks, including wrong attempt/request/key,
  artifact substitution, oversized diagnostics, cancellation and terminal paths.
- 42 production Kotlin recording-guard checks and 45 lifecycle checks, including
  sticky failed observations, actual format values, frozen timing and teardown.
- A genuine Rust signed-evidence regression: standard input passes the existing
  contract; four wrong-format/rate/channel cases fail both producer and recipient
  checks despite authentic signatures and valid acoustic challenges.
- Six actual page-handler checks with shipped Rust/WASM and bounded fake
  DOM/transport drivers, including retention across retry, malformed replacement,
  save refusal/recovery and separation from successful acceptance. No audio I/O.
- Android arm64/x86_64 C++/Kotlin assembly and lint.

The first independent package inspection passed contents, signature and byte
comparisons but refused freshness: cached production Rust/WASM outputs preceded
the changed `cfg(test)` regression file. Cargo had correctly reused their runtime
outputs. That failed report and package are retained. The relevant production
source timestamp was invalidated with its bytes/hash verified unchanged, and
the normal build rerun in the same snapshot; no inspector exemption, cache
deletion or changed signing identity was used.

Evidence is retained in the ignored private QA area. The source snapshot is
`/tmp/nonverba-unified-source/1e5ea813783444df8b79073eefa8d30d`, base
`8c383bf3450c5d629d384a4e469acb524553d33b`, dirty, archive SHA-256
`f45b8b1c47a3dddf2d1498bf43e6fca0aff83300a452957e4994cc909fc3ccb5`.

The fresh build `20261006T161731Z` passed independent inspection with no gaps.
It is version 0.7.0, 33,728,352 bytes, SHA-256
`d27fc876dbd9f30954e20d4cc776c640ce72add82eded026a85de12eeb56e888`,
with the established signer unchanged. The fresh compilation produced the same
APK bytes as the preserved first build; it resolved the conservative freshness
check without changing the verifier. The authentic passed inspection report and
eighteen small logs/reports, 168,522 bytes before their index, were retained in
the private reserve with exact host readback hashes.

The owner confirmed readiness for one short microphone/speaker attempt. The
original USB helper installed the verified update; installed-byte readback
matched the hash above. The awake lease was checked active and GPS warm-up
stopped before installation. Launch renewed the lease and GPS preparation.
USB then disappeared before the next input; the helper's read-only status
listed no device. No audio attempt had started on the corrected update. That
transport interruption is separate from microphone support and collection.

The final read-only USB check still listed no device. The dedicated helper was
stopped and port 5038 had zero listeners. Container process inspection confirmed
no active test, build, browser or preview process; old defunct children were
preserved. The corrected update has zero audio attempts at this checkpoint.
Phone cleanup could not be verified after disconnection: the last own-app
screenshot showed the renewed awake lease on with a bounded expiry and GPS
preparation active with its five-minute limit. The operator was asked to
reconnect; those controls must be checked/off before leaving the phone idle.
Private interruption and helper-stop records preserve the unsigned observations
and references to the original captures.

## Microphone pilot after format correction — 6 October 2026

The owner reconnected the stationary phone and resumed the already authorized
single short audio check. USB was authorized and Non-verba visible. The awake
lease was checked active with a fresh bounded expiry; GPS preparation was stopped
and confirmed off before entering audio. The installed verified format-fix package
was reused, with no build, reinstall, audio playback of a saved recording or
second acoustic attempt.

One prepared local-demo start reached the native pilot, then stopped with:

> Native microphone/speaker pilot did not recover the timely challenge

No four-second evidence recording, requester challenge rounds, signed WAV or
receipt completed. The earlier framework client-format rejection was not
repeated on this attempt. Its explicitly unsigned native diagnostics reported
terminal elapsed time 2,484 ms, stopped state `pilot`, phase `pilot-recording`,
96,000 last-observed retained frames, probe enqueued, pilot not verified and
zero evidence challenges. This elapsed value is a failed-attempt duration,
not a completed measurement time or demonstrated speedup.

The last observed AAudio input was 48 kHz mono `pcm-f32`, performance `none`,
built-in microphone, shared mode, burst 960 and capacity 2,880 frames.
Output was 48 kHz mono `pcm-f32`, low latency, built-in speaker, shared
mode, burst 192 and capacity 1,536 frames. The input session and timestamps were
reported ready. These are unsigned app-reported observations,
not independently attested collection, guaranteed playback or hardware truth.

The pilot policy currently combines failure to detect the nonce-bound marker
with a detected marker starting after its 800 ms limit. The displayed error
does not distinguish those cases or retain detector score, matched-symbol count,
RMS, band ratio or detected offset. No physical cause, hardware fault, hearing
property or operator responsibility is established. All thresholds remained
unchanged. The failed pilot PCM was released, so future diagnostic improvements
cannot retrospectively determine this attempt's acoustic failure.

Android recording-configuration diagnostics were explicitly unavailable. Source
review found a diagnostic-retention bug: pilot teardown closes and clears its
monitor before Rust pilot validation; terminal diagnostics then have no monitor
to read. A future correction must retain its bounded deep copy before detaching
it, with the original observation time and input session ID. This does not mean
the required configuration checks were bypassed during acquisition.

The failure details displayed the native attempt, original request and reporting
key IDs. The same frozen 2,484 ms value remained displayed across later inspection.
The existing JSON save control was invoked without a displayed export error;
exact saved-file bytes and storage durability were not retrieved or verified.
The approved helper has no audio-diagnostic retrieval action, and its accessibility
read again exposed only the WebView root. Evidence therefore retains the exact
own-app screenshots and an explicitly operator-transcribed checkpoint, not a
fabricated native JSON export or signed failure report.

Cleanup used the app's own Camera link rather than Android Back. The final
guarded screenshot confirms Keep screen awake off and GPS warm-up off
(`page-loading` shown as the reason). The USB helper stopped; port 5038 had zero
listeners. No microphone, speaker, phone-input or helper test session remains
running. This completes the
phone-control cleanup previously unverified after disconnection.

Private evidence retains hashes and references to the original captures in the
ignored evidence area.
All earlier successful and failed evidence remains preserved. The next bounded
work is software-only: retain configuration across pilot teardown, separate
not-detected from late-marker refusal and expose bounded detector metrics, then
test those paths with synthetic timing/signal inputs before another phone run.

## Microphone pilot diagnostics — software follow-up, 6 October 2026

The collector now preserves its last bounded Android configuration before pilot
teardown, including the original input session, observation time and stream
phase. A detached monitor cannot erase that observation. A later observed stream
replaces it with its own identity/time; a new attempt does not inherit it.
Diagnostic copying failures stay explicit and cannot skip resource cleanup.
Terminal timing freezes before failure diagnostics and release.

Rust now returns a fixed `nonverba-native-audio-pilot-assessment` from the exact
96,000 native-owned pilot samples and retained native nonce. It distinguishes
`passed`, `not_detected` and `detected_late`, retaining score, matched symbols,
best candidate offset, RMS and in-band energy ratio. Invalid PCM/nonce still
throws. The same internal policy backs legacy validation; its successful output,
thresholds and inclusive 38,400-sample (800 ms) start bound are unchanged. The
new JNI entry is internal, never a WebView interface. Copied pilot samples are
wiped in `finally`; neither samples nor assessment enters successful sealing.
The unsigned terminal diagnostic remains bounded to 16 KiB. Passing the pilot
grants no successful-measurement acceptance.

One source-only snapshot reused the preserved Debian container, existing
toolchains and named caches:
`/tmp/nonverba-unified-source/4a209fa6c32842939efaae786fcadb3b`, base
`8c383bf3450c5d629d384a4e469acb524553d33b`, dirty, archive SHA-256
`66cc65bef4054607ab16675871f5aacd2154fd00335b0a9e14357cc3fd4f08a1`.

Passed checks:

- 120 adapter checks: ownership, immutable nested diagnostics, older/null
  assessments, malformed/contradictory metrics, retry retention and separation
  from successful evidence.
- 21 native-audio Rust tests, including six new pilot cases, and five signal
  tests. Exact policy inputs at 38,400/38,401 samples test the inclusive boundary;
  waveform tests use clearly timely/late offsets because detector alignment is
  approximate. Silence, wrong nonce, low gain, synthetic filtering and malformed
  samples refuse without changing thresholds. Signed-valid and signed-invalid
  native WAV regressions also passed.
- 56 deterministic Kotlin lifecycle checks, including 11 configuration-retention
  checks after detachment, mutation isolation, failed copies, frozen timing,
  media cleanup and successor ownership.
- 61 real JVM/Rust JNI checks, including nine new bounded pilot-assessment cases.
  These synthetic fixtures exercise real signing callbacks without Android
  sensors or phone-key trust.
- Six actual page-handler tests with shipped Rust/WASM and bounded DOM, Worker,
  transport and IndexedDB doubles. Displayed/exported missing, late, passed and
  unavailable metrics retain their failure context; WAV, receipt and acceptance
  remain disabled. This is not a full physical or browser audio-flow result.
- Both Android ABIs, Kotlin compilation, lint and independent package inspection
  with no gaps. The established APK signer is unchanged.

The first inspection passed package-content checks but refused cached WASM
freshness: native-only pilot code and its `cfg(test)` source do not invalidate
the WASM target, while this inspector considers all Rust input times. That
refusal and its diagnosis remain preserved. Only the existing WASM compile was
invalidated using an unchanged `lib.rs` timestamp equal to the latest existing
Rust input, then rebuilt normally. Source, WASM and original APK hashes remained
identical. Inspection then passed on the same APK; no second package or weakened
inspection rule was used.

The single package is build `20261006T171953Z`, 33,730,256 bytes, SHA-256
`becf8481c0cdce3726ef8b45df3775f976d2903e63a05ddc4cbf1e9153aaff8a`, retained
under this snapshot's `code/artifacts/container-builds/`. It has not been
installed. Seventeen small QA records (129,560 bytes, plus their index) were
retained and hash-checked in the ignored private QA area.
Twelve current source files matched their tested snapshot byte for byte. Earlier
successful and failed evidence and unrelated edits remain preserved.

No phone, recording, playback, calibration, USB helper or test service ran in
this follow-up; all software checks completed. The prior phone's released PCM
cannot be recovered or retrospectively assessed. Its physical failure cause,
real detection with these diagnostics, a complete accepted microphone recording
and exact saved-phone JSON retrieval/durability remain unverified. Synthetic
filtering/low-gain cases demonstrate refusal behavior, not the phone's cause.
The earlier full synthetic browser-demo failure also remains unresolved; these
focused passing checks do not supersede it. A future device check should install
the verified package and obtain one bounded pilot result before choosing any
signal or timing change.

## Microphone pilot selection and callback inspection — 6 October 2026

The owner requested further inspection. This follow-up used only the existing
Debian container and silent synthetic samples; no phone, microphone, speaker,
USB helper, preview service or calibration was started. Earlier device evidence
and unrelated working changes remain preserved.

Five deterministic cases exercised the production `NativeAudioCore` JNI and
Rust detector. A timely noisy marker passed alone at offset 4,836, score
0.99638695, RMS 0.021800317 and 64 matched symbols. Adding a clean faint repeat
at the later interval made the original detector select offset 57,636, score
0.9986992 and RMS 0.000116996, below the existing 0.0003 floor. It consequently
refused the entire pilot despite the valid earlier marker. Both complete marker
intervals fit within the original 96,000 samples. These are generated test
signals, not a model or explanation of the phone's acoustic failure.

The bounded correction applies only to native pilot readiness. When ordinary
detection reports false, a fallback scans all complete starts in the same
recording and selects the highest-ranked candidate meeting the unchanged score,
matched-symbol, RMS and band-ratio gates. It applies the original inclusive
38,400-sample (800 ms) start limit after global selection. It returns a recovered
assessment only when that candidate is timely. Every original detected result,
including detected-late refusals, returns unchanged; an unsuccessful fallback
preserves the original refusal and all its metrics. Generic detection, browser
selection, signed WAV sealing and successful verification do not use this fallback.

The real JNI before/after comparison passed: the affected combined faint-repeat
case now exactly equals its timely-only baseline. All four other complete JSON
assessments are unchanged, including both late-marker refusals. A stronger clean
late repeat still suppresses a timely noisy marker. That ambiguity and generic
multiple-peak selection remain open for separate compatibility/policy work.
Clipping a search at the deadline could accept a late marker's rising flank;
that draft was rejected in review before testing or packaging.

Native waveform generation now happens before arming recording, followed directly
by enqueueing the generated probe. The temporary waveform is wiped in `finally`.
No observation window or deadline was lengthened. The controller retains the
pilot's own input session ID, last observed capture count, record request/start
and input callback timing, and any observed completed round-zero output callback.
Unavailable native values remain null; frame zero remains available. Later
evidence streams cannot replace that cached pilot observation. The optional
unsigned field stays within 2 KiB and the existing diagnostic stays within
16 KiB. A complete output callback means samples were supplied to the callback;
it does not prove hardware presentation or sound. No new native signing or
WebView media-submission interface was added.

Passed checks:

- 136 adapter checks, including pilot-stream ownership, immutable terminal
  observations, null/legacy/partial timing, exact large integers, malformed
  timings, retry retention and separation from successful evidence.
- 25 native-audio Rust tests, including ten pilot cases, plus five generic
  signal tests. Wrong nonce/index, silence, low gain, filtering and invalid PCM
  refuse. Exact policy inputs test 38,400/38,401; complete late waveforms and a
  qualifying late fallback preserve original refusals and wire metrics. Existing
  genuine signed-valid/signed-invalid WAV regressions passed.
- 61 real JVM/Rust JNI smoke checks, plus the five-case production JNI
  characterization and exact before/after comparison. No Android sensor or
  Keystore collection was exercised by those fixtures.
- Six actual page-handler tests using the built Rust/WASM and bounded DOM,
  transport and storage doubles. Complete, incomplete and unavailable pilot
  timing survives diagnostic display/export/retry; WAV, receipt and successful
  acceptance stay disabled for failures. This is not a full physical audio flow.
- Rust formatting, both Android ABIs, Kotlin compilation, lint and independent
  package inspection with no errors or current-build gaps. The existing signer
  and exact current web/WASM/native assets were verified.

The first Rust run retained 20 passes and five failed test assertions. Direct
`serde_json::to_value` widened float metrics differently from the decimal JSON
emitted by `inspect_pilot`. Expectations now use the same serialize/parse wire
path; no approximate tolerance or production change repaired that test issue.
A subsequent formatting check retained two test-only layout differences, then
the final formatted checks passed. Both earlier source-only snapshots and logs
remain preserved. After the successful build/page tests, unavailable `rg` inside
Debian prevented APK path selection. Inspection then used the exact path printed
by the completed build; no dependency installation or second APK was needed.

Final checks, build and inspection reused source snapshot
`/tmp/nonverba-unified-source/9f47fef4bbf34005a1339d5c1440e802`, base
`8c383bf3450c5d629d384a4e469acb524553d33b`, dirty, source archive SHA-256
`1b0da4315f359ea6ee8511bbfbd7dc308c69a9da0fd9cb3dd7207d0146709d00`.
The earlier failed-check snapshots are
`/tmp/nonverba-unified-source/ed214439b2944f41ae787f3da2a7a546` and
`/tmp/nonverba-unified-source/28912fa226724dab9f0fec4c2473df14`.
Adapter source bytes were independently matched between their passing snapshot
and the final one; unchanged adapters were not rerun again.

The single APK is build `20261006T180057Z`, 33,731,968 bytes, SHA-256
`e2182745d4537c3d5457cccf1445425b0a47ac07b05eb0a7efc1f58d558bc1be`,
retained in the final snapshot's `code/artifacts/container-builds/`. It has not
been copied to the host or installed. Its established signing certificate is
unchanged; the identity baseline remains private.

Twenty small QA records (130,951 bytes, plus checkpoint/copy-verification files)
were retained and hash-checked in the ignored private QA area.
Thirteen scoped authored source files matched the final tested snapshot exactly;
the original three characterization files remain unchanged. No PCM, WAV,
signing material, APK, cache or toolchain was transferred by this retention step.

All software commands completed. The prior phone's released pilot cannot be
retrospectively assessed. Its physical cause, new callback diagnostics on that
phone, fallback processing cost there, saved-phone JSON bytes/durability and a
complete accepted native recording remain unverified. Native C++ currently
discards stream stop/close return codes; honest error reporting remains an open
cleanup item, with no actual close failure observed. The earlier full synthetic
browser-demo failure remains unresolved. A future phone check should install
this verified package and stop after one bounded pilot result before deciding
on further acoustic or timing changes.

## Microphone phone pilot and transport rejection — 6 October 2026

The owner authorized one short local demo, explicitly including the four-second
recording if the two-second pilot passed. USB authorization was restored before
installation. No second start or retry ran. This was a same-device demo, not an
independent requester acceptance test. The phone stayed in place; media volume
and disconnected headphones were confirmed by the owner.

The previously verified build `20261006T180057Z` was copied once from its existing
source snapshot to the original private installation boundary.
The unchanged independent package inspector passed against that exact exported
path, with no current-build gaps and the established signer. The approved
original USB helper installed it and read back SHA-256
`e2182745d4537c3d5457cccf1445425b0a47ac07b05eb0a7efc1f58d558bc1be`.
No rebuild, key replacement, app-data deletion or permission grant was needed.
The earlier software-only installation statements above describe their earlier
checkpoints; this later check did install their package.

The pilot passed on the phone: 64/64 symbols, score 0.9936247, start offset
2,691 samples (56.06 ms), RMS 0.0053507304 and in-band ratio 0.30231676. These
unsigned detector observations establish readiness within the current policy;
they do not prove physical acoustic origin or explain the earlier failed pilot.
The collector then reported 192,000 retained frames at 48 kHz and two challenges,
covering the requested four seconds. The WebView stopped with
`Invalid native microphone response.` before a requester receipt or signed WAV
completed. The subsequent native cancellation retained stopped state
`awaiting-receipt`, phase `recording-ready` and frozen terminal elapsed 7,093 ms.
That time includes setup, pilot and collection in a failed attempt; it is not a
completed measurement time or a demonstrated speedup.

The cached pilot timing belonged to its original input session, distinct from
the later evidence stream. Its retained round-zero output callback covered
36,864 frames, independently of the later stream. Input/output were observed
at 48 kHz mono float, with intended built-in device IDs and no client silence
or effects in the last Android observation. Output callback completion means
samples reached the callback; it does not prove hardware presentation or sound.

The app's diagnostics save control showed `Saved to Download/Non-verba`. The
existing USB helper has no audio-diagnostics retrieval operation, so exact saved
JSON bytes and persistence across restart remain unverified. The operator
transcription is explicitly unsigned and is not that exported native JSON.
No receipt, C2PA WAV or successful acceptance is claimed for this attempt.

Private package inspection, export, display transcription, preflight and capture
index records remain in the ignored evidence area. The six indexed original
screenshots remain at their private paths without duplication.
The recording/progress, terminal error, full diagnostics, pilot timing, save
toast and final cleanup screenshots are indexed with their exact size and hash.
Earlier evidence, including unsuccessful checks, remains preserved.

After that single result, audio was stopped and the app's own Camera link was
used only to reach its controls; no photo was taken. GPS warm-up and Keep screen
awake were verified off. The dedicated USB helper stopped, and a read-only
loopback listener check confirmed zero listeners on port 5038. No audio,
preview, test service or helper session remains running. The existing development
container and its data remain preserved.

## Microphone JSON and Base64 transport correction — 6 October 2026

After phone cleanup, no further device check, recording, playback or package
build ran. Silent in-memory transport fixtures reproduced a concrete software
bug. Android's JSON writer prefixes each Base64 forward slash with a backslash;
192,000 valid PCM16 bytes can therefore occupy 512,000 JSON characters before
metadata, exceeding the former 300,000-character chunk limit. Completed-WAV
status had the same missing escape allowance. This behavior was independently
checked against [Android 11's JSONStringer source](https://android.googlesource.com/platform/libcore/+/refs/tags/android-11.0.0_r1/json/src/main/java/org/json/JSONStringer.java).
Native retry paths parse cached JSON before serializing, so the escaping happens
once rather than accumulating on retries.

The microphone adapter now derives response limits from twice the maximum
Base64 length plus the existing 64 KiB envelope: 577,536 characters per fixed
PCM16 chunk and 22,435,160 for a maximum-size WAV status. Smaller responses retain
their existing limit. Decoded chunks must still be exactly 192,000 bytes with
96,000 samples; WAV bytes stay at most 8 MiB. Session, position, challenge,
request/key, evidence-origin and downstream signed-evidence gates are unchanged.
The large JSON bound is finite but does not guarantee completion on a device
with little free memory.

The first Debian regression run retained 77/79 passes and two failures with
`Invalid native microphone response.`: a two-round native capture with an
Android-escaped, slash-rich second PCM segment, and an escaped five MiB final
payload. Correcting the response limits made PCM delivery pass; the second run
retained 78/79 passes and exposed `Maximum call stack size exceeded` in the
shared Base64 decoder's repeated-group regular expression. These failures and
their exact logs are preserved. The final-payload fixture is arbitrary synthetic
bytes for transport testing, not a signed WAV or successful-measurement fixture.
The rejected phone response bytes were not retained: these reproductions prove
software bugs, while their exact contribution to that phone error remains an
inference.

The shared decoder now checks complete groups, terminal padding and the standard
alphabet with a stack-safe scan. Existing encoded/decoded bounds, nonempty output
and exact canonical re-encoding stay enforced. Added tests reject internal or
excess padding, incomplete groups, whitespace, URL-safe/Unicode characters and
nonzero unused pad bits. An eight MiB roundtrip passes; limit-plus-one decoded
bytes refuse even when their Base64 length equals the valid case. The smaller
default GPS proof limit is unchanged.

The final focused run passed all 149 microphone, location, camera and GPS-attempt
adapter checks, with zero failures, skips or pending tests. The command was:

```sh
node --test test/native-audio-adapter-tests.mjs test/location-adapter-tests.mjs test/camera-adapter-tests.mjs test/gps-attempt-adapter-tests.mjs
```

One test-only source snapshot was created through the documented launcher:
`/tmp/nonverba-unified-source/cc4f512665154b9784240399417369b9`, base
`8c383bf3450c5d629d384a4e469acb524553d33b`, dirty, original source archive SHA-256
`462491922b7726bdd445571a7fa7435380c46d6592b80cc8b608396269b2bd14`.
That archive describes the initial failing-test source, not the final amended
source. To reuse the same test snapshot, exactly three authored files were
subsequently amended, preserving their before-images in its QA directory:
`web/src/audio-platform.js`, `web/src/location-platform.js` and
`code/test/location-adapter-tests.mjs`. The original package-producing source
was untouched. The final six-file tested hash list matches the current checkout
exactly, and the private checkpoint records each before/after amendment hash.
No package or source notice was produced from the amended test snapshot.

Three small test logs and the final hash list (75,133 bytes total) were copied
and hash-matched to the ignored private QA area. Its retention and checkpoint
records retain exact paths, hashes, source amendments and physical validation
limits.
The eleven indexed records total 125,914 bytes, plus the checkpoint. Before-images and all
container logs remain available. No waveform, WAV, cache/toolchain tree,
whole-build copy or additional APK was produced by this software correction.

The corrected source has not been built into an APK or installed. Full native
receipt/sealing/verification, independent requester acceptance, maximum-size
transport in Android WebView, exact saved phone JSON and persistence remain
pending. Pilot readiness and four-second collector counts on the installed
package are positive observations, not a complete accepted recording. The
strong late-repeat ambiguity, native stop/close error reporting and earlier
full synthetic browser-demo failure remain open. All commands completed and
no new session or service was started.

## Microphone corrected transport package — 6 October 2026

The owner requested continuation and confirmed readiness for one short local
microphone demo, including its two-second pilot and four-second recording if
the pilot passes. The two transport corrections described above were packaged
without further source changes. The six focused adapter input hashes match
the earlier 149 passing checks and the fresh package source snapshot exactly;
unchanged checks were not repeated. Six actual page-handler checks passed
against the fresh built Rust/WASM. These test pairing/lifecycle and failure
export separation with bounded doubles, not physical audio or a full signed
recording.

The documented launcher reused the verified existing Debian container and
managed caches. Build, both Android ABIs, Kotlin compilation, lint and the
independent package inspector passed. One APK was produced, build
`20261006T184318Z`, 33,731,968 bytes, SHA-256
`f4fe13da976b9063068fc1c029a5ced7880cee5e1092b9b5d0fe1d0a651bcb08`.
The source snapshot is
`/tmp/nonverba-unified-source/3406917974624e839e9aafa7b80dabeb`, base
`8c383bf3450c5d629d384a4e469acb524553d33b`, dirty, archive SHA-256
`758ab94b1f8824f25a2a268293d86f6f205dde74c2d8ac3760b9ba94912fa66f`.
Unlike the preceding test-only amended snapshot, this archive identifies the
source used to produce this package.

The initial bounded export command failed before copying anything because
`python3` was absent. The same filesystem operation was then performed with the
already provisioned Linux Node runtime; no dependency installation, new source
snapshot or build retry occurred. The failure transcription remains retained.
Only the APK was exported to the original private installation boundary. Size
and hash matched the snapshot original. The unchanged inspector genuinely verified
that exact exported path against the retained signer baseline, with no errors
or current-build gaps. The authentic report was copied unchanged and hash-checked.
The original approved USB helper installed the update and read back the same
APK hash. No app data, evidence key, Android permissions or signing identity
was replaced.

Private software evidence retains build/page-handler logs, export/inspection
results, retention records and the preflight failure. The five copied container
records total
49,112 bytes and each matched its original hash. Earlier successful and failed
software/device evidence remains preserved. The installed package still needs
its separate physical result; build and inspection alone do not certify the
complete microphone flow.

Physical preflight for that corrected package did not start audio. A fresh own-app
screenshot showed the existing awake lease active with a bounded expiry and GPS
warm-up active; the GPS stop control was tapped before installation. After installing,
Android's launch command stayed pending. A read-only screenshot check then
refused because `NotificationShade` had focus. No input followed into that window;
the owner was asked to return to unlocked Non-verba. The pending launch was
aborted by stopping the dedicated helper (ADB client exit 255), and zero
port-5038 listeners were confirmed. This does not prove that the app failed to
launch. No audio result, receipt or WAV was produced by this preflight.

All commands completed. The phone's awake control and GPS warm-up after the
update could not be rechecked or turned off while another window had focus;
that phone cleanup remains unverified. The lease expires automatically, and
collection/testing must wait for the owner's focus confirmation. The installed
corrected update remains in place. The private checkpoint and original failed
focus/launch transcription are retained; earlier physical failures are unchanged.

## Microphone corrected transport phone result — 6 October 2026

After the owner renewed continuation, one authorized local audio demo ran on
the already verified installed build `20261006T184318Z` (APK SHA-256
`f4fe13da976b9063068fc1c029a5ced7880cee5e1092b9b5d0fe1d0a651bcb08`).
No new update was installed in this check. One native attempt passed the
two-second pilot and reported
192,000 retained frames and two challenges for the four-second recording.
Both PCM chunks reached finalization, avoiding the preceding transport refusal.
Rust then refused before WAV signing with
`Fresh audio challenge was not detected within every round's allowed window`.
No signed WAV or successful measurement acceptance completed.

The unsigned pilot assessment reported 64/64 matched symbols, score 0.9947477,
offset 2,884 samples (60.08 ms), RMS 0.0053587933 and in-band ratio 0.30989772.
Its original input stream was distinct from the later evidence stream.
Both input and output last-observed AAudio formats were 48 kHz mono float with
built-in microphone/speaker routes. The terminal diagnostic reported `sealing`,
phase `recording-ready`, and 7,121 ms. That duration was unchanged on a later
read; it is a frozen failed-attempt duration, not a completed
measurement time or demonstrated speedup. Original request and key IDs and
the available callback/configuration observations are retained in the unsigned
display transcription.

The probes use 20,250/20,750 Hz rather than an ordinary beep. The owner's report
of hearing no sound does not determine the acoustic result. Native callback
completion likewise does not establish hardware presentation or physical sound.
The exact refused round and its detector metrics were discarded, and the PCM
was released. The saved JSON control was invoked once, but no save confirmation
was observed; exact native JSON retrieval and durability remain unverified.
Screenshots and transcription are not contemporaneously signed attempt reports.

The dedicated helper's original thirteen own-app screenshots are indexed,
without copying them, in the ignored private evidence area. Display transcription
and capture index records retain their identities, sizes and hashes. Earlier
package/preflight checkpoints and failed tests are
preserved. No second recording, playback, new photograph or GPS measurement ran.
The failed audio session stopped. Keep screen awake was turned off and verified
on the audio page; the helper was stopped and zero port-5038 listeners confirmed.
The existing native audio-document lifecycle excludes GPS warm-up; no GPS
development or acceptance testing was part of this check.

One silent synthetic Rust characterization then compared the exact pilot and
canonical PCM16 sealing detector paths on two fixed 96,000-sample fixtures.
The timely noisy baseline passed both. Adding a faint clean late repeat still
passed FLOAT pilot readiness (offset 4,836), while the generic PCM16 detector
selected offset 57,636 with RMS 0.00011794882 and refused. This demonstrates a
synthetic selection limitation; it does not identify the phone's missing round
metrics or physical cause, and it does not justify changing signed acceptance.
The focused test passed (1/1); all four actual results are in
`characterization.log`. The test-only snapshot was reused, its specific authored
file before-image retained, and its amended-source hash recorded separately
from the original archive. The package-producing snapshot was untouched.

## Microphone sealing-round diagnostics — software follow-up, 6 October 2026

The follow-up now preserves bounded unsigned per-round observations from the
same canonical PCM16 detection pass that decides native sealing. It records
round index, sample range, existing detector metrics and `passed`,
`not_detected` or `detected_late`. It runs no additional detector and retains
no PCM, challenge nonce or new signature. The inner assessment is limited to
15 rounds and 8,192 UTF-8 bytes; the outer frozen attempt diagnostic keeps its
existing 16 KiB bound and original request/attempt/key identities.

The established Rust sealing API and signed verifier keep their results and
acceptance rules. An internal observed-sealing variant captures the report
before acoustic refusal and preserves that original refusal. Earlier validation
errors clear stale metrics and retain their exception behavior. JNI returns
available metrics beside assessed refusals or successes; a signing callback
failure still refuses the WAV and clears pending Java exceptions. Kotlin
deep-copies those native-owned observations under the existing session authority
lock before terminal teardown. Copy errors remain separate diagnostics. No new
waveform or arbitrary signing endpoint is exposed to the WebView.

The adapter accepts legacy absent/null metrics, checks the strict bounded schema,
round order and actual predicate, and displays each round's result. Even an
all-passed diagnostic cannot supply a completed WAV or successful acceptance.
The metrics remain unsigned descriptions of the detector, not proof of physical
playback, collection, freshness, hardware fault or responsibility.

The existing test-only snapshot was reused, preserving exact before-images for
the authored batch. It was explicitly amended; its original archive hash does
not identify the amended source. The package-producing snapshot and installed
APK were untouched. Scoped Rust formatting passed. Focused native signing
checks passed 31/31, including the new five report regressions and the silent
characterization. Native adapter checks passed 114/114. The initial combined
adapter/page run retained those passes and one page-module setup failure because
the snapshot lacked `web/dist/pkg/nonverba_core_bg.wasm`. The documented web
builder generated that fresh asset once; the six actual page-handler checks
then passed. No unchanged adapter tests were repeated.

An audio-only entry point called the existing `audioSmoke` harness through the
real Linux JVM/Rust JNI library, passing 38 checks. It compiled existing shared
declarations but executed no GPS or camera harness. Synthetic signed audio and
its public request/transcript/key remain in a new scoped container QA directory;
older fixtures were preserved and no audio was played. These checks exercise
marshalling, same-error refusals, zero signing on failed detection, successful
signed fixtures, bounded reports and recovery after signing callback errors.
They do not exercise Android sensors, Keystore or physical acoustic support.

The changed Kotlin controller compiled against the real existing Android SDK
with `:app:compileDebugKotlin`; its exact build-tree before-image was preserved.
The existing SDK XML warning remains. This compiled the controller but did not
run its new retention branch on Android. No Android assembly, new APK, install,
physical recording, playback, dependency installation or container replacement
ran for this diagnostic follow-up. A complete native phone-signed recording,
independent requester acceptance, exact saved phone JSON and durability remain
unverified. Install the future verified diagnostic package only when the next
bounded device check is prepared; the phone's old unsigned observations cannot
be reconstructed into new metrics or signed reports.

The existing page testcase was then extended specifically for round metrics,
including missing/null reports, absent and late patterns, all-passed metrics,
malformed reports, exact saved JSON across retries and disabled successful
acceptance. The same six tests passed again using the already built WASM; no
build was repeated. Ten exact tested authored files match the current public
checkout, including the Kotlin file compiled in the managed Android tree.

The ignored private QA area retains fifteen copied container logs/metadata
(54,247 bytes), each hash-matched to its original, plus the display transcription,
capture index, initial characterization and amendment record. The checkpoint's
initial aggregate byte total was null; its exact before-image is preserved and
the total was corrected from the recorded per-file sizes. Twenty indexed records
total 73,696 bytes, plus the 6,926-byte final checkpoint.
No screenshots or synthetic WAVs were copied into this area. Earlier evidence
and the package checkpoint remain unchanged. All task commands completed;
no task test process or port-5038 listener remains, and the existing development
container and caches are preserved.

## Microphone diagnostic package and successful local phone demo — 6 October 2026

One prepared, owner-authorized local demo completed on the Cat S62 Pro after
installing the verified diagnostic update. The app displayed four seconds,
two acoustic challenges and a locally verified signed WAV. This is a successful
local demo observation, with the requester and operator on the same device;
it is not independent requester acceptance. The previous sealing rejection
remains preserved and unexplained. No detector threshold or successful-evidence
rule changed to obtain this result.

The new package was built through the documented public-source snapshot launcher
in the preserved Debian container. Its untouched source snapshot is
`/tmp/nonverba-unified-source/5d1de18f62104644b0263e021bb0495b`, base revision
`8c383bf3450c5d629d384a4e469acb524553d33b`, dirty source, archive SHA-256
`70818fa18ba4d592a1d12c652105cfc5090bf9b599c82020b7a5ee0acc1fb851`.
All ten previously tested authored files matched the retained tested bytes in
both this snapshot and the public checkout. The prior 31 Rust tests, 114 native
adapter tests, 38 audio-only JNI checks and six extended actual page-handler
tests were reused on that basis, rather than repeated. Both Android Rust ABIs,
Android assembly and lint passed. Existing SDK and Gradle warnings remain in
the build log.

Only the APK was exported, exclusively, to the original private installation bind.
The original and exported APKs have identical bytes: 33,735,856 bytes, SHA-256
`37dfbb4a6806f1ed4c65ff4b162d0e83339b14b030089781182eae69bbb94fbe`.
The unchanged Linux inspector passed package and current-build checks with
no errors or gaps and the retained signing certificate. Its authentic report
was copied without changes and remains in private QA.
The original approved USB helper installed the package and read back the same
installed APK hash for Android user 0. No container, dependency or signer changed.

USB authorization worked. The first awake-control input was rejected when
Non-verba lost focus; no input was sent. After the owner returned to the app,
an active awake lease was verified before installation and again after launch.
The home page's automatic GPS warm-up was explicitly stopped and verified off
before opening Audio. No GPS measurement or camera capture ran.

Exactly one Start demo recording input ran the two-second pilot and, after it
passed, the four-second demo. An intermediate screenshot showed challenge 1/2;
the terminal screenshot displayed `Demo complete. Acoustic challenges and signed
WAV verified locally.` The result panel displayed `4 seconds · 2 acoustic
challenges · local signature verified.` No failure panel appeared, so this
successful run does not validate the new Android failure-retention/display
branch or reveal the earlier refused round. The new unsigned round metrics
remain software-validated; no failure was deliberately induced or retried.

Save signed WAV and Save demo receipt were each invoked once, and both own-app
screenshots captured `Saved to Download/Non-verba`. The documented USB helper
has no audio export action. Exact WAV/receipt bytes, their request/attempt IDs,
external Rust verification and restart durability were therefore not retrieved
or established. Save notifications and screenshots must not be relabeled as
exact native exports. The one bounded accessibility read exposed only root
nodes; screenshots supplied the displayed evidence. No recorded-audio playback
or second recording ran. Hearing no ordinary beep is not a detection verdict
for the existing high-frequency probes.

The app remained on Audio with the completed session and disabled Stop session
control. Keep screen awake was turned off and verified. The dedicated USB server
was stopped and port 5038 had zero listeners; the new source snapshot had no
active test or service process. Existing container, caches, earlier failed
evidence and prior checkpoints remain preserved. The ignored private QA area
retains the build log, export metadata, unchanged inspector report, single-start
input log, capture index and unsigned agent checkpoint. The index references
13 original screenshots and one accessibility JSON (2,663,123 bytes), without
copying them. Their identifiers and checksums remain private.

## Audio saved-demo export and silent browser correction — 7 October 2026

Scope: prepare retrieval of the previous phone demo's exact saved WAV/receipt,
verify the existing Rust verifier's refusal cases outside the device, and
diagnose the retained silent browser recording interruption. No new physical
recording, probe, playback, camera capture or GPS test is authorized by this
checkpoint. Very noisy environment validation remains deferred.

The documented launcher reused the existing `non-verba-dev` container and its
unchanged image, bind and named volumes. It was stopped at the first runtime
inspection and was started through the original launcher; that failed
inspection executed no tests. An initial launcher argument binding error and a
sandbox Docker-pipe denial also executed no tests. The corrected documented
operation passed automatic approval review. No toolchain, dependency, container
or image was installed or replaced.

The bounded `ExportAudio` action now has its own `audio-demo` category. It allows
only explicit local demo WAV/receipt cache exports, 16 unique files, 8 MiB/WAV,
64 KiB/receipt and 32 MiB aggregate bytes. Original bytes, exact hashes and
incomplete transfer reports are retained. Hash reads as well as byte reads are
bounded. Own-app focus, user 0, linked-path rejection and unchanged installed
APK checks apply. `VerifySavedDownloads` checks only the exact unsuffixed public
names against those originals. Neither action verifies sensor evidence or
records successful measurement acceptance.

The Node importer prepares one explicit same-session pair for the unchanged
Rust `verify_audio` example. It preserves the receipt verbatim, requires an
external operator pin, refuses duplicate/unknown fields, malformed UTF-8,
oversize/nonregular/linked inputs and cross-artifact/demo substitution, and
keeps partial output rather than replacing a prior run. Request/transcript JSON
derived from an unsigned local demo receipt is not independently retained
requester history. Rust retains signature, PCM, acoustic and protocol authority.

Passed software checks:

- Importer: 49/49 tests, exit 0.
- Rust example: one locked build, exit 0; two retained authentic synthetic
  baselines verified. Wrong request, wrong key, wrong nonce, wrong PCM commitment
  and tampered WAV each returned exit 1 and the expected failed checks. All
  originals' hashes matched before and after each invocation.
- Actual remote shell templates: 9/9 Linux guard checks, exit 0, covering bounded
  reads/hashes, growth, replacement, symlinks, listing overflow and exact public
  Downloads outcomes. The first run passed eight checks and failed on an empty
  test-directory removal (`EISDIR`); only that fixture cleanup was corrected.
  The initial failing source, log and exit remain preserved. These checks do not
  execute PowerShell or Android toybox.
- Browser adapter/worklet: 71 TAP checks, including six deterministic recorder
  assertions. The strict repeated-frame regression still refuses completion.

PowerShell's 53 transport fixtures are authored but **unrun**: the existing
Debian environment has no provisioned PowerShell runtime. No host project tests
or dependency installation were used to bypass that boundary. The subsequent
actual phone transfer exercised the positive PowerShell/Android transport path;
the negative PowerShell fixtures remain unrun.

In installed Chromium 145.0.7632.6, a minimal silent characterization reproduced
the normal playback refusal: frame 152,320 repeated where 152,448 was required,
after the first full 96,000-sample chunk. The timing coincided with the second
probe ending. A steady graph completed the full 192,000 samples. Chromium's
[worklet frame-update source](https://raw.githubusercontent.com/chromium/chromium/145.0.7632.6/third_party/blink/renderer/modules/webaudio/base_audio_context.cc)
uses a graph try-lock and can skip that update. Graph mutation is a supported
explanation, not instrumented proof of the precise lock event.

The narrow correction keeps ended playback nodes attached until capture closes,
bounded to 16 probes of 36,864 frames. Closing still stops, disconnects and
releases every source. Afterward, three fresh silent normal playback recordings
each retained all 192,000 consecutive samples. Deliberate graph stress still
refused a repeated frame (26,496 versus 26,624). All contexts closed, tracks
ended, and browser/server processes stopped without uncaught errors. Recorder
continuity and Rust acceptance were unchanged. This characterization alone is
not a complete signed browser demo or a physical sensor result.

The subsequent original browser test was filtered to the single local-demo
check and uncaught-error check. It passed both, with one synthetic pilot and
four-second recording, real Rust/WASM/C2PA, 192,000 samples, two recovered
challenges and all eight verification checks true. `demo:true` and
`independent_requester_proven:false` remained explicit. Chromium used a null
audio output sink; no physical recording or playback occurred. One cached
core/web build took 0.45 seconds; no cooperation, Android or release build ran.
The ten generated test artifacts total 1,395,478 bytes and remain in the final
snapshot; their private checkpoint indexes originals without duplicating them.
The synthetic WAV is 397,994 bytes, SHA-256
`87b0b3e0188e62a59da02cf59b267fe651211984a1217e686f8608b91428adea`;
its unsigned demo receipt is 1,514 bytes, SHA-256
`2c28c15708a06df81da90619ffa05c80a3a69f45823209091655ae80e3330393`.
These are newly generated **synthetic** files, not yesterday's phone recording.
The owned server PID was absent afterward; there were no headless browser
processes or port-4174 listeners. No test session remains running.

Private evidence retains authentic logs, exits, per-case Rust stdout/stderr,
input hashes and the bounded fixture runner. The specific original authored
helper before-image and reviewed deployment record remain there. Initial and
corrected browser and shell results are separate files.
The original phone recordings and all previous failed evidence are untouched.
Private checkpoint and cleanup records retain the single signed-demo result,
exact source/artifact references and verified cleanup.
The initial local-only phase started no USB helper or phone sensor session.
After owner readiness confirmation, the saved-file transfer below ran without
a new phone sensor session.

Source base is `8c383bf3450c5d629d384a4e469acb524553d33b`, dirty:
initial snapshot `/tmp/nonverba-unified-source/b36696ef91b0489ba61852fb098b143a`,
archive SHA-256
`6846d1951a145f872c710a2f334bc0c00473cd244735a928fc6d9454b0c74a53`;
final production snapshot
`/tmp/nonverba-unified-source/9be6ad556bab4062bfab91a121108962`, archive
`3c6ca5a39fed93a16d56198bab27d10da626ad4c3f8d28ff4aedefc15eaeefbe`.
Two corrected test files were added under new names to that final snapshot;
its original files remain intact. Their separate hashes are retained in
`final-test-source-supplement.sha256` and are not represented as part of the
original snapshot archive. No APK or release archive was generated.

The expected native media certificate fingerprint and camera signer SPKI pin
were independently retained from prior verified records and remain private.
Native camera and audio use the same media key; the certificate fingerprint,
SPKI digest and APK signer are distinct identifiers. The expected key must not
be inferred from the new WAV/receipt. Certificate trust, hardware attestation,
physical source and independent requester acceptance remain separate claims.

### Saved phone WAV externally verified — 7 October 2026

The owner confirmed the phone connected, unlocked and focused on Non-verba.
The original approved USB helper authorized on the first check, and retained its
same loopback-only port-5038 server through retrieval. A fresh awake lease was
checked active; no lease was assumed from yesterday. Home GPS warm-up was
observed active and stopped for cleanup only.
No recording, probe, playback, camera/GPS measurement, installation or app
restart occurred. Accessibility exposed only root nodes, so three original
own-app screenshots supplied lease/cleanup evidence.

`ExportAudio` retrieved two exact cache exports: a 409,630-byte WAV and a
1,514-byte unsigned demo receipt. Their exact names, media hashes, retrieval
manifest and real-session identifier remain in ignored private evidence records.
The installed APK hash remained
`37dfbb4a6806f1ed4c65ff4b162d0e83339b14b030089781182eae69bbb94fbe`.
Both exact unsuffixed Downloads files matched original lengths/hashes in the
private saved-byte comparison record.
This establishes saved-byte presence after reconnect, not a witnessed crash/
restart recovery test, new freshness or the particular MediaStore save row.

Debian imported that explicit pair with the prior independently retained native
media certificate pin and ran the unchanged current-clock Rust CLI. Baseline
returned exit 0 with all nine checks true, including native audio metadata,
exact request/transcript/PCM binding, C2PA integrity, signing-time consistency
and signal recovery. The decoded WAV has 192,000 samples (four seconds at
48 kHz), two rounds and 118 consistent recording-configuration observations.
Both detected codes recovered 64/64 symbols. Detector scores were 0.9937677
and 0.9939163; these are detector results, not authenticity probabilities.
Alignment offsets 2,671 and 18,595 samples are not calibrated physical latency.

Wrong request, wrong key, wrong nonce, wrong PCM commitment and altered PCM
each returned exit 1 with the expected failed checks. All six cases passed.
The original WAV/receipt, retrieval manifest and existing verifier binary
remained unchanged before/after the matrix. One bounded 409,630-byte tampered
WAV control is retained; the original phone audio is not duplicated into QA.
The exact original small receipt is retained by the importer as designed.

Authentic per-case stdout/stderr, input provenance, results and their checksums
remain in ignored private QA records.

`demo:true` and `independent_requester_proven:false` remain explicit. The
receipt is unsigned same-device requester provenance, not an independent
requester's retained challenge/arrival history. Certificate trust, hardware
attestation, trusted clocks, physical sensor/acoustic origin and physical
freshness remain unproven. No successful independent acceptance was recorded.
This verifies the already signed phone WAV; it does not retroactively sign old
unsigned failure logs or settle responsibility, penalties or compensation.

Keep screen awake was turned off and GPS warm-up remained stopped in the retained
private own-app screenshot.
The dedicated USB helper then stopped; zero port-5038 listeners were confirmed.
An earlier non-elevated host listener read failed with CIM access denied and
made no cleanup claim; the final approved inspection confirmed cleanup.
The exact cleanup observation and checksum remain private.
All agent test/service sessions are closed. No new physical audio ran.
Very noisy environments, independent requester acceptance, native failure-display
coverage and the remaining physical lifecycle matrix remain open.

## Audio requester lifecycle and initial reload check — 7 October 2026

This follow-up is software-only. It uses separate synthetic requester/operator
browser contexts and keys, real WebRTC, AudioWorklet, Rust/WASM and C2PA, with a
null audio output sink. It does not establish physical acoustic origin, distinct
people or device operators, or an independent physical requester result.

The documented snapshot status check confirmed the preserved `non-verba-dev`
container running. The existing final source/build snapshot was reused:
`/tmp/nonverba-unified-source/9be6ad556bab4062bfab91a121108962/code`, base revision
`8c383bf3450c5d629d384a4e469acb524553d33b`, dirty state `1`, original archive
SHA-256 `3c6ca5a39fed93a16d56198bab27d10da626ad4c3f8d28ff4aedefc15eaeefbe`.
A comparison of 130 current authored core/web/build-input files, totalling
1,859,538 bytes, found no mismatch with that snapshot. No rebuild, new source
archive, dependency installation, APK or phone operation was needed.

The five focused `audio:` cases in `test/sensor-acceptance-lifecycle-tests.mjs`
passed, exit 0. They use actual retained Rust/WASM verification with a Node
IndexedDB/Worker double: completed transport closure and replay, compatibility
of the optional guard, cancellation/replacement/pagehide during verification,
the same changes immediately before atomic writes, and invalid acceptance
guards. This is not real-browser IndexedDB race coverage. The authentic log and
checksum remain in private QA.

The new browser case reloads a completed, locally accepted audio session and
re-verifies the original retained request, WAV, transcript, context and signed
requester receipt. Its first run passed nine preceding live integration checks,
then failed its new error-name assertion, exit 1. The reloaded Rust verdict was
actually `verified:true` and `fresh_action_eligible:true`; both original local
acceptance rows and the entire accepted store were unchanged. The WAV stayed
397,954 bytes, SHA-256
`2d93589ff7ed216b17bfdaac299870de55d77166105b436501e3cd3447a23e66`.
Duplicate acceptance and resumed delivery were refused, with zero new audio
contexts, microphone tracks, playback, requests or sealing after reload.

The failed assertion incorrectly required the public storage API to expose
`ConstraintError`. That API instead returned `Error("Evidence ledger transaction
failed.")` before the transaction error was populated. The test-only correction
observes bounded native IndexedDB request error events for the two exact replay
keys, without changing requests, handlers, default abort behavior, clocks or
policy. It retains the public error separately and requires a genuine underlying
`ConstraintError` while fresh. Production signing/storage code was unchanged.

The original failed runner is retained as
`test/audio-session-acceptance-browser.mjs`, SHA-256
`2dbb22714b3908feeaccb5eb4edfaeb25ee27d870b234306bf0991539d117787`.
The corrected supplement is separately retained as
`test/audio-session-acceptance-browser-corrected.mjs`, SHA-256
`9785de7ac1fdf3870d5e7408b97426e916921145291ada1667efcfa5588020f2`.
Neither supplement is included in the original source archive hash. Explicit
supplement and reuse records remain in ignored private QA, preserving
the failed result, actual reloaded verdict, logs, exact synthetic artifacts and
cleanup. Its owned preview PID 1064 was absent and port 4174 closed afterward.

### Corrected browser reload and replay result

The separate corrected run passed all 11 focused checks, exit 0, using Chromium
145.0.7632.6. Each run used one synthetic pilot and one four-second live recording
with two challenges. No physical microphone, speaker or phone was used.

Pairing withheld challenges until connected and refused unrelated identities.
The continuous recording, final signed WAV arrival, requester receipt return,
exact-byte retention and one-time local acceptance passed. Export verification
required separately supplied requester/operator pins and exact retained context;
import recorded no acceptance. Repeated download preserved bytes. Altered PCM,
wrong operator pin and a substituted nonce were refused by real Rust/WASM.

After requester reload, a fresh controller reverified the exact original
authority, receipt, context, transcript and WAV. `verified:true` and
`fresh_action_eligible:true` remained true without altering clocks. The WAV was
397,954 bytes, SHA-256
`96069ba1461f7a11312769a1b84ff84bf2628c325d266f552e1ebd34cb8fd9ff`, unchanged
after attempted replay. The native session-key add failed with `ConstraintError`;
the queued challenge-key add received `AbortError`. The public API refused with
its original generic error. Both acceptance rows and the entire accepted store
remained exactly unchanged. A repeated evidence delivery could not revive the
completed live session. Reload created zero audio contexts, microphone tracks,
playback, challenges or signatures; it made two actual Rust receipt verification
calls. No uncaught browser error occurred.

This verifies the existing requester controller/storage API, not automatic
restoration of the audio page's final-session export controls. Rust's signed
evidence verdict still reports `acceptance_recorded:false` and
`global_replay_checked:false`; the matching local acceptance ledger is separate.
Cleared storage, another profile/device and hidden histories remain outside
local replay protection. Separate synthetic keys/roles do not prove separate
people, physical collection, trusted clocks or hardware attestation.

Authentic corrected browser results, retained-reload verification and checksums
remain in ignored private QA records.
The initial failed evidence is preserved separately and is not counted as a
complete pass. The unsigned `completion.json` indexes 50 retained QA files,
6,737,919 bytes excluding the index itself; it does not authenticate collection.

Final Debian inspection confirmed both owned preview PIDs 1064 and 1297 absent,
connection to port 4174 refused, and no existing-runtime headless browser process.
All execution sessions and browser contexts closed. No build, dependency,
container/volume change, phone action or physical audio ran for this follow-up.

Remaining: audio-specific simultaneous first acceptance, independent requester
acceptance on physical devices, very noisy environments, native failure-display
and remaining physical lifecycle coverage. The shared real IndexedDB acceptance
race previously uses image evidence; this audio run exercises duplicate
acceptance after completion, not two concurrent first commits. The PowerShell
transport fixtures also remain unrun under the documented Debian limitation.

## Audio concurrent acceptance and lifecycle — 8 October 2026

The owner authorized closing the remaining audio work and confirmed that only
one device is available. Independent physical requester/operator trials are
deferred until a second device is available. This checkpoint needed no phone
connection, recording, playback, sensor acquisition or APK.

The original launcher started the existing pinned `non-verba-dev` container;
its identity, image, bind, named volumes, ports, GPU configuration and signer
were preserved. The public snapshot launcher created one source snapshot:
`/tmp/nonverba-unified-source/ec7fceb057a1450f8d903e9ee4f6380a`, 612 reviewed-namespace
files, base revision `8c383bf3450c5d629d384a4e469acb524553d33b`, dirty state `1`.
The evidence web build passed using the existing Debian toolchains and caches.
No Android build or package export ran.

The new maintained `code/test/audio-acceptance-browser-tests.mjs` creates one
synthetic four-second PCM fixture with two real Rust-generated challenges,
actual C2PA signing and an actual signed requester receipt. The requester and
operator fixture keys differ. There is no microphone, speaker, AudioWorklet,
WebRTC or physical-origin claim in this test. Wall and monotonic clocks are
unchanged; the fixture waits for the real clock to cover its declared span.

All six browser checks passed:

1. The complete signed synthetic audio verifies fresh, is retained identically
   in both tabs and starts with neither replay key accepted.
2. Cancelling the lifecycle guard after actual Rust verification refuses
   acceptance and leaves both keys absent.
3. Invalidating that guard between the real IndexedDB transaction's reads and
   its production handlers prevents either acceptance-key add.
4. Two tabs sharing one requester origin/identity both complete fresh Rust
   verification before either can commit. Exactly one attempt succeeds; the
   other reaches an actual `ConstraintError`. Both session/challenge rows equal
   the winning record, and retained authority, receipt, transcript and WAV bytes
   are unchanged. The test does not replace IndexedDB or the cryptographic engine.
5. Reloaded controllers reverify the same retained evidence; duplicate
   acceptance reaches uniqueness enforcement and preserves both winning rows.
   Reload/replay makes no new audio request, round, probe or signing call.
6. No uncaught browser error occurs.

The test observes request events without preventing their default handling.
Its verification gates hold actual Rust results, never substituted verdicts.
Cancellation cases exercise the production lifecycle-guard contract; they are
not physical Android pause, crash, power-loss or OS callback tests. Rust's report
still says `acceptance_recorded:false` and `global_replay_checked:false`; the
separate local ledger records the successful commit. Cleared storage, another
origin/device and hidden histories remain outside local replay protection.

The existing `sensor-acceptance-lifecycle-tests.mjs` and
`audio-pairing-ui-tests.mjs` also passed, 20/20, using actual Rust/WASM and bounded
Node DOM/Worker/IndexedDB doubles. They cover audio/location guard cancellation,
completed transport closure, replay, pre-challenge requester recreation, actual
page handlers and unsigned native failure diagnostics. The production Kotlin
lifecycle harness passed 56 checks with deterministic queues and cleanup.
These do not replace the physical acceptance matrix.

The initial browser launch selected Playwright's absent full Chromium executable
and failed before any acceptance test. The corrected run used the already
provisioned Chromium headless shell and the same built source snapshot. No
browser download, dependency install, new snapshot or rebuild was needed.
The initial failure log remains separate from the passing run. Results are
retained in the snapshot's ignored QA area, including build, initial/corrected
acceptance, audio/native lifecycle logs and browser results.

The passing browser is Chromium 145.0.7632.6. Final inspection found port 4174
closed and no provisioned-runtime headless browser process. `cleanup.json`
records artifact lengths/hashes and confirms the maintained test source matches
the tested snapshot exactly (SHA-256
`a4cfd64207552e17cb2a1baf6b28c89412fd635769c043f3fdb8f6c1349b9a46`).
The container remains running; its owned preview and test/browser sessions are
closed. The npm command alias and this documentation were added after the source
snapshot; no generated asset or production build input changed.

Run the maintained check against a built evidence web preview with
`node --run test:browser:audio:acceptance` inside the managed Debian environment.
Set `NONVERBA_TEST_URL`, `NONVERBA_PLAYWRIGHT_PATH`, `PLAYWRIGHT_BROWSERS_PATH` and
optionally `NONVERBA_AUDIO_QA_DIR` as for the existing browser checks.

No production signing, sensor policy or acceptance logic changed. Remaining:
independent physical requester acceptance (deferred for lack of a second device),
very noisy environments, native failure-display and other physical lifecycle
cases, and the previously recorded PowerShell transport-fixture runtime limit.

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

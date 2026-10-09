# Sensor implementation status

The Android and browser evidence application is a development implementation.
Its source is public under the repository license. Publishing the implementation
does not establish independent sensor authenticity, production readiness or a
new physical-device acceptance result.

| Component | Implemented boundary | Remaining limit |
| --- | --- | --- |
| Camera | Challenge-bound C2PA JPEGs, native Camera2 acquisition metadata and requester receipt/acceptance | A signature does not prove the scene, pixel origin on a compromised device or truthful wall-clock time |
| Microphone | Browser capture and native AAudio capture with fresh acoustic challenges, signed WAVs and retained requester observations | Acoustic support varies; modified clients and live external replay remain threats |
| Location | Request-bound COSE traces, native acquisition policy, raw GNSS observations and optional independently supplied navigation verification | Mathematical consistency does not establish satellite/RF authenticity or physical location |
| Key enrollment | Separate purpose-specific Android identities and independently evaluated attestation policy | Key-generation attestation does not authenticate later sensor measurements or current application execution |
| Requester workflow | Pairing before request release, complete-artifact verification, retained records and atomic local acceptance | Local ledgers do not provide global replay prevention across devices, cleared storage or hidden histories |
| Agent integration | Shared Rust verification and browser workflow adapters | A durable MCP/server workflow and its deployment trust boundaries remain separate work |

The stronger native/raw request profiles are explicit policies. Unsupported
capabilities must reject the request rather than silently switch to a reduced
profile. Legacy records retain their original signed rules.

GPS attempt reports describe a failed attempt, never a successful measurement.
Live timing diagnostics remain unsigned; covered failed attempts also retain
bounded frozen diagnostics in their separate signed report. Neither authorizes
capture. No privacy, freshness or timing rule is relaxed by
the repository unification.

## GPS failure-report checkpoint — 1 and 4 October 2026

A real-device GPS failed-attempt report was exported on 1 October before the
owner paused physical work. On 4 October, the public Rust/WASM verifier checked
its signature, independently retained request and trusted key. Its signed
terminal duration is 60.047 seconds with zero raw callbacks. The original
Downloads copies matched, and fresh native exports preserved the exact report,
request, timing and counters across a retry and page reload. Tampering, wrong
request/key and substitution with successful location proofs were refused.

The single fresh quiet retry stopped when Android reported raw-GNSS support as
unavailable, before samples or raw callbacks arrived. At that earlier checkpoint,
the failure class was outside the signed-report scope; it produced no new signed report and
preserved the earlier one. This OS status does not establish a hardware fault
or physical cause. Neither attempt establishes a successful GPS measurement,
accepted evidence or preparation speedup. The
[GPS attempt-report guide](GPS_ATTEMPT_REPORTS.md) describes the separate failure
format; [GPS preparation](GPS_PREPARATION.md) explains the timing boundaries.
The [dated validation](VALIDATION.md#gps-attempt-report-follow-up--4-october-2026)
records completed checks and remaining physical limits. The two-second minimum
observation span and existing collection deadline were unchanged.

Physical microphone playback, recording and calibration remain on hold and
require separate explicit owner authorization before resuming. Publishing the
source and reorganizing the repositories do not resume physical sensor work.
Earlier device records are retained outside this public source tree.

## GPS acquisition diagnosis — 4 October 2026

A later authorized quiet attempt also stopped with Android raw-measurement
status 0 before callbacks arrived. Read-only receiver diagnostics showed GPS
navigation running while the current top-level HAL capability mask omitted
raw measurements. This identifies a current OS-advertised blocker, not a proven
physical cause or permanent hardware limitation; the earlier raw trace remains
valid. Misleading permanent-unsupported and zero-callback timeout messages were
corrected in source. Forty-nine focused checks and Android Kotlin compilation
passed; at that diagnosis checkpoint no updated APK was installed and GPS
acquisition was not fixed.
The [diagnosis record](VALIDATION.md#gps-callback-diagnosis--4-october-2026) records
the evidence and limits.

After the owner restarted the stationary phone, Android advertised raw
measurements again. One fresh request on the unchanged APK produced a proof
that passed independent Rust/WASM verification against the pre-collection
original and previously trusted key. Its signed native session duration was
5,713 ms, with three fixes spanning 2,001 ms and four raw epochs. This confirms
recovery for that attempt without weakening the two-second minimum or any
policy. The initial receiver failure's cause and recurrence remain unresolved;
no permanent software fix or speedup is established. See the
[restart comparison](VALIDATION.md#gps-restart-comparison--4-october-2026).

## GPS reporting and retention checkpoint — 4 and 5 October 2026

The installed update covers raw-GNSS startup status 0 and includes clearer
diagnostics. A normal GPS proof and a separate phone-signed policy-rejection
report passed independent verification. The rejection used an explicitly fresh,
intentionally strict request; actual native observations were retained and
successful-measurement acceptance remained false. All three debug reporting
faults passed on the phone: signing, initial storage and final storage. These
are simulated finalization failures, not evidence of actual hardware or storage
outages; sensor observations and normal policies were unchanged.

A controlled app restart recovered three retained records byte for byte and the
final-write-fault attempt's earlier unsigned pending record. Exact comparison
of that pending snapshot with its pre-restart signed report exposed a one-ULP
JSON floating-point parsing difference. The failed check and original artifacts
were preserved. The already pinned `serde_json` now enables `float_roundtrip`;
245 core tests plus JNI/WASM and legacy compatibility checks passed. The phone
was disconnected before installation and the affected physical recheck on
4 October.

On 5 October the corrected package was installed and verified on the phone.
A fresh intentionally strict request caused actual native policy rejection;
the simulated final-write fault left a separately verified signed report in
memory and an earlier unsigned pending record in the journal. The signed
terminal attempt duration was frozen at 5,514 ms, with one raw callback/epoch
and zero eligible fixes. Successful-measurement acceptance remained false.
After a verified app process restart with the same APK and a new process ID,
five retained records were retrieved. The new pending snapshot matched its
pre-restart signed snapshot exactly, including floating-point values; prior
records retained their exact bytes. The initial-write-failed memory-only outcome
remained absent as expected. Controlled restart does not demonstrate recovery
from a crash during collection, writing or signing, or power-loss durability.

Naturally occurring status-0 report production on this phone remains
unverified. The receiver's original failure cause, recurrence and permanent
recovery remain unknown; the successful attempts do not establish a completion
time guarantee. See the [5 October exact retention recheck](VALIDATION.md#gps-exact-retention-recheck--5-october-2026)
and [4 October reporting validation](VALIDATION.md#gps-startup-and-reporting-validation--4-october-2026)
for the separate software, installed-package and physical results. No audio ran.

Start with [the evidence app guide](README.md),
[complete sensor policies](COMPLETE_SENSOR_PACKAGES.md),
[attestation verification](KEY_ATTESTATION_VERIFIER.md) and
[the security model](SECURITY.md). The [validation guide](VALIDATION.md) and
[physical acceptance checklist](DEVICE_ACCEPTANCE.md) distinguish software
checks from evidence obtained on an actual device.

## Camera quality guidance — 5 October 2026

The independent Rust module now measures delivered-JPEG resolution, exposure
distribution and regional sharpness indicators, with fixed regions and an
optional subject region. The browser verifier workspace can inspect and export
its separate unsigned guidance record. Uniform or unmeasurable texture and
insufficient samples remain explicit outcomes. There is no universal focus or
usability threshold, signed quality-contract enforcement or acceptance change.

Off-device validation passed 22 focused Rust tests, 16 adapter tests, exact
native/WASM comparison of 24 image/profile cases plus signed-photo substitution
separation, and six actual Chromium/Worker UI checks. The corpus includes all
eight orientations, grayscale, odd color subsampling, progressive JPEG and an
actual software-signed synthetic C2PA output. No physical sensor or phone was
used. Calibration, broader device/decoder agreement and installation on the
phone remain unverified. See [camera quality guidance](CAMERA_QUALITY.md) and
the [dated results](VALIDATION.md#camera-quality-guidance--5-october-2026).

A subsequent authorized single-photo check passed with the already verified
installed app: one 3000 × 4000 signed JPEG verified against its retained original
challenge and the previously trusted camera key, and native Rust/WASM quality
reports matched exactly off device. Wrong request/key and unsigned quality-record
substitution were rejected. The new quality UI is still not installed on the
phone; calibration remains separate. The camera preview ended, GPS preparation
and the awake lease were off, and the dedicated USB helper was closed. See the
[one-photo record](VALIDATION.md#one-photo-camera-quality-compatibility--5-october-2026).

Nine additional browser checks reused the saved full-size JPEG through the
actual quality panel and Worker. Complete and selected-region results, exact
exports, edge/invalid-region handling, unchanged image bytes and absence of
sensor/signing/acceptance activity passed. No further phone operation was needed.
See the [delivered-photo browser checks](VALIDATION.md#delivered-photo-browser-quality-checks--5-october-2026).

A new camera-quality APK was built and independently inspected on 5 October;
the package retains the established signer and its quality UI/engine assets match
the tested artifacts exactly. A narrow separate USB quality-report retrieval
action was prepared. Installation and live phone report retrieval remain pending
the owner's fresh device-readiness reply; no new capture is planned. See the
[deployment preparation](VALIDATION.md#camera-quality-phone-deployment-preparation--5-october-2026).

The prepared update was subsequently installed and its exact APK hash verified.
The owner selected the already saved 3000 × 4000 JPEG; Android's quality panel
analyzed it and saved one unsigned report. The approved USB helper retrieved the
27,679-byte export, and the existing Debian verifier confirmed complete equality
with retained native Rust and WASM results, including exact exported bytes.
No new photo, audio, evidence signing or successful acceptance was invoked.
GPS preparation and the awake lease were verified off and the dedicated helper
was stopped. See [the phone result](VALIDATION.md#phone-quality-panel-and-saved-jpeg-export--5-october-2026).
PowerShell parser negative tests remain unrun; the live retrieval covers its
positive path. Reading-fidelity calibration remains deferred. The owner wants
one unified requester quality value, with the blur algorithm still undecided;
see [the hardening notes](../notes/sensors/SENSOR_QUALITY_NOTES.md).

## Microphone lifecycle and assertion hardening — 6 October 2026

Cancelled browser setup now settles without waiting for a permission or audio
initialization promise. Late microphone grants are stopped. Native permission
waits and rejected queues end explicitly within the original request window and
existing session lifetime; terminal status timing freezes and remains unsigned.
Cleanup preserves unresolved resource ownership, retries failed callback
unregistration and wipes unsigned media. Rust verifies one exact audio assertion
and one exact native-acquisition assertion, refusing duplicates and lookalikes.

Focused JavaScript, Rust, JNI, Kotlin lifecycle and WASM checks passed. The real
browser cancellation/retry check passed with synthetic input and a null output
sink. A full synthetic browser demo failed on a repeated render frame, correctly
aborted, and retained its failure record; its cause remains unresolved. The
corrected Android package built, passed lint and independent package inspection,
with the established signer and the exact tested web assets. The package was
subsequently installed on the owner's Cat S62 Pro; the USB helper confirmed its
exact APK hash. One authorized local-demo start was refused before acquisition
because media volume was non-positive or Android reported the microphone muted.
The combined error does not distinguish those conditions. No AAudio streams,
pilot, challenge or signed WAV resulted from this path.

The refusal is retained as a pre-acquisition readiness check. Physical microphone
capture, speaker support and signing remain unverified; a subsequent check needs
positive media volume and an unmuted microphone. This does not complete the independent
requester, route/privacy, long-duration or crash/restart acceptance checklist.
Signed microphone failed-attempt reports and calibrated audio quality remain
future work. See [the dated results](VALIDATION.md#microphone-lifecycle-and-assertion-hardening--6-october-2026).

The owner authorized one retry after confirming non-zero media volume and
disconnected headphones. That start passed the earlier readiness check but was
refused because Android's reported microphone client format differed from the
strict AAudio contract. No completed WAV resulted; the actual differing fields
and stopping phase were not retained by that error, so the cause remains open.
Headset fallback remains unsupported and actual built-in route IDs are checked.
Both phone controls were subsequently verified off and the USB helper closed.
See [the retry checkpoint](VALIDATION.md#microphone-format-rejection-on-owner-authorized-retry--6-october-2026).

## Microphone input-format correction — 6 October 2026

The app now requests standard AAudio input performance to avoid Android 11's
legacy low-latency PCM16-to-float client conversion path. Output remains low
latency; all existing successful-evidence requirements remain enforced. This
addresses a plausible app-selected conflict; the earlier phone's exact differing
format was not retained. Separate mute/volume errors and bounded unsigned
diagnostics now retain last observed actual formats, phase and frozen timing
across retries in the open page, with a separate JSON save control.

Focused adapter, recording-guard, lifecycle, genuine signed-format and actual
page-handler checks passed. The rebuilt package passed lint and independent
inspection with no gaps, and its installed phone bytes matched. USB disconnected
before the corrected update's single authorized audio attempt started. Physical
microphone/speaker completion remains unverified. See [the correction record](VALIDATION.md#microphone-input-format-correction--6-october-2026),
including the preserved initial cache-freshness refusal and transport interruption.
At the disconnection checkpoint all software sessions and the dedicated USB
helper were closed; phone control cleanup remained unverified, with the awake
lease last on.

After reconnection, one authorized pilot reached 96,000 samples with actual
AAudio input/output at 48 kHz mono float and the intended built-in device IDs.
It stopped after an unsigned 2,484 ms because its acoustic challenge was not
recovered within policy. The error does not distinguish an undetected marker
from one detected too late. The format refusal was avoided for this attempt;
the complete microphone/speaker recording flow still did not pass. No signed
WAV or receipt completed. Phone awake/GPS controls are now
confirmed off and the USB helper closed. See [the pilot result](VALIDATION.md#microphone-pilot-after-format-correction--6-october-2026).

The subsequent software follow-up retains the last Android recording
configuration before pilot teardown and returns bounded Rust detector metrics.
It distinguishes `not_detected` from `detected_late`, preserving the exact
two-second pilot, detector thresholds and 800 ms start limit. These are unsigned
diagnostics; even `passed` means only pilot readiness and grants no successful
measurement acceptance. Synthetic signal, lifecycle, JNI and page checks passed,
as did the Android build, lint and independent package inspection. One package
was produced and remains in the existing container snapshot; it has not been
installed. No phone or audio test ran during this follow-up. Real pilot failure
cause, complete microphone/speaker support and exact saved phone diagnostics
remain unverified. See [the software checkpoint](VALIDATION.md#microphone-pilot-diagnostics--software-follow-up-6-october-2026).

## Microphone pilot inspection — 6 October 2026

Further silent inspection reproduced a detector-selection bug: a very faint
repeat could hide a valid timely pilot marker. Native readiness now retries
selection among qualifying peaks only when ordinary detection fails. The full
two-second window, signal thresholds and 800 ms limit remain unchanged; every
original detected-late refusal and successful signed-audio verification retain
their previous behavior. The stronger late-repeat ambiguity remains open.

Waveform generation now precedes recording, avoiding preparation work inside
the short capture window. Unsigned failure diagnostics preserve the pilot's own
last observed record/input/output callback timing, independently of later
evidence streams. Callback completion does not establish physical sound.

Rust, adapter, real JNI, actual page-handler, Android build/lint and independent
package checks passed. The corrected package remains inside the container and
has not been installed. No phone, recording, playback or USB session ran during
this inspection. The saved phone attempt's physical failure cause, the fallback's
runtime on that phone and a complete accepted native microphone recording remain
unverified. Native stop/close error reporting and the earlier full synthetic
browser-demo failure also remain open. See [the inspection record](VALIDATION.md#microphone-pilot-selection-and-callback-inspection--6-october-2026).

## Microphone phone result and transport correction — 6 October 2026

One owner-authorized local demo ran after installing the independently verified
update. Its pilot passed and the collector reported all four seconds of samples.
The WebView then stopped with `Invalid native microphone response.` before a
receipt or signed WAV completed. This establishes readiness and collection
counts for that attempt, not successful measurement acceptance. Pilot timing
remained attached to its original input stream; exact saved phone JSON and
persistence remain unverified.

Silent tests reproduced an Android JSON/Base64 response-size bug and a shared
decoder stack overflow. Both are corrected in source, keeping the same decoded
limits, identities and successful-evidence rules. All 149 focused microphone,
location, camera and GPS-attempt adapter checks passed. Both prior failing runs
remain preserved. The correction has not been packaged or installed; complete
native recording and independent requester acceptance are still pending.

No second phone start ran. Audio, GPS warm-up and Keep screen awake were stopped,
and the dedicated USB helper closed with zero port-5038 listeners confirmed.
See [the phone record](VALIDATION.md#microphone-phone-pilot-and-transport-rejection--6-october-2026)
and [the source correction](VALIDATION.md#microphone-json-and-base64-transport-correction--6-october-2026).

## Corrected microphone package installed — 6 October 2026

The transport/decoder corrections were built and independently verified with
no package gaps; six fresh actual page-handler checks passed. The original USB
helper installed exact APK hash
`f4fe13da976b9063068fc1c029a5ced7880cee5e1092b9b5d0fe1d0a651bcb08`.
No audio test started: Android's notification shade interrupted the launch
preflight. The owner must return to unlocked Non-verba before the single local
demo can continue. The pending launch and dedicated helper are closed, with
zero port-5038 listeners confirmed. Awake/GPS control cleanup after the update
remains unverified because the helper cannot operate another window.
See [the installed-package checkpoint](VALIDATION.md#microphone-corrected-transport-package--6-october-2026).

## Microphone collection reached sealing — 6 October 2026

One authorized local demo on the corrected installed package passed the pilot,
collected all four seconds and delivered both chunks. It stopped at Rust's
per-round acoustic check before signing, with no accepted WAV. The failed
attempt's 7,121 ms duration stayed frozen on later reads. Its exact refused
round remains unknown because round metrics and released PCM were not retained.

A silent two-fixture characterization reproduced a possible selection problem:
a faint later repeat can hide a valid timely marker from the unchanged generic
PCM16 detector, while pilot readiness still passes. This is a synthetic result,
not proof of this phone's cause. Acceptance rules remain unchanged.

The phone session is stopped, Keep screen awake is verified off, and the USB
helper is closed with no listener. GPS work remains closed; its home warm-up
was managed only for cleanup, and the audio document's existing native lifecycle
excludes it. See [the phone and synthetic results](VALIDATION.md#microphone-corrected-transport-phone-result--6-october-2026).

The software follow-up now retains each recording round's actual canonical
PCM16 detector result before refusal, without retaining audio or changing
successful acceptance. Reports stay bounded, unsigned and attached to the
original failed attempt; even all-passed metrics cannot become a successful
recording. Rust, adapter, real audio-only JNI and page-handler checks passed,
as did compilation of the controller against the existing Android SDK.
No new APK or phone recording ran for this follow-up. The diagnostics have not
been installed or exercised on Android; the exact phone cause and a complete
accepted microphone recording remain open. See [the software validation](VALIDATION.md#microphone-sealing-round-diagnostics--software-follow-up-6-october-2026).

## Microphone local demo passed on the diagnostic update — 6 October 2026

The verified diagnostic package is now installed. One authorized phone demo
passed its pilot, completed four seconds with two challenges, and displayed a
locally verified signed WAV. Both WAV and demo-receipt saves displayed success
notifications. This demonstrates one complete local demo; the earlier failed
attempt's cause and consistent reliability remain unresolved. Successful
acceptance rules were unchanged.

Exact saved WAV/receipt retrieval and external verification remain unverified,
as does independent requester acceptance. The successful run did not exercise
the new failure-report display/retention branch on Android. Those gaps remain
explicit; no further phone retry or recorded-audio playback ran. Keep screen
awake is verified off, GPS warm-up was stopped before Audio, and the USB helper
is closed with no listener. See [the package and phone record](VALIDATION.md#microphone-diagnostic-package-and-successful-local-phone-demo--6-october-2026).

Pending: test microphone challenge detection and honest refusal in very noisy
environments. Prefer offline fixtures before bounded device checks, then use the
results to decide whether changes are needed. This follow-up is deferred; no
controlled noisy-environment result or calibrated noise limit is claimed.

## Saved audio demo export and browser follow-up — 7 October 2026

Bounded saved-demo USB retrieval and a Debian importer are implemented. Importer
tests passed 49/49; two retained synthetic WAVs verified in the existing Rust
CLI, and five altered-input cases were refused. The corrected Linux shell
transfer checks passed 9/9. PowerShell transport fixtures remain unrun because
the managed Debian environment has no PowerShell runtime; no host project tests
were used. The subsequent quiet phone transfer retrieved yesterday's exact WAV
and unsigned demo receipt, and both public Downloads copies matched their
original hashes. External Rust verification passed all nine checks against the
separately retained native media certificate pin. Wrong request/key/nonce/PCM
commitment and altered samples were refused; original bytes stayed unchanged.

The silent browser interruption was reproduced and narrowly corrected by keeping
ended speaker nodes attached until capture closes, with bounded retention.
Three fresh normal synthetic recordings completed all four seconds; deliberate
graph stress and the exact repeated-frame regression still refused completion.
All contexts, tracks and test processes closed. The recorder and Rust acceptance
rules remain strict. No new phone recording, playback, GPS measurement, camera capture
or APK ran for this follow-up. The subsequent single full browser demo also
passed with real Rust/WASM/C2PA, two recovered challenges and all eight checks
true; its synthetic WAV remains labelled as a local demo. No test sessions
remain running. Noisy-environment and independent requester validation remain
open.

This was a saved-file check: no new physical recording, probe, playback or APK
installation ran. The original WAV has 192,000 samples and both challenges
recovered 64/64 symbols. It remains a local demo with unsigned requester
provenance and no independent requester acceptance or physical authenticity
claim. The observed fresh awake lease was turned off afterward, home GPS
warm-up was stopped for cleanup only, and the dedicated USB helper closed with
zero port-5038 listeners. The phone can be disconnected.

See [the exact-file and browser checkpoint](VALIDATION.md#audio-saved-demo-export-and-silent-browser-correction--7-october-2026).

## Audio requester retention and replay checks — 7 October 2026

The separate requester/operator software flow passed 11 focused real-browser
checks with distinct synthetic keys, real WebRTC, AudioWorklet, Rust/WASM and
C2PA. The five focused audio lifecycle/acceptance-guard checks also passed.
The exact completed WAV, original authority, signed receipt, transcript and
context survived requester reload and fresh re-verification. Duplicate
acceptance reached the real IndexedDB unique-key rejection; both original
acceptance rows stayed unchanged, and completed delivery could not resume.
Reload started no new recording, playback, challenge or signing.

The new regression test preserves an initial failed error-name assertion and
its corrected passing run separately. No production signing/storage change was
needed. All checks ran in the existing Debian environment with silent synthetic
input and reused build outputs. No phone action or physical audio ran; preview,
browser and test sessions are closed.

These establish software integration and local replay protection. Physical
independent-requester acceptance, audio-specific concurrent first acceptance,
very noisy environments and the remaining native/physical lifecycle matrix
remain open. Reload inspection uses the existing controller/storage API; it
does not restore the final-session export UI or resume live collection.
See [the lifecycle and reload evidence](VALIDATION.md#audio-requester-lifecycle-and-initial-reload-check--7-october-2026).

## Audio concurrent acceptance and lifecycle checkpoint — 8 October 2026

Six focused browser checks now cover first acceptance of actual signed synthetic
audio in two tabs sharing the same requester ledger. Both tabs finish fresh
Rust/WASM verification while both acceptance keys are absent. Exactly one
transaction commits the session and challenge records; the other reaches the
real IndexedDB unique-key refusal. Both records, original authority, signed
receipt, transcript and exact WAV remain unchanged after reload and replay.
Cancellation after verification and inside the actual transaction also leave
both acceptance keys absent. The existing 20 requester/page-handler tests and
56 native lifecycle checks passed in Debian.

This closes the audio-specific software concurrency gap. It uses synthetic PCM
and separate temporary signing keys, with no physical microphone or speaker.
No production acceptance change, APK, installation or phone operation was needed.
The owner has one available device, so physical requester/operator trials are
deferred until a second device is available. Very noisy environments, native
failure-display on the phone and the remaining physical lifecycle matrix remain
open. See [the validation record](VALIDATION.md#audio-concurrent-acceptance-and-lifecycle--8-october-2026).

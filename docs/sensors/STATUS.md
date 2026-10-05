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

# Sensor quality control — notes for later consideration

Recorded: 28 September 2026.

Status: discussion proposal, with failure/attempt reporting prioritized by the
owner on 30 September 2026. The bounded [native GPS attempt-report version 1](../../sensors/GPS_ATTEMPT_REPORTS.md)
was implemented on 1 October; it covers raw-GNSS policy rejection and the existing
collection timer expiring with zero raw callbacks. The
remaining quality proposals do not establish implemented features or calibrated
thresholds. Historical unsigned logs remain unsigned.

On 5 October the first [camera quality guidance module](../../sensors/CAMERA_QUALITY.md)
implements resolution, exposure distribution and regional sharpness inspection
of delivered JPEGs in Rust and WASM. Its separate unsigned report retains the
image hash and analysis profile. Calibration, enforced signed quality contracts,
movement evidence and simultaneous multi-camera capture remain proposals.

On 5 October the owner requested one unified user-facing quality value, with
one underlying algorithm. The proposed optional request argument is minimum
sharpness on a 0–100 scale, with higher values demanding a sharper image. The
algorithm remains deliberately undecided and implementation is deferred. Metric
versions and processing settings should be managed internally, rather than
presented as extra requester choices. The current guidance module and acceptance
rules are unchanged.

Published candidates include the [Crété-based blur-effect scale](https://scikit-image.org/docs/stable/api/skimage.measure.html#skimage.measure.blur_effect)
and [CPBD](https://ivulab.asu.edu/software/cpbd/). This is research for later work,
not selection of an algorithm or a calibrated threshold. Before enforcing the
single value, validate it against actual reading of representative text/digits,
including subject size, glare, noise, compression and sharp backgrounds. A blur
score is not a percentage of readable characters. Keep unassessable results
explicit and bind any future requirement to the original signed request before
collection. Quality failure alone does not establish responsibility.

## Purpose and fairness

Add simple, stable, deterministic measurements that help operators collect useful
evidence and help requesters judge whether it meets their task requirements.
Start with photographs, then reuse the policy and reporting structure for audio
and location.

Quality control creates risks for both parties:

- A requester could impose impossible requirements or penalize an operator for
  environmental conditions, device limitations, or inaccurate quality estimates.
- An operator could exploit weak quality metrics to submit technically passing
  evidence that does not answer the task, such as a sharp background surrounding
  an unreadable subject.

Keep three judgments separate:

1. **Integrity:** the evidence matches the original request and has not changed.
2. **Usability:** the evidence is adequate for this particular task.
3. **Responsibility:** what the evidence establishes about the cause of failure.

An authentic measurement may be unusable without establishing operator fault.
An inadequate result may still be declined for the requested use. Compensation
for an attempted measurement and consequences for demonstrated noncompliance
should follow separate, previously agreed rules. A quality failure alone must
not automatically become an accusation or misconduct penalty.

## Camera: practical initial checks

| Check | Candidate deterministic method | Interpretation and limits |
| --- | --- | --- |
| Resolution | Image dimensions and pixels covering an agreed subject region | A task-specific minimum can be enforced; image dimensions alone do not establish useful subject detail. |
| Exposure | Fractions of near-black and near-white pixels, measured by region | Flags potential lost detail. Darkness, bright surfaces and highlights can be legitimate scene content. |
| Sharpness | Local gradient strength, such as Tenengrad, at several scales | A blur indicator where sufficient texture exists; not a universal focus verdict. |
| Detail availability | Distribution of edges across the image and subject region | Distinguishes low measurable detail from a confident sharpness assessment. |
| Camera movement | Short preview-frame comparisons and native gyro observations around exposure | Supports a shake warning. Movement estimates have uncertainty and do not establish image usability by themselves. |

These checks need no machine learning. Deterministic calculation does not imply
universal diagnostic accuracy. A sharp plain wall can have a low sharpness score.
Noise, sharpening or a detailed background can inflate a score while the intended
subject remains blurry. Focus-measure performance depends on imaging conditions,
including noise, contrast and saturation.

Use regional measurements and an explicit **insufficient texture to assess**
outcome. Avoid adopting an arbitrary universal threshold such as “Laplacian
variance below 100 means failure.” Calibrate thresholds against representative
tasks, devices and processing conditions before enforcing them.

Android autofocus state, lens state and exposure metadata can support the pixel
analysis. These observations do not replace examination of the delivered image
or prove that the intended subject is in focus.

Distinguish shake during exposure from poor framing. A single photograph
generally cannot establish how much the camera moved. Preview frames and gyro
data provide additional evidence. Framing requires a task-specific description
of what must be visible. A sharp background does not make an unreadable meter or
serial number acceptable.

## Camera: simultaneous capture from all cameras — future consideration

For later implementation, photo measurements should retrieve captures from all
cameras on the device at once, including front, rear and additional physical
cameras. Treat these images as one measurement attempt, bound to the same request,
with each image retaining its camera identity, capture timestamp and quality
assessment.

Evaluate concurrent capture and synchronization support before implementation.
Record actual timing differences and any camera that is inaccessible, unsupported
for concurrent capture or fails, with the available reason and diagnostics.
Sequential captures or a subset of cameras must not silently count as a complete
simultaneous capture. This is a proposal for later consideration, not an
implemented feature.

## Audio: recording defects and environmental conditions

On 6 October, microphone hardening addresses cancelled browser setup, native
permission/queue deadlines and teardown recovery, and exact unique C2PA assertion
selection. Native terminal status timing is frozen but unsigned. This is not a
signed microphone failure-report format or a calibrated audio-quality score.
The [native audio guide](../../sensors/NATIVE_AUDIO.md) describes the implemented
boundary; [validation](../../sensors/VALIDATION.md) keeps software results and
remaining physical tests separate. Device work is prepared only after silent
container checks, with the owner connecting the phone for a bounded test. The
first authorized phone demo start was refused before opening audio streams:
media volume was non-positive or Android reported microphone mute. Its combined
message does not identify which condition failed. The installed update and
refusal are retained; physical capture and speaker support remain unverified.

Headphones also need an explicit evidence boundary. The current native audio
profile requests the built-in microphone and speaker by their exact Android
device IDs and checks the actual AAudio IDs before starting streams and during
capture. Wired, USB and Bluetooth microphones/headphones are not a supported
fallback. An attached accessory alone does not establish the route used, and
the USB debugging cable is not itself an audio accessory. The current test
instructions ask the operator to disconnect audio accessories.

Keep wired/USB/Bluetooth connection, disconnection and actual route substitution
on the pending device checklist. A future headset profile would need to state
which microphone and output produced the evidence and validate its acoustic
challenge path separately. The 6 October format fix adds distinct media-volume
zero and microphone-mute reasons. The older installed combined readiness error
does not identify which condition failed. Neither that error nor a connected
headset establishes hardware fault or operator responsibility.

The owner's headphone-free retry passed the earlier mute/volume gate but failed
the Android recording-configuration client-format check. The error did not
retain actual rate, channels, encoding or stopping phase. Preserve those bounded
values alongside the AAudio-reported format before another diagnostic attempt;
do not relax the guard or infer hardware incompatibility from this message.
The failed outcome is retained and phone cleanup was verified complete.

The next correction requests standard input performance while retaining
low-latency output and every strict format/collection requirement. Android 11's
legacy low-latency input implementation can use an underlying PCM16 client while
delivering float AAudio callbacks; this is a plausible app-selected cause, not
proof of this phone's unrecorded values. Bounded, explicitly unsigned diagnostics
now preserve actual client/device formats, last observed AAudio values and phase,
frozen timing and unavailable values. They are retained across retries in the
open page and can be saved separately; they give no successful-measurement credit.
Software and subsequent device results belong in the validation record.

The reconnected-phone check reached the two-second pilot with 48 kHz mono float
AAudio input/output on the selected built-in devices, but failed the acoustic
pilot policy after an unsigned 2,484 ms. The complete recording flow still does
not pass. One attempt only was used, and awake/GPS controls and the USB helper
were closed afterward. That pilot error combined missing detection with
detection after 800 ms; the physical/acoustic cause remains unknown.

The software follow-up now implements these diagnostic boundaries:

- Preserve the monitor's bounded Android configuration before pilot teardown,
  retaining its original observation time, input session and stream phase.
- Distinguish not-detected and late-marker refusal and retain bounded detector
  score, matched symbols, RMS, band ratio and offset, without retaining raw PCM
  or changing thresholds.
- Synthetic timing, silence, wrong nonce, filtering and low-signal tests, plus
  configuration retention after detachment, frozen timing and retry isolation.

These remain unsigned diagnostics. A passed pilot gives no successful-measurement
credit; signing and requester acceptance still require the complete evidence.
Physical detection on the phone and exact saved JSON retrieval/durability remain
open. The unchanged marker's actual playback/capture response is uncalibrated;
synthetic filtering failures cannot identify the phone's physical cause.

Further inspection found pilot recording started before native waveform
generation. Preparation now precedes record/enqueue, preserving the original
800 ms policy and two-second collection. Existing native callback timing and
completed pilot output-round details are retained separately as unsigned last
observations; completion means samples supplied to callbacks, not proven sound.

Five silent synthetic JNI cases reproduced a selection defect: a valid noisy
timely marker passed alone, but an extra clean repeat could hide it behind a
sub-RMS or late peak. A pilot-only bounded fallback fixes the sub-RMS case by
selecting the highest-ranked qualifying peak across the full pilot, then applying
the original 800 ms limit. Original detected-late refusals stay unchanged. A
deadline-clipped search could accept a late marker's rising flank and was rejected
during review before tests or packaging. This does not establish why the saved phone
attempt failed. Generic detection and successful signed WAV verification remain
unchanged; their multiple-peak selection and the stronger late-repeat ambiguity
remain open for separate policy/compatibility work. Native C++ also discards
stream stop/close return codes; honest reporting of those errors remains open,
with no observed close failure.

The conservative fallback, retained callback diagnostics, real-JNI regression,
adapter/page tests and Android package checks passed in the existing container.
No phone or audio test ran in that inspection; the package remains uninstalled.
See the [dated validation](../../sensors/VALIDATION.md#microphone-pilot-selection-and-callback-inspection--6-october-2026).

The later owner-authorized single local demo passed pilot readiness and reached
four seconds of retained native samples, but the WebView refused its response
before a receipt or signed WAV completed. Silent regression tests reproduced
an Android JSON/Base64 size bug and then a shared decoder stack overflow. Both
are corrected in source with unchanged decoded limits and acceptance rules;
149 focused transport checks passed. This correction has not been packaged or
installed, so a complete native recording remains pending. Saved phone JSON
bytes/durability, independent requester acceptance and the earlier full
synthetic browser-demo failure remain unverified. All phone controls and the
USB helper were closed. See [the phone result](../../sensors/VALIDATION.md#microphone-phone-pilot-and-transport-rejection--6-october-2026)
and [the silent transport correction](../../sensors/VALIDATION.md#microphone-json-and-base64-transport-correction--6-october-2026).

The already released pilot samples cannot be recovered from this attempt's
diagnostic record. The app's JSON-save control was invoked, but exact saved-file
retrieval/durability remains unverified; the current USB helper has no audio
diagnostic retrieval action. Do not treat screenshots or operator transcription
as an exact native export or a signed attempt report.

On 6 October the installed transport correction let one authorized phone demo
pass pilot readiness, retain all four seconds and reach sealing. Rust refused
the recording's per-round acoustic check before signing. The pilot's successful
metrics cannot establish that both later recording rounds passed. Their exact
metrics and released PCM were unavailable; the physical cause remains unknown.
A silent canonical-PCM16 characterization reproduced a selection limitation in
which a faint late repeat hides a valid early noisy marker, while pilot readiness
still passes. Do not assume that synthetic fixture describes this phone.
See [the phone and characterization record](../../sensors/VALIDATION.md#microphone-corrected-transport-phone-result--6-october-2026).

The software follow-up retains bounded unsigned per-round detector metrics from
the actual canonical PCM16 sealing pass before PCM release. This identifies
which round refused and whether its selected marker failed detection or the
800 ms start limit without adding recording retention, a signature, or an extra
detector pass. Rust, adapter, real audio-only JNI and actual page-handler checks
passed; Android controller compilation passed. The change is not packaged,
installed or physically exercised. It cannot recover the prior phone's missing
metrics or establish its cause. See [the diagnostic validation](../../sensors/VALIDATION.md#microphone-sealing-round-diagnostics--software-follow-up-6-october-2026).

Later on 6 October, the verified diagnostic package was installed and one
authorized phone demo completed four seconds with two challenges and a locally
verified signed WAV. Both save controls displayed success notifications. This
demonstrates one working local demo under the unchanged acceptance rules; it
does not explain the earlier failures or establish consistent reliability.
The successful attempt did not expose a failure report, so Android round-report
retention/display remains unverified. Exact saved WAV/receipt bytes, external
verification, restart durability and independent requester acceptance remain
pending. No second recording or recorded-audio playback ran, and the awake lease
and dedicated USB helper were closed. See [the successful local check](../../sensors/VALIDATION.md#microphone-diagnostic-package-and-successful-local-phone-demo--6-october-2026).

**Pending validation: very noisy environments.** The successful local demo does
not establish performance around loud traffic, music, machinery, wind or
interference near the probe frequencies. No calibrated environmental noise limit
or success rate has been measured. Prefer offline fixtures before a small,
focused device check; decide whether changes are needed after reviewing those
results. This validation is deferred.

The 7 October follow-up prepares exact saved-demo WAV/receipt retrieval and
independent Rust checking, with separate unsigned-receipt provenance and a
previously retained media-key pin. Importer, Rust altered-input and Linux transfer
guard checks passed. The subsequent saved-phone transfer and external Rust
verification passed: all nine checks true, both 64-symbol challenges recovered,
and five altered-input controls refused. Original WAV/receipt and public
Downloads copies match exact hashes. No new physical audio ran; cleanup is
verified. The unsigned demo receipt still provides no independently retained
requester history or acceptance. Silent Chromium
testing also reproduced an interrupted render-frame sequence; bounded retention
of ended playback sources corrected three normal runs while deliberate
interruptions still refused. The subsequent full synthetic browser demo passed
real Rust/WASM/C2PA verification with both acoustic challenges. This does not
measure physical acoustic quality or establish noisy-environment performance.
See [the dated results](../../sensors/VALIDATION.md#audio-saved-demo-export-and-silent-browser-correction--7-october-2026).

The next 7 October software check passed the separate synthetic requester/operator
flow, exact retained evidence after reload and real local duplicate-key refusal:
11 browser checks plus five lifecycle checks. It started no new physical audio.
The initial failed test assertion and corrected run remain separate records;
production signing/storage and freshness rules were unchanged. This covers
controller/storage inspection, not resumed live collection or restored export
controls. Physical independent-requester acceptance, simultaneous first audio
acceptance and very noisy environments remain open. See [the reload and replay
results](../../sensors/VALIDATION.md#audio-requester-lifecycle-and-initial-reload-check--7-october-2026).

Resolving
generic multiple-peak selection requires separate policy/compatibility work;
do not silently apply the pilot-only fallback to successful signed verification.
The 20.25/20.75 kHz probes have no ordinary beep; hearing no sound is not a
pass/fail verdict. The challenge's physical playback/capture response remains
uncalibrated.

Useful deterministic checks include:

- Missing samples, discontinuities and incorrect recording duration.
- Near-full-scale samples and sustained flat peaks as clipping indicators.
- Signal level over time.
- Recovery of the agreed acoustic challenge.

Quiet audio may be the correct result. Loud ambient noise may be the phenomenon
being measured. Neither should automatically count against the operator.

Arbitrary environmental audio has no universally meaningful signal-to-noise
ratio without defining the desired signal and a method for estimating the
background. Recovery of the challenge demonstrates detectability of that
challenge; it does not establish adequate capture of an unrelated external sound.

## Location: uncertainty as evidence

Check freshness, continuity, reported uncertainty, satellite geometry and
independent positioning residuals where available. Poor precision can make a
measurement unsuitable without establishing misconduct.

Preserve uncertainty semantics. Android horizontal accuracy uses a 68% confidence
radius; browser geolocation specifies 95%. Identical numeric thresholds across
those APIs are not directly equivalent. Do not silently treat repeated fixes or
reported uncertainty as independently established ground truth.

## Sensing failures as recorded outcomes — future consideration

Consider a sensing failure a valid, reportable outcome of a measurement attempt
across all sensor types. For example, GPS may fail to obtain a fix within the
agreed time limit. The failure record can be valid evidence of the attempt without
satisfying acceptance requirements for the requested measurement. Record the
acquisition outcome separately from the assessment of measurement quality.

Preserve failures diligently, including when no usable measurement is produced:

- Bind the record to the request, attempt, sensor, device and operator enrollment.
- Record start and end times, elapsed duration, configured timeout, retries and
  the stage at which acquisition failed or stopped.
- Retain available sensor/OS error codes, permission and sensor availability
  states, relevant diagnostics and any partial observations. For GPS, this could
  include available satellite observations and fix status during the attempt.
- Give a structured failure reason and readable explanation, distinguishing
  timeout, unavailable sensor, denied permission, cancellation and reported device
  error; explicitly record an unknown cause when evidence is insufficient.
- Protect the failure record's integrity and provenance through the signed
  evidence path, retaining it even if a later retry succeeds.

The aim is verifiable evidence of what failed and why, to the extent supported by
the observations. Distinguish an observed failure, a device-reported reason and an
established cause: a signed timeout record alone does not prove a hardware defect
or operator fault. This remains a proposal for later implementation.

### Priority recorded on 30 September: failed attempts must be inspectable

**Deferred to 1 October 2026 at the owner's request.** Resume from the
[sensor hardening handoff](../../sensors/STATUS.md): freeze terminal timing first, then
develop the separate signed GPS attempt report and its negative tests. No further
implementation or physical testing is planned for 30 September. This is a saved
handoff, not an automatic scheduled run.

The owner explicitly reiterated that adverse conditions are useful tests and
that operators need a way to report that they attempted collection. Prioritize
this alongside acquisition hardening, starting with GPS and keeping the record
format reusable across independently selected sensors. Camera/GPS composition
must expose each component's outcome; one successful sensor must not hide the
other's failure. No microphone testing is authorized by this priority.

The current phone run illustrates the gap: receiver preparation was active,
but collection ended after a last raw callback at 26.2 seconds with insufficient
qualifying satellite observations. The original request and diagnostics are
preserved in the [validation record](../../sensors/VALIDATION.md).
Those engineering records are unsigned. Neither the reported cloudy conditions
nor the sensor snapshot establishes a physical cause or operator responsibility.
Do not retrospectively sign these host observations as if the phone had recorded
and signed them during the attempt.

The code audit also found that `NativeLocation.snapshot` falls back to the current
elapsed session time when a failed session has no completed trace. The value can
therefore grow after failure. Freeze terminal timing before exporting or signing
a future failure report; do not substitute a later inspection timestamp. Today's
26.2-second diagnostic is a last-callback offset, not an exact terminal duration.

The next implementation must resolve these concrete requirements:

- Use a distinct, versioned failure/attempt artifact and signing domain. A valid
  failure report must never be accepted by the successful measurement verifier
  or satisfy that measurement's policy. Preserve exact original request binding,
  independently trusted signer pin, per-attempt ID and sensor identity. Device
  enrollment and operator authorization are separately verified context, never
  inferred from a key fingerprint or an operator-supplied identity field.
- Freeze terminal times and counters when collection stops. Separate permission
  preparation, waiting for usable readings, observation and finalization where
  actually measured; unavailable timestamps remain unknown. Distinguish no
  acquisition, partial acquisition, cancellation, expiry, provider loss, policy
  failure, signing failure and storage failure. Preserve original request limits
  and any local session limits without inventing shorter performance deadlines.
- Have the native collector supply its own snapshot; a WebView caller must not
  submit arbitrary claims for the native key to certify. Keep schema validation,
  report semantics, signing format and verification in Rust, with minimal Android
  lifecycle/key/storage glue. Retain bounded diagnostic codes and partial-data
  references with explicit provenance; unknown cause is a legitimate result.
- Return separate signature/request-binding, acquisition outcome, policy result,
  independently observed receipt/freshness and assurance fields. A signature
  establishes the reporting key and unchanged claims. It does not alone prove
  that acquisition physically happened, authenticate RF conditions, certify the
  human operator's effort or establish fault. Missing external observations stay
  unproven. A report signed or delivered after expiry cannot renew freshness or
  acquire successful-measurement acceptance rights.
- Preserve each failed record across retries and app reloads, with explicit
  retention/export behavior, bounded storage and idempotent finalization. Define
  nonce/reservation effects separately from successful sensor signing; creating
  an error report must not accidentally consume or bypass a success reservation.
  A process crash, unavailable signing key or full storage may prevent a signed
  report. Expose that absence or unsigned fallback honestly; never fabricate a
  completed certificate or claim that every failed attempt was recorded.
- Test genuine signed failures, altered request/pin/payload rejection,
  cross-artifact substitution, zero/partial observations, late reporting,
  cancellation races, signing/storage failure and retained lookup after retry.
  Include independent camera/GPS component outcomes. Synthetic tests establish
  software behavior; a later phone run is needed to establish native production
  and retrieval of the new artifact.

This priority does not define compensation, penalties or Assignment acceptance.
Those require separate previously agreed rules. A failed measurement can remain
unsuitable for the task while its signed failure report is valid and useful.

## Device and operator attribution — future consideration

Consider including a hash of the device MAC address, where available and suitable,
and other device-related values with every measurement: photographs, audio,
location and any future sensor types. Evaluate which values can reliably support
device continuity, including an enrolled device-key identifier. Bind the selected
values to the signed measurement, request and operator enrollment to help validate
that measurements came from the device associated with the expected operator.

The intended goal is to strengthen evidence that the operator took the
measurements. Device hashes alone do not prove who physically operated the device.
Before implementation, assess identifier availability, stability, spoofing and
privacy; hashing alone must not be treated as authentication or anonymization.
This is a note for later consideration, not an implemented feature or an approved
implementation plan.

## Proposed quality contract

Quality requirements should be fixed in the signed request before collection:

1. Agree on metric versions, thresholds, the relevant subject region, required
   device capabilities, time limits and permitted retries.
2. Give immediate guidance, such as “hold steady,” “subject too small,” or
   “location uncertainty exceeds the requirement.”
3. Report `meets_requirements`, `below_requirements`, `inconclusive`, or
   `unsupported`, with actual measurements and reasons. Preserve the distinction
   between an unavailable metric and a metric that was measured and failed.
4. Keep responsibility separate. A metric alone usually cannot distinguish
   deliberate obstruction, an honest mistake and environmental limitations.
5. Bound retries and retain an appropriate record of attempts, preventing both
   endless requester demands and selective submission of convenient measurements.

Avoid hiding all measurements behind one overall quality score. Agents should be
able to inspect which requirement passed, failed or could not be assessed.

## Suggested first implementation, when prioritized

Create an independent Rust quality module for resolution, exposure and regional
sharpness. Initially use it for guidance while thresholds are calibrated.

- Evaluate the actual delivered image so the requester can recompute its metrics.
- Version the decoding, orientation, color conversion, resizing, filtering and
  rounding rules. Prefer integer or fixed-point arithmetic where practical.
- Check agreement between native Rust and WASM using shared fixtures.
- Bind the quality profile and its version to the request and evidence.
- Treat capture-time device metadata as supporting observations with their own
  provenance limits.
- Preserve standalone sensor use and explicit composition.

The intended result is reproducible evidence about usability, with uncertainty
about causes and responsibility kept visible.

## References consulted

- [Pertuz, Puig and Garcia: Analysis of focus measure operators for shape-from-focus](https://www.sciencedirect.com/science/article/pii/S0031320312004736)
- [OpenCV: Laplace operator](https://docs.opencv.org/4.5.4/d5/db5/tutorial_laplace_operator.html)
- [Android Camera2 capture metadata](https://developer.android.com/reference/android/hardware/camera2/CaptureResult)
- [Android motion sensors](https://developer.android.com/develop/sensors-and-location/sensors/sensors_motion)
- [Android Location.getAccuracy](https://developer.android.com/reference/android/location/Location#getAccuracy())
- [W3C Geolocation](https://www.w3.org/TR/geolocation/)

# Native Android microphone acquisition

The Android operator path uses a bounded AAudio input/output session. The shared
Rust audio protocol, requester receipt and C2PA verification remain independent
of this platform adapter. Browser recording continues to use its own Web Audio
adapter and cannot claim native AAudio acquisition.

This path implements [acoustic challenge-response](AUDIO.md) with native-owned
speaker playback and microphone capture, alongside the acquisition safeguards
described below.

MainActivity and the web audio coordinator now integrate this native path.
Shared Rust tests, production Kotlin JNI declarations exercised on the Linux JVM,
and browser verification of signed native synthetic WAV fixtures cover the
protocol and signing boundary. Final APK packaging verification is tracked in
[VALIDATION.md](VALIDATION.md); physical microphone/speaker acceptance is still
required before claiming support for a particular phone.

## Ownership and protocol

`NativeAudio.kt` owns permission, foreground lifetime, the original request,
successive nonce order, replay reservation, and the private retained recording.
`NativeAudioRecordingMonitor.kt` observes Android's configuration for the exact
allocated input session; `NativeAudioRecordingGuard.kt` contains its independent,
host-testable rejection policy. Recording callbacks run on their own handler so
challenge processing and native signing cannot block observation delivery.
`native_audio_device.cpp` owns AAudio streams and fixed capture/playback buffers.
`NativeAudioCore.kt` exposes internal JNI entry points for Rust validation,
probe generation/detection, canonical PCM encoding and C2PA sealing. These
internal JNI methods are never installed as WebView interfaces.

The WebView interface accepts only an original audio request, requester rounds,
the original receipt wrapper and opaque native session identifiers. It cannot
submit microphone samples, a playback waveform, acquisition metadata, an image
hash or arbitrary bytes for the native key to sign. It can retrieve immutable
copies of successive microphone segments to deliver to the requester.

Setup prepares the native nonce-bound waveform before starting its two-second
acoustic pilot, then records and checks it with Rust
detector, then destroys those streams and buffers. A fresh pair of streams is
primed before `ready`; no evidence samples are retained before the first
requester nonce arrives. That nonce reserves the one-use request in an atomic
device ledger and starts retention at the next input callback. The speaker
callback waits for microphone retention to begin before playing the first
Rust-generated probe. The pilot cannot enter the signed evidence.

The existing two-second, 96,000-sample round protocol is unchanged. Subsequent
rounds require the preceding segment to have been exported by this adapter;
the independent requester additionally requires receipt, decoding, hashing and
retention of the actual bytes before generating its next random nonce. Local
export alone is not proof of requester receipt. The final Rust sealer checks
the complete request, original receipt/demo marker, exact nonce sequence,
retained PCM hashes and recovered acoustic codes.

At recording completion, the adapter copies the completed AAudio-owned buffer
into private session memory and closes microphone and speaker streams. It
retains that recording while awaiting the receipt and C2PA sealing. No exported
segment can replace the retained recording. The native camera and microphone
share the separately enrolled native media Keystore credential; preexisting web
and GPS identities remain separate. Certificate/SPKI mismatch never rotates an
identity automatically.

## Strict Android profile

- Android API29 or newer is required to observe per-client silencing, actual
  source and active preprocessing. The overall APK minimum remains API26.
  API28 and API30 AAudio functions are dynamically resolved; they do not become
  load-time dependencies on older Android versions.
- Android must advertise unprocessed input support. Actual streams must report
  48 kHz, mono, float PCM, and the input must report `UNPROCESSED`.
- The adapter selects explicit built-in microphone and built-in speaker device
  IDs. Different routes, removed devices, stream disconnection, microphone mute,
  media volume changes and audio focus loss fail the session.
- A new positive Android audio session ID is allocated separately for pilot and
  evidence input. AAudio must confirm that exact ID. Android recording callbacks
  and direct configuration queries match only that session, and startup waits
  for a matching observation. Missing/redacted/unavailable observations never
  become an assumed clean state. Once observed, disappearance fails capture.
- Both the client and actual source must report `UNPROCESSED`, the client format
  must match 48 kHz mono float PCM, and both reported effect lists must be empty.
  The actual device PCM format is retained independently, because Android can
  convert it to the client's format. Silencing, a different device/source/format,
  enabled preprocessing or an observation gap greater than one second aborts
  the session. A later clean observation cannot clear an earlier failure.
- API30+ input explicitly requests privacy-sensitive capture and must report
  that it took effect. API29 records support/request as false and actual state
  as null; no privacy-sensitive protection is claimed there.
- Shared stream mode is requested and reported honestly. Exclusive ownership
  of the physical microphone or speaker is not claimed. Standard performance is
  requested for input and low latency for output; actual modes are recorded.
  Android 11's legacy low-latency input can open an underlying PCM16 client and
  convert it to float AAudio callbacks. Standard input avoids this app-selected
  conflict with the existing strict float client-format requirement. It does not
  relax the source, route, format, timing or observation requirements.
  See the pinned [Android 11 input implementation](https://android.googlesource.com/platform/frameworks/av/+/refs/tags/android-11.0.0_r1/media/libaaudio/src/legacy/AudioStreamRecord.cpp)
  and [legacy-path selection for an explicit session](https://android.googlesource.com/platform/frameworks/av/+/refs/tags/android-11.0.0_r1/media/libaaudio/src/core/AudioStreamBuilder.cpp).
- The input callback copies AAudio input into a preallocated buffer. It never
  pads a missing input block or mixes the challenge waveform into microphone
  samples. Speaker silence and speaker probe playback are separate output work.
- Realtime callbacks do not allocate, invoke JNI, hash, sign, write files or
  acquire a mutex. Control-thread JNI operations own serialization and copying.
- Negative or nonzero xrun counters, callback errors, interrupted callback
  delivery, unexpected stream states and unavailable hardware timestamps after
  startup fail closed. Input xrun reporting can be incomplete on some Android
  HALs, so `xrun_reporting_completeness` is explicitly `unknown`.

Evidence uses actual paired `AAudioStream_getTimestamp(CLOCK_MONOTONIC)` results,
not the time at which JavaScript requested a recording. Frame positions,
monotonic nanoseconds and native callback times are exact decimal strings.
Distinct paired checkpoints are retained at a target spacing of at least
100 ms. Verification requires checkpoints within one second of both recording
edges and no gap greater than one second between retained observations. Both
input and output clocks must advance consistently with the 48 kHz frame rate;
reported timestamps must be no more than one second old when observed. Playback
frame intervals, challenge
arrival, retained sample count, observed xruns, actual routes and key protection
metadata are signed. Rust checks these for consistency with the original
request, recording length and transcript. Callback time describes delivery;
hardware timestamps describe Android's stream timing, and neither is remote
hardware attestation.

New native sealing also requires signed `recording_configuration` version 1.
It records the API/session/device, observed client silencing and sources,
client/device formats, effect lists, observation count and first/last monotonic
times, plus the requested and actual privacy-sensitive state. Observations must
cover the retained recording from before arming through its last input callback.
Historical native records without this field remain readable and receive no
credit for these checks. Configuration callbacks are asynchronous Android
observations: very brief or unreported changes can escape observation, and
compromised Android/HAL software can lie. This is not attestation of sensor data.
Callbacks remain registered during receipt/sealing so a queued bad observation
cannot be erased merely by stopping the input stream.

Before publishing a completed native WAV, the controller places a barrier
behind already-queued application recording-configuration callbacks. It keeps
the monitor open and the result private until that barrier returns to the
worker, then repeats monitor health, session ownership, permission and sample
freshness checks. Waiting is asynchronous and never holds the NativeAudio lock.
A two-second monotonic deadline, rejected handler posts or cancellation discard
the result; a late barrier cannot revive it. This drains the application's
already-queued observations, not unknown or undelivered Android/HAL work, and
does not establish sensor attestation. Silent deterministic queue tests cover
queued silencing after stream stop, timeout, worker delay, cancellation,
ownership changes and handler shutdown.

The deterministic host guard tests cover client-specific silencing between clean
polls, sticky failure, other session IDs, duplicate/missing configurations, source,
effects, route and format changes, clock/gap limits, observation coverage and a
queued bad callback after stream stop. They do not substitute for physical
AAudio callback, session-ID, privacy-policy and concurrent-recorder acceptance.
Those checks remain pending on a real Android phone.

API references: [Android input sharing](https://developer.android.com/media/platform/sharing-audio-input),
[recording configurations](https://developer.android.com/reference/android/media/AudioRecordingConfiguration),
and [AAudio session/privacy attributes](https://developer.android.com/ndk/reference/group/audio).

Each round must arrive within its segment's first 750 ms, begin native playback
within 800 ms of arrival, and start while no more than 800 ms of that segment's
microphone samples have been retained. Its output interval must contain exactly
the expected probe frames. The shared detector independently requires the correct
nonce-coded waveform within the permitted recording window; metadata alone does
not establish that a challenge is present in the WAV.

The completed recording's wall time must agree with its request anchor and final
input callback's monotonic time within one second. Rust assigns a finalization
timestamp when sealing begins, requires it to be no earlier than the reported completion
and the mapped final callback, and limits completion-to-sealing delay to thirty
seconds. Request receipt, recording completion and finalization must all remain
inside the original request window. The independent verifier repeats these checks;
even a correctly signed acquisition assertion fails when its timing or continuity
is inconsistent. These checks do not establish a trusted wall clock or correlation
with the different elapsed-realtime clock used by Camera2/GNSS.

The Android controller also enforces the thirty-second age budget against the
actual final input callback's monotonic counter at seal entry, after acquiring
the shared key lock, after signing, and before committing the result. It repeats
the original request-window and wall/monotonic continuity checks at those gates.
A delayed signer cannot extend a recording's freshness, and a foreground or
permission change discards a signature or result still in progress. The signed
finalization time remains explicitly the start of finalization; these delivery
gates do not turn it into an independently witnessed completion time.

## Bounds and terminal behavior

The recording is bounded by the existing even-duration four-to-thirty-second
protocol, fifteen rounds, 512 timestamp checkpoints and 256 KiB of acquisition
metadata. C++ allocates at most thirty seconds of retained float samples and
fifteen fixed 768 ms probe buffers per session. There is at most one native
AAudio device session. PCM copies, cached transport segments and C2PA output
also remain bounded by the request and shared WAV limits.

Permission denial, cancellation, foreground loss, native failure or timeout
closes streams and discards unsigned recording data. A request reserved at its
first nonce stays consumed after failure. Setup, waiting for a first nonce,
recording, and waiting for a receipt have explicit time limits. A phone that
cannot meet the strict profile fails; the native path does not silently
downgrade to a browser recording.

The native controller now schedules a watchdog independently of its recording
worker, including while the initial permission callback is absent. It uses the
earlier original request expiry or the existing 150-second session lifetime;
the exact 150,000 ms lifetime boundary remains permitted. Existing pilot,
challenge, recording, receipt and sample-freshness limits are unchanged.
Rejected handler submissions become errors instead of leaving a pending phase.
Cancellation and terminal transitions revoke queued work, and elapsed status
timing freezes before teardown. These status fields are explicitly unsigned;
they are not a signed microphone attempt report or a measurement duration.

Teardown attempts each resource release and wipes retained unsigned PCM, cached
segments and pilot data even if another release throws. Bounded unsigned cleanup
errors remain visible, and unresolved stream, audio-focus or recording-callback
cleanup prevents a new session until it succeeds. Callback health stays revoked
while failed Android unregistration is retried. The watchdog cannot forcibly interrupt a
platform/JNI operation already holding the controller lock; it is application
lifecycle enforcement, not a hardware or real-time deadline guarantee.

Failed or cancelled native sessions also freeze a bounded
`nonverba-native-audio-diagnostics` record. It identifies the native attempt,
original request session and reporting-key fingerprint, stopping phase, unsigned
terminal elapsed time, pilot enqueue/verification flags and challenge count.
It retains the last observed own-session Android recording configuration and
AAudio stream values, with their observation times and stream phase. A previous
pilot snapshot can remain when evidence-stream opening fails; it is explicitly
last observed, not an exact terminal hardware state. Unavailable values remain
null. No samples, effect arrays or waveform are included.

After the 6 October phone refusal, the controller retains the bounded last
framework configuration before pilot teardown, with its original observation
time, input session and stream phase. Rust assesses the collector's exact
96,000-sample pilot against the retained native nonce and returns a separate
`nonverba-native-audio-pilot-assessment`: `passed`, `not_detected` or
`detected_late`, plus score, matched symbols, best candidate sample offset, RMS
and in-band energy ratio. The unchanged policy requires detection and a start
offset no later than 38,400 samples (800 ms). Invalid PCM or nonce remains an
error, not a fabricated diagnosis. The internal JNI entry is never a WebView
interface; no arbitrary PCM enters it from the page.

The assessment is unsigned and retained in terminal diagnostics. Passing this
pilot only permits the subsequent evidence collection; it is not a completed
measurement. Best candidate offset is not calibrated sound travel time and
score is not a probability of authenticity. Neither refusal class establishes
physical cause. The earlier phone attempt cannot be retrospectively assessed
because its pilot samples were released; its original evidence remains unchanged.
See the [phone pilot record](VALIDATION.md#microphone-pilot-after-format-correction--6-october-2026).

When ordinary detection reports no qualifying signal, pilot readiness also
checks the highest-ranked qualifying peak across the complete bounded pilot.
It uses the same score, matched-symbol, RMS and band-ratio thresholds, then
applies the inclusive 38,400-sample start limit. A sub-threshold repeat cannot
hide a valid timely pilot. Original detected-late refusals stay unchanged; the
search is not clipped at the deadline, which could misclassify a late marker's
rising flank. Ordinary passing results and original failure metrics when no
timely peak qualifies remain unchanged. This is a readiness correction; the
generic detector and successful WAV sealing/verification retain their existing
rules. Multiple-peak selection in those successful-evidence paths, and suppression
by a stronger qualifying late repeat, remain separate open concerns.

Unsigned diagnostics also preserve the pilot's own input session, record/input
callback timing and the last observed completed output-round callback, when
available. A later evidence stream cannot replace these pilot observations.
Enqueueing and supplying samples to an output callback are distinct; even a
completed callback does not prove hardware presentation or a physical sound.
Unavailable completion stays null. Native stream close return-code reporting
remains an open cleanup concern; no close failure was observed on this phone.

The web adapter checks ownership and the 16 KiB diagnostic bound before retaining
the latest record across retries in the open page. A separate control saves it
as JSON; save or diagnostic construction errors remain errors. It is explicitly
unsigned, is not a successful measurement or signed failure report, and cannot
enter WAV signing or successful verification. No earlier unsigned failure is
retroactively signed. Media-volume zero and Android microphone mute now have
separate readiness errors.

The Rust audio verifier selects exactly one assertion in each required Non-verba
artifact domain. A similarly prefixed assertion cannot substitute for the exact
audio or native-acquisition assertion, and duplicate instances are rejected.
Unrelated assertions remain allowed. Historical audio without native acquisition
metadata remains readable and receives no native-monitoring credit.

## What this evidence establishes

C2PA binds the exact WAV, request, receipt and native acquisition metadata to the
enrolled native signing credential. Hardware stream timing and retained buffers
raise the effort required to substitute browser-provided media. Successive
unpredictable requester challenges narrow the usable replay window.

This does not prove a sound travelled through air, prove the identity or
distance of an external source, defeat an Android/kernel compromise, or attest
that a particular microphone produced the samples. A malicious app build may
falsify app-side acquisition assertions. The existing FSK carriers are nominally
20.25/20.75 kHz, with finite-duration sidebands: inaudibility is not guaranteed,
and some phones cannot play or capture them at all. Pilot success is a session
readiness check, not a measured detection-error rate or proof of acoustic origin.

## Physical acceptance still required

Compilation and synthetic Rust/JNI/browser tests do not establish real microphone accuracy.
Before claiming phone support, test at least these cases on each supported
device/Android build:

1. A real independent requester and a separately labelled local demo; compare
   retained PCM receipt hashes and verify the exported C2PA WAV independently.
2. Pilot failure on an attenuated/unsupported ultrasonic path; no `ready` or
   signed recording may result. Confirm pilot samples are absent from the WAV.
3. Delayed, repeated, reordered and missing nonces; rejected or late challenges
   must not produce acceptable native evidence.
4. Phone calls, another recording app, focus loss, volume/mute changes, plugging
   headphones, Bluetooth routing, screen/background transitions and permission
   revocation; check teardown and fresh retry requirements.
5. Actual AAudio timestamp availability, route IDs, buffer sizes, clock/frame
   consistency, xruns and callback continuity at both four and thirty seconds.
6. Crash/restart after nonce reservation, receipt timeout, cancelled signing and
   certificate-record mismatch; consumed requests and identity pins must persist.

Platform references: [AAudio guide](https://developer.android.com/ndk/guides/audio/aaudio/aaudio),
[AAudio API reference](https://developer.android.com/ndk/reference/group/audio),
and [Android unprocessed recording guidance](https://developer.android.com/media/platform/mediarecorder#creating-running).


### Output-frame consistency (29 September 2026)

Each probe's retained output start/end frame is now projected through the nearest retained AAudio output timestamp. Presentation and callback time are distinct. A bounded allowance of twice the reported stream buffer capacity, a 100 ms floor, one percent clock-rate variation and the checkpoint's observed age prevents grossly impossible placement while preserving queued output. This is a broad application consistency test, not calibrated speaker latency, acoustic distance or source authenticity. The same Rust check runs before sealing and during independent verification. Signed-invalid-WAV regressions keep valid C2PA integrity and detected acoustic codes while rejecting inconsistent frame claims; physical latency acceptance remains pending. Details and evidence are in [the dated checkpoint](VALIDATION.md).

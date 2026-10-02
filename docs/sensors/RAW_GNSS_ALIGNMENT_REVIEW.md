# Raw-GPS device compatibility decision

## Revised engineering choice — 29 September 2026

The owner delegated numerical choices and explicitly asked for device diversity,
not thresholds fitted to the one available phone. The previous 10 ms proposal
below is superseded by a recommended **100 ms** alignment allowance for new
raw-required requests, both standalone and composed with camera. This is a
task-scale choice: one tenth of the nominal one-second sampling cadence and 1%
of the ten-second observation window. It is not an Android guarantee or a claim
of broad physical-device testing. The actual uncertainty remains in the signed
record; receivers need not all report the same value.

The associated verifier correction separates nominal sampling cadence and
cross-clock compatibility from measurement precision. Nominal cadence remains
at least 950 ms; reported intervals must be nonoverlapping. A continuity check
compares clock advances using their reported alignment uncertainty, while a
hardware reset or backward clock still fails. It does not establish 100 ms
clock stability: at the maximum allowance, two 100 ms endpoint estimates plus
the 100 ms residual tolerance permit a 300 ms compatibility difference.
Age, delivery delay, observation span, maximum gap and PVT matching continue to
consume the actual uncertainty and applicable timestamp quantization.

Ordinary location and photo requests keep their existing non-raw defaults.
Raw observations remain a stronger explicit request, never a universal phone
requirement. Failure to meet that request's precision or capabilities is distinct
from a broken signature. A requester may issue a fresh ordinary request; an
existing signed raw request is not downgraded after seeing the measurements.
Legacy requests without the optional field keep their original interpretation.

Automatic approval review initially rejected applying the 100 ms shared preset.
The owner subsequently confirmed **“Yes, apply your recommended update”** for
new standalone GPS requests and GPS attached to photos. The shared source preset
now includes the 100 ms alignment cap; receiver/satellite precision is unchanged.
This supersedes the earlier pending approval. Old requests remain unchanged.

The reviewed compatibility implementation passed 47 raw-GPS Rust tests, 24 PVT
tests, 120 UI/handler tests and 16 actual shipped-WASM boundary checks before
the default changed. The signed synthetic matrix covers 0, 5, 25, 50 and 100 ms
uncertainty, including asymmetric uncertainty, reset, replay, jitter, insufficient
span and intact-signature policy rejection. The derived quality report explicitly
denies precise clock stability and a proven physical error bound. This is
simulated variation, not five physical devices. Exact checkpoint:
`code/artifacts/qa/raw-alignment-cross-device-validation-20260929.json`.
After the approved preset change, 162 affected adapter, handler and requester
session tests passed. The combined Debian build, Android lint and APK/browser
package inspection passed. Both packages are in
`code/artifacts/container-builds/20260929T144401Z/`; the exact build/verification
record is `code/artifacts/qa/gps-compatibility-approved-build-20260929.json`.
The APK was subsequently installed, preserving existing signing keys; its
SHA-256 is `34822ba7d2d9f4b4c313ba95dbeb5153e66f654eb6a90cfb044adb1ab0de93d2`.
The standalone raw proof (local review record, not included in this source release)
passed independent verification against its saved original and retained location
pin: 13 raw epochs, at least 9 qualifying satellites per epoch, and 11 GPS fixes
over 10.002 seconds. Four wrong-key/request/policy/record negatives were rejected.
The camera/raw-GPS pair (local review record, not included in this source release)
also passed, with 20 raw epochs, at least 6 qualifying satellites per epoch,
17 fixes over 16.001 seconds and a photo fix 461 ms old at exposure. Three
key/policy/proof substitutions failed. Native-camera, raw-GPS and correlated-clock
appraisal passed; hardware-attestation and independent-position requirements
correctly remained unsatisfied.

These records report a maximum 5 ms alignment uncertainty against their signed
100 ms cap. They validate these records on one phone, without establishing broad
device compatibility, RF authenticity, independent PVT or a physical uncertainty
bound. The first composed exposure occurred after the requested window was
available, so that run alone did not establish post-photo collection.

A subsequent independently verified pair (local review record, not included in this source release)
demonstrates early photo capture followed by the remaining GPS collection on
this device: exposure at 7.982693060 seconds preceded the earliest required-window
end at 16.951 seconds; nine GPS fixes and nine uncertainty-separated raw epochs
followed the photo. The trace ended 9.062 seconds after exposure and location
sealing entry occurred 9.843 seconds after exposure; the latter is not signature
completion. The photo fix was 521 ms old. The completed record has 11 fixes over
10 seconds and 15 raw epochs with at least 4 qualifying satellites each, still
reporting 5 ms alignment uncertainty. All 36 retrieved file hashes were checked.
Native-camera/raw-GPS/correlated-clock appraisal passed, and substituting the
previous valid photo's GPS proof was rejected. This closes that acquisition-order
gate for this phone/run; independent requester freshness, PVT and hardware
attestation remain unproven.

The existing foreground awake lease survived the APK update without a new
toggle and retained its 17:51 local expiry, as shown by the
14:50 screen (local review record, not included in this source release).
Microphone recording and playback remain on hold.

## Earlier 10 ms proposal and validation history

At that earlier checkpoint, the phone's last evaluated raw epoch reported
12 qualifying satellites and 5 ms alignment uncertainty. Its installed policy
applied the 0.1 ms receiver precision limit to Android's measurement-to-system-clock
alignment as well,
so that candidate failed. The original failed record remains unchanged:
`code/artifacts/device-acceptance/raw-clock-magnitude-20260929T1355.json`.

## Proposed new-request preset

Add this one field to new raw-required requests:

```json
"max_elapsed_realtime_uncertainty_ns": 10000000
```

This permits up to 10 ms of reported alignment uncertainty. Keep the existing
receiver and satellite timing limit at 100,000 ns (0.1 ms), along with all
delivery, freshness, observation-duration, continuity and position-match limits.
Existing requests omit this field and keep their original interpretation. Their
signed policy is never rewritten. The proposed preset applies to standalone raw
location and camera composition through the shared request-policy module.

The 10 ms choice is 1% of the one-second epoch cadence. Two endpoint budgets
consume 20 ms within the existing 50 ms cadence margin. The protocol's optional
field has a finite 1–100,000,000 ns schema range; every chosen value must also
satisfy the other timing rules. A schema-valid cap alone cannot make a trace pass.

## Completed safeguards

An explicit alignment policy consumes the actual reported uncertainty inside
timing allowances. It uses the lower reported edge for age, subtracts both
endpoint budgets from observation span, and includes both budgets in gap and
continuity checks. Millisecond timestamps additionally reserve their 1 ms
quantization allowance where needed. PVT matching and GPS-wall correlation
report nominal differences, uncertainty and quantization separately.

For example, a nominal 94 ms position-match difference plus 5 ms uncertainty
and 1 ms quantization fits a 100 ms limit; a 95 ms nominal difference fails.
Removing or substituting the alignment policy invalidates the original-request
binding. Raising it cannot waive receiver/satellite precision checks.

Android describes the alignment uncertainty as an estimate at 68% confidence;
accounting for it does not make it an absolute physical bound or authenticate
the receiver ([Android reference](https://developer.android.com/reference/android/location/GnssClock#getElapsedRealtimeUncertaintyNanos())).

## Validation and approval state

Final source tests passed: 41 raw-GPS tests, 24 position-verifier tests, 54 UI
adapter tests and 48 camera-handler tests. The raw and position tests include
signed artifacts, request substitution, legacy compatibility, delay/span and
fractional-nanosecond boundaries. Independent review found the missing
millisecond-bin allowance; the correction and its regression now pass.

All six final WebAssembly JSON-boundary checks passed. Exact report:
`code/artifacts/qa/raw-alignment-wasm-20260929T141653079Z.json`.
The combined test/source checkpoint is
`code/artifacts/qa/raw-alignment-validation-20260929.json`.
At this earlier checkpoint there was no new APK installation or physical result.
The request preset still omitted the field. Automatic approval review
first rejected changing that preset before the core timing safeguards were
demonstrated. After the safeguards and tests passed, review again rejected the
default because this exact 10 ms threshold across future standalone and composed
requests needed explicit user authorization. That proposal was subsequently
superseded by the device-compatibility decision recorded above.

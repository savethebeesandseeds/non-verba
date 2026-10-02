# Raw GNSS acquisition and evidence admission

Raw GNSS is independently requestable through the location module and uses the same policy when composed with camera evidence. The native collector owns Android callbacks. Rust owns evidence quality, timing and the collection decision. A browser cannot satisfy this profile.

## Startup and retained evidence

The native session starts one monotonic anchor and one fixed deadline. Missing required clock fields or empty signals before the first retained epoch are counted as rejected startup callbacks. Present measurements cross JNI and Rust evaluates the complete candidate trace.

`raw_gnss_collection.rs` returns a collection action alongside the unchanged raw consistency checks:

- `retain`: the candidate passes all per-epoch requirements; only the required total count/span/coverage may still be pending.
- `discard-startup`: exactly one candidate exists and no GPS sample has been admitted. The usual startup case permits insufficient qualifying satellites or finite nonnegative clock uncertainty above the requested maximum. A separate case permits a well-formed epoch wholly before the new anchor, including its uncertainty and every signal offset; it may also lack enough qualifying satellites. The rejected count increments and the candidate is removed. Original request, clock anchor, deadline and cadence remain intact.
- `reject`: malformed data, unexpected source or policy, timing/sequence/bounds failures, or any unacceptable epoch after retention begins terminates collection. A healthy second epoch cannot conceal a failed first retained epoch.

The unsigned field diagnostics never drive this decision. Structural clock validation and the retained-epoch uncertainty predicate are distinct, shared Rust functions; signing and independent verification always apply the full original quality limits. Code-type presence follows Android API 29: absent optional values become null, and a present empty string is retained as an unknown signal identity. Empty, absent and bounded unknown labels may qualify for basic raw-measurement consistency when all other quality checks pass; none establishes an identified signal. Empty and absent labels compare as the same unknown identity for duplicate detection, and satellite counts remain distinct constellation/SVID counts. Invalid characters and overlong present labels remain rejected. The separate GPS L1 C/A position solver still requires explicit code "C" and L1 carrier frequency, so unknown identities receive no position-solver credit. Negative and nonfinite uncertainty never qualifies for startup exclusion.

The GPS observation window starts only after raw evidence is retained. Completion still needs the requested actual duration, minimum samples and epochs, qualifying satellites in every retained epoch, continuous clocks, bounded gaps, GPS/raw alignment and fresh finalization. Discarded startup time does not count toward that duration. The signed trace carries the bounded rejected startup count, not an authenticated explanation of receiver behavior.

Collection progress may include an unsigned, coordinate-free
`alignment_diagnostic` for the first timing failure. The reason comes from the
same predicate used by verification; relative nanoseconds remain an exact signed
decimal string. Bounded callback/end counters, uncertainty, signal-offset range
and a short summary are local diagnostics, absent from the signed trace. The
Android error view exposes that summary without changing admission. The
30 September phone follow-up in [validation](VALIDATION.md) distinguishes a
pre-anchor startup failure from a later satellite-quality interruption.

## Evidence and limits

The optional signed `max_elapsed_realtime_uncertainty_ns` separates Android
measurement-to-system-clock alignment from receiver/satellite clock precision.
It accepts a finite value from 1 to 100,000,000 ns. Omission retains the original
shared `max_time_uncertainty_ns` cap and nominal timing rules. The receiver bias,
receiver time and satellite transmit-time caps remain unchanged. After the owner
delegated values and requested device diversity, the engineering recommendation
became 100 ms. The owner approved that update for new standalone and composed
requests, and the shared source preset now includes the field. See
`RAW_GNSS_ALIGNMENT_REVIEW.md` for validation and deployment state.

For an explicit alignment policy, the verifier rounds the reported alignment
uncertainty upward to nanoseconds and consumes it inside timing allowances:
earliest edge of the reported estimate for delivery/freshness, latest first epoch and earliest
last epoch for the required span, both endpoint uncertainties for maximum gaps,
and uncertainty-inclusive GPS-fix/PVT epoch matching. Nominal
timestamps and callback ordering remain checked; no timestamp is adjusted or
manufactured. A reported uncertainty interval may extend past callback receipt
without implying a future sample, but its earliest edge must follow collection
start. Floored millisecond callback, collection-end and fix timestamps reserve
their additional one-millisecond quantization allowance where used as upper
time bounds. PVT reports list that allowance separately from reported receiver
uncertainty. The same rules apply during native collection, sealing and independent
verification. Old requests keep their previous interpretation.

Sampling cadence and clock compatibility are different from task precision.
Explicit policies require nominal epochs at least 950 ms apart and nonoverlapping
reported alignment intervals. The cadence does not require each device to resolve
the spacing itself to within 50 ms. Cross-clock advances must be compatible within
100 ms plus their two reported alignment uncertainties; the hardware discontinuity
count must stay unchanged and both clocks must advance. At 100 ms uncertainty per
epoch, that comparison permits a 300 ms difference, not a proven 100 ms stability
bound. This avoids rejecting an otherwise consistent stream solely for having a
coarser clock estimate. The derived `timing_quality` report states maximum actual
uncertainty, the requested cap, 68% confidence semantics and that precise stability
and a physical error bound are not proven. Raw evidence and timestamps are unchanged.

Android defines this field as a reported 68% alignment estimate, not an absolute
physical error bound ([GnssClock reference](https://developer.android.com/reference/android/location/GnssClock#getElapsedRealtimeUncertaintyNanos())).
The timing budget is therefore an explicit quality policy, not satellite
authentication or proof of a trustworthy device clock. The recommended 100 ms
preset uses one tenth of the nominal one-second cadence. It is an engineering
task budget, not the specification of a
particular phone. The schema ceiling is not a promise
that every value below it can satisfy the other timing constraints.

The seven collection tests cover startup uncertainty boundaries, malformed signals and clock fields, later degradation, expired/misaligned requests, callback bounds and an actual COSE-signed full-duration trace with unchanged request and anchor after excluded startup. Additional raw-verifier tests construct signed malformed proofs and reject them independently. The earlier native and physical records remain outside this public import; see [current status](STATUS.md) and [validation boundaries](VALIDATION.md).

This preserves quality requirements while allowing acquisition to settle. It does not establish satellite authenticity, RF provenance, uncompromised firmware or true location. A receiver that never reaches the requested quality fails within the original deadline. No hardware success is inferred from synthetic tests.

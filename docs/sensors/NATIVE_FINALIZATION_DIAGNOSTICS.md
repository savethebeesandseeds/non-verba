# Native finalization diagnostics

Camera and location status expose small, unsigned timing diagnostics to identify which existing freshness check rejected a capture. These fields help select a measured performance fix. They do not attest sensor truth, participate in signatures, or authorize a capture.

## Rejection context

The existing error prefix is retained, followed by fixed sensor/stage labels, observed age, configured limit and reason. For example:

    Native capture became stale before finalization or delivery (sensor=location-fix; stage=seal-entry; age_ms=5001; limit_ms=5000; reason=too-old; unsigned timing)

Sensors are camera, location-fix and raw-gnss. Stages are seal-entry, signing-authority and result-delivery. Camera age uses the existing acquisition timestamp selection and 30,000 ms bound. Location-fix and raw-GNSS checks use the original request's maximum fix age. The camera's separate five-second GPS acquisition check and same-second future-fix rule are unchanged.

The admission predicate is unchanged: all elapsed values and the limit must be nonnegative, the sample must not be in the future, and its age must not exceed the limit. Diagnostics distinguish too-old, future-sample and invalid-bounds; an unavailable age is reported as unknown. Request expiry, lifecycle, permissions, clock continuity, identity and replay checks retain their original ordering and behavior. Errors remain subject to the existing 400-character status bound. The new fields contain no coordinates, scene data, keys, request IDs or absolute timestamps.

The signing interface accepts a Boolean authority callback. A per-operation adapter now retains the first actual authority exception, still returns false to block signing, and restores that exception if JNI reports a generic failure. It also rejects a returned result after a failed gate. A failed gate cannot later be revived by another callback; unrelated native errors retain their own exception when no authority check failed.

## Relative phase durations

Native camera and location status include a timing_diagnostics object with unsigned: true. It can contain at most these five integer-millisecond durations. A field is absent until both endpoints exist. Only the first observation of each fixed phase is retained.

| Field | Meaning |
| --- | --- |
| ready_to_finalize_request_ms | Location trace ready until finalize was accepted; absent for camera |
| finalize_request_to_seal_entry_ms | Accepted location finalize until its seal-entry guard; includes queueing, decoding and replay reservation |
| ready_to_seal_entry_ms | Native inputs ready until seal-entry guard |
| seal_call_ms | Seal-entry guard sample until native seal returned or threw; includes the sealing/signing call |
| ready_to_delivery_check_ms | Native inputs ready until the final delivery guard, including failures at that guard |

For camera, ready means both the JPEG and correlated Camera2 result have arrived. For location, it means trace validation completed and collection was frozen. Seal-entry/delivery marks use the existing guard's monotonic clock reading. Phase reads and writes occur under each controller's existing session lock. A failed seal-entry guard has no seal_call_ms; signing or delivery failures can retain completed earlier phases. Unsigned timings may change as an in-flight operation finishes and are not a signed transcript.

A large location ready_to_finalize_request_ms places delay before native location finalization; compare the camera's own sealing duration before attributing it to browser transfer or orchestration. A large finalize_request_to_seal_entry_ms instead includes native queueing/decoding/ledger work. This is phase localization, not a CPU profiler, and does not independently prove the source of delay.

## Validation and physical follow-up

Run inside the managed Debian container:

    bash crates/nonverba-android/tests/run-native-session-guards.sh

The new deterministic production-helper suite checks all sensor/stage boundaries, equality at the existing age limit, one millisecond over, future/invalid clocks, legacy errors, request-expiry precedence, preserved first failure across a simulated opaque JNI wrapper before/after signing, successful and unrelated-error paths, and bounded independent phase snapshots. The retained QA report is code/artifacts/qa/native-finalization-diagnostics-20260929.json.

The motivating physical run is retained in code/artifacts/device-acceptance/composed-camera-finalization-rejection-20260929.json. Its old message does not identify which gate failed. The new diagnostics require an Android build and a fresh physical request before classifying that device's delay. Synthetic tests do not establish Camera2, Android Keystore, raw-GNSS or physical latency acceptance. No retained-JPEG optimization, freshness tolerance change or failed-nonce retry is part of this change.

# Native GPS attempt reports, version 1

Implemented 1 October 2026. This bounded version covers a native collector's
**raw-GNSS policy rejection during collection**, including zero eligible GPS
fixes and partial raw epochs, and **the existing collection timer expiring with
zero raw callbacks**. The timeout extension was authorized after the first phone
follow-up on 1 October. Permission denial, cancellation, timeouts after callbacks
but without a raw policy rejection, provider loss, process death before terminal capture and
other failure classes do not yet produce this signed artifact. Their absence is
not a successful measurement. All terminal sessions now freeze their status
timing and counters before publication, including failures outside report scope.

## Protocol and trust

Rust owns `location_attempt::Snapshot`, `Report`, the signing format and verifier.
The report is a tagged COSE Sign1 ES256 message with protected content type
`application/vnd.nonverba.gps-attempt-v1+json` and external AAD
`org.nonverba.gps-attempt.v1`. Its payload type is
`nonverba-gps-attempt-report`; successful location evidence keeps its existing
type, content type and signing domain. Substitution in either direction fails.
Only `verify_gps_attempt_report` is exported to WASM; native report signing is
an internal Rust/JNI operation. No WebView method accepts observations, clocks,
partial traces or arbitrary signing data. `NativeLocation` supplies its own
immutable terminal snapshot and the location key selected at session start.

Verification requires the independently retained original request and trusted
location SPKI fingerprint. Every original request field, policy and composition
context must match; lossless JSON whitespace/key ordering may differ. The exact
UTF-8 request received by the native bridge is also retained and hashed within
the signature. It is exported without rewriting. Key enrollment, operator
authorization and any independently witnessed arrival are separate inputs;
version 1 supplies no external arrival receipt or attestation appraisal.

The per-session random UUID is the attempt ID. The snapshot records original
request limits, the existing 60,000 ms native session timeout, stopping stage,
start/terminal wall time, frozen monotonic elapsed milliseconds, measured
permission/admission offsets, callback timing and counts, rejected fixes,
bounded collector diagnostics and available partial fixes/raw epochs. Last raw
callback time and terminal elapsed time remain different fields. Wall times and
OS observations remain device claims. Missing stage timestamps remain null.
There is no new two-second timeout or weaker successful evidence requirement.

Rust reevaluates partial received data with the existing raw collection policy
and derives structured rejection reasons. The original v1 snapshot without a
`terminal_trigger` still means raw policy rejection and must show `reject`.
An explicit `collection-timeout` trigger instead requires the unchanged 60,000 ms
bound to have elapsed during collection, permission granted, zero callbacks,
no admitted/discarded raw epochs and no eligible fixes. Its outcome is
`raw-gnss-no-callback-timeout` with `COLLECTION_TIMEOUT` and
`RAW_GNSS_NO_CALLBACKS`; raw evaluation stays null because no measurements arrived.
That elapsed time is an attempt duration, not an observation span or a completed
measurement time. Timeout cannot be inferred from a pending/empty trace alone;
native supplies the actual timer trigger. Unknown triggers, early timeout,
cancellation and successful traces cannot use this signer. Old raw-rejection
reports remain verifiable, while old verifiers reject the new timeout case.
The verifier separately returns signature, original-request/key binding,
claim consistency and raw evaluation. `successful_measurement`,
`measurement_policy_satisfied`, `successful_acceptance_eligible`,
`fresh_action_eligible` and `independent_receipt_verified` remain false.
Late signing can authenticate a historical failure, but never renew freshness.
The successful verifier, appraisal and requester acceptance paths require their
own successful artifacts and do not accept the attempt report.

The signature authenticates the reporting key and unchanged claims. It does not
alone prove physical collection, human effort, weather, hardware fault, RF
authenticity or responsibility. Physical cause is `unknown`; collection,
hardware, clock, effort and fault assurance flags remain false. Compensation,
penalties and Assignment acceptance are outside this artifact.

## Native retention and export

The native collector freezes status under its session lock before queued
teardown. Callbacks cannot replace the frozen status. A covered terminal outcome queues
exactly one finalization using immutable bytes/key references; a retry or page
pause cannot relabel that failed snapshot or deliver it as a successful proof.
Cancellation winning before rejection or the collection timeout produces no report.

The independent app-private `no_backup/gps-attempts-v1` journal holds up to 32
attempts, at most 4 MiB + 32 KiB per export record, with atomic writes and exact
readback. No pruning, replacement of other attempts, signing identity rotation
or success-ledger consumption occurs. The initial unsigned pending record is
written before signing. The final signed record replaces only its own pending
record. Snapshots/report JSON have a 2 MiB limit; raw data retains the existing
64-epoch, 128-measurement-per-epoch and 128-fix bounds. Oversized data fails
explicitly instead of silently truncating observations. Full journal or corrupt
inventory fails closed and preserves prior data. App clearing/uninstall removes
app-private retention; explicit public exports must be kept independently.

`unsigned-pending` after process interruption is an uncertain outcome, not a
certificate. Key/signing failure retains `unsigned-signing-failed`. Storage
failure is reported in native status; a current memory fallback can be exported
as `unsigned-storage-failed` or `signed-storage-failed`, but cannot promise
retention after retry/process death. No initial durable write means no signing
is attempted. A final write failure preserves the earlier pending record and
exposes the current in-memory outcome. A process crash may prevent any record;
this version does not claim that every attempt was durably recorded.

Native `listAttempts` and `readAttempt(UUID)` are read-only and do not activate a
sensor, extend GPS preparation, reserve a successful nonce or sign anything.
The Location page's separate failed-attempt panel can refresh, save one or all
retained attempts with their exact native request, and verify an imported report
against independently supplied originals/pins. A composed request keeps its
camera context, but the report describes GPS only; camera outcomes and keys
remain separate. Microphone operation is not involved.

Explicit Save uses the existing public exporter and unique UUID export folders.
`ExportLocations` retrieves `nonverba-gps-attempt-<UUID>.json` and
`nonverba-gps-attempt-request-<UUID>.json` under its existing USB-only guards and
bounds. `VerifySavedDownloads` also recognizes these exact public filenames.
Transfer/Downloads checks do not verify signatures, original authority or
physical sensing. A repeated filename can be suffixed by MediaStore; the existing
unsuffixed-file ambiguity reporting still applies.

Yesterday's unsigned logs, including request prefix `c1a5a22c4de3`, remain
unchanged historical observations. They are never inputs to native signing and
are not converted to contemporaneous signed reports.

## Validation

The dated [validation record](VALIDATION.md) records software, package and phone
results separately, including failed harness runs. Synthetic Rust/JCA/JNI/WASM
tests exercise real signatures with synthetic observations; they do not establish
Android Keystore or physical collector production. Physical testing is limited
to authorized quiet GPS checks with the phone stationary. Microphone recording,
tones, playback and calibration remain held.

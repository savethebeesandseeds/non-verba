# Camera-set profile and preparation contract

Implemented software foundation, 16 October 2026. The shared Rust
[`camera_set`](../../code/crates/nonverba-core/src/camera_set.rs) module validates
an explicit camera set and assesses supplied capability and exposure-start
claims. It does not open a camera, sign images, grant consent or accept evidence.
The subsequent [camera-set implementation](CAMERA_SET_IMPLEMENTATION.md) adds
request-bound multi-image signing, explicit native sequential/concurrent modes and a browser
single-camera route. Physical acceptance and the remaining failure-retention work
remain separate. The validation record below describes the original profile-only
checkpoint; the implementation record covers the later integration checks.

## Required camera set

Version 1 has two explicit kinds:

| Kind | Required members | Timing shape |
| --- | --- | --- |
| `single-camera` | Exactly one named camera; front, back, external or unknown facing | `{"mode":"single"}` |
| `front-back` | At least one named front camera and one named back camera; additional named cameras remain required | Explicit `{"mode":"sequential"}` or `{"mode":"concurrent","max_start_skew_ns":"..."}` |

On 16 October the owner selected sequential capture after the connected phone
reported no concurrent combination. One operator shutter may therefore collect
rear then front at different times. This is a separate signed timing mode, not a
fallback for an existing concurrent request. The profile's camera-list order is
the required sequential order; the trial builder selects rear before front.

Camera IDs are opaque, case-sensitive, device/adapter-scoped identifiers. They
must be unique within the profile, nonblank, contain no control characters and
fit 128 UTF-8 bytes. They are not human identities or permanent cross-device
identifiers. A profile lists 1–16 cameras; 16 is a resource bound, not a claim
about available hardware. Input JSON is limited to 16 KiB. Unknown fields,
versions, enum values, duplicated JSON fields and inconsistent kind/timing
shapes fail validation.

The requester must select the explicit set before dispatch; capability discovery
does not silently rewrite it. A computer with one camera can use `single-camera`
without inventing a rear/front partner. A phone request requiring front and rear
cannot become single-camera because one member is unavailable. Additional
physical cameras are included by identity when the selected profile requires
them, rather than inferred from lens count or a logical camera name. Whether a
request covers every available physical camera must be stated in the eventual
request/selection contract; this module cannot discover hidden hardware.

## Capability preparation is not authorization

`assess_capabilities` compares the exact required IDs and facings with supplied
adapter observations. It reports missing IDs and facing mismatches independently
of the concurrency advertisement:

- `not-required`: single-camera or explicit sequential capture requests no concurrency.
- `advertised`: one advertised combination contains all required cameras.
- `not-advertised`: combinations were reported, but none covers the required set.
- `unknown`: concurrency discovery is unavailable or was not performed.

`concurrent_sets: null`/absence and `concurrent_sets: []` deliberately differ.
Inventory IDs must be unique; advertised groups contain 2–16 distinct inventory
IDs, cannot repeat in another order and are limited to 64 groups. Advertising a
group cannot erase missing/incorrect camera membership. An advertisement is
neither stream-configuration admission nor a ready/authorized capture result.
These functions have no sensor, key, filesystem or network operations.

Android's [CameraManager reference](https://developer.android.com/reference/android/hardware/camera2/CameraManager#getConcurrentCameraIds())
distinguishes concurrent camera combinations from support for the selected
session configuration. Its camera-ID list also excludes physical cameras usable
only through a logical camera. Future Android integration must preserve those
limits and explicitly check the selected JPEG/preview configuration; this module
does not pretend that an advertised combination validates that configuration.

## Timing claims

There is no default simultaneity tolerance. `max_start_skew_ns` must be supplied
as a canonical unsigned decimal string fitting `u64`; leading zeroes, negative,
floating-point, exponent and overflow representations fail. Zero requests equal
reported exposure starts. The request author chooses a tolerance for the task;
no recommended production value is selected here.

`assess_timing` operates on supplied per-camera exposure-start counters and
explicit clock-domain IDs. All required cameras must be present exactly once.
Extra/duplicate cameras or malformed counters fail; missing observations, absent
timestamps, absent timebases or different clock domains are `unassessable`.
Comparable claims pass only if `max(start) - min(start)` is at most the requested
tolerance, with exact integer arithmetic and an inclusive boundary. A legitimate
single-camera record receives `not-required`, not multi-camera timing credit.

Sequential assessment requires strictly increasing exposure-start claims in the
declared profile order, independent of transport/image array order. It returns
`sequential-order-confirmed` or `sequential-order-violated`; missing or different
clocks remain `unassessable`. The report includes the exact decimal nanosecond
exposure-start span for comparable verified members. For two cameras this is the
rear-to-front gap. No default maximum gap or simultaneity claim is introduced;
the native attempt, request, processing and per-image GPS freshness bounds still
apply. The signed original profile prevents sequential evidence from satisfying
a concurrent request, even if its observed gap happens to fit that tolerance.

Callbacks, request submission times and file arrival must not substitute for
exposure starts. No cross-clock mapping, uncertainty calibration, exposure
overlap or physical simultaneity is established by this arithmetic. A common
clock-domain ID is an adapter claim, not remotely attested time. A later verifier
must obtain these fields from verified artifacts, not an operator-supplied
standalone timing verdict.

## Collection and consent handoff

The selected set, intended source views, recipients, task and timing requirement
must be shown before deliberate consent and frozen with the eventual original
signed request. Front-camera inclusion is an additional view, not face
authentication or permission to publish biometric data. Every required camera
needs valid permission and the applicable work-state authority. The shared grant
must bind the principal, device, operation, current authoritative work-state
revision, purpose, sensors, recipients, consent and validity. No capability query,
login, reconnect or status read authorizes collection.

Hero 1 supplies these collector requirements and per-camera evidence semantics;
Hero 2 supplies authority/privacy policy, Hero 3 participant task/consent meaning,
Hero 10 Android permission/lifecycle integration, Hero 8 operation/status/cancel
interfaces and Hero 11 any selected hosted exchange. Authority provenance,
offline validity, the exact grant schema, supported adapters/devices, stream
configuration and task-specific timing tolerance remain unresolved inputs to
integration. This software contract selects no account authority, background
capture, fallback or institutional policy.

## Required terminal outcomes for integration

The future bundle/collector must keep each expected camera's outcome distinct:

| Observation | Attempt interpretation |
| --- | --- |
| Every required image is acquired, verified and within the required assessable timing | Candidate complete collection; receipt, current authority and explicit acceptance remain separate |
| Some required images exist; another required camera is missing or fails | Partial attempt; preserve available originals and the missing/failed member |
| No required image is produced after collection starts | Failed attempt; retain available diagnostics and explicit absent artifacts |
| A required camera/configuration cannot be supported before collection | Unsupported request; do not substitute another mode or single-camera capture |
| All images exist but timing fails or cannot be assessed | Images retained, requested timing failed/unassessable; no simultaneous-profile success |

These are integration requirements, not new signed failure formats implemented
by this module. Signature/report availability, unsigned fallback, storage failure,
expiry and cancellation remain separate fields. Cleanup distinguishes confirmed
release, failed cleanup with retained ownership and unknown release. Neither an
acknowledgment nor lease expiry proves an unreachable device stopped. A retry
requires its own valid authority/request; it cannot replace the failed attempt.

## Validation scope

Focused Rust tests exercise single-camera and front/back policies, missing and
additional members, duplicate/unknown combinations, unavailable concurrency,
strict JSON, bounded work and exact timing beyond JavaScript's integer range.
Their source is
[`camera_set_tests.rs`](../../code/crates/nonverba-core/src/camera_set_tests.rs).
On 16 October 2026, `cargo test --locked --offline -p nonverba-core camera_set`
passed all 12 focused tests in the existing managed Debian container. The same
source snapshot was formatted with the existing Rust formatter; only the two
formatted module/test source files were copied back, with matching SHA-256
values. The test run compiled the core crate but filtered out 317 other tests;
it is not an aggregate-suite result. No dependency installation, APK, phone
operation, camera capture, screenshot collection or physical acceptance ran.

An additional nested-policy regression initially found that Serde's internally
tagged unit variant ignored extra fields in `single` timing. The variant is now
an empty struct variant, which rejects those fields; the expanded 12-test suite
passes. The intervening stale Rust match-pattern compile error was corrected.
The failed checks remain part of the recorded development history, rather than
being counted as passes. The final formatted source copies match the passing
snapshot's module/test hashes.

This completed the bounded software profile/preparation foundation. See the
[subsequent integration record](CAMERA_SET_IMPLEMENTATION.md) for later work and
its remaining limits.

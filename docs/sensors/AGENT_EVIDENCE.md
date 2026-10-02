# Agent evidence appraisal

Non-verba is intended primarily for agent use, including future full MCP workflow
control. This page describes the implemented appraisal API. The separate
[agent workflow and MCP requirements](../development/AGENT_WORKFLOWS_MCP.md) record the planned
control surface and its authorization, lifecycle and durable-state requirements;
they do not imply that an MCP server already exists.

The requester retains the original request, its acceptance policy and independently
enrolled key identifiers. The operator must not supply the authoritative copies of
those inputs at verification time. Hash the photo/audio signing certificate for a
media pin; hash canonical SPKI DER for a location pin. They are different pin
conventions. Attestation binding additionally uses the actual signing key's SPKI
digest, including for media whose artifact pin identifies a C2PA certificate.

## Rust and WASM interface

The `agent_appraisal` module reruns the actual signature, exact-request, byte-binding
and sensor-specific verifier before applying the requester's requirements. It never
accepts a caller-supplied verification report as evidence.

These exported functions return JSON and are also available through `core-worker.js`:

- `appraise_location(proof, original_request_json, location_spki_pin,
  expected_asset_json, policy_json, now_secs)`; use `"null"` for standalone location.
- `appraise_image(jpeg, original_challenge_json, media_certificate_pin,
  policy_json, now_secs)` for metadata-only camera requests.
- `appraise_camera_location(jpeg, location_proof, original_location_request_json,
  media_certificate_pin, location_spki_pin, policy_json, now_secs)` for composition.
- `appraise_audio(wav, original_request_json, original_transcript_json,
  media_certificate_pin, policy_json, now_secs)`; the transcript must be the copy
  independently retained by the requester, including actual chunk arrival times.

All fields for the selected policy version are mandatory, unknown fields fail, and unsupported requirements
remain unsatisfied. Example for a standalone native location proof with raw GNSS:

```json
{
  "version": 1,
  "native_acquisition_required": true,
  "raw_gnss_required": true,
  "correlated_camera_clock_required": false,
  "hardware_attestation_required": false,
  "independent_position_required": false
}
```

Set `raw_gnss_required` to false for camera/audio-only appraisal. For a combined
photo, setting it to true requires the matching independently verified raw GNSS
proof. Set `correlated_camera_clock_required` for a Camera2 REALTIME timestamp;
devices with UNKNOWN camera timebases then fail that policy. It does not claim
audio-camera clock correlation. AAudio uses CLOCK_MONOTONIC; Camera2 REALTIME and
native location use Android's elapsed realtime clock, which includes suspend time.

`native_acquisition_required` requires a valid native acquisition assertion or
native location profile. This is still a signed application claim under the enrolled
key. It does not establish a remotely authenticated OS or a trusted sensor bus.
For composed camera/location evidence, this flag checks the camera acquisition.
Require native location separately in the original location request's profile,
or require raw GNSS; it is not an implicit requirement that every composed sensor
use a native collector.

Policy version 2 adds the mandatory boolean `audio_recording_monitoring_required`.
Its other six fields are identical to version 1. Version 1 must omit this new field;
version 2 must include it, and `null` is invalid. Version 1 serialization is
unchanged, so retained signed session requests remain verifiable. A version change
without its matching field shape is rejected.

For monitored audio, use `version:2` and
`audio_recording_monitoring_required:true` in the independently retained policy.
The requirement passes only after the actual WAV and native acquisition assertion
verify, including the signed recording configuration's ordered observations,
coverage, source, route, effects and privacy checks. Browser audio and historical
native records without the whole configuration object fail this requirement;
they remain readable and may satisfy the older native-acquisition requirement.
This audio-only requirement is unsatisfied for camera and location evidence.
Set it to false explicitly in a version 2 policy when it is not required.

The corresponding result check is `audio_recording_monitoring`. Inspect its
`established` value to learn what the verified recording contains. Operator UI
capabilities are useful for planning but are not verification evidence. For camera
clock capability, the existing `correlated_camera_clock_required` similarly
requires a verified REALTIME acquisition assertion rather than trusting the
operator's capability advertisement. These requirements describe authenticated
application metadata; neither establishes a trusted sensor bus.

The basic APIs above leave `hardware_attestation_required` and
`independent_position_required` unsatisfied because they receive no independently
retained enrollment or navigation inputs. Version 0.5 adds separate context APIs
that can establish those capabilities at the restricted levels described below.
Local KeyInfo, signed raw GNSS alone and operator-provided verdicts remain
insufficient.

## Additional verifier context (0.5)

Each basic API has an exported `_with_context` variant, with the same arguments
and one `context_json` argument immediately before `now_secs`:

- `appraise_location_with_context`
- `appraise_image_with_context`
- `appraise_camera_location_with_context`
- `appraise_audio_with_context`

The context is a versioned JSON object capped at 4 MiB. Unknown fields fail. Its
three optional entries are inputs for actual cryptographic or mathematical
verification, not saved reports:

| Context entry | Contents and use |
| --- | --- |
| `key_attestation` | `{ "chain": ..., "expected": ..., "trust": ... }` for the actual primary signer: location SPKI for standalone location, media signer SPKI for camera/audio |
| `location_key_attestation` | The same three inputs for the separate location signer in a composed camera/location proof; rejected for other workflows |
| `position` | `{ "navigation_json": "exact retained navigation JSON bytes", "policy": ... }`; valid only when a signed location proof is supplied |

Use `{"version":1}` for an empty context. It produces the same appraisal as the
basic API. Set the corresponding evidence-policy requirement to true when a task
must depend on that capability; inspect the additional report even when the
capability is optional.

For enrollment, the requester first creates and retains a typed request with
`create_key_enrollment_request("media" | "location", now_secs)`. The Android
enrollment page generates a separate challenged key without replacing or selecting
an existing identity. The requester independently calls
`verify_key_enrollment(response, original_request, policy, trust,
response_received_at, now_secs)` and retains the locally produced `expected`
object, original response chain, policy, arrival observation and resulting pin.
`trust` must contain independently obtained root pins and a current complete
revocation snapshot; refreshing it is the verifier's responsibility. Never import
an operator's saved enrollment verdict as these expectations.

The context verifier rechecks the chain, original enrollment challenge, expiry,
revocation, app identity, boot state and hardware/patch policy. It compares the
attested SPKI with the signer extracted from the newly verified sensor artifact.
That artifact signature establishes key possession. A composed photo must bind
and validate both its media key and its location key to satisfy
`hardware_attestation_required`.

The Google profile uses a restricted compiled root set plus the verifier's own
allowlist. `private-test` chains never satisfy the hardware requirement. Attestation
describes the key and boot/app claims at key generation; it does not establish
current OS/app integrity or the origin of a later sensor sample. Application
identity is Android-software-reported within the signed extension. The certificate
validator intentionally rejects unsupported profiles rather than weakening checks.
See [key attestation](KEY_ATTESTATION_VERIFIER.md) and
[native enrollment](NATIVE_KEY_ENROLLMENT.md) for exact schemas and compatibility
limits.

For independent position, `navigation_json` is separately acquired GPS LNAV data;
the required `position.policy.nav_sha256` pins its exact UTF-8 bytes. The solver
re-verifies the signed location proof, recomputes every retained GPS L1 C/A epoch
from its code observations, fits receiver clock bias, and checks residuals,
geometry and every reported fix under the retained position policy. A composed
photo also binds that location proof to the complete final JPEG hash. All of these
checks must pass to establish `independent_position_required`.

This is a GPS position/clock consistency check. It does not solve velocity,
authenticate navigation transport or satellite signals, prove physical location,
or supply a trusted clock. A forged but mutually consistent observation set is
still possible under a compromised collection path. The verifier must obtain
navigation data and the GPS/UTC offset independently. The separate bounded
[RINEX 3 importer](../../code/crates/nonverba-core/src/location_proof/position/importer/README.md)
accepts the independently retained source hash and capture window, then returns
`navigation_json` and `navigation_sha256` for this context and its policy. It
retains at most 128 applicable GPS LNAV records and discloses skipped records;
import success never substitutes for the signed-observation verifier. There is no
automatic navigation fetcher or authenticated provider service. See the
[position profile](../../code/crates/nonverba-core/src/location_proof/position/README.md)
for its exact supported signals, bounds, algorithms and independent test oracle.

## Reading the result

| Field | Meaning |
| --- | --- |
| `evidence_verified` | The underlying verifier's signature, request and evidence checks passed |
| `policy_satisfied` | The evidence passed and every explicitly required capability is established at the supported level |
| `checks[].established` | The corresponding capability is present in verified evidence; absent requirements do not imply presence |
| `missing_requirements` | Requirements preventing acceptance under this policy |
| `request_window_open` | Caller-supplied current time is within the original request window |
| `fresh_action_eligible` | Policy and current window pass, and this is not demo evidence; caller must still check its replay ledger |
| `verification` | Full sensor-specific report, including metadata, uncertainty, errors and limits |
| `additional_evidence.key_attested` | Actual signer-bound enrollment met the supported hardware policy; for composition both keys passed |
| `additional_evidence.position_verified` | Independent position, residual/geometry and reported-location checks all passed |
| `additional_evidence.signing_key`, `location_key`, `position` | Complete separately rerun reports; absent inputs remain `null` |

No appraisal writes acceptance state. `acceptance_recorded`, `local_replay_checked`
and `global_replay_checked` remain false. `physical_measurement_authenticity_proven`
and `device_clock_trusted` also remain false. Treat exceptions as failure, never as
permission to retry with a weaker policy. Keep historical verification separate
from authorization to take a fresh action.

## Requester timing

The live location page pairs before it creates the sensor challenge. An armed
operator receives a new signed request only when the requester begins its timer.
The requester records complete proof arrival before asynchronous verification,
then signs a COSE receipt binding the exact proof and original signed request.
Verify it with `verify_live_session_receipt` using the independently retained
original request and requester/operator pins. Check both the location appraisal
and receipt; neither substitutes for the other.

The requester reserves both the live session identifier and underlying sensor
challenge before transmission. Acceptance is atomic in the local requester ledger.
A signed receipt authenticates the requester's timing assertions; it does not
authenticate that clock or prove an independent observer. Same-device demos carry
a signed demo marker and cannot authorize fresh acceptance.

Audio continues to use successive unpredictable challenges: receive the preceding
two-second PCM segment first, then generate the next nonce. The requester retains
the segment hashes and arrival times independently of the final C2PA WAV.

## Remaining operational and physical validation

The verifier algorithms and enrollment interface are implemented. Production use
still needs maintained trust/navigation inputs, a durable requester enrollment and
acceptance service, and a deployment-specific app/signing policy. The enrollment
page's initial policy pins the development APK and must be reviewed for any other
deployment. No operator account service or authenticated navigation provider is
invented by the app. Play Integrity or another fresh capture-time integrity service
would need separate integration and actual service configuration.

The shared [evidence-session API](EVIDENCE_SESSIONS.md) connects requester receipt
checking, actual sensor appraisal and local atomic task acceptance. Its browser
controller is `web/src/agent-requester.js`; it is a transport-independent agent
integration API. Existing interactive pages retain their individual workflows.
All app ledgers are local to one browser/app profile and do not provide replay
exclusion across requesters, devices, or the separate legacy workflow ledgers.

Physical device validation must measure supported microphones and speaker paths,
camera timestamp behavior, GNSS availability, CPU/signing delay, route changes,
revoked permissions and deliberate replay/injection cases. Synthetic tests are
identified separately in [the validation record](VALIDATION.md). Passing host or
synthetic browser checks does not establish phone compatibility, a real hardware
attestation chain or physical measurement authenticity. Release packaging and
device-validation status must be read from that record rather than inferred from
these API descriptions.

# Complete sensor packages

New requester forms default to the fullest currently implemented collection
profile for their selected sensors. Reduced profiles remain available inside
closed **Details and reduced profiles** controls. A visible summary always
describes the actual selection, including after a reduced profile is chosen.
These are new-request defaults, not a rewrite of existing signed requests,
saved evidence, demo protocols or low-level Rust API defaults.

| Requester workflow | New default | Returned evidence |
| --- | --- | --- |
| Camera with location | Native/raw GPS location proof, two-second minimum with at least three fixes/epochs; Android uses native camera acquisition | C2PA JPEG with GPS and available camera acquisition metadata, plus a separate signed location proof with raw receiver/satellite observations and the exact JPEG digest |
| Live camera with location | Same raw location requirement plus required native camera and correlated capture clock | JPEG and location proof, original signed requester request, exact verifier context, independently supplied key IDs, signed complete-arrival receipt and verification report |
| Standalone location | Native GPS with required raw measurements, two-second minimum and at least three fixes/epochs | Signed location proof and original request; camera and microphone remain unused |
| Live location | Same raw location profile | Location proof, original signed request/context, independently supplied key IDs, requester receipt and verification report |
| Live audio | Ten seconds of native Android monitored recording | Signed WAV with native acquisition/recording-configuration observations, original request, acoustic transcript and final requester receipt |

The package is a logical set of existing artifacts, not a new archive or signing
format. Keep all indicated artifacts together; a camera JPEG cannot replace its
required location proof. File exchange alone does not create a requester receipt.
The current USB helper remains development transport, and live phone WebRTC
connectivity is still a separate unresolved gate. Full MCP service control is
planned in [the agent requirements](../development/AGENT_WORKFLOWS_MCP.md).

## Preparation and failure behavior

The requester selects the profile before issuing a fresh timed challenge. Live
operator preparation checks native location availability and the raw-GNSS API
flag before pairing/consent; monitored audio rejects a known unsupported operator
before joining. These checks only read capabilities and do not activate sensors.
They cannot predict satellite reception, clock quality or a usable raw trace.
Android receiver preparation is separate: the bounded foreground GPS warm-up
described in [GPS performance](STATUS.md) may already be running when
the operator opens a camera/location page with existing precise permission.
Its fixes are discarded and never count toward a request.
The existing collectors and Rust validators enforce the complete signed policy
during collection and verification. Missing required data fails explicitly.
There is no new best-effort raw mode and no automatic fallback after dispatch.

A browser can request and verify a complete Android package. To collect with a
browser or a less capable device, the requester must explicitly select a reduced
profile and create a new request. Previously created requests keep their original
policy. Requester and operator roles, independently trusted pins and explicit
consent remain separate.

Camera and location retain concurrent collection: a fresh GPS observation is
selected for the photo while the remaining trace can finish afterward. Audio
does not become part of camera/location collection. Its current protocol uses
speaker pilot/probe sounds as well as the microphone; recording, playback and
calibration remain on hold during development until separately authorized.

## Complete collection versus assurance

Complete means the implemented sensor evidence required by the selected profile,
within existing duration, quality, size and lifecycle limits. It does not mean
maximum recording duration, every possible sensor field, or established physical
truth. Optional fields remain explicitly absent when the device does not report
them. A successful signature is distinct from current freshness and committed
acceptance.

Hardware key attestation and independent position recomputation remain explicit
additional requirements. Their independent chains/trust inputs or navigation
data cannot be inferred from a selected profile, device capability or operator
report. They are not enabled by default. Selecting them freezes stronger policy;
missing or rejected context must not be presented as a successful verification.
The available phone has demonstrated raw-GPS and camera composition, but has not
passed the independent-position or retained hardware enrollment policy.

## Measurement cost observed so far

Exact timing analysis (local review record, not included in this source release)
uses four retained successful phone runs and records 33 unchanged source hashes.
These are a few signed device-clock observations, not a typical-latency promise
or a benchmark with independently trusted physical clocks.

| Stage | Observed interval | Interpretation |
| --- | --- | --- |
| Camera submission to exposure | 196–206 ms | Native capture submission is the available proxy; physical button-touch time was not recorded |
| Exposure start to JPEG callback | 205–211 ms | Includes exposure/readout/encoding/delivery; not just exposure duration |
| Camera submission to JPEG callback | About 405–416 ms | Computed from the preceding two recorded stages |
| Exposure/acquisition to camera finalization entry | 375–631 ms | Entry into finalization, not completed signature/export |
| Standalone raw-GPS collection | 15.814 s | Includes warmup and the requested ten-second trace; first retained fix at 5.730 s |
| Camera + raw-GPS collection | 17.043 s and 21.812 s | Concurrent camera work; first retained fixes at 6.951 s and 5.105 s |
| Location collection end to finalization entry | 0.153 s standalone; 0.781 s and 6.595 s composed | Includes waiting for composition where applicable; final signing completion is not measured |
| Latest separate-requester photo round trip | 132.908 s | Includes human/agent UI, saving and USB export; not sensor acquisition speed |
| Audio | Ten-second recording plus a two-second pilot sample budget | Source-derived only; setup, inter-round delivery and signing add time. Physical microphone/speaker performance is unmeasured |

The early composed run took its photo 7.983 seconds into location collection;
nine GPS fixes and nine uncertainty-separated raw epochs followed it. This
demonstrates overlap rather than a mandatory camera-then-GPS sequence. All
timings above are historical; reopening the report does not renew freshness.

Future performance measurements should instrument preparation, first qualifying
fix/raw epoch, shutter submission, exposure, image delivery, collection end,
signing completion and requester complete-file arrival separately. The first
optimization targets are receiver warmup, composition/signing delay and artifact
transfer overhead. Existing signed requirements remain exact. The later
owner-authorized [GPS optimization](STATUS.md) shortens new raw
requests and prepares the receiver ahead of capture while preserving
quality/freshness checks.

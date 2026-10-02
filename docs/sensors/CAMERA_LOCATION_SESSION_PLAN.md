# Composed camera/location requester session plan

**Status: IMPLEMENTED IN SOURCE; integration/package and physical acceptance remain separate gates.** On 2026-09-29 the composed controller/policy and dual-artifact transport were implemented, with the UI and manual capture integration developed alongside them. The controller has real Rust/WASM + shared-requester validation described below. This document retains the design contract and validation requirements. Existing image-only and standalone workflows remain available. No physical live composed requester session has been validated.

## Pre-implementation baseline recorded 28 September 2026

The table below records the original baseline and work planned at that time. Current controller/test evidence appears at the end of this document and in `CAMERA_SESSIONS.md`.

| Module | Responsibility before this integration | Integration required at that time |
| --- | --- | --- |
| `web/src/camera-session.js` | Image-only pairing, consent, signed request, requester receipt and acceptance | Add explicitly versioned composed pairing, both pins, retained location request/context, composed appraisal and result handling |
| `web/src/camera-peer.js` | Bounded reliable ordered data channel, one JPEG transfer | Add one negotiated two-artifact transfer; preserve the image-only wire format |
| `web/src/camera-session-capture.js` | Manual shutter handoff; currently rejects any location proof | Retain the complete composed request and both pins; return the exact JPEG and proof together |
| `web/src/app.js` | Existing browser/native camera capture and independent location collection | Load the authenticated camera/location request envelope; pass the resulting location proof and checked location key through the live handoff |
| `web/src/camera-session-ui.js`, `web/src/index.html` | Pairing, consent, lifecycle guards, exports and explicit acceptance | Add explicit composed profile, location pin/context controls and proof export; preserve current cancellation and image-only controls |
| `web/src/camera-location.js` | Camera/location request envelope and separate proof-file encoding | Reuse its typed request envelope and existing export format |
| `web/src/location-policy.js` | Explicit browser/native/GNSS/raw acquisition presets | Reuse the selected preset exactly; do not weaken it during capture |
| `web/src/location-capture.js`, `web/src/location-platform.js` | Independent begin/finalize collection and bounded COSE proof | Reuse without making location dependent on the camera session implementation |
| `web/src/camera-platform.js` | Native preview/shutter bridge and location submission | Reuse the existing native composed acquisition path |
| `web/src/agent-requester.js`, `web/src/agent-evidence-storage.js` | Request reservation, complete-artifact arrival, raw verification, retained evidence and atomic acceptance | Already support primary and secondary artifacts; no storage redesign is proposed |
| `code/crates/nonverba-core/src/evidence_session/` | Typed camera-location request, exact dual-artifact receipt and policy verification | Existing shipped APIs suffice; no new cryptographic protocol is proposed |
| `code/crates/nonverba-core/src/agent_appraisal/context.rs` | Independent verifier context, both signer attestations and optional position recomputation | Reuse its existing schema and verification; never accept supplied reports |

The live-location migration supplies the corresponding standalone conventions. `camera-session-policy.js` has its own bounded composed context validator, explicitly allowing `location_key_attestation`; the standalone location validator remains unchanged.

## Frozen authority and compatibility

Keep image-only pairing/version 1 and its current public API behavior intact. Introduce an explicit version 2 composed offer/answer with strict keys, a pairing ID, requester SPKI pin, media certificate pin, location SPKI pin, agreed task/acquisition requirements and exact verifier-context digest. A version 1 peer must reject composed pairing instead of silently treating it as an image-only request. Pair and obtain operator consent before creating a fresh sensor challenge.

The signed Rust session spec remains version 1, with `evidence.type:"camera-location"`. Its original location request supplies the same challenge used by the JPEG and has `context.purpose:"camera"`; set its composition session identifier once before signing. Retain that complete request, not merely its challenge. Freeze both typed operator pins, the full location acquisition policy, EvidencePolicy and delivery limits. At dispatch the operator must authenticate the requester wrapper against its independently known requester pin and independently selected local signing keys, then compare the exact allowed task and policies. Recheck both local keys before collection/finalization; changing a key requires a new session.

The requester context belongs to the requester. Both participants load the exact configuration before pairing and compare its digest; preserve its original UTF-8 bytes throughout verification/export. Minimal `{"version":1}` remains valid when stronger requirements are explicitly false. For composition, `key_attestation` applies to the verified media signer, `location_key_attestation` to the verified location signer, and `position` carries independently retained navigation bytes and policy. A hardware requirement needs both actual signers to qualify. A position requirement needs successful recomputation from the signed raw observations and retained navigation context. Do not derive trust policy from returned artifacts or operator reports. The signed request freezes EvidencePolicy; the receipt binds the exact context bytes. Do not imply that the existing Rust request itself contains a context binding.

A native camera requirement does not implicitly require a native location trace: the composed appraisal's `native_acquisition_required` concerns image acquisition. Require the location request's native profile/provider explicitly when that is intended. A raw requirement must require raw collection in the sensor request as well as the corresponding evidence-policy check. A missing native bridge or unavailable raw observations must fail rather than downgrade.

Ordinary standalone/composed camera APIs, location APIs, their signed formats and exports must remain compatible. Imported historical verification remains separate from live requester acceptance.

## Bounded transfer API

The source interface is:

```js
new CameraPeer({
  mode: 'image-v1' | 'camera-location-v2',
  authorizeArtifacts: ({primaryBytes, secondaryBytes}) => boolean,
  onArtifacts: ({primary, secondary}) => void,
  // Existing message, connected and failure callbacks remain.
});
await peer.sendArtifacts({primary: jpegBytes, secondary: locationProofBytes});
```

Preserve existing `sendArtifact`/`onArtifact` behavior for image-only callers. Negotiate the composed mode through the versioned pairing; use a distinct composed data-channel label. Continue using one reliable ordered data channel with no media tracks, signaling service, STUN or TURN.

The composed wire header is exactly:

```json
{"type":"artifact-set","version":2,"primary_bytes":12345,"secondary_bytes":6789}
```

Require safe integer lengths, both nonempty: primary at most 32 MiB; secondary at most the existing `MAX_LOCATION_PROOF` (2 MiB plus 16 KiB framing allowance). Validate the expected requester role/session phase and receive explicit application authorization before allocating either buffer. Allow exactly one set per direction/session. Reject unknown header fields, image-only/composed mode substitution and repeated headers.

Send JPEG first, then COSE proof. Each binary frame has the existing four-byte little-endian offset followed by at most 16,000 bytes. For composed mode the offset is global across both artifacts. A frame must contain exactly `min(16000, remaining bytes in the current artifact)` bytes; it must not cross the artifact boundary. The next proof frame starts at the JPEG length. This allows two bounded destination arrays without concatenating an additional aggregate buffer. Snapshot both outbound arrays before sending so caller mutation cannot change an in-flight transfer.

Preserve current control-count/size limits, fragment-stall deadlines, send backpressure, cancellation and disconnect behavior. Reject controls interleaved with the active artifact set. A partial JPEG, a completed JPEG without its proof, or a partial proof cannot yield a receipt or success event. The application response deadline remains authoritative even if a transport deadline is longer.

## Acquisition, arrival and acceptance

Reuse the manual shutter workflow. The app already starts an independent location window after native shutter intent, supplies the selected fix to NativeCamera, and finalizes a separate location proof bound to the complete signed JPEG. The browser composed path similarly uses independent begin/finalize location collection around capture. The live handoff must retain the exact location request and both pins, check its returned artifacts, and call `appraise_camera_location_with_context` with those originals before sending.

On the requester, call `AgentRequester.receive(sessionId,{primary,secondary})` synchronously from the callback delivering the completed second artifact, before copying, decoding, hashing, appraisal or UI work. This is the sole complete-response arrival observation. Do not timestamp a header, first fragment or JPEG-only completion, and do not stop the requester's response timer until both full artifacts arrive. The existing controller records wall and monotonic time and verifies both raw artifacts before signing its receipt.

Keep existing bounds: challenge wrapping/dispatch within five seconds, maximum response interval 180 seconds, receipt sealing within 30 seconds of complete arrival, selected receipt-age limit (currently 60 seconds for live camera), and original sensor expiry. Keep the location trace minimum duration and native collectors' existing shorter deadlines. Do not reapply the initial five-second dispatch-age check after a legitimate human shutter delay; the retained authenticated wrapper remains authority.

Retain and export three originals: JPEG, separate location proof and requester session bundle containing the original signed request/receipt/context. The operator verifies the returned receipt against its own exact artifact pair and retained authority. Requester acceptance remains a separate action that reruns raw verification, applies current expiry/receipt-age checks, and atomically reserves session and sensor nonce with the current-context guard. A saved verdict or receipt import cannot replace that workflow. Normal completed transport closure may retain acceptance eligibility; explicit cancellation, replacement or pagehide invalidates an in-flight acceptance.

## Minimum focused validation

Use actual shipped Rust/WASM signatures, C2PA images, COSE proofs and requester receipts for these tests; label all fabricated sensor inputs synthetic. Transport/DOM/transaction doubles exercise orchestration and do not establish actual browser implementations.

1. A correctly signed composed pair completes controller delivery, verifies its receipt and can be accepted exactly once. Existing image-only and standalone location regressions still pass.
2. Missing/swapped/truncated proofs, a proof bound to another JPEG, a changed JPEG, either wrong signer pin, an altered complete location request, and policy/context substitution fail. Bare image submission cannot satisfy a composed request.
3. The first completed JPEG produces no arrival observation or receipt. Delaying the final proof beyond the response limit or sensor expiry fails. Arrival precedes hashing/async verification, and sealing or acceptance after its respective bound fails.
4. Header authorization happens before allocation; oversized/zero/unsafe lengths, mode substitution, boundary-crossing/wrong-offset fragments, duplicate sets, interleaved controls, stalls and disconnection between artifacts fail closed. Mutating outbound buffers after send starts cannot change retained bytes.
5. Cancellation during location collection, native/browser finalization, receipt verification and the actual acceptance transaction prevents a late success or commit. Successful normal closure still permits explicit acceptance.
6. An explicitly native location request rejects a valid software trace even with a valid native camera JPEG. Raw-required acquisition rejects missing raw observations without downgrade.
7. Real signed raw synthetic fixtures satisfy independent-position policy with the retained pinned navigation context; missing/wrong navigation context fails even if a requester re-signs its changed receipt. Existing Rust coverage is in `evidence_session/tests_position.rs`.
8. Composed hardware policy requires both independently revalidated signer attestations. One qualifying key or an attestation for a different artifact key cannot satisfy it. Private-test credentials never establish hardware trust.
9. Pairing emits no challenge; consent freezes both identities and requirements. Pre-challenge own-file-picker lifecycle handling stays bounded; active acquisition/pagehide cannot resume. UI offers both exact artifact exports and cannot silently switch to metadata-only capture.

## Remaining physical gates

No physical browser-to-phone direct WebRTC composed route has been validated. Local HTTP/USB preview reachability does not establish an ICE route. Actual Android picker/permission event ordering, simultaneous camera/location lifecycle, collector deadlines under real load, full artifact transfer and independently witnessed requester dispatch/arrival still need explicit device testing.

The available phone has produced a locally verified ordinary location proof, but raw-GNSS observations remain unavailable in the recorded physical attempts; no raw/PVT capability claim follows from synthetic tests or OS capability metadata. Native camera and location signatures remain application-visible acquisition evidence, not proof of an authentic scene, an unspoofed physical position, a trusted clock or independent people/devices. Microphone testing remains outside this plan and under the existing sound hold.

## Controller implementation evidence — 29 September 2026

`camera-composed-session-tests.mjs` executes the actual `CameraSession`, `AgentRequester` and shared durable-storage code with synthetic sensor inputs and transport/IndexedDB doubles. Real shipped Rust/WASM creates and validates independent media/location signatures, the complete composed request, two-artifact receipts and replay-protected acceptance. The suite verifies that a completed JPEG cannot timestamp arrival, that the complete proof callback invokes the requester synchronously, and that a Buffer-backed caller cannot mutate bytes held across asynchronous sealing. It covers artifact/pin/request/policy/context substitution, native/raw downgrade refusal, response/seal/receipt-age limits, both key checks, and cancellation through the actual acceptance transaction. Existing image-only tests remain unchanged and pass alongside it. This is source/test evidence, not a release-build or physical-routing claim. See the retained `camera-composed-controller-20260929` QA report for exact commands and source hashes.

A focused Rust regression in `agent_appraisal/context_tests.rs` now creates a real composed C2PA JPEG and file-bound COSE proof with two separately enrolled private-test signing keys. Both actual signer bindings and possession checks succeed; missing, swapped and wrong-key contexts cannot satisfy composed hardware policy. Private test roots remain untrusted for hardware, even when both artifact bindings succeed. This does not establish a production-attested positive case or a physical sensor acquisition. All six context tests passed in Debian on 29 September 2026 (the optional fixture-export test performs no export unless requested).

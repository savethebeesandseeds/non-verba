# Shared live-location requester sessions

The interactive live-location.html page uses the common evidence-session protocol
and AgentRequester. The standalone/offline collector and signed proof format are
unchanged. Camera and microphone are not activated. Existing bounded LivePeer
transport is reused without another server, relay, STUN configuration or port.

## Agreement and acquisition

Version-2 pairing contains public pins, an independent pairing ID, task/profile
hints, explicit optional requirements, demo flag and SHA-256 of the exact verifier
context. It contains no challenge. Both public IDs must be obtained through a
trusted channel. The operator rechecks its actual location key at joining,
consent, request admission and proof completion.

Only after connection and explicit operator consent does AgentRequester create
the location challenge and signed shared wrapper, reserve both session and sensor
nonce, then dispatch. The sensor challenge lasts five minutes. Collection requires
ten seconds of observations, complete-proof delivery within 90 seconds, and
fresh acceptance within 60 seconds of receipt arrival.

At initial receipt, the operator authenticates the wrapper, requester/operator
pins, task, exact sensor policy, shared policy, demo flag and delivery limits.
It reserves the sensor challenge and invokes the existing collector outside the
control queue, so cancellation remains responsive. Wrapper admission is not
repeated after the measurement window; acquisition expiry and final receipt
verification keep their existing independent checks.

| Collection choice | Shared native acquisition | Shared raw GNSS | Sensor provider |
| --- | --- | --- | --- |
| Browser or Android | Not required | Not required | Any |
| Native Android | Required | Not required | Any native provider |
| Native satellite location | Required | Not required | GNSS |
| Native raw satellite measurements | Required | Required | GNSS plus raw policy |

Exact sensor policy equality prevents fallback from native/raw to ordinary
browser measurements. Independent position recomputation requires the raw profile.
Hardware attestation and position recomputation remain separate explicit policy
requirements, never inferred from a signature or local capability report.

## Independently retained context

Each participant can paste or load at most 4 MiB of exact JSON before pairing.
The default is {"version":1}. The existing Rust shape permits optional
key_attestation (chain, expected, trust) and position (navigation_json, policy).
The composed-only location_key_attestation field is rejected for standalone GPS.

Attestation-required pairing rejects missing context or an expectation for a
different operator SPKI. Position-required pairing rejects missing navigation
and policy context. Rust performs nested credential, revocation, navigation,
position and policy verification against the actual proof. Shape validation alone
is not a trust verdict, and no trust data is downloaded or guessed.

The operator independently loads the exact agreed context. Its hash must match
the offer before pairing completes. The session retains that immutable string;
AgentRequester durably stores it and the signed receipt binds it. Context JSON
whitespace matters to this exact-byte binding.

The nonverba-location-session-evidence export contains the original wrapper
string, receipt, pins and context. Import requires a separately retained original
request, trusted pins and explicitly supplied exact context. Bundle context never
becomes verifier configuration automatically. Storage/export preserve the original
wrapper string; Rust cryptographic binding concerns the signed COSE bytes and
does not claim harmless outer JSON formatting is a different signature.

## Arrival, cancellation and acceptance

Only complete bounded COSE delivery invokes AgentRequester.receive, synchronously
inside the transport callback before copying, UI work or asynchronous validation.
The requester records its own arrival clocks. Operator timing or saved verdicts
are not accepted as substitutes.

Duplicate control/artifacts and late acquisition completion fail closed.
Cancellation immediately before completion publication or acceptance commit
revokes the current UI authority. The UI passes its exact held result and revision
through the shared atomic acceptance guard. Successful ordinary transport closure
preserves completed evidence for explicit acceptance. Acceptance reruns the
current cryptographic/context checks, receipt-age policy and local replay ledger.

Local demo requests and receipts retain signed demo:true. They may verify
historically but never authorize fresh acceptance. Requester clocks, independent
requesters, physical measurement authenticity and global replay remain unproven.

Verifier input edits invalidate old verdicts and pending verification. Exact text
values and selected File identity are compared after asynchronous reads.
Context imports are bounded, generation-guarded and lifecycle-checked: older
reads cannot overwrite newer selections, manual edits or active pairing.

## Historical compatibility

Explicit Historical location-only v1 mode uses the unchanged Rust
verify_live_session_receipt API. It neither falls back after shared verification
failure nor adds a shared receipt-age policy to old records. Imported records
cannot record acceptance or resume an old session. Old v1 pairing offers request
a fresh v2 pairing. Legacy storage/APIs and standalone location remain intact.

## Focused validation

The live-location-session-tests.mjs suite uses actual shipped Rust/WASM,
AgentRequester and shared storage code with synthetic clocks/location, injected
transport and an in-memory transaction double. It checks consent before nonce
creation, exact retained proof/context, complete-arrival timestamps, signed demo
nonacceptance, strict policy substitutions, native/raw downgrade rejection,
context bounds, receipt-age expiry, guarded local acceptance, duplicate async
start/arm, late cancellation, same-pin requester recreation and explicit legacy
historical verification.

location-verification-input-tests.mjs covers delayed verification/file input
changes and context selection races. The existing browser integration harness is
adapted to shared receipt/storage shapes for the subsequent integrated run.

This focused run does not exercise browser IndexedDB implementation, WebRTC,
Android UI/file pickers, native/raw successful acquisition, physical GNSS,
hardware attestation or playback. WASM intentionally refuses native claims signed
through its software path. Native-positive and physical coverage are separate.

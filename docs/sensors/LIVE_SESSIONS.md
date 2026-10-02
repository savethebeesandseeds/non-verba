# Historical location-only v1 receipts

The active interactive workflow now uses [shared location sessions](LIVE_LOCATION_SHARED.md).
This document preserves the historical v1 protocol and its original behavior.
Legacy exported records remain independently verifiable.

`live-location.html` was the original independent requester/operator workflow. It combined
the existing standalone location collector with direct WebRTC data transport and
the new Rust `live_session` verifier. Camera and microphone are not activated.
No new backend, signaling server, STUN service, or relay is configured; peers
must be directly reachable, normally on the same local network.

## Collection flow

1. Each side obtains the other's public key ID through its trusted channel. A
   dedicated requester software key is stored in its own encrypted IndexedDB
   vault; the location operator continues using its existing browser or native
   location key. Requester SPKI, location SPKI and camera certificate pins have
   distinct protocol types.
2. Pairing offer/answer establishes only the data connection. The offer contains
   a pairing ID, key references and task/policy hints. It does **not** contain the
   sensor challenge, signed request, or an already created sensor request.
3. The operator explicitly allows the displayed collection. The requester then
   creates a fresh sensor challenge and signed session request. Both the session
   ID and sensor challenge ID are atomically reserved in its local ledger before
   transmission. The requester starts its wall and monotonic interval clocks
   immediately before sending the request.
4. The operator validates the signed request against the independently supplied
   requester pin, its own location pin and the task/policy it allowed. It reserves
   the sensor challenge locally and invokes the existing location collector.
   Native/raw-GNSS requirements continue to fail closed on unsupported platforms.
5. The complete signed location COSE proof is transferred in bounded ordered
   fragments. The requester records arrival before queued hashing/validation.
   Rust verifies the actual location proof, original request, operator pin and
   timing policy before the requester signs the final receipt.
6. The requester durably retains its original request, proof, receipt and report.
   A copy of the signed receipt is sent back to the operator for independent
   checking. The requester can explicitly accept the record once in its own
   atomic acceptance ledger. Session and sensor challenge reservations are never
   reset after a failed attempt; a fresh request is required.

The UI currently requests ten seconds of measurements and a 90-second delivery
deadline, inside the underlying 15-minute sensor request window. Raw GNSS policies
are selected using the same presets as standalone location/camera composition.
These are implementation limits, not validated physical-device performance
claims. Backgrounding, cancellation, connection failure or invalid records stop
the session. Complete, durably retained evidence survives loss of the optional
final acknowledgement.

The local demo creates two real peer connections and collects actual device
location, with a signed `demo:true` sensor request. The requester key remains
separate from the operator key but both roles run on one device. Verification
preserves the demo marker and disables fresh acceptance.

## Independent verification

Keep the original signed request, exact location proof and signed receipt.
Verification separately checks both COSE signatures, independently supplied key
pins, exact original-request bytes, artifact hash/length, requester timing and
the complete existing location verifier. A valid requester signature over an
invalid operator proof cannot pass. Public keys included in the files do not
become trust anchors.

The receipt authenticates the requester's delivery assertions and the exact
bytes observed under the supplied pins. `requester_clock_trusted`,
`physical_freshness_proven`, `independent_requester_proven` and
`global_replay_checked` remain false. `fresh_action_eligible` is only a current
time-window predicate; `acceptance_requires_local_replay_check:true` and
`acceptance_recorded:false` describe the stateless verifier's limits. Historical
verification remains possible after expiry without enabling fresh acceptance.

This first phase is a single complete-artifact exchange. The operator's existing
proof format is unchanged and does not bind the extra wrapper session ID. A new
wrapper cannot refresh an old sensor challenge. The UI therefore generates a
new sensor challenge only after pairing/consent and reserves both identifiers.
Native incremental checkpoints and successive location challenges are later
work. Requester signatures do not prove independent physical operators or trusted
clocks, and a local ledger is not a global replay service.

## Code boundaries and tests

- `code/crates/nonverba-core/src/live_session/`: typed protocol, COSE signing,
  immutable-policy validation and independent artifact verification.
- `web/src/live-peer.js`: bounded data-only direct transport.
- `web/src/live-session-storage.js`: requester identity, dual reservations,
  terminal evidence retention and local atomic acceptance.
- `web/src/live-location-session.js`: consent, fresh-request sequencing, timing,
  cancellation and existing sensor collector orchestration.
- `web/src/live-location-ui.js` and `live-location.html`: presentation/export.

Rust regressions cover correctly signed malicious receipts, role confusion,
wrong pins, substitutions, malformed inputs, timing/expiry, demo downgrades and
invalid operator signatures. `code/test/live-location-browser-tests.mjs` exercises
two independent browser contexts, real WebRTC, real Rust/WASM signatures, dual
ledger transactions, a local demo and UI layout. Browser coordinates in that
test are explicitly synthetic; it is not physical GNSS or Android attestation
validation.

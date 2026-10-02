# Live camera sessions

The camera page has a separate **Live camera session** panel. Standard bare camera requests and camera + location-proof composition keep their existing workflows. The live panel can request a photo with signed GPS metadata (pairing version 1), or a photo plus a separate, file-bound location proof (pairing version 2). Both use the existing independent sensor modules and shared requester ledger.

1. The operator reads the camera public ID without starting a sensor and sends it through the requester’s trusted channel. The requester enters that independently known ID, task and camera acquisition policy. For composition, the requester also enters the independent location SPKI ID, selects the location profile, and loads any explicit attestation/navigation context before creating a pairing offer. Its requester identity exists before any fresh challenge.
2. The operator enters the requester ID obtained through a trusted channel, imports/pastes the offer, checks the task and acquisition policy, and prepares permissions before creating its answer. This briefly opens/closes the camera with audio disabled and obtains/discards a location fix; no frame is read or retained. Native camera and precise-location permission flags must pass. The operator then returns the answer. Both peers connect before the operator explicitly allows the task.
3. Only then does the requester issue the fresh signed evidence-session request. The operator validates its original wrapper, requester pin, both selected operator pins where applicable, task, exact sensor/evidence policies, context commitment and dispatch age. The exact authenticated challenge and complete composed location request is loaded into the existing camera controls. The human opens the camera and uses its shutter; no imported JPEG is a capture source.
4. The signed JPEG and, for composition, its separate COSE location proof return on the data channel. The requester timestamps complete-byte arrival only after all required files are complete, reruns the shipped Rust verifier, seals and rechecks the receipt, and retains the exact originals in its local evidence ledger. The operator checks the returned receipt against its own retained request and exact artifacts. Both may save the exact JPEG, matching location proof when required, and request/receipt/context bundle.
5. **Reverify & accept once here** is a separate requester action. It rechecks raw retained artifacts, original authority, context, expiry and receipt freshness, then writes session/nonce keys atomically. A synchronous lifecycle guard is checked again inside that transaction. A saved report cannot authorize acceptance. Storage clearing removes this local ledger; it is not global replay protection.

Completed live results now display a session ID. Save it before reloading, then
open **Retained requester evidence — test lookup after reload**, enter that ID
and click **Load & reverify**. Lookup requires the same browser origin/profile
and retained requester identity. It reloads the original request, receipt,
context and artifact bytes, and separately displays the current Rust verdict,
freshness and existing local acceptance record. Loading or clearing the lookup
does not create a challenge, start sensors, delete evidence or renew freshness.
An explicit acceptance attempt rechecks the originals and current clock; a
second attempt is rejected by the existing atomic ledger. Historical evidence
can remain verifiable after fresh acceptance expires. Edited IDs, cancellation,
backgrounding and Android pause invalidate an in-flight acceptance guard.

The retained panel was validated with actual Linux Chromium, IndexedDB and the
shipped Rust/WASM using signed synthetic image and composed location fixtures.
Page reload, first acceptance, duplicate rejection, expiry and cancellation
passed. This does not establish the physical live browser-to-phone route below.
See [the validation record](VALIDATION.md).

The native-correlated profile requires Android native camera acquisition and a correlated capture clock in the verified JPEG. Browser/software evidence is a separately selected, weaker profile and cannot satisfy the native profile. Camera acquisition and location acquisition are separate requirements: a native camera policy does not imply native location. Composed location options retain the shared browser/native/GNSS/raw presets exactly; unavailable native or raw acquisition fails without downgrade. Optional composed hardware policy requires both actual signing keys to qualify against independent attestation inputs. Independent position requires raw observations and retained navigation/policy context. These checks still do not prove a truthful scene, an unspoofed physical position, independently correct clocks or requester independence. Same-device/self-operated testing remains a demonstration even though the image protocol has no special demo field; the verifier’s explicit authenticity/independence flags remain false.

The camera modules preserve the shared Rust timing limits: challenge wrapping and dispatch within five seconds, a complete response within 180 seconds, receipt sealing within 30 seconds, and fresh acceptance within 60 seconds of receipt and before the sensor request expires. The five-second wrapper check runs on initial receipt, not again after the human shutter delay. The original signed wrapper remains the authority throughout.

## Transport and lifecycle

`camera-peer.js` is camera-only: one reliable ordered WebRTC data channel, no media tracks, signaling service, STUN or TURN. Pairing descriptions are exchanged manually. A directly reachable ICE route is required; existing HTTP/USB preview forwarding alone does not establish it. The 30 September phone preflight accepted the answer's SDP but observed no open data channel before timeout. A working browser-to-phone route and end-to-end physical capture on this path remain unvalidated.

The Android debug test interface also supports a [bounded USB offer/answer file
handoff](../development/USB_DEBUGGING.md#pre-challenge-camera-pairing-files). Staging gives a
32-character token for an explicit **Load staged USB offer** action on the
operator page. It leaves the separately entered requester pin, normal Join,
permission preparation and consent requirements intact. It cannot load into an
active pairing or replace a nonempty offer. No sensor starts on import. Public
answer retrieval uses the existing explicit Save workflow. Physical staging,
import, answer creation/save and hash-checked USB retrieval passed on 30 September.
The operator remained unarmed and no sensor challenge or photo was created.

Before any timed challenge, the bounded `camera-pairing-preflight.mjs` harness
can create an offer, accept only the matching saved answer and record actual
ICE/data-channel state. It never arms the operator or issues a challenge, and
closes its own browser/preview. `--self-test` connected two isolated Chromium
pages in Debian with an open data channel and zero sensor/challenge calls.
This local result does not prove phone connectivity. The controller's 20-second
connection timer starts when the requester connects the answer, not when the
operator creates it. See [validation](VALIDATION.md).

Controls are limited to 64 KiB UTF-8 and 64 messages. Image-only version 1 preserves its existing label and one-JPEG framing. Composed version 2 uses a distinct label and one exact two-length header: JPEG at most 32 MiB and nonempty location proof at most 2 MiB plus 16 KiB. The receiver authorizes both lengths before allocating either array. Ordered fragments carry a global offset, up to 16,000 data bytes, and cannot cross an artifact boundary. Duplicate, interleaved, malformed, oversized, stalled and disconnected transfers fail closed. JPEG-only completion in a composed session creates no arrival observation or receipt; only the complete second file does.

Permission preparation is bounded to 60 seconds, stops a late returned stream after cancellation, and cancels on pagehide. Its own OS permission overlay occurs before any session exists. Capture reacquires its own GPS fix; preparation data never becomes evidence.

Cancellation, active-session backgrounding, navigation and Android pause abort acquisition/transport. No active challenge resumes after suspension. Successful transport closure retains completed requester evidence for explicit acceptance; an intentional cancel/new session/pagehide invalidates any pending acceptance guard.

The only suspension exception is a clicked **answer-file import before any challenge exists**: at most one minute, while requester pairing is still unconnected. Android signals its own document picker before launching it; the UI requires both that signal and the matching file-input intent. Actual pagehide still cancels. The pre-challenge requester instance is recreated on return and must have the identical retained public pin before a challenge can be generated. No sensor or native Activity lifecycle guard is relaxed. This route has DOM/lifecycle tests; actual Android picker behavior still requires a device test.

## Independent context and verification scope

Composed hints commit to SHA-256 of the exact independently loaded verifier-context bytes before pairing. Both peers must load the same bytes. The original signed session spec freezes evidence policy; its receipt binds context bytes. `key_attestation` applies to the verified media signer, `location_key_attestation` to the verified location signer, and `position` to independently retained navigation data and policy. No returned report becomes verifier authority. Context is bounded to 4 MiB. The minimal context remains valid when stronger requirements are explicitly false. Image-only version 1 preserves its original minimal context behavior.


Focused Debian tests use real shipped Rust/WASM signatures, C2PA images and evidence-session receipts for controller/acceptance checks, with explicitly synthetic software media. Transport, DOM and transaction test doubles cover framing, consent, timing boundaries, immutable handoff, cancellation and atomic commit guards. They do not claim physical capture, actual WebRTC connectivity, browser IndexedDB implementation, native picker behavior or mobile visual layout.

Run inside the existing development container (no dependencies required):

```sh
node --test test/camera-peer-tests.mjs test/camera-session-tests.mjs test/camera-composed-session-tests.mjs test/camera-session-capture-tests.mjs test/camera-app-handoff-tests.mjs test/camera-session-ui-tests.mjs test/camera-session-preflight-tests.mjs test/agent-evidence-guard-tests.mjs test/camera-adapter-tests.mjs
```

Implementation is segmented into `camera-peer.js` (transport), `camera-session.js` (authenticated protocol), `camera-session-policy.js` (frozen agreement/context), `camera-session-capture.js` (manual shutter handoff), `camera-session-ui.js` (UI/lifecycle), `camera-session-preflight.js` (discarded permission warmup), shared `pairing-import.js` (bounded pre-challenge answer import), and minimal `app.js` hooks. Cryptography, sensor appraisal and receipt rules remain in the existing Rust/WASM APIs. `AgentRequester` and its durable ledger remain the requester authority; their optional current-context guard preserves older callers’ default behavior.

`retained-evidence-ui.js` owns only retained lookup and its lifecycle guards. Run
its Node checks with `node --test test/retained-evidence-storage-tests.mjs test/retained-evidence-ui-tests.mjs`.
After the normal build and optional [Debian browser dependencies](../development/CONTAINER_PLAN.md#optional-browser-test-dependencies--30-september-2026),
run the real-browser check inside the container:

```sh
NONVERBA_PLAYWRIGHT_PATH=/opt/nonverba-tools/browser-tests/node_modules/playwright \
PLAYWRIGHT_BROWSERS_PATH=/opt/nonverba-tools/browser-tests/browsers \
node test/retained-evidence-browser-tests.mjs
```

It owns and closes a loopback preview on port 4173 and an isolated browser
context. Leave that port free before running; it never connects to a phone.

### Controller validation on 29 September 2026

The new composed controller suite uses actual `AgentRequester` and shared evidence storage with an in-memory IndexedDB transaction double, real shipped Rust/WASM signatures, C2PA JPEGs and COSE proofs made from explicitly synthetic browser sensor data. It checks exact two-key/both-artifact receipts and once-only acceptance; JPEG-only waiting; wrong/missing/truncated/file-mismatched artifacts; changed request/policy/context/key; software evidence rejected by native/raw profiles; delivery, sealing and acceptance deadlines; cancellation during collection/transfer/verification/atomic acceptance; and Buffer-backed caller mutation during async sealing. Existing image-only and acceptance-guard suites remain green. These tests do not establish native raw acquisition or a real WebRTC/browser/phone route. Existing Rust position fixtures separately cover signed raw synthetic observations and composed receipt context; real device capability remains a physical gate.

A focused Rust regression in `agent_appraisal/context_tests.rs` now creates a real composed C2PA JPEG and file-bound COSE proof with two separately enrolled private-test signing keys. Both actual signer bindings and possession checks succeed; missing, swapped and wrong-key contexts cannot satisfy composed hardware policy. Private test roots remain untrusted for hardware, even when both artifact bindings succeed. This does not establish a production-attested positive case or a physical sensor acquisition. All six context tests passed in Debian on 29 September 2026 (the optional fixture-export test performs no export unless requested).

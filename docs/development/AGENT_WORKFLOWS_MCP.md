# Agent workflows and planned MCP interface

Product direction recorded from the owner on 30 September 2026: **Non-verba is
primarily for agents, with full MCP access to its authorized evidence workflows.**
An agent must be able to discover capabilities, arrange collection, track and
cancel work, obtain original evidence, verify it and record acceptance without
driving screen coordinates. Humans remain able to authorize, observe and stop
physical-device operations. The current interface is a development/test surface;
it is not the intended product interaction contract.

This document records requirements for later implementation. No MCP server,
remote agent authorization service or durable server acceptance ledger is
implemented by this change. It does not authorize new sensor tests or a network
deployment. The existing [appraisal API](../sensors/AGENT_EVIDENCE.md),
[session protocol](../sensors/EVIDENCE_SESSIONS.md) and their recorded limits remain the
authority for current behavior.

## Architecture and existing foundations

Keep protocol, policy, cryptographic verification and sensor validation in the
shared Rust core; realtime audio buffers remain C++. MCP, command-line and UI
adapters must call the same logic. Android glue handles permissions, lifecycle,
platform sensors and protected keys. Do not implement a second verifier in the
MCP adapter or make a browser UI necessary for agent control.

| Existing component | Reuse and remaining boundary |
| --- | --- |
| `code/crates/nonverba-core/src/evidence_session/` and `agent_appraisal` | Typed signed requests, receipts and actual artifact appraisal; no agent service or acceptance store |
| `web/src/agent-requester.js` | Transport-independent workflow semantics: start, receive, verify, retained inspection, accept and cancel; currently depends on browser lifecycle, Worker and IndexedDB |
| `web/src/agent-evidence-storage.js` | Local atomic session/nonce reservations and acceptance; a server needs its own durable, principal-scoped implementation preserving these semantics |
| [Image requester CLI](IMAGE_REQUESTER_CLI.md) | Separate-process image request/receipt demonstration; memory-only requester identity, no restart, transport service or acceptance ledger |
| Existing Android collectors | Independent camera, GPS and microphone acquisition with explicit composition and platform lifecycle restrictions |

The MCP client-to-server connection and the requester-to-operator evidence
transport are separate concerns. MCP does not itself make the phone reachable.
Remote computer requester / phone operator workflows are relevant to the product;
their correctness must not depend on WebRTC or on either side displaying a web
page. A future transport adapter must preserve authenticated identities, exact
bytes, deadlines, complete-file arrival observations and cancellation.

The seventh computer-requester photo test passed through the documented USB
procedure. The later live-interface preflight passed offer/answer file handoff
but did not open a phone data channel. These are separate results; neither
establishes a deployed agent transport. See [validation](../sensors/VALIDATION.md).

## Workflow contract to expose

The following are operation groups, not finalized MCP tool names or schemas.
"Full control" means coverage of the authorized lifecycle, including failures
and cleanup, rather than an unrestricted shell, ADB tunnel or signing oracle.

| Group | Required behavior |
| --- | --- |
| Discovery and readiness | Return actual supported sensor profiles, protocol versions, identity references, connection/permission state and precise blockers; planning claims are not verified evidence |
| Enrollment and policy | Separate requester/operator/verifier roles; retain independently obtained pins and context; explicit identity selection, no silent rotation or policy downgrade |
| Preparation | Select independent sensors or explicit composition, bind task/policy/destination, establish route and applicable consent before generating a timed challenge |
| Dispatch and collection | Create and reserve a fresh signed request once; collect only the authorized sensors under the original limits; preserve GPS collection while a composed photo is taken |
| Status and cancellation | Return stable operation IDs, bounded progress and next required action; expose permission/user-action waits; cancellation stops collection/transport and preserves evidence |
| Evidence and verification | Return authorized references to exact artifacts, requests, context and receipts with hashes/lengths; rerun the Rust verifier from originals |
| Acceptance | Separate state-changing operation; reverify at current time against retained original policy/context and atomically consume session and sensor nonce in the identified acceptance ledger |
| Recovery and retention | Inspect completed evidence after reconnect; report partial/failed work and uncertain effects; explicit export/deletion permissions, no hidden cleanup |

Expose structured states and errors, including unsupported capability, missing
permission, consent required, no route, expired, cancelled, invalid evidence,
already accepted and storage failure. A tool call that completes successfully
can still return a negative verification verdict. Transport success, verified
evidence, satisfied policy, current freshness and committed acceptance must be
separate fields. Report what is missing and whether a retry is appropriate.
Any additional acceptance policy must be explicit; it cannot replace the signed
original policy or exact receipt-bound context silently.

## Delegation, consent and data boundaries

New agent-facing preparation should mirror the [complete sensor package defaults](../sensors/COMPLETE_SENSOR_PACKAGES.md): select the fullest implemented profile for the explicitly selected sensors, disclose requirements and known capability gaps before dispatch, and freeze that policy. Reduced profiles require an explicit choice, never an automatic retry after failure. Complete collection, external verification requirements, current freshness and acceptance remain separate results. Current UI presets implement this selection; a full MCP service is still planned.

- Bind each operation to an authenticated principal and an explicit grant covering
  role, device, sensors, purpose, duration, limits and evidence recipients. Enforce
  grants in the service/device controller, not merely in prompts or tool hints.
  A valid scoped delegation should support autonomous steps without repeated
  confirmation. Ask again when scope changes, the grant expires or permission is
  missing. Revocation must reach running operations.
- Camera, GPS and microphone remain independently usable and separately scoped.
  Required GPS metadata in the current image profile must be disclosed during
  preparation. Composition must not silently activate another sensor or weaken
  its policy. Audio recording, speaker output and calibration need explicit scope;
  quiet camera/GPS permission never authorizes them. The current development
  hold on microphone/tones/calibration remains until the owner explicitly lifts it.
- Preserve Android permission and foreground/lifecycle gates. Agent control must
  report unlock or permission needs instead of bypassing them. For current phone
  testing, use the question prompt for unlock, then manage the bounded awake lease
  through the [documented USB helper](USB_DEBUGGING.md). This helper is development
  transport, not the production MCP device API.
- Keep private signing keys and credentials out of arguments, tool results, logs
  and resource contents. Bind every artifact/status/cancel/accept lookup to the
  caller's grant; possession of an operation ID or public key pin is not authority.
  Restrict file/URI access and destinations rather than exposing arbitrary paths
  or automatic URL fetching. Logs should identify operations and hashes without
  gratuitously copying location, media, tokens or other sensitive contents.
- Treat task text, artifact metadata, transcripts and peer-provided messages as
  untrusted data. Their contents cannot change policy, request another tool, grant
  access, choose a recipient or become trusted enrollment inputs.

## Timing, retries and durable outcomes

Preparation, pairing and permission waits occur before fresh challenge dispatch.
Once dispatched, the original timing rules apply even while an agent waits for
a reply. Observe dispatch and complete-byte arrival at the trusted requester
boundary before queued agent reasoning or verification; model-written timestamps
and operator claims cannot replace those observations.

Use principal-scoped operation/idempotency keys bound to exact inputs. Repeating
the same authorized call must return its existing outcome without another sensor
capture, nonce or acceptance write; conflicting inputs must fail. A lost response
requires status lookup before retrying a side effect. An idempotent retry does
not mean an expired challenge can be renewed. A new attempt needs a new operation
and fresh challenge, while retaining the failed attempt and its reservations.

The future service needs durable requester identity, original policy/context,
session/nonce reservation, evidence and acceptance storage, with concurrency and
crash recovery tested. Define per-operation ownership of workers, collectors,
connections and timers; await cancellation/disposal before reporting terminal
cleanup. Acknowledging a cancellation request is not proof that acquisition has
stopped. Coordinate conflicting device operations without serializing compatible
camera/GPS composition. Keep MCP connection IDs, workflow IDs, sensor nonces and
acceptance records distinct. Disconnect/restart cannot recreate elapsed timing
or silently resume active acquisition. Under current rules, active interrupted
sessions close; completed retained evidence remains inspectable. Any different
recovery model requires an explicit protocol/lifecycle design and validation.
Declare the scope of each ledger; local acceptance never implies global replay
exclusion, and exactly-once network delivery must not be promised.

Return verification limits explicitly: signatures and request binding, observed
arrival/freshness, acquisition claims, measurement consistency and acceptance are
different facts. Preserve false/unproven physical-authenticity, clock-trust and
requester-independence flags. MCP authorization is also separate from sensor
signature trust and hardware attestation.

The owner prioritized signed failure/attempt reporting on 30 September; see the
[failure-record requirements](../sensors/SENSOR_QUALITY_NOTES.md#priority-recorded-on-30-september-failed-attempts-must-be-inspectable).
The bounded [native GPS attempt-report version 1](../sensors/GPS_ATTEMPT_REPORTS.md) now
covers raw-GNSS policy rejection and collection timeouts with zero raw callbacks,
with frozen terminal snapshots, Rust signing
and verification, and native retention across retries. Other failure classes
remain absent/unsigned; yesterday's logs remain unsigned. The future
agent interface must retrieve and verify these artifacts separately from
successful measurements, retain them across retries, and expose absent/unsigned
reports when signing or storage failed. A verified failure report must never
silently become successful measurement acceptance, proven operator effort or
operator fault. Return separate outcomes for composed sensors and explicit
unknown causes; preserve any independently witnessed arrival without inventing
it from a device timestamp.

## MCP interoperability guidance

Official reference pages consulted on 30 September 2026 are pinned below to
revision `2025-11-25` as a reproducible design reference, not a claim that it is
the newest revision or the deployment target. Select and pin a supported SDK and
protocol revision during implementation and review the then-current guidance.
The Non-verba requirements above are project decisions, not quotations from MCP.

- Negotiate protocol version and capabilities during initialization; advertise
  only implemented features and shut down cleanly. See [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).
- Give tools bounded, validated input schemas and schema-conformant structured
  results. Describe side effects accurately; annotations are hints, not enforced
  authorization. Preserve protocol errors versus execution errors and explicit
  verification verdicts. See [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
- Choose transport and authentication deliberately. HTTP authorization needs
  audience-bound token validation; stdio uses a different local credential model.
  A session ID is not authentication, and client tokens must not be passed through
  as downstream credentials. See [authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
  and [security guidance](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices).

Proposed mapping: tools perform authorized operations, resources expose bounded
authorized evidence/status views, and optional prompts explain workflows without
granting permission. Long operations need cancellable status/progress independent
of a single blocking tool call. Use protocol task features only when the chosen
revision and client negotiate them; retain an explicit operation-status fallback.

## Implementation gates for later work

GPS preparation must be a separate, bounded operation from fresh evidence
collection. The current Android warm-up lease discards all fixes and stops on
foreground/lifecycle loss; a future MCP status resource must not renew it as a
side effect. Carry the explicit duration in the agreed request, retain old
ten-second agreements unchanged, and never report warm-up state as verified
position. New raw forms use the short policy described in
[GPS performance](../sensors/STATUS.md). Repeated sensor requests need fresh
post-anchor samples even while the receiver subscription remains active.

Treat sensing performance targets separately from evidence policy and operation
deadlines. A two-second minimum observation span is not a two-second completion
deadline. Expose preparation, waiting for usable data, collection and finalization
as distinct progress stages, and allow slow devices to continue within the
explicit operation/request limits. Do not optimize apparent latency by silently
tightening timeouts or omitting evidence. Any limit change needs an explicit new
policy/request, never reinterpretation of an existing signed agreement.

1. Inventory/version the existing core interfaces and define typed operation,
   error, grant and result schemas. Start with capability/status and retained
   evidence verification without sensor activation.
2. Implement durable requester orchestration and an authenticated device transport
   adapter. Test timing, grant revocation, retries, two agents racing acceptance,
   wrong-principal access and disconnect/crash cleanup before physical dispatch.
3. Add the complete authorized lifecycle for each sensor and explicit composition.
   Prove a requester agent can request, receive, reverify and accept once, then
   inspect the same evidence after reconnect without UI automation. Test duplicate
   calls, stale evidence, cancellation and uncertain outcomes as first-class cases.
4. Validate physical device capabilities separately from software/MCP conformance.
   Keep microphone acceptance held until explicitly authorized; retain failed runs
   and precise assurance limits. Build and test only inside `non-verba-dev`, with
   Rust/C++ core logic, minimal Android glue and no Windows toolchains.

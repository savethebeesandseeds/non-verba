# Image requester CLI

The interactive and USB procedure below describes the preserved, matching
pre-unification checkout. Public-checkout [snapshot validation](CONTAINER_MIGRATION.md)
does not provide an interactive owner session or authorize phone operations.

`code/tools/image-requester-session.mjs` runs one requester session in Debian,
using the shipped Rust/WASM image and evidence-session APIs. It creates a separate
requester identity before any fresh challenge. The private key stays in process
memory; the tool has no restart, transport service, phone control or acceptance
ledger. It does not change the APK; the separate bounded USB helper transports
the public bare challenge when explicitly invoked.

From the repository root, open the existing container shell:

```powershell
./code/dev.ps1 -Action Shell
```

Then, inside Debian at `/workspace/code`, start:

```sh
node tools/image-requester-session.mjs --operator-pin YOUR_INDEPENDENTLY_KNOWN_64_HEX_CAMERA_PIN \
  --requester 'Requester agent' --task 'Photograph the requested subject' \
  --output-dir /workspace/code/artifacts/device-acceptance/NEW_UNIQUE_DIRECTORY
```

A caller already running in Debian can instead spawn this Node command with
connected stdin/stdout pipes. The current `dev.ps1 Exec` does not forward Docker
stdin, so it cannot host this interactive session or a Windows-side input pipe.
Do not change the launcher or run the requester runtime on Windows to bypass that.

An existing output directory rejects; there is no overwrite or resume. Optional
`--policy FILE` and `--context FILE` read bounded UTF-8 inputs before challenge
creation. The default policy requires native acquisition and a correlated camera
clock, with hardware attestation false and context `{"version":1}`. Policy/context
shape validation uses the existing Rust appraisal parser; attestation evidence
is evaluated against the actual signer when the returned image is verified.
Supplied policy/context bytes remain exact, including whitespace. A stronger
caller-supplied policy is never relaxed after dispatch.

Keep stdin connected and read stdout as JSON lines. After `ready`, explicitly send:

```json
{"command":"dispatch"}
```

This generates and retains the fresh challenge and signed wrapper, then hands
`challenge_json` and `request_envelope_json` to the caller in a `dispatch` event.
The timing starts immediately before that stdout write, after original inputs
are retained. **This witnesses handoff to the caller's transport, not delivery
to the handset.** Forward the exact challenge to the operator through an existing
authorized channel. The current camera UI imports the bare challenge; it does
not itself authenticate this separate requester wrapper.

### Physical USB delivery

The 29 September audit found no automatic outbound route. On 30 September,
`AppCameraChallenge` added a bounded route through the existing authorized USB
helper, without an APK rebuild or changes to `AppText`. See
[USB debugging](USB_DEBUGGING.md#bounded-camera-challenge-insertion) for its full
file, character, focus and readback restrictions. It accepts the CLI's retained
bare `challenge.json`, not its signed requester-session wrapper or a composed
camera/location envelope.

Before dispatch, connect and authorize USB, open Camera → Operator with the empty
challenge field visible, and have the quiet capture/export controls ready. Use
short ASCII labels compatible with the helper's allowlist. The requester process
may wait at `ready` during this setup; no challenge exists yet. Once prepared,
send `dispatch`, wait for `dispatched`, then run this separate Windows PowerShell 7
command against the newly retained file:

```powershell
./code/tools/usb-device.ps1 -Action AppCameraChallenge -CameraChallengeFile C:\Work\Non-verba\open-source\code\artifacts\device-acceptance\NEW_UNIQUE_DIRECTORY\challenge.json
```

The helper preserves those original bytes and timestamps. It derives a compact
JSON representation with Unicode-escaped string keys to avoid keyboard
autocorrection, proves that it decodes to the original challenge, and verifies
the complete inserted field by length and SHA-256. It never clears existing
text, loads the challenge, opens the camera or takes a photo. Only after
`verified-field-insertion` should the operator load the challenge, open the
camera, capture, and save the signed photo. The existing `ExportCamera` action
retrieves that saved JPEG unchanged; send its container-visible path to the
still-running requester's `receive` command below. All delivery, interaction,
capture, saving and USB retrieval time counts toward the 180-second response
deadline. Prepare once and perform the sequence without avoidable pauses; do
not extend or backdate a timed-out session.

A mismatch stops before loading or sensor use. Cancel the requester, retain the
failure artifacts, reload a clean camera page, and create a new session when
ready. The helper does not retry or repair altered field text automatically.
User-managed import remains possible; the external Android file chooser is still
outside automated own-app focus guards. No push, clipboard, external import
intent or wireless route was added.

Exact field insertion is handset UI delivery evidence. The CLI's signed dispatch
continues to mean stdout handoff, and final arrival is still witnessed only by
the CLI's complete file read in Debian. The completed physical run below validates
that CLI path. It does not add an acceptance ledger or demonstrate the separate
live UI pairing workflow.

### USB validation history

The initial 30 September attempts are retained rather than counted as completed
requester proofs:

| Attempt | Observed outcome | Retained evidence |
| --- | --- | --- |
| First | The keyboard changed the JSON key `id` to `I'd`; full readback rejected the field. Requester cancelled without loading or capture. | Transfer (local review record, not included in this source release), cancellation (local review record, not included in this source release) |
| Second | Dismissing the keyboard with Back did not prevent the same correction. Readback rejected; requester cancelled. That extra Back action was removed. | Transfer (local review record, not included in this source release), cancellation (local review record, not included in this source release) |
| Third | Encoding all string keys and values expanded this request to 1,240 characters. Insertion was incomplete, and full readback rejected it; requester cancelled. | Transfer (local review record, not included in this source release), cancellation (local review record, not included in this source release) |
| Fourth | Encoding only keys delivered all 485 characters with exact readback and unchanged challenge semantics. A later orchestration pause exhausted the response deadline before capture; no image was received. | Transfer (local review record, not included in this source release), deadline failure (local review record, not included in this source release) |
| Fifth | Exact field insertion passed, but the pause before shutter input exhausted the response deadline; no image was received. | Transfer (local review record, not included in this source release), deadline failure (local review record, not included in this source release) |
| Sixth | Exact insertion passed. The web-only batch refused the native shutter; a later coordinate tap did not produce a signed photo. The requester was cancelled. | Transfer (local review record, not included in this source release), cancellation (local review record, not included in this source release) |
| Seventh | Exact insertion, one guarded native shutter tap, save and export succeeded. The separate requester verified the JPEG and signed receipt within its original deadline. | Result (local review record, not included in this source release), verification (local review record, not included in this source release) |

These attempts required no APK rebuild, global keyboard setting change, relaxed
deadline, or microphone operation. A field-insertion success alone is not an
end-to-end requester/camera validation result.

The seventh run returned the complete 2,677,097-byte JPEG in 120,785 ms against
the original 180,000 ms limit. This includes developer interaction and retrieval
of 20 saved camera artifacts; it is not a required capture wait or a camera-speed
measurement. C2PA integrity, exact request and operator binding, GPS metadata,
native camera metadata, correlated camera clock, request/receipt authentication
and timing checks passed. Raw GNSS, remote hardware attestation, replay acceptance,
trusted requester clock and physical authenticity were not established.

The USB helper now supports exact `TAKE PHOTO` and `CANCEL` selectors in the
observed native camera dialog; other native controls remain outside the batch.
A camera transition may invalidate the final accessibility read after an input
was sent. Read the report's `input_sent` field and obtain a fresh guarded state;
never repeat a shutter tap blindly. The numbered orchestration scripts retained
with these artifacts are historical test records, not services or resumable
sessions. The requester process and those scripts have exited. Further device
testing and the overall hardening goal are paused.

### Receiving the result

Wait for the separate `dispatched` event, which follows completed stdout writing,
before sending another command. Once the complete returned JPEG is available,
request its bounded read using an absolute container-visible path:

```json
{"command":"receive","path":"/workspace/code/artifacts/device-acceptance/RETURNED.jpg"}
```

The tool timestamps arrival immediately after the complete file read using its
own wall and monotonic clocks. It never imports a caller-supplied timestamp or
backdates arrival to camera capture, Save, filesystem mtime or Windows USB copying.
Only a regular file of 1 byte through 32 MiB is accepted; symlink paths, changed
files and duplicate/early receives fail. Keep the process and stdin alive until
`complete`. `{"command":"cancel"}`, EOF, interruption, malformed/oversized commands
or deadlines abandon the session. The JSON-line input limit is 4096 bytes.

Existing protocol limits remain: five seconds for creation-to-completed dispatch,
180 seconds from handoff to final-file reception, one-second wall/monotonic
agreement, and thirty seconds from reception through receipt verification. A
five-minute challenge leaves dispatch overhead while preserving the 180-second
response bound. Manual import/capture/export time counts; a missed limit requires
a new session. No synthetic clock controls are exposed by the CLI.

The new directory retains exact `policy.json`, `context.json`, public requester
identity/configuration, `challenge.json`, `request.json`, authenticated request
payload, `dispatch.json`, `image.jpg`, `arrival.json`, `receipt.json`, the complete
`verification.json` and a hash-indexed `result.json`. Failed runs retain existing
artifacts plus `failure.json` when writable. Precise camera location can appear
in the full report; stdout contains only public dispatch data and completion
metadata. A successfully signed receipt is reverified and must still be fresh
before the run completes. This is never local/global replay acceptance, a trusted
clock, trusted hardware or proof of physical scene/location authenticity.

Run focused tests inside Debian:

```powershell
./code/dev.ps1 -Action Exec -Command @('node','--test','test/image-requester-session-tests.mjs')
```

The suite uses real shipped WASM, C2PA and COSE signatures, plus synthetic image
content and controlled clocks for boundary cases. One test drives the actual CLI
process with real clocks. The default native policy rejects software images;
positive software-fixture tests explicitly request the weaker profile. They do
not represent physical camera or secure-hardware acceptance.

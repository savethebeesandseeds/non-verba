# USB debugging on Windows

This guide documents the existing verified transport in the former private
checkout. Its container, helper, locally provisioned ADB files and device data
are preserved. Publishing a source copy does not install ADB, authorize a new
phone operation or change the explicitly approved helper path. Public-checkout
snapshot validation excludes ADB and does not use this transport.

The user approved this narrow host exception on 28 September 2026: the existing
native Windows ADB and its two USB DLLs communicate with the phone over a cable.
Java, Gradle, Rust, C++, builds and tests remain in `non-verba-dev`. This is a
Windows USB transport, not direct USB passthrough into the container.

No new software, Windows driver, USB/IP service, firewall exception or system
PATH change was needed to start the helper. On 28 September 2026 the provisioned
Cat S62 Pro was detected and authorized over USB (Android 11/API30). No driver
installation was needed. This establishes transport access, not sensor trust.

## Verified transport configuration

- Google Platform Tools 37.0.1, existing files in
  `code/android/.toolchain/sdk/platform-tools`.
- Valid Google LLC Authenticode signatures for `adb.exe`, `AdbWinApi.dll` and
  `AdbWinUsbApi.dll`; the wrapper pins their verified SHA-256 hashes.
- Dedicated server `127.0.0.1:5038`, without an interface exposed to the LAN.
- `ADB_MDNS=0` and `ADB_MDNS_AUTO_CONNECT=0` are process-local settings.
  Runtime `server-status` reports `mdns_enabled: false` and `MDNS_DISABLED`.
- No UDP endpoints were observed for the helper process.
- Device operations use `adb -d`: USB only, and fail if multiple USB phones exist.
- No wireless pairing, `connect`, `tcpip` or arbitrary shell is exposed.
- `InstallVerified` accepts only a successful Linux package-verification report
  for an exported container build. It checks the retained development signer and
  exact local APK hash, installs only `org.nonverba.camera` for the foreground
  user, preserves app data, and checks the installed hash. It does not downgrade,
  uninstall, grant permissions or launch the app.

ADB uses its normal host authorization key under the Windows user's `.android`
directory. The phone must approve the computer before commands can run. This
key is local authentication state, not a project or evidence-signing key. Do not
commit or share it. USB debugging gives the authorized computer significant
access to the phone; disable it or revoke that authorization when finished.

## Phone setup

1. On the Cat S62 Pro, open Settings → About phone and tap Build number seven
   times, entering the device PIN if requested.
2. In Developer options, enable USB debugging and keep Wireless debugging off.
3. Connect a USB data cable directly to this PC and unlock the phone.
4. Approve this computer when the phone displays the USB debugging prompt.

For the existing authorized setup, from `C:\Work\Non-verba\private-source` on Windows:

```powershell
./code/tools/usb-device.ps1 Status
./code/tools/usb-device.ps1 DeviceInfo
./code/tools/usb-device.ps1 AppStatus
# Read-only GNSS startup diagnosis while Non-verba has user-0 focus:
./code/tools/usb-device.ps1 GpsDiagnostics
# After a successful Linux package verification, using its exact JSON path:
./code/tools/usb-device.ps1 InstallVerified -VerificationReport C:\Work\Non-verba\private-source\code\artifacts\qa\REPORT.json
./code/tools/usb-device.ps1 Launch
./code/tools/usb-device.ps1 RestartApp
./code/tools/usb-device.ps1 AppScreenshot
./code/tools/usb-device.ps1 ExportEnrollments
./code/tools/usb-device.ps1 ExportLocations
./code/tools/usb-device.ps1 ExportCamera
# Compare API29+ direct Downloads copies against an original public retrieval:
./code/tools/usb-device.ps1 VerifySavedDownloads -RetrievalManifest C:\Work\Non-verba\private-source\code\artifacts\device-acceptance\RETRIEVAL-DIRECTORY\retrieval.json
./code/tools/usb-device.ps1 Preview
./code/tools/usb-device.ps1 Stop
```

`Status` starts or reuses the checked local server and lists devices. An empty
list means there is no usable ADB connection yet; `unauthorized` means the phone
still needs approval. `DeviceInfo` reads the model and Android version.
`AppStatus` reads fixed properties, relevant declared features and the foreground
Android user's Non-verba installation/hash. It handles an absent package without
mistaking it for a disconnected phone, and rechecks the foreground user. It does
not launch the app or activate sensors. `Preview`
forwards the phone's localhost port 4173 over the USB cable to Windows loopback,
which Docker forwards to the Debian preview. It does not route through Wi-Fi.
`Stop` stops only this dedicated helper server. It does not disable the setting
on the phone or stop another ADB server on port 5037.

After explicitly saving native GPS attempt reports in the Location page's
separate failed-attempt panel, `ExportLocations` retrieves the exact public
`nonverba-gps-attempt-<UUID>.json` and
`nonverba-gps-attempt-request-<UUID>.json` filenames. `VerifySavedDownloads`
recognizes these names too. Bounds and own-app/USB guards still apply; retrieval
checks only bytes and structure. Run the Rust report verifier separately with
the independently retained original request and trusted key. Unsigned/signing
or storage-failure exports must not be relabeled as signed reports. See
[GPS attempt reports](../sensors/GPS_ATTEMPT_REPORTS.md).

`Launch` opens the app's normal bundled home page. Capture, permissions and
sound-producing actions still require separate UI interactions. Installation
and launch are explicit commands, never a side effect of status checks.

`RestartApp` is an explicit process-recovery check for the already installed app.
First finish collection, export/verify evidence and turn preparation and awake
controls off. It requires focused user-0 Non-verba, stops only its fixed package,
verifies process absence, launches its fixed MainActivity, and checks unchanged
APK, user and own-app focus. It preserves app data, keys, journals, caches and OS
settings; it does not grant permissions. Its unique report retains each completed
stage and any failure without an automatic retry. Check preparation and a fresh
awake lease after relaunch. This tests process stop/relaunch, not arbitrary
mid-transaction death or a phone reboot; no collection is explicitly invoked.

Authorized public-source updates use the reviewed
[bounded snapshot APK export](CONTAINER_MIGRATION.md#bounded-snapshot-apk-export-for-an-authorized-phone-update).
The original `InstallVerified` checks and USB helper path remain unchanged.

`GpsDiagnostics` requires focused user-0 Non-verba before and after its fixed
read-only queries. It records Android build metadata, the developer/full-tracking
settings, bounded scalar receiver flags, dump field names without their values,
and bounded measurement-only framework/vendor error logs. It starts no sensor,
changes no setting, clears no logs and accepts no arbitrary shell command.
Results are unsigned local diagnostics, retained privately. Empty/missing logs
or flags are inconclusive; vendor formats and logging differ. The action cannot
operate Android settings, restart the phone or establish physical cause.

`AppScreenshot` reads a bounded PNG only while the focused window is Non-verba's
user-0 activity, and rechecks focus before saving it uniquely under device
acceptance artifacts. It rejects notification/lock screens or another app. It
does not inject input, take a camera photo, or activate the microphone.

After explicit authorization to control the phone, `AppTap`, `AppSwipe`,
`AppBack` and `AppText` permit one routine Non-verba UI action per invocation. They require the
same focused user-0 Non-verba activity immediately before input and report focus
again afterward. If focus leaves the app, stop and ask the user; do not follow
into permission dialogs, the lock screen or other apps. They expose no arbitrary
shell command. Microphone calibration, demos, challenges and
playback remain prohibited until separately authorized.

Tap/swipe require `-ScreenshotPath` naming an original `AppScreenshot` PNG in
the device-acceptance directory, captured within 120 seconds. Its dimensions
must match strictly parsed `wm size` and a single current `SurfaceOrientation`;
ambiguous metadata or changed rotation rejects input. Use integer `-X` and `-Y`
from that freshly inspected screenshot. Swipe additionally requires `-ToX` and
`-ToY`, with optional `-DurationMs` from 100 to 1000 (default 300). Both endpoints
must remain inside the display, excluding its top and bottom four-percent inset.
`AppBack` takes no coordinates or screenshot argument. Inspect a fresh screenshot
before every subsequent input; an input result does not prove UI success.

`AppText` requires the same recent `-ScreenshotPath`, display metadata and focus
checks as tap/swipe. It only inserts `-Text` into an observed focused app field:
1 to 200 ASCII characters, beginning with a letter or digit, followed only by
letters, digits, spaces, periods, underscores or hyphens. Spaces are encoded as
`%s` for the fixed Android `input text` command; caller-supplied percent signs,
shell syntax, Unicode and newlines are rejected. Use it only for the authorized
routine public test labels, never JSON, credentials or secrets. It does not
clear fields, select all, use the clipboard or submit a form.

### Pre-challenge camera pairing files

For a physical check, first use the question prompt to ask the user to unlock
and show Non-verba; after confirmation, enable **Keep screen awake** immediately
and verify its active lease before continuing. Manage the lease during testing
without repeated unlock requests. It persists across app updates and expires
automatically after two hours while keeping the foreground app awake.

The [30 September physical follow-up](../sensors/VALIDATION.md)
passed staged-offer import and saved-answer retrieval. The requester accepted
the answer, but no direct WebRTC data channel opened. File handoff success does
not establish a reachable route or sensor evidence.

The debug test UI can explicitly load a public camera offer staged through USB.
This path transports signaling only; it does not issue a challenge, grant consent,
authenticate a peer, start a sensor or provide a WebRTC route. Before phone work,
check and enable the existing **Keep screen awake** lease as described below.

```powershell
./code/tools/usb-device.ps1 StageCameraOffer -CameraOfferFile C:\Work\Non-verba\private-source\code\artifacts\device-acceptance\RUN\offer.json
./code/tools/usb-device.ps1 ExportCameraPairing
```

`StageCameraOffer` requires PowerShell 7, focused user-0 Non-verba and a regular,
non-linked UTF-8 JSON file under device-acceptance (1..120000 bytes). It accepts
only public version-1/2 camera-offer fields and one data-only SDP description.
It sends the exact snapshotted bytes on binary stdin, never as shell syntax,
through `adb -d shell -T run-as org.nonverba.camera`. A fixed script creates one
new `cache/camera-pairing/<32 lowercase hex token>.json`, with no overwrite and
at most 32 entries. It rejects symlinks, bounds the copy and makes the completed
file read-only. Exact size/hash readback and unchanged app/user/focus are required
for `verified-public-offer-staged`. Failed/partial files and staging reports remain
preserved; never load a token whose staging failed. No cleanup or arbitrary file
upload action is exposed.

In Camera → Live camera session → Operator, independently enter the requester
public ID, enter the returned token, and click **Load staged USB offer**. The offer
field must be empty. The debug-only Android bridge reads only that token's regular
bounded UTF-8 file while the camera page is foreground. The existing JS parser,
pin comparison, permission preparation and explicit task consent still apply.
Import does not populate trusted IDs or click Join. Release builds omit the bridge.

After **Prepare permissions & create answer**, explicitly **Save pairing answer**.
`ExportCameraPairing` retrieves only `nonverba-camera-offer.json` and
`nonverba-camera-answer.json` under existing UUID public export folders, with
120000-byte limits, exact hashes and the existing read-only export safeguards.
Its unique manifest includes the untrusted `pairing_id` so the requester can select
the current answer. It does not retrieve keys or evidence files. Use the matching
saved answer in the original requester process; old answers cannot replace it.

The preflight in `code/test/camera-pairing-preflight.mjs` runs only in Debian,
creates no sensor challenge, and waits up to eight minutes for `answer.json` in
its printed unique directory. Publish the complete copied answer atomically
(temporary sibling then rename) after matching the retrieval's pairing ID.
Creating `STOP` in that directory cancels the wait. The harness closes its own
browser and preview and records candidate/data-channel statistics. `--self-test`
uses two isolated Debian pages without a phone; `--self-test-invalid-answer`
confirms that a wrong pairing answer is classified as `signaling-rejected`.
A route result requires the actual requester peer to have accepted the remote
description; malformed/mismatched signaling is not evidence of a routing failure.
USB HTTP preview forwarding
remains separate from ICE/DTLS/SCTP connectivity; never infer a route from file
transfer or HTTP success.

### Bounded camera challenge insertion

`AppCameraChallenge` is a separate public-request insertion action added on
30 September 2026. It requires PowerShell 7 and leaves `AppText` unchanged.
Prepare the Camera → Operator page with its challenge textarea empty and visible
before dispatching a timed requester session. Reload the camera page through its
normal app navigation to discard a previous test's field; the helper never clears
or replaces existing text.

```powershell
./code/tools/usb-device.ps1 -Action AppCameraChallenge -CameraChallengeFile C:\Work\Non-verba\private-source\code\artifacts\device-acceptance\NEW_UNIQUE_DIRECTORY\challenge.json
```

The file must be a nonempty regular UTF-8 JSON file, at most 8 KiB, beneath
`code/artifacts/device-acceptance`. Reparse points in its path are rejected. It
must contain only the seven bare camera challenge fields: `version`, `id`,
`requester`, `task`, `nonce`, `issued_at`, and `expires_at`. Duplicate/unknown keys,
invalid nonce/ID correspondence, unsupported versions and noninteger timestamps
are rejected. Timestamps are preserved and insertion requires the original
validity window; they are never refreshed. Requester/task labels are deliberately
narrower than the product format: 1–200 and 1–2000 ASCII characters respectively,
starting with a letter or digit and otherwise containing only letters, digits,
spaces, periods, underscores or hyphens. Camera/location envelopes, requester
session wrappers, escaped source strings and arbitrary JSON are not accepted.

The original file is read without modification and its original-byte hash is
retained. The helper derives compact JSON with every string **key** encoded using
standard JSON `\uXXXX` escapes; string values remain the validated ASCII text.
This avoids the tested keyboard's correction of `id` to `I'd` while keeping the
synthetic input short. Parsing this generated representation must reconstruct the
exact compact original before any insertion. No arbitrary escaped payload is
accepted. The wire text is capped at 16 KiB; maximum supported label lengths
produce about 2.6 KiB. These are input bounds, not promises of delivery reliability
on every keyboard/device.

Windows `ProcessStartInfo.ArgumentList` preserves native arguments. A fixed
Android `input text` command single-quotes the generated JSON; validated spaces
become Android's `%s` tokens. A conservative Windows command-line bound is checked.
The action exposes no clipboard, push, wireless route or caller-supplied shell.
It requires foreground user-0 Non-verba MainActivity, one enabled WebView, and
exactly one enabled, editable, non-password `operator-challenge` field. It taps
that field within its observed safe bounds, verifies the same empty field has
focus, rechecks the source hash and app focus, and sends one bounded text input.

Success requires the observed **complete** field length and SHA-256 to match the
generated wire text. `AppUiState` supplies that hash only for the bounded camera
challenge field; ordinary saved text remains truncated to 512 characters and
oversized existing fields retain the previous UI-reading behavior. The unique
`app-camera-challenge-*.json` report retains separate original, compact-canonical,
wire and decoded-canonical hashes. `verified-field-insertion` means exactly that:
the helper does not click Load challenge, authenticate the separate requester
wrapper, start a sensor, witness image arrival or create an acceptance decision.
Any changed, truncated or autocorrected field is rejected without automatic
retries. Do not load a rejected field.

On 30 September, the first two physical transfers were rejected after keyboard
autocorrection; a larger encoding of all keys and values was rejected after an
incomplete insertion. Their requester sessions were cancelled. The final
key-only encoding delivered a 485-character field with exact hash readback in
the fourth transfer report (local review record, not included in this source release).
That session subsequently missed its response deadline before a photo was taken;
it is transport evidence, not a completed requester/camera proof. The attempt
history is retained in [Image requester CLI](IMAGE_REQUESTER_CLI.md#usb-validation-history).

The later seventh run (local review record, not included in this source release)
completed exact insertion, guarded native capture, save, export and separate
requester verification. Its full 120,785 ms interval includes developer controls
and USB copying; the requester's own complete-file read establishes arrival.
The transport's retrieval manifest continues to make no independent freshness
or hardware-attestation claim. No APK rebuild or sensor-policy change was needed.

For development, the agent must manage the app's existing **Keep screen awake**
control and check its lease before a test. The user should not have to maintain
screen activity during automation. The control only applies while Non-verba is
in the foreground; it does not change Android's lock settings. Do not mistake a
camera session timeout or a stopped automation batch for screen locking.

The user reiterated this on 30 September: check the control before phone use,
enable or renew its two-hour lease when needed, and confirm the displayed active
state and expiry. If the display goes dark or the phone is locked, stop phone
input and ask the user to unlock it; then recheck the awake state before resuming.
Use the existing foreground control instead of relying on incidental taps to
prevent timeout. Never interact with the lock screen through the helper.

The current interface is a testing interface, not the planned product UI. The
user authorizes practical interface changes that make these tests easier.
Prepare pairing, controls and observations before issuing a timed challenge;
interface convenience must preserve the original request, timing, sensor
independence, verification and acceptance boundaries.

`AppDismissShare` is retained only for older installed APKs whose Save controls
open Android's share sheet. Current APKs save directly without that sheet. It requires `-ScreenshotPath` from the
original Non-verba screen observed before Save, with a ten-minute age limit and the same
PNG, path and current-display checks. It accepts no coordinates or text. Only
the exact focused user-0 system `android/com.android.internal.app.ChooserActivity`
is eligible, checked again immediately before one fixed `KEYCODE_BACK`. This
only dismisses the chooser: it cannot select a recipient or send the artifact.
The post-action focus must return to Non-verba or the result reports
`stopped-user-needed`; do not continue into another app. Permission dialogs,
lock screens and other external windows remain blocked.

`ExportEnrollments` retrieves only public request/response JSON files deliberately
staged by the Signing keys page's **Save original** and **Save enrollment response**
buttons. It uses `run-as org.nonverba.camera` with foreground Android user 0;
other users are rejected. It reads only exact enrollment filenames beneath
`cache/exports/<UUID>/`, rejects symlinks and oversized files, and checks the
original bytes against device SHA-256 before and after the bounded base64 copy.
Copies and a retrieval manifest are saved to a unique directory under
`code/artifacts/device-acceptance/`. Nothing is removed from the phone. It does
not read private identity files, activate sensors or verify hardware attestation.
The recorded time is USB retrieval time, not independently witnessed challenge
issuance or an invented earlier arrival. Incomplete runs retain their manifest
and any files already copied; inspect its status before using them.

`ExportLocations` uses the same read-only transport checks for the Location page's
explicitly saved proof, original request and public key JSON. Allowed names are
`nonverba-location-<12 lowercase hex characters>.json`,
`nonverba-location-request-<12 lowercase hex characters>.json` and
`nonverba-public-location-key.json`, each under an existing UUID export folder.
It applies the app's proof-envelope limit, a 64 KiB request limit and a 16 KiB
public-key limit. The original bytes and a separate retrieval manifest are kept
locally; location proof/signature verification remains a separate Rust check.
A request's demo label is retained as an unverified claim. Retrieval never turns
a local demo into independently witnessed requester evidence.

`ExportCamera` uses the same read-only transport checks for the Camera page's
explicitly saved original JPEG, challenge and public device ID. It accepts only
`nonverba-<12 lowercase hex characters>.jpg` (up to 32 MiB),
`nonverba-challenge-<12 lowercase hex characters>.json` (up to 16 KiB), and
`nonverba-public-device-id.txt` (up to 1 KiB). The public ID text must match the
app's exact fingerprint and fixed native/software description format. Challenge
JSON must have the public camera shape and match its filename; the existing
camera/location request envelope is also supported. JPEG checks here only
recognize its header. Original bytes and hashes are retained in a unique camera
retrieval directory for separate Rust/C2PA verification; transfer does not prove
capture freshness, GPS or the depicted scene. It never takes a photo or starts
the microphone. Composed location proofs use `ExportLocations` separately.

`VerifySavedDownloads` accepts only a complete public `retrieval.json` in its
original camera/location/enrollment directory beneath device-acceptance. It
validates allowed filenames, bounded sizes, local original byte hashes, user 0,
API29+ and the installed APK hash recorded by that retrieval. It derives only
the exact `/storage/emulated/0/Download/Non-verba/<original filename>` paths and
reads bounded file sizes and hashes; it rejects symlinks and does not enumerate
Downloads, read other files or change phone data. No screenshot, input or sensor
operation is involved.

The unique local `downloads-check-*.json` report distinguishes exact byte/hash
matches, differences, inaccessible/missing paths and repeated export names that
cannot identify one save. MediaStore may suffix duplicate names; this action
does not search those alternatives or assert that a matched path is the newest
save. A match confirms the exact unsuffixed file contains the original public
bytes at verification time. It does not verify sensor authenticity, signatures,
independent freshness or hardware attestation. Failed checks preserve their
partial report. Older API26-28 app-documents exports are outside this action.

The helper does not make a compromised PC or phone trustworthy. These controls
limit exposure and transport selection; they do not prove sensor authenticity.

The explicit sound hold remains in force, reiterated on 30 September: no physical
microphone recording, tones, playback, calibration, audio demos or acoustic
challenges without a later explicit authorization. Ultrasonic target frequencies
do not guarantee inaudible playback.

Sources: [Android device setup](https://developer.android.com/studio/run/device),
[ADB configuration](https://developer.android.com/tools/adb),
[official Platform Tools](https://developer.android.com/tools/releases/platform-tools).

AppDismissShare allows an own-app screenshot up to ten minutes old because it
only closes the exact system chooser with Back. Coordinate and text actions
retain their two-minute bound. It never accepts notification or lock screens.

## Direct Save behavior

The current Android exporter writes a byte-checked copy to Downloads/Non-verba
(API29+), or app-specific external Documents/Non-verba (API26-28; removed on
uninstall), and shows a saved-folder confirmation. It preserves exact public
cache/exports/UUID files for the existing USB retrieval actions. No automatic
share sheet, FileProvider grant or recipient selection is involved. A failed
public save can leave a complete cache copy; USB retrieval alone does not prove
that a public Downloads save succeeded.

AppUiState reads a bounded accessibility view only while user-0 Non-verba is focused before and after. It reserves one unique shell-owned /data/local/tmp/nonverba-ui-UUID.xml file and deletes only that temporary file. XML is capped at 1 MiB, DTDs and external entities are prohibited, and only useful Non-verba package nodes are saved in a unique app-ui-*.json; raw XML, system/keyboard nodes and password text are not retained. The output previews labels, flags, resource IDs and bounds. Semantic IDs remain stable when bounds move; duplicate IDs must be treated as ambiguous. This action sends no input and activates no sensors. AppScreenshot remains the fallback for controls not exposed through accessibility.

AppUiState uses the full default UIAutomator dump because the compressed dump on the current WebView exposed only its root container. The same XML, package and focus bounds apply; no global accessibility settings or WebView debugging are changed.

AppUiState console summaries prioritize controls and status/runtime notices, omitting long stories and JSON. The state file retains text excerpts up to 512 characters with truncation flags; semantic IDs hash the full original fields, with password fields redacted. Truncated text must never be matched as an exact selector. The full XML cap remains 1 MiB and DTD/entity resolution stays disabled. Internal state-read and save functions avoid repeated USB initialization for the explicitly approved guarded input batches.


AppUiBatch is authorized for the quiet tests: at most eight taps, scrolls or
short test-field insertions, with a fresh own-app check for each action.
Microphone playback still requires separate approval; this batch action refuses
the audio workflow and Audio navigation. It exposes no OS/permission/lock-screen
controls, arbitrary keys, coordinates, shell commands, clipboard or form submit.

Use -UiPlan with one non-linked JSON file directly in
code/artifacts/device-acceptance (at most 16 KiB). Its exact shape is
{"version":1,"steps":[...]}, with one to eight steps. A tap/text selector has
exactly one resource-id, text, content-desc or id field. Matching must yield one
enabled, clickable, non-password node from the fresh hierarchy. Truncated text
cannot match an exact text selector. Tap uses its current center inside safe
WebView/display bounds. Text additionally requires that exact EditText already
focused; insertion accepts the same bounded public ASCII allowlist as AppText,
never credentials, secrets or arbitrary JSON. A scroll step accepts only
direction up/down, moving the document with a fixed 350 ms gesture within the
currently visible own WebView.

For an already-open native camera preview, a tap with the exact text selector
`TAKE PHOTO` or `CANCEL` has a narrow native branch. It requires no WebView, the
`Non-verba camera` heading, one native content container, and exactly the two
enabled, clickable camera buttons. All other selectors, text and scroll actions
remain WebView-only. It uses the same fresh user-0 MainActivity focus checks,
display rotation check, protected screen inset and eight-step maximum. Opening
the preview can replace the app window token; a hierarchy spanning that
transition is discarded as before. Observe the stable native dialog in a fresh
batch instead of retrying an input whose outcome is unknown. No screenshot
round trip is required to locate these two observed native buttons.

Example:
{"version":1,"steps":[{"action":"scroll","direction":"down"},
{"action":"tap","selector":{"resource-id":"location-save-proof"}},
{"action":"tap","selector":{"resource-id":"location-save-proof-request"}}]}

Use actual exposed labels/IDs. Missing, ambiguous, disabled or offscreen targets
stop the entire batch without adaptive retries. Each step refreshes hierarchy,
checks current display rotation and safe bounds, then checks own user-0 focus
immediately before and after input. Unexpected external windows stop later
steps. The unique app-ui-batch report records compact selection/input evidence;
successful completion returns a saved final state and concise status/control
summary. It does not restart USB initialization for every step. Input receipt is
not proof a Save succeeded: export retrieval and VerifySavedDownloads still
provide the original-byte/public-file checks. The public key button is
location-save-key; location-save-proof-request saves the original request
belonging to the completed location proof.

When a batch stops, its report retains the last successfully observed own-app state and a compact node summary. These are explicitly labelled with their step number as observations before that step input, never as the final or current app state. Missing/offscreen selector failures therefore provide useful controls without another phone query. Numeric pixel locals are distinct from the standalone string coordinate parameters; the original bounds checks remain unchanged.

## Unsigned camera quality export retrieval

Use the original approved `private-source/code/tools/usb-device.ps1
ExportCameraQuality` action after explicitly saving a quality record in the app.
It reads only owned cache exports named
`nonverba-camera-quality-<12 lowercase image-hash characters>.json`, with
128 KiB/report and at most 128 files. It preserves original bytes and rejects
unexpected paths, malformed root JSON, forbidden authenticity/acceptance claims
and filename/image-prefix disagreement. Its separate retrieval type and `quality`
kind cannot be counted as a camera photo, original challenge or GPS artifact.

This is unsigned guidance transport. Its digest checks do not authenticate the
sender or establish metric correctness, task usability, effort or responsibility.
Recompute in Rust/WASM against independently retained JPEG and profile bytes.
The existing `ExportCamera` and `VerifySavedDownloads` allowlists are unchanged.
See [camera quality validation](../sensors/VALIDATION.md#camera-quality-phone-deployment-preparation--5-october-2026)
for the separate package, parser and device coverage.

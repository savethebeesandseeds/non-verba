# Participant mock confirmation and document/face capture

Implemented 21 October 2026. The owner selected functional document and guided
frontal-photo capture, with **mock email and no real sending until the last mile**.
One UI and two shared capture/workflow adapters serve the browser and Android.
This completes acquisition/review software, not verified identity or phone-camera
acceptance. The previous [local-account checkpoint](PARTICIPANT_ACCOUNT_INTEGRATION.md)
remains historical.

The subsequent 23 October [identity camera tool](IDENTITY_CAMERA_TOOL.md)
replaces unsigned camera acquisition in the current source: Android shares the
hardened native controller, while browsers supply a bounded best-effort signed
photo. Images are normalized before signing and preserved byte-for-byte through
review/intake. Document-file import remains separate and unverified. The dated
checkpoints below preserve their original scope; source integration does not
replace the currently selected live service policy or establish phone acceptance.

## Account confirmation

The running local service reports `email_delivery: mock`,
`real_email_enabled: false`, `development_only: true`. Create a reserved test
contact such as `person@example.invalid`. Opening the mock email deliberately
requests only the code for that exact pending operation. Using it fills the
confirmation control; a separate deliberate action confirms the account and
generates a recovery code, without creating a login. Save that factor privately
and sign in through the existing PKCE/current-context client.

The bounded mock endpoint requires the operation ID, operation secret and exact
purpose. Unknown, wrong-secret, non-reserved, expired, consumed or superseded
recovery operations cannot reveal a code. Mock responses never enable real
mailboxes, identity decisions or general mailbox/admin access. Codes stay out of
app URLs, history, logs and persistent storage, and clear on submission or view
departure. Recovery still requires both the saved factor and its mock contact
code. Real SMTP source remains dormant; no provider or sender was configured and
no real message was sent.

## Deliberate capture and custody

A confirmed current service account, active session and declared role bind every
capture attempt. Processing consent precedes camera/file selection. The browser
can select a document-front JPEG/PNG up to 8 MiB, 16 megapixels and 8192 pixels on
an edge; encoded bounds precede decoding and decoded dimensions must agree.
Original selected file bytes stay in memory, including any existing metadata.
There is no native file picker or automatic upload.

The rear document camera and front face camera request video only. A local
90-second lease bounds each deliberate start. Canvas re-encoding produces at most
2 MiB JPEG, with maximum edges of 1600 pixels for document and 960 for face,
without carrying source-file metadata. The sensor stops before asynchronous
encoding, review or any possible later transfer. Failed cleanup blocks new
acquisition, and permission/encoder cancellation fences late streams and pixels.

Up/down/left/right/front guidance records only the user's deliberate progression.
The accessibility skip is explicit. Only the final frontal still is captured;
there are no movement frames, microphone data, face features, recognition, OCR,
document-authenticity result or liveness measurement. Both review and subsequent
actions revalidate current account/session/recovery generation. Edits invalidate
review. Capture remains optional and grants no work, key or posting authority.

Photo bytes and owned object URLs live only in the current workflow. Replacement,
removal, consent withdrawal, cancellation, leaving the identity journey,
backgrounding and reload release them. Late asynchronous results cannot restore
discarded selections. Android DOM storage is disabled. The old synthetic
enrollment store/receipts remain separate source fixtures; they never receive
actual images. **Finish capture** means locally reviewed photos only, with no
submission receipt or identity decision. Protected persistence, upload custody,
retention/deletion/backup rules and a verifier remain future work.

## Platform and validation

Android requests only CAMERA in the main manifest; all camera features are
optional. Its exact app-assets origin, exact bundled document, camera-only
resource, OS permission and foreground lifecycle must all agree before granting
WebView capture. The known system permission overlay may resume that same pending
request; real background loss cancels it. Other resources and foreign origins
stay denied. Debug alone retains the existing fixed-loopback account channel and
INTERNET permission; release gains no network/account channel. No USB settings,
containers, named volumes or developer sensor host were replaced.

The eleven-file shared runtime is 164,069/196,608 bytes. CSP permits own-origin
camera and blob image/media previews, while script, document, resource and
connection boundaries remain narrow. New capture staging uses a distinct managed
generation, preserving the old illustration stage and strict output guards.

The same managed application source snapshot, with explicit task-source updates,
passed 77 focused account/relay/camera/workflow/package/catalog checks, 22
build-process checks and 25 Chromium groups. Browser cases cover actual synthetic
video-to-JPEG capture, both orientations, guidance/skip, file refusal/selection,
review invalidation, late permission/encoding, foreground/navigation cleanup,
no photo storage/egress, mock enrollment/recovery and keyboard/320px/200% layouts.
Two test assumptions were corrected for intentional setup navigation after
interruption and retained keyboard focus; their suite reran successfully.

The actual running local relay/client completed mock enrollment confirmation,
PKCE/current context, sign-out and recovery with old-password refusal and fresh
login. A retained synthetic account was created; no real contact or personal
media was used. Backend formatting/static/unit and retained database checks
passed independently. The local API/worker were updated using their existing
launcher; database/object/viewer services and data were preserved.

Participant assembly/lint and actual compiled permission/assets/debug-signer
inspection passed against an independent retained baseline. No APK export or
installation, physical camera, phone lifecycle/permission, USB or real-mailbox
acceptance is claimed. Preview inspection shows mock-only email and the live
capture entry. Identity verification remains pending.

## Identity details, image preparation and private intake — 23 October 2026

This checkpoint supersedes the page-only custody description above for the new
submission path. Unsubmitted drafts still live only in the current page. The
signed-in identity entry opens the Level 1 document form directly; Level 2 remains
blocked until an authoritative Level 1 decision exists. Document type, full name,
city of birth, nationality and age accompany the document-front and frontal-face
photos. These are self-declared fields, not verified attributes.

The previous page-only processing checkbox is removed. Camera and file actions
remain deliberate. Before selecting an image, the shared adapter checks JPEG/PNG
headers and bounded input size (32 MiB, 64 megapixels, 16384-pixel edge). It uses
resized decoding and re-encodes every selected image as JPEG, removing source
metadata and preserving orientation. Document images have at most a 2400-pixel
edge and face images at most 1280; each output is at most 2 MiB. Lower quality and
resolution are attempted automatically when necessary. Unsupported or excessive
inputs fail before capture acceptance. Camera acquisition retains its existing
lease, cleanup and cancellation guards. This adds no OCR, recognition or liveness
measurement.

Normalized sRGB JPEG output also removes nonessential application markers and
comments, including the ICC block emitted by Chromium's encoder. The private
intake independently rejects hidden metadata, so bypassing the shared client
does not retain EXIF, GPS, IPTC, ICC or comment blocks. Only bounded standard
JFIF/Adobe markers are permitted alongside the JPEG image stream.

The full [Identity Intake Notice](IDENTITY_INTAKE_NOTICE_REVIEW.md) follows the
versioned Account Terms process: inspect the complete pinned text, explicitly
agree at its end, then separately submit the reviewed package. Opening the notice
alone accepts nothing. Changes to fields, photos or the notice invalidate review
and acceptance. The client compares exact text and SHA-256 with the bundled
canonical document; missing or changed bytes block submission.

The private service accepts an account/session/recovery-generation-bound package
only through authenticated intake. A private storage receipt is required before
the UI says it was saved. An interrupted reply keeps the original operation for
status checking and does not imply cancellation or permission to send a new
package. Receipts remain pending and unlock no identity badge or work privilege.
Private copies and exact notice acceptance can outlive the page and test-account
closure; local cleanup is not a service or backup erasure operation.

The current notice is a synthetic development draft. Hx02 owns its register and
unresolved custodian, retention, reviewer access, deletion/backup and real-data
adoption decisions. Intake is unavailable by default while those decisions remain
open. Synthetic tests exercise durable storage; they do not authorize collecting
real identity documents or establish compliance. The existing Account Terms bytes
and historical acceptance records are unchanged.

## Direct frontal photo interface — 23 October 2026

The shared participant interface replaces its optional movement exercise with a
single frontal still. Idle, live preview and selected-photo states share one
compact card. Start camera is deliberate; the live frame contains an oval guide,
and Take photo waits for camera readiness. Retake from the selected image or
review clears old media/review/notice agreement and starts a replacement camera
session. Capture still stops the sensor before encoding, and Stop returns to idle.
Keyboard focus follows camera readiness and photo selection.

The interface chooses the existing frontal-only workflow mode instead of asking
users to advance through direction steps. This changes no retained photo count,
processing purpose, notice acceptance, identity authority or liveness capability.
The shared optional guidance API remains available to its other consumers.
Existing authorization, lease, image bounds, foreground, cleanup, cancellation
and stale-result guards continue to apply.

## Compact identity submission — 23 October 2026

After the selected frontal photo, Continue performs the deliberate, current
revision-bound review and opens the final submission step. It does not repeat
the photos or fields: those remain available in a closed Review or change
details disclosure. Reading that disclosure changes no review or agreement.
Edits and replacement photos still invalidate both; incomplete required details
return directly to the document form through controls and history guards.

The final notice checkbox, label and link follow the Account Terms interaction:
opening the full pinned document accepts nothing. Only its end checkbox agrees,
then returns through Back. Submit before agreement opens that document without
sending media. Unavailable intake has a single status and no disabled submit
button. A pending or uncertain original operation locks editing and agreement;
its unresolved outcome permits status checking only, without a new submission.

This presentation change preserves the exact notice, separate deliberate storage
action, account/session/revision binding, unavailable live-intake gate and
unresolved custody/adoption decisions. It changes no retained fields, photos,
processing, verification authority or historical acceptance records.

## Test submission presentation and ownership — 23 October 2026

The owner selected test-data submissions under the existing synthetic-only v1
notice. The final review disclosure now precedes the notice checkbox, and the
screen and receipt distinguish retained test submissions from future document
checks/account validation. Pending remains unverified, without a processing-time
promise or an active reviewer claim. Document Try again clears the current
photo, preserves entered details and returns focus to the camera choice without
acquisition.

Hx10 owns the shared client and its availability/receipt handling. Hx11 owns
service admission, private custody implementation, activation and live evidence;
Hx02 owns the notice and unresolved real-user custody/adoption decisions. A
test-only availability decision does not authorize real IDs or change the exact
v1 document, its historical acceptance or either identity level's prerequisites.

Hx11 subsequently completed [test-only service activation](SERVICE_IDENTITY_INTAKE_CHECKPOINT.md)
for two selected existing confirmed synthetic accounts, including the client
review account. Live synthetic submission, exact retry, original receipt lookup
and private byte readback passed, with pending identity/work authority unchanged.
The verified preview/service continue using v1. Separately ongoing camera-proof
and successor-notice source work is preserved, unserved by this preview and
outside this completed validation scope.

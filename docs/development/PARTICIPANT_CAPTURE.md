# Participant mock confirmation and document/face capture

Implemented 21 October 2026. The owner selected functional document and guided
frontal-photo capture, with **mock email and no real sending until the last mile**.
One UI and two shared capture/workflow adapters serve the browser and Android.
This completes acquisition/review software, not verified identity or phone-camera
acceptance. The previous [local-account checkpoint](PARTICIPANT_ACCOUNT_INTEGRATION.md)
remains historical.

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

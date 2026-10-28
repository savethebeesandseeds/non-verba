# Non-verba participant UI

`src/` is the shared UI source for browser and the Non-verba APK. Android bundles
the HTML, CSS and JavaScript in a WebView; its native host lives in
`code/android/participant/` with package ID `org.nonverba.participant`. Keep
participant behavior in this one UI source and platform differences in adapters.

Current source camera acquisition uses the shared
[identity camera tool](../../../docs/development/IDENTITY_CAMERA_TOOL.md): strict
native front/rear capture without location, best-effort browser proofs, and
final-byte validation before optional proof-bearing intake. The native preview
owns its shutter. Imported documents have no capture proof. Synthetic notice
v2 discloses the new metadata while preserving v1 history; source integration
does not activate or reload the live service.

## One application across browser and Android

Edit this shared source to change either platform's interface. The browser
preview, Chromium workflow checks and APK stage/package inspectors all consume
`collectParticipantAssets` from `code/tools/build/participant-assets.mjs`.
The preview's ordinary responses must match those canonical bytes exactly;
the package inspector rejects missing, changed or extra bundled assets.
Maintained checks in `code/test/unit/participant-package-tests.mjs` exercise
that boundary, including rejection of local review markup in a package.

Keep screens, navigation, draft validation and workflow state shared. Put only
capability differences such as Android permissions or native acquisition behind
platform adapters; keep protocol rules in the shared Rust authority. Browser
checks exercise shared behavior, while Android still needs its host, lifecycle,
permission and native-adapter checks.

A source edit reaches an installed phone only after rebuilding and installing
the APK. The browser preview also needs a fresh source snapshot after edits. Run
one preview from the unmodified main working tree; do not patch a retained
snapshot into a separate client version. The local app has one document URL,
`http://127.0.0.1:4173/`. Its generated HTML adds only the local annotation CSP
exception and noindex metadata to the packaged application.
Temporary changes in browser developer tools do not edit source or an APK.

On 21 October 2026, all 20 focused participant package/workspace checks passed
in managed Debian, including two maintained HTTP parity/review-isolation cases.
They compare every ordinary preview response to canonical package bytes and
reject review-only markup or entries in a synthetic package. This check did not
rebuild/install an APK or repeat Android device acceptance.

`src/index.html`, `participant.js` and `participant.css` form the nonbinding
workspace preview. Its quiet Home shows the selected artwork; Requests and
Operations lists live in navigation. The separate operator example supports
browsing one synthetic job. Request creation requires identity verification;
operation creation and offering require advanced identity verification. The
current account contract reports only pending identity, so these actions and
their editors remain locked. Service-dependent publication, agreement and work
actions remain unavailable. The account service described below is separate
from this unconnected work preview.

## Compact Account and identity levels — 23 October 2026

Identity setup presents two small stamp targets: sage Level 1 for Requests and
mahogany Level 2 for Operations. Separate fixed entry points replace the level
selector. Level 2 requires authoritative Level 1 eligibility before dispatch,
during account revalidation and on restored capture routes. Local photo review
does not satisfy that prerequisite. The current pending-only contract therefore
keeps Level 2 locked. Level 1 currently prepares a document and face photo for
review; no verification service or advanced decision is implemented.

Account has an identity-stamp area driven by the
same authoritative workflow-access policy as request/operation eligibility.
The current validated pending-only contract unlocks neither level. Signed-in
accounts instead show a gray stamp in Account that says **No identity on record**;
signed-out views show no account stamp. Earned Level 2 also requires Level 1.
Settings contains only the Sign in or Account entry, without an identity stamp.
Email confirmation, photo review, device attestation, display flags and history
cannot grant an identity record or unlock a workflow. A document photo and a
face photo are not confirmed with the issuer. Capture indicators follow
the immutable bound pipeline rather than a selectable level.

Account/identity headings, controls and notices use concise literal wording.
The shared pages keep deliberate photo consent, unsubmitted/unverified status,
direct single-photo capture without liveness checks, recovery factors, versioned
terms and explicit unknown sign-out/deletion outcomes. Demo and page-lifetime
notes appear below the actions. Stamp masters remain in
`assets/identity/originals/`; the container-only branding recipe prepares the
128px transparent WebPs. Account displays its badge at 112px (96px on narrow
screens); capture uses a faint 128px watermark and setup uses 48px stamps.
The closed browser/APK asset set includes only
the three small WebPs, retaining the individual 8 KiB bound with a 400 KiB runtime
bound for this feature. No new native interface, permission or dependency is
introduced.

## Identity prerequisites — 22 October 2026

New request and New operation are native disabled buttons until their respective
identity prerequisites can be established. The same policy guards navigation,
rendering, Back/Forward history, form input and submission before draft mutation.
Request editor/review and later Requester steps require basic verification;
operation editor/review, offers and later Operator steps require advanced
verification. Requests/Operations lists and the read-only work example remain
available. Accessible descriptions explain each disabled action.

The policy consumes the account adapter's current snapshot. That validated
contract supplies only pending identity and has no accepted basic/advanced
eligibility record. Consequently, no current account can unlock these actions.
Email confirmation, account roles, captured photos, device attestation, display
readiness, altered DOM or restored history cannot supply that authority. A
blocked action preserves inert drafts; losing/changing the authenticated owner
clears workflow drafts and review values without clearing unrelated account,
recovery or API state.

This closes the current preview's draft entry points. It does not add a person
verification service or server-side basic/advanced authorization. Before any
connected work mutation is enabled, the service must supply authoritative
eligibility and enforce it independently on that mutation. Earlier draft-entry
examples below describe historical layout checkpoints, superseded by this gate.

## Compact header and navigation

The first 21 October design review centered the sprout and application name between
equal 44-pixel controls. Two unequal horizontal lines open left navigation;
three dots open the right Settings panel. Requester/Operator choices live only
in navigation. The Preview badge and footer tagline are removed; the concise
nonbinding notice and draft-lifetime information remain.

The panels use labelled modal dialogs, keyboard focus containment and return,
Escape/outside dismissal, and same-document history so Back closes a panel
before leaving the underlying view. Opening/dismissing panels and role switching
preserve drafts. Settings shows Account, API access, Status and Budgets with
their actual unavailable/no-data state; it creates no account, credential,
service connection or budget operation.

All 20 focused package/workspace checks and ten Chromium groups passed. Header
and dialog layouts cover 320, 390, 631 and 1280-pixel widths plus 200% text at
320 pixels. The shared four-asset UI totals 40,138 bytes within the existing
64-KiB budget. The refreshed in-app browser was also inspected. This design
checkpoint does not rebuild/install an APK or verify Android WebView menu/Back
behavior on a phone; the earlier installed build remains separate evidence.

## Landing page, Requests and Operations

The follow-up review keeps both menu controls fixed while the centered brand
scrolls away. The notice beneath the header is removed. Home presents Requests
and Operations before any form is selected. Left navigation links to both lists;
small inline feather and hammer SVGs open the request and operation draft views.
The artwork adds no runtime dependency or separately packaged asset.

Each list reflects its current in-memory draft, including incomplete input and
literal titles. The operation draft has its own name/description validation and
review; creation remains unavailable. It is independent from the existing
request and synthetic offer drafts. This prototype holds one draft of each kind,
does not invent server records and does not define a service operation schema
or execution permission. Deliberate reset clears all three drafts and returns
Home; closing/reloading clears them as well.

All 22 focused package/workspace checks and 13 Chromium groups passed in managed
Debian. They include landing/list routing, independent drafts, literal titles,
fixed/clickable controls after scroll, scrolling brand, modal focus/Back handling,
responsive layouts and no service/storage/native-authority calls. An added
source check requires the Android fragment allowlist to equal the shared routes.
At that layout checkpoint, the shared four-asset UI totalled 49,641 bytes within
the unchanged 64-KiB budget.
The refreshed live browser landing/menu was visually inspected. No APK was
rebuilt or installed, and Android WebView behavior remains a later device check.

The following icon-only correction adds matching open-square outlines and a
broader claw-hammer shape to both menu/list new actions. Fourteen focused
package/HTTP-parity guards passed, and the exact shared SVGs were rendered at
larger size for review. Navigation and draft behavior are unchanged; no APK
was rebuilt for this artwork correction.

## Quiet home, About and author credit

The next 21 October review removes the Home title and list shortcuts. Home keeps
the existing header/fixed menu controls, a small centered sprout character, and
the Waajacu mark with a linked `by waajacu` footer. Requests and Operations stay
in left navigation under a centered Dashboard heading, with no Home link or close
button. The bold Requests and Operations labels expand independently, starting
collapsed each time the drawer opens. Their feather/hammer actions remain directly
available, with native New request/New operation hover titles and accessible names.
Clicking the backdrop or pressing Escape or Back closes navigation and restores
focus to its menu control. Dashboard sections use the same dividers and spacing
as Settings. Both drawers have centered headings and no close buttons; the
static Settings panel focuses its heading and keeps keyboard focus inside.
Its final About section always shows the version/license line, without
descriptive copy or a disclosure toggle. Local draft management is deferred;
its section, reset handlers and unused styles are removed.

The header's sole visible wordmark is `Facta, non verba.`, with `non verba.`
italicized, beside the sprout. The author credit uses 0.78rem text and a 24px
mark. An earlier branding checkpoint placed the motto beneath Non-verba;
fourteen package checks and fourteen Chromium groups passed at that stage,
including narrow layouts, 200% text and readable header/footer bounds. That
historical six-asset runtime was 62,569 bytes; the styling review needed no APK
build.

This drawer revision passed 22 focused package/workspace checks and 13 Chromium
groups, including centered headings at phone/desktop widths and 200% text,
bold disclosure labels, hover titles, always-visible final About, preserved
in-memory input and the unchanged plain URL. Follow-up checks also cover matching
Dashboard dividers and keyboard focus in static Settings without a close button.
The runtime is now 58,567 bytes.
No APK build or phone installation was needed for this shared UI review.

The simplified drawer passed 22 focused package/workspace checks and 13 Chromium
groups, including independent disclosure, hidden empty states, draft retention,
focus containment and outside/Escape/Back dismissal. The shared six-asset runtime
totals 59,833 bytes. This browser review does not rebuild or install either APK.

The original artwork is preserved. Explicit preparation uses the managed
Chromium canvas recipe, WebP quality 0.85 and transparent contain fitting:

```sh
node tools/build/prepare-participant-branding.mjs --write
node tools/build/prepare-participant-branding.mjs --check
```

The selected `01-sprout.png` becomes a 160px, 6,512-byte shared asset rendered at
96px. The original Waajacu favicon becomes a 48px, 2,142-byte shared asset rendered
at 24px after the footer-size review. Both reviewed files live in `assets/branding/`, with an 8-KiB individual
limit. Routine builds consume them directly; they do not regenerate artwork or
launch Chromium. Browser preview, Gradle and Android share an exact six-file
runtime closure totaling 59,147 bytes at that layout checkpoint, within the
unchanged 64-KiB limit.

The footer links to `https://waajacu.com/`. In Android, only a user-initiated,
main-frame GET to that exact URL, excluding redirects, is handed to the external
browser. The bundled WebView keeps its network and other navigation restrictions.
No new network permission, credential flow or JavaScript bridge is introduced.

Artwork recipe checking, 28 focused package/workspace/screen-awake checks and
13 Chromium groups passed. Participant assembly/lint also passed in managed
Debian (34 seconds; 16 tasks executed, 31 up to date). The browser Home/About
was visually inspected. This build was not exported or installed; the external
browser handoff and new layout still need a later phone check.

Navigation uses button actions and same-document history state. The browser and
APK document URL stays plain: no view, drawer, draft or form state in a fragment,
query string or path. Incoming query/fragment values do not select a screen and
are removed when the document opens. Share links are deferred to a separate
explicit request/operation sharing contract.

The plain-URL change passed 22 focused package/workspace checks and 13 Chromium
groups covering editing, reviews, drawers, Back/Forward, ignored legacy URLs and
reload/reset. Legacy list/example views without a current menu path use explicit
synthetic history restoration fixtures; current draft actions use actual controls.
At that checkpoint, the shared runtime was 60,847 bytes. Participant assembly/lint passed in managed
Debian (27 seconds; 15 tasks executed, 32 up to date). No APK was exported or
installed; native Back behavior still needs a phone check for this build.

Drafts survive internal Back/Forward, editing and list navigation in memory only.
Reload clears them and returns Home. Keep this lifetime visible and preserve plain language,
one primary action per view, labelled fields and keyboard access.

The Android participant variant stages an explicit allowlist of those shell
files and canonical artwork from `web/site/branding/`. Developer evidence tools,
WASM/native sensor libraries, models and browser inspections are outside that
shell. Keep future participant workflows scoped to their agreed behavior and
service contract.

For a browser design review, run from the repository root on Windows:

```powershell
./code/dev.ps1 -Snapshot -Action Exec -Command @('env', 'NONVERBA_BIND=0.0.0.0', 'node', '--run', 'serve:participant')
```

This uses the existing managed container and host loopback port 4173. Open
`http://127.0.0.1:4173/`. No Android or WASM build is needed. Root serves the
application directly. Old document URLs redirect to root; they do not expose
another page version. Relative resources resolve to exact participant catalog
bytes. The in-memory local HTML permits style elements for Codex selection,
forbids style attributes, keeps script policy strict and is marked noindex.
Production/package HTML keeps its exact strict source bytes; the local entry
and server do not enter the APK. A source snapshot is fixed; restart this
preview from a fresh snapshot after editing the UI.

Use the [Android guide](../../../code/android/README.md) for the separate participant
build, package checks and acceptance boundaries. All builds and checks run in
the managed container. See the [web architecture](../../README.md) for the other
applications.

## Attention indicators

The shared UI projects attention from explicit request/operation item IDs through
`renderAttention(root, {requests: [...], operations: [...]})`. The menu gains a
small blue bell at its top right, the matching Dashboard section gains a bell,
and the corresponding list item gains a right-aligned blue dot. Accessible
descriptions identify attention without relying on color alone.

Only IDs matching present list rows contribute to the section/menu indicators.
Closed drawers and collapsed lists retain them. Opening a drawer, section or
item does not acknowledge or clear attention; a new source projection clears it.
Ordinary local drafts never generate notifications. The current row IDs are
local UI bindings, not service record IDs or a backend event contract.

Startup remains quiet. There is no push permission, polling, native bridge,
network call, persistence, counter or animation. Browser screenshots use explicit
synthetic input and example item titles through the same renderer, without
changing the preview entry or encoding state in the URL. A later backend adapter
must supply the actual item IDs and attention decisions; this projection does
not establish their authority or define what events require participant action.

Twenty-two focused package/workspace checks and 14 Chromium groups passed,
including copied input, request-only/operation-only/combined flags, duplicate and
unknown IDs, row removal, retained attention through navigation, accessible
descriptions and 320px/200% layouts. The optional-field clearing fixture was
corrected and rerun in the same managed source snapshot. The six-asset runtime
totals 62,156 bytes within the unchanged 64-KiB guard. No APK build, installation,
backend event or device notification was involved in this design review.

## Role setup warnings

Both Dashboard role labels initially show a 16px triangle for missing identity
setup, aligned at the right edge while collapsed. Expanding Requests or Operations
moves that same yellow SVG to the left of the blue `Set up identity verification`
action. Warning triangles remain yellow while action text stays blue.
Expanded rows are indented 24px: setup uses the warning icon, empty lists use a
circle with a slash, and draft rows use the matching feather or hammer. These
icons share inline SVG symbols in the document, with no added assets or dependencies.
Settings also exposes a yellow warning and an active blue `Create account`
entry. It and both role setup actions open the shared `identity/setup` view,
titled `Account and identity`, while the document URL stays plain. Back returns
to the previous view and preserves the independent in-memory drafts.

The menu shows a setup warning at its bottom right while either role still needs
setup. It stays separate from the blue attention bell at the top right, and hides
only when both roles are ready.

`renderRoleSetup(root, {requests: true, operations: false})` projects display
readiness only: a ready role hides its triangle and setup link. It does not
verify identity or grant permission to publish requests or accept operations.
Each renderer owns its accessible description token: `Identity setup required`
composes with attention on the role labels and menu control. Refreshing either
display preserves the other hint.

The original setup checkpoint placed a disabled account-creation action before
identity verification. The account-first sample journey below now replaces that
placeholder. Posting, operation creation and other service-dependent actions
remain unavailable.

The preceding role-setup checkpoint passed 22 focused package/workspace checks
and 15 Chromium groups in managed Debian, including both setup entry points,
Back/draft retention, per-role display readiness, composed descriptions and
layouts from 320 to 1280 pixels plus 200% text. Its six-asset runtime was 64,560
of the allowed 65,536 bytes. That historical result does not cover the subsequent
icon placement and menu warning refinement. No APK build, installation, phone
test or backend integration was established by that checkpoint.

The 21 October warning-placement refinement passed 22 focused package/workspace
checks and 15 Chromium groups in managed Debian. Checks cover warning-node
relocation, right alignment, blue indented setup rows, reused row icons, composed
descriptions and separate menu warning/attention indicators at 320px and 200%
text. The shared six-asset runtime is 65,470/65,536 bytes. No APK build,
installation, physical-device test or backend acceptance is claimed.

The subsequent click correction resolves delegated navigation from the original
event path. Clicking a collapsed triangle expands its role without opening
identity setup after the icon moves; the explicit setup link still navigates.
Both real triangle-click regressions passed with the 22 package/workspace checks
and 15 Chromium groups. Runtime is 65,499/65,536 bytes; no APK or service change
was involved.

The 21 October account-entry refinement passed 22 focused package/workspace
checks and 15 Chromium groups in managed Debian. Yellow warning icons and blue
action text remain distinct; Settings and both role links open the account-first
flow. Checks retain keyboard modal behavior, 320px/200% layouts, Back/draft
preservation, the plain URL and collapsed-triangle click regression. Identical
button reset declarations are shared to keep the six-asset runtime at
65,498/65,536 bytes under the unchanged guard. This review collected no
credentials or media, added no service integration and performed no APK or
device operation.

## Account-first sample onboarding

This is the earlier fixture-only checkpoint. The connected local account
implementation below supersedes its account adapter and networking boundary;
the illustrated identity workflow remains separate.

At that checkpoint, the shared browser/APK interface covered account creation, sample email
confirmation, sign-in, sign-out and two-factor recovery before initial document
and frontal-photo enrollment. The Settings Account entry and both Dashboard
setup links open this journey. Its closed internal views use same-document
history; no account, enrollment, selected item or step is encoded in the URL.
Back/Forward passes the same current-account and selected-item prerequisites as
button navigation. Async completion cannot navigate or focus a departed view.

`onboarding-account.js` accepts only the supplied reserved `.invalid` sample
accounts and fixed sample password, confirmation and recovery codes shown in the
interface. Creation demonstrates pending confirmation. Sign-in can reopen the
predefined confirmed fixture after reload, without restoring a real login.
Account metadata, passwords, codes and session identifiers stay in memory;
secret controls clear on submission and view changes. This is not a password
service, real email delivery, session authority or password reset. Recovery
requires both sample factors, revokes the sample session and changes its
generation within the open page only. Reload resets the bundled fixture account,
including recovery generation; this sample cannot demonstrate persistent recovery
revocation. Google, X and Apple linking remain future planning.

`onboarding-ui.js` composes Hx02's selected
`code/test/fixtures/identity/synthetic-enrollment-workflow.js` (its current location); it does not copy identity
policy into Kotlin. An active confirmed sample binding is required before the
workflow begins. The user deliberately enables processing, selects one bundled
illustrated document, follows up/down/left/right/front guidance and selects a
frontal face illustration. The animated guide requests no sensor and measures
neither movement nor liveness. It does not grant real identity assurance or
posting/operation permission. Real role-specific initial face requirements are
still an owner decision.

Review displays both items, with replace/retake, separate retention consent and
explicit confirmation before saving. Any selection/consent edit invalidates
review. Reopening an unsubmitted saved selection requires fresh review. Cancel
clears the active selection but does not delete a saved record. A separate
deliberate deletion removes the selected illustrated media; a previously issued
media-free local receipt remains. Submission records only an exact local sample
receipt and always leaves identity unverified. An uncertain submission exposes
original-operation lookup/retry and blocks editing/deletion until resolved.

The only persisted data is Hx02's validated bundled-fixture envelope/receipt,
under `nonverba.synthetic-enrollment.v1:`. The UI storage adapter rejects other
key prefixes and bounds record size. No email, password, confirmation/recovery
code, session token or arbitrary user media enters those records. A new page
starts at Home signed out; deliberately signing into the same fixed fixture and
choosing the same role can restore its saved illustrations. Account/recovery
bindings isolate retained selections. Storage failure stays a visible error or
uncertain result, not a success claim.

The reviewed participant runtime expands from the original six files/64 KiB to
exactly thirteen selected files/128 KiB for this feature: five app UI files, the
shared workflow, three branding files and four tiny prepared SVG illustrations.
Each image retains its 8 KiB bound. The browser collector, Gradle, native map and
package inspector share that closure. SVGs are prepared byte-exactly from the
shared fixture export; strict self-only image/script policy is preserved. Android
DOM storage is enabled for these synthetic fixtures; no network/camera permission,
file picker, JavaScript bridge or real-media custody is added.

Real account service integration, confirmation delivery, credential custody,
identity capture permissions, sensitive-media retention/reviewer authority and
identity decisions remain separate Hx02/Hx11/platform work. See
[the enrollment handoff](../../../docs/development/IDENTITY_ENROLLMENT_SLICE.md).

Focused checks run only in the managed container:

```sh
node tools/build/prepare-participant-identity.mjs --check
node --test test/unit/onboarding-account-tests.mjs test/unit/synthetic-enrollment-workflow-tests.mjs test/unit/participant-workspace-tests.mjs test/unit/participant-package-tests.mjs test/unit/test-suites-tests.mjs
node test/browser/participant-browser-check.mjs
node test/browser/participant-onboarding-browser-check.mjs
```

On 21 October 2026, the fixture-byte check, all 49 focused account/workflow/
workspace/package/catalog checks, the 15 existing participant Chromium groups
and eight new onboarding groups passed in one managed source snapshot. Browser
checks include a delayed real digest followed by Back, pending receipt/deletion,
reload without a restored session, and 320px/200% keyboard layout. One test
expectation was corrected to preserve Settings-toggle focus when sign-out stays
on the same gateway. Participant assembly and lint passed (55 seconds; 16 tasks
executed, 31 up to date). The 13-file runtime is 121,371/131,072 bytes.
The refreshed in-app browser also completed the sample account, guided
illustration review, retention and pending receipt sequence. No APK was exported
or installed. Native DOM-storage lifecycle, real camera/document handling,
connected accounts, physical devices and real-person assurance remain untested.

## Connected local accounts

This records the first service-client checkpoint. The later
[mock confirmation and live capture](#mock-confirmation-and-live-capture) section
supersedes its mail/camera, fixture-storage and fourteen-file runtime limits.

The shared application now uses the local account service for reviewed account
enrollment, pending confirmation, email/password sign-in, current account/session
context, sign-out and two-factor recovery. It accepts made-up `.invalid` contacts
for this development environment, rather than fixed UI accounts/passwords.
Creation includes current display-name/email/role review. Confirmation creates no
login; the user explicitly reveals and saves the generated recovery code, then
signs in. Recovery requires the existing recovery code plus a separate contact
confirmation and new password, rotates the recovery code and requires fresh login.
Google, X and Apple remain unimplemented.

`onboarding-account.js` performs the registered authorization-code/S256 PKCE
exchange, verifies the exact callback/state and ES256 ID-token signature,
issuer/audience/nonce/time claims, then requires the authoritative
`/v1/account/context`. Tokens alone do not render a signed-in account. Current
account reads revalidate session/account/generation, serialize rotating refresh,
and fence cancelled or late responses. Passwords, tokens, operation secrets,
confirmation factors and recovery codes are transient application memory, never
app URL/history or browser storage. Reload starts signed out. Server accounts and
recovery changes persist independently. Failed/uncertain server sign-out is
distinct from explicitly forgetting a local session, with no false stopped-work
or revocation claim.

Browser development uses `account-transport.js` and the narrowly allowlisted
same-origin relay in `code/tools/preview/participant-account-relay.mjs`. It is off
unless explicitly enabled with `NONVERBA_ACCOUNT_RELAY=local`. It forwards only
the selected account/OIDC operations to the fixed existing development service,
checks Host/Origin, retains only short-lived authorization CSRF cookies per
unguessable one-use flow and follows no redirects. It passes bearer authorization
only from the current request. Request/response sizes, concurrency, rate and
timeouts are bounded; errors omit upstream text and credentials. It transits
credentials in memory and adds no public mail/admin access, general proxy or CORS
grant. The app URL remains plain throughout authentication.

The debug APK uses an exact-origin/main-frame WebMessage channel from the bundled
document to a fixed numeric-loopback relay URL. Only debug requests INTERNET and
permits numeric-loopback cleartext; the existing documented USB 4173 forwarding
is the selected development transport. No phone action or new forwarding port was
performed. WebView resource networking/cookies remain blocked, release has no
account bridge/network permission, and there is no camera/file/media capability.
Lifecycle teardown cancels workers and rejects stale replies. One UI source still
serves browser and APK. The reviewed closure is fourteen files/192 KiB, with the
8 KiB per-image and 8 MiB APK bounds unchanged.

Identity enrollment still uses bundled illustrations only, bound to a freshly
revalidated signed-in service account and declared role. Its local receipt is
never sent as an identity decision to the account service. Signing in does not
verify identity, approve keys, publish requests, accept operations or start work.
Real contact delivery, real media custody/capture, deployment and phone acceptance
remain pending. The local confirmation sink is privileged; the app cannot read it.

All 65 focused checks and 23 Chromium groups passed. The final 155,640-byte
runtime assembled/linted successfully, and actual APK permissions/assets/debug
signer inspection passed against an independent retained baseline. A separate
live shared-client check passed enrollment, operator-supplied private confirmation,
email PKCE/context, sign-out and recovery with old-password denial and fresh login
against the running local service. Its disposable challenge transfers were kept
private and atomic; no factor was displayed in the browser or console. No APK
export/install, phone validation, real mailbox delivery or real identity assurance
was performed. See the [integration contract and checks](../../../docs/development/PARTICIPANT_ACCOUNT_INTEGRATION.md).

## Mock confirmation and live capture

The owner selected mock email until the last mile. Create a test account with an
`example.invalid` address, open its **mock email**, use that code and deliberately
confirm. Save the generated recovery code privately, then sign in. Recovery uses
the same mock inbox plus the existing recovery factor; no real email is sent.
The mock service returns a code only for the exact secret-bound, pending reserved
test operation. Real contacts are refused in mock mode; ordinary mailbox delivery
and external sign-in providers remain outside this checkpoint.

After signing in, choose a declared role and processing consent. Start the rear
camera to photograph the document front, or deliberately select a bounded JPEG/
PNG in the browser. Then start the front camera, follow up/down/left/right/front
guidance (or explicitly skip it), and take one frontal still. Review the exact two
photos, replace/retake or discard them, and finish capture. Camera images are
bounded JPEGs re-encoded without source-file metadata. The browser file option
holds the original bounded image; it does not upload it. Android uses its camera
and deliberately provides no file picker.

The camera stops before encoding/review. Permission cancellation, track loss,
the 90-second local camera lease, navigation, backgrounding and account loss fence
late results. Retakes invalidate review. Photos and object URLs stay in memory;
cancel, leaving the identity journey, backgrounding or reload discards them.
Android DOM storage is disabled. No photo is written to the synthetic fixture
store, sent to the account service or presented as a submission/identity decision.
Guidance performs no movement/liveness measurement, OCR or face comparison.
Identity and posting/acceptance authority remain unverified/unavailable.

The closed shared runtime now contains eleven files (164,069 bytes within the
unchanged 192 KiB limit): six app files, two shared capture/workflow modules and
three branding assets. Four illustrations and the synthetic workflow remain
source fixtures outside the product runtime. The new managed capture stage leaves
the old fixture stage untouched. Android adds only the optional CAMERA capability;
the exact bundled origin and foreground document gate camera permission. The
debug-only account network boundary remains unchanged.

All 77 focused checks, 22 build-process checks and 25 Chromium groups passed.
The live shared client completed a retained test account's mock confirmation,
PKCE sign-in, sign-out and recovery against the running local service. Android
assembly/lint and compiled permission/assets/retained-signer inspection passed.
Camera browser checks used synthetic Chromium video, not a person's ID or face.
No APK installation or physical-camera/phone acceptance is claimed. See
[the capture contract](../../../docs/development/PARTICIPANT_CAPTURE.md).

## Delete a test account and repeat setup

Settings now offers **Delete test account** while signed in to the local mock
service. Type the current email and password and explicitly confirm. This closes
that account, revokes its credentials and frees its email for registration again
with fresh account/principal IDs. The account record stays for a retention period,
so it can still be found if information about the account is required. The
length of that period is not selected. Deletion confirms only after the same
read-then-agree checkbox used for account terms. Cancel clears the controls.
A lost result stays unknown
until **Check original deletion** resolves the same private operation, without
blind mutation retries.

The deletion increment passed 56 focused checks, 27 Chromium groups and actual
local-service deletion/status/same-email re-registration. The eleven-file runtime
is now 172,328 bytes within the unchanged 192 KiB bound. The participant APK was
built, exported, independently inspected and installed on the connected phone
with matching installed hash and preserved app data. Its account entry reported
the mock service connected; physical camera/onboarding acceptance remains separate.
See [the test-account and phone-update record](../../../docs/development/PARTICIPANT_ACCOUNT_DELETION.md).

## Status icons and propagation

Every status has one source ID, an owning section, a kind and a plain-text
description. The same source can appear in more than one view without creating
extra alerts. Sources belong to a declared parent tree: request/operation items
lead to their Dashboard sections, while account/API/service/key information leads
to Settings. The two header buttons use the same renderer and aggregation rule.

Warnings are yellow triangles, errors are red crosses, notifications are blue
bells (dots beside individual items), pending checks are blue clocks, and unknown
results are question marks. A healthy check is green; neutral information uses an
information icon. Icons have accessible descriptions and never replace status text.

The common rule is:

1. Show the full state at its source. Roll issues and notifications up through
   every declared ancestor, including its header button.
2. At each summary, show one highest-priority issue (`error`, `warning`, `pending`,
   then `unknown`) and an independent notification bell. Duplicate messages and
   sources do not add duplicate badges. Healthy and neutral states stay local.
3. Expanding a branch hides that branch's summary icons and reveals its item
   icons. The header summary remains. Opening, reading or closing never clears
   the source; only a new producer state resolves it.
4. Replacing or removing sources recomputes all ancestors. Missing owners,
   conflicting IDs, broken parents and cycles cannot leak into another branch.

Declare a node using `data-status-node` and, for a nonroot node, an explicit
`data-status-parent`. An origin uses `data-status-source`; a summary uses
`data-status-summary`. A summary may name its disclosure button through
`data-status-disclosure`. Call `setStatusSources(root, namespace, records)` with
`{id, owner, kind, message}` records to replace that producer's current states.
Adding a feature under an existing owner requires no custom header-button logic.
The reducer/renderer live in the shared participant module, so browser and Android
use the same behavior. These are display hints, never authentication or work authority.

Settings performs fresh read-only checks on opening, then ten seconds after
each completed check while it remains open and visible. Closing, backgrounding
or leaving the page stops scheduling; an in-flight bounded read may finish.
Reopening or returning checks immediately, including a restored open drawer.
Background checks retain established labels and glyphs until a new result arrives;
unchanged glyphs retain their DOM nodes. Checks do not overlap and pause during
account actions. API discovery and local
persistence-service readiness are separate.
Cached configuration does not stand in for a live response. The account adapter
retains bounded current-session key diagnostics; failures, owner/generation
mismatch or truncated lists remain unknown/incomplete rather than empty or
healthy. Settings does not render a device-key row or propagate a status from
that removed row. An approved server mapping does not prove a private key is
present on this device. Creating, binding and approving device keys are not
connected in this participant interface yet. Budget data is unreported;
readiness does not verify identity, email
delivery, signing ability or all background services.

Network, API and Server appear as compact rows under **Services**.
Network feedback uses a success check for the device's online indication,
a warning while offline and an unknown glyph when indeterminate; network availability
does not confirm internet reachability. Server readiness is the actual API
response, independent of that indication. No third-party connectivity probe is
added. Budgets has its own section outside service status. Both Budgets and
**Manage API keys** are hidden initially and shown only while signed in; they
hide again on sign-out or session loss. If the API entry is focused when it
hides, focus returns to Account. Manage API keys closes Settings and opens the
main-workspace preview. It does not accept server configuration or an existing
secret. This visibility rule grants no server authority and does not change
the inert prototype's history-restoration routes.
The signed-out account entry is **Sign in**. Dashboard identity warnings appear only
for signed-in accounts still awaiting review and clear on sign-out. Requests
use **Start Level 1 identity** and Operations use **Start Level 1 identity first**.
These labels name the identity level. They do not confirm a person with an issuer.
Settings account actions use separate compact rows with 44px targets. Header
issues occupy the inward lower corner: lower-right on Dashboard and lower-left
on Settings. Independent notification bells use the matching upper corners.
These positions and the nested API group use the same propagation rule above.

## Simple sign-in

The first field accepts **Email or username**, including optional `@` and ASCII
case normalization for the public account handle. Continue selects the password
step locally for every valid identifier, without a service lookup, email or
account-existence claim. Email and public username authenticate through the
existing password/PKCE flow. Unknown and incorrect credentials receive a generic
denial; only authenticated current context reveals a handle's confirmed email.
Back clears the password step and secrets. No anonymous directory lookup exists.

Settings opens **Sign in** when signed out and **Account** when signed in. The
signed-out entry contains Email or username, Continue and a **Create account**
link. Only that explicit signup path requests an email code before the new-account
form, whose confirmed email stays readonly. Recovery separately requires email
proof and a recovery code. Username-origin recovery asks for the account email;
it does not resolve the contact anonymously. The shared **Back** control handles
identifier, password, signup email and code steps without repeating mail or
restoring secrets; browser/native Back follows the same history. Successful authentication
returns Home; sign-out and local forgetting return to the sign-in screen.
Identity capture remains a separate explicit journey.

If this open page holds a signed-in session, the centered **Account** page shows
its email and public @username. These are
selectable details from the validated account snapshot, with no editable fields
or secret credentials. Devices, Sign out and the red Delete account action use
decorative SVG icons. **Level 1 identity** shows the existing yellow warning
with an accessible prerequisite description while that level is missing;
there is no separate Pending profile row. These actions live on that
page; Settings keeps its compact account summary and Account link. Deletion
retains its development-only availability and existing confirmation flow.
**Level 1 identity** performs a fresh current-account read, including the
adapter's bounded refresh and principal/session binding checks, before opening
identity setup. Failure cannot grant authority. Confirmed server sign-out clears
the details and returns to a fresh sign-in entry. An uncertain result retains
the separate local-forget action without claiming server revocation. Tokens and
passwords remain memory-only; no remembered email, localStorage credential,
device-login database or cross-reload restore is added.
The signup entry contract retains bounded operation-owned POST start/confirm
requests and no login authority. A password failure never chooses signup.
The service generates eight hexadecimal code characters. Eight visible slots
share one labelled input with autocomplete, paste, lowercase normalization and
normal keyboard editing. Continue requires all eight characters. Invalid codes
remain subject to the existing five-attempt and expiry limits; this routing
challenge grants no account authority.
Email remains mocked: reserved synthetic contacts can open **Email preview** to
view the backend's simulated message. Its **Use code** control fills the slots
without confirming them. This simulation does not establish real mailbox
ownership. SMTP mode never exposes that preview; no mail configuration or external delivery changes
are part of this UI work. Neither path stores a remembered email or credential.
The existing development issuer has no silent-login/session-restore contract;
the CSRF cookie is not reused as a login credential.

## API key management preview

The intended pattern is first-party key issuance: name an integration's key,
choose limited permissions and expiry, generate it, reveal its secret once,
then identify it by a masked prefix in a management list with usage dates and
revoke/rotate actions. This follows the documented dashboard patterns in
[Stripe's API key guide](https://docs.stripe.com/keys) and
[Cloudflare's token creation guide](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).
Server deployment and endpoint selection belong to the application configuration.

The **+** button opens an editable name, permissions and expiration form, with a
separate **Generate API key** action aligned right below it. The permission
choices are Read only and Read and write; expiration includes 24 hours, 7 days,
30 days, 90 days, 365 days and Never expires.
Required fields and blank names are validated before generating a page-only
**Demo key**. Its `nv-` value is unusable for authentication and is cleared by
Done, closing the form or changing routes. Demo rows show masked prefixes and
support removal through Revoke; metadata lasts only in this open page. There
are no key-service calls, persistent storage, real bearer credentials or API/MCP
authority. The inventory reads **Unavailable** when there are no demo rows;
this is not an empty or healthy account claim. Device signing keys and login
tokens remain separate. Real issuance, scopes, storage, secret delivery and
lifecycle APIs still need their own backend contract.

The readonly key stays selectable, and focus/click selects its complete value.
**Copy** reports success only after the browser clipboard write completes. A
refused or unavailable clipboard selects the field for manual copying. Done,
new generation, revocation, route changes and page exit clear the result and
fence delayed UI feedback. Copying adds no server request or key persistence.

This dashboard adds no dependency. The current closed runtime includes the shared
attestation tool, browser-key module, bundled versioned account terms and recovery-export adapter: fifteen files under a
reviewed 296 KiB allowance. Compact code entry used 212 KiB; device proof and inventory extended that
reviewed allowance. The 8 KiB per-image and 8 MiB APK limits
remain unchanged.

Signed-in accounts can open **Settings → Devices** to review device/session
activity and sign out individual sessions. Android sends a dedicated Keystore
possession proof and certificate chain; browsers are explicitly unverified.
See [sign-in devices](../../../docs/development/PARTICIPANT_SIGNIN_DEVICES.md)
for the attestation, privacy and physical-validation boundaries.

The workspace is labelled **Developer services** and **API and MCP keys**.
Centered below the key panel with additional spacing,
**swagger.platform.non-verba.com** opens the intentionally
empty shared documentation view. It uses the same Back widget and plain app
URL. This is a local documentation placeholder: no DNS/hosting, Swagger UI
dependency, OpenAPI operations, MCP tools, server configuration or external
navigation is added. The future reference can document the agreed API and MCP
contracts when they are ready.

The shared header Back widget is mounted once through
`mountBackControl(document, onBack)` in `participant.js`. Its native button,
decorative arrow and label live in that component; `.back` owns its common style.
Every participant route and both platforms use that same instance. The caller
retains the existing history/fallback policy; contextual cancellation and draft
destination actions remain separate actions.

## Centered signup and versioned account terms

Sign in, Confirm email and Create account share a centered 440px column, bounded
by the available screen width. Email preview includes Copy code with a selectable
fallback when clipboard access is unavailable. Back clears the old preview and
cannot display a delayed copy result on another step.

Signup shows the confirmed email first with gray readonly styling, then a unique
username with a fixed `@` prefix and a five-level password bar. The API keeps
the bare canonical username. Level 2 is required. Both Requester and Operator roles are enabled;
signup grants no work-key, signature, identity or sensor authority. The private
service independently enforces username uniqueness, confirmed email binding and
new-password policy.

Weak-password hints distinguish length, common passwords, repetition, sequences
and account-derived choices, suggesting unrelated words. They update visibly
and through a polite accessible announcement; eight characters alone do not
guarantee acceptance. The password policy and five-level thresholds are unchanged.

Create account stays clickable when the service, confirmed email and pinned
terms are ready. Local field feedback explains corrections and preserves the
draft; invalid details never submit enrollment. Hyphenated usernames suggest
underscores. Valid details without agreement open full terms for review.

The inline **account terms** link beside the checkbox opens the complete document
and preserves the in-memory signup draft on Back. Activating the signup checkbox
also opens that view without checking it. Draft status and the version
appear in that document view.
Only the agreement checkbox at the end of the full document records the choice. It returns to signup through
the same Back action and synchronizes its consent choice, preserving the draft.
Back without agreeing does not accept the terms.
Agreement survives ordinary username/password corrections and a refused username
submission. Password controls still clear on submission; changed/unavailable
terms, withdrawal or leaving the signup context reset the choice. The app checks
the service's complete text and SHA-256 against the bundled authored document;
enrollment binds the exact terms ID, version and hash. The service retains that
full text and the account's agreement record. Missing or changed terms block
signup. Current terms are a development draft, not an adopted public agreement;
operator, eligibility, countries and governing law remain open for Hero 2 review.

See [the signup integration record](../../../docs/development/PARTICIPANT_SIGNUP.md).

The recovery screen now reveals eight independent codes in two columns and four
rows and downloads the same set as `non-verba-recovery-codes.txt`. Continue needs
no checkbox or download acknowledgment. Browser export reports download start;
Android delegates to its scoped system document picker and confirms only a
completed write. Navigation clears memory-only codes. One code plus separate
email proof completes recovery, retiring the entire old set and issuing eight
fresh codes. Legacy single keys remain valid; no existing account is silently
rotated. See the signup record for retention, compatibility and validation limits.

## Account layout and identity intake — 23 October 2026

Account shows username before email, the current status stamp beside the heading,
and compact device, identity, sign-out and deletion actions at the bottom. Capture
headings use a faint decorative level watermark. For accounts without a saved
submission, opening identity verification leads directly to the Level 1 form.
Accounts awaiting approval reopen their saved status. The Level 2 prerequisite
remains authoritative.

Settings shows only the Sign in or Account entry for the account section.
Identity verification and its status badge stay on the Account page. Full name
spans the first form row, city of birth and nationality share the next, and Age
and Document type share the final row. Narrow layouts stack in the same reading
order. The capture-wide Discard photos link is removed; Back and leaving the
identity flow retain their existing cleanup behavior.

The form adds document type, full name, city of birth, nationality and age. Large
JPEG/PNG photos are resized and re-encoded automatically before selection. Review
includes the complete versioned Identity Intake Notice, agreement at its end and
a separate submission action. Saved status requires a private service receipt;
interrupted replies require checking the original operation. Submission grants no
verified badge or work authority.

Face photo uses one card for idle, live preview and the selected still. Start
camera opens the front camera with an oval guide; Take photo becomes available
when the frame is ready. Retake photo clears the prior selection and review,
then opens the camera directly. Continue accepts the selected photos and opens
the final submission step. The movement
wizard and skip controls are removed; no movement video or liveness result is
collected. Stop and Back keep the existing camera and draft cleanup guards.

The final step puts a closed Review or change details disclosure before the
notice checkbox. It has no repeated photo-confirmation action. Its notice
checkbox, associated label and link open the complete pinned document without
agreeing; only the checkbox at the document end records agreement and returns
through Back. Available Submit without agreement opens that same document and
sends nothing. Unavailable intake shows one status instead of a disabled submit
action. An uncertain submission offers only the original operation's status
check. Editing required details or replacing photos still invalidates review
and notice agreement, and incomplete details return directly to the form.

Current intake is a synthetic development implementation and is unavailable by
default pending the custody and retention decisions tracked by Hx02. See the
[capture and custody checkpoint](../../../docs/development/PARTICIPANT_CAPTURE.md#identity-details-image-preparation-and-private-intake--23-october-2026)
and [notice contract](../../../docs/development/IDENTITY_INTAKE_NOTICE_REVIEW.md).

## Home arrival guidance and test intake — 23 October 2026

Home briefly animates the centered character, then pulses Options while signed
out or Navigation while signed in. Three pulses use the character's warm beige robe
(`#dfc2a4`), keeping the sage icon and a soft eight-pixel tan halo at their peak. The icon stays
visible throughout. The cue runs once on
initial entry and once after a fresh sign-in; ordinary revisits and status checks
do not restart it. Either menu gaining focus, opening a panel, leaving Home, backgrounding
or page exit stops it. Reduced-motion preference suppresses both animations.
The sequence has a bounded timeout and never opens the menu or moves focus.

Document Try again uses a trash icon, clears the selected photo and returns
focus to the camera action without opening a sensor. Entered details remain.
Review/change details now precedes the final notice checkbox in both reading
and keyboard order. The final screen and receipt explain that test submissions
remain pending while document checks and account validation are developed;
they grant no verification or work access.

The owner selected test-data submissions under the existing exact v1 notice.
Hx10 owns this client integration, Hx11 owns intake/service activation and its
evidence, and Hx02 owns notice/custody records. Actual availability comes from
the authenticated service. This selects no real-ID intake or successor notice.

Hx11 has completed the [selected test-only activation](../../../docs/development/SERVICE_IDENTITY_INTAKE_CHECKPOINT.md)
for the current client review account and one owned service fixture. The served
preview initially retained a v1 client to match that service. At the owner's
direction it now runs unmodified main, including the current camera-proof/v2
client. The selected live service remains v1. Account sign-in and retained
submission status remain supported; new camera capture and intake are
unavailable until the selected service supports the current notice and proof
contract. No preview-only downgrade or notice substitution is performed.

## Account identity status and saved-password sign-in — 23 October 2026

The account adapter owns an explicit identity submission state machine:
signed out, checking, unverified, awaiting approval, or unavailable. Generic
`identity_verification: pending` is insufficient to establish a submission.
Only an exact authenticated Level 1 custody receipt can show Awaiting review.
Fresh sign-in restores that state through `GET /v1/account/identity/status`,
bound to the current account, principal, recovery generation and session.
Stale results cannot replace a newer receipt or restore a previous account.
Unknown, malformed and failed reads remain unavailable. No client status is
persisted as authority, and neither pending receipt nor badge unlocks work.

Awaiting review appears over the gray account stamp. Requests use the waiting
clock; Operations still require Level 1 identity before Level 2 and retain their warning.
The saved-submission screen ends with a green Done button. A pending account's
identity action opens its status without starting another capture.

While review is pending, Requests says Awaiting review and
opens the saved status. Operations shows the inactive requirement to start Level 1 identity first.
It does not offer Level 2 setup during that wait. The saved
status heading is Awaiting review. The explanation says the Level 1 identity
has been received, review is pending, and it is not confirmed with the issuer.
Unconfirmed original submissions retain their separate unconfirmed message and lookup action.

Continue on the identifier screen can use an origin-bound PasswordCredential
when the browser supports silent access and the identifier matches. Retrieval
uses `mediation: 'silent'`: it does not request a separate account chooser. If
the browser needs interaction, it returns no credential and the existing
password step opens. A supplied credential uses the existing sign-in operation
and adds no visible password field to the identifier screen.
Unsupported, cancelled or mismatched manager results also keep the password step;
third-party managers that provide only a username cannot universally supply a
password through this API. There is no passive credential request, hidden bait
field, password storage or credential logging. Route changes and backgrounding
cancel and fence a pending silent request. The implementation follows the
[Credential Management specification](https://www.w3.org/TR/credential-management-1/#mediation-requirements)
and [Chrome's feature-detection guidance](https://web.dev/articles/security-credential-management).

The two helpers add explicitly listed runtime assets. The shared browser/native
runtime budget is 400 KiB; the image and APK bounds remain 8 KiB each and 8 MiB.
Source, package and browser checks are separate from service activation and
physical-device or real password-manager acceptance.

## Synthetic identity review — 23 October 2026

The same participant app includes a small test reviewer interface. Account
shows Review test submissions only after an authenticated, owner-bound reviewer
permission response. Ordinary Requester/Operator roles do not grant access.
The server rechecks every queue, case, photo and decision request. The one local
app remains at `http://127.0.0.1:4173/`.

An authorized reviewer opens one case, sees its exact details, submission and
receipt commitments, accepted notice and two private photos, then deliberately
records Approve for test, Request correction or Reject with a 1–500-character
reason. Decisions bind the immutable case and expected revision. A conflict
requires a read-only reload; an uncertain write permits only original-operation
lookup. Its recovered receipt is historical and cannot replace current status.
Case departure, backgrounding, logout and permission loss release displayed
media; late results cannot restore it.

Own-subject review results use a separate authenticated read and remain available
without reviewer permission. Approved for test, Correction requested and
Rejected for test never grant genuine identity, Requests, Operations, Level 2,
signing, payment or sensor authority. A deliberate new or corrected test package
starts with fresh details, photos and exact notice acceptance; its review starts
pending and does not inherit an older decision. Reopening Account refreshes
these read-only results even when it is already the current screen.

The two explicit reviewer modules bring the shared runtime ceiling to 448 KiB.
Restoring the 23 October identity seals raises that ceiling to 456 KiB.
The requester succulent and operator sprout on Home raise it to 465 KiB.
Showing one current figure, with the mode switch in the header and dashboard, raises it to 467 KiB.
Naming the current mode on the dashboard raises it to 468 KiB.
Confirming a change to the other mode raises it to 471 KiB.
Stating account-closure retention in the draft terms, and the deletion review page, raises it to 476 KiB.
The unchanged individual image and APK limits remain 8 KiB and 8 MiB. Private
photo responses use a separate 3 MiB JSON/base64 cap with at most 2 MiB decoded
JPEG bytes; case details use 256 KiB, and ordinary summaries/decisions 64 KiB.
Browser, relay and Android enforce the exact route-specific bounds. Hx02 owns
notice v3 and preserved v1/v2 bytes; Hx11 owns the private audited endpoint and
activation. See the [client checkpoint](../../../docs/development/PARTICIPANT_IDENTITY_REVIEW.md)
for executed evidence and remaining limits. Real-data intake remains pending.

# Participant local account integration

Initial service checkpoint implemented 21 October 2026 under Hero 10. The later
[mock confirmation and live capture](PARTICIPANT_CAPTURE.md) record supersedes the
mail/capture exclusions, fixture-storage and fourteen-file runtime below.
The [email-first entry follow-up](VALIDATION.md#email-first-participant-entry--22-october-2026)
adds an operation-owned contact challenge before existing/new-account routing;
its current UI and mock-mail boundary are described in the
[application guide](../../web/apps/non-verba/README.md#simple-sign-in).
This checkpoint connects the shared browser/APK
account interface to the owner-selected local development account service. It
does not implement production authentication, external providers, email delivery,
identity verification, real document/face acquisition or work/key authority.
The [service checkpoint](SERVICE_SIGNIN_CONTEXT_CHECKPOINT.md) records backend
scope separately; backend implementation and operational evidence stay private.

## Shared account client

The application contains one UI and one service-account state machine. Reviewed
minimal account enrollment uses a CSPRNG operation ID/secret and a SHA-256
reference to reviewed contact/name/role metadata, never a fast password hash.
Exact retries reuse their original operation; passwords must be supplied again
and are not retained for retry. Generic pending responses do not prove that a
contact exists. Confirmation/status receipts are historical and grant no login.
The application creates and deliberately reveals a high-entropy recovery code;
it does not write that code to persistent application storage.

Email login keeps the existing development authorization-code/S256 PKCE flow,
registered public client and exact callback. The transport captures the 303
without navigating, preserving the plain application URL. The client verifies
state, code, ES256 ID-token signature/JWKS, issuer/audience/nonce/time and principal
binding, then reads coherent current context. Session ID equality, current
confirmation, declared roles, safe counters/deadlines and pending identity status
are validated. An unbound current login is supported; no bound-key endpoint is
used as an initial-account prerequisite.

Current account checks surround illustrated enrollment actions. Expiring access
uses serialized rotating refresh; an uncertain refresh is not retried blindly.
Cancellation and generation fences prevent late login, context or refresh from
restoring authority. Server sign-out, local forgetting and an unknown result
remain distinct. Recovery requires both existing recovery code and contact
confirmation, changes credentials/generation, revokes old authority and requires
fresh login. Neither recovery nor reconnect resumes work or restores a lost key.

Only `.invalid` contacts are accepted in this selected local environment. No
fixed UI password or automatic confirmation remains. Application passwords,
tokens, operation secrets and factors are memory-only and secret controls clear
on submission/view departure. Durable account data belongs to the service.
Pending operation details are lost on reload; existing server records are not
deleted. The application cannot retrieve the privileged local confirmation sink,
and no email delivery is claimed.

## Browser and Android transport

The existing participant preview port remains host-loopback only. Its account
relay is disabled by default; an explicit managed development launch uses:

```sh
NONVERBA_BIND=0.0.0.0 NONVERBA_ACCOUNT_RELAY=local node --run serve:participant
```

The container listener serves the existing loopback-published port; this is not
LAN hosting. The fixed upstream Docker Desktop host route was verified against
the existing local service. The canonical issuer/callback remain the registered
loopback strings. No client registration, service origin policy, CORS grant,
container/volume/port or backend configuration was changed.

`GET /account-api/config` describes this capability. `POST
/account-api/transport` accepts a closed ID/request envelope, exact trusted
Host/Origin and custom header. Only the selected account and OIDC paths/methods
are permitted. Caller-selected URLs, arbitrary headers, cookies, privileged
mail/admin routes and redirects are refused. CSRF cookies are isolated by
unguessable flow ID, expire independently within five minutes, and are consumed
after every authorization attempt. Bearer tokens are explicit per request; the
relay retains no API-session token jar. All replies prohibit caching, and bounded
errors omit payloads, credentials and redirect query values.

The debug APK's origin-restricted WebMessage adapter accepts only its exact
bundled main document and relays only to numeric loopback port 4173. It uses the
existing documented USB forwarding design; no physical connection was exercised.
Its workers, queue, deadlines and byte sizes are bounded; stop/destroy invalidate
replies and disconnect work. WebView resource loading stays closed, cookies stay
off and sensors/file access remain denied. INTERNET and numeric-loopback
cleartext are debug-only. Release keeps no account bridge or network permission;
production endpoints, transport and credential custody require separate work.

Fourteen selected runtime files total 155,640/196,608 bytes. The exact collector,
Gradle/native maps and inspector agree. No added UI library/model is selected;
the individual image limit remains 8 KiB and APK limit 8 MiB. The browser permits
only same-origin connections, while the bundled WebView keeps its stricter
connection prohibition and uses the scoped native channel.

## Validation and limits

One managed source snapshot supplied the related checks and builds. All 65
focused account/relay/workflow/workspace/package/catalog checks and 23 Chromium
groups passed. Refusal fixtures cover unsafe counters, wrong state/nonce/token
claims, current-context failure, cancellation and late results, unknown sign-out,
exact egress/origin/CSRF rules and private-storage exclusion. Keyboard and 320px
200% text checks passed. Consent choices now remain visible while asynchronous
account validation runs; the keyboard fixture waits for validation before
activating its next button.

Final participant assembly/lint passed, followed by actual compiled permission,
asset-byte, debug-signature and package inspection against an independent retained
baseline. No APK was exported or installed. Source checks separately establish
the debug/release networking boundary; they are not a physical WebMessage,
Android HTTP, lifecycle or USB acceptance result.

The explicit standalone `code/test/integration/participant-account-live.mjs`
created owned `.invalid` development fixtures through the live relay. The final
run passed actual discovery, enrollment/status, deliberate confirmation without
login, email PKCE/CSRF and signed-token verification, coherent unbound context,
server sign-out, two-factor recovery, old-password denial, fresh login and
generation change. An operator supplied only each owned operation's private
challenge directly between managed containers; none was printed or shown in the
browser. The application/relay have no administrative mail capability. Earlier
harness attempts exposed a partial-file transfer race; atomic transfer and a
minimum-length wait corrected the harness. All attempts and synthetic server
records were retained without cleanup.

Live check commands and private challenge paths are operational evidence, outside
public source. No real mailbox delivery, real credentials, real identity/media,
external provider, production deployment or phone behavior was established.
Document/front-photo guidance remains the separately labelled illustrated
workflow, with identity always pending and no liveness/movement decision.

Focused managed checks:

```sh
node tools/build/prepare-participant-identity.mjs --check
node --test test/unit/onboarding-account-tests.mjs test/unit/participant-account-relay-tests.mjs test/unit/synthetic-enrollment-workflow-tests.mjs test/unit/participant-workspace-tests.mjs test/unit/participant-package-tests.mjs test/unit/test-suites-tests.mjs
node test/browser/participant-browser-check.mjs
node test/browser/participant-onboarding-browser-check.mjs
```

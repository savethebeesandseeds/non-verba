# Private email sign-in and current context checkpoint

Completed 21 October 2026. Hero 11's owner-selected email sign-in and current
account/session context Goal passed its bounded local synthetic scope. The
validated interface and its limits were coordinated with Heroes 2 and 10.
Backend implementation, configuration and detailed operational evidence remain
private. Shared enrollment UI and APK integration retain their existing owners.
Identity validation remains pending.

The [23 October password-first continuation](#password-first-public-handle-sign-in--23-october-2026)
below extends these selectors. The original checkpoint retains its dated scope.

Email sign-in extends the existing local authorization-code/S256 PKCE flow.
Clients submit exactly one email or retained opaque login-name selector with
the password and existing one-use authorization/CSRF exchange. Email comparison
matches enrollment: trim surrounding ASCII whitespace and compare ASCII
case-insensitively, without provider-specific alias folding or automatic
account/identity merging. Exact confirmed local identity bindings remain
required. Both selectors share the resolved account's credential lockout;
unknown contacts, wrong credentials, pending enrollment and operational rate
limits receive generic denial. This creates no password token grant, approved
participant key or contractual authority.

`GET /v1/account/context` provides one coherent current confirmed account and
presented-session snapshot, including an initially unbound login. Its flat
account fields retain account/principal identifiers, declared roles, recovery
generation, local issuer binding and durable work state. It adds the current
session identifier, active snapshot flag, separate stored-session and access
deadlines, and the presented credential's current approved binding when present.
An older unbound token gains no authority when stored session metadata becomes
bound: its binding flag stays false and device, key, role and public-key fields
stay null. The response does not depend on finding the current session in a
capped inventory. Counters are checked for exact JavaScript representation,
authorization is rechecked after relevant waits, and responses prohibit caching.
Every context reports identity verification as pending.

## Password-first public-handle sign-in — 23 October 2026

Ordinary participant sign-in now accepts email or the public unique account
handle directly with the password. A distinct public-handle selector keeps it
separate from retained opaque internal login names. Continuing from an identifier
to the password screen is local: it sends no lookup, contact challenge or mail.
Only successful password authentication and coherent current account/session
validation expose the handle's confirmed contact. Signup still requires email
proof; recovery still requires both a recovery code and separate contact proof.

The existing one-use CSRF exchange, authorization-code/S256 PKCE, token checks,
account/session binding, throttling and resolved-principal lockout remain.
Current alias binding is rechecked after the principal serialization wait;
unknown, unconfirmed, disabled, renamed/deleted/reused mappings and wrong
credentials retain generic denials. The participant independently matches the
authenticated context to its selected email or handle before registering the
sign-in device. No public contact directory, credential merge, schema migration,
work authority or identity-verification decision is introduced.

See [executed validation](VALIDATION.md#password-first-sign-in-and-account-action-icons--23-october-2026)
for the bounded client, service and activation checks. Backend implementation,
fixtures and detailed operational records remain private.

Current context remains distinct from historical enrollment/recovery receipts,
UI role flags and pending operations. Reads do not approve keys, publish a
profile, resume work or activate sensors. Recovery invalidates old password and
session authority while preserving the new account generation. Explicit session
sign-out can persist stopped work; ordinary token or inventory revocation is
not the same work-state action. Heroes 2 and 10 received the validated fields,
credential/binding distinctions and recovery/sign-out semantics. The OpenAPI
contract includes the closed context and email-or-login-name form, and now
allows both existing synthetic account-assurance labels without claiming
identity verification. Earlier supported contracts remain available; no new
database migration was needed.

Formatting, all-target Clippy with warnings denied, 26 normal tests and 23
enabled database/object-store integration tests passed. Component checks covered
an older unbound token after binding, a current session beyond 270 newer
inventory entries, unsafe counters and expiry/recovery behind a principal lock.
Actual synthetic HTTP created and confirmed three accounts plus a pending
operation. It passed normalized email login, distinct plus aliases, legacy
PKCE compatibility, generic credential/selector denials, unbound context with
correct identifiers/roles/generation, absence of approved-key authority and
rejection of account override attempts. Own-session revocation, recovery with
old password/access denial and new email/password login, and unbound explicit
sign-out with stopped work passed. One synthetic stored-session deadline was
deliberately expired for the HTTP check; this was not an elapsed access-token
expiry exercise. Queued token expiry was covered separately by component tests.

A full graceful service restart passed saved valid access/refresh and revoked
credential checks before fresh login. An isolated restore matched 55 table
witnesses and 40 current objects and preserved viewer/PUBLIC denial on all 52
protected authentication, account and service tables. Actual recovered-service
HTTP passed fresh email login, current context, the original recovery receipt
and selected durable-witness comparison. Earlier seeded service evidence also
passed source/recovered HTTP replay and independent shared-Rust verification of
restored signatures. Source service targets and final readiness were restored,
including the 52 protected-table denial checks.

A bounded marker check collected 78 selected sensitive values and their 86
representations from five private state snapshots and 20 snapshotted local-mail
confirmation tokens. None appeared in the 129 captured HTTP journals or selected
runtime/database log prefixes that were scanned. Private state snapshots
intentionally retain fixture credentials; they were marker sources, not targets
of an absence claim. This is a selected-marker check, not a comprehensive secret
or security audit. Restore evidence covers an exported
database snapshot and checked current objects, without claiming an atomic
database/object-store cut, historical object versions or backup of issuer/runtime
secrets and external systems.

The result establishes local synthetic server behavior. Real mailbox delivery,
selected production credential/reset policy, platform networking and real
credential custody, identity validation, biometric/media custody, external
providers and production deployment remain pending. No face, document or other
identity evidence is accepted by this sign-in/context flow.

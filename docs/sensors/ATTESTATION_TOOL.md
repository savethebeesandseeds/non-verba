# Reusable device attestation tool

Hero 01's tool hardening work separates device-attestation mechanism from its
account consumer. The first supported possession profile is `signin-device`,
using the existing `NONVERBA:SIGNIN_DEVICE:v1` transcript. Additional purposes
need their own reviewed profile; callers cannot supply arbitrary signing bytes.
The account HTTP protocol, participant/work-key authority, existing native key
aliases and retained enrollment records stay compatible.

## Responsibilities

| Component | Responsibility |
| --- | --- |
| `web/shared/identity/device-attestation.js` | Standalone browser/native tool, bounded profile input/results, operation state, cancellation and disposal. No account HTTP or UI dependency. |
| Shared `DeviceAttestationProof.kt`, `DeviceAttestationStore.kt` and `AttestationOperations.kt` | Fixed protocol, Keystore storage/generation/public evidence and revocable operation/lock helpers. Store access uses Android application context; these mechanism helpers have no WebView, HTTP or verifier-policy dependency. |
| Shared `DeviceAttestationBridge.kt` and `AttestationDocumentAccess.kt` | Exact-origin/document admission, app-supplied foreground/profile fences, bounded worker dispatch and bridge messages. The bridge explicitly depends on Android Activity and WebView. |
| `code/android/participant/.../LoginDevice.kt` | Participant wiring into the shared bridge. |
| `code/android/app/.../MainActivity.kt` | Developer-page wiring into the same shared bridge, with a fixed synthetic profile and normal navigation/lifecycle revocation. |
| `web/apps/non-verba-dev/src/keys/device-attestation-ui.js` | Host-token loading, deliberate native proof collection and exact public exports. No account HTTP or local hardware verdict. |
| `nonverba-core::android_attestation` | Existing independent certificate-chain and generation-claim verification. No duplicated cryptography is introduced. |
| Private service attestation module | Independent original enrollment context, caller-selected policy, authenticated trust refresh and shared verifier invocation. Sign-in maps its retained context into that module. |
| Account client/server | Authenticated account/session context, challenge issuance/consumption, fresh possession verification and device/session records. |

The participant UI creates `createDeviceAttestationTool()` and passes it through
the account workflow's existing device interface. A restored page recreates a
closed tool before later sign-in, with fresh document authority and retained
browser keys where storage is available. `account-transport.js`
contains only account transport. The browser preview and APK package use the
same explicit tool source through the participant asset collector.

## Web contract

`createDeviceAttestationTool({scope = globalThis} = {})` returns a version-1 tool
with `purpose: 'signin-device'`, `platform` and a display `name`:

- `capabilities({signal})` describes key storage and availability. Hardware
  attestation is `unsupported` in the browser and `unverified` for an available
  native bridge. Availability is never a hardware verdict.
- `describe({signal})` returns the platform/name pair consumed by account setup.
- `prove(challenge, {signal})` snapshots and validates the closed structured
  challenge before returning to its caller, then returns bounded public SPKI,
  signature and optional original attestation chain. It performs no account
  request and accepts no caller-selected trust verdict.
- `status()` exposes `idle`, `running` or `closed`. One operation runs at a time.
- `cancel()` revokes the current operation. `close()` also clears document key references,
  removes its listener and releases bridge ownership. Page exit closes the tool.

The challenge binds account, current session, recovery generation, platform,
canonical random challenge ID/nonce and the existing two-minute window. Returned
evidence remains untrusted until independently verified. Structural validation
of a chain in JavaScript supplies no certificate or hardware verdict.

### Automatic browser continuity

The browser makes its best effort automatically, without passkey setup, biometric
prompts, extensions or new permission requests. Where IndexedDB is usable, it
retains an origin-local nonextractable P-256 key pair for the fixed purpose and
account. Fresh challenges reuse that key after reload or in another tab on the
same origin, letting the existing server group proven sessions by public-key
hash. Account password authentication and session authority remain separate.

The retained key identifies a browser-profile key, not a unique physical device
or a verified browser implementation. Every proof still binds the exact account,
current session, recovery generation, random challenge and original time window.
Recovery changes that signed context without silently rotating the browser key.
Other accounts and origins have separate keys. This adds no browser-fingerprint
collection, biometric data, password, login token or cross-origin identifier.

The dedicated store is bounded to 32 account scopes and never evicts, rotates or
overwrites an existing key. Concurrent tabs select the same committed key.
Retained key records must have the expected schema, algorithm, usages and
nonextractability; a signature/verification check must also establish that their
public and private keys match. An inconsistent existing record fails explicitly
rather than acquiring a replacement identity. Nonextractability restricts WebCrypto
export and does not establish hardware protection or protection from same-origin
code with signing access.

Missing, blocked or unusable storage has a bounded automatic document-memory
fallback, reported as `key_storage: 'document-memory'`; usable persistent storage
is reported as `key_storage: 'origin-indexeddb'`. This is an observed client
capability, not a trusted server attestation verdict. A memory-only key lasts for
the tool/document lifetime. Closing the tool clears its memory and connections
but preserves committed IndexedDB keys. Clearing site data loses retained keys;
the next authorized sign-in can register a new key. Server session revocation
still revokes authority independently of whether a local key remains.

Hardware attestation remains `unsupported` in the browser, and the server keeps
its browser hardware result unverified. No passkey or DBSC transport is added:
the account channel uses explicit bearer authorization through its JSON relay,
whereas DBSC requires a separate browser-managed cookie/refresh integration.

## Native ownership and cancellation

The shared store retains the existing account-scoped alias and no-backup record
schema, original generation challenge and chain, pending/ready transitions,
32-slot capacity and narrow StrongBox-unavailable fallback. Existing or orphaned
keys are preserved; missing/inconsistent records fail explicitly. Key renewal,
rotation and deletion are separate decisions with no automatic implementation.

The bridge keeps `config:true` and structured challenge envelopes. Cancellation
adds `{id: freshRequestUuid, cancel: originalRequestUuid}`. Web abort, timeout,
failed operations and disposal send bounded cancellation for that exact request.
Native tickets revoke queued/running publication and remain distinct across
navigation, pause, stop and later Activity sessions. Shared lock waits check
authority and deadlines while contended; checks surround signing and publication.

An already started Android Keystore call may continue after cancellation. A
cancellation acknowledgment therefore records revoked publication authority,
with no claim that hardware generation stopped or that a generated key was
removed. Partial keys/records are preserved for same-context recovery where
possible; an attempted generation without a recoverable key fails explicitly.
The tool exposes bounded failure categories without platform exception
text, private material or an invented hardware verdict.

## Independent assessment and policy

The existing Rust verifier remains authoritative. The private reusable assessor
accepts a chain, original challenge/issue/expiry/arrival context, independently
expected SPKI hash, independently selected policy/trust and verifier clock. Its
input types have no login session or account dependency. Sign-in retains its
environment configuration and browser dispatch in its own adapter.

The owner's approved development policy is preserved. Its selected package,
signer, hardware/patch requirements, enrollment-age limit and trust freshness
remain consumer policy; extracting the tool does not make them defaults for
other consumers. No service reload or policy activation is part of this source
migration.

A fresh possession signature does not refresh original key-generation evidence.
Generation-time claims, current trust reassessment and later possession remain
separate. Neither result establishes current OS/process state, live presence,
physical identity or sensor origin. The sensor enrollment/selection tool remains
separate, with its existing media/location keys and explicit selection semantics.

## Developer APK tool and independent requests

The developer app (`org.nonverba.camera`) exposes **Device attestation tool** from
the camera tools page. Its bundled `device-attestation.html` uses the same shared
web tool, native bridge, Keystore store and fixed `signin-device` transcript as
the account consumer. It does not invoke the separate sensor-key enrollment UI,
select a media/location identity or contact an account service. Developer results
are scoped to that package; they do not establish participant-package acceptance.

Startup checks capability only. **Load request** parses a host-issued token;
**Prove test key** is the separate deliberate operation that may create the test
scope's first native key. Browser capability is shown as unavailable for native
proving, and the page does not substitute a browser key. Cancellation, page exit
and Android lifecycle changes fence delivery. A restored page replaces its closed
tool without automatically proving or renewing a request.

Prepare the installed developer app and open its tool before issuing the short
request. Inside the existing managed Debian environment, from `code/`, run:

```sh
node tools/evidence/device-attestation-check.mjs create-request \
  --output ARTIFACT_DIR/original-request.json
```

The exclusive output is the independently retained eight-field original. The
command reports a compact public token:
`NVAT1.<scopehex32>.<issuedUnixSecs>.<challengeIdBase64url43>.<nonceBase64url43>`.
Paste that complete token into **Host-issued request token**, then choose
**Load request**. The parser preserves the original issue time and two-minute
expiry. It reconstructs `account_id: dev-tool:attestation:<scopehex32>`,
`current_session_id: dev-tool-session:<challenge_id>`, recovery generation zero,
the native Android platform and canonical standard-base64 nonce. The developer
bridge admits only that fixed synthetic profile. These names create no account
or session authority.

For a later possession or restart check, `create-request --scope SCOPEHEX32`
creates a fresh request for the same retained test key. Keep the first enrollment
original separately from every later possession original. Omitting `--scope`
chooses a new synthetic scope, whose explicit first proof may create an additional
key; it does not rotate or delete an earlier key.

**Save request** exports the raw eight-field request as
`nonverba-device-attestation-request-<UUID>.json` (at most 4 KiB). **Save proof**
exports `nonverba-device-attestation-proof-<UUID>.json` (at most 192 KiB), with
exactly `type`, `version`, `purpose`, `request`, `proof` and
`hardware_attested: false`. The type is `nonverba-device-attestation-proof`,
version is 1 and purpose is `signin-device`. The nested proof is the shared
tool's public SPKI, signature, optional certificate chain, platform and display
name. A public SPKI SHA-256 pin and returned certificate count are displayed;
neither is a local hardware-verification result.

Retrieve only explicitly saved public exports using the documented
[USB attestation retrieval](../development/USB_DEBUGGING.md#developer-attestation-tool-public-exports).
The retrieval action accepts one to eight matching files in total and checks
their exact bytes. Each successfully retained file records `received_at_utc`
when the host has decoded its complete bounded canonical bytes, before subsequent
hash/schema/app checks, and `retrieved_at_utc` after those checks and local storage.
The entry is published only after that file passes all checks. Select the first
successfully retained proof whose request and hashes match the independent
original, then use its `received_at_utc` for external arrival. A phone success
label, later validation completion or the manifest's final completion time is
not that arrival observation.

Retain the first successful matching enrollment proof's arrival value. Later
proofs, repeated retrieval and restart must not replace it to make enrollment
appear newer. The enrollment original is the request used for first key
generation; loading an unused or expired request creates no enrollment witness.
Arrival outside the original window remains a refusal. A fresh request must be
explicitly issued rather than changing an original's recorded times.

## Offline proof and chain checking

The same managed-container CLI verifies the exact retrieved proof against an
independently retained possession original and the separately retained enrollment
original. It uses Node's P-256 verifier for the fixed fresh-possession transcript
and calls the actual built Rust/WASM `verify_key_attestation` for chain policy.
Use the verified source snapshot's existing developer WASM build; the CLI loads
`web/dist-android/pkg/` and performs no trust fetch or host build.

```sh
node tools/evidence/device-attestation-check.mjs verify \
  --request CURRENT_ORIGINAL.json --proof RETRIEVED_PROOF.json \
  --received-at "$attestation_received_at" \
  --enrollment-request FIRST_ENROLLMENT_ORIGINAL.json \
  --enrollment-received-at "$attestation_enrollment_received_at" \
  --policy INDEPENDENT_DEVELOPER_POLICY.json --trust INDEPENDENT_TRUST.json \
  --expected-spki "$attestation_retained_spki" --output NEW_REPORT.json
```

Supply actual requester-observed Unix arrival times. For the first proof, current
and enrollment originals/arrivals may be the same; later proofs retain the first
enrollment context. Convert the selected manifest entry's `received_at_utc` with
an explicit `DateTimeOffset` cast in PowerShell, which also accepts ISO values
automatically parsed as `DateTime` by PowerShell 7.5:

```powershell
$attestationReceivedAt = ([DateTimeOffset]$attestationProofEntry.received_at_utc).ToUnixTimeSeconds()
```

Keep that first value for `--enrollment-received-at`; a later proof supplies its
own `--received-at`. The optional `--expected-spki` must use an independently
retained prior pin when testing continuity. Without a prior pin, the report marks
that limitation rather than establishing a previously trusted device identity.

The explicit offline policy names `org.nonverba.camera` and independently known
developer APK signer/version expectations. Trust roots, revocation material,
security/patch floors and verifier clock remain independent inputs. The approved
participant sign-in policy is unchanged; an unfavorable developer-chain result
does not authorize relaxing either policy. A preserved valid possession result
and a rejected or unavailable generation-attestation result remain separate.

For a scoped restart check, retain the same synthetic scope and independently
compare SPKI and complete chain bytes before/after restart, then issue and verify
a fresh possession challenge with the original enrollment context. Matching
bytes alone establish neither current process integrity nor successful hardware
attestation. The CLI writes an exclusive report with input hashes and the actual
WASM hash, preserving the supplied originals and proof.

## Validation and remaining acceptance

Focused tool, account-consumer, packaging, browser and Kotlin checks run only in
the documented managed Linux containers. The native harness exercises the actual
shared protocol, DER/JCA conversion, cancellation, ticket ownership and lock
contention with deterministic or JVM inputs. Browser tests use real WebCrypto
and intercepted account fixtures. The developer UI browser check exercises a
synthetic native bridge, exact request/proof exports, late-result cancellation
and restored-page tool recreation. These checks do not execute Android Keystore.

The [22 October developer-phone run](../development/VALIDATION.md#developer-apk-attestation-tool-validation--22-october-2026)
completed data-preserving installation, two independently valid possession
proofs, a verified process restart with identical SPKI and all four certificate
bytes, and actual expired-request refusals. Both generation assessments refused
the unchanged patch policy. That refusal precedes full attested application
identity acceptance; it establishes no accepted hardware enrollment or current
device state. Physical cancellation/interrupted generation, eligible-hardware
admission, participant/service deployment and any new renewal procedure remain
separate from this completed diagnostic run.

The [automatic browser continuation](../development/VALIDATION.md#automatic-browser-attestation-effort--22-october-2026)
passed real Chromium storage, signature, reload, race, capacity, refusal and
fallback checks, plus the existing account workflow with retained-key reuse
after reload. These are browser-profile possession/continuity results, with
hardware and browser/OS integrity assurance remaining unverified.

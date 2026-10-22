# Participant sign-in devices

The shared participant sign-in registers a separate login-device key after
password/PKCE authentication. Settings → Devices shows account-owned device
records, current sessions, last activity and individual session sign-out.
Older sessions without a device proof remain visible as Other sessions.
"Signed in" means an unexpired, unrevoked authorization, not live presence.

## Proof and attestation

The server issues a random 32-byte, two-minute challenge bound to the current
account, session, recovery generation and platform. The key signs the fixed
`NONVERBA:SIGNIN_DEVICE:v1` transcript. The server verifies the actual P-256 SPKI
and signature and atomically consumes the challenge. Login-device records do not
change the existing participant/work-key binding or grant signing permissions.

Android uses a dedicated account-scoped AndroidKeyStore key and exports its
attestation certificate chain. The private key remains in Keystore. Its original
challenge, public material and chain remain in app no-backup storage; later
sign-ins sign fresh challenges with the same key. The bridge accepts only the
bundled main document while foregrounded and fences lifecycle/document changes.
StrongBox falls back to TEE only on its explicit unavailable exception before an
alias exists. Interrupted or partial records and existing aliases are preserved.
No serial, IMEI, account password or login token is stored with this key.
The display name is self-reported, not verified hardware identity.

Hardware assurance is a server verdict using independently configured package,
signer, version, security and patch expectations, pinned Google roots and fresh
authenticated revocation data. Unsupported hardware, missing/expired trust,
stale enrollment or failed verification remains unverified. A valid chain
describes **key-generation state**, not the device's current OS, process,
location, identity or online presence. The original challenge/arrival time is
never replaced by a later proof. If initial registration did not reach the
server, a later chain with its old nonce cannot acquire a fresh verified age.

The browser automatically tries to retain an origin-local nonextractable P-256
key in a dedicated IndexedDB store, scoped to the fixed sign-in purpose and
account. Reloads and other tabs on the same origin reuse the committed key, so
fresh possession proofs can group sessions under the same browser-profile key.
Account, current session, recovery generation and expiry remain signed for each
new challenge; recovery changes do not silently rotate the key. No passkey setup,
biometric prompt, extension, fingerprint collection or new permission is needed.

Blocked, missing or unusable storage falls back to document-memory keys with an
explicit local capability result. Inconsistent existing records fail without
replacement. The bounded store retains at most 32 account keys without eviction;
closing a page preserves committed keys, while clearing site data loses them.
Stored material includes the account scope and public/private CryptoKey objects;
passwords, login tokens and biometric/browser-fingerprint traits are excluded.
The server already groups by independently verified public-key hash. Neither
persistence nor a valid signature establishes hardware protection, a unique
physical device, genuine browser code or current OS state. Browser hardware
attestation remains unsupported/unverified. Previous server sessions remain
visible until expiry or revocation; retaining a key does not restore a login token
or authorization after reload. See the [tool's storage and fallback contract](../sensors/ATTESTATION_TOOL.md#automatic-browser-continuity).

## Bounds and validation

The account flow now consumes the shared [device-attestation tool](../sensors/ATTESTATION_TOOL.md).
Its web mechanism is outside account HTTP transport, native key/proof handling
lives in the shared Android tool source, and private verification receives an
independent original-enrollment context. The existing sign-in protocol and
retained identities remain compatible. Cancellation now revokes the exact
native request; generation-time evidence remains separate from fresh possession.

The same explicit runtime is used by Chromium preview and Android packaging.
The tool stays within the current shared 296 KiB runtime allowance, with unchanged 8 KiB
per image and 8 MiB APK bounds. Only the proof path allows a 192 KiB body and
only device inventory allows a 256 KiB response. Other account paths retain
their existing limits. Certificate count, DER bytes, canonical encoding and
closed paths are independently checked by the native host, relay and server.

Managed checks cover account/session binding, strict hardware verdict schemas,
cancellation and concurrent authority loss, unknown sessions, session revocation,
real browser WebCrypto proof, narrow/large-text UI and exact package assets.
The pure Kotlin harness checks transcript bounds, malformed DER and real JCA
signature normalization. Android assembly/lint checks compilation and packaging;
these checks do not establish physical-device attestation or production policy.

Run through the documented managed Linux environment:

```sh
node --test test/unit/device-attestation-tests.mjs test/unit/onboarding-account-tests.mjs test/unit/participant-account-relay-tests.mjs test/unit/participant-workspace-tests.mjs test/unit/participant-package-tests.mjs
node test/browser/participant-onboarding-browser-check.mjs
bash android/tests/platform/run-login-device-proof.sh
bash tools/build/build-android.sh participant
```

The existing explicit live account harness additionally exercises real device
registration, grouping two sessions by one key and revoking another session.
It uses owned synthetic accounts and retains their service records.

Android's [key-attestation verification guidance](https://developer.android.com/privacy-and-security/security-key-attestation)
describes independent chain, security-level and revocation verification.

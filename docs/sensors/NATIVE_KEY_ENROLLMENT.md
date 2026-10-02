# Native key enrollment and selection

Android can create a separately challenged, non-exportable signing key for each
of two purposes: `media` (camera and microphone) and `location`. The native
enrollment bridge owns key generation and exports the public attestation chain.
Rust verification decides whether the returned chain satisfies a requester's
challenge, key pin and independently configured trust policy. Merely completing
native enrollment does not establish hardware attestation or sensor truth.

## Existing identities remain intact

The older browser identity and the native v1 media/location aliases are retained.
Enrollment creates a different v3 alias for each requester challenge; it does not
replace a v1 key, modify its public record, or silently select the new identity.
The media C2PA certificate pin and location SPKI pin are distinct conventions and
must not be substituted for one another. Both exports also carry an SPKI SHA-256
digest for remote attestation binding.

Earlier v2 aliases (`org.nonverba.camera.media-capture.attested.v2` and
`org.nonverba.camera.location-capture.attested.v2`) and their records are preserved
as original generations. New aliases end in `attested.v3.<challenge-sha256>`;
their records likewise include the SHA-256 of the canonical challenge bytes in
the filename. Bounded records in Android's `noBackupFilesDir` retain each
enrollment and the explicitly selected profile. Atomic per-generation writes
and deterministic discovery avoid a separate index/record consistency gap.
No bridge method deletes, replaces, or imports a private key.

## Enrollment lifecycle

`NativeKeyEnrollment.begin(purpose, challengeBase64)` accepts exactly 32 challenge
bytes in canonical standard Base64. The requester supplies the challenge. It
must be verified against the independently retained original enrollment request;
an operator-supplied challenge alone is not a freshness witness.

The same challenge resumes or exports its existing generation. A new challenge
creates an additional key for renewed enrollment; existing enrollments and the
selected capture identity remain unchanged. Each purpose permits at most 32
preserved enrollment slots, including its earlier v2 generation, pending records
and orphaned matching Keystore aliases. A full store rejects new generations;
existing generations can still be exported, selected or resumed. Retirement or
deletion is a separate future workflow, not an automatic consequence of renewal.

The bridge samples the foreground enrollment document on Android's main thread,
then runs key generation on a separate worker. Backgrounding, navigation,
cancellation, destruction, or a sixty-second elapsed-realtime limit revoke that
session. Long platform operations cannot be reliably interrupted, so generated
keys and recovery records are preserved even when publication is cancelled.

Before generating a key, the store persists a pending record containing the
original challenge and generation-attempt state. Recovery only accepts that same
challenge for that generation. An existing alias without its matching record,
a record whose challenge differs from its filename, or a failed attempt without
a recoverable key causes an explicit failure. There is no automatic replacement
of a failed generation. A requested StrongBox key may fall back only when
Android reports `StrongBoxUnavailableException` and no partial alias exists; the
export records both the request and fallback.

A successful enrollment retains and exports Android's bounded certificate chain,
SPKI, key pin, original challenge and local `KeyInfo` security-level label. For
media, it also retains the compatible C2PA certificate around the same SPKI.
`hardware_attested` remains `false` in this native response: a remote verifier
must validate the chain and its attestation extension before drawing that claim.
`exportEnrollmentForKey(purpose, fingerprint)` resolves exactly that generation,
rechecks the saved chain and SPKI against its actual Keystore entry, and rechecks
the saved pin. It does not regenerate missing keys. The older
`exportEnrollment(purpose)` resolves the selected attested generation, otherwise
the original v2 generation, otherwise the sole ready generation. It rejects an
ambiguous set instead of guessing the newest key. Capabilities expose public
generation pins, challenges and SPKI digests plus occupied/maximum slot counts.

## Selection and capture

`selectProfile(purpose, profile, expectedFingerprint)` requires the foreground
enrollment page and an exact pin for the requested `legacy` or `attested` profile.
It resolves that identity, checks the revocable foreground ticket, and atomically
records the selection. A cancellation during the final write may leave the
already requested selection committed; the error explicitly instructs the
operator to inspect the selected profile instead of implying rollback.

Each location, camera or microphone session freezes its selected profile, key
object and public identity at `begin`. Public export and signing resolve this
exact frozen pin rather than whichever key is selected or newest at that later
moment. Selection changes apply to later sessions.
The existing original-request and independent expected-pin checks continue to
apply to the resulting evidence. A requester must explicitly pin the newly
enrolled identity before accepting it.

The bridge exposes enrollment, selection, capability/status, export and cancel
operations only. It does not expose arbitrary signing. Sensor signing remains
inside the native acquisition controllers and their Rust finalization paths.
Shared key locks check the session's revocable authorization both after acquiring
the lock and after signing; cancellation cannot be bypassed by a queued signer.

## Validation boundary

The production lifecycle and monotonic freshness gates have a deterministic host
Kotlin harness at `code/crates/nonverba-android/tests/run-native-session-guards.ps1`.
It exercises clock changes, stale samples, authority revocation, lock contention
and expiry during signing. The companion catalog harness checks exact-generation
lookup, legacy compatibility, ambiguous exports, duplicate records, absent pins,
resumption and the slot bound. These checks use fake clocks/public identities and
do not exercise Android Keystore or a physical sensor.

Physical acceptance still requires a connected phone: challenge-bound key
generation, StrongBox behavior, chain export, app restart and selected-key
persistence, cancellation during generation, legacy-key continuity, additional
challenged generations, full-store handling, and capture/export with each exact
selected or session-frozen pin. A trusted signing key establishes key custody under
the attestation policy; it does not attest Camera2, AAudio, GPS observations or
the surrounding physical world.

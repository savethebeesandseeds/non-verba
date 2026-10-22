# Private protocol-backed service release checkpoint

Recorded 21 October 2026. Hero 11's first bounded protocol-backed service release
passed its local acceptance gates. Implementation, deployment configuration,
keys, client fixtures and detailed operational evidence remain private. This
public record contains only sanitized scope and outcomes.

The owner selected local development OIDC, explicitly provisioned synthetic
accounts and R/O/M client keys. Hero 11 validates the server entirely through
container-side signed clients; Hero 10 owns APK development and integration.
No APK or physical-device result is required or claimed. Backend APK-specific
test source and launch additions were removed; retained local outputs and data
were preserved.

Completed local checks include:

- PostgreSQL migrations, external configuration, versioned JSON/OpenAPI,
  dependency readiness and correlated OpenTelemetry SDK request traces.
- Actual HTTP authorization-code/S256 PKCE login, approved role-key possession,
  refresh rotation, revocation and scoped denial checks. Focused component tests
  additionally reject mismatched principal/device/key/role and expired authority.
- Hold survived a new login, then deliberate Clock out survived another login
  and the later graceful service restart and isolated restore/replay. The
  `profile_visible` response flag stayed true, and clocked-out R/O/M inbox
  responses were silent. Persisted profile fields, visibility policy and sensor
  shutdown are outside this check.
- A fully signed protocol-v2 R/O/M formation and one initial Operator
  CompletionClaim, exact content-addressed originals/event/artifact retrieval,
  and independent unchanged Rust verification against explicit trust. Exact JSON
  formatting is retained rather than inferred from signature validity.
- Principal-scoped operation lookup, healthy-response retries, conflicting
  request and invalid-artifact denial. Component checks cover concurrent
  acceptance, interrupted delivery and storage-failure pending recovery.

All owned services were gracefully stopped and restarted. Replaying the original
client operations returned their original receipts and preserved scoped domain,
object-reference, operation, outbox/inbox and work-state witnesses.

An exported PostgreSQL snapshot and checked current evidence objects were then
restored into new isolated targets. Table row witnesses, exact object bytes and
database access policy matched the selected recovery point. Restored signed
records passed independent shared Rust verification. The same original HTTP
operations were replayed against the recovered API and worker, with unchanged
scoped witnesses and no reopened acceptance or additional inbox/work identities.
Source API/worker operation was restored and environment verification passed.

Replay deliberately creates fresh authentication bookkeeping; it does not retest
old revoked tokens after restart. No actual dropped HTTP response was injected.
The recovery point is a database snapshot plus checked current objects, not an
atomic database/S3 snapshot, historical-version restore or complete global history.
Unsupported version-pinned references or active retention require an explicit
mapping and are refused by this bounded procedure.

Focused S3-compatible hashing, conditional-write and versioning checks and a
bounded governance-retention metadata exercise passed separately. They establish
no AWS parity, irreversible immutability or adopted application retention policy.
Acceptance and outbox intent commit together in PostgreSQL after verification;
object publication is separate and unaccepted objects or pending operations may
remain after interruption. The worker supplies a database inbox, not external
push/email, sufficient notice or consent.

The final versioned private OCI archive passed descriptor, digest, member and ELF
checks, followed by a same-container nonroot chroot execution of the packaged
API's configuration-free `--version` path. The image's service, database/S3
connectivity and provider runtime were not launched by that check. Private Render
Frankfurt staging configuration remains documented and unapplied.

No registry publication, cloud service, public endpoint, real work, identity
assurance, Requester acknowledgment, payment, settlement, pilot-region decision
or production readiness is established. Union, disputes and incidents remain
outside this first synthetic service release.

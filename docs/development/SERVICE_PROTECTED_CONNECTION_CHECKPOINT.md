# Single-container protected connection checkpoint

Recorded 22 October 2026. The owner selected one private backend codebase and
the existing backend container for the service, database, object storage, worker
and protected tunnel. The five extra staging containers were removed with
explicit approval while all data remained preserved. The backend implementation,
connector credential and detailed operating records remain private.

The current reconnection uses the pinned connector as an owned process inside
the existing container. It introduces no new container, image, mount, published
port or separate service instance. The scoped protected connection passed.

The owned connector and original API readiness returned HTTP 200. The existing
container identity, start time, mounts, ports and device settings were unchanged,
as were the API, worker, database, object store and viewer processes. No extra
staging container exists. The unchanged remote configuration retained its
canonical selected route, required edge authorization and final 404 catch-all;
four edge connections registered.

A repeated start reused the same owned connector process. Current local
discovery confirmed the unchanged loopback HTTP issuer/endpoints. Heroes 2 and
10 received the corrected single-container contract and its transport-only
authentication limit.

Certificate-validated HTTPS requests without edge admission and with an invalid
edge app token both received the Access sign-in redirect. Following the owner's
sign-in, the browser reached actual API status JSON. A current-account request
without a Non-verba bearer returned an authorization error, preserving the
separate backend authorization requirement. An excluded-path browser navigation
was blocked by the browser client, so no actual owner HTTP 404 result is claimed;
the catch-all was verified through received configuration only.

Syntax checks and 15 synthetic token-guard checks passed. Reconnection required
no API/worker restart, account or issuer-key change, database migration, data
merge, image change or remote route/policy/DNS change. Existing homepage hosting
and all retained data remain preserved.

The local issuer, participant/account records, signing key, database and storage
selection remain unchanged. This operation concerns transport only and does not
restore the retired staging HTTPS issuer or its earlier external PKCE/session
journey. Native-client integration, identity validation and production readiness
remain pending.

The remote hostname and owner-only edge policy remain unchanged. An existing
staging label does not imply a separate staging runtime. Before another person's
demo, deliberately select and test their external/native access. Backend login
does not grant edge admission, and no shared client service secret is supplied.

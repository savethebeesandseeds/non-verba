# Shared web components

Reusable browser workflow, evidence, transport, storage and platform modules live
here, grouped into `runtime/`, `evidence/`, `camera/`, `audio/`, `location/`,
`identity/` and `map/`. App pages and presentation belong in
`apps/non-verba-dev/` or `apps/non-verba/`; isolated component pages belong in
`inspections/`. Each app reuses its UI source across browser and APK targets.

The evidence build preserves each module's existing flat runtime filename in
`web/dist/`; Android stages only modules reachable from its developer entries.
Shared placement does not automatically include a module in the participant
app or establish backend integration. The participant shell retains its separate
explicit asset allowlist.

`identity/device-attestation.js` is the reusable browser/native device proof tool.
The participant account flow consumes its first fixed `signin-device` profile;
account HTTP and verifier policy remain outside it. See the
[tool contract](../../docs/sensors/ATTESTATION_TOOL.md) for lifecycle and assurance
boundaries.

Keep cross-capability primitives in `runtime/`: `base64.js` provides capped,
canonical byte transport and `database.js` owns the deployed IndexedDB schema.
`identity/identity-vault.js` owns identity encryption and the native vault
adapter; `evidence/capture-storage.js` owns capture reservation and acceptance
replay/clock checks. Their separation preserves the existing origin database,
stored identities and records.

Location bridge transport stays in `location-platform.js`; unsigned diagnostic
projection lives in `location-diagnostics.js`, and verified-report wording in
`location-presentation.js`. Audio and camera use neutral runtime codecs directly.

Use the [web architecture guide](../README.md) for application and build
boundaries, and the [sensor documentation](../../docs/sensors/README.md) for the
implemented evidence semantics and limits.

# Protocol-2 regression vectors

These ten signed input bundles, verification trust bindings and native reports
are public synthetic regression vectors. They cover seven corrective cases and
three late-context/partial-authorization histories. Their signing identities use
deliberately public test keys; their service, expense and payment claims do not
represent people, services or funds.

The files were copied without changing bytes from the retained NV2-01 snapshot
dated 28 September 2026. The inputs were originally reconstructed from review
descriptions, not supplied by an independent reviewer. Reports were captured by
the project verifier; agreement between native and WASM reports is runtime parity,
not independent proof of protocol correctness.

`provenance.json` records every copied file's original snapshot, byte length and
SHA-256. The private snapshot's logs, operational history and unrelated artifacts
are excluded. Never use these keys or fixtures for real assignments.

Project-authored material is licensed under AGPL-3.0-only; see the root LICENSE.

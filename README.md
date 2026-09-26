# Non-verba cooperation protocol

A Rust reference implementation of task-based cooperation over labour remuneration,
compiled to WebAssembly using the same stack as the photo, location and audio
sensors. Operators set their personal hourly rate **R**. Each verified
performance can contribute one equally weighted new vote; older votes lose weight.
The protocol calculates a task minimum, allows higher individual prices, and keeps
accepted price/time terms stable.

This repository contains the protocol and its tests. The separate evidence-camera
application does not yet provide the identities, agreements, completion ledger or
payments needed to operate it. Nothing here publishes prices or activates a union.

## Folder layout

| Path | Purpose |
| --- | --- |
| `web/branding/` | Project artwork and branding assets |
| `code/crates/` | Rust protocol implementation |
| `code/protocol/` | JavaScript host wrapper for the shared Rust/WASM core |
| `code/test/` | Behavioral, WASM and browser tests |
| `code/examples/` | Runnable protocol examples |
| `code/tools/` | Build scripts |
| `docs/` | Protocol, regulatory boundary and validation documentation |

Build metadata lives in `code/`. Generated WASM packages and Rust build outputs
stay in the ignored `code/pkg/` and `code/target/` directories.

## Build and run

The toolchain is pinned to Rust 1.96.0 and `wasm-bindgen` 0.2.122, matching the
sensor core. Rust owns all protocol validation and calculations. The small
JavaScript wrapper loads WASM, freezes records and invokes the host's verification
callbacks; there is no JavaScript pricing implementation or fallback.

Use Node.js 22 or newer for the build wrapper and browser/WASM tests. No npm runtime
dependencies are needed. Rust dependencies are pinned in `code/Cargo.lock`. A first
build requires the Rust toolchain, WASM target, native linker and dependencies.

Run build and test commands from `code/` so the pinned toolchain and package
metadata apply:

```sh
cd code
```

For a standalone checkout, provision the matching CLI if it is not on PATH:

```sh
cargo install wasm-bindgen-cli --version 0.2.122 --locked
```

The build script also accepts `NONVERBA_WASM_BINDGEN` as an executable path, and
automatically reuses the sensor checkout's already installed CLI when available.

```sh
node tools/build-wasm.mjs
cargo test --locked --workspace
node --test test/cooperation.test.mjs test/wasm.test.mjs
node examples/cooperation.mjs
```

`npm test` and `npm run example` rebuild WASM before running. `npm run test:rust`
runs the native Rust tests. The example is explicitly a local simulation with
fictional records, not a production verification adapter.

With an existing Playwright installation, `node test/browser-smoke.mjs` checks
the actual web build in both a browser and a module Worker. Set
`NONVERBA_PLAYWRIGHT_PATH` to that package's location if it is not locally
resolvable; `NONVERBA_BROWSER_EXECUTABLE` can select a browser executable.

The build produces `code/pkg/nonverba_cooperation.js`, TypeScript declarations, and
`code/pkg/nonverba_cooperation_bg.wasm` using `wasm-bindgen --target web`. These
generated files and `code/target/` are ignored by Git; source and the lockfile are
retained. The default test command selects the two Node test suites; the browser
smoke test runs separately through `npm run test:browser`.

## Runtime integration

Import `code/protocol/cooperation.mjs` in Node, a browser module or a module Worker.
Its existing API is unchanged and waits for the adjacent WASM to initialize.
Serve `code/protocol/` and `code/pkg/` as adjacent directories in the same application, with the WASM MIME type
`application/wasm` and a CSP permitting same-origin WASM execution and loading.
The sensor app already uses this pattern in browsers and Android's WebView.

Verification callbacks must run in the realm that owns the authenticated records.
Functions cannot be transferred in Worker messages; install real adapters in the
Worker or perform admission in the owning realm. Never replace them with posted
`verified: true` flags.

Native Rust applications can depend on `code/crates/nonverba-cooperation` as an `rlib`
and call `execute_json` with a verifier. See the crate's API documentation and
[protocol boundary](docs/COOPERATION_PROTOCOL.md#rust-wasm-and-host-boundary).
The raw `cooperation_plan` export returns a provisional calculation and required
checks; it does **not** authenticate or authorize that calculation by itself.

## Rules at a glance

- One vote per completed assignment per Operator; repeat performances contribute
  additional votes. This is equal influence **per performance**, not per person.
- Each vote snapshots personal R, measured working time and the corresponding
  proposed task price. Actual prices paid are not automatically votes.
- A linear decay window and an upper weighted median provide deterministic rules.
- An agreed baseline protects against an automatic fall below the protected floor.
- Price and time are the only working-condition quantities modeled in v1.
- A bounded optional demand premium uses authenticated requested/available time.
- An individual quote respects both the collective minimum and personal R.
- Accepted work retains its terms. Approved overruns are paid proportionally.

## Read and integrate

- [Protocol, formulas, record fields and adapter contract](docs/COOPERATION_PROTOCOL.md)
- [Regulatory boundary and requirements before operation](docs/REGULATORY_BOUNDARY.md)
- [Rust implementation](code/crates/nonverba-cooperation/src/lib.rs)
- [JavaScript host wrapper](code/protocol/cooperation.mjs)
- [Runnable example](code/examples/cooperation.mjs)
- [Behavioral tests](code/test/cooperation.test.mjs)
- [WASM integration tests](code/test/wasm.test.mjs)
- [Validation results and limits](docs/VALIDATION.md)

The reference implementation validates shapes, scopes, arithmetic and transaction
limits. Deployment adapters must authenticate the underlying facts. A valid
signature, a successful test suite or a changing formula does not establish that a
collective pricing arrangement is lawful. Applicability must be assessed for the
actual workers, work and counterparties before activating an agreement.

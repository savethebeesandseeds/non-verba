# Non-verba cooperation protocol

A Rust reference implementation of task-based cooperation over labour remuneration,
compiled to WebAssembly using the same stack as the photo, location and audio
sensors. Operators set their personal hourly rate **R**. Each verified
performance can contribute one equally weighted new vote; older votes lose weight.
The protocol calculates a task minimum, allows higher individual prices, and keeps
accepted price/time terms stable.

This repository contains the protocol, its tests and a standalone interactive
union simulator. The separate evidence-camera
application does not yet provide the identities, agreements, completion ledger or
payments needed to operate it. Nothing here publishes prices or activates a union.

## Folder layout

| Path | Purpose |
| --- | --- |
| `web/index.html`, `web/index.css` | Responsive public homepage with the project identity and GitHub source link |
| `web/union.html`, `web/union.css`, `web/union.mjs` | Standalone Operators' union simulator |
| `web/setup.mjs` | On-page setup editor with configuration import and download |
| `web/union.config.json` | Default simulator configuration loaded when the page opens |
| `web/branding/` | Project artwork and branding assets |
| `code/crates/` | Rust protocol implementation |
| `code/protocol/` | JavaScript host wrapper for the shared Rust/WASM core |
| `code/simulator/` | Configuration loading and fictional scenario state connected to the Rust/WASM core |
| `code/test/` | Behavioral, WASM and browser tests |
| `code/examples/` | Runnable protocol examples |
| `code/tools/` | Build scripts and local homepage/simulator preview server |
| `docs/` | Protocol, regulatory boundary and validation documentation |

Build metadata lives in `code/`. Generated WASM packages and Rust build outputs
stay in the ignored `code/pkg/` and `code/target/` directories.

## Homepage

The homepage is plain HTML and CSS. It uses the existing transparent sprout
character in `web/branding/individual/01-sprout.png`, loads no external assets,
and links directly to this repository on GitHub. It requires no JavaScript,
package installation, or Rust/WASM build.

From the repository root:

```sh
cd code
node --run serve:web
```

Open [the homepage](http://127.0.0.1:4174/). The same server keeps the simulator
available at `/web/union.html`. Set `NONVERBA_UNION_PORT` to choose another port;
`0` selects an available port. Static hosting can serve `web/` directly with
`index.html` as its entry point; keep its CSS and branding assets alongside it.

For local Codex annotation, use `/web/index-review.html`. The server generates
this noindex route with a narrow inline-style-element exception. The production
page retains its strict CSP; the generated review route is not a release asset.

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
node --test test/cooperation.test.mjs test/wasm.test.mjs test/simulator-config.test.mjs test/simulator-model.test.mjs
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
retained. The default test command selects the Node test suites; the browser
smoke test runs separately through `npm run test:browser`, and the simulator's
browser integration runs through `npm run test:simulator`.

## Interactive union simulator

From `code/`, build the WASM package if `pkg/` is not already available, then start
the local server:

```sh
node tools/build-wasm.mjs
node tools/serve-simulator.mjs
```

The equivalent package commands are `npm run build:wasm` and
`npm run serve:simulator` (or `node --run serve:simulator` without npm).

Open [the union simulator](http://127.0.0.1:4174/web/union.html). Set
`NONVERBA_UNION_PORT` to use another port; `0` selects an available port and the
server prints its URL. Serve the page over HTTP: opening it with `file://` does
not support the required module and WASM loading.

Explore shared personal hourly settings, completed-task votes, decay, demand,
individual quotes and settlement using the existing Rust/WASM calculations.
All people, completions, agreements and demand are fictional, and edits remain in
memory. See [the simulator guide](docs/SIMULATOR.md) for its controls, timeline
limits, JSON export and separate local review route.

Use **Set up your simulation** at the top of the page to edit currency, locale,
Operators, tasks and policy. Advanced settings cover the clock, scope, demand and
limits. Edits remain a draft until **Apply setup**, which validates them and
starts a new scenario, discarding the previous votes and acceptances. A currency change preserves the
numbers entered without exchange-rate conversion; amounts must fit the new
currency's precision (NOK: 2, JPY: 0, KWD: 3).

**Download configuration** saves the validated draft as JSON. **Import
configuration** loads a file into the draft for review before applying it;
**Discard edits** restores the last applied setup. These settings remain in page
memory. Reloading uses [web/union.config.json](web/union.config.json) again. To
change that default, save a downloaded configuration as this file. **Export
snapshot** separately saves the full simulation record. See the
[configuration guide](docs/SIMULATOR.md#configure-in-the-page) for details.

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
- [Interactive simulator guide](docs/SIMULATOR.md)
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

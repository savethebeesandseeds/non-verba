# Cooperation simulator

`union.html` is an independent browser sandbox for fictional Operators, tasks,
rates, voting, offers and settlements. `union.mjs` controls the interface and
`setup.mjs` edits the scenario configuration. The shared model and calculation
code live in `code/simulator/` and the cooperation Rust/WASM core.

Scenario records are held locally in memory. This is not an operational
membership, payment or participant service, and it is not part of the developer
evidence app or participant APK.

Follow the [simulator guide](../../docs/cooperation/SIMULATOR.md) for configuration,
the managed-container build and preview, tests, and current limits. Its entry
URL remains `/web/simulator/union.html`; it is separate from `web/dist/`.

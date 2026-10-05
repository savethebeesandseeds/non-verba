# Operators' union simulator

The standalone page at `web/simulator/union.html` explores the cooperation protocol with
fictional Operators, work and agreements. `web/simulator/union.mjs` controls the interface;
`web/simulator/setup.mjs` provides the configuration editor;
`code/simulator/config.mjs` loads the shared `web/simulator/union.config.json`, and
`code/simulator/model.mjs` manages the local scenario and calls the existing
Rust/WebAssembly protocol. Voting, prices, support thresholds and settlement use
that shared core.

The [operators union notes](../notes/cooperation/OPERATORS_UNION_NOTES.md) explain
the larger idea, distinguish this simulation from an operational union and
preserve questions for its further development.

## Launch

Run builds and previews inside the [managed Debian environment](../development/CONTAINER_PLAN.md).
From the repository root, the [snapshot bridge](../development/CONTAINER_MIGRATION.md) uses:

```powershell
./code/dev.ps1 -Snapshot -Action Exec -Command @('bash', '-c', 'node tools/build-wasm.mjs && NONVERBA_BIND=0.0.0.0 NONVERBA_UNION_PORT=4173 node tools/serve-simulator.mjs')
```

Build and preview use the same fresh snapshot. Generated outputs remain inside
that snapshot; separate invocations do not share `code/pkg/`. Open
[the local simulator](http://127.0.0.1:4173/web/simulator/union.html).
It requires HTTP module and WASM loading; opening the HTML with `file://` will not
work.

The server defaults to `127.0.0.1:4174`. `NONVERBA_UNION_PORT=0` selects an
available port for internal browser tests. The explicit `NONVERBA_BIND=0.0.0.0`
override is permitted only in the managed Linux container; Docker still exposes
the documented port on host loopback. Port 4173 is shared with the capture preview,
so run only one preview at a time. No container ports are added.

The server serves an explicit asset allowlist. Stop it with
Ctrl+C.

Inside Debian, `npm run build:wasm` and `npm run serve:simulator` invoke the same tools.
Run the configuration and scenario tests with
`node --test test/simulator-config.test.mjs test/simulator-model.test.mjs` and the
browser integration with `node test/simulator-browser.mjs`, using an existing
Playwright installation as described in the README. No browser dependencies are
downloaded by these checks.

## Configure in the page

Use **Set up your simulation** at the top of the page. Currency and locale are
visible immediately; expand **Operators**, **Task categories**, **Cooperation policy** or **Advanced settings**
to edit the rest. Advanced settings cover the clock, scope, synthetic demand and
input limits. You can configure the scenario directly in the browser.

Changes are a **draft** until you select **Apply setup**. Applying validates the
entire configuration and starts a new scenario, discarding the previous votes,
accepted assignments and settlement state. Invalid settings show an error and
leave the current simulation unchanged.

- **Discard edits** restores the setup fields to the last applied configuration.
  It does not reset the ongoing simulation.
- **Download configuration** validates the draft and downloads configuration JSON
  compatible with `web/simulator/union.config.json`. Downloading does not apply the draft.
- **Import configuration** reads a configuration file into the draft. Review it
  and select **Apply setup** to use it; importing does not change the running
  scenario.

Applied settings are kept only in the current page's memory. There is no
automatic persistence or write to the source file. Reloading loads
[web/simulator/union.config.json](../../web/simulator/union.config.json) again. Keep a configuration
download to import later, or save it as `web/simulator/union.config.json` to change the
default for subsequent page loads. **Reset simulation** uses the last applied
configuration without reloading the file.

## Currency and configuration files

Currency selects a supported standard code; locale controls display formatting.
Decimal precision comes from that currency's standard metadata. The setup
editor accepts ordinary monetary amounts. Changing currency preserves those
numbers: a draft rate of 300 NOK becomes a draft rate of 300 JPY, with **no
foreign-exchange conversion**. Review rates, baselines and monetary limits before
applying. Amounts requiring more decimal places than the new currency supports
must be corrected; they are not silently rounded. JPY uses whole-yen amounts,
while KWD supports three decimal places.

In configuration JSON, monetary values are **integer minor units**, including
personal rates per hour, task baselines and monetary limits:

| Currency | Decimal places | One minor unit | A configured amount of `12345` |
| --- | --- | --- | --- |
| `NOK` | 2 | NOK 0.01 | NOK 123.45 |
| `JPY` | 0 | JPY 1 | JPY 12345 |
| `KWD` | 3 | KWD 0.001 | KWD 12.345 |

The editor converts its monetary fields to these units when applying or
downloading. Labels, parsing, displayed prices and exported units use the same
validated configuration. If editing the JSON manually, review all monetary
integers when changing `currency`: changing the code alone gives those integers
a different monetary meaning. Existing exported simulation records keep their
own currency and units and must not be relabeled.

The default file supplies currency, locale, clock, scope, policy, demand, limits,
Operators and tasks. It is validated before the simulator starts. A missing file,
malformed JSON or invalid settings stops initialization with an error instead of
silently using built-in defaults. Correct the source file and reload. The setup
editor also validates imported and edited configuration before applying it.
Configuration does not change the protocol's integer arithmetic or authorize a
real agreement.

Keep new scenario defaults in this JSON rather than in the model or HTML. Add
their validation in `code/simulator/config.mjs`, then have both the model and
interface consume the validated values. Fixed protocol rules stay in Rust.

## Explore the scenario

- **Task categories:** configured tasks keep separate vote histories, policy
  settings, demand and accepted assignments. The supplied example includes Site
  photograph and Audio inspection. Switching categories preserves their state.
- **Personal R:** each Operator has one hourly rate shared across categories.
  Changing it affects new quotes and future votes. Recorded votes retain their
  original rate, time and proposed price.
- **Completed work:** adding a hypothetical completion creates one new vote at
  full initial weight. Another completion by the same Operator creates another
  vote. Influence is equal per performance, rather than per person.
- **Time and support:** votes lose weight linearly and remain visible after expiry.
  When participation falls below the required support, both the configured
  baseline price and baseline duration apply. The price and duration medians are
  calculated independently.
- **Demand:** requested and available work are synthetic labour-time inputs.
  Shortage can add a bounded premium; balanced or excess capacity adds none.
  With positive sensitivity, positive demand with zero capacity reaches the cap. Demand snapshots are
  refreshed at the selected simulation date, without measuring a real market.
- **An assignment:** choose an Operator and test an offer. It must meet both the
  collective floor and that person's expected-time price. Acceptance locks the
  terms. Approved extra time increases payment proportionally; faster completion
  retains the accepted amount. The demo stores one accepted example per category.

The timeline hides completions and acceptances dated after the selected day
without deleting them. It does **not** reconstruct past policy, personal-rate,
demand or approved-time settings: those remain the current scenario controls.
Policy edits explore alternatives; they are not member votes or authorized
amendments to an actual agreement.

Changes made with the simulation's live controls, including personal R, demand
and baseline adjustments, do not automatically rewrite the setup configuration.
**Reset simulation** restores the last applied setup and its initial task
histories and rates. Use the setup editor to change defaults you want to keep in
a configuration download.

**Export snapshot** downloads the full simulation record: configuration, currency
units, current state, evaluation and assumptions, including records currently
hidden by the timeline. This unsigned snapshot is separate from **Download
configuration**. Use the configuration download for setup import; a simulation
snapshot records the work explored during the session.

## Scope and local review

The simulation verifier checks consistency with its in-memory records. It does
not authenticate people, completions, agreements, approved time or legal
eligibility, and must not be reused as a production verifier. The page has no
identity, market-data or payment backend and does not activate agreements or
transfer money. Read the [protocol](COOPERATION_PROTOCOL.md) and
[regulatory boundary](REGULATORY_BOUNDARY.md) before integration.

For local Codex element annotation, use
[/web/simulator/union-review.html](http://127.0.0.1:4174/web/simulator/union-review.html), adjusting the
port if needed. The preview server generates this route from the same HTML with
the narrow `style-src-elem 'self' 'unsafe-inline'` exception and noindex markers.
It preserves `style-src-attr 'none'` and the strict script policy. The ordinary
page's CSP stays unchanged. This route is local review only and must not be
included in release exports.

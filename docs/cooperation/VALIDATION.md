# Cooperation protocol validation

This is the historical 26 September 2026 record, retained from the original cooperation repository. It does not describe fresh checks for the unified checkout. Current checks use the managed Linux container and are recorded in [unification validation](../development/VALIDATION.md). Folder paths and the separate-repository statements below describe that earlier revision.

Validated on 26 September 2026 on Windows with Rust 1.96.0, wasm-bindgen 0.2.122,
Node.js v24.19.0, and the existing headless Edge/Playwright installation.
Rust dependencies came from the local cache; no live records were used.

## Folder reorganization — 26 September 2026

After moving the implementation, manifests, tests, tools, generated WASM, and Rust cache under `code/`, the following checks passed again: 15 native Rust tests plus doc-tests, the WASM rebuild and all 56 Node tests via `node --run test`, the Edge browser/module Worker smoke test, and the runnable example. JavaScript syntax, local documentation links, and ignore rules were also checked. Branding now lives under `web/branding/`; the repository and its license remain separate from the private application.

## Public homepage — 26 September 2026

The portrait concept is implemented in `web/index.html` and `web/index.css`, using
the existing transparent sprout character. Browser checks passed at 320, 390,
720, 1024, and 1440 pixel widths without horizontal overflow. The character loads,
the GitHub source link navigates to the expected repository, keyboard focus is
visible, and the page remains usable with JavaScript disabled. Initial page loads
request only local assets and produce no browser or CSP errors.

The local server redirects `/` to the homepage and preserves the simulator's
explicit URL. Production CSP stays strict; `/web/site/index-review.html` is a separate
noindex response with only the narrow style-element exception. Its HTTP method
restrictions and asset allowlist were checked. The full existing simulator browser
suite passed again with real WASM. Screenshots and the homepage check results are
saved under ignored `code/artifacts/qa/homepage/`.

## Commands and results

The standalone union simulator was also validated on 26 September 2026. Its
17 scenario tests and 15 configuration/currency tests pass alongside the existing
56 protocol/WASM tests (88 total).
`node test/simulator-browser.mjs` passes in headless Edge with the real WASM
module. It exercises personal R snapshots, task isolation, vote decay/fallback,
offer rejection, locked terms, extra-time settlement, faster work, JSON export,
missing-WASM failure, server allowlisting and separate production/review CSP.
Configuration tests cover exact currency parsing/formatting, immutable settings,
safe amount/time limits, and rejected malformed configurations. Browser tests
also load alternate task/operator/policy/limit configurations, exercise EUR/JPY/KWD
voting, acceptance and payment, and reject missing or invalid configuration.
The visible setup editor is covered for draft isolation, apply/discard,
currency changes without conversion, rejection of excess precision, configuration
import/download, adding/removing Operators and tasks, and reset/reload behavior.
Desktop and narrow-screen checks include collapsed and expanded setup controls.
The page makes no external requests. Desktop (1440px) and mobile (390px/320px)
screenshots are generated under the ignored `code/artifacts/qa/` directory.

Commands below run from `code/`; paths reflect the current folder layout.

| Command | Result |
| --- | --- |
| `cargo test --locked --workspace` | 15 native Rust tests passed; doc-tests passed |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | Passed |
| `node tools/build-wasm.mjs` | Built the real Rust/WASM module using the web target |
| `node --check protocol/cooperation.mjs` | Passed |
| `node --test --test-reporter=dot test/cooperation.test.mjs test/wasm.test.mjs` | 56 tests passed against compiled WASM, including the original 49 behavior tests |
| `node test/browser-smoke.mjs` | Passed in Edge's page and module Worker; two real WASM fetches |
| `node examples/cooperation.mjs` | Passed; fictional calculation below |

The generated `code/pkg/nonverba_cooperation_bg.wasm` is 109,531 bytes. Native and web
builds use the same Rust source; there is no second JavaScript calculation path.
The browser smoke test verifies matching results, integer rounding, voting,
personal quoting and rejection of a denied verification callback in both realms.
Its temporary localhost server and browser were closed after the test.

The example calculates a collective minimum of 18,750 minor NOK units for 1,800
seconds, including a 25% demand premium. The Operator's higher personal rate gives
a 25,000-minor-unit quote. An agreed 2,400 seconds of final working time requires
33,334 minor units after upward rounding. The example labels all trust adapters
as simulation-only.

## Covered behavior

- Equal initial weight per performance, including multiple performances by one
  Operator; linear age decay, exact median ties, expiry and future-time rejection.
- Immutable personal-rate snapshots; duplicate completions and repeat ballots for
  one assignment/Operator pair rejected.
- Isolation by agreement, task/version, jurisdiction, region, counterparty and
  currency; unknown scope restrictions rejected.
- Distinct-Operator and effective-vote-mass thresholds, including fallback price
  and time, protected baseline, exact integer rounding and overflow failures.
- Bounded demand premiums, zero sensitivity/capacity, missing or stale inputs,
  required attestation of unavailable enabled demand, and quote freshness.
- Personal R cannot undercut the collective floor; higher offers are accepted;
  later policy/rate changes do not rewrite accepted terms.
- Proportional approved-time overruns, retained task price for faster completion,
  and required acceptance/time verification.
- Required verification adapters, rejection of caller-supplied `verified` claims,
  complete ballot snapshot checks and frozen inputs.
- Real WASM binary/export checks, exact weights larger than JavaScript's safe
  integer range, retained signature/proof metadata, and compact verification
  paths that avoid repeating large policy metadata once per vote.

## What these tests do not establish

Fixtures deliberately substitute trusted adapters. Passing tests do not establish
real identity, worker eligibility, lawful bargaining authority, authentic work,
truthful demand/time, a complete production ledger or executed payments. Those
integration requirements and the regulatory boundary are documented separately.
The standalone simulator is not connected to the camera app or live enforcement.
The separate sensor application and Android APK were not changed or rebuilt;
physical Android device validation remains outside this library migration.

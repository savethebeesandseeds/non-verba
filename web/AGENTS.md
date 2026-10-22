# Web source boundaries

Follow the repository-wide instructions and the architecture in `README.md`.

- Keep one UI source per application for browser and APK. Put Non-verba-dev
  screens in `apps/non-verba-dev/src/<feature>/` and Non-verba participant
  screens in `apps/non-verba/src/`. Platform packaging must not create a second
  UI implementation. Android host modules remain in `code/android/app/` and
  `code/android/participant/` respectively.
  Put reusable capture, session, platform and workflow adapters in
  `shared/<capability>/`. Shared modules must not depend on an application or
  inspection page. Rust remains the authority for protocol and verification.
- Treat browser and Android as two platforms for each application. Share its
  markup, styling, navigation, validation and workflow state; keep capability
  differences behind explicit platform adapters. Do not maintain browser-only
  copies of product screens or duplicate business rules in the Android host.
  The participant browser preview, Chromium checks and APK packaging must use
  `collectParticipantAssets`; preserve byte comparisons in preview/package
  checks. Local review instrumentation may alter only the documented CSP and
  indexing metadata, never product content or behavior. A browser pass covers
  shared UI behavior; Android permission, lifecycle and native-adapter checks
  remain separate.
- Keep unintegrated browser demonstrations in `inspections/<feature>/`.
  Completing an inspection does not complete a participant workflow.
- `apps/non-verba/` is the separate participant application. Reuse selected shared interfaces
  when implementing an agreed workflow; never copy or stage the developer app
  into its shell. Keep its explicit asset selection and budgets reviewed.
- Register evidence/inspection source assets and entry points in `assets.json`.
  Keep its stable runtime output names unique. The build validates references,
  source coverage and application dependency boundaries; do not bypass these
  checks by copying an entire source directory into a package.
- Browser evidence assets go to `dist/`; developer Android assets go to
  `dist-android/` and contain only the declared developer dependency closure.
  Never edit generated output or add browser inspection/model files to Android
  staging. Preserve the native document allowlist and production CSP.
- Homepage and simulator remain independent tools with their own entry points.
  The project dashboard lives in the sibling private checkout at
  `../../private-source/web/dashboard/`; follow the private
  [upkeep instructions](../../private-source/AGENTS.md) and its schema and refresh
  procedure when recording confirmed progress.
- Run project builds and tests only through the documented managed Debian
  environment. Source moves require updated imports, evidence/document links,
  build/package consumers and focused browser checks of the affected entries.

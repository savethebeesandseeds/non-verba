# Non-verba working boundaries

## Scope and shared work

- Keep changes limited to the requested outcome. A source cleanup is not a disk
  cleanup, backup, toolchain migration, or container rebuild.
- Inspect Git status before edits. Preserve other sessions' changes and never
  stage unrelated work. The unified public repository is the active source;
  the sibling private repository is retained for private records and future work.
- Use `git ls-files`, `rg`, and targeted reads. Do not recursively inventory,
  hash, copy, or archive ignored build outputs, dependency caches, toolchains,
  captures, or the whole checkout for an ordinary source task.
- If recovery copies are needed, preserve only the specific authored files or
  Git patch required for that change. Never make a backup of generated caches.
- Do not move or delete existing caches, archives, signing material, evidence,
  or another session's live files as incidental cleanup. An existing local
  archive is recovery data; keeping it does not authorize expanding it.

## Project progress dashboard

- Maintain one JSON per Hero in `web/dashboard/heroes/`, for example
  `web/dashboard/heroes/01-sensors.json`. The fixed hierarchy
  is Hero -> Goal -> Milestone; the previous eleven categories are Heroes. Read
  `web/dashboard/SCHEMA.md` and the relevant Hero JSON before updates; the schema
  is sufficient for ordinary progress edits. `docs/notes/WORKSTREAMS.md` defines
  Hero boundaries.
- Keep the dashboard root limited to `README.md`, `SCHEMA.md`, `manifest.json`
  and `package.json`. Hero records live in `heroes/`, interface sources in `src/`,
  build/validation/refresh helpers in `scripts/`, formal schemas in `schemas/`,
  prepared artwork in `assets/branding/`, focused checks in `tests/`, and generated
  output in `public/`. Use the current manifest paths; do not recreate the old
  root-level Hero files when continuing a session started before this migration.
- Keep this a partial record of confirmed work. Add Goals and Milestones only
  from explicit owner requests, agreed task records or evidenced implementation;
  do not seed guessed tasks, acceptance criteria, dependencies or active states
  from a broad workstream description. Leave `goals: []` when the breakdown is
  unconfirmed, or `milestones: []` for a confirmed Goal with no scoped steps.
  An existing evidence file alone does not prove a Milestone's state. Record
  the outcome and its limits; omit unknown dates and ownership. Completion
  indicators apply only to listed Milestones, including local prototypes.
- When a task achieves a milestone, update its Hero JSON in the same change
  as the implementation or decision. Record the actual scoped outcome, status,
  acceptance criteria and authored evidence references. Update the Hero's
  `updatedAt`; Milestone dates/owner/dependencies are optional. Use `completedAt`
  only for a known achievement date. Ordinary updates touch no shared manifest.
- Mark a Milestone done only when its stated acceptance criteria are met and evidence
  is linked. Track prototype, software, physical-device and deployment milestones
  separately. Record an unresolved blocker explicitly; preserve historical limits
  and avoid treating a successful component check as whole-workstream completion.
- Add Goals and Milestones as scope becomes concrete. Store states only on
  Milestones; Hero/Goal summaries are computed. Preserve stable globally unique
  IDs and valid Milestone dependencies. Update the manifest and workstream outline
  only when Heroes change.
  Keep private captures, device records, credentials and operational logs out of
  dashboard JSON. Preserve other sessions' Hero edits.
- Whenever any Hero JSON changes, including Goals, descriptions, evidence or
  Milestone states, refresh the dashboard in the same task. The chat editing the
  JSON is responsible for this step unless the owner explicitly coordinates
  refresh elsewhere; do not wait for the user to ask. Run
  `./web/dashboard/scripts/refresh.ps1` from the repository root, or
  `bash web/dashboard/scripts/refresh.sh` from Windows Bash. The shell helper
  delegates to PowerShell on Windows; inside managed Debian it updates only the
  current snapshot's HTML. The Windows workflow validates and regenerates the
  standalone HTML in the existing managed container through a source snapshot,
  then copies `public/index.html` back. Hero JSONs
  remain the source of truth; preserve concurrent edits and never hand-edit the
  generated HTML. Confirm that the helper completed successfully before reporting
  the dashboard updated; JSON/schema inspection or `-Check` alone does not refresh
  it. If a guard or environment blocker prevents refresh, preserve the guards and
  concurrent work and explicitly report that the dashboard refresh is pending.
  Dashboard upkeep needs no APK or aggregate project build.
- Use `./web/dashboard/scripts/refresh.ps1 -Check` to validate data and HTML freshness
  without host writes. When UI/model/template/schema code or behavior changes,
  use `-BrowserCheck` for focused model and file-open browser checks as well as
  freshness; refresh the generated HTML before delivery. Keep scripts protected
  by generated CSP hashes.
- The dashboard opens directly as `web/dashboard/public/index.html`, already populated
  from its last validated snapshot; do not create a webserver or require a picker
  to use it. Browser file-open security prevents automatically fetching adjacent
  JSONs. JSON edits become visible only after refresh and reopening/reloading the
  HTML. Opening the finished HTML requires no container or development runtime.
- Keep navigation at overview -> one Hero -> one Goal. Start with neither
  selected; do not automatically render all Hero or Goal detail sections.
  A selected Hero shows compact vertical Goal choices with done/total rings,
  recorded state dots, clear selected styling and a fixed chevron cue. Keep
  View Goal/Viewing Goal action text visually hidden for accessibility, retaining
  button semantics, selection attributes and live announcements. Keep one adjacent
  detail panel on desktop and a compact swipeable strip above details on phones.
  Make the Goal navigator's scrolling area taller but bounded and its buttons
  compact. Keep surfaces in the cream, sage and earthy sand theme, with contrasting
  pale olive/sage around ivory/sage Goal choices, soft sage criteria,
  warm parchment evidence and translucent sand Milestone headers with dark ink.
  Emphasize actual source statuses through stronger rails/top rules, markers and
  badges; preserve semantic status colors and keep any body tint consistent.
  Show each Milestone's description once in its header: a two-line closed preview
  and the complete literal text when expanded, without a duplicate body copy.
  Goal selection
  updates only that panel, retains the choices and button focus, and causes no
  automatic document scroll. Goals overview preserves position and returns focus
  to the previous choice; Project overview clears both selections.
  Filters retain all choices and the selected Goal, with full-scope progress,
  separate match counts and an explicit reset path when none match. Reset keeps
  both selections. Active filters reveal matching Milestones;
  clearing them restores the normal Goal hide/show choice.
  Dependency/focus links select the actual owning Hero and Goal and intentionally
  jump to the requested Milestone. Preserve source order and states, including
  empty planning Goals; invent no priority or progress.
- Reuse the project artwork in `web/site/branding/` for the dashboard. Keep
  originals unchanged and embed its small dashboard derivatives through
  `web/dashboard/scripts/branding.mjs`; the standalone page must retain its artwork
  without neighboring assets or network requests. Completion indicators count
  tracked milestones, and the current-work panel reflects actual active/blocked
  records; do not invent priorities or imply production readiness.

## Builds and generated data

- Develop, build, test, and run project services only in the documented managed
  Linux container. Read `docs/development/CONTAINER_PLAN.md` and
  `docs/development/CONTAINER_MIGRATION.md` before container operations.
- Never install or execute Java, Gradle, Rust, Android SDKs, or project build
  toolchains on Windows. Small host scripts for inspection and orchestration
  are allowed. A missing or stopped container is not permission for a host build.
- Reuse the existing `/opt/nonverba-tools` toolchains and `/opt/nonverba-build`
  caches. Do not put downloaded SDKs or dependency/build caches in a host checkout.
- The five Rust packages share `code/Cargo.toml` and `code/Cargo.lock`. Add new
  packages to that workspace; do not introduce nested workspaces or lockfiles
  as an incidental implementation choice. Keep module responsibilities separate.
- Run the smallest relevant validation. Documentation, license, ignore-rule,
  and instruction edits do not justify aggregate tests, Android builds, browser
  screenshots, or release packages.
- Generate an APK, archive, capture, or QA report only when the task needs that
  output. Reuse one source snapshot for related checks; do not repeatedly export
  packages merely to record routine verification.
- Before a new export, copy, or archive expected to exceed 256 MiB, state its
  exact destination, purpose, and expected size. If a task would add more than
  1 GiB outside the existing managed build caches, obtain explicit authorization
  before proceeding. These limits never authorize deleting older data.
- Remove only disposable temporary transfer files created by the current
  invocation. Preserve requested outputs. Existing snapshots, exports, Docker
  objects, named volumes, images, and caches require a separate, itemized cleanup
  decision; never run broad prune, reset, or recursive cleanup commands.

## Version control and publication

- `.gitignore` protects commits; it does not limit disk usage and does not untrack
  files already in Git. Check both ignore behavior and tracked generated paths.
- Track source, manifests, lockfiles, documentation, artwork, and reviewed
  synthetic fixtures. Keep local captures, device records, QA results, packages,
  credentials, signing keys, build products, and toolchains out of source commits.
- Do not add broad JSON, image, or archive ignore patterns that hide intentional
  fixtures or assets. Review any generated file proposed for tracking explicitly.
- Untracking a generated file must preserve its working copy and private Git
  history. Do not publish private history or operational records.
- Use small, explicit commits. Describe completed behavior accurately; never
  document a planned migration or launcher deployment as already finished.
- Preserve repository ownership and existing remote identities. No new `.git`,
  global `safe.directory` workaround, or hosting-account changes are implied.

## Devices and containers

- Follow the documented existing container configuration. Do not create or
  replace containers, images, mounts, volumes, ports, or signing identities as a
  workaround. Inspect and reuse the exact managed container.
- The approved Windows USB exception remains limited to the original sibling
  `private-source/code/tools/usb-device.ps1` and its verified Google ADB binary
  and two USB DLLs: loopback port 5038, mDNS/network autoconnection disabled,
  physical-device selection with `-d`. It does not authorize Windows Java,
  wireless debugging, driver installation, or phone actions unrelated to a task.
- Control the APK through text and semantic state by default. Read the original
  USB helper's `AppUiState`, select observed resource IDs, exact labels or content
  descriptions, and use its bounded `AppUiBatch` for related authorized steps.
  Inspect the returned final state; input acknowledgement does not prove success.
  Do not use screenshot/coordinate loops as the routine control method: they are
  slower and more fragile. Screenshots are for visual checks or specific controls
  genuinely absent from semantic state. A root-only hierarchy is an accessibility
  limitation, not proof of a blank or stuck page; record that limitation and use
  a targeted fallback. Recheck semantic access after a page or app change.
  Follow `docs/development/USB_DEBUGGING.md`; preserve own-app focus, fresh-state,
  ambiguity, permission and native-dialog guards. This preference does not
  authorize arbitrary ADB/JavaScript, global accessibility changes, WebView remote
  debugging, credentials, other-app control or automatic permission approval.

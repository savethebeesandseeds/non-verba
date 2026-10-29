# Non-verba working boundaries

## Scope and shared work

- Keep changes limited to the requested outcome. A source cleanup is not a disk
  cleanup, backup, toolchain migration, or container rebuild.
- Keep one participant preview at the documented port, running a fresh unmodified
  snapshot of the main working tree through the managed launcher. Do not maintain
  a hand-patched or older preview client alongside main. Resolve service
  compatibility in the maintained source/service contract; preserve unavailable-feature guards.
- Use only `http://127.0.0.1:4173/` as the local participant app URL. Serve the
  application there directly; old document URLs redirect to `/`. Keep the local
  annotation CSP exception server-only and production/package HTML strict.
- Keep the participant browser and the participant APK on one UI and one account
  outcome. The debug native transport must allow every account route the shared
  client and the preview relay allow. A route missing from the phone is a product
  bug, not a platform difference. Adapters cover only what the page cannot do
  itself, such as permissions, camera capture, and the USB loopback.
- Inspect Git status before edits. Preserve other sessions' changes and never
  stage unrelated work. This repository owns the public applications, protocols
  and reference tools. The sibling `private-source/code/server/` is the
  owner-selected active private backend, with its own instructions, dedicated
  container and explicitly approved separate Cargo package. Keep backend source,
  deployment configuration and operational records private; do not merge its
  workspace into this one.
- Use `git ls-files`, `rg`, and targeted reads. Do not recursively inventory,
  hash, copy, or archive ignored build outputs, dependency caches, toolchains,
  captures, or the whole checkout for an ordinary source task.
- If recovery copies are needed, preserve only the specific authored files or
  Git patch required for that change. Never make a backup of generated caches.
- Do not move or delete existing caches, archives, signing material, evidence,
  or another session's live files as incidental cleanup. An existing local
  archive is recovery data; keeping it does not authorize expanding it.

## Project progress dashboard

- The project progress dashboard is maintained in the sibling private checkout at
  `../private-source/web/dashboard/`. Follow the private
  [working instructions](../private-source/AGENTS.md) and dashboard
  [schema](../private-source/web/dashboard/SCHEMA.md) before editing its records.
  These local links require the shared workspace; the dashboard is outside the
  public repository and public release exports.
- When a public-source task achieves a recorded Milestone, update its private
  Hero JSON with the actual scoped outcome and public evidence, preserve other
  sessions' edits, and complete the dashboard's refresh procedure in the same
  task. Report a blocked refresh explicitly; do not weaken its guards or treat a
  component check as whole-workstream completion.

## Legal documents and notices

- Hx02 is the owner's continuing steward of
  [the legal document register](docs/LEGAL_DOCUMENT_REGISTER.md). Keep its source
  references, versions, review dates, states and outstanding decisions current
  whenever legal text, notices, agreement flows, offering/coverage or relevant
  data handling changes. Follow its maintenance procedure; preserve earlier
  exact agreement and notice bytes and their acceptance records.
- Other Heroes retain implementation and subject ownership. Record their actual
  evidence and unresolved gaps without promoting draft text, synthetic notices
  or technical checks into legal approval or adoption. Operator, country and
  adoption decisions remain with the owner and applicable legal review.

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
- Follow `code/README.md` for source ownership. Place utilities in the existing
  purpose directories under `code/tools/`, and JavaScript checks in the scoped
  groups under `code/test/`; register their prerequisites in
  `code/tools/test/test-suites.mjs`. Android platform tests belong to
  `code/android/tests/`, JNI integration tests to their Rust crate, and frozen
  research to its versioned experiment. Update consumers when moving source;
  do not recreate flat compatibility copies or duplicate test harnesses.
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

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

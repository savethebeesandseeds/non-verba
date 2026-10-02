# Managed Debian development environment

Project development, builds, tests and Java execution run inside the project's
managed Linux container. Windows scripts inspect files and orchestrate Docker or
the explicitly approved USB transport; they do not run host build toolchains.

The authoritative definition is
[`code/container/config.json`](../../code/container/config.json), with
[`code/dev.ps1`](../../code/dev.ps1) for host orchestration,
[`code/dev.sh`](../../code/dev.sh) for project operations and
[`code/setup.sh`](../../code/setup.sh) for reproducible dependency setup.

The documented configuration uses `non-verba-dev`, image
`non-verba:dev-gpu-v1`, command `sleep infinity`, working directory
`/workspace/code`, named volumes `non-verba-dev-home` at `/root` and
`non-verba-dev-tools` at `/opt`, loopback ports 4173 and 9222, restart policy `no`
and the configured GPU access. The Dockerfile and lockfiles pin provisioning
inputs. Do not invent a replacement definition or run an unmanaged probe container.

## Existing checkout transition

The pre-unification container binds the former private checkout at `/workspace`.
That container and its named volumes are preserved. A launcher in this public
checkout must not silently reinterpret the existing bind or labels as this source
tree. The default launcher checks the complete expected configuration and refuses
a mismatched same-named container.

Use the explicit snapshot bridge in
[the migration guide](CONTAINER_MIGRATION.md) to validate this checkout in the
already running, verified environment. Snapshot execution uses a fresh source
copy and does not replace the existing bind, container, image, volumes or phone
connection. Follow the guide for the supported operations and restrictions.

A permanent bind transition is a separate container lifecycle change. Preserve
existing containers and all mounted data; do not delete them or bypass the
configuration assertions as a shortcut.

## Normal launcher procedure

For a container whose bind and labels match its checkout, run from that checkout's
root:

```powershell
./code/dev.ps1 Status
./code/dev.ps1 Up
./code/dev.ps1 Setup
./code/dev.ps1 Test
./code/dev.ps1 Build
./code/dev.ps1 Serve
```

`Up` inspects and reuses an existing matching container, including a stopped one.
`Setup` installs/configures dependencies without managing container lifecycle.
`Build` and `Test` dispatch the project operations inside Debian. `Prepare` is
dependency-image preparation; it does not create or replace a container.

The evidence application preview uses the documented loopback port 4173. Camera
access needs localhost or HTTPS. The optional local `review.html` entry permits
only the narrow style-element exception needed for Codex annotations. Production
HTML keeps its strict CSP, and Android assets exclude the review entry.

## Browser and Android checks

Browser test dependencies are separately pinned under
[`code/container/browser-tests`](../../code/container/browser-tests).
Follow `setup.sh`'s documented optional browser setup rather than installing a
host browser toolchain. An unavailable browser runtime is an explicit validation
limit; do not replace real browser checks with a claim based on adapter tests.

Android uses the Linux JDK, Android SDK/NDK and Gradle inside the managed environment.
Keep Java off the Windows host. Android build details are in
[the package guide](../../code/android/README.md). New build outputs remain
ignored under `code/artifacts/`; source publication does not include signing
credentials or earlier phone evidence.

The [USB guide](USB_DEBUGGING.md) documents the separately authorized physical
USB transport. Snapshot mode does not authorize ADB or phone operations. Network
debugging and USB passthrough are different configurations and must not be assumed.

Record checks actually executed in [validation](VALIDATION.md). Container health,
a successful build and synthetic tests are separate from physical acceptance.

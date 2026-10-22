# Preserved container and explicit source snapshots

The public checkout and the original private checkout remain separate physical
directories. This guide describes the preserved application/research container
and the public-source snapshot bridge. The owner-selected private backend now
has its own private instructions and dedicated container in
`private-source/code/server/`; it does not use this bridge as its service launcher.
Private Git history is preserved. Former application source and working changes
remain in a small local recovery archive outside both repositories.
Obsolete archived caches and host toolchains were removed at the owner's request. See
[completed consolidation record](VALIDATION.md#private-reserve-and-recovery-record)
and [working boundaries](../../AGENTS.md).
The existing managed container is
preserved: name `non-verba-dev`, immutable ID
`fcb9461f2ccc1d76871ee40713fcc93752b72e51a454890188cf9b1f052d7d4e`, image
`non-verba:dev-gpu-v1`, immutable image ID
`sha256:2fb1e6b1c3250aae15625a15c4496326bceb8487b26ac9f66cd94f7c2462bc1e`.
Its bind still maps the sibling `private-source` checkout to `/workspace`; its
working directory remains `/workspace/code`.

The named volumes `non-verba-dev-home` (`/root`) and `non-verba-dev-tools`
(`/opt`), loopback ports 4173 and 9222, `sleep infinity` command, restart policy
`no`, and configured GPU access stay unchanged. Toolchains, signing identity and
dependency/build caches remain in the existing container and volumes. There is
no USB passthrough and no host Java or build-toolchain fallback.

## Snapshot bridge

The normal launcher retains strict checkout/bind/label assertions. It refuses
the original same-named container when invoked from this public checkout.
`-Snapshot` is an explicit migration bridge; it validates the complete recorded
container configuration and immutable IDs against the original sibling bind.
It never relabels, retargets, starts, replaces or recreates that container.

The original private launcher was moved during the interrupted cleanup. Its
replacement is the reviewed
[compatibility bridge](../../code/container/private-repository-bridge.ps1),
deployed at the original path. It inspects or starts only the pinned existing
container, without replacing it. Deployment did not start the container. When
development requires it, from the parent directory containing both checkouts:

```powershell
./private-source/code/dev.ps1 Up
```

Then, from the unified public checkout:

```powershell
./code/dev.ps1 -Snapshot -Action Status
./code/dev.ps1 -Snapshot -Action Test
./code/dev.ps1 -Snapshot -Action Build -Command @('developer')
```

Android builds require an explicit `developer`, `participant` or `all` target.
Routine builds assemble/lint without exporting copies. The
[Android build contract](../../code/android/README.md#build-contract) defines the
canonical target pipeline, concurrency limit, run records and verified export flags.

Snapshot execution accepts `Setup`, `Shell`, `Exec`, `Build`, `Test`, `Serve`
and `Native`. `Status` only inspects the environment. `Up`, `Prepare` and `Adb`
are rejected in this mode. Dependency setup still follows `setup.sh`; it does
not manage container lifecycle or start project services.

The private bridge accepts only `Up` and `Status`. It refuses project
actions and any missing or mismatched container. Development commands use the
public source snapshot; the archived private implementation is not executed.

By default, each execution copies the current public source namespaces into a fresh
directory beneath `/tmp/nonverba-unified-source/`. The launcher prints its exact
path. This copy contains no `.git`, private history, reviews, evidence artifacts,
build outputs, developer toolchains/caches, generated Android assets or signing
vaults. It allows source files, reviewed fixtures and artwork, refuses linked
path components and unknown file types, and independently verifies the archive's
exact regular-file set and hashes before copying/extracting it. Publication
review of source and fixture contents is still a prerequisite.

The bridge uses existing PowerShell 7/.NET archive inspection and Windows `tar`
only to inspect/package source files; no project build executes on Windows.
`Serve` builds the evidence WebAssembly/assets in its own fresh snapshot before
starting the preview. `Test` invokes the same aggregate package test command as
`node --run test`, including cooperation, evidence, assignment and dispute tests.

Normal application commands execute this snapshot's `dev.sh`, never the old private source. Bash
entry points derive their code directory from their location. Linux toolchains
and caches continue to use `/opt/nonverba-tools` and `/opt/nonverba-build`.

### Private dashboard maintenance

The project dashboard lives at `private-source/web/dashboard/` in the shared
workspace. Its [refresh helper](../../../private-source/web/dashboard/README.md)
uses the existing application development container through an explicit
`-Snapshot -DashboardSnapshot -Action Exec` invocation of the public
`code/dev.ps1` launcher. Ordinary public snapshots do not include private source.

The opted-in dashboard snapshot preserves the workspace layout: public source is
under `open-source/`, alongside only `private-source/web/dashboard/`. It includes
no private backend implementation, private Git history, signing material or
operational records. Evidence and verification paths in dashboard records start
with `open-source/` or `private-source/` relative to that workspace root. Canonical
branding remains under `open-source/web/site/branding/`.

From the private repository root, run:

```powershell
./web/dashboard/scripts/refresh.ps1
```

The helper validates and regenerates the standalone HTML in that composite
snapshot, then copies only its generated `public/index.html` back into the private
dashboard. Add `-Check` for validity and freshness checks or `-BrowserCheck` for
focused model and file-open browser checks, following the dashboard guide. The
server container and the default public snapshot/export scope stay separate.

## Related operations share one snapshot

Every invocation creates a fresh source copy. Generated web outputs, exports and
reports stay inside that copy and are not copied back automatically. Android
staging/outputs and Cargo/Gradle caches use the shared `/opt/nonverba-build` tree;
a later selected build can replace its cached APK. An explicit verified export
retains an exclusive copy for handoff. Keep preparation and follow-up checks
together; a browser-only export needs no Android build:

```powershell
./code/dev.ps1 -Snapshot -Action Exec -Command @(
  'bash', '-c',
  'node tools/build/build-web.mjs && node tools/build/package-web.mjs'
)
```

For APK handoff, add `--export --baseline-report PATH` to the selected Build
command. The pipeline runs the selected independent package inspectors against
its exact exported APKs in the same snapshot before finalizing a manifest.
The developer inspector is `node tools/build/verify-android-package.mjs`; the separate
participant inspector is `node tools/build/verify-participant-package.mjs`. Each also
accepts an exact existing `--apk` and independent `--baseline-report`. The
original report may remain under `/workspace/code/artifacts/`; reading its
public signer fingerprint does not require publishing the private report.
The inspector also verifies version, assets, libraries and license/source
notices; it does not establish reproducibility or physical sensor truth.

The maintained browser exporter independently verifies its produced archive.
`node tools/build/verify-web-package.mjs --archive PATH` compares an existing archive
with the current built snapshot without changing it. Legacy PowerShell release
packaging/verifier entry points now stop with explicit Linux directions. The
superseded Python packager/tests and unreachable Windows Java/MSVC implementations
are removed. GNSS fixture validation remains available through
`cargo test --locked -p nonverba-core rtklib`; independent oracle regeneration
needs a reviewed Linux port and is not performed by that check.

Outputs can be retained separately by copying the exact printed container path
with `docker cp`. Do not add APKs, QA screenshots, enrollment/evidence exports or
personal device records to public source. Existing private and scratch outputs
are preserved by the bridge; it does not automatically remove existing
snapshots, outputs, caches or Docker objects.

Generate an export only when it is needed for the task. Reuse one snapshot for
related checks and do not repeatedly build packages for routine verification.
The temporary container transfer archive is disposable; snapshot source and
outputs remain available. Old snapshots and exports require a separately
itemized cleanup decision, following the [working boundaries](../../AGENTS.md).

## Source notices and signing identities

The snapshot supplies its base Git revision, worktree state and source-archive
SHA-256 as `NONVERBA_SOURCE_REVISION`, `NONVERBA_SOURCE_DIRTY` and
`NONVERBA_SOURCE_SNAPSHOT_SHA256`. Binary exports include `LICENSE.txt`,
`SOURCE.txt`, root `LICENSES/` notices and `THIRD_PARTY_NOTICES.md` when present.
Android notices live separately in `assets/nonverba-license/`; its bundled
document/origin allowlists are unchanged.

Follow-up commands in the same snapshot must receive those same three source
metadata variables. `dev.sh` preserves supplied values but does not reconstruct
them when a later `docker exec` omits the launcher's environment. Record the
original values and pass them explicitly for package inspection; otherwise the
inspector correctly rejects a different expected `SOURCE.txt`. Reinspect the
unchanged APK with the original snapshot metadata rather than editing notices,
rewriting reports or rebuilding/exporting another package.

Dirty or unspecified development builds explicitly say that their base revision
may not contain the exact matching source. Before distributing such binaries,
provide their complete corresponding source. A clean identified build points
to its source revision. These notices do not certify reproducible builds,
conformance, signatures or honest sensors.

The current Linux APK build preserves the established debug signing key in
`/root/.android/debug.keystore`; it refuses to invent a replacement. Signing
vaults and credentials are not published. A fresh independent environment needs
an explicitly chosen signing identity and reviewed enrollment/verifier pins.

## USB and permanent migration limits

The existing Windows USB exception remains limited to the original
`private-source/code/tools/usb-device.ps1` and its verified Google ADB executable
and USB DLLs. It retains loopback server port 5038, disabled mDNS/network
autoconnection and physical-device selection. The public copied helper refuses
to extend that exception from a new path. Source unification does not authorize
phone actions, wireless debugging, host Java or automatic driver installation.
See [the USB procedure](USB_DEBUGGING.md).

The original helper supports `-AppTarget developer|participant` only for
`AppStatus`, `AppWindowState`, `InstallVerified`, `Launch`, `AppUiState`, `AppScreenshot`,
`AppUiBatch`, `AppTap`, `AppSwipe`, `AppBack` and `AppText`.
The default remains developer. Package and activity selection is fixed to
`org.nonverba.camera/.MainActivity` or
`org.nonverba.participant/.ParticipantActivity`; no arbitrary package is exposed.
Sensor, restart and retrieval actions remain developer only and reject
an explicit `-AppTarget`. The original host path and transport restrictions still
apply to both APKs.

Direct snapshot APK paths are outside the original helper's strict
`/workspace/code/artifacts/container-builds/` installation-report boundary.
The reviewed bounded export bridge below permits an authorized phone update
without changing that boundary or the existing container bind.

### Bounded snapshot APK export for an authorized phone update

Originally reviewed 4 October 2026; the target-specific report contract now
covers both APKs. Use the same launcher-validated source snapshot for
the build, export and package inspection. This procedure does not rebuild the
container, migrate its bind, rewrite a verification report or change a signer.

1. Build the explicit `developer`, `participant` or `all` target in the existing
   managed container through the snapshot launcher, with
   `--export --baseline-report PATH` for handoff. Keep the exact printed snapshot,
   export and successful independent inspector report paths. Check each selected
   APK and every parent component are regular/unlinked, then record size and hash.
2. Create one new, exclusive UTC-named directory under the existing original
   `/workspace/code/artifacts/container-builds/` bind. Verify that the parent
   resolves to that exact path and no component is linked. Fail if the target
   already exists. Copy only the selected `nonverba-debug.apk` and/or
   `nonverba-participant-debug.apk`, retaining those exact filenames. Compare
   each copy's bytes/hash with its snapshot export. Keep both outputs and any
   failed evidence.
3. From that same public snapshot and with its original source metadata, run
   each selected Linux inspector against the exact bound export path and the
   independently retained original signer baseline:

   - Developer: `node tools/build/verify-android-package.mjs --apk
     /workspace/code/artifacts/container-builds/<UTC>/nonverba-debug.apk
     --baseline-report <ORIGINAL-BASELINE>`. Require schema 2, `passed`, package
     checks, current Linux build verification with no gaps, signature verification
     and the retained signer.
   - Participant: `node tools/build/verify-participant-package.mjs --apk
     /workspace/code/artifacts/container-builds/<UTC>/nonverba-participant-debug.apk
     --baseline-report <ORIGINAL-BASELINE>`. Require schema 1, `passed`, package
     checks, exact `org.nonverba.participant` identity and
     `participant-shell-debug` kind, retained debug signature, matching baseline
     signer, compiled-manifest permissions, ZIP alignment and license/source notices.

   Require no errors. Each inspector must genuinely produce that exact APK path
   in its report; never rewrite paths, check fields or source notices in a report.
   Participant checks do not claim the developer inspector's current compiled
   source coverage, reproducibility or physical acceptance.
4. Copy only each authentic inspector report, unchanged, to a new file in the
   original host private `code/artifacts/qa/` directory and compare its hash.
   The corresponding APKs already reside in the original host bind. Invoke the
   original approved USB helper's `InstallVerified -AppTarget developer` or
   `InstallVerified -AppTarget participant` with that target's exact
   `-VerificationReport` path. Retain each installed-hash readback; the helper
   also rechecks unchanged local APK bytes. Installation does not launch either
   app. When authorized, `Launch -AppTarget developer` or
   `Launch -AppTarget participant` opens only its fixed activity.

No cache, build-tree, signing-key or whole-snapshot copy is part of this bridge.
Apply the working-boundary size limits before large transfers. Build/inspection
success remains separate from installation and subsequent physical validation.
A permanent bind/transport transition still needs a separately reviewed
lifecycle procedure preserving the original container, volumes, data and signer.

Provisioning source changes also change the image-input hash. `Prepare` can
therefore require an explicit image rebuild even while the verified existing
container remains usable for snapshot checks. Do not bypass that comparison or
silently replace the image/container.

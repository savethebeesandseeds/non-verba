# Preserved container and explicit source snapshots

The unified public checkout and the original private checkout remain separate
physical directories. The private reserve tracks only README, ignore rules and
text attributes; its original Git history is preserved. Former source and
working changes remain in a small local recovery archive outside both repositories.
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
./code/dev.ps1 -Snapshot -Action Build
```

Snapshot execution accepts `Setup`, `Shell`, `Exec`, `Build`, `Test`, `Serve`
and `Native`. `Status` only inspects the environment. `Up`, `Prepare` and `Adb`
are rejected in this mode. Dependency setup still follows `setup.sh`; it does
not manage container lifecycle or start project services.

The private bridge accepts only `Up` and `Status`. It refuses project
actions and any missing or mismatched container. Development commands use the
public source snapshot; the archived private implementation is not executed.

Each execution copies the current published source namespaces into a fresh
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

Commands execute this snapshot's `dev.sh`, never the old private source. Bash
entry points derive their code directory from their location. Linux toolchains
and caches continue to use `/opt/nonverba-tools` and `/opt/nonverba-build`.

## Related operations share one snapshot

Every invocation creates a fresh source copy. Generated WASM, Android staging,
exports and reports stay inside that copy; they are not copied back or reused by
another invocation. Keep a build and its follow-up checks together:

```powershell
./code/dev.ps1 -Snapshot -Action Exec -Command @(
  'bash', '-c',
  'bash dev.sh build && node tools/package-web.mjs'
)
```

For APK inspection, run `node tools/verify-android-package.mjs` after building
in the same snapshot. Supply `--apk` with the build's exact exported APK path
and `--baseline-report` with an independently retained signer report. The
original report may remain under `/workspace/code/artifacts/`; reading its
public signer fingerprint does not require publishing the private report.
The inspector also verifies version, assets, libraries and license/source
notices; it does not establish reproducibility or physical sensor truth.

The maintained browser exporter independently verifies its produced archive.
`node tools/verify-web-package.mjs --archive PATH` compares an existing archive
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

Direct snapshot APK paths are outside the original helper's strict
`/workspace/code/artifacts/container-builds/` installation-report boundary.
The reviewed bounded export bridge below permits an authorized phone update
without changing that boundary or the existing container bind.

### Bounded snapshot APK export for an authorized phone update

Reviewed 4 October 2026. Use the same launcher-validated source snapshot for
the build, export and package inspection. This procedure does not rebuild the
container, migrate its bind, rewrite a verification report or change a signer.

1. Build in the existing managed container through the snapshot launcher. Keep
   the exact printed snapshot and build output paths. Check that the APK and
   every parent component are regular/unlinked, then record its size and hash.
2. Create one new, exclusive UTC-named directory under the existing original
   `/workspace/code/artifacts/container-builds/` bind. Verify that the parent
   resolves to that exact path and no component is linked. Fail if the target
   already exists. Copy only `nonverba-debug.apk`; compare its bytes/hash with
   the snapshot output. Keep both outputs and any failed evidence.
3. From the same public snapshot, run the unmodified Linux package inspector
   against that exact `/workspace/code/artifacts/container-builds/<UTC>/nonverba-debug.apk`
   copy, with the independently retained original signer baseline. Require
   `passed`, current-build verification, no reported gaps and the retained signer.
   The inspector must genuinely produce this path in its report; never edit it.
4. Copy only the authentic inspector report, unchanged, to a new file in the
   original host private QA directory and compare its hash. The APK already
   resides in the original host bind. Invoke the original approved USB helper's
   `InstallVerified` with this report; retain its exact installed-hash readback.

No cache, build-tree, signing-key or whole-snapshot copy is part of this bridge.
Apply the working-boundary size limits before large transfers. Build/inspection
success remains separate from installation and subsequent physical validation.
A permanent bind/transport transition still needs a separately reviewed
lifecycle procedure preserving the original container, volumes, data and signer.

Provisioning source changes also change the image-input hash. `Prepare` can
therefore require an explicit image rebuild even while the verified existing
container remains usable for snapshot checks. Do not bypass that comparison or
silently replace the image/container.

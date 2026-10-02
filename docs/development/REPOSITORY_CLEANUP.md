# Repository state and cleanup boundaries

The unified public repository contains the protocol, sensor core, Android
application, browser UI, tests, and development tools. The private repository
remains private and retains its original Git history for future use.

## Current local state

The source unification was committed separately from the subsequent cleanup.
The cleanup was interrupted after old private working files and ignored caches
were moved into a dated `local-archive/` directory outside both repositories.
The private Git history was not moved, reset, or replaced. Many original tracked
source paths are therefore absent from the private working tree; this does not
mean they have been removed from its Git history.

Local evidence and package records under private `code/artifacts/`, approved USB
helpers, and the existing Google USB transport files stayed at their original
paths. Concurrent research-note edits must be preserved. Do not restore older
archived documents over live files.

The private reserve conversion is unfinished. The private checkout does not yet
track only reserve metadata. Its missing launcher has been replaced by the
reviewed [compatibility bridge](../../code/container/private-repository-bridge.ps1)
at `private-source/code/dev.ps1`. It accepts only `Up` and `Status`, validates the
pinned existing container, and never runs the archived private implementation.
Deployment did not start the container or change its volumes or configuration.
Do not invoke old tools from the archive.

The archive contains original paths, sizes, hashes, and tracked-change patches.
It is recovery data, not another checkout or a publication input. Its existence
does not justify further copies, cache inventories, or repeated verification of
generated files. Do not expand or delete it as part of a source task.

## What belongs in Git

Track authored source, documentation, manifests, lockfiles, artwork, and reviewed
synthetic fixtures. Ignore reproducible build outputs, installed dependencies,
SDKs, generated packages, local captures, device-acceptance records, signing
material, and routine QA results.

The public source reviewed at revision `7457adc` contained approximately 40 MB
of tracked files and no tracked build caches. The large old private directory
included ignored Rust outputs and toolchains. Git ignores prevent new files from
being added; they neither limit disk growth nor remove already tracked records.
Remove an already tracked local artifact from the index only, preserving its
working copy and private history. Never import private history into public Git.
The ignore correction removed 1,222 private device-acceptance records from
tracking; every working file remained on disk.

## Working limits

The [project instructions](../../AGENTS.md) define the limits for subsequent
work. Ordinary source cleanup must use targeted source reads rather than
recursively hashing, backing up, or archiving ignored trees. Documentation and
ignore changes need relevant checks, not Android builds or package exports.

Builds run only in the documented Linux container, reusing its existing
`/opt/nonverba-tools` and `/opt/nonverba-build` paths. Generate exports only when
the task requires them and use one snapshot for related checks. Removal of old
snapshots, caches, archives, or Docker objects is a separate itemized decision;
no such deletion is part of this correction.

Source consolidation and this correction do not add physical-device validation
or resolve the limitations recorded in [validation](VALIDATION.md).

# Completed repository consolidation

The public repository is the active home of the protocol, sensor core, Android
application, browser UI, tests, tools and documentation. All five Rust packages
share `code/Cargo.toml` and `code/Cargo.lock`, while keeping their own interfaces.
The simulator's browser interface and JavaScript model use the same cooperation
core; their separate folders are parts of one simulator.

## Private reserve

The private repository now tracks exactly `README.md`, `.gitignore` and
`.gitattributes`. Its original Git history remains intact. The migrated source,
private journals and operational copies are no longer tracked at its current
revision; future authored private work remains trackable.

Ignored local files deliberately remain at their original paths:

- `code/dev.ps1`: the reviewed [compatibility bridge](../../code/container/private-repository-bridge.ps1), limited to `Up` and `Status` for the pinned existing container.
- Four approved USB/staging helpers and the verified Google transport executable
  and DLLs: compatibility copies maintained from public source.
- `code/artifacts/`: existing local evidence, signer reports and older packages.

Three stale private research drafts matched their existing recovery copies and
were removed from the live private checkout. Their newer public versions were
preserved. Active terminology work in the public requests/disputes modules is a
separate change and is not included in the consolidation commits.

The existing container, original bind, image, named volumes, loopback ports, GPU
configuration and signer remain unchanged. Development uses public source
snapshots through the [migration procedure](CONTAINER_MIGRATION.md). Compatibility
files do not extend phone, wireless or Windows toolchain authorization.

## Small recovery archive

The dated archive beside the repositories retains authored source, private notes,
working-change patches, signing/user files and original inventory records. At the
owner's explicit request, 22.1 GB of reproducible build outputs, obsolete host
SDKs/toolchains, dependency caches and old generated packages were deleted.
The remaining recovery archive was measured at about 88.5 MB after that pruning.

The archive's `cleanup-record.json` identifies intentionally removed paths;
its original manifest and verification describe the earlier complete inventory.
It is private recovery data, not an active checkout or publication input. Do not
expand it, execute obsolete tools, or restore stale content over concurrent work.

## Ongoing limits

Track source, documentation, manifests, lockfiles, artwork and reviewed synthetic
fixtures. Generated outputs, toolchains, captures, signing material and routine
QA results stay out of source commits. Ignore rules prevent accidental tracking;
they neither limit disk usage nor remove previously tracked data.

The [working boundaries](../../AGENTS.md) require targeted source inspection,
small relevant checks, container-only builds and reuse of existing caches. They
prohibit whole-cache inventories/backups and incidental archive or Docker cleanup.
No physical sensor testing or package export is part of this final cleanup.

The [validation record](VALIDATION.md) distinguishes the original unification
checks from the focused single-workspace checks and existing physical limitations.

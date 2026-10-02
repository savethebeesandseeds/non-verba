# Non-verba

Non-verba develops tools for cooperation, signed assignments, sensor evidence,
and independent verification. The protocol, Android application, browser
application, and reference verifiers now live in this repository.

This is a development project. Its components do not yet form a deployed
marketplace, payment service, or complete cooperation workflow. A valid signature
does not prove that a camera scene, sound, or location is truthful. Read the
[evidence boundaries](docs/sensors/SECURITY.md) and the
[assignment threat model](docs/requests/THREAT_MODEL.md) before relying on a report.

## Project structure

| Path | Responsibility |
| --- | --- |
| `web/site/` | Public homepage and project artwork |
| `web/simulator/` | Standalone cooperation simulator and setup editor |
| `web/src/` | Shared requester, operator, and verifier browser UI |
| `code/crates/nonverba-cooperation/` | Task-scoped remuneration calculations |
| `code/crates/nonverba-core/` | Sensor policies, evidence formats, signing, and verification |
| `code/crates/nonverba-android/` | Native sensor JNI interface |
| `code/android/` | Android application and native acquisition adapters |
| `code/requests/` | Three-party assignment protocol and portable verifier |
| `code/disputes/` | Analysis-only dispute workflow; no financial authority |
| `code/protocol/`, `code/simulator/` | Cooperation host API and simulator model |
| `code/test/`, `code/examples/` | Integration tests and runnable examples |
| `code/tools/`, `code/container/` | Build, packaging, and managed development tools |
| `docs/` | [Specifications, usage, development, and limitations](docs/README.md) |

All five Rust packages share the workspace and lockfile in `code/`. Sensor,
Android, cooperation, assignment, and dispute code remain separate packages with
their own module boundaries. Generated packages, captures, local trust material,
build outputs, and toolchains are excluded from version control.

Release builds use the shared size-optimized profile with LTO and
`panic = "abort"`; tests retain Cargo's normal test profile.

## Development

Project builds, tests, and Java run inside the documented Debian development
container. Rust 1.96.0 and wasm-bindgen 0.2.122 are pinned. Do not install or run
project toolchains on Windows.

Use the [container guide](docs/development/CONTAINER_PLAN.md). Existing local
containers remain tied to their original checkout; the explicit
[snapshot bridge](docs/development/CONTAINER_MIGRATION.md) permits working on this
repository without replacing them or their volumes.

Follow the [working boundaries](AGENTS.md): use the smallest relevant check,
reuse container caches, and keep source cleanup separate from disk cleanup.
Ignore rules prevent generated files from entering Git; they do not limit disk
usage or authorize archiving or deleting local data.

Inside the managed container, from `code/`:

```sh
node --run test
node --run build:web
export NONVERBA_PLAYWRIGHT_PATH=/opt/nonverba-tools/browser-tests/node_modules/playwright
export PLAYWRIGHT_BROWSERS_PATH=/opt/nonverba-tools/browser-tests/browsers
node --run test:browser
node --run test:simulator
```

The aggregate test command covers the Rust workspace, cooperation WASM tests,
and sensor JavaScript adapters. Browser, Android, and physical-device checks are
separate. See [validation](docs/development/VALIDATION.md) for the checks actually
performed for this consolidation.

The homepage export is a deliberately small static package. Adding Android and
browser source does not automatically deploy either application through Pages.
See [homepage deployment](docs/development/HOMEPAGE_DEPLOYMENT.md).

## License and contributions

Project-owned source and accompanying materials are licensed under the GNU
Affero General Public License, version 3 only (`AGPL-3.0-only`). See [LICENSE](LICENSE),
[third-party notices](THIRD_PARTY_NOTICES.md), and [contribution guidance](CONTRIBUTING.md).
Third-party dependencies, artwork, and data retain their own terms.

AGPL permits commercial use and forks. Its applicable distribution and modified
network-service obligations provide access to corresponding source; they do not
require every private modification to be published or certify a fork as fair.
Modified versions must carry the required modification notices. Project names
and release identity must not be used to imply endorsement of a fork.

Earlier public revisions through `63e5884` were released under Apache 2.0; those
grants remain valid. The previously separate application source enters this
public repository with this consolidation under AGPLv3. Its private Git history,
operational records, signing material, and personal captures are not imported.
The private repository remains a reserve for future work. Its former source,
uncommitted work and private journals remain in a small local recovery archive;
obsolete caches and host toolchains were removed at the owner's request. The
private repository now tracks only its README, ignore rules and text attributes.
Its original Git history and ignored local records remain private.
See [repository cleanup](docs/development/REPOSITORY_CLEANUP.md).

Read the [governance principles](GOVERNANCE.md) for the project's intended rights
and cooperation model. They are a draft design, not a legal charter or a
guarantee of deployed behavior.

# Implementation map

The public implementation has one Rust workspace and two application hosts.
Browser and APK UI sources live in [`web/apps/`](../web/apps/README.md).

| Directory | Owns |
| --- | --- |
| `crates/` | Shared Rust protocol, evidence, WASM and JNI libraries. |
| `android/` | Android application hosts, native collectors and platform tests. |
| `protocol/` | JavaScript interface to the cooperation WASM library. |
| `simulator/` | Simulator configuration and presentation model. |
| `requests/` | Assignment protocol crate and its own protocol tests. |
| `disputes/` | Dispute protocol crate; its `prototypes/` are separate research records. |
| [`test/`](test/README.md) | Cross-application JavaScript, browser and integration checks. |
| [`tools/`](tools/README.md) | Build, inspection, preview and evidence utilities by purpose. |
| `container/` | Managed Linux environment definition and orchestration support. |
| `examples/` | Small protocol usage examples. |

`Cargo.toml` and `Cargo.lock` own all five public Rust packages. The explicitly
private service implementation in `private-source/code/server/` has its own
approved workspace; it is not an input to public builds or publication.

Run project commands through `dev.ps1` / `dev.sh` in the documented managed
container. `setup.sh` provisions dependencies. Generated build inputs and caches
belong to the managed build tree; ignored local evidence and previous exports
are retained data, not source directories to reorganize.

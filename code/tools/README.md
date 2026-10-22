# Tool ownership

Run commands from `code/` inside the managed Linux container unless a helper
explicitly documents Windows orchestration. The package scripts and `dev.sh`
are the normal entry points.

| Directory | Purpose |
| --- | --- |
| `build/` | WASM/web/Android preparation, asset catalogs, packaging, notices and package inspection. |
| `device/` | Device preflight and bounded USB transport source. |
| `evidence/` | Requester sessions, demo export, enrollment inspection and camera-offer staging. |
| `preview/` | Read-only developer, participant and simulator preview servers. |
| `provision/` | Pinned model/trust preparation, GNSS reference instructions and GPU probe source. |
| `test/` | Test prerequisite catalog and group runner. |

Examples:

```sh
node tools/build/build-web.mjs
node tools/preview/serve.mjs
node tools/test/run-tests.mjs javascript
bash tools/build/build-android.sh developer
```

Keep new utilities with their owning operation. Build helpers may share reviewed
package inspectors; device operations must retain their existing focus, identity
and transport guards. Do not add root-level compatibility copies of moved tools.

The Windows USB authorization remains tied to the existing
`private-source/code/tools/usb-device.ps1` and its verified native ADB files.
Moving the public transport source into `device/` does not relocate or authorize
execution of that public copy. The original private transport stays in place.
Disabled Windows build/verification wrappers remain explicit instructions to use
Linux; they are not alternate host build paths.

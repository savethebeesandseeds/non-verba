# Local analysis runtime

The native adapter calls a separately provisioned, fixed loopback llama.cpp
server. It launches no process, downloads nothing, reads no signing vault and
dispatches no tool/model action. The Assignment verifier remains a separate
library. A runtime or model declaration is never payment authority.

The supported API source pin is
`14a9d09f75683c94c2c4f229efe54670d4209089`. The adapter checks exact local server
binary and GGUF SHA-256 values, the server's reported build/template/model path,
one slot and the requested context size. The backend, thread count, CUDA device
and layer offload (when selected), offline mode and disabled context shifting are
administrator setup requirements;
server properties do not independently prove those process settings. Hashing a
local file and receiving a server claim do not prove that those bytes were loaded
or that inference was honest. Every completion keeps `execution_attested:false`.

Source inspection used the pinned [official server API](https://github.com/ggml-org/llama.cpp/blob/14a9d09f75683c94c2c4f229efe54670d4209089/tools/server/README.md),
the [official grammar documentation](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md),
and the [candidate model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507).
At the initial DP-1 checkpoint Qwen had not been downloaded. The separate
resource handoff subsequently provisioned SmolLM2-135M-Instruct
Q4_K_M for a CPU plumbing probe; it is not an adopted dispute resolver.

## Runtime and model availability

Runtime binaries, model weights and administrator resource manifests are not
included in the source repository. Consult
[container development](../../docs/development/CONTAINER_PLAN.md) before
provisioning a runtime or model. Existing local checkouts migrating from the
former private repository use the
[container migration bridge](../../docs/development/CONTAINER_MIGRATION.md).
Models retain their own licenses; publishing this companion under AGPL does not
relicense their weights or adopt them as reliable dispute resolvers.

The optional dependency-only model setup entry point, when deliberately selected,
verifies or downloads the pinned evaluation model and exits without starting
inference. For example, from the repository root:

```powershell
./code/dev.ps1 -Action Exec -Command @('bash','setup.sh','--model-only','qwen3-4b-instruct-2507-q4-k-m')
```

Setup alone establishes artifact availability, not useful analysis. Never infer
availability from an old capture or assume that a contributor has installed a
model. Ordinary deterministic tests require no actual model and download no
weights.

The retained [historical version-1 failure](tests/fixtures/historical-v1/README.md)
used a small SmolLM2 CPU model on synthetic contract/evidence. Both the adapter
probe and the pipeline's evidence stage reached the 2,048-token output cap with
unfinished JSON and were rejected as `TRUNCATED_RESPONSE`. The comparison stage
did not run. The minimal published fixture retains the exact failed portable
record and its specification/trust bytes, not the runtime logs or resource
handoff. Replay validates a retained failure; it neither reruns a model nor
establishes model quality.

`development_spec(dictionary_hash, requester_profile_hash, operator_profile_hash)`
creates a valid editable unavailable specification. Actual build/model/template
hashes are `null`, not placeholders. Adopting a provisioned model creates a new
exact specification/context requiring the applicable review and endorsements.
Mock execution is explicitly `MOCK`, has no measured model token usage, and
cannot become real execution by relabeling a saved report. An actual independent
rerun must be recorded as a new attempt.

## Exact supported specification versions

Version 1 retains its original CPU profile, prompt bytes, single schema, field
serialization and artifact-directory scope. Historical signed specifications are
not rewritten. `development_spec_v2(...)` creates a separate draft with version 2
and a required `v2` profile. That profile pins
`nv-reasoning-projection-v2` and the byte hashes of the two stage schema files.
The top-level output-schema hash pins the canonical object containing both
schemas. The evidence and comparison prompts are separately hashed as before.
Unknown versions, mixed version/profile fields and mismatched schema hashes fail.

Version 3 is a disclosed engineering iteration constructed with
`development_spec_v3(...)`. It uses separate v3 prompt/schema files and
`nv-reasoning-projection-v3`; the existing `v2` profile object retains its wire
name, with exact version 3 hashes required. Version 2 remains available with its
frozen byte pins for replay. Merely changing a version number fails validation.
The v3 schemas bound citation strings; source membership is still checked by the
ordinary validator. No citation enum is heuristically extracted from model text.
The v3 analysis profile admits only citation IDs matching `[A-Za-z0-9_:-]{1,64}`;
unsupported IDs reject analysis before any model call, preserving the full case
and core financial report without silently dropping source items or narrowing core IDs.

Versions 4 and 5 are further explicit experimental drafts, with separately pinned
prompts, stage schemas and projection versions. V4 permits empty unresolved-reason
lists when the evidence supports a settled observation and raises prose fields to
320 bytes; it retains the 2,048-token output cap. V5 also checks that each comparison
reports the exact Requester and Operator allocation for that dimension. Neither
check validates the meaning or fairness of the model's explanation. Citation-ID
admission bounds remain as in v3. Earlier versions and signed results remain
available unchanged; selecting a new version is never a silent upgrade.

Versions 2 through 5 support CPU or explicit CUDA. CUDA requires `backend:"cuda"` and
`v2.cuda:{"device":"CUDA0","n_gpu_layers":99}` (the layer count is an explicit
1–999 integer, not an inferred setting). CPU requires `v2.cuda:null`.
The administrator must launch the matching device/offload settings. `/props`
does not establish those settings or attest GPU execution. The runtime report
continues to distinguish observed hashes and server claims from attestation.
Changing any version, prompt, schema, backend, device, layer count or model pin
requires a new exact specification and applicable context endorsements.

## Administrator prerequisite for an opt-in run

Use the existing managed Debian container; do not start another container,
publish another host port, download weights automatically or install a Windows
toolchain. Model acceptance has not been performed here. For any new resource
profile an administrator must supply independently obtained runtime/model artifacts
and record their actual hashes and conversion/quantization provenance. Version 1
supports only Q4_K_M, an embedded tokenizer pinned by the complete GGUF, no LoRA
adapters, and the fixed compiled prompts/schema. Other profiles fail closed.

The original CPU model directories are `/opt/nonverba-models`,
`/opt/nonverba-tools/models` and `/opt/nonverba-build/models`, with a `.gguf` file.
Versions 2 and 3 also admit `/usr/local/share/nonverba/models`. The CPU Linux ELF
`llama-server` must be under `/opt/nonverba-tools/llama.cpp` or
`/opt/nonverba-tools/llama-cpp`. A CUDA specification requires the server directly
under `/usr/local/lib/nonverba/llama.cpp/14a9d09f75683c94c2c4f229efe54670d4209089/build-cuda/bin`.
CPU/CUDA path substitution is rejected before contacting the server. Canonical
paths are checked again; parent traversal
and escaping symlinks fail. Neither path nor endpoint comes from a case, model
response or signed participant input. Administrative configuration has exactly
`endpoint`, `model_path`, `server_binary_path`; default endpoint is
`127.0.0.1:8087` inside Debian. Other numeric loopback addresses are administrator
choices, never server redirects or DNS targets.

The separately managed server must use the pinned build, exact model/template,
one slot, fixed backend/device/offload/thread settings, explicit context/output limits, offline
mode, disabled context shifting, and no external tool/MCP/media-file integrations.
Keep server and analysis processes away from signing keys, private participant
vaults and payment capabilities using deployment permissions. The adapter's path
allowlist prevents its own arbitrary file reads; loopback and an environment flag
are not OS isolation against another process with the same privileges. This
increment does not claim that such deployment isolation has been provisioned.

## Request and result bounds

The adapter first validates the specification and local artifact hashes, then
checks `/props`. It formats the full system/user conversation via
`/apply-template` and tokenizes that complete formatted prompt via `/tokenize`.
The pinned server parser defaults `add_generation_prompt` to `true`
(`tools/server/server-common.cpp:1274`). A metadata-only check against the running
approved SmolLM2 GPU server confirmed that omitted and explicit `true` give the
same prompt ending in `<|im_start|>assistant\n`. The model declares
`tokenizer.ggml.add_bos_token:false`; tokenizing that prompt with `add_special`
true or false produced identical token arrays. No framing change or extra
inference was needed to establish these observations.
Each stage independently repeats this admission, including the second stage's
first interpretation and profiles. It reserves output capacity before requesting `/completion` with those exact
token IDs. Thus template overhead is counted and not added again after admission.
An extra context slot is conservatively reserved. Oversized cases fail before
generation, with no truncation, context shift or automatic staging.

Development hypotheses are 8,192 context tokens, at most 6,144 input and 2,048
output tokens, a 512 KiB prompt, 64 KiB output text and a 120-second total deadline.
Version 1 uses its original shared output schema; versions 2 through 5 select the pinned
evidence or comparison schema for that call. The JSON schema uses a deliberately small subset of objects, arrays, primitives,
enum, bounds and required fields. It describes output structure in both prompts;
the ordinary pipeline validator independently rejects unsupported fields,
fabricated references, wrong dimensions and authority. JSON syntax is not reasoning
validity. The application validator also applies UTF-8 byte limits, which can be
stricter than a grammar's character counts.

There is one active call per backend with no queue or automatic retry. Wall-clock
timeout/cancellation is checked during hashing and between short socket polls.
Closing a request rejects late local output; it does not prove the server stopped
CPU or GPU work immediately. Generation still has a bounded token cap. HTTP is a narrow
nonstreaming profile: Content-Length and JSON required; redirects, chunking and
compression are refused. Completion responses must report a complete stop,
no truncation, exact input-token count and bounded output count. Malformed model
text is retained with its failure rather than promoted to analysis. Post-run
properties are checked again. Prompts/provenance are retained separately from
model-authored fields.

## Testing and explicit smoke command

Run only inside the existing managed container using the project launcher:

```sh
bash /workspace/code/dev.sh exec cargo test --locked --manifest-path disputes/Cargo.toml --test runtime
```

Ordinary tests use scripted responses or an in-process HTTP server with clearly
fake temporary ELF/GGUF headers. These are API/containment tests, not usable model
artifacts or model-quality evidence. The fixture files are removed afterwards.
The real-model test is ignored by default. After provisioning and exact
administrator/specification review, set `NONVERBA_LLAMA_ADMIN_CONFIG` and
`NONVERBA_LLAMA_SPEC` to the corresponding JSON paths inside Debian and explicitly
run:

```sh
bash /workspace/code/dev.sh exec cargo test --locked --manifest-path disputes/Cargo.toml --test runtime real_model_smoke_opt_in -- --ignored --nocapture
```

This smoke test does not launch/install the server. It prints a serialized raw
completion and execution observations, not a settlement or quality assessment.
Do not pass sensitive real evidence to the synthetic smoke case. No real-model
quality or fairness result is claimed by passing deterministic tests.

The native Rust example provides a bounded CPU driver. Its administrative resource
and capture paths are explicit. To verify current files without starting any
subprocess or writing any capture, use `--check` instead of
`--run --capture-root ...`. To explicitly run new inference:

```sh
bash /workspace/code/dev.sh exec cargo run --offline --locked --manifest-path disputes/Cargo.toml --example real_smoke -- \
  --resources /absolute/administrator/resources.json \
  --pins /absolute/administrator/runtime-pins.json \
  --run --capture-root /existing/absolute/capture-directory
```

It verifies the handed-off GGUF, server, adjacent runtime libraries, source archive
and conversion-card hashes; compiles the ignored `real_local` test offline; starts
one temporary CPU server on container loopback; and stops only that owned child
using Rust's `Child::kill` and waits for it to exit. `--help` and missing opt-in
start no process, read no resource and create no capture. Each `--run` invocation
creates a new capture directory under the explicit existing capture root. It
never overwrites or retries an earlier attempt. The test signs a new synthetic context after installing actual
pins, using existing deterministic fixture keys in memory. It does not change any
previously signed context or read real participant keys.

One direct adapter probe and one `SINGLE` pipeline schedule use the first fixed
seed, 17. The second pipeline stage runs only if the first stage is accepted.
Both probes retain raw failures; the test exits unsuccessfully if either direct
inference or the complete two-stage analysis fails. Inspection, portable export,
replay and the unchanged contractual bundle/projection are checked independently
of model success. A schema rejection or output cap is an observed failed attempt,
never evidence of a successful two-pass analysis. Only synthetic data is used.


DP-2 extends that same native example with the separately declared GPU experiment:

```sh
bash /workspace/code/dev.sh exec cargo run --release --offline --locked --manifest-path disputes/Cargo.toml --example real_smoke -- \
  --demo-dp2 --spec-version 5 --model qwen --run-in /existing/empty/capture-directory
```

This is an explicit new execution, not replay. It requires the exact already
approved model and GPU binary, creates eight fresh synthetic contexts, records
the plan before generation, retains every attempt, and stops only its own
loopback server. No installation or container lifecycle operation is performed.
The capture directory must already exist and be empty. Output uses create-new
files, buffered writes and an explicit flush/sync; existing captures are never
overwritten. A successful driver exit means the declared schedule was retained
with an unchanged core, **not** that model analysis succeeded or was useful.
This workflow has no completed independent evaluation establishing useful reasoning or fairness.

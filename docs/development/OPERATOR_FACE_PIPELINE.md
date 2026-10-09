# Operator face enrollment and comparison

The isolated browser registration and authentication workflows share a selected
local face pipeline. Operator registration enrolls an account-bound reference;
recurring Operator authentication compares a fresh capture with the current
reference. Requester registration and authentication have no face steps and do
not instantiate the model or biometric store. Existing developer tools remain
directly accessible.

This is an experimental continuity check. It does not verify the enrolled
person's legal identity, establish liveness or trusted capture, authenticate a
real account, clock anyone in, or authorize work sensors. Every inspection result
keeps genuine authentication, verified presence and work authority false, even
when features match. Read the [owner's model selection and evidence review](../notes/sensors/OPEN_FACE_AUTHENTICATION_RESEARCH.md),
[registration roadmap](REGISTRATION_PIPELINES.md) and
[work privacy requirements](AUTHENTICATION_AND_WORK_PRIVACY.md) alongside this
implementation record.

## Selected and pinned pipeline

Use [Qualcomm MobileFaceNet](https://huggingface.co/qualcomm/MobileFaceNet), sourced
from foamliu's `weights/mobilefacenet.pt`. This is the 128D checkpoint, distinct
from InsightFace's 512D MobileFaceNet weights. The
[source model lock](../../code/models/mobilefacenet/model-lock.json),
[shared browser profile](../../web/src/face-model-spec.js) and
[Rust policy profile](../../code/crates/nonverba-core/src/face_identity.rs) bind
enrollment and comparison to the same version. Changing preprocessing,
alignment, aggregation, weights or runtime requires a new compatible profile;
existing references cannot silently migrate to a different encoder.

| Item | Selected value |
| --- | --- |
| Profile | `operator-face-mobilefacenet128-qaihub064-v1` |
| foamliu source revision | `a6cc9032a659b615f477833e1a70b5e7931bcccc` |
| Source checkpoint SHA-256 | `90a00ba1d8b0b688af3deb731ed53dca582e6106805d1bc3cfdef55f570493f4` |
| Reviewed Qualcomm wrapper revision | `a586a230c9a21cc355c6dd0995fa249d156da175` |
| Qualcomm v0.64.0 tag revision | `53af617346c1a9c51c0cdf9d05540946d02741e5` |
| Publisher ONNX release | Qualcomm `mobile_facenet` v0.64.0, float export |
| Standalone encoder SHA-256 | `1efc0e9098b219466bb54c82a971e08da11e29267aee6f7f9c1fd13274b7f7ec` |
| Encoder interface | Two float32 inputs, `img1` and `img2`, each `[1,3,112,112]`; `embeddings` output `[2,128]` |
| Runtime | ONNX Runtime Web 1.23.2, CPU WASM, one thread, float32 |
| Separate detector | OpenCV YuNet `face_detection_yunet_2023mar.onnx`, with pinned local 320×320 contract |
| Alignment | Five landmarks, similarity transform, bilinear resampling to 112×112 |
| Comparison | L2-normalized 128D features, cosine similarity; threshold defaults to unset |

The standalone export deterministically inlines the publisher's external tensor
data. The lock records the source archive, graph, data, derived encoder, detector,
runtime modules and license notices with exact sizes and digests. Build staging
checks those artifacts and the browser checks the pinned manifest and asset
digests before creating inference sessions. Assets are served from the local
inspection origin; no inference or biometric upload service is called.

Aligned encoder input is RGB, NCHW float32 in **[0,1]**. The published graph owns
the ImageNet mean `[0.485,0.456,0.406]` and standard deviation
`[0.229,0.224,0.225]` normalization. Do not normalize again in the adapter or
substitute a [-1,1] input recipe. The graph sums each image's original and
horizontal-flip features. The single-image adapter supplies the same crop to
both inputs, selects the first output row, then performs one L2 normalization.
This avoids mixing two people in one representation. Paired-versus-duplicated
input parity is a required export check, separate from biometric accuracy.

Detection and alignment are separate from MobileFaceNet. The adapter supplies
raw BGR to a 320×320 YuNet input using aspect-preserving resize and top-left
letterboxing. It decodes scores at 0.8 and uses NMS at 0.3. Zero faces and multiple
surviving faces are rejected; it never chooses the largest face to enroll.
Landmark bounds, face size, eye geometry and alignment residual checks reject
malformed acquisition. These are engineering checks with uncalibrated limits,
not a liveness or presentation-attack detector.

## Deliberate capture and separate reference retention

Operators have six registration steps: personal details, accessibility,
certifications, privacy, face enrollment and final review. Requesters have five,
omitting face enrollment. All ordinary form details stay in page memory and
remain self-reported. The Operator face step uses the existing bounded
authentication camera workflow; entering that step does not start a camera.

After explicit processing consent and **Start camera**, a temporary operation
permits only camera use on the initiating device. Its illustrative lease is
30 seconds. Microphone, location and work sensing remain blocked. Capture closes
the camera and revokes its authority before inference. Completion, cancellation,
expiry, failure, a newer privacy decision or lifecycle loss stops the operation;
late results cannot reopen it. Enrollment can run while on hold, clocked out or
signed out under this same deliberate exception. It never resumes work.

A quality-accepted capture supplies a transient feature vector. Retention needs
its own review, explicit consent and **Enroll** action. The stored reference
contains the account/principal binding, enrollment device and operation, time,
model profile, simulation marker and 128D features. It contains no photograph.
The [local store](../../web/src/face-reference-store.js) encrypts that record with
AES-256-GCM and a per-record non-extractable WebCrypto key; the binding is
authenticated as additional data. The IndexedDB envelope contains only the
reference ID, key, IV and ciphertext. Review summaries and public profile
candidates expose no feature vector.

An existing compatible reference can be reused during local registration.
Replacement requires a fresh reviewed capture and an explicit **Replace**
action. Replacement and deletion check the expected current reference ID in the
same transaction, so another tab's enrollment is not overwritten or deleted by
a stale operation. An unreadable reference fails closed and can be deliberately
replaced or deleted through its envelope ID. No automatic recovery accepts it.
If the retained ID changed after the displayed review, deletion requires another
deliberate action on the newly shown reference; replacement requires reviewing
and capturing again. A pending lookup cannot adopt a newer operation.

Transient cleanup and retained-reference deletion are different promises.
Cancel/reset/reload clears the draft and transient capture; it preserves an
already committed reference selected for retention. Cancellation before a
retention transaction commits aborts the pending write. Deleting a reference
requires its own action and invalidates affected registration review. The
workflow fences delayed inference, policy replies and reference changes against
the current account, device, operation, authentication epoch and privacy revision.

Device-local encryption is a limited storage boundary. The encrypted record and
its usable key live under the same browser origin. A compromised origin can use
that key, and browser data clearing or device loss can destroy the reference.
This is not a protected server account vault, cross-device synchronization,
backup, secure enclave or a promise to erase all browser/process memory. The
inspection uses synthetic account IDs; it has no trusted account credential to
establish who controls them.

## Truthful outcomes and unresolved assurance

Missing reference, wrong account, incompatible profile, unavailable model,
invalid acquisition, missing threshold and nonmatching features remain explicit
outcomes. Synthetic capture has no genuine face pixels and cannot create a real
embedding or authenticate a person. Requester core calls return a face-not-required
outcome without enrollment or comparison. No failure or match changes hold,
clock-out, sign-out or any work sensor grant.

The threshold is intentionally unset. An entered value is an **uncalibrated
evaluation threshold**; matching at it is not a production authentication claim.
Low false-match performance, acquisition failures, demographic and capture
conditions, aging references and deliberate attacks require an evaluation of this
exact complete pipeline. The upstream 99.48% LFW result and 82.55% MegaFace row
do not establish that operating point. The MegaFace protocol/FAR is unspecified
in that row; the supplied LFW script chooses and tests its threshold on the same
6,000 pairs. Do not transfer the original paper's stronger result or another
model's benchmark to these selected artifacts. See the
[research evidence and its limits](../notes/sensors/OPEN_FACE_AUTHENTICATION_RESEARCH.md#concrete-artifacts-sizes-and-licensing).

Still missing before actual-app use:

- Real account creation, credential authentication, verified contact ownership,
  Google/OAuth linking, recovery and trusted account/reference binding.
- Device enrollment, account access from another device, key/session revocation,
  synchronization and confirmed account-wide work privacy enforcement.
- Registration legal identity and certification verification, each with its own
  evidence, review, appeal and retention policy.
- Calibrated face thresholds, presentation-attack/liveness checks, trusted capture
  and an explicit policy combining those inputs with account credentials.
- Measured end-to-end latency, RAM and battery on representative older phones.
  Published encoder or NPU timings do not include this CPU browser pipeline's
  capture, detection, alignment, inference and assurance work.
- Product biometric storage, retention periods, deletion across devices,
  recovery, access controls and training-data/license review before distribution.

## Dependency preparation and focused checks

Run dependency preparation, builds and tests only in the documented managed
Linux container. The preparation tool uses the dedicated existing-tools cache:

```text
/opt/nonverba-tools/models/mobilefacenet/foamliu-a6cc9032-qaihub-v0.64.0-ort1.23.2/
```

```sh
node tools/prepare-face-model.mjs --download
node tools/prepare-face-model.mjs --verify
node --run test:operator-face
node --run test:model:operator-face
node --run test:browser:operator-face
```

`--download` is an explicit dependency preparation step, not a browser or build
side effect. It verifies existing files and publishes only missing, digest-checked
artifacts in the dedicated cache. It does not overwrite unknown existing files.
The web build stages only the verified browser bundle; absent assets leave the
UI usable with face inference unavailable. Native Android staging excludes the
browser face bundle; this change provides no native phone adapter or APK result.

Policy and adapter checks cover role separation, account/model binding, unset
thresholds, no genuine assurance/work grant, cleanup, delayed replies and
reference races. Model-dependent browser checks use the actual compiled Rust
Worker and CPU runtime with synthetic image/features. They establish interface,
parity, fail-closed and storage behavior; they are not biometric accuracy,
physical camera shutdown or real-person authentication tests. Executed checks
belong in [validation](VALIDATION.md).

## Third-party provenance

The Qualcomm model card declares Apache-2.0 for the selected MobileFaceNet model;
that declaration does not by itself clear all upstream implementation or
training-data rights. YuNet's model directory has its own MIT license, separate
from OpenCV's detector decoding implementation. ONNX Runtime Web is MIT. Exact
artifact provenance and copied distribution notices are recorded in the model
lock and [third-party notices](../../THIRD_PARTY_NOTICES.md). A published license
statement is evidence, not a completed license or biometric-data audit.

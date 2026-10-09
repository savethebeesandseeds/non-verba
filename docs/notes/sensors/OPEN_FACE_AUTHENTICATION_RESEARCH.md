# Open face embeddings for authentication research

Research snapshot: 9 October 2026.

Status: published-evidence review with an owner-requested model selection for
Operator registration and authentication on 9 October 2026. Thresholds and
complete-system reliability remain to be evaluated. No models were downloaded,
executed or tested on a phone for this review.

Read alongside the agreed
[authentication and work privacy requirements](../../development/AUTHENTICATION_AND_WORK_PRIVACY.md)
and the [private video embedding discussion](PRIVATE_VIDEO_EMBEDDING_VALIDATION.md).
Recurring account authentication, registration identity verification and
authorization remain separate. The owner requests face checks in both Operator
pipelines and explicitly excludes face checks from Requester registration and
authentication.

## Selected model and integration scope

Select [Qualcomm MobileFaceNet](https://huggingface.co/qualcomm/MobileFaceNet),
sourced from foamliu's
[`weights/mobilefacenet.pt`](https://github.com/foamliu/MobileFaceNet/blob/master/weights/mobilefacenet.pt).
The published model has about 1M parameters, about 4 MB of weights, aligned
112×112 RGB input and a 128-dimensional face representation. Its model card
declares Apache-2.0. This choice favors a small on-device deployment with a
concrete published checkpoint and license declaration; it does not establish
production authentication accuracy or complete training-data clearance.

Use this exact model family and source checkpoint for both Operator steps:

- Registration captures a face, enrolls a reference and binds it to the Operator
  account under the registration privacy and consent flow. Enrollment alone
  establishes a reference for later continuity checks; it does not verify a
  claimed legal identity without a separate trusted identity process.
- Recurring authentication compares a fresh Operator capture with that enrolled
  reference. Keep the account credential, face match, liveness and capture
  integrity results distinct. Authentication does not resume work or authorize
  work sensors.
- Requester registration and authentication require no face capture, enrollment
  or face comparison.

Pin the retrieved weight digest, exported artifact, runtime and preprocessing
before use. Detection, alignment, normalization and any original/flip or
multi-frame aggregation must agree between enrollment and comparison. Compare
L2-normalized face features using cosine similarity and calibrate a threshold
for the actual pipeline; do not adopt a demonstration threshold as policy.
Qualcomm's wrapper includes paired original/flip inference, so a single-face
adapter must preserve or explicitly version its aggregation behavior and verify
feature parity with the paired wrapper. The supplied two-input export must not
be treated as an already defined one-image enrollment encoder. Do not
substitute InsightFace's 512D `w600k_mbf.onnx` under the same MobileFaceNet name.

Add the selected model adapter and required Operator-only steps within the
existing isolated registration/authentication implementation. Missing references,
unavailable inference, failed capture and unresolved liveness must retain
truthful pending or failure states. Reference retention, replacement and deletion
need explicit handling distinct from transient capture cleanup. The selected
encoder does not supply a face detector, liveness detector or trusted camera
path; those remain separate integration and evaluation work.

## Findings

Dedicated face embeddings are credible candidates for one-to-one comparison
against a trusted enrolled reference. Published research configurations accept
roughly 95–98% of genuine IJB-C template comparisons at a false-match operating
point of one in 10,000. Stricter thresholds reduce genuine acceptance. These
results support a prototype comparison; they do not establish a production
authentication system or the accuracy of an arbitrary port with the same name.

Model choice must specify architecture, training data, actual weights,
preprocessing, aggregation, precision and runtime. An ArcFace training loss is
not a uniquely identified downloadable model. Storage size is not runtime RAM.
Face matching, presentation-attack detection and trusted capture are distinct
parts of the system.

## Reading the reliability numbers

False match rate (FMR, often called FAR in papers) counts acceptance of
nonmatching identities. True accept rate (TAR) counts accepted genuine
comparisons; false non-match rate is its complement for that comparison
protocol. Acquisition failures and complete authentication rejection require
separate reporting. A threshold producing FAR 10^-4 on a benchmark is not a
universal one-in-10,000 probability that a deliberate attacker succeeds.

LFW's aggregate pair-verification accuracy is a useful regression check, but
does not establish the desired low-FMR operating point. NIST evaluates
verification separately across capture conditions, elapsed time and demographic
groups. Its results cannot be assigned to an open checkpoint without a verified
mapping to the submitted binary. No such mapping was established for the
specific artifacts reviewed here. See [NIST FRTE 1:1](https://pages.nist.gov/frvt/html/frvt11.html).

## Published verification evidence

These are author-reported research configurations. Percentages describe genuine
acceptance at the stated false-match rate, not overall authentication accuracy.

| Evaluated configuration | IJB-C TAR at FAR 10^-4 | TAR at FAR 10^-5 |
| --- | --- | --- |
| ArcFace MobileFaceNet, Glint360K | 95.04% | 92.62% |
| ArcFace R50, Glint360K | 97.16% | 95.81% |
| ArcFace R100, Glint360K | 97.55% | 96.38% |
| AdaFace R18, WebFace4M | 94.99% | Not supplied in the checkpoint table |
| AdaFace R50, WebFace4M | 96.98% | Not supplied in the checkpoint table |
| AdaFace R100, WebFace12M | 97.66% | Not supplied in the checkpoint table |

Sources: [official ArcFace training results](https://github.com/deepinsight/insightface/tree/master/recognition/arcface_torch#performance-on-ijb-c-and-iccv2021-mfr)
and [official AdaFace results](https://github.com/mk-minchul/AdaFace#mixed-quality-scenario-ijbb-ijbc-dataset).
The ArcFace table also reports MobileFaceNet/MS1MV2 at 93.61% and 90.28%, showing
that the architecture name alone does not fix reliability.

IJB-C compares templates that can contain multiple photographs and video
frames. AdaFace's supplied evaluation uses precomputed facial landmarks and
horizontal-flip inference before template aggregation. Its legacy input is
aligned 112×112 BGR, whereas the current CVLFace examples use RGB. Do not relabel
these results as single-selfie acceptance or assume conversion preserves them.
See the [AdaFace evaluation implementation](https://github.com/mk-minchul/AdaFace/blob/master/validation_mixed/validate_IJB_BC.py).

Two additional research references are relevant. Plain MagFace reports IJB-C
TAR 95.81% at 10^-4 and 89.26% at 10^-6; its quality-weighted MagFace+ aggregation
reports 95.97% and 90.24%. Available LVFace-T/Glint360K weights report 96.67% at
10^-4 and 88.53% at 10^-6. Stronger paper configurations must not be attributed
to other released weights. See [MagFace, Table 2](https://arxiv.org/pdf/2103.06627)
and the [LVFace model table](https://github.com/bytedance/LVFace#lvface-pretrained-models).
These remain optional larger-model comparisons.

## Concrete artifacts, sizes and licensing

| Candidate artifact | Published weight or pack size | Face input and embedding | Published licensing boundary |
| --- | --- | --- | --- |
| Qualcomm MobileFaceNet, sourced from foamliu `mobilefacenet.pt` | About 4 MB; about 1M parameters | 112×112 RGB; 128D | Model card declares Apache-2.0; training-data rights are a separate dependency |
| OpenCV `face_recognition_sface_2021dec.onnx` | 38,696,353 bytes, about 38.7 MB | Aligned 112×112; 128D | All files in its model directory are declared Apache-2.0 |
| OpenCV SFace `2021dec_int8.onnx` | 9,896,933 bytes, about 9.9 MB | Same face interface | Same directory declaration |
| OpenCV SFace `2021dec_int8bq.onnx` | 10,667,852 bytes, about 10.7 MB | Same face interface | Same directory declaration |
| InsightFace `buffalo_sc`, `w600k_mbf.onnx` | 16 MB for the detector/recognizer pack; individual recognizer size unverified here | 112×112 RGB; 512D | Supplied pretrained weights are non-commercial research only |
| Current author CVLFace AdaFace IR18/WebFace4M | 24M rounded parameters; F32 safetensors about 96.2 MB | 112×112 RGB; 512D | Card refers to the training-dataset license |
| Current author CVLFace AdaFace IR50/WebFace4M | 43.6M rounded parameters; about 175 MB | Same | Same licensing dependency |

Sources: [Qualcomm model card](https://huggingface.co/qualcomm/MobileFaceNet),
[SFace model directory](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface),
[InsightFace model inventory](https://github.com/deepinsight/insightface/blob/master/python-package/docs/model_zoo.md),
and current author AdaFace [IR18 files](https://huggingface.co/minchul/cvlface_adaface_ir18_webface4m/tree/main)
and [IR50 files](https://huggingface.co/minchul/cvlface_adaface_ir50_webface4m/tree/main).

The current CVLFace files are not the original AdaFace Google Drive checkpoints;
their sizes and RGB interface must remain separately identified. Likewise,
Qualcomm's 128D MobileFaceNet checkpoint is not the InsightFace/Glint360K model
from the verification table. Its card reports LFW accuracy, without supplying
corresponding low-FAR verification evidence. The 4 MB figure does not apply to
every implementation called MobileFaceNet.

A follow-up source review found that the upstream foamliu implementation
reports 99.48% LFW and 82.55% MegaFace, compared with 99.55% and 92.59% in its
original-paper row. Its README does not identify the MegaFace operating point
or protocol; do not label 82.55% as TAR at a particular FAR, or transfer the
paper model's stronger results to the selected checkpoint. The result row links
an upstream scripted release; parity with the selected source/export artifacts
has not been independently verified. See the
[upstream performance table](https://github.com/foamliu/MobileFaceNet#performance).

The supplied upstream
[LFW evaluation script](https://github.com/foamliu/MobileFaceNet/blob/master/lfw_eval.py)
selects a threshold minimizing errors across all 6,000 pairs and reports
accuracy on those same pairs. This is weaker evidence than a held-out threshold
evaluation, and does not establish low-FMR performance. The selected model is
therefore an experimental deployment choice based on size, available exports
and mobile profiles; this review has not demonstrated an authentication-quality
advantage over SFace or the larger accuracy references.

InsightFace code is MIT, but its supplied model and training-data restrictions
remain non-commercial research. Its published licensing path permits obtaining
separate commercial terms. This review does not initiate that process. See the
[current license statement](https://github.com/deepinsight/insightface#license).

AuraFace-v1 is another explicitly Apache-2.0 published alternative. Its card
reports 99.65% LFW and 90.93% CPLFW accuracy, but no IJB-C low-FAR table. Its
ResNet100 architecture is a larger baseline rather than the first small-phone
candidate. See the [publisher's model card](https://huggingface.co/fal/AuraFace-v1).
Published license statements are recorded as evidence, not a completed audit of
every training-data and bundled detector dependency.

## Older-device and runtime evidence

| Published configuration | Processing result | Scope |
| --- | --- | --- |
| Original MobileFaceNet, CASIA-trained 112×112 architecture, 0.99M parameters; Snapdragon 820 CPU, four threads, NCNN | 24 ms | Historical encoder measurement; no capture, detection or PAD |
| Qualcomm MobileFaceNet; Snapdragon 8 Gen 1 NPU, ONNX float | 1.478 ms | Current chipset profile, two faces with original/flip augmentation |
| Same Qualcomm profile, w8a16 | 1.09 ms | Quantized profile; authentication error rates still require measurement |
| OpenCV SFace FP32 / INT8; Raspberry Pi 4B CPU | 68.82 / 87.42 ms | Board benchmark including preprocessing and postprocessing; not a phone estimate |

Sources: [MobileFaceNets, Tables 2–4](https://arxiv.org/pdf/1804.07573),
[Qualcomm current profile table](https://huggingface.co/qualcomm/MobileFaceNet#performance-summary),
and [OpenCV benchmark](https://github.com/opencv/opencv_zoo/blob/main/benchmark/README.md#raspberry-pi-4b).

The original paper's 18 ms result belongs to a 96×96 variant. Its 24 ms table
times the CASIA-trained configuration; the stronger accuracy uses MS-Celeb-1M
training. Treat the latency as historical architecture evidence, not a timing
verified for identical benchmark weights. Its 4 MB model
reports 92.59% TAR at FAR 10^-6 on refined MegaFace's large protocol; that is a
different dataset and model from the IJB-C table. Qualcomm's
[wrapper](https://github.com/qualcomm/ai-hub-models/blob/main/src/qai_hub_models/models/mobile_facenet/model.py)
runs four backbone evaluations per pair. Do not divide its timing by four to
claim measured single-face latency. Its exported bundle bytes and complete app
RAM were not verified here. INT8 storage can also be slower on a particular CPU,
as the SFace board result demonstrates.

An independent app author's [iPhone 13 Pro suite](https://github.com/beomwookang/ios-face-recognition-suite#benchmarks-iphone-13-pro-fp16)
reports 6.1 ms for detection, alignment and recognition using CoreML/ANE, with
100 iterations and five warmups. The timing section specifies FP16; its 13.3 MB
MobileFaceNet figure is FP32 source storage. The exact converted weight file was
not verified against a publisher checkpoint, so this is supporting feasibility
evidence rather than a reproducible artifact recommendation. No comparable
author-validated AdaFace phone profile was found.

## Authentication properties beyond a face match

As a reference profile, current NIST guidance combines biometrics with a
physical authenticator and an alternative non-biometric route. It specifies
fixed-threshold zero-effort FMR at most 10^-4 across demographic groups,
recommends FNMR below 5%, and requires facial presentation-attack detection.
It also treats sensor/endpoint integrity and injection attacks separately.
These reference values are not adopted Non-verba thresholds. See
[SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html#use-of-biometrics).

Platform biometrics/passkeys can locally authorize use of an account credential.
WebAuthn user verification can also use a PIN or multiple enrolled biometrics;
it does not concretely identify the natural person. Therefore, it does not
automatically satisfy the separate expected-Operator presence check. See
[WebAuthn user verification](https://www.w3.org/TR/webauthn-3/#user-verification).

InsightFace now offers a separate RGB liveness addon, whose threshold and crop
gate are explicitly integration defaults rather than accuracy guarantees. It
accepts a supplied image. No independent PAD result for its exact released
checkpoint was established in the checked sources. See the
[addon documentation](https://github.com/deepinsight/insightface/blob/master/python-package/docs/liveness.md).
NIST's 2023 evaluation of 82 passive software PAD algorithms found none detected
all tested attack types; this is dated evidence, not a score for that addon or
every later model. See the [NIST findings](https://www.nist.gov/news-events/news/2023/09/whats-wrong-picture-nist-face-analysis-program-helps-find-answers).

In the proposed private protocol, an untrusted app can reuse an old face vector,
encrypt it again and sign it with a fresh challenge. The response can be fresh
while the face evidence is old. A commitment or proof of correct encrypted
comparison does not prove camera acquisition, correct enrollment or execution
of PAD. Solving these properties remains part of the authentication design.

## Validation plan for the selected model

Evaluate the selected Qualcomm MobileFaceNet artifact first. OpenCV SFace and
pinned AdaFace R18/R50 or ArcFace R50 artifacts can serve as comparison references
where their stated weight terms permit the trial. Keep licensing readiness,
measured matching quality and phone cost as separate results. EmbeddingGemma 2
remains a general-vision baseline without demonstrated face-authentication
accuracy.

1. Establish trusted reference enrollment and its account binding separately
   from recurring authentication. Specify how references are replaced and how
   access is recovered after device loss or appearance changes.
2. Evaluate the complete capture, detection, alignment, quality gate, embedding
   and comparison sequence. Include older and midrange phones, multiple sessions,
   lighting, pose, expression, occlusion and supported accessibility conditions.
3. Select the threshold on development identities, freeze it, and evaluate on
   held-out people and sessions. Report FMR/FNMR, acquisition failures, genuine
   retry burden and confidence intervals by relevant capture/device groups.
   A small pilot cannot establish a rare false-match rate from a few mistakes.
4. Repeat reliability evaluation for the exported and quantized files, including
   single-frame versus quality-controlled multi-frame aggregation. Record file
   digest, input normalization, alignment template, dimensions, runtime/backend,
   latency distribution, startup and memory.
5. Measure PAD and complete-system acceptance of photographs, screen replays,
   masks and synthetic media separately from nonmatching live users. Test camera
   and embedding injection, replay with a new nonce, malformed vectors and model
   substitution under the chosen endpoint trust assumptions.
6. Bind a validated face result to the Operator account, device/session, role,
   policy and intended reuse scope. Preserve the authentication-only camera
   exception, cleanup on capture completion/cancellation/expiry, and stopped work
   state. An auth result must not enable work sensors or resume work implicitly.

The owner has requested that the authentication session add this model to both
Operator pipelines, with no Requester face checks. A measured evaluation and a
documented capture trust design remain necessary before claiming reliable
deployed authentication. This note records the selection and integration scope;
it does not claim that implementation or validation has already completed.

### Implementation follow-up — 9 October 2026

The isolated authentication/registration components now implement the selected
Operator-only enrollment and recurring comparison. Exact model/runtime pins,
single-image aggregation, deliberate encrypted local retention and the unresolved
assurance boundaries are recorded in
[Operator face pipeline](../../development/OPERATOR_FACE_PIPELINE.md). Executed
synthetic policy, preparation and browser checks are recorded in
[development validation](../../development/VALIDATION.md#selected-operator-face-components--9-october-2026).
Those checks establish implementation behavior and export-interface parity;
they do not complete the real-person evaluation or capture trust plan above.

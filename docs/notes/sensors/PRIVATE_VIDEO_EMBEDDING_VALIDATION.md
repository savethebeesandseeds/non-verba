# Compact representations for private video validation research

Recorded: 8 October 2026.

Status: experimental discussion and proposed evaluation. No protocol, model,
cryptographic library, acceptance threshold or automatic consequence is adopted
by these notes.

The owner proposes recording video on the Operator's device and transmitting
embeddings instead of the video, using EmbeddingGemma 2 as an initial candidate.
Cryptographic commitments should fix the validation inputs and rules. The
question should remain private from both the Operator and the Operator's app.
Homomorphic computation is a candidate worth testing.

The owner emphasizes that recordings can be very long and embeddings may provide
a compact way to transmit useful information. The earlier independent-embedding,
dot-product and homomorphic-comparison approaches remain exploratory options.
Representation granularity, validation method and encryption protocol remain open.

The research goal is to reduce transmission while preserving information useful
for private validation questions. Compare representation size with the range and
reliability of validations it supports. Query privacy, correct evaluation and
faithful derivation from a recording remain separate properties.

## Compact representations of long recordings

Treat embeddings as candidate lossy representations for downstream analysis.
Their usefulness does not require reconstructing the original video, but neither
does compact size establish that they preserve every detail a later question may
need. A long recording also needs an explicit coverage and temporal policy.

| Candidate representation | Potential benefit to study | Main tradeoff to test |
| --- | --- | --- |
| A global summary derived from the recording | A small fixed-size overview | Short events and local details may be obscured by aggregation |
| Ordered embeddings for bounded segments | Coverage and localization across a long recording | Payload grows with duration and segment density |
| Summaries at several temporal scales | An overview together with finer event information | Extra storage, overlap and an undecided aggregation method |
| Richer latent or token features | More information for downstream models than one pooled vector | Greater transmission and processing cost |
| A compact index with selective later evidence | Initial transmission can remain small | Retention is required and follow-up requests may leak aspects of the private question |

These are representation candidates, not claims that EmbeddingGemma 2 implements
each route directly. A fixed-size overview of a long recording may require
sampling, chunking or aggregation; those transformations belong in the experiment.
Evaluate which questions remain answerable as well as compression, device cost,
temporal resolution and coverage of brief events. Keep the original-video research
baseline available to identify information lost by the compact representation.
Measure actual transmitted bytes, including metadata and cryptographic overhead,
against the original encoded video. Test several later questions against the same
frozen representation, including held-out question families and different recording
durations. Retain covered and omitted intervals so compact output does not silently
imply complete coverage.

For an illustrative size calculation, one 768-dimensional float32 vector every
five seconds of a one-hour recording gives 720 vectors, or 2,211,840 bytes
(about 2.11 MiB) before metadata and cryptographic overhead. This is a proposed
granularity, not a measured encoding or a claim of adequate event coverage.

## Candidate similarity calculation

Let `Q` be the Requester's private question or expected-event description. Let
`V` be the Operator's video. Use compatible text and vision paths of a pinned
model to produce normalized query vector `q` and ordered visual vectors `v_i`.
Each visual vector represents a frame or a bounded segment under a fixed sampling
policy. For unit vectors, `s_i = dot(q, v_i)` is cosine similarity.

This tests semantic resemblance to a description. It does not produce an answer
to every possible question. For example, matching a description of a repaired
bicycle differs from reading a serial number or proving that a repair succeeded.
A query-conditioned representation `E(V, Q)` also differs from comparing
independently computed `E(V)` and `E(Q)`. Ordinary plaintext inference cannot
consume a question that the app never receives.

[EmbeddingGemma 2](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2)
maps text, images, video and audio into a shared 768-dimensional space. Its text
and vision configuration has 440M parameters; the full configuration adds audio
for 740M. Smaller output vectors save transmission and storage, with a quality
tradeoff that must be evaluated on the selected task.

The 170M vision encoder produces intermediate visual features, not captions or
OCR text. Image-only inputs still pass through the shared 270M backbone, then
the embedding projection, pooling and normalization. Thus the normal image
embedding route is 440M; removing query text does not remove the shared backbone.
See Google's
[architecture guide](https://developers.googleblog.com/embeddinggemma-2-the-developer-guide/).

The Transformers API exposes `get_image_features()` for intermediate features.
Those are not the final shared 768-dimensional embeddings. Running only the
visual front end and sending features for later processing is an experimental
alternative with its own payload, quality and device-cost measurements; it is
not an adopted 170M replacement for the standard image embedding path. Producing
text descriptions would require a separate generative model or trained decoder.
See the
[model API](https://huggingface.co/docs/transformers/en/model_doc/embedding_gemma2).

The Python video path samples frames at 1 fps by default and allows configurable
sampling. The mobile API documents text, image, audio and mixed-content inputs;
plan for app-side video decoding and sampling rather than assuming direct MP4
ingestion. Sparse sampling can omit a brief event. See the
[video guide](https://ai.google.dev/gemma/docs/embeddinggemma/multimodal-embeddinggemma-with-sentence-transformers)
and [Android embedding API](https://developers.google.com/edge/mediapipe/solutions/retrieval/universal_embedder/android).

## Published device processing measurements

Benchmark snapshot: 9 October 2026. Distinguish parameter count, downloaded
bundle size and runtime memory. The
[LiteRT specifications](https://huggingface.co/litert-community/embeddinggemma-2-text-vision-440m-litert-lm#model-specifications)
list these CPU/GPU files:

| Configuration | Parameters | Download |
| --- | --- | --- |
| Text | 270M | 165 MB |
| Text and vision | 440M: 270M text plus 170M vision | 388 MB |
| Text, vision and audio | 740M: adds 300M audio | 485 MB |

Text weights use INT4 and vision weights INT8, with per-channel quantization-aware
training. Modality encoders load on demand. These file sizes do not identify the
TPU artifact or total runtime memory.

Both the 440M card and the
[740M card](https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm/blob/main/README.md)
repeat identical Text + Vision results without naming the exact loaded file and
resident modules per device. The logical text and vision configuration is 440M;
the benchmark artifact provenance remains unspecified.

Published latency uses 70 vision tokens and averages five iterations:

| Device | Backend | Text + Vision latency | Derived images/second | Reported memory |
| --- | --- | --- | --- | --- |
| Pixel 11 Pro | TPU | 49 ms | 20.4 | 125 MB, excludes TPU |
| S26 Ultra | CPU | 175 ms | 5.7 | 694 MB |
| S26 Ultra | GPU | 119 ms | 8.4 | 427 MB, excludes GPU |
| iPhone 18 Pro | CPU | 191 ms | 5.2 | 196 MB |
| iPhone 18 Pro | GPU | 69.8 ms | 14.3 | 196 MB |
| Raspberry Pi 5, 16 GB | CPU | 1,761 ms | 0.57 | 619 MB |
| Jetson Orin Nano | CPU | 1,741 ms | 0.57 | 627 MB |
| Jetson Orin Nano | GPU | 485 ms | 2.06 | 1,103 MB, excludes GPU |

Memory uses different platform metrics and a cached second load; cross-platform
figures are not directly comparable. Apple phys_footprint includes accelerator
allocations, whereas the other reported process metrics exclude them. Raspberry
Pi and Jetson results do not establish older-phone performance. No credible
older or midrange phone result was found in this research snapshot.

The image rates are serial reciprocals of latency, not sustained measurements.
They omit decoding, concurrent recording, startup, thermal behavior, HE and
longer temporal inputs. The
[AI Edge announcement](https://developers.googleblog.com/google-ai-edge-with-embeddinggemma-2/)
describes the timings as per-image embedding with a maximum 70-token vision budget.

The official
[device benchmark notebook](https://github.com/google-ai-edge/litert-samples/blob/main/benchmark/developer_device_platform/embedding_gemma_ddp_benchmark.ipynb)
does identify a 740M artifact. It contains no saved results and tests CPU text
and text + image + audio inputs, with 50 iterations and four threads. Its
different procedure does not resolve the published image table's artifact.

For illustration, sampling one frame per second from one hour of video gives
3,600 image inputs. At the reported S26 Ultra GPU latency of 119 ms, their serial
model time is 428.4 seconds, about 7.1 minutes, before the rest of the pipeline.
This calculation assumes separate image embeddings and unchanged latency; it
does not estimate joint multi-frame embedding speed or select a sampling policy.

A future device test should include an older flagship and a low-memory midrange
phone, using the explicit 440M/388 MB text and vision artifact for independent
frame embeddings. Retain its file hash, quantization, runtime version, device,
backend and vision budget. Measure decoding and embedding together during a
sustained recording, plus offline indexing separately. Report latency
distribution, completed frames, backlog, total accessible memory, thermal and
energy observations. Test representation quality at each sampling rate. This
proposal does not select the final video representation or model. No phone
performance run has been performed for these notes.

## Candidate computation routes

| Route | What leaves the Operator device | Where the question stays | Main research question |
| --- | --- | --- | --- |
| Upload general embeddings | Ordered video embeddings and signed metadata | Requester device or trusted service | Are the vectors sufficient for the actual validation? |
| Evaluate an encrypted query locally | Commitments, signed metadata and encrypted similarity scores | Requester device; only encrypted query vectors reach the Operator app | Can private comparison be efficient and verifiable? |
| Perform inference on encrypted inputs | An encrypted computation protocol | Depends on the protocol | Can the full model be represented and evaluated at an acceptable cost? |

The first route already keeps the question off the Operator device without
homomorphic encryption. The second also lets the Operator retain the video
vectors locally, changing the transmitted result from vectors to encrypted
scores. Both are candidates; this discussion does not select one.

A plaintext query vector is unsuitable for the secrecy requirement. An Operator
with the embedding model can compare it against likely questions. Embedding
inversion research also demonstrates text recovery for other models; its reported
recovery rates are not results for EmbeddingGemma 2. See
[Text Embeddings Reveal Almost As Much As Text](https://aclanthology.org/2023.emnlp-main.765/).

## Candidate homomorphic comparison after local embedding

The Requester computes and normalizes `q` locally, creates an encryption context,
and retains its secret key. The Operator receives only the public evaluation
material and encrypted query `Enc(q)`. The Operator computes normalized `v_i`
locally and evaluates:

```text
Requester: q = normalize(TextEmbed(Q))
Operator:  v_i = normalize(VisualEmbed(sample_i(V)))
Operator:  Enc(s_i) = EvalDot(Enc(q), v_i)
Requester: s_i = Decrypt(Enc(s_i))
Requester: result = CommittedScoringRule(s_0, ..., s_n)
```

Only the comparison operates on ciphertext. The embedding model can remain
unchanged. Normalization happens before encryption, avoiding an encrypted square
root or division. Thresholding and temporal aggregation can initially happen
privately on the Requester's device after decryption.

TenSEAL provides an encrypted CKKS vector dot product with a plaintext vector.
Its implementation multiplies by the plaintext operand and sums the products.
This is an available primitive, not a measured mobile implementation. See the
[Python API](https://github.com/OpenMined/TenSEAL/blob/main/tenseal/tensors/ckksvector.py)
and [underlying implementation](https://github.com/OpenMined/TenSEAL/blob/main/tenseal/cpp/tensors/ckksvector.cpp).

CKKS supports approximate arithmetic suited to real-valued embeddings. Measure
its score error and changed decisions near the threshold. Integer schemes such
as BFV or BGV offer another route after fixed-point quantization, provided the
chosen modulus prevents wraparound; quantization still introduces error. Library
support alone does not choose safe parameters. See
[Microsoft SEAL](https://github.com/microsoft/SEAL).

HE ciphertexts and evaluation keys are larger than raw vectors. Measure initial
key transfer, per-query ciphertexts and per-segment results separately. The raw
size of a 768-dimensional float32 vector, 3,072 bytes, is not an HE payload estimate.

HE does not certify the chosen vector or the performed calculation. A malicious
Operator can return an unrelated ciphertext and sign it. A further mechanism
must verify evaluation against the committed vectors. Likewise, a commitment to
`q` does not prove that an encrypted query contains that same `q`.

SEAL's security guidance states that ciphertexts are unauthenticated and that it
does not provide circuit privacy. CKKS decryption feedback can expose secret-key
information. Keep decrypted scores local in the initial experiment and provide
no general decryption or detailed error-feedback service. Hiding the Operator's
vectors from the decryptor requires additional protocol analysis. See
[SEAL security guidance](https://github.com/microsoft/SEAL/blob/main/SECURITY.md).

## Commitments and ordering

A candidate query commitment is:

```text
C_query = SHA256(Encode(
    domain, session_id, task_id, public_profile, private_randomness,
    question, exact_query_vector_bytes, query_derivation_profile,
    complete_scoring_policy, encrypted_query_digest
))
```

This is a proposed randomized hash construction to review before implementation.
Use fresh private CSPRNG randomness, provisionally 32 bytes, and an unambiguous
versioned encoding. Keep that randomness secret while the question is concealed.
A predictable question hashed without private randomness allows guessing. Do
not also publish an unsalted question hash, plaintext query vector or identifiers
that expose the hidden question. The salted disclosure design in
[RFC 9901 section 9.3](https://www.rfc-editor.org/rfc/rfc9901.html#section-9.3)
explains the need for independent high-entropy unrevealed randomness.

The committed policy should fix positive and negative references, prompts,
pooling, temporal aggregation, thresholds, rounding, missing-data handling,
retries, permitted output and inconclusive behavior. Otherwise a party can keep
the question fixed while changing the decision rule after seeing evidence.
Specify vector byte encoding, dimensions and invalid-number handling separately
from the metadata encoding. [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)
is one candidate for canonical JSON metadata.

Proposed sequence for the HE route:

1. Agree on public task scope, model and capture profile, session identities,
   permitted number of hidden tests, deadlines and evidence access rules.
2. The Requester signs one query commitment, the session bindings, and separate
   public fields for the randomized query-ciphertext digest and encryption
   context/key fingerprints. The Operator acknowledges these before capture.
   Multiple tests require a fixed set and an explicit rule for reporting the
   complete set.
3. The Operator captures video and derives general, ordered vectors without the
   question. A signed submission binds the original query commitment, source-video
   digest, complete vector-manifest commitment, sampling and model claims.
4. The Requester acknowledges the frozen submission. The encrypted query is then
   delivered with public evaluation material and checked against the separately
   signed public ciphertext digest and context/key fingerprints.
5. The Operator returns signed encrypted scores bound to the same session and
   frozen vector commitment. The Requester decrypts locally. Honest arithmetic
   is an assumption until a verification mechanism is included.

Cross-referenced signed messages establish a causal transcript and resist later
substitution. They do not establish physical capture time. Commitments cannot
force a party to finish the protocol or disclose an opening.

The Operator cannot extract the ciphertext digest from the opaque query
commitment. The separate public digest allows a byte-consistency check without
opening that commitment. Hashing a randomized HE ciphertext differs from
publishing a guessable plaintext question hash; ciphertext generation must use
fresh scheme-appropriate randomness. The relationship between that ciphertext
and the privately committed query still needs a separate verification mechanism.

The question and commitment opening are not disclosed to the Operator or app in
this design. Independent audit requires an agreed confidential verifier or a
proof mechanism that establishes the relevant statement without revealing the
question. Neither is selected yet.

## Properties that require separate evidence

| Property | What the proposed primitives establish | What remains to establish |
| --- | --- | --- |
| Query privacy | HE can conceal the query operand under the chosen scheme's assumptions | Leakage through task context, output, metadata and repeated attempts |
| Fixed test | A hiding commitment binds the declared question and policy | Relevance, fairness, query derivation and ciphertext consistency |
| Attributed submission | A signature binds a signer to submitted bytes | Honest execution and truthful sensor claims |
| Correct comparison | A proof could bind arithmetic to committed query and video vectors | A concrete proof construction and its numerical semantics |
| Video derivation | Video and vector commitments fix the declared inputs and outputs | Proof or independent recomputation of the derivation relationship |
| Real recording | Session challenges and capture observations add evidence | Freshness, scene authenticity and the trusted acquisition path |

Proving a small vector comparison is a different scope from proving video
decoding, sampling and full model inference. Even a valid inference proof
establishes computation on its input witness, not that the witness came from a
real camera scene. Signing a video hash and vectors together proves no derivation
relationship by itself. Without retained video, later re-embedding and visual
review are unavailable. These boundaries follow the existing
[sensor security model](../../sensors/SECURITY.md) and
[evidence session design](../../sensors/EVIDENCE_SESSIONS.md).

Hidden predicates must remain within an agreed task scope. A commitment can fix
an irrelevant or impossible test just as effectively as a useful one. Decide
how an authorized verifier can check permitted scope while preserving question
secrecy. Experimental scores alone establish no payment, penalty or misconduct
authority under the [Assignment threat model](../../requests/THREAT_MODEL.md).

## Face identity as a separate research question

The follow-up [open face authentication review](OPEN_FACE_AUTHENTICATION_RESEARCH.md)
records verification rates, concrete artifact sizes, older-device measurements,
weight licensing and capture/PAD gaps for the authentication discussion.

The owner asks whether these embeddings can support face recognition.
EmbeddingGemma 2 vectors can be compared for cropped face inputs, but the
[official card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2)
does not report a separate face identity or verification accuracy. General
image retrieval scores do not establish reliable same-person matching.

Compare this experimental baseline with an encoder trained specifically for
face identity. [ArcFace](https://openaccess.thecvf.com/content_CVPR_2019/html/Deng_ArcFace_Additive_Angular_Margin_Loss_for_Deep_Face_Recognition_CVPR_2019_paper.html)
is an identity-separating training loss, not one fixed deployment architecture.
[MobileFaceNets](https://arxiv.org/abs/1804.07573) describes mobile face encoders
around 1M parameters and 4 MB of weights. These are candidates for study, not an
adopted model or measured performance for this application.

A future comparison should use detected and aligned faces, same-person images
across sessions, poses and lighting, and difficult different-person pairs.
Calibrate thresholds on separate data and measure false matches and false
rejections on held-out people and sessions. Identity matching does not establish
liveness, video freshness or completion of an action. Separately test what
identity information the general embeddings retain; an unvalidated recognition
capability does not establish anonymity. No face evaluation has been performed.

## Evidence for semantic comparison

The owner asks how to test, or read about, the extent to which a dot product is
sufficient. The relevant question is whether a scoring method separates the
specific permitted validation outcomes, including convincing near-misses.
Arithmetic correctness alone cannot answer this.

Google reports 50.67 mean Hit@1 for MMEB-v2 Video using the full-precision,
768-dimensional EmbeddingGemma 2 checkpoint. Hit@1 measures whether the correct
candidate ranks first. It is not a calibrated probability that an arbitrary
claim is true or a false-acceptance rate for a binary validator. See the
[model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).

MMEB-v2 includes video retrieval, moment retrieval, classification and question
answering, including temporal and action tasks. Its video QA formulation embeds
the question and video together and matches against candidate answers. That
does not directly evaluate our proposed independent `E(Q)` versus `E(V)`
comparison. Read the task formulations as well as aggregate scores in the
[MMEB-v2 paper](https://arxiv.org/html/2507.04590v1).

Useful targeted readings are:

- [TemporalBench](https://arxiv.org/abs/2410.10818) tests fine temporal differences
  such as repetition frequency, event order and motion magnitude. It also
  evaluates embedding models with descriptions that differ in an essential fact.
- [NegBench](https://arxiv.org/abs/2501.09425) examines negation in image and video
  retrieval and caption selection, relevant to presence versus absence and
  performed versus omitted actions.
- [MVEB](https://arxiv.org/html/2606.14958v1) separates cosine retrieval and
  matching against label descriptions from learned classifiers on frozen video
  embeddings. It supplies a useful diagnostic distinction between the scorer
  and the representation.

Results for other models in these papers are not EmbeddingGemma 2 measurements.
They identify useful test designs and possible failure modes. General benchmark
performance must be complemented by recordings representative of the chosen task.

## Testing whether a dot product is sufficient

First run a plaintext semantic experiment using the same frozen vectors intended
for the encrypted protocol. Compare these methods on the same examples:

| Method | Calculation or input | What a successful result would support |
| --- | --- | --- |
| Direct similarity | `dot(q_expected, v)` with a calibrated threshold | A single semantic direction is sufficient for this test profile |
| Positive versus negative descriptions | `dot(q_positive - q_negative, v)` | Contrasting plausible outcomes improves separation |
| Linear classifier | `dot(w, v) + b`, trained on labeled development examples | Useful task information is available beyond the original query direction |
| Later original-video baseline | A question-conditioned model receives both question and video | Better performance on the same held-out cases would support richer processing or original visual information |

Use declarative event descriptions as well as question wording, with the
documented model/runtime task prefixes. Treat wording and reference choices as
development choices to freeze before the final test. Negative descriptions are
not assumed to solve negation automatically. A learned classifier needs labels
for the supported task family; its success would not establish zero-shot ability
on arbitrary unseen hidden questions. The original-video baseline belongs in a
controlled research environment, where access to the question and video is
authorized, rather than on the production Operator device.

Create matched positive and negative examples differing in one essential fact.
An illustrative test might require connecting a cable before operating a switch.
Include the correct sequence, reversed sequence, connector merely held nearby,
missing step, unrelated footage, brief connection missed by sparse sampling and
an obstructed view. Have reviewers label the visible event independently of model
scores, retaining disagreement and unobservable cases. A label that a step is
visible is distinct from evidence that the physical work succeeded.

Retain ordered frame or segment scores and test temporal handling separately.
For independent frame embeddings, mean and maximum pooling are unchanged by
permuting the frames; they cannot distinguish opposite event orders. Event
presence, sustained properties and sequences need different pooling or temporal
rules. Compare full sampling with lower frame rates, single-frame controls and
reversed/shuffled sequences. An event present in the recording but missed between
sampled frames is a sampling limitation, while failure on visible sampled frames
concerns representation or scoring.

Keep every clip and recording session within one data split. Hold out people,
locations and devices where possible, or report these as separate generalization
tests. Do not put adjacent frames, near-duplicate clips or references from the
same source recording into both development and test sets. Tune prompts,
references, model configuration, pooling, classifier and thresholds only on
development data, then freeze them before evaluating the held-out set. See
[grouped validation](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data)
and [threshold tuning](https://scikit-learn.org/stable/modules/classification_threshold.html).

Before the final test, specify tolerated false acceptance and required positive
acceptance coverage for the experimental task profile. Report false acceptance
among genuinely negative cases, false rejection among positives, inconclusive
rate, accepted positives, confidence intervals and results for each failure
mode. An abstention rule must not appear reliable merely because it declines
every case. Ranking accuracy or a strong average score alone is insufficient.

For illustration, zero false acceptances among 100 independent representative
negative cases still gives a one-sided 95 percent binomial upper bound of about
2.95 percent; among 300 it is about 0.994 percent. These are statistical examples,
not adopted risk tolerances. Correlated frames are not independent trials, and
the bound does not cover unseen attack strategies. See
[NIST binomial interval guidance](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).

If direct similarity fails but a contrast score or linear classifier succeeds,
the original scorer needs improvement while the embeddings remain useful. Both
improvements still fit an encrypted linear comparison: encrypt the private
difference vector or classifier weights, then decrypt scores and threshold on
the Requester device. If all tested embedding methods fail while the original
video baseline succeeds, investigate sampling and information loss. That result
would not prove that no information exists anywhere in the embeddings.

An evaluation record should retain the task family, clip/session group, split,
visible-event label and uncertainty, exact model and preprocessing profile,
scoring method, raw scores, frozen decision rule, outcome and failure category.
This lets later HE experiments reuse the exact same vectors and distinguish
semantic errors from encryption-induced numerical changes. Initial benchmarks
can use a bounded relevant subset; no complete benchmark-corpus download is
needed to formulate or inspect this experiment.

## Candidate experiments

These experiments can develop as separate research tracks. Their order below
does not select a final architecture or require dot-product scoring.

1. Compare compact representations of long recordings at several temporal
   granularities. Measure payload, device cost, coverage and support for different
   later validation questions. Keep representation choices separate from scorer
   choices so a weak comparison rule does not prematurely eliminate an embedding.
2. Run the semantic comparison experiment above on consented clips for a few
   narrow tasks. Synthetic clips can help isolate failures but cannot establish
   performance on real phone recordings. Compare direct similarity, contrasting
   descriptions and a linear classifier before reducing output dimensions.
3. Inside the managed development container, compare plaintext dot products with
   HE results on synthetic normalized vectors, then actual model vectors. Record
   numerical error, decisions near thresholds, context parameters, serialized
   sizes, time and memory. Synthetic arithmetic success is not semantic validation.
4. Specify the signed transcript and exercise altered commitments, wrong sessions,
   reordered or omitted segments, repeated tests and ciphertext substitution.
   Report unverified derivation and arithmetic honestly rather than marking them
   as capture verification.
5. Measure embedding and HE costs separately on target phones using the existing
   container and device procedure. Investigate verifiable comparison before
   attempting full inference proofs or encrypted model inference.

These are proposed research tracks. No model download, container mutation, prototype,
benchmark or new verification profile has been performed for this discussion.

## Open design decisions

- Which compact representation and temporal granularity preserve enough
  information from long recordings for the intended range of private questions?
- Which exact validations are expressible as semantic comparison, and which need
  an answer-producing model or specialized temporal measurements?
- Should general video vectors reach the Requester, or should only encrypted
  scores leave the Operator device?
- Who may learn scores and final decisions? Repeated private queries can reveal
  visual information; output feedback can also reveal aspects of the hidden test.
- What mechanism binds the encrypted query to its commitment and the evaluated
  vectors to the frozen submission?
- How is a hidden question's permitted scope independently checked without
  disclosing it to the Operator or app?
- What evidence retention, confidential audit and unresolved-result procedure is
  acceptable to both parties?

MPC, which distributes private inputs across a secure computation protocol, is
another candidate if both inputs and threshold decisions must remain private.
Selection should follow the required visibility and adversary assumptions.
Homomorphic comparison is one bounded arithmetic experiment when the query
operand needs to be concealed from the Operator's evaluator. Its feasibility
would not select the representation or make dot-product scoring the final
validation method.

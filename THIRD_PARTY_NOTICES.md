# Third-party materials

The root AGPL-3.0-only license covers project-owned material. It does not replace
the terms or provenance of the following external materials, nor the licenses of
dependencies installed by the build tools. Dependency packages remain separately
licensed under their own notices and license files.

| Material | Location and provenance |
| --- | --- |
| Primer Octicons GitHub icon | Homepage inline SVG; MIT notice in [LICENSES/Primer-Octicons-MIT.txt](LICENSES/Primer-Octicons-MIT.txt) and beside the SVG |
| IGS/BKG broadcast navigation excerpt | `code/crates/nonverba-core/src/location_proof/position/importer/igs-2026270-excerpt.rnx`; [data notice](LICENSES/IGS-BKG-navigation-notice.txt) |
| Google public Android attestation root certificates | `code/crates/nonverba-core/src/android_attestation/google-roots-2026.json`; [trust-anchor notice](LICENSES/Google-attestation-roots-notice.txt) |
| RTKLIB-generated numerical test vectors | `code/crates/nonverba-core/src/location_proof/position/rtklib-reference.json` and `rtklib-rollover-reference.json`; [fixture notice](LICENSES/RTKLIB-fixtures-notice.txt) |
| zune-jpeg progressive JPEG regression fixture | `code/crates/nonverba-core/tests/fixtures/camera-quality/progressive-dri-420.hex.txt`; exact synthetic bytes from `zune-jpeg` 0.5.15 `src/mcu_prog.rs`, with [provenance](code/crates/nonverba-core/tests/fixtures/camera-quality/README.md) and the selected [Zlib license](code/crates/nonverba-core/tests/fixtures/camera-quality/LICENSE-ZLIB.txt) |
| Qualcomm/foamliu MobileFaceNet 128D model | Optional local browser face bundle; foamliu checkpoint `weights/mobilefacenet.pt` at revision `a6cc9032a659b615f477833e1a70b5e7931bcccc`, Qualcomm float ONNX release v0.64.0 and deterministic inline-data export; exact sizes, digests, source URLs and distribution notices in the [model lock](code/models/mobilefacenet/model-lock.json). The [Qualcomm model card](https://huggingface.co/qualcomm/MobileFaceNet) declares Apache-2.0; upstream implementation and training-data rights remain separate review boundaries. |
| OpenCV YuNet face detector | Optional local browser face bundle; `face_detection_yunet_2023mar.onnx` with pinned local 320×320 contract, identified separately from the face encoder in the [model lock](code/models/mobilefacenet/model-lock.json). The [model directory license](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE) is MIT, copyright Shiqi Yu, 2020. Detector decoding/alignment provenance is described in the [face implementation record](docs/development/OPERATOR_FACE_PIPELINE.md). |
| ONNX Runtime Web 1.23.2 | Optional browser CPU WASM inference runtime; exact npm package/module/WASM digests and copied MIT license notices in the [model lock](code/models/mobilefacenet/model-lock.json). See [Microsoft's license](https://github.com/microsoft/onnxruntime/blob/v1.23.2/LICENSE). |

The navigation excerpt is external satellite-navigation data, not a phone's
sensor evidence. Root certificates contain public verification keys, not private
signing keys. RTKLIB vectors are mathematical synthetic inputs and outputs, not
observations at a private physical location. Public synthetic contract vectors
and their migration provenance are described in their fixture READMEs.

The optional face dependency cache and generated browser bundle are build inputs
and outputs, not project-owned model weights committed under AGPL. Model, detector
and runtime notices accompany the staged browser assets. Their published licenses
do not establish training-data clearance, production authentication accuracy,
liveness or trusted capture. The [Operator face record](docs/development/OPERATOR_FACE_PIPELINE.md)
documents these separate boundaries and the unresolved evaluation work.

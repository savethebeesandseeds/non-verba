// SPDX-License-Identifier: AGPL-3.0-only
// Shared enrollment/comparison profile. Asset hashes are populated from the
// independently retrieved publisher artifacts in the model lock.
export const MOBILE_FACE_SPEC = Object.freeze({
  id: 'qualcomm-foamliu-mobilefacenet-128d', version: 'operator-face-mobilefacenet128-qaihub064-v1',
  checkpoint_sha256: '90a00ba1d8b0b688af3deb731ed53dca582e6106805d1bc3cfdef55f570493f4',
  artifact_sha256: '1efc0e9098b219466bb54c82a971e08da11e29267aee6f7f9c1fd13274b7f7ec',
  preprocessing: 'rgb112-nchw-f32-imagenet-meanstd-v1',
  aggregation: 'original-plus-horizontal-flip-sum-then-l2-v1', dimensions: 128,
  runtime: 'onnxruntime-web-1.23.2-wasm-cpu-single-thread', precision: 'float32',
  alignment: 'yunet-2023mar-320-bgr-score0.8-nms0.3-five-point-similarity-bilinear-112-v1',
});
export const FACE_MODEL_CACHE = '/opt/nonverba-tools/models/mobilefacenet/foamliu-a6cc9032-qaihub-v0.64.0-ort1.23.2';
export const MOBILE_FACE_LOCK_SHA256 = 'c5b7b733570c0684baaf740d97f2d16c3b0ac3e01b43a0de58d3db360a66b5da';

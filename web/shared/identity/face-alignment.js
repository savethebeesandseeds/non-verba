// SPDX-License-Identifier: AGPL-3.0-only
// Geometry/preprocessing only, independent of the encoder and of liveness.
export const FACE_TEMPLATE_112 = Object.freeze([[38.2946, 51.6963], [73.5318, 51.5014],
  [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]].map(Object.freeze));
const failed = message => Object.assign(new Error(message), {code: 'capture_quality_failure'});
function image(pixels) {
  if (!Number.isInteger(pixels?.width) || !Number.isInteger(pixels?.height)
      || pixels.width < 16 || pixels.height < 16 || pixels.width * pixels.height > 16777216
      || !pixels.data || pixels.data.length !== pixels.width * pixels.height * 4) throw failed('The camera image is unavailable or too large.');
}
function sample(pixels, x, y, channel) {
  if (x < 0 || y < 0 || x > pixels.width - 1 || y > pixels.height - 1) return 0;
  const left = Math.floor(x), top = Math.floor(y), right = Math.min(left + 1, pixels.width - 1), bottom = Math.min(top + 1, pixels.height - 1);
  const dx = x - left, dy = y - top;
  const value = (col, row) => pixels.data[(row * pixels.width + col) * 4 + channel];
  return value(left, top) * (1 - dx) * (1 - dy) + value(right, top) * dx * (1 - dy)
    + value(left, bottom) * (1 - dx) * dy + value(right, bottom) * dx * dy;
}
export function resizeDetectorInput(pixels, side = 320) {
  image(pixels);
  const scale = Math.min(side / pixels.width, side / pixels.height);
  const width = Math.max(1, Math.round(pixels.width * scale)), height = Math.max(1, Math.round(pixels.height * scale));
  const tensor = new Float32Array(side * side * 3);
  // Aspect-preserving top-left letterbox; zero padding at right and bottom.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceX = Math.max(0, Math.min(pixels.width - 1, (x + 0.5) * pixels.width / width - 0.5));
    const sourceY = Math.max(0, Math.min(pixels.height - 1, (y + 0.5) * pixels.height / height - 0.5));
    const index = y * side + x;
    tensor[index] = sample(pixels, sourceX, sourceY, 2);
    tensor[side * side + index] = sample(pixels, sourceX, sourceY, 1);
    tensor[side * side * 2 + index] = sample(pixels, sourceX, sourceY, 0);
  }
  return {tensor, width, height, scaleX: width / pixels.width, scaleY: height / pixels.height};
}
function iou(a, b) {
  const area = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return area / (a.width * a.height + b.width * b.height - area);
}
export function decodeYuNet(outputs, {side = 320, scoreThreshold = 0.8, nmsThreshold = 0.3} = {}) {
  const candidates = [];
  for (const stride of [8, 16, 32]) {
    const cols = side / stride, count = cols * cols;
    const cls = outputs[`cls_${stride}`]?.data, obj = outputs[`obj_${stride}`]?.data;
    const box = outputs[`bbox_${stride}`]?.data, points = outputs[`kps_${stride}`]?.data;
    if (cls?.length !== count || obj?.length !== count || box?.length !== count * 4 || points?.length !== count * 10) throw failed('The detector returned an incompatible landmark layout.');
    for (let index = 0; index < count; index++) {
      const score = Math.sqrt(Math.max(0, Math.min(1, cls[index])) * Math.max(0, Math.min(1, obj[index])));
      if (!Number.isFinite(score) || score < scoreThreshold) continue;
      const x = index % cols, y = Math.floor(index / cols);
      const cx = (x + box[index * 4]) * stride, cy = (y + box[index * 4 + 1]) * stride;
      const width = Math.exp(box[index * 4 + 2]) * stride, height = Math.exp(box[index * 4 + 3]) * stride;
      const landmarks = Array.from({length: 5}, (_, n) => [(points[index * 10 + n * 2] + x) * stride,
        (points[index * 10 + n * 2 + 1] + y) * stride]);
      if (![cx, cy, width, height, ...landmarks.flat()].every(Number.isFinite) || width <= 0 || height <= 0) continue;
      candidates.push({x: cx - width / 2, y: cy - height / 2, width, height, landmarks, score});
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const retained = [];
  for (const candidate of candidates.slice(0, 5000)) if (retained.every(face => iou(candidate, face) <= nmsThreshold)) retained.push(candidate);
  return retained;
}
export function alignSingleFace(pixels, faces, transform = {scaleX: 1, scaleY: 1}) {
  image(pixels);
  if (faces.length !== 1) throw failed(faces.length ? 'Multiple faces were detected. Capture only the Operator; no face is selected automatically.' : 'No usable face was detected. Try a clear, well-lit capture.');
  const face = faces[0];
  if (face.width < 40 || face.height < 40) throw failed('The face is too small for this inspection capture.');
  const landmarks = face.landmarks.map(([x, y]) => [x / transform.scaleX, y / transform.scaleY]);
  if (landmarks.length !== 5 || landmarks.some(point => point.length !== 2 || !point.every(Number.isFinite)
    || point[0] < 0 || point[1] < 0 || point[0] >= pixels.width || point[1] >= pixels.height)) throw failed('The face landmarks are incomplete or outside the image.');
  if (landmarks[1][0] <= landmarks[0][0] || Math.hypot(landmarks[1][0] - landmarks[0][0], landmarks[1][1] - landmarks[0][1]) < 12) throw failed('Face landmark orientation or resolution is unsuitable.');
  const mean = points => [0, 1].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
  const source = mean(landmarks), destination = mean(FACE_TEMPLATE_112);
  let variance = 0, dot = 0, cross = 0;
  landmarks.forEach(([x, y], index) => {
    const dx = x - source[0], dy = y - source[1], tx = FACE_TEMPLATE_112[index][0] - destination[0], ty = FACE_TEMPLATE_112[index][1] - destination[1];
    variance += dx * dx + dy * dy; dot += dx * tx + dy * ty; cross += dx * ty - dy * tx;
  });
  if (!(variance > 1)) throw failed('Face alignment is degenerate.');
  const a = dot / variance, b = cross / variance, determinant = a * a + b * b;
  const tx = destination[0] - a * source[0] + b * source[1], ty = destination[1] - b * source[0] - a * source[1];
  if (!(determinant > 1e-8) || ![a, b, tx, ty].every(Number.isFinite)) throw failed('Face alignment failed.');
  const residual = Math.sqrt(landmarks.reduce((sum, [x, y], index) => sum
    + (a * x - b * y + tx - FACE_TEMPLATE_112[index][0]) ** 2
    + (b * x + a * y + ty - FACE_TEMPLATE_112[index][1]) ** 2, 0) / 5);
  if (residual > 12) throw failed('The landmark fit is unsuitable. Try a front-facing capture.');
  const tensor = new Float32Array(3 * 112 * 112);
  for (let y = 0; y < 112; y++) for (let x = 0; x < 112; x++) {
    const sx = (a * (x - tx) + b * (y - ty)) / determinant;
    const sy = (-b * (x - tx) + a * (y - ty)) / determinant;
    const index = y * 112 + x;
    for (let channel = 0; channel < 3; channel++) tensor[channel * 112 * 112 + index] = sample(pixels, sx, sy, channel) / 255;
  }
  return {tensor, residual, quality: 'accepted'};
}
export function normalizeFaceFeature(values) {
  if (values.length !== 128 || !Array.from(values).every(Number.isFinite)) throw failed('The encoder returned an invalid feature vector.');
  const maximum = Math.max(...Array.from(values, value => Math.abs(value)));
  if (!(maximum > 0)) throw failed('The encoder returned an empty feature vector.');
  const norm = Math.sqrt(Array.from(values).reduce((sum, value) => sum + (value / maximum) ** 2, 0));
  if (!Number.isFinite(norm) || norm <= 0) throw failed('The encoder returned an invalid feature norm.');
  return Array.from(values, value => (value / maximum) / norm);
}

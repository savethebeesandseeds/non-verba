// SPDX-License-Identifier: AGPL-3.0-only
// This adapter dispatches JPEG bytes to Rust. It never measures pixels, signs
// evidence, or changes successful-measurement verification or acceptance.
export const MAX_CAMERA_QUALITY_BYTES = 32 * 1024 * 1024;
const PROFILE_TYPE = 'nonverba-camera-quality-profile';
const REPORT_TYPE = 'nonverba-camera-quality-report';
const message = error => String(error?.message || error);

export function cameraQualityRegion(value) {
  if (value == null) return null;
  const fields = ['x', 'y', 'width', 'height'];
  if (typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== fields.length
      || fields.some(key => !Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 8192)
      || value.width === 0 || value.height === 0) {
    throw new Error('Use whole pixel coordinates and a positive subject width and height.');
  }
  return Object.fromEntries(fields.map(key => [key, value[key]]));
}

function analysisProfile(value, subjectRegion) {
  if (!value || value.version !== 1 || value.type !== PROFILE_TYPE
      || typeof value.metric_profile !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value.metric_profile)
      || value.subject_region !== null
      || Object.keys(value).length !== 4) throw new Error('The image quality profile is unavailable or unsupported.');
  return {...value, subject_region: cameraQualityRegion(subjectRegion)};
}

function qualityReport(value, byteLength) {
  if (!value || value.version !== 1 || value.type !== REPORT_TYPE
      || value.guidance_only !== true || value.satisfies_successful_measurement !== false
      || value.authenticity_proven !== false || !/^[a-f0-9]{64}$/.test(value.image_sha256)
      || !/^[a-f0-9]{64}$/.test(value.analysis_profile_sha256)
      || value.image?.byte_length !== byteLength || !Array.isArray(value.regions)
      || value.regions.length > 6 || !Array.isArray(value.guidance)) {
    throw new Error('The engine returned an unsupported image quality report.');
  }
  return JSON.stringify(value, null, 2);
}

/** State and stale-result handling only; the injected engine owns all metrics. */
export class CameraQualityAnalysis {
  constructor({engine, onState = () => {}}) {
    this.engine = engine;
    this.onState = onState;
    this.revision = 0;
    this.reportJson = null;
    this.phase = 'idle';
  }
  get report() { return this.reportJson === null ? null : JSON.parse(this.reportJson); }
  reset(detail = 'Image quality inputs changed. Analyze again.') {
    this.revision++;
    this.reportJson = null;
    this.phase = 'idle';
    this.onState({phase: this.phase, report: null, detail});
  }
  async analyze(file, subjectRegion = null) {
    const revision = ++this.revision;
    this.reportJson = null;
    this.phase = 'working';
    this.onState({phase: this.phase, report: null, detail: 'Measuring the selected JPEG locally…'});
    try {
      if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choose a JPEG in Original files above.');
      if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_CAMERA_QUALITY_BYTES) {
        throw new Error('Choose a JPEG no larger than 32 MiB.');
      }
      const region = cameraQualityRegion(subjectRegion);
      const defaults = await this.engine.json('camera_quality_profile');
      if (revision !== this.revision) return null;
      const profile = analysisProfile(defaults, region);
      const buffer = await file.arrayBuffer();
      if (revision !== this.revision) return null;
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size
          || buffer.byteLength > MAX_CAMERA_QUALITY_BYTES) throw new Error('The selected image could not be read completely.');
      const report = await this.engine.json('analyze_camera_quality', new Uint8Array(buffer), JSON.stringify(profile));
      if (revision !== this.revision) return null;
      this.reportJson = qualityReport(report, buffer.byteLength);
      this.phase = 'ready';
      this.onState({phase: this.phase, report: this.report, detail: 'Image measurements ready. Guidance only; no calibrated pass or fail verdict.'});
      return this.report;
    } catch (error) {
      if (revision !== this.revision) return null;
      this.reportJson = null;
      this.phase = 'error';
      this.onState({phase: this.phase, report: null, detail: message(error)});
      throw error;
    }
  }
  async save(saveArtifact) {
    if (this.phase !== 'ready' || this.reportJson === null) throw new Error('Analyze the selected JPEG before saving its quality record.');
    const text = this.reportJson;
    const hash = JSON.parse(text).image_sha256;
    await saveArtifact(`nonverba-camera-quality-${hash.slice(0, 12)}.json`, 'application/json', text);
  }
}

const percentage = (count, total) => Number.isSafeInteger(count) && Number.isSafeInteger(total)
  && count >= 0 && total > 0 && count <= total ? `${(100 * count / total).toFixed(2)}%` : 'unavailable';
export function cameraQualityRegionSummary(region) {
  const exposure = region.exposure;
  const states = region.sharpness?.map(item => item.assessment) || [];
  const sharpness = states.includes('measured')
    ? 'Sharpness measurements available; a calibrated focus verdict is unavailable.'
    : states.includes('insufficient-texture')
      ? 'Insufficient texture to assess sharpness.'
      : 'Insufficient data to assess sharpness.';
  return `${region.bounds.width} × ${region.bounds.height} pixels. Near-black pixels: ${percentage(exposure?.near_black_count, exposure?.sample_count)}. Near-white pixels: ${percentage(exposure?.near_white_count, exposure?.sample_count)}. ${sharpness}`;
}

export function installCameraQualityUI({engine, saveArtifact, root = document}) {
  const $ = id => root.getElementById(id);
  if (!$('camera-quality-panel')) return null;
  let saving = false;
  const render = state => {
    $('camera-quality-status').textContent = state.detail;
    $('camera-quality-analyze').disabled = state.phase === 'working';
    $('camera-quality-save').disabled = state.phase !== 'ready' || saving;
    $('camera-quality-result').hidden = !state.report;
    $('camera-quality-record').textContent = state.report ? JSON.stringify(state.report, null, 2) : '';
    $('camera-quality-regions').replaceChildren();
    if (!state.report) return;
    const image = state.report.image;
    $('camera-quality-dimensions').textContent = `Image resolution: ${image.oriented_width} × ${image.oriented_height} pixels.`;
    for (const region of state.report.regions.filter(item => ['full_frame', 'subject'].includes(item.id))) {
      const line = root.createElement('p');
      line.textContent = `${region.id === 'subject' ? 'Selected subject region' : 'Full image'} — ${cameraQualityRegionSummary(region)}`;
      $('camera-quality-regions').append(line);
    }
    $('camera-quality-subject-note').textContent = state.report.regions.some(item => item.id === 'subject')
      ? 'The selected region is measured separately. Its content and task suitability still require human review.'
      : 'No subject region selected. A detailed background does not establish useful detail in the intended subject.';
  };
  const analysis = new CameraQualityAnalysis({engine, onState: render});
  const invalidate = () => {
    $('camera-quality-region-inputs').hidden = $('camera-quality-use-region').value !== 'subject';
    analysis.reset();
  };
  $('verify-file').addEventListener('change', invalidate);
  $('camera-quality-use-region').addEventListener('change', invalidate);
  for (const axis of ['x', 'y', 'width', 'height']) $('camera-quality-region-' + axis).addEventListener('input', invalidate);
  $('camera-quality-analyze').addEventListener('click', async () => {
    if ($('camera-quality-analyze').disabled) return;
    try {
      const region = $('camera-quality-use-region').value === 'subject'
        ? Object.fromEntries(['x', 'y', 'width', 'height'].map(key => {
          const text = $('camera-quality-region-' + key).value.trim();
          if (!/^\d+$/.test(text)) throw new Error('Use whole pixel coordinates and a positive subject width and height.');
          return [key, Number(text)];
        })) : null;
      await analysis.analyze($('verify-file').files?.[0], region);
    } catch (error) {
      // Parse errors occur before analyze(), so they must clear any old result.
      if (analysis.phase !== 'error') analysis.reset(message(error));
    }
  });
  $('camera-quality-save').addEventListener('click', async () => {
    if ($('camera-quality-save').disabled) return;
    const revision = analysis.revision;
    saving = true;
    $('camera-quality-save').disabled = true;
    try {
      await analysis.save(saveArtifact);
      if (revision === analysis.revision) $('camera-quality-status').textContent = 'Quality record saved. This unsigned guidance record is separate from evidence verification.';
    } catch (error) {
      if (revision === analysis.revision) $('camera-quality-status').textContent = `Quality record was not saved: ${message(error)}`;
    } finally {
      saving = false;
      $('camera-quality-save').disabled = analysis.phase !== 'ready';
    }
  });
  analysis.reset('Choose a JPEG above, then analyze its image quality. No challenge or signing key is needed for these measurements.');
  return analysis;
}

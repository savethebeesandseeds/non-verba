// SPDX-License-Identifier: AGPL-3.0-only
// Native-owned PCM adapter. Only requests, random challenges and the requester's
// final receipt go into the bridge; recorded audio and probe samples never do.
import {base64ToBytes} from './location-platform.js';
const PIN = /^[0-9a-f]{64}$/;
const MAX_WAV = 8 * 1024 * 1024;
const CHUNK_SAMPLES = 96000;
const MAX_DIAGNOSTICS = 16 * 1024;
const MAX_ROUND_ASSESSMENT = 8192;
const MAX_RESPONSE_ENVELOPE = 64 * 1024;
const NATIVE_SESSION = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
// Android JSONObject escapes Base64 slashes. Bound JSON text separately from decoded bytes.
const base64ResponseLimit = bytes => 2 * Math.ceil(bytes / 3) * 4 + MAX_RESPONSE_ENVELOPE;

function parseResponse(text, max = MAX_RESPONSE_ENVELOPE) {
  if (typeof text !== 'string' || text.length > max) throw new Error('Invalid native microphone response.');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native microphone response.');
  return value;
}
const stopped = value => value.ok === false || ['error', 'cancelled'].includes(value.state);
const stoppedError = value => new Error(typeof value.error === 'string' && value.error ? value.error.slice(0, 400) : 'Native microphone stopped.');
function decode(text, max) {
  const value = parseResponse(text, max);
  if (stopped(value)) throw stoppedError(value);
  return value;
}
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function fields(value, names, optional = []) { return object(value) && names.every(name => Object.hasOwn(value, name)) && Object.keys(value).every(name => names.includes(name) || optional.includes(name)); }
const textField = (value, max) => typeof value === 'string' && value.length <= max;
const count = value => Number.isSafeInteger(value) && value >= 0;
const androidInteger = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
const monotonic = value => typeof value === 'string' && /^[0-9]{1,19}$/.test(value);
const bool = value => typeof value === 'boolean';
function diagnosticFormat(value) {
  return fields(value, ['sample_rate', 'channels', 'encoding', 'android_encoding', 'channel_mask', 'channel_index_mask'])
    && count(value.sample_rate) && count(value.channels)
    && ['pcm-u8', 'pcm-i16', 'pcm-i24', 'pcm-i32', 'pcm-f32', 'unsupported'].includes(value.encoding)
    && ['android_encoding', 'channel_mask', 'channel_index_mask'].every(key => androidInteger(value[key]));
}
function diagnosticStream(value) {
  return fields(value, ['device_id', 'device_type', 'sample_rate', 'channels', 'format', 'sharing_mode', 'performance_mode', 'frames_per_burst', 'buffer_capacity_frames'])
    && ['device_id', 'sample_rate', 'channels', 'frames_per_burst', 'buffer_capacity_frames'].every(key => count(value[key]))
    && ['built-in-mic', 'built-in-speaker'].includes(value.device_type) && value.format === 'pcm-f32'
    && ['shared', 'exclusive'].includes(value.sharing_mode) && ['none', 'low-latency', 'power-saving'].includes(value.performance_mode);
}
function requestedStream(value) {
  return fields(value, ['sample_rate', 'channels', 'format', 'performance_mode']) && value.sample_rate === 48000 && value.channels === 1
    && value.format === 'pcm-f32' && ['none', 'low-latency'].includes(value.performance_mode);
}
function assessmentOutcome(value, maximumStart) {
  const detection = value.detection;
  if (!fields(detection, ['detected', 'score', 'matched_symbols', 'symbol_count', 'offset_samples', 'sample_rate', 'rms', 'in_band_ratio'])
      || !bool(detection.detected) || detection.symbol_count !== 64 || detection.sample_rate !== 48000
      || !count(detection.matched_symbols) || detection.matched_symbols > detection.symbol_count
      || !count(detection.offset_samples) || detection.offset_samples > CHUNK_SAMPLES - 64 * 576
      || !['score', 'rms', 'in_band_ratio'].every(key => typeof detection[key] === 'number' && Number.isFinite(detection[key]) && detection[key] >= 0 && detection[key] <= 1)) return false;
  const reason = !detection.detected ? 'not_detected' : detection.offset_samples > maximumStart ? 'detected_late' : 'passed';
  return value.reason === reason && value.passed === (reason === 'passed');
}
function pilotAssessment(value) {
  return fields(value, ['version', 'type', 'signal_algorithm', 'sample_count', 'maximum_start_offset_samples', 'passed', 'reason', 'detection'])
    && value.version === 1 && value.type === 'nonverba-native-audio-pilot-assessment' && value.signal_algorithm === 'org.nonverba.audio-fsk.v1'
    && value.sample_count === CHUNK_SAMPLES && value.maximum_start_offset_samples === 38400 && bool(value.passed)
    && assessmentOutcome(value, value.maximum_start_offset_samples);
}
function roundAssessment(value, challengeCount, retainedFrames) {
  if (!fields(value, ['version', 'type', 'signal_algorithm', 'sample_format', 'maximum_start_offset_samples', 'passed', 'rounds'])
      || value.version !== 1 || value.type !== 'nonverba-native-audio-round-assessment' || value.signal_algorithm !== 'org.nonverba.audio-fsk.v1'
      || value.sample_format !== 'pcm16' || value.maximum_start_offset_samples !== 38400 || !bool(value.passed)
      || !Array.isArray(value.rounds) || value.rounds.length < 1 || value.rounds.length > 15 || value.rounds.length !== challengeCount
      || retainedFrames !== null && value.rounds.length * CHUNK_SAMPLES > retainedFrames
      || new TextEncoder().encode(JSON.stringify(value)).length > MAX_ROUND_ASSESSMENT) return false;
  return value.rounds.every((round, index) => fields(round, ['index', 'start_sample', 'sample_count', 'passed', 'reason', 'detection'])
    && round.index === index && round.start_sample === index * CHUNK_SAMPLES && round.sample_count === CHUNK_SAMPLES
    && bool(round.passed) && assessmentOutcome(round, value.maximum_start_offset_samples))
    && value.passed === value.rounds.every(round => round.passed);
}
function nativeDecimal(value, positive = false) {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n && (!positive || BigInt(value) > 0n);
}
function pilotNativeTiming(value) {
  if (!fields(value, ['input_session_id', 'observed_monotonic_ns', 'captured_frames', 'record_requested_monotonic_ns', 'record_start_stream_frame',
    'first_input_callback_monotonic_ns', 'last_input_callback_monotonic_ns', 'completed_output_probe'])
    || !androidInteger(value.input_session_id) || value.input_session_id <= 0 || !nativeDecimal(value.observed_monotonic_ns, true)
    || !count(value.captured_frames) || value.captured_frames > CHUNK_SAMPLES
    || !['record_requested_monotonic_ns', 'first_input_callback_monotonic_ns', 'last_input_callback_monotonic_ns'].every(key => value[key] === null
      || nativeDecimal(value[key], true) && BigInt(value[key]) <= BigInt(value.observed_monotonic_ns))
    || !(value.record_start_stream_frame === null || nativeDecimal(value.record_start_stream_frame))) return false;
  // Callback fields are separate atomic observations, not a transactional clock
  // snapshot. An incomplete observation can retain only some timestamps.
  if (value.first_input_callback_monotonic_ns !== null && value.last_input_callback_monotonic_ns !== null
      && BigInt(value.first_input_callback_monotonic_ns) > BigInt(value.last_input_callback_monotonic_ns)) return false;
  const probe = value.completed_output_probe;
  return probe === null || fields(probe, ['index', 'output_start_stream_frame', 'output_end_stream_frame', 'output_first_callback_monotonic_ns', 'input_frame_at_output_start'])
    && probe.index === 0 && nativeDecimal(probe.output_start_stream_frame) && nativeDecimal(probe.output_end_stream_frame)
    && BigInt(probe.output_end_stream_frame) - BigInt(probe.output_start_stream_frame) === 36864n
    && nativeDecimal(probe.output_first_callback_monotonic_ns, true) && BigInt(probe.output_first_callback_monotonic_ns) <= BigInt(value.observed_monotonic_ns)
    && count(probe.input_frame_at_output_start) && probe.input_frame_at_output_start <= CHUNK_SAMPLES;
}
// This is an unsigned diagnostic record, never input to successful audio verification.
function diagnosticSnapshot(value, sessionId, requestId, pin) {
  if (!fields(value, ['version', 'type', 'signed', 'successful_measurement', 'session_id', 'request_session_id', 'key_fingerprint',
    'stopped_state', 'stopping_phase', 'error', 'terminal_elapsed_ms', 'retained_frames_last_observed', 'pilot_probe_enqueued', 'pilot_verified',
    'challenge_count', 'android_recording_configuration_last_observed', 'aaudio_requested', 'aaudio_actual_last_observed', 'diagnostic_errors'], ['pilot_assessment', 'pilot_native_timing_last_observed', 'round_assessment'])) return null;
  if (value.version !== 1 || value.type !== 'nonverba-native-audio-diagnostics' || value.signed !== false || value.successful_measurement !== false
      || !NATIVE_SESSION.test(value.session_id) || value.session_id !== sessionId || !PIN.test(value.request_session_id) || value.request_session_id !== requestId
      || !PIN.test(value.key_fingerprint) || value.key_fingerprint !== pin || !textField(value.stopped_state, 64) || !textField(value.stopping_phase, 64)
      || !textField(value.error, 400) || !count(value.terminal_elapsed_ms) || !(value.retained_frames_last_observed === null || count(value.retained_frames_last_observed))
      || !bool(value.pilot_probe_enqueued) || !bool(value.pilot_verified) || !count(value.challenge_count) || value.challenge_count > 15
      || !Array.isArray(value.diagnostic_errors) || value.diagnostic_errors.length > 8 || !value.diagnostic_errors.every(error => textField(error, 400))) return null;
  const configuration = value.android_recording_configuration_last_observed;
  if (configuration !== null && (!fields(configuration, ['input_session_id', 'observed_monotonic_ns', 'device_id', 'built_in', 'client_silenced',
    'client_source', 'source', 'client_format', 'device_format', 'client_effect_count', 'effect_count'], ['stream_phase'])
    || !['input_session_id', 'device_id', 'client_effect_count', 'effect_count'].every(key => count(configuration[key]))
    || !monotonic(configuration.observed_monotonic_ns) || !bool(configuration.built_in) || !bool(configuration.client_silenced)
    || !androidInteger(configuration.client_source) || !androidInteger(configuration.source)
    || !diagnosticFormat(configuration.client_format) || !diagnosticFormat(configuration.device_format)
    || Object.hasOwn(configuration, 'stream_phase') && !textField(configuration.stream_phase, 64))) return null;
  if (Object.hasOwn(value, 'pilot_assessment') && value.pilot_assessment !== null && !pilotAssessment(value.pilot_assessment)) return null;
  if (Object.hasOwn(value, 'pilot_native_timing_last_observed') && value.pilot_native_timing_last_observed !== null && !pilotNativeTiming(value.pilot_native_timing_last_observed)) return null;
  if (Object.hasOwn(value, 'round_assessment') && value.round_assessment !== null
      && !roundAssessment(value.round_assessment, value.challenge_count, value.retained_frames_last_observed)) return null;
  if (!fields(value.aaudio_requested, ['input', 'output']) || !requestedStream(value.aaudio_requested.input) || !requestedStream(value.aaudio_requested.output)
      || value.aaudio_requested.input.performance_mode !== 'none' || value.aaudio_requested.output.performance_mode !== 'low-latency') return null;
  const actual = value.aaudio_actual_last_observed;
  if (actual !== null && (!fields(actual, ['input', 'output', 'input_session_id', 'captured_frames', 'timestamps_ready', 'observed_monotonic_ns', 'stream_phase'])
    || !diagnosticStream(actual.input) || !diagnosticStream(actual.output) || !count(actual.input_session_id) || !count(actual.captured_frames)
    || !bool(actual.timestamps_ready) || !monotonic(actual.observed_monotonic_ns) || !textField(actual.stream_phase, 64))) return null;
  const encoded = JSON.stringify(value);
  return new TextEncoder().encode(encoded).length <= MAX_DIAGNOSTICS ? JSON.parse(encoded) : null;
}

export function nativeAudioDiagnosticRows(value) {
  const yes = value => value ? 'yes' : 'no';
  const format = value => `${value.sample_rate} Hz, ${value.channels} channel(s), ${value.encoding}; Android encoding ${value.android_encoding}, channel mask ${value.channel_mask}, index mask ${value.channel_index_mask}`;
  const stream = value => `${value.sample_rate} Hz, ${value.channels} channel(s), ${value.format}, ${value.performance_mode}${value.device_type ? `; ${value.device_type} ID ${value.device_id}, ${value.sharing_mode}, burst ${value.frames_per_burst}, capacity ${value.buffer_capacity_frames}` : ''}`;
  const rows = [`Native attempt: ${value.session_id}`, `Original request: ${value.request_session_id}`, `Reporting key ID: ${value.key_fingerprint}`,
    `Unsigned attempt duration: ${value.terminal_elapsed_ms} ms; stopped state: ${value.stopped_state}; phase: ${value.stopping_phase}`,
    `Reason: ${value.error}`, `Last-observed retained frames: ${value.retained_frames_last_observed ?? 'unavailable'}`,
    `Pilot probe enqueued: ${yes(value.pilot_probe_enqueued)} (does not establish playback); pilot verified: ${yes(value.pilot_verified)}; challenges: ${value.challenge_count}`,
    `Requested AAudio input: ${stream(value.aaudio_requested.input)}`, `Requested AAudio output: ${stream(value.aaudio_requested.output)}`];
  const configuration = value.android_recording_configuration_last_observed;
  if (configuration) rows.push(`Android configuration last observed at monotonic ns ${configuration.observed_monotonic_ns}; input session ${configuration.input_session_id}, device ${configuration.device_id}, built-in: ${yes(configuration.built_in)}, client silenced: ${yes(configuration.client_silenced)}; sources client/device ${configuration.client_source}/${configuration.source}; effects client/device ${configuration.client_effect_count}/${configuration.effect_count}`,
    `Last-observed Android configuration stream phase: ${configuration.stream_phase ?? 'unavailable'}`,
    `Last-observed Android client format: ${format(configuration.client_format)}`, `Last-observed Android device format: ${format(configuration.device_format)}`);
  else rows.push('Last-observed Android recording configuration: unavailable.');
  const actual = value.aaudio_actual_last_observed;
  if (actual) rows.push(`AAudio last observed at monotonic ns ${actual.observed_monotonic_ns}; stream phase ${actual.stream_phase}; input session ${actual.input_session_id}, captured frames ${actual.captured_frames}, timestamps ready: ${yes(actual.timestamps_ready)}`,
    `Last-observed AAudio input: ${stream(actual.input)}`, `Last-observed AAudio output: ${stream(actual.output)}`);
  else rows.push('Last-observed AAudio streams: unavailable.');
  const assessment = value.pilot_assessment;
  if (assessment) {
    const detection = assessment.detection;
    rows.push(`Unsigned pilot assessment: ${assessment.reason}; acoustic pilot policy passed: ${yes(assessment.passed)}. This is not a completed measurement.`,
      `Pilot detector: detected ${yes(detection.detected)}; score ${detection.score}; matched symbols ${detection.matched_symbols}/${detection.symbol_count}; best candidate offset ${detection.offset_samples} samples (${(detection.offset_samples / 48).toFixed(2)} ms).`,
      `Pilot interval: ${assessment.sample_count} samples at ${detection.sample_rate} Hz; maximum accepted start ${assessment.maximum_start_offset_samples} samples (800 ms).`,
      `Pilot signal metrics: RMS ${detection.rms}; in-band energy ratio ${detection.in_band_ratio}. Detector score is not a probability of authenticity.`);
  } else rows.push('Pilot assessment: unavailable; no detector metrics were retained.');
  const timing = value.pilot_native_timing_last_observed;
  if (timing) {
    rows.push(`Pilot native timing last observed: input session ${timing.input_session_id}, monotonic ns ${timing.observed_monotonic_ns}, captured pilot frames ${timing.captured_frames}.`,
      `Pilot recording requested at monotonic ns ${timing.record_requested_monotonic_ns ?? 'unavailable'}; input start stream frame ${timing.record_start_stream_frame ?? 'unavailable'}.`,
      `Pilot input callbacks: first monotonic ns ${timing.first_input_callback_monotonic_ns ?? 'unavailable'}; last monotonic ns ${timing.last_input_callback_monotonic_ns ?? 'unavailable'}.`);
    const probe = timing.completed_output_probe;
    if (probe) rows.push(`Pilot output callback completion last observed: round 0, output frames ${probe.output_start_stream_frame} to ${probe.output_end_stream_frame} (36864 samples); first callback monotonic ns ${probe.output_first_callback_monotonic_ns}; captured input frame at start ${probe.input_frame_at_output_start}.`);
    else rows.push('Pilot completed output callback: unavailable in the last observation; enqueueing does not establish callback completion.');
    rows.push('Pilot output callbacks do not establish hardware presentation or physical sound.');
  } else rows.push('Pilot native timing: unavailable; enqueueing does not establish output callback completion.');
  const evidenceRounds = value.round_assessment;
  if (evidenceRounds) {
    rows.push(`Unsigned evidence-round assessment (canonical PCM16): all round checks passed: ${yes(evidenceRounds.passed)}. This is not a completed measurement.`);
    for (const round of evidenceRounds.rounds) {
      const detection = round.detection;
      rows.push(`Evidence round ${round.index + 1}/${evidenceRounds.rounds.length}: ${round.reason}; detected ${yes(detection.detected)}; score ${detection.score}; matched symbols ${detection.matched_symbols}/${detection.symbol_count}; best candidate offset ${detection.offset_samples} samples (${(detection.offset_samples / 48).toFixed(2)} ms); RMS ${detection.rms}; in-band energy ratio ${detection.in_band_ratio}.`);
    }
    rows.push('Evidence-round detector scores are not probabilities of authenticity or physical freshness.');
  } else rows.push('Evidence-round assessment: unavailable; no per-round detector metrics were retained.');
  rows.push(...value.diagnostic_errors.map(error => `Diagnostic collection error: ${error}`));
  return rows.map(row => row.slice(0, 512));
}

export function nativeAudioPlatform(requireCapture = true) {
  const bridge = globalThis.NativeAudio;
  if (!bridge) return null;
  for (const method of ['capabilities', 'begin', 'status', 'round', 'chunk', 'finalize', 'cancel']) {
    if (typeof bridge[method] !== 'function') throw new Error('The native microphone bridge is incomplete.');
  }
  const capabilities = decode(bridge.capabilities());
  if ((requireCapture && capabilities.available !== true) || typeof capabilities.available !== 'boolean' || capabilities.version !== 1 || !PIN.test(capabilities.key_fingerprint)) {
    throw new Error('Native microphone capture requires a supported Android device and built-in audio route.');
  }
  return {bridge, capabilities, fingerprint: capabilities.key_fingerprint};
}

export class NativeAudioCapture {
  #lastDiagnostics = null;
  #lastDiagnosticError = null;
  constructor(platform, request, onFailure) {
    this.platform = platform; this.request = request; this.onFailure = onFailure;
    this.closed = false; this.abort = new AbortController(); this.nextChunk = 0; this.nextRound = 0;
  }
  diagnostics() { return this.#lastDiagnostics ? structuredClone(this.#lastDiagnostics) : null; }
  diagnosticsError() { return this.#lastDiagnosticError; }
  retainDiagnostics(value) {
    if (!stopped(value) || value.session_id !== this.id || value.key_fingerprint !== this.platform.fingerprint) return;
    if (this.#lastDiagnostics || this.#lastDiagnosticError) return;
    const diagnostic = diagnosticSnapshot(value.diagnostics, this.id, this.request.session_id, this.platform.fingerprint);
    if (diagnostic) this.#lastDiagnostics = diagnostic;
    else if (textField(value.diagnostics_error, 160) && value.diagnostics_error) this.#lastDiagnosticError = value.diagnostics_error;
  }
  response(text, max) {
    const value = parseResponse(text, max);
    if (stopped(value)) {
      if (value.session_id !== this.id || value.key_fingerprint !== this.platform.fingerprint) throw new Error('Native microphone session or signing identity changed.');
      this.retainDiagnostics(value);
      const error = stoppedError(value);
      if (this.#lastDiagnostics) error.nativeDiagnostics = this.diagnostics();
      if (this.#lastDiagnosticError) error.nativeDiagnosticsError = this.#lastDiagnosticError;
      throw error;
    }
    return value;
  }
  active() { if (this.closed) throw new DOMException('Native microphone capture cancelled.', 'AbortError'); }
  permissionPending() {
    try { return !!this.id && this.status().state === 'requesting-permission'; } catch { return false; }
  }
  wait() {
    return new Promise((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); this.abort.signal.removeEventListener('abort', cancel); reject(new DOMException('Native microphone capture cancelled.', 'AbortError')); };
      const timer = setTimeout(() => { this.abort.signal.removeEventListener('abort', cancel); resolve(); }, 25);
      this.abort.signal.addEventListener('abort', cancel, {once: true});
      if (this.closed) cancel();
    });
  }
  status(large = false) {
    this.active();
    const result = this.response(this.platform.bridge.status(this.id), large ? base64ResponseLimit(MAX_WAV) : MAX_RESPONSE_ENVELOPE);
    if (result.session_id !== this.id || result.key_fingerprint !== this.platform.fingerprint) throw new Error('Native microphone session or signing identity changed.');
    return result;
  }
  async open() {
    this.active();
    try {
      const begunText = this.platform.bridge.begin(JSON.stringify(this.request)), begun = parseResponse(begunText);
      if (stopped(begun) && (typeof begun.session_id !== 'string' || !begun.session_id)) throw stoppedError(begun);
      if (typeof begun.session_id !== 'string' || !begun.session_id || begun.session_id.length > 64) throw new Error('Native microphone did not create a session.');
      this.id = begun.session_id;
      this.response(begunText);
      const deadline = performance.now() + 20000;
      while (true) {
        const status = this.status();
        if (status.state === 'ready') {
          if (status.pilot_verified !== true) throw new Error('Native speaker and microphone test did not pass.');
          return;
        }
        if (!['requesting-permission', 'preparing', 'pilot'].includes(status.state)) throw new Error('Unexpected native microphone setup state.');
        if (performance.now() > deadline) throw new Error('Native microphone setup timed out.');
        await this.wait();
      }
    } catch (error) { this.close(); throw error; }
  }
  round(round, onChunk) {
    this.active();
    if (round.index !== this.nextRound || round.session_id !== this.request.session_id || !PIN.test(round.nonce)) throw new Error('Native microphone received an unexpected challenge.');
    const accepted = this.response(this.platform.bridge.round(this.id, JSON.stringify({session_id: round.session_id, index: round.index, nonce: round.nonce})));
    if (accepted.session_id !== this.id) throw new Error('Native microphone round session changed.');
    this.nextRound++;
    if (round.index === 0) {
      this.onChunk = onChunk;
      this.polling = this.pollChunks().catch(error => { if (!this.closed) { this.close(); this.onFailure(error); } });
    }
  }
  async pollChunks() {
    const total = this.request.duration_secs / 2, deadline = performance.now() + this.request.duration_secs * 1000 + 7000;
    while (this.nextChunk < total) {
      const status = this.status();
      if (!['recording', 'awaiting-receipt'].includes(status.state)) throw new Error('Native recording ended unexpectedly.');
      const chunk = this.response(this.platform.bridge.chunk(this.id, this.nextChunk), base64ResponseLimit(CHUNK_SAMPLES * 2));
      if (chunk.session_id !== this.id || chunk.index !== this.nextChunk) throw new Error('Native audio segment belongs to another session or position.');
      if (chunk.pending === false) {
        if (this.nextChunk >= this.nextRound || chunk.sample_count !== CHUNK_SAMPLES || !PIN.test(chunk.pcm_sha256)) throw new Error('Native audio segment has no matching challenge or sample count.');
        const bytes = base64ToBytes(chunk.pcm_base64, CHUNK_SAMPLES * 2);
        if (bytes.length !== CHUNK_SAMPLES * 2) throw new Error('Incomplete native microphone segment.');
        const index = this.nextChunk++;
        await this.onChunk(index, bytes); this.active();
      } else if (chunk.pending !== true) throw new Error('Native microphone omitted segment availability.');
      if (performance.now() > deadline) throw new Error('Native microphone delivery timed out.');
      if (this.nextChunk < total) await this.wait();
    }
  }
  async finalize(receipt) {
    this.active();
    if (this.nextChunk !== this.request.duration_secs / 2 || this.nextRound !== this.nextChunk) throw new Error('Native recording is incomplete.');
    const accepted = this.response(this.platform.bridge.finalize(this.id, JSON.stringify(receipt)));
    if (accepted.session_id !== this.id) throw new Error('Native microphone finalization session changed.');
    const deadline = performance.now() + 30000;
    while (true) {
      const status = this.status(true);
      if (status.state === 'complete') {
        if (status.result?.fingerprint !== this.platform.fingerprint || status.result?.media_origin !== 'native-aaudio-pcm') throw new Error('Unexpected native microphone evidence origin.');
        const bytes = base64ToBytes(status.result.wav_base64, MAX_WAV);
        this.active(); return bytes;
      }
      if (status.state !== 'sealing') throw new Error('Native microphone did not begin signing.');
      if (performance.now() > deadline) throw new Error('Native microphone signing timed out.');
      await this.wait();
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.abort.abort();
    if (this.id) { try { this.retainDiagnostics(parseResponse(this.platform.bridge.cancel(this.id))); } catch { /* Keep the original failure. */ } }
  }
}

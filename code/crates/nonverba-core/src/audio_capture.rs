// SPDX-License-Identifier: AGPL-3.0-only
//! Native audio acquisition assertions. These consistency checks describe the
//! application/AAudio path; they never attest hardware or prove acoustic origin.

use serde::{Deserialize, Serialize};

use crate::{
    audio::{AudioCapture, AudioRequest, AudioTranscript, CHUNK_SAMPLES, SAMPLE_RATE},
    err,
};

pub const ASSERTION_LABEL: &str = "org.nonverba.audio.acquisition";

/// Android's application-visible recording configuration, not sensor attestation.
/// Older records omit this object and therefore make no monitoring claim.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordingFormat {
    pub sample_rate: u32,
    pub channels: u32,
    pub encoding: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordingConfiguration {
    pub version: u32,
    pub api_level: u32,
    pub input_session_id: i32,
    pub client_silenced: bool,
    pub client_source: String,
    pub source: String,
    pub device_id: i32,
    pub client_format: RecordingFormat,
    pub device_format: RecordingFormat,
    pub client_effects: Vec<String>,
    pub effects: Vec<String>,
    pub observation_count: u32,
    pub first_observed_monotonic_ns: String,
    pub last_observed_monotonic_ns: String,
    pub observation_monotonic_ns: Vec<String>,
    pub privacy_sensitive_supported: bool,
    pub privacy_sensitive_requested: bool,
    pub privacy_sensitive_actual: Option<bool>,
}

impl RecordingConfiguration {
    fn validate(&self, capture: &AudioCaptureMetadata, now_ms: u64) -> Result<(), String> {
        let first = counter(&self.first_observed_monotonic_ns)?;
        let last = counter(&self.last_observed_monotonic_ns)?;
        let requested = counter(&capture.record_requested_monotonic_ns)?;
        let input_end = counter(&capture.last_input_callback_monotonic_ns)?;
        let received = counter(&capture.request_received_monotonic_ns)?;
        if !(2..=10_000).contains(&self.observation_monotonic_ns.len())
            || self.observation_monotonic_ns.len() != self.observation_count as usize
            || self.observation_monotonic_ns.first() != Some(&self.first_observed_monotonic_ns)
            || self.observation_monotonic_ns.last() != Some(&self.last_observed_monotonic_ns)
        {
            return Err("Native recording observation sequence differs from its summary".into());
        }
        let mut prior = None;
        for observed in &self.observation_monotonic_ns {
            let observed = counter(observed)?;
            if prior.is_some_and(|prior| observed < prior || observed - prior > 1_000_000_000) {
                return Err("Native recording observations regress or contain a gap".into());
            }
            prior = Some(observed);
        }
        let observed_wall = capture
            .request_received_unix_ms
            .checked_add(last.saturating_sub(received) / 1_000_000)
            .ok_or("Native recording configuration clock overflow")?;
        if self.version != 1
            || self.api_level < 29
            || self.input_session_id <= 0
            || self.client_silenced
            || self.client_source != "unprocessed"
            || self.source != "unprocessed"
            || self.device_id != capture.input.device_id
            || self.client_format.sample_rate != SAMPLE_RATE
            || self.client_format.channels != 1
            || self.client_format.encoding != "pcm-f32"
            || !(8_000..=192_000).contains(&self.device_format.sample_rate)
            || !(1..=32).contains(&self.device_format.channels)
            || !matches!(
                self.device_format.encoding.as_str(),
                "pcm-u8" | "pcm-i16" | "pcm-i24" | "pcm-i32" | "pcm-f32"
            )
            || !self.client_effects.is_empty()
            || !self.effects.is_empty()
            || !(2..=10_000).contains(&self.observation_count)
            || first < received
            || first > requested
            || last < input_end
            || last <= first
            || last - input_end > 30_000_000_000
            || observed_wall > now_ms
        {
            return Err("Native recording configuration is silenced, processed, mismatched or incompletely observed".into());
        }
        let privacy = (
            self.privacy_sensitive_supported,
            self.privacy_sensitive_requested,
            self.privacy_sensitive_actual,
        );
        if (self.api_level == 29 && privacy != (false, false, None))
            || (self.api_level >= 30 && privacy != (true, true, Some(true)))
        {
            return Err("Native recording privacy-sensitive configuration is inconsistent".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioStreamMetadata {
    pub device_id: i32,
    pub device_type: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub format: String,
    pub sharing_mode: String,
    pub performance_mode: String,
    pub frames_per_burst: u32,
    pub buffer_capacity_frames: u32,
}

impl AudioStreamMetadata {
    fn validate(&self, device_type: &str) -> Result<(), String> {
        if self.device_id <= 0
            || self.device_type != device_type
            || self.sample_rate != SAMPLE_RATE
            || self.channels != 1
            || self.format != "pcm-f32"
            || !matches!(self.sharing_mode.as_str(), "shared" | "exclusive")
            || !matches!(
                self.performance_mode.as_str(),
                "none" | "low-latency" | "power-saving"
            )
            || self.frames_per_burst == 0
            || self.frames_per_burst > SAMPLE_RATE
            || self.buffer_capacity_frames < self.frames_per_burst
            || self.buffer_capacity_frames > SAMPLE_RATE * 2
        {
            return Err(
                "Native audio stream does not match the requested built-in 48 kHz mono profile"
                    .into(),
            );
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioCheckpoint {
    pub observed_monotonic_ns: String,
    pub input_frame_position: String,
    pub input_timestamp_ns: String,
    pub output_frame_position: String,
    pub output_timestamp_ns: String,
    pub captured_frames: u32,
    pub input_xruns: u32,
    pub output_xruns: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioPlaybackRound {
    pub index: u32,
    pub nonce: String,
    pub received_monotonic_ns: String,
    pub requested_at_frame: u32,
    pub output_start_stream_frame: String,
    pub output_end_stream_frame: String,
    pub output_first_callback_monotonic_ns: String,
    pub input_frame_at_output_start: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioCaptureMetadata {
    pub version: u32,
    #[serde(rename = "type")]
    pub record_type: String,
    pub backend: String,
    pub session_id: String,
    pub request_session_id: String,
    pub request_received_unix_ms: u64,
    pub request_received_monotonic_ns: String,
    pub record_requested_monotonic_ns: String,
    pub completed_unix_ms: u64,
    pub clock: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub format: String,
    pub input_preset: String,
    pub record_start_stream_frame: String,
    pub first_input_callback_monotonic_ns: String,
    pub last_input_callback_monotonic_ns: String,
    pub captured_frames: u32,
    pub input: AudioStreamMetadata,
    pub output: AudioStreamMetadata,
    pub input_xruns: u32,
    pub output_xruns: u32,
    pub xrun_reporting_completeness: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recording_configuration: Option<RecordingConfiguration>,
    pub checkpoints: Vec<AudioCheckpoint>,
    pub rounds: Vec<AudioPlaybackRound>,
    pub keystore_security_level: String,
    pub strongbox_requested: bool,
    pub strongbox_fallback: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sealed_at_unix_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seal_time_origin: Option<String>,
}

impl AudioCaptureMetadata {
    pub fn validate(
        &self,
        request: &AudioRequest,
        transcript: &AudioTranscript,
        now_ms: u64,
    ) -> Result<(), String> {
        let expected_frames = request
            .duration_secs
            .checked_mul(SAMPLE_RATE)
            .ok_or("Native audio requested frame count overflow")?;
        if self.version != 1
            || self.record_type != "nonverba-native-audio-capture"
            || self.backend != "android-aaudio"
            || self.session_id.is_empty()
            || self.session_id.len() > 128
            || self.request_session_id != request.session_id
            || self.clock != "monotonic"
            || self.sample_rate != SAMPLE_RATE
            || self.channels != 1
            || self.format != "pcm-f32"
            || self.input_preset != "unprocessed"
            || self.captured_frames != expected_frames
            || self.captured_frames != transcript.total_samples
            || self.input_xruns != 0
            || self.output_xruns != 0
            || self.xrun_reporting_completeness != "unknown"
            || !matches!(
                self.keystore_security_level.as_str(),
                "strongbox"
                    | "trusted-environment"
                    | "software"
                    | "hardware-unspecified"
                    | "unknown"
            )
            || (self.strongbox_fallback && !self.strongbox_requested)
        {
            return Err(
                "Invalid native audio acquisition profile, frame count or interruption state"
                    .into(),
            );
        }
        self.input.validate("built-in-mic")?;
        self.output.validate("built-in-speaker")?;
        let received = counter(&self.request_received_monotonic_ns)?;
        let requested = counter(&self.record_requested_monotonic_ns)?;
        let first = counter(&self.first_input_callback_monotonic_ns)?;
        let last = counter(&self.last_input_callback_monotonic_ns)?;
        if requested < received
            || first < requested
            || last <= first
            || first - requested > 1_000_000_000
        {
            return Err("Native audio recording callback order is invalid".into());
        }
        let duration_ns = u64::from(request.duration_secs) * 1_000_000_000;
        let callback_tolerance = (u64::from(self.input.buffer_capacity_frames) * 2 * 1_000_000_000
            / u64::from(SAMPLE_RATE))
        .max(100_000_000);
        if (last - first).abs_diff(duration_ns) > callback_tolerance
            || last - requested > duration_ns + 2_000_000_000
        {
            return Err(
                "Native microphone callback duration differs from its retained samples".into(),
            );
        }
        let expected_complete = self
            .request_received_unix_ms
            .checked_add((last - received) / 1_000_000)
            .ok_or("Native audio completion clock overflow")?;
        if self.completed_unix_ms.abs_diff(expected_complete) > 1000
            || self.completed_unix_ms > now_ms
        {
            return Err("Native audio wall and monotonic clocks disagree".into());
        }
        crate::audio::request_at(request, self.request_received_unix_ms / 1000)?;
        crate::audio::request_at(request, self.completed_unix_ms / 1000)?;
        match (self.sealed_at_unix_ms, self.seal_time_origin.as_deref()) {
            (None, None) => {}
            (Some(sealed), Some("native-finalization-start"))
                if sealed >= self.completed_unix_ms
                    && sealed >= expected_complete
                    && sealed <= now_ms
                    && sealed - self.completed_unix_ms <= 30_000 =>
            {
                crate::audio::request_at(request, sealed / 1000)?;
            }
            _ => return Err("Native audio finalization timing is invalid or stale".into()),
        }
        self.validate_checkpoints(requested, last)?;
        self.validate_rounds(transcript, received, requested, last)?;
        if let Some(configuration) = &self.recording_configuration {
            configuration.validate(self, now_ms)?;
        }
        Ok(())
    }

    fn validate_checkpoints(&self, requested: u64, last: u64) -> Result<(), String> {
        if !(2..=512).contains(&self.checkpoints.len())
            || self.checkpoints[0].captured_frames > SAMPLE_RATE
            || self.checkpoints.last().is_none_or(|p| {
                p.captured_frames < self.captured_frames.saturating_sub(SAMPLE_RATE)
            })
        {
            return Err(
                "Native audio requires hardware timestamp checkpoints across the recording".into(),
            );
        }
        if counter(&self.checkpoints[0].observed_monotonic_ns)?
            > requested.saturating_add(1_000_000_000)
            || counter(&self.checkpoints.last().unwrap().observed_monotonic_ns)?
                < last.saturating_sub(1_000_000_000)
        {
            return Err("Native audio hardware checkpoint coverage misses a recording edge".into());
        }
        let start_frame = counter(&self.record_start_stream_frame)?;
        let mut previous: Option<(u64, u64, u64, u64, u64, u32)> = None;
        for point in &self.checkpoints {
            let observed = counter(&point.observed_monotonic_ns)?;
            let input_frame = counter(&point.input_frame_position)?;
            let input_time = counter(&point.input_timestamp_ns)?;
            let output_frame = counter(&point.output_frame_position)?;
            let output_time = counter(&point.output_timestamp_ns)?;
            if observed < requested
                || observed > last.saturating_add(1_000_000_000)
                || input_time > observed
                || output_time > observed
                || observed - input_time > 1_000_000_000
                || observed - output_time > 1_000_000_000
                || point.captured_frames > self.captured_frames
                || point.input_xruns != 0
                || point.output_xruns != 0
                || input_frame
                    .abs_diff(start_frame.saturating_add(u64::from(point.captured_frames)))
                    > u64::from(self.input.buffer_capacity_frames) + u64::from(SAMPLE_RATE)
            {
                return Err("Native audio hardware timestamp checkpoint is stale, interrupted or inconsistent".into());
            }
            if let Some((
                prior_observed,
                prior_input_frame,
                prior_input_time,
                prior_output_frame,
                prior_output_time,
                prior_captured,
            )) = previous
            {
                if observed <= prior_observed
                    || observed - prior_observed > 1_000_000_000
                    || point.captured_frames < prior_captured
                {
                    return Err("Native audio checkpoints are not ordered or contain a gap".into());
                }
                check_rate(prior_input_frame, prior_input_time, input_frame, input_time)?;
                check_rate(
                    prior_output_frame,
                    prior_output_time,
                    output_frame,
                    output_time,
                )?;
            }
            previous = Some((
                observed,
                input_frame,
                input_time,
                output_frame,
                output_time,
                point.captured_frames,
            ));
        }
        Ok(())
    }

    fn validate_rounds(
        &self,
        transcript: &AudioTranscript,
        received: u64,
        requested: u64,
        last: u64,
    ) -> Result<(), String> {
        if self.rounds.len() != transcript.rounds.len() || self.rounds.len() > 15 {
            return Err("Native playback rounds differ from the requester transcript".into());
        }
        let mut previous_received = received;
        let mut previous_end = 0;
        for (index, (round, retained)) in self.rounds.iter().zip(&transcript.rounds).enumerate() {
            let arrival = counter(&round.received_monotonic_ns)?;
            let output_start = counter(&round.output_start_stream_frame)?;
            let output_end = counter(&round.output_end_stream_frame)?;
            let callback = counter(&round.output_first_callback_monotonic_ns)?;
            let start = index as u32 * CHUNK_SAMPLES;
            if round.index != index as u32
                || round.index != retained.index
                || round.nonce != retained.nonce
                || arrival < previous_received
                || arrival > last
                || callback < arrival
                || callback > last
                || callback - arrival > 800_000_000
                || (index > 0 && arrival < requested)
                || round.requested_at_frame < start
                || round.requested_at_frame > start + 36_000
                || round.input_frame_at_output_start < round.requested_at_frame
                || round.input_frame_at_output_start > start + 38_400
                || output_start < previous_end
                || output_end.checked_sub(output_start)
                    != Some(crate::audio_signal::PROBE_SAMPLES as u64)
            {
                return Err("Native audio challenge arrival or playback timing is invalid".into());
            }
            self.validate_playback_clock(output_start, output_end, callback, last)?;
            previous_received = arrival;
            previous_end = output_end;
        }
        Ok(())
    }

    fn validate_playback_clock(
        &self,
        output_start: u64,
        output_end: u64,
        callback: u64,
        last_input: u64,
    ) -> Result<(), String> {
        // AAudio getTimestamp indexes the same stream from frame zero as the
        // callback counters, but timestamps describe presentation, not callback
        // delivery. Preserve a bounded output queue instead of equating them.
        // https://developer.android.com/ndk/reference/group/audio
        let mut nearest: Option<(u64, u64, u64)> = None;
        for point in &self.checkpoints {
            let time = counter(&point.output_timestamp_ns)?;
            let frame = counter(&point.output_frame_position)?;
            let observed = counter(&point.observed_monotonic_ns)?;
            if nearest
                .is_none_or(|(prior, _, _)| time.abs_diff(callback) < prior.abs_diff(callback))
            {
                nearest = Some((time, frame, observed));
            }
        }
        let (time, frame, observed) = nearest.ok_or("Native playback has no hardware timestamp")?;
        let frame_ns = |frames: i128| frames * 1_000_000_000 / i128::from(SAMPLE_RATE);
        let presentation =
            |position: u64| i128::from(time) + frame_ns(i128::from(position) - i128::from(frame));
        // Deliberately broad consistency bounds, not timestamp accuracy or
        // acoustic distance: retain the existing 100ms callback floor, allow
        // 1% clock-rate variation, and include this observation's actual age.
        // Use signed wide arithmetic so backwards projection and Android-long
        // counters cannot underflow or lose precision through floating point.
        let uncertainty = 100_000_000i128
            + i128::from(time.abs_diff(callback)) / 100
            + i128::from(observed - time);
        let output_queue = frame_ns(i128::from(self.output.buffer_capacity_frames) * 2);
        let input_delivery = frame_ns(i128::from(self.input.buffer_capacity_frames) * 2);
        let start = presentation(output_start);
        let end = presentation(output_end);
        if start < i128::from(callback) - uncertainty
            || start > i128::from(callback) + output_queue + uncertainty
            || end > i128::from(last_input) + input_delivery + uncertainty
        {
            return Err(
                "Native audio playback frame positions disagree with its hardware timestamps"
                    .into(),
            );
        }
        Ok(())
    }
}

fn counter(value: &str) -> Result<u64, String> {
    if value.is_empty() || value.len() > 19 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Invalid native audio frame or monotonic counter".into());
    }
    let number: u64 = value.parse().map_err(err)?;
    if number > i64::MAX as u64 || number.to_string() != value {
        return Err("Native audio counters must be canonical nonnegative Android longs".into());
    }
    Ok(number)
}

fn check_rate(old_frame: u64, old_time: u64, frame: u64, time: u64) -> Result<(), String> {
    if frame <= old_frame || time <= old_time {
        return Err("Native stream hardware clocks stopped or went backwards".into());
    }
    let elapsed = time - old_time;
    let actual_frames = u128::from(frame - old_frame);
    let expected_frames = u128::from(elapsed) * u128::from(SAMPLE_RATE) / 1_000_000_000;
    // Broad consistency tolerance, not a calibrated oscillator or distance claim.
    if actual_frames.abs_diff(expected_frames) > 480 + expected_frames / 100 {
        return Err("Native stream hardware frame rate disagrees with its timestamps".into());
    }
    Ok(())
}

pub(crate) fn read_assertion(
    manifest: &c2pa::Manifest,
    capture: Option<&AudioCapture>,
    now_secs: u64,
) -> Result<Option<AudioCaptureMetadata>, String> {
    // Read-side C2PA labels omit instance suffixes. Count all exact-domain
    // instances and decode that selected assertion, never a prefix lookalike.
    let mut assertions = manifest
        .assertions()
        .iter()
        .filter(|assertion| assertion.label() == ASSERTION_LABEL);
    let Some(assertion) = assertions.next() else {
        return Ok(None);
    };
    if assertions.next().is_some() {
        return Err("Native audio acquisition assertion must be unique".into());
    }
    let metadata: AudioCaptureMetadata = assertion.to_assertion().map_err(err)?;
    let capture = capture.ok_or("Native audio metadata requires the signed recording assertion")?;
    let sealed = metadata
        .sealed_at_unix_ms
        .ok_or("Native audio assertion is missing its finalization timestamp")?;
    if sealed / 1000 != capture.signed_at {
        return Err("Native audio finalization time differs from the signed recording".into());
    }
    let now_ms = now_secs
        .checked_mul(1000)
        .and_then(|value| value.checked_add(999))
        .ok_or("Native audio verification time overflow")?;
    metadata.validate(&capture.request, &capture.transcript, now_ms)?;
    Ok(Some(metadata))
}

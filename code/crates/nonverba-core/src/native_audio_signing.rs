// SPDX-License-Identifier: AGPL-3.0-only
//! Native-owned audio protocol validation and C2PA sealing helpers.

use std::{collections::HashSet, io::Cursor};

use serde::{Deserialize, Serialize};

use crate::{
    audio::{AudioRequest, AudioRound, AudioTranscript, CHUNK_SAMPLES},
    audio_capture::{AudioCaptureMetadata, ASSERTION_LABEL},
    err,
    native_signer::ExternalSigner,
    parse, seconds,
};

/// Validate all retained round identities before accepting the next fresh nonce.
pub fn validate_round(
    request_json: &str,
    round_json: &str,
    prior_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let request: AudioRequest = parse(&crate::validate_audio_request(request_json, now_secs)?)?;
    let prior: Vec<AudioRound> = parse(prior_json)?;
    let round: AudioRound = parse(round_json)?;
    if prior.len() >= (request.duration_secs / 2) as usize || round.index != prior.len() as u32 {
        return Err("Native audio challenge is not the next recording round".into());
    }
    validate_rounds(&request, prior.iter().chain(std::iter::once(&round)))?;
    serde_json::to_string(&round).map_err(err)
}

fn validate_rounds<'a>(
    request: &AudioRequest,
    rounds: impl Iterator<Item = &'a AudioRound>,
) -> Result<(), String> {
    let mut nonces = HashSet::new();
    for (index, round) in rounds.enumerate() {
        if round.session_id != request.session_id
            || round.index != index as u32
            || round.index >= request.duration_secs / 2
            || round.nonce.len() != 64
            || !round
                .nonce
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || !nonces.insert(&round.nonce)
        {
            return Err("Native audio rounds must have distinct nonces and contiguous session-bound indexes".into());
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RequesterReceipt {
    version: u32,
    #[serde(rename = "type")]
    receipt_type: String,
    request: AudioRequest,
    transcript: AudioTranscript,
}

/// Receipt transport is untrusted: only the exact retained request and nonce
/// sequence can complete this session. The final sealer also checks actual PCM.
pub fn validate_receipt(
    request_json: &str,
    rounds_json: &str,
    receipt_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let request: AudioRequest = parse(&crate::validate_audio_request(request_json, now_secs)?)?;
    let rounds: Vec<AudioRound> = parse(rounds_json)?;
    let receipt: RequesterReceipt = parse(receipt_json)?;
    let expected_type = if request.demo {
        "nonverba-audio-demo-receipt"
    } else {
        "nonverba-audio-receipt"
    };
    if receipt.version != 1
        || receipt.receipt_type != expected_type
        || receipt.request != request
        || rounds.len() != (request.duration_secs / 2) as usize
        || receipt.transcript.rounds.len() != rounds.len()
        || receipt.transcript.completed_at > seconds(now_secs)?
    {
        return Err("Native audio receipt differs from the original request or demo role".into());
    }
    validate_rounds(&request, rounds.iter())?;
    if rounds
        .iter()
        .zip(&receipt.transcript.rounds)
        .any(|(original, received)| {
            original.index != received.index || original.nonce != received.nonce
        })
    {
        return Err("Native audio receipt differs from the challenges actually played".into());
    }
    crate::audio::transcript_shape(&request, &receipt.transcript)?;
    serde_json::to_string(&receipt.transcript).map_err(err)
}

const PILOT_MAXIMUM_START_OFFSET_SAMPLES: u32 = crate::audio::LATEST_PROBE_OFFSET;
pub const MAX_ROUND_ASSESSMENT_JSON_BYTES: usize = 8192;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum PilotReason {
    Passed,
    NotDetected,
    DetectedLate,
}

#[derive(Serialize)]
struct PilotAssessment {
    version: u32,
    #[serde(rename = "type")]
    assessment_type: &'static str,
    signal_algorithm: &'static str,
    sample_count: u32,
    maximum_start_offset_samples: u32,
    passed: bool,
    reason: PilotReason,
    detection: crate::audio_signal::Detection,
}

#[derive(Serialize)]
struct NativeRoundAssessment {
    version: u32,
    #[serde(rename = "type")]
    assessment_type: &'static str,
    signal_algorithm: &'static str,
    sample_format: &'static str,
    maximum_start_offset_samples: u32,
    passed: bool,
    rounds: Vec<NativeRoundAssessmentEntry>,
}

#[derive(Serialize)]
struct NativeRoundAssessmentEntry {
    index: u32,
    start_sample: u32,
    sample_count: u32,
    passed: bool,
    reason: PilotReason,
    detection: crate::audio_signal::Detection,
}

/// Unsigned native diagnostics from the exact canonical detections already used
/// by sealing. No request, nonce, PCM, signature or readiness fallback is added.
pub(crate) fn serialize_round_assessment(
    transcript: &AudioTranscript,
    detections: &[crate::audio_signal::Detection],
) -> Result<String, String> {
    if detections.len() != transcript.rounds.len() || detections.is_empty() || detections.len() > 15
    {
        return Err("Native audio round assessment has an invalid round count".into());
    }
    let rounds: Vec<_> = transcript
        .rounds
        .iter()
        .zip(detections)
        .map(|(round, detection)| {
            let reason = if !detection.detected {
                PilotReason::NotDetected
            } else if detection.offset_samples > crate::audio::LATEST_PROBE_OFFSET {
                PilotReason::DetectedLate
            } else {
                PilotReason::Passed
            };
            NativeRoundAssessmentEntry {
                index: round.index,
                start_sample: round.start_sample,
                sample_count: round.sample_count,
                passed: reason == PilotReason::Passed,
                reason,
                detection: detection.clone(),
            }
        })
        .collect();
    let assessment = NativeRoundAssessment {
        version: 1,
        assessment_type: "nonverba-native-audio-round-assessment",
        signal_algorithm: crate::audio_signal::PROFILE,
        sample_format: "pcm16",
        maximum_start_offset_samples: crate::audio::LATEST_PROBE_OFFSET,
        passed: rounds.iter().all(|round| round.passed),
        rounds,
    };
    let json = serde_json::to_string(&assessment).map_err(err)?;
    if json.len() > MAX_ROUND_ASSESSMENT_JSON_BYTES {
        return Err("Native audio round assessment exceeds its byte bound".into());
    }
    Ok(json)
}

impl PilotAssessment {
    fn from_detection(detection: crate::audio_signal::Detection) -> Self {
        let reason = if !detection.detected {
            PilotReason::NotDetected
        } else if detection.offset_samples > PILOT_MAXIMUM_START_OFFSET_SAMPLES {
            PilotReason::DetectedLate
        } else {
            PilotReason::Passed
        };
        Self {
            version: 1,
            assessment_type: "nonverba-native-audio-pilot-assessment",
            signal_algorithm: crate::audio_signal::PROFILE,
            sample_count: CHUNK_SAMPLES,
            maximum_start_offset_samples: PILOT_MAXIMUM_START_OFFSET_SAMPLES,
            passed: reason == PilotReason::Passed,
            reason,
            detection,
        }
    }
}

fn assess_pilot(pcm: &[f32], round_json: &str) -> Result<PilotAssessment, String> {
    if pcm.len() != CHUNK_SAMPLES as usize {
        return Err("Native audio pilot requires exactly two seconds of microphone samples".into());
    }
    let round: AudioRound = parse(round_json)?;
    let detection = crate::audio_signal::detect(
        pcm,
        crate::audio::SAMPLE_RATE,
        &round.session_id,
        round.index,
        &round.nonce,
    )?;
    let assessment = PilotAssessment::from_detection(detection);
    if assessment.detection.detected {
        // Preserve both ordinary success and every detected-late refusal.
        return Ok(assessment);
    }
    // A sub-floor peak can hide a qualifying marker. Readiness alone retries
    // global selection among candidates meeting all unchanged detection gates.
    // Never clip the search to the deadline: a late marker's rising flank could
    // otherwise be promoted. Public detection and signed audio keep their
    // original selection policy, including the unresolved late-repeat ambiguity.
    if let Some(qualifying) = crate::audio_signal::detect_qualifying_peak(
        pcm,
        crate::audio::SAMPLE_RATE,
        &round.session_id,
        round.index,
        &round.nonce,
    )? {
        let fallback = PilotAssessment::from_detection(qualifying);
        if fallback.passed {
            return Ok(fallback);
        }
    }
    // Preserve the complete original refusal and its full-window metrics.
    Ok(assessment)
}

/// An unsigned setup diagnostic derived from the retained native pilot only.
/// It reports the unchanged detector and timing policy, never successful audio
/// evidence, a calibrated acoustic diagnosis or the cause of a refusal.
pub fn inspect_pilot(pcm: &[f32], round_json: &str) -> Result<String, String> {
    serde_json::to_string(&assess_pilot(pcm, round_json)?).map_err(err)
}

pub fn validate_pilot(pcm: &[f32], round_json: &str) -> Result<String, String> {
    let assessment = assess_pilot(pcm, round_json)?;
    if !assessment.passed {
        return Err("Native microphone/speaker pilot did not recover the timely challenge".into());
    }
    // Keep the successful legacy return shape compatible with existing callers.
    serde_json::to_string(&assessment.detection).map_err(err)
}

impl ExternalSigner<'_> {
    /// The native session must supply only its retained microphone samples.
    /// Nothing in this method exposes a JavaScript waveform/signing interface.
    pub fn seal_native_audio(
        &self,
        pcm: &[f32],
        request_json: &str,
        transcript_json: &str,
        metadata: &AudioCaptureMetadata,
        now_ms: u64,
    ) -> Result<Vec<u8>, String> {
        self.seal_native_audio_inner(pcm, request_json, transcript_json, metadata, now_ms, None)
    }

    /// Preserve bounded unsigned round checks even if policy or signing later
    /// refuses. The caller owns the slot; it never enters the signed assertions.
    #[allow(clippy::too_many_arguments)]
    pub fn seal_native_audio_observed(
        &self,
        pcm: &[f32],
        request_json: &str,
        transcript_json: &str,
        metadata: &AudioCaptureMetadata,
        now_ms: u64,
        round_assessment: &mut Option<String>,
    ) -> Result<Vec<u8>, String> {
        *round_assessment = None;
        self.seal_native_audio_inner(
            pcm,
            request_json,
            transcript_json,
            metadata,
            now_ms,
            Some(round_assessment),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn seal_native_audio_inner(
        &self,
        pcm: &[f32],
        request_json: &str,
        transcript_json: &str,
        metadata: &AudioCaptureMetadata,
        now_ms: u64,
        round_assessment: Option<&mut Option<String>>,
    ) -> Result<Vec<u8>, String> {
        let request: AudioRequest = parse(request_json)?;
        let transcript: AudioTranscript = parse(transcript_json)?;
        crate::audio::request_at(&request, now_ms / 1000)?;
        crate::audio::transcript_shape(&request, &transcript)?;
        if metadata.recording_configuration.is_none() {
            return Err(
                "New native audio capture requires observed recording configuration".into(),
            );
        }
        metadata.validate(&request, &transcript, now_ms)?;
        if metadata.sealed_at_unix_ms.is_some() || metadata.seal_time_origin.is_some() {
            return Err("Native audio finalization timing must be assigned by Rust".into());
        }
        let mut metadata = metadata.clone();
        metadata.sealed_at_unix_ms = Some(now_ms);
        metadata.seal_time_origin = Some("native-finalization-start".into());
        metadata.validate(&request, &transcript, now_ms)?;
        let (mut builder, mut source) = match round_assessment {
            Some(slot) => crate::audio::prepare_audio_observed(
                pcm,
                request_json,
                transcript_json,
                (now_ms / 1000) as f64,
                self.fingerprint(),
                slot,
            ),
            None => crate::audio::prepare_audio(
                pcm,
                request_json,
                transcript_json,
                (now_ms / 1000) as f64,
                self.fingerprint(),
            ),
        }?;
        builder
            .add_assertion(ASSERTION_LABEL, &metadata)
            .map_err(err)?;
        let mut destination = Cursor::new(Vec::new());
        builder
            .sign(self, "audio/wav", &mut source, &mut destination)
            .map_err(err)?;
        Ok(destination.into_inner())
    }
}

#[cfg(test)]
#[path = "native_audio_signing/pilot_tests.rs"]
mod pilot_tests;

#[cfg(test)]
#[path = "native_audio_signing/playback_tests.rs"]
mod playback_tests;

#[cfg(test)]
#[path = "native_audio_signing/round_assessment_tests.rs"]
mod round_assessment_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::{AudioReceipt, SAMPLE_RATE};
    use futures::executor::block_on;
    use p256::{
        ecdsa::{signature::Signer as _, Signature},
        pkcs8::EncodePublicKey,
    };
    use serde_json::{json, Value};

    const NOW: f64 = 1_790_424_000.0;

    pub(super) fn fixture() -> (
        AudioRequest,
        AudioTranscript,
        Vec<AudioRound>,
        Vec<f32>,
        AudioCaptureMetadata,
    ) {
        let request: AudioRequest = parse(
            &crate::create_audio_request("requester", "Native microphone fixture", NOW, 120, 4)
                .unwrap(),
        )
        .unwrap();
        let request_json = serde_json::to_string(&request).unwrap();
        let mut samples = vec![0.0; 4 * SAMPLE_RATE as usize];
        let mut rounds = Vec::new();
        let mut receipts = Vec::new();
        let mut playback = Vec::new();
        for index in 0..2 {
            let round: AudioRound = parse(
                &crate::create_audio_round(&request_json, index, NOW + 1.0 + f64::from(index * 2))
                    .unwrap(),
            )
            .unwrap();
            let probe = crate::audio_probe(&round.session_id, index, &round.nonce).unwrap();
            let start = (index * CHUNK_SAMPLES) as usize;
            samples[start + 4800..start + 4800 + probe.len()].copy_from_slice(&probe);
            receipts.push(AudioReceipt {
                index,
                nonce: round.nonce.clone(),
                issued_elapsed_ms: index * 2010,
                received_elapsed_ms: index * 2010 + 2000,
                pcm_sha256: crate::hash_audio_pcm(&samples[start..start + CHUNK_SAMPLES as usize])
                    .unwrap(),
                start_sample: index * CHUNK_SAMPLES,
                sample_count: CHUNK_SAMPLES,
            });
            playback.push(json!({"index":index,"nonce":round.nonce,
                "received_monotonic_ns":(2_000_000_000u64 + u64::from(index) * 2_010_000_000).to_string(),
                "requested_at_frame":index * 96_480,
                "output_start_stream_frame":(52_800 + index * 96_000).to_string(),
                "output_end_stream_frame":(89_664 + index * 96_000).to_string(),
                "output_first_callback_monotonic_ns":(2_100_000_000u64 + u64::from(index) * 2_000_000_000).to_string(),
                "input_frame_at_output_start":4800 + index * CHUNK_SAMPLES}));
            rounds.push(round);
        }
        let transcript = AudioTranscript {
            version: 1,
            session_id: request.session_id.clone(),
            started_at: NOW as u64 + 1,
            completed_at: NOW as u64 + 5,
            total_samples: samples.len() as u32,
            rounds: receipts,
        };
        let stream = |kind| {
            json!({"device_id":if kind == "built-in-mic" {1} else {2},"device_type":kind,
            "sample_rate":48000,"channels":1,"format":"pcm-f32","sharing_mode":"shared",
            "performance_mode":"low-latency","frames_per_burst":192,"buffer_capacity_frames":1536})
        };
        let recording_configuration = json!({
            "version":1,"api_level":29,"input_session_id":42,"client_silenced":false,
            "client_source":"unprocessed","source":"unprocessed","device_id":1,
            "client_format":{"sample_rate":48000,"channels":1,"encoding":"pcm-f32"},
            "device_format":{"sample_rate":48000,"channels":1,"encoding":"pcm-i16"},
            "client_effects":[],"effects":[],"observation_count":6,
            "first_observed_monotonic_ns":"1500000000","last_observed_monotonic_ns":"6010000000",
            "observation_monotonic_ns":["1500000000","2500000000","3500000000","4500000000","5500000000","6010000000"],
            "privacy_sensitive_supported":false,"privacy_sensitive_requested":false,"privacy_sensitive_actual":null
        });
        let metadata = serde_json::from_value(json!({
            "version":1,"type":"nonverba-native-audio-capture","backend":"android-aaudio","session_id":"native-audio-session",
            "request_session_id":request.session_id,"request_received_unix_ms":(NOW * 1000.0) as u64,
            "request_received_monotonic_ns":"1000000000","record_requested_monotonic_ns":"2000000000",
            "completed_unix_ms":(NOW * 1000.0) as u64 + 5004,"clock":"monotonic","sample_rate":48000,
            "channels":1,"format":"pcm-f32","input_preset":"unprocessed","record_start_stream_frame":"48000",
            "first_input_callback_monotonic_ns":"2004000000","last_input_callback_monotonic_ns":"6004000000",
            "captured_frames":192000,"input":stream("built-in-mic"),"output":stream("built-in-speaker"),
            "input_xruns":0,"output_xruns":0,"xrun_reporting_completeness":"unknown",
            "recording_configuration":recording_configuration,
            "checkpoints":[
                {"observed_monotonic_ns":"2510000000","input_frame_position":"72000","input_timestamp_ns":"2500000000",
                 "output_frame_position":"72000","output_timestamp_ns":"2500000000","captured_frames":24000,"input_xruns":0,"output_xruns":0},
                {"observed_monotonic_ns":"3510000000","input_frame_position":"120000","input_timestamp_ns":"3500000000",
                 "output_frame_position":"120000","output_timestamp_ns":"3500000000","captured_frames":72000,"input_xruns":0,"output_xruns":0},
                {"observed_monotonic_ns":"4510000000","input_frame_position":"168000","input_timestamp_ns":"4500000000",
                 "output_frame_position":"168000","output_timestamp_ns":"4500000000","captured_frames":120000,"input_xruns":0,"output_xruns":0},
                {"observed_monotonic_ns":"5510000000","input_frame_position":"216000","input_timestamp_ns":"5500000000",
                 "output_frame_position":"216000","output_timestamp_ns":"5500000000","captured_frames":168000,"input_xruns":0,"output_xruns":0}],
            "rounds":playback,"keystore_security_level":"software","strongbox_requested":false,"strongbox_fallback":false
        })).unwrap();
        (request, transcript, rounds, samples, metadata)
    }

    #[test]
    fn native_audio_rounds_and_receipts_cannot_substitute_roles_or_nonces() {
        let (request, transcript, rounds, _, _) = fixture();
        let request_json = serde_json::to_string(&request).unwrap();
        let round = serde_json::to_string(&rounds[1]).unwrap();
        let prior = serde_json::to_string(&rounds[..1]).unwrap();
        validate_round(&request_json, &round, &prior, NOW + 3.0).unwrap();
        assert!(validate_round(&request_json, &round, "[]", NOW + 3.0).is_err());
        let mut duplicate = rounds[1].clone();
        duplicate.nonce = rounds[0].nonce.clone();
        assert!(validate_round(
            &request_json,
            &serde_json::to_string(&duplicate).unwrap(),
            &prior,
            NOW + 3.0
        )
        .is_err());
        let mut receipt = json!({"version":1,"type":"nonverba-audio-receipt","request":request,"transcript":transcript});
        let rounds = serde_json::to_string(&rounds).unwrap();
        validate_receipt(&request_json, &rounds, &receipt.to_string(), NOW + 6.0).unwrap();
        receipt["type"] = json!("nonverba-audio-demo-receipt");
        assert!(validate_receipt(&request_json, &rounds, &receipt.to_string(), NOW + 6.0).is_err());
        receipt["type"] = json!("nonverba-audio-receipt");
        receipt["transcript"]["rounds"][0]["nonce"] = json!("1".repeat(64));
        assert!(validate_receipt(&request_json, &rounds, &receipt.to_string(), NOW + 6.0).is_err());
    }

    #[test]
    fn native_audio_pilot_requires_actual_complete_timely_samples() {
        let (_, _, rounds, samples, _) = fixture();
        let round = serde_json::to_string(&rounds[0]).unwrap();
        validate_pilot(&samples[..CHUNK_SAMPLES as usize], &round).unwrap();
        assert!(validate_pilot(&vec![0.0; CHUNK_SAMPLES as usize], &round).is_err());
        assert!(validate_pilot(&samples[..100], &round).is_err());
    }

    #[test]
    fn native_audio_metadata_rejects_route_clock_dropout_and_playback_substitution() {
        let (request, transcript, _, _, valid) = fixture();
        let now = (NOW * 1000.0) as u64 + 6000;
        valid.validate(&request, &transcript, now).unwrap();
        let mut bad = valid.clone();
        bad.input.device_type = "bluetooth".into();
        assert!(bad.validate(&request, &transcript, now).is_err());
        let mut bad = valid.clone();
        bad.input_xruns = 1;
        assert!(bad.validate(&request, &transcript, now).is_err());
        let mut bad = valid.clone();
        bad.checkpoints[1].input_timestamp_ns = "4500000000".into();
        assert!(bad.validate(&request, &transcript, now).is_err());
        let mut bad = valid.clone();
        bad.rounds[1].nonce = "0".repeat(64);
        assert!(bad.validate(&request, &transcript, now).is_err());
        let mut bad = valid.clone();
        bad.rounds[1].requested_at_frame = 96_000 + 36_001;
        assert!(bad.validate(&request, &transcript, now).is_err());
        let mut bad = valid.clone();
        bad.checkpoints.remove(0);
        assert!(bad.validate(&request, &transcript, now).is_err());
        let mut bad = valid.clone();
        bad.checkpoints.remove(1);
        assert!(bad.validate(&request, &transcript, now).is_err());
        let mut bad = valid;
        // A wall-clock tolerance must not allow signing before the last input
        // callback mapped from the retained monotonic anchor.
        bad.completed_unix_ms -= 500;
        bad.sealed_at_unix_ms = Some(bad.completed_unix_ms);
        bad.seal_time_origin = Some("native-finalization-start".into());
        assert!(bad.validate(&request, &transcript, now).is_err());
    }

    #[test]
    fn recording_configuration_requires_unsilenced_unprocessed_observation_coverage() {
        let (request, transcript, _, _, valid) = fixture();
        let now = (NOW * 1000.0) as u64 + 6000;
        let original = serde_json::to_value(&valid).unwrap();
        for (field, value) in [
            ("api_level", json!(28)),
            ("input_session_id", json!(0)),
            ("client_silenced", json!(true)),
            ("source", json!("voice-recognition")),
            ("client_source", json!("mic")),
            ("device_id", json!(2)),
            ("effects", json!(["automatic-gain-control"])),
            ("client_effects", json!(["noise-suppression"])),
            ("observation_count", json!(1)),
            ("first_observed_monotonic_ns", json!("2000000001")),
            ("last_observed_monotonic_ns", json!("6003999999")),
            ("privacy_sensitive_actual", json!(true)),
            (
                "client_format",
                json!({"sample_rate":44100,"channels":1,"encoding":"pcm-f32"}),
            ),
            (
                "device_format",
                json!({"sample_rate":48000,"channels":1,"encoding":"mp3"}),
            ),
        ] {
            let mut changed = original.clone();
            changed["recording_configuration"][field] = value;
            let changed: AudioCaptureMetadata = serde_json::from_value(changed).unwrap();
            assert!(
                changed.validate(&request, &transcript, now).is_err(),
                "{field}"
            );
        }
        let mut modern = valid.clone();
        let configuration = modern.recording_configuration.as_mut().unwrap();
        configuration.api_level = 30;
        assert!(modern.validate(&request, &transcript, now).is_err());
        let configuration = modern.recording_configuration.as_mut().unwrap();
        configuration.privacy_sensitive_supported = true;
        configuration.privacy_sensitive_requested = true;
        configuration.privacy_sensitive_actual = Some(true);
        modern.validate(&request, &transcript, now).unwrap();
        // A historical record can remain readable without asserting this capability.
        modern.recording_configuration = None;
        modern.validate(&request, &transcript, now).unwrap();
    }

    #[test]
    fn recording_observation_sequence_cannot_hide_gaps_or_reordered_samples() {
        let (request, transcript, _, _, valid) = fixture();
        let now = (NOW * 1000.0) as u64 + 6000;
        for (index, replacement) in [
            (1, "2500000001"),
            (1, "1499999999"),
            (2, "03500000000"),
            (5, "6000000000"),
        ] {
            let mut changed = valid.clone();
            changed
                .recording_configuration
                .as_mut()
                .unwrap()
                .observation_monotonic_ns[index] = replacement.into();
            assert!(
                changed.validate(&request, &transcript, now).is_err(),
                "{index}: {replacement}"
            );
        }
        let mut omitted = valid.clone();
        let configuration = omitted.recording_configuration.as_mut().unwrap();
        configuration.observation_monotonic_ns.remove(2);
        configuration.observation_count -= 1;
        assert!(
            omitted.validate(&request, &transcript, now).is_err(),
            "Matching summary must not conceal a two-second gap"
        );
        let mut over_limit = valid.clone();
        let configuration = over_limit.recording_configuration.as_mut().unwrap();
        configuration.observation_monotonic_ns = vec!["1500000000".into(); 10_001];
        configuration.observation_count = 10_001;
        assert!(over_limit.validate(&request, &transcript, now).is_err());
        let mut simultaneous = valid.clone();
        let configuration = simultaneous.recording_configuration.as_mut().unwrap();
        configuration
            .observation_monotonic_ns
            .insert(1, "1500000000".into());
        configuration.observation_count += 1;
        simultaneous.validate(&request, &transcript, now).unwrap();
        let mut missing = serde_json::to_value(&valid).unwrap();
        missing["recording_configuration"]
            .as_object_mut()
            .unwrap()
            .remove("observation_monotonic_ns");
        assert!(serde_json::from_value::<AudioCaptureMetadata>(missing).is_err());
    }

    #[test]
    fn policy_v2_requires_actual_signed_recording_monitoring_without_downgrading_history() {
        let (request, transcript, _, samples, metadata) = fixture();
        let request_json = serde_json::to_string(&request).unwrap();
        let transcript_json = serde_json::to_string(&transcript).unwrap();
        let key = crate::CertificateKey::generate().unwrap().key;
        let spki = key.verifying_key().to_public_key_der().unwrap();
        let certs = crate::native_signer::create_certificate_chain(spki.as_bytes()).unwrap();
        let mut callback = |message: &[u8]| {
            let signature: Signature = key.sign(message);
            Ok(signature.to_der().as_bytes().to_vec())
        };
        let signer = ExternalSigner::new(&certs, spki.as_bytes(), &mut callback).unwrap();
        let current = signer
            .seal_native_audio(
                &samples,
                &request_json,
                &transcript_json,
                &metadata,
                (NOW * 1000.0) as u64 + 6000,
            )
            .unwrap();
        let browser = signer
            .seal_audio(&samples, &request_json, &transcript_json, NOW + 6.0)
            .unwrap();
        // Recreate a legitimate historical assertion. Current native sealing
        // deliberately refuses to produce this older, unmonitored profile.
        let mut legacy = metadata.clone();
        legacy.recording_configuration = None;
        legacy.sealed_at_unix_ms = Some((NOW * 1000.0) as u64 + 6000);
        legacy.seal_time_origin = Some("native-finalization-start".into());
        let (mut builder, mut source) = crate::audio::prepare_audio(
            &samples,
            &request_json,
            &transcript_json,
            NOW + 6.0,
            signer.fingerprint(),
        )
        .unwrap();
        builder.add_assertion(ASSERTION_LABEL, &legacy).unwrap();
        let mut destination = Cursor::new(Vec::new());
        builder
            .sign(&signer, "audio/wav", &mut source, &mut destination)
            .unwrap();
        let legacy = destination.into_inner();
        let v1 = json!({"version":1,"native_acquisition_required":true,"raw_gnss_required":false,"correlated_camera_clock_required":false,"hardware_attestation_required":false,"independent_position_required":false});
        let mut v2 = v1.clone();
        v2["version"] = json!(2);
        v2["audio_recording_monitoring_required"] = json!(true);
        let appraise = |bytes: &[u8], policy: &Value| -> Value {
            serde_json::from_str(
                &block_on(crate::agent_appraisal::appraise_audio_with_context(
                    bytes,
                    &request_json,
                    &transcript_json,
                    signer.fingerprint(),
                    &policy.to_string(),
                    r#"{"version":1}"#,
                    NOW + 7.0,
                ))
                .unwrap(),
            )
            .unwrap()
        };
        assert_eq!(appraise(&legacy, &v1)["policy_satisfied"], true);
        for bytes in [&legacy, &browser] {
            let report = appraise(bytes, &v2);
            assert_eq!(report["evidence_verified"], true, "{report}");
            assert_eq!(report["policy_satisfied"], false);
            assert!(report["missing_requirements"]
                .as_array()
                .unwrap()
                .contains(&json!("audio_recording_monitoring")));
        }
        let report = appraise(&current, &v2);
        assert_eq!(report["policy_satisfied"], true, "{report}");
        assert_eq!(report["fresh_action_eligible"], true);
        assert_eq!(report["physical_measurement_authenticity_proven"], false);
        v2["audio_recording_monitoring_required"] = json!(false);
        assert_eq!(appraise(&legacy, &v2)["policy_satisfied"], true);
    }

    #[test]
    fn native_audio_roundtrip_and_signed_invalid_metadata_use_independent_verifier() {
        let (request, transcript, _, samples, metadata) = fixture();
        let request_json = serde_json::to_string(&request).unwrap();
        let transcript_json = serde_json::to_string(&transcript).unwrap();
        let key = crate::CertificateKey::generate().unwrap().key;
        let spki = key.verifying_key().to_public_key_der().unwrap();
        let certs = crate::native_signer::create_certificate_chain(spki.as_bytes()).unwrap();
        let mut callback = |message: &[u8]| {
            let signature: Signature = key.sign(message);
            Ok(signature.to_der().as_bytes().to_vec())
        };
        let signer = ExternalSigner::new(&certs, spki.as_bytes(), &mut callback).unwrap();
        let mut legacy = metadata.clone();
        legacy.recording_configuration = None;
        assert!(signer
            .seal_native_audio(
                &samples,
                &request_json,
                &transcript_json,
                &legacy,
                (NOW * 1000.0) as u64 + 6000
            )
            .is_err());
        let signed = signer
            .seal_native_audio(
                &samples,
                &request_json,
                &transcript_json,
                &metadata,
                (NOW * 1000.0) as u64 + 6000,
            )
            .unwrap();
        let verify = |bytes: &[u8]| -> Value {
            serde_json::from_str(
                &block_on(crate::verify_audio(
                    bytes,
                    &request_json,
                    &transcript_json,
                    signer.fingerprint(),
                    NOW + 7.0,
                ))
                .unwrap(),
            )
            .unwrap()
        };
        let report = verify(&signed);
        assert_eq!(report["verified"], true, "{report}");
        assert_eq!(report["checks"]["native_audio_metadata_valid"], true);
        assert_eq!(report["native_audio"]["backend"], "android-aaudio");
        assert_eq!(report["hardware_attested"], false);
        assert_eq!(report["sensor_origin_proven"], false);
        let (mut builder, mut source) = crate::audio::prepare_audio(
            &samples,
            &request_json,
            &transcript_json,
            NOW + 6.0,
            signer.fingerprint(),
        )
        .unwrap();
        let mut bad = metadata;
        bad.sealed_at_unix_ms = Some((NOW * 1000.0) as u64 + 6000);
        bad.seal_time_origin = Some("native-finalization-start".into());
        bad.output_xruns = 1;
        builder.add_assertion(ASSERTION_LABEL, &bad).unwrap();
        let mut destination = Cursor::new(Vec::new());
        builder
            .sign(&signer, "audio/wav", &mut source, &mut destination)
            .unwrap();
        let report = verify(destination.get_ref());
        assert_eq!(report["checks"]["c2pa_integrity"], true);
        assert_eq!(report["checks"]["native_audio_metadata_valid"], false);
        assert_eq!(report["verified"], false);
    }
}

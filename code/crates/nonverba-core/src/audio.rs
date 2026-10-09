// SPDX-License-Identifier: AGPL-3.0-only
//! Live requester audio challenges, canonical PCM, and C2PA WAV provenance.
//! Requester-retained transcripts are independent verification inputs. Matching
//! tones attest to sample content, not a trusted microphone or physical freshness.

use std::{collections::HashSet, io::Cursor};

use c2pa::{Builder, BuilderIntent, DigitalSourceType, Reader, ValidationState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    audio_signal, certificate_fingerprint, context, digest, err, local_signer, parse, seconds,
    Identity,
};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHUNK_SAMPLES: u32 = 96_000;
pub const SIGNAL_ALGORITHM: &str = "org.nonverba.audio-fsk.v1";
const AUDIO_ASSERTION: &str = "org.nonverba.audio";
const MAX_SAMPLES: usize = 30 * SAMPLE_RATE as usize;
const MAX_WAV: usize = 8 * 1024 * 1024;
const DEADLINE_MS: u32 = 3000;
pub(crate) const LATEST_PROBE_OFFSET: u32 = 38_400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioRequest {
    pub version: u32,
    /// The demo marker travels inside the signed assertion. Legacy requests
    /// omit it; false does not imply independently attested requester identity.
    #[serde(default, skip_serializing_if = "is_false")]
    pub demo: bool,
    pub session_id: String,
    pub requester: String,
    pub task: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub duration_secs: u32,
    pub sample_rate: u32,
    pub channels: u32,
    pub chunk_samples: u32,
    pub round_deadline_ms: u32,
    pub signal_algorithm: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioRound {
    pub session_id: String,
    pub index: u32,
    pub nonce: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioReceipt {
    pub index: u32,
    pub nonce: String,
    pub issued_elapsed_ms: u32,
    pub received_elapsed_ms: u32,
    pub pcm_sha256: String,
    pub start_sample: u32,
    pub sample_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioTranscript {
    pub version: u32,
    pub session_id: String,
    pub started_at: u64,
    pub completed_at: u64,
    pub total_samples: u32,
    pub rounds: Vec<AudioReceipt>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioCapture {
    pub version: u32,
    pub request: AudioRequest,
    pub transcript: AudioTranscript,
    pub signed_at: u64,
    pub device_fingerprint: String,
    pub pcm_sha256: String,
    pub signal_algorithm: String,
}

#[derive(Default, Serialize, Deserialize)]
pub struct AudioChecks {
    pub c2pa_integrity: bool,
    pub request_match: bool,
    pub transcript_match: bool,
    pub device_match: bool,
    pub recording_binding: bool,
    pub protocol_valid: bool,
    pub signal_detected: bool,
    pub signing_time_valid: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_audio_metadata_valid: Option<bool>,
}

#[derive(Serialize, Deserialize)]
pub struct AudioVerification {
    pub verified: bool,
    /// Derived from the signed capture request, never the supplied receipt type.
    /// It is only authenticated when C2PA validation succeeds.
    pub demo: bool,
    pub independent_requester_proven: bool,
    pub checks: AudioChecks,
    pub certificate_trusted: bool,
    pub hardware_attested: bool,
    pub sensor_origin_proven: bool,
    pub acoustic_path_proven: bool,
    pub physical_freshness_proven: bool,
    pub clock_trusted: bool,
    pub device_fingerprint: String,
    /// Actual C2PA signer SPKI; callers must also require successful verification.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub signer_spki_sha256: String,
    pub capture: Option<AudioCapture>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_audio: Option<crate::audio_capture::AudioCaptureMetadata>,
    pub detections: Vec<Value>,
    pub validation: Value,
    pub errors: Vec<String>,
}

fn is_false(value: &bool) -> bool {
    !value
}

fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn random_nonce() -> Result<String, String> {
    let mut nonce = [0u8; 32];
    getrandom::getrandom(&mut nonce).map_err(err)?;
    Ok(hex::encode(nonce))
}

fn request_shape(request: &AudioRequest) -> Result<(), String> {
    if request.version != 1
        || !is_hash(&request.session_id)
        || request.sample_rate != SAMPLE_RATE
        || request.channels != 1
        || request.chunk_samples != CHUNK_SAMPLES
        || request.round_deadline_ms != DEADLINE_MS
        || request.signal_algorithm != SIGNAL_ALGORITHM
    {
        return Err("Unsupported audio request or signal profile".into());
    }
    if request.requester.trim().is_empty()
        || request.requester.len() > 200
        || request.task.trim().is_empty()
        || request.task.len() > 2000
    {
        return Err(
            "Audio request requires requester (1–200 bytes) and task (1–2000 bytes)".into(),
        );
    }
    if !(4..=30).contains(&request.duration_secs) || !request.duration_secs.is_multiple_of(2) {
        return Err("Audio duration must be an even number from 4 to 30 seconds".into());
    }
    let lifetime = request
        .expires_at
        .checked_sub(request.issued_at)
        .ok_or("Audio request expires before issue time")?;
    if lifetime <= u64::from(request.duration_secs) || lifetime > crate::MAX_LIFETIME {
        return Err(
            "Audio request lifetime must exceed recording duration and be at most 24 hours".into(),
        );
    }
    // Both are consumed by JavaScript, whose integer precision is bounded.
    seconds(request.issued_at as f64)?;
    seconds(request.expires_at as f64)?;
    Ok(())
}

pub(crate) fn request_at(request: &AudioRequest, now: u64) -> Result<(), String> {
    request_shape(request)?;
    if now < request.issued_at || now >= request.expires_at {
        return Err("Audio request is not currently valid; obtain a fresh request".into());
    }
    Ok(())
}

pub(crate) fn transcript_shape(
    request: &AudioRequest,
    transcript: &AudioTranscript,
) -> Result<(), String> {
    request_shape(request)?;
    if transcript.version != 1
        || transcript.session_id != request.session_id
        || transcript.total_samples != request.duration_secs * SAMPLE_RATE
        || transcript.rounds.len() != (request.duration_secs / 2) as usize
    {
        return Err("Audio transcript session, length, or round count is invalid".into());
    }
    request_at(request, transcript.started_at)?;
    request_at(request, transcript.completed_at)?;
    let wall_seconds = transcript
        .completed_at
        .checked_sub(transcript.started_at)
        .ok_or("Audio completion precedes start")?;
    let max_elapsed = wall_seconds
        .checked_add(1)
        .and_then(|value| value.checked_mul(1000))
        .ok_or("Audio transcript time is too large")?;
    let mut nonces = HashSet::new();
    let mut previous_received = 0;
    for (index, round) in transcript.rounds.iter().enumerate() {
        if round.index != index as u32
            || round.start_sample != index as u32 * CHUNK_SAMPLES
            || round.sample_count != CHUNK_SAMPLES
            || !is_hash(&round.pcm_sha256)
            || !is_hash(&round.nonce)
            || !nonces.insert(&round.nonce)
        {
            return Err(
                "Audio rounds must have distinct 256-bit nonces and contiguous exact PCM chunks"
                    .into(),
            );
        }
        if (index == 0 && round.issued_elapsed_ms != 0)
            || round.issued_elapsed_ms < previous_received
            || round.received_elapsed_ms <= round.issued_elapsed_ms
            // The requester measures from the first issue, because subsequent
            // challenges arrive during an already-running continuous chunk.
            // A per-round two-second minimum would reject legitimate overlap.
            || round.received_elapsed_ms < (index as u32 + 1) * 2000 - 100
            || round.received_elapsed_ms - round.issued_elapsed_ms > request.round_deadline_ms
            || u64::from(round.received_elapsed_ms) > max_elapsed
        {
            return Err("Audio round was issued before predecessor receipt, arrived before its recording window, missed its deadline, or has invalid timing".into());
        }
        previous_received = round.received_elapsed_ms;
    }
    Ok(())
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn create_audio_request(
    requester: &str,
    task: &str,
    now_secs: f64,
    lifetime_secs: u32,
    duration_secs: u32,
) -> Result<String, String> {
    let now = seconds(now_secs)?;
    let request = AudioRequest {
        version: 1,
        demo: false,
        session_id: random_nonce()?,
        requester: requester.trim().into(),
        task: task.trim().into(),
        issued_at: now,
        expires_at: now
            .checked_add(lifetime_secs.into())
            .ok_or("Invalid expiry")?,
        duration_secs,
        sample_rate: SAMPLE_RATE,
        channels: 1,
        chunk_samples: CHUNK_SAMPLES,
        round_deadline_ms: DEADLINE_MS,
        signal_algorithm: SIGNAL_ALGORITHM.into(),
    };
    request_shape(&request)?;
    serde_json::to_string(&request).map_err(err)
}

/// A visibly labelled local demonstration uses the same challenge, PCM and C2PA
/// checks. Its signed marker prevents a receipt wrapper from upgrading its role.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn create_audio_demo_request(now_secs: f64) -> Result<String, String> {
    let mut request: AudioRequest = parse(&create_audio_request(
        "Local demo — same device",
        "DEMO ONLY: microphone and speaker demonstration on this device. No independent requester.",
        now_secs,
        900,
        4,
    )?)?;
    request.demo = true;
    serde_json::to_string(&request).map_err(err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn validate_audio_request(request_json: &str, now_secs: f64) -> Result<String, String> {
    let request: AudioRequest = parse(request_json)?;
    request_at(&request, seconds(now_secs)?)?;
    serde_json::to_string(&request).map_err(err)
}

/// Called by the requester only after receiving and retaining the predecessor's
/// actual PCM. This stateless function cannot enforce that external role boundary.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn create_audio_round(request_json: &str, index: u32, now_secs: f64) -> Result<String, String> {
    let request: AudioRequest = parse(request_json)?;
    request_at(&request, seconds(now_secs)?)?;
    if index >= request.duration_secs / 2 {
        return Err("Audio round index is outside this request".into());
    }
    serde_json::to_string(&AudioRound {
        session_id: request.session_id,
        index,
        nonce: random_nonce()?,
    })
    .map_err(err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn encode_audio_pcm(pcm: &[f32]) -> Result<Vec<u8>, String> {
    if pcm.is_empty() || pcm.len() > MAX_SAMPLES {
        return Err("PCM must contain 1 sample to 30 seconds at 48 kHz".into());
    }
    let mut bytes = Vec::with_capacity(pcm.len() * 2);
    for sample in pcm {
        if !sample.is_finite() || !(-1.0..=1.0).contains(sample) {
            return Err("PCM samples must be finite and within [-1,1]".into());
        }
        bytes.extend_from_slice(&((f64::from(*sample) * 32767.0).round() as i16).to_le_bytes());
    }
    Ok(bytes)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn decode_audio_pcm(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.is_empty() || !bytes.len().is_multiple_of(2) || bytes.len() > MAX_SAMPLES * 2 {
        return Err("PCM16LE byte count is invalid".into());
    }
    bytes
        .chunks_exact(2)
        .map(|bytes| {
            let value = i16::from_le_bytes([bytes[0], bytes[1]]);
            if value == i16::MIN {
                return Err("PCM16LE -32768 is outside Non-verba's canonical sample range".into());
            }
            Ok(f32::from(value) / 32767.0)
        })
        .collect()
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn hash_audio_pcm(pcm: &[f32]) -> Result<String, String> {
    Ok(digest(encode_audio_pcm(pcm)?))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn audio_probe(session_id: &str, index: u32, nonce_hex: &str) -> Result<Vec<f32>, String> {
    audio_signal::generate(session_id, index, nonce_hex)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn detect_audio_probe(
    pcm: &[f32],
    session_id: &str,
    index: u32,
    nonce_hex: &str,
) -> Result<String, String> {
    serde_json::to_string(&audio_signal::detect(
        pcm,
        SAMPLE_RATE,
        session_id,
        index,
        nonce_hex,
    )?)
    .map_err(err)
}

fn wav(pcm_bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(pcm_bytes.len() + 44);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(pcm_bytes.len() as u32 + 36).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(pcm_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(pcm_bytes);
    out
}

fn pcm_from_wav(bytes: &[u8]) -> Result<&[u8], String> {
    if bytes.len() < 44
        || bytes.len() > MAX_WAV
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
    {
        return Err("Expected a bounded RIFF WAVE file".into());
    }
    let declared = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if declared.checked_add(8) != Some(bytes.len()) {
        return Err("WAV length or trailing bytes are invalid".into());
    }
    let expected_fmt = &wav(&[])[20..36];
    let mut saw_fmt = false;
    let mut pcm = None;
    let mut offset = 12usize;
    while offset < bytes.len() {
        if bytes.len() - offset < 8 {
            return Err("Truncated WAV chunk".into());
        }
        let kind = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let end = start
            .checked_add(size)
            .filter(|end| *end <= bytes.len())
            .ok_or("Truncated WAV data")?;
        if kind == b"fmt " {
            if saw_fmt || &bytes[start..end] != expected_fmt {
                return Err("WAV must contain one 48 kHz mono PCM16 format".into());
            }
            saw_fmt = true;
        } else if kind == b"data" {
            if pcm.is_some() {
                return Err("WAV must contain exactly one continuous PCM data chunk".into());
            }
            pcm = Some(&bytes[start..end]);
        }
        offset = end
            .checked_add(size % 2)
            .filter(|next| *next <= bytes.len())
            .ok_or("Missing WAV chunk padding")?;
    }
    if !saw_fmt {
        return Err("Missing WAV format".into());
    }
    pcm.ok_or("Missing WAV PCM data".into())
}

fn recording_binding(pcm: &[u8], transcript: &AudioTranscript) -> Result<(), String> {
    if pcm.len() != transcript.total_samples as usize * 2 {
        return Err("Recording does not match the exact requested sample count".into());
    }
    for round in &transcript.rounds {
        let start = round.start_sample as usize * 2;
        let end = start
            .checked_add(round.sample_count as usize * 2)
            .ok_or("Invalid PCM range")?;
        let bytes = pcm
            .get(start..end)
            .ok_or("Audio transcript chunk is outside recording")?;
        if digest(bytes) != round.pcm_sha256 {
            return Err(format!(
                "PCM chunk {} differs from requester-retained bytes",
                round.index
            ));
        }
    }
    Ok(())
}

fn detections(pcm: &[f32], transcript: &AudioTranscript) -> Result<(bool, Vec<Value>), String> {
    let (passed, reports) = round_detections(pcm, transcript)?;
    Ok((
        passed,
        reports
            .into_iter()
            .map(|report| serde_json::to_value(report).map_err(err))
            .collect::<Result<_, _>>()?,
    ))
}

fn round_detections(
    pcm: &[f32],
    transcript: &AudioTranscript,
) -> Result<(bool, Vec<audio_signal::Detection>), String> {
    let mut passed = true;
    let mut reports = Vec::with_capacity(transcript.rounds.len());
    for round in &transcript.rounds {
        let start = round.start_sample as usize;
        let end = start
            .checked_add(round.sample_count as usize)
            .ok_or("Invalid signal sample range")?;
        let samples = pcm
            .get(start..end)
            .ok_or("Signal transcript chunk is outside recording")?;
        let report = audio_signal::detect(
            samples,
            SAMPLE_RATE,
            &transcript.session_id,
            round.index,
            &round.nonce,
        )?;
        passed &= report.detected && report.offset_samples <= LATEST_PROBE_OFFSET;
        reports.push(report);
    }
    Ok((passed, reports))
}

fn read_capture_assertion(manifest: &c2pa::Manifest) -> Result<AudioCapture, String> {
    // C2PA 0.91 find_assertion uses prefix matching. Select the exact domain
    // ourselves; read-side labels omit instance suffixes, so duplicates count.
    let mut assertions = manifest
        .assertions()
        .iter()
        .filter(|assertion| assertion.label() == AUDIO_ASSERTION);
    let assertion = assertions
        .next()
        .ok_or("Missing Non-verba audio assertion")?;
    if assertions.next().is_some() {
        return Err("Non-verba audio assertion must be unique".into());
    }
    assertion.to_assertion().map_err(err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub async fn seal_audio(
    pcm: &[f32],
    identity_json: &str,
    request_json: &str,
    transcript_json: &str,
    now_secs: f64,
) -> Result<Vec<u8>, String> {
    let identity: Identity = parse(identity_json)?;
    let signer = local_signer(&identity)?;
    let (mut builder, mut source) = prepare_audio(
        pcm,
        request_json,
        transcript_json,
        now_secs,
        &identity.fingerprint,
    )?;
    let mut destination = Cursor::new(Vec::new());
    builder
        .sign_async(&signer, "audio/wav", &mut source, &mut destination)
        .await
        .map_err(err)?;
    Ok(destination.into_inner())
}

pub(crate) fn prepare_audio(
    pcm: &[f32],
    request_json: &str,
    transcript_json: &str,
    now_secs: f64,
    fingerprint: &str,
) -> Result<(Builder, Cursor<Vec<u8>>), String> {
    prepare_audio_inner(
        pcm,
        request_json,
        transcript_json,
        now_secs,
        fingerprint,
        None,
    )
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn prepare_audio_observed(
    pcm: &[f32],
    request_json: &str,
    transcript_json: &str,
    now_secs: f64,
    fingerprint: &str,
    round_assessment: &mut Option<String>,
) -> Result<(Builder, Cursor<Vec<u8>>), String> {
    *round_assessment = None;
    prepare_audio_inner(
        pcm,
        request_json,
        transcript_json,
        now_secs,
        fingerprint,
        Some(round_assessment),
    )
}

fn prepare_audio_inner(
    pcm: &[f32],
    request_json: &str,
    transcript_json: &str,
    now_secs: f64,
    fingerprint: &str,
    round_assessment: Option<&mut Option<String>>,
) -> Result<(Builder, Cursor<Vec<u8>>), String> {
    #[cfg(target_arch = "wasm32")]
    let _ = round_assessment;
    let now = seconds(now_secs)?;
    let request: AudioRequest = parse(request_json)?;
    let transcript: AudioTranscript = parse(transcript_json)?;
    request_at(&request, now)?;
    transcript_shape(&request, &transcript)?;
    if transcript.completed_at > now {
        return Err("Audio transcript completion is in the future".into());
    }
    let pcm_bytes = encode_audio_pcm(pcm)?;
    recording_binding(&pcm_bytes, &transcript)?;
    // Verify exactly the quantized PCM that will travel in the signed WAV.
    let (passed, reports) = round_detections(&decode_audio_pcm(&pcm_bytes)?, &transcript)?;
    #[cfg(not(target_arch = "wasm32"))]
    let mut assessment_error = None;
    #[cfg(not(target_arch = "wasm32"))]
    if let Some(slot) = round_assessment {
        match crate::native_audio_signing::serialize_round_assessment(&transcript, &reports) {
            Ok(assessment) => *slot = Some(assessment),
            Err(error) => assessment_error = Some(error),
        }
    }
    #[cfg(target_arch = "wasm32")]
    let _ = reports;
    if !passed {
        return Err(
            "Fresh audio challenge was not detected within every round's allowed window".into(),
        );
    }
    #[cfg(not(target_arch = "wasm32"))]
    if let Some(error) = assessment_error {
        return Err(error);
    }
    let capture = AudioCapture {
        version: 1,
        request,
        transcript,
        signed_at: now,
        device_fingerprint: fingerprint.into(),
        pcm_sha256: digest(&pcm_bytes),
        signal_algorithm: SIGNAL_ALGORITHM.into(),
    };
    let mut builder = Builder::from_context(context()?)
        .with_definition(json!({
            "title":"Non-verba live audio challenge recording",
            "claim_generator_info":[{"name":"Non-verba","version":env!("CARGO_PKG_VERSION")}]
        }))
        .map_err(err)?;
    builder.set_intent(BuilderIntent::Create(DigitalSourceType::DigitalCapture));
    builder
        .add_assertion(AUDIO_ASSERTION, &capture)
        .map_err(err)?;
    Ok((builder, Cursor::new(wav(&pcm_bytes))))
}

/// Historical verification requires the requester's independently retained
/// request AND transcript. A transcript supplied only by the operator is not a
/// substitute. A separate one-time acceptance ledger is still required.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub async fn verify_audio(
    wav_bytes: &[u8],
    expected_request_json: &str,
    expected_transcript_json: &str,
    expected_device_fingerprint: &str,
    now_secs: f64,
) -> Result<String, String> {
    serde_json::to_string(
        &verify_audio_report(
            wav_bytes,
            expected_request_json,
            expected_transcript_json,
            expected_device_fingerprint,
            now_secs,
        )
        .await?,
    )
    .map_err(err)
}

/// Typed native result; JSON encoding is confined to the transport wrapper.
pub async fn verify_audio_report(
    wav_bytes: &[u8],
    expected_request_json: &str,
    expected_transcript_json: &str,
    expected_device_fingerprint: &str,
    now_secs: f64,
) -> Result<AudioVerification, String> {
    if wav_bytes.len() > MAX_WAV {
        return Err("WAV exceeds the 8 MiB input limit".into());
    }
    let now = seconds(now_secs)?;
    let expected_request: AudioRequest = parse(expected_request_json)?;
    let expected_transcript: AudioTranscript = parse(expected_transcript_json)?;
    transcript_shape(&expected_request, &expected_transcript)?;
    let mut result = AudioVerification {
        verified: false,
        demo: false,
        independent_requester_proven: false,
        checks: AudioChecks::default(),
        certificate_trusted: false,
        hardware_attested: false,
        sensor_origin_proven: false,
        acoustic_path_proven: false,
        physical_freshness_proven: false,
        clock_trusted: false,
        device_fingerprint: String::new(),
        signer_spki_sha256: String::new(),
        capture: None,
        native_audio: None,
        detections: Vec::new(),
        validation: Value::Null,
        errors: Vec::new(),
    };
    let reader = match Reader::from_context(context()?)
        .with_stream_async("audio/wav", Cursor::new(wav_bytes))
        .await
    {
        Ok(reader) => reader,
        Err(error) => {
            result
                .errors
                .push(format!("C2PA audio manifest cannot be validated: {error}"));
            return Ok(result);
        }
    };
    result.validation = serde_json::to_value(reader.validation_results()).map_err(err)?;
    result.checks.c2pa_integrity = matches!(
        reader.validation_state(),
        ValidationState::Valid | ValidationState::Trusted
    );
    let manifest = reader
        .active_manifest()
        .ok_or("No active C2PA audio manifest")?;
    if let Some(signature) = manifest.signature_info() {
        result.device_fingerprint =
            certificate_fingerprint(signature.cert_chain()).unwrap_or_default();
        result.signer_spki_sha256 =
            crate::certificate_spki_fingerprint(signature.cert_chain()).unwrap_or_default();
    }
    match read_capture_assertion(manifest) {
        Ok(capture) => {
            result.demo = capture.request.demo;
            result.checks.request_match = capture.request == expected_request;
            result.checks.transcript_match = capture.transcript == expected_transcript;
            result.checks.device_match = is_hash(expected_device_fingerprint)
                && result.device_fingerprint == expected_device_fingerprint
                && capture.device_fingerprint == result.device_fingerprint;
            result.checks.protocol_valid = capture.version == 1
                && capture.signal_algorithm == SIGNAL_ALGORITHM
                && transcript_shape(&capture.request, &capture.transcript).is_ok();
            result.checks.signing_time_valid = request_at(&capture.request, capture.signed_at)
                .is_ok()
                && capture.signed_at >= capture.transcript.completed_at
                && capture.signed_at <= now;
            match pcm_from_wav(wav_bytes).and_then(|bytes| Ok((bytes, decode_audio_pcm(bytes)?))) {
                Ok((bytes, pcm)) => {
                    result.checks.recording_binding = digest(bytes) == capture.pcm_sha256
                        && recording_binding(bytes, &expected_transcript).is_ok();
                    match detections(&pcm, &expected_transcript) {
                        Ok((passed, reports)) => {
                            result.checks.signal_detected = passed;
                            result.detections = reports;
                        }
                        Err(error) => result
                            .errors
                            .push(format!("Audio detection failed: {error}")),
                    }
                }
                Err(error) => result
                    .errors
                    .push(format!("Audio samples cannot be validated: {error}")),
            }
            result.capture = Some(capture);
        }
        Err(error) => result.errors.push(format!(
            "Missing or malformed Non-verba audio assertion: {error}"
        )),
    }
    match crate::audio_capture::read_assertion(manifest, result.capture.as_ref(), now) {
        Ok(Some(metadata)) => {
            result.checks.native_audio_metadata_valid = Some(true);
            result.native_audio = Some(metadata);
        }
        Ok(None) => {}
        Err(error) => {
            result.checks.native_audio_metadata_valid = Some(false);
            result
                .errors
                .push(format!("Native audio metadata failed: {error}"));
        }
    }
    for (passed, message) in [
        (
            result.checks.c2pa_integrity,
            "C2PA audio signature or binding failed",
        ),
        (
            result.checks.request_match,
            "Signed request differs from the requester-retained request",
        ),
        (
            result.checks.transcript_match,
            "Signed transcript differs from the requester-retained transcript",
        ),
        (
            result.checks.device_match,
            "Audio signer differs from the pinned operator identity",
        ),
        (
            result.checks.recording_binding,
            "Recording samples differ from the requester-retained PCM commitments",
        ),
        (
            result.checks.protocol_valid,
            "Audio challenge protocol or transcript is invalid",
        ),
        (
            result.checks.signal_detected,
            "Fresh audio challenges were not detected in every allowed round window",
        ),
        (
            result.checks.signing_time_valid,
            "Audio signing time is outside the request window or in the future",
        ),
    ] {
        if !passed {
            result.errors.push(message.into());
        }
    }
    result.verified = result.errors.is_empty();
    Ok(result)
}

#[cfg(test)]
#[path = "audio/assertion_tests.rs"]
pub(crate) mod assertion_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use futures::executor::block_on;

    const NOW: f64 = 1_790_424_000.0;

    pub(super) fn fixture() -> (AudioRequest, AudioTranscript, Vec<f32>) {
        let request: AudioRequest = parse(
            &create_audio_request("Independent requester", "Audio protocol test", NOW, 120, 4)
                .unwrap(),
        )
        .unwrap();
        fixture_for_request(request)
    }

    fn fixture_for_request(request: AudioRequest) -> (AudioRequest, AudioTranscript, Vec<f32>) {
        let mut pcm = vec![0.0; request.duration_secs as usize * SAMPLE_RATE as usize];
        let mut rounds = Vec::new();
        for index in 0..2 {
            let challenge: AudioRound = parse(
                &create_audio_round(
                    &serde_json::to_string(&request).unwrap(),
                    index,
                    NOW + index as f64 * 2.0,
                )
                .unwrap(),
            )
            .unwrap();
            let probe = audio_probe(&request.session_id, index, &challenge.nonce).unwrap();
            let start = index as usize * CHUNK_SAMPLES as usize;
            // Slightly delayed playback, after already-started continuous capture.
            pcm[start + 4800..start + 4800 + probe.len()].copy_from_slice(&probe);
            rounds.push(AudioReceipt {
                index,
                nonce: challenge.nonce,
                issued_elapsed_ms: index * 2010,
                received_elapsed_ms: index * 2010 + 2000,
                pcm_sha256: hash_audio_pcm(&pcm[start..start + CHUNK_SAMPLES as usize]).unwrap(),
                start_sample: index * CHUNK_SAMPLES,
                sample_count: CHUNK_SAMPLES,
            });
        }
        let transcript = AudioTranscript {
            version: 1,
            session_id: request.session_id.clone(),
            started_at: NOW as u64,
            completed_at: NOW as u64 + 4,
            total_samples: pcm.len() as u32,
            rounds,
        };
        (request, transcript, pcm)
    }

    #[test]
    fn pcm_conversion_is_canonical_and_wav_parser_rejects_ambiguous_data() {
        let samples = [-1.0, -0.5, -0.00001, 0.0, 0.00001, 0.5, 1.0];
        let encoded = encode_audio_pcm(&samples).unwrap();
        assert_eq!(&encoded[..2], &(-32767i16).to_le_bytes());
        assert_eq!(&encoded[encoded.len() - 2..], &32767i16.to_le_bytes());
        assert_eq!(
            encode_audio_pcm(&decode_audio_pcm(&encoded).unwrap()).unwrap(),
            encoded
        );
        assert!(encode_audio_pcm(&[f32::NAN]).is_err());
        assert!(encode_audio_pcm(&[1.01]).is_err());
        assert!(decode_audio_pcm(&i16::MIN.to_le_bytes()).is_err());
        assert!(decode_audio_pcm(&[0]).is_err());
        let original = wav(&encoded);
        assert_eq!(pcm_from_wav(&original).unwrap(), encoded);
        let mut changed = original.clone();
        changed.push(0);
        assert!(pcm_from_wav(&changed).is_err());
        let mut changed = original.clone();
        changed[40..44].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(pcm_from_wav(&changed).is_err());
        let mut changed = original.clone();
        changed[24..28].copy_from_slice(&44_100u32.to_le_bytes());
        assert!(pcm_from_wav(&changed).is_err());
        let mut changed = original.clone();
        changed.extend_from_slice(b"data\x00\x00\x00\x00");
        let size = changed.len() as u32 - 8;
        changed[4..8].copy_from_slice(&size.to_le_bytes());
        assert!(pcm_from_wav(&changed).is_err());
    }

    #[test]
    fn request_and_transcript_require_fresh_distinct_ordered_rounds() {
        let (request, transcript, _) = fixture();
        let request_json = serde_json::to_string(&request).unwrap();
        transcript_shape(&request, &transcript).unwrap();
        assert!(create_audio_request("r", "task", NOW, 120, 5).is_err());
        assert!(create_audio_request("r", "task", NOW, 120, 32).is_err());
        assert!(validate_audio_request(&request_json, NOW + 120.0).is_err());
        assert!(create_audio_round(&request_json, 2, NOW).is_err());
        assert_ne!(
            create_audio_round(&request_json, 0, NOW).unwrap(),
            create_audio_round(&request_json, 0, NOW).unwrap()
        );
        let mut replay = transcript.clone();
        replay.rounds[1].nonce = replay.rounds[0].nonce.clone();
        assert!(transcript_shape(&request, &replay).is_err());
        let mut early = transcript.clone();
        early.rounds[1].issued_elapsed_ms = early.rounds[0].received_elapsed_ms - 1;
        assert!(transcript_shape(&request, &early).is_err());
        let mut late = transcript.clone();
        late.rounds[1].received_elapsed_ms = late.rounds[1].issued_elapsed_ms + 3001;
        assert!(transcript_shape(&request, &late).is_err());
        let mut gap = transcript.clone();
        gap.rounds[1].start_sample += 1;
        assert!(transcript_shape(&request, &gap).is_err());
        let mut truncated = transcript.clone();
        truncated.total_samples -= 1;
        assert!(transcript_shape(&request, &truncated).is_err());
        // Correct sample counts and hashes do not justify completing a claimed
        // four-second live exchange in milliseconds. Reject accelerated replies.
        let mut accelerated = transcript.clone();
        accelerated.completed_at = accelerated.started_at;
        accelerated.rounds[0].received_elapsed_ms = 1;
        accelerated.rounds[1].issued_elapsed_ms = 1;
        accelerated.rounds[1].received_elapsed_ms = 2;
        assert!(transcript_shape(&request, &accelerated).is_err());
        // The lower bound is global, not two seconds after each later issue.
        let mut boundary = transcript.clone();
        boundary.rounds[0].received_elapsed_ms = 1900;
        boundary.rounds[1].issued_elapsed_ms = 2050;
        boundary.rounds[1].received_elapsed_ms = 3900;
        assert!(transcript_shape(&request, &boundary).is_ok());
        boundary.rounds[1].received_elapsed_ms = 3899;
        assert!(transcript_shape(&request, &boundary).is_err());
    }

    #[test]
    fn c2pa_audio_roundtrip_binds_retained_transcript_pin_and_exact_pcm() {
        let (request, transcript, pcm) = fixture();
        let request_json = serde_json::to_string(&request).unwrap();
        // Legacy requests omitted this field. Normal captures still do so and
        // their signed requests deserialize as non-demo.
        assert!(!serde_json::from_str::<Value>(&request_json)
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("demo"));
        assert!(!parse::<AudioRequest>(&request_json).unwrap().demo);
        let transcript_json = serde_json::to_string(&transcript).unwrap();
        let identity = crate::create_identity().unwrap();
        let fingerprint = crate::identity_fingerprint(&identity).unwrap();
        let sealed = block_on(seal_audio(
            &pcm,
            &identity,
            &request_json,
            &transcript_json,
            NOW + 5.0,
        ))
        .unwrap();
        assert_eq!(
            pcm_from_wav(&sealed).unwrap(),
            encode_audio_pcm(&pcm).unwrap()
        );
        let verify = |bytes: &[u8], expected: &str, pin: &str| -> AudioVerification {
            parse(
                &block_on(verify_audio(
                    bytes,
                    &request_json,
                    expected,
                    pin,
                    NOW + 300.0,
                ))
                .unwrap(),
            )
            .unwrap()
        };
        let result = verify(&sealed, &transcript_json, &fingerprint);
        assert!(
            result.verified,
            "{}",
            serde_json::to_string(&result).unwrap()
        );
        assert!(!result.demo && !result.independent_requester_proven);
        assert_eq!(result.detections.len(), 2);
        assert!(
            !result.sensor_origin_proven
                && !result.acoustic_path_proven
                && !result.physical_freshness_proven
        );
        assert!(!result.certificate_trusted && !result.hardware_attested && !result.clock_trusted);
        assert!(!verify(&sealed, &transcript_json, &"0".repeat(64)).verified);
        let mut wrong_nonce = transcript.clone();
        wrong_nonce.rounds[0].nonce = random_nonce().unwrap();
        let wrong_json = serde_json::to_string(&wrong_nonce).unwrap();
        let wrong = verify(&sealed, &wrong_json, &fingerprint);
        assert!(!wrong.verified && !wrong.checks.transcript_match && !wrong.checks.signal_detected);
        assert!(block_on(seal_audio(
            &pcm,
            &identity,
            &request_json,
            &wrong_json,
            NOW + 5.0
        ))
        .is_err());
        let mut wrong_hash = transcript.clone();
        wrong_hash.rounds[0].pcm_sha256 = "0".repeat(64);
        let wrong = verify(
            &sealed,
            &serde_json::to_string(&wrong_hash).unwrap(),
            &fingerprint,
        );
        assert!(!wrong.verified && !wrong.checks.recording_binding);
        let mut tampered = sealed.clone();
        let data = pcm_from_wav(&sealed).unwrap();
        let at = data.as_ptr() as usize - sealed.as_ptr() as usize;
        tampered[at + 500] ^= 1;
        let tampered = verify(&tampered, &transcript_json, &fingerprint);
        assert!(
            !tampered.verified
                && !tampered.checks.c2pa_integrity
                && !tampered.checks.recording_binding
        );
        assert!(block_on(seal_audio(
            &pcm[..pcm.len() - 1],
            &identity,
            &request_json,
            &transcript_json,
            NOW + 5.0
        ))
        .is_err());
        assert!(block_on(seal_audio(
            &pcm,
            &identity,
            &request_json,
            &transcript_json,
            NOW + 120.0
        ))
        .is_err());
    }

    #[test]
    fn demo_marker_is_signed_and_cannot_be_removed_by_rewrapping_the_receipt() {
        let request_json = create_audio_demo_request(NOW).unwrap();
        let request: AudioRequest = parse(&request_json).unwrap();
        assert!(request.demo);
        assert_eq!(request.duration_secs, 4);
        assert_eq!(request.expires_at - request.issued_at, 900);
        assert!(request.requester.contains("demo"));
        assert!(
            request.task.contains("DEMO ONLY") && request.task.contains("No independent requester")
        );
        let another: AudioRequest = parse(&create_audio_demo_request(NOW).unwrap()).unwrap();
        assert_ne!(request.session_id, another.session_id);
        let (_, transcript, pcm) = fixture_for_request(request);
        let transcript_json = serde_json::to_string(&transcript).unwrap();
        let identity = crate::create_identity().unwrap();
        let fingerprint = crate::identity_fingerprint(&identity).unwrap();
        let sealed = block_on(seal_audio(
            &pcm,
            &identity,
            &request_json,
            &transcript_json,
            NOW + 5.0,
        ))
        .unwrap();
        let verify = |expected: &str| -> AudioVerification {
            parse(
                &block_on(verify_audio(
                    &sealed,
                    expected,
                    &transcript_json,
                    &fingerprint,
                    NOW + 1000.0,
                ))
                .unwrap(),
            )
            .unwrap()
        };
        let authentic = verify(&request_json);
        assert!(authentic.verified && authentic.demo);
        assert!(!authentic.independent_requester_proven);
        assert!(authentic.capture.unwrap().request.demo);

        // Receipt wrappers are not authoritative. If someone strips the marker
        // from an expected request, the signed request remains visibly a demo
        // and the request-equality check rejects the purported upgrade.
        let mut stripped: Value = parse(&request_json).unwrap();
        stripped.as_object_mut().unwrap().remove("demo");
        let downgraded = verify(&stripped.to_string());
        assert!(downgraded.checks.c2pa_integrity && downgraded.demo);
        assert!(!downgraded.verified && !downgraded.checks.request_match);
        assert!(!downgraded.independent_requester_proven);
        stripped["demo"] = json!(false);
        let falsified = verify(&stripped.to_string());
        assert!(falsified.demo && !falsified.verified);
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
//! Synthetic unsigned observations of the existing native sealing checks.
//! No microphone, speaker, phone collection or physical-cause claim.

use super::*;
use p256::{
    ecdsa::{signature::Signer as _, Signature},
    pkcs8::EncodePublicKey,
};
use serde_json::Value;
use std::cell::Cell;

const NOW: f64 = 1_790_424_000.0;
const REFUSAL: &str = "Fresh audio challenge was not detected within every round's allowed window";

fn with_signer(test: impl FnOnce(&ExternalSigner<'_>, &Cell<usize>)) {
    let key = crate::CertificateKey::generate().unwrap().key;
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let certs = crate::native_signer::create_certificate_chain(spki.as_bytes()).unwrap();
    let calls = Cell::new(0);
    let mut callback = |message: &[u8]| {
        calls.set(calls.get() + 1);
        let signature: Signature = key.sign(message);
        Ok(signature.to_der().as_bytes().to_vec())
    };
    let signer = ExternalSigner::new(&certs, spki.as_bytes(), &mut callback).unwrap();
    test(&signer, &calls);
}

fn wire_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::from_str(&serde_json::to_string(value).unwrap()).unwrap()
}

fn assessment(
    slot: &Option<String>,
    request: &AudioRequest,
    transcript: &AudioTranscript,
) -> Value {
    let json = slot
        .as_ref()
        .expect("Actual round checks were not retained");
    assert!(json.len() <= MAX_ROUND_ASSESSMENT_JSON_BYTES);
    assert!(!json.contains(&request.session_id));
    for round in &transcript.rounds {
        assert!(!json.contains(&round.nonce));
    }
    for forbidden in [
        "\"nonce\"",
        "\"request\"",
        "\"pcm_base64\"",
        "\"signature\"",
    ] {
        assert!(!json.contains(forbidden));
    }
    let report: Value = serde_json::from_str(json).unwrap();
    assert_eq!(report.as_object().unwrap().len(), 7);
    assert_eq!(report["version"], 1);
    assert_eq!(report["type"], "nonverba-native-audio-round-assessment");
    assert_eq!(report["signal_algorithm"], crate::audio_signal::PROFILE);
    assert_eq!(report["sample_format"], "pcm16");
    assert_eq!(report["maximum_start_offset_samples"], 38_400);
    let rounds = report["rounds"].as_array().unwrap();
    assert_eq!(rounds.len(), transcript.rounds.len());
    assert!(rounds.len() <= 15);
    for (entry, round) in rounds.iter().zip(&transcript.rounds) {
        assert_eq!(entry.as_object().unwrap().len(), 6);
        assert_eq!(entry["index"], round.index);
        assert_eq!(entry["start_sample"], round.start_sample);
        assert_eq!(entry["sample_count"], CHUNK_SAMPLES);
        assert_eq!(entry["detection"].as_object().unwrap().len(), 8);
    }
    report
}

fn refresh_hashes(samples: &[f32], transcript: &mut AudioTranscript) {
    for round in &mut transcript.rounds {
        let start = round.start_sample as usize;
        round.pcm_sha256 =
            crate::hash_audio_pcm(&samples[start..start + CHUNK_SAMPLES as usize]).unwrap();
    }
}

fn assert_quantized_reports(samples: &[f32], transcript: &AudioTranscript, report: &Value) {
    let canonical = crate::decode_audio_pcm(&crate::encode_audio_pcm(samples).unwrap()).unwrap();
    for (entry, round) in report["rounds"]
        .as_array()
        .unwrap()
        .iter()
        .zip(&transcript.rounds)
    {
        let start = round.start_sample as usize;
        let detected = crate::audio_signal::detect(
            &canonical[start..start + CHUNK_SAMPLES as usize],
            crate::audio::SAMPLE_RATE,
            &transcript.session_id,
            round.index,
            &round.nonce,
        )
        .unwrap();
        let passed = detected.detected && detected.offset_samples <= 38_400;
        assert_eq!(entry["passed"], passed);
        assert_eq!(entry["detection"], wire_value(&detected));
    }
}

#[test]
fn successful_observed_sealing_keeps_quantized_checks_outside_the_signed_artifact() {
    let (request, transcript, _, samples, metadata) = super::tests::fixture();
    let request_json = serde_json::to_string(&request).unwrap();
    let transcript_json = serde_json::to_string(&transcript).unwrap();
    with_signer(|signer, calls| {
        let mut slot = None;
        let wav = signer
            .seal_native_audio_observed(
                &samples,
                &request_json,
                &transcript_json,
                &metadata,
                (NOW * 1000.0) as u64 + 6000,
                &mut slot,
            )
            .unwrap();
        assert!(calls.get() > 0);
        let report = assessment(&slot, &request, &transcript);
        assert_eq!(report["passed"], true);
        assert_quantized_reports(&samples, &transcript, &report);
        let verified: crate::audio::AudioVerification = crate::parse(
            &futures::executor::block_on(crate::verify_audio(
                &wav,
                &request_json,
                &transcript_json,
                signer.fingerprint(),
                NOW + 7.0,
            ))
            .unwrap(),
        )
        .unwrap();
        assert!(verified.verified && verified.checks.signal_detected);
        assert!(!serde_json::to_string(&verified)
            .unwrap()
            .contains("round_assessment"));
    });
}

#[test]
fn signal_refusal_retains_each_round_without_calling_the_signer_or_changing_the_error() {
    let (request, transcript, rounds, samples, metadata) = super::tests::fixture();
    let request_json = serde_json::to_string(&request).unwrap();
    for reason in ["not_detected", "detected_late", "wrong_nonce"] {
        let mut changed = samples.clone();
        changed[CHUNK_SAMPLES as usize..].fill(0.0);
        if reason != "not_detected" {
            let nonce = if reason == "wrong_nonce" {
                &rounds[0].nonce
            } else {
                &rounds[1].nonce
            };
            let marker = crate::audio_probe(&request.session_id, 1, nonce).unwrap();
            let offset = if reason == "detected_late" {
                48_000
            } else {
                4_800
            };
            let start = CHUNK_SAMPLES as usize + offset;
            changed[start..start + marker.len()].copy_from_slice(&marker);
        }
        let mut receipt = transcript.clone();
        refresh_hashes(&changed, &mut receipt);
        let receipt_json = serde_json::to_string(&receipt).unwrap();
        with_signer(|signer, calls| {
            let mut slot = Some("stale observation".into());
            let error = signer
                .seal_native_audio_observed(
                    &changed,
                    &request_json,
                    &receipt_json,
                    &metadata,
                    (NOW * 1000.0) as u64 + 6000,
                    &mut slot,
                )
                .unwrap_err();
            assert_eq!(error, REFUSAL);
            assert_eq!(calls.get(), 0);
            let report = assessment(&slot, &request, &receipt);
            assert_eq!(report["passed"], false);
            assert_eq!(report["rounds"][0]["passed"], true);
            assert_eq!(report["rounds"][1]["passed"], false);
            assert_eq!(
                report["rounds"][1]["reason"],
                if reason == "detected_late" {
                    "detected_late"
                } else {
                    "not_detected"
                }
            );
            assert_quantized_reports(&changed, &receipt, &report);
            assert_eq!(
                signer
                    .seal_native_audio(
                        &changed,
                        &request_json,
                        &receipt_json,
                        &metadata,
                        (NOW * 1000.0) as u64 + 6000,
                    )
                    .unwrap_err(),
                REFUSAL
            );
            assert_eq!(calls.get(), 0);
        });
    }
}

#[test]
fn earlier_validation_errors_clear_stale_observation_without_inventing_round_metrics() {
    let (request, transcript, _, samples, metadata) = super::tests::fixture();
    let request_json = serde_json::to_string(&request).unwrap();
    let mut wrong_hash = transcript.clone();
    wrong_hash.rounds[0].pcm_sha256 = "0".repeat(64);
    let mut wrong_metadata = metadata.clone();
    wrong_metadata.input.sample_rate = 44_100;
    let mut invalid_pcm = samples.clone();
    invalid_pcm[0] = f32::NAN;
    let now_ms = (NOW * 1000.0) as u64 + 6000;
    with_signer(|signer, calls| {
        for (pcm, receipt, capture, at) in [
            (&samples, &wrong_hash, &metadata, now_ms),
            (&samples, &transcript, &wrong_metadata, now_ms),
            (&invalid_pcm, &transcript, &metadata, now_ms),
            (&samples, &transcript, &metadata, now_ms + 120_000),
        ] {
            let receipt_json = serde_json::to_string(receipt).unwrap();
            let mut slot = Some("stale observation".into());
            let old_error = signer
                .seal_native_audio(pcm, &request_json, &receipt_json, capture, at)
                .unwrap_err();
            let observed_error = signer
                .seal_native_audio_observed(
                    pcm,
                    &request_json,
                    &receipt_json,
                    capture,
                    at,
                    &mut slot,
                )
                .unwrap_err();
            assert_eq!(observed_error, old_error);
            assert!(slot.is_none());
            assert_eq!(calls.get(), 0);
        }
    });
}

#[test]
fn later_signing_failure_keeps_the_completed_unsigned_round_checks_immutable() {
    let (request, transcript, _, samples, metadata) = super::tests::fixture();
    let request_json = serde_json::to_string(&request).unwrap();
    let transcript_json = serde_json::to_string(&transcript).unwrap();
    let key = crate::CertificateKey::generate().unwrap().key;
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let certs = crate::native_signer::create_certificate_chain(spki.as_bytes()).unwrap();
    let calls = Cell::new(0);
    let mut callback = |_: &[u8]| {
        calls.set(calls.get() + 1);
        Err("synthetic signer refusal".to_owned())
    };
    let signer = ExternalSigner::new(&certs, spki.as_bytes(), &mut callback).unwrap();
    let mut slot = None;
    let error = signer
        .seal_native_audio_observed(
            &samples,
            &request_json,
            &transcript_json,
            &metadata,
            (NOW * 1000.0) as u64 + 6000,
            &mut slot,
        )
        .unwrap_err();
    assert!(error.contains("synthetic signer refusal"), "{error}");
    assert!(calls.get() > 0);
    let frozen = slot.clone();
    let report = assessment(&slot, &request, &transcript);
    assert_eq!(report["passed"], true);
    assert_quantized_reports(&samples, &transcript, &report);
    let mut another = Some("stale".into());
    assert!(signer
        .seal_native_audio_observed(
            &samples,
            "{}",
            &transcript_json,
            &metadata,
            (NOW * 1000.0) as u64 + 6000,
            &mut another,
        )
        .is_err());
    assert!(another.is_none());
    assert_eq!(slot, frozen);
}

#[test]
fn maximum_fifteen_round_assessment_fits_its_byte_bound_without_nonce_or_pcm() {
    let (request, mut transcript, _, samples, _) = super::tests::fixture();
    let canonical = crate::decode_audio_pcm(&crate::encode_audio_pcm(&samples).unwrap()).unwrap();
    let detected = crate::audio_signal::detect(
        &canonical[..CHUNK_SAMPLES as usize],
        crate::audio::SAMPLE_RATE,
        &request.session_id,
        0,
        &transcript.rounds[0].nonce,
    )
    .unwrap();
    let receipt = transcript.rounds[0].clone();
    transcript.rounds = (0..15)
        .map(|index| {
            let mut round = receipt.clone();
            round.index = index;
            round.start_sample = index * CHUNK_SAMPLES;
            round
        })
        .collect();
    // Serialization bounds only; these copies do not claim fifteen collections.
    let detections = vec![detected.clone(); 15];
    let slot = Some(serialize_round_assessment(&transcript, &detections).unwrap());
    let report = assessment(&slot, &request, &transcript);
    assert_eq!(report["rounds"].as_array().unwrap().len(), 15);
    assert_eq!(report["passed"], true);
    transcript.rounds.push(receipt);
    assert!(serialize_round_assessment(&transcript, &vec![detected; 16]).is_err());
    assert!(serialize_round_assessment(&transcript, &[]).is_err());
}

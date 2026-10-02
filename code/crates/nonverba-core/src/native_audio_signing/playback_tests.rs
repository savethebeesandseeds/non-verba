// SPDX-License-Identifier: AGPL-3.0-only
//! Real signed WAV regressions for native output-frame/clock consistency.
use super::*;
use crate::audio_capture::AudioCaptureMetadata;
use futures::executor::block_on;
use p256::{
    ecdsa::{signature::Signer as _, Signature},
    pkcs8::EncodePublicKey,
};
use serde_json::Value;

const NOW: f64 = 1_790_424_000.0;

fn shift_frames(metadata: &mut AudioCaptureMetadata, offset: i64) {
    for round in &mut metadata.rounds {
        round.output_start_stream_frame =
            (round.output_start_stream_frame.parse::<i64>().unwrap() + offset).to_string();
        round.output_end_stream_frame =
            (round.output_end_stream_frame.parse::<i64>().unwrap() + offset).to_string();
    }
}

#[test]
fn output_playback_frames_cannot_float_independently_of_hardware_timestamps() {
    let (request, transcript, _, _, valid) = super::tests::fixture();
    let now = (NOW * 1000.0) as u64 + 6000;
    valid.validate(&request, &transcript, now).unwrap();
    for offset in [9_000_000_000, -48_000] {
        let mut changed = valid.clone();
        shift_frames(&mut changed, offset);
        assert!(
            changed.validate(&request, &transcript, now).is_err(),
            "displaced output frames: {offset}"
        );
    }
}

#[test]
fn output_clock_displacement_is_rejected_even_in_an_authentic_c2pa_wav() {
    let (request, transcript, _, samples, mut metadata) = super::tests::fixture();
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
    shift_frames(&mut metadata, 9_000_000_000);
    assert!(
        signer
            .seal_native_audio(
                &samples,
                &request_json,
                &transcript_json,
                &metadata,
                (NOW * 1000.0) as u64 + 6000
            )
            .is_err(),
        "Producer must also reject the inconsistent playback clock"
    );
    metadata.sealed_at_unix_ms = Some((NOW * 1000.0) as u64 + 6000);
    metadata.seal_time_origin = Some("native-finalization-start".into());
    let (mut builder, mut source) = crate::audio::prepare_audio(
        &samples,
        &request_json,
        &transcript_json,
        NOW + 6.0,
        signer.fingerprint(),
    )
    .unwrap();
    // Bypass the producer validator deliberately: only the independent verifier
    // can reject a malformed assertion from an otherwise authorized signer.
    builder.add_assertion(ASSERTION_LABEL, &metadata).unwrap();
    let mut destination = Cursor::new(Vec::new());
    builder
        .sign(&signer, "audio/wav", &mut source, &mut destination)
        .unwrap();
    let report: Value = serde_json::from_str(
        &block_on(crate::verify_audio(
            destination.get_ref(),
            &request_json,
            &transcript_json,
            signer.fingerprint(),
            NOW + 7.0,
        ))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(report["checks"]["c2pa_integrity"], true, "{report}");
    assert_eq!(report["checks"]["signal_detected"], true, "{report}");
    assert_eq!(
        report["checks"]["native_audio_metadata_valid"], false,
        "{report}"
    );
    assert_eq!(report["verified"], false);
    assert_eq!(report["hardware_attested"], false);
    assert_eq!(report["sensor_origin_proven"], false);
}

#[test]
fn output_timestamp_correlation_preserves_queued_playback_and_legacy_monitoring_shape() {
    let (request, transcript, _, _, mut metadata) = super::tests::fixture();
    let now = (NOW * 1000.0) as u64 + 6000;
    // A half-second output queue is legitimate with this reported capacity;
    // the presentation frame must not be forced to the callback's own time.
    metadata.output.buffer_capacity_frames = 24_000;
    shift_frames(&mut metadata, 24_000);
    metadata.validate(&request, &transcript, now).unwrap();
    metadata.recording_configuration = None;
    metadata.validate(&request, &transcript, now).unwrap();
}

#[test]
fn output_timestamp_origin_remains_independent_of_input_and_exact_above_js_integer_limit() {
    let (request, transcript, _, _, mut metadata) = super::tests::fixture();
    let now = (NOW * 1000.0) as u64 + 6000;
    // The output stream can start before the input stream. Only the output
    // frame/time relation matters, never numerical equality of their frames.
    let offset = 9_007_199_254_740_993;
    shift_frames(&mut metadata, offset);
    for point in &mut metadata.checkpoints {
        point.output_frame_position =
            (point.output_frame_position.parse::<i64>().unwrap() + offset).to_string();
    }
    metadata.validate(&request, &transcript, now).unwrap();
    // Moving just the output hardware position breaks that relation, even
    // though every clock still advances at exactly the expected sample rate.
    for point in &mut metadata.checkpoints {
        point.output_frame_position =
            (point.output_frame_position.parse::<i64>().unwrap() + 48_000).to_string();
    }
    assert!(metadata.validate(&request, &transcript, now).is_err());
}

#[test]
fn buffered_probe_cannot_be_scheduled_beyond_the_retained_recording() {
    let (request, transcript, _, _, mut metadata) = super::tests::fixture();
    let now = (NOW * 1000.0) as u64 + 6000;
    // Queue capacity alone is insufficient: the final complete marker must
    // still belong to the recording interval, with input-delivery allowance.
    metadata.output.buffer_capacity_frames = 96_000;
    let last = metadata.rounds.last_mut().unwrap();
    last.output_start_stream_frame =
        (last.output_start_stream_frame.parse::<u64>().unwrap() + 96_000).to_string();
    last.output_end_stream_frame =
        (last.output_end_stream_frame.parse::<u64>().unwrap() + 96_000).to_string();
    let error = metadata.validate(&request, &transcript, now).unwrap_err();
    assert!(error.contains("playback frame positions"), "{error}");
}

#[test]
fn extreme_playback_counters_fail_without_wrapping_or_panicking() {
    let (request, transcript, _, _, mut metadata) = super::tests::fixture();
    let now = (NOW * 1000.0) as u64 + 6000;
    let last = metadata.rounds.last_mut().unwrap();
    last.output_start_stream_frame =
        (i64::MAX - crate::audio_signal::PROBE_SAMPLES as i64).to_string();
    last.output_end_stream_frame = i64::MAX.to_string();
    assert!(metadata.validate(&request, &transcript, now).is_err());
}

// SPDX-License-Identifier: AGPL-3.0-only
//! Silent synthetic pilot diagnostics; no microphone, playback or signing.

use super::*;
use crate::audio_signal::{self, Detection, SAMPLE_RATE};
use serde_json::Value;

const SESSION: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NONCE: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

fn wire_value<T: serde::Serialize>(value: &T) -> Value {
    // Match inspect_pilot's exact wire path: direct to_value widens f32 to f64
    // instead of parsing the decimal emitted by the report's JSON serializer.
    serde_json::from_str(&serde_json::to_string(value).unwrap()).unwrap()
}

fn round(nonce: &str) -> String {
    indexed_round(0, nonce)
}

fn indexed_round(index: u32, nonce: &str) -> String {
    serde_json::to_string(&AudioRound {
        session_id: SESSION.into(),
        index,
        nonce: nonce.into(),
    })
    .unwrap()
}

fn recording(offset: usize, gain: f32) -> Vec<f32> {
    let probe = audio_signal::generate(SESSION, 0, NONCE).unwrap();
    let mut samples = vec![0.0; CHUNK_SAMPLES as usize];
    for (target, sample) in samples[offset..].iter_mut().zip(probe) {
        *target = gain * sample;
    }
    samples
}

fn inspect(samples: &[f32], nonce: &str) -> Value {
    inspect_indexed(samples, 0, nonce)
}

fn inspect_indexed(samples: &[f32], index: u32, nonce: &str) -> Value {
    let json = inspect_pilot(samples, &indexed_round(index, nonce)).unwrap();
    assert!(
        json.len() < 1024,
        "The fixed diagnostic unexpectedly expanded"
    );
    assert!(!json.contains(NONCE) && !json.contains(SESSION));
    let assessment: Value = serde_json::from_str(&json).unwrap();
    assert_eq!(assessment.as_object().unwrap().len(), 8);
    assert_eq!(assessment["version"], 1);
    assert_eq!(assessment["type"], "nonverba-native-audio-pilot-assessment");
    assert_eq!(assessment["signal_algorithm"], audio_signal::PROFILE);
    assert_eq!(assessment["sample_count"], CHUNK_SAMPLES);
    assert_eq!(assessment["maximum_start_offset_samples"], 38_400);
    let detection = assessment["detection"].as_object().unwrap();
    assert_eq!(detection.len(), 8);
    assert_eq!(detection["sample_rate"], SAMPLE_RATE);
    assert_eq!(detection["symbol_count"], 64);
    for metric in ["score", "rms", "in_band_ratio"] {
        let value = detection[metric].as_f64().unwrap();
        assert!(
            value.is_finite() && (0.0..=1.0).contains(&value),
            "{metric}"
        );
    }
    assert!(detection["matched_symbols"].as_u64().unwrap() <= 64);
    assessment
}

fn detected(offset_samples: u32) -> Detection {
    Detection {
        detected: true,
        score: 0.95,
        matched_symbols: 64,
        symbol_count: 64,
        offset_samples,
        sample_rate: SAMPLE_RATE,
        rms: 0.2,
        in_band_ratio: 0.9,
    }
}

#[test]
fn pilot_policy_retains_the_exact_inclusive_sample_boundary() {
    let limit = PilotAssessment::from_detection(detected(38_400));
    assert!(limit.passed);
    assert_eq!(limit.reason, PilotReason::Passed);
    let late = PilotAssessment::from_detection(detected(38_401));
    assert!(!late.passed);
    assert_eq!(late.reason, PilotReason::DetectedLate);
    let mut absent = detected(38_401);
    absent.detected = false;
    let absent = PilotAssessment::from_detection(absent);
    assert!(!absent.passed);
    assert_eq!(absent.reason, PilotReason::NotDetected);
}

#[test]
fn timely_pilot_inspection_and_legacy_success_use_identical_detection() {
    let samples = recording(4_800, 0.5);
    let assessment = inspect(&samples, NONCE);
    assert_eq!(assessment["passed"], true);
    assert_eq!(assessment["reason"], "passed");
    assert_eq!(assessment["detection"]["detected"], true);
    assert!(
        assessment["detection"]["offset_samples"]
            .as_u64()
            .unwrap()
            .abs_diff(4_800)
            <= 192
    );
    let legacy: Value =
        serde_json::from_str(&validate_pilot(&samples, &round(NONCE)).unwrap()).unwrap();
    assert_eq!(legacy, assessment["detection"]);
    let ordinary = audio_signal::detect(&samples, SAMPLE_RATE, SESSION, 0, NONCE).unwrap();
    assert_eq!(wire_value(&ordinary), assessment["detection"]);
}

fn add_marker(samples: &mut [f32], offset: usize, gain: f32, noise: f32) {
    let probe = audio_signal::generate(SESSION, 7, NONCE).unwrap();
    assert!(offset + probe.len() <= samples.len());
    let mut random = 0x9137_abc1_u32;
    for (target, sample) in samples[offset..].iter_mut().zip(probe) {
        random ^= random << 13;
        random ^= random >> 17;
        random ^= random << 5;
        let uniform = (random as f64 / f64::from(u32::MAX) * 2.0 - 1.0) as f32;
        *target += gain * sample + noise * uniform;
    }
}

#[test]
fn pilot_only_fallback_recovers_a_timely_marker_hidden_by_a_sub_floor_repeat() {
    // Matches the real-JNI silent characterization, with noise only around the
    // timely marker and two complete, disjoint nonce-bound marker intervals.
    let mut baseline = vec![0.0; CHUNK_SAMPLES as usize];
    add_marker(&mut baseline, 4_800, 0.07, 0.025);
    let ordinary = audio_signal::detect(&baseline, SAMPLE_RATE, SESSION, 7, NONCE).unwrap();
    assert!(ordinary.detected, "{ordinary:?}");
    let baseline_assessment = inspect_indexed(&baseline, 7, NONCE);
    assert_eq!(baseline_assessment["passed"], true);
    assert_eq!(baseline_assessment["detection"], wire_value(&ordinary));

    let mut samples = baseline.clone();
    add_marker(&mut samples, 57_600, 0.0005, 0.0);
    // Preserve the general detector's existing selection and demonstrate the
    // genuine suppression, rather than broadening signed acceptance.
    let generic = audio_signal::detect(&samples, SAMPLE_RATE, SESSION, 7, NONCE).unwrap();
    assert!(
        generic.offset_samples.abs_diff(57_600) <= 192,
        "{generic:?}"
    );
    let original = PilotAssessment::from_detection(generic);
    assert!(!original.passed);
    assert_eq!(original.reason, PilotReason::NotDetected);

    let assessment = inspect_indexed(&samples, 7, NONCE);
    assert_eq!(assessment["passed"], true);
    assert_eq!(assessment["reason"], "passed");
    let detection = &assessment["detection"];
    assert_eq!(detection["detected"], true);
    assert!(detection["offset_samples"].as_u64().unwrap() <= 38_400);
    assert!(
        detection["offset_samples"]
            .as_u64()
            .unwrap()
            .abs_diff(4_800)
            <= 192
    );
    assert!(detection["score"].as_f64().unwrap() >= 0.85);
    assert!(detection["matched_symbols"].as_u64().unwrap() >= 60);
    assert!(detection["rms"].as_f64().unwrap() >= 0.0003);
    assert!(detection["in_band_ratio"].as_f64().unwrap() >= 0.025);
    let legacy: Value =
        serde_json::from_str(&validate_pilot(&samples, &indexed_round(7, NONCE)).unwrap()).unwrap();
    assert_eq!(legacy, *detection);
}

#[test]
fn synthetic_characterization_compares_float_pilot_with_pcm16_round_detection() {
    // Silent synthetic characterization only, not phone-failure causation.
    // Reuse the exact readiness regression fixtures; no signatures, raw-media
    // exports, detector changes or successful-acceptance policy changes.
    let mut baseline = vec![0.0; CHUNK_SAMPLES as usize];
    add_marker(&mut baseline, 4_800, 0.07, 0.025);
    let mut repeated = baseline.clone();
    add_marker(&mut repeated, 57_600, 0.0005, 0.0);
    let mut invariants = Vec::new();
    for (name, samples) in [
        ("timely-noisy-baseline", baseline),
        ("sub-floor-repeat", repeated),
    ] {
        let assessment = inspect_indexed(&samples, 7, NONCE);
        let detection = &assessment["detection"];
        let float_window_passed = detection["detected"].as_bool().unwrap()
            && detection["offset_samples"].as_u64().unwrap()
                <= u64::from(PILOT_MAXIMUM_START_OFFSET_SAMPLES);
        println!(
            "{}",
            serde_json::json!({
                "type": "nonverba-synthetic-audio-pcm-path-characterization",
                "case": name,
                "path": "native-float-pilot",
                "physical_device_tested": false,
                "assessment": assessment,
                "per_round_window_passed": float_window_passed,
            })
        );
        let decoded =
            crate::audio::decode_audio_pcm(&crate::audio::encode_audio_pcm(&samples).unwrap())
                .unwrap();
        assert_eq!(decoded.len(), CHUNK_SAMPLES as usize);
        // This is precisely the canonical PCM16 and generic-detector path used
        // by prepare_audio for each transcript chunk before any WAV signing.
        let quantized = audio_signal::detect(&decoded, SAMPLE_RATE, SESSION, 7, NONCE).unwrap();
        let pcm16_window_passed =
            quantized.detected && quantized.offset_samples <= PILOT_MAXIMUM_START_OFFSET_SAMPLES;
        println!(
            "{}",
            serde_json::json!({
                "type": "nonverba-synthetic-audio-pcm-path-characterization",
                "case": name,
                "path": "pcm16-generic-round-detector",
                "physical_device_tested": false,
                "sample_count": decoded.len(),
                "detection": wire_value(&quantized),
                "per_round_window_passed": pcm16_window_passed,
            })
        );
        invariants.push((float_window_passed, pcm16_window_passed));
    }
    // Both FLOAT readiness results are covered by the regression immediately
    // above. Canonical PCM16 must preserve the supported timely-noisy baseline.
    // Print all four actual results first; the quantized repeat remains an
    // exploratory observation with no guessed pass/refusal assertion.
    assert!(invariants[0].0 && invariants[1].0);
    assert!(
        invariants[0].1,
        "Canonical PCM16 changed the supported baseline"
    );
}

#[test]
fn pilot_fallback_without_a_qualifying_timely_code_preserves_the_original_refusal() {
    let mut late_only = vec![0.0; CHUNK_SAMPLES as usize];
    add_marker(&mut late_only, 57_600, 0.1, 0.0);
    let mut quiet_timely = vec![0.0; CHUNK_SAMPLES as usize];
    add_marker(&mut quiet_timely, 4_800, 0.0005, 0.0);
    let mut quiet_late = vec![0.0; CHUNK_SAMPLES as usize];
    add_marker(&mut quiet_late, 57_600, 0.0005, 0.0);
    let mut quiet_timely_and_late = late_only.clone();
    add_marker(&mut quiet_timely_and_late, 4_800, 0.0005, 0.0);
    let mut wrong_challenge = late_only.clone();
    add_marker(&mut wrong_challenge, 4_800, 0.07, 0.025);

    for (samples, index, nonce) in [
        (late_only, 7, NONCE),
        (quiet_timely, 7, NONCE),
        (quiet_late, 7, NONCE),
        (quiet_timely_and_late, 7, NONCE),
        (wrong_challenge.clone(), 7, SESSION),
        (wrong_challenge, 8, NONCE),
        (vec![0.0; CHUNK_SAMPLES as usize], 7, NONCE),
    ] {
        let generic = audio_signal::detect(&samples, SAMPLE_RATE, SESSION, index, nonce).unwrap();
        let original = PilotAssessment::from_detection(generic);
        assert!(!original.passed);
        let assessment = inspect_indexed(&samples, index, nonce);
        assert_eq!(assessment, wire_value(&original));
        assert_eq!(assessment["passed"], false);
        assert!(validate_pilot(&samples, &indexed_round(index, nonce)).is_err());
    }
}

#[test]
fn original_detected_late_refusals_keep_their_complete_metrics_and_deadline() {
    let mut strong_repeat = vec![0.0; CHUNK_SAMPLES as usize];
    add_marker(&mut strong_repeat, 4_800, 0.07, 0.025);
    add_marker(&mut strong_repeat, 57_600, 0.1, 0.0);
    let mut cases = vec![strong_repeat];
    for offset in [38_448, 38_640, 38_880] {
        let mut samples = vec![0.0; CHUNK_SAMPLES as usize];
        add_marker(&mut samples, offset, 0.1, 0.0);
        cases.push(samples);
    }
    for samples in cases {
        let generic = audio_signal::detect(&samples, SAMPLE_RATE, SESSION, 7, NONCE).unwrap();
        assert!(generic.detected, "{generic:?}");
        assert!(generic.offset_samples > 38_400, "{generic:?}");
        let original = PilotAssessment::from_detection(generic);
        assert_eq!(original.reason, PilotReason::DetectedLate);
        assert_eq!(inspect_indexed(&samples, 7, NONCE), wire_value(&original));
        assert!(validate_pilot(&samples, &indexed_round(7, NONCE)).is_err());
    }
}

#[test]
fn qualifying_late_peak_does_not_replace_an_original_not_detected_refusal() {
    let mut samples = vec![0.0; CHUNK_SAMPLES as usize];
    add_marker(&mut samples, 4_800, 0.0005, 0.0);
    add_marker(&mut samples, 57_600, 0.07, 0.025);
    let generic = audio_signal::detect(&samples, SAMPLE_RATE, SESSION, 7, NONCE).unwrap();
    assert!(!generic.detected, "{generic:?}");
    assert!(generic.offset_samples.abs_diff(4_800) <= 192, "{generic:?}");
    let original = PilotAssessment::from_detection(generic);
    assert_eq!(original.reason, PilotReason::NotDetected);
    let qualifying = audio_signal::detect_qualifying_peak(&samples, SAMPLE_RATE, SESSION, 7, NONCE)
        .unwrap()
        .unwrap();
    assert!(qualifying.detected);
    assert!(qualifying.offset_samples > 38_400, "{qualifying:?}");
    assert_eq!(inspect_indexed(&samples, 7, NONCE), wire_value(&original));
    assert!(validate_pilot(&samples, &indexed_round(7, NONCE)).is_err());
}

#[test]
fn recovered_but_late_pilot_is_a_distinct_refusal() {
    let samples = recording(48_000, 0.5);
    let assessment = inspect(&samples, NONCE);
    assert_eq!(assessment["passed"], false);
    assert_eq!(assessment["reason"], "detected_late");
    assert_eq!(assessment["detection"]["detected"], true);
    assert!(assessment["detection"]["offset_samples"].as_u64().unwrap() > 38_400);
    assert!(validate_pilot(&samples, &round(NONCE)).is_err());
}

#[test]
fn silence_and_a_wrong_nonce_remain_not_detected_refusals() {
    for (samples, nonce) in [
        (vec![0.0; CHUNK_SAMPLES as usize], NONCE),
        (recording(4_800, 0.5), SESSION),
    ] {
        let assessment = inspect(&samples, nonce);
        assert_eq!(assessment["passed"], false);
        assert_eq!(assessment["reason"], "not_detected");
        assert_eq!(assessment["detection"]["detected"], false);
        assert!(validate_pilot(&samples, &round(nonce)).is_err());
    }
}

#[test]
fn filtered_carriers_and_low_gain_do_not_weaken_pilot_policy() {
    let mut filtered = recording(4_800, 0.5);
    let mut state = 0.0;
    for (index, sample) in filtered.iter_mut().enumerate() {
        // Known synthetic low-pass filtering attenuates the marker carriers;
        // unrelated lower-frequency content remains. This is not a device model.
        state += 0.001 * (*sample - state);
        *sample = state
            + (0.1 * (std::f64::consts::TAU * 440.0 * index as f64 / f64::from(SAMPLE_RATE)).sin())
                as f32;
    }
    for samples in [filtered, recording(4_800, 0.0001)] {
        let assessment = inspect(&samples, NONCE);
        assert_eq!(assessment["passed"], false);
        assert_eq!(assessment["reason"], "not_detected");
        assert_eq!(assessment["detection"]["detected"], false);
        assert!(validate_pilot(&samples, &round(NONCE)).is_err());
    }
}

#[test]
fn inspection_rejects_invalid_inputs_instead_of_inventing_a_sensor_diagnosis() {
    let valid = recording(4_800, 0.5);
    for length in [0, CHUNK_SAMPLES as usize - 1, CHUNK_SAMPLES as usize + 1] {
        let samples = vec![0.0; length];
        assert!(inspect_pilot(&samples, &round(NONCE)).is_err());
        assert!(validate_pilot(&samples, &round(NONCE)).is_err());
    }
    for sample in [f32::NAN, f32::INFINITY, -1.01, 1.01] {
        let mut invalid = valid.clone();
        invalid[0] = sample;
        assert!(inspect_pilot(&invalid, &round(NONCE)).is_err());
        assert!(validate_pilot(&invalid, &round(NONCE)).is_err());
    }
    for challenge in [
        "{}".into(),
        round(&NONCE.to_uppercase()),
        round("not-a-nonce"),
    ] {
        assert!(inspect_pilot(&valid, &challenge).is_err());
        assert!(validate_pilot(&valid, &challenge).is_err());
    }
}

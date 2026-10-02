// SPDX-License-Identifier: AGPL-3.0-only
//! Actual cryptographic artifacts across all four variants, plus hostile timing
//! and authority mutations. Synthetic measurements never establish sensor truth.
use super::*;
use futures::executor::block_on;
use serde_json::{json as value, Value};
const NOW: f64 = 2_000_000_000.0;
const BASE: u64 = 2_000_000_000_000;
const CONTEXT: &str = r#"{"version":1}"#;

struct Fixture {
    operator: String,
    requester: String,
    pin: String,
    spec: Value,
    original: String,
    primary: Vec<u8>,
    secondary: Vec<u8>,
    transcript: String,
    receipt: String,
}
impl Fixture {
    fn seal(&self, timing: ReceiptTiming, now: f64) -> Result<String, String> {
        block_on(seal_evidence_session_receipt(
            &self.original,
            &self.primary,
            &self.secondary,
            &self.transcript,
            &json(&timing).unwrap(),
            &self.requester,
            &self.pin,
            CONTEXT,
            now,
        ))
    }
    fn verify(&self, receipt: &str, now: f64) -> Value {
        parse(
            &block_on(verify_evidence_session_receipt(
                receipt,
                &self.original,
                &self.primary,
                &self.secondary,
                &self.transcript,
                &self.pin,
                CONTEXT,
                now,
            ))
            .unwrap(),
        )
        .unwrap()
    }
    fn resign_receipt(&self, mutate: impl FnOnce(&mut SessionReceipt)) -> String {
        let mut envelope: ReceiptEnvelope = parse(&self.receipt).unwrap();
        let mut receipt = cose::read::<SessionReceipt>(
            &decode(&envelope.receipt_cose_b64).unwrap(),
            RECEIPT_TYPE,
        )
        .unwrap()
        .payload;
        mutate(&mut receipt);
        envelope.receipt_cose_b64 = STANDARD.encode(
            cose::sign(
                &receipt,
                &cose::RequesterIdentity::load(&self.requester).unwrap(),
                RECEIPT_TYPE,
            )
            .unwrap(),
        );
        json(&envelope).unwrap()
    }
    fn rewrap(&mut self) {
        self.original =
            create_evidence_session_request(&self.spec.to_string(), &self.requester, NOW).unwrap();
    }
}
fn jpeg() -> Vec<u8> {
    let pixels = image::RgbImage::from_fn(640, 480, |x, y| {
        image::Rgb([
            (48 + x / 4 % 160) as u8,
            (48 + y / 3 % 160) as u8,
            (64 + (x + y) / 5 % 128) as u8,
        ])
    });
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 95)
        .encode_image(&pixels)
        .unwrap();
    bytes
}
fn fixture(kind: &str, demo: bool) -> Fixture {
    fixture_with_camera_timing(kind, demo, None)
}
fn native_camera_image(
    operator: &str,
    challenge: &Value,
    location: &str,
    location_request: Option<Value>,
    acquired_at_ms: u64,
    finalized_at_ms: u64,
) -> Vec<u8> {
    // Real C2PA signatures over synthetic pixels and camera clock claims.
    // A software fixture key does not establish native hardware acquisition.
    let identity: crate::Identity = parse(operator).unwrap();
    let signer = crate::local_signer(&identity).unwrap();
    let (mut builder, mut source) = crate::prepare_image(
        &jpeg(),
        &challenge.to_string(),
        (acquired_at_ms / 1000) as f64,
        location,
        location_request,
        crate::ImageSigningIdentity {
            fingerprint: &identity.fingerprint,
            protection: "device-local-software-key",
        },
    )
    .unwrap();
    let mut metadata = crate::camera_capture::tests::fixture();
    metadata.request_received_unix_ms = acquired_at_ms;
    metadata.callback_received_unix_ms = acquired_at_ms;
    metadata.acquired_at_unix_ms = acquired_at_ms;
    metadata.sealed_at_unix_ms = Some(finalized_at_ms);
    metadata.seal_time_origin = Some("native-finalization-start".into());
    builder
        .add_assertion(crate::camera_capture::ASSERTION_LABEL, &metadata)
        .unwrap();
    let mut destination = std::io::Cursor::new(Vec::new());
    builder
        .sign(&signer, "image/jpeg", &mut source, &mut destination)
        .unwrap();
    destination.into_inner()
}
fn fixture_with_camera_timing(
    kind: &str,
    demo: bool,
    camera_timing: Option<(u64, u64)>,
) -> Fixture {
    let operator = crate::create_identity().unwrap();
    let requester = crate::create_identity().unwrap();
    let pin = cose::RequesterIdentity::load(&requester).unwrap().pin;
    let media_pin = crate::identity_fingerprint(&operator).unwrap();
    let location_pin = cose::RequesterIdentity::load(&operator).unwrap().pin;
    let mut trace =
        crate::location_proof::parse_trace(include_str!("../location_proof/raw_gnss_fixture.json"))
            .unwrap();
    trace.request.demo = demo;
    trace.raw_gnss = None;
    trace.request.policy.raw_gnss = None;
    trace.request.policy.profile = "browser-or-native".into();
    trace.request.policy.required_provider = "any".into();
    trace.profile = "software-browser".into();
    trace.permission_precision = "browser".into();
    trace.uncertainty_semantics = "w3c-95-percent".into();
    for sample in &mut trace.samples {
        sample.provider = "browser-geolocation".into();
        sample.fix_elapsed_ms = None;
        sample.mock = None;
    }
    let mut secondary = Vec::new();
    let mut transcript = String::new();
    let request;
    let primary;
    let pins;
    if kind == "location" {
        request = value!(trace.request);
        primary = crate::location_proof::seal_location_proof(
            &json(&trace).unwrap(),
            &operator,
            "null",
            NOW + 12.0,
        )
        .unwrap();
        pins = value!({"media_certificate_sha256":null,"location_spki_sha256":location_pin});
    } else if kind == "audio" {
        use crate::audio::*;
        let mut audio: AudioRequest = parse(
            &create_audio_request("requester", "synthetic protocol test", NOW, 900, 4).unwrap(),
        )
        .unwrap();
        audio.demo = demo;
        request = value!(audio);
        let mut pcm = vec![0.0; 4 * SAMPLE_RATE as usize];
        let mut rounds = Vec::new();
        for index in 0..2 {
            let round: AudioRound = parse(
                &create_audio_round(&request.to_string(), index, NOW + index as f64 * 2.0).unwrap(),
            )
            .unwrap();
            let probe = audio_probe(&audio.session_id, index, &round.nonce).unwrap();
            let start = index as usize * CHUNK_SAMPLES as usize;
            pcm[start + 4800..start + 4800 + probe.len()].copy_from_slice(&probe);
            rounds.push(AudioReceipt {
                index,
                nonce: round.nonce,
                issued_elapsed_ms: index * 2010,
                received_elapsed_ms: index * 2010 + 2000,
                pcm_sha256: hash_audio_pcm(&pcm[start..start + CHUNK_SAMPLES as usize]).unwrap(),
                start_sample: index * CHUNK_SAMPLES,
                sample_count: CHUNK_SAMPLES,
            });
        }
        transcript = json(&AudioTranscript {
            version: 1,
            session_id: audio.session_id,
            started_at: NOW as u64,
            completed_at: NOW as u64 + 4,
            total_samples: pcm.len() as u32,
            rounds,
        })
        .unwrap();
        primary = block_on(seal_audio(
            &pcm,
            &operator,
            &request.to_string(),
            &transcript,
            NOW + 5.0,
        ))
        .unwrap();
        pins = value!({"media_certificate_sha256":media_pin,"location_spki_sha256":null});
    } else {
        let last = trace.samples.last().unwrap();
        let fix_timestamp_ms = if kind == "image" {
            camera_timing.map_or(last.fix_timestamp_ms, |(acquired, _)| acquired)
        } else {
            last.fix_timestamp_ms
        };
        let location=value!({"latitude":last.latitude,"longitude":last.longitude,"accuracy_m":last.accuracy_m,
            "altitude_m":last.altitude_m,"altitude_accuracy_m":last.altitude_accuracy_m,"timestamp_ms":fix_timestamp_ms,"source":"device-geolocation"}).to_string();
        if kind == "camera-location" {
            trace.request.context = Some(crate::location_proof::Context {
                camera_timing: None,
                session_id: "evidence-session-test".into(),
                purpose: "camera".into(),
            });
            request = value!(trace.request);
            primary = if let Some((acquired, finalized)) = camera_timing {
                native_camera_image(
                    &operator,
                    &value!(trace.request.challenge),
                    &location,
                    Some(request.clone()),
                    acquired,
                    finalized,
                )
            } else {
                block_on(crate::seal_image_with_location_request(
                    &jpeg(),
                    &json(&trace.request.challenge).unwrap(),
                    &operator,
                    NOW + 12.0,
                    &location,
                    &request.to_string(),
                ))
                .unwrap()
            };
            secondary = crate::location_proof::seal_location_proof(
                &json(&trace).unwrap(),
                &operator,
                &crate::location_proof::location_asset(&primary).unwrap(),
                NOW + 12.0,
            )
            .unwrap();
            pins =
                value!({"media_certificate_sha256":media_pin,"location_spki_sha256":location_pin});
        } else {
            request = value!(trace.request.challenge);
            primary = if let Some((acquired, finalized)) = camera_timing {
                native_camera_image(&operator, &request, &location, None, acquired, finalized)
            } else {
                block_on(crate::seal_image(
                    &jpeg(),
                    &request.to_string(),
                    &operator,
                    NOW + 12.0,
                    &location,
                ))
                .unwrap()
            };
            pins = value!({"media_certificate_sha256":media_pin,"location_spki_sha256":null});
        }
    }
    let spec = value!({"version":1,"evidence":{"type":kind,"request":request},"operator_pins":pins,
        "policy":{"version":1,"native_acquisition_required":false,"raw_gnss_required":false,"correlated_camera_clock_required":false,"hardware_attestation_required":false,"independent_position_required":false},
        "delivery":{"max_response_ms":90000,"max_receipt_age_ms":60000}});
    let mut f = Fixture {
        operator,
        requester,
        pin,
        spec,
        original: String::new(),
        primary,
        secondary,
        transcript,
        receipt: String::new(),
    };
    f.rewrap();
    let received_at_ms = camera_timing.map_or(BASE + 12000, |(_, finalized)| finalized);
    f.receipt = f
        .seal(
            ReceiptTiming {
                sent_at_ms: BASE,
                received_at_ms,
                elapsed_ms: received_at_ms - BASE,
            },
            received_at_ms.div_ceil(1000) as f64,
        )
        .unwrap();
    f
}

#[test]
fn native_camera_finalization_must_precede_requester_arrival_for_both_variants() {
    for kind in ["image", "camera-location"] {
        let f = fixture_with_camera_timing(kind, false, Some((BASE + 12000, BASE + 15001)));
        for (received, expected) in [(14001, true), (14000, false)] {
            let receipt = f.resign_receipt(|r| {
                r.timing.received_at_ms = BASE + received;
                r.timing.elapsed_ms = received;
            });
            let report = f.verify(&receipt, NOW + 16.0);
            assert_eq!(report["checks"]["receipt_authenticated"], true);
            assert_eq!(report["checks"]["artifact_bindings"], true);
            assert_eq!(report["checks"]["evidence_verified"], true);
            assert_eq!(
                report["checks"]["sample_precedes_reception"], expected,
                "{kind}: {report}"
            );
            assert_eq!(report["verified"], expected, "{kind}: {report}");
            assert_eq!(report["physical_measurement_authenticity_proven"], false);
            if !expected {
                assert_eq!(report["errors"], value!(["EVIDENCE_SAMPLE_OBSERVATION"]));
            }
            // The sealing API and independent verification apply the same rule.
            let sealed = f.seal(
                ReceiptTiming {
                    sent_at_ms: BASE,
                    received_at_ms: BASE + received,
                    elapsed_ms: received,
                },
                NOW + 16.0,
            );
            assert_eq!(sealed.is_ok(), expected, "{kind}: {sealed:?}");
        }
    }
}

#[test]
fn native_camera_acquisition_uses_milliseconds_at_the_dispatch_boundary() {
    let f = fixture_with_camera_timing("image", false, Some((BASE + 3999, BASE + 15001)));
    for (sent, expected) in [(4999, true), (5000, false)] {
        let receipt = f.resign_receipt(|r| {
            r.timing.sent_at_ms = BASE + sent;
            r.timing.elapsed_ms = r.timing.received_at_ms - r.timing.sent_at_ms;
        });
        let report = f.verify(&receipt, NOW + 16.0);
        assert_eq!(report["checks"]["evidence_verified"], true);
        assert_eq!(report["checks"]["prompt_dispatch"], true);
        assert_eq!(
            report["checks"]["sample_precedes_reception"], expected,
            "{report}"
        );
        assert_eq!(report["verified"], expected, "{report}");
        if !expected {
            assert_eq!(report["errors"], value!(["EVIDENCE_SAMPLE_OBSERVATION"]));
        }
    }
}

#[test]
fn all_four_variants_reverify_actual_artifacts_and_preserve_honest_claims() {
    for kind in ["image", "location", "camera-location", "audio"] {
        let f = fixture(kind, false);
        let report = f.verify(&f.receipt, NOW + 13.0);
        assert_eq!(report["verified"], true, "{kind}: {report}");
        assert_eq!(report["fresh_action_eligible"], true);
        assert_eq!(report["request"]["spec"]["evidence"]["type"], kind);
        for field in [
            "acceptance_recorded",
            "local_replay_checked",
            "global_replay_checked",
            "requester_clock_trusted",
            "independent_requester_proven",
            "physical_measurement_authenticity_proven",
        ] {
            assert_eq!(report[field], false, "{field}");
        }
        let parsed = validate_evidence_session_request(
            &f.original,
            &f.pin,
            &f.spec["operator_pins"].to_string(),
            NOW,
        )
        .unwrap();
        assert_eq!(
            parse::<Value>(&parsed).unwrap()["sensor_nonce"]
                .as_str()
                .unwrap()
                .len(),
            64
        );
    }
}

#[test]
fn stale_receipt_and_expiry_remove_action_eligibility_without_erasing_integrity() {
    let f = fixture("location", false);
    for at in [NOW + 73.0, NOW + 901.0] {
        let report = f.verify(&f.receipt, at);
        assert_eq!(report["verified"], true, "{report}");
        assert_eq!(report["fresh_action_eligible"], false);
    }
    let f = fixture("location", true);
    let report = f.verify(&f.receipt, NOW + 13.0);
    assert_eq!(report["verified"], true);
    assert_eq!(report["demo"], true);
    assert_eq!(report["fresh_action_eligible"], false);
}

#[test]
fn resigned_bad_timing_does_not_make_witness_claims_valid() {
    let f = fixture("location", false);
    let cases: Vec<fn(&mut SessionReceipt)> = vec![
        |r| {
            r.timing.sent_at_ms += 6000;
            r.timing.received_at_ms += 6000;
        },
        |r| r.timing.elapsed_ms = 90001,
        |r| r.timing.elapsed_ms = 9999,
        |r| r.timing.received_at_ms += 1001,
        |r| r.sealed_at_ms += 30001,
        |r| r.sealed_at_ms -= 1001,
        |r| {
            r.timing.received_at_ms = BASE + 901000;
            r.timing.elapsed_ms = 901000;
        },
        |r| r.timing.sent_at_ms = MAX_SAFE_INTEGER + 1,
        |r| r.demo = true,
    ];
    for mutate in cases {
        let changed = f.resign_receipt(mutate);
        assert_eq!(f.verify(&changed, NOW + 13.0)["verified"], false);
    }
    assert!(f
        .seal(
            ReceiptTiming {
                sent_at_ms: BASE + 6000,
                received_at_ms: BASE + 18000,
                elapsed_ms: 12000
            },
            NOW + 18.0
        )
        .is_err());
}

#[test]
fn request_authority_and_shapes_cannot_be_replaced() {
    let mut f = fixture("location", false);
    assert!(create_evidence_session_request(&f.spec.to_string(), &f.requester, NOW + 6.0).is_err());
    assert!(validate_evidence_session_request(
        &f.original,
        &f.pin,
        &f.spec["operator_pins"].to_string(),
        NOW + 6.0
    )
    .is_err());
    let wrong_pin = "f".repeat(64);
    assert!(validate_evidence_session_request(
        &f.original,
        &wrong_pin,
        &f.spec["operator_pins"].to_string(),
        NOW
    )
    .is_err());
    let mut pins = f.spec["operator_pins"].clone();
    pins["location_spki_sha256"] = value!(wrong_pin);
    assert!(
        validate_evidence_session_request(&f.original, &f.pin, &pins.to_string(), NOW).is_err()
    );
    let old = f.receipt.clone();
    f.rewrap();
    assert_eq!(f.verify(&old, NOW + 13.0)["verified"], false);
    for field in ["forged_report", "unknown"] {
        let mut spec = f.spec.clone();
        spec[field] = value!({"verified":true});
        assert!(create_evidence_session_request(&spec.to_string(), &f.requester, NOW).is_err());
    }
    f.spec["operator_pins"]
        .as_object_mut()
        .unwrap()
        .remove("media_certificate_sha256");
    assert!(create_evidence_session_request(&f.spec.to_string(), &f.requester, NOW).is_err());
}

#[test]
fn substituted_bytes_context_and_transcript_are_rejected_even_when_semantically_equal() {
    let mut f = fixture("location", false);
    f.primary[0] ^= 1;
    assert_eq!(f.verify(&f.receipt, NOW + 13.0)["verified"], false);
    let f = fixture("audio", false);
    let changed = format!(" {}", f.transcript);
    let result = block_on(verify_evidence_session_receipt(
        &f.receipt,
        &f.original,
        &f.primary,
        &f.secondary,
        &changed,
        &f.pin,
        CONTEXT,
        NOW + 13.0,
    ))
    .unwrap();
    assert_eq!(parse::<Value>(&result).unwrap()["verified"], false);
    let result = block_on(verify_evidence_session_receipt(
        &f.receipt,
        &f.original,
        &f.primary,
        &f.secondary,
        &f.transcript,
        &f.pin,
        "{\"version\": 1}",
        NOW + 13.0,
    ))
    .unwrap();
    assert_eq!(
        parse::<Value>(&result).unwrap()["checks"]["context_binding"],
        false
    );
}

#[test]
fn media_certificate_hash_does_not_hide_requester_operator_key_reuse() {
    let mut f = fixture("image", false);
    f.requester = f.operator.clone();
    f.pin = cose::RequesterIdentity::load(&f.requester).unwrap().pin;
    assert_ne!(f.pin, f.spec["operator_pins"]["media_certificate_sha256"]);
    f.rewrap();
    let error = f
        .seal(
            ReceiptTiming {
                sent_at_ms: BASE,
                received_at_ms: BASE + 12000,
                elapsed_ms: 12000,
            },
            NOW + 12.0,
        )
        .unwrap_err();
    assert!(error.contains("EVIDENCE_KEY_ROLES"), "{error}");
}

#[test]
fn frozen_evidence_policy_is_enforced_by_real_context_verifier() {
    let mut f = fixture("location", false);
    f.spec["policy"]["hardware_attestation_required"] = value!(true);
    f.rewrap();
    let error = f
        .seal(
            ReceiptTiming {
                sent_at_ms: BASE,
                received_at_ms: BASE + 12000,
                elapsed_ms: 12000,
            },
            NOW + 12.0,
        )
        .unwrap_err();
    assert!(error.contains("EVIDENCE_POLICY"), "{error}");
}

#[test]
fn policy_v2_is_frozen_and_monitoring_does_not_apply_to_other_sensors() {
    let mut f = fixture("location", false);
    f.spec["policy"]["version"] = value!(2);
    assert!(create_evidence_session_request(&f.spec.to_string(), &f.requester, NOW).is_err());
    f.spec["policy"]["audio_recording_monitoring_required"] = value!(false);
    f.rewrap();
    f.receipt = f
        .seal(
            ReceiptTiming {
                sent_at_ms: BASE,
                received_at_ms: BASE + 12000,
                elapsed_ms: 12000,
            },
            NOW + 12.0,
        )
        .unwrap();
    assert_eq!(f.verify(&f.receipt, NOW + 13.0)["verified"], true);
    f.spec["policy"]["audio_recording_monitoring_required"] = value!(true);
    f.rewrap();
    assert!(f
        .seal(
            ReceiptTiming {
                sent_at_ms: BASE,
                received_at_ms: BASE + 12000,
                elapsed_ms: 12000
            },
            NOW + 12.0
        )
        .unwrap_err()
        .contains("EVIDENCE_POLICY"));
    f.spec["policy"]["version"] = value!(1);
    assert!(create_evidence_session_request(&f.spec.to_string(), &f.requester, NOW).is_err());
}

#[test]
fn requester_signature_cannot_bless_corrupt_operator_artifact() {
    let mut f = fixture("location", false);
    f.primary[0] ^= 1;
    let changed = f.resign_receipt(|r| r.primary_binding = binding(&f.primary));
    let report = f.verify(&changed, NOW + 13.0);
    assert_eq!(report["checks"]["receipt_authenticated"], true);
    assert_eq!(report["checks"]["artifact_bindings"], true);
    assert_eq!(report["checks"]["evidence_verified"], false);
    assert_eq!(report["verified"], false);
}

#[test]
fn cose_domains_signatures_and_unknown_envelope_fields_are_enforced() {
    use coset::{CoseSign1, TaggedCborSerializable};
    let f = fixture("location", false);
    let original = request_bytes(&f.original).unwrap();
    let request = protocol::authenticate(&original, &f.pin).unwrap();
    let wrong_domain = cose::sign(
        &request,
        &cose::RequesterIdentity::load(&f.requester).unwrap(),
        RECEIPT_TYPE,
    )
    .unwrap();
    let envelope = RequestEnvelope {
        version: 1,
        kind: "nonverba-evidence-session-request".into(),
        cose_b64: STANDARD.encode(wrong_domain),
    };
    assert!(validate_evidence_session_request(
        &json(&envelope).unwrap(),
        &f.pin,
        &f.spec["operator_pins"].to_string(),
        NOW
    )
    .is_err());
    let mut receipt: ReceiptEnvelope = parse(&f.receipt).unwrap();
    let mut cose =
        CoseSign1::from_tagged_slice(&decode(&receipt.receipt_cose_b64).unwrap()).unwrap();
    cose.signature[0] ^= 1;
    receipt.receipt_cose_b64 = STANDARD.encode(cose.to_tagged_vec().unwrap());
    assert_eq!(
        f.verify(&json(&receipt).unwrap(), NOW + 13.0)["checks"]["receipt_authenticated"],
        false
    );
    let mut extra: Value = parse(&f.receipt).unwrap();
    extra["verified"] = value!(true);
    assert_eq!(f.verify(&extra.to_string(), NOW + 13.0)["verified"], false);
    let mut spec = f.spec.clone();
    spec["evidence"]["report"] = value!({"verified":true});
    assert!(create_evidence_session_request(&spec.to_string(), &f.requester, NOW).is_err());
}

#[test]
fn integer_time_api_conservatively_enforces_subsecond_age_policy() {
    let mut f = fixture("location", false);
    f.spec["delivery"]["max_receipt_age_ms"] = value!(1);
    f.rewrap();
    f.receipt = f
        .seal(
            ReceiptTiming {
                sent_at_ms: BASE,
                received_at_ms: BASE + 12000,
                elapsed_ms: 12000,
            },
            NOW + 12.0,
        )
        .unwrap();
    let report = f.verify(&f.receipt, NOW + 12.0);
    assert_eq!(report["verified"], true);
    assert_eq!(report["fresh_action_eligible"], false);
}

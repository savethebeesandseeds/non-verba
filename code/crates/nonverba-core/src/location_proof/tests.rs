// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use coset::{CoseSign1, TaggedCborSerializable};
use serde_json::Value;

pub(super) const NOW: u64 = 2_000_000_000;

pub(super) fn fixture(native: bool) -> (Trace, String, String) {
    let identity = crate::create_identity().unwrap();
    let public: Value = serde_json::from_str(&location_identity(&identity).unwrap()).unwrap();
    let pin = public["fingerprint"].as_str().unwrap().to_owned();
    let request = parse_request(
        &create_location_request(
            "Requester",
            "Observe the site",
            NOW as f64,
            900,
            "null",
            r#"{"session_id":"session-1","purpose":"standalone"}"#,
        )
        .unwrap(),
    )
    .unwrap();
    let start = NOW * 1000 + 1000;
    let samples = [1000, 6000, 11000]
        .iter()
        .enumerate()
        .map(|(i, &elapsed)| Sample {
            sequence: i,
            observed_elapsed_ms: elapsed,
            fix_timestamp_ms: start + elapsed,
            fix_elapsed_ms: native.then_some(elapsed),
            provider: if native { "gps" } else { "browser-geolocation" }.into(),
            latitude: 47.4979,
            longitude: 19.0402,
            accuracy_m: 12.0,
            altitude_m: Some(-5.0),
            altitude_accuracy_m: Some(3.0),
            mock: if native { Some(false) } else { None },
        })
        .collect();
    let trace = Trace {
        version: 1,
        kind: "nonverba-location-trace".into(),
        request,
        profile: if native {
            "native-android"
        } else {
            "software-browser"
        }
        .into(),
        permission_precision: if native { "fine" } else { "browser" }.into(),
        uncertainty_semantics: if native {
            "android-68-percent"
        } else {
            "w3c-95-percent"
        }
        .into(),
        capture_correlation: "none".into(),
        started_at_ms: start,
        ended_at_ms: start + 11000,
        elapsed_ms: 11000,
        samples,
        raw_gnss: None,
    };
    (trace, identity, pin)
}

pub(super) fn sealed(trace: &Trace, identity: &str, asset: Option<AssetBinding>) -> Vec<u8> {
    if trace.profile == "software-browser" {
        seal_location_proof(
            &json(trace).unwrap(),
            identity,
            &json(&asset).unwrap(),
            (NOW + 12) as f64,
        )
        .unwrap()
    } else {
        let key = software_key(identity).unwrap();
        let spki = key.verifying_key().to_public_key_der().unwrap();
        seal_with_signer(trace, spki.as_bytes(), asset, (NOW + 12) * 1000, |bytes| {
            let signature: Signature = key.sign(bytes);
            Ok(signature.to_der().as_bytes().to_vec())
        })
        .unwrap()
    }
}

#[test]
fn software_cose_round_trip_is_bound_but_not_attested() {
    let (trace, identity, pin) = fixture(false);
    let bytes = sealed(&trace, &identity, None);
    assert_eq!(bytes[0], 0xd2, "RFC 9052 COSE_Sign1 tag 18");
    let report = verify(&bytes, &trace.request, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(report.verified, "{:?}", report.errors);
    assert!(serde_json::to_value(&report.checks)
        .unwrap()
        .as_object()
        .unwrap()
        .values()
        .all(|v| v == true));
    assert!(
        !report.hardware_attested
            && !report.collection_attested
            && !report.location_authenticity_proven
            && !report.clock_trusted
    );
    assert_eq!(report.profile, "software-browser");
    assert_eq!(report.selected_location.as_ref(), trace.samples.last());
    assert_ne!(
        pin,
        crate::identity_fingerprint(&identity).unwrap(),
        "Location SPKI pin is distinct from the photo certificate pin"
    );
    assert!(
        verify(&bytes, &trace.request, &pin, None, (NOW + 100000) * 1000)
            .unwrap()
            .verified,
        "Historical proof must remain verifiable"
    );
}

#[test]
fn native_der_callback_claim_is_not_hardware_attestation() {
    let (mut trace, identity, pin) = fixture(true);
    trace.request.policy.profile = "native-required".into();
    trace.request.policy.required_provider = "gnss".into();
    let proof = sealed(&trace, &identity, None);
    let result = verify(&proof, &trace.request, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(result.verified, "{:?}", result.errors);
    assert_eq!(result.key_protection, "android-keystore");
    // This fixture intentionally uses a software key through the callback:
    // the source claim cannot, by itself, establish hardware provenance.
    assert!(
        !result.hardware_attested
            && !result.collection_attested
            && !result.location_authenticity_proven
    );
    assert!(
        seal_location_proof(&json(&trace).unwrap(), &identity, "null", (NOW + 12) as f64).is_err()
    );
}

#[test]
fn signature_payload_wrong_pin_and_exact_request_changes_fail() {
    let (trace, identity, pin) = fixture(false);
    let proof = sealed(&trace, &identity, None);
    let mut message = CoseSign1::from_tagged_slice(&proof).unwrap();
    message.signature[10] ^= 1;
    let bad = verify(
        &message.to_tagged_vec().unwrap(),
        &trace.request,
        &pin,
        None,
        (NOW + 12) * 1000,
    )
    .unwrap();
    assert!(!bad.verified && !bad.checks.signature_integrity);
    let mut message = CoseSign1::from_tagged_slice(&proof).unwrap();
    let mut evidence: Evidence = serde_json::from_slice(message.payload.as_ref().unwrap()).unwrap();
    evidence.trace.samples[1].latitude += 0.00001;
    message.payload = Some(serde_json::to_vec(&evidence).unwrap());
    assert!(
        !verify(
            &message.to_tagged_vec().unwrap(),
            &trace.request,
            &pin,
            None,
            (NOW + 12) * 1000
        )
        .unwrap()
        .checks
        .signature_integrity
    );
    assert!(
        !verify(
            &proof,
            &trace.request,
            &"0".repeat(64),
            None,
            (NOW + 12) * 1000
        )
        .unwrap()
        .checks
        .device_match
    );
    for field in ["challenge", "policy", "context", "demo"] {
        let mut expected = trace.request.clone();
        match field {
            "challenge" => {
                expected.challenge = parse_request(
                    &create_location_request(
                        "Requester",
                        "Observe the site",
                        NOW as f64,
                        900,
                        "null",
                        "null",
                    )
                    .unwrap(),
                )
                .unwrap()
                .challenge
            }
            "policy" => expected.policy.max_accuracy_m = 200.0,
            "context" => expected.context.as_mut().unwrap().session_id = "another-session".into(),
            _ => expected.demo = true,
        }
        let result = verify(&proof, &expected, &pin, None, (NOW + 12) * 1000).unwrap();
        assert!(!result.verified && !result.checks.request_match, "{field}");
    }
}

#[test]
fn policy_downgrade_and_mock_locations_fail_before_signing() {
    let (mut browser, identity, _) = fixture(false);
    browser.request.policy.profile = "native-required".into();
    assert!(seal_location_proof(
        &json(&browser).unwrap(),
        &identity,
        "null",
        (NOW + 12) as f64
    )
    .is_err());
    browser.request.policy.profile = "browser-or-native".into();
    browser.request.policy.required_provider = "gnss".into();
    assert!(validate_trace(&browser, (NOW + 12) * 1000).is_err());
    let (native, _, _) = fixture(true);
    let mut tampered = native.clone();
    tampered.samples[1].mock = Some(true);
    assert!(validate_trace(&tampered, (NOW + 12) * 1000).is_err());
    tampered.samples[1].mock = None;
    assert!(validate_trace(&tampered, (NOW + 12) * 1000).is_err());
    tampered = native.clone();
    tampered.permission_precision = "coarse".into();
    assert!(validate_trace(&tampered, (NOW + 12) * 1000).is_err());
    tampered = native;
    tampered.uncertainty_semantics = "w3c-95-percent".into();
    assert!(validate_trace(&tampered, (NOW + 12) * 1000).is_err());
}

#[test]
fn distinct_window_rejects_missing_duplicated_reordered_and_accelerated_samples() {
    let (trace, _, _) = fixture(false);
    for mode in 0..6 {
        let mut bad = trace.clone();
        match mode {
            0 => {
                bad.samples.remove(1);
            }
            1 => bad.samples[1] = bad.samples[0].clone(),
            2 => bad.samples.swap(0, 1),
            3 => bad.samples[1].sequence = 4,
            4 => {
                for (i, s) in bad.samples.iter_mut().enumerate() {
                    s.observed_elapsed_ms = (i + 1) as u64;
                    s.fix_timestamp_ms = bad.started_at_ms + s.observed_elapsed_ms;
                }
            }
            _ => bad.samples[2].fix_timestamp_ms = bad.samples[1].fix_timestamp_ms,
        }
        assert!(
            validate_trace(&bad, (NOW + 12) * 1000).is_err(),
            "Mode {mode}"
        );
    }
    let mut warmup = trace.clone();
    for s in &mut warmup.samples {
        s.observed_elapsed_ms += 12000;
        s.fix_timestamp_ms += 12000;
    }
    warmup.elapsed_ms += 12000;
    warmup.ended_at_ms += 12000;
    assert!(
        validate_trace(&warmup, (NOW + 24) * 1000).is_ok(),
        "Warmup is allowed before the distinct 10-second observation window"
    );
}

#[test]
fn stale_fix_finalization_and_native_delivery_delay_are_rejected() {
    let (trace, _, _) = fixture(false);
    assert!(
        validate_trace(&trace, (NOW + 18) * 1000).is_err(),
        "Selected fix expires before finalization"
    );
    let mut bad = trace.clone();
    bad.samples[1].fix_timestamp_ms -= 6000;
    assert!(validate_trace(&bad, (NOW + 12) * 1000).is_err());
    let (mut native, _, _) = fixture(true);
    native.samples[1].fix_elapsed_ms = Some(2000);
    native.samples[1].fix_timestamp_ms = native.started_at_ms + 2000;
    assert!(
        validate_trace(&native, (NOW + 12) * 1000).is_err(),
        "4-second native callback delay exceeds policy"
    );
    native.samples[0].fix_elapsed_ms = Some(0);
    assert!(
        validate_trace(&native, (NOW + 12) * 1000).is_err(),
        "Native fix must follow challenge receipt"
    );
}

#[test]
fn time_window_wall_jumps_future_and_native_clock_inconsistency_fail() {
    let (trace, _, _) = fixture(false);
    let mut jump = trace.clone();
    jump.ended_at_ms += 5000;
    assert!(validate_trace(&jump, (NOW + 17) * 1000).is_err());
    assert!(validate_trace(&trace, (NOW + 10) * 1000).is_err());
    let mut expiry = trace.clone();
    expiry.request.challenge.expires_at = NOW + 11;
    assert!(validate_trace(&expiry, (NOW + 12) * 1000).is_err());
    let (mut native, _, _) = fixture(true);
    native.samples[1].fix_timestamp_ms += 2000;
    assert!(validate_trace(&native, (NOW + 12) * 1000).is_err());
}

#[test]
fn uncertainty_coordinate_and_implausible_motion_are_rejected() {
    let (trace, _, _) = fixture(false);
    for mode in 0..5 {
        let mut bad = trace.clone();
        match mode {
            0 => bad.samples[1].accuracy_m = 101.0,
            1 => bad.samples[1].latitude = 90.1,
            2 => bad.samples[1].longitude = -181.0,
            3 => bad.samples[1].latitude += 1.0,
            _ => bad.samples[1].accuracy_m = f64::NAN,
        }
        assert!(
            validate_trace(&bad, (NOW + 12) * 1000).is_err(),
            "Mode {mode}"
        );
    }
}

#[test]
fn media_binding_is_exact_and_standalone_cannot_be_relabelled() {
    let (trace, identity, pin) = fixture(false);
    let asset = asset_from_jpeg(&[0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).unwrap();
    let proof = sealed(&trace, &identity, Some(asset.clone()));
    let result = verify(
        &proof,
        &trace.request,
        &pin,
        Some(&asset),
        (NOW + 12) * 1000,
    )
    .unwrap();
    assert!(result.verified);
    assert_eq!(
        result.evidence.unwrap().trace.capture_correlation,
        "application-submission-interval"
    );
    let different = asset_from_jpeg(&[0xff, 0xd8, 0xff, 0xe0, 1, 2, 4]).unwrap();
    assert!(
        !verify(
            &proof,
            &trace.request,
            &pin,
            Some(&different),
            (NOW + 12) * 1000
        )
        .unwrap()
        .checks
        .asset_binding
    );
    assert!(
        !verify(&proof, &trace.request, &pin, None, (NOW + 12) * 1000)
            .unwrap()
            .verified
    );
    let standalone = sealed(&trace, &identity, None);
    assert!(
        !verify(
            &standalone,
            &trace.request,
            &pin,
            Some(&asset),
            (NOW + 12) * 1000
        )
        .unwrap()
        .verified
    );
}

#[test]
fn strict_json_unknown_duplicate_nonfinite_and_oversized_inputs_fail() {
    let (trace, _, _) = fixture(false);
    let serialized = json(&trace).unwrap();
    assert!(
        parse_trace(&serialized.replacen("\"version\":1", "\"version\":1,\"version\":1", 1))
            .is_err()
    );
    assert!(parse_trace(&serialized.replacen(
        "\"version\":1",
        "\"version\":1,\"unknown\":true",
        1
    ))
    .is_err());
    assert!(parse_trace(&serialized.replace("47.4979", "NaN")).is_err());
    assert!(parse_trace(&" ".repeat(MAX_JSON + 1)).is_err());
    let mut policy = Policy {
        duration_ms: 4999,
        ..Policy::default()
    };
    assert!(validate_policy(&policy).is_err());
    policy.duration_ms = 15001;
    assert!(validate_policy(&policy).is_err());
}

#[test]
fn malformed_cose_and_invalid_callback_never_validate() {
    let (trace, identity, pin) = fixture(false);
    let proof = sealed(&trace, &identity, None);
    let mut message = CoseSign1::from_tagged_slice(&proof).unwrap();
    message.unprotected.key_id = vec![1];
    assert!(
        !verify(
            &message.to_tagged_vec().unwrap(),
            &trace.request,
            &pin,
            None,
            (NOW + 12) * 1000
        )
        .unwrap()
        .verified
    );
    assert!(
        !verify(&[0], &trace.request, &pin, None, (NOW + 12) * 1000)
            .unwrap()
            .verified
    );
    let (native, _, _) = fixture(true);
    let key = software_key(&identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    assert!(
        seal_with_signer(&native, spki.as_bytes(), None, (NOW + 12) * 1000, |_| Ok(
            vec![0; 64]
        ))
        .is_err()
    );
}

#[test]
fn durable_demo_marker_cannot_be_removed_from_expected_request() {
    let (mut trace, identity, pin) = fixture(false);
    trace.request = parse_request(&create_location_demo_request(NOW as f64).unwrap()).unwrap();
    assert_eq!(trace.request.policy.max_finalization_delay_ms, Some(30_000));
    let proof = sealed(&trace, &identity, None);
    let valid = verify(&proof, &trace.request, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(valid.verified && valid.demo);
    let mut stripped = trace.request.clone();
    stripped.demo = false;
    let invalid = verify(&proof, &stripped, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(!invalid.verified && invalid.demo && !invalid.checks.request_match);
}

#[test]
fn a_valid_signature_does_not_bypass_observation_policy_checks() {
    let (trace, identity, pin) = fixture(true);
    let key = software_key(&identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let evidence = cose::make_evidence(&trace, spki.as_bytes(), None, (NOW + 12) * 1000).unwrap();
    for mode in 0..6 {
        let mut malicious = evidence.clone();
        match mode {
            0 => malicious.trace.samples[1].mock = Some(true),
            1 => malicious.trace.samples[1].sequence = 9,
            2 => malicious.trace.samples[1].accuracy_m = 999.0,
            3 => malicious.trace.samples[1].latitude += 2.0,
            4 => malicious.sealed_at_ms += 6000,
            _ => {
                malicious.trace.samples.remove(0);
            }
        }
        // Model an operator with access to its own signing key. It can create a
        // valid COSE signature over bad evidence, bypassing our honest signer.
        let proof = cose::sign_evidence(&malicious, |bytes| {
            let signature: Signature = key.sign(bytes);
            Ok(signature.to_der().as_bytes().to_vec())
        })
        .unwrap();
        let report = verify(&proof, &trace.request, &pin, None, (NOW + 30) * 1000).unwrap();
        assert!(report.checks.signature_integrity);
        assert!(!report.verified, "Policy bypass mode {mode}");
    }
}

#[test]
fn browser_delivery_and_collection_start_limits_are_verified_even_when_signed() {
    let (trace, identity, pin) = fixture(false);
    let key = software_key(&identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    for pre_collection in [false, true] {
        let mut evidence =
            cose::make_evidence(&trace, spki.as_bytes(), None, (NOW + 12) * 1000).unwrap();
        if pre_collection {
            // Still after challenge issuance and only 1.5s old at callback.
            evidence.trace.samples[0].fix_timestamp_ms = trace.started_at_ms - 500;
        } else {
            // Under max_fix_age5s but beyond max_delivery_delay3s.
            evidence.trace.samples[1].fix_timestamp_ms -= 3500;
        }
        assert!(validate_trace(&evidence.trace, (NOW + 12) * 1000).is_err());
        let proof = cose::sign_evidence(&evidence, |bytes| {
            let signature: Signature = key.sign(bytes);
            Ok(signature.to_bytes().to_vec())
        })
        .unwrap();
        let report = verify(&proof, &trace.request, &pin, None, (NOW + 12) * 1000).unwrap();
        assert!(report.checks.signature_integrity);
        assert!(!report.verified && !report.checks.fix_freshness_valid);
    }
}

#[test]
fn finalization_allowance_is_explicit_bounded_and_preserves_legacy_requests() {
    let (mut trace, _, _) = fixture(true);
    let end = trace.ended_at_ms;
    let original = json(&trace.request).unwrap();
    assert!(!original.contains("max_finalization_delay_ms"));
    assert!(validate_trace(&trace, end + 5000).is_ok());
    assert!(validate_trace(&trace, end + 5001).is_err());
    for delay in [1, 5000, 30_000] {
        trace.request.policy.max_finalization_delay_ms = Some(delay);
        assert!(validate_trace(&trace, end + delay).is_ok());
        assert!(validate_trace(&trace, end + delay + 1).is_err());
    }
    for delay in [0, 30_001, u64::MAX] {
        trace.request.policy.max_finalization_delay_ms = Some(delay);
        assert!(validate_policy(&trace.request.policy).is_err());
    }
    trace.request.policy.max_finalization_delay_ms = None;
    assert_eq!(json(&trace.request).unwrap(), original);
}

#[test]
fn signed_processing_allowance_never_replaces_acquisition_or_request_binding() {
    for native in [false, true] {
        let (mut trace, identity, pin) = fixture(native);
        trace.request.policy.max_finalization_delay_ms = Some(30_000);
        let sealed_at = trace.ended_at_ms + 7400;
        let key = software_key(&identity).unwrap();
        let spki = key.verifying_key().to_public_key_der().unwrap();
        let evidence = cose::make_evidence(&trace, spki.as_bytes(), None, sealed_at).unwrap();
        let sign = |evidence: &Evidence| {
            cose::sign_evidence(evidence, |bytes| {
                let signature: Signature = key.sign(bytes);
                Ok(signature.to_bytes().to_vec())
            })
            .unwrap()
        };
        let proof = sign(&evidence);
        assert!(
            verify(&proof, &trace.request, &pin, None, sealed_at)
                .unwrap()
                .verified
        );
        let mut stricter = trace.request.clone();
        stricter.policy.max_finalization_delay_ms = Some(5000);
        assert!(
            !verify(&proof, &stricter, &pin, None, sealed_at)
                .unwrap()
                .checks
                .request_match
        );
        stricter.policy.max_finalization_delay_ms = None;
        assert!(
            !verify(&proof, &stricter, &pin, None, sealed_at)
                .unwrap()
                .checks
                .request_match
        );
        for mode in 0..4 {
            let mut invalid = evidence.clone();
            match mode {
                0 => invalid.sealed_at_ms = trace.ended_at_ms + 30_001,
                1 => invalid.trace.samples[1].fix_timestamp_ms -= 3500,
                2 => {
                    invalid.trace.ended_at_ms += 6000;
                    invalid.trace.elapsed_ms += 6000;
                }
                _ => invalid.sealed_at_ms = trace.request.challenge.expires_at * 1000,
            }
            assert!(validate_trace(&invalid.trace, invalid.sealed_at_ms).is_err());
            let report = verify(&sign(&invalid), &trace.request, &pin, None, sealed_at).unwrap();
            assert!(report.checks.signature_integrity);
            assert!(!report.verified, "native={native}, mode={mode}");
        }
    }
}

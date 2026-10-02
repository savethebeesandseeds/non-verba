// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use coset::{CoseSign1, TaggedCborSerializable};
use serde_json::Value;

const NOW: u64 = 2_000_000_000;

struct Fixture {
    location_request: String,
    artifact: Vec<u8>,
    request: String,
    receipt: String,
    requester_identity: String,
    requester_pin: String,
    operator_pin: KeyPin,
}
fn fixture(demo: bool) -> Fixture {
    let mut trace =
        location_proof::parse_trace(include_str!("../location_proof/raw_gnss_fixture.json"))
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
    let operator_identity = crate::create_identity().unwrap();
    let public: Value =
        serde_json::from_str(&location_proof::location_identity(&operator_identity).unwrap())
            .unwrap();
    let operator_pin = KeyPin {
        kind: PinKind::OperatorLocationSpkiSha256,
        sha256: public["fingerprint"].as_str().unwrap().into(),
    };
    let artifact = location_proof::seal_location_proof(
        &json(&trace).unwrap(),
        &operator_identity,
        "null",
        (NOW + 12) as f64,
    )
    .unwrap();
    let requester_identity = crate::create_identity().unwrap();
    let requester = cose::RequesterIdentity::load(&requester_identity).unwrap();
    let location_request = json(&trace.request).unwrap();
    let request = create_live_session_request(
        &location_request,
        &requester_identity,
        &json(&operator_pin).unwrap(),
        NOW as f64,
        90_000,
    )
    .unwrap();
    let timing = ReceiptTiming {
        sent_at_ms: NOW * 1000,
        received_at_ms: (NOW + 12) * 1000,
        elapsed_ms: 12_000,
    };
    let receipt = seal_live_session_receipt(
        &request,
        &artifact,
        &json(&timing).unwrap(),
        &requester_identity,
        &requester.pin,
        (NOW + 12) as f64,
    )
    .unwrap();
    Fixture {
        location_request,
        artifact,
        request,
        receipt,
        requester_identity,
        requester_pin: requester.pin,
        operator_pin,
    }
}
fn verify(f: &Fixture, receipt: &str) -> SessionVerification {
    verify_receipt(
        receipt,
        &f.request,
        &f.artifact,
        &f.requester_pin,
        &f.operator_pin,
        (NOW + 12) * 1000,
    )
    .unwrap()
}
fn changed_receipt(f: &Fixture, mutate: impl FnOnce(&mut SessionReceipt)) -> String {
    let mut envelope: ReceiptEnvelope = parse(&f.receipt).unwrap();
    let mut receipt = cose::read::<SessionReceipt>(
        &decode_base64(&envelope.receipt_cose_b64, MAX_COSE_BYTES).unwrap(),
        cose::RECEIPT_TYPE,
    )
    .unwrap()
    .payload;
    mutate(&mut receipt);
    let identity = cose::RequesterIdentity::load(&f.requester_identity).unwrap();
    envelope.receipt_cose_b64 =
        STANDARD.encode(cose::sign(&receipt, &identity, cose::RECEIPT_TYPE).unwrap());
    json(&envelope).unwrap()
}

#[test]
fn independent_signed_request_and_receipt_bind_real_location_proof() {
    let f = fixture(false);
    let validated = validate_live_session_request(
        &f.request,
        &f.requester_pin,
        &json(&f.operator_pin).unwrap(),
        NOW as f64,
    )
    .unwrap();
    let request: SessionRequest = parse(&validated).unwrap();
    assert_eq!(json(&request.location_request).unwrap(), f.location_request);
    let report = verify(&f, &f.receipt);
    assert!(
        report.verified && report.fresh_action_eligible,
        "{:?}",
        report.errors
    );
    assert!(report.location_verification.unwrap().verified);
    assert!(!report.requester_clock_trusted && !report.physical_freshness_proven);
    assert!(!report.independent_requester_proven && !report.global_replay_checked);
    assert_eq!(report.replay_status, "not-checked");
    assert!(report.acceptance_requires_local_replay_check && !report.acceptance_recorded);
    let identity: Value =
        serde_json::from_str(&live_requester_identity(&f.requester_identity).unwrap()).unwrap();
    assert_eq!(identity["pin"]["type"], "requester-spki-sha256");
    assert!(!identity.to_string().contains("private_key"));
}

#[test]
fn historical_receipts_verify_without_becoming_fresh_actions() {
    let f = fixture(false);
    let report = verify_receipt(
        &f.receipt,
        &f.request,
        &f.artifact,
        &f.requester_pin,
        &f.operator_pin,
        (NOW + 2000) * 1000,
    )
    .unwrap();
    assert!(report.verified && !report.fresh_action_eligible);
    assert!(validate_live_session_request(
        &f.request,
        &f.requester_pin,
        &json(&f.operator_pin).unwrap(),
        (NOW + 2000) as f64
    )
    .is_err());
}

#[test]
fn included_requester_key_is_not_a_trust_anchor_and_pin_roles_are_strict() {
    let f = fixture(false);
    assert!(
        !verify_receipt(
            &f.receipt,
            &f.request,
            &f.artifact,
            &"0".repeat(64),
            &f.operator_pin,
            (NOW + 12) * 1000
        )
        .unwrap()
        .verified
    );
    let wrong_operator = KeyPin {
        sha256: "1".repeat(64),
        ..f.operator_pin.clone()
    };
    assert!(
        !verify_receipt(
            &f.receipt,
            &f.request,
            &f.artifact,
            &f.requester_pin,
            &wrong_operator,
            (NOW + 12) * 1000
        )
        .unwrap()
        .verified
    );
    let wrong_role = KeyPin {
        kind: PinKind::OperatorCameraCertificateSha256,
        ..f.operator_pin.clone()
    };
    assert!(create_live_session_request(
        &f.location_request,
        &f.requester_identity,
        &json(&wrong_role).unwrap(),
        NOW as f64,
        90_000
    )
    .is_err());
    let same_key = KeyPin {
        sha256: f.requester_pin.clone(),
        ..f.operator_pin.clone()
    };
    assert!(create_live_session_request(
        &f.location_request,
        &f.requester_identity,
        &json(&same_key).unwrap(),
        NOW as f64,
        90_000
    )
    .is_err());
}

#[test]
fn sessions_have_new_nonces_and_original_request_substitution_fails() {
    let f = fixture(false);
    let other = create_live_session_request(
        &f.location_request,
        &f.requester_identity,
        &json(&f.operator_pin).unwrap(),
        NOW as f64,
        90_000,
    )
    .unwrap();
    let a = cose::read::<SessionRequest>(&request_bytes(&f.request).unwrap(), cose::REQUEST_TYPE)
        .unwrap()
        .payload;
    let b = cose::read::<SessionRequest>(&request_bytes(&other).unwrap(), cose::REQUEST_TYPE)
        .unwrap()
        .payload;
    assert_ne!(a.session_id, b.session_id);
    let report = verify_receipt(
        &f.receipt,
        &other,
        &f.artifact,
        &f.requester_pin,
        &f.operator_pin,
        (NOW + 12) * 1000,
    )
    .unwrap();
    assert!(
        !report.verified && !report.checks.original_request_match && !report.checks.session_binding
    );
}

#[test]
fn valid_requester_signatures_cannot_override_binding_or_timing_rules() {
    let f = fixture(false);
    for mode in 0..13 {
        let changed = changed_receipt(&f, |receipt| match mode {
            0 => receipt.session_id = "f".repeat(64),
            1 => receipt.request_binding.bytes += 1,
            2 => receipt.location_request_binding.sha256 = "0".repeat(64),
            3 => receipt.artifact_binding.sha256 = "0".repeat(64),
            4 => receipt.artifact_binding.bytes += 1,
            5 => receipt.timing.elapsed_ms = 90_001,
            6 => receipt.timing.elapsed_ms = 9999,
            7 => receipt.timing.sent_at_ms -= 1000,
            8 => receipt.timing.received_at_ms = u64::MAX,
            9 => receipt.sealed_at_ms += 31_001,
            10 => receipt.requester_pin.kind = PinKind::OperatorLocationSpkiSha256,
            11 => receipt.demo = true,
            _ => receipt.version = 2,
        });
        let report = verify(&f, &changed);
        assert!(report.checks.receipt_signature_integrity, "Mode {mode}");
        assert!(!report.verified, "Mode {mode}");
    }
}

#[test]
fn artifact_hash_alone_cannot_replace_independent_operator_verification() {
    let mut f = fixture(false);
    let mut artifact = CoseSign1::from_tagged_slice(&f.artifact).unwrap();
    artifact.signature[0] ^= 1;
    f.artifact = artifact.to_tagged_vec().unwrap();
    let changed = changed_receipt(&f, |receipt| {
        receipt.artifact_binding = binding(&f.artifact)
    });
    let report = verify(&f, &changed);
    assert!(report.checks.receipt_signature_integrity && report.checks.artifact_binding);
    assert!(!report.verified && !report.checks.location_proof_valid);
    assert!(seal_live_session_receipt(
        &f.request,
        &f.artifact,
        &json(&ReceiptTiming {
            sent_at_ms: NOW * 1000,
            received_at_ms: (NOW + 12) * 1000,
            elapsed_ms: 12_000,
        })
        .unwrap(),
        &f.requester_identity,
        &f.requester_pin,
        (NOW + 12) as f64
    )
    .is_err());
}

#[test]
fn demo_status_is_signed_and_cannot_be_upgraded_to_independent_requester() {
    let f = fixture(true);
    let report = verify(&f, &f.receipt);
    assert!(report.verified && report.demo && !report.fresh_action_eligible);
    let stripped = changed_receipt(&f, |receipt| receipt.demo = false);
    let report = verify(&f, &stripped);
    assert!(!report.verified && report.demo && !report.checks.demo_marker_valid);
}

#[test]
fn strict_domains_encodings_fields_and_limits_reject_malformed_inputs() {
    let f = fixture(false);
    let mut envelope: ReceiptEnvelope = parse(&f.receipt).unwrap();
    envelope.receipt_cose_b64 = envelope.request_cose_b64.clone();
    assert!(!verify(&f, &json(&envelope).unwrap()).verified);
    let duplicate = f
        .receipt
        .replacen("\"version\":1", "\"version\":1,\"version\":1", 1);
    assert!(!verify(&f, &duplicate).verified);
    let unknown = f
        .receipt
        .replacen("\"version\":1", "\"version\":1,\"unknown\":true", 1);
    assert!(!verify(&f, &unknown).verified);
    assert!(!verify(&f, &" ".repeat(MAX_ENVELOPE_JSON_BYTES + 1)).verified);
    envelope = parse(&f.receipt).unwrap();
    envelope.receipt_cose_b64.push('=');
    assert!(!verify(&f, &json(&envelope).unwrap()).verified);
    let empty: Vec<u8> = vec![];
    assert!(
        !verify_receipt(
            &f.receipt,
            &f.request,
            &empty,
            &f.requester_pin,
            &f.operator_pin,
            (NOW + 12) * 1000
        )
        .unwrap()
        .verified
    );
}

#[test]
fn signed_invalid_request_times_fail_without_arithmetic_overflow() {
    let f = fixture(false);
    let original = request_bytes(&f.request).unwrap();
    let mut request = cose::read::<SessionRequest>(&original, cose::REQUEST_TYPE)
        .unwrap()
        .payload;
    request.location_request.challenge.expires_at = u64::MAX;
    let signer = cose::RequesterIdentity::load(&f.requester_identity).unwrap();
    let bytes = cose::sign(&request, &signer, cose::REQUEST_TYPE).unwrap();
    let altered = json(&RequestEnvelope {
        version: 1,
        kind: "nonverba-live-session-request".into(),
        cose_b64: STANDARD.encode(&bytes),
    })
    .unwrap();
    let mut envelope: ReceiptEnvelope = parse(&f.receipt).unwrap();
    envelope.request_cose_b64 = STANDARD.encode(&bytes);
    let report = verify_receipt(
        &json(&envelope).unwrap(),
        &altered,
        &f.artifact,
        &f.requester_pin,
        &f.operator_pin,
        (NOW + 12) * 1000,
    )
    .unwrap();
    assert!(!report.verified && !report.checks.request_policy_valid);
}

#[test]
fn requested_deadline_must_fit_the_sensor_challenge() {
    let f = fixture(false);
    for deadline in [9999, 10_999, 180_001] {
        assert!(create_live_session_request(
            &f.location_request,
            &f.requester_identity,
            &json(&f.operator_pin).unwrap(),
            NOW as f64,
            deadline
        )
        .is_err());
    }
    let mut request: location_proof::Request = parse(&f.location_request).unwrap();
    request.challenge.expires_at = NOW + 89;
    assert!(create_live_session_request(
        &json(&request).unwrap(),
        &f.requester_identity,
        &json(&f.operator_pin).unwrap(),
        NOW as f64,
        90_000
    )
    .is_err());
}

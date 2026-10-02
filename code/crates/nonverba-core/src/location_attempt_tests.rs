// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use p256::{
    ecdsa::{signature::Signer, SigningKey},
    pkcs8::EncodePublicKey,
};

fn fixture() -> (Snapshot, SigningKey, Vec<u8>) {
    let mut trace: Trace =
        serde_json::from_str(include_str!("location_proof/raw_gnss_fixture.json")).unwrap();
    trace.request.challenge = serde_json::from_str(
        &crate::create_challenge(
            "Synthetic requester",
            "Synthetic GPS rejection",
            2_000_000_000.0,
            900,
        )
        .unwrap(),
    )
    .unwrap();
    let raw = trace.raw_gnss.as_mut().unwrap();
    raw.epochs.truncate(2);
    raw.epochs[1].measurements.truncate(3);
    trace.samples.clear();
    trace.elapsed_ms = 2_100;
    trace.ended_at_ms = trace.started_at_ms + trace.elapsed_ms;
    let snapshot = Snapshot {
        version: 1,
        kind: "nonverba-gps-attempt-snapshot".into(),
        attempt_id: "11111111-1111-4111-8111-111111111111".into(),
        original_request_json: serde_json::to_string(&trace.request).unwrap(),
        stopping_stage: "collecting".into(),
        terminal_trigger: TerminalTrigger::RawPolicyRejection,
        local_timeout_ms: 60_000,
        diagnostics: Diagnostics {
            rejected_fixes: 2,
            raw_callback_count: 2,
            last_raw_callback_elapsed_ms: Some(2000),
            permission_granted_elapsed_ms: Some(1),
            first_raw_admitted_elapsed_ms: Some(1000),
            collector_status_json: "{}".into(),
        },
        partial_trace: trace,
    };
    let key = SigningKey::from_slice(&[7; 32]).unwrap();
    let spki = key
        .verifying_key()
        .to_public_key_der()
        .unwrap()
        .as_bytes()
        .to_vec();
    (snapshot, key, spki)
}
fn signed(s: Snapshot, key: &SigningKey, spki: &[u8], late: u64) -> Vec<u8> {
    seal_with_signer(s, spki, late, |tbs| {
        let sig: Signature = key.sign(tbs);
        Ok(sig.to_der().as_bytes().to_vec())
    })
    .unwrap()
}

fn timeout_fixture() -> (Snapshot, SigningKey, Vec<u8>) {
    let (mut s, key, spki) = fixture();
    s.terminal_trigger = TerminalTrigger::CollectionTimeout;
    s.partial_trace.elapsed_ms = 60_000;
    s.partial_trace.ended_at_ms = s.partial_trace.started_at_ms + 60_000;
    s.partial_trace.raw_gnss.as_mut().unwrap().epochs.clear();
    s.partial_trace
        .raw_gnss
        .as_mut()
        .unwrap()
        .rejected_epoch_count = 0;
    s.diagnostics.raw_callback_count = 0;
    s.diagnostics.last_raw_callback_elapsed_ms = None;
    s.diagnostics.first_raw_admitted_elapsed_ms = None;
    (s, key, spki)
}

#[test]
fn no_callback_timeout_is_signed_without_invented_raw_evaluation_or_success() {
    let (s, key, spki) = timeout_fixture();
    let bytes = signed(s.clone(), &key, &spki, s.partial_trace.ended_at_ms + 5000);
    let pin = location::fingerprint_spki(&spki).unwrap();
    let v = verify(&bytes, &s.original_request_json, &pin).unwrap();
    assert!(v.report_verified, "{:?}", v.errors);
    assert_eq!(v.acquisition_outcome, "raw-gnss-no-callback-timeout");
    assert!(v.raw_gnss_evaluation.is_none());
    assert!(
        !v.successful_measurement
            && !v.measurement_policy_satisfied
            && !v.successful_acceptance_eligible
    );
    assert!(
        !v.collection_attested
            && !v.clock_trusted
            && !v.operator_effort_proven
            && !v.physical_cause_proven
    );
    let r = v.report.unwrap();
    assert_eq!(
        r.reason_codes,
        ["COLLECTION_TIMEOUT", "RAW_GNSS_NO_CALLBACKS"]
    );
    assert_eq!(r.snapshot.partial_trace.elapsed_ms, 60_000);
    assert_eq!(r.snapshot.diagnostics.last_raw_callback_elapsed_ms, None);
    assert_eq!(r.physical_cause, "unknown");
    assert!(
        !location::verify(
            &bytes,
            &s.partial_trace.request,
            &pin,
            None,
            s.partial_trace.ended_at_ms
        )
        .unwrap()
        .verified
    );
    assert!(
        !verify(&bytes, &s.original_request_json, &"0".repeat(64))
            .unwrap()
            .report_verified
    );
    let mut other = s.partial_trace.request.clone();
    other.challenge.task = "Other task".into();
    assert!(
        !verify(&bytes, &serde_json::to_string(&other).unwrap(), &pin)
            .unwrap()
            .report_verified
    );
    let policy = r#"{"version":1,"native_acquisition_required":false,"raw_gnss_required":false,"correlated_camera_clock_required":false,"hardware_attestation_required":false,"independent_position_required":false}"#;
    let appraisal: serde_json::Value = serde_json::from_str(
        &crate::agent_appraisal::appraise_location(
            &bytes,
            &s.original_request_json,
            &pin,
            "null",
            policy,
            2_000_000_065.0,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(appraisal["evidence_verified"], false);
    assert_eq!(appraisal["policy_satisfied"], false);
}

#[test]
fn early_timeout_or_received_raw_data_cannot_use_the_no_callback_signer() {
    let (s, key, spki) = timeout_fixture();
    for change in 0..10 {
        let mut bad = s.clone();
        match change {
            0 => {
                bad.partial_trace.elapsed_ms = 59_999;
                bad.partial_trace.ended_at_ms -= 1;
            }
            1 => {
                bad.diagnostics.raw_callback_count = 1;
                bad.diagnostics.last_raw_callback_elapsed_ms = Some(55_000);
            }
            2 => {
                bad.partial_trace
                    .raw_gnss
                    .as_mut()
                    .unwrap()
                    .rejected_epoch_count = 1
            }
            3 => bad.diagnostics.first_raw_admitted_elapsed_ms = Some(2000),
            4 => bad.diagnostics.permission_granted_elapsed_ms = None,
            5 => bad.stopping_stage = "ready".into(),
            6 => bad.terminal_trigger = TerminalTrigger::RawPolicyRejection,
            7 => bad.local_timeout_ms = 59_999,
            8 => {
                bad.partial_trace
                    .raw_gnss
                    .as_mut()
                    .unwrap()
                    .anchor_elapsed_realtime_ns = "0".into()
            }
            _ => {
                bad.partial_trace.raw_gnss.as_mut().unwrap().epochs =
                    fixture().0.partial_trace.raw_gnss.unwrap().epochs
            }
        }
        let mut called = false;
        let now = bad.partial_trace.ended_at_ms;
        assert!(
            seal_with_signer(bad, &spki, now, |tbs| {
                called = true;
                let sig: Signature = key.sign(tbs);
                Ok(sig.to_bytes().to_vec())
            })
            .is_err(),
            "case {change}"
        );
        assert!(!called, "case {change}");
    }
}

#[test]
fn timeout_claim_substitution_and_timing_tampering_fail() {
    let (s, key, spki) = timeout_fixture();
    let bytes = signed(s.clone(), &key, &spki, s.partial_trace.ended_at_ms);
    let pin = location::fingerprint_spki(&spki).unwrap();
    for change in 0..4 {
        let mut m = CoseSign1::from_tagged_slice(&bytes).unwrap();
        let mut r: Report = serde_json::from_slice(m.payload.as_ref().unwrap()).unwrap();
        match change {
            0 => r.outcome = "raw-gnss-policy-rejected".into(),
            1 => r.reason_codes = vec!["RAW_GNSS_SATELLITE_COUNT".into()],
            2 => r.snapshot.terminal_trigger = TerminalTrigger::RawPolicyRejection,
            _ => r.snapshot.partial_trace.elapsed_ms = 59_999,
        }
        m.payload = Some(serde_json::to_vec(&r).unwrap());
        assert!(
            !verify(
                &m.clone().to_tagged_vec().unwrap(),
                &s.original_request_json,
                &pin
            )
            .unwrap()
            .signature_integrity
        );
        let sig: Signature = key.sign(&m.tbs_data(AAD));
        m.signature = sig.to_bytes().to_vec();
        let v = verify(&m.to_tagged_vec().unwrap(), &s.original_request_json, &pin).unwrap();
        assert!(v.signature_integrity);
        assert!(!v.claims_consistent && !v.report_verified);
    }
}

#[test]
fn original_v1_snapshot_defaults_only_to_raw_rejection() {
    let (s, key, spki) = fixture();
    let json = serde_json::to_string(&s).unwrap();
    assert!(!json.contains("terminal_trigger"));
    let old = parse_snapshot(&json).unwrap();
    assert_eq!(old.terminal_trigger, TerminalTrigger::RawPolicyRejection);
    let bytes = signed(old, &key, &spki, s.partial_trace.ended_at_ms);
    assert!(
        verify(
            &bytes,
            &s.original_request_json,
            &location::fingerprint_spki(&spki).unwrap()
        )
        .unwrap()
        .report_verified
    );
    let (timeout, _, _) = timeout_fixture();
    let mut json: serde_json::Value = serde_json::to_value(timeout).unwrap();
    json["terminal_trigger"] = "permission-denied".into();
    assert!(parse_snapshot(&json.to_string()).is_err());
}

#[test]
fn signed_rejection_preserves_exact_request_terminal_partial_data_and_limits() {
    let (s, key, spki) = fixture();
    let bytes = signed(s.clone(), &key, &spki, s.partial_trace.ended_at_ms + 10);
    let v = verify(
        &bytes,
        &s.original_request_json,
        &location::fingerprint_spki(&spki).unwrap(),
    )
    .unwrap();
    assert!(v.report_verified, "{:?}", v.errors);
    assert!(
        !v.successful_measurement && !v.successful_acceptance_eligible && !v.fresh_action_eligible
    );
    assert!(
        !v.operator_effort_proven
            && !v.operator_fault_proven
            && !v.collection_attested
            && !v.independent_receipt_verified
    );
    let r = v.report.unwrap();
    assert_eq!(r.snapshot.partial_trace.elapsed_ms, 2100);
    assert_eq!(
        r.snapshot.diagnostics.last_raw_callback_elapsed_ms,
        Some(2000)
    );
    assert!(r
        .reason_codes
        .iter()
        .any(|c| c == "RAW_GNSS_SATELLITE_COUNT"));
    assert!(r.snapshot.partial_trace.samples.is_empty());
    assert_eq!(r.physical_cause, "unknown");
}
#[test]
fn tampering_wrong_request_and_wrong_key_fail_while_lossless_serialization_matches() {
    let (s, key, spki) = fixture();
    let bytes = signed(s.clone(), &key, &spki, s.partial_trace.ended_at_ms);
    let pin = location::fingerprint_spki(&spki).unwrap();
    let mut changed = CoseSign1::from_tagged_slice(&bytes).unwrap();
    let mut r: Report = serde_json::from_slice(changed.payload.as_ref().unwrap()).unwrap();
    r.snapshot.diagnostics.rejected_fixes += 1;
    changed.payload = Some(serde_json::to_vec(&r).unwrap());
    assert!(
        !verify(
            &changed.to_tagged_vec().unwrap(),
            &s.original_request_json,
            &pin
        )
        .unwrap()
        .signature_integrity
    );
    assert!(
        !verify(&bytes, &s.original_request_json, &"0".repeat(64))
            .unwrap()
            .report_verified
    );
    let mut original: serde_json::Value = serde_json::from_str(&s.original_request_json).unwrap();
    original["challenge"]["task"] = "Different task".into();
    assert!(
        !verify(&bytes, &original.to_string(), &pin)
            .unwrap()
            .request_match
    );
    assert!(
        verify(&bytes, &format!("{}\n", s.original_request_json), &pin)
            .unwrap()
            .request_match
    );
}
#[test]
fn cross_artifact_substitution_fails_both_directions() {
    let (s, key, spki) = fixture();
    let bytes = signed(s.clone(), &key, &spki, s.partial_trace.ended_at_ms);
    let pin = location::fingerprint_spki(&spki).unwrap();
    let policy = r#"{"version":1,"native_acquisition_required":false,"raw_gnss_required":false,"correlated_camera_clock_required":false,"hardware_attestation_required":false,"independent_position_required":false}"#;
    let appraisal: serde_json::Value = serde_json::from_str(
        &crate::agent_appraisal::appraise_location(
            &bytes,
            &s.original_request_json,
            &pin,
            "null",
            policy,
            2_000_000_003.0,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(appraisal["evidence_verified"], false);
    assert_eq!(appraisal["policy_satisfied"], false);
    assert!(
        !location::verify(
            &bytes,
            &s.partial_trace.request,
            &pin,
            None,
            s.partial_trace.ended_at_ms
        )
        .unwrap()
        .verified
    );
    let mut successful: Trace =
        serde_json::from_str(include_str!("location_proof/raw_gnss_fixture.json")).unwrap();
    successful.request = s.partial_trace.request.clone();
    let success =
        location::seal_with_signer(&successful, &spki, None, successful.ended_at_ms, |tbs| {
            let signature: Signature = key.sign(tbs);
            Ok(signature.to_bytes().to_vec())
        })
        .unwrap();
    assert!(
        location::verify(
            &success,
            &successful.request,
            &pin,
            None,
            successful.ended_at_ms
        )
        .unwrap()
        .verified
    );
    assert!(
        !verify(&success, &s.original_request_json, &pin)
            .unwrap()
            .report_verified
    );
}
#[test]
fn genuine_signature_cannot_certify_inconsistent_reason_or_success_claim() {
    let (s, key, spki) = fixture();
    let pin = location::fingerprint_spki(&spki).unwrap();
    let bytes = signed(s.clone(), &key, &spki, s.partial_trace.ended_at_ms);
    for change in 0..3 {
        let mut m = CoseSign1::from_tagged_slice(&bytes).unwrap();
        let mut r: Report = serde_json::from_slice(m.payload.as_ref().unwrap()).unwrap();
        match change {
            0 => r.reason_codes.clear(),
            1 => r.outcome = "success".into(),
            _ => r.physical_cause = "weather".into(),
        }
        m.payload = Some(serde_json::to_vec(&r).unwrap());
        let sig: Signature = key.sign(&m.tbs_data(AAD));
        m.signature = sig.to_bytes().to_vec();
        let v = verify(&m.to_tagged_vec().unwrap(), &s.original_request_json, &pin).unwrap();
        assert!(v.signature_integrity);
        assert!(!v.claims_consistent && !v.report_verified && !v.successful_acceptance_eligible);
    }
}
#[test]
fn late_reporting_is_historical_failure_and_never_renews_freshness() {
    let (s, key, spki) = fixture();
    let late = s.partial_trace.request.challenge.expires_at * 1000 + 1000;
    let bytes = signed(s.clone(), &key, &spki, late);
    let v = verify(
        &bytes,
        &s.original_request_json,
        &location::fingerprint_spki(&spki).unwrap(),
    )
    .unwrap();
    assert!(v.report_verified);
    assert!(!v.fresh_action_eligible && !v.independent_receipt_verified);
    assert_eq!(v.report.unwrap().snapshot.partial_trace.elapsed_ms, 2100);
}
#[test]
fn zero_raw_pending_success_cancellation_and_unbounded_snapshots_do_not_sign() {
    let (s, key, spki) = fixture();
    for change in 0..8 {
        let mut bad = s.clone();
        match change {
            0 => bad.partial_trace.raw_gnss.as_mut().unwrap().epochs.clear(),
            1 => {
                let measurements = bad.partial_trace.raw_gnss.as_ref().unwrap().epochs[0]
                    .measurements
                    .clone();
                bad.partial_trace.raw_gnss.as_mut().unwrap().epochs[1].measurements = measurements;
            }
            2 => bad.stopping_stage = "cancelled".into(),
            3 => bad.diagnostics.last_raw_callback_elapsed_ms = Some(2101),
            4 => bad.local_timeout_ms = 2000,
            5 => bad.attempt_id = "caller-chosen-arbitrary-data".into(),
            6 => bad.diagnostics.collector_status_json = "x".repeat(16385),
            _ => bad.partial_trace.request.challenge.task = "substituted".into(),
        }
        let mut called = false;
        let now = bad.partial_trace.ended_at_ms;
        let r = seal_with_signer(bad, &spki, now, |tbs| {
            called = true;
            let sig: Signature = key.sign(tbs);
            Ok(sig.to_bytes().to_vec())
        });
        assert!(r.is_err() && !called, "case {change}");
    }
}
#[test]
fn signer_failure_and_wrong_signature_never_produce_report_bytes() {
    let (s, _, spki) = fixture();
    let now = s.partial_trace.ended_at_ms;
    assert!(
        seal_with_signer(s.clone(), &spki, now, |_| Err("Key unavailable".into()))
            .unwrap_err()
            .contains("unavailable")
    );
    assert!(seal_with_signer(s, &spki, now, |_| Ok(vec![0; 64])).is_err());
}
#[test]
fn separate_attempt_ids_and_composed_request_are_preserved() {
    let (mut s, key, spki) = fixture();
    s.partial_trace.request.context = Some(location::Context {
        session_id: "synthetic-camera-component".into(),
        purpose: "camera".into(),
        camera_timing: Some("concurrent".into()),
    });
    s.original_request_json = serde_json::to_string(&s.partial_trace.request).unwrap();
    let first = signed(s.clone(), &key, &spki, s.partial_trace.ended_at_ms);
    s.attempt_id = "22222222-2222-4222-8222-222222222222".into();
    let second = signed(s.clone(), &key, &spki, s.partial_trace.ended_at_ms);
    for bytes in [first, second] {
        let v = verify(
            &bytes,
            &s.original_request_json,
            &location::fingerprint_spki(&spki).unwrap(),
        )
        .unwrap();
        assert!(v.report_verified && !v.successful_acceptance_eligible);
        assert_eq!(
            v.report
                .unwrap()
                .snapshot
                .partial_trace
                .request
                .context
                .unwrap()
                .purpose,
            "camera"
        );
    }
}

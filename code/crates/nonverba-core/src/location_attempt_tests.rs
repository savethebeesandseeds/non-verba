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

#[test]
fn native_partial_observation_doubles_roundtrip_exactly_into_signed_failure_claims() {
    let (mut source, key, spki) = fixture();
    source.partial_trace.request.policy.max_accuracy_m = 186.52586364746094;
    source.original_request_json = serde_json::to_string(&source.partial_trace.request).unwrap();
    let mut sample: Trace =
        serde_json::from_str(include_str!("location_proof/raw_gnss_fixture.json")).unwrap();
    let mut fix = sample.samples.remove(0);
    fix.latitude = 47.497901916503906;
    fix.longitude = 19.04020118713379;
    fix.accuracy_m = 12.125000953674316;
    fix.altitude_m = Some(-186.52586364746094);
    fix.altitude_accuracy_m = Some(0.8044999837875366);
    source.partial_trace.samples.push(fix);
    let raw = source.partial_trace.raw_gnss.as_mut().unwrap();
    raw.epochs[0].clock.bias_ns = Some(-0.0);
    raw.epochs[0].clock.drift_ns_per_second = Some(-186.52586364746094);
    raw.epochs[0].clock.drift_uncertainty_ns_per_second = Some(0.8044999837875366);
    raw.epochs[0].measurements[0].pseudorange_rate_mps = -186.52586364746094;
    raw.epochs[0].measurements[0].pseudorange_rate_uncertainty_mps = 0.8044999837875366;
    raw.epochs[0].measurements[0].accumulated_delta_range_m = Some(-186.52586364746094);
    raw.epochs[0].measurements[0].accumulated_delta_range_uncertainty_m = Some(0.8044999837875366);
    assert_eq!(
        raw.epochs[0].measurements[0].pseudorange_rate_mps.to_bits(),
        0xc067_50d3_e000_0000,
    );
    let native_json = serde_json::to_string(&source).unwrap();
    assert!(native_json.contains("-186.52586364746094"));
    let parsed = parse_snapshot(&native_json).unwrap();
    assert_eq!(
        parsed.partial_trace.raw_gnss.as_ref().unwrap().epochs[0].measurements[0]
            .pseudorange_rate_mps.to_bits(),
        0xc067_50d3_e000_0000,
    );
    let bytes = signed(parsed.clone(), &key, &spki, source.partial_trace.ended_at_ms);
    let pin = location::fingerprint_spki(&spki).unwrap();
    let verified = verify(&bytes, &source.original_request_json, &pin).unwrap();
    assert!(verified.report_verified, "{:?}", verified.errors);
    assert!(verified.request_match);
    assert!(!verified.successful_acceptance_eligible);
    let report = verified.report.unwrap();
    assert_eq!(report.snapshot.original_request_json, source.original_request_json);
    assert_eq!(report.original_request_sha256, crate::digest(source.original_request_json.as_bytes()));

    fn exact_numbers(expected: &serde_json::Value, actual: &serde_json::Value, at: &str) {
        match expected {
            serde_json::Value::Number(number) if number.is_f64() => assert_eq!(
                number.as_f64().unwrap().to_bits(),
                actual.as_f64().unwrap().to_bits(),
                "Native partial-observation double changed at {at}",
            ),
            serde_json::Value::Array(values) => {
                for (index, value) in values.iter().enumerate() {
                    exact_numbers(value, &actual[index], &format!("{at}.{index}"));
                }
            }
            serde_json::Value::Object(values) => {
                for (name, value) in values {
                    exact_numbers(value, &actual[name], &format!("{at}.{name}"));
                }
            }
            _ => assert_eq!(expected, actual, "Frozen native claim changed at {at}"),
        }
    }
    let original = serde_json::to_value(&source).unwrap();
    for roundtrip in [serde_json::to_value(parsed).unwrap(), serde_json::to_value(&report.snapshot).unwrap()] {
        assert_eq!(original, roundtrip);
        exact_numbers(&original, &roundtrip, "snapshot");
    }
    assert_eq!(report.snapshot.partial_trace.elapsed_ms, source.partial_trace.elapsed_ms);
    assert_eq!(report.snapshot.partial_trace.ended_at_ms, source.partial_trace.ended_at_ms);
    assert_eq!(report.snapshot.diagnostics.raw_callback_count, source.diagnostics.raw_callback_count);
    let mut wrong_request = source.partial_trace.request.clone();
    wrong_request.policy.max_accuracy_m = f64::from_bits(wrong_request.policy.max_accuracy_m.to_bits() + 1);
    let wrong = verify(&bytes, &serde_json::to_string(&wrong_request).unwrap(), &pin).unwrap();
    assert!(wrong.signature_integrity && wrong.claims_consistent);
    assert!(!wrong.request_match && !wrong.report_verified);

    // The unchanged v1 domain also verifies an already encoded historical value.
    // A parser fix must preserve that payload claim rather than retro-correcting it
    // from an unsigned native snapshot. This is synthetic legacy-format evidence.
    let mut legacy = source.clone();
    legacy.partial_trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0]
        .pseudorange_rate_mps = f64::from_bits(0xc067_50d3_e000_0001);
    let legacy_bytes = signed(legacy, &key, &spki, source.partial_trace.ended_at_ms);
    let old = verify(&legacy_bytes, &source.original_request_json, &pin).unwrap();
    assert!(old.report_verified, "{:?}", old.errors);
    assert_eq!(
        old.report.unwrap().snapshot.partial_trace.raw_gnss.unwrap().epochs[0].measurements[0]
            .pseudorange_rate_mps.to_bits(),
        0xc067_50d3_e000_0001,
    );

    // A legacy parser could encode an adjacent policy double while preserving
    // the exact request string. A real signature never resolves that mismatch.
    let mut message = CoseSign1::from_tagged_slice(&bytes).unwrap();
    let mut contradictory: Report = serde_json::from_slice(message.payload.as_ref().unwrap()).unwrap();
    contradictory.snapshot.partial_trace.request.policy.max_accuracy_m =
        f64::from_bits(source.partial_trace.request.policy.max_accuracy_m.to_bits() + 1);
    message.payload = Some(serde_json::to_vec(&contradictory).unwrap());
    let signature: Signature = key.sign(&message.tbs_data(AAD));
    message.signature = signature.to_bytes().to_vec();
    let rejected = verify(&message.to_tagged_vec().unwrap(), &source.original_request_json, &pin).unwrap();
    assert!(rejected.signature_integrity && rejected.request_match);
    assert!(!rejected.claims_consistent && !rejected.report_verified);
}

#[test]
fn explicit_strict_delivery_request_rejects_first_epoch_and_signs_actual_policy() {
    let (mut s, key, spki) = fixture();
    s.partial_trace.request.policy.duration_ms = 2_000;
    s.partial_trace.request.policy.max_finalization_delay_ms = Some(30_000);
    s.partial_trace
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = Some(1.0);
    let raw = s.partial_trace.raw_gnss.as_mut().unwrap();
    raw.epochs.truncate(1);
    raw.rejected_epoch_count = 0;
    raw.epochs[0].clock.elapsed_realtime_uncertainty_ns = 5_000_000.0;
    s.partial_trace.elapsed_ms = 1_100;
    s.partial_trace.ended_at_ms = s.partial_trace.started_at_ms + 1_100;
    s.diagnostics.rejected_fixes = 0;
    s.diagnostics.raw_callback_count = 1;
    s.diagnostics.last_raw_callback_elapsed_ms = Some(1_000);
    s.diagnostics.first_raw_admitted_elapsed_ms = None;
    s.diagnostics.collector_status_json = serde_json::json!({
        "raw_gnss_diagnostics": {
            "registration": "registered",
            "receiver_status": "ready",
            "receiver_status_code": 1,
            "callback_count": 1,
            "last_callback_elapsed_ms": 1_000,
            "cadence_skipped": 0,
            "warmup_reasons": {}
        }
    })
    .to_string();
    let cap_only = location::evaluate_raw_gnss_collection(&s.partial_trace);
    assert_eq!(cap_only.collection_action, RawGnssCollectionAction::DiscardStartup);
    assert!(!cap_only.checks.clock_fields_valid);
    assert!(cap_only.checks.collection_alignment_valid);

    // The actual reported 5 ms uncertainty, plus the callback's floored time bin,
    // cannot fit this explicit 1 ms delivery budget. The uncertainty cap alone
    // is startup quality rejection and must not be mistaken for a terminal cause.
    s.partial_trace.request.policy.max_delivery_delay_ms = 1;
    s.original_request_json = serde_json::to_string(&s.partial_trace.request).unwrap();
    let progress = location::evaluate_raw_gnss_collection(&s.partial_trace);
    assert_eq!(progress.collection_action, RawGnssCollectionAction::Reject);
    assert!(!progress.checks.clock_fields_valid && !progress.checks.collection_alignment_valid);
    assert!(progress.checks.error_codes.iter().any(|code| code == "RAW_GNSS_CLOCK_FIELDS"));
    assert!(progress.checks.error_codes.iter().any(|code| code == "RAW_GNSS_ALIGNMENT"));
    let bytes = signed(s.clone(), &key, &spki, s.partial_trace.ended_at_ms + 1);
    let verified = verify(
        &bytes,
        &s.original_request_json,
        &location::fingerprint_spki(&spki).unwrap(),
    )
    .unwrap();
    assert!(verified.report_verified && verified.request_match, "{:?}", verified.errors);
    assert!(!verified.successful_acceptance_eligible && !verified.measurement_policy_satisfied);
    let report = verified.report.unwrap();
    assert_eq!(report.outcome, "raw-gnss-policy-rejected");
    assert_eq!(report.reason_codes, progress.checks.error_codes);
    assert_eq!(report.snapshot.original_request_json, s.original_request_json);
    assert_eq!(report.snapshot.partial_trace.request.policy.max_delivery_delay_ms, 1);
    assert_eq!(
        report.snapshot.partial_trace.request.policy.raw_gnss.unwrap().max_elapsed_realtime_uncertainty_ns,
        Some(1.0)
    );
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

fn startup_fixture() -> (Snapshot, SigningKey, Vec<u8>) {
    let (mut s, key, spki) = timeout_fixture();
    s.terminal_trigger = TerminalTrigger::RawGnssStartupUnavailable;
    s.partial_trace.elapsed_ms = 713;
    s.partial_trace.ended_at_ms = s.partial_trace.started_at_ms + 713;
    // Ordinary GPS updates can have been rejected by the missing-raw-data guard.
    // They are diagnostics, not accepted fixes or evidence of a physical cause.
    s.diagnostics.rejected_fixes = 2;
    s.diagnostics.collector_status_json = serde_json::json!({
        "raw_gnss_diagnostics": {
            "unsigned": true,
            "registration": "registered",
            "registration_api": "androidx-compat-handler",
            "receiver_status": "not-supported",
            "receiver_status_code": 0,
            "callback_count": 0,
            "last_callback_elapsed_ms": null,
            "cadence_skipped": 0,
            "warmup_reasons": {},
            "os_has_measurements": null
        }
    })
    .to_string();
    (s, key, spki)
}

#[test]
fn native_startup_status_report_is_a_bound_failure_and_never_success() {
    let (s, key, spki) = startup_fixture();
    let pin = location::fingerprint_spki(&spki).unwrap();
    let bytes = signed(s.clone(), &key, &spki, s.partial_trace.ended_at_ms + 7);
    let v = verify(&bytes, &s.original_request_json, &pin).unwrap();
    assert!(v.report_verified, "{:?}", v.errors);
    assert_eq!(v.acquisition_outcome, "raw-gnss-startup-unavailable");
    assert!(v.raw_gnss_evaluation.is_none());
    assert!(
        !v.successful_measurement
            && !v.measurement_policy_satisfied
            && !v.successful_acceptance_eligible
            && !v.fresh_action_eligible
            && !v.independent_receipt_verified
    );
    assert!(
        !v.collection_attested
            && !v.hardware_attested
            && !v.clock_trusted
            && !v.operator_effort_proven
            && !v.operator_fault_proven
            && !v.physical_cause_proven
    );
    let r = v.report.unwrap();
    assert_eq!(r.reason_codes, ["RAW_GNSS_STARTUP_UNAVAILABLE", "RAW_GNSS_NO_CALLBACKS"]);
    assert_eq!(r.physical_cause, "unknown");
    assert_eq!(r.original_request_sha256, crate::digest(s.original_request_json.as_bytes()));
    assert_eq!(r.snapshot.original_request_json, s.original_request_json);
    assert_eq!(r.snapshot.attempt_id, s.attempt_id);
    assert_eq!(r.snapshot.partial_trace.elapsed_ms, 713);
    assert_eq!(r.snapshot.diagnostics.rejected_fixes, 2);
    assert_eq!(r.snapshot.diagnostics.last_raw_callback_elapsed_ms, None);
    assert!(!verify(&bytes, &s.original_request_json, &"0".repeat(64)).unwrap().report_verified);
    let mut other = s.partial_trace.request.clone();
    other.challenge.task = "Other startup request".into();
    assert!(!verify(&bytes, &serde_json::to_string(&other).unwrap(), &pin).unwrap().request_match);
    assert!(!location::verify(&bytes, &s.partial_trace.request, &pin, None, s.partial_trace.ended_at_ms).unwrap().verified);
    let policy = r#"{"version":1,"native_acquisition_required":false,"raw_gnss_required":false,"correlated_camera_clock_required":false,"hardware_attestation_required":false,"independent_position_required":false}"#;
    let appraisal: serde_json::Value = serde_json::from_str(
        &crate::agent_appraisal::appraise_location(
            &bytes, &s.original_request_json, &pin, "null", policy, 2_000_000_001.0,
        ).unwrap(),
    ).unwrap();
    assert_eq!(appraisal["evidence_verified"], false);
    assert_eq!(appraisal["policy_satisfied"], false);
    let mut success_trace: Trace = serde_json::from_str(include_str!("location_proof/raw_gnss_fixture.json")).unwrap();
    success_trace.request = s.partial_trace.request.clone();
    let success = location::seal_with_signer(&success_trace, &spki, None, success_trace.ended_at_ms, |tbs| {
        let sig: Signature = key.sign(tbs);
        Ok(sig.to_bytes().to_vec())
    }).unwrap();
    assert!(!verify(&success, &s.original_request_json, &pin).unwrap().report_verified);
}

#[test]
fn startup_unavailable_requires_explicit_native_status_and_consistent_empty_observations() {
    let (s, key, spki) = startup_fixture();
    for change in 0..25 {
        let mut bad = s.clone();
        let mut status: serde_json::Value = serde_json::from_str(&bad.diagnostics.collector_status_json).unwrap();
        match change {
            0 => status["raw_gnss_diagnostics"]["registration"] = "attempting".into(),
            1 => status["raw_gnss_diagnostics"]["registration"] = "refused".into(),
            2 => status["raw_gnss_diagnostics"]["receiver_status"] = "ready".into(),
            3 => status["raw_gnss_diagnostics"]["receiver_status_code"] = 1.into(),
            4 => status["raw_gnss_diagnostics"]["receiver_status_code"] = "0".into(),
            5 => status["raw_gnss_diagnostics"]["callback_count"] = 1.into(),
            6 => status["raw_gnss_diagnostics"]["last_callback_elapsed_ms"] = 700.into(),
            7 => status["raw_gnss_diagnostics"]["cadence_skipped"] = 1.into(),
            8 => status["raw_gnss_diagnostics"]["warmup_reasons"] = serde_json::json!({"empty-signals": 1}),
            9 => status = serde_json::json!({}),
            10 => { status["raw_gnss_diagnostics"].as_object_mut().unwrap().remove("last_callback_elapsed_ms"); }
            11 => { bad.diagnostics.raw_callback_count = 1; bad.diagnostics.last_raw_callback_elapsed_ms = Some(700); }
            12 => bad.diagnostics.first_raw_admitted_elapsed_ms = Some(500),
            13 => bad.diagnostics.permission_granted_elapsed_ms = None,
            14 => bad.partial_trace.raw_gnss.as_mut().unwrap().rejected_epoch_count = 1,
            15 => bad.partial_trace.raw_gnss.as_mut().unwrap().epochs = fixture().0.partial_trace.raw_gnss.unwrap().epochs,
            16 => {
                let success: Trace = serde_json::from_str(include_str!("location_proof/raw_gnss_fixture.json")).unwrap();
                let mut fix = success.samples[0].clone();
                fix.observed_elapsed_ms = 500;
                bad.partial_trace.samples = vec![fix];
            }
            17 => bad.stopping_stage = "requesting-permission".into(),
            18 => bad.stopping_stage = "ready".into(),
            19 => bad.stopping_stage = "cancelled".into(),
            20 => bad.terminal_trigger = TerminalTrigger::CollectionTimeout,
            21 => bad.partial_trace.raw_gnss.as_mut().unwrap().anchor_elapsed_realtime_ns = "0".into(),
            22 => bad.partial_trace.raw_gnss.as_mut().unwrap().collection_interval_ms = 0,
            23 => bad.partial_trace.raw_gnss.as_mut().unwrap().kind = "synthetic-browser-gnss".into(),
            _ => { bad.diagnostics.last_raw_callback_elapsed_ms = Some(714); }
        }
        bad.diagnostics.collector_status_json = status.to_string();
        let mut called = false;
        let now = bad.partial_trace.ended_at_ms;
        assert!(seal_with_signer(bad, &spki, now, |tbs| {
            called = true;
            let sig: Signature = key.sign(tbs);
            Ok(sig.to_bytes().to_vec())
        }).is_err(), "case {change}");
        assert!(!called, "case {change}");
    }
}

#[test]
fn startup_report_tampering_and_resigned_inconsistent_claims_fail() {
    let (s, key, spki) = startup_fixture();
    let bytes = signed(s.clone(), &key, &spki, s.partial_trace.ended_at_ms);
    let pin = location::fingerprint_spki(&spki).unwrap();
    for change in 0..7 {
        let mut message = CoseSign1::from_tagged_slice(&bytes).unwrap();
        let mut report: Report = serde_json::from_slice(message.payload.as_ref().unwrap()).unwrap();
        match change {
            0 => report.snapshot.terminal_trigger = TerminalTrigger::CollectionTimeout,
            1 => report.outcome = "raw-gnss-policy-rejected".into(),
            2 => report.reason_codes = vec!["HARDWARE_FAULT".into()],
            3 => report.physical_cause = "receiver-broken".into(),
            4 => report.snapshot.diagnostics.collector_status_json = "{}".into(),
            5 => report.snapshot.stopping_stage = "ready".into(),
            _ => report.snapshot.partial_trace.elapsed_ms = 0,
        }
        message.payload = Some(serde_json::to_vec(&report).unwrap());
        let v = verify(&message.clone().to_tagged_vec().unwrap(), &s.original_request_json, &pin).unwrap();
        assert!(!v.signature_integrity && !v.report_verified);
        // Even a real signature cannot make contradictory claims acceptable.
        let sig: Signature = key.sign(&message.tbs_data(AAD));
        message.signature = sig.to_bytes().to_vec();
        let v = verify(&message.to_tagged_vec().unwrap(), &s.original_request_json, &pin).unwrap();
        assert!(v.signature_integrity);
        assert!(!v.claims_consistent && !v.report_verified && !v.successful_acceptance_eligible);
    }
}

#[test]
fn startup_failure_is_historical_and_signer_faults_produce_no_report() {
    let (s, key, spki) = startup_fixture();
    let late = s.partial_trace.request.challenge.expires_at * 1000 + 1000;
    let bytes = signed(s.clone(), &key, &spki, late);
    let v = verify(&bytes, &s.original_request_json, &location::fingerprint_spki(&spki).unwrap()).unwrap();
    assert!(v.report_verified);
    assert!(!v.fresh_action_eligible && !v.independent_receipt_verified);
    assert_eq!(v.report.unwrap().snapshot.partial_trace.elapsed_ms, 713);
    let now = s.partial_trace.ended_at_ms;
    assert!(seal_with_signer(s.clone(), &spki, now, |_| Err("Key unavailable".into())).unwrap_err().contains("unavailable"));
    assert!(seal_with_signer(s, &spki, now, |_| Ok(vec![0; 64])).is_err());
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
    let (startup, _, _) = startup_fixture();
    let mut json = serde_json::to_value(startup).unwrap();
    json.as_object_mut().unwrap().remove("terminal_trigger");
    let implicit = parse_snapshot(&json.to_string()).unwrap();
    assert_eq!(implicit.terminal_trigger, TerminalTrigger::RawPolicyRejection);
    let mut called = false;
    let now = implicit.partial_trace.ended_at_ms;
    assert!(seal_with_signer(implicit, &spki, now, |_| {
        called = true;
        Ok(vec![0; 64])
    }).is_err());
    assert!(!called);
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

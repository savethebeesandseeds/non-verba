// SPDX-License-Identifier: AGPL-3.0-only
use super::{
    tests::{fixture, sealed, NOW},
    *,
};
use serde_json::Value;

type ClockDiagnosticMutation = (&'static str, &'static str, fn(&mut RawGnssClock));
type MeasurementDiagnosticMutation = (&'static str, &'static str, fn(&mut RawGnssMeasurement));
type ClockUncertaintyMutation = (&'static str, fn(&mut RawGnssClock, f64));

pub(super) fn raw_fixture() -> (Trace, String, String) {
    let (mut trace, identity, pin) = fixture(true);
    trace.request.policy.profile = "native-required".into();
    trace.request.policy.required_provider = "gnss".into();
    trace.request.policy.raw_gnss = Some(RawGnssPolicy::default());
    trace.raw_gnss = Some(RawGnssTrace {
        version: 1,
        kind: "android-raw-gnss".into(),
        anchor_elapsed_realtime_ns: "500000000000".into(),
        full_tracking_requested: true,
        collection_interval_ms: 1000,
        rejected_epoch_count: 2,
        epochs: (0..11)
            .map(|i| {
                let elapsed_ms = (i + 1) as u64 * 1000;
                RawGnssEpoch {
                    sequence: i,
                    observed_elapsed_ms: elapsed_ms,
                    clock: RawGnssClock {
                        time_ns: (1_000_000_000_000 + elapsed_ms * 1_000_000).to_string(),
                        full_bias_ns: "-1234567890123456789".into(),
                        bias_ns: Some(-0.125),
                        bias_uncertainty_ns: Some(1.0),
                        time_uncertainty_ns: None,
                        drift_ns_per_second: Some(-10.0),
                        drift_uncertainty_ns_per_second: Some(0.5),
                        hardware_clock_discontinuity_count: 7,
                        elapsed_realtime_ns: (500_000_000_000 + elapsed_ms * 1_000_000).to_string(),
                        elapsed_realtime_uncertainty_ns: 1000.0,
                    },
                    measurements: (1..=4)
                        .map(|svid| RawGnssMeasurement {
                            constellation: 1,
                            svid,
                            state: 9,
                            received_sv_time_ns: (123_456_789_000_000 + elapsed_ms * 1_000_000)
                                .to_string(),
                            received_sv_time_uncertainty_ns: "10".into(),
                            time_offset_ns: 0.0,
                            cn0_dbhz: 35.0,
                            pseudorange_rate_mps: -123.0,
                            pseudorange_rate_uncertainty_mps: 0.1,
                            carrier_frequency_hz: Some(1_575_420_000.0),
                            code_type: Some("C".into()),
                            accumulated_delta_range_state: 1,
                            accumulated_delta_range_m: Some(10_000.0),
                            accumulated_delta_range_uncertainty_m: Some(0.02),
                            automatic_gain_control_db: Some(-5.0),
                        })
                        .collect(),
                }
            })
            .collect(),
    });
    (trace, identity, pin)
}

#[test]
fn raw_round_trip_preserves_exact_nanoseconds_and_truth_boundaries() {
    let (trace, identity, pin) = raw_fixture();
    let decoded = parse_trace(&json(&trace).unwrap()).unwrap();
    assert_eq!(decoded, trace);
    let proof = sealed(&trace, &identity, None);
    let result = verify(&proof, &trace.request, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(result.verified, "{:?}", result.errors);
    let checks = result.raw_gnss.unwrap();
    assert!(checks.required && checks.present && checks.ready);
    assert_eq!(checks.epoch_count, 11);
    assert_eq!(checks.min_qualifying_satellites, 4);
    assert!(!checks.satellite_authentication_verified);
    assert!(!checks.independent_position_recomputed && !checks.collection_attested);
    assert!(!result.hardware_attested && !result.location_authenticity_proven);
}

#[test]
fn short_duration_is_explicit_raw_only_and_preserves_legacy_defaults_and_counts() {
    assert_eq!(Policy::default().duration_ms, 10_000);
    let (trace, _, _) = raw_fixture();
    let mut policy = trace.request.policy;
    for duration in [2_000, 5_000, 10_000, 15_000] {
        policy.duration_ms = duration;
        assert!(validate_policy(&policy).is_ok(), "duration {duration}");
    }
    for duration in [0, 1_999, 15_001] {
        policy.duration_ms = duration;
        assert!(validate_policy(&policy).is_err(), "duration {duration}");
    }
    policy.duration_ms = 2_000;
    policy.min_samples = 2;
    assert!(validate_policy(&policy).is_err());
    policy.min_samples = 3;
    policy.raw_gnss.as_mut().unwrap().min_epochs = 2;
    assert!(validate_policy(&policy).is_err());
    policy.raw_gnss.as_mut().unwrap().min_epochs = 3;
    policy.profile = "browser-or-native".into();
    assert!(validate_policy(&policy).is_err());
    policy.profile = "native-required".into();
    policy.required_provider = "any".into();
    assert!(validate_policy(&policy).is_err());
    policy.required_provider = "gnss".into();
    policy.raw_gnss = None;
    for duration in [2_000, 4_999] {
        policy.duration_ms = duration;
        assert!(validate_policy(&policy).is_err());
    }
    policy.duration_ms = 5_000;
    assert!(validate_policy(&policy).is_ok());
}

fn short_raw_fixture() -> (Trace, String, String) {
    let (mut trace, identity, pin) = raw_fixture();
    trace.request.policy.duration_ms = 2_000;
    trace
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = Some(10_000_000.0);
    for (index, sample) in trace.samples.iter_mut().enumerate() {
        let elapsed = (index as u64 + 1) * 1_000;
        sample.fix_elapsed_ms = Some(elapsed);
        sample.observed_elapsed_ms = elapsed;
        sample.fix_timestamp_ms = trace.started_at_ms + elapsed;
    }
    let raw = trace.raw_gnss.as_mut().unwrap();
    raw.epochs.truncate(4);
    for epoch in &mut raw.epochs {
        epoch.clock.elapsed_realtime_uncertainty_ns = 5_000_000.0;
    }
    trace.elapsed_ms = 4_000;
    trace.ended_at_ms = trace.started_at_ms + trace.elapsed_ms;
    (trace, identity, pin)
}

#[test]
fn signed_short_raw_trace_keeps_exact_request_and_conservative_coverage() {
    let (trace, identity, pin) = short_raw_fixture();
    let key = software_key(&identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let proof = seal_with_signer(&trace, spki.as_bytes(), None, trace.ended_at_ms, |bytes| {
        let signature: Signature = key.sign(bytes);
        Ok(signature.to_bytes().to_vec())
    })
    .unwrap();
    let report = verify(&proof, &trace.request, &pin, None, trace.ended_at_ms).unwrap();
    assert!(report.verified, "{:?}", report.errors);
    assert!(report.checks.signature_integrity && report.checks.collection_duration_valid);
    let raw = report.raw_gnss.as_ref().unwrap();
    assert!(raw.ready && raw.coverage_valid && raw.epoch_count_valid);
    assert_eq!(raw.epoch_count, 4);
    assert_eq!(trace.samples.len(), 3);
    assert!(!raw.independent_position_recomputed && !raw.satellite_authentication_verified);
    assert!(
        !report.location_authenticity_proven
            && !report.collection_attested
            && !report.clock_trusted
    );

    let mut original_ten_seconds = trace.request.clone();
    original_ten_seconds.policy.duration_ms = 10_000;
    let mismatched = verify(&proof, &original_ten_seconds, &pin, None, trace.ended_at_ms).unwrap();
    assert!(mismatched.checks.signature_integrity);
    assert!(!mismatched.verified && !mismatched.checks.request_match);
}

#[test]
fn signed_short_raw_proofs_cannot_hide_insufficient_span_counts_or_uncertainty() {
    let (trace, identity, pin) = short_raw_fixture();
    let key = software_key(&identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let template = cose::make_evidence(&trace, spki.as_bytes(), None, trace.ended_at_ms).unwrap();
    for mode in 0..4 {
        let mut bad = template.clone();
        match mode {
            0 => {
                let last = bad.trace.samples.last_mut().unwrap();
                last.fix_elapsed_ms = Some(2_999);
                last.observed_elapsed_ms = 2_999;
                last.fix_timestamp_ms = bad.trace.started_at_ms + 2_999;
            }
            1 => {
                bad.trace.samples.remove(1);
                bad.trace.samples[1].sequence = 1;
            }
            2 => {
                bad.trace.raw_gnss.as_mut().unwrap().epochs.truncate(2);
            }
            _ => {
                // Three 1-Hz epochs span two seconds nominally, but only
                // 1.990 seconds after both reported 5-ms endpoint budgets.
                bad.trace.raw_gnss.as_mut().unwrap().epochs.truncate(3);
            }
        }
        assert!(
            validate_trace(&bad.trace, trace.ended_at_ms).is_err(),
            "mode {mode}"
        );
        let proof = cose::sign_evidence(&bad, |bytes| {
            let signature: Signature = key.sign(bytes);
            Ok(signature.to_bytes().to_vec())
        })
        .unwrap();
        let report = verify(&proof, &trace.request, &pin, None, trace.ended_at_ms).unwrap();
        assert!(
            report.checks.signature_integrity
                && report.checks.device_match
                && report.checks.request_match,
            "signed binding mode {mode}"
        );
        assert!(!report.verified, "mode {mode}");
        let raw = report.raw_gnss.as_ref().unwrap();
        match mode {
            0 => assert!(!report.checks.collection_duration_valid),
            1 => assert!(!report.checks.sample_count_valid),
            2 => assert!(!raw.epoch_count_valid),
            _ => {
                assert!(
                    report.checks.collection_duration_valid && report.checks.sample_count_valid
                );
                assert!(
                    raw.epoch_count_valid
                        && raw.clock_fields_valid
                        && raw.collection_alignment_valid
                );
                assert!(!raw.coverage_valid && !raw.ready);
            }
        }
    }
}

#[test]
fn legacy_payloads_stay_absent_and_verifiable() {
    let (trace, identity, pin) = fixture(false);
    let encoded = json(&trace).unwrap();
    assert!(!encoded.contains("raw_gnss"));
    let proof = sealed(&parse_trace(&encoded).unwrap(), &identity, None);
    let result = verify(&proof, &trace.request, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(result.verified && result.raw_gnss.is_none());
    assert!(!json(&result).unwrap().contains("raw_gnss"));
}

#[test]
fn required_mode_refuses_absence_browser_unrequested_data_and_downgrade() {
    let (trace, identity, pin) = raw_fixture();
    for mode in 0..4 {
        let mut bad = trace.clone();
        match mode {
            0 => bad.raw_gnss = None,
            1 => bad.profile = "software-browser".into(),
            2 => bad.request.policy.raw_gnss = None,
            _ => bad.request.policy.profile = "browser-or-native".into(),
        }
        assert!(
            validate_trace(&bad, (NOW + 12) * 1000).is_err(),
            "Mode {mode}"
        );
    }
    let proof = sealed(&trace, &identity, None);
    let mut downgraded = trace.request.clone();
    downgraded.policy.raw_gnss = None;
    let report = verify(&proof, &downgraded, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(!report.verified && !report.checks.request_match);
}

#[test]
fn signed_malformed_raw_measurements_do_not_bypass_independent_verification() {
    let (trace, identity, pin) = raw_fixture();
    let key = software_key(&identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let template = cose::make_evidence(&trace, spki.as_bytes(), None, (NOW + 12) * 1000).unwrap();
    for mode in 0..16 {
        let mut bad = template.clone();
        let raw = bad.trace.raw_gnss.as_mut().unwrap();
        match mode {
            0 => raw.epochs[2].clock.hardware_clock_discontinuity_count += 1,
            1 => raw.epochs[2].clock.time_ns = raw.epochs[1].clock.time_ns.clone(),
            2 => raw.epochs[2].clock.full_bias_ns = "-1234567892123456789".into(),
            3 => raw.epochs[2].clock.elapsed_realtime_ns = "503000000001.0".into(),
            4 => raw.epochs[2].clock.elapsed_realtime_uncertainty_ns = 1_000_001.0,
            5 => raw.epochs[2].sequence = 99,
            6 => raw.epochs[2].measurements[0].svid = 0,
            7 => raw.epochs[2].measurements[0].state = 0,
            8 => raw.epochs[2].measurements[0].received_sv_time_uncertainty_ns = "100001".into(),
            9 => raw.epochs[2].measurements[0].pseudorange_rate_uncertainty_mps = 21.0,
            10 => raw.epochs[2].measurements[0].accumulated_delta_range_uncertainty_m = None,
            11 => raw.epochs[2].measurements[0].received_sv_time_ns = "604800000000000".into(),
            12 => raw.epochs[2].measurements[0] = raw.epochs[2].measurements[1].clone(),
            13 => raw.epochs[2].clock.time_ns = "+1003000000000".into(),
            14 => raw.epochs[2].measurements[0].time_offset_ns = 500_000_000.0,
            _ => raw.epochs.swap(2, 3),
        }
        let proof = cose::sign_evidence(&bad, |bytes| {
            let signature: Signature = key.sign(bytes);
            Ok(signature.to_bytes().to_vec())
        })
        .unwrap();
        let report = verify(&proof, &trace.request, &pin, None, (NOW + 12) * 1000).unwrap();
        assert!(report.checks.signature_integrity, "Signature {mode}");
        assert!(
            !report.verified && !report.raw_gnss.unwrap().ready,
            "Mode {mode}"
        );
    }
}

#[test]
fn full_span_gaps_delays_and_finalization_age_are_enforced() {
    let (trace, _, _) = raw_fixture();
    for mode in 0..6 {
        let mut bad = trace.clone();
        let raw = bad.raw_gnss.as_mut().unwrap();
        match mode {
            0 => {
                raw.epochs.remove(10);
            }
            1 => {
                raw.epochs.drain(3..6);
                for (i, e) in raw.epochs.iter_mut().enumerate() {
                    e.sequence = i;
                }
            }
            2 => raw.epochs[0].observed_elapsed_ms += 4000,
            3 => raw.anchor_elapsed_realtime_ns = "505000000000".into(),
            4 => raw.epochs[0].measurements[0].time_offset_ns = -1_000_000_000.0,
            _ => {
                raw.epochs[1].clock.elapsed_realtime_ns = "501500000000".into();
            }
        }
        assert!(
            validate_trace(&bad, (NOW + 12) * 1000).is_err(),
            "Mode {mode}"
        );
    }
    let checks = raw_gnss::evaluate_at(&trace, (NOW + 18) * 1000);
    assert!(!checks.freshness_valid && checks.error_codes.contains(&"RAW_GNSS_FRESHNESS".into()));
}

#[test]
fn bands_and_codes_do_not_inflate_independent_satellite_count() {
    let (mut trace, _, _) = raw_fixture();
    for epoch in &mut trace.raw_gnss.as_mut().unwrap().epochs {
        let one = epoch.measurements[0].clone();
        epoch.measurements = (0..4)
            .map(|i| {
                let mut m = one.clone();
                m.carrier_frequency_hz = Some(1_575_420_000.0 - i as f64 * 1e8);
                m
            })
            .collect();
    }
    let checks = evaluate_raw_gnss(&trace);
    assert!(checks.measurement_fields_valid);
    assert_eq!(checks.min_qualifying_satellites, 1);
    assert!(!checks.satellite_count_valid && !checks.ready);
}

#[test]
fn progress_waits_for_real_duration_but_accepts_independent_optional_clock_fields() {
    let (mut trace, _, _) = raw_fixture();
    let raw = trace.raw_gnss.as_mut().unwrap();
    for e in &mut raw.epochs {
        e.clock.bias_ns = None;
        e.clock.drift_ns_per_second = None;
        e.clock.time_ns = (e.clock.time_ns.parse::<i64>().unwrap() - 2_000_000_000_000).to_string();
    }
    assert!(evaluate_raw_gnss(&trace).ready);
    trace.raw_gnss.as_mut().unwrap().epochs.truncate(1);
    let progress = evaluate_raw_gnss(&trace);
    assert!(!progress.ready);
    assert!(progress.epoch_sequence_valid && progress.clock_fields_valid);
    assert!(progress
        .error_codes
        .contains(&"RAW_GNSS_EPOCH_COUNT".into()));
    assert!(progress.error_codes.contains(&"RAW_GNSS_COVERAGE".into()));
}

#[test]
fn array_json_and_protocol_version_bounds_are_applied_before_signing() {
    let (trace, _, _) = raw_fixture();
    let value = serde_json::to_value(&trace).unwrap();
    for mode in 0..3 {
        let mut bad = value.clone();
        match mode {
            0 => {
                bad["raw_gnss"]["epochs"] =
                    Value::Array(vec![bad["raw_gnss"]["epochs"][0].clone(); 65])
            }
            1 => {
                bad["raw_gnss"]["epochs"][0]["measurements"] = Value::Array(vec![
                        bad["raw_gnss"]["epochs"][0]["measurements"][0].clone();
                        129
                    ])
            }
            _ => bad["samples"] = Value::Array(vec![bad["samples"][0].clone(); 129]),
        }
        assert!(parse_trace(&bad.to_string()).is_err(), "Array {mode}");
    }
    assert!(parse_trace(&" ".repeat(MAX_TRACE_JSON_BYTES + 1)).is_err());
    assert!(parse_request(&" ".repeat(MAX_REQUEST_JSON_BYTES + 1)).is_err());
    let mut invalid = trace.clone();
    invalid.raw_gnss.as_mut().unwrap().version = 2;
    assert!(!evaluate_raw_gnss(&invalid).bounds_valid);
    invalid = trace;
    invalid
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .min_satellites = 3;
    assert!(validate_policy(&invalid.request.policy).is_err());
}

#[test]
fn larger_raw_proof_round_trip_obeys_shared_limits() {
    let (mut trace, identity, pin) = raw_fixture();
    for epoch in &mut trace.raw_gnss.as_mut().unwrap().epochs {
        let template = epoch.measurements[0].clone();
        epoch.measurements = (1..=32)
            .flat_map(|svid| {
                [1, 6].map(|constellation| {
                    let mut m = template.clone();
                    m.svid = svid;
                    m.constellation = constellation;
                    m
                })
            })
            .collect();
    }
    let proof = sealed(&trace, &identity, None);
    assert!(proof.len() > 96 * 1024 && proof.len() < MAX_PROOF_BYTES);
    let report = verify(&proof, &trace.request, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(report.verified, "{:?}", report.errors);
}

#[test]
fn shared_jni_fixture_is_valid_synthetic_raw_evidence() {
    let trace = parse_trace(include_str!("raw_gnss_fixture.json")).unwrap();
    assert!(validate_trace(&trace, (NOW + 12) * 1000).is_ok());
    assert!(evaluate_raw_gnss(&trace).ready);
    assert_eq!(trace.request.challenge.requester, "Synthetic test fixture");
}

#[test]
fn first_raw_epoch_before_any_gps_fix_reports_only_pending_coverage() {
    let (mut trace, _, _) = raw_fixture();
    trace.samples.clear();
    trace.raw_gnss.as_mut().unwrap().epochs.truncate(1);
    trace.elapsed_ms = 1300;
    trace.ended_at_ms = trace.started_at_ms + 1300;
    let checks = evaluate_raw_gnss(&trace);
    assert_eq!(
        checks.error_codes,
        ["RAW_GNSS_EPOCH_COUNT", "RAW_GNSS_COVERAGE"]
    );
    assert!(
        checks.clock_fields_valid
            && checks.clock_continuity_valid
            && checks.measurement_fields_valid
    );
    assert!(checks.field_diagnostics.is_empty());
    assert!(!checks.ready);
}

#[test]
fn raw_clock_field_diagnostics_identify_failures_without_changing_verdicts() {
    let (trace, _, _) = raw_fixture();
    let changes: [ClockDiagnosticMutation; 9] = [
        ("time_ns", "invalid-integer", |c| c.time_ns = "+1".into()),
        ("full_bias_ns", "invalid-integer", |c| {
            c.full_bias_ns = "private-invalid-value".into()
        }),
        ("elapsed_realtime_ns", "invalid-integer", |c| {
            c.elapsed_realtime_ns = "1.5".into()
        }),
        ("bias_ns", "out-of-range", |c| c.bias_ns = Some(1e13)),
        ("bias_uncertainty_ns", "above-policy", |c| {
            c.bias_uncertainty_ns = Some(100_001.0)
        }),
        ("time_uncertainty_ns", "negative", |c| {
            c.time_uncertainty_ns = Some(-1.0)
        }),
        ("drift_ns_per_second", "out-of-range", |c| {
            c.drift_ns_per_second = Some(1e10)
        }),
        ("drift_uncertainty_ns_per_second", "out-of-range", |c| {
            c.drift_uncertainty_ns_per_second = Some(-1.0)
        }),
        ("elapsed_realtime_uncertainty_ns", "above-policy", |c| {
            c.elapsed_realtime_uncertainty_ns = 100_001.0
        }),
    ];
    for (field, reason, change) in changes {
        let mut bad = trace.clone();
        change(&mut bad.raw_gnss.as_mut().unwrap().epochs[0].clock);
        let checks = evaluate_raw_gnss(&bad);
        assert!(
            !checks.ready && !checks.clock_fields_valid && !checks.clock_continuity_valid,
            "{field}"
        );
        assert!(checks.measurement_fields_valid, "{field}");
        assert_eq!(
            checks.field_diagnostics,
            vec![raw_gnss::RawGnssFieldDiagnostic {
                field: format!("clock.{field}"),
                reason: reason.into(),
                count: 1,
                reported_max: (reason == "above-policy").then_some(100_001.0),
                requested_max: (reason == "above-policy").then_some(100_000.0),
            }]
        );
        assert!(!serde_json::to_string(&checks.field_diagnostics)
            .unwrap()
            .contains("private-invalid-value"));
        assert!(validate_trace(&bad, (NOW + 12) * 1000).is_err());
    }
    let mut bad = trace;
    bad.raw_gnss.as_mut().unwrap().anchor_elapsed_realtime_ns = "-1".into();
    let checks = evaluate_raw_gnss(&bad);
    assert_eq!(
        checks.field_diagnostics[0].field,
        "clock.anchor_elapsed_realtime_ns"
    );
    assert_eq!(checks.field_diagnostics[0].reason, "invalid-integer");
    assert!(!checks.ready && !checks.clock_fields_valid);
}

#[test]
fn raw_measurement_field_diagnostics_cover_each_existing_rejection_predicate() {
    let (trace, _, _) = raw_fixture();
    let changes: [MeasurementDiagnosticMutation; 15] = [
        ("satellite_id", "out-of-range", |m| m.svid = 0),
        ("state", "unsupported-bits", |m| m.state |= 0x20000),
        ("received_sv_time_ns", "out-of-range", |m| {
            m.received_sv_time_ns = "604800000000000".into()
        }),
        ("received_sv_time_uncertainty_ns", "out-of-range", |m| {
            m.received_sv_time_uncertainty_ns = "-1".into()
        }),
        ("time_offset_ns", "out-of-range", |m| {
            m.time_offset_ns = -2e9
        }),
        ("cn0_dbhz", "out-of-range", |m| m.cn0_dbhz = 101.0),
        ("pseudorange_rate_mps", "out-of-range", |m| {
            m.pseudorange_rate_mps = 20_001.0
        }),
        ("pseudorange_rate_uncertainty_mps", "out-of-range", |m| {
            m.pseudorange_rate_uncertainty_mps = -1.0
        }),
        ("carrier_frequency_hz", "out-of-range", |m| {
            m.carrier_frequency_hz = Some(0.0)
        }),
        ("code_type", "overlong", |m| {
            m.code_type = Some("private-invalid-value".into())
        }),
        ("accumulated_delta_range_state", "unsupported-bits", |m| {
            m.accumulated_delta_range_state |= 32
        }),
        ("accumulated_delta_range_m", "out-of-range", |m| {
            m.accumulated_delta_range_m = Some(1e13)
        }),
        (
            "accumulated_delta_range_uncertainty_m",
            "out-of-range",
            |m| m.accumulated_delta_range_uncertainty_m = Some(-1.0),
        ),
        (
            "accumulated_delta_range_pair",
            "inconsistent-presence",
            |m| m.accumulated_delta_range_uncertainty_m = None,
        ),
        ("automatic_gain_control_db", "out-of-range", |m| {
            m.automatic_gain_control_db = Some(-1001.0)
        }),
    ];
    for (field, reason, change) in changes {
        let mut bad = trace.clone();
        change(&mut bad.raw_gnss.as_mut().unwrap().epochs[0].measurements[0]);
        let checks = evaluate_raw_gnss(&bad);
        assert!(!checks.ready && !checks.measurement_fields_valid, "{field}");
        assert!(
            checks.clock_fields_valid && checks.clock_continuity_valid,
            "{field}"
        );
        assert_eq!(
            checks.field_diagnostics,
            vec![raw_gnss::RawGnssFieldDiagnostic {
                field: format!("measurement.{field}"),
                reason: reason.into(),
                count: 1,
                ..Default::default()
            }]
        );
        assert!(!serde_json::to_string(&checks.field_diagnostics)
            .unwrap()
            .contains("private-invalid-value"));
        assert!(validate_trace(&bad, (NOW + 12) * 1000).is_err());
    }
    let mut duplicate = trace;
    let epoch = &mut duplicate.raw_gnss.as_mut().unwrap().epochs[0];
    epoch.measurements.push(epoch.measurements[0].clone());
    let checks = evaluate_raw_gnss(&duplicate);
    assert!(!checks.ready && !checks.measurement_fields_valid);
    assert_eq!(
        checks.field_diagnostics[0].field,
        "measurement.signal_identity"
    );
    assert_eq!(checks.field_diagnostics[0].reason, "duplicate-signal");
    assert_eq!(checks.field_diagnostics[0].count, 1);
}

#[test]
fn raw_field_diagnostics_are_additive_bounded_and_do_not_promote_partial_lock() {
    let (mut trace, _, _) = raw_fixture();
    let valid = evaluate_raw_gnss(&trace);
    assert!(valid.ready && valid.field_diagnostics.is_empty());
    let mut old_report = serde_json::to_value(&valid).unwrap();
    old_report
        .as_object_mut()
        .unwrap()
        .remove("field_diagnostics");
    let old_report: RawGnssChecks = serde_json::from_value(old_report).unwrap();
    assert!(old_report.ready && old_report.field_diagnostics.is_empty());
    for epoch in &mut trace.raw_gnss.as_mut().unwrap().epochs {
        for m in &mut epoch.measurements {
            m.state = 0;
        }
    }
    let partial = evaluate_raw_gnss(&trace);
    assert!(!partial.ready && !partial.satellite_count_valid);
    assert!(partial.measurement_fields_valid && partial.field_diagnostics.is_empty());
    let raw = trace.raw_gnss.as_mut().unwrap();
    raw.epochs = vec![raw.epochs[0].clone(); MAX_RAW_GNSS_EPOCHS];
    for epoch in &mut raw.epochs {
        epoch.clock.bias_uncertainty_ns = Some(100_001.0);
        epoch.measurements = vec![epoch.measurements[0].clone(); MAX_RAW_GNSS_MEASUREMENTS];
        for m in &mut epoch.measurements {
            m.code_type = Some("bad".into());
        }
    }
    let checks = evaluate_raw_gnss(&trace);
    assert_eq!(checks.field_diagnostics.len(), 2);
    assert_eq!(checks.field_diagnostics[0].count, 64);
    assert_eq!(checks.field_diagnostics[1].count, 8192);
    assert!(!checks.ready && !checks.clock_fields_valid && !checks.measurement_fields_valid);
}

#[test]
fn clock_uncertainty_reasons_distinguish_quality_from_malformed_values() {
    let (trace, _, _) = raw_fixture();
    let fields: [ClockUncertaintyMutation; 3] = [
        ("clock.bias_uncertainty_ns", |c, value| {
            c.bias_uncertainty_ns = Some(value)
        }),
        ("clock.time_uncertainty_ns", |c, value| {
            c.time_uncertainty_ns = Some(value)
        }),
        ("clock.elapsed_realtime_uncertainty_ns", |c, value| {
            c.elapsed_realtime_uncertainty_ns = value
        }),
    ];
    for (field, set) in fields {
        for (value, reason) in [
            (-1.0, "negative"),
            (f64::NAN, "nonfinite"),
            (f64::INFINITY, "nonfinite"),
            (f64::NEG_INFINITY, "nonfinite"),
            (100_001.0, "above-policy"),
        ] {
            let mut bad = trace.clone();
            set(&mut bad.raw_gnss.as_mut().unwrap().epochs[0].clock, value);
            let checks = evaluate_raw_gnss(&bad);
            assert!(
                !checks.ready && !checks.clock_fields_valid,
                "{field}: {reason}"
            );
            assert_eq!(
                checks.field_diagnostics,
                vec![raw_gnss::RawGnssFieldDiagnostic {
                    field: field.into(),
                    reason: reason.into(),
                    count: 1,
                    reported_max: (reason == "above-policy").then_some(100_001.0),
                    requested_max: (reason == "above-policy").then_some(100_000.0),
                }]
            );
        }
        for value in [0.0, 100_000.0] {
            let mut valid = trace.clone();
            set(&mut valid.raw_gnss.as_mut().unwrap().epochs[0].clock, value);
            let checks = evaluate_raw_gnss(&valid);
            assert!(
                checks.ready && checks.field_diagnostics.is_empty(),
                "{field}: {value}"
            );
        }
    }
}

#[test]
fn code_type_absence_is_optional_but_present_malformed_values_stay_rejected() {
    let (trace, _, _) = raw_fixture();
    for code in [
        None,
        Some("UNKNOWN"),
        Some("C"),
        Some("G"),
        Some("ABCDEFGHIJKLMNOP"),
    ] {
        let mut valid = trace.clone();
        valid.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].code_type =
            code.map(str::to_owned);
        let checks = evaluate_raw_gnss(&valid);
        assert!(
            checks.ready && checks.field_diagnostics.is_empty(),
            "{code:?}"
        );
    }
    for (value, reason) in [
        ("ABCDEFGHIJKLMNOPQ", "overlong"),
        ("c", "invalid-characters"),
        ("C/A", "invalid-characters"),
        (" ", "invalid-characters"),
        ("é", "invalid-characters"),
        ("C\0", "invalid-characters"),
    ] {
        let mut bad = trace.clone();
        bad.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].code_type = Some(value.into());
        let checks = evaluate_raw_gnss(&bad);
        assert!(
            !checks.ready && !checks.measurement_fields_valid,
            "{reason}"
        );
        assert_eq!(
            checks.field_diagnostics,
            vec![raw_gnss::RawGnssFieldDiagnostic {
                field: "measurement.code_type".into(),
                reason: reason.into(),
                count: 1,
                ..Default::default()
            }]
        );
        assert!(validate_trace(&bad, (NOW + 12) * 1000).is_err());
    }
}

#[test]
fn distinct_failure_reasons_for_one_field_are_retained_as_separate_bounded_counts() {
    let (mut trace, _, _) = raw_fixture();
    let raw = trace.raw_gnss.as_mut().unwrap();
    for (index, (value, code)) in [
        (-1.0, ""),
        (f64::NAN, "ABCDEFGHIJKLMNOPQ"),
        (100_001.0, "c"),
    ]
    .into_iter()
    .enumerate()
    {
        raw.epochs[index].clock.bias_uncertainty_ns = Some(value);
        raw.epochs[index].measurements[0].code_type = Some(code.into());
    }
    let checks = evaluate_raw_gnss(&trace);
    assert!(!checks.ready && !checks.clock_fields_valid && !checks.measurement_fields_valid);
    assert_eq!(checks.field_diagnostics.len(), 6);
    assert!(checks
        .field_diagnostics
        .iter()
        .all(|entry| entry.count == 1));
    let reasons: Vec<_> = checks
        .field_diagnostics
        .iter()
        .map(|entry| entry.reason.as_str())
        .collect();
    assert_eq!(
        reasons,
        [
            "above-policy",
            "negative",
            "nonfinite",
            "empty",
            "invalid-characters",
            "overlong"
        ]
    );
}

#[test]
fn raw_finalization_allowance_preserves_epoch_freshness_at_collection_end() {
    let (mut trace, _, _) = raw_fixture();
    let end = trace.ended_at_ms;
    assert!(!raw_gnss::evaluate_at(&trace, end + 7400).freshness_valid);
    trace.request.policy.max_finalization_delay_ms = Some(30_000);
    assert!(raw_gnss::evaluate_at(&trace, end + 7400).ready);
    assert!(raw_gnss::evaluate_at(&trace, end + 30_000).freshness_valid);
    assert!(!raw_gnss::evaluate_at(&trace, end + 30_001).freshness_valid);
    trace.ended_at_ms += 6000;
    trace.elapsed_ms += 6000;
    assert!(!raw_gnss::evaluate_at(&trace, trace.ended_at_ms + 1).freshness_valid);
}

#[test]
fn empty_codes_are_retained_and_cannot_bypass_unknown_signal_duplicates() {
    let (mut trace, identity, pin) = raw_fixture();
    for epoch in &mut trace.raw_gnss.as_mut().unwrap().epochs {
        let mut unknown = epoch.measurements[0].clone();
        unknown.svid = 5;
        unknown.code_type = Some(String::new());
        epoch.measurements.push(unknown);
    }
    let original = trace.clone();
    let checks = evaluate_raw_gnss(&trace);
    assert!(checks.ready && checks.measurement_fields_valid);
    assert_eq!(checks.min_qualifying_satellites, 5);
    assert_eq!(
        checks.field_diagnostics,
        vec![raw_gnss::RawGnssFieldDiagnostic {
            field: "measurement.code_type".into(),
            reason: "empty".into(),
            count: 11,
            ..Default::default()
        }]
    );
    assert_eq!(parse_trace(&json(&trace).unwrap()).unwrap(), original);
    let proof = sealed(&trace, &identity, None);
    let result = verify(&proof, &trace.request, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(result.verified, "{:?}", result.errors);
    assert_eq!(result.evidence.unwrap().trace, original);
    assert_eq!(trace, original);

    for reverse in [false, true] {
        let mut duplicate_trace = original.clone();
        let epoch = &mut duplicate_trace.raw_gnss.as_mut().unwrap().epochs[0];
        epoch.measurements[0].code_type = None;
        let mut duplicate = epoch.measurements[0].clone();
        duplicate.code_type = Some(String::new());
        epoch.measurements.push(duplicate);
        if reverse {
            epoch.measurements.reverse();
        }
        let before = duplicate_trace.clone();
        let checks = evaluate_raw_gnss(&duplicate_trace);
        assert!(!checks.ready && !checks.measurement_fields_valid);
        assert_eq!(checks.min_qualifying_satellites, 5);
        assert!(checks
            .field_diagnostics
            .iter()
            .any(|entry| entry.field == "measurement.signal_identity"
                && entry.reason == "duplicate-signal"
                && entry.count == 1));
        assert!(validate_trace(&duplicate_trace, (NOW + 12) * 1000).is_err());
        assert_eq!(duplicate_trace, before);
    }
}

#[test]
fn unknown_codes_share_basic_eligibility_without_inflating_satellites_or_skipping_quality() {
    let (base, _, _) = raw_fixture();
    for code in [None, Some(""), Some("UNKNOWN")] {
        let mut trace = base.clone();
        for epoch in &mut trace.raw_gnss.as_mut().unwrap().epochs {
            for measurement in &mut epoch.measurements {
                measurement.code_type = code.map(str::to_owned);
            }
        }
        let checks = evaluate_raw_gnss(&trace);
        assert!(checks.ready && checks.measurement_fields_valid, "{code:?}");
        assert_eq!(checks.min_qualifying_satellites, 4);
        assert_eq!(parse_trace(&json(&trace).unwrap()).unwrap(), trace);

        for mode in 0..3 {
            let mut bad = trace.clone();
            let measurement = &mut bad.raw_gnss.as_mut().unwrap().epochs[0].measurements[0];
            match mode {
                0 => measurement.state = 0,
                1 => measurement.received_sv_time_uncertainty_ns = "100001".into(),
                _ => measurement.pseudorange_rate_uncertainty_mps = 21.0,
            }
            let checks = evaluate_raw_gnss(&bad);
            assert!(checks.measurement_fields_valid);
            assert_eq!(checks.min_qualifying_satellites, 3, "{code:?}/{mode}");
            assert!(!checks.ready && !checks.satellite_count_valid);
            assert!(validate_trace(&bad, (NOW + 12) * 1000).is_err());
        }
    }

    let mut same_satellite = base;
    for epoch in &mut same_satellite.raw_gnss.as_mut().unwrap().epochs {
        epoch.measurements[0].code_type = None;
        let mut other_signal = epoch.measurements[0].clone();
        other_signal.code_type = Some("UNKNOWN".into());
        epoch.measurements.push(other_signal);
    }
    let checks = evaluate_raw_gnss(&same_satellite);
    assert!(checks.ready && checks.measurement_fields_valid);
    assert_eq!(checks.min_qualifying_satellites, 4);
    same_satellite
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .min_satellites = 5;
    let checks = evaluate_raw_gnss(&same_satellite);
    assert!(checks.measurement_fields_valid);
    assert!(!checks.ready && !checks.satellite_count_valid);
    assert!(validate_trace(&same_satellite, (NOW + 12) * 1000).is_err());
}

#[test]
fn raw_uncertainty_diagnostics_report_bounded_maxima_without_changing_evidence() {
    let (mut trace, _, _) = raw_fixture();
    let policy_limit = trace
        .request
        .policy
        .raw_gnss
        .as_ref()
        .unwrap()
        .max_time_uncertainty_ns;
    let raw = trace.raw_gnss.as_mut().unwrap();
    raw.epochs[0].clock.elapsed_realtime_uncertainty_ns = 100_001.25;
    raw.epochs[1].clock.elapsed_realtime_uncertainty_ns = 250_000.5;
    raw.epochs[2].clock.elapsed_realtime_uncertainty_ns = 200_000.0;
    let before = trace.clone();
    let checks = evaluate_raw_gnss(&trace);
    assert!(!checks.ready && !checks.clock_fields_valid);
    assert_eq!(
        checks.field_diagnostics,
        vec![raw_gnss::RawGnssFieldDiagnostic {
            field: "clock.elapsed_realtime_uncertainty_ns".into(),
            reason: "above-policy".into(),
            count: 3,
            reported_max: Some(250_000.5),
            requested_max: Some(policy_limit),
        }]
    );
    assert_eq!(trace, before);
    assert_eq!(parse_trace(&json(&trace).unwrap()).unwrap(), before);
    let encoded = serde_json::to_value(&checks.field_diagnostics).unwrap();
    assert_eq!(encoded[0].as_object().unwrap().len(), 5);
    // Old diagnostic reports still deserialize without the additive numbers.
    let old: raw_gnss::RawGnssFieldDiagnostic = serde_json::from_value(serde_json::json!({
        "field":"clock.elapsed_realtime_uncertainty_ns", "reason":"above-policy", "count":3
    }))
    .unwrap();
    assert!(old.reported_max.is_none() && old.requested_max.is_none());
}

#[test]
fn raw_uncertainty_diagnostics_never_clip_or_leak_invalid_numeric_values() {
    let (trace, _, _) = raw_fixture();
    for value in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -1.0,
        9_007_199_254_740_992.0,
        f64::MAX,
    ] {
        let mut invalid = trace.clone();
        invalid.raw_gnss.as_mut().unwrap().epochs[0]
            .clock
            .elapsed_realtime_uncertainty_ns = value;
        let checks = evaluate_raw_gnss(&invalid);
        assert!(!checks.ready && !checks.clock_fields_valid);
        assert!(checks
            .field_diagnostics
            .iter()
            .all(|field| field.reported_max.is_none() && field.requested_max.is_none()));
        let encoded = json(&checks.field_diagnostics).unwrap();
        assert!(!encoded.contains("reported_max") && !encoded.contains("requested_max"));
    }
    let mut boundary = trace;
    boundary.raw_gnss.as_mut().unwrap().epochs[0]
        .clock
        .elapsed_realtime_uncertainty_ns = 9_007_199_254_740_991.0;
    assert_eq!(
        evaluate_raw_gnss(&boundary).field_diagnostics[0].reported_max,
        Some(9_007_199_254_740_991.0)
    );
    // An out-of-bound later outlier suppresses the maximum rather than turning
    // a smaller, partially observed value into a false maximum.
    boundary.raw_gnss.as_mut().unwrap().epochs[1]
        .clock
        .elapsed_realtime_uncertainty_ns = f64::MAX;
    assert!(evaluate_raw_gnss(&boundary).field_diagnostics[0]
        .reported_max
        .is_none());
}

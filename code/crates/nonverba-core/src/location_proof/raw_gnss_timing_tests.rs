// SPDX-License-Identifier: AGPL-3.0-only
use super::super::{
    continuous, evaluate_at, evaluate_raw_gnss_collection, policy_valid, RawGnssCollectionAction,
};
use super::*;
use crate::location_proof::{
    cose, json, parse_trace,
    raw_gnss_tests::raw_fixture,
    software_key,
    tests::{sealed, NOW},
    validate_trace, verify,
};
use p256::{
    ecdsa::{signature::Signer, Signature},
    pkcs8::EncodePublicKey,
};

fn explicit_fixture() -> (Trace, String, String) {
    let (mut trace, identity, pin) = raw_fixture();
    trace
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = Some(10_000_000.0);
    trace.request.policy.duration_ms = 9990;
    for epoch in &mut trace.raw_gnss.as_mut().unwrap().epochs {
        epoch.clock.elapsed_realtime_uncertainty_ns = 5_000_000.0;
    }
    (trace, identity, pin)
}
fn policy(trace: &Trace) -> &RawGnssPolicy {
    trace.request.policy.raw_gnss.as_ref().unwrap()
}
fn raw(trace: &Trace) -> &RawGnssTrace {
    trace.raw_gnss.as_ref().unwrap()
}
fn set_time(epoch: &mut RawGnssEpoch, elapsed_ns: u64) {
    epoch.clock.elapsed_realtime_ns = (500_000_000_000 + elapsed_ns).to_string();
}
fn set_uncertainty(trace: &mut Trace, ns: f64) {
    for epoch in &mut trace.raw_gnss.as_mut().unwrap().epochs {
        epoch.clock.elapsed_realtime_uncertainty_ns = ns;
    }
}

#[test]
fn optional_alignment_policy_preserves_legacy_bytes_and_validates_finite_bounds() {
    let (legacy, identity, pin) = raw_fixture();
    let encoded = json(&legacy).unwrap();
    assert!(!encoded.contains("max_elapsed_realtime_uncertainty_ns"));
    assert_eq!(json(&parse_trace(&encoded).unwrap()).unwrap(), encoded);
    let proof = sealed(&legacy, &identity, None);
    assert!(
        verify(&proof, &legacy.request, &pin, None, legacy.ended_at_ms)
            .unwrap()
            .verified
    );
    for value in [1.0, 10_000_000.0, 100_000_000.0] {
        let mut changed = legacy.request.policy.clone();
        changed
            .raw_gnss
            .as_mut()
            .unwrap()
            .max_elapsed_realtime_uncertainty_ns = Some(value);
        assert!(policy_valid(&changed), "{value}");
    }
    for value in [0.0, -1.0, 100_000_000.1, f64::NAN, f64::INFINITY] {
        let mut changed = legacy.request.policy.clone();
        changed
            .raw_gnss
            .as_mut()
            .unwrap()
            .max_elapsed_realtime_uncertainty_ns = Some(value);
        assert!(!policy_valid(&changed), "{value}");
    }
}

#[test]
fn explicit_signed_alignment_budget_is_bound_to_original_request() {
    let (trace, identity, pin) = explicit_fixture();
    let proof = sealed(&trace, &identity, None);
    let report = verify(&proof, &trace.request, &pin, None, trace.ended_at_ms).unwrap();
    assert!(report.verified, "{:?}", report.errors);
    assert!(report.raw_gnss.as_ref().unwrap().ready);
    assert!(!report.location_authenticity_proven && !report.collection_attested);
    for cap in [None, Some(9_000_000.0), Some(100_000_000.0)] {
        let mut changed = trace.request.clone();
        changed
            .policy
            .raw_gnss
            .as_mut()
            .unwrap()
            .max_elapsed_realtime_uncertainty_ns = cap;
        let altered = verify(&proof, &changed, &pin, None, trace.ended_at_ms).unwrap();
        assert!(!altered.verified && !altered.checks.request_match);
    }
    let mut removed = trace.clone();
    removed
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = None;
    assert!(!evaluate_at(&removed, removed.ended_at_ms).clock_fields_valid);
}

#[test]
fn explicit_budget_does_not_relax_receiver_or_satellite_quality() {
    let (trace, _, _) = explicit_fixture();
    for mode in 0..4 {
        let mut bad = trace.clone();
        let epoch = &mut bad.raw_gnss.as_mut().unwrap().epochs[1];
        match mode {
            0 => epoch.clock.bias_uncertainty_ns = Some(100_001.0),
            1 => epoch.clock.time_uncertainty_ns = Some(100_001.0),
            2 => epoch.measurements[0].received_sv_time_uncertainty_ns = "100001".into(),
            _ => epoch.clock.elapsed_realtime_uncertainty_ns = 10_000_000.1,
        }
        assert!(
            validate_trace(&bad, bad.ended_at_ms).is_err(),
            "mode {mode}"
        );
        if mode != 2 {
            let field = match mode {
                0 => "clock.bias_uncertainty_ns",
                1 => "clock.time_uncertainty_ns",
                _ => "clock.elapsed_realtime_uncertainty_ns",
            };
            let checks = evaluate_at(&bad, bad.ended_at_ms);
            let note = checks
                .field_diagnostics
                .iter()
                .find(|note| note.field == field)
                .unwrap();
            assert_eq!(note.reason, "above-policy");
            assert_eq!(
                note.requested_max,
                Some(if mode == 3 { 10_000_000.0 } else { 100_000.0 })
            );
            assert_eq!(
                note.reported_max,
                Some(if mode == 3 { 10_000_000.1 } else { 100_001.0 })
            );
        }
    }
}

#[test]
fn reported_uncertainty_is_rounded_up_and_hostile_values_fail_closed() {
    let (trace, _, _) = explicit_fixture();
    let mut clock = raw(&trace).epochs[0].clock.clone();
    clock.elapsed_realtime_uncertainty_ns = 5_000_000.01;
    assert_eq!(
        alignment_uncertainty_ns(&clock, policy(&trace)),
        Some(5_000_001)
    );
    for value in [-1.0, f64::NAN, f64::INFINITY, 9_007_199_254_740_992.0] {
        clock.elapsed_realtime_uncertainty_ns = value;
        assert_eq!(
            alignment_uncertainty_ns(&clock, policy(&trace)),
            None,
            "{value}"
        );
    }
}

#[test]
fn delivery_uses_earliest_edge_but_keeps_nominal_callback_causality() {
    let (mut trace, _, _) = explicit_fixture();
    assert!(
        alignment(&trace, raw(&trace), policy(&trace)),
        "Reported upper edge may overlap the callback"
    );
    trace.raw_gnss.as_mut().unwrap().epochs[0].observed_elapsed_ms = 3994;
    assert!(alignment(&trace, raw(&trace), policy(&trace)));
    trace.raw_gnss.as_mut().unwrap().epochs[0]
        .clock
        .elapsed_realtime_uncertainty_ns = 5_000_000.01;
    assert!(
        !alignment(&trace, raw(&trace), policy(&trace)),
        "Ceil uncertainty consumes the last ns"
    );
    set_uncertainty(&mut trace, 5_000_000.0);
    trace.raw_gnss.as_mut().unwrap().epochs[0].observed_elapsed_ms = 3995;
    assert!(!alignment(&trace, raw(&trace), policy(&trace)));
    trace.raw_gnss.as_mut().unwrap().epochs[0].observed_elapsed_ms = 1000;
    set_time(
        &mut trace.raw_gnss.as_mut().unwrap().epochs[0],
        1_001_000_000,
    );
    assert!(!alignment(&trace, raw(&trace), policy(&trace)));
    set_time(&mut trace.raw_gnss.as_mut().unwrap().epochs[0], 5_000_000);
    assert!(
        !alignment(&trace, raw(&trace), policy(&trace)),
        "Earliest edge equals anchor"
    );
    set_time(
        &mut trace.raw_gnss.as_mut().unwrap().epochs[0],
        1_000_000_000,
    );
    trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].time_offset_ns = 1_000_000.0;
    assert!(
        !alignment(&trace, raw(&trace), policy(&trace)),
        "Future measurement offset"
    );
}

#[test]
fn coverage_consumes_span_budget_but_keeps_nominal_cadence_separate() {
    let (mut trace, _, _) = explicit_fixture();
    assert!(coverage(&trace, raw(&trace), policy(&trace)));
    trace.request.policy.duration_ms = 9991;
    assert!(!coverage(&trace, raw(&trace), policy(&trace)));
    trace.request.policy.duration_ms = 9900;
    trace
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = Some(100_000_000.0);
    set_uncertainty(&mut trace, 25_000_000.0);
    assert!(
        coverage(&trace, raw(&trace), policy(&trace)),
        "Coarse alignment still has a nominal one-second cadence"
    );
    set_uncertainty(&mut trace, 25_000_000.01);
    assert!(coverage(&trace, raw(&trace), policy(&trace)));
    set_time(
        &mut trace.raw_gnss.as_mut().unwrap().epochs[1],
        1_950_000_000,
    );
    assert!(
        coverage(&trace, raw(&trace), policy(&trace)),
        "950 ms nominal cadence"
    );
    set_time(
        &mut trace.raw_gnss.as_mut().unwrap().epochs[1],
        1_949_999_999,
    );
    assert!(!coverage(&trace, raw(&trace), policy(&trace)));
    let (mut legacy, _, _) = raw_fixture();
    assert!(evaluate_at(&legacy, legacy.ended_at_ms).coverage_valid);
    legacy
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = Some(100_000.0);
    assert!(
        !evaluate_at(&legacy, legacy.ended_at_ms).coverage_valid,
        "Explicit accounting may not spend uncertainty outside an exact legacy span"
    );
}

#[test]
fn max_gap_and_fix_coverage_consume_uncertainty_without_widening_budget() {
    let (mut trace, _, _) = explicit_fixture();
    trace.request.policy.duration_ms = 2000;
    trace.raw_gnss.as_mut().unwrap().epochs.truncate(2);
    set_time(
        &mut trace.raw_gnss.as_mut().unwrap().epochs[1],
        3_490_000_000,
    );
    trace.samples[2].fix_elapsed_ms = Some(3485);
    assert!(
        coverage(&trace, raw(&trace), policy(&trace)),
        "2490 ms plus 10 ms equals max gap"
    );
    set_time(
        &mut trace.raw_gnss.as_mut().unwrap().epochs[1],
        3_490_000_001,
    );
    assert!(!coverage(&trace, raw(&trace), policy(&trace)));
    let (mut trace, _, _) = explicit_fixture();
    trace.request.policy.duration_ms = 9900;
    trace.samples[2].fix_elapsed_ms = Some(13494);
    assert!(
        coverage(&trace, raw(&trace), policy(&trace)),
        "Last fix upper edge equals the gap budget"
    );
    set_uncertainty(&mut trace, 5_000_000.01);
    assert!(
        !coverage(&trace, raw(&trace), policy(&trace)),
        "Ceil uncertainty consumes the last ns"
    );
    set_uncertainty(&mut trace, 5_000_000.0);
    trace.samples[2].fix_elapsed_ms = Some(13495);
    assert!(
        !coverage(&trace, raw(&trace), policy(&trace)),
        "Floor equality omits up to one ms of fix age"
    );
    let (mut trace, _, _) = explicit_fixture();
    for epoch in &mut trace.raw_gnss.as_mut().unwrap().epochs {
        let relative = uint(&epoch.clock.elapsed_realtime_ns).unwrap() - 500_000_000_000;
        set_time(epoch, relative + 2_000_000_000);
    }
    trace.samples[0].fix_elapsed_ms = Some(505);
    assert!(
        coverage(&trace, raw(&trace), policy(&trace)),
        "First fix lower edge stays conservative"
    );
    trace.samples[0].fix_elapsed_ms = Some(504);
    assert!(!coverage(&trace, raw(&trace), policy(&trace)));
}

#[test]
fn continuity_checks_compatibility_without_claiming_precise_stability() {
    let (trace, _, _) = explicit_fixture();
    let a = raw(&trace).epochs[0].clone();
    let mut b = raw(&trace).epochs[1].clone();
    b.clock.time_ns = (uint(&b.clock.time_ns).unwrap() + 110_000_000).to_string();
    assert!(continuous(&a, &b, policy(&trace)));
    b.clock.time_ns = (uint(&b.clock.time_ns).unwrap() + 1).to_string();
    assert!(!continuous(&a, &b, policy(&trace)));
    b = raw(&trace).epochs[1].clone();
    b.clock.hardware_clock_discontinuity_count += 1;
    assert!(!continuous(&a, &b, policy(&trace)));
}

#[test]
fn freshness_uses_earliest_edge_even_with_separate_finalization_allowance() {
    let (mut trace, _, _) = explicit_fixture();
    trace.request.policy.max_finalization_delay_ms = Some(30_000);
    trace.elapsed_ms = 15994;
    trace.ended_at_ms = trace.started_at_ms + trace.elapsed_ms;
    assert!(freshness(
        &trace,
        raw(&trace),
        policy(&trace),
        trace.ended_at_ms + 30_000
    ));
    assert!(!freshness(
        &trace,
        raw(&trace),
        policy(&trace),
        trace.ended_at_ms + 30_001
    ));
    set_uncertainty(&mut trace, 5_000_000.01);
    assert!(
        !freshness(&trace, raw(&trace), policy(&trace), trace.ended_at_ms),
        "Ceil uncertainty consumes the last ns"
    );
    set_uncertainty(&mut trace, 5_000_000.0);
    trace.elapsed_ms += 1;
    trace.ended_at_ms += 1;
    assert!(!freshness(
        &trace,
        raw(&trace),
        policy(&trace),
        trace.ended_at_ms
    ));
}

#[test]
fn above_cap_startup_can_be_discarded_but_established_degradation_cannot() {
    let (mut trace, _, _) = explicit_fixture();
    trace.samples.clear();
    trace.raw_gnss.as_mut().unwrap().epochs.truncate(1);
    trace.elapsed_ms = 1000;
    trace.ended_at_ms = trace.started_at_ms + trace.elapsed_ms;
    set_uncertainty(&mut trace, 10_000_000.1);
    let report = evaluate_raw_gnss_collection(&trace);
    assert_eq!(
        report.collection_action,
        RawGnssCollectionAction::DiscardStartup
    );
    assert!(!report.checks.clock_fields_valid && report.checks.collection_alignment_valid);
    let (mut established, _, _) = explicit_fixture();
    established.raw_gnss.as_mut().unwrap().epochs[1]
        .clock
        .elapsed_realtime_uncertainty_ns = 10_000_000.1;
    assert_eq!(
        evaluate_raw_gnss_collection(&established).collection_action,
        RawGnssCollectionAction::Reject
    );
}

#[test]
fn correctly_signed_replayed_delayed_and_overconfident_epochs_are_rejected() {
    let (trace, identity, pin) = explicit_fixture();
    let key = software_key(&identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let template = cose::make_evidence(&trace, spki.as_bytes(), None, (NOW + 12) * 1000).unwrap();
    for mode in 0..5 {
        let mut bad = template.clone();
        let raw = bad.trace.raw_gnss.as_mut().unwrap();
        match mode {
            0 => raw.epochs[2] = raw.epochs[1].clone(),
            1 => raw.epochs[0].observed_elapsed_ms = 3995,
            2 => raw.epochs[2].clock.elapsed_realtime_uncertainty_ns = 10_000_000.1,
            3 => raw.epochs[2].clock.elapsed_realtime_ns = "500001000000".into(),
            _ => bad.trace.request.policy.duration_ms = 10_000,
        }
        let proof = cose::sign_evidence(&bad, |bytes| {
            let signature: Signature = key.sign(bytes);
            Ok(signature.to_bytes().to_vec())
        })
        .unwrap();
        let report = verify(&proof, &trace.request, &pin, None, trace.ended_at_ms).unwrap();
        assert!(report.checks.signature_integrity, "mode {mode}");
        assert!(!report.verified, "mode {mode}");
    }
}

#[test]
fn measurement_offset_delivery_uses_receipt_upper_edge_without_extra_allowance() {
    let (mut trace, _, _) = explicit_fixture();
    trace.raw_gnss.as_mut().unwrap().epochs[0].observed_elapsed_ms = 3993;
    trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].time_offset_ns = -1_000_000.0;
    assert!(alignment(&trace, raw(&trace), policy(&trace)));
    trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].time_offset_ns = -1_000_000.01;
    assert!(!alignment(&trace, raw(&trace), policy(&trace)));
    trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].time_offset_ns = -2_000_000.0;
    assert!(
        !alignment(&trace, raw(&trace), policy(&trace)),
        "Measurement floor equality is not a full delay budget"
    );
}

fn broad_quality_fixture(uncertainty_ns: f64) -> (Trace, String, String) {
    let (mut trace, identity, pin) = explicit_fixture();
    trace.request.policy.duration_ms = 10_000;
    trace
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = Some(100_000_000.0);
    let epochs = &mut trace.raw_gnss.as_mut().unwrap().epochs;
    let mut next = epochs.last().unwrap().clone();
    next.sequence += 1;
    next.observed_elapsed_ms += 1000;
    next.clock.time_ns = (uint(&next.clock.time_ns).unwrap() + 1_000_000_000).to_string();
    set_time(&mut next, 12_000_000_000);
    for measurement in &mut next.measurements {
        measurement.received_sv_time_ns =
            (uint(&measurement.received_sv_time_ns).unwrap() + 1_000_000_000).to_string();
    }
    epochs.push(next);
    set_uncertainty(&mut trace, uncertainty_ns);
    trace.elapsed_ms = 12_000;
    trace.ended_at_ms = trace.started_at_ms + trace.elapsed_ms;
    (trace, identity, pin)
}

#[test]
fn signed_cross_device_uncertainty_matrix_preserves_full_task_budgets() {
    for uncertainty in [0.0, 5_000_000.0, 25_000_000.0, 50_000_000.0, 100_000_000.0] {
        let (trace, identity, pin) = broad_quality_fixture(uncertainty);
        let key = software_key(&identity).unwrap();
        let spki = key.verifying_key().to_public_key_der().unwrap();
        let original = json(&trace).unwrap();
        let proof = crate::location_proof::seal_with_signer(
            &trace,
            spki.as_bytes(),
            None,
            trace.ended_at_ms,
            |bytes| {
                let signature: Signature = key.sign(bytes);
                Ok(signature.to_der().as_bytes().to_vec())
            },
        )
        .unwrap();
        let report = verify(&proof, &trace.request, &pin, None, trace.ended_at_ms).unwrap();
        assert!(
            report.verified,
            "uncertainty {uncertainty}: {:?}",
            report.errors
        );
        let checks = report.raw_gnss.unwrap();
        assert!(checks.ready);
        let quality = checks.timing_quality.unwrap();
        assert_eq!(
            quality.reported_max_elapsed_uncertainty_ns,
            Some(uncertainty)
        );
        assert_eq!(quality.requested_max_elapsed_uncertainty_ns, 100_000_000.0);
        assert_eq!(quality.confidence_percent, 68);
        assert_eq!(
            quality.continuity_semantics,
            "compatible-with-reported-uncertainty"
        );
        assert!(!quality.precise_clock_stability_proven && !quality.physical_error_bound_proven);
        assert!(!checks.collection_attested && !checks.satellite_authentication_verified);
        assert!(!report.location_authenticity_proven);
        assert_eq!(
            evaluate_raw_gnss_collection(&trace).collection_action,
            RawGnssCollectionAction::Retain
        );
        assert_eq!(json(&trace).unwrap(), original, "Signed data is immutable");
    }
}

#[test]
fn coarse_clock_compatibility_keeps_reset_forward_gap_delay_and_quality_guards() {
    let (trace, _, _) = broad_quality_fixture(100_000_000.0);
    for mode in 0..7 {
        let mut bad = trace.clone();
        let raw = bad.raw_gnss.as_mut().unwrap();
        match mode {
            0 => raw.epochs[2].clock.time_ns = raw.epochs[1].clock.time_ns.clone(),
            1 => {
                raw.epochs[2].clock.elapsed_realtime_ns =
                    raw.epochs[1].clock.elapsed_realtime_ns.clone()
            }
            2 => raw.epochs[2].clock.hardware_clock_discontinuity_count += 1,
            3 => raw.epochs[2].clock.elapsed_realtime_uncertainty_ns = 100_000_000.1,
            4 => raw.epochs[0].observed_elapsed_ms = 3900,
            5 => {
                raw.epochs.drain(2..4);
                for (i, epoch) in raw.epochs.iter_mut().enumerate() {
                    epoch.sequence = i;
                }
            }
            _ => set_time(&mut raw.epochs[1], 1_949_999_999),
        }
        assert!(
            validate_trace(&bad, bad.ended_at_ms).is_err(),
            "mode {mode}"
        );
    }
    let mut jitter = trace.clone();
    set_time(
        &mut jitter.raw_gnss.as_mut().unwrap().epochs[1],
        1_950_000_000,
    );
    assert!(
        validate_trace(&jitter, jitter.ended_at_ms).is_ok(),
        "50 ms nominal jitter is within declared cadence"
    );
    let mut boundary = trace.clone();
    boundary.raw_gnss.as_mut().unwrap().epochs[0].observed_elapsed_ms = 3899;
    assert!(alignment(&boundary, raw(&boundary), policy(&boundary)));
    let a = raw(&trace).epochs[0].clone();
    let mut b = raw(&trace).epochs[1].clone();
    b.clock.time_ns = (uint(&b.clock.time_ns).unwrap() + 300_000_000).to_string();
    assert!(
        continuous(&a, &b, policy(&trace)),
        "100 ms residual plus two reported 100 ms endpoint estimates"
    );
    b.clock.time_ns = (uint(&b.clock.time_ns).unwrap() + 1).to_string();
    assert!(!continuous(&a, &b, policy(&trace)));
}

#[test]
fn uncertain_epoch_nonoverlap_is_mandatory_independently_of_nominal_rate() {
    // Direct predicate boundary: public policy rejects this larger uncertainty
    // too, but the ordering predicate must not assume that separate validation.
    let (mut trace, _, _) = broad_quality_fixture(500_000_000.0);
    trace.request.policy.duration_ms = 1000;
    assert!(!coverage(&trace, raw(&trace), policy(&trace)));
    set_uncertainty(&mut trace, 499_999_999.0);
    assert!(coverage(&trace, raw(&trace), policy(&trace)));
}

#[test]
fn explicit_quality_projection_is_bounded_complete_and_absent_for_legacy() {
    let (legacy, _, _) = raw_fixture();
    assert!(!json(&evaluate_at(&legacy, legacy.ended_at_ms))
        .unwrap()
        .contains("timing_quality"));
    let mut a = raw(&legacy).epochs[0].clone();
    let mut b = raw(&legacy).epochs[1].clone();
    b.clock.time_ns = (uint(&b.clock.time_ns).unwrap() + 100_000_000).to_string();
    assert!(continuous(&a, &b, policy(&legacy)));
    b.clock.time_ns = (uint(&b.clock.time_ns).unwrap() + 1).to_string();
    assert!(!continuous(&a, &b, policy(&legacy)));
    a.clock.elapsed_realtime_uncertainty_ns = 99_999.0;
    assert!(
        !continuous(&a, &b, policy(&legacy)),
        "Legacy uncertainty never expands its old threshold"
    );
    for value in [-1.0, f64::NAN, f64::INFINITY, 9_007_199_254_740_992.0] {
        let (mut trace, _, _) = broad_quality_fixture(5_000_000.0);
        trace.raw_gnss.as_mut().unwrap().epochs[5]
            .clock
            .elapsed_realtime_uncertainty_ns = value;
        let checks = evaluate_at(&trace, trace.ended_at_ms);
        assert!(!checks.ready);
        assert_eq!(
            checks
                .timing_quality
                .unwrap()
                .reported_max_elapsed_uncertainty_ns,
            None
        );
    }
    let (mut trace, _, _) = broad_quality_fixture(100_000_001.0);
    let quality = evaluate_at(&trace, trace.ended_at_ms)
        .timing_quality
        .unwrap();
    assert_eq!(
        quality.reported_max_elapsed_uncertainty_ns,
        Some(100_000_001.0),
        "Above-cap quality is reported, never clipped"
    );
    trace.raw_gnss.as_mut().unwrap().epochs.clear();
    assert_eq!(
        evaluate_at(&trace, trace.ended_at_ms)
            .timing_quality
            .unwrap()
            .reported_max_elapsed_uncertainty_ns,
        None
    );
    trace
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = Some(f64::NAN);
    assert!(evaluate_at(&trace, trace.ended_at_ms)
        .timing_quality
        .is_none());
}

#[test]
fn asymmetric_endpoint_uncertainty_controls_both_clock_compatibility_residuals() {
    let (trace, _, _) = broad_quality_fixture(100_000_000.0);
    let mut a = raw(&trace).epochs[0].clone();
    a.clock.elapsed_realtime_uncertainty_ns = 5_000_000.0;
    let original = raw(&trace).epochs[1].clone();
    for corrected_gps in [false, true] {
        for sign in [-1_i64, 1] {
            let mut b = original.clone();
            if corrected_gps {
                let bias: i64 = b.clock.full_bias_ns.parse().unwrap();
                b.clock.full_bias_ns = (bias + sign * 205_000_000).to_string();
            } else {
                let time: i64 = b.clock.time_ns.parse().unwrap();
                b.clock.time_ns = (time + sign * 205_000_000).to_string();
            }
            assert!(continuous(&a, &b, policy(&trace)));
            if corrected_gps {
                let bias: i64 = b.clock.full_bias_ns.parse().unwrap();
                b.clock.full_bias_ns = (bias + sign).to_string();
            } else {
                let time: i64 = b.clock.time_ns.parse().unwrap();
                b.clock.time_ns = (time + sign).to_string();
            }
            assert!(
                !continuous(&a, &b, policy(&trace)),
                "Uses actual 5+100 ms, not twice the 100 ms policy cap"
            );
        }
    }
}

#[test]
fn authentic_bound_records_still_reject_insufficient_span_and_incompatible_clock() {
    let (trace, identity, pin) = broad_quality_fixture(100_000_000.0);
    let key = software_key(&identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let original = cose::make_evidence(&trace, spki.as_bytes(), None, trace.ended_at_ms).unwrap();
    for shortened_span in [true, false] {
        let mut changed = original.clone();
        let raw = changed.trace.raw_gnss.as_mut().unwrap();
        if shortened_span {
            raw.epochs.pop(); // Nominal 10 seconds leaves only 9.8 seconds after uncertainty.
        } else {
            let epoch = &mut raw.epochs[2];
            epoch.clock.time_ns = (uint(&epoch.clock.time_ns).unwrap() + 300_000_001).to_string();
        }
        let proof = cose::sign_evidence(&changed, |bytes| {
            let signature: Signature = key.sign(bytes);
            Ok(signature.to_bytes().to_vec())
        })
        .unwrap();
        let report = verify(&proof, &trace.request, &pin, None, trace.ended_at_ms).unwrap();
        assert!(
            report.checks.signature_integrity
                && report.checks.request_match
                && report.checks.device_match
                && report.checks.asset_binding
        );
        assert!(
            !report.verified,
            "Intact binding cannot waive measurement quality"
        );
        let raw_checks = report.raw_gnss.unwrap();
        if shortened_span {
            assert!(!raw_checks.coverage_valid);
            assert!(raw_checks.clock_continuity_valid);
        } else {
            assert!(!raw_checks.clock_continuity_valid);
            assert!(raw_checks.coverage_valid);
        }
    }
}

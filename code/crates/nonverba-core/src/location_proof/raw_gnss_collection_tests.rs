// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use crate::location_proof::{
    raw_gnss_tests::raw_fixture,
    tests::{sealed, NOW},
    validate_trace, verify,
};
use RawGnssCollectionAction::*;

fn startup() -> Trace {
    let (mut t, _, _) = raw_fixture();
    t.samples.clear();
    t.raw_gnss.as_mut().unwrap().epochs.truncate(1);
    t.elapsed_ms = 1000;
    t.ended_at_ms = t.started_at_ms + t.elapsed_ms;
    t
}
fn disposition(t: &Trace) -> RawGnssCollectionAction {
    evaluate_raw_gnss_collection(t).collection_action
}

fn cached_startup(explicit_uncertainty: bool) -> Trace {
    let mut trace = startup();
    if explicit_uncertainty {
        trace
            .request
            .policy
            .raw_gnss
            .as_mut()
            .unwrap()
            .max_elapsed_realtime_uncertainty_ns = Some(10_000_000.0);
    }
    let epoch = &mut trace.raw_gnss.as_mut().unwrap().epochs[0];
    epoch.clock.elapsed_realtime_ns = "499900000000".into();
    epoch.clock.time_ns = "999900000000".into();
    if explicit_uncertainty {
        epoch.clock.elapsed_realtime_uncertainty_ns = 5_000_000.0;
    }
    trace
}

#[test]
fn cached_first_raw_epoch_is_excluded_without_restarting_or_crediting_collection() {
    for explicit in [false, true] {
        let trace = cached_startup(explicit);
        let before = trace.clone();
        let progress = evaluate_raw_gnss_collection(&trace);
        assert_eq!(progress.collection_action, DiscardStartup);
        assert!(progress.checks.clock_fields_valid && progress.checks.measurement_fields_valid);
        assert!(progress.checks.satellite_count_valid);
        assert!(!progress.checks.collection_alignment_valid && !progress.checks.ready);
        assert!(validate_trace(&trace, trace.ended_at_ms).is_err());
        assert_eq!(
            trace, before,
            "The request, anchor, deadline and counters must not change"
        );
    }
}

#[test]
fn cached_epoch_must_wholly_precede_anchor_including_uncertainty_and_signal_offsets() {
    for explicit in [false, true] {
        let mut trace = cached_startup(explicit);
        let uncertainty = trace.raw_gnss.as_ref().unwrap().epochs[0]
            .clock
            .elapsed_realtime_uncertainty_ns as u64;
        trace.raw_gnss.as_mut().unwrap().epochs[0]
            .clock
            .elapsed_realtime_ns = (500_000_000_000 - uncertainty - 1).to_string();
        assert_eq!(disposition(&trace), DiscardStartup);
        let mut overlap = trace.clone();
        overlap.raw_gnss.as_mut().unwrap().epochs[0]
            .clock
            .elapsed_realtime_ns = (500_000_000_000 - uncertainty).to_string();
        assert_eq!(disposition(&overlap), Reject);
        let mut signal_overlap = trace.clone();
        signal_overlap.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].time_offset_ns = 1.0;
        assert_eq!(disposition(&signal_overlap), Reject);
    }
}

fn cached_low_satellite_startup() -> Trace {
    let mut trace = explicit_startup();
    trace.request.policy.duration_ms = 2_000;
    trace.elapsed_ms = 574;
    trace.ended_at_ms = trace.started_at_ms + trace.elapsed_ms;
    let epoch = &mut trace.raw_gnss.as_mut().unwrap().epochs[0];
    epoch.clock.elapsed_realtime_ns = (500_000_000_000_u64 - 54_426_294).to_string();
    epoch.clock.time_ns = (1_000_000_000_000_u64 - 54_426_294).to_string();
    epoch.observed_elapsed_ms = 568;
    epoch.measurements[0].state = 0; // Valid partial lock does not qualify as a satellite.
    trace
}

#[test]
fn wholly_cached_startup_with_too_few_qualifying_satellites_is_excluded_without_credit() {
    for shortage in 0..3 {
        let mut trace = cached_low_satellite_startup();
        let epoch = &mut trace.raw_gnss.as_mut().unwrap().epochs[0];
        if shortage == 1 {
            for measurement in &mut epoch.measurements {
                measurement.state = 0;
            }
        } else if shortage == 2 {
            epoch.measurements[0].state = 9;
            epoch.measurements[0].received_sv_time_uncertainty_ns = "100001".into();
        }
        let before = trace.clone();
        let progress = evaluate_raw_gnss_collection(&trace);
        assert_eq!(progress.collection_action, DiscardStartup);
        assert!(progress.checks.clock_fields_valid && progress.checks.measurement_fields_valid);
        assert!(!progress.checks.satellite_count_valid && !progress.checks.ready);
        assert_eq!(
            progress.checks.error_codes,
            [
                "RAW_GNSS_EPOCH_COUNT",
                "RAW_GNSS_ALIGNMENT",
                "RAW_GNSS_SATELLITE_COUNT",
                "RAW_GNSS_COVERAGE",
                "RAW_GNSS_FRESHNESS"
            ]
        );
        let diagnostic = progress.alignment_diagnostic.unwrap();
        assert_eq!(diagnostic.reason, "epoch-before-anchor");
        assert_eq!(diagnostic.measurement_relative_ns, "-54426294");
        assert_eq!(diagnostic.callback_elapsed_ms, 568);
        assert_eq!(diagnostic.trace_elapsed_ms, 574);
        assert_eq!(diagnostic.uncertainty_ns, 5_000_000.0);
        assert_eq!(
            trace, before,
            "No request, anchor, deadline, sample or counter mutation"
        );
        assert!(validate_trace(&trace, trace.ended_at_ms).is_err());
    }
}

#[test]
fn cached_low_satellite_discard_never_hides_malformed_future_overlap_or_later_events() {
    for mode in 0..9 {
        let mut trace = cached_low_satellite_startup();
        match mode {
            0 => trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].svid = 0,
            1 => trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].state = 1 << 25,
            2 => {
                trace.raw_gnss.as_mut().unwrap().epochs[0]
                    .clock
                    .elapsed_realtime_ns = "500600000000".into()
            }
            3 => {
                trace.raw_gnss.as_mut().unwrap().epochs[0]
                    .clock
                    .elapsed_realtime_ns = "499995000000".into()
            }
            4 => {
                trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].time_offset_ns =
                    49_426_294.0
            }
            5 => trace.raw_gnss.as_mut().unwrap().epochs[0].observed_elapsed_ms = 575,
            6 => trace.samples.push(raw_fixture().0.samples[0].clone()),
            7 => {
                trace.raw_gnss.as_mut().unwrap().epochs[0]
                    .clock
                    .elapsed_realtime_uncertainty_ns = 10_000_000.1
            }
            _ => {
                let cached = trace.raw_gnss.as_ref().unwrap().epochs[0].clone();
                let mut prior = raw_fixture().0.raw_gnss.unwrap().epochs.remove(0);
                prior.observed_elapsed_ms = 567;
                prior.clock.elapsed_realtime_ns = "500300000000".into();
                prior.clock.time_ns = "1000300000000".into();
                trace.raw_gnss.as_mut().unwrap().epochs = vec![prior, cached];
                trace.raw_gnss.as_mut().unwrap().epochs[1].sequence = 1;
            }
        }
        assert_eq!(disposition(&trace), Reject, "mode {mode}");
    }
}

#[test]
fn retained_cached_low_satellite_epoch_cannot_be_sealed_or_verified_even_when_signed() {
    use crate::location_proof::{cose, seal_with_signer, software_key};
    use p256::{
        ecdsa::{signature::Signer, Signature},
        pkcs8::EncodePublicKey,
    };

    let cached = cached_low_satellite_startup();
    let (mut fresh, identity, pin) = raw_fixture();
    fresh.request.policy = cached.request.policy.clone();
    let key = software_key(&identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let mut evidence =
        cose::make_evidence(&fresh, spki.as_bytes(), None, fresh.ended_at_ms).unwrap();
    evidence.trace.raw_gnss.as_mut().unwrap().epochs[0] =
        cached.raw_gnss.as_ref().unwrap().epochs[0].clone();
    assert!(seal_with_signer(
        &evidence.trace,
        spki.as_bytes(),
        None,
        fresh.ended_at_ms,
        |_| panic!("Invalid retained measurements must fail before invoking the signer")
    )
    .is_err());
    let forged = cose::sign_evidence(&evidence, |bytes| {
        let signature: Signature = key.sign(bytes);
        Ok(signature.to_bytes().to_vec())
    })
    .unwrap();
    let rejected = verify(&forged, &fresh.request, &pin, None, fresh.ended_at_ms).unwrap();
    assert!(
        rejected.checks.signature_integrity
            && rejected.checks.request_match
            && rejected.checks.device_match
    );
    assert!(!rejected.verified);
    let checks = rejected.raw_gnss.unwrap();
    assert!(!checks.collection_alignment_valid && !checks.satellite_count_valid && !checks.ready);
}

#[test]
fn short_requested_window_can_follow_twenty_seconds_of_startup_without_moving_anchor() {
    use crate::location_proof::{seal_with_signer, software_key};
    use p256::{
        ecdsa::{signature::Signer, Signature},
        pkcs8::EncodePublicKey,
    };

    let (mut trace, identity, pin) = raw_fixture();
    let mut startup = cached_low_satellite_startup();
    trace.request.policy = startup.request.policy.clone();
    startup.request = trace.request.clone();
    let original_request = trace.request.clone();
    let original_anchor = trace
        .raw_gnss
        .as_ref()
        .unwrap()
        .anchor_elapsed_realtime_ns
        .clone();
    let original_start = trace.started_at_ms;
    assert_eq!(disposition(&startup), DiscardStartup);
    // Acquisition may keep waiting for sufficient lock. Each rejected candidate
    // is excluded, and neither the challenge nor evidence duration is restarted.
    for elapsed in [1_000, 10_000, 19_000] {
        startup.elapsed_ms = elapsed;
        startup.ended_at_ms = startup.started_at_ms + elapsed;
        let raw = startup.raw_gnss.as_mut().unwrap();
        raw.rejected_epoch_count += 1;
        let epoch = &mut raw.epochs[0];
        epoch.observed_elapsed_ms = elapsed;
        epoch.clock.elapsed_realtime_ns = (500_000_000_000 + elapsed * 1_000_000).to_string();
        epoch.clock.time_ns = (1_000_000_000_000 + elapsed * 1_000_000).to_string();
        let progress = evaluate_raw_gnss_collection(&startup);
        assert_eq!(progress.collection_action, DiscardStartup);
        assert!(!progress.checks.ready);
    }
    for (index, sample) in trace.samples.iter_mut().enumerate() {
        let elapsed = 20_000 + index as u64 * 1_000;
        sample.observed_elapsed_ms = elapsed;
        sample.fix_elapsed_ms = Some(elapsed);
        sample.fix_timestamp_ms = trace.started_at_ms + elapsed;
    }
    let raw = trace.raw_gnss.as_mut().unwrap();
    raw.epochs.truncate(4);
    raw.rejected_epoch_count = startup.raw_gnss.as_ref().unwrap().rejected_epoch_count + 1;
    for (index, epoch) in raw.epochs.iter_mut().enumerate() {
        let elapsed = 20_000 + index as u64 * 1_000;
        epoch.observed_elapsed_ms = elapsed;
        epoch.clock.elapsed_realtime_ns = (500_000_000_000 + elapsed * 1_000_000).to_string();
        epoch.clock.time_ns = (1_000_000_000_000 + elapsed * 1_000_000).to_string();
        epoch.clock.elapsed_realtime_uncertainty_ns = 5_000_000.0;
        for measurement in &mut epoch.measurements {
            measurement.received_sv_time_ns =
                (uint(&measurement.received_sv_time_ns).unwrap() + 19_000_000_000).to_string();
        }
    }
    trace.elapsed_ms = 23_000;
    trace.ended_at_ms = trace.started_at_ms + trace.elapsed_ms;
    let progress = evaluate_raw_gnss_collection(&trace);
    assert_eq!(progress.collection_action, Retain);
    assert!(progress.checks.ready);
    let key = software_key(&identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let proof = seal_with_signer(&trace, spki.as_bytes(), None, trace.ended_at_ms, |bytes| {
        let signature: Signature = key.sign(bytes);
        Ok(signature.to_bytes().to_vec())
    })
    .unwrap();
    let verified = verify(&proof, &original_request, &pin, None, trace.ended_at_ms).unwrap();
    assert!(verified.verified, "{:?}", verified.errors);
    assert!(!verified.location_authenticity_proven && !verified.collection_attested);
    assert_eq!(trace.request, original_request);
    assert_eq!(trace.started_at_ms, original_start);
    assert_eq!(
        trace.raw_gnss.as_ref().unwrap().anchor_elapsed_realtime_ns,
        original_anchor
    );
    assert_eq!(trace.request.policy.duration_ms, 2_000);
    assert_eq!(
        trace.elapsed_ms, 23_000,
        "Requested evidence duration is not a completion deadline"
    );
}

#[test]
fn cached_startup_rule_never_hides_future_malformed_quality_or_established_trace_errors() {
    for mode in 0..10 {
        let mut trace = cached_startup(true);
        match mode {
            0 => {
                trace.raw_gnss.as_mut().unwrap().epochs[0]
                    .clock
                    .elapsed_realtime_ns = "501100000000".into()
            }
            1 => trace.raw_gnss.as_mut().unwrap().epochs[0].observed_elapsed_ms = 1001,
            2 => {
                trace.raw_gnss.as_mut().unwrap().epochs[0]
                    .clock
                    .elapsed_realtime_ns = "0499900000000".into()
            }
            3 => {
                trace.raw_gnss.as_mut().unwrap().epochs[0]
                    .clock
                    .elapsed_realtime_uncertainty_ns = 10_000_000.1
            }
            4 => trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].state = 1 << 25,
            5 => trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].svid = 0,
            6 => {
                trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].time_offset_ns =
                    200_000_000.0
            }
            7 => trace.samples.push(raw_fixture().0.samples[0].clone()),
            8 => trace.raw_gnss.as_mut().unwrap().rejected_epoch_count = 4096,
            _ => {
                let mut later = raw_fixture().0;
                later.samples.clear();
                later.raw_gnss.as_mut().unwrap().epochs.truncate(2);
                later.raw_gnss.as_mut().unwrap().epochs[1]
                    .clock
                    .elapsed_realtime_ns = "499900000000".into();
                trace = later;
            }
        }
        assert_eq!(disposition(&trace), Reject, "mode {mode}");
    }
}

#[test]
fn signed_proof_after_cached_startup_keeps_anchor_but_retaining_cached_epoch_still_fails() {
    use crate::location_proof::{cose, software_key};
    use p256::{
        ecdsa::{signature::Signer, Signature},
        pkcs8::EncodePublicKey,
    };

    let (mut trace, identity, pin) = raw_fixture();
    let original = trace.request.clone();
    let anchor = trace
        .raw_gnss
        .as_ref()
        .unwrap()
        .anchor_elapsed_realtime_ns
        .clone();
    let mut cached = trace.clone();
    cached.samples.clear();
    cached.raw_gnss.as_mut().unwrap().epochs.truncate(1);
    cached.raw_gnss.as_mut().unwrap().epochs[0]
        .clock
        .elapsed_realtime_ns = "499900000000".into();
    cached.elapsed_ms = 1_000;
    cached.ended_at_ms = cached.started_at_ms + cached.elapsed_ms;
    assert_eq!(disposition(&cached), DiscardStartup);

    // The native adapter increments the diagnostic counter after removing the
    // candidate. Fresh retained measurements still cover the original window.
    trace.raw_gnss.as_mut().unwrap().rejected_epoch_count += 1;
    let proof = sealed(&trace, &identity, None);
    let valid = verify(&proof, &original, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(valid.verified && valid.raw_gnss.as_ref().unwrap().ready);
    assert_eq!(trace.request, original);
    assert_eq!(
        trace.raw_gnss.as_ref().unwrap().anchor_elapsed_realtime_ns,
        anchor
    );

    let key = software_key(&identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let mut bad = cose::make_evidence(&trace, spki.as_bytes(), None, (NOW + 12) * 1000).unwrap();
    bad.trace.raw_gnss.as_mut().unwrap().epochs[0] =
        cached.raw_gnss.as_ref().unwrap().epochs[0].clone();
    assert!(validate_trace(&bad.trace, (NOW + 12) * 1000).is_err());
    let forged = cose::sign_evidence(&bad, |bytes| {
        let signature: Signature = key.sign(bytes);
        Ok(signature.to_bytes().to_vec())
    })
    .unwrap();
    let rejected = verify(&forged, &original, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(rejected.checks.signature_integrity && rejected.checks.request_match);
    assert!(
        !rejected.verified
            && !rejected
                .raw_gnss
                .as_ref()
                .unwrap()
                .collection_alignment_valid
    );
}

#[test]
fn startup_clock_uncertainty_is_excluded_without_evidence_credit() {
    for field in 0..3 {
        let mut t = startup();
        let clock = &mut t.raw_gnss.as_mut().unwrap().epochs[0].clock;
        match field {
            0 => clock.bias_uncertainty_ns = Some(100_001.0),
            1 => clock.time_uncertainty_ns = Some(100_001.0),
            _ => clock.elapsed_realtime_uncertainty_ns = 100_001.0,
        }
        let before = t.clone();
        let progress = evaluate_raw_gnss_collection(&t);
        assert_eq!(progress.collection_action, DiscardStartup);
        assert!(!progress.checks.ready && !progress.checks.clock_fields_valid);
        assert!(validate_trace(&t, t.ended_at_ms).is_err());
        assert_eq!(t, before);
    }
    let mut boundary = startup();
    boundary.raw_gnss.as_mut().unwrap().epochs[0]
        .clock
        .elapsed_realtime_uncertainty_ns = 100_000.0;
    assert_eq!(disposition(&boundary), Retain);
}

#[test]
fn malformed_clock_and_present_signal_fields_cannot_be_hidden_as_warmup() {
    for mode in 0..10 {
        let mut t = startup();
        let epoch = &mut t.raw_gnss.as_mut().unwrap().epochs[0];
        epoch.clock.elapsed_realtime_uncertainty_ns = 100_001.0;
        match mode {
            0 => epoch.clock.bias_uncertainty_ns = Some(-1.0),
            1 => epoch.clock.time_uncertainty_ns = Some(f64::NAN),
            2 => epoch.clock.elapsed_realtime_uncertainty_ns = f64::INFINITY,
            3 => epoch.clock.full_bias_ns = "+123".into(),
            4 => epoch.clock.drift_ns_per_second = Some(1e10),
            5 => epoch.measurements[0].code_type = Some("bad-code".into()),
            6 => epoch.measurements[0].received_sv_time_ns = "-1".into(),
            7 => epoch.measurements[0] = epoch.measurements[1].clone(),
            8 => epoch.measurements[0].svid = 0,
            _ => epoch.measurements[0].state = 1 << 25,
        }
        assert_eq!(disposition(&t), Reject, "mode {mode}");
    }
}

#[test]
fn satellite_startup_shortage_remains_excluded_but_later_loss_is_fatal() {
    for mode in 0..3 {
        let mutate = |m: &mut crate::location_proof::RawGnssMeasurement| match mode {
            0 => m.state = 0,
            1 => m.received_sv_time_uncertainty_ns = "100001".into(),
            _ => m.pseudorange_rate_uncertainty_mps = 21.0,
        };
        let mut t = startup();
        mutate(&mut t.raw_gnss.as_mut().unwrap().epochs[0].measurements[0]);
        assert_eq!(disposition(&t), DiscardStartup);
        let (mut established, _, _) = raw_fixture();
        mutate(&mut established.raw_gnss.as_mut().unwrap().epochs[1].measurements[0]);
        assert_eq!(disposition(&established), Reject);
    }
}

#[test]
fn uncertainty_after_first_admission_never_restarts_collection() {
    let (mut t, _, _) = raw_fixture();
    t.samples.clear();
    t.raw_gnss.as_mut().unwrap().epochs.truncate(2);
    t.raw_gnss.as_mut().unwrap().epochs[1]
        .clock
        .elapsed_realtime_uncertainty_ns = 100_001.0;
    assert_eq!(disposition(&t), Reject);
    let (original, _, _) = raw_fixture();
    let mut first = startup();
    first.samples.push(original.samples[0].clone());
    first.raw_gnss.as_mut().unwrap().epochs[0]
        .clock
        .elapsed_realtime_uncertainty_ns = 100_001.0;
    assert_eq!(disposition(&first), Reject);
}

#[test]
fn startup_cannot_hide_expiry_clock_alignment_source_or_shape_errors() {
    for mode in 0..11 {
        let mut t = startup();
        t.raw_gnss.as_mut().unwrap().epochs[0]
            .clock
            .elapsed_realtime_uncertainty_ns = 100_001.0;
        match mode {
            0 => t.ended_at_ms = t.request.challenge.expires_at * 1000,
            1 => t.started_at_ms = t.request.challenge.issued_at * 1000 - 1,
            2 => t.elapsed_ms = 60_001,
            3 => t.raw_gnss.as_mut().unwrap().rejected_epoch_count = 4096,
            4 => t.raw_gnss.as_mut().unwrap().epochs[0].sequence = 1,
            5 => t.raw_gnss.as_mut().unwrap().epochs[0].observed_elapsed_ms = 999,
            6 => t.raw_gnss.as_mut().unwrap().anchor_elapsed_realtime_ns = "600000000000".into(),
            7 => t.profile = "software-browser".into(),
            8 => t.request.policy.duration_ms = 1,
            9 => t.ended_at_ms += 1001,
            _ => t.raw_gnss.as_mut().unwrap().epochs[0].measurements.clear(),
        }
        assert_eq!(disposition(&t), Reject, "mode {mode}");
    }
}

#[test]
fn actual_signed_trace_after_warmup_retains_original_request_anchor_and_full_span() {
    let (mut t, identity, pin) = raw_fixture();
    let original = t.request.clone();
    let anchor = t
        .raw_gnss
        .as_ref()
        .unwrap()
        .anchor_elapsed_realtime_ns
        .clone();
    t.raw_gnss.as_mut().unwrap().rejected_epoch_count = 3;
    assert_eq!(disposition(&t), Retain);
    let proof = sealed(&t, &identity, None);
    let verified = verify(&proof, &original, &pin, None, (NOW + 12) * 1000).unwrap();
    assert!(verified.verified && verified.raw_gnss.unwrap().ready);
    assert_eq!(t.request, original);
    assert_eq!(
        t.raw_gnss.as_ref().unwrap().anchor_elapsed_realtime_ns,
        anchor
    );
    assert_eq!(t.raw_gnss.as_ref().unwrap().rejected_epoch_count, 3);
    assert_eq!(
        t.samples.last().unwrap().fix_elapsed_ms.unwrap() - t.samples[0].fix_elapsed_ms.unwrap(),
        10000
    );
    // Keeping a rejected startup epoch in that otherwise valid signed window is forbidden.
    t.raw_gnss.as_mut().unwrap().epochs[0]
        .clock
        .elapsed_realtime_uncertainty_ns = 100_001.0;
    assert!(validate_trace(&t, (NOW + 12) * 1000).is_err());
    assert_eq!(disposition(&t), Reject);
}

#[test]
fn collection_progress_is_additive_and_missing_raw_cannot_be_retained() {
    let t = startup();
    let report = serde_json::to_value(evaluate_raw_gnss_collection(&t)).unwrap();
    assert_eq!(report["collection_action"], "retain");
    assert_eq!(report["ready"], false);
    assert_eq!(report["clock_fields_valid"], true);
    assert!(report.get("alignment_diagnostic").is_none());
    let mut missing = t;
    missing.raw_gnss = None;
    assert_eq!(disposition(&missing), Reject);
    missing.request.policy.raw_gnss = None;
    assert_eq!(disposition(&missing), Reject);
}

fn explicit_startup() -> Trace {
    let mut trace = startup();
    trace
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = Some(10_000_000.0);
    trace.raw_gnss.as_mut().unwrap().epochs[0]
        .clock
        .elapsed_realtime_uncertainty_ns = 5_000_000.0;
    trace
}

#[test]
fn unsigned_alignment_diagnostic_distinguishes_future_anchor_and_delivery_failures() {
    let cases = [
        (1_100_000_000_u64, 1000, 0.0, "epoch-after-callback"),
        (4_000_000, 1000, 0.0, "epoch-uncertainty-before-anchor"),
        (5_000_000, 1000, 0.0, "epoch-uncertainty-at-anchor"),
        (100_000_000, 300, -100_000_000.0, "signal-before-anchor"),
        (1_000_000_000, 1000, 1_000_000.0, "signal-after-callback"),
        (1_000_000_000, 3995, 0.0, "epoch-delivery-budget"),
        (1_000_000_000, 3993, -1_000_000.01, "signal-delivery-budget"),
    ];
    for (relative_ns, callback_ms, offset, reason) in cases {
        let mut trace = explicit_startup();
        trace.elapsed_ms = callback_ms;
        trace.ended_at_ms = trace.started_at_ms + callback_ms;
        let epoch = &mut trace.raw_gnss.as_mut().unwrap().epochs[0];
        epoch.clock.elapsed_realtime_ns = (500_000_000_000 + relative_ns).to_string();
        epoch.observed_elapsed_ms = callback_ms;
        epoch.measurements[0].time_offset_ns = offset;
        let before = serde_json::to_vec(&trace).unwrap();
        let checks = serde_json::to_value(evaluate_raw_gnss(&trace)).unwrap();
        let mut progress = serde_json::to_value(evaluate_raw_gnss_collection(&trace)).unwrap();
        assert_eq!(progress["collection_action"], "reject", "{reason}");
        assert_eq!(progress["collection_alignment_valid"], false);
        let diagnostic = progress
            .as_object_mut()
            .unwrap()
            .remove("alignment_diagnostic")
            .unwrap();
        assert_eq!(diagnostic["unsigned"], true);
        assert_eq!(diagnostic["epoch_sequence"], 0);
        assert_eq!(diagnostic["reason"], reason);
        assert_eq!(
            diagnostic["measurement_relative_ns"],
            relative_ns.to_string()
        );
        assert_eq!(diagnostic["callback_elapsed_ms"], callback_ms);
        assert_eq!(diagnostic["trace_elapsed_ms"], callback_ms);
        assert_eq!(diagnostic["uncertainty_ns"], 5_000_000.0);
        assert_eq!(diagnostic["signal_offset_min_ns"], offset.min(0.0));
        assert_eq!(diagnostic["signal_offset_max_ns"], offset.max(0.0));
        let summary = diagnostic["summary"].as_str().unwrap();
        assert!(summary.is_ascii() && summary.len() <= 240);
        assert!(summary.contains(reason));
        assert!(summary.contains(&format!("dt={relative_ns}ns")));
        // Additive local status must not change proof checks or serialized evidence.
        progress
            .as_object_mut()
            .unwrap()
            .remove("collection_action");
        assert_eq!(progress, checks);
        assert_eq!(serde_json::to_vec(&trace).unwrap(), before);
        assert!(!checks
            .as_object()
            .unwrap()
            .contains_key("alignment_diagnostic"));
        if reason == "signal-before-anchor" {
            assert_eq!(checks["freshness_valid"], true);
            assert_eq!(
                checks["error_codes"],
                serde_json::json!([
                    "RAW_GNSS_EPOCH_COUNT",
                    "RAW_GNSS_ALIGNMENT",
                    "RAW_GNSS_COVERAGE"
                ])
            );
        }
    }
}

#[test]
fn alignment_diagnostic_preserves_signed_integer_precision_and_first_failure() {
    for explicit in [false, true] {
        let trace = cached_startup(explicit);
        let report = serde_json::to_value(evaluate_raw_gnss_collection(&trace)).unwrap();
        assert_eq!(
            report["alignment_diagnostic"]["measurement_relative_ns"],
            "-100000000"
        );
        assert_eq!(
            report["alignment_diagnostic"]["reason"],
            "epoch-before-anchor"
        );
        assert_eq!(report["collection_action"], "discard-startup");
    }
    let (mut trace, _, _) = raw_fixture();
    let raw = trace.raw_gnss.as_mut().unwrap();
    // Both fail; report only the first failing candidate, without f64 conversion.
    raw.epochs[1].clock.elapsed_realtime_ns =
        (500_000_000_000_u64 + 9_007_199_254_740_993).to_string();
    raw.epochs[2].clock.elapsed_realtime_ns = "499900000000".into();
    let report = serde_json::to_value(evaluate_raw_gnss_collection(&trace)).unwrap();
    assert_eq!(report["alignment_diagnostic"]["epoch_sequence"], 1);
    assert_eq!(
        report["alignment_diagnostic"]["measurement_relative_ns"],
        "9007199254740993"
    );
    assert_eq!(
        report["alignment_diagnostic"]["reason"],
        "epoch-after-callback"
    );
    assert_eq!(report["collection_action"], "reject");
}

#[test]
fn malformed_diagnostic_values_are_omitted_without_changing_rejection() {
    for mode in 0..6 {
        let mut trace = explicit_startup();
        let epoch = &mut trace.raw_gnss.as_mut().unwrap().epochs[0];
        epoch.clock.elapsed_realtime_ns = "501100000000".into();
        match mode {
            0 => epoch.clock.elapsed_realtime_uncertainty_ns = f64::NAN,
            1 => epoch.measurements[0].time_offset_ns = f64::INFINITY,
            2 => epoch.clock.elapsed_realtime_ns = "0501100000000".into(),
            3 => epoch.measurements.clear(),
            4 => epoch.observed_elapsed_ms = u64::MAX,
            _ => trace.elapsed_ms = u64::MAX,
        }
        let report = serde_json::to_value(evaluate_raw_gnss_collection(&trace)).unwrap();
        assert_eq!(report["collection_action"], "reject");
        assert!(report.get("alignment_diagnostic").is_none(), "mode {mode}");
    }
}

#[test]
fn unordered_signal_offsets_still_fail_alignment_in_both_policy_modes() {
    for explicit in [false, true] {
        for (offset, reason) in [
            (f64::NAN, "signal-before-anchor"),
            (f64::NEG_INFINITY, "signal-before-anchor"),
            (f64::INFINITY, "signal-after-callback"),
        ] {
            let mut trace = if explicit {
                explicit_startup()
            } else {
                startup()
            };
            trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[0].time_offset_ns = offset;
            let raw = trace.raw_gnss.as_ref().unwrap();
            assert_eq!(
                timing::alignment_error(
                    &trace,
                    &raw.epochs[0],
                    500_000_000_000,
                    trace.request.policy.raw_gnss.as_ref().unwrap()
                ),
                Some(reason)
            );
            let report = evaluate_raw_gnss_collection(&trace);
            assert!(!report.checks.collection_alignment_valid);
            assert_eq!(report.collection_action, Reject);
            assert!(report.alignment_diagnostic.is_none());
        }
    }
}

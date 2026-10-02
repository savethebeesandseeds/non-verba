// SPDX-License-Identifier: AGPL-3.0-only
//! Synthetic reference observations produced by pinned, unmodified RTKLIB,
//! independently from the implementation under test. No physical trust claim.
use super::*;
use crate::location_proof::{self as location, Trace};
use p256::{
    ecdsa::{signature::Signer, Signature},
    pkcs8::EncodePublicKey,
};
use serde_json::{json, Value};

const REFERENCE: &str = include_str!("rtklib-reference.json");
struct Fixture {
    trace: Trace,
    identity: String,
    pin: String,
    nav: Navigation,
    policy: PositionPolicy,
    reference: Value,
}
fn fixture() -> Fixture {
    fixture_from(REFERENCE)
}
fn fixture_from(reference_json: &str) -> Fixture {
    let reference: Value = serde_json::from_str(reference_json).unwrap();
    let nav: Navigation = serde_json::from_value(json!({
        "version": 1, "type": "nonverba-gps-lnav",
        "source": {"id": reference["reference"], "sha256": hash(reference_json.as_bytes())},
        "ionosphere": reference["ionosphere"], "ephemerides": reference["ephemerides"]
    }))
    .unwrap();
    let mut trace = location::parse_trace(include_str!("../raw_gnss_fixture.json")).unwrap();
    let week = reference["gps_week"].as_u64().unwrap();
    let first_tow_ms = (reference["epochs"][0]["true_receive_tow_s"]
        .as_f64()
        .unwrap()
        * 1000.0)
        .round() as u64;
    let start = (315_964_800 + week * 604_800 - 18) * 1000 + first_tow_ms - 1000;
    trace.request = location::parse_request(
        &location::create_location_request(
            "RTKLIB synthetic fixture",
            "Synthetic mathematical validation only",
            (start / 1000 - 1) as f64,
            900,
            &serde_json::to_string(&trace.request.policy).unwrap(),
            "null",
        )
        .unwrap(),
    )
    .unwrap();
    trace.started_at_ms = start;
    trace.ended_at_ms = start + trace.elapsed_ms;
    for s in &mut trace.samples {
        s.fix_timestamp_ms = start + s.observed_elapsed_ms;
        s.altitude_m = Some(120.0);
    }
    for (epoch, source) in trace
        .raw_gnss
        .as_mut()
        .unwrap()
        .epochs
        .iter_mut()
        .zip(reference["epochs"].as_array().unwrap())
    {
        let tow_ns = (source["true_receive_tow_s"].as_f64().unwrap() * 1e9).round() as i128;
        let fractional_bias = source["receiver_clock_bias_ns"].as_f64().unwrap();
        let gps_ns =
            (week * 604_800) as i128 * 1_000_000_000 + tow_ns + fractional_bias.round() as i128;
        let hardware = epoch.clock.time_ns.parse::<i128>().unwrap();
        epoch.clock.full_bias_ns = (hardware - gps_ns).to_string();
        epoch.clock.bias_ns = Some(fractional_bias.round() - fractional_bias);
        epoch.clock.drift_ns_per_second = Some(0.0);
        let template = epoch.measurements[0].clone();
        epoch.measurements = source["satellites"]
            .as_array()
            .unwrap()
            .iter()
            .map(|sat| {
                let mut m = template.clone();
                m.svid = sat["svid"].as_u64().unwrap() as u16;
                m.received_sv_time_ns = sat["sv_time_tow_ns"].as_str().unwrap().to_owned();
                m
            })
            .collect();
    }
    let identity = crate::create_identity().unwrap();
    let id: Value = serde_json::from_str(&location::location_identity(&identity).unwrap()).unwrap();
    let policy = PositionPolicy {
        version: 1,
        nav_sha256: hash(serde_json::to_string(&nav).unwrap().as_bytes()),
        gps_utc_offset_s: 18,
        min_satellites: 6,
        max_sv_time_uncertainty_ns: 100.0,
        max_pdop: 8.0,
        max_residual_m: 30.0,
        max_weighted_rms: 3.0,
        max_horizontal_difference_m: 10.0,
        max_vertical_difference_m: 10.0,
        max_match_interval_ms: 1000,
    };
    assert!(location::evaluate_raw_gnss(&trace).ready);
    Fixture {
        trace,
        identity,
        pin: id["fingerprint"].as_str().unwrap().into(),
        nav,
        policy,
        reference,
    }
}
fn seal(f: &Fixture) -> Vec<u8> {
    let key = location::software_key(&f.identity).unwrap();
    let spki = key.verifying_key().to_public_key_der().unwrap();
    location::seal_with_signer(
        &f.trace,
        spki.as_bytes(),
        None,
        f.trace.ended_at_ms,
        |bytes| {
            let sig: Signature = key.sign(bytes);
            Ok(sig.to_bytes().to_vec())
        },
    )
    .unwrap()
}
fn verify_bytes(f: &Fixture, proof: &[u8], request: &str, pin: &str, asset: &str) -> Value {
    serde_json::from_str(
        &verify_location_position(
            proof,
            request,
            pin,
            asset,
            &serde_json::to_string(&f.nav).unwrap(),
            &serde_json::to_string(&f.policy).unwrap(),
            (f.trace.ended_at_ms / 1000 + 1) as f64,
        )
        .unwrap(),
    )
    .unwrap()
}
fn report(f: &Fixture) -> Value {
    verify_bytes(
        f,
        &seal(f),
        &serde_json::to_string(&f.trace.request).unwrap(),
        &f.pin,
        "null",
    )
}
fn repin_nav(f: &mut Fixture) {
    f.policy.nav_sha256 = hash(serde_json::to_string(&f.nav).unwrap().as_bytes());
}
fn vector(value: &Value) -> [f64; 3] {
    std::array::from_fn(|i| value[i].as_f64().unwrap())
}
fn assert_positions(f: &Fixture, result: &Value, clock: f64) {
    assert_eq!(result["verified"], true, "{result:#}");
    for e in result["epochs"].as_array().unwrap() {
        assert!(
            orbit::norm(orbit::subtract(
                vector(&e["ecef_m"]),
                vector(&f.reference["receiver_ecef_m"])
            )) < 1.0,
            "{e:#}"
        );
        assert!(
            (e["receiver_clock_bias_m"].as_f64().unwrap() - clock).abs() < 1.0,
            "{e:#}"
        );
    }
}

#[test]
fn short_signed_raw_window_recomputes_each_epoch_against_pinned_navigation() {
    let mut f = fixture();
    f.trace.request.policy.duration_ms = 2_000;
    f.trace
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = Some(10_000_000.0);
    for (index, sample) in f.trace.samples.iter_mut().enumerate() {
        let elapsed = (index as u64 + 1) * 1_000;
        sample.fix_elapsed_ms = Some(elapsed);
        sample.observed_elapsed_ms = elapsed;
        sample.fix_timestamp_ms = f.trace.started_at_ms + elapsed;
    }
    let raw = f.trace.raw_gnss.as_mut().unwrap();
    raw.epochs.truncate(4);
    for epoch in &mut raw.epochs {
        epoch.clock.elapsed_realtime_uncertainty_ns = 5_000_000.0;
    }
    f.trace.elapsed_ms = 4_000;
    f.trace.ended_at_ms = f.trace.started_at_ms + f.trace.elapsed_ms;
    let result = report(&f);
    assert_positions(&f, &result, 75.0);
    assert_eq!(result["evidence_verified"], true);
    assert_eq!(result["nav_digest_match"], true);
    assert_eq!(result["independent_position_recomputed"], true);
    assert_eq!(result["epochs"].as_array().unwrap().len(), 4);
    assert_eq!(result["comparisons"].as_array().unwrap().len(), 3);
    for epoch in result["epochs"].as_array().unwrap() {
        assert!(epoch["satellites"].as_array().unwrap().len() >= 6);
    }
    for field in [
        "satellite_authentication_verified",
        "navigation_source_authenticated",
        "collection_attested",
        "physical_location_proven",
        "clock_trusted",
    ] {
        assert_eq!(result[field], false, "{field}");
    }
}

#[test]
fn independent_rtklib_orbits_clocks_atmosphere_and_range_agree() {
    let f = fixture();
    let llh = [47.4979_f64.to_radians(), 19.0402_f64.to_radians(), 120.0];
    let receiver = vector(&f.reference["receiver_ecef_m"]);
    for e in f.reference["epochs"].as_array().unwrap() {
        for s in e["satellites"].as_array().unwrap() {
            let ephemeris = f
                .nav
                .ephemerides
                .iter()
                .find(|n| u64::from(n.svid) == s["svid"].as_u64().unwrap())
                .unwrap();
            let (position, clock) =
                orbit::satellite(ephemeris, s["transmit_tow_s"].as_f64().unwrap()).unwrap();
            assert!(orbit::norm(orbit::subtract(position, vector(&s["ecef_m"]))) < 0.001);
            assert!((clock - s["satellite_clock_s"].as_f64().unwrap()).abs() < 1e-12);
            let (distance, line) = orbit::range(position, receiver);
            assert!((distance - s["geometric_range_m"].as_f64().unwrap()).abs() < 0.001);
            let (az, el) = orbit::azel(llh, line);
            assert!((az.to_degrees() - s["azimuth_deg"].as_f64().unwrap()).abs() < 1e-7);
            assert!((el.to_degrees() - s["elevation_deg"].as_f64().unwrap()).abs() < 1e-7);
            assert!(
                (orbit::ionosphere(
                    &f.nav.ionosphere,
                    e["true_receive_tow_s"].as_f64().unwrap(),
                    llh,
                    az,
                    el
                ) - s["ionosphere_m"].as_f64().unwrap())
                .abs()
                    < 1e-5
            );
            assert!(
                (orbit::troposphere(llh, el) - s["troposphere_m"].as_f64().unwrap()).abs() < 1e-5
            );
        }
    }
}

#[test]
fn independently_generated_observations_solve_all_signed_epochs_without_trusting_claims() {
    let f = fixture();
    let result = report(&f);
    assert_positions(&f, &result, 75.0);
    assert_eq!(result["epochs"].as_array().unwrap().len(), 11);
    assert_eq!(result["comparisons"].as_array().unwrap().len(), 3);
    for flag in [
        "satellite_authentication_verified",
        "navigation_source_authenticated",
        "physical_location_proven",
        "collection_attested",
        "clock_trusted",
    ] {
        assert_eq!(result[flag], false);
    }
    assert_eq!(
        result["location_verification"]["raw_gnss"]["independent_position_recomputed"],
        false
    );
}

#[test]
fn signature_original_request_pin_and_asset_are_rechecked() {
    let f = fixture();
    let proof = seal(&f);
    let request = serde_json::to_string(&f.trace.request).unwrap();
    let mut altered = proof.clone();
    let last = altered.len() - 1;
    altered[last] ^= 1;
    let mut other = f.trace.request.clone();
    other.challenge.task.push_str(" altered");
    let asset = json!({"kind": "image/jpeg", "sha256": "0".repeat(64)}).to_string();
    for (bytes, req, pin, expected_asset) in [
        (altered.as_slice(), request.clone(), f.pin.clone(), "null"),
        (
            proof.as_slice(),
            serde_json::to_string(&other).unwrap(),
            f.pin.clone(),
            "null",
        ),
        (proof.as_slice(), request.clone(), "0".repeat(64), "null"),
        (
            proof.as_slice(),
            request.clone(),
            f.pin.clone(),
            asset.as_str(),
        ),
    ] {
        let r = verify_bytes(&f, bytes, &req, &pin, expected_asset);
        assert_eq!(r["evidence_verified"], false);
        assert_eq!(r["verified"], false);
        assert!(r["epochs"].as_array().unwrap().is_empty());
    }
}

#[test]
fn altered_coordinates_and_antipodal_claims_cannot_seed_or_fool_solution() {
    for antipodal in [false, true] {
        let mut f = fixture();
        for s in &mut f.trace.samples {
            s.latitude = if antipodal { -47.4979 } else { 48.0 };
            s.longitude = if antipodal { 19.0402 - 180.0 } else { 20.0 };
        }
        let r = report(&f);
        assert_eq!(r["evidence_verified"], true);
        assert_eq!(r["independent_position_recomputed"], true);
        assert_eq!(r["consistency_passed"], true);
        assert_eq!(r["reported_location_consistent"], false);
        assert_eq!(r["verified"], false);
        assert!(
            r["comparisons"][0]["horizontal_difference_m"]
                .as_f64()
                .unwrap()
                > 10_000.0
        );
    }
}

#[test]
fn independent_navigation_pin_health_age_and_expanded_week_are_required() {
    for mode in 0..6 {
        let mut f = fixture();
        for e in &mut f.nav.ephemerides {
            match mode {
                0 => e.af0_s += 1e-5,
                1 => e.health = 1,
                2 => e.toe_s -= 10_000.0,
                3 => e.gps_week -= 1024,
                4 => e.transmission_tow_s = 100_200.0,
                _ => e.toc_s -= 10_000.0,
            }
        }
        if mode != 0 {
            repin_nav(&mut f);
        }
        let r = report(&f);
        assert_eq!(r["verified"], false, "mode {mode}: {r:#}");
        assert_eq!(r["independent_position_recomputed"], false);
        assert_eq!(r["nav_digest_match"], mode != 0);
    }
}

#[test]
fn one_bad_epoch_outlier_fails_without_residual_based_satellite_removal() {
    let mut f = fixture();
    let m = &mut f.trace.raw_gnss.as_mut().unwrap().epochs[5].measurements[0];
    m.received_sv_time_ns = (m.received_sv_time_ns.parse::<u64>().unwrap() + 10_000).to_string();
    let r = report(&f);
    assert_eq!(r["evidence_verified"], true);
    assert_eq!(r["verified"], false);
    assert_eq!(r["epochs"][4]["consistency_passed"], true);
    assert_eq!(r["epochs"][5]["consistency_passed"], false);
    assert_eq!(r["epochs"][5]["satellites"].as_array().unwrap().len(), 9);
}

#[test]
fn raw_readiness_is_not_enough_for_position_satellite_signal_and_uncertainty_policy() {
    for mode in 0..4 {
        let mut f = fixture();
        for epoch in &mut f.trace.raw_gnss.as_mut().unwrap().epochs {
            match mode {
                0 => epoch.measurements.truncate(5),
                1 => {
                    for m in &mut epoch.measurements {
                        m.code_type = None;
                    }
                }
                2 => {
                    for m in &mut epoch.measurements {
                        m.carrier_frequency_hz = Some(1_176_450_000.0);
                    }
                }
                _ => {
                    for m in &mut epoch.measurements {
                        m.received_sv_time_uncertainty_ns = "101".into();
                    }
                }
            }
        }
        assert!(location::evaluate_raw_gnss(&f.trace).ready);
        let r = report(&f);
        assert_eq!(r["evidence_verified"], true);
        assert_eq!(r["independent_position_recomputed"], false, "mode {mode}");
        assert_eq!(r["verified"], false);
    }
}

#[test]
fn rank_deficient_geometry_and_strict_pdop_policy_fail_closed() {
    let mut f = fixture();
    let template = f.nav.ephemerides[0].clone();
    for e in &mut f.nav.ephemerides {
        let svid = e.svid;
        *e = template.clone();
        e.svid = svid;
    }
    repin_nav(&mut f);
    for e in &mut f.trace.raw_gnss.as_mut().unwrap().epochs {
        let time = e.measurements[0].received_sv_time_ns.clone();
        for m in &mut e.measurements {
            m.received_sv_time_ns = time.clone();
        }
    }
    let r = report(&f);
    assert_eq!(r["verified"], false);
    assert_eq!(r["independent_position_recomputed"], false);
    let mut f = fixture();
    f.policy.max_pdop = 1.0;
    let r = report(&f);
    assert_eq!(r["independent_position_recomputed"], true);
    assert_eq!(r["consistency_passed"], false);
}

#[test]
fn common_receiver_bias_is_fitted_but_gps_wall_time_disagreement_is_rejected() {
    let mut f = fixture();
    for epoch in &mut f.trace.raw_gnss.as_mut().unwrap().epochs {
        *epoch.clock.bias_ns.as_mut().unwrap() -= 1000.0;
    }
    assert_positions(&f, &report(&f), 75.0 + orbit::C * 1e-6);
    f.policy.gps_utc_offset_s = 0;
    let r = report(&f);
    assert_eq!(r["verified"], false);
    assert_eq!(r["independent_position_recomputed"], false);
}

#[test]
fn android_measurement_time_offset_is_added_not_subtracted() {
    let mut f = fixture();
    for epoch in &mut f.trace.raw_gnss.as_mut().unwrap().epochs {
        for (i, m) in epoch.measurements.iter_mut().enumerate() {
            let offset = if i % 2 == 0 { 1000_i64 } else { -1000_i64 };
            m.time_offset_ns = offset as f64;
            m.received_sv_time_ns =
                (m.received_sv_time_ns.parse::<i64>().unwrap() + offset).to_string();
        }
    }
    assert_positions(&f, &report(&f), 75.0);
}

#[test]
fn navigation_and_policy_inputs_reject_unknown_fields_duplicates_and_size_overflow() {
    let mut f = fixture();
    f.nav.ephemerides.push(f.nav.ephemerides[0].clone());
    assert!(validate_nav(&f.nav).is_err());
    f.nav.ephemerides.last_mut().unwrap().iode = 100;
    f.nav.ephemerides.last_mut().unwrap().iodc = 100;
    assert!(
        validate_nav(&f.nav).is_err(),
        "conflicting ephemeris at same SV and epoch"
    );
    f = fixture();
    f.policy.min_satellites = 4;
    assert!(validate_policy(&f.policy).is_err());
    f.policy.min_satellites = 6;
    f.policy.max_residual_m = f64::NAN;
    assert!(validate_policy(&f.policy).is_err());
    assert!(parse::<Navigation>(&" ".repeat(MAX_NAV_BYTES + 1), MAX_NAV_BYTES).is_err());
    let mut nav = serde_json::to_value(&f.nav).unwrap();
    nav["trusted"] = json!(true);
    assert!(parse::<Navigation>(&nav.to_string(), MAX_NAV_BYTES).is_err());
}

#[test]
fn ephemeris_selection_handles_week_rollover_without_modulo_1024_ambiguity() {
    let mut f = fixture();
    let e = &mut f.nav.ephemerides[0];
    e.toe_s = 604_790.0;
    e.toc_s = e.toe_s;
    e.transmission_tow_s = 604_700.0;
    assert!(orbit::select_signal(&f.nav, 1, 2201, 0.02)
        .unwrap()
        .is_some());
    assert!(orbit::select_signal(&f.nav, 1, 1177, 0.02)
        .unwrap()
        .is_none());
    assert!((orbit::week_delta(0.02 - 604_799.95) - 0.07).abs() < 1e-9);
    assert!((orbit::week_delta(604_799.95 - 0.02) + 0.07).abs() < 1e-9);
}

#[test]
fn signal_clock_correction_is_applied_before_all_ephemeris_age_boundaries() {
    let mut f = fixture();
    f.nav.ephemerides.truncate(1);
    let e = &mut f.nav.ephemerides[0];
    // Circular orbit and constant clock make the boundary independent of
    // Kepler/relativity and iteration roundoff. Exercise both correction signs.
    e.e = 0.0;
    e.af1_s_s = 0.0;
    e.af2_s_s2 = 0.0;
    e.tgd_s = 0.0;
    for correction in [-0.01, 0.01] {
        f.nav.ephemerides[0].af0_s = correction;
        for (toe, toc, transmission, boundary, upper) in [
            (100_000.0, 100_000.0, 99_900.0, 99_900.0, false),
            (100_000.0, 100_000.0, 99_900.0, 107_200.0, true),
            (100_000.0, 99_999.0, 99_900.0, 107_199.0, true),
            (100_000.0, 100_000.0, 90_000.0, 104_400.0, true),
            (100_000.0, 100_000.0, 92_000.0, 92_800.0, false),
        ] {
            let e = &mut f.nav.ephemerides[0];
            e.toe_s = toe;
            e.toc_s = toc;
            e.transmission_tow_s = transmission;
            for (gps_offset, admitted) in [(-0.002, upper), (0.002, !upper)] {
                let signal = boundary + gps_offset + correction;
                let selected = orbit::select_signal(&f.nav, 1, 2200, signal).unwrap();
                assert_eq!(selected.is_some(), admitted,
                    "boundary={boundary}, upper={upper}, correction={correction}, offset={gps_offset}");
            }
        }
    }
}

#[test]
fn insufficient_satellite_and_parse_failures_retain_exclusion_reasons() {
    let mut f = fixture();
    let raw = f.trace.raw_gnss.as_mut().unwrap();
    let epoch = &mut raw.epochs[0];
    epoch.measurements[0].code_type = Some("UNKNOWN".into());
    epoch.measurements[1].received_sv_time_uncertainty_ns = "101".into();
    let missing = epoch.measurements[2].svid;
    f.nav.ephemerides.retain(|e| e.svid != missing);
    epoch.measurements[3].cn0_dbhz = 17.0;
    let raw = f.trace.raw_gnss.as_ref().unwrap();
    let result = solve::epoch(&f.trace, raw, &raw.epochs[0], &f.nav, &f.policy);
    assert!(!result.computed);
    assert_eq!(result.excluded.len(), 4);
    for reason in ["not identified", "uncertainty", "no healthy", "C/N0"] {
        assert!(
            result.excluded.iter().any(|v| v.contains(reason)),
            "{result:?}"
        );
    }
    assert!(result.errors[0].contains("Only 5 usable"));
    f.trace.raw_gnss.as_mut().unwrap().epochs[0].measurements[4].received_sv_time_ns = "bad".into();
    let raw = f.trace.raw_gnss.as_ref().unwrap();
    let result = solve::epoch(&f.trace, raw, &raw.epochs[0], &f.nav, &f.policy);
    assert!(!result.computed);
    assert_eq!(result.excluded.len(), 4);
    assert!(!result.errors.is_empty());
}

#[test]
fn every_fix_must_match_both_the_position_and_a_nearby_solution_epoch() {
    for vertical in [false, true] {
        let mut f = fixture();
        if vertical {
            f.trace.samples[1].altitude_m = Some(140.0);
        } else {
            f.policy.max_match_interval_ms = 100;
            f.trace.samples[1].fix_elapsed_ms = Some(5500);
            f.trace.samples[1].fix_timestamp_ms -= 500;
        }
        let r = report(&f);
        assert_eq!(r["evidence_verified"], true, "{r:#}");
        assert_eq!(r["independent_position_recomputed"], true);
        assert_eq!(r["consistency_passed"], true);
        assert_eq!(r["comparisons"][0]["passed"], true);
        assert_eq!(r["comparisons"][1]["passed"], false);
        assert_eq!(r["comparisons"][2]["passed"], true);
        assert_eq!(r["reported_location_consistent"], false);
        assert_eq!(r["verified"], false);
    }
}

#[test]
fn duplicate_l1_observations_cannot_supply_residual_redundancy() {
    let mut f = fixture();
    for epoch in &mut f.trace.raw_gnss.as_mut().unwrap().epochs {
        let mut duplicate = epoch.measurements[0].clone();
        // Distinct signal identity for the raw collector, still the same GPS
        // satellite and selected L1 C/A observable for this position profile.
        *duplicate.carrier_frequency_hz.as_mut().unwrap() += 1.0;
        epoch.measurements.push(duplicate);
    }
    assert!(location::evaluate_raw_gnss(&f.trace).ready);
    let r = report(&f);
    assert_eq!(r["evidence_verified"], true);
    assert_eq!(r["independent_position_recomputed"], false);
    assert_eq!(r["verified"], false);
    assert!(r["epochs"][0]["errors"][0]
        .as_str()
        .unwrap()
        .contains("Duplicate"));
}

#[test]
fn pseudorange_and_clock_bias_work_across_the_satellite_week_boundary() {
    // Independent RTKLIB observations received 20 ms into the GPS week,
    // initially transmitted before rollover, with previous-week ephemerides.
    let f = fixture_from(include_str!("rtklib-rollover-reference.json"));
    assert!(
        f.trace.raw_gnss.as_ref().unwrap().epochs[0].measurements[0]
            .received_sv_time_ns
            .parse::<u64>()
            .unwrap()
            > 604_799_000_000_000
    );
    assert_positions(&f, &report(&f), 75.0);
}
pub(super) fn reference_bundle() -> Value {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let f = fixture();
    json!({
        "synthetic": true,
        "proof_b64": STANDARD.encode(seal(&f)),
        "original_request": f.trace.request,
        "expected_pin": f.pin,
        "expected_asset": null,
        "navigation_json": serde_json::to_string(&f.nav).unwrap(),
        "policy": f.policy,
        "now_secs": f.trace.ended_at_ms/1000+1
    })
}

#[test]
fn retained_empty_code_never_supplies_gps_l1_position_credit() {
    let mut f = fixture();
    let epoch = &mut f.trace.raw_gnss.as_mut().unwrap().epochs[0];
    epoch.measurements.truncate(f.policy.min_satellites);
    epoch.measurements[0].code_type = Some(String::new());
    // Five identified SVs satisfy the raw profile, but cannot supply six L1 SVs.
    assert!(location::evaluate_raw_gnss(&f.trace).ready);
    let raw = f.trace.raw_gnss.as_ref().unwrap();
    let result = solve::epoch(&f.trace, raw, &raw.epochs[0], &f.nav, &f.policy);
    assert!(!result.computed);
    assert!(result
        .excluded
        .iter()
        .any(|reason| reason.contains("not identified GPS L1 C/A")));
    assert!(result
        .errors
        .iter()
        .any(|reason| reason.contains("Only 5 usable")));
    assert_eq!(raw.epochs[0].measurements[0].code_type.as_deref(), Some(""));
}

/// Keep the requested observation duration inside the explicit endpoint budget.
/// This fixture is signed synthetic RTKLIB data, never physical GPS evidence.
fn explicit_elapsed_fixture(uncertainty_ns: f64) -> Fixture {
    let mut f = fixture();
    f.trace
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = Some(10_000_000.0);
    f.trace.request.policy.duration_ms = 9_990;
    f.trace.elapsed_ms += 10;
    f.trace.ended_at_ms += 10;
    for epoch in &mut f.trace.raw_gnss.as_mut().unwrap().epochs {
        epoch.clock.elapsed_realtime_uncertainty_ns = uncertainty_ns;
        epoch.observed_elapsed_ms += 10;
    }
    f
}

#[test]
fn explicit_elapsed_uncertainty_is_budgeted_without_changing_legacy_position_reports() {
    let old = report(&fixture());
    assert_eq!(old["verified"], true);
    assert!(old["epochs"][0].get("clock_alignment").is_none());
    assert!(old["comparisons"][0].get("time_alignment").is_none());
    let f = explicit_elapsed_fixture(5_000_000.0);
    let r = report(&f);
    assert_positions(&f, &r, 75.0);
    let epoch = &r["epochs"][0]["clock_alignment"];
    assert_eq!(epoch["reported_elapsed_uncertainty_ns"], 5_000_000.0);
    assert_eq!(epoch["uncertainty_budget_ns"], 5_000_000);
    assert_eq!(epoch["quantization_budget_ns"], 1_000_000);
    assert_eq!(
        epoch["budgeted_interval_ns"].as_u64().unwrap(),
        epoch["nominal_interval_ns"].as_u64().unwrap() + 6_000_000
    );
    let comparison = &r["comparisons"][0];
    assert_eq!(comparison["interval_ms"], 0);
    assert_eq!(comparison["time_alignment"]["nominal_interval_ns"], 0);
    assert_eq!(
        comparison["time_alignment"]["budgeted_interval_ns"],
        6_000_000
    );
    for flag in [
        "physical_location_proven",
        "clock_trusted",
        "satellite_authentication_verified",
    ] {
        assert_eq!(r[flag], false);
    }
}

#[test]
fn signed_position_match_reserves_reported_uncertainty_inside_existing_limit() {
    for (nominal_ms, expected) in [(94, true), (95, false)] {
        let mut f = explicit_elapsed_fixture(5_000_000.0);
        f.policy.max_match_interval_ms = 100;
        f.trace.samples[1].fix_elapsed_ms = Some(6000 - nominal_ms);
        f.trace.samples[1].fix_timestamp_ms -= nominal_ms;
        let r = report(&f);
        assert_eq!(r["evidence_verified"], true, "{r:#}");
        assert_eq!(r["independent_position_recomputed"], true);
        assert_eq!(r["verified"], expected, "{r:#}");
        assert_eq!(r["comparisons"][1]["interval_ms"], nominal_ms);
        assert_eq!(
            r["comparisons"][1]["time_alignment"]["budgeted_interval_ns"],
            (nominal_ms + 6) * 1_000_000
        );
    }
    // Legacy requests continue to use their established nominal interval rule.
    let mut old = fixture();
    old.policy.max_match_interval_ms = 100;
    old.trace.samples[1].fix_elapsed_ms = Some(5904);
    old.trace.samples[1].fix_timestamp_ms -= 96;
    assert_eq!(report(&old)["verified"], true);
}

#[test]
fn signed_gps_wall_correlation_reserves_uncertainty_inside_one_second() {
    for (shift_ms, expected) in [(-995_i64, false), (-993, true), (993, true), (995, false)] {
        let mut f = explicit_elapsed_fixture(5_000_000.0);
        f.trace.started_at_ms = f.trace.started_at_ms.checked_add_signed(-shift_ms).unwrap();
        f.trace.ended_at_ms = f.trace.ended_at_ms.checked_add_signed(-shift_ms).unwrap();
        for sample in &mut f.trace.samples {
            sample.fix_timestamp_ms = sample
                .fix_timestamp_ms
                .checked_add_signed(-shift_ms)
                .unwrap();
        }
        let r = report(&f);
        assert_eq!(r["evidence_verified"], true, "{r:#}");
        assert_eq!(r["verified"], expected, "{r:#}");
        assert_eq!(r["independent_position_recomputed"], expected);
        let timing = &r["epochs"][0]["clock_alignment"];
        assert_eq!(
            timing["budgeted_interval_ns"].as_u64().unwrap() <= 1_000_000_000,
            expected
        );
        if !expected {
            assert!(r["epochs"][0]["errors"]
                .as_array()
                .unwrap()
                .iter()
                .any(|error| error
                    .as_str()
                    .unwrap()
                    .contains("GPS system time disagrees")));
        }
    }
    let mut old = fixture();
    old.trace.started_at_ms -= 996;
    old.trace.ended_at_ms -= 996;
    for sample in &mut old.trace.samples {
        sample.fix_timestamp_ms -= 996;
    }
    assert_eq!(report(&old)["verified"], true);
}

#[test]
fn position_matching_selects_the_best_budgeted_epoch_instead_of_nearest_nominal() {
    let mut f = explicit_elapsed_fixture(5_000_000.0);
    f.policy.max_match_interval_ms = 503;
    f.trace.samples[1].fix_elapsed_ms = Some(5499);
    f.trace.samples[1].fix_timestamp_ms -= 501;
    f.trace.raw_gnss.as_mut().unwrap().epochs[5]
        .clock
        .elapsed_realtime_uncertainty_ns = 1_000_000.0;
    let r = report(&f);
    assert_eq!(r["verified"], true, "{r:#}");
    assert_eq!(r["comparisons"][1]["epoch_sequence"], 5);
    assert_eq!(r["comparisons"][1]["interval_ms"], 501);
    assert_eq!(
        r["comparisons"][1]["time_alignment"]["budgeted_interval_ns"],
        503_000_000
    );
}

#[test]
fn fractional_reported_uncertainty_rounds_up_at_the_position_match_boundary() {
    let mut f = explicit_elapsed_fixture(5_000_000.25);
    f.trace.request.policy.duration_ms = 9_989;
    f.policy.max_match_interval_ms = 100;
    f.trace.samples[1].fix_elapsed_ms = Some(5906);
    f.trace.samples[1].fix_timestamp_ms -= 94;
    let r = report(&f);
    assert_eq!(r["evidence_verified"], true, "{r:#}");
    assert_eq!(r["independent_position_recomputed"], true);
    assert_eq!(r["verified"], false);
    assert_eq!(
        r["comparisons"][1]["time_alignment"]["nominal_interval_ns"],
        94_000_000
    );
    assert_eq!(
        r["comparisons"][1]["time_alignment"]["uncertainty_budget_ns"],
        5_000_001
    );
    assert_eq!(
        r["comparisons"][1]["time_alignment"]["budgeted_interval_ns"],
        100_000_001
    );
}

#[test]
fn whole_millisecond_fix_cannot_hide_submillisecond_alignment_at_the_policy_boundary() {
    let mut f = explicit_elapsed_fixture(5_000_000.0);
    let raw = f.trace.raw_gnss.as_mut().unwrap();
    raw.epochs.remove(1); // Without the 2000 ms epoch, 1000 ms is the closest match.
    for (sequence, epoch) in raw.epochs.iter_mut().enumerate() {
        epoch.sequence = sequence;
    }
    // The stored 1995 ms native fix could originate at 1995.999999 ms.
    // The old nominal 995 ms + 5 ms receiver budget was insufficient at 1000 ms.
    f.trace.samples[1].fix_elapsed_ms = Some(1995);
    f.trace.samples[1].observed_elapsed_ms = 2000;
    f.trace.samples[1].fix_timestamp_ms = f.trace.started_at_ms + 1995;
    let r = report(&f);
    assert_eq!(r["evidence_verified"], true, "{r:#}");
    assert_eq!(r["independent_position_recomputed"], true);
    assert_eq!(r["verified"], false);
    let comparison = &r["comparisons"][1];
    assert_eq!(comparison["epoch_sequence"], 0);
    assert_eq!(comparison["interval_ms"], 995);
    assert_eq!(
        comparison["time_alignment"]["nominal_interval_ns"],
        995_000_000
    );
    assert_eq!(
        comparison["time_alignment"]["uncertainty_budget_ns"],
        5_000_000
    );
    assert_eq!(
        comparison["time_alignment"]["quantization_budget_ns"],
        1_000_000
    );
    assert_eq!(
        comparison["time_alignment"]["budgeted_interval_ns"],
        1_001_000_000
    );
    assert_eq!(comparison["passed"], false);

    // Requests without the optional policy retain their established decisions.
    f.trace
        .request
        .policy
        .raw_gnss
        .as_mut()
        .unwrap()
        .max_elapsed_realtime_uncertainty_ns = None;
    for epoch in &mut f.trace.raw_gnss.as_mut().unwrap().epochs {
        epoch.clock.elapsed_realtime_uncertainty_ns = 1000.0;
    }
    let old = report(&f);
    assert_eq!(old["verified"], true, "{old:#}");
    assert!(old["comparisons"][1].get("time_alignment").is_none());
}

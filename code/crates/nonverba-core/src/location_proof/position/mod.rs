// SPDX-License-Identifier: AGPL-3.0-only
//! Independent GPS L1 C/A position/receiver-clock recomputation from signed raw
//! observations and separately pinned verifier-supplied GPS LNAV parameters.
//! This is mathematical consistency, not RF authentication or attestation.
pub mod importer;
mod linear;
mod model;
mod orbit;
mod solve;
use model::{ClaimComparison, EpochResult, TimingBudget, MAX_EPHEMERIDES};
pub use model::{Ephemeris, Navigation, PositionPolicy, PositionReport, Source, MAX_NAV_BYTES};
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn canonical_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn finite(value: f64, min: f64, max: f64) -> bool {
    value.is_finite() && (min..=max).contains(&value)
}
fn parse<T: DeserializeOwned>(value: &str, limit: usize) -> Result<T, String> {
    if value.len() > limit {
        return Err("GPS verifier JSON exceeds its bound".into());
    }
    serde_json::from_str(value).map_err(crate::err)
}
fn validate_policy(p: &PositionPolicy) -> Result<(), String> {
    if p.version != 1
        || !canonical_hash(&p.nav_sha256)
        || p.gps_utc_offset_s > 128
        || !(6..=32).contains(&p.min_satellites)
        || !finite(p.max_sv_time_uncertainty_ns, 1.0, 500.0)
        || !finite(p.max_pdop, 1.0, 30.0)
        || !finite(p.max_residual_m, 0.01, 1000.0)
        || !finite(p.max_weighted_rms, 0.01, 20.0)
        || !finite(p.max_horizontal_difference_m, 0.01, 10_000.0)
        || !finite(p.max_vertical_difference_m, 0.01, 10_000.0)
        || !(1..=5000).contains(&p.max_match_interval_ms)
    {
        return Err("Invalid GPS position policy".into());
    }
    Ok(())
}
fn validate_nav(nav: &Navigation) -> Result<(), String> {
    if nav.version != 1
        || nav.kind != "nonverba-gps-lnav"
        || nav.source.id.is_empty()
        || nav.source.id.len() > 512
        || !canonical_hash(&nav.source.sha256)
        || nav.ephemerides.is_empty()
        || nav.ephemerides.len() > MAX_EPHEMERIDES
        || !nav.ionosphere.alpha.iter().all(|v| finite(*v, -1e-4, 1e-4))
        || !nav.ionosphere.beta.iter().all(|v| finite(*v, -1e7, 1e7))
    {
        return Err("Invalid bounded GPS navigation bundle".into());
    }
    let mut seen = BTreeSet::new();
    for e in &nav.ephemerides {
        if !(1..=32).contains(&e.svid)
            || !(1..=8191).contains(&e.gps_week)
            || e.fit_interval_hours != 4
            || e.iode > 255
            || e.iodc > 1023
            || e.iodc & 255 != e.iode
            || e.health > 63
            || !finite(e.toe_s, 0.0, 604_799.999999)
            || !finite(e.toc_s, 0.0, 604_799.999999)
            || !finite(e.transmission_tow_s, 0.0, 604_799.999999)
            || !finite(e.ura_m, 0.0, 100.0)
            || !finite(e.sqrt_a_m_sqrt, 5000.0, 5300.0)
            || !finite(e.e, 0.0, 0.03)
            || ![e.m0_rad, e.omega_rad, e.omega0_rad, e.i0_rad]
                .iter()
                .all(|v| finite(*v, -7.0, 7.0))
            || ![e.delta_n_rad_s, e.omega_dot_rad_s, e.idot_rad_s]
                .iter()
                .all(|v| finite(*v, -1e-5, 1e-5))
            || ![e.cuc_rad, e.cus_rad, e.cic_rad, e.cis_rad]
                .iter()
                .all(|v| finite(*v, -1e-3, 1e-3))
            || ![e.crc_m, e.crs_m]
                .iter()
                .all(|v| finite(*v, -2000.0, 2000.0))
            || !finite(e.af0_s, -0.01, 0.01)
            || !finite(e.af1_s_s, -1e-8, 1e-8)
            || !finite(e.af2_s_s2, -1e-12, 1e-12)
            || !finite(e.tgd_s, -1e-6, 1e-6)
            || !seen.insert((e.svid, e.gps_week, e.toe_s.to_bits()))
        {
            return Err("Invalid, duplicate or unsupported GPS LNAV ephemeris".into());
        }
    }
    Ok(())
}

fn comparison_timing(epoch: &EpochResult, fix_elapsed_ms: u64) -> Option<TimingBudget> {
    epoch.clock_alignment.map(|clock| {
        TimingBudget::new(
            epoch
                .measurement_elapsed_ns
                .abs_diff(fix_elapsed_ms.saturating_mul(1_000_000)),
            clock.reported_elapsed_uncertainty_ns,
            clock.uncertainty_budget_ns,
        )
    })
}

/// Expected navigation digest and policy are independently retained verifier
/// inputs, like the expected operator pin. The proof cannot supply them for you.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[allow(clippy::too_many_arguments)]
pub fn verify_location_position(
    proof: &[u8],
    original_request: &str,
    expected_pin: &str,
    expected_asset: &str,
    nav_data_json: &str,
    position_policy_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let policy: PositionPolicy = parse(position_policy_json, 4096)?;
    validate_policy(&policy)?;
    let nav: Navigation = parse(nav_data_json, MAX_NAV_BYTES)?;
    validate_nav(&nav)?;
    let location = super::verify_location_proof(
        proof,
        original_request,
        expected_pin,
        expected_asset,
        now_secs,
    )?;
    let location: super::Verification = serde_json::from_str(&location).map_err(crate::err)?;
    let digest = hash(nav_data_json.as_bytes());
    let nav_matches = digest == policy.nav_sha256;
    let mut report = PositionReport {
        version: 1,
        method: "gps-l1-ca-broadcast-wls-v1",
        verified: false,
        evidence_verified: location.verified,
        nav_digest_match: nav_matches,
        navigation_sha256: digest,
        navigation_source: nav.source.clone(),
        policy,
        independent_position_recomputed: false,
        consistency_passed: false,
        reported_location_consistent: false,
        epochs: Vec::new(),
        comparisons: Vec::new(),
        satellite_authentication_verified: false,
        navigation_source_authenticated: false,
        collection_attested: false,
        physical_location_proven: false,
        clock_trusted: false,
        errors: Vec::new(),
        location_verification: location,
    };
    if !report.evidence_verified {
        report
            .errors
            .push("Original pinned location proof failed verification".into());
    }
    if !nav_matches {
        report
            .errors
            .push("Navigation bytes differ from the independently retained digest".into());
    }
    if !report
        .location_verification
        .raw_gnss
        .as_ref()
        .is_some_and(|v| v.ready)
    {
        report
            .errors
            .push("A complete consistent signed raw-GNSS trace is required".into());
    }
    if !report.errors.is_empty() {
        return serde_json::to_string(&report).map_err(crate::err);
    }
    let trace = &report
        .location_verification
        .evidence
        .as_ref()
        .ok_or("Verified location evidence is absent")?
        .trace;
    let raw = trace
        .raw_gnss
        .as_ref()
        .ok_or("Verified raw trace is absent")?;
    report.epochs = raw
        .epochs
        .iter()
        .map(|epoch| solve::epoch(trace, raw, epoch, &nav, &report.policy))
        .collect();
    report.independent_position_recomputed =
        !report.epochs.is_empty() && report.epochs.iter().all(|e| e.computed);
    report.consistency_passed = report.independent_position_recomputed
        && report.epochs.iter().all(|e| e.consistency_passed);
    if !report.independent_position_recomputed {
        report.errors.push(
            "GPS position could not be independently recomputed for every retained epoch".into(),
        );
    } else if !report.consistency_passed {
        report
            .errors
            .push("Recomputed GPS geometry or residuals failed the policy".into());
    }
    if report.independent_position_recomputed {
        for sample in &trace.samples {
            let Some(at) = sample.fix_elapsed_ms else {
                report
                    .errors
                    .push("Position comparison requires the native fix monotonic epoch".into());
                continue;
            };
            let epoch = report
                .epochs
                .iter()
                .min_by_key(|e| {
                    comparison_timing(e, at).map_or_else(
                        || {
                            e.measurement_elapsed_ms
                                .abs_diff(at)
                                .saturating_mul(1_000_000)
                        },
                        |timing| timing.budgeted_interval_ns,
                    )
                })
                .ok_or("No GPS position epoch")?;
            let llh = [
                epoch.latitude_deg.unwrap().to_radians(),
                epoch.longitude_deg.unwrap().to_radians(),
                epoch.ellipsoid_height_m.unwrap(),
            ];
            // Chord between coordinates projected onto the WGS84 ellipsoid.
            // Unlike a tangent-plane projection this cannot hide antipodal claims.
            // The policy bounds it to <=10 km, where arc/chord difference is tiny.
            let claimed = orbit::ecef([
                sample.latitude.to_radians(),
                sample.longitude.to_radians(),
                0.0,
            ]);
            let solved = orbit::ecef([llh[0], llh[1], 0.0]);
            let horizontal = orbit::norm(orbit::subtract(claimed, solved));
            let vertical = sample.altitude_m.map(|v| (v - llh[2]).abs());
            let interval = epoch.measurement_elapsed_ms.abs_diff(at);
            let time_alignment = comparison_timing(epoch, at);
            let timing_passed =
                time_alignment.map_or(interval <= report.policy.max_match_interval_ms, |timing| {
                    timing.budgeted_interval_ns <= report.policy.max_match_interval_ms * 1_000_000
                });
            let passed = timing_passed
                && horizontal <= report.policy.max_horizontal_difference_m
                && vertical.is_none_or(|v| v <= report.policy.max_vertical_difference_m);
            report.comparisons.push(ClaimComparison {
                sample_sequence: sample.sequence,
                epoch_sequence: epoch.sequence,
                interval_ms: interval,
                time_alignment,
                horizontal_difference_m: horizontal,
                vertical_difference_m: vertical,
                passed,
            });
        }
        report.reported_location_consistent = report.comparisons.len() == trace.samples.len()
            && report.comparisons.iter().all(|c| c.passed);
        if !report.reported_location_consistent {
            report.errors.push("Device-reported coordinates disagree with the independently recomputed position or epoch".into());
        }
    }
    report.verified = report.evidence_verified
        && report.nav_digest_match
        && report.consistency_passed
        && report.reported_location_consistent;
    serde_json::to_string(&report).map_err(crate::err)
}

#[cfg(test)]
mod tests;

/// Synthetic signed evidence for cross-module policy tests, never a device record.
#[cfg(test)]
pub(crate) fn reference_test_bundle() -> serde_json::Value {
    tests::reference_bundle()
}

// SPDX-License-Identifier: AGPL-3.0-only
//! Native acquisition decisions, separate from signed-proof admission.
//! A rejected startup candidate never enters the evidence window. The original
//! request, monotonic anchor, deadline and rejected-epoch count remain unchanged.
use super::{
    clock_structure_valid, evaluate_raw_gnss, timing, uint, RawGnssChecks, Trace,
    MAX_RAW_GNSS_EPOCHS,
};
use crate::location_proof::validation::{validate_request, MAX_COLLECTION_MS};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RawGnssCollectionAction {
    Retain,
    DiscardStartup,
    Reject,
}

#[derive(Debug, Serialize)]
pub struct RawGnssCollectionProgress {
    #[serde(flatten)]
    pub checks: RawGnssChecks,
    pub collection_action: RawGnssCollectionAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    alignment_diagnostic: Option<AlignmentDiagnostic>,
}

/// Coordinate-free local acquisition status. Never serialized into a proof.
#[derive(Debug, Serialize)]
struct AlignmentDiagnostic {
    unsigned: bool,
    epoch_sequence: usize,
    reason: &'static str,
    measurement_relative_ns: String,
    callback_elapsed_ms: u64,
    trace_elapsed_ms: u64,
    uncertainty_ns: f64,
    signal_offset_min_ns: f64,
    signal_offset_max_ns: f64,
    summary: String,
}

/// This drives native acquisition only. It does not relax evaluate_raw_gnss,
/// validate_trace, signing, verification, or the required evidence duration.
pub fn evaluate_raw_gnss_collection(trace: &Trace) -> RawGnssCollectionProgress {
    let checks = evaluate_raw_gnss(trace);
    let collection_action = action(trace, &checks);
    let alignment_diagnostic = alignment_diagnostic(trace, &checks);
    RawGnssCollectionProgress {
        checks,
        collection_action,
        alignment_diagnostic,
    }
}

fn alignment_diagnostic(trace: &Trace, checks: &RawGnssChecks) -> Option<AlignmentDiagnostic> {
    if checks.collection_alignment_valid {
        return None;
    }
    let raw = trace.raw_gnss.as_ref()?;
    let policy = trace.request.policy.raw_gnss.as_ref()?;
    let anchor = uint(&raw.anchor_elapsed_realtime_ns)?;
    for epoch in raw.epochs.iter().take(MAX_RAW_GNSS_EPOCHS) {
        let Some(reason) = timing::alignment_error(trace, epoch, anchor, policy) else {
            continue;
        };
        let measured = uint(&epoch.clock.elapsed_realtime_ns)?;
        let uncertainty = epoch.clock.elapsed_realtime_uncertainty_ns;
        if epoch.sequence >= MAX_RAW_GNSS_EPOCHS
            || epoch.observed_elapsed_ms > MAX_COLLECTION_MS
            || trace.elapsed_ms > MAX_COLLECTION_MS
            || !uncertainty.is_finite()
            || !(0.0..=100_000_000.0).contains(&uncertainty)
            || epoch.measurements.is_empty()
            || epoch
                .measurements
                .iter()
                .any(|m| !m.time_offset_ns.is_finite() || m.time_offset_ns.abs() > 1_000_000_000.0)
        {
            return None;
        }
        let minimum = epoch
            .measurements
            .iter()
            .map(|m| m.time_offset_ns)
            .fold(f64::INFINITY, f64::min);
        let maximum = epoch
            .measurements
            .iter()
            .map(|m| m.time_offset_ns)
            .fold(f64::NEG_INFINITY, f64::max);
        let relative = (i128::from(measured) - i128::from(anchor)).to_string();
        let summary = format!("raw-align[{reason}] e{} dt={relative}ns cb={}ms end={}ms u={uncertainty:.3e}ns off={minimum:.3e}..{maximum:.3e}ns",
            epoch.sequence, epoch.observed_elapsed_ms, trace.elapsed_ms);
        if summary.len() > 240 {
            return None;
        }
        return Some(AlignmentDiagnostic {
            unsigned: true,
            epoch_sequence: epoch.sequence,
            reason,
            measurement_relative_ns: relative,
            callback_elapsed_ms: epoch.observed_elapsed_ms,
            trace_elapsed_ms: trace.elapsed_ms,
            uncertainty_ns: uncertainty,
            signal_offset_min_ns: minimum,
            signal_offset_max_ns: maximum,
            summary,
        });
    }
    None
}

fn action(trace: &Trace, checks: &RawGnssChecks) -> RawGnssCollectionAction {
    use RawGnssCollectionAction::*;
    if trace.version != 1
        || trace.kind != "nonverba-location-trace"
        || trace.profile != "native-android"
        || trace.permission_precision != "fine"
        || trace.uncertainty_semantics != "android-68-percent"
        || trace.capture_correlation != "none"
        || validate_request(&trace.request, trace.started_at_ms).is_err()
        || validate_request(&trace.request, trace.ended_at_ms).is_err()
        || trace.ended_at_ms < trace.started_at_ms
        || trace.elapsed_ms > MAX_COLLECTION_MS
        || (trace.ended_at_ms - trace.started_at_ms).abs_diff(trace.elapsed_ms) > 1000
        || !checks.required
        || !checks.present
    {
        return Reject;
    }
    let pending = |code: &str| matches!(code, "RAW_GNSS_EPOCH_COUNT" | "RAW_GNSS_COVERAGE");
    if checks.error_codes.iter().all(|code| pending(code)) {
        return Retain;
    }
    let Some(raw) = &trace.raw_gnss else {
        return Reject;
    };
    // A native session appends the candidate before calling this function. One
    // epoch and no GPS samples therefore means no previous epoch was retained.
    // Never discard an interruption from an established evidence sequence.
    if raw.epochs.len() != 1
        || !trace.samples.is_empty()
        || raw.rejected_epoch_count >= 4096
        || !clock_structure_valid(&raw.epochs[0].clock)
    {
        return Reject;
    }
    if cached_candidate_before_anchor(trace, checks)
        && checks.error_codes.iter().all(|code| {
            pending(code)
                || matches!(
                    code.as_str(),
                    "RAW_GNSS_ALIGNMENT" | "RAW_GNSS_FRESHNESS" | "RAW_GNSS_SATELLITE_COUNT"
                )
        })
    {
        // A receiver already running for another consumer may deliver a cached
        // event when this session registers. Exclude it without evidence credit;
        // never move the request anchor or restart its collection deadline.
        // The discarded event need not have enough qualifying satellites. Its
        // clock and every present measurement field must still be well formed.
        return DiscardStartup;
    }
    if checks.clock_fields_valid && checks.satellite_count_valid {
        return Reject;
    }
    if checks.error_codes.iter().all(|code| {
        pending(code)
            || matches!(
                code.as_str(),
                "RAW_GNSS_SATELLITE_COUNT" | "RAW_GNSS_CLOCK_FIELDS" | "RAW_GNSS_CLOCK_CONTINUITY"
            )
    }) {
        // With exactly one structurally valid clock, continuity is false only
        // because clock quality failed; no observed inter-epoch reset is hidden.
        DiscardStartup
    } else {
        Reject
    }
}

fn cached_candidate_before_anchor(trace: &Trace, checks: &RawGnssChecks) -> bool {
    if !checks.clock_fields_valid || !checks.measurement_fields_valid {
        return false;
    }
    let Some(raw) = &trace.raw_gnss else {
        return false;
    };
    let Some(epoch) = raw.epochs.first() else {
        return false;
    };
    if epoch.observed_elapsed_ms > trace.elapsed_ms {
        return false;
    }
    let Some((anchor, measured)) =
        uint(&raw.anchor_elapsed_realtime_ns).zip(uint(&epoch.clock.elapsed_realtime_ns))
    else {
        return false;
    };
    // Clock quality above bounds this finite value to at most 100 ms. Even a
    // legacy policy must not call an uncertainty-overlapping epoch cached.
    let uncertainty = epoch.clock.elapsed_realtime_uncertainty_ns.ceil() as u64;
    let Some((earliest, latest)) = measured
        .checked_sub(uncertainty)
        .zip(measured.checked_add(uncertainty))
    else {
        return false;
    };
    earliest > 0
        && latest < anchor
        && epoch.measurements.iter().all(|measurement| {
            let before = (-measurement.time_offset_ns).max(0.0).ceil() as u64;
            let after = measurement.time_offset_ns.max(0.0).ceil() as u64;
            earliest > before
                && latest
                    .checked_add(after)
                    .is_some_and(|upper| upper < anchor)
        })
}

#[cfg(test)]
#[path = "raw_gnss_collection_tests.rs"]
mod tests;

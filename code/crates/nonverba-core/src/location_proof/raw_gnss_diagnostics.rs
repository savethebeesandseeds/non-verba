// SPDX-License-Identifier: AGPL-3.0-only
//! Coordinate-free, bounded raw receiver field rejection and qualification notes.
//! This private projection never participates in evidence admission.
use super::{
    bounded, measurement_fields, satellite_id, signal_code_identity, sint, uint,
    RawGnssFieldDiagnostic, RawGnssPolicy, RawGnssTrace, MAX_RAW_GNSS_EPOCHS,
    MAX_RAW_GNSS_MEASUREMENTS,
};
use std::collections::{BTreeMap, BTreeSet};

// Reasons classify an already rejected value; they never determine admission.
// None is optional absence, so its placeholder reason will never be emitted.
fn uncertainty_reason(value: Option<f64>, maximum: f64) -> &'static str {
    match value {
        Some(v) if !v.is_finite() => "nonfinite",
        Some(v) if v < 0.0 => "negative",
        Some(v) if v > maximum => "above-policy",
        _ => "policy-range", // Also explains rejection when the policy itself is invalid.
    }
}

fn code_reason(value: Option<&str>) -> &'static str {
    match value {
        Some("") => "empty",
        Some(v) if v.len() > 16 => "overlong",
        _ => "invalid-characters",
    }
}

// A safe JSON numeric bound limits diagnostics only, never evidence admission.
const MAX_DIAGNOSTIC_UNCERTAINTY_NS: f64 = 9_007_199_254_740_991.0;

fn uncertainty_values(
    raw: &RawGnssTrace,
    policy: &RawGnssPolicy,
    field: &str,
    reason: &str,
) -> (Option<f64>, Option<f64>) {
    let limit = if field == "clock.elapsed_realtime_uncertainty_ns" {
        policy.elapsed_uncertainty_limit()
    } else {
        policy.max_time_uncertainty_ns
    };
    let maximum_limit = if field == "clock.elapsed_realtime_uncertainty_ns"
        && policy.max_elapsed_realtime_uncertainty_ns.is_some()
    {
        100_000_000.0
    } else {
        1_000_000.0
    };
    if reason != "above-policy" || !bounded(limit, 1.0, maximum_limit) {
        return (None, None);
    }
    let mut maximum: Option<f64> = None;
    for epoch in raw.epochs.iter().take(MAX_RAW_GNSS_EPOCHS) {
        let value = match field {
            "clock.bias_uncertainty_ns" => epoch.clock.bias_uncertainty_ns,
            "clock.time_uncertainty_ns" => epoch.clock.time_uncertainty_ns,
            "clock.elapsed_realtime_uncertainty_ns" => {
                Some(epoch.clock.elapsed_realtime_uncertainty_ns)
            }
            _ => return (None, None),
        };
        if let Some(value) = value.filter(|value| *value > limit) {
            // Do not clip a huge outlier or label a partial maximum as complete.
            if !bounded(value, 0.0, MAX_DIAGNOSTIC_UNCERTAINTY_NS) {
                return (None, None);
            }
            maximum = Some(maximum.map_or(value, |previous| previous.max(value)));
        }
    }
    (maximum, maximum.map(|_| limit))
}

// Diagnostics deliberately do not participate in `ready` or any verdict. The
// predicates in the parent module remain unchanged; tests cover their agreement with these
// labels. Only bounded clock-uncertainty maxima and their requested limit are
// projected; coordinates, IDs and absolute clock observations are never returned.
pub(super) fn evaluate(raw: &RawGnssTrace, policy: &RawGnssPolicy) -> Vec<RawGnssFieldDiagnostic> {
    let mut counts: BTreeMap<(&'static str, &'static str), u32> = BTreeMap::new();
    let mut note = |field: &'static str, reason: &'static str, valid: bool| {
        if !valid {
            let count = counts.entry((field, reason)).or_default();
            *count = count.saturating_add(1).min(8192);
        }
    };
    note(
        "clock.anchor_elapsed_realtime_ns",
        "invalid-integer",
        uint(&raw.anchor_elapsed_realtime_ns).is_some(),
    );
    for epoch in raw.epochs.iter().take(MAX_RAW_GNSS_EPOCHS) {
        let c = &epoch.clock;
        for (field, reason, valid) in [
            (
                "clock.time_ns",
                "invalid-integer",
                sint(&c.time_ns).is_some(),
            ),
            (
                "clock.full_bias_ns",
                "invalid-integer",
                sint(&c.full_bias_ns).is_some(),
            ),
            (
                "clock.elapsed_realtime_ns",
                "invalid-integer",
                uint(&c.elapsed_realtime_ns).is_some(),
            ),
            (
                "clock.bias_ns",
                "out-of-range",
                c.bias_ns.is_none_or(|v| bounded(v, -1e12, 1e12)),
            ),
            (
                "clock.bias_uncertainty_ns",
                uncertainty_reason(c.bias_uncertainty_ns, policy.max_time_uncertainty_ns),
                c.bias_uncertainty_ns
                    .is_none_or(|v| bounded(v, 0.0, policy.max_time_uncertainty_ns)),
            ),
            (
                "clock.time_uncertainty_ns",
                uncertainty_reason(c.time_uncertainty_ns, policy.max_time_uncertainty_ns),
                c.time_uncertainty_ns
                    .is_none_or(|v| bounded(v, 0.0, policy.max_time_uncertainty_ns)),
            ),
            (
                "clock.drift_ns_per_second",
                "out-of-range",
                c.drift_ns_per_second.is_none_or(|v| bounded(v, -1e9, 1e9)),
            ),
            (
                "clock.drift_uncertainty_ns_per_second",
                "out-of-range",
                c.drift_uncertainty_ns_per_second
                    .is_none_or(|v| bounded(v, 0.0, 1e9)),
            ),
            (
                "clock.elapsed_realtime_uncertainty_ns",
                uncertainty_reason(
                    Some(c.elapsed_realtime_uncertainty_ns),
                    policy.elapsed_uncertainty_limit(),
                ),
                bounded(
                    c.elapsed_realtime_uncertainty_ns,
                    0.0,
                    policy.elapsed_uncertainty_limit(),
                ),
            ),
        ] {
            note(field, reason, valid);
        }
        let mut identities = BTreeSet::new();
        for m in epoch.measurements.iter().take(MAX_RAW_GNSS_MEASUREMENTS) {
            let period_ns = if m.constellation == 3 {
                86_400_000_000_000
            } else {
                604_800_000_000_000
            };
            for (field, reason, valid) in [
                ("measurement.satellite_id", "out-of-range", satellite_id(m)),
                (
                    "measurement.state",
                    "unsupported-bits",
                    m.state & !0x1ffff == 0,
                ),
                (
                    "measurement.received_sv_time_ns",
                    "out-of-range",
                    uint(&m.received_sv_time_ns).is_some_and(|v| v < period_ns),
                ),
                (
                    "measurement.received_sv_time_uncertainty_ns",
                    "out-of-range",
                    uint(&m.received_sv_time_uncertainty_ns)
                        .is_some_and(|v| v <= 604_800_000_000_000),
                ),
                (
                    "measurement.time_offset_ns",
                    "out-of-range",
                    bounded(m.time_offset_ns, -1e9, 1e9),
                ),
                (
                    "measurement.cn0_dbhz",
                    "out-of-range",
                    bounded(m.cn0_dbhz, 0.0, 100.0),
                ),
                (
                    "measurement.pseudorange_rate_mps",
                    "out-of-range",
                    bounded(m.pseudorange_rate_mps, -20_000.0, 20_000.0),
                ),
                (
                    "measurement.pseudorange_rate_uncertainty_mps",
                    "out-of-range",
                    bounded(m.pseudorange_rate_uncertainty_mps, 0.0, 20_000.0),
                ),
                (
                    "measurement.carrier_frequency_hz",
                    "out-of-range",
                    m.carrier_frequency_hz.is_none_or(|v| bounded(v, 1e8, 3e9)),
                ),
                (
                    "measurement.code_type",
                    code_reason(m.code_type.as_deref()),
                    // Retain the explicit empty-code note without inferring a signal identity.
                    m.code_type.as_ref().is_none_or(|v| {
                        !v.is_empty()
                            && v.len() <= 16
                            && v.bytes()
                                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
                    }),
                ),
                (
                    "measurement.accumulated_delta_range_state",
                    "unsupported-bits",
                    m.accumulated_delta_range_state & !31 == 0,
                ),
                (
                    "measurement.accumulated_delta_range_m",
                    "out-of-range",
                    m.accumulated_delta_range_m
                        .is_none_or(|v| bounded(v, -1e12, 1e12)),
                ),
                (
                    "measurement.accumulated_delta_range_uncertainty_m",
                    "out-of-range",
                    m.accumulated_delta_range_uncertainty_m
                        .is_none_or(|v| bounded(v, 0.0, 1e12)),
                ),
                (
                    "measurement.accumulated_delta_range_pair",
                    "inconsistent-presence",
                    m.accumulated_delta_range_m.is_some()
                        == m.accumulated_delta_range_uncertainty_m.is_some()
                        && (m.accumulated_delta_range_state & 1 == 0
                            || m.accumulated_delta_range_m.is_some()),
                ),
                (
                    "measurement.automatic_gain_control_db",
                    "out-of-range",
                    m.automatic_gain_control_db
                        .is_none_or(|v| bounded(v, -1000.0, 1000.0)),
                ),
            ] {
                note(field, reason, valid);
            }
            // Match admission's identity check only for structurally valid fields.
            if measurement_fields(m) {
                note(
                    "measurement.signal_identity",
                    "duplicate-signal",
                    identities.insert((
                        m.constellation,
                        m.svid,
                        m.carrier_frequency_hz.map(f64::to_bits),
                        signal_code_identity(m),
                    )),
                );
            }
        }
    }
    counts
        .into_iter()
        .map(|((field, reason), count)| {
            let (reported_max, requested_max) = uncertainty_values(raw, policy, field, reason);
            RawGnssFieldDiagnostic {
                field: field.into(),
                reason: reason.into(),
                count,
                reported_max,
                requested_max,
            }
        })
        .collect()
}

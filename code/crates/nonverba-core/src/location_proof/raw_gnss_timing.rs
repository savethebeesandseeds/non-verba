// SPDX-License-Identifier: AGPL-3.0-only
//! Timing-budget accounting for an explicitly requested alignment policy.
//! Reported 68% uncertainty is consumed conservatively without treating it as
//! an authenticated interval or modifying any measurement/receipt timestamp.
use super::{
    alignment_uncertainty_ns, measurement_elapsed, uint, RawGnssEpoch, RawGnssPolicy, RawGnssTrace,
    Trace, MAX_COLLECTION_MS, RAW_GNSS_INTERVAL_MS, RAW_GNSS_INTERVAL_TOLERANCE_MS,
};
use std::cmp::Ordering;
const NS_PER_MS: u64 = 1_000_000;
// Native callback, end and fix counters discard the fractional millisecond.
// Charge the upper edge of that bin when a later time consumes an age budget.
fn floored_ms_upper_ns(value: u64) -> Option<u64> {
    value.checked_add(1)?.checked_mul(NS_PER_MS)
}
struct Bounds {
    nominal: u64,
    lower: u64,
    upper: u64,
}
fn bounds(epoch: &RawGnssEpoch, anchor: u64, policy: &RawGnssPolicy) -> Option<Bounds> {
    checked_bounds(epoch, anchor, policy).ok()
}
fn checked_bounds(
    epoch: &RawGnssEpoch,
    anchor: u64,
    policy: &RawGnssPolicy,
) -> Result<Bounds, &'static str> {
    let nominal = uint(&epoch.clock.elapsed_realtime_ns)
        .ok_or("invalid-measurement-time")?
        .checked_sub(anchor)
        .ok_or("epoch-before-anchor")?;
    let uncertainty =
        alignment_uncertainty_ns(&epoch.clock, policy).ok_or("invalid-epoch-uncertainty")?;
    Ok(Bounds {
        nominal,
        lower: nominal
            .checked_sub(uncertainty)
            .ok_or("epoch-uncertainty-before-anchor")?,
        upper: nominal
            .checked_add(uncertainty)
            .ok_or("epoch-uncertainty-overflow")?,
    })
}
pub(super) fn alignment(trace: &Trace, raw: &RawGnssTrace, policy: &RawGnssPolicy) -> bool {
    trace.elapsed_ms <= MAX_COLLECTION_MS
        && uint(&raw.anchor_elapsed_realtime_ns).is_some_and(|anchor| {
            raw.epochs
                .iter()
                .all(|epoch| alignment_error(trace, epoch, anchor, policy).is_none())
        })
}

/// The admission predicate and unsigned diagnostics share these exact tests.
/// Returning a reason adds no allowance and never changes a reported timestamp.
pub(super) fn alignment_error(
    trace: &Trace,
    epoch: &RawGnssEpoch,
    anchor: u64,
    policy: &RawGnssPolicy,
) -> Option<&'static str> {
    if trace.elapsed_ms > MAX_COLLECTION_MS {
        return Some("collection-limit");
    }
    if policy.max_elapsed_realtime_uncertainty_ns.is_none() {
        return legacy_alignment_error(trace, epoch, anchor);
    }
    let b = match checked_bounds(epoch, anchor, policy) {
        Ok(bounds) => bounds,
        Err(reason) => return Some(reason),
    };
    let Some(observed_upper) = floored_ms_upper_ns(epoch.observed_elapsed_ms) else {
        return Some("callback-overflow");
    };
    let Some(delivery_budget) = trace
        .request
        .policy
        .max_delivery_delay_ms
        .checked_mul(NS_PER_MS)
    else {
        return Some("delivery-budget-overflow");
    };
    // Nominal causality stays mandatory. The reported 1-sigma upper edge
    // may overlap callback receipt; that is not a future sensor sample.
    if b.nominal / NS_PER_MS == 0 {
        return Some("epoch-at-anchor");
    }
    if b.lower == 0 {
        return Some("epoch-uncertainty-at-anchor");
    }
    if b.nominal / NS_PER_MS > epoch.observed_elapsed_ms {
        return Some("epoch-after-callback");
    }
    if epoch.observed_elapsed_ms > trace.elapsed_ms {
        return Some("callback-after-trace");
    }
    if observed_upper.saturating_sub(b.lower) > delivery_budget {
        return Some("epoch-delivery-budget");
    }
    for measurement in &epoch.measurements {
        let nominal = b.nominal as f64 + measurement.time_offset_ns;
        let lower = b.lower as f64 + measurement.time_offset_ns;
        if lower.partial_cmp(&0.0) != Some(Ordering::Greater) {
            return Some("signal-before-anchor");
        }
        if nominal.partial_cmp(&(observed_upper as f64)) != Some(Ordering::Less) {
            return Some("signal-after-callback");
        }
        if !matches!(
            (observed_upper as f64 - lower).partial_cmp(&(delivery_budget as f64)),
            Some(Ordering::Less | Ordering::Equal)
        ) {
            return Some("signal-delivery-budget");
        }
    }
    None
}

fn legacy_alignment_error(
    trace: &Trace,
    epoch: &RawGnssEpoch,
    anchor: u64,
) -> Option<&'static str> {
    let Some(elapsed) = measurement_elapsed(epoch, anchor) else {
        return Some("epoch-before-anchor");
    };
    if elapsed == 0 {
        return Some("epoch-at-anchor");
    }
    if elapsed > epoch.observed_elapsed_ms {
        return Some("epoch-after-callback");
    }
    if epoch.observed_elapsed_ms > trace.elapsed_ms {
        return Some("callback-after-trace");
    }
    if epoch.observed_elapsed_ms - elapsed > trace.request.policy.max_delivery_delay_ms {
        return Some("epoch-delivery-budget");
    }
    let Some(relative_ns) =
        uint(&epoch.clock.elapsed_realtime_ns).and_then(|measured| measured.checked_sub(anchor))
    else {
        return Some("epoch-before-anchor");
    };
    for measurement in &epoch.measurements {
        let measurement_ns = relative_ns as f64 + measurement.time_offset_ns;
        let observed_ns = epoch.observed_elapsed_ms as f64 * NS_PER_MS as f64;
        if measurement_ns.partial_cmp(&0.0) != Some(Ordering::Greater) {
            return Some("signal-before-anchor");
        }
        if measurement_ns.partial_cmp(&(observed_ns + NS_PER_MS as f64)) != Some(Ordering::Less) {
            return Some("signal-after-callback");
        }
        if !matches!(
            (observed_ns - measurement_ns).partial_cmp(
                &(trace.request.policy.max_delivery_delay_ms as f64 * NS_PER_MS as f64
                    + NS_PER_MS as f64)
            ),
            Some(Ordering::Less | Ordering::Equal)
        ) {
            return Some("signal-delivery-budget");
        }
    }
    None
}
pub(super) fn coverage(trace: &Trace, raw: &RawGnssTrace, policy: &RawGnssPolicy) -> bool {
    let Some(anchor) = uint(&raw.anchor_elapsed_realtime_ns) else {
        return false;
    };
    let Some(times) = raw
        .epochs
        .iter()
        .map(|epoch| bounds(epoch, anchor, policy))
        .collect::<Option<Vec<_>>>()
    else {
        return false;
    };
    let (Some(first), Some(last), Some(first_fix), Some(last_fix)) = (
        times.first(),
        times.last(),
        trace.samples.first(),
        trace.samples.last(),
    ) else {
        return false;
    };
    let Some(gap) = policy.max_epoch_gap_ms.checked_mul(NS_PER_MS) else {
        return false;
    };
    let Some(span) = trace.request.policy.duration_ms.checked_mul(NS_PER_MS) else {
        return false;
    };
    let cadence = (RAW_GNSS_INTERVAL_MS - RAW_GNSS_INTERVAL_TOLERANCE_MS) * NS_PER_MS;
    last.lower
        .checked_sub(first.upper)
        .is_some_and(|duration| duration >= span)
        && times.windows(2).all(|pair| {
            // Cadence constrains the nominal acquisition schedule. Clock
            // alignment precision must not masquerade as faster sampling.
            pair[1]
                .nominal
                .checked_sub(pair[0].nominal)
                .is_some_and(|minimum| minimum >= cadence)
                && pair[1].lower > pair[0].upper
                && pair[1]
                    .upper
                    .checked_sub(pair[0].lower)
                    .is_some_and(|maximum| maximum <= gap)
        })
        && first_fix
            .fix_elapsed_ms
            .and_then(|fix| fix.checked_mul(NS_PER_MS))
            .and_then(|fix| fix.checked_add(gap))
            .is_some_and(|latest| first.upper <= latest)
        && last_fix
            .fix_elapsed_ms
            .and_then(floored_ms_upper_ns)
            .zip(last.lower.checked_add(gap))
            .is_some_and(|(fix, latest)| latest >= fix)
}
pub(super) fn freshness(
    trace: &Trace,
    raw: &RawGnssTrace,
    policy: &RawGnssPolicy,
    sealed_at_ms: u64,
) -> bool {
    let Some(anchor) = uint(&raw.anchor_elapsed_realtime_ns) else {
        return false;
    };
    let Some(last) = raw
        .epochs
        .last()
        .and_then(|epoch| bounds(epoch, anchor, policy))
    else {
        return false;
    };
    let Some(end) = floored_ms_upper_ns(trace.elapsed_ms) else {
        return false;
    };
    let Some(budget) = trace.request.policy.max_fix_age_ms.checked_mul(NS_PER_MS) else {
        return false;
    };
    end.saturating_sub(last.lower) <= budget
        && trace
            .started_at_ms
            .checked_add(last.lower / NS_PER_MS)
            .is_some_and(|earliest_wall| {
                super::super::validation::finalization_within_policy(
                    trace,
                    sealed_at_ms,
                    earliest_wall,
                )
            })
}

#[cfg(test)]
#[path = "raw_gnss_timing_tests.rs"]
mod tests;

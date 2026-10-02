// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded Android raw-GNSS observations and deterministic consistency checks.
//! These checks do not authenticate satellites, solve PVT, or attest collection.
//! Android long nanoseconds stay decimal strings through JavaScript/JSON so no
//! precision is lost. All validation also runs on the independent verifier.
use super::{model::*, validation::MAX_COLLECTION_MS};
use serde::{de, Deserialize, Deserializer, Serialize};
use std::{collections::BTreeSet, fmt, marker::PhantomData};

#[path = "raw_gnss_collection.rs"]
mod collection;
#[path = "raw_gnss_diagnostics.rs"]
mod diagnostics;
#[path = "raw_gnss_timing.rs"]
mod timing;
pub use collection::{
    evaluate_raw_gnss_collection, RawGnssCollectionAction, RawGnssCollectionProgress,
};

pub const MAX_RAW_GNSS_EPOCHS: usize = 64;
pub const MAX_RAW_GNSS_MEASUREMENTS: usize = 128;
pub const RAW_GNSS_INTERVAL_MS: u64 = 1000;
/// Fixed scheduling tolerance; it never shortens the required actual span.
pub const RAW_GNSS_INTERVAL_TOLERANCE_MS: u64 = 50;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawGnssPolicy {
    pub version: u32,
    pub mode: String,
    pub min_epochs: usize,
    pub min_satellites: usize,
    pub max_epoch_gap_ms: u64,
    pub max_time_uncertainty_ns: f64,
    /// Separate measurement/system-clock alignment budget. Absence preserves
    /// both the legacy shared quality cap and legacy nominal timing checks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_elapsed_realtime_uncertainty_ns: Option<f64>,
    pub max_pseudorange_rate_uncertainty_mps: f64,
}
impl Default for RawGnssPolicy {
    fn default() -> Self {
        Self {
            version: 1,
            mode: "required".into(),
            min_epochs: 3,
            min_satellites: 4,
            max_epoch_gap_ms: 2500,
            max_time_uncertainty_ns: 100_000.0,
            max_elapsed_realtime_uncertainty_ns: None,
            max_pseudorange_rate_uncertainty_mps: 20.0,
        }
    }
}

impl RawGnssPolicy {
    pub(crate) fn elapsed_uncertainty_limit(&self) -> f64 {
        self.max_elapsed_realtime_uncertainty_ns
            .unwrap_or(self.max_time_uncertainty_ns)
    }
}

/// Additional reported alignment budget only for explicitly opted-in requests.
/// Android reports 68% alignment confidence; this accounting is not a hard bound
/// on physical error, authenticated time, or a changed sensor timestamp.
pub(crate) fn alignment_uncertainty_ns(
    clock: &RawGnssClock,
    policy: &RawGnssPolicy,
) -> Option<u64> {
    let Some(limit) = policy.max_elapsed_realtime_uncertainty_ns else {
        return Some(0);
    };
    // Quality is checked separately in clock_fields. A bounded above-cap first
    // candidate still needs its timing evaluated before it can be discarded.
    (bounded(limit, 1.0, 100_000_000.0)
        && bounded(
            clock.elapsed_realtime_uncertainty_ns,
            0.0,
            9_007_199_254_740_991.0,
        ))
    .then(|| clock.elapsed_realtime_uncertainty_ns.ceil() as u64)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawGnssTrace {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub anchor_elapsed_realtime_ns: String,
    /// Requests full tracking where Android supports it; not proof it occurred.
    pub full_tracking_requested: bool,
    /// Target cadence with a fixed 50ms tolerance. No best-of sampling.
    pub collection_interval_ms: u64,
    /// Incomplete/insufficient warmup epochs before the first retained epoch.
    pub rejected_epoch_count: u32,
    #[serde(deserialize_with = "bounded_epochs")]
    pub epochs: Vec<RawGnssEpoch>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawGnssEpoch {
    pub sequence: usize,
    pub observed_elapsed_ms: u64,
    pub clock: RawGnssClock,
    #[serde(deserialize_with = "bounded_measurements")]
    pub measurements: Vec<RawGnssMeasurement>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawGnssClock {
    pub time_ns: String,
    pub full_bias_ns: String,
    pub bias_ns: Option<f64>,
    pub bias_uncertainty_ns: Option<f64>,
    /// Android permits omission because this can be the reference clock itself.
    pub time_uncertainty_ns: Option<f64>,
    pub drift_ns_per_second: Option<f64>,
    pub drift_uncertainty_ns_per_second: Option<f64>,
    pub hardware_clock_discontinuity_count: u32,
    pub elapsed_realtime_ns: String,
    pub elapsed_realtime_uncertainty_ns: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawGnssMeasurement {
    pub constellation: u8,
    pub svid: u16,
    pub state: u32,
    pub received_sv_time_ns: String,
    pub received_sv_time_uncertainty_ns: String,
    pub time_offset_ns: f64,
    pub cn0_dbhz: f64,
    pub pseudorange_rate_mps: f64,
    pub pseudorange_rate_uncertainty_mps: f64,
    pub carrier_frequency_hz: Option<f64>,
    pub code_type: Option<String>,
    pub accumulated_delta_range_state: u32,
    pub accumulated_delta_range_m: Option<f64>,
    pub accumulated_delta_range_uncertainty_m: Option<f64>,
    pub automatic_gain_control_db: Option<f64>,
}

/// `ready` means this policy's consistency predicates pass. It is not a trust
/// score or evidence of RF authenticity. False capability flags stay explicit.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct RawGnssChecks {
    pub required: bool,
    pub present: bool,
    pub ready: bool,
    pub policy_valid: bool,
    pub source_valid: bool,
    pub bounds_valid: bool,
    pub epoch_count_valid: bool,
    pub epoch_sequence_valid: bool,
    pub clock_fields_valid: bool,
    pub clock_continuity_valid: bool,
    pub collection_alignment_valid: bool,
    pub measurement_fields_valid: bool,
    pub satellite_count_valid: bool,
    pub coverage_valid: bool,
    pub freshness_valid: bool,
    pub epoch_count: usize,
    pub min_qualifying_satellites: usize,
    pub satellite_authentication_verified: bool,
    pub independent_position_recomputed: bool,
    pub collection_attested: bool,
    pub error_codes: Vec<String>,
    /// Unsigned quality interpretation only for an explicit alignment policy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing_quality: Option<RawGnssTimingQuality>,
    /// Coordinate-free diagnostic detail only; it never changes an admission predicate.
    /// Older serialized check reports omit this additive field.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_diagnostics: Vec<RawGnssFieldDiagnostic>,
}

/// Derived quality does not change the signed evidence or establish sensor trust.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawGnssTimingQuality {
    pub reported_max_elapsed_uncertainty_ns: Option<f64>,
    pub requested_max_elapsed_uncertainty_ns: f64,
    pub confidence_percent: u8,
    pub continuity_semantics: String,
    pub precise_clock_stability_proven: bool,
    pub physical_error_bound_proven: bool,
}
fn timing_quality(raw: &RawGnssTrace, policy: &RawGnssPolicy) -> Option<RawGnssTimingQuality> {
    let cap = policy.max_elapsed_realtime_uncertainty_ns?;
    if !bounded(cap, 1.0, 100_000_000.0) {
        return None;
    }
    let reported = if raw.epochs.is_empty() || raw.epochs.len() > MAX_RAW_GNSS_EPOCHS {
        None
    } else {
        raw.epochs.iter().try_fold(0.0_f64, |maximum, epoch| {
            let value = epoch.clock.elapsed_realtime_uncertainty_ns;
            bounded(value, 0.0, 9_007_199_254_740_991.0).then(|| maximum.max(value))
        })
    };
    Some(RawGnssTimingQuality {
        reported_max_elapsed_uncertainty_ns: reported,
        requested_max_elapsed_uncertainty_ns: cap,
        confidence_percent: 68,
        continuity_semantics: "compatible-with-reported-uncertainty".into(),
        precise_clock_stability_proven: false,
        physical_error_bound_proven: false,
    })
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct RawGnssFieldDiagnostic {
    pub field: String,
    pub reason: String,
    pub count: u32,
    /// Unsigned diagnostic projection of bounded clock uncertainty only, in ns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reported_max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_max: Option<f64>,
}

// Count bounds apply while deserializing, before a malicious array is allocated
// in full. The overall byte limit additionally bounds strings/nested payloads.
fn bounded_vec<'de, D, T, const N: usize>(d: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Visitor<T, const N: usize>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>, const N: usize> de::Visitor<'de> for Visitor<T, N> {
        type Value = Vec<T>;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            write!(f, "an array of at most {N} elements")
        }
        fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut out = Vec::with_capacity(seq.size_hint().unwrap_or(0).min(N));
            while let Some(item) = seq.next_element()? {
                if out.len() == N {
                    return Err(de::Error::custom("Location array exceeds element limit"));
                }
                out.push(item);
            }
            Ok(out)
        }
    }
    d.deserialize_seq(Visitor::<T, N>(PhantomData))
}
pub(super) fn bounded_samples<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Sample>, D::Error> {
    bounded_vec::<D, Sample, 128>(d)
}
fn bounded_epochs<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<RawGnssEpoch>, D::Error> {
    bounded_vec::<D, RawGnssEpoch, MAX_RAW_GNSS_EPOCHS>(d)
}
fn bounded_measurements<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Vec<RawGnssMeasurement>, D::Error> {
    bounded_vec::<D, RawGnssMeasurement, MAX_RAW_GNSS_MEASUREMENTS>(d)
}

fn bounded(value: f64, min: f64, max: f64) -> bool {
    value.is_finite() && (min..=max).contains(&value)
}
fn uint(value: &str) -> Option<u64> {
    if value.is_empty() || value.len() > 20 || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let parsed = value.parse::<u64>().ok()?;
    (parsed.to_string() == value).then_some(parsed)
}
fn sint(value: &str) -> Option<i64> {
    if value.is_empty() || value.len() > 20 {
        return None;
    }
    let parsed = value.parse::<i64>().ok()?;
    (parsed.to_string() == value).then_some(parsed)
}

pub(super) fn policy_valid(p: &Policy) -> bool {
    p.raw_gnss.as_ref().is_none_or(|r| {
        r.version == 1
            && r.mode == "required"
            && p.profile == "native-required"
            && p.required_provider == "gnss"
            && (3..=MAX_RAW_GNSS_EPOCHS).contains(&r.min_epochs)
            && (4..=64).contains(&r.min_satellites)
            && (1500..=5000).contains(&r.max_epoch_gap_ms)
            && bounded(r.max_time_uncertainty_ns, 1.0, 1_000_000.0)
            && r.max_elapsed_realtime_uncertainty_ns
                .is_none_or(|limit| bounded(limit, 1.0, 100_000_000.0))
            && bounded(r.max_pseudorange_rate_uncertainty_mps, 0.001, 100.0)
    })
}

fn clock_fields(clock: &RawGnssClock, p: &RawGnssPolicy) -> bool {
    clock_structure_valid(clock)
        && clock
            .bias_uncertainty_ns
            .is_none_or(|v| v <= p.max_time_uncertainty_ns)
        && clock
            .time_uncertainty_ns
            .is_none_or(|v| v <= p.max_time_uncertainty_ns)
        && clock.elapsed_realtime_uncertainty_ns <= p.elapsed_uncertainty_limit()
}

// Structural validity is distinct from acquisition quality. Only the collection
// state machine may discard finite, nonnegative over-policy startup uncertainty;
// every retained epoch still passes clock_fields during sealing and verification.
fn clock_structure_valid(clock: &RawGnssClock) -> bool {
    sint(&clock.time_ns).is_some()
        && sint(&clock.full_bias_ns).is_some()
        && uint(&clock.elapsed_realtime_ns).is_some()
        && clock.bias_ns.is_none_or(|v| bounded(v, -1e12, 1e12))
        && clock
            .bias_uncertainty_ns
            .is_none_or(|v| bounded(v, 0.0, f64::MAX))
        && clock
            .time_uncertainty_ns
            .is_none_or(|v| bounded(v, 0.0, f64::MAX))
        && clock
            .drift_ns_per_second
            .is_none_or(|v| bounded(v, -1e9, 1e9))
        && clock
            .drift_uncertainty_ns_per_second
            .is_none_or(|v| bounded(v, 0.0, 1e9))
        && bounded(clock.elapsed_realtime_uncertainty_ns, 0.0, f64::MAX)
}

// Android GnssStatus SVID ranges, including GLONASS's FCN+100 representation.
fn satellite_id(m: &RawGnssMeasurement) -> bool {
    match m.constellation {
        1 => (1..=32).contains(&m.svid),
        2 => (120..=151).contains(&m.svid) || (183..=192).contains(&m.svid),
        3 => (1..=25).contains(&m.svid) || (93..=106).contains(&m.svid),
        4 => (183..=212).contains(&m.svid),
        5 => (1..=63).contains(&m.svid),
        6 => (1..=36).contains(&m.svid),
        7 => (1..=14).contains(&m.svid),
        _ => false,
    }
}
fn measurement_fields(m: &RawGnssMeasurement) -> bool {
    // Full time-of-week/day bounds are deliberately broader than partial code
    // lock ranges; partial/ambiguous observations are retained but do not count.
    let period_ns = if m.constellation == 3 {
        86_400_000_000_000
    } else {
        604_800_000_000_000
    };
    satellite_id(m)
        && m.state & !0x1ffff == 0
        && uint(&m.received_sv_time_ns).is_some_and(|v| v < period_ns)
        && uint(&m.received_sv_time_uncertainty_ns).is_some_and(|v| v <= 604_800_000_000_000)
        && bounded(m.time_offset_ns, -1e9, 1e9)
        && bounded(m.cn0_dbhz, 0.0, 100.0)
        && bounded(m.pseudorange_rate_mps, -20_000.0, 20_000.0)
        && bounded(m.pseudorange_rate_uncertainty_mps, 0.0, 20_000.0)
        && m.carrier_frequency_hz.is_none_or(|v| bounded(v, 1e8, 3e9))
        // Preserve optional code representations; basic consistency does not identify a signal.
        && m.code_type.as_ref().is_none_or(|v| {
            v.len() <= 16
                && v.bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        })
        && m.accumulated_delta_range_state & !31 == 0
        && m.accumulated_delta_range_m
            .is_none_or(|v| bounded(v, -1e12, 1e12))
        && m.accumulated_delta_range_uncertainty_m
            .is_none_or(|v| bounded(v, 0.0, 1e12))
        && (m.accumulated_delta_range_m.is_some()
            == m.accumulated_delta_range_uncertainty_m.is_some())
        && (m.accumulated_delta_range_state & 1 == 0 || m.accumulated_delta_range_m.is_some())
        && m.automatic_gain_control_db
            .is_none_or(|v| bounded(v, -1000.0, 1000.0))
}
// Compare unknown signal identities conservatively without rewriting evidence.
fn signal_code_identity(m: &RawGnssMeasurement) -> Option<&str> {
    m.code_type.as_deref().filter(|value| !value.is_empty())
}
fn qualifies(m: &RawGnssMeasurement, p: &RawGnssPolicy) -> bool {
    let time_known = if m.constellation == 3 {
        m.state & (128 | 32768) != 0
    } else {
        m.state & (8 | 16384) != 0
    };
    let code_lock = m.state & (1 | 1024 | 2048 | 65536) != 0;
    // GLONASS FCN does not uniquely identify an orbital satellite; keep it but
    // do not count it as an independent SV until its orbital slot is known.
    measurement_fields(m)
        && !(m.constellation == 3 && m.svid >= 93)
        && code_lock
        && time_known
        && m.state & 16 == 0
        && m.cn0_dbhz > 0.0
        && uint(&m.received_sv_time_uncertainty_ns)
            .is_some_and(|v| v as f64 <= p.max_time_uncertainty_ns)
        && m.pseudorange_rate_uncertainty_mps <= p.max_pseudorange_rate_uncertainty_mps
}

fn measurement_elapsed(epoch: &RawGnssEpoch, anchor: u64) -> Option<u64> {
    uint(&epoch.clock.elapsed_realtime_ns)?
        .checked_sub(anchor)
        .map(|ns| ns / 1_000_000)
}
fn continuous(a: &RawGnssEpoch, b: &RawGnssEpoch, policy: &RawGnssPolicy) -> bool {
    let (Some(at), Some(bt), Some(ae), Some(be), Some(ab), Some(bb)) = (
        sint(&a.clock.time_ns),
        sint(&b.clock.time_ns),
        uint(&a.clock.elapsed_realtime_ns),
        uint(&b.clock.elapsed_realtime_ns),
        sint(&a.clock.full_bias_ns),
        sint(&b.clock.full_bias_ns),
    ) else {
        return false;
    };
    // Use integer differences before converting small deltas to f64. Never
    // round a ~1e18 ns timestamp through floating point.
    let receiver_delta = bt as i128 - at as i128;
    let gps_delta = receiver_delta - (bb as i128 - ab as i128);
    let elapsed_delta = be as i128 - ae as i128;
    let bias_delta = b.clock.bias_ns.unwrap_or(0.0) - a.clock.bias_ns.unwrap_or(0.0);
    let Some(uncertainty) = alignment_uncertainty_ns(&a.clock, policy)
        .zip(alignment_uncertainty_ns(&b.clock, policy))
        .and_then(|(a, b)| a.checked_add(b))
    else {
        return false;
    };
    // Alignment precision is not receiver-clock drift. Explicit mode checks
    // compatibility with reported uncertainty; task age/span retain their own
    // conservative budgets. Legacy absence contributes zero, exactly as before.
    let Some(compatibility_budget) = 100_000_000_u64.checked_add(uncertainty) else {
        return false;
    };
    a.clock.hardware_clock_discontinuity_count == b.clock.hardware_clock_discontinuity_count
        && receiver_delta > 0
        && elapsed_delta > 0
        && (receiver_delta - elapsed_delta).abs() <= i128::from(compatibility_budget)
        && ((gps_delta - elapsed_delta) as f64 - bias_delta).abs() <= compatibility_budget as f64
}

/// Also usable as native collection progress: an incomplete trace returns
/// machine-readable count/coverage errors; malformed epochs never become ready.
pub fn evaluate_raw_gnss(trace: &Trace) -> RawGnssChecks {
    evaluate_at(trace, trace.ended_at_ms)
}

pub(super) fn evaluate_at(trace: &Trace, sealed_at_ms: u64) -> RawGnssChecks {
    let mut c = RawGnssChecks {
        required: trace.request.policy.raw_gnss.is_some(),
        present: trace.raw_gnss.is_some(),
        policy_valid: policy_valid(&trace.request.policy),
        ..RawGnssChecks::default()
    };
    if !c.required && !c.present {
        c.ready = true;
        return c;
    }
    let Some(p) = trace.request.policy.raw_gnss.as_ref() else {
        c.error_codes.push("RAW_GNSS_UNREQUESTED".into());
        return c;
    };
    let Some(raw) = trace.raw_gnss.as_ref() else {
        c.error_codes.push("RAW_GNSS_REQUIRED".into());
        return c;
    };
    c.timing_quality = timing_quality(raw, p);
    c.source_valid =
        trace.profile == "native-android" && trace.samples.iter().all(|s| s.provider == "gps");
    c.bounds_valid = raw.version == 1
        && raw.kind == "android-raw-gnss"
        && raw.collection_interval_ms == RAW_GNSS_INTERVAL_MS
        && raw.rejected_epoch_count <= 4096
        && raw.epochs.len() <= MAX_RAW_GNSS_EPOCHS
        && raw.epochs.iter().all(|e| {
            !e.measurements.is_empty() && e.measurements.len() <= MAX_RAW_GNSS_MEASUREMENTS
        });
    c.epoch_count = raw.epochs.len();
    c.epoch_count_valid = raw.epochs.len() >= p.min_epochs;
    c.epoch_sequence_valid = raw.epochs.iter().enumerate().all(|(i, e)| e.sequence == i)
        && raw
            .epochs
            .windows(2)
            .all(|e| e[1].observed_elapsed_ms > e[0].observed_elapsed_ms);
    c.clock_fields_valid = uint(&raw.anchor_elapsed_realtime_ns).is_some()
        && raw.epochs.iter().all(|e| clock_fields(&e.clock, p));
    c.clock_continuity_valid =
        c.clock_fields_valid && raw.epochs.windows(2).all(|e| continuous(&e[0], &e[1], p));
    c.collection_alignment_valid = timing::alignment(trace, raw, p);
    c.measurement_fields_valid = raw.epochs.iter().all(|e| {
        let mut identities = BTreeSet::new();
        e.measurements.iter().all(|m| {
            measurement_fields(m)
                && identities.insert((
                    m.constellation,
                    m.svid,
                    m.carrier_frequency_hz.map(f64::to_bits),
                    signal_code_identity(m),
                ))
        })
    });
    c.min_qualifying_satellites = raw
        .epochs
        .iter()
        .map(|e| {
            e.measurements
                .iter()
                .filter(|m| qualifies(m, p))
                .map(|m| (m.constellation, m.svid))
                .collect::<BTreeSet<_>>()
                .len()
        })
        .min()
        .unwrap_or(0);
    c.satellite_count_valid = c.min_qualifying_satellites >= p.min_satellites;
    c.coverage_valid = if p.max_elapsed_realtime_uncertainty_ns.is_some() {
        timing::coverage(trace, raw, p)
    } else {
        uint(&raw.anchor_elapsed_realtime_ns).is_some_and(|anchor| {
            let elapsed: Option<Vec<_>> = raw
                .epochs
                .iter()
                .map(|e| measurement_elapsed(e, anchor))
                .collect();
            elapsed.is_some_and(|times| {
                match (
                    times.first(),
                    times.last(),
                    trace.samples.first(),
                    trace.samples.last(),
                ) {
                    (Some(first), Some(last), Some(first_fix), Some(last_fix)) => {
                        last.saturating_sub(*first) >= trace.request.policy.duration_ms
                            && times.windows(2).all(|t| {
                                t[1] > t[0]
                                    && t[1] - t[0]
                                        >= RAW_GNSS_INTERVAL_MS - RAW_GNSS_INTERVAL_TOLERANCE_MS
                                    && t[1] - t[0] <= p.max_epoch_gap_ms
                            })
                            && first_fix
                                .fix_elapsed_ms
                                .is_some_and(|fix| *first <= fix.saturating_add(p.max_epoch_gap_ms))
                            && last_fix
                                .fix_elapsed_ms
                                .is_some_and(|fix| last.saturating_add(p.max_epoch_gap_ms) >= fix)
                    }
                    _ => false,
                }
            })
        })
    };
    c.freshness_valid = if p.max_elapsed_realtime_uncertainty_ns.is_some() {
        timing::freshness(trace, raw, p, sealed_at_ms)
    } else {
        uint(&raw.anchor_elapsed_realtime_ns).is_some_and(|anchor| {
            raw.epochs
                .last()
                .and_then(|e| measurement_elapsed(e, anchor))
                .is_some_and(|elapsed| {
                    trace.elapsed_ms.saturating_sub(elapsed) <= trace.request.policy.max_fix_age_ms
                        && super::validation::finalization_within_policy(
                            trace,
                            sealed_at_ms,
                            trace.started_at_ms.saturating_add(elapsed),
                        )
                })
        })
    };
    for (passed, code) in [
        (c.policy_valid, "RAW_GNSS_POLICY"),
        (c.source_valid, "RAW_GNSS_SOURCE"),
        (c.bounds_valid, "RAW_GNSS_BOUNDS"),
        (c.epoch_count_valid, "RAW_GNSS_EPOCH_COUNT"),
        (c.epoch_sequence_valid, "RAW_GNSS_SEQUENCE"),
        (c.clock_fields_valid, "RAW_GNSS_CLOCK_FIELDS"),
        (c.clock_continuity_valid, "RAW_GNSS_CLOCK_CONTINUITY"),
        (c.collection_alignment_valid, "RAW_GNSS_ALIGNMENT"),
        (c.measurement_fields_valid, "RAW_GNSS_MEASUREMENT_FIELDS"),
        (c.satellite_count_valid, "RAW_GNSS_SATELLITE_COUNT"),
        (c.coverage_valid, "RAW_GNSS_COVERAGE"),
        (c.freshness_valid, "RAW_GNSS_FRESHNESS"),
    ] {
        if !passed {
            c.error_codes.push(code.into());
        }
    }
    c.field_diagnostics = diagnostics::evaluate(raw, p);
    c.ready = c.error_codes.is_empty();
    c
}

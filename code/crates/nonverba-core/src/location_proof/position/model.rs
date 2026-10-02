// SPDX-License-Identifier: AGPL-3.0-only
//! Explicit verifier inputs. Source labels never authenticate navigation data.
use serde::{Deserialize, Serialize};

pub const MAX_NAV_BYTES: usize = 256 * 1024;
pub const MAX_EPHEMERIDES: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PositionPolicy {
    pub version: u32,
    pub nav_sha256: String,
    pub gps_utc_offset_s: u32,
    pub min_satellites: usize,
    pub max_sv_time_uncertainty_ns: f64,
    pub max_pdop: f64,
    pub max_residual_m: f64,
    pub max_weighted_rms: f64,
    pub max_horizontal_difference_m: f64,
    pub max_vertical_difference_m: f64,
    pub max_match_interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub id: String,
    /// Digest of the original independently retained source file, not this JSON.
    pub sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ionosphere {
    pub alpha: [f64; 4],
    pub beta: [f64; 4],
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Navigation {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub source: Source,
    pub ionosphere: Ionosphere,
    pub ephemerides: Vec<Ephemeris>,
}

/// GPS LNAV, SI units and radians, expanded GPS week (never modulo 1024).
/// GPS L1 C/A only. No almanac, precise orbit or multi-constellation fallback.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ephemeris {
    pub svid: u16,
    pub gps_week: u32,
    pub toe_s: f64,
    pub toc_s: f64,
    pub transmission_tow_s: f64,
    pub fit_interval_hours: u32,
    pub iode: u32,
    pub iodc: u32,
    pub health: u32,
    pub ura_m: f64,
    pub sqrt_a_m_sqrt: f64,
    pub e: f64,
    pub delta_n_rad_s: f64,
    pub m0_rad: f64,
    pub omega_rad: f64,
    pub omega0_rad: f64,
    pub omega_dot_rad_s: f64,
    pub i0_rad: f64,
    pub idot_rad_s: f64,
    pub cuc_rad: f64,
    pub cus_rad: f64,
    pub crc_m: f64,
    pub crs_m: f64,
    pub cic_rad: f64,
    pub cis_rad: f64,
    pub af0_s: f64,
    pub af1_s_s: f64,
    pub af2_s_s2: f64,
    pub tgd_s: f64,
}

#[derive(Debug, Serialize)]
pub struct SatelliteResult {
    pub svid: u16,
    pub residual_m: f64,
    pub sigma_m: f64,
    pub elevation_deg: f64,
    pub pseudorange_m: f64,
    pub ephemeris_iode: u32,
}
/// Budget using the receiver's reported 68% alignment uncertainty, not a
/// guaranteed bound on physical timing or authenticated receiver behavior.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct TimingBudget {
    pub nominal_interval_ns: u64,
    pub reported_elapsed_uncertainty_ns: f64,
    pub uncertainty_budget_ns: u64,
    pub quantization_budget_ns: u64,
    pub budgeted_interval_ns: u64,
}
impl TimingBudget {
    pub(super) fn new(nominal: u64, reported: f64, uncertainty: u64) -> Self {
        Self {
            nominal_interval_ns: nominal,
            reported_elapsed_uncertainty_ns: reported,
            uncertainty_budget_ns: uncertainty,
            // Native fixes and the wall-clock origin retain whole milliseconds.
            // Their omitted sub-millisecond part cannot be treated as zero.
            quantization_budget_ns: 1_000_000,
            budgeted_interval_ns: nominal
                .saturating_add(uncertainty)
                .saturating_add(1_000_000),
        }
    }
}
#[derive(Debug, Serialize)]
pub struct EpochResult {
    pub sequence: usize,
    pub measurement_elapsed_ms: u64,
    #[serde(skip)]
    pub(super) measurement_elapsed_ns: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clock_alignment: Option<TimingBudget>,
    pub computed: bool,
    pub consistency_passed: bool,
    pub ecef_m: Option<[f64; 3]>,
    pub latitude_deg: Option<f64>,
    pub longitude_deg: Option<f64>,
    pub ellipsoid_height_m: Option<f64>,
    pub receiver_clock_bias_m: Option<f64>,
    pub pdop: Option<f64>,
    pub weighted_rms: Option<f64>,
    pub satellites: Vec<SatelliteResult>,
    pub excluded: Vec<String>,
    pub errors: Vec<String>,
}
impl EpochResult {
    pub(super) fn empty(sequence: usize, elapsed: u64) -> Self {
        Self {
            sequence,
            measurement_elapsed_ms: elapsed,
            measurement_elapsed_ns: elapsed.saturating_mul(1_000_000),
            clock_alignment: None,
            computed: false,
            consistency_passed: false,
            ecef_m: None,
            latitude_deg: None,
            longitude_deg: None,
            ellipsoid_height_m: None,
            receiver_clock_bias_m: None,
            pdop: None,
            weighted_rms: None,
            satellites: Vec::new(),
            excluded: Vec::new(),
            errors: Vec::new(),
        }
    }
}
#[derive(Debug, Serialize)]
pub struct ClaimComparison {
    pub sample_sequence: usize,
    pub epoch_sequence: usize,
    pub interval_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_alignment: Option<TimingBudget>,
    pub horizontal_difference_m: f64,
    pub vertical_difference_m: Option<f64>,
    pub passed: bool,
}
#[derive(Debug, Serialize)]
pub struct PositionReport {
    pub version: u32,
    pub method: &'static str,
    pub verified: bool,
    pub evidence_verified: bool,
    pub nav_digest_match: bool,
    pub navigation_sha256: String,
    pub navigation_source: Source,
    pub policy: PositionPolicy,
    pub independent_position_recomputed: bool,
    pub consistency_passed: bool,
    pub reported_location_consistent: bool,
    pub epochs: Vec<EpochResult>,
    pub comparisons: Vec<ClaimComparison>,
    pub satellite_authentication_verified: bool,
    pub navigation_source_authenticated: bool,
    pub collection_attested: bool,
    pub physical_location_proven: bool,
    pub clock_trusted: bool,
    pub errors: Vec<String>,
    pub location_verification: super::super::Verification,
}

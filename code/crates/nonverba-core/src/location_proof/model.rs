// SPDX-License-Identifier: AGPL-3.0-only
//! Strict, versioned location protocol types. Times are safe integer milliseconds.
use crate::Challenge;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub profile: String,
    pub required_provider: String,
    pub duration_ms: u64,
    pub min_samples: usize,
    pub max_accuracy_m: f64,
    pub max_fix_age_ms: u64,
    pub max_delivery_delay_ms: u64,
    /// Optional end-of-collection to finalization allowance. Absence preserves
    /// the legacy last-fix-at-sealing age rule; never inferred from evidence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_finalization_delay_ms: Option<u64>,
    pub max_speed_mps: f64,
    /// An absent policy preserves v1 collection. A present policy is mandatory;
    /// unsupported devices must not silently fall back to coordinate-only proof.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_gnss: Option<super::raw_gnss::RawGnssPolicy>,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            profile: "browser-or-native".into(),
            required_provider: "any".into(),
            duration_ms: 10_000,
            min_samples: 3,
            max_accuracy_m: 100.0,
            max_fix_age_ms: 5_000,
            max_delivery_delay_ms: 3_000,
            max_finalization_delay_ms: None,
            max_speed_mps: 100.0,
            raw_gnss: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Context {
    pub session_id: String,
    pub purpose: String,
    /// Explicit camera composition semantics; absent keeps the final-sample binding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera_timing: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub challenge: Challenge,
    #[serde(default, skip_serializing_if = "is_false")]
    pub demo: bool,
    pub policy: Policy,
    pub context: Option<Context>,
}
fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sample {
    pub sequence: usize,
    pub observed_elapsed_ms: u64,
    pub fix_timestamp_ms: u64,
    /// Native fix elapsedRealtime minus the request's native collection anchor.
    /// Null in browser proofs, where this independent timestamp is unavailable.
    pub fix_elapsed_ms: Option<u64>,
    pub provider: String,
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy_m: f64,
    pub altitude_m: Option<f64>,
    pub altitude_accuracy_m: Option<f64>,
    pub mock: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trace {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub request: Request,
    pub profile: String,
    pub permission_precision: String,
    pub uncertainty_semantics: String,
    pub capture_correlation: String,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub elapsed_ms: u64,
    #[serde(deserialize_with = "super::raw_gnss::bounded_samples")]
    pub samples: Vec<Sample>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_gnss: Option<super::raw_gnss::RawGnssTrace>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssetBinding {
    pub kind: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub trace: Trace,
    pub sealed_at_ms: u64,
    pub public_spki_der_b64: String,
    /// A signed source claim, not remote attestation of its implementation.
    pub key_protection: String,
    pub asset: Option<AssetBinding>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Checks {
    pub signature_integrity: bool,
    pub device_match: bool,
    pub request_match: bool,
    pub policy_valid: bool,
    pub source_claim_matches_policy: bool,
    pub sample_count_valid: bool,
    pub sequence_valid: bool,
    pub collection_duration_valid: bool,
    pub clock_consistent: bool,
    pub fix_freshness_valid: bool,
    pub accuracy_valid: bool,
    pub motion_consistent: bool,
    pub mock_locations_rejected: bool,
    pub uncertainty_semantics_valid: bool,
    pub capture_time_in_window: bool,
    pub capture_not_in_future: bool,
    pub asset_binding: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Verification {
    pub verified: bool,
    pub checks: Checks,
    pub profile: String,
    pub demo: bool,
    pub key_protection: String,
    pub device_fingerprint: String,
    pub selected_location: Option<Sample>,
    pub evidence: Option<Evidence>,
    pub hardware_attested: bool,
    pub collection_attested: bool,
    pub location_authenticity_proven: bool,
    pub clock_trusted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_gnss: Option<super::raw_gnss::RawGnssChecks>,
    pub errors: Vec<String>,
}

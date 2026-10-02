// SPDX-License-Identifier: AGPL-3.0-only
pub use crate::live_session::{ByteBinding, KeyPin, PinKind, ReceiptTiming};
use crate::{agent_appraisal::EvidencePolicy, audio::AudioRequest, location_proof, Challenge};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "type",
    content = "request",
    rename_all = "kebab-case",
    deny_unknown_fields
)]
pub enum Evidence {
    Image(Challenge),
    Location(location_proof::Request),
    CameraLocation(location_proof::Request),
    Audio(AudioRequest),
}

fn nullable<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperatorPins {
    #[serde(deserialize_with = "nullable")]
    pub media_certificate_sha256: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub location_spki_sha256: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Delivery {
    pub max_response_ms: u64,
    pub max_receipt_age_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionSpec {
    pub version: u32,
    pub evidence: Evidence,
    pub operator_pins: OperatorPins,
    pub policy: EvidencePolicy,
    pub delivery: Delivery,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionRequest {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub session_id: String,
    pub created_at_ms: u64,
    pub requester_pin: KeyPin,
    pub requester_public_spki_der_b64: String,
    pub spec: SessionSpec,
    pub sensor_nonce: String,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
    pub sensor_request_binding: ByteBinding,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestEnvelope {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub cose_b64: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionReceipt {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub session_id: String,
    pub request_binding: ByteBinding,
    pub primary_binding: ByteBinding,
    pub secondary_binding: ByteBinding,
    pub audio_transcript_binding: ByteBinding,
    pub context_binding: ByteBinding,
    pub requester_pin: KeyPin,
    pub requester_public_spki_der_b64: String,
    pub timing: ReceiptTiming,
    pub sealed_at_ms: u64,
    pub demo: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptEnvelope {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub request_cose_b64: String,
    pub receipt_cose_b64: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionChecks {
    pub request_authenticated: bool,
    pub receipt_authenticated: bool,
    pub original_request_match: bool,
    pub session_binding: bool,
    pub artifact_bindings: bool,
    pub context_binding: bool,
    pub timing_consistent: bool,
    pub response_deadline_met: bool,
    pub minimum_interval_met: bool,
    pub prompt_dispatch: bool,
    pub recorded_window_valid: bool,
    pub sealing_time_valid: bool,
    pub not_future: bool,
    pub evidence_verified: bool,
    pub evidence_policy_satisfied: bool,
    pub key_roles_separated: bool,
    pub sample_precedes_reception: bool,
    pub demo_marker_valid: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionVerification {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub verified: bool,
    pub fresh_action_eligible: bool,
    pub demo: bool,
    pub checks: SessionChecks,
    pub request: Option<SessionRequest>,
    pub request_binding: Option<ByteBinding>,
    pub receipt: Option<SessionReceipt>,
    /// Produced internally by the matching verifier, never accepted as input.
    pub appraisal: Option<Value>,
    pub acceptance_recorded: bool,
    pub local_replay_checked: bool,
    pub global_replay_checked: bool,
    pub requester_clock_trusted: bool,
    pub independent_requester_proven: bool,
    pub physical_measurement_authenticity_proven: bool,
    pub errors: Vec<String>,
}

impl crate::live_session::RequesterKey for SessionRequest {
    fn public_key(&self) -> &str {
        &self.requester_public_spki_der_b64
    }
}
impl crate::live_session::RequesterKey for SessionReceipt {
    fn public_key(&self) -> &str {
        &self.requester_public_spki_der_b64
    }
}

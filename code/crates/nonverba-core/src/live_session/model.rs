// SPDX-License-Identifier: AGPL-3.0-only
use crate::location_proof;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PinKind {
    RequesterSpkiSha256,
    OperatorLocationSpkiSha256,
    OperatorCameraCertificateSha256,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyPin {
    #[serde(rename = "type")]
    pub kind: PinKind,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ByteBinding {
    pub sha256: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionRequest {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub session_id: String,
    pub created_at_ms: u64,
    pub requester_pin: KeyPin,
    pub operator_pin: KeyPin,
    pub requester_public_spki_der_b64: String,
    pub location_request: location_proof::Request,
    pub location_request_binding: ByteBinding,
    pub min_response_ms: u64,
    pub max_response_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestEnvelope {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub cose_b64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptTiming {
    pub sent_at_ms: u64,
    pub received_at_ms: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionReceipt {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub session_id: String,
    pub request_binding: ByteBinding,
    pub location_request_binding: ByteBinding,
    pub artifact_binding: ByteBinding,
    pub operator_pin: KeyPin,
    pub requester_pin: KeyPin,
    pub requester_public_spki_der_b64: String,
    pub timing: ReceiptTiming,
    pub sealed_at_ms: u64,
    pub demo: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptEnvelope {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub request_cose_b64: String,
    pub receipt_cose_b64: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SessionChecks {
    pub request_signature_integrity: bool,
    pub receipt_signature_integrity: bool,
    pub requester_pin_match: bool,
    pub operator_pin_match: bool,
    pub key_roles_separated: bool,
    pub original_request_match: bool,
    pub session_binding: bool,
    pub artifact_binding: bool,
    pub request_policy_valid: bool,
    pub timing_consistent: bool,
    pub response_deadline_met: bool,
    pub minimum_interval_met: bool,
    pub recorded_window_valid: bool,
    pub sealing_time_valid: bool,
    pub not_future: bool,
    pub location_proof_valid: bool,
    pub demo_marker_valid: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionVerification {
    /// Signatures, bindings and policy assertions pass under the supplied pins.
    pub verified: bool,
    /// Time-window eligibility only. Local atomic replay/acceptance is external.
    pub fresh_action_eligible: bool,
    pub demo: bool,
    pub checks: SessionChecks,
    pub request: Option<SessionRequest>,
    pub receipt: Option<SessionReceipt>,
    pub location_verification: Option<location_proof::Verification>,
    pub requester_clock_trusted: bool,
    pub physical_freshness_proven: bool,
    pub independent_requester_proven: bool,
    pub global_replay_checked: bool,
    pub replay_status: String,
    pub acceptance_requires_local_replay_check: bool,
    pub acceptance_recorded: bool,
    pub errors: Vec<String>,
}

pub(crate) trait RequesterKey {
    fn public_key(&self) -> &str;
}
impl RequesterKey for SessionRequest {
    fn public_key(&self) -> &str {
        &self.requester_public_spki_der_b64
    }
}
impl RequesterKey for SessionReceipt {
    fn public_key(&self) -> &str {
        &self.requester_public_spki_der_b64
    }
}

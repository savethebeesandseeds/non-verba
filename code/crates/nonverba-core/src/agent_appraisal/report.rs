// SPDX-License-Identifier: AGPL-3.0-only
//! Typed sensor composition. JSON diagnostics remain presentation data.
use super::{context::AdditionalEvidence, EvidencePolicy};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
#[serde(untagged)]
pub(crate) enum SensorVerification {
    Image(Box<crate::Verification>),
    Location(Box<crate::location_proof::Verification>),
    CameraLocation(Box<crate::camera_location::CameraLocationVerification>),
    Audio(Box<crate::audio::AudioVerification>),
}

impl SensorVerification {
    pub(crate) fn sensor(&self) -> &'static str {
        match self {
            Self::Image(_) | Self::CameraLocation(_) => "image",
            Self::Location(_) => "location",
            Self::Audio(_) => "audio",
        }
    }

    pub(crate) fn verified(&self) -> bool {
        match self {
            Self::Image(report) => report.verified,
            Self::Location(report) => report.verified,
            Self::CameraLocation(report) => report.image.verified,
            Self::Audio(report) => report.verified,
        }
    }

    pub(crate) fn image(&self) -> Option<&crate::Verification> {
        match self {
            Self::Image(report) => Some(report),
            Self::CameraLocation(report) => Some(&report.image),
            _ => None,
        }
    }

    pub(crate) fn location(&self) -> Option<&crate::location_proof::Verification> {
        match self {
            Self::Location(report) => Some(report),
            Self::CameraLocation(report) => Some(&report.location),
            _ => None,
        }
    }

    pub(crate) fn audio(&self) -> Option<&crate::audio::AudioVerification> {
        match self {
            Self::Audio(report) => Some(report),
            _ => None,
        }
    }

    pub(crate) fn signer_spki(&self) -> &str {
        match self {
            Self::Image(report) => &report.signer_spki_sha256,
            Self::Location(report) => &report.device_fingerprint,
            Self::CameraLocation(report) => &report.image.signer_spki_sha256,
            Self::Audio(report) => &report.signer_spki_sha256,
        }
    }

    pub(crate) fn composed(&self) -> bool {
        matches!(self, Self::CameraLocation(_))
    }

    fn native(&self) -> bool {
        match self {
            Self::Image(report) => report.checks.native_camera_metadata_valid == Some(true),
            Self::CameraLocation(report) => {
                report.image.checks.native_camera_metadata_valid == Some(true)
            }
            Self::Location(report) => report
                .evidence
                .as_ref()
                .is_some_and(|evidence| evidence.trace.profile == "native-android"),
            Self::Audio(report) => report.checks.native_audio_metadata_valid == Some(true),
        }
    }

    fn demo(&self) -> bool {
        match self {
            Self::Location(report) => report.demo,
            Self::Audio(report) => report.demo,
            _ => false,
        }
    }
}

#[derive(Serialize)]
struct PolicyCheck {
    name: &'static str,
    required: bool,
    established: bool,
    policy_passed: bool,
}

#[derive(Serialize)]
pub(crate) struct AppraisalReport {
    version: u32,
    #[serde(rename = "type")]
    kind: &'static str,
    sensor: &'static str,
    policy: EvidencePolicy,
    pub(crate) evidence_verified: bool,
    pub(crate) policy_satisfied: bool,
    request_window_open: bool,
    pub(crate) demo: bool,
    fresh_action_eligible: bool,
    checks: Vec<PolicyCheck>,
    missing_requirements: Vec<&'static str>,
    acceptance_recorded: bool,
    local_replay_checked: bool,
    global_replay_checked: bool,
    physical_measurement_authenticity_proven: bool,
    device_clock_trusted: bool,
    additional_evidence: AdditionalEvidence,
    pub(crate) verification: SensorVerification,
}

pub(super) fn appraise_report(
    report: SensorVerification,
    request: &Value,
    policy: EvidencePolicy,
    now: u64,
    additional: AdditionalEvidence,
) -> AppraisalReport {
    let sensor = report.sensor();
    let valid = report.verified();
    let native = report.native();
    let requirements = [
        (
            "native_acquisition_metadata",
            policy.native_acquisition_required,
            native,
        ),
        (
            "audio_recording_monitoring",
            policy.audio_recording_monitoring_required.unwrap_or(false),
            native
                && report
                    .audio()
                    .and_then(|r| r.native_audio.as_ref())
                    .is_some_and(|metadata| metadata.recording_configuration.is_some()),
        ),
        (
            "raw_gnss_consistency",
            policy.raw_gnss_required,
            report.location().is_some_and(|location| {
                location.verified
                    && location
                        .raw_gnss
                        .as_ref()
                        .is_some_and(|checks| checks.ready)
            }),
        ),
        (
            "correlated_camera_clock",
            policy.correlated_camera_clock_required,
            native
                && report
                    .image()
                    .and_then(|r| r.native_camera.as_ref())
                    .is_some_and(|metadata| metadata.timestamp_source == "realtime"),
        ),
        // Only independently revalidated, actual-credential-bound extra evidence
        // can satisfy these requirements. Local KeyInfo and operator reports cannot.
        (
            "remote_hardware_attestation",
            policy.hardware_attestation_required,
            additional.key_attested,
        ),
        (
            "independent_position_recomputation",
            policy.independent_position_required,
            additional.position_verified,
        ),
    ];
    let checks = requirements
        .iter()
        .map(|(name, required, observed)| PolicyCheck {
            name,
            required: *required,
            established: valid && *observed,
            policy_passed: !*required || (valid && *observed),
        })
        .collect();
    let missing: Vec<_> = requirements
        .iter()
        .filter(|(_, required, observed)| *required && (!valid || !observed))
        .map(|(name, _, _)| *name)
        .collect();
    let satisfied = valid && missing.is_empty();
    // Retain the original request representation: normalization would change
    // signed input bytes. Only output/report composition uses native types.
    let challenge =
        if sensor == "audio" || (sensor == "image" && request.get("challenge").is_none()) {
            request
        } else {
            &request["challenge"]
        };
    let window_open = challenge["issued_at"]
        .as_u64()
        .is_some_and(|issued| now >= issued)
        && challenge["expires_at"]
            .as_u64()
            .is_some_and(|expiry| now < expiry);
    let demo = request["demo"] == true || report.demo();
    AppraisalReport {
        version: 1,
        kind: "nonverba-agent-appraisal",
        sensor,
        policy,
        evidence_verified: valid,
        policy_satisfied: satisfied,
        request_window_open: window_open,
        demo,
        fresh_action_eligible: satisfied && window_open && !demo,
        checks,
        missing_requirements: missing,
        acceptance_recorded: false,
        local_replay_checked: false,
        global_replay_checked: false,
        physical_measurement_authenticity_proven: false,
        device_clock_trusted: false,
        additional_evidence: additional,
        verification: report,
    }
}

pub(super) fn appraisal_json(report: &AppraisalReport) -> Result<String, String> {
    // Existing appraisal transports were built as JSON Values. Preserve their
    // recursively sorted object keys while native callers retain typed reports.
    serde_json::to_string(&serde_json::to_value(report).map_err(crate::err)?).map_err(crate::err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn typed_appraisal_preserves_legacy_transport_shape_and_key_order() {
        let now = 2_000_000_000.0;
        let request_json = crate::location_proof::create_location_request(
            "requester",
            "transport compatibility",
            now,
            60,
            "null",
            "null",
        )
        .unwrap();
        let request: Value = serde_json::from_str(&request_json).unwrap();
        let verification = crate::location_proof::verify_location_proof_report(
            &[],
            &request_json,
            &"0".repeat(64),
            "null",
            now,
        )
        .unwrap();
        let verification_value = serde_json::to_value(&verification).unwrap();
        let policy = EvidencePolicy {
            version: 1,
            native_acquisition_required: false,
            raw_gnss_required: false,
            correlated_camera_clock_required: false,
            hardware_attestation_required: false,
            independent_position_required: false,
            audio_recording_monitoring_required: None,
        };
        let policy_value = serde_json::to_value(&policy).unwrap();
        let report = appraise_report(
            SensorVerification::Location(Box::new(verification)),
            &request,
            policy,
            now as u64,
            AdditionalEvidence::default(),
        );
        let checks: Vec<Value> = [
            "native_acquisition_metadata",
            "audio_recording_monitoring",
            "raw_gnss_consistency",
            "correlated_camera_clock",
            "remote_hardware_attestation",
            "independent_position_recomputation",
        ]
        .into_iter()
        .map(|name| {
            json!({
                "name":name,"required":false,"established":false,"policy_passed":true,
            })
        })
        .collect();
        // This is the previous externally visible envelope, including null
        // context fields, omitted v1 monitoring requirement and sorted keys.
        let expected = json!({
            "version":1,"type":"nonverba-agent-appraisal","sensor":"location",
            "policy":policy_value,"evidence_verified":false,"policy_satisfied":false,
            "request_window_open":true,"demo":false,"fresh_action_eligible":false,
            "checks":checks,"missing_requirements":[],
            "acceptance_recorded":false,"local_replay_checked":false,"global_replay_checked":false,
            "physical_measurement_authenticity_proven":false,"device_clock_trusted":false,
            "additional_evidence":{"key_attested":false,"position_verified":false,
                "signing_key":null,"location_key":null,"position":null},
            "verification":verification_value,
        });
        assert_eq!(appraisal_json(&report).unwrap(), expected.to_string());
    }
}

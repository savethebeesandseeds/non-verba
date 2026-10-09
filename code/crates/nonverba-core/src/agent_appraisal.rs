// SPDX-License-Identifier: AGPL-3.0-only
//! Caller-retained agent acceptance policies, applied after real verification.
//! A policy result describes evidence available under explicit pins, not truth
//! of a scene, remote attestation, global replay protection or a trusted clock.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

mod context;
mod report;
use report::{appraisal_json, appraise_report};
pub(crate) use report::{AppraisalReport, SensorVerification};
#[cfg(test)]
#[path = "agent_appraisal/context_tests.rs"]
mod context_tests;
pub use context::{
    appraise_audio_with_context, appraise_camera_location_with_context,
    appraise_image_with_context, appraise_location_with_context,
};
pub(crate) use context::{
    appraise_audio_with_context_report, appraise_camera_location_with_context_report,
    appraise_image_with_context_report, appraise_location_with_context_report,
};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidencePolicy {
    pub version: u32,
    pub native_acquisition_required: bool,
    pub raw_gnss_required: bool,
    pub correlated_camera_clock_required: bool,
    pub hardware_attestation_required: bool,
    pub independent_position_required: bool,
    /// Version 1 must omit this field; version 2 must supply a boolean. Keeping
    /// absence distinct preserves canonical v1 policies inside signed requests.
    #[serde(
        default,
        deserialize_with = "monitoring_requirement",
        skip_serializing_if = "Option::is_none"
    )]
    pub audio_recording_monitoring_required: Option<bool>,
}

fn monitoring_requirement<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<bool>, D::Error> {
    bool::deserialize(deserializer).map(Some)
}

impl EvidencePolicy {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if !matches!(
            (self.version, self.audio_recording_monitoring_required),
            (1, None) | (2, Some(_))
        ) {
            return Err("Evidence policy v1 must omit audio recording monitoring; v2 must explicitly require or decline it".into());
        }
        Ok(())
    }
}

fn policy(text: &str) -> Result<EvidencePolicy, String> {
    if text.len() > 4096 {
        return Err("Agent evidence policy exceeds its limit".into());
    }
    let result: EvidencePolicy = serde_json::from_str(text).map_err(crate::err)?;
    result.validate()?;
    Ok(result)
}

fn request_value(text: &str) -> Result<Value, String> {
    if text.len() > 64 * 1024 {
        return Err("Agent original request exceeds its limit".into());
    }
    serde_json::from_str(text).map_err(crate::err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn appraise_location(
    proof: &[u8],
    request_json: &str,
    expected_pin: &str,
    expected_asset_json: &str,
    policy_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let now = crate::seconds(now_secs)?;
    let report = crate::location_proof::verify_location_proof_report(
        proof,
        request_json,
        expected_pin,
        expected_asset_json,
        now_secs,
    )?;
    appraisal_json(&appraise_report(
        SensorVerification::Location(Box::new(report)),
        &request,
        policy,
        now,
        context::AdditionalEvidence::default(),
    ))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub async fn appraise_image(
    jpeg: &[u8],
    request_json: &str,
    expected_pin: &str,
    policy_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let now = crate::seconds(now_secs)?;
    let report = crate::verify_image_report(jpeg, request_json, expected_pin, now_secs).await?;
    appraisal_json(&appraise_report(
        SensorVerification::Image(Box::new(report)),
        &request,
        policy,
        now,
        context::AdditionalEvidence::default(),
    ))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub async fn appraise_camera_location(
    jpeg: &[u8],
    proof: &[u8],
    request_json: &str,
    camera_pin: &str,
    location_pin: &str,
    policy_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let now = crate::seconds(now_secs)?;
    let report = crate::camera_location::verify_image_with_location_proof_report(
        jpeg,
        proof,
        request_json,
        camera_pin,
        location_pin,
        now_secs,
    )
    .await?;
    appraisal_json(&appraise_report(
        SensorVerification::CameraLocation(Box::new(report)),
        &request,
        policy,
        now,
        context::AdditionalEvidence::default(),
    ))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub async fn appraise_audio(
    wav: &[u8],
    request_json: &str,
    original_transcript_json: &str,
    expected_pin: &str,
    policy_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let now = crate::seconds(now_secs)?;
    let report = crate::audio::verify_audio_report(
        wav,
        request_json,
        original_transcript_json,
        expected_pin,
        now_secs,
    )
    .await?;
    appraisal_json(&appraise_report(
        SensorVerification::Audio(Box::new(report)),
        &request,
        policy,
        now,
        context::AdditionalEvidence::default(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    const NOW: f64 = 2_000_000_000.0;
    fn basic_policy() -> EvidencePolicy {
        EvidencePolicy {
            version: 1,
            native_acquisition_required: false,
            raw_gnss_required: false,
            correlated_camera_clock_required: false,
            hardware_attestation_required: false,
            independent_position_required: false,
            audio_recording_monitoring_required: None,
        }
    }

    #[test]
    fn signed_browser_location_cannot_satisfy_native_or_attestation_requirements() {
        let identity = crate::create_identity().unwrap();
        let key: Value =
            serde_json::from_str(&crate::location_proof::location_identity(&identity).unwrap())
                .unwrap();
        let request = crate::location_proof::create_location_request(
            "agent",
            "measure location",
            NOW,
            60,
            "null",
            "null",
        )
        .unwrap();
        let request_value: Value = serde_json::from_str(&request).unwrap();
        let samples: Vec<Value> = [0, 5000, 10000].into_iter().enumerate().map(|(sequence, elapsed)| json!({
            "sequence":sequence,"observed_elapsed_ms":elapsed,"fix_elapsed_ms":null,"fix_timestamp_ms":NOW as u64 * 1000 + elapsed,
            "provider":"browser-geolocation","latitude":47.4979,"longitude":19.0402,"accuracy_m":10,
            "altitude_m":null,"altitude_accuracy_m":null,"mock":null
        })).collect();
        let trace = json!({"version":1,"type":"nonverba-location-trace","request":request_value,
            "profile":"software-browser","permission_precision":"browser","uncertainty_semantics":"w3c-95-percent",
            "capture_correlation":"none","started_at_ms":NOW as u64 * 1000,"ended_at_ms":NOW as u64 * 1000 + 10000,
            "elapsed_ms":10000,"samples":samples});
        let proof = crate::location_proof::seal_location_proof(
            &trace.to_string(),
            &identity,
            "null",
            NOW + 10.0,
        )
        .unwrap();
        let mut policy = basic_policy();
        let evaluate = |policy: &EvidencePolicy, pin: &str, at| -> Value {
            serde_json::from_str(
                &appraise_location(
                    &proof,
                    &request,
                    pin,
                    "null",
                    &serde_json::to_string(policy).unwrap(),
                    at,
                )
                .unwrap(),
            )
            .unwrap()
        };
        let pin = key["fingerprint"].as_str().unwrap();
        assert_eq!(evaluate(&policy, pin, NOW + 11.0)["policy_satisfied"], true);
        assert_eq!(
            evaluate(&policy, pin, NOW + 61.0)["fresh_action_eligible"],
            false
        );
        assert_eq!(
            evaluate(&policy, &"0".repeat(64), NOW + 11.0)["policy_satisfied"],
            false
        );
        policy.native_acquisition_required = true;
        let report = evaluate(&policy, pin, NOW + 11.0);
        assert_eq!(report["evidence_verified"], true);
        assert_eq!(report["policy_satisfied"], false);
        policy.hardware_attestation_required = true;
        policy.raw_gnss_required = true;
        assert_eq!(
            evaluate(&policy, pin, NOW + 11.0)["missing_requirements"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
    }

    #[test]
    fn unrecognized_policy_requirements_are_not_ignored() {
        let mut value = serde_json::to_value(basic_policy()).unwrap();
        value["satellite_authentication_required"] = json!(true);
        assert!(policy(&value.to_string()).is_err());
        assert!(policy("{\"version\":1}").is_err());
    }

    #[test]
    fn policy_versions_preserve_v1_bytes_and_require_explicit_v2_monitoring() {
        let v1 = serde_json::to_string(&basic_policy()).unwrap();
        assert_eq!(
            v1,
            r#"{"version":1,"native_acquisition_required":false,"raw_gnss_required":false,"correlated_camera_clock_required":false,"hardware_attestation_required":false,"independent_position_required":false}"#
        );
        assert_eq!(serde_json::to_string(&policy(&v1).unwrap()).unwrap(), v1);
        let original: Value = serde_json::from_str(&v1).unwrap();
        for version in [1, 2, 3] {
            for field in [
                None,
                Some(json!(null)),
                Some(json!(false)),
                Some(json!(true)),
                Some(json!("true")),
            ] {
                let mut value = original.clone();
                value["version"] = json!(version);
                if let Some(field) = &field {
                    value["audio_recording_monitoring_required"] = field.clone();
                }
                let expected = version == 1 && field.is_none()
                    || version == 2 && field.as_ref().is_some_and(Value::is_boolean);
                assert_eq!(policy(&value.to_string()).is_ok(), expected, "{value}");
            }
        }
        let mut v2 = original;
        v2["version"] = json!(2);
        v2["audio_recording_monitoring_required"] = json!(true);
        for key in [
            "native_acquisition_required",
            "raw_gnss_required",
            "correlated_camera_clock_required",
            "hardware_attestation_required",
            "independent_position_required",
        ] {
            let mut missing = v2.clone();
            missing.as_object_mut().unwrap().remove(key);
            assert!(policy(&missing.to_string()).is_err());
        }
        v2["recording_monitor_verified"] = json!(true);
        assert!(policy(&v2.to_string()).is_err());
    }
}

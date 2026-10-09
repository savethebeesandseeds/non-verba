// SPDX-License-Identifier: AGPL-3.0-only
//! Account-bound Operator face enrollment continuity using selected 128D features.
//!
//! The caller performs inference; this policy normalizes, checks the pinned model
//! contract and compares features. It does not establish legal identity, live
//! human presence, trusted camera acquisition or a calibrated error rate. Model
//! outputs and imported reports alone can never authenticate an account or grant
//! sensor/work authority. Requester workflows do not require or enroll faces.

use crate::authentication::{identifier, AuthenticationContext, AuthenticationMode};
use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub const FACE_DIMENSIONS: usize = 128;
// The parent pins these to the retrieved checkpoint and reviewed export before
// enabling the adapter. An unpinned build fails closed rather than accepting an
// arbitrary model supplied by a caller under a familiar family name.
pub const CHECKPOINT_SHA256: &str =
    "90a00ba1d8b0b688af3deb731ed53dca582e6106805d1bc3cfdef55f570493f4";
pub const ARTIFACT_SHA256: &str =
    "1efc0e9098b219466bb54c82a971e08da11e29267aee6f7f9c1fd13274b7f7ec";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaceModelSpec {
    pub id: String,
    pub version: String,
    pub checkpoint_sha256: String,
    pub artifact_sha256: String,
    pub preprocessing: String,
    pub aggregation: String,
    pub dimensions: u32,
    pub runtime: String,
    pub precision: String,
    pub alignment: String,
}

pub fn selected_model() -> FaceModelSpec {
    FaceModelSpec {
        id: "qualcomm-foamliu-mobilefacenet-128d".into(),
        version: "operator-face-mobilefacenet128-qaihub064-v1".into(),
        checkpoint_sha256: CHECKPOINT_SHA256.into(),
        artifact_sha256: ARTIFACT_SHA256.into(),
        preprocessing: "rgb112-nchw-f32-imagenet-meanstd-v1".into(),
        aggregation: "original-plus-horizontal-flip-sum-then-l2-v1".into(),
        dimensions: FACE_DIMENSIONS as u32,
        runtime: "onnxruntime-web-1.23.2-wasm-cpu-single-thread".into(),
        precision: "float32".into(),
        alignment: "yunet-2023mar-320-bgr-score0.8-nms0.3-five-point-similarity-bilinear-112-v1"
            .into(),
    }
}

impl FaceModelSpec {
    pub fn is_selected(&self) -> bool {
        fn digest(value: &str) -> bool {
            value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        }
        digest(CHECKPOINT_SHA256) && digest(ARTIFACT_SHA256) && self == &selected_model()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaceBinding {
    pub account_id: String,
    pub principal_id: String,
    pub device_id: String,
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaceReference {
    pub reference_id: String,
    pub account_id: String,
    pub principal_id: String,
    pub enrolled_device_id: String,
    pub enrollment_operation_id: String,
    pub enrolled_at: u64,
    pub model: FaceModelSpec,
    pub embedding: Vec<f64>,
    pub simulation: bool,
}

impl FaceReference {
    pub fn valid_for(&self, account: &str, principal: &str, model: &FaceModelSpec) -> bool {
        [
            &self.reference_id,
            &self.account_id,
            &self.principal_id,
            &self.enrolled_device_id,
            &self.enrollment_operation_id,
        ]
        .iter()
        .all(|value| identifier(value).is_ok())
            && self.account_id == account
            && self.principal_id == principal
            && self.model.is_selected()
            && &self.model == model
            && normalized(&self.embedding).is_some()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FaceQuality {
    Accepted,
    Failed,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FaceStatus {
    NotRequired,
    ConsentRequired,
    EnrollmentMissing,
    Enrolled,
    CaptureQualityFailure,
    ModelUnavailable,
    ModelIncompatible,
    ReferenceScopeMismatch,
    ThresholdUnconfigured,
    ThresholdInvalid,
    Match,
    Nonmatch,
    LivenessUnresolved,
    TrustedCaptureUnresolved,
    ThresholdUncalibrated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaceReport {
    pub status: FaceStatus,
    pub states: Vec<FaceStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<FaceReference>,
    pub reference_id: Option<String>,
    pub binding: FaceBinding,
    pub evaluated_at: u64,
    pub model: Option<FaceModelSpec>,
    pub cosine_similarity: Option<f64>,
    pub embedding_match: Option<bool>,
    pub threshold: Option<f64>,
    pub threshold_calibrated: bool,
    pub authenticated: bool,
    pub identity_verified: bool,
    pub operator_presence_verified: bool,
    pub liveness: String,
    pub trusted_capture: String,
    pub simulation: bool,
    pub work_authority_granted: bool,
    pub enrollment_continuity_only: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaceEnrollInput {
    pub now_secs: u64,
    pub mode: AuthenticationMode,
    pub context: AuthenticationContext,
    pub operation_id: String,
    pub reference_id: String,
    pub model: Option<FaceModelSpec>,
    pub embedding: Option<Vec<f64>>,
    pub quality: FaceQuality,
    pub model_available: bool,
    pub deliberate: bool,
    pub consent: bool,
    pub simulation: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaceAssessInput {
    pub now_secs: u64,
    pub mode: AuthenticationMode,
    pub context: AuthenticationContext,
    pub operation_id: String,
    pub model: Option<FaceModelSpec>,
    pub embedding: Option<Vec<f64>>,
    pub quality: FaceQuality,
    pub model_available: bool,
    pub reference: Option<FaceReference>,
    pub threshold: Option<f64>,
    pub simulation: bool,
}

fn report(
    context: &AuthenticationContext,
    operation: &str,
    now: u64,
    model: Option<FaceModelSpec>,
    simulation: bool,
    status: FaceStatus,
) -> FaceReport {
    let states = if status == FaceStatus::NotRequired {
        vec![status]
    } else {
        vec![
            status,
            FaceStatus::LivenessUnresolved,
            FaceStatus::TrustedCaptureUnresolved,
            FaceStatus::ThresholdUncalibrated,
        ]
    };
    FaceReport {
        status,
        states,
        reference: None,
        reference_id: None,
        binding: FaceBinding {
            account_id: context.account_id.clone(),
            principal_id: context.principal_id.clone(),
            device_id: context.device_id.clone(),
            operation_id: operation.into(),
        },
        evaluated_at: now,
        model,
        cosine_similarity: None,
        embedding_match: None,
        threshold: None,
        threshold_calibrated: false,
        authenticated: false,
        identity_verified: false,
        operator_presence_verified: false,
        liveness: "unresolved".into(),
        trusted_capture: "unresolved".into(),
        simulation,
        work_authority_granted: false,
        enrollment_continuity_only: true,
    }
}

fn validate_binding(context: &AuthenticationContext, operation: &str) -> Result<(), String> {
    context.validate()?;
    identifier(operation)
}

/// Scale first so finite extreme vectors cannot overflow the squared norm.
fn normalized(vector: &[f64]) -> Option<Vec<f64>> {
    if vector.len() != FACE_DIMENSIONS || vector.iter().any(|value| !value.is_finite()) {
        return None;
    }
    let scale = vector
        .iter()
        .fold(0.0f64, |maximum, value| maximum.max(value.abs()));
    if scale == 0.0 {
        return None;
    }
    let norm = vector
        .iter()
        .map(|value| (value / scale).powi(2))
        .sum::<f64>()
        .sqrt();
    if !norm.is_finite() || norm == 0.0 {
        return None;
    }
    Some(vector.iter().map(|value| (value / scale) / norm).collect())
}

fn capture_status(
    model: Option<&FaceModelSpec>,
    available: bool,
    quality: FaceQuality,
    embedding: Option<&[f64]>,
) -> Result<Vec<f64>, FaceStatus> {
    if !available || model.is_none() {
        return Err(FaceStatus::ModelUnavailable);
    }
    if !model.is_some_and(FaceModelSpec::is_selected) {
        return Err(FaceStatus::ModelIncompatible);
    }
    if quality != FaceQuality::Accepted {
        return Err(FaceStatus::CaptureQualityFailure);
    }
    embedding
        .and_then(normalized)
        .ok_or(FaceStatus::CaptureQualityFailure)
}

pub fn enroll(input: FaceEnrollInput) -> Result<FaceReport, String> {
    validate_binding(&input.context, &input.operation_id)?;
    identifier(&input.reference_id)?;
    let mut output = report(
        &input.context,
        &input.operation_id,
        input.now_secs,
        input.model.clone(),
        input.simulation,
        FaceStatus::Enrolled,
    );
    let status = if input.mode == AuthenticationMode::Requester {
        Some(FaceStatus::NotRequired)
    } else if !input.deliberate || !input.consent {
        Some(FaceStatus::ConsentRequired)
    } else {
        None
    };
    if let Some(status) = status {
        return Ok(report(
            &input.context,
            &input.operation_id,
            input.now_secs,
            None,
            input.simulation,
            status,
        ));
    }
    let embedding = match capture_status(
        input.model.as_ref(),
        input.model_available,
        input.quality,
        input.embedding.as_deref(),
    ) {
        Ok(embedding) => embedding,
        Err(status) => {
            return Ok(report(
                &input.context,
                &input.operation_id,
                input.now_secs,
                input.model,
                input.simulation,
                status,
            ))
        }
    };
    output.reference_id = Some(input.reference_id.clone());
    output.reference = Some(FaceReference {
        reference_id: input.reference_id,
        account_id: input.context.account_id,
        principal_id: input.context.principal_id,
        enrolled_device_id: input.context.device_id,
        enrollment_operation_id: input.operation_id,
        enrolled_at: input.now_secs,
        model: input.model.expect("capture_status checked the model"),
        embedding,
        simulation: input.simulation,
    });
    Ok(output)
}

pub fn assess(input: FaceAssessInput) -> Result<FaceReport, String> {
    validate_binding(&input.context, &input.operation_id)?;
    let mut output = report(
        &input.context,
        &input.operation_id,
        input.now_secs,
        input.model.clone(),
        input.simulation,
        FaceStatus::Match,
    );
    let fail = |status| {
        report(
            &input.context,
            &input.operation_id,
            input.now_secs,
            input.model.clone(),
            input.simulation,
            status,
        )
    };
    if input.mode == AuthenticationMode::Requester {
        return Ok(report(
            &input.context,
            &input.operation_id,
            input.now_secs,
            None,
            input.simulation,
            FaceStatus::NotRequired,
        ));
    }
    let Some(reference) = &input.reference else {
        return Ok(fail(FaceStatus::EnrollmentMissing));
    };
    let embedding = match capture_status(
        input.model.as_ref(),
        input.model_available,
        input.quality,
        input.embedding.as_deref(),
    ) {
        Ok(embedding) => embedding,
        Err(status) => return Ok(fail(status)),
    };
    let model = input
        .model
        .as_ref()
        .expect("capture_status checked the model");
    if reference.account_id != input.context.account_id
        || reference.principal_id != input.context.principal_id
        || reference.enrolled_at > input.now_secs
    {
        return Ok(fail(FaceStatus::ReferenceScopeMismatch));
    }
    if !reference.valid_for(
        &input.context.account_id,
        &input.context.principal_id,
        model,
    ) {
        return Ok(fail(FaceStatus::ModelIncompatible));
    }
    let Some(threshold) = input.threshold else {
        return Ok(fail(FaceStatus::ThresholdUnconfigured));
    };
    if !threshold.is_finite() || !(-1.0..=1.0).contains(&threshold) {
        return Ok(fail(FaceStatus::ThresholdInvalid));
    }
    let enrolled = normalized(&reference.embedding).expect("reference.valid_for checked vector");
    let similarity = embedding
        .iter()
        .zip(enrolled)
        .map(|(current, enrolled)| current * enrolled)
        .sum::<f64>()
        .clamp(-1.0, 1.0);
    let matched = similarity >= threshold;
    output.status = if matched {
        FaceStatus::Match
    } else {
        FaceStatus::Nonmatch
    };
    output.states[0] = output.status;
    output.cosine_similarity = Some(similarity);
    output.embedding_match = Some(matched);
    output.threshold = Some(threshold);
    output.reference_id = Some(reference.reference_id.clone());
    output.simulation |= reference.simulation;
    Ok(output)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn face_identity_enroll(input_json: &str) -> Result<String, String> {
    serde_json::to_string(&enroll(crate::parse(input_json)?)?).map_err(crate::err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn face_identity_assess(input_json: &str) -> Result<String, String> {
    serde_json::to_string(&assess(crate::parse(input_json)?)?).map_err(crate::err)
}

#[cfg(test)]
pub(crate) fn fixture_context() -> AuthenticationContext {
    AuthenticationContext {
        account_id: "account".into(),
        principal_id: "person".into(),
        device_id: "device-a".into(),
        session_id: "session-a".into(),
        task_id: Some("task-a".into()),
    }
}

#[cfg(test)]
pub(crate) fn fixture_reference(simulation: bool) -> FaceReference {
    let mut embedding = vec![0.0; FACE_DIMENSIONS];
    embedding[0] = 3.0;
    embedding[1] = 4.0;
    enroll(FaceEnrollInput {
        now_secs: 99,
        mode: AuthenticationMode::Operator,
        context: fixture_context(),
        operation_id: "enrollment-a".into(),
        reference_id: "reference-a".into(),
        model: Some(selected_model()),
        embedding: Some(embedding),
        quality: FaceQuality::Accepted,
        model_available: true,
        deliberate: true,
        consent: true,
        simulation,
    })
    .unwrap()
    .reference
    .expect("The selected manifest must be pinned before validation")
}

#[cfg(test)]
pub(crate) fn fixture_comparison(operation: &str, simulation: bool) -> FaceReport {
    let reference = fixture_reference(simulation);
    assess(FaceAssessInput {
        now_secs: 104,
        mode: AuthenticationMode::Operator,
        context: fixture_context(),
        operation_id: operation.into(),
        model: Some(selected_model()),
        embedding: Some(reference.embedding.clone()),
        quality: FaceQuality::Accepted,
        model_available: true,
        reference: Some(reference),
        threshold: Some(0.5),
        simulation,
    })
    .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> FaceAssessInput {
        let reference = fixture_reference(false);
        FaceAssessInput {
            now_secs: 104,
            mode: AuthenticationMode::Operator,
            context: fixture_context(),
            operation_id: "auth-a".into(),
            model: Some(selected_model()),
            embedding: Some(reference.embedding.clone()),
            quality: FaceQuality::Accepted,
            model_available: true,
            reference: Some(reference),
            threshold: Some(0.5),
            simulation: false,
        }
    }

    #[test]
    fn normalization_requires_exact_finite_nonzero_128d_and_handles_extreme_values() {
        assert!(normalized(&vec![1.0; 512]).is_none());
        assert!(normalized(&vec![0.0; FACE_DIMENSIONS]).is_none());
        assert!(normalized(&vec![f64::NAN; FACE_DIMENSIONS]).is_none());
        let mut vector = vec![0.0; FACE_DIMENSIONS];
        vector[0] = 3.0e300;
        vector[1] = 4.0e300;
        let normalized = normalized(&vector).unwrap();
        assert!((normalized[0] - 0.6).abs() < 1e-12);
        assert!((normalized[1] - 0.8).abs() < 1e-12);
        assert!((normalized.iter().map(|value| value * value).sum::<f64>() - 1.0).abs() < 1e-12);
    }

    #[test]
    fn match_and_nonmatch_do_not_establish_live_presence_trusted_capture_or_authority() {
        let matched = assess(request()).unwrap();
        assert_eq!(matched.status, FaceStatus::Match);
        assert_eq!(matched.embedding_match, Some(true));
        assert!((matched.cosine_similarity.unwrap() - 1.0).abs() < 1e-12);
        assert!(
            !matched.authenticated
                && !matched.identity_verified
                && !matched.operator_presence_verified
        );
        assert!(!matched.work_authority_granted && !matched.threshold_calibrated);
        assert!(matched.states.contains(&FaceStatus::LivenessUnresolved));
        assert!(matched
            .states
            .contains(&FaceStatus::TrustedCaptureUnresolved));
        let mut different = request();
        different.embedding = different
            .embedding
            .map(|vector| vector.into_iter().map(|value| -value).collect());
        let nonmatch = assess(different).unwrap();
        assert_eq!(nonmatch.status, FaceStatus::Nonmatch);
        assert_eq!(nonmatch.embedding_match, Some(false));
    }

    #[test]
    fn missing_reference_quality_failure_model_unavailability_and_thresholds_are_distinct() {
        let mut missing = request();
        missing.reference = None;
        assert_eq!(
            assess(missing).unwrap().status,
            FaceStatus::EnrollmentMissing
        );
        let mut failed = request();
        failed.quality = FaceQuality::Failed;
        assert_eq!(
            assess(failed).unwrap().status,
            FaceStatus::CaptureQualityFailure
        );
        let mut unavailable = request();
        unavailable.model_available = false;
        assert_eq!(
            assess(unavailable).unwrap().status,
            FaceStatus::ModelUnavailable
        );
        let mut unconfigured = request();
        unconfigured.threshold = None;
        assert_eq!(
            assess(unconfigured).unwrap().status,
            FaceStatus::ThresholdUnconfigured
        );
        let mut invalid = request();
        invalid.threshold = Some(1.01);
        assert_eq!(
            assess(invalid).unwrap().status,
            FaceStatus::ThresholdInvalid
        );
    }

    #[test]
    fn full_selected_model_contract_is_pinned_and_cannot_be_substituted_consistently() {
        assert!(selected_model().is_selected());
        for field in [
            "checkpoint",
            "artifact",
            "preprocessing",
            "aggregation",
            "alignment",
            "runtime",
            "precision",
            "dimension",
        ] {
            let mut input = request();
            let model = input.model.as_mut().unwrap();
            match field {
                "checkpoint" => model.checkpoint_sha256 = "0".repeat(64),
                "artifact" => model.artifact_sha256 = "0".repeat(64),
                "preprocessing" => model.preprocessing = "other".into(),
                "aggregation" => model.aggregation = "other".into(),
                "alignment" => model.alignment = "other".into(),
                "runtime" => model.runtime = "other".into(),
                "precision" => model.precision = "int8".into(),
                "dimension" => model.dimensions = 512,
                _ => unreachable!(),
            }
            // Even two mutually matching imported descriptors cannot bypass pins.
            input.reference.as_mut().unwrap().model = model.clone();
            assert_eq!(
                assess(input).unwrap().status,
                FaceStatus::ModelIncompatible,
                "{field}"
            );
        }
    }

    #[test]
    fn references_are_account_principal_bound_and_simulation_is_contagious() {
        for field in ["account", "principal", "future"] {
            let mut input = request();
            let reference = input.reference.as_mut().unwrap();
            match field {
                "account" => reference.account_id = "other".into(),
                "principal" => reference.principal_id = "other".into(),
                "future" => reference.enrolled_at = 105,
                _ => unreachable!(),
            }
            assert_eq!(
                assess(input).unwrap().status,
                FaceStatus::ReferenceScopeMismatch
            );
        }
        let mut synthetic_reference = request();
        synthetic_reference.reference.as_mut().unwrap().simulation = true;
        let report = assess(synthetic_reference).unwrap();
        assert!(report.simulation);
        assert!(!report.authenticated);
    }

    #[test]
    fn requester_never_enrolls_or_matches_faces_and_operator_requires_deliberate_consent() {
        let mut requester = request();
        requester.mode = AuthenticationMode::Requester;
        let report = assess(requester).unwrap();
        assert_eq!(report.status, FaceStatus::NotRequired);
        assert_eq!(report.embedding_match, None);
        let input = FaceEnrollInput {
            now_secs: 99,
            mode: AuthenticationMode::Requester,
            context: fixture_context(),
            operation_id: "enrollment-a".into(),
            reference_id: "reference-a".into(),
            model: Some(selected_model()),
            embedding: Some(vec![1.0; FACE_DIMENSIONS]),
            quality: FaceQuality::Accepted,
            model_available: true,
            deliberate: true,
            consent: true,
            simulation: false,
        };
        let report = enroll(input).unwrap();
        assert_eq!(report.status, FaceStatus::NotRequired);
        assert!(report.reference.is_none());
        let report = enroll(FaceEnrollInput {
            now_secs: 99,
            mode: AuthenticationMode::Operator,
            context: fixture_context(),
            operation_id: "enrollment-a".into(),
            reference_id: "reference-a".into(),
            model: Some(selected_model()),
            embedding: Some(vec![1.0; FACE_DIMENSIONS]),
            quality: FaceQuality::Accepted,
            model_available: true,
            deliberate: false,
            consent: true,
            simulation: false,
        })
        .unwrap();
        assert_eq!(report.status, FaceStatus::ConsentRequired);
        assert!(report.reference.is_none());
    }
}

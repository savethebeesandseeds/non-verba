// SPDX-License-Identifier: AGPL-3.0-only
//! Independent verifier inputs, never operator-supplied verdicts.
use super::*;

#[derive(Default, Serialize)]
pub(crate) struct AdditionalEvidence {
    pub key_attested: bool,
    pub position_verified: bool,
    pub signing_key: Option<Value>,
    pub location_key: Option<Value>,
    pub position: Option<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VerificationContext {
    version: u32,
    key_attestation: Option<AttestationContext>,
    location_key_attestation: Option<AttestationContext>,
    position: Option<PositionContext>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AttestationContext {
    chain: Value,
    expected: Value,
    trust: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PositionContext {
    /// Exact bytes, pinned by the independently retained policy's digest.
    navigation_json: String,
    policy: Value,
}

fn parse_context(text: &str) -> Result<VerificationContext, String> {
    if text.len() > 4 * 1024 * 1024 {
        return Err("Agent verification context exceeds its limit".into());
    }
    let context: VerificationContext = serde_json::from_str(text).map_err(crate::err)?;
    if context.version != 1 {
        return Err("Unsupported agent verification context".into());
    }
    Ok(context)
}

fn attestation(
    context: Option<&AttestationContext>,
    valid: bool,
    actual_spki: Option<&str>,
    now: f64,
) -> Result<Option<Value>, String> {
    let Some(context) = context else {
        return Ok(None);
    };
    if !valid {
        return Ok(Some(json!({"key_enrollment_attested":false,
            "artifact_key_bound":false,"possession_proven":false,
            "error":"Underlying sensor evidence did not verify"})));
    }
    let actual_spki = actual_spki.ok_or("Verified evidence has no signer SPKI")?;
    if actual_spki.len() != 64
        || context.expected["expected_spki_sha256"].as_str() != Some(actual_spki)
    {
        return Err("Attestation expectation does not match the actual sensor signer key".into());
    }
    let mut result: Value =
        serde_json::from_str(&crate::android_attestation::verify_key_attestation(
            &context.chain.to_string(),
            &context.expected.to_string(),
            &context.trust.to_string(),
            now,
        )?)
        .map_err(crate::err)?;
    // Artifact signature establishes possession; boot/app claims remain at generation.
    result["artifact_key_bound"] = json!(true);
    result["possession_proven"] = json!(true);
    Ok(Some(result))
}
fn attested(report: &Option<Value>) -> bool {
    report.as_ref().is_some_and(|r| {
        r["key_enrollment_attested"] == true
            && r["artifact_key_bound"] == true
            && r["possession_proven"] == true
    })
}

fn additional(
    context: &VerificationContext,
    report: &SensorVerification,
    now: f64,
) -> Result<AdditionalEvidence, String> {
    let sensor = report.sensor();
    let composed = report.composed();
    if !composed && context.location_key_attestation.is_some() {
        return Err(
            "A separate location key applies only to composed camera/location evidence".into(),
        );
    }
    if sensor != "location" && !composed && context.position.is_some() {
        return Err("Position recomputation requires a signed location proof".into());
    }
    let signing_key = attestation(
        context.key_attestation.as_ref(),
        report.verified(),
        Some(report.signer_spki()),
        now,
    )?;
    let location_key = if composed {
        let location = report.location();
        attestation(
            context.location_key_attestation.as_ref(),
            report.verified() && location.is_some_and(|location| location.verified),
            location.map(|location| location.device_fingerprint.as_str()),
            now,
        )?
    } else {
        None
    };
    // Both signers must meet a composed artifact's hardware requirement.
    let key_attested = attested(&signing_key) && (!composed || attested(&location_key));
    Ok(AdditionalEvidence {
        key_attested,
        signing_key,
        location_key,
        ..Default::default()
    })
}

fn recompute_position(
    extra: &mut AdditionalEvidence,
    context: &VerificationContext,
    proof: &[u8],
    request: &str,
    pin: &str,
    asset: &str,
    now: f64,
) -> Result<(), String> {
    if let Some(position) = &context.position {
        let result: Value =
            serde_json::from_str(&crate::location_proof::position::verify_location_position(
                proof,
                request,
                pin,
                asset,
                &position.navigation_json,
                &position.policy.to_string(),
                now,
            )?)
            .map_err(crate::err)?;
        extra.position_verified = result["verified"] == true
            && result["independent_position_recomputed"] == true
            && result["reported_location_consistent"] == true;
        extra.position = Some(result);
    }
    Ok(())
}

/// Context expectations and trust data must come from retained verifier configuration.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn appraise_location_with_context(
    proof: &[u8],
    request_json: &str,
    expected_pin: &str,
    expected_asset_json: &str,
    policy_json: &str,
    context_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    appraisal_json(&appraise_location_with_context_report(
        proof,
        request_json,
        expected_pin,
        expected_asset_json,
        policy_json,
        context_json,
        now_secs,
    )?)
}

pub(crate) fn appraise_location_with_context_report(
    proof: &[u8],
    request_json: &str,
    expected_pin: &str,
    expected_asset_json: &str,
    policy_json: &str,
    context_json: &str,
    now_secs: f64,
) -> Result<AppraisalReport, String> {
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let context = parse_context(context_json)?;
    let now = crate::seconds(now_secs)?;
    let report = SensorVerification::Location(Box::new(
        crate::location_proof::verify_location_proof_report(
            proof,
            request_json,
            expected_pin,
            expected_asset_json,
            now_secs,
        )?,
    ));
    let mut extra = additional(&context, &report, now_secs)?;
    recompute_position(
        &mut extra,
        &context,
        proof,
        request_json,
        expected_pin,
        expected_asset_json,
        now_secs,
    )?;
    Ok(appraise_report(report, &request, policy, now, extra))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub async fn appraise_image_with_context(
    jpeg: &[u8],
    request_json: &str,
    expected_pin: &str,
    policy_json: &str,
    context_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    appraisal_json(
        &appraise_image_with_context_report(
            jpeg,
            request_json,
            expected_pin,
            policy_json,
            context_json,
            now_secs,
        )
        .await?,
    )
}

pub(crate) async fn appraise_image_with_context_report(
    jpeg: &[u8],
    request_json: &str,
    expected_pin: &str,
    policy_json: &str,
    context_json: &str,
    now_secs: f64,
) -> Result<AppraisalReport, String> {
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let context = parse_context(context_json)?;
    let now = crate::seconds(now_secs)?;
    let report = SensorVerification::Image(Box::new(
        crate::verify_image_report(jpeg, request_json, expected_pin, now_secs).await?,
    ));
    let extra = additional(&context, &report, now_secs)?;
    Ok(appraise_report(report, &request, policy, now, extra))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[allow(clippy::too_many_arguments)] // Independent composed pins plus policy/context.
pub async fn appraise_camera_location_with_context(
    jpeg: &[u8],
    proof: &[u8],
    request_json: &str,
    camera_pin: &str,
    location_pin: &str,
    policy_json: &str,
    context_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    appraisal_json(
        &appraise_camera_location_with_context_report(
            jpeg,
            proof,
            request_json,
            camera_pin,
            location_pin,
            policy_json,
            context_json,
            now_secs,
        )
        .await?,
    )
}

#[allow(clippy::too_many_arguments)] // Independent composed pins plus policy/context.
pub(crate) async fn appraise_camera_location_with_context_report(
    jpeg: &[u8],
    proof: &[u8],
    request_json: &str,
    camera_pin: &str,
    location_pin: &str,
    policy_json: &str,
    context_json: &str,
    now_secs: f64,
) -> Result<AppraisalReport, String> {
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let context = parse_context(context_json)?;
    let now = crate::seconds(now_secs)?;
    let report = SensorVerification::CameraLocation(Box::new(
        crate::camera_location::verify_image_with_location_proof_report(
            jpeg,
            proof,
            request_json,
            camera_pin,
            location_pin,
            now_secs,
        )
        .await?,
    ));
    let mut extra = additional(&context, &report, now_secs)?;
    recompute_position(
        &mut extra,
        &context,
        proof,
        request_json,
        location_pin,
        &crate::location_proof::location_asset(jpeg)?,
        now_secs,
    )?;
    Ok(appraise_report(report, &request, policy, now, extra))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub async fn appraise_audio_with_context(
    wav: &[u8],
    request_json: &str,
    original_transcript_json: &str,
    expected_pin: &str,
    policy_json: &str,
    context_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    appraisal_json(
        &appraise_audio_with_context_report(
            wav,
            request_json,
            original_transcript_json,
            expected_pin,
            policy_json,
            context_json,
            now_secs,
        )
        .await?,
    )
}

pub(crate) async fn appraise_audio_with_context_report(
    wav: &[u8],
    request_json: &str,
    original_transcript_json: &str,
    expected_pin: &str,
    policy_json: &str,
    context_json: &str,
    now_secs: f64,
) -> Result<AppraisalReport, String> {
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let context = parse_context(context_json)?;
    let now = crate::seconds(now_secs)?;
    let report = SensorVerification::Audio(Box::new(
        crate::audio::verify_audio_report(
            wav,
            request_json,
            original_transcript_json,
            expected_pin,
            now_secs,
        )
        .await?,
    ));
    let extra = additional(&context, &report, now_secs)?;
    Ok(appraise_report(report, &request, policy, now, extra))
}

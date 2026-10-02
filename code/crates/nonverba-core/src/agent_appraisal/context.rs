// SPDX-License-Identifier: AGPL-3.0-only
//! Independent verifier inputs, never operator-supplied verdicts.
use super::*;

#[derive(Default, Serialize)]
pub(super) struct AdditionalEvidence {
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
    sensor: &str,
    report: &Value,
    composed: bool,
    now: f64,
) -> Result<AdditionalEvidence, String> {
    if !composed && context.location_key_attestation.is_some() {
        return Err(
            "A separate location key applies only to composed camera/location evidence".into(),
        );
    }
    if sensor != "location" && !composed && context.position.is_some() {
        return Err("Position recomputation requires a signed location proof".into());
    }
    let spki = if sensor == "location" {
        &report["device_fingerprint"]
    } else {
        &report["signer_spki_sha256"]
    };
    let signing_key = attestation(
        context.key_attestation.as_ref(),
        report["verified"] == true,
        spki.as_str(),
        now,
    )?;
    let location_key = if composed {
        attestation(
            context.location_key_attestation.as_ref(),
            report["verified"] == true && report["location_proof"]["verified"] == true,
            report["location_proof"]["device_fingerprint"].as_str(),
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
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let context = parse_context(context_json)?;
    let now = crate::seconds(now_secs)?;
    let report: Value = serde_json::from_str(&crate::location_proof::verify_location_proof(
        proof,
        request_json,
        expected_pin,
        expected_asset_json,
        now_secs,
    )?)
    .map_err(crate::err)?;
    let mut extra = additional(&context, "location", &report, false, now_secs)?;
    recompute_position(
        &mut extra,
        &context,
        proof,
        request_json,
        expected_pin,
        expected_asset_json,
        now_secs,
    )?;
    appraise_with_additional("location", report, &request, &policy, now, &extra)
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
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let context = parse_context(context_json)?;
    let now = crate::seconds(now_secs)?;
    let report: Value = serde_json::from_str(
        &crate::verify_image(jpeg, request_json, expected_pin, now_secs).await?,
    )
    .map_err(crate::err)?;
    let extra = additional(&context, "image", &report, false, now_secs)?;
    appraise_with_additional("image", report, &request, &policy, now, &extra)
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
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let context = parse_context(context_json)?;
    let now = crate::seconds(now_secs)?;
    let report: Value = serde_json::from_str(
        &crate::camera_location::verify_image_with_location_proof(
            jpeg,
            proof,
            request_json,
            camera_pin,
            location_pin,
            now_secs,
        )
        .await?,
    )
    .map_err(crate::err)?;
    let mut extra = additional(&context, "image", &report, true, now_secs)?;
    recompute_position(
        &mut extra,
        &context,
        proof,
        request_json,
        location_pin,
        &crate::location_proof::location_asset(jpeg)?,
        now_secs,
    )?;
    appraise_with_additional("image", report, &request, &policy, now, &extra)
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
    let policy = policy(policy_json)?;
    let request = request_value(request_json)?;
    let context = parse_context(context_json)?;
    let now = crate::seconds(now_secs)?;
    let report: Value = serde_json::from_str(
        &crate::audio::verify_audio(
            wav,
            request_json,
            original_transcript_json,
            expected_pin,
            now_secs,
        )
        .await?,
    )
    .map_err(crate::err)?;
    let extra = additional(&context, "audio", &report, false, now_secs)?;
    appraise_with_additional("audio", report, &request, &policy, now, &extra)
}

// SPDX-License-Identifier: AGPL-3.0-only
//! Composition of two independently verifiable proofs. C2PA binds the camera
//! request and location policy; a separate COSE location proof commits to the
//! complete final JPEG. Neither record contains a hash of itself.

use serde_json::Value;

use crate::{err, location::Location, parse, Challenge, Verification};

#[cfg(test)]
#[path = "camera_location_tests.rs"]
mod tests;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub(crate) const PROOF_REQUIRED: &str =
    "This photo requires its matching location proof and independently pinned location key";

/// Native composition retains both typed reports. Its serialized form remains
/// the existing image report, including the presentation-only location field.
#[derive(serde::Serialize)]
#[serde(transparent)]
pub struct CameraLocationVerification {
    pub image: Verification,
    #[serde(skip)]
    pub location: crate::location_proof::Verification,
}

fn camera_request(text: &str, at: f64) -> Result<Value, String> {
    let normalized = crate::location_proof::validate_location_request(text, at)?;
    let request: Value = parse(&normalized)?;
    if request["context"]["purpose"] != "camera" || request["demo"] == true {
        return Err("A camera attachment requires a non-demo camera location request".into());
    }
    Ok(request)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub async fn seal_image_with_location_request(
    image_bytes: &[u8],
    challenge_json: &str,
    identity_json: &str,
    now_secs: f64,
    location_json: &str,
    location_request_json: &str,
) -> Result<Vec<u8>, String> {
    let request = camera_request(location_request_json, now_secs)?;
    let expected: Challenge = parse(challenge_json)?;
    let bound: Challenge = serde_json::from_value(request["challenge"].clone()).map_err(err)?;
    if expected != bound {
        return Err("The photo and location proof must use the same requester challenge".into());
    }
    crate::seal_image_impl(
        image_bytes,
        challenge_json,
        identity_json,
        now_secs,
        location_json,
        Some(request),
    )
    .await
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub async fn verify_image_with_location_proof(
    image_bytes: &[u8],
    proof_bytes: &[u8],
    expected_location_request_json: &str,
    expected_photo_fingerprint: &str,
    expected_location_fingerprint: &str,
    now_secs: f64,
) -> Result<String, String> {
    serde_json::to_string(
        &verify_image_with_location_proof_report(
            image_bytes,
            proof_bytes,
            expected_location_request_json,
            expected_photo_fingerprint,
            expected_location_fingerprint,
            now_secs,
        )
        .await?,
    )
    .map_err(err)
}

/// Typed camera/location composition used before transport serialization.
pub async fn verify_image_with_location_proof_report(
    image_bytes: &[u8],
    proof_bytes: &[u8],
    expected_location_request_json: &str,
    expected_photo_fingerprint: &str,
    expected_location_fingerprint: &str,
    now_secs: f64,
) -> Result<CameraLocationVerification, String> {
    let supplied: Value = parse(expected_location_request_json)?;
    let issued_at = supplied["challenge"]["issued_at"]
        .as_u64()
        .ok_or("The original location request is missing its challenge")?;
    // Historical verification validates the request at issuance; acceptance and
    // replay prevention remain separate requester-side operations.
    let expected = camera_request(expected_location_request_json, issued_at as f64)?;
    let challenge = serde_json::to_string(&expected["challenge"]).map_err(err)?;
    let mut image = crate::verify_image_report(
        image_bytes,
        &challenge,
        expected_photo_fingerprint,
        now_secs,
    )
    .await?;
    image.errors.retain(|message| message != PROOF_REQUIRED);
    let asset = crate::location_proof::location_asset(image_bytes)?;
    let location = crate::location_proof::verify_location_proof_report(
        proof_bytes,
        expected_location_request_json,
        expected_location_fingerprint,
        &asset,
        now_secs,
    )?;
    let capture_matches = image.capture.as_ref().is_some_and(|capture| {
        capture.version == 3
            && capture.location_request.as_ref().is_some_and(|request| {
                crate::camera_capture::same_request_value(request, &expected)
            })
    });
    // A caller may submit arbitrary JPEG bytes to the native location session.
    // Matching the authenticated trace to both the signed assertion and EXIF is
    // essential: the native collector never certifies caller-supplied GPS data.
    let camera_observation = selected_observation(&location, &image, &expected)
        .ok()
        .cloned();
    let selected_matches = camera_observation.as_ref().is_some_and(|sample| {
        crate::location::matches(image_bytes, &sample_location(sample)).is_ok()
    });
    let attached = capture_matches && selected_matches && location.verified;
    image.checks.location_proof_valid = Some(attached);
    let mut location_value = serde_json::to_value(&location).map_err(err)?;
    if attached && expected["context"]["camera_timing"] == "concurrent" {
        // The standalone report's selected_location remains the final trace fix.
        // Identify the distinct, authenticated observation actually bound to the photo.
        location_value["camera_observation"] =
            serde_json::to_value(camera_observation.unwrap()).map_err(err)?;
    }
    if !capture_matches {
        image
            .errors
            .push("The C2PA photo does not bind the original location request".into());
    }
    if !selected_matches {
        image
            .errors
            .push("Photo GPS differs from the location session's selected observation".into());
    }
    if !location.verified {
        image
            .errors
            .push("The attached location proof did not pass verification".into());
    }
    image.location_proof = Some(location_value);
    let checks = &image.checks;
    image.verified = checks.c2pa_integrity
        && checks.challenge_match
        && checks.device_match
        && checks.capture_time_in_window
        && checks.capture_not_in_future
        && checks.location_metadata_valid == Some(true)
        && checks.native_camera_metadata_valid != Some(false)
        && attached;
    Ok(CameraLocationVerification { image, location })
}

fn selected_observation<'a>(
    report: &'a crate::location_proof::Verification,
    image: &Verification,
    expected: &Value,
) -> Result<&'a crate::location_proof::Sample, String> {
    let samples = &report
        .evidence
        .as_ref()
        .ok_or("Location proof has no observations")?
        .trace
        .samples;
    let capture = image
        .capture
        .as_ref()
        .ok_or("Photo has no capture assertion")?;
    let embedded = capture.location.as_ref().ok_or("Photo has no GPS report")?;
    if expected["context"]["camera_timing"] != "concurrent" {
        let sample = samples
            .last()
            .ok_or("Location proof has no selected observation")?;
        if sample_location(sample) != *embedded {
            return Err("Photo GPS differs from the final location observation".into());
        }
        return Ok(sample);
    }
    // Equality includes the fix timestamp and all GPS fields. Trace validation
    // additionally requires strictly increasing timestamps; no later coordinate
    // is silently substituted for the fix retained at the photo's acquisition.
    let mut matches = samples
        .iter()
        .filter(|sample| sample_location(sample) == *embedded);
    let sample = matches
        .next()
        .ok_or("Photo GPS is absent from the location trace")?;
    if matches.next().is_some() {
        return Err("Photo GPS matches multiple location observations".into());
    }
    let fix_ms = sample.fix_timestamp_ms;
    let maximum_age = expected["policy"]["max_fix_age_ms"]
        .as_u64()
        .ok_or("Missing camera fix freshness policy")?;
    let (acquired_ms, future_allowance) = match &image.native_camera {
        Some(metadata) => (metadata.acquired_at_unix_ms, 0),
        None => (
            capture
                .captured_at
                .checked_mul(1000)
                .ok_or("Camera time overflow")?,
            1000,
        ),
    };
    if fix_ms > acquired_ms.saturating_add(future_allowance)
        || acquired_ms.saturating_sub(fix_ms) > maximum_age
    {
        return Err("Photo observation is not fresh at camera acquisition".into());
    }
    Ok(sample)
}

fn sample_location(sample: &crate::location_proof::Sample) -> Location {
    Location {
        latitude: sample.latitude,
        longitude: sample.longitude,
        accuracy_m: sample.accuracy_m,
        altitude_m: sample.altitude_m,
        altitude_accuracy_m: sample.altitude_accuracy_m,
        timestamp_ms: sample.fix_timestamp_ms as f64,
        source: "device-geolocation".into(),
    }
}

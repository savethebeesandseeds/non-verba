// SPDX-License-Identifier: AGPL-3.0-only
//! Independently verified sets of C2PA JPEGs. The transport index is unsigned;
//! every signed member binds the full request, attempt and its camera identity.

use crate::{camera_set::*, err, Challenge};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::BTreeSet, io::Cursor};

pub const ASSERTION_LABEL: &str = "org.nonverba.camera.set";
pub const MAX_BUNDLE_BYTES: usize = 48 * 1024 * 1024;
pub const MAX_TOTAL_JPEG_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_REQUEST_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Acquisition {
    NativeCamera2,
    Browser,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraSetRequest {
    pub version: u32,
    #[serde(rename = "type")]
    pub record_type: String,
    pub challenge: Challenge,
    pub profile: CameraSetProfile,
    pub acquisition: Acquisition,
}

impl CameraSetRequest {
    pub fn validate_shape(&self) -> Result<(), String> {
        if self.version != 1 || self.record_type != "nonverba-camera-set-request" {
            return Err("Unsupported camera-set request".into());
        }
        crate::challenge_shape(&self.challenge)?;
        self.profile.validate()?;
        if self.acquisition == Acquisition::Browser
            && self.profile.kind != CameraSetKind::SingleCamera
        {
            return Err("Browser version 1 supports explicit single-camera requests only".into());
        }
        Ok(())
    }
    pub fn validate(&self, now_ms: u64) -> Result<(), String> {
        self.validate_shape()?;
        crate::challenge_at(&self.challenge, now_ms / 1000)
    }
    pub fn camera_request(&self) -> crate::camera_capture::CameraRequest {
        crate::camera_capture::CameraRequest {
            version: 1,
            challenge: self.challenge.clone(),
            location_request: None,
        }
    }
}

pub fn parse_request(value: &str) -> Result<CameraSetRequest, String> {
    if value.len() > MAX_REQUEST_BYTES {
        return Err("Camera-set request exceeds 32 KiB".into());
    }
    let request: CameraSetRequest = serde_json::from_str(value).map_err(err)?;
    request.validate_shape()?;
    Ok(request)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraSetMember {
    pub version: u32,
    pub request: CameraSetRequest,
    pub attempt_id: String,
    pub camera_id: String,
}

impl CameraSetMember {
    pub fn validate(&self) -> Result<(), String> {
        self.request.validate_shape()?;
        if self.version != 1
            || !crate::location_attempt::valid_attempt_id(&self.attempt_id)
            || !self
                .request
                .profile
                .cameras
                .iter()
                .any(|c| c.camera_id == self.camera_id)
        {
            return Err("Invalid camera-set member identity or attempt".into());
        }
        Ok(())
    }
    pub fn validate_native(
        &self,
        metadata: &crate::camera_capture::CameraCaptureMetadata,
    ) -> Result<(), String> {
        self.validate()?;
        let camera = self
            .request
            .profile
            .cameras
            .iter()
            .find(|c| c.camera_id == self.camera_id)
            .unwrap();
        if self.request.acquisition != Acquisition::NativeCamera2
            || metadata.session_id != self.attempt_id
            || metadata.camera_id != self.camera_id
            || serde_json::to_value(camera.lens_facing).map_err(err)? != metadata.lens_facing
        {
            return Err("Camera-set membership differs from native acquisition".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraSetImage {
    pub camera_id: String,
    pub jpeg_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraSetBundle {
    pub version: u32,
    #[serde(rename = "type")]
    pub record_type: String,
    pub request: CameraSetRequest,
    pub attempt_id: String,
    pub images: Vec<CameraSetImage>,
}

#[derive(Serialize)]
pub struct SetMemberVerification {
    pub camera_id: String,
    pub jpeg_sha256: String,
    pub binding_valid: bool,
    pub image: crate::Verification,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
pub struct CameraSetVerification {
    pub verified: bool,
    pub request_match: bool,
    pub membership_complete: bool,
    pub timing: TimingAssessment,
    pub timing_policy: CaptureTiming,
    pub exposure_start_span_ns: Option<String>,
    pub members: Vec<SetMemberVerification>,
    pub hardware_attested: bool,
    pub physical_simultaneity_proven: bool,
    pub errors: Vec<String>,
}

pub async fn verify_bundle(
    bundle_json: &str,
    expected_json: &str,
    pin: &str,
    now_secs: f64,
) -> Result<CameraSetVerification, String> {
    if bundle_json.len() > MAX_BUNDLE_BYTES {
        return Err("Camera-set transport exceeds 48 MiB".into());
    }
    let expected = parse_request(expected_json)?;
    if pin.len() != 64
        || !pin
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(
            "An independently expected lowercase media certificate SHA-256 is required".into(),
        );
    }
    let bundle: CameraSetBundle = serde_json::from_str(bundle_json).map_err(err)?;
    bundle.request.validate_shape()?;
    if bundle.version != 1
        || bundle.record_type != "nonverba-camera-set-bundle"
        || !crate::location_attempt::valid_attempt_id(&bundle.attempt_id)
        || bundle.images.len() > MAX_CAMERAS
    {
        return Err("Invalid camera-set transport".into());
    }
    let request_match = bundle.request == expected;
    let required: BTreeSet<_> = expected
        .profile
        .cameras
        .iter()
        .map(|c| c.camera_id.as_str())
        .collect();
    let delivered: BTreeSet<_> = bundle.images.iter().map(|c| c.camera_id.as_str()).collect();
    let membership_complete = delivered == required && delivered.len() == bundle.images.len();
    let mut result = CameraSetVerification {
        verified: false,
        request_match,
        membership_complete,
        timing: TimingAssessment::Unassessable,
        timing_policy: expected.profile.timing.clone(),
        exposure_start_span_ns: None,
        members: vec![],
        hardware_attested: false,
        physical_simultaneity_proven: false,
        errors: vec![],
    };
    if !request_match {
        result
            .errors
            .push("Transport request differs from the retained original".into());
    }
    if !membership_complete {
        result
            .errors
            .push("Required membership is missing, duplicated or substituted".into());
    }
    let challenge = serde_json::to_string(&expected.challenge).map_err(err)?;
    let mut starts = vec![];
    let mut total = 0usize;
    for item in &bundle.images {
        total = total
            .checked_add(item.jpeg_b64.len())
            .ok_or("Camera-set size overflow")?;
        if total > (MAX_TOTAL_JPEG_BYTES.div_ceil(3) * 4 + MAX_CAMERAS * 4) {
            return Err("Camera-set JPEGs exceed the aggregate resource bound".into());
        }
    }
    total = 0;
    for item in &bundle.images {
        let bytes = STANDARD.decode(&item.jpeg_b64).map_err(err)?;
        if STANDARD.encode(&bytes) != item.jpeg_b64 {
            return Err("Noncanonical JPEG base64".into());
        }
        total += bytes.len();
        if total > MAX_TOTAL_JPEG_BYTES {
            return Err("Camera-set JPEGs exceed 32 MiB in total".into());
        }
        let image = crate::verify_image_report(&bytes, &challenge, pin, now_secs).await?;
        let mut errors = vec![];
        let binding = async {
            let reader = c2pa::Reader::from_context(crate::context()?)
                .with_stream_async("image/jpeg", Cursor::new(&bytes))
                .await
                .map_err(err)?;
            let manifest = reader
                .active_manifest()
                .ok_or("No active camera-set manifest")?;
            let labels: Vec<_> = manifest
                .assertions()
                .iter()
                .filter(|a| a.label().starts_with(ASSERTION_LABEL))
                .collect();
            if labels.len() != 1 || labels[0].label() != ASSERTION_LABEL {
                return Err("A unique exact camera-set assertion is required".into());
            }
            let member: CameraSetMember = manifest.find_assertion(ASSERTION_LABEL).map_err(err)?;
            member.validate()?;
            if member.request != expected
                || member.attempt_id != bundle.attempt_id
                || member.camera_id != item.camera_id
            {
                return Err(
                    "Signed camera-set binding differs from original request, attempt or member"
                        .into(),
                );
            }
            match expected.acquisition {
                Acquisition::NativeCamera2 => {
                    let metadata = image
                        .native_camera
                        .as_ref()
                        .ok_or("Native camera-set member lacks verified acquisition metadata")?;
                    member.validate_native(metadata)?;
                    starts.push(CaptureStart {
                        camera_id: item.camera_id.clone(),
                        timebase_id: (metadata.timestamp_source == "realtime")
                            .then(|| format!("android-elapsed:{}:{}", pin, bundle.attempt_id)),
                        start_ns: (metadata.timestamp_source == "realtime")
                            .then(|| metadata.sensor_timestamp_ns.clone()),
                    });
                }
                Acquisition::Browser => {
                    if image.native_camera.is_some() {
                        return Err("Browser member cannot claim native acquisition".into());
                    }
                    starts.push(CaptureStart {
                        camera_id: item.camera_id.clone(),
                        timebase_id: None,
                        start_ns: None,
                    });
                }
            }
            Ok::<(), String>(())
        }
        .await;
        if let Err(error) = &binding {
            errors.push(error.clone());
        }
        result.members.push(SetMemberVerification {
            camera_id: item.camera_id.clone(),
            jpeg_sha256: crate::digest(&bytes),
            binding_valid: binding.is_ok(),
            image,
            errors,
        });
    }
    if membership_complete
        && result
            .members
            .iter()
            .all(|m| m.binding_valid && m.image.verified)
    {
        let timing = assess_timing_report(&expected.profile, &starts)?;
        result.timing = timing.assessment;
        result.exposure_start_span_ns = timing.exposure_start_span_ns;
    }
    result.verified = request_match
        && membership_complete
        && result
            .members
            .iter()
            .all(|m| m.binding_valid && m.image.verified)
        && matches!(
            result.timing,
            TimingAssessment::NotRequired
                | TimingAssessment::WithinRequestedSkew
                | TimingAssessment::SequentialOrderConfirmed
        );
    Ok(result)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn create_camera_set_request(
    requester: &str,
    task: &str,
    profile_json: &str,
    acquisition: &str,
    now_secs: f64,
    ttl: u32,
) -> Result<String, String> {
    let request = CameraSetRequest {
        version: 1,
        record_type: "nonverba-camera-set-request".into(),
        challenge: serde_json::from_str(&crate::create_challenge(requester, task, now_secs, ttl)?)
            .map_err(err)?,
        profile: parse_profile(profile_json)?,
        acquisition: serde_json::from_value(json!(acquisition)).map_err(err)?,
    };
    request.validate_shape()?;
    serde_json::to_string(&request).map_err(err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn validate_camera_set_request(request_json: &str, now_secs: f64) -> Result<String, String> {
    let request = parse_request(request_json)?;
    request.validate(
        crate::seconds(now_secs)?
            .checked_mul(1000)
            .ok_or("Camera-set time overflow")?,
    )?;
    serde_json::to_string(&request).map_err(err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub async fn verify_camera_set(
    bundle_json: &str,
    expected_json: &str,
    pin: &str,
    now_secs: f64,
) -> Result<String, String> {
    serde_json::to_string(&verify_bundle(bundle_json, expected_json, pin, now_secs).await?)
        .map_err(err)
}

/// Software browser path only. Never emits a native acquisition assertion.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub async fn seal_browser_camera_set_member(
    jpeg: &[u8],
    request_json: &str,
    attempt_id: &str,
    camera_id: &str,
    identity_json: &str,
    location_json: &str,
    now_secs: f64,
) -> Result<Vec<u8>, String> {
    let request = parse_request(request_json)?;
    request.validate(
        crate::seconds(now_secs)?
            .checked_mul(1000)
            .ok_or("Camera-set time overflow")?,
    )?;
    if request.acquisition != Acquisition::Browser {
        return Err("Software signing cannot satisfy native camera-set acquisition".into());
    }
    let member = CameraSetMember {
        version: 1,
        request,
        attempt_id: attempt_id.into(),
        camera_id: camera_id.into(),
    };
    member.validate()?;
    let identity: crate::Identity = crate::parse(identity_json)?;
    let signer = crate::local_signer(&identity)?;
    let (mut builder, mut source) = crate::prepare_image(
        jpeg,
        &serde_json::to_string(&member.request.challenge).map_err(err)?,
        now_secs,
        location_json,
        None,
        crate::ImageSigningIdentity {
            fingerprint: &identity.fingerprint,
            protection: "device-local-software-key",
        },
    )?;
    builder
        .add_assertion(ASSERTION_LABEL, &member)
        .map_err(err)?;
    let mut destination = Cursor::new(Vec::new());
    builder
        .sign_async(&signer, "image/jpeg", &mut source, &mut destination)
        .await
        .map_err(err)?;
    Ok(destination.into_inner())
}

#[cfg(test)]
#[path = "camera_set_evidence_tests.rs"]
mod tests;

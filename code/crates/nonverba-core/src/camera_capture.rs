// SPDX-License-Identifier: AGPL-3.0-only
//! Camera acquisition metadata validation shared by native signing and verifiers.
//! Metadata is an authenticated application claim, not hardware attestation.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{challenge_at, err, parse, Challenge};

pub const ASSERTION_LABEL: &str = "org.nonverba.camera.acquisition";
const MAX_SESSION_NS: u64 = 60_000_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraRequest {
    pub version: u32,
    pub challenge: Challenge,
    pub location_request: Option<Value>,
}

impl CameraRequest {
    pub fn validate(&self, now_ms: u64) -> Result<(), String> {
        if self.version != 1 {
            return Err("Unsupported native camera request".into());
        }
        challenge_at(&self.challenge, now_ms / 1000)?;
        if let Some(request) = &self.location_request {
            let normalized: Value = parse(&crate::location_proof::validate_location_request(
                &serde_json::to_string(request).map_err(err)?,
                (now_ms / 1000) as f64,
            )?)?;
            if !same_request_value(request, &normalized)
                || request["context"]["purpose"] != "camera"
                || request["demo"] == true
            {
                return Err(
                    "Native camera requires the original non-demo camera location policy".into(),
                );
            }
            let bound: Challenge =
                serde_json::from_value(request["challenge"].clone()).map_err(err)?;
            if self.challenge != bound {
                return Err("Camera and location request challenges differ".into());
            }
        }
        Ok(())
    }
}

// serde_json distinguishes 100 from 100.0, whereas JSON.parse/stringify in the
// WebView does not. Permit only that lossless numeric representation difference;
// preserve every object key, array entry, value and optional-field presence.
// In particular, converting all numbers to f64 would conflate distinct integers
// beyond JavaScript's exact range and must not become an equality shortcut.
pub(crate) fn same_request_value(original: &Value, normalized: &Value) -> bool {
    if original == normalized {
        return true;
    }
    match (original, normalized) {
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter().all(|(key, value)| {
                    b.get(key)
                        .is_some_and(|other| same_request_value(value, other))
                })
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_request_value(a, b))
        }
        (Value::Number(a), Value::Number(b)) => {
            fn safe_integer(number: &serde_json::Number) -> Option<f64> {
                const MAX: i64 = 9_007_199_254_740_991;
                number
                    .as_i64()
                    .filter(|value| (-MAX..=MAX).contains(value))
                    .map(|value| value as f64)
            }
            (a.is_f64() && safe_integer(b).is_some_and(|value| a.as_f64() == Some(value)))
                || (b.is_f64() && safe_integer(a).is_some_and(|value| b.as_f64() == Some(value)))
        }
        _ => false,
    }
}

/// Nanosecond counters are canonical decimal strings to survive JSON transport
/// through JavaScript without losing precision after roughly 104 days of uptime.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraCaptureMetadata {
    pub version: u32,
    #[serde(rename = "type")]
    pub record_type: String,
    pub session_id: String,
    pub camera_id: String,
    pub lens_facing: String,
    pub timestamp_source: String,
    pub request_received_unix_ms: u64,
    pub callback_received_unix_ms: u64,
    pub capture_time_origin: String,
    pub request_received_elapsed_ns: String,
    pub capture_requested_elapsed_ns: String,
    pub callback_received_elapsed_ns: String,
    pub image_received_elapsed_ns: String,
    pub sensor_timestamp_ns: String,
    pub image_timestamp_ns: String,
    pub acquired_at_unix_ms: u64,
    /// Assigned by Rust from the native finalization-entry clock sample. It is
    /// not a hardware clock, requester receipt, or exact signature completion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sealed_at_unix_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seal_time_origin: Option<String>,
    pub frame_number: String,
    pub width: u32,
    pub height: u32,
    pub jpeg_orientation_degrees: u32,
    pub zsl_requested_disabled: bool,
    pub test_pattern_requested_disabled: bool,
    pub zsl_result_enabled: Option<bool>,
    pub test_pattern_result_mode: Option<u32>,
    pub gps_origin: String,
    pub keystore_security_level: String,
    pub strongbox_requested: bool,
    pub strongbox_fallback: bool,
    pub exposure_time_ns: Option<String>,
    pub sensitivity_iso: Option<u32>,
    pub focal_length_mm: Option<f64>,
}

impl CameraCaptureMetadata {
    pub fn validate(&self, challenge: &Challenge, now_ms: u64) -> Result<(), String> {
        if self.version != 1
            || self.record_type != "nonverba-native-camera-capture"
            || self.session_id.is_empty()
            || self.session_id.len() > 128
            || self.camera_id.is_empty()
            || self.camera_id.len() > 128
            || !matches!(self.lens_facing.as_str(), "back" | "front" | "external")
            || !matches!(self.timestamp_source.as_str(), "realtime" | "unknown")
            || self.gps_origin != "caller-submitted-device-geolocation"
            || !matches!(
                self.keystore_security_level.as_str(),
                "strongbox"
                    | "trusted-environment"
                    | "software"
                    | "hardware-unspecified"
                    | "unknown"
            )
            || (self.strongbox_fallback && !self.strongbox_requested)
            || !self.zsl_requested_disabled
            || !self.test_pattern_requested_disabled
            || self.zsl_result_enabled == Some(true)
            || self.test_pattern_result_mode.is_some_and(|mode| mode != 0)
        {
            return Err("Invalid native camera acquisition profile or processing result".into());
        }
        let received = counter(&self.request_received_elapsed_ns)?;
        let requested = counter(&self.capture_requested_elapsed_ns)?;
        let callback = counter(&self.callback_received_elapsed_ns)?;
        let image = counter(&self.image_received_elapsed_ns)?;
        let sensor = counter(&self.sensor_timestamp_ns)?;
        let image_timestamp = counter(&self.image_timestamp_ns)?;
        counter(&self.frame_number)?;
        if requested < received
            || callback < requested
            || image < requested
            || callback.saturating_sub(received) > MAX_SESSION_NS
            || image.saturating_sub(received) > MAX_SESSION_NS
            || sensor != image_timestamp
        {
            return Err(
                "Native camera image/result timestamp matching or session order failed".into(),
            );
        }
        if self.timestamp_source == "realtime"
            && (sensor < requested || sensor > callback || sensor > image)
        {
            return Err(
                "Native camera sensor timestamp is outside its live capture interval".into(),
            );
        }
        let expected_callback_wall = self
            .request_received_unix_ms
            .checked_add((callback - received) / 1_000_000)
            .ok_or("Native camera clock overflow")?;
        let inputs_received_wall = self
            .request_received_unix_ms
            .checked_add((callback.max(image) - received) / 1_000_000)
            .ok_or("Native camera input arrival clock overflow")?;
        if self
            .callback_received_unix_ms
            .abs_diff(expected_callback_wall)
            > 1000
        {
            return Err("Native camera wall and monotonic clocks diverged during capture".into());
        }
        let expected_acquisition = if self.timestamp_source == "realtime" {
            if self.capture_time_origin != "monotonic-mapped-exposure" {
                return Err(
                    "Native camera exposure time must use the monotonic clock mapping".into(),
                );
            }
            self.request_received_unix_ms
                .checked_add((sensor - received) / 1_000_000)
                .ok_or("Native camera exposure clock overflow")?
        } else {
            // UNKNOWN timebases support image/result matching, not an exposure
            // mapping. Their wall time is explicitly the callback receipt time.
            if self.capture_time_origin != "callback-receipt" {
                return Err("Unknown camera clock requires explicit callback receipt time".into());
            }
            self.callback_received_unix_ms
        };
        if self.acquired_at_unix_ms != expected_acquisition {
            return Err("Native camera acquisition time disagrees with its clock origin".into());
        }
        if self.acquired_at_unix_ms > now_ms
            || self.callback_received_unix_ms > now_ms
            || inputs_received_wall > now_ms
        {
            return Err("Native camera acquisition time is in the future".into());
        }
        challenge_at(challenge, self.acquired_at_unix_ms / 1000)?;
        match (self.sealed_at_unix_ms, self.seal_time_origin.as_deref()) {
            (None, None) => {} // Before native finalization adds its own timing.
            (Some(sealed), Some("native-finalization-start")) => {
                if sealed < self.acquired_at_unix_ms
                    || sealed < inputs_received_wall
                    || sealed < self.callback_received_unix_ms
                    || sealed > now_ms
                    || sealed - self.acquired_at_unix_ms > 30_000
                {
                    return Err("Native camera finalization must follow both input arrivals and begin within thirty seconds of acquisition".into());
                }
                challenge_at(challenge, sealed / 1000)?;
            }
            _ => return Err("Invalid native camera finalization clock origin".into()),
        }
        if self.width < 256
            || self.height < 256
            || self.width > 8192
            || self.height > 8192
            || u64::from(self.width) * u64::from(self.height) > 16_777_216
            || !matches!(self.jpeg_orientation_degrees, 0 | 90 | 180 | 270)
            || self
                .sensitivity_iso
                .is_some_and(|iso| iso == 0 || iso > 10_000_000)
            || self
                .focal_length_mm
                .is_some_and(|length| !length.is_finite() || length <= 0.0 || length > 100_000.0)
        {
            return Err("Invalid native camera image dimensions or capture properties".into());
        }
        if let Some(exposure) = &self.exposure_time_ns {
            let exposure = counter(exposure)?;
            if exposure == 0 || exposure > MAX_SESSION_NS {
                return Err("Invalid native camera exposure duration".into());
            }
            if self.timestamp_source == "realtime" {
                // REALTIME timestamps share the image-arrival clock. The first
                // row's exposure must finish before its complete image arrives;
                // this checks signed claims, not physical sensor authenticity.
                let exposure_end = sensor
                    .checked_add(exposure)
                    .ok_or("Native camera exposure clock overflow")?;
                if exposure_end > image {
                    return Err("Native camera exposure extends beyond image arrival".into());
                }
            }
        }
        Ok(())
    }

    pub fn matches_jpeg(&self, bytes: &[u8]) -> Result<(), String> {
        let (width, height) =
            image::ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Jpeg)
                .into_dimensions()
                .map_err(err)?;
        let same = (width, height) == (self.width, self.height);
        let rotated = matches!(self.jpeg_orientation_degrees, 90 | 270)
            && (width, height) == (self.height, self.width);
        if !same && !rotated {
            return Err("Native camera dimensions differ from the signed JPEG".into());
        }
        Ok(())
    }

    /// GPS remains caller-submitted, but the native profile requires a fix
    /// within five seconds of acquisition. Preserve only the existing public
    /// capture timestamp's same-second tolerance for a future fix.
    pub fn validate_location(&self, location: &crate::location::Location) -> Result<(), String> {
        if !location.timestamp_ms.is_finite()
            || location.timestamp_ms < 0.0
            || location.timestamp_ms.fract() != 0.0
            || location.timestamp_ms > 9_007_199_254_740_991.0
        {
            return Err("Native camera GPS timestamp is invalid".into());
        }
        let timestamp = location.timestamp_ms as u64;
        let same_second_end = (self.acquired_at_unix_ms / 1000)
            .saturating_mul(1000)
            .saturating_add(999);
        if timestamp > same_second_end {
            return Err(format!(
                "Native camera GPS must be within five seconds of acquisition (selected fix is {} ms after acquisition; same-second allowance is {} ms)",
                timestamp - self.acquired_at_unix_ms,
                same_second_end - self.acquired_at_unix_ms,
            ));
        }
        let age_ms = self.acquired_at_unix_ms.saturating_sub(timestamp);
        if age_ms > 5000 {
            return Err(format!(
                "Native camera GPS must be within five seconds of acquisition (selected fix age at acquisition: {age_ms} ms; maximum: 5000 ms)",
            ));
        }
        Ok(())
    }
}

fn counter(value: &str) -> Result<u64, String> {
    if value.is_empty() || value.len() > 19 || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Invalid native camera monotonic counter".into());
    }
    let number: u64 = value.parse().map_err(err)?;
    if number > i64::MAX as u64 || number.to_string() != value {
        return Err("Native camera counters must be canonical nonnegative Android longs".into());
    }
    Ok(number)
}

pub(crate) fn read_assertion(
    manifest: &c2pa::Manifest,
    capture: Option<&crate::CaptureAssertion>,
    jpeg: &[u8],
    now_secs: u64,
) -> Result<Option<CameraCaptureMetadata>, String> {
    let count = manifest
        .assertions()
        .iter()
        .filter(|assertion| assertion.label() == ASSERTION_LABEL)
        .count();
    if count == 0 {
        return Ok(None);
    }
    if count != 1 {
        return Err("Native camera acquisition assertion must be unique".into());
    }
    let metadata: CameraCaptureMetadata = manifest.find_assertion(ASSERTION_LABEL).map_err(err)?;
    if metadata.sealed_at_unix_ms.is_none() {
        return Err("Native camera assertion is missing its finalization timestamp".into());
    }
    let capture = capture.ok_or("Native camera metadata requires the signed capture assertion")?;
    // The public verifier receives whole Unix seconds. Permit only the same
    // second's fractional remainder, as in the existing EXIF location validator.
    let now_ms = now_secs
        .checked_mul(1000)
        .and_then(|value| value.checked_add(999))
        .ok_or("Native camera verification time is too large")?;
    metadata.validate(&capture.challenge, now_ms)?;
    metadata.validate_location(
        capture
            .location
            .as_ref()
            .ok_or("Native camera metadata requires its signed GPS report")?,
    )?;
    if metadata.acquired_at_unix_ms / 1000 != capture.captured_at {
        return Err("Native camera clock differs from the signed capture time".into());
    }
    metadata.matches_jpeg(jpeg)?;
    Ok(Some(metadata))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    const NOW: u64 = 1_790_424_000;

    pub(crate) fn fixture() -> CameraCaptureMetadata {
        serde_json::from_value(serde_json::json!({
            "version":1,"type":"nonverba-native-camera-capture","session_id":"native-fixture",
            "camera_id":"0","lens_facing":"back","timestamp_source":"realtime",
            "request_received_unix_ms":NOW * 1000,"callback_received_unix_ms":NOW * 1000,
            "capture_time_origin":"monotonic-mapped-exposure",
            "request_received_elapsed_ns":"9007199254740993",
            "capture_requested_elapsed_ns":"9007199254741003",
            "sensor_timestamp_ns":"9007199254741013","image_timestamp_ns":"9007199254741013",
            "callback_received_elapsed_ns":"9007199254741033","image_received_elapsed_ns":"9007199254741043",
            "acquired_at_unix_ms":NOW * 1000,"frame_number":"2","width":640,"height":480,
            "jpeg_orientation_degrees":0,"zsl_requested_disabled":true,"test_pattern_requested_disabled":true,
            "zsl_result_enabled":null,"test_pattern_result_mode":0,"gps_origin":"caller-submitted-device-geolocation",
            "keystore_security_level":"software","strongbox_requested":false,"strongbox_fallback":false,
            "exposure_time_ns":"10","sensitivity_iso":200,"focal_length_mm":4.5
        })).unwrap()
    }

    #[test]
    fn native_camera_accepts_actual_wasm_js_location_requests() {
        let fixture: Value = parse(include_str!("camera_request_boundary_fixture.json")).unwrap();
        let now_ms = fixture["now_ms"].as_u64().unwrap();
        let requests = fixture["requests"].as_array().unwrap();
        assert_eq!(requests.len(), 4);
        for case in requests {
            let original: Value = parse(case["wasm_json"].as_str().unwrap()).unwrap();
            let bridged: Value = parse(case["js_json"].as_str().unwrap()).unwrap();
            assert_ne!(
                original, bridged,
                "fixture must exercise number representation"
            );
            let challenge: Challenge =
                serde_json::from_value(original["challenge"].clone()).unwrap();
            for location_request in [original, bridged] {
                let request = CameraRequest {
                    version: 1,
                    challenge: challenge.clone(),
                    location_request: Some(location_request.clone()),
                };
                request
                    .validate(now_ms)
                    .unwrap_or_else(|error| panic!("{}: {error}", case["profile"]));
                assert_eq!(
                    request.location_request,
                    Some(location_request),
                    "validation must not replace the original request"
                );
            }
        }
    }

    #[test]
    fn retrieved_phone_request_is_valid_at_original_issue_time_only() {
        // Exact exported public request from the failed 2026-09-29 phone run.
        // Replaying validation at its issue time proves parsing, not fresh evidence.
        let envelope: Value = parse(include_str!("camera_request_phone_fixture.json")).unwrap();
        let original = envelope["location_request"].clone();
        let request = CameraRequest {
            version: 1,
            challenge: serde_json::from_value(original["challenge"].clone()).unwrap(),
            location_request: Some(original.clone()),
        };
        request
            .validate(request.challenge.issued_at * 1000)
            .unwrap();
        assert_eq!(request.location_request, Some(original));
        assert!(request
            .validate(request.challenge.expires_at * 1000)
            .is_err());
    }

    #[test]
    fn numeric_transport_comparison_never_drops_structure_or_precision() {
        for (left, right, expected) in [
            ("100", "100.0", true),
            ("100", "1e2", true),
            ("-100", "-100.0", true),
            ("0", "-0.0", true),
            ("100", "100.00000001", false),
            ("100", "99.99999999", false),
            ("9007199254740992", "9007199254740992.0", false),
            ("9007199254740993", "9007199254740992.0", false),
            ("-9007199254740993", "-9007199254740992.0", false),
            ("18446744073709551615", "18446744073709551616.0", false),
            ("100", "\"100\"", false),
            ("false", "0", false),
            ("{\"a\":100}", "{\"a\":100.0}", true),
            ("[100,1]", "[100.0,1]", true),
            ("[100,1]", "[1,100.0]", false),
            ("[100]", "[100.0,1]", false),
            ("{}", "{\"a\":null}", false),
            ("{\"a\":100}", "{\"b\":100.0}", false),
        ] {
            let a: Value = parse(left).unwrap();
            let b: Value = parse(right).unwrap();
            assert_eq!(same_request_value(&a, &b), expected, "{left} vs {right}");
            assert_eq!(same_request_value(&b, &a), expected, "{right} vs {left}");
        }
        // Construct adjacent f64 values directly: decimal parsing itself is a
        // separate serde_json boundary, and comparison must not use an epsilon.
        let max_safe_integer = Value::from(9_007_199_254_740_991_i64);
        let max_safe_float = Value::from(9_007_199_254_740_991_f64);
        assert!(same_request_value(&max_safe_integer, &max_safe_float));
        assert!(same_request_value(&max_safe_float, &max_safe_integer));
        let integer = Value::from(100);
        for value in [100.0_f64.next_up(), 100.0_f64.next_down()] {
            let fractional = Value::from(value);
            assert!(!same_request_value(&integer, &fractional));
            assert!(!same_request_value(&fractional, &integer));
        }
    }

    #[test]
    fn native_camera_still_requires_complete_non_demo_bound_policy() {
        let fixture: Value = parse(include_str!("camera_request_boundary_fixture.json")).unwrap();
        for case in fixture["requests"].as_array().unwrap() {
            let original: Value = parse(case["js_json"].as_str().unwrap()).unwrap();
            let request = CameraRequest {
                version: 1,
                challenge: serde_json::from_value(original["challenge"].clone()).unwrap(),
                location_request: Some(original.clone()),
            };
            let check = |altered: Value| {
                let mutated = CameraRequest {
                    location_request: Some(altered),
                    ..request.clone()
                };
                assert!(
                    mutated.validate(NOW * 1000).is_err(),
                    "{} accepted {}",
                    case["profile"],
                    mutated.location_request.unwrap()
                );
            };
            let mut paths = vec!["", "/challenge", "/policy", "/context"];
            if original["policy"].get("raw_gnss").is_some() {
                paths.push("/policy/raw_gnss");
            }
            for path in paths {
                let object = original.pointer(path).unwrap().as_object().unwrap();
                for key in object.keys() {
                    // This optional policy is not recoverable from the outer camera
                    // challenge alone; the signed-original verifier tests cover its removal.
                    if path == "/policy" && key == "raw_gnss" {
                        continue;
                    }
                    let mut missing = original.clone();
                    missing
                        .pointer_mut(path)
                        .unwrap()
                        .as_object_mut()
                        .unwrap()
                        .remove(key);
                    check(missing);
                }
                let mut unknown = original.clone();
                unknown
                    .pointer_mut(path)
                    .unwrap()
                    .as_object_mut()
                    .unwrap()
                    .insert("unknown".into(), true.into());
                check(unknown);
            }
            for (path, value) in [
                ("/context", Value::Null),
                ("/context/purpose", "standalone".into()),
                ("/policy/max_accuracy_m", "100".into()),
                ("/policy/max_accuracy_m", 0.into()),
                ("/policy/max_speed_mps", 1001.into()),
                ("/policy/duration_ms", 10000.5.into()),
                ("/challenge/issued_at", (NOW + 1).into()),
            ] {
                let mut changed = original.clone();
                *changed.pointer_mut(path).unwrap() = value;
                check(changed);
            }
            for demo in [false, true] {
                let mut changed = original.clone();
                changed["demo"] = demo.into();
                check(changed);
            }
            if original["policy"].get("raw_gnss").is_none() {
                let mut changed = original.clone();
                changed["policy"]["raw_gnss"] = Value::Null;
                check(changed);
            }
            let mut changed = original.clone();
            changed["challenge"] =
                parse::<Value>(&crate::create_challenge("other", "other", NOW as f64, 60).unwrap())
                    .unwrap();
            check(changed);
            assert!(request.validate((NOW + 60) * 1000).is_err());
        }
    }

    #[test]
    fn native_camera_gps_rejection_reports_only_age_or_future_lead_at_exact_bounds() {
        let mut metadata = fixture();
        metadata.acquired_at_unix_ms = NOW * 1000 + 123;
        let mut location: crate::location::Location = parse(
            &serde_json::json!({
                "latitude":47.4979,"longitude":19.0402,"accuracy_m":12.0,
                "altitude_m":null,"altitude_accuracy_m":null,
                "timestamp_ms":metadata.acquired_at_unix_ms - 5000,"source":"device-geolocation"
            })
            .to_string(),
        )
        .unwrap();
        metadata.validate_location(&location).unwrap();
        location.timestamp_ms -= 1.0;
        let stale = metadata.validate_location(&location).unwrap_err();
        assert_eq!(stale, "Native camera GPS must be within five seconds of acquisition (selected fix age at acquisition: 5001 ms; maximum: 5000 ms)");
        location.timestamp_ms = (NOW * 1000 + 999) as f64;
        metadata.validate_location(&location).unwrap();
        location.timestamp_ms += 1.0;
        let future = metadata.validate_location(&location).unwrap_err();
        assert_eq!(future, "Native camera GPS must be within five seconds of acquisition (selected fix is 877 ms after acquisition; same-second allowance is 876 ms)");
        for error in [&stale, &future] {
            assert!(
                error.len() < 400,
                "native error transport must retain the diagnostic"
            );
            for private_value in [
                "47.4979",
                "19.0402",
                &metadata.acquired_at_unix_ms.to_string(),
            ] {
                assert!(!error.contains(private_value));
            }
        }
        location.timestamp_ms += 0.5;
        assert_eq!(
            metadata.validate_location(&location).unwrap_err(),
            "Native camera GPS timestamp is invalid"
        );
    }

    #[test]
    fn native_camera_clock_and_processing_claims_fail_closed() {
        let challenge: Challenge =
            parse(&crate::create_challenge("requester", "camera", NOW as f64, 60).unwrap())
                .unwrap();
        let valid = fixture();
        valid.validate(&challenge, NOW * 1000).unwrap();
        let mut forged = valid.clone();
        forged.image_timestamp_ns = "9007199254741012".into();
        assert!(forged.validate(&challenge, NOW * 1000).is_err());
        let mut forged = valid.clone();
        forged.sensor_timestamp_ns = "100".into();
        forged.image_timestamp_ns = "100".into();
        assert!(forged.validate(&challenge, NOW * 1000).is_err());
        forged.timestamp_source = "unknown".into();
        forged.capture_time_origin = "callback-receipt".into();
        forged.validate(&challenge, NOW * 1000).unwrap();
        forged.request_received_elapsed_ns = "09007199254740993".into();
        assert!(forged.validate(&challenge, NOW * 1000).is_err());
        let mut forged = valid.clone();
        forged.test_pattern_result_mode = Some(1);
        assert!(forged.validate(&challenge, NOW * 1000).is_err());
        let mut forged = valid.clone();
        forged.callback_received_unix_ms += 1500;
        assert!(forged.validate(&challenge, NOW * 1000 + 2000).is_err());
        let mut forged = valid.clone();
        forged.acquired_at_unix_ms += 1;
        assert!(forged.validate(&challenge, NOW * 1000 + 2000).is_err());
        let mut forged = valid;
        forged.zsl_result_enabled = Some(true);
        assert!(forged.validate(&challenge, NOW * 1000).is_err());
    }

    #[test]
    fn realtime_exposure_must_end_by_image_arrival_at_nanosecond_precision() {
        let challenge: Challenge =
            parse(&crate::create_challenge("requester", "camera", NOW as f64, 60).unwrap())
                .unwrap();
        let mut metadata = fixture();
        // Counters exceed f64's exact integer range. The callback is earlier
        // than this exposure end; only complete image arrival bounds it.
        metadata.exposure_time_ns = Some("30".into());
        metadata.validate(&challenge, NOW * 1000).unwrap();
        metadata.exposure_time_ns = Some("31".into());
        assert_eq!(
            metadata.validate(&challenge, NOW * 1000).unwrap_err(),
            "Native camera exposure extends beyond image arrival"
        );
    }

    #[test]
    fn realtime_exposure_end_cannot_wrap_large_camera_counters() {
        let challenge: Challenge =
            parse(&crate::create_challenge("requester", "camera", NOW as f64, 60).unwrap())
                .unwrap();
        let mut metadata = fixture();
        let maximum = i64::MAX as u64;
        metadata.request_received_elapsed_ns = (maximum - 100).to_string();
        metadata.capture_requested_elapsed_ns = (maximum - 90).to_string();
        metadata.sensor_timestamp_ns = (maximum - 80).to_string();
        metadata.image_timestamp_ns = metadata.sensor_timestamp_ns.clone();
        metadata.callback_received_elapsed_ns = (maximum - 60).to_string();
        metadata.image_received_elapsed_ns = maximum.to_string();
        metadata.exposure_time_ns = Some("80".into());
        metadata.validate(&challenge, NOW * 1000).unwrap();
        metadata.exposure_time_ns = Some("81".into());
        assert_eq!(
            metadata.validate(&challenge, NOW * 1000).unwrap_err(),
            "Native camera exposure extends beyond image arrival"
        );
        // Larger counters cannot enter the arithmetic: Android reports signed
        // longs, and the existing canonical counter parser enforces that bound.
        metadata.image_received_elapsed_ns = (maximum + 1).to_string();
        assert_eq!(
            metadata.validate(&challenge, NOW * 1000).unwrap_err(),
            "Native camera counters must be canonical nonnegative Android longs"
        );
    }

    #[test]
    fn optional_exposure_and_unknown_timebase_keep_their_existing_scope() {
        let challenge: Challenge =
            parse(&crate::create_challenge("requester", "camera", NOW as f64, 60).unwrap())
                .unwrap();
        for source in ["realtime", "unknown"] {
            let mut metadata = fixture();
            metadata.timestamp_source = source.into();
            if source == "unknown" {
                metadata.capture_time_origin = "callback-receipt".into();
            }
            metadata.exposure_time_ns = None;
            metadata.validate(&challenge, NOW * 1000).unwrap();
            if source == "unknown" {
                // A different timebase cannot be ordered against arrival.
                metadata.exposure_time_ns = Some(MAX_SESSION_NS.to_string());
                metadata.validate(&challenge, NOW * 1000).unwrap();
            }
            for invalid in [0, MAX_SESSION_NS + 1] {
                metadata.exposure_time_ns = Some(invalid.to_string());
                assert_eq!(
                    metadata.validate(&challenge, NOW * 1000).unwrap_err(),
                    "Invalid native camera exposure duration"
                );
            }
        }
    }

    #[test]
    fn finalization_cannot_precede_either_camera_input_arrival() {
        let challenge: Challenge =
            parse(&crate::create_challenge("requester", "camera", NOW as f64, 60).unwrap())
                .unwrap();
        for later_image in [true, false] {
            let mut metadata = fixture();
            let received = counter(&metadata.request_received_elapsed_ns).unwrap();
            if later_image {
                metadata.image_received_elapsed_ns = (received + 2_000_000_000).to_string();
            } else {
                metadata.callback_received_elapsed_ns = (received + 2_000_000_000).to_string();
                metadata.callback_received_unix_ms += 2000;
            }
            metadata.sealed_at_unix_ms = Some(NOW * 1000 + 1999);
            metadata.seal_time_origin = Some("native-finalization-start".into());
            assert!(metadata.validate(&challenge, NOW * 1000 + 3000).is_err());
            metadata.sealed_at_unix_ms = Some(NOW * 1000 + 2000);
            metadata.validate(&challenge, NOW * 1000 + 3000).unwrap();
            // Arrival timestamps cannot be future-dated before finalization either.
            metadata.sealed_at_unix_ms = None;
            metadata.seal_time_origin = None;
            assert!(metadata.validate(&challenge, NOW * 1000 + 1999).is_err());
        }
    }
}

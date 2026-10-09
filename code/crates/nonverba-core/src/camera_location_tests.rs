// SPDX-License-Identifier: AGPL-3.0-only
//! Regression tests for the boundary between independently signed artifacts.
use super::*;
use crate::location_proof::{self as proof, Sample, Trace};
use futures::executor::block_on;
use serde_json::json;

const NOW: f64 = 2_000_000_000.0;

fn jpeg(variant: u32) -> Vec<u8> {
    let pixels = image::RgbImage::from_fn(640, 480, |x, y| {
        image::Rgb([
            (48 + (x + variant * 11) / 4 % 160) as u8,
            (48 + y / 3 % 160) as u8,
            (64 + (x + y) / 5 % 128) as u8,
        ])
    });
    let mut output = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 95)
        .encode_image(&pixels)
        .unwrap();
    output
}

struct Fixture {
    identity: String,
    photo_pin: String,
    location_pin: String,
    trace: Trace,
    location: String,
    image: Vec<u8>,
    proof: Vec<u8>,
}
impl Fixture {
    fn request(&self) -> String {
        serde_json::to_string(&self.trace.request).unwrap()
    }
    fn challenge(&self) -> String {
        serde_json::to_string(&self.trace.request.challenge).unwrap()
    }
    fn sign_image(&self, bytes: &[u8], location: &str) -> Vec<u8> {
        self.sign_image_at(bytes, location, NOW + 12.0)
    }
    fn sign_image_at(&self, bytes: &[u8], location: &str, captured_at: f64) -> Vec<u8> {
        block_on(seal_image_with_location_request(
            bytes,
            &self.challenge(),
            &self.identity,
            captured_at,
            location,
            &self.request(),
        ))
        .unwrap()
    }
    fn bind_image(&self, bytes: &[u8]) -> Vec<u8> {
        proof::seal_location_proof(
            &serde_json::to_string(&self.trace).unwrap(),
            &self.identity,
            &proof::location_asset(bytes).unwrap(),
            NOW + 12.0,
        )
        .unwrap()
    }
    fn verify(
        &self,
        image: &[u8],
        sidecar: &[u8],
        request: &str,
        photo_pin: &str,
        location_pin: &str,
    ) -> Verification {
        serde_json::from_str(
            &block_on(verify_image_with_location_proof(
                image,
                sidecar,
                request,
                photo_pin,
                location_pin,
                NOW + 13.0,
            ))
            .unwrap(),
        )
        .unwrap()
    }
}

fn fixture() -> Fixture {
    let identity = crate::create_identity().unwrap();
    let photo_pin = crate::identity_fingerprint(&identity).unwrap();
    let location_identity: Value =
        serde_json::from_str(&proof::location_identity(&identity).unwrap()).unwrap();
    let request = proof::parse_request(
        &proof::create_location_request(
            "Camera requester",
            "Inspect the site",
            NOW,
            900,
            "null",
            r#"{"session_id":"camera-session","purpose":"camera"}"#,
        )
        .unwrap(),
    )
    .unwrap();
    let started_at_ms = (NOW as u64) * 1000 + 1000;
    let samples = [1000, 6000, 11000]
        .iter()
        .enumerate()
        .map(|(sequence, &elapsed)| Sample {
            sequence,
            observed_elapsed_ms: elapsed,
            fix_timestamp_ms: started_at_ms + elapsed,
            fix_elapsed_ms: None,
            provider: "browser-geolocation".into(),
            latitude: 47.4979,
            longitude: 19.0402,
            accuracy_m: 12.0,
            altitude_m: None,
            altitude_accuracy_m: None,
            mock: None,
        })
        .collect();
    let trace = Trace {
        raw_gnss: None,
        version: 1,
        kind: "nonverba-location-trace".into(),
        request,
        profile: "software-browser".into(),
        permission_precision: "browser".into(),
        uncertainty_semantics: "w3c-95-percent".into(),
        capture_correlation: "none".into(),
        started_at_ms,
        ended_at_ms: started_at_ms + 11000,
        elapsed_ms: 11000,
        samples,
    };
    let sample = trace.samples.last().unwrap();
    let location = json!({"latitude":sample.latitude,"longitude":sample.longitude,"accuracy_m":sample.accuracy_m,"altitude_m":null,"altitude_accuracy_m":null,"timestamp_ms":sample.fix_timestamp_ms,"source":"device-geolocation"}).to_string();
    let mut result = Fixture {
        identity,
        photo_pin,
        location_pin: location_identity["fingerprint"].as_str().unwrap().into(),
        trace,
        location,
        image: Vec::new(),
        proof: Vec::new(),
    };
    result.image = result.sign_image(&jpeg(0), &result.location);
    result.proof = result.bind_image(&result.image);
    result
}

#[test]
fn composed_photo_requires_both_artifacts_and_preserves_unproven_claims() {
    let f = fixture();
    let result = f.verify(
        &f.image,
        &f.proof,
        &f.request(),
        &f.photo_pin,
        &f.location_pin,
    );
    assert!(result.verified, "{:?}", result.errors);
    assert_eq!(result.capture.unwrap().version, 3);
    assert_eq!(result.checks.location_proof_valid, Some(true));
    assert!(
        !result.hardware_attested
            && !result.camera_freshness_proven
            && !result.location_authenticity_proven
    );
    let location = result.location_proof.unwrap();
    assert_eq!(location["verified"], true);
    assert_eq!(location["collection_attested"], false);
    let without_sidecar: Verification = serde_json::from_str(
        &block_on(crate::verify_image(
            &f.image,
            &f.challenge(),
            &f.photo_pin,
            NOW + 13.0,
        ))
        .unwrap(),
    )
    .unwrap();
    assert!(
        !without_sidecar.verified
            && without_sidecar
                .errors
                .iter()
                .any(|error| error == PROOF_REQUIRED)
    );
    let missing = f.verify(&f.image, &[], &f.request(), &f.photo_pin, &f.location_pin);
    assert!(!missing.verified && missing.checks.location_proof_valid == Some(false));
}

#[test]
fn swapped_valid_jpeg_wrong_pins_and_substituted_request_fail() {
    let f = fixture();
    let swapped = f.sign_image(&jpeg(1), &f.location);
    let result = f.verify(
        &swapped,
        &f.proof,
        &f.request(),
        &f.photo_pin,
        &f.location_pin,
    );
    assert!(
        result.checks.c2pa_integrity,
        "Swapped file is independently valid C2PA"
    );
    assert!(!result.verified);
    assert_eq!(
        result.location_proof.unwrap()["checks"]["asset_binding"],
        false
    );
    let bad_photo = f.verify(
        &f.image,
        &f.proof,
        &f.request(),
        &"0".repeat(64),
        &f.location_pin,
    );
    assert!(!bad_photo.verified && !bad_photo.checks.device_match);
    let bad_location = f.verify(
        &f.image,
        &f.proof,
        &f.request(),
        &f.photo_pin,
        &"0".repeat(64),
    );
    assert!(!bad_location.verified);
    assert_eq!(
        bad_location.location_proof.unwrap()["checks"]["device_match"],
        false
    );
    let mut changed = f.trace.request.clone();
    changed.context.as_mut().unwrap().session_id = "substituted-session".into();
    let changed = serde_json::to_string(&changed).unwrap();
    let bad_request = f.verify(&f.image, &f.proof, &changed, &f.photo_pin, &f.location_pin);
    assert!(!bad_request.verified);
    assert_eq!(
        bad_request.location_proof.unwrap()["checks"]["request_match"],
        false
    );
}

#[test]
fn independently_valid_signatures_cannot_hide_a_selected_fix_mismatch() {
    let f = fixture();
    let mut different: Value = serde_json::from_str(&f.location).unwrap();
    different["latitude"] = json!(47.5079);
    let image = f.sign_image(&jpeg(0), &different.to_string());
    // Model a caller submitting a JPEG with different GPS to an honest native
    // location signer: both individual signatures are valid and file-bound.
    let sidecar = f.bind_image(&image);
    let result = f.verify(
        &image,
        &sidecar,
        &f.request(),
        &f.photo_pin,
        &f.location_pin,
    );
    assert!(result.checks.c2pa_integrity);
    assert_eq!(result.checks.location_metadata_valid, Some(true));
    assert_eq!(result.location_proof.unwrap()["verified"], true);
    assert!(!result.verified);
    assert!(result
        .errors
        .iter()
        .any(|error| error.contains("selected observation")));
}

#[test]
fn legacy_photo_stays_valid_and_cannot_be_silently_upgraded() {
    let f = fixture();
    let old = block_on(crate::seal_image(
        &jpeg(0),
        &f.challenge(),
        &f.identity,
        NOW + 12.0,
        &f.location,
    ))
    .unwrap();
    let old_result: Verification = serde_json::from_str(
        &block_on(crate::verify_image(
            &old,
            &f.challenge(),
            &f.photo_pin,
            NOW + 13.0,
        ))
        .unwrap(),
    )
    .unwrap();
    assert!(old_result.verified);
    assert_eq!(old_result.capture.unwrap().version, 2);
    assert_eq!(old_result.checks.location_proof_valid, None);
    let proof = f.bind_image(&old);
    let upgraded = f.verify(&old, &proof, &f.request(), &f.photo_pin, &f.location_pin);
    assert!(
        !upgraded.verified,
        "A legacy photo did not sign this additional location request"
    );
}

fn concurrent_fixture() -> Fixture {
    let mut f = fixture();
    f.trace.request.context.as_mut().unwrap().camera_timing = Some("concurrent".into());
    // Movement after the early photo stays in the trace, never in its photo GPS.
    f.trace.samples[1].latitude += 0.0001;
    f.trace.samples[2].latitude += 0.0002;
    f.location = serde_json::to_string(&sample_location(&f.trace.samples[0])).unwrap();
    f.image = f.sign_image_at(&jpeg(0), &f.location, NOW + 3.0);
    f.proof = f.bind_image(&f.image);
    f
}

#[test]
fn camera_context_requires_explicit_supported_concurrent_semantics() {
    for (purpose, timing, valid) in [
        ("camera", Some("concurrent"), true),
        ("camera", None, true),
        ("standalone", None, true),
        ("standalone", Some("concurrent"), false),
        ("camera", Some(""), false),
        ("camera", Some("before"), false),
    ] {
        let mut context = json!({"session_id":"context-test", "purpose":purpose});
        if let Some(timing) = timing {
            context["camera_timing"] = timing.into();
        }
        let request = proof::create_location_request(
            "requester",
            "task",
            NOW,
            60,
            "null",
            &context.to_string(),
        );
        assert_eq!(request.is_ok(), valid, "{context}");
        if valid {
            let normalized: Value = serde_json::from_str(&request.unwrap()).unwrap();
            assert_eq!(normalized["context"], context);
        }
    }
}

#[test]
fn concurrent_camera_binds_early_photo_before_later_moved_samples() {
    let f = concurrent_fixture();
    let verified = f.verify(
        &f.image,
        &f.proof,
        &f.request(),
        &f.photo_pin,
        &f.location_pin,
    );
    assert!(verified.verified, "{:?}", verified.errors);
    assert_eq!(
        verified.capture.as_ref().unwrap().captured_at,
        NOW as u64 + 3
    );
    let report = verified.location_proof.unwrap();
    assert_eq!(
        report["camera_observation"],
        serde_json::to_value(&f.trace.samples[0]).unwrap()
    );
    assert_eq!(report["selected_location"]["sequence"], 2);
    assert_ne!(
        report["camera_observation"]["latitude"],
        report["selected_location"]["latitude"]
    );
    assert!(report["evidence"]["trace"]["ended_at_ms"].as_u64().unwrap() > (NOW as u64 + 3) * 1000);
    // Removing the requested timing semantics cannot reinterpret a signed pair.
    let mut downgraded = f.trace.request.clone();
    downgraded.context.as_mut().unwrap().camera_timing = None;
    let changed = f.verify(
        &f.image,
        &f.proof,
        &serde_json::to_string(&downgraded).unwrap(),
        &f.photo_pin,
        &f.location_pin,
    );
    assert!(!changed.verified);
    assert_eq!(
        changed.location_proof.unwrap()["checks"]["request_match"],
        false
    );
    let wrong_pin = f.verify(
        &f.image,
        &f.proof,
        &f.request(),
        &f.photo_pin,
        &"0".repeat(64),
    );
    assert!(!wrong_pin.verified);
    // Legacy requests still demand the final observation, even for valid early
    // photo GPS and independently valid, byte-bound signatures.
    let mut legacy = f;
    legacy.trace.request = downgraded;
    let image = legacy.sign_image_at(&jpeg(0), &legacy.location, NOW + 3.0);
    let sidecar = legacy.bind_image(&image);
    let old = legacy.verify(
        &image,
        &sidecar,
        &legacy.request(),
        &legacy.photo_pin,
        &legacy.location_pin,
    );
    assert!(!old.verified);
    assert!(old.checks.c2pa_integrity);
    assert_eq!(old.location_proof.unwrap()["verified"], true);
}

#[test]
fn concurrent_camera_rejects_wrong_missing_and_stale_observations() {
    let f = concurrent_fixture();
    for (variant, captured_at) in [
        ("coordinate", NOW + 3.0),
        ("absent", NOW + 3.0),
        ("stale", NOW + 8.0),
    ] {
        let mut location: Value = serde_json::from_str(&f.location).unwrap();
        if variant == "coordinate" {
            location["latitude"] = json!(47.5);
        }
        if variant == "absent" {
            location["timestamp_ms"] = json!((NOW as u64 + 3) * 1000);
        }
        let image = f.sign_image_at(&jpeg(0), &location.to_string(), captured_at);
        let sidecar = f.bind_image(&image);
        let result = f.verify(
            &image,
            &sidecar,
            &f.request(),
            &f.photo_pin,
            &f.location_pin,
        );
        assert!(!result.verified, "accepted {variant}");
        assert!(result.checks.c2pa_integrity);
        assert_eq!(result.checks.location_metadata_valid, Some(true));
        assert_eq!(result.location_proof.unwrap()["verified"], true);
    }
    // Retain the existing browser whole-second future tolerance, without
    // permitting a fix beyond it. Both image signing and composition use it.
    let tolerance = f.sign_image_at(&jpeg(0), &f.location, NOW + 1.0);
    let sidecar = f.bind_image(&tolerance);
    assert!(
        f.verify(
            &tolerance,
            &sidecar,
            &f.request(),
            &f.photo_pin,
            &f.location_pin
        )
        .verified
    );
    assert!(block_on(seal_image_with_location_request(
        &jpeg(0),
        &f.challenge(),
        &f.identity,
        NOW,
        &f.location,
        &f.request()
    ))
    .is_err());
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn concurrent_camera_uses_precise_native_acquisition_time() {
    use p256::{
        ecdsa::{signature::Signer as _, Signature},
        pkcs8::EncodePublicKey,
    };
    let f = concurrent_fixture();
    let key = crate::CertificateKey::generate().unwrap().key;
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let certs = crate::native_signer::create_certificate_chain(spki.as_bytes()).unwrap();
    let mut callback = |message: &[u8]| {
        let signature: Signature = key.sign(message);
        Ok(signature.to_der().as_bytes().to_vec())
    };
    let signer =
        crate::native_signer::ExternalSigner::new(&certs, spki.as_bytes(), &mut callback).unwrap();
    let request = crate::camera_capture::CameraRequest {
        version: 1,
        challenge: f.trace.request.challenge.clone(),
        location_request: Some(serde_json::to_value(&f.trace.request).unwrap()),
    };
    for (fix_delay, acquired_after_ms, expected) in [(0, 3000, true), (123, 2122, false)] {
        let mut trace = f.trace.clone();
        for sample in &mut trace.samples {
            sample.fix_timestamp_ms += fix_delay;
            sample.observed_elapsed_ms += fix_delay;
        }
        trace.ended_at_ms += fix_delay;
        trace.elapsed_ms += fix_delay;
        let location = serde_json::to_string(&sample_location(&trace.samples[0])).unwrap();
        let mut metadata = crate::camera_capture::tests::fixture();
        let received: u64 = metadata.request_received_elapsed_ns.parse().unwrap();
        let sensor = received + acquired_after_ms * 1_000_000;
        metadata.request_received_unix_ms = NOW as u64 * 1000;
        metadata.capture_requested_elapsed_ns = (sensor - 10).to_string();
        metadata.sensor_timestamp_ns = sensor.to_string();
        metadata.image_timestamp_ns = sensor.to_string();
        metadata.callback_received_elapsed_ns = (sensor + 100).to_string();
        metadata.image_received_elapsed_ns = (sensor + 100).to_string();
        metadata.acquired_at_unix_ms = NOW as u64 * 1000 + acquired_after_ms;
        metadata.callback_received_unix_ms = metadata.acquired_at_unix_ms;
        let image = signer
            .seal_camera(
                &jpeg(0),
                &request,
                &location,
                &metadata,
                metadata.acquired_at_unix_ms + 1,
            )
            .unwrap();
        let sidecar = proof::seal_location_proof(
            &serde_json::to_string(&trace).unwrap(),
            &f.identity,
            &proof::location_asset(&image).unwrap(),
            NOW + 13.0,
        )
        .unwrap();
        let result = f.verify(
            &image,
            &sidecar,
            &f.request(),
            signer.fingerprint(),
            &f.location_pin,
        );
        assert_eq!(result.verified, expected, "{:?}", result.errors);
        assert_eq!(result.checks.native_camera_metadata_valid, Some(true));
        assert_eq!(result.location_proof.unwrap()["verified"], true);
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
//! Native-only capture preparation. The caller is an internal session controller.

use std::{borrow::Cow, io::Cursor};

use image::{ImageDecoder, ImageFormat, ImageReader, Limits};

use super::ExternalSigner;
use crate::{
    camera_capture::{CameraCaptureMetadata, CameraRequest, ASSERTION_LABEL},
    err, ImageSigningIdentity,
};

impl ExternalSigner<'_> {
    /// Validate session-owned capture metadata and seal the native JPEG. The
    /// supplied GPS remains explicitly caller-submitted; a requested location
    /// proof must independently bind this final C2PA JPEG after sealing.
    pub fn seal_camera(
        &self,
        jpeg: &[u8],
        request: &CameraRequest,
        location_json: &str,
        metadata: &CameraCaptureMetadata,
        now_ms: u64,
    ) -> Result<Vec<u8>, String> {
        request.validate(now_ms)?;
        metadata.validate(&request.challenge, now_ms)?;
        metadata.validate_location(&crate::parse(location_json)?)?;
        if metadata.sealed_at_unix_ms.is_some() || metadata.seal_time_origin.is_some() {
            return Err("Native finalization timing must be assigned by the Rust signer".into());
        }
        let mut metadata = metadata.clone();
        metadata.sealed_at_unix_ms = Some(now_ms);
        metadata.seal_time_origin = Some("native-finalization-start".into());
        metadata.validate(&request.challenge, now_ms)?;
        if jpeg.len() > 32 * 1024 * 1024 {
            return Err("Native camera JPEG exceeds 32 MiB".into());
        }
        metadata.matches_jpeg(jpeg)?;
        let normalized = normalize_orientation(jpeg)?;
        let (mut builder, mut source) = crate::prepare_image(
            &normalized,
            &serde_json::to_string(&request.challenge).map_err(err)?,
            (metadata.acquired_at_unix_ms / 1000) as f64,
            location_json,
            request.location_request.clone(),
            ImageSigningIdentity {
                fingerprint: self.fingerprint(),
                protection: "external-key-unattested",
            },
        )?;
        metadata.matches_jpeg(source.get_ref())?;
        builder
            .add_assertion(ASSERTION_LABEL, &metadata)
            .map_err(err)?;
        let mut destination = Cursor::new(Vec::new());
        builder
            .sign(self, "image/jpeg", &mut source, &mut destination)
            .map_err(err)?;
        Ok(destination.into_inner())
    }
}

fn normalize_orientation(bytes: &[u8]) -> Result<Cow<'_, [u8]>, String> {
    let mut limits = Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Jpeg);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(err)?;
    let (width, height) = decoder.dimensions();
    if width < 256 || height < 256 || u64::from(width) * u64::from(height) > 16_777_216 {
        return Err("Native JPEG dimensions are outside the supported watermark profile".into());
    }
    let orientation = decoder.orientation().map_err(err)?;
    if orientation == image::metadata::Orientation::NoTransforms {
        return Ok(Cow::Borrowed(bytes));
    }
    // Camera2 may encode orientation in EXIF instead of rotating its pixels.
    // Apply it before watermark re-encoding removes original metadata.
    let mut image = image::DynamicImage::from_decoder(decoder).map_err(err)?;
    image.apply_orientation(orientation);
    let mut normalized = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut normalized, 96)
        .encode_image(&image)
        .map_err(err)?;
    Ok(Cow::Owned(normalized))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{camera_capture::tests::fixture, native_signer::create_certificate_chain};
    use futures::executor::block_on;
    use p256::{
        ecdsa::{signature::Signer as _, Signature},
        pkcs8::EncodePublicKey,
    };
    use serde_json::{json, Value};

    const NOW: f64 = 1_790_424_000.0;

    fn jpeg() -> Vec<u8> {
        let image = image::RgbImage::from_fn(640, 480, |x, y| {
            image::Rgb([(48 + x / 4 % 160) as u8, (48 + y / 3 % 160) as u8, 100])
        });
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 95)
            .encode_image(&image)
            .unwrap();
        bytes
    }

    fn location() -> String {
        json!({"latitude":47.4979,"longitude":19.0402,"accuracy_m":12.25,
            "altitude_m":null,"altitude_accuracy_m":null,"timestamp_ms":NOW * 1000.0,
            "source":"device-geolocation"})
        .to_string()
    }

    fn request() -> CameraRequest {
        CameraRequest {
            version: 1,
            challenge: serde_json::from_str(
                &crate::create_challenge("requester", "native camera fixture", NOW, 60).unwrap(),
            )
            .unwrap(),
            location_request: None,
        }
    }

    #[test]
    fn native_camera_roundtrip_checks_metadata_without_upgrading_attestation() {
        let key = crate::CertificateKey::generate().unwrap().key;
        let spki = key.verifying_key().to_public_key_der().unwrap();
        let certs = create_certificate_chain(spki.as_bytes()).unwrap();
        let mut callback = |message: &[u8]| {
            let signature: Signature = key.sign(message);
            Ok(signature.to_der().as_bytes().to_vec())
        };
        let signer = ExternalSigner::new(&certs, spki.as_bytes(), &mut callback).unwrap();
        let request = request();
        let signed = signer
            .seal_camera(
                &jpeg(),
                &request,
                &location(),
                &fixture(),
                (NOW * 1000.0) as u64,
            )
            .unwrap();
        let report: Value = serde_json::from_str(
            &block_on(crate::verify_image(
                &signed,
                &serde_json::to_string(&request.challenge).unwrap(),
                signer.fingerprint(),
                NOW + 1.0,
            ))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(report["verified"], true, "{report}");
        assert_eq!(report["checks"]["native_camera_metadata_valid"], true);
        assert_eq!(
            report["native_camera"]["sensor_timestamp_ns"],
            "9007199254741013"
        );
        assert_eq!(
            report["native_camera"]["gps_origin"],
            "caller-submitted-device-geolocation"
        );
        assert_eq!(report["hardware_attested"], false);
        assert_eq!(report["camera_freshness_proven"], false);
        assert_eq!(
            report["native_camera"]["sealed_at_unix_ms"],
            json!((NOW * 1000.0) as u64)
        );
        assert_eq!(
            report["native_camera"]["seal_time_origin"],
            "native-finalization-start"
        );
        assert!(signer
            .seal_camera(
                &jpeg(),
                &request,
                &location(),
                &fixture(),
                (NOW * 1000.0) as u64 + 30_001
            )
            .is_err());
        let mut invalid = fixture();
        invalid.image_timestamp_ns = "100".into();
        assert!(signer
            .seal_camera(
                &jpeg(),
                &request,
                &location(),
                &invalid,
                (NOW * 1000.0) as u64
            )
            .is_err());
    }

    #[test]
    fn native_camera_keeps_required_location_proof_and_exact_policy_binding() {
        let location_request: Value = serde_json::from_str(
            &crate::location_proof::create_location_request(
                "requester",
                "camera with location",
                NOW,
                60,
                "null",
                r#"{"purpose":"camera","session_id":"camera-fixture"}"#,
            )
            .unwrap(),
        )
        .unwrap();
        let request = CameraRequest {
            version: 1,
            challenge: serde_json::from_value(location_request["challenge"].clone()).unwrap(),
            location_request: Some(location_request.clone()),
        };
        let key = crate::CertificateKey::generate().unwrap().key;
        let spki = key.verifying_key().to_public_key_der().unwrap();
        let certs = create_certificate_chain(spki.as_bytes()).unwrap();
        let mut callback = |message: &[u8]| {
            let signature: Signature = key.sign(message);
            Ok(signature.to_bytes().to_vec())
        };
        let signer = ExternalSigner::new(&certs, spki.as_bytes(), &mut callback).unwrap();
        let signed = signer
            .seal_camera(
                &jpeg(),
                &request,
                &location(),
                &fixture(),
                (NOW * 1000.0) as u64,
            )
            .unwrap();
        let report: Value = serde_json::from_str(
            &block_on(crate::verify_image(
                &signed,
                &serde_json::to_string(&request.challenge).unwrap(),
                signer.fingerprint(),
                NOW + 1.0,
            ))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(report["verified"], false);
        assert_eq!(report["checks"]["native_camera_metadata_valid"], true);
        assert_eq!(report["checks"]["location_proof_valid"], false);
        assert_eq!(report["capture"]["location_request"], location_request);
        let mut wrong = request;
        wrong.location_request.as_mut().unwrap()["challenge"]["task"] = json!("a different task");
        assert!(wrong.validate((NOW * 1000.0) as u64).is_err());
    }

    #[test]
    fn native_camera_composed_wasm_js_requests_keep_exact_signed_policy_and_separate_proof() {
        // Synthetic pixels, capture metadata and raw observations; real Rust native
        // signing, C2PA/COSE verification and independent signing keys.
        let cases: Value =
            crate::parse(include_str!("camera_request_boundary_fixture.json")).unwrap();
        let media_key = crate::CertificateKey::generate().unwrap().key;
        let media_spki = media_key.verifying_key().to_public_key_der().unwrap();
        let certs = create_certificate_chain(media_spki.as_bytes()).unwrap();
        let mut callback = |message: &[u8]| {
            let signature: Signature = media_key.sign(message);
            Ok(signature.to_der().as_bytes().to_vec())
        };
        let signer = ExternalSigner::new(&certs, media_spki.as_bytes(), &mut callback).unwrap();
        let location_key = crate::CertificateKey::generate().unwrap().key;
        let location_spki = location_key.verifying_key().to_public_key_der().unwrap();
        let location_pin =
            crate::location_proof::fingerprint_spki(location_spki.as_bytes()).unwrap();
        let now_ms = NOW as u64 * 1000 + 12000;
        for case in cases["requests"].as_array().unwrap() {
            let original: Value = crate::parse(case["js_json"].as_str().unwrap()).unwrap();
            let request = CameraRequest {
                version: 1,
                challenge: serde_json::from_value(original["challenge"].clone()).unwrap(),
                location_request: Some(original.clone()),
            };
            let mut trace: crate::location_proof::Trace =
                crate::parse(include_str!("location_proof/raw_gnss_fixture.json")).unwrap();
            trace.request = serde_json::from_value(original.clone()).unwrap();
            if trace.request.policy.raw_gnss.is_none() {
                trace.raw_gnss = None;
            }
            let shifted = |time: u64| time - 2_000_000_000_000 + NOW as u64 * 1000;
            trace.started_at_ms = shifted(trace.started_at_ms);
            trace.ended_at_ms = shifted(trace.ended_at_ms);
            for sample in &mut trace.samples {
                sample.fix_timestamp_ms = shifted(sample.fix_timestamp_ms);
            }
            let sample = trace.samples.last().unwrap();
            let gps = json!({"latitude":sample.latitude,"longitude":sample.longitude,"accuracy_m":sample.accuracy_m,
                "altitude_m":sample.altitude_m,"altitude_accuracy_m":sample.altitude_accuracy_m,
                "timestamp_ms":sample.fix_timestamp_ms,"source":"device-geolocation"}).to_string();
            let mut metadata = fixture();
            metadata.request_received_unix_ms = now_ms;
            metadata.callback_received_unix_ms = now_ms;
            metadata.acquired_at_unix_ms = now_ms;
            let signed = signer
                .seal_camera(&jpeg(), &request, &gps, &metadata, now_ms)
                .unwrap();
            let proof = crate::location_proof::seal_with_signer(
                &trace,
                location_spki.as_bytes(),
                Some(crate::location_proof::asset_from_jpeg(&signed).unwrap()),
                now_ms,
                |message| {
                    let signature: Signature = location_key.sign(message);
                    Ok(signature.to_der().as_bytes().to_vec())
                },
            )
            .unwrap();
            let verify = |expected: &Value, sidecar: &[u8], pin: &str| -> crate::Verification {
                crate::parse(
                    &block_on(crate::verify_image_with_location_proof(
                        &signed,
                        sidecar,
                        &expected.to_string(),
                        signer.fingerprint(),
                        pin,
                        NOW + 13.0,
                    ))
                    .unwrap(),
                )
                .unwrap()
            };
            let report = verify(&original, &proof, &location_pin);
            assert!(report.verified, "{}: {:?}", case["profile"], report.errors);
            assert!(report.checks.c2pa_integrity);
            assert_eq!(report.checks.native_camera_metadata_valid, Some(true));
            assert_eq!(
                report.capture.unwrap().location_request,
                Some(original.clone())
            );
            assert!(
                !report.hardware_attested
                    && !report.camera_freshness_proven
                    && !report.location_authenticity_proven
            );
            // Equivalent WASM number spelling remains the same policy; every
            // substantive change still fails its independent signed-original check.
            let wasm: Value = crate::parse(case["wasm_json"].as_str().unwrap()).unwrap();
            assert!(verify(&wasm, &proof, &location_pin).verified);
            for (path, value) in [
                ("/policy/max_accuracy_m", json!(99.5)),
                ("/context/session_id", json!("another-session")),
                ("/challenge/task", json!("another-task")),
            ] {
                let mut changed = original.clone();
                *changed.pointer_mut(path).unwrap() = value;
                assert!(!verify(&changed, &proof, &location_pin).verified, "{path}");
            }
            if original["policy"].get("raw_gnss").is_some() {
                let mut changed = original.clone();
                changed["policy"]
                    .as_object_mut()
                    .unwrap()
                    .remove("raw_gnss");
                assert!(!verify(&changed, &proof, &location_pin).verified);
            }
            assert!(!verify(&original, &proof, &"0".repeat(64)).verified);
            let mut tampered = proof.clone();
            let last = tampered.len() - 1;
            tampered[last] ^= 1;
            assert!(!verify(&original, &tampered, &location_pin).verified);
        }
    }

    #[test]
    fn native_camera_normalizes_exif_rotation_before_watermark() {
        let original = jpeg();
        // Minimal little-endian TIFF IFD with Orientation=6 (rotate 90 degrees).
        let exif: &[u8] =
            b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let mut oriented = vec![0xff, 0xd8, 0xff, 0xe1];
        oriented.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        oriented.extend_from_slice(exif);
        oriented.extend_from_slice(&original[2..]);
        let normalized = normalize_orientation(&oriented).unwrap();
        let dimensions = ImageReader::with_format(Cursor::new(normalized), ImageFormat::Jpeg)
            .into_dimensions()
            .unwrap();
        assert_eq!(dimensions, (480, 640));
    }

    #[test]
    fn valid_c2pa_signature_cannot_hide_invalid_native_camera_metadata() {
        let identity_json = crate::create_identity().unwrap();
        let identity: crate::Identity = crate::parse(&identity_json).unwrap();
        let signer = crate::local_signer(&identity).unwrap();
        let request = request();
        let challenge = serde_json::to_string(&request.challenge).unwrap();
        let (mut builder, mut source) = crate::prepare_image(
            &jpeg(),
            &challenge,
            NOW,
            &location(),
            None,
            ImageSigningIdentity {
                fingerprint: &identity.fingerprint,
                protection: "device-local-software-key",
            },
        )
        .unwrap();
        let mut metadata = fixture();
        metadata.sealed_at_unix_ms = Some((NOW * 1000.0) as u64);
        metadata.seal_time_origin = Some("native-finalization-start".into());
        metadata.image_timestamp_ns = "100".into();
        builder.add_assertion(ASSERTION_LABEL, &metadata).unwrap();
        let mut destination = Cursor::new(Vec::new());
        builder
            .sign(&signer, "image/jpeg", &mut source, &mut destination)
            .unwrap();
        let report: Value = serde_json::from_str(
            &block_on(crate::verify_image(
                destination.get_ref(),
                &challenge,
                &identity.fingerprint,
                NOW + 1.0,
            ))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(report["checks"]["c2pa_integrity"], true);
        assert_eq!(report["checks"]["native_camera_metadata_valid"], false);
        assert_eq!(report["verified"], false);
    }

    #[test]
    fn signed_camera_cannot_claim_sealing_before_native_jpeg_arrival() {
        let identity: crate::Identity = crate::parse(&crate::create_identity().unwrap()).unwrap();
        let signer = crate::local_signer(&identity).unwrap();
        let challenge = serde_json::to_string(&request().challenge).unwrap();
        let (mut builder, mut source) = crate::prepare_image(
            &jpeg(),
            &challenge,
            NOW,
            &location(),
            None,
            ImageSigningIdentity {
                fingerprint: &identity.fingerprint,
                protection: "device-local-software-key",
            },
        )
        .unwrap();
        let mut metadata = fixture();
        metadata.image_received_elapsed_ns =
            (metadata.request_received_elapsed_ns.parse::<u64>().unwrap() + 2_000_000_000)
                .to_string();
        metadata.sealed_at_unix_ms = Some((NOW * 1000.0) as u64 + 1999);
        metadata.seal_time_origin = Some("native-finalization-start".into());
        builder.add_assertion(ASSERTION_LABEL, &metadata).unwrap();
        let mut destination = Cursor::new(Vec::new());
        builder
            .sign(&signer, "image/jpeg", &mut source, &mut destination)
            .unwrap();
        let report: Value = serde_json::from_str(
            &block_on(crate::verify_image(
                destination.get_ref(),
                &challenge,
                &identity.fingerprint,
                NOW + 3.0,
            ))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(report["checks"]["c2pa_integrity"], true);
        assert_eq!(report["checks"]["native_camera_metadata_valid"], false);
        assert_eq!(report["verified"], false);
    }

    #[test]
    fn signed_native_camera_exposure_must_end_by_jpeg_arrival() {
        let identity: crate::Identity = crate::parse(&crate::create_identity().unwrap()).unwrap();
        let signer = crate::local_signer(&identity).unwrap();
        let challenge = serde_json::to_string(&request().challenge).unwrap();
        let jpeg = jpeg();
        let mut metadata = fixture();
        metadata.sealed_at_unix_ms = Some((NOW * 1000.0) as u64);
        metadata.seal_time_origin = Some("native-finalization-start".into());
        let sensor = metadata.sensor_timestamp_ns.parse::<u64>().unwrap();
        let image = metadata.image_received_elapsed_ns.parse::<u64>().unwrap();
        // Synthetic counters exceed JavaScript's exact integer range. The
        // first-row exposure ends exactly at image receipt, then one ns later.
        for (exposure, valid) in [(image - sensor, true), (image - sensor + 1, false)] {
            metadata.exposure_time_ns = Some(exposure.to_string());
            // Bypass the native signing guard so the verifier must reject an
            // impossible claim even inside an otherwise genuine C2PA signature.
            let (mut builder, mut source) = crate::prepare_image(
                &jpeg,
                &challenge,
                NOW,
                &location(),
                None,
                ImageSigningIdentity {
                    fingerprint: &identity.fingerprint,
                    protection: "device-local-software-key",
                },
            )
            .unwrap();
            builder.add_assertion(ASSERTION_LABEL, &metadata).unwrap();
            let mut destination = Cursor::new(Vec::new());
            builder
                .sign(&signer, "image/jpeg", &mut source, &mut destination)
                .unwrap();
            let report: crate::Verification = crate::parse(
                &block_on(crate::verify_image(
                    destination.get_ref(),
                    &challenge,
                    &identity.fingerprint,
                    NOW + 1.0,
                ))
                .unwrap(),
            )
            .unwrap();
            assert!(report.checks.c2pa_integrity, "{:?}", report.errors);
            assert!(report.checks.challenge_match);
            assert!(report.checks.device_match);
            assert!(report.checks.capture_time_in_window);
            assert!(report.checks.capture_not_in_future);
            assert_eq!(report.checks.location_metadata_valid, Some(true));
            assert_eq!(report.checks.location_proof_valid, None);
            assert_eq!(report.checks.native_camera_metadata_valid, Some(valid));
            assert_eq!(report.verified, valid, "{:?}", report.errors);
            if valid {
                assert!(report.errors.is_empty());
                assert_eq!(
                    report.native_camera.unwrap().exposure_time_ns,
                    metadata.exposure_time_ns
                );
            } else {
                assert_eq!(report.errors.len(), 1, "{:?}", report.errors);
                assert!(report.errors[0].starts_with("Native camera metadata failed:"));
                assert!(report.native_camera.is_none());
            }
            assert!(!report.hardware_attested);
            assert!(!report.camera_freshness_proven);
            assert!(!report.location_authenticity_proven);
        }
    }

    #[test]
    fn native_camera_gps_age_is_checked_again_when_verifying_a_valid_signature() {
        let metadata = fixture();
        let mut gps: crate::location::Location = crate::parse(&location()).unwrap();
        gps.timestamp_ms -= 5000.0;
        metadata.validate_location(&gps).unwrap();
        gps.timestamp_ms -= 1.0;
        assert!(metadata.validate_location(&gps).is_err());
        let identity: crate::Identity = crate::parse(&crate::create_identity().unwrap()).unwrap();
        let signer = crate::local_signer(&identity).unwrap();
        let mut request = request();
        request.challenge.issued_at -= 10;
        let challenge = serde_json::to_string(&request.challenge).unwrap();
        // Legacy preparation accepts this five-second-old GPS report, so a
        // signed native assertion must impose its stronger age limit itself.
        let (mut builder, mut source) = crate::prepare_image(
            &jpeg(),
            &challenge,
            NOW,
            &serde_json::to_string(&gps).unwrap(),
            None,
            ImageSigningIdentity {
                fingerprint: &identity.fingerprint,
                protection: "device-local-software-key",
            },
        )
        .unwrap();
        let mut metadata = metadata;
        metadata.sealed_at_unix_ms = Some((NOW * 1000.0) as u64);
        metadata.seal_time_origin = Some("native-finalization-start".into());
        builder.add_assertion(ASSERTION_LABEL, &metadata).unwrap();
        let mut destination = Cursor::new(Vec::new());
        builder
            .sign(&signer, "image/jpeg", &mut source, &mut destination)
            .unwrap();
        let report: Value = serde_json::from_str(
            &block_on(crate::verify_image(
                destination.get_ref(),
                &challenge,
                &identity.fingerprint,
                NOW + 1.0,
            ))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(report["checks"]["c2pa_integrity"], true);
        assert_eq!(report["checks"]["native_camera_metadata_valid"], false);
        assert_eq!(report["verified"], false);
    }
}

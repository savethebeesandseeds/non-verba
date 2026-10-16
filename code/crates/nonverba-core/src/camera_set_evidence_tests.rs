// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use futures::executor::block_on;
use p256::{
    ecdsa::{signature::Signer as _, Signature},
    pkcs8::EncodePublicKey,
};

const NOW: f64 = 1_790_424_000.0;
const ATTEMPT: &str = "12345678-1234-1234-1234-123456789abc";
fn profile(single: bool) -> CameraSetProfile {
    CameraSetProfile {
        version: 1,
        kind: if single {
            CameraSetKind::SingleCamera
        } else {
            CameraSetKind::FrontBack
        },
        cameras: if single {
            vec![CameraDescriptor {
                camera_id: "front".into(),
                lens_facing: LensFacing::Front,
            }]
        } else {
            vec![
                CameraDescriptor {
                    camera_id: "front".into(),
                    lens_facing: LensFacing::Front,
                },
                CameraDescriptor {
                    camera_id: "rear".into(),
                    lens_facing: LensFacing::Back,
                },
            ]
        },
        timing: if single {
            CaptureTiming::Single {}
        } else {
            CaptureTiming::Concurrent {
                max_start_skew_ns: "5000000".into(),
            }
        },
    }
}
fn request(single: bool) -> CameraSetRequest {
    serde_json::from_str(
        &create_camera_set_request(
            "requester",
            "camera set synthetic",
            &serde_json::to_string(&profile(single)).unwrap(),
            "native-camera2",
            NOW,
            60,
        )
        .unwrap(),
    )
    .unwrap()
}
fn jpeg() -> Vec<u8> {
    let pixels = image::RgbImage::from_fn(640, 480, |x, y| {
        image::Rgb([(48 + x / 4 % 160) as u8, (48 + y / 3 % 160) as u8, 100])
    });
    let mut bytes = vec![];
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 95)
        .encode_image(&pixels)
        .unwrap();
    bytes
}
fn location() -> String {
    json!({"latitude":47.4979,"longitude":19.0402,"accuracy_m":12.25,"altitude_m":null,"altitude_accuracy_m":null,"timestamp_ms":NOW*1000.0,"source":"device-geolocation"}).to_string()
}
fn make(single: bool) -> (CameraSetBundle, String) {
    make_modified(single, "ordinary")
}
fn make_modified(single: bool, mode: &str) -> (CameraSetBundle, String) {
    let key = crate::CertificateKey::generate().unwrap().key;
    let spki = key.verifying_key().to_public_key_der().unwrap();
    let cert = crate::native_signer::create_certificate_chain(spki.as_bytes()).unwrap();
    let mut callback = |message: &[u8]| {
        let signature: Signature = key.sign(message);
        Ok(signature.to_der().as_bytes().to_vec())
    };
    let signer =
        crate::native_signer::ExternalSigner::new(&cert, spki.as_bytes(), &mut callback).unwrap();
    let mut request = request(single);
    if mode.starts_with("sequential") {
        request.profile.cameras.reverse(); // rear, then front
        request.profile.timing = CaptureTiming::Sequential {};
    }
    if mode == "skew" {
        request.profile.timing = CaptureTiming::Concurrent {
            max_start_skew_ns: "0".into(),
        };
    }
    let mut bundle = CameraSetBundle {
        version: 1,
        record_type: "nonverba-camera-set-bundle".into(),
        request: request.clone(),
        attempt_id: ATTEMPT.into(),
        images: vec![],
    };
    for (index, camera) in request.profile.cameras.iter().enumerate() {
        let mut metadata = crate::camera_capture::tests::fixture();
        metadata.session_id = ATTEMPT.into();
        metadata.camera_id = camera.camera_id.clone();
        metadata.lens_facing = if camera.lens_facing == LensFacing::Front {
            "front"
        } else {
            "back"
        }
        .into();
        if mode == "skew" && index == 1 {
            metadata.sensor_timestamp_ns =
                (metadata.sensor_timestamp_ns.parse::<u64>().unwrap() + 1).to_string();
            metadata.image_timestamp_ns = metadata.sensor_timestamp_ns.clone();
        }
        if mode == "unknown" && index == 1 {
            metadata.timestamp_source = "unknown".into();
            metadata.capture_time_origin = "callback-receipt".into();
        }
        if mode.starts_with("sequential") && index == 1 {
            let delta = if mode == "sequential-reversed" { 0 } else { 1 };
            metadata.sensor_timestamp_ns =
                (metadata.sensor_timestamp_ns.parse::<u64>().unwrap() + delta).to_string();
            metadata.image_timestamp_ns = metadata.sensor_timestamp_ns.clone();
            if mode == "sequential-unknown" {
                metadata.timestamp_source = "unknown".into();
                metadata.capture_time_origin = "callback-receipt".into();
            }
        }
        let member = CameraSetMember {
            version: 1,
            request: request.clone(),
            attempt_id: ATTEMPT.into(),
            camera_id: camera.camera_id.clone(),
        };
        let bytes = signer
            .seal_camera_set_member(
                &jpeg(),
                &member,
                &location(),
                &metadata,
                (NOW * 1000.0) as u64,
            )
            .unwrap();
        bundle.images.push(CameraSetImage {
            camera_id: camera.camera_id.clone(),
            jpeg_b64: STANDARD.encode(bytes),
        });
    }
    (bundle, signer.fingerprint().into())
}
fn verify(
    bundle: &CameraSetBundle,
    expected: &CameraSetRequest,
    pin: &str,
) -> CameraSetVerification {
    block_on(verify_bundle(
        &serde_json::to_string(bundle).unwrap(),
        &serde_json::to_string(expected).unwrap(),
        pin,
        NOW + 1.0,
    ))
    .unwrap()
}
#[test]
fn camera_set_c2pa_complete_and_explicit_single_roundtrip() {
    for single in [false, true] {
        let (bundle, pin) = make(single);
        let report = verify(&bundle, &bundle.request, &pin);
        assert!(
            report.verified,
            "{}",
            serde_json::to_string(&report).unwrap()
        );
        assert!(!report.physical_simultaneity_proven);
        assert!(!report.hardware_attested);
        // Retrieval after request expiry is allowed: signed acquisitions were in-window.
        assert!(
            block_on(verify_bundle(
                &serde_json::to_string(&bundle).unwrap(),
                &serde_json::to_string(&bundle.request).unwrap(),
                &pin,
                NOW + 3600.0
            ))
            .unwrap()
            .verified
        );
    }
}

#[test]
fn camera_set_sequential_signed_mode_order_gap_and_no_concurrent_promotion() {
    let (mut bundle, pin) = make_modified(false, "sequential");
    let report = verify(&bundle, &bundle.request, &pin);
    assert!(
        report.verified,
        "{}",
        serde_json::to_string(&report).unwrap()
    );
    assert_eq!(report.timing, TimingAssessment::SequentialOrderConfirmed);
    assert_eq!(report.exposure_start_span_ns.as_deref(), Some("1"));
    assert!(!report.physical_simultaneity_proven);
    bundle.images.reverse(); // unsigned transport ordering has no authority
    assert!(verify(&bundle, &bundle.request, &pin).verified);
    let mut concurrent = bundle.request.clone();
    concurrent.profile.timing = CaptureTiming::Concurrent {
        max_start_skew_ns: "1000000000".into(),
    };
    assert!(!verify(&bundle, &concurrent, &pin).verified);
    let mut reversed = bundle.request.clone();
    reversed.profile.cameras.reverse();
    assert!(!verify(&bundle, &reversed, &pin).verified);
    for mode in ["sequential-reversed", "sequential-unknown"] {
        let (bundle, pin) = make_modified(false, mode);
        let report = verify(&bundle, &bundle.request, &pin);
        assert!(report.members.iter().all(|m| m.image.verified));
        assert!(!report.verified);
        assert_eq!(
            report.timing,
            if mode == "sequential-unknown" {
                TimingAssessment::Unassessable
            } else {
                TimingAssessment::SequentialOrderViolated
            }
        );
        if mode == "sequential-unknown" {
            assert_eq!(report.exposure_start_span_ns, None);
        }
    }
}
#[test]
fn camera_set_c2pa_omissions_swaps_duplicates_bytes_request_key_and_attempt_fail() {
    let (bundle, pin) = make(false);
    let mut changed = bundle.clone();
    changed.images.pop();
    assert!(!verify(&changed, &bundle.request, &pin).verified);
    let mut changed = bundle.clone();
    changed.images.push(changed.images[0].clone());
    assert!(!verify(&changed, &bundle.request, &pin).verified);
    let mut changed = bundle.clone();
    changed.images[0].camera_id = "rear".into();
    changed.images[1].camera_id = "front".into();
    assert!(!verify(&changed, &bundle.request, &pin).verified);
    let mut changed = bundle.clone();
    let mut bytes = STANDARD.decode(&changed.images[0].jpeg_b64).unwrap();
    bytes[500] ^= 1;
    changed.images[0].jpeg_b64 = STANDARD.encode(bytes);
    assert!(!verify(&changed, &bundle.request, &pin).verified);
    let mut changed = bundle.clone();
    changed.request.challenge.task = "changed".into();
    assert!(!verify(&changed, &changed.request, &pin).verified);
    let mut changed = bundle.clone();
    changed.attempt_id = "22345678-1234-1234-1234-123456789abc".into();
    assert!(!verify(&changed, &bundle.request, &pin).verified);
    assert!(!verify(&bundle, &bundle.request, &"a".repeat(64)).verified);
}
#[test]
fn camera_set_c2pa_mixing_same_request_different_attempt_is_not_complete() {
    let (mut bundle, pin) = make(false);
    let (other, _) = make(false);
    bundle.images[1] = other.images[1].clone();
    assert!(!verify(&bundle, &bundle.request, &pin).verified);
}
#[test]
fn camera_set_c2pa_legacy_jpeg_cannot_be_promoted_to_set() {
    let (mut bundle, _) = make(true);
    let identity = crate::create_identity().unwrap();
    let value: serde_json::Value = serde_json::from_str(&identity).unwrap();
    let bytes = block_on(crate::seal_image(
        &jpeg(),
        &serde_json::to_string(&bundle.request.challenge).unwrap(),
        &identity,
        NOW,
        &location(),
    ))
    .unwrap();
    bundle.images[0].jpeg_b64 = STANDARD.encode(bytes);
    let report = verify(
        &bundle,
        &bundle.request,
        value["fingerprint"].as_str().unwrap(),
    );
    assert!(report.members[0].image.verified);
    assert!(!report.verified);
}
#[test]
fn camera_set_browser_single_is_distinct_from_native() {
    let mut request = request(true);
    request.acquisition = Acquisition::Browser;
    let identity = crate::create_identity().unwrap();
    let value: serde_json::Value = serde_json::from_str(&identity).unwrap();
    let bytes = block_on(seal_browser_camera_set_member(
        &jpeg(),
        &serde_json::to_string(&request).unwrap(),
        ATTEMPT,
        "front",
        &identity,
        &location(),
        NOW,
    ))
    .unwrap();
    let bundle = CameraSetBundle {
        version: 1,
        record_type: "nonverba-camera-set-bundle".into(),
        request: request.clone(),
        attempt_id: ATTEMPT.into(),
        images: vec![CameraSetImage {
            camera_id: "front".into(),
            jpeg_b64: STANDARD.encode(bytes),
        }],
    };
    assert!(verify(&bundle, &request, value["fingerprint"].as_str().unwrap()).verified);
    request.acquisition = Acquisition::NativeCamera2;
    assert!(!verify(&bundle, &request, value["fingerprint"].as_str().unwrap()).verified);
    assert!(block_on(seal_browser_camera_set_member(
        &jpeg(),
        &serde_json::to_string(&request).unwrap(),
        ATTEMPT,
        "front",
        &identity,
        &location(),
        NOW
    ))
    .is_err());
}
#[test]
fn camera_set_request_strict_expiry_and_no_location_downgrade() {
    let original = serde_json::to_value(request(false)).unwrap();
    let mut changed = original.clone();
    changed["location_request"] = json!({});
    assert!(parse_request(&changed.to_string()).is_err());
    let mut changed = original.clone();
    changed["profile"]["timing"]["max_start_skew_ns"] = json!(10);
    assert!(parse_request(&changed.to_string()).is_err());
    assert!(validate_camera_set_request(&original.to_string(), NOW + 61.0).is_err());
    assert!(parse_request(&" ".repeat(MAX_REQUEST_BYTES + 1)).is_err());
    let mut changed = original;
    changed["acquisition"] = json!("browser");
    assert!(parse_request(&changed.to_string()).is_err());
}

#[test]
fn camera_set_signed_timing_claims_must_satisfy_original_policy() {
    for (mode, timing) in [
        ("skew", TimingAssessment::ExceedsRequestedSkew),
        ("unknown", TimingAssessment::Unassessable),
    ] {
        let (bundle, pin) = make_modified(false, mode);
        let report = verify(&bundle, &bundle.request, &pin);
        assert!(report
            .members
            .iter()
            .all(|m| m.binding_valid && m.image.verified));
        assert_eq!(report.timing, timing);
        assert!(!report.verified);
    }
}

#[test]
fn camera_set_duplicate_signed_assertions_cannot_be_complete() {
    let mut request = request(true);
    request.acquisition = Acquisition::Browser;
    let identity: crate::Identity = crate::parse(&crate::create_identity().unwrap()).unwrap();
    let signer = crate::local_signer(&identity).unwrap();
    let member = CameraSetMember {
        version: 1,
        request: request.clone(),
        attempt_id: ATTEMPT.into(),
        camera_id: "front".into(),
    };
    let (mut builder, mut source) = crate::prepare_image(
        &jpeg(),
        &serde_json::to_string(&request.challenge).unwrap(),
        NOW,
        &location(),
        None,
        crate::ImageSigningIdentity {
            fingerprint: &identity.fingerprint,
            protection: "device-local-software-key",
        },
    )
    .unwrap();
    builder.add_assertion(ASSERTION_LABEL, &member).unwrap();
    builder.add_assertion(ASSERTION_LABEL, &member).unwrap();
    let mut output = Cursor::new(vec![]);
    builder
        .sign(&signer, "image/jpeg", &mut source, &mut output)
        .unwrap();
    let bundle = CameraSetBundle {
        version: 1,
        record_type: "nonverba-camera-set-bundle".into(),
        request: request.clone(),
        attempt_id: ATTEMPT.into(),
        images: vec![CameraSetImage {
            camera_id: "front".into(),
            jpeg_b64: STANDARD.encode(output.into_inner()),
        }],
    };
    assert!(!verify(&bundle, &request, &identity.fingerprint).verified);
}

// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use crate::key_enrollment::integration_tests::{enrollment, Enrollment, NOW};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures::executor::block_on;
use p256::{
    ecdsa::{signature::Signer, Signature},
    pkcs8::EncodePrivateKey,
};

fn basic_policy() -> Value {
    json!({"version":1,"native_acquisition_required":false,"raw_gnss_required":false,
        "correlated_camera_clock_required":false,"hardware_attestation_required":false,
        "independent_position_required":false})
}

fn signed_location(f: &Enrollment) -> Value {
    let request: Value = serde_json::from_str(
        &crate::location_proof::create_location_request(
            "independent verifier",
            "synthetic attestation binding test",
            NOW,
            60,
            "null",
            "null",
        )
        .unwrap(),
    )
    .unwrap();
    let samples: Vec<Value> = [0, 5000, 10000]
        .into_iter()
        .enumerate()
        .map(|(sequence, elapsed)| {
            json!({
                "sequence":sequence,"observed_elapsed_ms":elapsed,"fix_elapsed_ms":null,
                "fix_timestamp_ms":NOW as u64*1000+elapsed,"provider":"browser-geolocation",
                "latitude":47.4979,"longitude":19.0402,"accuracy_m":10,"altitude_m":null,
                "altitude_accuracy_m":null,"mock":null,
            })
        })
        .collect();
    let trace = json!({"version":1,"type":"nonverba-location-trace","request":request,
        "profile":"software-browser","permission_precision":"browser","uncertainty_semantics":"w3c-95-percent",
        "capture_correlation":"none","started_at_ms":NOW as u64*1000,"ended_at_ms":NOW as u64*1000+10000,
        "elapsed_ms":10000,"samples":samples});
    // The generated private fixture key remains in memory and is never exported.
    let identity = crate::Identity {
        version: 1,
        private_key_pkcs8_b64: STANDARD.encode(
            f.attestation
                .signing_key()
                .to_pkcs8_der()
                .unwrap()
                .as_bytes(),
        ),
        certificate_pem: String::new(),
        fingerprint: f.response["fingerprint"].as_str().unwrap().into(),
    };
    let proof = crate::location_proof::seal_location_proof(
        &trace.to_string(),
        &serde_json::to_string(&identity).unwrap(),
        "null",
        NOW + 10.0,
    )
    .unwrap();
    json!({"proof_b64":STANDARD.encode(proof),"request":request,"pin":f.response["fingerprint"],"now":NOW+11.0})
}

fn signed_image(f: &Enrollment) -> Value {
    let challenge: Value = serde_json::from_str(
        &crate::create_challenge(
            "independent verifier",
            "synthetic image key binding",
            NOW,
            60,
        )
        .unwrap(),
    )
    .unwrap();
    let image = image::RgbImage::from_fn(640, 480, |x, y| {
        image::Rgb([
            (48 + x / 4 % 160) as u8,
            (48 + y / 3 % 160) as u8,
            (64 + (x + y) / 5 % 128) as u8,
        ])
    });
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
        .encode_image(&image)
        .unwrap();
    let key = f.attestation.signing_key();
    let mut callback = |bytes: &[u8]| {
        let signature: Signature = key.sign(bytes);
        Ok(signature.to_bytes().to_vec())
    };
    let signer = crate::native_signer::ExternalSigner::new(
        f.response["certificate_pem"].as_str().unwrap(),
        &f.spki,
        &mut callback,
    )
    .unwrap();
    let location = json!({"latitude":47.4979,"longitude":19.0402,"accuracy_m":10,
        "altitude_m":null,"altitude_accuracy_m":null,"timestamp_ms":NOW as u64*1000,"source":"device-geolocation"});
    let jpeg = signer
        .seal_image(
            &jpeg,
            &challenge.to_string(),
            NOW + 1.0,
            &location.to_string(),
        )
        .unwrap();
    json!({"jpeg_b64":STANDARD.encode(jpeg),"request":challenge,"pin":f.response["fingerprint"],"now":NOW+2.0})
}

fn location_appraisal(artifact: &Value, policy: &Value, context: &Value) -> Result<Value, String> {
    serde_json::from_str(&appraise_location_with_context(
        &STANDARD
            .decode(artifact["proof_b64"].as_str().unwrap())
            .unwrap(),
        &artifact["request"].to_string(),
        artifact["pin"].as_str().unwrap(),
        "null",
        &policy.to_string(),
        &context.to_string(),
        artifact["now"].as_f64().unwrap(),
    )?)
    .map_err(crate::err)
}

#[test]
fn verified_location_signature_binds_enrollment_without_promoting_private_roots() {
    let f = enrollment("location");
    let artifact = signed_location(&f);
    let context = json!({"version":1,"key_attestation":f.context()});
    let mut policy = basic_policy();
    let report = location_appraisal(&artifact, &policy, &context).unwrap();
    assert_eq!(report["evidence_verified"], true);
    assert_eq!(
        report["additional_evidence"]["signing_key"]["artifact_key_bound"],
        true
    );
    assert_eq!(
        report["additional_evidence"]["signing_key"]["possession_proven"],
        true
    );
    assert_eq!(
        report["additional_evidence"]["signing_key"]["key_enrollment_attested"],
        false
    );
    assert_eq!(report["policy_satisfied"], true);
    policy["hardware_attestation_required"] = json!(true);
    let report = location_appraisal(&artifact, &policy, &context).unwrap();
    assert_eq!(report["evidence_verified"], true);
    assert_eq!(report["policy_satisfied"], false);
    assert_eq!(
        report["missing_requirements"],
        json!(["remote_hardware_attestation"])
    );
    let wrong = json!({"version":1,"key_attestation":enrollment("location").context()});
    assert!(location_appraisal(&artifact, &policy, &wrong).is_err());
    let mut changed = artifact.clone();
    changed["request"]["challenge"]["task"] = json!("different task");
    let report = location_appraisal(&changed, &policy, &context).unwrap();
    assert_eq!(report["evidence_verified"], false);
    assert_eq!(
        report["additional_evidence"]["signing_key"]["artifact_key_bound"],
        false
    );
    assert_eq!(
        report["additional_evidence"]["signing_key"]["possession_proven"],
        false
    );
}

#[test]
fn actual_c2pa_media_signer_is_bound_to_its_separate_enrollment_spki() {
    let f = enrollment("media");
    let artifact = signed_image(&f);
    let policy = basic_policy();
    let context = json!({"version":1,"key_attestation":f.context()});
    let evaluate = |ctx: &Value| {
        block_on(appraise_image_with_context(
            &STANDARD
                .decode(artifact["jpeg_b64"].as_str().unwrap())
                .unwrap(),
            &artifact["request"].to_string(),
            artifact["pin"].as_str().unwrap(),
            &policy.to_string(),
            &ctx.to_string(),
            NOW + 2.0,
        ))
    };
    let report: Value = serde_json::from_str(&evaluate(&context).unwrap()).unwrap();
    assert_eq!(report["evidence_verified"], true, "{report:#}");
    assert_eq!(
        report["additional_evidence"]["signing_key"]["artifact_key_bound"],
        true
    );
    assert_eq!(
        report["additional_evidence"]["signing_key"]["possession_proven"],
        true
    );
    assert_eq!(report["additional_evidence"]["key_attested"], false);
    assert_eq!(report["physical_measurement_authenticity_proven"], false);
    let wrong = json!({"version":1,"key_attestation":enrollment("media").context()});
    assert!(evaluate(&wrong).is_err());
}

#[test]
fn empty_context_preserves_baseline_and_operator_verdicts_are_rejected() {
    let f = enrollment("location");
    let artifact = signed_location(&f);
    let policy = basic_policy();
    let empty = json!({"version":1});
    let actual = location_appraisal(&artifact, &policy, &empty).unwrap();
    let baseline: Value = serde_json::from_str(
        &appraise_location(
            &STANDARD
                .decode(artifact["proof_b64"].as_str().unwrap())
                .unwrap(),
            &artifact["request"].to_string(),
            artifact["pin"].as_str().unwrap(),
            "null",
            &policy.to_string(),
            NOW + 11.0,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(actual, baseline);
    for ctx in [
        json!({"version":1,"key_attested":true}),
        json!({"version":1,"key_attestation":{"verified":true,"key_enrollment_attested":true}}),
        json!({"version":1,"location_key_attestation":f.context()}),
    ] {
        assert!(location_appraisal(&artifact, &policy, &ctx).is_err());
    }
    let mut ctx = json!({"version":1,"key_attestation":f.context()});
    ctx["key_attestation"]["verified"] = json!(true);
    assert!(location_appraisal(&artifact, &policy, &ctx).is_err());
}

#[test]
fn actual_signed_raw_observations_are_recomputed_by_the_context_verifier() {
    let f = crate::location_proof::position::reference_test_bundle();
    let artifact = json!({"proof_b64":f["proof_b64"],"request":f["original_request"],"pin":f["expected_pin"],"now":f["now_secs"]});
    let mut policy = basic_policy();
    policy["native_acquisition_required"] = json!(true);
    policy["raw_gnss_required"] = json!(true);
    policy["independent_position_required"] = json!(true);
    let mut context = json!({"version":1,"position":{"navigation_json":f["navigation_json"],"policy":f["policy"]}});
    let report = location_appraisal(&artifact, &policy, &context).unwrap();
    assert_eq!(report["evidence_verified"], true, "{report:#}");
    assert_eq!(
        report["additional_evidence"]["position_verified"], true,
        "{report:#}"
    );
    assert_eq!(report["policy_satisfied"], true, "{report:#}");
    assert_eq!(report["physical_measurement_authenticity_proven"], false);
    context["position"]["navigation_json"] =
        json!(format!("{} ", f["navigation_json"].as_str().unwrap()));
    let report = location_appraisal(&artifact, &policy, &context).unwrap();
    assert_eq!(report["additional_evidence"]["position_verified"], false);
    assert_eq!(report["policy_satisfied"], false);
}

#[test]
fn export_public_trust_fixture_when_requested() {
    let Ok(directory) = std::env::var("NONVERBA_TRUST_FIXTURE_DIR") else {
        return;
    };
    let location = enrollment("location");
    let media = enrollment("media");
    let bundle = json!({"synthetic":true,"physical_device_tested":false,"crypto_mocked":false,
        "location_enrollment":location.public_bundle(),"media_enrollment":media.public_bundle(),
        "location":signed_location(&location),"image":signed_image(&media),
        "position":crate::location_proof::position::reference_test_bundle(),"agent_policy":basic_policy()});
    let text = serde_json::to_string_pretty(&bundle).unwrap();
    assert!(
        !text.contains("PRIVATE KEY") && !text.contains("private_key") && !text.contains("pkcs8")
    );
    std::fs::write(
        std::path::Path::new(&directory).join("trust-synthetic-fixtures.json"),
        text,
    )
    .unwrap();
}

#[test]
fn composed_artifacts_bind_two_independent_enrollments_without_promoting_test_roots() {
    // Real signatures and certificate paths; synthetic camera/location and private
    // test trust anchors. No hardware or physical acquisition claim is possible.
    let media = enrollment("media");
    let location = enrollment("location");
    let ordinary = signed_location(&location);
    let ordinary_proof = STANDARD
        .decode(ordinary["proof_b64"].as_str().unwrap())
        .unwrap();
    let verified: Value = serde_json::from_str(
        &crate::location_proof::verify_location_proof(
            &ordinary_proof,
            &ordinary["request"].to_string(),
            ordinary["pin"].as_str().unwrap(),
            "null",
            NOW + 11.0,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(verified["verified"], true);
    let mut trace: crate::location_proof::Trace =
        serde_json::from_value(verified["evidence"]["trace"].clone()).unwrap();
    trace.request.context = Some(crate::location_proof::Context {
        camera_timing: None,
        session_id: trace.request.challenge.id.clone(),
        purpose: "camera".into(),
    });
    let request = serde_json::to_value(&trace.request).unwrap();
    let last = trace.samples.last().unwrap();
    let fix = json!({"latitude":last.latitude,"longitude":last.longitude,"accuracy_m":last.accuracy_m,
        "altitude_m":last.altitude_m,"altitude_accuracy_m":last.altitude_accuracy_m,
        "timestamp_ms":last.fix_timestamp_ms,"source":"device-geolocation"});
    let pixels = image::RgbImage::from_fn(640, 480, |x, y| {
        image::Rgb([
            (48 + x / 4 % 160) as u8,
            (48 + y / 3 % 160) as u8,
            (64 + (x + y) / 5 % 128) as u8,
        ])
    });
    let mut original_jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut original_jpeg, 95)
        .encode_image(&pixels)
        .unwrap();
    let media_key = media.attestation.signing_key();
    let mut sign_media = |data: &[u8]| {
        let signature: Signature = media_key.sign(data);
        Ok(signature.to_bytes().to_vec())
    };
    let media_signer = crate::native_signer::ExternalSigner::new(
        media.response["certificate_pem"].as_str().unwrap(),
        &media.spki,
        &mut sign_media,
    )
    .unwrap();
    let (mut builder, mut source) = crate::prepare_image(
        &original_jpeg,
        &request["challenge"].to_string(),
        NOW + 10.0,
        &fix.to_string(),
        Some(request.clone()),
        crate::ImageSigningIdentity {
            fingerprint: media_signer.fingerprint(),
            protection: "external-key-unattested",
        },
    )
    .unwrap();
    let mut output = std::io::Cursor::new(Vec::new());
    builder
        .sign(&media_signer, "image/jpeg", &mut source, &mut output)
        .unwrap();
    let jpeg = output.into_inner();
    let asset = crate::location_proof::location_asset(&jpeg).unwrap();
    let location_identity = crate::Identity {
        version: 1,
        private_key_pkcs8_b64: STANDARD.encode(
            location
                .attestation
                .signing_key()
                .to_pkcs8_der()
                .unwrap()
                .as_bytes(),
        ),
        certificate_pem: String::new(),
        fingerprint: location.response["fingerprint"].as_str().unwrap().into(),
    };
    let proof = crate::location_proof::seal_location_proof(
        &serde_json::to_string(&trace).unwrap(),
        &serde_json::to_string(&location_identity).unwrap(),
        &asset,
        NOW + 10.0,
    )
    .unwrap();
    let context = json!({"version":1,"key_attestation":media.context(),"location_key_attestation":location.context()});
    let evaluate = |ctx: &Value, policy: &Value| -> Result<Value, String> {
        serde_json::from_str(&block_on(appraise_camera_location_with_context(
            &jpeg,
            &proof,
            &request.to_string(),
            media.response["fingerprint"].as_str().unwrap(),
            location.response["fingerprint"].as_str().unwrap(),
            &policy.to_string(),
            &ctx.to_string(),
            NOW + 11.0,
        ))?)
        .map_err(crate::err)
    };
    let mut policy = basic_policy();
    let report = evaluate(&context, &policy).unwrap();
    assert_eq!(report["evidence_verified"], true, "{report:#}");
    assert_eq!(report["policy_satisfied"], true, "{report:#}");
    assert_eq!(report["additional_evidence"]["key_attested"], false);
    assert_eq!(report["physical_measurement_authenticity_proven"], false);
    for signer in ["signing_key", "location_key"] {
        assert_eq!(
            report["additional_evidence"][signer]["artifact_key_bound"],
            true
        );
        assert_eq!(
            report["additional_evidence"][signer]["possession_proven"],
            true
        );
        assert_eq!(
            report["additional_evidence"][signer]["key_enrollment_attested"],
            false
        );
    }
    policy["hardware_attestation_required"] = json!(true);
    // Neither both private roots nor a missing signer may become hardware trust.
    for ctx in [
        context.clone(),
        json!({"version":1,"key_attestation":media.context()}),
        json!({"version":1,"location_key_attestation":location.context()}),
        json!({"version":1}),
    ] {
        let report = evaluate(&ctx, &policy).unwrap();
        assert_eq!(report["evidence_verified"], true);
        assert_eq!(report["policy_satisfied"], false);
        assert_eq!(report["additional_evidence"]["key_attested"], false);
        assert_eq!(
            report["missing_requirements"],
            json!(["remote_hardware_attestation"])
        );
    }
    for (name, wrong) in [
        ("key_attestation", location.context()),
        ("location_key_attestation", media.context()),
        ("key_attestation", enrollment("media").context()),
        ("location_key_attestation", enrollment("location").context()),
    ] {
        let mut changed = context.clone();
        changed[name] = wrong;
        assert!(
            evaluate(&changed, &policy).is_err(),
            "{name} must bind the actual artifact signer"
        );
    }
}

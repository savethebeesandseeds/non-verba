// SPDX-License-Identifier: AGPL-3.0-only
//! Existing RTKLIB-generated observations, actual COSE/C2PA signatures and the
//! requester receipt verifier. All receiver/photo inputs remain synthetic.
use super::*;
use futures::executor::block_on;
use p256::{
    ecdsa::{signature::Signer, Signature, SigningKey},
    pkcs8::{DecodePrivateKey, EncodePublicKey},
};
use serde_json::{json as value, Value};

struct Fixture {
    requester: String,
    requester_pin: String,
    spec: Value,
    original: String,
    primary: Vec<u8>,
    secondary: Vec<u8>,
    context: String,
    receipt: String,
    issued_secs: f64,
    now_secs: f64,
    timing: ReceiptTiming,
}
impl Fixture {
    fn seal(&self, context: &str) -> Result<String, String> {
        block_on(seal_evidence_session_receipt(
            &self.original,
            &self.primary,
            &self.secondary,
            "",
            &json(&self.timing).unwrap(),
            &self.requester,
            &self.requester_pin,
            context,
            self.now_secs,
        ))
    }
    fn verify(&self, receipt: &str, context: &str) -> Value {
        serde_json::from_str(
            &block_on(verify_evidence_session_receipt(
                receipt,
                &self.original,
                &self.primary,
                &self.secondary,
                "",
                &self.requester_pin,
                context,
                self.now_secs,
            ))
            .unwrap(),
        )
        .unwrap()
    }
    fn resign_receipt_context(&self, context: &str) -> String {
        let mut envelope: ReceiptEnvelope = parse(&self.receipt).unwrap();
        let mut receipt = cose::read::<SessionReceipt>(
            &decode(&envelope.receipt_cose_b64).unwrap(),
            RECEIPT_TYPE,
        )
        .unwrap()
        .payload;
        // Deliberately give the hostile context a genuine requester signature.
        // Sensor/position policy must fail independently of envelope binding.
        receipt.context_binding = binding(context.as_bytes());
        envelope.receipt_cose_b64 = STANDARD.encode(
            cose::sign(
                &receipt,
                &cose::RequesterIdentity::load(&self.requester).unwrap(),
                RECEIPT_TYPE,
            )
            .unwrap(),
        );
        json(&envelope).unwrap()
    }
}

fn synthetic_jpeg() -> Vec<u8> {
    let pixels = image::RgbImage::from_fn(640, 480, |x, y| {
        image::Rgb([(40 + x / 4 % 170) as u8, (40 + y / 3 % 170) as u8, 96])
    });
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 95)
        .encode_image(&pixels)
        .unwrap();
    bytes
}

fn fixture(composed: bool) -> Fixture {
    let reference = crate::location_proof::position::reference_test_bundle();
    assert_eq!(reference["synthetic"], true);
    let original_proof = STANDARD
        .decode(reference["proof_b64"].as_str().unwrap())
        .unwrap();
    let verified: Value = serde_json::from_str(
        &crate::location_proof::verify_location_proof(
            &original_proof,
            &reference["original_request"].to_string(),
            reference["expected_pin"].as_str().unwrap(),
            "null",
            reference["now_secs"].as_f64().unwrap(),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(verified["verified"], true);
    let mut trace: crate::location_proof::Trace =
        serde_json::from_value(verified["evidence"]["trace"].clone()).unwrap();
    assert!(trace.raw_gnss.is_some());
    assert_eq!(trace.request.policy.profile, "native-required");
    assert_eq!(trace.request.policy.required_provider, "gnss");
    let now_secs = trace.ended_at_ms as f64 / 1000.0 + 1.0;
    let issued_secs = trace.request.challenge.issued_at as f64;
    let requester = crate::create_identity().unwrap();
    let requester_pin = cose::RequesterIdentity::load(&requester).unwrap().pin;
    let primary;
    let secondary;
    let pins;
    if composed {
        trace.request.context = Some(crate::location_proof::Context {
            camera_timing: None,
            session_id: "position-receipt-composition-test".into(),
            purpose: "camera".into(),
        });
        let media_identity = crate::create_identity().unwrap();
        let location_identity: Value =
            serde_json::from_str(&crate::create_identity().unwrap()).unwrap();
        let location_key = SigningKey::from_pkcs8_der(
            &STANDARD
                .decode(location_identity["private_key_pkcs8_b64"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        let spki = location_key.verifying_key().to_public_key_der().unwrap();
        let last = trace.samples.last().unwrap();
        let location = value!({
            "latitude":last.latitude, "longitude":last.longitude, "accuracy_m":last.accuracy_m,
            "altitude_m":last.altitude_m, "altitude_accuracy_m":last.altitude_accuracy_m,
            "timestamp_ms":last.fix_timestamp_ms, "source":"device-geolocation"
        });
        primary = block_on(crate::seal_image_with_location_request(
            &synthetic_jpeg(),
            &json(&trace.request.challenge).unwrap(),
            &media_identity,
            trace.ended_at_ms as f64 / 1000.0,
            &location.to_string(),
            &json(&trace.request).unwrap(),
        ))
        .unwrap();
        let asset = serde_json::from_str(&crate::location_proof::location_asset(&primary).unwrap())
            .unwrap();
        secondary = crate::location_proof::seal_with_signer(
            &trace,
            spki.as_bytes(),
            Some(asset),
            trace.ended_at_ms,
            |data| {
                let signature: Signature = location_key.sign(data);
                Ok(signature.to_bytes().to_vec())
            },
        )
        .unwrap();
        pins = value!({
            "media_certificate_sha256":crate::identity_fingerprint(&media_identity).unwrap(),
            "location_spki_sha256":crate::location_proof::fingerprint_spki(spki.as_bytes()).unwrap()
        });
    } else {
        primary = original_proof;
        secondary = Vec::new();
        pins = value!({"media_certificate_sha256":null,"location_spki_sha256":reference["expected_pin"]});
    }
    let spec = value!({
        "version":1,
        "evidence":{"type":if composed {"camera-location"} else {"location"},"request":trace.request},
        "operator_pins":pins,
        "policy":{"version":1,"native_acquisition_required":!composed,
            "raw_gnss_required":true,"correlated_camera_clock_required":false,
            "hardware_attestation_required":false,"independent_position_required":true},
        "delivery":{"max_response_ms":90000,"max_receipt_age_ms":60000}
    });
    let original =
        create_evidence_session_request(&spec.to_string(), &requester, issued_secs).unwrap();
    let context = value!({"version":1,"position":{
        "navigation_json":reference["navigation_json"],"policy":reference["policy"]
    }})
    .to_string();
    let sent = trace.request.challenge.issued_at * 1000;
    let received = trace.ended_at_ms + 1000;
    let mut f = Fixture {
        requester,
        requester_pin,
        spec,
        original,
        primary,
        secondary,
        context,
        receipt: String::new(),
        issued_secs,
        now_secs,
        timing: ReceiptTiming {
            sent_at_ms: sent,
            received_at_ms: received,
            elapsed_ms: received - sent,
        },
    };
    f.receipt = f.seal(&f.context).unwrap();
    f
}

#[test]
fn signed_raw_position_and_composed_jpeg_satisfy_the_retained_receipt_policy() {
    for composed in [false, true] {
        let f = fixture(composed);
        let report = f.verify(&f.receipt, &f.context);
        assert_eq!(report["verified"], true, "{report:#}");
        assert_eq!(report["fresh_action_eligible"], true);
        assert_eq!(report["checks"]["evidence_policy_satisfied"], true);
        assert_eq!(
            report["request"]["spec"]["policy"]["independent_position_required"],
            true
        );
        assert_eq!(
            report["receipt"]["primary_binding"]["sha256"],
            crate::digest(&f.primary)
        );
        assert_eq!(
            report["receipt"]["secondary_binding"]["sha256"],
            crate::digest(&f.secondary)
        );
        let position = &report["appraisal"]["additional_evidence"]["position"];
        for field in [
            "verified",
            "evidence_verified",
            "nav_digest_match",
            "independent_position_recomputed",
            "consistency_passed",
            "reported_location_consistent",
        ] {
            assert_eq!(position[field], true, "{field}: {position:#}");
        }
        assert_eq!(position["epochs"].as_array().unwrap().len(), 11);
        assert!(position["epochs"]
            .as_array()
            .unwrap()
            .iter()
            .all(|epoch| epoch["computed"] == true));
        for field in [
            "satellite_authentication_verified",
            "navigation_source_authenticated",
            "collection_attested",
            "physical_location_proven",
            "clock_trusted",
        ] {
            assert_eq!(position[field], false, "{field}");
        }
        assert_eq!(report["physical_measurement_authenticity_proven"], false);
        assert_eq!(report["requester_clock_trusted"], false);
        assert_eq!(report["acceptance_recorded"], false);
        assert_eq!(
            report["appraisal"]["additional_evidence"]["key_attested"],
            false
        );
        if composed {
            assert_eq!(
                report["appraisal"]["verification"]["checks"]["location_proof_valid"],
                true
            );
            assert_eq!(
                position["location_verification"]["evidence"]["asset"]["sha256"],
                crate::digest(&f.primary)
            );
        }
    }
}

#[test]
fn requester_signature_cannot_bless_missing_or_wrong_position_context() {
    for composed in [false, true] {
        let f = fixture(composed);
        let mut wrong_pin: Value = serde_json::from_str(&f.context).unwrap();
        wrong_pin["position"]["policy"]["nav_sha256"] = value!("0".repeat(64));
        for context in [r#"{"version":1}"#.to_owned(), wrong_pin.to_string()] {
            assert!(f.seal(&context).unwrap_err().contains("EVIDENCE_POLICY"));
            let report = f.verify(&f.resign_receipt_context(&context), &context);
            assert_eq!(report["checks"]["receipt_authenticated"], true);
            assert_eq!(report["checks"]["context_binding"], true);
            assert_eq!(report["checks"]["artifact_bindings"], true);
            assert_eq!(report["checks"]["evidence_verified"], true);
            assert_eq!(report["checks"]["evidence_policy_satisfied"], false);
            assert_eq!(
                report["appraisal"]["additional_evidence"]["position_verified"],
                false
            );
            assert_eq!(report["verified"], false);
            assert_eq!(report["fresh_action_eligible"], false);
            assert!(report["appraisal"]["missing_requirements"]
                .as_array()
                .unwrap()
                .contains(&value!("independent_position_recomputation")));
        }
        // Retained context bytes also remain part of the original receipt.
        let changed_context = f.verify(&f.receipt, &wrong_pin.to_string());
        assert_eq!(changed_context["checks"]["context_binding"], false);
    }
}

#[test]
fn position_receipts_still_require_original_authority_pins_and_exact_composed_asset() {
    let mut f = fixture(true);
    let original = f.original.clone();
    let mut altered_spec = f.spec.clone();
    altered_spec["policy"]["independent_position_required"] = value!(false);
    f.original =
        create_evidence_session_request(&altered_spec.to_string(), &f.requester, f.issued_secs)
            .unwrap();
    let report = f.verify(&f.receipt, &f.context);
    assert_eq!(report["checks"]["request_authenticated"], true);
    assert_eq!(report["checks"]["original_request_match"], false);
    assert_eq!(report["verified"], false);
    f.original = original.clone();
    for pin in ["location_spki_sha256", "media_certificate_sha256"] {
        let mut altered_spec = f.spec.clone();
        altered_spec["operator_pins"][pin] = value!("0".repeat(64));
        f.original =
            create_evidence_session_request(&altered_spec.to_string(), &f.requester, f.issued_secs)
                .unwrap();
        assert!(f.seal(&f.context).is_err(), "{pin}");
    }
    f.original = original;
    // The original signed raw observations still solve; they cannot authorize
    // replacing the complete JPEG that their own COSE asset binding commits to.
    f.primary[32] ^= 1;
    let report = f.verify(&f.receipt, &f.context);
    assert_eq!(report["checks"]["artifact_bindings"], false);
    assert_eq!(report["verified"], false);
    assert_eq!(report["fresh_action_eligible"], false);
    assert!(f.seal(&f.context).is_err());
}

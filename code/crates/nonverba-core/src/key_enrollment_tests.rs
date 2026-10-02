// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use crate::android_attestation::tests::{fixture_with_challenge, Fixture};
use p256::pkcs8::EncodePublicKey;

pub(crate) const NOW: f64 = 1_800_000_000.0;
pub(crate) struct Enrollment {
    pub(crate) attestation: Fixture,
    pub(crate) request: Value,
    pub(crate) response: Value,
    pub(crate) policy: Value,
    pub(crate) spki: Vec<u8>,
}
impl Enrollment {
    pub(crate) fn verify(&self, arrival: f64, now: f64) -> Result<Value, String> {
        serde_json::from_str(&verify_key_enrollment(
            &self.response.to_string(),
            &self.request.to_string(),
            &self.policy.to_string(),
            &self.attestation.trust.to_string(),
            arrival,
            now,
        )?)
        .map_err(crate::err)
    }
    pub(crate) fn context(&self) -> Value {
        let report = self.verify(NOW, NOW).unwrap();
        json!({"chain":self.attestation.chain,"expected":report["expected"],"trust":self.attestation.trust})
    }
    pub(crate) fn public_bundle(&self) -> Value {
        json!({"request":self.request,"response":self.response,"policy":self.policy,
            "trust":self.attestation.trust,"context":self.context(),"arrival":NOW,"now":NOW})
    }
}
pub(crate) fn enrollment(purpose: &str) -> Enrollment {
    let request: Value =
        serde_json::from_str(&create_key_enrollment_request(purpose, NOW).unwrap()).unwrap();
    let challenge = STANDARD
        .decode(request["challenge_b64"].as_str().unwrap())
        .unwrap();
    let attestation = fixture_with_challenge(&challenge);
    let key = attestation.signing_key();
    let spki = key
        .verifying_key()
        .to_public_key_der()
        .unwrap()
        .as_bytes()
        .to_vec();
    let (certificate, fingerprint) = if purpose == "media" {
        let certificate = crate::native_signer::create_certificate_chain(&spki).unwrap();
        let fingerprint = crate::certificate_fingerprint(&certificate).unwrap();
        (Some(certificate), fingerprint)
    } else {
        (
            None,
            crate::location_proof::fingerprint_spki(&spki).unwrap(),
        )
    };
    let response = json!({"version":1,"type":"nonverba-key-enrollment","purpose":purpose,
        "challenge_b64":request["challenge_b64"],"public_spki_der_b64":STANDARD.encode(&spki),
        "spki_sha256":crate::digest(&spki),"fingerprint":fingerprint,
        "chain":attestation.chain,"key_profile":"attested","security_level":"trusted-environment",
        "strongbox_requested":true,"strongbox_fallback":true,"hardware_attested":false,
        "certificate_pem":certificate});
    let mut policy = attestation.expected.clone();
    for key in [
        "challenge_b64",
        "challenge_issued_at",
        "challenge_expires_at",
        "response_received_at",
        "expected_spki_sha256",
    ] {
        policy.as_object_mut().unwrap().remove(key);
    }
    Enrollment {
        attestation,
        request,
        response,
        policy,
        spki,
    }
}

#[test]
fn original_nonce_purpose_and_times_are_domain_bound() {
    let f = enrollment("location");
    for (field, value) in [
        ("purpose", json!("media")),
        ("nonce_b64", json!(STANDARD.encode([4; 32]))),
        ("issued_at", json!(NOW as u64 - 1)),
        ("expires_at", json!(NOW as u64 + 599)),
        ("challenge_b64", json!(STANDARD.encode([5; 32]))),
    ] {
        let mut request = f.request.clone();
        request[field] = value;
        assert!(
            validate_key_enrollment_request(&request.to_string(), NOW).is_err(),
            "{field}"
        );
    }
    assert!(validate_key_enrollment_request(&f.request.to_string(), NOW + 599.0).is_ok());
    assert!(validate_key_enrollment_request(&f.request.to_string(), NOW + 600.0).is_err());
}

#[test]
fn actual_attested_key_binds_both_identity_pin_formats_without_hardware_claims() {
    for purpose in ["location", "media"] {
        let f = enrollment(purpose);
        let result = f.verify(NOW, NOW + 1.0).unwrap();
        assert_eq!(result["verified"], true);
        assert_eq!(result["key_enrollment_attested"], false);
        assert_eq!(result["possession_proven"], false);
        assert_eq!(result["sensor_origin_proven"], false);
        assert_eq!(result["fingerprint"], f.response["fingerprint"]);
        assert_eq!(result["spki_sha256"], crate::digest(&f.spki));
        f.verify(NOW, NOW + 1000.0).unwrap(); // Request expiry is distinct from enrollment age.
    }
}

#[test]
fn operator_response_cannot_replace_challenge_key_identity_or_claim_authority() {
    for (field, value) in [
        ("purpose", json!("media")),
        ("challenge_b64", json!(STANDARD.encode([6; 32]))),
        ("spki_sha256", json!("0".repeat(64))),
        ("fingerprint", json!("0".repeat(64))),
        ("hardware_attested", json!(true)),
        ("strongbox_requested", json!(false)),
        ("verified", json!(true)),
        ("key_profile", json!("legacy")),
    ] {
        let mut f = enrollment("location");
        f.response[field] = value;
        assert!(f.verify(NOW, NOW).is_err(), "{field}");
    }
    let mut f = enrollment("location");
    let other = enrollment("location");
    for field in ["public_spki_der_b64", "spki_sha256", "fingerprint"] {
        f.response[field] = other.response[field].clone();
    }
    assert!(f.verify(NOW, NOW).is_err());
    let mut media = enrollment("media");
    media.response["certificate_pem"] = enrollment("media").response["certificate_pem"].clone();
    assert!(media.verify(NOW, NOW).is_err());
    let mut location = enrollment("location");
    location.response["certificate_pem"] = media.response["certificate_pem"].clone();
    assert!(location.verify(NOW, NOW).is_err());
}

#[test]
fn enrollment_requires_independent_app_policy_arrival_and_fresh_revocation() {
    for (field, value) in [
        ("package_name", json!("org.attacker.camera")),
        ("min_version_code", json!(7)),
        ("signing_certificate_sha256", json!(["0".repeat(64)])),
        ("minimum_security_level", json!("strongbox")),
        ("trusted", json!(true)),
    ] {
        let mut f = enrollment("media");
        f.policy[field] = value;
        assert!(f.verify(NOW, NOW).is_err(), "{field}");
    }
    let f = enrollment("location");
    assert!(f.verify(NOW - 1.0, NOW).is_err());
    assert!(f.verify(NOW + 600.0, NOW + 600.0).is_err());
    assert!(f.verify(NOW + 1.0, NOW).is_err());
    let mut f = enrollment("location");
    f.attestation.trust["revocation"]["entries"]["2"] = json!({"status":"SUSPENDED"});
    assert!(f.verify(NOW, NOW).is_err());
    let mut f = enrollment("location");
    f.attestation.trust["revocation"]["valid_until"] = json!(NOW as u64);
    assert!(f.verify(NOW, NOW).is_err());
    let mut f = enrollment("location");
    f.attestation.trust["profile"] = json!("google-hardware-attestation");
    assert!(f.verify(NOW, NOW).is_err());
}

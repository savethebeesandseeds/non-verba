// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use crate::CertificateKey;
use rcgen::{
    BasicConstraints, CertificateParams, CustomExtension, DnType, IsCa, Issuer, KeyUsagePurpose,
};
use serde_json::Value;
const NOW: u64 = 1_800_000_000;
const OID: &[u64] = &[1, 3, 6, 1, 4, 1, 11129, 2, 1, 17];

fn tlv(tag: &[u8], body: &[u8]) -> Vec<u8> {
    let mut out = tag.to_vec();
    if body.len() < 128 {
        out.push(body.len() as u8);
    } else if body.len() < 256 {
        out.extend([129, body.len() as u8]);
    } else {
        out.extend([130, (body.len() >> 8) as u8, body.len() as u8]);
    }
    out.extend(body);
    out
}
fn integer(tag: u8, value: u64) -> Vec<u8> {
    let bytes = value.to_be_bytes();
    let start = bytes.iter().position(|v| *v != 0).unwrap_or(7);
    let mut bytes = bytes[start..].to_vec();
    if bytes[0] & 128 != 0 {
        bytes.insert(0, 0);
    }
    tlv(&[tag], &bytes)
}
fn seq(children: Vec<Vec<u8>>) -> Vec<u8> {
    tlv(&[48], &children.concat())
}
fn set(mut children: Vec<Vec<u8>>) -> Vec<u8> {
    children.sort();
    tlv(&[49], &children.concat())
}
fn octets(bytes: &[u8]) -> Vec<u8> {
    tlv(&[4], bytes)
}
fn tagged(tag: u32, value: Vec<u8>) -> Vec<u8> {
    let mut id = if tag < 31 {
        vec![160 + tag as u8]
    } else {
        vec![191]
    };
    if tag >= 31 {
        if tag >= 128 {
            id.push(128 + (tag >> 7) as u8);
        }
        id.push((tag & 127) as u8);
    }
    tlv(&id, &value)
}
fn lists() -> (BTreeMap<u32, Vec<u8>>, BTreeMap<u32, Vec<u8>>) {
    let app = seq(vec![
        set(vec![seq(vec![
            octets(b"org.nonverba.camera"),
            integer(2, 6),
        ])]),
        set(vec![octets(&[9; 32])]),
    ]);
    let software = BTreeMap::from([(701, integer(2, NOW * 1000)), (709, octets(&app))]);
    let hardware = BTreeMap::from([
        (1, set(vec![integer(2, 2)])),
        (2, integer(2, 3)),
        (3, integer(2, 256)),
        (5, set(vec![integer(2, 4)])),
        (10, integer(2, 1)),
        (503, vec![5, 0]),
        (702, integer(2, 0)),
        (
            704,
            seq(vec![
                octets(&[1; 32]),
                vec![1, 1, 255],
                integer(10, 0),
                octets(&[2; 32]),
            ]),
        ),
        (705, integer(2, 160000)),
        (706, integer(2, 202609)),
        (718, integer(2, 20260901)),
        (719, integer(2, 20260901)),
    ]);
    (software, hardware)
}
fn description(
    software: BTreeMap<u32, Vec<u8>>,
    hardware: BTreeMap<u32, Vec<u8>>,
    level: u64,
) -> Vec<u8> {
    description_with_challenge(software, hardware, level, &[7; 32])
}
fn description_with_challenge(
    software: BTreeMap<u32, Vec<u8>>,
    hardware: BTreeMap<u32, Vec<u8>>,
    level: u64,
    challenge: &[u8],
) -> Vec<u8> {
    let list = |values: BTreeMap<u32, Vec<u8>>| {
        seq(values.into_iter().map(|(k, v)| tagged(k, v)).collect())
    };
    seq(vec![
        integer(2, 300),
        integer(10, level),
        integer(2, 300),
        integer(10, level),
        octets(challenge),
        octets(&[]),
        list(software),
        list(hardware),
    ])
}
fn valid_description() -> Vec<u8> {
    let (s, h) = lists();
    description(s, h, 1)
}
pub(crate) struct Fixture {
    pub(crate) chain: Value,
    pub(crate) expected: Value,
    pub(crate) trust: Value,
    leaf_key: CertificateKey,
    leaf_params: CertificateParams,
}
impl Fixture {
    pub(crate) fn signing_key(&self) -> p256::ecdsa::SigningKey {
        self.leaf_key.key.clone()
    }
    fn new(
        record: Vec<u8>,
        mutate: impl FnOnce(&mut CertificateParams, &mut CertificateParams, &mut CertificateParams),
    ) -> Self {
        fn params(name: &str, key: &CertificateKey, serial: u64, ca: bool) -> CertificateParams {
            let mut p = CertificateParams::default();
            p.distinguished_name.push(DnType::CommonName, name);
            p.serial_number = Some(serial.into());
            p.is_ca = if ca {
                IsCa::Ca(BasicConstraints::Unconstrained)
            } else {
                IsCa::ExplicitNoCa
            };
            p.key_usages = if ca {
                vec![KeyUsagePurpose::KeyCertSign]
            } else {
                vec![KeyUsagePurpose::DigitalSignature]
            };
            key.configure_certificate(&mut p);
            p.serial_number = Some(serial.into());
            p
        }
        let root_key = CertificateKey::generate().unwrap();
        let issuer_key = CertificateKey::generate().unwrap();
        let leaf_key = CertificateKey::generate().unwrap();
        let mut root_p = params("synthetic attestation root", &root_key, 3, true);
        let mut issuer_p = params("synthetic attestation issuer", &issuer_key, 2, true);
        let mut leaf_p = params("synthetic attested key", &leaf_key, 1, false);
        leaf_p
            .custom_extensions
            .push(CustomExtension::from_oid_content(OID, record));
        mutate(&mut root_p, &mut issuer_p, &mut leaf_p);
        let root = root_p.self_signed(&root_key).unwrap();
        let root = root.der().to_vec();
        let root_issuer = Issuer::new(root_p, root_key);
        let issuer = issuer_p.signed_by(&issuer_key, &root_issuer).unwrap();
        let issuer_der = issuer.der().to_vec();
        let issuer = Issuer::new(issuer_p, issuer_key);
        let leaf = leaf_p.signed_by(&leaf_key, &issuer).unwrap();
        let leaf = leaf.der().to_vec();
        let (_, leaf_x) = X509Certificate::from_der(&leaf).unwrap();
        let leaf_pin = crate::digest(leaf_x.public_key().raw);
        let (_, root_x) = X509Certificate::from_der(&root).unwrap();
        let root_pin = crate::digest(root_x.public_key().raw);
        Self {
            chain: json!({"version":1,"certificates_der_b64":[STANDARD.encode(&leaf),STANDARD.encode(&issuer_der),STANDARD.encode(&root)]}),
            expected: json!({"version":1,"challenge_b64":STANDARD.encode([7;32]),"challenge_issued_at":NOW-10,"challenge_expires_at":NOW+120,
                "response_received_at":NOW,"max_enrollment_age_secs":86400,"expected_spki_sha256":leaf_pin,
                "package_name":"org.nonverba.camera","min_version_code":6,"signing_certificate_sha256":[hex::encode([9;32])],
                "minimum_security_level":"trusted-environment","minimum_os_version":150000,"minimum_os_patch_level":202608,
                "minimum_vendor_patch_level":20260801,"minimum_boot_patch_level":20260801}),
            trust: json!({"version":1,"profile":"private-test","root_spki_sha256":[root_pin],"revocation":{"fetched_at":NOW-1,"valid_until":NOW+3600,"entries":{}}}),
            leaf_key,
            leaf_params: leaf_p,
        }
    }
    fn verify(&self, now: u64) -> Result<Value, String> {
        serde_json::from_str(&verify_key_attestation(
            &self.chain.to_string(),
            &self.expected.to_string(),
            &self.trust.to_string(),
            now as f64,
        )?)
        .map_err(crate::err)
    }
}
pub(crate) fn fixture() -> Fixture {
    fixture_with_challenge(&[7; 32])
}
pub(crate) fn fixture_with_challenge(challenge: &[u8]) -> Fixture {
    let (software, hardware) = lists();
    let mut fixture = Fixture::new(
        description_with_challenge(software, hardware, 1, challenge),
        |_, _, _| {},
    );
    fixture.expected["challenge_b64"] = json!(STANDARD.encode(challenge));
    fixture
}

#[test]
fn synthetic_valid_chain_is_not_a_google_hardware_verdict() {
    use p256::pkcs8::EncodePublicKey;
    let f = fixture();
    let report = f.verify(NOW).unwrap();
    assert_eq!(report["verified"], true);
    assert_eq!(report["key_enrollment_attested"], false);
    assert_eq!(
        f.expected["expected_spki_sha256"],
        crate::digest(
            f.signing_key()
                .verifying_key()
                .to_public_key_der()
                .unwrap()
                .as_bytes()
        )
    );
    assert_eq!(report["sensor_origin_proven"], false);
    assert_eq!(report["state_scope"], "at-key-generation");
    assert_eq!(report["claims"]["os_patch_level"], 202609);
    f.verify(NOW + 1000).unwrap(); // reusable enrollment after original challenge expiry
}
#[test]
fn operator_trust_roots_and_expected_keys_cannot_substitute() {
    let mut f = fixture();
    f.trust["profile"] = json!("google-hardware-attestation");
    assert!(f.verify(NOW).is_err());
    f.trust["profile"] = json!("private-test");
    f.trust["root_spki_sha256"] = json!(["0".repeat(64)]);
    assert!(f.verify(NOW).is_err());
    let mut f = fixture();
    f.expected["expected_spki_sha256"] = json!("0".repeat(64));
    assert!(f.verify(NOW).is_err());
    let mut f = fixture();
    f.expected["challenge_b64"] = json!(STANDARD.encode([8; 32]));
    assert!(f.verify(NOW).is_err());
}
#[test]
fn pinned_app_identity_patch_level_and_strongbox_policy_are_enforced() {
    for (field, value) in [
        ("package_name", json!("org.other.app")),
        ("min_version_code", json!(7)),
        ("signing_certificate_sha256", json!(["0".repeat(64)])),
        ("minimum_security_level", json!("strongbox")),
        ("minimum_os_patch_level", json!(202610)),
        ("minimum_vendor_patch_level", json!(20261001)),
        ("minimum_boot_patch_level", json!(20261001)),
    ] {
        let mut f = fixture();
        f.expected[field] = value;
        assert!(f.verify(NOW).is_err(), "{field}");
    }
}
#[test]
fn revocation_freshness_all_chain_serials_and_enrollment_age_fail_closed() {
    for serial in ["1", "2", "3"] {
        let mut f = fixture();
        f.trust["revocation"]["entries"][serial] = json!({"status":"REVOKED"});
        assert!(f.verify(NOW).is_err());
    }
    let mut f = fixture();
    f.trust["revocation"]["valid_until"] = json!(NOW);
    assert!(f.verify(NOW).is_err());
    let mut f = fixture();
    f.trust["revocation"]["fetched_at"] = json!(NOW + 1);
    assert!(f.verify(NOW).is_err());
    let mut f = fixture();
    f.expected["response_received_at"] = json!(NOW + 121);
    assert!(f.verify(NOW + 121).is_err());
    let mut f = fixture();
    f.expected["max_enrollment_age_secs"] = json!(1);
    assert!(f.verify(NOW + 2).is_err());
    let mut f = fixture();
    f.trust["revocation"]["entries"]["1"] = json!({"status":"GOOD"});
    assert!(f.verify(NOW).is_err());
}
#[test]
fn certificate_signatures_ca_constraints_and_expiry_are_independent() {
    let mut f = fixture();
    let mut leaf = STANDARD
        .decode(f.chain["certificates_der_b64"][0].as_str().unwrap())
        .unwrap();
    let last = leaf.len() - 1;
    leaf[last] ^= 1;
    f.chain["certificates_der_b64"][0] = json!(STANDARD.encode(leaf));
    assert!(f.verify(NOW).is_err());
    assert!(
        Fixture::new(valid_description(), |_, issuer, _| issuer.is_ca =
            IsCa::ExplicitNoCa)
        .verify(NOW)
        .is_err()
    );
    assert!(Fixture::new(valid_description(), |root, _, _| root.is_ca =
        IsCa::Ca(BasicConstraints::Constrained(0)))
    .verify(NOW)
    .is_err());
    assert!(
        Fixture::new(valid_description(), |_, _, leaf| leaf.not_after =
            rcgen::date_time_ymd(2020, 1, 1))
        .verify(NOW)
        .is_err()
    );
    assert!(
        Fixture::new(valid_description(), |_, issuer, _| issuer.key_usages =
            vec![KeyUsagePurpose::DigitalSignature])
        .verify(NOW)
        .is_err()
    );
}
#[test]
fn unknown_critical_and_unimplemented_path_constraints_are_rejected() {
    for critical in [false, true] {
        assert!(Fixture::new(valid_description(), |_, _, leaf| {
            let mut ext = CustomExtension::from_oid_content(
                if critical {
                    &[1, 2, 3, 99]
                } else {
                    &[2, 5, 29, 54]
                },
                vec![2, 1, 0],
            );
            ext.set_criticality(critical);
            leaf.custom_extensions.push(ext);
        })
        .verify(NOW)
        .is_err());
    }
}
#[test]
fn appended_forged_attestations_and_duplicate_extensions_are_rejected() {
    assert!(Fixture::new(valid_description(), |_, issuer, _| issuer
        .custom_extensions
        .push(CustomExtension::from_oid_content(OID, valid_description())))
    .verify(NOW)
    .is_err());
    assert!(Fixture::new(valid_description(), |_, _, leaf| leaf
        .custom_extensions
        .push(CustomExtension::from_oid_content(OID, valid_description())))
    .verify(NOW)
    .is_err());
    let mut f = fixture();
    let attacker = CertificateKey::generate().unwrap();
    let mut p = CertificateParams::default();
    p.distinguished_name
        .push(DnType::CommonName, "appended fake leaf");
    p.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    p.serial_number = Some(5u64.into());
    p.custom_extensions
        .push(CustomExtension::from_oid_content(OID, valid_description()));
    attacker.configure_certificate(&mut p);
    let appended = p
        .signed_by(&attacker, &Issuer::new(f.leaf_params.clone(), &f.leaf_key))
        .unwrap();
    f.chain["certificates_der_b64"]
        .as_array_mut()
        .unwrap()
        .insert(0, json!(STANDARD.encode(appended.der())));
    assert!(f.verify(NOW).is_err());
}
#[test]
fn hardware_enforcement_boot_state_and_authorization_tags_fail_closed() {
    let (s, h) = lists();
    assert!(Fixture::new(description(s, h, 0), |_, _, _| {})
        .verify(NOW)
        .is_err());
    let (s, mut h) = lists();
    h.insert(
        704,
        seq(vec![
            octets(&[1; 32]),
            vec![1, 1, 0],
            integer(10, 0),
            octets(&[2; 32]),
        ]),
    );
    assert!(Fixture::new(description(s, h, 1), |_, _, _| {})
        .verify(NOW)
        .is_err());
    for tag in [1, 702, 704, 705, 706, 718, 719] {
        let (s, mut h) = lists();
        h.remove(&tag);
        assert!(
            Fixture::new(description(s, h, 1), |_, _, _| {})
                .verify(NOW)
                .is_err(),
            "tag {tag}"
        );
    }
    let (mut s, h) = lists();
    s.insert(705, integer(2, 160000));
    assert!(Fixture::new(description(s, h, 1), |_, _, _| {})
        .verify(NOW)
        .is_err());
    let (s, mut h) = lists();
    h.insert(999, integer(2, 0));
    assert!(Fixture::new(description(s, h, 1), |_, _, _| {})
        .verify(NOW)
        .is_err());
}
#[test]
fn malformed_der_and_duplicate_authorization_tags_are_rejected() {
    for bytes in [
        vec![48, 128, 0, 0],
        vec![48, 129, 0],
        vec![2, 2, 0, 1],
        vec![1, 1, 1],
        vec![48, 3, 5, 0, 0],
    ] {
        assert!(der::canonical(&bytes).is_err());
    }
    let desc = valid_description();
    let fields = der::one(&desc).unwrap().children(16).unwrap();
    let mut hardware = fields[7].body.to_vec();
    hardware.extend(tagged(719, integer(2, 20260901)));
    let mut values: Vec<Vec<u8>> = fields.iter().map(|f| f.encoded.to_vec()).collect();
    values[7] = tlv(&[48], &hardware);
    assert!(Fixture::new(seq(values), |_, _, _| {}).verify(NOW).is_err());
    let mut bad = valid_description();
    bad.push(0);
    assert!(Fixture::new(bad, |_, _, _| {}).verify(NOW).is_err());
}

fn official_root(index: usize, expected_signature_oid: &str) {
    // These are public Google certificates, not a generated hardware fixture.
    // Checking their signatures exercises the actual RSA and P-384 algorithms
    // used by supported anchors without pretending to possess an attested key.
    let roots: Vec<String> = serde_json::from_str(include_str!("google-roots-2026.json")).unwrap();
    assert_eq!(roots.len(), GOOGLE_ROOTS.len());
    let root_der = ::pem::parse(&roots[index]).unwrap();
    assert_eq!(root_der.tag(), "CERTIFICATE");
    der::canonical(root_der.contents()).unwrap();
    let (remaining, root) = X509Certificate::from_der(root_der.contents()).unwrap();
    assert!(remaining.is_empty());
    assert_eq!(crate::digest(root.public_key().raw), GOOGLE_ROOTS[index]);
    assert_eq!(
        root.signature_algorithm.algorithm.to_id_string(),
        expected_signature_oid
    );
    assert_eq!(root.issuer(), root.subject());
    assert!(root
        .validity()
        .is_valid_at(ASN1Time::from_timestamp(NOW as i64).unwrap()));
    assert!(root.basic_constraints().unwrap().unwrap().value.ca);
    assert!(root.key_usage().unwrap().unwrap().value.key_cert_sign());
    public_key(&root, false).unwrap();
    extensions(&root).unwrap();
    verify_edge(&root, &root).unwrap();

    let mut corrupted = root_der.contents().to_vec();
    *corrupted.last_mut().unwrap() ^= 1;
    let (_, bad_signature) = X509Certificate::from_der(&corrupted).unwrap();
    assert!(verify_edge(&bad_signature, &root).is_err());
}

#[test]
fn official_google_rsa_root_pin_and_self_signature_are_verified() {
    official_root(0, "1.2.840.113549.1.1.11");
}

#[test]
fn official_google_p384_root_pin_and_self_signature_are_verified() {
    official_root(1, "1.2.840.10045.4.3.3");
}

#[test]
fn provisioning_is_bound_to_the_adjacent_attestation_and_security_level() {
    use coset::cbor::{ser::into_writer, value::Value as Cbor};
    let provisioning_oid = &[1, 3, 6, 1, 4, 1, 11129, 2, 1, 30];
    let provisioning = |entity: &str, lost: bool| {
        let map = Cbor::Map(vec![
            (Cbor::Integer(1.into()), Cbor::Integer(2.into())),
            (Cbor::Integer(4.into()), Cbor::Text(entity.into())),
            (Cbor::Integer(6.into()), Cbor::Bool(lost)),
        ]);
        let mut bytes = Vec::new();
        into_writer(&map, &mut bytes).unwrap();
        bytes
    };
    let valid = Fixture::new(valid_description(), |_, issuer, _| {
        issuer
            .custom_extensions
            .push(CustomExtension::from_oid_content(
                provisioning_oid,
                provisioning("TEE", false),
            ));
    });
    assert_eq!(valid.verify(NOW).unwrap()["key_enrollment_attested"], false);
    for (entity, lost) in [("STRONG_BOX", false), ("TEE", true), ("unknown", false)] {
        assert!(Fixture::new(valid_description(), |_, issuer, _| {
            issuer
                .custom_extensions
                .push(CustomExtension::from_oid_content(
                    provisioning_oid,
                    provisioning(entity, lost),
                ));
        })
        .verify(NOW)
        .is_err());
    }
    assert!(Fixture::new(valid_description(), |root, _, _| {
        root.custom_extensions
            .push(CustomExtension::from_oid_content(
                provisioning_oid,
                provisioning("TEE", false),
            ));
    })
    .verify(NOW)
    .is_err());
    assert!(Fixture::new(valid_description(), |_, issuer, leaf| {
        for cert in [issuer, leaf] {
            cert.custom_extensions
                .push(CustomExtension::from_oid_content(
                    provisioning_oid,
                    provisioning("TEE", false),
                ));
        }
    })
    .verify(NOW)
    .is_err());
}

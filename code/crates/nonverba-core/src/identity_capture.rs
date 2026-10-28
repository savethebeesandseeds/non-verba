// SPDX-License-Identifier: AGPL-3.0-only
//! Detached, location-free identity-photo possession evidence. A valid signature
//! binds exact reviewed JPEG bytes and an independently retained request. It does
//! not attest a camera, browser, hardware key, clock, person or document.
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use image::{ImageFormat, ImageReader, Limits};
use p256::{
    ecdsa::{signature::Verifier, Signature, VerifyingKey},
    pkcs8::{DecodePublicKey, EncodePublicKey},
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Cursor;

pub const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_PROOF_BYTES: usize = 16 * 1024;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const DOMAIN: &[u8] = b"NONVERBA:IDENTITY_CAPTURE:v1\n";
type Result<T> = std::result::Result<T, &'static str>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u8,
    pub purpose: String,
    pub challenge_id: String,
    pub nonce: String,
    pub account_id: String,
    pub principal_id: String,
    pub current_session_id: String,
    pub recovery_generation: u64,
    pub kind: String,
    pub source: String,
    pub public_spki_sha256: String,
    pub issued_at_ms: u64,
    pub capture_expires_at_ms: u64,
    pub submit_expires_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Acquisition {
    pub version: u8,
    pub timestamp_source: String,
    pub request_elapsed_realtime_ns: String,
    pub image_received_elapsed_realtime_ns: String,
    pub result_received_elapsed_realtime_ns: String,
    pub sensor_timestamp_ns: String,
    pub image_timestamp_ns: String,
    pub zsl_requested_disabled: bool,
    pub test_pattern_requested_disabled: bool,
    #[serde(deserialize_with = "nullable")]
    pub zsl_result_enabled: Option<bool>,
    #[serde(deserialize_with = "nullable")]
    pub test_pattern_result_mode: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Payload {
    pub request: Request,
    pub image_sha256: String,
    pub image_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub captured_at_ms: u64,
    pub lens_facing: String,
    #[serde(deserialize_with = "nullable")]
    pub acquisition: Option<Acquisition>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Proof {
    pub payload: Payload,
    pub public_spki_der_b64: String,
    pub signature_b64: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct Assessment {
    pub signature_valid: bool,
    pub exact_image_bound: bool,
    pub original_request_bound: bool,
    pub source: String,
    pub hardware_attested: bool,
    pub native_origin_attested: bool,
    pub browser_origin_attested: bool,
    pub capture_time_trusted: bool,
    pub identity_verified: bool,
}

fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}
fn require(value: bool, code: &'static str) -> Result<()> {
    if value {
        Ok(())
    } else {
        Err(code)
    }
}
fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}
fn token(value: &str) -> bool {
    value.len() == 43
        && URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|v| v.len() == 32 && URL_SAFE_NO_PAD.encode(v) == value)
}

impl Request {
    pub fn validate(&self) -> Result<()> {
        require(
            self.version == 1
                && self.purpose == "identity-capture"
                && token(&self.challenge_id)
                && token(&self.nonce)
                && identifier(&self.account_id)
                && identifier(&self.principal_id)
                && identifier(&self.current_session_id)
                && self.recovery_generation <= MAX_SAFE_INTEGER
                && matches!(self.kind.as_str(), "document_front" | "face_front")
                && matches!(self.source.as_str(), "native-camera2" | "browser-camera")
                && hash(&self.public_spki_sha256)
                && self.issued_at_ms <= MAX_SAFE_INTEGER
                && self.capture_expires_at_ms <= MAX_SAFE_INTEGER
                && self.submit_expires_at_ms <= MAX_SAFE_INTEGER
                && self.capture_expires_at_ms > self.issued_at_ms
                && self.capture_expires_at_ms - self.issued_at_ms <= 120_000
                && self.submit_expires_at_ms >= self.capture_expires_at_ms
                && self.submit_expires_at_ms - self.issued_at_ms <= 900_000,
            "identity_capture_request_invalid",
        )
    }
}

fn decode(value: &str, maximum: usize) -> Result<Vec<u8>> {
    require(
        value.len() <= maximum.div_ceil(3) * 4,
        "identity_capture_encoding_invalid",
    )?;
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| "identity_capture_encoding_invalid")?;
    require(
        !bytes.is_empty() && bytes.len() <= maximum && STANDARD.encode(&bytes) == value,
        "identity_capture_encoding_invalid",
    )?;
    Ok(bytes)
}
fn public_key(value: &str) -> Result<(VerifyingKey, Vec<u8>)> {
    let bytes = decode(value, 128)?;
    let key =
        VerifyingKey::from_public_key_der(&bytes).map_err(|_| "identity_capture_key_invalid")?;
    let canonical = key
        .to_public_key_der()
        .map_err(|_| "identity_capture_key_invalid")?;
    require(
        canonical.as_bytes() == bytes,
        "identity_capture_key_invalid",
    )?;
    Ok((key, bytes))
}
pub fn public_spki_sha256(value: &str) -> Result<String> {
    let (_, bytes) = public_key(value)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn counter(value: &str) -> Result<u64> {
    require(
        !value.is_empty()
            && value.len() <= 19
            && value.bytes().all(|b| b.is_ascii_digit())
            && (value == "0" || !value.starts_with('0')),
        "identity_capture_acquisition_invalid",
    )?;
    let parsed = value
        .parse::<u64>()
        .map_err(|_| "identity_capture_acquisition_invalid")?;
    require(
        parsed <= i64::MAX as u64,
        "identity_capture_acquisition_invalid",
    )?;
    Ok(parsed)
}
impl Acquisition {
    fn validate(&self) -> Result<()> {
        require(
            self.version == 1
                && matches!(self.timestamp_source.as_str(), "realtime" | "unknown")
                && self.zsl_requested_disabled
                && self.test_pattern_requested_disabled
                && self.zsl_result_enabled != Some(true)
                && self.test_pattern_result_mode.is_none_or(|v| v == 0),
            "identity_capture_acquisition_invalid",
        )?;
        let request = counter(&self.request_elapsed_realtime_ns)?;
        let image = counter(&self.image_received_elapsed_realtime_ns)?;
        let result = counter(&self.result_received_elapsed_realtime_ns)?;
        let sensor = counter(&self.sensor_timestamp_ns)?;
        require(
            sensor == counter(&self.image_timestamp_ns)?
                && image >= request
                && result >= request
                && image - request <= 15_000_000_000
                && result - request <= 15_000_000_000
                && image.abs_diff(result) <= 15_000_000_000,
            "identity_capture_acquisition_invalid",
        )?;
        if self.timestamp_source == "realtime" {
            require(
                sensor >= request
                    && sensor <= image
                    && sensor <= result
                    && image - sensor <= 15_000_000_000
                    && result - sensor <= 15_000_000_000,
                "identity_capture_acquisition_invalid",
            )?;
        }
        Ok(())
    }
}

impl Payload {
    fn validate(&self) -> Result<()> {
        self.request.validate()?;
        require(
            hash(&self.image_sha256)
                && self.image_bytes > 0
                && self.image_bytes <= MAX_IMAGE_BYTES as u64
                && self.width > 0
                && self.height > 0
                && self.width <= 2400
                && self.height <= 2400
                && self.captured_at_ms <= MAX_SAFE_INTEGER
                && matches!(
                    self.lens_facing.as_str(),
                    "front" | "back" | "external" | "unknown"
                ),
            "identity_capture_payload_invalid",
        )?;
        match (self.request.source.as_str(), &self.acquisition) {
            ("native-camera2", Some(acquisition)) => {
                require(
                    self.lens_facing
                        == if self.request.kind == "document_front" {
                            "back"
                        } else {
                            "front"
                        },
                    "identity_capture_acquisition_invalid",
                )?;
                acquisition.validate()?;
            }
            ("browser-camera", None) => {}
            _ => return Err("identity_capture_acquisition_invalid"),
        }
        Ok(())
    }
}

pub fn parse_proof(bytes: &[u8]) -> Result<Proof> {
    require(
        bytes.len() <= MAX_PROOF_BYTES,
        "identity_capture_proof_invalid",
    )?;
    let proof: Proof =
        serde_json::from_slice(bytes).map_err(|_| "identity_capture_proof_invalid")?;
    proof.payload.validate()?;
    decode(&proof.public_spki_der_b64, 128)?;
    decode(&proof.signature_b64, 64)?;
    Ok(proof)
}

/// Canonical closed payload: compact JSON, recursively ASCII-lexical object keys,
/// integer numbers only. Nanosecond counters remain lossless decimal strings.
pub fn signing_bytes(payload: &Payload) -> Result<Vec<u8>> {
    payload.validate()?;
    let value = serde_json::to_value(payload).map_err(|_| "identity_capture_payload_invalid")?;
    fn write(value: &Value, out: &mut Vec<u8>) -> Result<()> {
        match value {
            Value::Object(map) => {
                out.push(b'{');
                let mut keys: Vec<_> = map.keys().collect();
                keys.sort_unstable();
                for (index, key) in keys.iter().enumerate() {
                    require(key.is_ascii(), "identity_capture_payload_invalid")?;
                    if index != 0 {
                        out.push(b',');
                    }
                    out.extend(
                        serde_json::to_vec(key).map_err(|_| "identity_capture_payload_invalid")?,
                    );
                    out.push(b':');
                    write(&map[*key], out)?;
                }
                out.push(b'}');
            }
            Value::Number(number) => {
                require(
                    number.as_u64().is_some_and(|v| v <= MAX_SAFE_INTEGER),
                    "identity_capture_payload_invalid",
                )?;
                out.extend(number.to_string().as_bytes());
            }
            Value::Array(_) => return Err("identity_capture_payload_invalid"),
            other => out
                .extend(serde_json::to_vec(other).map_err(|_| "identity_capture_payload_invalid")?),
        }
        Ok(())
    }
    let mut bytes = DOMAIN.to_vec();
    write(&value, &mut bytes)?;
    require(
        bytes.len() <= MAX_PROOF_BYTES,
        "identity_capture_payload_invalid",
    )?;
    Ok(bytes)
}

/// Verify against independently retained authority and the exact final JPEG.
pub fn verify(proof: &Proof, original: &Request, jpeg: &[u8], now_ms: u64) -> Result<Assessment> {
    original.validate()?;
    let payload = &proof.payload;
    payload.validate()?;
    require(
        payload.request == *original,
        "identity_capture_original_required",
    )?;
    require(
        now_ms <= MAX_SAFE_INTEGER
            && now_ms >= original.issued_at_ms
            && now_ms < original.submit_expires_at_ms
            && payload.captured_at_ms >= original.issued_at_ms
            && payload.captured_at_ms < original.capture_expires_at_ms
            && payload.captured_at_ms <= now_ms,
        "identity_capture_expired",
    )?;
    let (width, height) = jpeg_dimensions(jpeg, &original.kind)?;
    require(
        payload.width == width
            && payload.height == height
            && payload.image_bytes == jpeg.len() as u64
            && hash(&payload.image_sha256)
            && payload.image_sha256 == hex::encode(Sha256::digest(jpeg)),
        "identity_capture_image_mismatch",
    )?;
    let (key, spki) = public_key(&proof.public_spki_der_b64)?;
    require(
        original.public_spki_sha256 == hex::encode(Sha256::digest(spki)),
        "identity_capture_key_mismatch",
    )?;
    let signature = Signature::from_slice(&decode(&proof.signature_b64, 64)?)
        .map_err(|_| "identity_capture_signature_invalid")?;
    key.verify(&signing_bytes(payload)?, &signature)
        .map_err(|_| "identity_capture_signature_invalid")?;
    Ok(Assessment {
        signature_valid: true,
        exact_image_bound: true,
        original_request_bound: true,
        source: original.source.clone(),
        hardware_attested: false,
        native_origin_attested: false,
        browser_origin_attested: false,
        capture_time_trusted: false,
        identity_verified: false,
    })
}

/// A minimal JPEG profile intentionally excludes EXIF, GPS, C2PA and comments.
pub fn jpeg_dimensions(bytes: &[u8], kind: &str) -> Result<(u32, u32)> {
    let edge = match kind {
        "document_front" => 2400,
        "face_front" => 1280,
        _ => return Err("identity_capture_image_invalid"),
    };
    require(
        !bytes.is_empty()
            && bytes.len() <= MAX_IMAGE_BYTES
            && bytes.starts_with(&[0xff, 0xd8])
            && bytes.ends_with(&[0xff, 0xd9]),
        "identity_capture_image_invalid",
    )?;
    let mut position = 2;
    let mut scan = false;
    let mut saw_scan = false;
    let mut jfif = false;
    let mut adobe = false;
    loop {
        if scan && bytes.get(position).is_some_and(|b| *b != 0xff) {
            position += 1;
            continue;
        }
        require(
            bytes.get(position) == Some(&0xff),
            "identity_capture_image_invalid",
        )?;
        while bytes.get(position) == Some(&0xff) {
            position += 1;
        }
        let marker = *bytes
            .get(position)
            .ok_or("identity_capture_image_invalid")?;
        position += 1;
        if scan && (marker == 0 || (0xd0..=0xd7).contains(&marker)) {
            continue;
        }
        if marker == 0xd9 {
            require(
                saw_scan && position == bytes.len(),
                "identity_capture_image_invalid",
            )?;
            break;
        }
        require(
            !matches!(marker, 0 | 0x01 | 0xd0..=0xd8),
            "identity_capture_image_invalid",
        )?;
        let length = bytes
            .get(position..position + 2)
            .ok_or("identity_capture_image_invalid")?;
        let length = u16::from_be_bytes([length[0], length[1]]) as usize;
        require(length >= 2, "identity_capture_image_invalid")?;
        let segment = bytes
            .get(position + 2..position + length)
            .ok_or("identity_capture_image_invalid")?;
        match marker {
            0xe0 => {
                require(
                    !jfif
                        && !saw_scan
                        && segment.len() == 14
                        && segment.starts_with(b"JFIF\0")
                        && segment[5] == 1
                        && segment[6] <= 2
                        && segment[7] <= 2
                        && (segment[8] != 0 || segment[9] != 0)
                        && (segment[10] != 0 || segment[11] != 0)
                        && segment[12] == 0
                        && segment[13] == 0,
                    "identity_capture_metadata_not_allowed",
                )?;
                jfif = true;
            }
            0xee => {
                require(
                    !adobe
                        && !saw_scan
                        && segment.len() == 12
                        && segment.starts_with(b"Adobe")
                        && segment[5..7] == 100u16.to_be_bytes()
                        && segment[7..11] == [0, 0, 0, 0]
                        && segment[11] <= 2,
                    "identity_capture_metadata_not_allowed",
                )?;
                adobe = true;
            }
            0xe1..=0xed | 0xef | 0xfe => return Err("identity_capture_metadata_not_allowed"),
            _ => {}
        }
        position += length;
        scan = marker == 0xda;
        saw_scan |= scan;
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Jpeg);
    let mut limits = Limits::default();
    limits.max_image_width = Some(edge);
    limits.max_image_height = Some(edge);
    limits.max_alloc = Some(32 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| "identity_capture_image_invalid")?;
    require(
        decoded.width() > 0
            && decoded.height() > 0
            && decoded.width() <= edge
            && decoded.height() <= edge,
        "identity_capture_image_invalid",
    )?;
    Ok((decoded.width(), decoded.height()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{signature::Signer, SigningKey};

    #[test]
    #[ignore = "explicit synthetic golden-fixture generation only; prints no production key material"]
    fn generate_golden_fixture() {
        let mut cases = Vec::new();
        let mut jpeg = Vec::new();
        for source in ["browser-camera", "native-camera2"] {
            let (proof, _, bytes) = fixture(source);
            jpeg = bytes;
            let signing = signing_bytes(&proof.payload).unwrap();
            cases.push(serde_json::json!({"source":source,"original":proof.payload.request,"proof":proof,
                "verifier_time_ms":2_000_000_002_000u64,"signing_bytes_base64":STANDARD.encode(&signing),"signing_sha256":hex::encode(Sha256::digest(&signing))}));
        }
        let value = serde_json::json!({"fixture":"nonverba-identity-capture-v1","synthetic_only":true,
            "description":"Invented 8x8 blank image and fixed synthetic P256 test key. Never use this key for participants or devices.","jpeg_base64":STANDARD.encode(jpeg),"cases":cases});
        println!(
            "IDENTITY_CAPTURE_GOLDEN:{}",
            STANDARD.encode(serde_json::to_vec_pretty(&value).unwrap())
        );
    }

    #[test]
    fn cross_language_golden_proofs_and_transcripts_match() {
        let value: Value = serde_json::from_slice(include_bytes!(
            "../../../test/fixtures/identity-capture-v1.json"
        ))
        .unwrap();
        assert_eq!(value["synthetic_only"], true);
        let jpeg = STANDARD
            .decode(value["jpeg_base64"].as_str().unwrap())
            .unwrap();
        for case in value["cases"].as_array().unwrap() {
            let original: Request = serde_json::from_value(case["original"].clone()).unwrap();
            let proof = parse_proof(&serde_json::to_vec(&case["proof"]).unwrap()).unwrap();
            let signing = signing_bytes(&proof.payload).unwrap();
            assert_eq!(STANDARD.encode(&signing), case["signing_bytes_base64"]);
            assert_eq!(
                hex::encode(Sha256::digest(&signing)),
                case["signing_sha256"]
            );
            assert!(verify(
                &proof,
                &original,
                &jpeg,
                case["verifier_time_ms"].as_u64().unwrap()
            )
            .is_ok());
        }
    }

    #[test]
    fn actual_jca_generated_proof_verifies_independently() {
        let value: Value = serde_json::from_slice(include_bytes!(
            "../../../test/fixtures/identity-capture-jca-v1.json"
        ))
        .unwrap();
        assert_eq!(value["type"], "synthetic-jca-identity-capture");
        assert_eq!(value["hardware_attested"], false);
        let jpeg = STANDARD
            .decode(value["image_base64"].as_str().unwrap())
            .unwrap();
        let proof = parse_proof(&serde_json::to_vec(&value["proof"]).unwrap()).unwrap();
        assert_eq!(proof.payload.request.source, "native-camera2");
        assert_eq!((proof.payload.width, proof.payload.height), (320, 240));
        let result = verify(
            &proof,
            &proof.payload.request,
            &jpeg,
            value["now_ms"].as_u64().unwrap(),
        )
        .unwrap();
        assert!(result.signature_valid && result.exact_image_bound);
        assert!(
            !result.hardware_attested
                && !result.native_origin_attested
                && !result.capture_time_trusted
        );
        let mut changed = proof.clone();
        changed.payload.captured_at_ms += 1;
        assert_eq!(
            verify(
                &changed,
                &proof.payload.request,
                &jpeg,
                value["now_ms"].as_u64().unwrap()
            )
            .unwrap_err(),
            "identity_capture_signature_invalid"
        );
    }
    fn fixture(source: &str) -> (Proof, SigningKey, Vec<u8>) {
        let key = SigningKey::from_slice(&[47; 32]).unwrap();
        let spki = STANDARD.encode(key.verifying_key().to_public_key_der().unwrap().as_bytes());
        let request = Request {
            version: 1,
            purpose: "identity-capture".into(),
            challenge_id: URL_SAFE_NO_PAD.encode([31; 32]),
            nonce: URL_SAFE_NO_PAD.encode([32; 32]),
            account_id: "account:fixture".into(),
            principal_id: "principal:fixture".into(),
            current_session_id: "session:fixture".into(),
            recovery_generation: 0,
            kind: "document_front".into(),
            source: source.into(),
            public_spki_sha256: public_spki_sha256(&spki).unwrap(),
            issued_at_ms: 2_000_000_000_000,
            capture_expires_at_ms: 2_000_000_120_000,
            submit_expires_at_ms: 2_000_000_900_000,
        };
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode_image(&image::RgbImage::new(8, 8))
            .unwrap();
        let acquisition = (source == "native-camera2").then(|| Acquisition {
            version: 1,
            timestamp_source: "realtime".into(),
            request_elapsed_realtime_ns: "9007199254741000".into(),
            image_received_elapsed_realtime_ns: "9007199254741020".into(),
            result_received_elapsed_realtime_ns: "9007199254741021".into(),
            sensor_timestamp_ns: "9007199254741010".into(),
            image_timestamp_ns: "9007199254741010".into(),
            zsl_requested_disabled: true,
            test_pattern_requested_disabled: true,
            zsl_result_enabled: None,
            test_pattern_result_mode: Some(0),
        });
        let payload = Payload {
            request,
            image_sha256: hex::encode(Sha256::digest(&jpeg)),
            image_bytes: jpeg.len() as u64,
            width: 8,
            height: 8,
            captured_at_ms: 2_000_000_001_000,
            lens_facing: "back".into(),
            acquisition,
        };
        let mut proof = Proof {
            payload,
            public_spki_der_b64: spki,
            signature_b64: String::new(),
        };
        sign(&mut proof, &key);
        (proof, key, jpeg)
    }
    fn sign(proof: &mut Proof, key: &SigningKey) {
        let signature: Signature = key.sign(&signing_bytes(&proof.payload).unwrap());
        proof.signature_b64 = STANDARD.encode(signature.to_bytes());
    }
    #[test]
    fn exact_browser_and_native_photos_have_bounded_untrusted_assurance() {
        for source in ["browser-camera", "native-camera2"] {
            let (proof, _, jpeg) = fixture(source);
            let result = verify(&proof, &proof.payload.request, &jpeg, 2_000_000_002_000).unwrap();
            assert!(result.exact_image_bound && result.signature_valid);
            assert!(
                !result.hardware_attested
                    && !result.native_origin_attested
                    && !result.capture_time_trusted
                    && !result.identity_verified
            );
        }
    }
    #[test]
    fn changed_original_key_image_and_signed_claims_fail() {
        let (proof, key, jpeg) = fixture("browser-camera");
        let original = proof.payload.request.clone();
        let mut changed = original.clone();
        changed.current_session_id = "session:other".into();
        assert_eq!(
            verify(&proof, &changed, &jpeg, 2_000_000_002_000).unwrap_err(),
            "identity_capture_original_required"
        );
        let mut changed = proof.clone();
        changed.payload.width = 7;
        sign(&mut changed, &key);
        assert_eq!(
            verify(&changed, &original, &jpeg, 2_000_000_002_000).unwrap_err(),
            "identity_capture_image_mismatch"
        );
        let mut changed = proof.clone();
        changed.payload.lens_facing = "front".into();
        assert_eq!(
            verify(&changed, &original, &jpeg, 2_000_000_002_000).unwrap_err(),
            "identity_capture_signature_invalid"
        );
        let (_, other, _) = fixture("browser-camera");
        let alternate = SigningKey::from_slice(&[48; 32]).unwrap();
        let mut changed = proof.clone();
        changed.public_spki_der_b64 = STANDARD.encode(
            alternate
                .verifying_key()
                .to_public_key_der()
                .unwrap()
                .as_bytes(),
        );
        assert!(verify(&changed, &original, &jpeg, 2_000_000_002_000).is_err());
        drop(other);
        let mut changed = jpeg.clone();
        changed.push(0);
        assert!(verify(&proof, &original, &changed, 2_000_000_002_000).is_err());
    }
    #[test]
    fn capture_and_submission_windows_are_distinct_and_exclusive() {
        let (mut proof, key, jpeg) = fixture("browser-camera");
        let original = proof.payload.request.clone();
        assert!(verify(&proof, &original, &jpeg, 2_000_000_800_000).is_ok());
        assert!(verify(&proof, &original, &jpeg, original.submit_expires_at_ms).is_err());
        proof.payload.captured_at_ms = original.capture_expires_at_ms;
        sign(&mut proof, &key);
        assert!(verify(&proof, &original, &jpeg, 2_000_000_800_000).is_err());
    }
    #[test]
    fn native_matching_clocks_and_observed_modes_cannot_be_forged_by_resigning() {
        let (proof, _, jpeg) = fixture("native-camera2");
        for change in 0..6 {
            let mut bad = proof.clone();
            let a = bad.payload.acquisition.as_mut().unwrap();
            match change {
                0 => a.image_timestamp_ns = "9007199254741011".into(),
                1 => a.request_elapsed_realtime_ns = "09007199254741000".into(),
                2 => a.zsl_result_enabled = Some(true),
                3 => a.test_pattern_result_mode = Some(1),
                4 => a.sensor_timestamp_ns = "9223372036854775808".into(),
                _ => bad.payload.lens_facing = "front".into(),
            };
            assert!(verify(&bad, &proof.payload.request, &jpeg, 2_000_000_002_000).is_err());
        }
    }
    #[test]
    fn closed_json_nullable_fields_and_canonical_encoding_are_enforced() {
        let (proof, _, _) = fixture("browser-camera");
        let mut value = serde_json::to_value(&proof).unwrap();
        value["payload"]
            .as_object_mut()
            .unwrap()
            .remove("acquisition");
        assert!(serde_json::from_value::<Proof>(value).is_err());
        let bytes = signing_bytes(&proof.payload).unwrap();
        assert!(bytes.starts_with(
            b"NONVERBA:IDENTITY_CAPTURE:v1\n{\"acquisition\":null,\"captured_at_ms\":"
        ));
        assert!(public_spki_sha256(&(proof.public_spki_der_b64 + "\n")).is_err());
        let mut bad = proof.payload.request;
        bad.recovery_generation = MAX_SAFE_INTEGER + 1;
        assert!(bad.validate().is_err());
    }
    #[test]
    fn metadata_and_oversized_direct_image_inputs_are_refused() {
        let (_, _, jpeg) = fixture("browser-camera");
        for marker in [0xe1, 0xeb, 0xed, 0xfe] {
            let mut bytes = jpeg.clone();
            bytes.splice(2..2, [0xff, marker, 0, 4, 1, 2]);
            assert_eq!(
                jpeg_dimensions(&bytes, "document_front").unwrap_err(),
                "identity_capture_metadata_not_allowed"
            );
        }
        assert!(jpeg_dimensions(&vec![0; MAX_IMAGE_BYTES + 1], "document_front").is_err());
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
//! Native-only C2PA signing adapter for session-owned external keys.
//!
//! This module is not compiled into WASM and is not a sensor collector. Android
//! controllers must retain acquired bytes, enforce lifecycle/replay policy, and
//! hold the callback as a per-finalization capability. Do not expose it as a
//! generic JavaScript signer. An external callback does not establish hardware
//! protection, remote attestation, sensor origin, or a trusted capture clock.

use std::{cell::RefCell, io::Cursor};

use c2pa::{
    crypto::cose::{check_end_entity_certificate_profile, CertificateTrustPolicy},
    status_tracker::StatusTracker,
    Signer, SigningAlg,
};
use p256::{
    ecdsa::{signature::Verifier, Signature, VerifyingKey},
    pkcs8::{DecodePublicKey, EncodePublicKey},
};
use rcgen::{
    BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer,
    KeyIdMethod, KeyUsagePurpose, PublicKeyData, PKCS_ECDSA_P256_SHA256,
};
use sha2::{Digest, Sha256};
use x509_parser::prelude::{FromDer, X509Certificate};

use crate::{err, CertificateKey, ImageSigningIdentity};

#[path = "native_camera_signing.rs"]
mod camera;

const MAX_CERTIFICATES: usize = 8;
const MAX_CHAIN_BYTES: usize = 64 * 1024;
const MAX_SIGNING_INPUT: usize = 256 * 1024;

/// A synchronous callback may borrow a JNI environment and session capability.
/// Return SHA256withECDSA's DER signature or the canonical 64-byte ES256 form.
pub type SigningCallback<'a> = dyn FnMut(&[u8]) -> Result<Vec<u8>, String> + 'a;

/// An independently pinned public certificate and a borrowed external signer.
/// The callback's private key never needs to enter the Rust core or web runtime.
pub struct ExternalSigner<'a> {
    certificates: Vec<Vec<u8>>,
    public_key: VerifyingKey,
    fingerprint: String,
    reserve_size: usize,
    callback: RefCell<&'a mut SigningCallback<'a>>,
}

impl<'a> ExternalSigner<'a> {
    /// Validate the C2PA leaf profile and require its SPKI to match the enrolled
    /// public key before any signing callback is invoked. This checks credential
    /// shape, not public CA trust, Android attestation, or enrollment authority.
    pub fn new(
        certificate_pem: &str,
        public_spki: &[u8],
        callback: &'a mut SigningCallback<'a>,
    ) -> Result<Self, String> {
        if certificate_pem.is_empty() || certificate_pem.len() > MAX_CHAIN_BYTES {
            return Err("External signer certificate chain is too large or empty".into());
        }
        let public_key = parse_public_key(public_spki)?;
        let canonical_spki = public_key.to_public_key_der().map_err(err)?;
        let certificates = pem::parse_many(certificate_pem).map_err(err)?;
        if certificates.is_empty() || certificates.len() > MAX_CERTIFICATES {
            return Err("External signer requires one to eight certificates".into());
        }
        let certificates = certificates
            .into_iter()
            .map(|certificate| {
                if certificate.tag() != "CERTIFICATE" {
                    return Err("External signer chain contains a non-certificate PEM".into());
                }
                let (remaining, _) =
                    X509Certificate::from_der(certificate.contents()).map_err(err)?;
                if !remaining.is_empty() {
                    return Err("External signer certificate has trailing DER data".into());
                }
                Ok(certificate.into_contents())
            })
            .collect::<Result<Vec<_>, String>>()?;
        let (_, leaf) = X509Certificate::from_der(&certificates[0]).map_err(err)?;
        if leaf.public_key().raw != canonical_spki.as_bytes() {
            return Err("External signer certificate differs from the enrolled public key".into());
        }
        check_end_entity_certificate_profile(
            &certificates[0],
            &CertificateTrustPolicy::default(),
            &mut StatusTracker::default(),
            None,
        )
        .map_err(|error| format!("External signer certificate is not C2PA-compatible: {error}"))?;
        let fingerprint = crate::digest(&certificates[0]);
        Ok(Self {
            reserve_size: 10_000 + certificate_pem.len(),
            certificates,
            public_key,
            fingerprint,
            callback: RefCell::new(callback),
        })
    }

    /// SHA-256 of the exact leaf DER, matching the existing image/audio pin format.
    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    /// Seal a session-owned JPEG using the same validation, watermark, EXIF and
    /// C2PA preparation as the browser. No native acquisition claim is added.
    pub fn seal_image(
        &self,
        image_bytes: &[u8],
        challenge_json: &str,
        now_secs: f64,
        location_json: &str,
    ) -> Result<Vec<u8>, String> {
        let (mut builder, mut source) = crate::prepare_image(
            image_bytes,
            challenge_json,
            now_secs,
            location_json,
            None,
            ImageSigningIdentity {
                fingerprint: self.fingerprint(),
                protection: "external-key-unattested",
            },
        )?;
        let mut destination = Cursor::new(Vec::new());
        builder
            .sign(self, "image/jpeg", &mut source, &mut destination)
            .map_err(err)?;
        Ok(destination.into_inner())
    }

    /// Seal retained PCM after checking the original request, exact received
    /// segment hashes, transcript timing and every challenge's acoustic response.
    /// These content checks do not prove the PCM came from a native microphone.
    pub fn seal_audio(
        &self,
        pcm: &[f32],
        request_json: &str,
        transcript_json: &str,
        now_secs: f64,
    ) -> Result<Vec<u8>, String> {
        let (mut builder, mut source) = crate::audio::prepare_audio(
            pcm,
            request_json,
            transcript_json,
            now_secs,
            self.fingerprint(),
        )?;
        let mut destination = Cursor::new(Vec::new());
        builder
            .sign(self, "audio/wav", &mut source, &mut destination)
            .map_err(err)?;
        Ok(destination.into_inner())
    }
}

impl Signer for ExternalSigner<'_> {
    fn sign(&self, message: &[u8]) -> c2pa::Result<Vec<u8>> {
        if message.is_empty() || message.len() > MAX_SIGNING_INPUT {
            return Err(c2pa::Error::BadParam(
                "External signing input is out of bounds".into(),
            ));
        }
        let mut callback = self.callback.try_borrow_mut().map_err(|_| {
            c2pa::Error::BadParam("External signer callback is already active".into())
        })?;
        let encoded = callback(message).map_err(c2pa::Error::BadParam)?;
        // Use length, not the first byte: a raw r value can legitimately start 0x30.
        let signature = if encoded.len() == 64 {
            Signature::from_slice(&encoded)
        } else {
            Signature::from_der(&encoded)
        }
        .map_err(|_| c2pa::Error::BadParam("External signer returned malformed ES256".into()))?;
        let signature = signature.normalize_s().unwrap_or(signature);
        self.public_key.verify(message, &signature).map_err(|_| {
            c2pa::Error::BadParam(
                "External signer signature does not match the enrolled key".into(),
            )
        })?;
        Ok(signature.to_bytes().to_vec())
    }

    fn alg(&self) -> SigningAlg {
        SigningAlg::Es256
    }

    fn certs(&self) -> c2pa::Result<Vec<Vec<u8>>> {
        Ok(self.certificates.clone())
    }

    fn reserve_size(&self) -> usize {
        self.reserve_size
    }
}

fn parse_public_key(spki: &[u8]) -> Result<VerifyingKey, String> {
    if spki.is_empty() || spki.len() > 4096 {
        return Err("External signer public key is out of bounds".into());
    }
    VerifyingKey::from_public_key_der(spki).map_err(err)
}

struct ExternalPublicKey(Vec<u8>);

impl PublicKeyData for ExternalPublicKey {
    fn der_bytes(&self) -> &[u8] {
        &self.0
    }

    fn algorithm(&self) -> &'static rcgen::SignatureAlgorithm {
        &PKCS_ECDSA_P256_SHA256
    }
}

/// Create a local, untrusted C2PA-compatible certificate around an external P-256
/// public key. No callback or external private key is needed for issuance. Persist
/// the returned public chain exactly once: reissuing it changes the certificate
/// fingerprint and must never silently replace an enrolled identity. The temporary
/// local issuer is not a remotely trusted authority or an Android attestation root.
pub fn create_certificate_chain(public_spki: &[u8]) -> Result<String, String> {
    let public_key = parse_public_key(public_spki)?;
    let external = ExternalPublicKey(public_key.to_encoded_point(false).as_bytes().to_vec());
    let issuer_key = CertificateKey::generate()?;
    let mut issuer_params = CertificateParams::default();
    issuer_params.distinguished_name.push(
        DnType::CommonName,
        "Non-verba local external-key development issuer",
    );
    issuer_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    issuer_params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    issuer_key.configure_certificate(&mut issuer_params);
    let issuer_certificate = issuer_params.self_signed(&issuer_key).map_err(err)?;
    let issuer = Issuer::new(issuer_params, issuer_key);
    let mut params = CertificateParams::default();
    params
        .distinguished_name
        .push(DnType::CommonName, "Non-verba external signing identity");
    params.is_ca = IsCa::ExplicitNoCa;
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = vec![
        ExtendedKeyUsagePurpose::EmailProtection,
        ExtendedKeyUsagePurpose::Other(vec![1, 3, 6, 1, 4, 1, 62558, 2, 1]),
    ];
    params.use_authority_key_identifier_extension = true;
    let mut serial = Sha256::digest(&external.0)[..20].to_vec();
    serial[0] &= 0x7f;
    params.serial_number = Some(serial.into());
    params.key_identifier_method = KeyIdMethod::PreSpecified(
        Sha256::digest(external.subject_public_key_info())[..20].to_vec(),
    );
    let certificate = params.signed_by(&external, &issuer).map_err(err)?;
    Ok(format!("{}{}", certificate.pem(), issuer_certificate.pem()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::{AudioReceipt, AudioRequest, AudioTranscript, CHUNK_SAMPLES, SAMPLE_RATE};
    use futures::executor::block_on;
    use p256::ecdsa::{signature::Signer as _, SigningKey};
    use serde_json::{json, Value};

    const NOW: f64 = 1_790_424_000.0;

    fn key() -> SigningKey {
        CertificateKey::generate().unwrap().key
    }

    fn spki(key: &SigningKey) -> Vec<u8> {
        key.verifying_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec()
    }

    #[test]
    fn external_leaf_matches_spki_and_rejects_wrong_key_before_callback() {
        let key = key();
        let spki = spki(&key);
        let certs = create_certificate_chain(&spki).unwrap();
        let mut callback = |_message: &[u8]| panic!("Enrollment must not invoke the signing key");
        let signer = ExternalSigner::new(&certs, &spki, &mut callback).unwrap();
        assert_eq!(
            signer.fingerprint(),
            crate::certificate_fingerprint(&certs).unwrap()
        );
        drop(signer);
        assert!(ExternalSigner::new(&certs, &self::spki(&self::key()), &mut callback).is_err());
        assert!(ExternalSigner::new("", &spki, &mut callback).is_err());
        assert!(ExternalSigner::new(&certs, &[0; 91], &mut callback).is_err());
        assert!(create_certificate_chain(&[0; 91]).is_err());
        let leaf = pem::parse_many(&certs).unwrap().remove(0);
        let mut trailing = leaf.contents().to_vec();
        trailing.push(0);
        let malformed = pem::encode(&pem::Pem::new("CERTIFICATE", trailing));
        assert!(ExternalSigner::new(&malformed, &spki, &mut callback).is_err());
    }

    #[test]
    fn external_callback_converts_der_and_rejects_wrong_or_malformed_signatures() {
        let key = key();
        let spki = spki(&key);
        let certs = create_certificate_chain(&spki).unwrap();
        let mut calls = 0;
        let mut callback = |message: &[u8]| {
            calls += 1;
            let signature: Signature = key.sign(message);
            Ok(signature.to_der().as_bytes().to_vec())
        };
        let signer = ExternalSigner::new(&certs, &spki, &mut callback).unwrap();
        let signature = Signer::sign(&signer, b"session-owned signing input").unwrap();
        assert_eq!(signature.len(), 64);
        assert!(Signer::sign(&signer, &[]).is_err());
        assert!(Signer::sign(&signer, &vec![0; MAX_SIGNING_INPUT + 1]).is_err());
        drop(signer);
        assert_eq!(calls, 1);
        let wrong = self::key();
        let mut wrong_callback = |message: &[u8]| {
            let signature: Signature = wrong.sign(message);
            Ok(signature.to_bytes().to_vec())
        };
        let signer = ExternalSigner::new(&certs, &spki, &mut wrong_callback).unwrap();
        assert!(Signer::sign(&signer, b"session-owned signing input").is_err());
        let mut malformed = |_message: &[u8]| Ok(vec![0; 64]);
        let signer = ExternalSigner::new(&certs, &spki, &mut malformed).unwrap();
        assert!(Signer::sign(&signer, b"session-owned signing input").is_err());
        let mut cancelled = |_message: &[u8]| Err("Session was cancelled".into());
        let signer = ExternalSigner::new(&certs, &spki, &mut cancelled).unwrap();
        assert!(Signer::sign(&signer, b"session-owned signing input").is_err());
    }

    #[test]
    fn external_signer_seals_jpeg_with_existing_verifier_and_no_attestation_upgrade() {
        let key = key();
        let spki = spki(&key);
        let certs = create_certificate_chain(&spki).unwrap();
        let mut callback = |message: &[u8]| {
            let signature: Signature = key.sign(message);
            Ok(signature.to_der().as_bytes().to_vec())
        };
        let signer = ExternalSigner::new(&certs, &spki, &mut callback).unwrap();
        let image = image::RgbImage::from_fn(640, 480, |x, y| {
            image::Rgb([(48 + x / 4 % 160) as u8, (48 + y / 3 % 160) as u8, 100])
        });
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
            .encode_image(&image)
            .unwrap();
        let challenge =
            crate::create_challenge("requester", "External signer fixture", NOW, 60).unwrap();
        let location = json!({"latitude":47.4979,"longitude":19.0402,"accuracy_m":12.25,
            "altitude_m":null,"altitude_accuracy_m":null,"timestamp_ms":NOW * 1000.0,
            "source":"device-geolocation"})
        .to_string();
        let signed = signer
            .seal_image(&jpeg, &challenge, NOW, &location)
            .unwrap();
        let report: Value = serde_json::from_str(
            &block_on(crate::verify_image(
                &signed,
                &challenge,
                signer.fingerprint(),
                NOW + 1.0,
            ))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(report["verified"], true, "{report}");
        assert_eq!(
            report["capture"]["key_protection"],
            "external-key-unattested"
        );
        assert_eq!(report["hardware_attested"], false);
        assert_eq!(report["camera_freshness_proven"], false);
        assert_eq!(report["certificate_trusted"], false);
        let wrong_pin: Value = serde_json::from_str(
            &block_on(crate::verify_image(
                &signed,
                &challenge,
                &"0".repeat(64),
                NOW + 1.0,
            ))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(wrong_pin["verified"], false);
    }

    #[test]
    fn external_signer_seals_wav_and_rejects_substituted_pcm() {
        let key = key();
        let spki = spki(&key);
        let certs = create_certificate_chain(&spki).unwrap();
        let mut callback = |message: &[u8]| {
            let signature: Signature = key.sign(message);
            Ok(signature.to_bytes().to_vec())
        };
        let signer = ExternalSigner::new(&certs, &spki, &mut callback).unwrap();
        let request_json =
            crate::create_audio_request("requester", "External audio fixture", NOW, 60, 4).unwrap();
        let request: AudioRequest = serde_json::from_str(&request_json).unwrap();
        let mut pcm = vec![0.0; 4 * SAMPLE_RATE as usize];
        let mut rounds = Vec::new();
        for index in 0..2 {
            let round: crate::audio::AudioRound = serde_json::from_str(
                &crate::create_audio_round(&request_json, index, NOW + f64::from(index * 2))
                    .unwrap(),
            )
            .unwrap();
            let probe = crate::audio_probe(&request.session_id, index, &round.nonce).unwrap();
            let start = (index * CHUNK_SAMPLES) as usize;
            pcm[start + 4800..start + 4800 + probe.len()].copy_from_slice(&probe);
            rounds.push(AudioReceipt {
                index,
                nonce: round.nonce,
                issued_elapsed_ms: index * 2010,
                received_elapsed_ms: index * 2010 + 2000,
                pcm_sha256: crate::hash_audio_pcm(&pcm[start..start + CHUNK_SAMPLES as usize])
                    .unwrap(),
                start_sample: index * CHUNK_SAMPLES,
                sample_count: CHUNK_SAMPLES,
            });
        }
        let transcript = serde_json::to_string(&AudioTranscript {
            version: 1,
            session_id: request.session_id,
            started_at: NOW as u64,
            completed_at: NOW as u64 + 4,
            total_samples: pcm.len() as u32,
            rounds,
        })
        .unwrap();
        let signed = signer
            .seal_audio(&pcm, &request_json, &transcript, NOW + 5.0)
            .unwrap();
        let report: Value = serde_json::from_str(
            &block_on(crate::verify_audio(
                &signed,
                &request_json,
                &transcript,
                signer.fingerprint(),
                NOW + 6.0,
            ))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(report["verified"], true, "{report}");
        assert_eq!(report["hardware_attested"], false);
        assert_eq!(report["sensor_origin_proven"], false);
        pcm[0] = 0.5;
        assert!(signer
            .seal_audio(&pcm, &request_json, &transcript, NOW + 5.0)
            .is_err());
    }
}

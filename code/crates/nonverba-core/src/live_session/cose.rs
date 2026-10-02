// SPDX-License-Identifier: AGPL-3.0-only
//! Standard COSE_Sign1 transport for two domain-separated requester messages.
//! Location proof's public SPKI validator is reused; no location source/signing
//! privilege is exposed to the requester. Keys must be separately provisioned.
use super::{model::RequesterKey, MAX_COSE_BYTES, MAX_PAYLOAD_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine};
use coset::{iana, CoseSign1, CoseSign1Builder, Header, HeaderBuilder, TaggedCborSerializable};
use p256::{
    ecdsa::{
        signature::{Signer, Verifier},
        Signature, SigningKey, VerifyingKey,
    },
    pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePublicKey},
};
use serde::{de::DeserializeOwned, Serialize};
use zeroize::Zeroizing;

pub(super) const REQUEST_TYPE: &str = "application/vnd.nonverba.live-location-request+json";
pub(super) const RECEIPT_TYPE: &str = "application/vnd.nonverba.live-location-receipt+json";

pub(crate) struct RequesterIdentity {
    key: SigningKey,
    pub spki: Vec<u8>,
    pub pin: String,
}
impl RequesterIdentity {
    pub fn load(text: &str) -> Result<Self, String> {
        let identity: crate::Identity = crate::parse(text)?;
        if identity.version != 1 {
            return Err("Unsupported requester signing identity".into());
        }
        let private = Zeroizing::new(
            STANDARD
                .decode(&identity.private_key_pkcs8_b64)
                .map_err(crate::err)?,
        );
        let key = SigningKey::from_pkcs8_der(&private).map_err(crate::err)?;
        let spki = key
            .verifying_key()
            .to_public_key_der()
            .map_err(crate::err)?
            .as_bytes()
            .to_vec();
        let pin = crate::location_proof::fingerprint_spki(&spki)?;
        Ok(Self { key, spki, pin })
    }
}

fn header(content_type: &str, pin: &str) -> Result<Header, String> {
    Ok(HeaderBuilder::new()
        .algorithm(iana::Algorithm::ES256)
        .content_type(content_type.into())
        .key_id(hex::decode(pin).map_err(crate::err)?)
        .build())
}

pub(crate) fn sign(
    payload: &impl Serialize,
    identity: &RequesterIdentity,
    content_type: &str,
) -> Result<Vec<u8>, String> {
    let payload = serde_json::to_vec(payload).map_err(crate::err)?;
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err("Live-session payload exceeds its limit".into());
    }
    let mut message = CoseSign1Builder::new()
        .protected(header(content_type, &identity.pin)?)
        .payload(payload)
        .build();
    let signature: Signature = identity.key.sign(&message.tbs_data(&[]));
    message.signature = signature
        .normalize_s()
        .unwrap_or(signature)
        .to_bytes()
        .to_vec();
    let bytes = message.to_tagged_vec().map_err(crate::err)?;
    if bytes.len() > MAX_COSE_BYTES {
        return Err("Live-session COSE exceeds its limit".into());
    }
    Ok(bytes)
}

pub(crate) struct Signed<T> {
    pub payload: T,
    pub pin: String,
    pub signature_valid: bool,
}

pub(crate) fn read<T: DeserializeOwned + RequesterKey>(
    bytes: &[u8],
    content_type: &str,
) -> Result<Signed<T>, String> {
    if bytes.len() > MAX_COSE_BYTES {
        return Err("Live-session COSE exceeds its limit".into());
    }
    let message = CoseSign1::from_tagged_slice(bytes).map_err(crate::err)?;
    if !message.unprotected.is_empty() {
        return Err("Unprotected live-session headers are forbidden".into());
    }
    let payload_bytes = message
        .payload
        .as_ref()
        .ok_or("Live-session COSE needs an attached payload")?;
    if payload_bytes.len() > MAX_PAYLOAD_BYTES {
        return Err("Live-session payload exceeds its limit".into());
    }
    let payload: T = serde_json::from_slice(payload_bytes).map_err(crate::err)?;
    let spki = super::decode_base64(payload.public_key(), 256)?;
    let pin = crate::location_proof::fingerprint_spki(&spki)?;
    if message.protected.header != header(content_type, &pin)? {
        return Err("Wrong live-session domain, key ID or algorithm".into());
    }
    let key = VerifyingKey::from_public_key_der(&spki).map_err(crate::err)?;
    let signature_valid = message
        .verify_signature(&[], |signature, data| {
            let signature = Signature::from_slice(signature)?;
            key.verify(data, &signature)
        })
        .is_ok();
    Ok(Signed {
        payload,
        pin,
        signature_valid,
    })
}

// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

impl Evidence {
    pub(super) fn request_json(&self) -> Result<String, String> {
        match self {
            Self::Image(r) => json(r),
            Self::Location(r) | Self::CameraLocation(r) => json(r),
            Self::Audio(r) => json(r),
        }
    }
    pub(super) fn identity(&self) -> (&str, u64, u64) {
        let c = match self {
            Self::Image(r) => r,
            Self::Location(r) | Self::CameraLocation(r) => &r.challenge,
            Self::Audio(r) => return (&r.session_id, r.issued_at, r.expires_at),
        };
        (&c.id, c.issued_at, c.expires_at)
    }
    pub(super) fn demo(&self) -> bool {
        match self {
            Self::Image(_) => false,
            Self::Location(r) | Self::CameraLocation(r) => r.demo,
            Self::Audio(r) => r.demo,
        }
    }
    pub(super) fn min_response_ms(&self) -> u64 {
        match self {
            Self::Image(_) => 0,
            Self::Location(r) | Self::CameraLocation(r) => r.policy.duration_ms,
            Self::Audio(r) => u64::from(r.duration_secs) * 1000 - 100,
        }
    }
    fn validate_at(&self, now_ms: u64) -> Result<(), String> {
        match self {
            Self::Image(r) => {
                crate::validate_challenge(&json(r)?, (now_ms / 1000) as f64)?;
            }
            Self::Location(r) => {
                crate::location_proof::validate_request(r, now_ms)?;
                if r.context.is_some() {
                    return Err("Standalone location cannot carry a composed asset context".into());
                }
            }
            Self::CameraLocation(r) => {
                crate::location_proof::validate_request(r, now_ms)?;
                if r.demo || r.context.as_ref().is_none_or(|c| c.purpose != "camera") {
                    return Err("Camera-location requires a non-demo camera request context".into());
                }
            }
            Self::Audio(r) => {
                crate::audio::validate_audio_request(&json(r)?, (now_ms / 1000) as f64)?;
            }
        }
        Ok(())
    }
}

pub(super) fn shape(request: &SessionRequest) -> Result<(), String> {
    let spec = &request.spec;
    if request.version != 1
        || request.kind != "nonverba-evidence-session-request-payload"
        || !hash(&request.session_id)
        || request.created_at_ms > MAX_SAFE_INTEGER
        || !request.created_at_ms.is_multiple_of(1000)
        || spec.version != 1
        || request.requester_pin.kind != PinKind::RequesterSpkiSha256
        || !hash(&request.requester_pin.sha256)
    {
        return Err("Unsupported evidence-session request".into());
    }
    spec.policy.validate()?;
    spec.evidence.validate_at(request.created_at_ms)?;
    let (nonce, issued, expires) = spec.evidence.identity();
    let issued = millis(issued as f64)?;
    let expires = millis(expires as f64)?;
    if !hash(nonce)
        || request.sensor_nonce != nonce
        || request.issued_at_ms != issued
        || request.expires_at_ms != expires
        || request.created_at_ms < issued
        || request.created_at_ms - issued > MAX_START_DELAY_MS
        || request.sensor_request_binding != binding(spec.evidence.request_json()?.as_bytes())
    {
        return Err("Original sensor request identity, digest or challenge age is invalid".into());
    }
    let (needs_media, needs_location) = match &spec.evidence {
        Evidence::Image(_) | Evidence::Audio(_) => (true, false),
        Evidence::Location(_) => (false, true),
        Evidence::CameraLocation(_) => (true, true),
    };
    for (pin, required) in [
        (&spec.operator_pins.media_certificate_sha256, needs_media),
        (&spec.operator_pins.location_spki_sha256, needs_location),
    ] {
        if pin.is_some() != required || pin.as_ref().is_some_and(|s| !hash(s)) {
            return Err("Evidence kind requires exactly its typed operator pins".into());
        }
    }
    if spec.operator_pins.location_spki_sha256.as_deref() == Some(&request.requester_pin.sha256) {
        return Err("Requester and location signer must use different keys".into());
    }
    if spec.delivery.max_response_ms < spec.evidence.min_response_ms().saturating_add(1000)
        || spec.delivery.max_response_ms > MAX_RESPONSE_MS
        || !(1..=86_400_000).contains(&spec.delivery.max_receipt_age_ms)
        || request
            .created_at_ms
            .saturating_add(spec.delivery.max_response_ms)
            > expires
    {
        return Err("Evidence-session delivery limits are invalid".into());
    }
    Ok(())
}

pub(super) fn authenticate(bytes: &[u8], expected_pin: &str) -> Result<SessionRequest, String> {
    if !hash(expected_pin) {
        return Err("An independently retained requester SPKI pin is required".into());
    }
    let signed = cose::read::<SessionRequest>(bytes, REQUEST_TYPE)?;
    shape(&signed.payload)?;
    if !signed.signature_valid
        || signed.pin != expected_pin
        || signed.payload.requester_pin.sha256 != expected_pin
    {
        return Err("Evidence request signature or retained requester pin does not match".into());
    }
    Ok(signed.payload)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn create_evidence_session_request(
    spec_json: &str,
    requester_identity_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let spec: SessionSpec = parse(spec_json)?;
    let signer = cose::RequesterIdentity::load(requester_identity_json)?;
    let mut nonce = [0u8; 32];
    getrandom::getrandom(&mut nonce).map_err(crate::err)?;
    let (sensor_nonce, issued, expires) = spec.evidence.identity();
    let request = SessionRequest {
        version: 1,
        kind: "nonverba-evidence-session-request-payload".into(),
        session_id: hex::encode(nonce),
        created_at_ms: millis(now_secs)?,
        requester_pin: KeyPin {
            kind: PinKind::RequesterSpkiSha256,
            sha256: signer.pin.clone(),
        },
        requester_public_spki_der_b64: STANDARD.encode(&signer.spki),
        sensor_nonce: sensor_nonce.into(),
        issued_at_ms: millis(issued as f64)?,
        expires_at_ms: millis(expires as f64)?,
        sensor_request_binding: binding(spec.evidence.request_json()?.as_bytes()),
        spec,
    };
    shape(&request)?;
    json(&RequestEnvelope {
        version: 1,
        kind: "nonverba-evidence-session-request".into(),
        cose_b64: STANDARD.encode(cose::sign(&request, &signer, REQUEST_TYPE)?),
    })
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn validate_evidence_session_request(
    envelope_json: &str,
    expected_requester_pin: &str,
    expected_operator_pins_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let request = authenticate(&request_bytes(envelope_json)?, expected_requester_pin)?;
    let pins: OperatorPins = parse(expected_operator_pins_json)?;
    let now = millis(now_secs)?;
    if pins != request.spec.operator_pins
        || now < request.created_at_ms
        || now - request.created_at_ms > MAX_START_DELAY_MS
        || now.saturating_add(request.spec.delivery.max_response_ms) > request.expires_at_ms
    {
        return Err(
            "Evidence request pins, dispatch time or remaining validity do not match".into(),
        );
    }
    json(&request)
}

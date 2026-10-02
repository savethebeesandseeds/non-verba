// SPDX-License-Identifier: AGPL-3.0-only
//! Internal camera JNI. Kotlin retains JPEGs and capture metadata; this module is
//! never installed as a WebView bridge and has no JavaScript signing endpoint.

use base64::{engine::general_purpose::STANDARD, Engine};
use jni::{
    objects::{JByteArray, JObject, JString, JValue},
    sys::{jlong, jstring},
    JNIEnv,
};
use nonverba_core::{
    camera_capture::{CameraCaptureMetadata, CameraRequest},
    native_signer::{create_certificate_chain, ExternalSigner},
};
use serde_json::{json, Value};

use super::{now, response, text};

fn bytes(env: &mut JNIEnv<'_>, array: JByteArray<'_>, max: i32) -> Result<Vec<u8>, String> {
    if env
        .get_array_length(&array)
        .map_err(|error| error.to_string())?
        > max
    {
        return Err("Native camera byte input exceeds its size limit".into());
    }
    env.convert_byte_array(array)
        .map_err(|error| error.to_string())
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeCameraCore_createCertificate(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    public_spki: JByteArray<'_>,
) -> jstring {
    response(&mut env, |env| {
        create_certificate_chain(&bytes(env, public_spki, 4096)?)
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeCameraCore_identity(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    certificate_pem: JString<'_>,
    public_spki: JByteArray<'_>,
) -> jstring {
    response(&mut env, |env| {
        let certificate = text(env, certificate_pem, 64 * 1024)?;
        let spki = bytes(env, public_spki, 4096)?;
        // Enrollment validation must never exercise an unrestricted signing key.
        let mut unavailable =
            |_message: &[u8]| Err("No signing capability during identity lookup".into());
        let signer = ExternalSigner::new(&certificate, &spki, &mut unavailable)?;
        Ok(json!({"fingerprint": signer.fingerprint()}).to_string())
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeCameraCore_validateRequest(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    challenge_json: JString<'_>,
    location_request_json: JString<'_>,
    now_ms: jlong,
) -> jstring {
    response(&mut env, |env| {
        let challenge = serde_json::from_str(&text(env, challenge_json, 64 * 1024)?)
            .map_err(|error| error.to_string())?;
        let location_json = text(env, location_request_json, 64 * 1024)?;
        let location_request: Option<Value> = if location_json.is_empty() {
            None
        } else {
            serde_json::from_str(&location_json).map_err(|error| error.to_string())?
        };
        let request = CameraRequest {
            version: 1,
            challenge,
            location_request,
        };
        request.validate(now(now_ms)?)?;
        serde_json::to_string(&request).map_err(|error| error.to_string())
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeCameraCore_validateLocation(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    request_json: JString<'_>,
    location_json: JString<'_>,
    now_ms: jlong,
) -> jstring {
    response(&mut env, |env| {
        let request: CameraRequest = serde_json::from_str(&text(env, request_json, 128 * 1024)?)
            .map_err(|error| error.to_string())?;
        let now_ms = now(now_ms)?;
        request.validate(now_ms)?;
        nonverba_core::validate_location(
            &text(env, location_json, 64 * 1024)?,
            &serde_json::to_string(&request.challenge).map_err(|error| error.to_string())?,
            (now_ms / 1000) as f64,
        )
    })
}

#[no_mangle]
#[allow(clippy::too_many_arguments)] // Fixed JNI ABI matches the native-only Kotlin controller.
pub extern "system" fn Java_org_nonverba_camera_NativeCameraCore_seal(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    jpeg: JByteArray<'_>,
    request_json: JString<'_>,
    location_json: JString<'_>,
    capture_metadata_json: JString<'_>,
    public_spki: JByteArray<'_>,
    certificate_pem: JString<'_>,
    now_ms: jlong,
    key: JObject<'_>,
) -> jstring {
    response(&mut env, |env| {
        let jpeg = bytes(env, jpeg, 32 * 1024 * 1024)?;
        let request: CameraRequest = serde_json::from_str(&text(env, request_json, 128 * 1024)?)
            .map_err(|error| error.to_string())?;
        let location = text(env, location_json, 64 * 1024)?;
        let metadata: CameraCaptureMetadata =
            serde_json::from_str(&text(env, capture_metadata_json, 16 * 1024)?)
                .map_err(|error| error.to_string())?;
        let spki = bytes(env, public_spki, 4096)?;
        let certificate = text(env, certificate_pem, 64 * 1024)?;
        let mut callback = |message: &[u8]| {
            let message = env
                .byte_array_from_slice(message)
                .map_err(|error| error.to_string())?;
            let signature = env
                .call_method(
                    &key,
                    "signEvidence",
                    "([B)[B",
                    &[JValue::Object(message.as_ref())],
                )
                .map_err(|_| "Android camera signing capability failed".to_owned())?
                .l()
                .map_err(|error| error.to_string())?;
            bytes(env, JByteArray::from(signature), 128)
        };
        let signer = ExternalSigner::new(&certificate, &spki, &mut callback)?;
        let sealed = signer.seal_camera(&jpeg, &request, &location, &metadata, now(now_ms)?)?;
        Ok(json!({
            "image_base64": STANDARD.encode(sealed),
            "fingerprint": signer.fingerprint(),
            "media_origin": "native-camera2-jpeg",
            "hardware_attested": false,
            "collection_attested": false,
            "camera_exposure_attested": false
        })
        .to_string())
    })
}

// SPDX-License-Identifier: AGPL-3.0-only
//! Internal Android JNI adapter. Only the Kotlin session controller calls these functions.
//! The WebView bridge cannot supply observations, timestamps, or data to a generic signer.
mod audio;
mod camera;
use base64::{engine::general_purpose::STANDARD, Engine};
use jni::{
    objects::{JByteArray, JObject, JString, JValue},
    sys::{jlong, jstring},
    JNIEnv,
};
use nonverba_core::location_proof::{
    asset_from_jpeg, evaluate_raw_gnss_collection, fingerprint_spki, parse_request, parse_trace,
    seal_with_signer, validate_request, validate_trace, MAX_TRACE_JSON_BYTES,
};
use serde_json::json;

fn text(env: &mut JNIEnv<'_>, input: JString<'_>, max: usize) -> Result<String, String> {
    let value: String = env.get_string(&input).map_err(|e| e.to_string())?.into();
    if value.len() > max {
        return Err("Native protocol input is too large".into());
    }
    Ok(value)
}

fn now(value: jlong) -> Result<u64, String> {
    u64::try_from(value).map_err(|_| "Invalid native clock".into())
}

fn response<'local>(
    env: &mut JNIEnv<'local>,
    operation: impl FnOnce(&mut JNIEnv<'local>) -> Result<String, String>,
) -> jstring {
    match operation(env) {
        Ok(value) => match env.new_string(value) {
            Ok(value) => value.into_raw(),
            Err(_) => std::ptr::null_mut(),
        },
        Err(message) => {
            // Clear a failed internal Keystore callback before translating its error.
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_clear();
            }
            let _ = env.throw_new("java/lang/IllegalArgumentException", message);
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeLocationCore_sealAttempt(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    snapshot: JString<'_>,
    public_spki: JByteArray<'_>,
    now_ms: jlong,
    key: JObject<'_>,
) -> jstring {
    response(&mut env, |env| {
        let snapshot = nonverba_core::location_attempt::parse_snapshot(&text(
            env,
            snapshot,
            nonverba_core::location_attempt::MAX_ATTEMPT_JSON,
        )?)?;
        if env
            .get_array_length(&public_spki)
            .map_err(|e| e.to_string())?
            > 256
        {
            return Err("Invalid attempt public key size".into());
        }
        let spki = env
            .convert_byte_array(public_spki)
            .map_err(|e| e.to_string())?;
        let report = nonverba_core::location_attempt::seal_with_signer(
            snapshot,
            &spki,
            now(now_ms)?,
            |message| {
                let array = env
                    .byte_array_from_slice(message)
                    .map_err(|e| e.to_string())?;
                let signature = env
                    .call_method(
                        &key,
                        "signEvidence",
                        "([B)[B",
                        &[JValue::Object(array.as_ref())],
                    )
                    .map_err(|_| "Android Keystore attempt signing failed".to_owned())?
                    .l()
                    .map_err(|e| e.to_string())?;
                env.convert_byte_array(JByteArray::from(signature))
                    .map_err(|e| e.to_string())
            },
        )?;
        Ok(json!({"report_base64": STANDARD.encode(report)}).to_string())
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeLocationCore_validateRequest(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    request: JString<'_>,
    now_ms: jlong,
) -> jstring {
    response(&mut env, |env| {
        let request = parse_request(&text(env, request, 64 * 1024)?)?;
        validate_request(&request, now(now_ms)?)?;
        serde_json::to_string(&request).map_err(|e| e.to_string())
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeLocationCore_validateTrace(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    trace: JString<'_>,
    now_ms: jlong,
) -> jstring {
    response(&mut env, |env| {
        let trace = parse_trace(&text(env, trace, MAX_TRACE_JSON_BYTES)?)?;
        validate_trace(&trace, now(now_ms)?)?;
        serde_json::to_string(&trace).map_err(|e| e.to_string())
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeLocationCore_rawGnssProgress(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    trace: JString<'_>,
) -> jstring {
    response(&mut env, |env| {
        let trace = parse_trace(&text(env, trace, MAX_TRACE_JSON_BYTES)?)?;
        serde_json::to_string(&evaluate_raw_gnss_collection(&trace)).map_err(|e| e.to_string())
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeLocationCore_fingerprint(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    public_spki: JByteArray<'_>,
) -> jstring {
    response(&mut env, |env| {
        if env
            .get_array_length(&public_spki)
            .map_err(|e| e.to_string())?
            > 4096
        {
            return Err("Invalid public key size".into());
        }
        fingerprint_spki(
            &env.convert_byte_array(public_spki)
                .map_err(|e| e.to_string())?,
        )
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeLocationCore_seal(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    trace: JString<'_>,
    public_spki: JByteArray<'_>,
    jpeg: JByteArray<'_>,
    now_ms: jlong,
    key: JObject<'_>,
) -> jstring {
    response(&mut env, |env| {
        let trace = parse_trace(&text(env, trace, MAX_TRACE_JSON_BYTES)?)?;
        if trace.profile != "native-android" {
            return Err("Native collector profile is required".into());
        }
        if env
            .get_array_length(&public_spki)
            .map_err(|e| e.to_string())?
            > 4096
        {
            return Err("Invalid public key size".into());
        }
        if env.get_array_length(&jpeg).map_err(|e| e.to_string())? > 32 * 1024 * 1024 {
            return Err("JPEG exceeds 32 MiB".into());
        }
        let spki = env
            .convert_byte_array(public_spki)
            .map_err(|e| e.to_string())?;
        let jpeg = env.convert_byte_array(jpeg).map_err(|e| e.to_string())?;
        let asset = if jpeg.is_empty() {
            None
        } else {
            Some(asset_from_jpeg(&jpeg)?)
        };
        let proof = seal_with_signer(&trace, &spki, asset, now(now_ms)?, |message| {
            let message_array = env
                .byte_array_from_slice(message)
                .map_err(|e| e.to_string())?;
            let signature = env
                .call_method(
                    &key,
                    "signEvidence",
                    "([B)[B",
                    &[JValue::Object(message_array.as_ref())],
                )
                .map_err(|_| "Android Keystore evidence signing failed".to_owned())?
                .l()
                .map_err(|e| e.to_string())?;
            let signature = JByteArray::from(signature);
            env.convert_byte_array(signature).map_err(|e| e.to_string())
        })?;
        Ok(json!({
            "proof_base64": STANDARD.encode(proof),
            "key_fingerprint": fingerprint_spki(&spki)?,
            "media_origin": if jpeg.is_empty() { "none" } else { "webview-submitted-jpeg" },
            "hardware_attested": false,
            "collection_attested": false,
            "camera_exposure_attested": false
        })
        .to_string())
    })
}

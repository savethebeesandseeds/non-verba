// SPDX-License-Identifier: AGPL-3.0-only
//! Internal native audio JNI. Kotlin obtains PCM exclusively from the retained
//! AAudio device buffer; these functions are never a JavaScript bridge.

use super::{now, response, text};
use base64::{engine::general_purpose::STANDARD, Engine};
use jni::{
    objects::{JByteArray, JFloatArray, JObject, JString, JValue},
    sys::{jfloatArray, jlong, jstring},
    JNIEnv,
};
use nonverba_core::{
    audio::{AudioRound, CHUNK_SAMPLES, SAMPLE_RATE},
    audio_capture::AudioCaptureMetadata,
    native_signer::ExternalSigner,
};
use serde_json::json;

fn pcm(env: &mut JNIEnv<'_>, input: JFloatArray<'_>, max: i32) -> Result<Vec<f32>, String> {
    let length = env
        .get_array_length(&input)
        .map_err(|error| error.to_string())?;
    if length <= 0 || length > max {
        return Err("Native audio sample buffer exceeds its bounds".into());
    }
    let mut samples = vec![0.0; length as usize];
    env.get_float_array_region(input, 0, &mut samples)
        .map_err(|error| error.to_string())?;
    Ok(samples)
}

fn bytes(env: &mut JNIEnv<'_>, input: JByteArray<'_>, max: i32) -> Result<Vec<u8>, String> {
    if env
        .get_array_length(&input)
        .map_err(|error| error.to_string())?
        > max
    {
        return Err("Native audio key input exceeds its bounds".into());
    }
    env.convert_byte_array(input)
        .map_err(|error| error.to_string())
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeAudioCore_validateRequest(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    request: JString<'_>,
    now_ms: jlong,
) -> jstring {
    response(&mut env, |env| {
        nonverba_core::validate_audio_request(
            &text(env, request, 64 * 1024)?,
            (now(now_ms)? / 1000) as f64,
        )
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeAudioCore_createPilot(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    request: JString<'_>,
    now_ms: jlong,
) -> jstring {
    response(&mut env, |env| {
        nonverba_core::create_audio_round(
            &text(env, request, 64 * 1024)?,
            0,
            (now(now_ms)? / 1000) as f64,
        )
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeAudioCore_validateRound(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    request: JString<'_>,
    round: JString<'_>,
    prior: JString<'_>,
    now_ms: jlong,
) -> jstring {
    response(&mut env, |env| {
        nonverba_core::native_audio_signing::validate_round(
            &text(env, request, 64 * 1024)?,
            &text(env, round, 4096)?,
            &text(env, prior, 16 * 1024)?,
            (now(now_ms)? / 1000) as f64,
        )
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeAudioCore_probe(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    round: JString<'_>,
) -> jfloatArray {
    let result = (|| {
        let round: AudioRound = serde_json::from_str(&text(&mut env, round, 4096)?)
            .map_err(|error| error.to_string())?;
        let samples = nonverba_core::audio_probe(&round.session_id, round.index, &round.nonce)?;
        let array = env
            .new_float_array(samples.len() as i32)
            .map_err(|error| error.to_string())?;
        env.set_float_array_region(&array, 0, &samples)
            .map_err(|error| error.to_string())?;
        Ok::<_, String>(array.into_raw())
    })();
    match result {
        Ok(array) => array,
        Err(error) => {
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_clear();
            }
            let _ = env.throw_new("java/lang/IllegalArgumentException", error);
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeAudioCore_validatePilot(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    samples: JFloatArray<'_>,
    round: JString<'_>,
) -> jstring {
    response(&mut env, |env| {
        nonverba_core::native_audio_signing::validate_pilot(
            &pcm(env, samples, CHUNK_SAMPLES as i32)?,
            &text(env, round, 4096)?,
        )
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeAudioCore_encodeChunk(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    samples: JFloatArray<'_>,
) -> jstring {
    response(&mut env, |env| {
        let samples = pcm(env, samples, CHUNK_SAMPLES as i32)?;
        if samples.len() != CHUNK_SAMPLES as usize {
            return Err("Native audio transport requires a complete two-second chunk".into());
        }
        let encoded = nonverba_core::encode_audio_pcm(&samples)?;
        Ok(json!({"pcm_base64": STANDARD.encode(encoded), "pcm_sha256": nonverba_core::hash_audio_pcm(&samples)?, "sample_count": samples.len()}).to_string())
    })
}

#[no_mangle]
pub extern "system" fn Java_org_nonverba_camera_NativeAudioCore_validateReceipt(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    request: JString<'_>,
    rounds: JString<'_>,
    receipt: JString<'_>,
    now_ms: jlong,
) -> jstring {
    response(&mut env, |env| {
        nonverba_core::native_audio_signing::validate_receipt(
            &text(env, request, 64 * 1024)?,
            &text(env, rounds, 16 * 1024)?,
            &text(env, receipt, 64 * 1024)?,
            (now(now_ms)? / 1000) as f64,
        )
    })
}

#[no_mangle]
#[allow(clippy::too_many_arguments)] // Fixed internal Kotlin ABI, not a WebView API.
pub extern "system" fn Java_org_nonverba_camera_NativeAudioCore_seal(
    mut env: JNIEnv<'_>,
    _this: JObject<'_>,
    samples: JFloatArray<'_>,
    request: JString<'_>,
    transcript: JString<'_>,
    metadata: JString<'_>,
    public_spki: JByteArray<'_>,
    certificate_pem: JString<'_>,
    now_ms: jlong,
    key: JObject<'_>,
) -> jstring {
    response(&mut env, |env| {
        let samples = pcm(env, samples, (30 * SAMPLE_RATE) as i32)?;
        let request = text(env, request, 64 * 1024)?;
        let transcript = text(env, transcript, 64 * 1024)?;
        let metadata: AudioCaptureMetadata =
            serde_json::from_str(&text(env, metadata, 512 * 1024)?)
                .map_err(|error| error.to_string())?;
        let spki = bytes(env, public_spki, 4096)?;
        let certificates = text(env, certificate_pem, 64 * 1024)?;
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
                .map_err(|_| "Native audio signing capability failed".to_owned())?
                .l()
                .map_err(|error| error.to_string())?;
            bytes(env, JByteArray::from(signature), 128)
        };
        let signer = ExternalSigner::new(&certificates, &spki, &mut callback)?;
        let wav =
            signer.seal_native_audio(&samples, &request, &transcript, &metadata, now(now_ms)?)?;
        Ok(json!({"wav_base64": STANDARD.encode(wav), "fingerprint": signer.fingerprint(), "media_origin":"native-aaudio-pcm",
            "hardware_attested":false,"collection_attested":false,"sensor_origin_proven":false,"acoustic_path_proven":false}).to_string())
    })
}

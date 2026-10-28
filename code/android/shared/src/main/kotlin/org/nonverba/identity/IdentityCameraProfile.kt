// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.identity

import org.json.JSONArray
import org.json.JSONObject
import org.nonverba.attestation.DeviceAttestationProof
import org.nonverba.camera.NativeCameraIdentity
import org.nonverba.camera.NativeCameraProfile

internal object IdentityCameraProfile {
    fun objectMap(value: JSONObject): Map<String, Any?> = value.keys().asSequence().associateWith { key -> convert(value.get(key)) }
    private fun convert(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> objectMap(value)
        is JSONArray -> (0 until value.length()).map { convert(value.get(it)) }
        else -> value
    }
    fun prepare(json: String, key: IdentityCaptureKey, active: () -> Boolean): NativeCameraProfile {
        val original = IdentityCaptureProtocol.request(objectMap(JSONObject(json)), System.currentTimeMillis())
        val account = original["account_id"] as String; val kind = original["kind"] as String
        val identity = key.identity(account, active)
        IdentityCaptureProtocol.request(original, System.currentTimeMillis(), identity.pin)
        return NativeCameraProfile(JSONObject(IdentityCaptureProtocol.canonical(original)), original["challenge_id"] as String,
            NativeCameraIdentity(identity.pin, "identity-capture-v1", identity.spki, "unverified", false, false),
            requiredLens = IdentityCaptureProtocol.lens(kind), requiresLocation = false, retainCompleted = false, active = active,
            requireWindow = { now -> IdentityCaptureProtocol.window(original, now) },
            validateLocation = { _, _ -> error("Location is unavailable in identity capture") },
            seal = { jpeg, location, metadata, _, authority ->
                check(location == null && authority())
                val image = IdentityImageNormalizer.normalize(jpeg, kind, authority); check(authority())
                val lens = metadata.getString("lens_facing"); check(lens == IdentityCaptureProtocol.lens(kind))
                val acquisition = linkedMapOf<String, Any?>("version" to 1, "timestamp_source" to metadata.getString("timestamp_source"),
                    "request_elapsed_realtime_ns" to metadata.getString("capture_requested_elapsed_ns"),
                    "image_received_elapsed_realtime_ns" to metadata.getString("image_received_elapsed_ns"),
                    "result_received_elapsed_realtime_ns" to metadata.getString("callback_received_elapsed_ns"),
                    "sensor_timestamp_ns" to metadata.getString("sensor_timestamp_ns"), "image_timestamp_ns" to metadata.getString("image_timestamp_ns"),
                    "zsl_requested_disabled" to true, "test_pattern_requested_disabled" to true,
                    "zsl_result_enabled" to if (metadata.isNull("zsl_result_enabled")) null else metadata.getBoolean("zsl_result_enabled"),
                    "test_pattern_result_mode" to if (metadata.isNull("test_pattern_result_mode")) null else metadata.getInt("test_pattern_result_mode"))
                IdentityCaptureProtocol.acquisition(acquisition)
                val captured = metadata.getLong("acquired_at_unix_ms")
                check(captured >= IdentityCaptureProtocol.integer(original["issued_at_ms"]) && captured <= System.currentTimeMillis() &&
                    captured < IdentityCaptureProtocol.integer(original["capture_expires_at_ms"]))
                val payload = linkedMapOf<String, Any?>("request" to original, "image_sha256" to IdentityCaptureProtocol.sha256(image.bytes),
                    "image_bytes" to image.bytes.size, "width" to image.width, "height" to image.height,
                    "captured_at_ms" to captured, "lens_facing" to lens, "acquisition" to acquisition)
                val signature = key.sign(account, identity.pin, IdentityCaptureProtocol.signingBytes(payload), authority)
                check(authority())
                val proof = JSONObject().put("payload", JSONObject(IdentityCaptureProtocol.canonical(payload)))
                    .put("public_spki_der_b64", DeviceAttestationProof.b64(identity.spki)).put("signature_b64", DeviceAttestationProof.b64(signature))
                check(proof.toString().toByteArray(Charsets.UTF_8).size <= 16_384)
                JSONObject().put("image_base64", DeviceAttestationProof.b64(image.bytes)).put("proof", proof)
            })
    }
}

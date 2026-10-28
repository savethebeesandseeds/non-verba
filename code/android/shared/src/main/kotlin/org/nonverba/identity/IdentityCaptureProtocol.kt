// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.identity

import org.nonverba.attestation.DeviceAttestationProof
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/** Closed identity purpose; no photo-evidence, account-authentication or raw-signing operation. */
internal object IdentityCaptureProtocol {
    private val fields = setOf("version", "purpose", "challenge_id", "nonce", "account_id", "principal_id",
        "current_session_id", "recovery_generation", "kind", "source", "public_spki_sha256", "issued_at_ms",
        "capture_expires_at_ms", "submit_expires_at_ms")
    private val identifier = Regex("[A-Za-z0-9._:-]{1,128}")
    fun identifier(value: String) = identifier.matches(value)
    fun integer(value: Any?): Long {
        require(value is Long || value is Int)
        return (value as Number).toLong().also { require(it in 0..9_007_199_254_740_991L) }
    }
    fun request(value: Map<String, Any?>, nowMs: Long, expectedKey: String? = null): Map<String, Any?> {
        require(value.keys == fields && integer(value["version"]) == 1L && value["purpose"] == "identity-capture")
        for (field in listOf("account_id", "principal_id", "current_session_id")) require(identifier(value[field] as? String ?: ""))
        require(DeviceAttestationProof.url32(value["challenge_id"] as? String ?: "") && DeviceAttestationProof.url32(value["nonce"] as? String ?: ""))
        integer(value["recovery_generation"])
        require(value["kind"] in listOf("document_front", "face_front") && value["source"] == "native-camera2")
        val pin = value["public_spki_sha256"] as? String ?: ""
        require(Regex("[a-f0-9]{64}").matches(pin) && (expectedKey == null || pin == expectedKey))
        val issued = integer(value["issued_at_ms"])
        val expires = integer(value["capture_expires_at_ms"])
        val submit = integer(value["submit_expires_at_ms"])
        require(expires - issued == 120_000L && submit - issued == 900_000L && issued <= nowMs + 30_000L && nowMs < expires)
        return value.toMap()
    }
    fun window(request: Map<String, Any?>, nowMs: Long) {
        require(nowMs >= integer(request["issued_at_ms"]) && nowMs < integer(request["capture_expires_at_ms"]))
    }
    fun lens(kind: String) = when (kind) { "document_front" -> "back"; "face_front" -> "front"; else -> error("Invalid identity kind") }
    fun acquisition(value: Map<String, Any?>) {
        require(value.keys == setOf("version", "timestamp_source", "request_elapsed_realtime_ns", "image_received_elapsed_realtime_ns",
            "result_received_elapsed_realtime_ns", "sensor_timestamp_ns", "image_timestamp_ns", "zsl_requested_disabled",
            "test_pattern_requested_disabled", "zsl_result_enabled", "test_pattern_result_mode"))
        require(integer(value["version"]) == 1L && value["timestamp_source"] in listOf("realtime", "unknown") &&
            value["zsl_requested_disabled"] == true && value["test_pattern_requested_disabled"] == true &&
            value["zsl_result_enabled"] in listOf(null, false) &&
            (value["test_pattern_result_mode"] == null || integer(value["test_pattern_result_mode"]) == 0L))
        fun ns(name: String): Long {
            val text = value[name] as? String ?: error("Missing native counter")
            require(Regex("0|[1-9][0-9]{0,18}").matches(text))
            return requireNotNull(text.toLongOrNull()).also { require(it >= 0) }
        }
        val request = ns("request_elapsed_realtime_ns")
        val image = ns("image_received_elapsed_realtime_ns"); val result = ns("result_received_elapsed_realtime_ns")
        val sensor = ns("sensor_timestamp_ns")
        require(sensor == ns("image_timestamp_ns") && image >= request && result >= request &&
            image - request <= 15_000_000_000L && result - request <= 15_000_000_000L)
        if (value["timestamp_source"] == "realtime") require(sensor >= request && sensor <= image && sensor <= result)
    }
    fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    fun canonical(value: Any?): String = when (value) {
        null -> "null"
        is Boolean -> value.toString()
        is Int, is Long -> integer(value).toString()
        is String -> buildString {
            append('"')
            for (character in value) when (character) {
                '"' -> append("\\\""); '\\' -> append("\\\\"); '\b' -> append("\\b"); '\u000c' -> append("\\f")
                '\n' -> append("\\n"); '\r' -> append("\\r"); '\t' -> append("\\t")
                else -> if (character.code < 32) append("\\u%04x".format(character.code)) else append(character)
            }
            append('"')
        }
        is Map<*, *> -> value.keys.map { it as String }.sorted().joinToString(",", "{", "}") { canonical(it) + ":" + canonical(value[it]) }
        is List<*> -> value.joinToString(",", "[", "]") { canonical(it) }
        else -> error("Unsupported identity capture JSON value")
    }
    fun signingBytes(payload: Map<String, Any?>): ByteArray =
        ("NONVERBA:IDENTITY_CAPTURE:v1\n" + canonical(payload)).toByteArray(StandardCharsets.UTF_8)
}

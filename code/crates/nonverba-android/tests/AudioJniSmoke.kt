// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.io.File
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/** Synthetic JVM coverage of every production audio JNI declaration. These
 * fixtures exercise protocol/DSP/signing, and make no Android sensor claim. */
internal fun audioSmoke(output: File): Int {
    val now = 1_800_000_000_000L
    val session = "03".repeat(32)
    val request = """{"version":1,"session_id":"$session","requester":"JNI synthetic test","task":"Synthetic native microphone sample","issued_at":1800000000,"expires_at":1800000120,"duration_secs":4,"sample_rate":48000,"channels":1,"chunk_samples":96000,"round_deadline_ms":3000,"signal_algorithm":"org.nonverba.audio-fsk.v1"}"""
    fun field(json: String, name: String) = Regex("\"$name\":\"([^\"]+)\"").find(json)!!.groupValues[1]
    fun objectField(json: String, name: String): String? {
        val at = json.indexOf("\"$name\":")
        if (at < 0) return null
        val start = at + name.length + 3
        if (json.getOrNull(start) != '{') return null
        var depth = 0; var quoted = false; var escaped = false
        for (index in start until json.length) {
            val character = json[index]
            if (quoted) {
                if (escaped) escaped = false
                else if (character == '\\') escaped = true
                else if (character == '"') quoted = false
            } else when (character) {
                '"' -> quoted = true
                '{' -> depth++
                '}' -> { depth--; if (depth == 0) return json.substring(start, index + 1) }
            }
        }
        return null
    }
    fun roundAssessment(envelope: String, expectedPass: Boolean): String {
        val report = requireNotNull(objectField(envelope, "round_assessment"))
        check(report.toByteArray(Charsets.UTF_8).size <= 8192)
        check(report.contains("\"type\":\"nonverba-native-audio-round-assessment\""))
        check(report.contains("\"sample_format\":\"pcm16\"") && report.contains("\"maximum_start_offset_samples\":38400"))
        check(Regex("\"passed\":(true|false)").find(report)!!.groupValues[1] == expectedPass.toString())
        check(Regex("\"index\":").findAll(report).count() == 2)
        check(!report.contains(session) && !report.contains("04".repeat(32)) && !report.contains("05".repeat(32)))
        check(!report.contains("\"nonce\"") && !report.contains("pcm_base64") && !report.contains("\"signature\""))
        return report
    }
    var checks = 0
    fun passed(name: String) { checks++; println("PASS $name") }
    fun rejected(name: String, operation: () -> Unit) {
        var failed = false
        try { operation() } catch (_: IllegalArgumentException) { failed = true }
        check(failed) { "$name did not fail closed" }; passed(name)
    }
    check(NativeAudioCore.validateRequest(request, now).contains(session))
    rejected("native audio expired request rejected across JNI") { NativeAudioCore.validateRequest(request, now + 120_000) }
    val pilot = NativeAudioCore.createPilot(request, now)
    check(pilot != NativeAudioCore.createPilot(request, now))
    val pilotWave = NativeAudioCore.probe(pilot)
    check(pilotWave.size == 36864 && pilotWave.all { it.isFinite() && it in -1.0f..1.0f })
    val pilotPcm = FloatArray(96000)
    pilotWave.copyInto(pilotPcm, 4800)
    check(NativeAudioCore.validatePilot(pilotPcm, pilot).contains("\"detected\":true"))
    passed("native audio unpredictable pilot and Rust DSP cross JNI")
    rejected("native audio silent pilot rejected") { NativeAudioCore.validatePilot(FloatArray(96000), pilot) }
    rejected("native audio partial pilot rejected") { NativeAudioCore.validatePilot(FloatArray(10), pilot) }

    val assessment = NativeAudioCore.inspectPilot(pilotPcm, pilot)
    check(assessment.length < 1024 && assessment.contains("\"type\":\"nonverba-native-audio-pilot-assessment\""))
    check(assessment.contains("\"passed\":true") && field(assessment, "reason") == "passed")
    check(assessment.contains("\"sample_count\":96000") && assessment.contains("\"maximum_start_offset_samples\":38400"))
    check(!assessment.contains(session) && !assessment.contains(field(pilot, "nonce")))
    passed("native audio pilot inspection preserves bounded metrics without nonce or samples across JNI")
    val missing = NativeAudioCore.inspectPilot(FloatArray(96000), pilot)
    check(missing.contains("\"passed\":false") && field(missing, "reason") == "not_detected")
    check(missing.contains("\"detected\":false") && missing.contains("\"rms\":0.0"))
    passed("native audio silent pilot has an explicit inspection refusal")
    val latePcm = FloatArray(96000).also { pilotWave.copyInto(it, 48000) }
    val late = NativeAudioCore.inspectPilot(latePcm, pilot)
    check(late.contains("\"passed\":false") && field(late, "reason") == "detected_late")
    check(late.contains("\"detected\":true"))
    passed("native audio recovered late pilot has a distinct inspection refusal")
    rejected("native audio inspected late pilot still rejected by legacy gate") { NativeAudioCore.validatePilot(latePcm, pilot) }
    rejected("native audio inspected partial pilot rejected") { NativeAudioCore.inspectPilot(FloatArray(95999), pilot) }
    rejected("native audio inspected oversized pilot rejected") { NativeAudioCore.inspectPilot(FloatArray(96001), pilot) }
    rejected("native audio inspected nonfinite pilot rejected") { NativeAudioCore.inspectPilot(pilotPcm.clone().apply { this[0] = Float.NaN }, pilot) }
    rejected("native audio inspected out-of-range pilot rejected") { NativeAudioCore.inspectPilot(pilotPcm.clone().apply { this[0] = 1.01f }, pilot) }
    rejected("native audio inspected malformed nonce rejected") { NativeAudioCore.inspectPilot(pilotPcm, pilot.replace(field(pilot, "nonce"), "bad")) }

    val rounds = (0..1).map { index ->
        """{"session_id":"$session","index":$index,"nonce":"${if (index == 0) "04".repeat(32) else "05".repeat(32)}"}"""
    }
    val samples = FloatArray(192000)
    val receipts = rounds.mapIndexed { index, round ->
        val prior = rounds.take(index).joinToString(",", "[", "]")
        check(NativeAudioCore.validateRound(request, round, prior, now + 1000 + index * 2000).contains("\"index\":$index"))
        NativeAudioCore.probe(round).copyInto(samples, index * 96000 + 4800)
        val encoded = NativeAudioCore.encodeChunk(samples.copyOfRange(index * 96000, (index + 1) * 96000))
        val pcmBytes = Base64.getDecoder().decode(field(encoded, "pcm_base64"))
        val hash = MessageDigest.getInstance("SHA-256").digest(pcmBytes).joinToString("") { "%02x".format(it) }
        check(pcmBytes.size == 192000 && hash == field(encoded, "pcm_sha256") && encoded.contains("\"sample_count\":96000"))
        """{"index":$index,"nonce":"${field(round, "nonce")}","issued_elapsed_ms":${index * 2010},"received_elapsed_ms":${index * 2010 + 2000},"pcm_sha256":"$hash","start_sample":${index * 96000},"sample_count":96000}"""
    }
    passed("native audio sequential challenges and canonical chunk hashes cross JNI")
    rejected("native audio out-of-order challenge rejected") { NativeAudioCore.validateRound(request, rounds[1], "[]", now) }
    rejected("native audio repeated nonce rejected") {
        NativeAudioCore.validateRound(request, rounds[1].replace("05".repeat(32), "04".repeat(32)), "[${rounds[0]}]", now)
    }
    rejected("native audio nonfinite PCM rejected") { NativeAudioCore.encodeChunk(FloatArray(96000) { Float.NaN }) }
    rejected("native audio incomplete chunk rejected") { NativeAudioCore.encodeChunk(FloatArray(95999)) }
    val transcript = """{"version":1,"session_id":"$session","started_at":1800000001,"completed_at":1800000005,"total_samples":192000,"rounds":[${receipts.joinToString(",") }]}"""
    val receipt = """{"version":1,"type":"nonverba-audio-receipt","request":$request,"transcript":$transcript}"""
    val roundsJson = rounds.joinToString(",", "[", "]")
    val retainedTranscript = NativeAudioCore.validateReceipt(request, roundsJson, receipt, now + 6000)
    check(retainedTranscript.contains(session))
    passed("native audio final receipt preserves exact request and played challenges")
    rejected("native audio receipt role substitution rejected") {
        NativeAudioCore.validateReceipt(request, roundsJson, receipt.replace("nonverba-audio-receipt", "nonverba-audio-demo-receipt"), now + 6000)
    }
    rejected("native audio receipt nonce substitution rejected") {
        NativeAudioCore.validateReceipt(request, roundsJson, receipt.replace("04".repeat(32), "06".repeat(32)), now + 6000)
    }

    fun stream(kind: String, id: Int) = """{"device_id":$id,"device_type":"$kind","sample_rate":48000,"channels":1,"format":"pcm-f32","sharing_mode":"shared","performance_mode":"low-latency","frames_per_burst":192,"buffer_capacity_frames":1536}"""
    val playback = rounds.mapIndexed { index, round ->
        """{"index":$index,"nonce":"${field(round, "nonce")}","received_monotonic_ns":"${2_000_000_000L + index * 2_010_000_000L}","requested_at_frame":${index * 96480},"output_start_stream_frame":"${52800 + index * 96000}","output_end_stream_frame":"${89664 + index * 96000}","output_first_callback_monotonic_ns":"${2_100_000_000L + index * 2_000_000_000L}","input_frame_at_output_start":${4800 + index * 96000}}"""
    }.joinToString(",")
    val metadata = """{"version":1,"type":"nonverba-native-audio-capture","backend":"android-aaudio","session_id":"synthetic-jni-audio","request_session_id":"$session","request_received_unix_ms":$now,"request_received_monotonic_ns":"1000000000","record_requested_monotonic_ns":"2000000000","completed_unix_ms":${now + 5004},"clock":"monotonic","sample_rate":48000,"channels":1,"format":"pcm-f32","input_preset":"unprocessed","record_start_stream_frame":"48000","first_input_callback_monotonic_ns":"2004000000","last_input_callback_monotonic_ns":"6004000000","captured_frames":192000,"input":${stream("built-in-mic", 1)},"output":${stream("built-in-speaker", 2)},"input_xruns":0,"output_xruns":0,"xrun_reporting_completeness":"unknown","recording_configuration":{"version":1,"api_level":29,"input_session_id":42,"client_silenced":false,"client_source":"unprocessed","source":"unprocessed","device_id":1,"client_format":{"sample_rate":48000,"channels":1,"encoding":"pcm-f32"},"device_format":{"sample_rate":48000,"channels":1,"encoding":"pcm-i16"},"client_effects":[],"effects":[],"observation_count":6,"first_observed_monotonic_ns":"1500000000","last_observed_monotonic_ns":"6010000000","observation_monotonic_ns":["1500000000","2500000000","3500000000","4500000000","5500000000","6010000000"],"privacy_sensitive_supported":false,"privacy_sensitive_requested":false,"privacy_sensitive_actual":null},"checkpoints":[{"observed_monotonic_ns":"2510000000","input_frame_position":"72000","input_timestamp_ns":"2500000000","output_frame_position":"72000","output_timestamp_ns":"2500000000","captured_frames":24000,"input_xruns":0,"output_xruns":0},{"observed_monotonic_ns":"3510000000","input_frame_position":"120000","input_timestamp_ns":"3500000000","output_frame_position":"120000","output_timestamp_ns":"3500000000","captured_frames":72000,"input_xruns":0,"output_xruns":0},{"observed_monotonic_ns":"4510000000","input_frame_position":"168000","input_timestamp_ns":"4500000000","output_frame_position":"168000","output_timestamp_ns":"4500000000","captured_frames":120000,"input_xruns":0,"output_xruns":0},{"observed_monotonic_ns":"5510000000","input_frame_position":"216000","input_timestamp_ns":"5500000000","output_frame_position":"216000","output_timestamp_ns":"5500000000","captured_frames":168000,"input_xruns":0,"output_xruns":0}],"rounds":[$playback],"keystore_security_level":"software","strongbox_requested":false,"strongbox_fallback":false}"""
    val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    val cert = NativeCameraCore.createCertificate(pair.public.encoded)
    val pin = field(NativeCameraCore.identity(cert, pair.public.encoded), "fingerprint")
    var signCalls = 0
    val signer = NativeMediaEvidenceSigner { input ->
        signCalls++
        Signature.getInstance("SHA256withECDSA").run { initSign(pair.private); update(input); sign() }
    }
    fun seal(pcm: FloatArray = samples, capture: String = metadata, at: Long = now + 6000, capability: NativeMediaEvidenceSigner = signer, retained: String = retainedTranscript) =
        NativeAudioCore.seal(pcm, request, retained, capture, pair.public.encoded, cert, at, capability)
    val result = seal()
    val signed = Base64.getDecoder().decode(field(result, "wav_base64"))
    check(signed.size > 384000 && signed.copyOfRange(0, 4).toString(Charsets.US_ASCII) == "RIFF" && signCalls > 0)
    check(result.contains("native-aaudio-pcm") && result.contains("\"hardware_attested\":false") && result.contains("\"sensor_origin_proven\":false"))
    passed("native audio C2PA WAV seals through real DER signature callback")
    roundAssessment(result, true)
    passed("native audio success retains bounded canonical round checks outside the WAV")
    val before = signCalls
    rejected("native audio changed PCM rejected before signing") { seal(pcm = samples.clone().apply { this[0] = 0.5f }) }
    rejected("native audio silenced client rejected before signing") { seal(capture = metadata.replace("\"client_silenced\":false", "\"client_silenced\":true")) }
    rejected("native audio preprocessing rejected before signing") { seal(capture = metadata.replace("\"effects\":[]", "\"effects\":[\"automatic-gain-control\"]")) }
    rejected("native audio missing observation edge rejected before signing") { seal(capture = metadata.replace("\"last_observed_monotonic_ns\":\"6010000000\"", "\"last_observed_monotonic_ns\":\"6003999999\"")) }
    rejected("native audio observation count mismatch rejected before signing") { seal(capture = metadata.replace("\"observation_count\":6", "\"observation_count\":2")) }
    rejected("native audio hidden observation gap rejected before signing") { seal(capture = metadata.replace("\"observation_monotonic_ns\":[\"1500000000\",\"2500000000\"", "\"observation_monotonic_ns\":[\"1500000000\",\"2500000001\"")) }
    rejected("native audio xrun rejected before signing") { seal(capture = metadata.replace("\"output_xruns\":0", "\"output_xruns\":1")) }
    rejected("native audio invalid hardware frame clock rejected before signing") { seal(capture = metadata.replace("\"input_timestamp_ns\":\"5500000000\"", "\"input_timestamp_ns\":\"4500000000\"")) }
    rejected("native audio substituted route rejected before signing") { seal(capture = metadata.replace("built-in-mic", "bluetooth")) }
    rejected("native audio late finalization rejected before signing") { seal(at = now + 35005) }
    check(signCalls == before)
    for ((reason, markerOffset) in listOf("not_detected" to null, "detected_late" to 48000)) {
        val changed = samples.clone().apply { fill(0.0f, 96000, size) }
        if (markerOffset != null) NativeAudioCore.probe(rounds[1]).copyInto(changed, 96000 + markerOffset)
        val encoded = NativeAudioCore.encodeChunk(changed.copyOfRange(96000, 192000))
        val changedTranscript = retainedTranscript.replace(field(receipts[1], "pcm_sha256"), field(encoded, "pcm_sha256"))
        val refusal = seal(pcm = changed, retained = changedTranscript)
        check(refusal.contains("\"ok\":false") && !refusal.contains("wav_base64"))
        check(field(refusal, "error") == "Fresh audio challenge was not detected within every round's allowed window")
        val frozen = roundAssessment(refusal, false)
        check(frozen.contains("\"reason\":\"$reason\""))
        check(signCalls == before)
        changed.fill(0.0f)
        check(roundAssessment(refusal, false) == frozen)
        passed("native audio $reason refusal preserves unsigned round metrics without signing")
    }
    val malformed = seal(capability = NativeMediaEvidenceSigner { ByteArray(8) })
    check(malformed.contains("\"ok\":false") && !malformed.contains("wav_base64"))
    check(field(malformed, "error").isNotEmpty())
    roundAssessment(malformed, true)
    passed("native audio malformed signing response refuses the WAV while preserving completed round checks")
    val cancelled = seal(capability = NativeMediaEvidenceSigner { error("cancelled audio session") })
    check(cancelled.contains("\"ok\":false") && cancelled.contains("Native audio signing capability failed") && !cancelled.contains("wav_base64"))
    roundAssessment(cancelled, true)
    passed("native audio callback exception becomes a refusal with completed round checks")
    val recovered = seal()
    check(recovered.contains("wav_base64"))
    roundAssessment(recovered, true)
    passed("audio JNI remains usable after a signing callback exception")
    File(output, "native-audio-synthetic.wav").writeBytes(signed)
    File(output, "native-audio-synthetic-request.json").writeText(request)
    File(output, "native-audio-synthetic-transcript.json").writeText(retainedTranscript)
    File(output, "native-audio-synthetic-key.txt").writeText(pin)
    return checks
}

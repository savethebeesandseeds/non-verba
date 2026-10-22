// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Production observation policy, with deterministic Android-style event sequences. */
fun main() {
    var passed = 0
    val format = NativeAudioRecordingGuard.Format(48000, 1, "pcm-f32")
    val hardware = NativeAudioRecordingGuard.Format(48000, 2, "pcm-i16")
    val clean = NativeAudioRecordingGuard.Configuration(71, 4, true, false, 9, 9, format, hardware, emptyList(), emptyList())
    fun guard() = NativeAudioRecordingGuard(71, 4)
    fun rejects(label: String, body: () -> Unit) {
        check(runCatching(body).isFailure) { "$label unexpectedly passed" }; passed++
    }
    val observed = guard()
    check(!observed.observe(listOf(clean.copy(sessionId = 72, silenced = true)), 100)); passed++
    check(observed.observe(listOf(clean), 200)); passed++
    observed.observe(listOf(clean), 500)
    observed.finish(250, 450)
    check(observed.count == 2 && observed.firstNs == 200L && observed.lastNs == 500L); passed++
    check(observed.observationNs == listOf(200L, 500L)); passed++
    // Explicit stream stop is expected after finish; it must not invent another
    // clean observation or turn an earlier bad event back into a clean state.
    check(!observed.observe(emptyList(), 600) && observed.count == 2); passed++
    check(observed.observationNs == listOf(200L, 500L)); passed++
    observed.requireHealthy()
    val invalid = listOf(
        "Client silenced" to clean.copy(silenced = true),
        "Route changed" to clean.copy(deviceId = 5),
        "Not built-in microphone" to clean.copy(builtIn = false),
        "Client source changed" to clean.copy(clientSource = 6),
        "Actual source changed" to clean.copy(source = 6),
        "Client preprocessing" to clean.copy(clientEffects = listOf("11111111-1111-1111-1111-111111111111")),
        "Shared-path preprocessing" to clean.copy(effects = listOf("22222222-2222-2222-2222-222222222222")),
        "Wrong client format" to clean.copy(clientFormat = hardware),
        "Unavailable hardware format" to clean.copy(deviceFormat = hardware.copy(sampleRate = 0)),
        "Unsupported hardware encoding" to clean.copy(deviceFormat = hardware.copy(encoding = "unsupported"))
    )
    for ((label, value) in invalid) rejects(label) { guard().observe(listOf(value), 200) }
    val rejectedFormat = guard()
    val frameworkPcm16 = clean.copy(clientFormat = format.copy(encoding = "pcm-i16"))
    val formatFailure = runCatching { rejectedFormat.observe(listOf(frameworkPcm16), 200) }.exceptionOrNull()
    check(formatFailure?.message?.contains("48000 Hz / 1 channels / pcm-i16") == true); passed++
    check(rejectedFormat.diagnosticConfiguration == frameworkPcm16 && rejectedFormat.baseline == null && rejectedFormat.count == 0); passed++
    rejects("Fresh clean config cannot erase the refused format diagnostic") { rejectedFormat.observe(listOf(clean), 300) }
    check(rejectedFormat.diagnosticConfiguration == frameworkPcm16); passed++
    for (changed in listOf(format.copy(sampleRate = 44100), format.copy(channels = 2), format.copy(encoding = "unsupported"))) {
        val failed = guard()
        val message = runCatching { failed.observe(listOf(clean.copy(clientFormat = changed)), 100) }.exceptionOrNull()?.message
        check(message?.contains("${changed.sampleRate} Hz / ${changed.channels} channels / ${changed.encoding}") == true); passed++
        check(failed.diagnosticConfiguration?.clientFormat == changed && failed.count == 0); passed++
    }
    val sticky = guard()
    sticky.observe(listOf(clean), 100)
    rejects("Bad callback between otherwise clean polls") { sticky.observe(listOf(clean.copy(silenced = true)), 200) }
    rejects("Unsilencing cannot erase failed observation") { sticky.observe(listOf(clean), 300) }
    rejects("Cannot sign after failed observation") { sticky.requireHealthy() }
    rejects("Duplicate matching session") { guard().observe(listOf(clean, clean), 100) }
    rejects("Missing established recording") { guard().apply { observe(listOf(clean), 100); observe(emptyList(), 200) } }
    rejects("Hardware format change") { guard().apply { observe(listOf(clean), 100); observe(listOf(clean.copy(deviceFormat = hardware.copy(channels = 1))), 200) } }
    rejects("Callback/poll clock regression") { guard().apply { observe(listOf(clean), 100); observe(listOf(clean), 99) } }
    rejects("Observation interruption") { guard().apply { observe(listOf(clean), 100); observe(listOf(clean), 1_000_000_101) } }
    val simultaneous = guard()
    simultaneous.observe(listOf(clean), 100)
    simultaneous.observe(listOf(clean), 100)
    simultaneous.observe(listOf(clean), 1_000_000_100)
    simultaneous.finish(100, 1_000_000_100)
    check(simultaneous.observationNs == listOf(100L, 100L, 1_000_000_100L)); passed++
    val bounded = guard()
    repeat(10_000) { bounded.observe(listOf(clean), 100L + it) }
    check(bounded.observationNs.size == 10_000); passed++
    rejects("Observation array limit") { bounded.observe(listOf(clean), 10_101) }
    rejects("No actual observations") { guard().finish(100, 200) }
    rejects("One observation cannot cover recording") { guard().apply { observe(listOf(clean), 100); finish(100, 100) } }
    rejects("Late observation start") { guard().apply { observe(listOf(clean), 100); observe(listOf(clean), 300); finish(99, 200) } }
    rejects("Incomplete observation end") { guard().apply { observe(listOf(clean), 100); observe(listOf(clean), 300); finish(100, 301) } }
    rejects("Queued silencing event remains fatal after input stops") { observed.observe(listOf(clean.copy(silenced = true)), 700) }
    println("Native microphone recording guard: $passed checks passed")
}

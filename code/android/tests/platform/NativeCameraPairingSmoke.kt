// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.io.File
import java.nio.file.Files

/** Real bounded local-file reads; no Android device, WebView or sensor execution. */
fun main(args: Array<String>) {
    check(args.size == 1)
    val fixtures = File(args[0]).apply { check(mkdir()) }
    val token = "0123456789abcdef0123456789abcdef"
    var passed = 0
    fun expect(value: Boolean) { check(value); passed++ }
    fun directory() = Files.createTempDirectory(fixtures.toPath(), "case-").toFile()
    fun staged(cache: File, bytes: ByteArray): File {
        val folder = File(cache, "camera-pairing").apply { check(mkdir()) }
        return File(folder, "$token.json").apply { writeBytes(bytes) }
    }
    fun reader(cache: File, debug: Boolean = true) = NativeCameraPairing(cache, debug).apply { setForeground(true) }
    fun rejected(bridge: NativeCameraPairing, value: String = token) {
        expect(bridge.readOffer(value) == null)
        expect(bridge.lastError() == "The staged camera offer could not be read. Keep Non-verba open and check the USB pairing token.")
    }

    val exact = "{\r\n  \"type\":\"nonverba-camera-offer\",\"task\":\"árvíztűrő 🌍\",\"sdp\":\"v=0\\r\\n\"\r\n}\r\n"
    val cache = directory()
    val source = staged(cache, exact.toByteArray(Charsets.UTF_8))
    val original = source.readBytes()
    val bridge = NativeCameraPairing(cache, true)
    rejected(bridge) // No read before the Activity grants foreground camera access.
    bridge.setForeground(true)
    expect(bridge.readOffer(token) == exact)
    expect(bridge.lastError() == null)
    expect(source.readBytes().contentEquals(original))
    expect(bridge.readOffer(token) == exact) // Reading does not consume or rewrite a staged offer.
    bridge.setForeground(false)
    rejected(bridge)
    bridge.setForeground(true)
    expect(bridge.readOffer(token) == exact)
    bridge.destroy()
    bridge.setForeground(true)
    rejected(bridge) // A destroyed Activity cannot reopen access.
    rejected(reader(cache, false)) // Defense in depth beyond debug-only registration.

    val valid = reader(cache)
    for (invalid in listOf("", token.dropLast(1), token + "0", token.uppercase(), "../$token", "$token.json",
        "$token\n", "$token/", "0".repeat(31) + "g", "0".repeat(31) + "é")) {
        rejected(valid, invalid)
    }
    expect(valid.readOffer(token) == exact && valid.lastError() == null)
    rejected(valid, "f".repeat(32)) // Missing file.
    rejected(reader(directory())) // Missing inbox is not created by a read.

    val empty = directory()
    staged(empty, byteArrayOf())
    rejected(reader(empty))
    val tooLarge = directory()
    staged(tooLarge, ByteArray(120_001) { 0x61 })
    rejected(reader(tooLarge))
    val boundary = directory()
    val boundaryText = "é".repeat(60_000)
    staged(boundary, boundaryText.toByteArray(Charsets.UTF_8))
    expect(reader(boundary).readOffer(token) == boundaryText) // Bound bytes, not Kotlin characters.
    val malformed = directory()
    staged(malformed, byteArrayOf(0xc3.toByte(), 0x28))
    rejected(reader(malformed))

    val external = File(fixtures, "unrelated.txt").apply { writeText("unrelated file must remain unread") }
    val fileLink = directory()
    File(fileLink, "camera-pairing").mkdir()
    Files.createSymbolicLink(File(fileLink, "camera-pairing/$token.json").toPath(), external.toPath())
    rejected(reader(fileLink))
    val folderLink = directory()
    Files.createSymbolicLink(File(folderLink, "camera-pairing").toPath(), File(cache, "camera-pairing").toPath())
    rejected(reader(folderLink))
    val cacheLink = File(directory(), "linked-cache")
    Files.createSymbolicLink(cacheLink.toPath(), cache.toPath())
    rejected(reader(cacheLink))
    val nonFile = directory()
    File(nonFile, "camera-pairing/$token.json").mkdirs()
    rejected(reader(nonFile))
    val nonFolder = directory()
    File(nonFolder, "camera-pairing").writeText("not a directory")
    rejected(reader(nonFolder))
    expect(source.readBytes().contentEquals(original))
    expect(external.readText() == "unrelated file must remain unread")
    println("NativeCameraPairing: $passed bounded file, encoding and lifecycle checks passed; no device or sensor tested.")
}

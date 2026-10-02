// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.webkit.JavascriptInterface
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.OpenOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.BasicFileAttributes

/** Debug-only public pairing file read. No sensor, network, signing or protocol authority. */
internal class NativeCameraPairing(private val cacheDirectory: File, private val debugBuild: Boolean) {
    private class Access(val foreground: Boolean, val destroyed: Boolean = false)
    // Activity lifecycle/document checks run on main. JavaBridge reads only this
    // immutable snapshot and never calls WebView methods from its worker thread.
    @Volatile private var access = Access(false)
    @Volatile private var error: String? = null

    fun setForeground(value: Boolean) {
        if (!access.destroyed) access = Access(value)
    }

    fun destroy() { access = Access(false, true) }

    @JavascriptInterface
    fun lastError(): String? = error

    @JavascriptInterface
    @Synchronized
    fun readOffer(token: String): String? {
        error = null
        val initial = access
        return try {
            check(debugBuild && initial.foreground && !initial.destroyed)
            require(TOKEN.matches(token))
            val folder = File(cacheDirectory, "camera-pairing")
            val file = File(folder, "$token.json")
            checkDirectory(cacheDirectory)
            checkDirectory(folder)
            check(file.absoluteFile == file.canonicalFile && file.parentFile == folder)
            val before = attributes(file)
            check(before.isRegularFile && !before.isSymbolicLink && before.size() in 1..MAX_BYTES.toLong())
            val bytes = ByteBuffer.allocate(MAX_BYTES + 1)
            Files.newByteChannel(file.toPath(), setOf<OpenOption>(StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)).use { channel ->
                check(channel.size() == before.size())
                while (bytes.hasRemaining()) {
                    val count = channel.read(bytes)
                    if (count < 0) break
                    check(count > 0)
                }
                check(bytes.position().toLong() == before.size() && channel.size() == before.size())
            }
            checkDirectory(cacheDirectory)
            checkDirectory(folder)
            check(file.absoluteFile == file.canonicalFile)
            val after = attributes(file)
            check(after.isRegularFile && !after.isSymbolicLink && after.size() == before.size() &&
                after.fileKey() == before.fileKey() && after.lastModifiedTime() == before.lastModifiedTime())
            bytes.flip()
            val text = Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(bytes).toString()
            check(access === initial && initial.foreground && !initial.destroyed)
            // Exact text is passed to the existing JS pairing parser. No pin,
            // offer schema or freshness verdict is inferred from this file.
            text
        } catch (_: Exception) {
            error = "The staged camera offer could not be read. Keep Non-verba open and check the USB pairing token."
            null
        }
    }

    private fun attributes(file: File): BasicFileAttributes =
        Files.readAttributes(file.toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)

    private fun checkDirectory(directory: File) {
        val state = attributes(directory)
        check(state.isDirectory && !state.isSymbolicLink && directory.absoluteFile == directory.canonicalFile)
    }

    private companion object {
        const val MAX_BYTES = 120_000
        val TOKEN = Regex("[a-f0-9]{32}")
    }
}

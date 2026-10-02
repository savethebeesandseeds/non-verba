// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.util.AtomicFile
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID

/** OS file export only. Signed artifact bytes are never transformed here. */
internal class NativeArtifactExports(context: Context) {
    private val app = context.applicationContext

    fun save(name: String, mime: String, bytes: ByteArray): String {
        // Retain the exact public export for bounded USB retrieval. A random
        // folder and atomic write preserve older exports and hide partial files.
        val staged = newFile(File(app.cacheDir, "exports"), name)
        writeAtomic(staged, bytes)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveDownload(name, mime, bytes)
        } else {
            // No broad storage permission or picker on API 26-28. These files
            // survive app restarts, but Android removes them on uninstall.
            val documents = checkNotNull(app.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS))
            val target = newFile(File(documents, "Non-verba"), name)
            writeAtomic(target, bytes)
            "App documents/Non-verba/${target.parentFile!!.name}/$name"
        }
    }

    private fun newFile(parent: File, name: String): File {
        check(parent.isDirectory || parent.mkdirs()) { "Export directory is unavailable" }
        val folder = File(parent, UUID.randomUUID().toString())
        check(folder.mkdir()) { "Export destination already exists" }
        return File(folder, name)
    }

    private fun writeAtomic(file: File, bytes: ByteArray) {
        val atomic = AtomicFile(file)
        val stream = atomic.startWrite()
        try {
            stream.write(bytes)
            atomic.finishWrite(stream)
        } catch (failure: Exception) {
            atomic.failWrite(stream)
            throw failure
        }
        file.inputStream().use { verifyCopy(it, bytes) }
    }

    @android.annotation.TargetApi(Build.VERSION_CODES.Q)
    private fun saveDownload(name: String, mime: String, bytes: ByteArray): String {
        val resolver = app.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Non-verba")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        // MediaStore creates a distinct row/file; an existing filename is never
        // opened for writing. Publish only a complete byte-for-byte checked copy.
        val uri = checkNotNull(resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
        try {
            val descriptor = checkNotNull(resolver.openFileDescriptor(uri, "w"))
            ParcelFileDescriptor.AutoCloseOutputStream(descriptor).use {
                it.write(bytes)
                it.flush()
                it.fd.sync()
            }
            checkNotNull(resolver.openInputStream(uri)).use { verifyCopy(it, bytes) }
            check(resolver.update(uri, ContentValues().apply {
                put(MediaStore.Downloads.IS_PENDING, 0)
            }, null, null) == 1) { "Download could not be published" }
            // The provider may suffix duplicate names; report the truthful folder.
            return "${Environment.DIRECTORY_DOWNLOADS}/Non-verba"
        } catch (failure: Exception) {
            // Roll back only the row this invocation created, never prior data.
            try { resolver.delete(uri, null, null) } catch (cleanup: Exception) { failure.addSuppressed(cleanup) }
            throw failure
        }
    }

    private fun verifyCopy(input: InputStream, expected: ByteArray) {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(16 * 1024)
        var count = 0L
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            count += read
            check(count <= expected.size) { "Export length changed" }
            digest.update(buffer, 0, read)
        }
        check(count == expected.size.toLong() && MessageDigest.isEqual(
            digest.digest(), MessageDigest.getInstance("SHA-256").digest(expected)
        )) { "Export bytes changed" }
    }
}

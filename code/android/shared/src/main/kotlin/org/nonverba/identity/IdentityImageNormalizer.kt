// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.identity

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import java.io.ByteArrayOutputStream
import java.util.Collections
import java.util.IdentityHashMap
import kotlin.math.max
import kotlin.math.roundToInt

internal object IdentityImageNormalizer {
    data class Image(val bytes: ByteArray, val width: Int, val height: Int)
    fun normalize(jpeg: ByteArray, kind: String, active: () -> Boolean): Image {
        check(active()); require(jpeg.size in 4..(32 * 1024 * 1024))
        val edge = when (kind) { "document_front" -> 2400; "face_front" -> 1280; else -> error("Invalid identity kind") }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, bounds)
        require(bounds.outMimeType == "image/jpeg" && bounds.outWidth in 256..8192 && bounds.outHeight in 256..8192 &&
            bounds.outWidth.toLong() * bounds.outHeight <= 12_000_000)
        val orientation = IdentityJpegPolicy.orientation(jpeg)
        val owned = Collections.newSetFromMap(IdentityHashMap<Bitmap, Boolean>())
        try {
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= edge) sample *= 2
            val decoded = requireNotNull(BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, BitmapFactory.Options().apply {
                inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888
            })); owned.add(decoded); check(active())
            val transform = Matrix().apply { when (orientation) {
                2 -> setScale(-1f, 1f); 3 -> setRotate(180f); 4 -> setScale(1f, -1f)
                5 -> { setRotate(90f); postScale(-1f, 1f) }; 6 -> setRotate(90f)
                7 -> { setRotate(270f); postScale(-1f, 1f) }; 8 -> setRotate(270f)
            } }
            val image = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, transform, true); owned.add(image)
            for (limit in listOf(edge, if (kind == "document_front") 1600 else 960).distinct()) {
                check(active())
                val scale = minOf(1.0, limit.toDouble() / max(image.width, image.height))
                val target = Bitmap.createScaledBitmap(image, max(1, (image.width * scale).roundToInt()), max(1, (image.height * scale).roundToInt()), true)
                owned.add(target)
                for (quality in listOf(90, 82, 74)) {
                    check(active()); val output = ByteArrayOutputStream()
                    check(target.compress(Bitmap.CompressFormat.JPEG, quality, output)); check(active())
                    if (output.size() <= 2 * 1024 * 1024) return Image(IdentityJpegPolicy.sanitize(output.toByteArray()), target.width, target.height)
                }
            }
            error("Identity image cannot fit the transport limit")
        } finally { owned.forEach { it.recycle() } }
    }
}

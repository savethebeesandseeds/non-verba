// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.identity

import java.io.ByteArrayOutputStream

/** Strip every APP/COM segment, including late segments, without changing JPEG pixels. */
internal object IdentityJpegPolicy {
    fun sanitize(bytes: ByteArray): ByteArray {
        require(bytes.size in 4..(2 * 1024 * 1024) && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte())
        val out = ByteArrayOutputStream(bytes.size); out.write(bytes, 0, 2)
        var offset = 2; var scanned = false
        while (offset < bytes.size) {
            val start = offset
            require(bytes[offset++].toInt() and 255 == 255)
            while (offset < bytes.size && bytes[offset].toInt() and 255 == 255) offset++
            require(offset < bytes.size)
            val marker = bytes[offset++].toInt() and 255
            if (marker == 0xd9) { require(scanned && offset == bytes.size); out.write(bytes, start, offset - start); return out.toByteArray() }
            require(marker !in listOf(0, 1, 0xd8) && marker !in 0xd0..0xd7 && offset + 2 <= bytes.size)
            val length = (bytes[offset].toInt() and 255) * 256 + (bytes[offset + 1].toInt() and 255)
            require(length >= 2 && offset + length <= bytes.size)
            val end = offset + length
            if (marker !in 0xe0..0xef && marker != 0xfe) out.write(bytes, start, end - start)
            offset = end
            if (marker == 0xda) {
                scanned = true
                val entropy = offset
                while (offset < bytes.size) {
                    if (bytes[offset++].toInt() and 255 != 255) continue
                    val markerStart = offset - 1
                    while (offset < bytes.size && bytes[offset].toInt() and 255 == 255) offset++
                    require(offset < bytes.size)
                    val next = bytes[offset++].toInt() and 255
                    if (next == 0 || next in 0xd0..0xd7) continue
                    offset = markerStart; break
                }
                require(offset < bytes.size); out.write(bytes, entropy, offset - entropy)
            }
        }
        error("Incomplete identity JPEG")
    }

    /** Bounded TIFF orientation only; every other metadata field is discarded. */
    fun orientation(bytes: ByteArray): Int {
        require(bytes.size >= 4 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte())
        var offset = 2
        while (offset + 4 <= bytes.size && offset < 1024 * 1024) {
            require(bytes[offset++].toInt() and 255 == 255)
            while (offset < bytes.size && bytes[offset].toInt() and 255 == 255) offset++
            require(offset < bytes.size)
            val marker = bytes[offset++].toInt() and 255
            if (marker == 0xda || marker == 0xd9) return 1
            require(offset + 2 <= bytes.size)
            val length = (bytes[offset].toInt() and 255) * 256 + (bytes[offset + 1].toInt() and 255)
            val end = offset + length; require(length >= 2 && end <= bytes.size)
            if (marker == 0xe1 && length >= 16 && bytes.copyOfRange(offset + 2, offset + 8).contentEquals(byteArrayOf(69,120,105,102,0,0))) {
                val base = offset + 8
                val little = bytes[base] == 73.toByte() && bytes[base + 1] == 73.toByte()
                require(little || bytes[base] == 77.toByte() && bytes[base + 1] == 77.toByte())
                fun number(at: Int, count: Int): Long {
                    require(at >= base && at + count <= end)
                    var result = 0L
                    for (i in 0 until count) result = result or ((bytes[at + i].toLong() and 255) shl (8 * if (little) i else count - 1 - i))
                    return result
                }
                require(number(base + 2, 2) == 42L)
                val delta = number(base + 4, 4); require(delta in 8..(end - base - 2).toLong())
                val directory = base + delta.toInt(); val count = number(directory, 2).toInt()
                require(count <= 256 && directory + 2 + count * 12 <= end)
                for (i in 0 until count) {
                    val at = directory + 2 + i * 12
                    if (number(at, 2) == 0x112L) {
                        require(number(at + 2, 2) == 3L && number(at + 4, 4) == 1L)
                        return number(at + 8, 2).toInt().also { require(it in 1..8) }
                    }
                }
            }
            offset = end
        }
        error("Identity JPEG header exceeds its inspection bound")
    }
}

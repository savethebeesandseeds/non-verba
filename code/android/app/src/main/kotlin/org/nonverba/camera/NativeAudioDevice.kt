// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Internal AAudio ownership boundary. None of these methods is a WebView interface. */
internal object NativeAudioDevice {
    init { System.loadLibrary("nonverba_audio") }
    external fun open(inputDeviceId: Int, outputDeviceId: Int, inputSessionId: Int): Long
    external fun snapshot(handle: Long): String
    external fun record(handle: Long, totalFrames: Int)
    external fun play(handle: Long, index: Int, generatedProbe: FloatArray)
    external fun copyFrames(handle: Long, firstFrame: Int, frameCount: Int): FloatArray
    external fun close(handle: Long)
}

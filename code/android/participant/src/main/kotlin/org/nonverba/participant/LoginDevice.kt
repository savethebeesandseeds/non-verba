// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.participant

import android.app.Activity
import android.webkit.WebView
import org.nonverba.attestation.DeviceAttestationBridge

/** Participant app wiring; native mechanism and bridge remain shared with the developer tool. */
internal class LoginDevice(activity: Activity, webView: WebView, documentUrl: String, foregroundDocument: () -> Boolean) {
    private val bridge = DeviceAttestationBridge(activity, webView, documentUrl, foregroundDocument)
    fun start() = bridge.start()
    fun resume() = bridge.resume()
    fun documentChanged() = bridge.documentChanged()
    fun pause() = bridge.pause()
    fun stop() = bridge.stop()
    fun close() = bridge.close()
}

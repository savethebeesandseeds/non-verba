// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import org.json.JSONObject

/** Native-only session policy. Neither captured bytes nor the signing callback are a JS capability. */
internal data class NativeCameraIdentity(val fingerprint: String, val profile: String, val spki: ByteArray,
    val securityLevel: String, val strongBoxRequested: Boolean, val strongBoxFallback: Boolean)

internal data class NativeCameraProfile(
    val request: JSONObject,
    val nonce: String,
    val identity: NativeCameraIdentity,
    val requiredLens: String? = null,
    val requiresLocation: Boolean = true,
    val retainCompleted: Boolean = true,
    val active: () -> Boolean = { true },
    val requireWindow: (Long) -> Unit,
    val validateLocation: (String, Long) -> String,
    val seal: (ByteArray, String?, JSONObject, Long, () -> Boolean) -> JSONObject
)

internal data class NativeCameraLabels(val title: String, val opening: String, val shutter: String,
    val cancel: String, val locationPending: String, val ready: String, val capturing: String)

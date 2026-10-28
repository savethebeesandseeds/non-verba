// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.app.Activity
import android.content.pm.PackageManager
import android.Manifest
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONObject

/** Existing developer photo protocol; acquisition is shared with the identity camera. */
internal class NativeCamera(private val activity: Activity, isForeground: () -> Boolean,
    requestCameraPermission: ((Boolean) -> Unit) -> Unit) {
    private val engine = NativeCameraEngine(activity, isForeground, requestCameraPermission,
        NativeCameraLabels(activity.getString(R.string.camera_title), activity.getString(R.string.camera_opening),
            activity.getString(R.string.camera_shutter), activity.getString(R.string.camera_cancel),
            activity.getString(R.string.camera_location_pending), activity.getString(R.string.camera_ready),
            activity.getString(R.string.camera_capturing)), "native-camera-capture-ledger-v1.json") { challenge, location, active ->
        val request = JSONObject(NativeCameraCore.validateRequest(challenge, location, System.currentTimeMillis()))
        val key = NativeAttestedKeyStore.mediaKey(activity)
        val identity = key.publicIdentity()
        check(active()) { "Camera setup authority was revoked" }
        val bound = request.getJSONObject("challenge")
        NativeCameraProfile(request, bound.getString("id"), NativeCameraIdentity(identity.fingerprint, key.profile,
            identity.spki, identity.securityLevel, identity.strongBoxRequested, identity.strongBoxFallback), active = active,
            requireWindow = { now -> NativeSessionGuards.requireRequestWindow(now, bound.getLong("issued_at"), bound.getLong("expires_at")) },
            validateLocation = { supplied, now -> NativeCameraCore.validateLocation(request.toString(), supplied, now) },
            seal = { jpeg, suppliedLocation, metadata, now, authority ->
                val signer = NativeMediaEvidenceSigner(key, authority)
                JSONObject(NativeCameraCore.seal(jpeg, request.toString(), requireNotNull(suppliedLocation), metadata.toString(),
                    identity.spki, identity.certificatePem, now, signer))
            })
    }
    @JavascriptInterface fun capabilities(): String = try {
        val key = NativeAttestedKeyStore.mediaKey(activity)
        val identity = key.publicIdentity()
        JSONObject().put("available", true).put("version", 1).put("platform", "android-camera2")
            .put("key_fingerprint", identity.fingerprint).put("key_profile", key.profile)
            .put("public_key_spki_b64", Base64.encodeToString(identity.spki, Base64.NO_WRAP))
            .put("keystore_security_level", identity.securityLevel)
            .put("strongbox_requested", identity.strongBoxRequested).put("strongbox_fallback", identity.strongBoxFallback)
            .put("camera_permission", activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
            .put("hardware_attested", false).put("collection_attested", false).put("camera_freshness_proven", false).toString()
    } catch (error: Throwable) { JSONObject().put("ok", false).put("state", "error").put("error", (error.message ?: "Native camera unavailable").take(400)).toString() }
    @JavascriptInterface fun begin(challengeJson: String, locationRequestJson: String) = engine.begin(challengeJson, locationRequestJson)
    @JavascriptInterface fun status(sessionId: String) = engine.status(sessionId)
    @JavascriptInterface fun capture(sessionId: String, locationJson: String) = engine.capture(sessionId, locationJson)
    @JavascriptInterface fun cancel(sessionId: String) = engine.cancel(sessionId)
    fun revokeAuthority() = engine.revokeAuthority()
    fun pause() = engine.pause()
    fun destroy() = engine.destroy()
}

// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.annotation.SuppressLint
import android.location.LocationManager
import android.os.Handler
import android.os.SystemClock
import androidx.core.location.GnssStatusCompat
import androidx.core.location.LocationManagerCompat
import org.json.JSONObject

/** Optional status observation alongside an existing GPS request; never substitutes for raw GNSS. */
internal class NativeGnssStatusCollector(
    private val manager: LocationManager,
    private val handler: Handler,
    private val anchorNs: Long,
    private val diagnostics: NativeGnssStatusDiagnostics,
    private val canObserve: () -> Boolean
) {
    private var callback: GnssStatusCompat.Callback? = null

    @SuppressLint("MissingPermission") // Owning native session checks precise foreground permission.
    fun start() {
        if (!canObserve() || !diagnostics.registrationAttempt()) return
        val listener = object : GnssStatusCompat.Callback() {
            override fun onSatelliteStatusChanged(status: GnssStatusCompat) {
                if (!canObserve() || !diagnostics.callback((SystemClock.elapsedRealtimeNanos() - anchorNs) / 1_000_000)) return
                try {
                    val count = status.satelliteCount
                    if (count !in 0..NativeGnssStatusDiagnostics.MAX_SATELLITES) {
                        diagnostics.unreadableCallback()
                        return
                    }
                    val satellites = List(count) { index -> NativeGnssStatusDiagnostics.Satellite(
                        status.getConstellationType(index), status.usedInFix(index), status.getCn0DbHz(index).toDouble()) }
                    diagnostics.observe(satellites)
                } catch (_: Throwable) { diagnostics.unreadableCallback() }
            }
        }
        callback = listener
        try {
            val registered = LocationManagerCompat.registerGnssStatusCallback(manager, listener, handler)
            diagnostics.registrationResult(registered)
            if (!registered) stop()
        } catch (_: Throwable) {
            diagnostics.registrationException()
            stop()
        }
    }

    /** Main-thread, idempotent cleanup on every terminal/frozen path; optional diagnostics cannot fail a proof. */
    fun stop() {
        diagnostics.stop()
        val listener = callback
        callback = null
        if (listener != null) {
            try { LocationManagerCompat.unregisterGnssStatusCallback(manager, listener) }
            catch (_: Throwable) { diagnostics.cleanupFailure() }
        }
    }

    companion object {
        fun snapshot(diagnostics: NativeGnssStatusDiagnostics): JSONObject {
            val value = diagnostics.snapshot()
            val observation = value.observation
            val constellations = JSONObject()
            observation?.constellationCounts?.forEach { (name, count) -> constellations.put(name, count) }
            return JSONObject().put("unsigned", true).put("registration", value.registration.label)
                .put("registration_api", if (value.registration == NativeGnssStatusDiagnostics.Registration.NOT_ATTEMPTED) JSONObject.NULL else "androidx-compat-handler")
                .put("active", value.active).put("callback_count", value.callbackCount)
                .put("last_callback_elapsed_ms", value.lastCallbackElapsedMs ?: JSONObject.NULL)
                .put("unreadable_callbacks", value.unreadableCallbacks).put("cleanup_failed", value.cleanupFailed)
                .put("satellite_count", observation?.satelliteCount ?: JSONObject.NULL)
                .put("used_in_fix_count", observation?.usedInFixCount ?: JSONObject.NULL)
                .put("cn0_sample_count", observation?.cn0SampleCount ?: JSONObject.NULL)
                .put("invalid_cn0_count", observation?.invalidCn0Count ?: JSONObject.NULL)
                .put("cn0_min_dbhz", observation?.cn0MinDbHz ?: JSONObject.NULL)
                .put("cn0_mean_dbhz", observation?.cn0MeanDbHz ?: JSONObject.NULL)
                .put("cn0_max_dbhz", observation?.cn0MaxDbHz ?: JSONObject.NULL)
                .put("constellation_counts", constellations)
        }
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.annotation.SuppressLint
import android.location.GnssMeasurement
import android.location.GnssMeasurementRequest
import android.location.GnssMeasurementsEvent
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.SystemClock
import androidx.annotation.RequiresApi
import androidx.core.location.LocationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executor

/**
 * Copies Android receiver measurements into a session-owned record. Admission, timing,
 * satellite quality and continuity policy remain in Rust. This is never a WebView bridge.
 * Missing clock fields during receiver warmup are counted; after collection starts they
 * terminate the session instead of hiding an interruption in an otherwise continuous trace.
 */
internal class RawGnssCollector(
    private val manager: LocationManager,
    private val handler: Handler,
    private val anchorNs: Long,
    private val diagnostics: NativeLocationDiagnostics.Raw,
    private val onEpoch: (JSONObject) -> Boolean,
    private val onWarmupRejected: () -> Unit,
    private val onFailure: (String, Int?) -> Unit
) {
    private var callback: GnssMeasurementsEvent.Callback? = null
    private var active = false
    private var acceptedEpoch = false
    private var lastConsideredNs: Long? = null

    val fullTrackingRequested: Boolean get() = Build.VERSION.SDK_INT >= 31

    @SuppressLint("MissingPermission") // Session checks precise foreground permission immediately before this call.
    fun start() {
        check(Build.VERSION.SDK_INT >= 29) { "Raw GNSS evidence requires Android 10 or later and receiver elapsed timestamps" }
        check(callback == null && !active) { "Raw GNSS collection is already registered" }
        val listener = object : GnssMeasurementsEvent.Callback() {
            override fun onGnssMeasurementsReceived(event: GnssMeasurementsEvent) {
                if (!active) return
                val callbackNs = SystemClock.elapsedRealtimeNanos()
                diagnostics.callback((callbackNs - anchorNs) / 1_000_000)
                try {
                    if (Build.VERSION.SDK_INT >= 29) collect(event, callbackNs)
                    else onFailure("Raw GNSS evidence requires Android 10 or later", null)
                } catch (error: Throwable) {
                    onFailure((error.message ?: "Native raw GNSS collection failed").take(400), null)
                }
            }

            @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
            @Deprecated("Legacy Android callback")
            override fun onStatusChanged(status: Int) {
                if (!active) return
                diagnostics.status(when (status) {
                    STATUS_NOT_SUPPORTED -> NativeLocationDiagnostics.RawStatus.NOT_SUPPORTED
                    STATUS_LOCATION_DISABLED -> NativeLocationDiagnostics.RawStatus.LOCATION_DISABLED
                    STATUS_NOT_ALLOWED -> NativeLocationDiagnostics.RawStatus.NOT_ALLOWED
                    STATUS_READY -> NativeLocationDiagnostics.RawStatus.READY
                    else -> NativeLocationDiagnostics.RawStatus.UNKNOWN
                }, status)
                NativeLocationDiagnostics.rawStatusFailure(status)?.let { onFailure(it, status) }
            }
        }
        callback = listener
        active = true
        diagnostics.osReport(
            if (Build.VERSION.SDK_INT >= 31) runCatching { manager.gnssCapabilities.hasMeasurements() }.getOrNull() else null,
            if (Build.VERSION.SDK_INT >= 28) runCatching { manager.gnssYearOfHardware }.getOrNull() else null,
            if (Build.VERSION.SDK_INT >= 28) runCatching { manager.gnssHardwareModelName }.getOrNull() else null)
        diagnostics.registrationAttempt(if (Build.VERSION.SDK_INT >= 31) NativeLocationDiagnostics.RawBranch.FULL_TRACKING
            else NativeLocationDiagnostics.RawBranch.COMPAT_HANDLER)
        val registered = try {
            if (Build.VERSION.SDK_INT >= 31) {
                val request = GnssMeasurementRequest.Builder().setFullTracking(true).apply {
                    if (Build.VERSION.SDK_INT >= 33) setIntervalMillis(COLLECTION_INTERVAL_MS)
                }.build()
                manager.registerGnssMeasurementsCallback(request, Executor { handler.post(it) }, listener)
            } else {
                // The compatibility implementation avoids the Android R pre-QPR1 callback crash.
                LocationManagerCompat.registerGnssMeasurementsCallback(manager, listener, handler)
            }
        } catch (error: Throwable) {
            diagnostics.registrationException()
            stop()
            throw error
        }
        diagnostics.registrationResult(registered)
        if (!registered) {
            stop()
            error("The receiver refused raw GNSS measurement registration")
        }
    }

    /** Invoked on the main thread on every session terminal path, including ready/frozen. */
    fun stop() {
        active = false
        val listener = callback
        callback = null
        if (listener != null) LocationManagerCompat.unregisterGnssMeasurementsCallback(manager, listener)
    }

    @RequiresApi(29)
    private fun collect(event: GnssMeasurementsEvent, callbackNs: Long) {
        val clock = event.clock
        if (!clock.hasElapsedRealtimeNanos() || !clock.hasElapsedRealtimeUncertaintyNanos() ||
            !clock.hasFullBiasNanos()) {
            check(!acceptedEpoch) { "Receiver clock fields disappeared during raw GNSS collection" }
            if (!clock.hasElapsedRealtimeNanos()) diagnostics.warmup(NativeLocationDiagnostics.RawWarmup.MISSING_ELAPSED)
            if (!clock.hasElapsedRealtimeUncertaintyNanos()) diagnostics.warmup(NativeLocationDiagnostics.RawWarmup.MISSING_UNCERTAINTY)
            if (!clock.hasFullBiasNanos()) diagnostics.warmup(NativeLocationDiagnostics.RawWarmup.MISSING_FULL_BIAS)
            onWarmupRejected()
            return
        }
        val measurementNs = clock.elapsedRealtimeNanos
        // Retain a fixed target cadence, independent of signal quality. Version 1 permits
        // 50 ms scheduling jitter so a nominal 1 Hz receiver does not lose alternate epochs.
        // Rust checks actual span/gaps; callbacks never manufacture or interpolate data.
        val previousNs = lastConsideredNs
        if (measurementNs >= anchorNs && previousNs != null && measurementNs > previousNs &&
            measurementNs - previousNs < (COLLECTION_INTERVAL_MS - CADENCE_TOLERANCE_MS) * 1_000_000L) {
            diagnostics.skippedCadence()
            return
        }
        lastConsideredNs = measurementNs
        check(event.measurements.size <= MAX_MEASUREMENTS) { "Raw GNSS epoch exceeds the satellite signal limit" }
        if (event.measurements.isEmpty()) {
            check(!acceptedEpoch) { "Raw GNSS satellite measurements disappeared during collection" }
            diagnostics.warmup(NativeLocationDiagnostics.RawWarmup.EMPTY_SIGNALS)
            onWarmupRejected()
            return
        }
        val measurements = JSONArray()
        for (measurement in event.measurements) measurements.put(copyMeasurement(measurement))
        val clockRecord = JSONObject()
            .put("time_ns", clock.timeNanos.toString())
            .put("full_bias_ns", clock.fullBiasNanos.toString())
            .put("bias_ns", if (clock.hasBiasNanos()) clock.biasNanos else JSONObject.NULL)
            .put("bias_uncertainty_ns", if (clock.hasBiasUncertaintyNanos()) clock.biasUncertaintyNanos else JSONObject.NULL)
            .put("time_uncertainty_ns", if (clock.hasTimeUncertaintyNanos()) clock.timeUncertaintyNanos else JSONObject.NULL)
            .put("drift_ns_per_second", if (clock.hasDriftNanosPerSecond()) clock.driftNanosPerSecond else JSONObject.NULL)
            .put("drift_uncertainty_ns_per_second", if (clock.hasDriftUncertaintyNanosPerSecond()) clock.driftUncertaintyNanosPerSecond else JSONObject.NULL)
            .put("hardware_clock_discontinuity_count", clock.hardwareClockDiscontinuityCount)
            .put("elapsed_realtime_ns", measurementNs.toString())
            .put("elapsed_realtime_uncertainty_ns", clock.elapsedRealtimeUncertaintyNanos)
        val epoch = JSONObject()
            .put("observed_elapsed_ms", (callbackNs - anchorNs) / 1_000_000)
            .put("clock", clockRecord)
            .put("measurements", measurements)
        if (onEpoch(epoch)) acceptedEpoch = true
    }

    @Suppress("DEPRECATION")
    @RequiresApi(29)
    private fun copyMeasurement(measurement: GnssMeasurement): JSONObject = JSONObject()
        .put("constellation", measurement.constellationType)
        .put("svid", measurement.svid)
        .put("state", measurement.state)
        .put("received_sv_time_ns", measurement.receivedSvTimeNanos.toString())
        .put("received_sv_time_uncertainty_ns", measurement.receivedSvTimeUncertaintyNanos.toString())
        .put("time_offset_ns", measurement.timeOffsetNanos)
        .put("cn0_dbhz", measurement.cn0DbHz)
        .put("pseudorange_rate_mps", measurement.pseudorangeRateMetersPerSecond)
        .put("pseudorange_rate_uncertainty_mps", measurement.pseudorangeRateUncertaintyMetersPerSecond)
        .put("carrier_frequency_hz", if (measurement.hasCarrierFrequencyHz()) measurement.carrierFrequencyHz.toDouble() else JSONObject.NULL)
        .put("code_type", if (measurement.hasCodeType()) requireNotNull(measurement.codeType) {
            "Receiver code type presence flag had no value"
        } else JSONObject.NULL)
        .put("accumulated_delta_range_state", measurement.accumulatedDeltaRangeState)
        .put("accumulated_delta_range_m", if (measurement.accumulatedDeltaRangeState != GnssMeasurement.ADR_STATE_UNKNOWN) measurement.accumulatedDeltaRangeMeters else JSONObject.NULL)
        .put("accumulated_delta_range_uncertainty_m", if (measurement.accumulatedDeltaRangeState != GnssMeasurement.ADR_STATE_UNKNOWN) measurement.accumulatedDeltaRangeUncertaintyMeters else JSONObject.NULL)
        .put("automatic_gain_control_db", if (measurement.hasAutomaticGainControlLevelDb()) measurement.automaticGainControlLevelDb else JSONObject.NULL)

    companion object {
        const val COLLECTION_INTERVAL_MS = 1000
        const val CADENCE_TOLERANCE_MS = 50
        const val MAX_MEASUREMENTS = 128
        const val MAX_EPOCHS = 64
        const val MAX_REJECTED_EPOCHS = 4096
        const val MAX_TRACE_BYTES = 2 * 1024 * 1024
    }
}

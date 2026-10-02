// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/** Enrollment only; this bridge cannot submit payloads for signing or replace existing keys. */
internal class NativeKeyEnrollment(private val activity: Activity, private val isForeground: () -> Boolean) {
    private val lock = Any()
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var current: Session? = null
    private var generation = 0L
    private var closed = false
    @Volatile private var foreground = false

    private class Session(val id: String, val purpose: String, val challenge: String, val generation: Long) {
        val anchorNs = SystemClock.elapsedRealtimeNanos()
        var state = "preparing"
        var error: String? = null
        var result: JSONObject? = null
    }

    @JavascriptInterface
    fun capabilities(): String = try {
        val purposes = JSONObject()
        for (purpose in listOf("media", "location")) {
            val legacy = if (purpose == "media") NativeMediaCaptureKey(activity).publicIdentity().fingerprint
                else NativeLocationCore.fingerprint(LocationCaptureKey(activity).publicSpki())
            purposes.put(purpose, NativeAttestedKeyStore.summary(activity, purpose).put("legacy_fingerprint", legacy))
        }
        JSONObject().put("ok", true).put("available", true).put("version", 1).put("purposes", purposes)
            .put("hardware_attested", false).toString()
    } catch (error: Throwable) { failure(error) }

    @JavascriptInterface
    fun begin(purpose: String, challengeBase64: String): String = try {
        NativeAttestedKeyStore.purpose(purpose)
        NativeAttestedKeyStore.challenge(challengeBase64)
        val session = synchronized(lock) {
            check(!closed && current?.state != "preparing") { "Enrollment is closed or already running" }
            Session(UUID.randomUUID().toString(), purpose, challengeBase64, generation).also { current = it }
        }
        main.post {
            synchronized(lock) {
                if (closed || current !== session || session.state != "preparing" || generation != session.generation) return@post
                foreground = isForeground()
                if (!foreground) { session.state = "error"; session.error = "Enrollment requires the foreground key enrollment page"; return@post }
            }
            main.postDelayed({ synchronized(lock) {
                if (current === session && session.state == "preparing") {
                    session.state = "error"
                    session.error = "Enrollment exceeded its 60-second foreground lifetime; any generated key was preserved"
                }
            } }, 60_000)
            worker.execute {
                try {
                    val result = NativeAttestedKeyStore.enroll(activity, purpose, challengeBase64) { active(session) }
                    synchronized(lock) {
                        check(active(session)) { "Enrollment was cancelled" }
                        session.result = result
                        session.state = "ready"
                    }
                } catch (error: Throwable) { synchronized(lock) {
                    if (current === session && session.state == "preparing") { session.state = "error"; session.error = safeError(error) }
                } }
            }
        }
        synchronized(lock) { snapshot(session).toString() }
    } catch (error: Throwable) { failure(error) }

    @JavascriptInterface
    fun status(enrollmentId: String): String = synchronized(lock) {
        current?.takeIf { it.id == enrollmentId }?.let { snapshot(it).toString() }
            ?: failureMessage("Unknown key enrollment session")
    }

    @JavascriptInterface
    fun exportEnrollment(purpose: String): String = try { NativeAttestedKeyStore.export(activity, purpose).toString() }
        catch (error: Throwable) { failure(error) }

    @JavascriptInterface
    fun exportEnrollmentForKey(purpose: String, fingerprint: String): String = try {
        NativeAttestedKeyStore.export(activity, purpose, fingerprint).toString()
    } catch (error: Throwable) { failure(error) }

    @JavascriptInterface
    fun selectProfile(purpose: String, profile: String, expectedFingerprint: String): String = try {
        // JavascriptInterface runs on a WebView worker. Sample the document only on main;
        // subsequent work uses this revocable ticket, never WebView APIs off main.
        val ticket = FutureTask {
            synchronized(lock) {
                check(!closed && isForeground()) { "Key selection requires the foreground key enrollment page" }
                foreground = true
                Pair(generation, SystemClock.elapsedRealtimeNanos())
            }
        }
        main.post(ticket)
        val (selectedGeneration, anchorNs) = ticket.get(5, TimeUnit.SECONDS)
        NativeAttestedKeyStore.select(activity, purpose, profile, expectedFingerprint) {
            synchronized(lock) {
                foreground && !closed && generation == selectedGeneration && withinLifetime(anchorNs)
            }
        }.toString()
    } catch (error: Throwable) { failure(error) }

    @JavascriptInterface
    fun cancel(enrollmentId: String): String = synchronized(lock) {
        val session = current?.takeIf { it.id == enrollmentId } ?: return@synchronized failureMessage("Unknown key enrollment session")
        if (session.state == "preparing") { session.state = "cancelled"; session.error = "Enrollment cancelled; any generated key was preserved" }
        snapshot(session).toString()
    }

    fun pause() {
        foreground = false
        synchronized(lock) {
            generation++
            current?.takeIf { it.state == "preparing" }?.let {
                it.state = "cancelled"; it.error = "The application left the foreground; any generated key was preserved"
            }
        }
    }

    fun destroy() {
        pause()
        synchronized(lock) { closed = true }
        worker.shutdown()
    }

    private fun active(session: Session): Boolean = synchronized(lock) {
        foreground && !closed && current === session && generation == session.generation && session.state == "preparing" && withinLifetime(session.anchorNs)
    }
    private fun withinLifetime(anchorNs: Long): Boolean {
        val now = SystemClock.elapsedRealtimeNanos()
        return now >= anchorNs && now - anchorNs <= 60_000_000_000L
    }
    private fun snapshot(session: Session) = JSONObject().put("ok", session.error == null)
        .put("session_id", session.id).put("purpose", session.purpose).put("state", session.state)
        .apply { session.error?.let { put("error", it) }; session.result?.let { put("result", it) } }
    private fun safeError(error: Throwable) = (error.message ?: "Native key enrollment failed").take(300)
    private fun failure(error: Throwable) = failureMessage(safeError(error))
    private fun failureMessage(message: String) = JSONObject().put("ok", false).put("error", message).toString()
}

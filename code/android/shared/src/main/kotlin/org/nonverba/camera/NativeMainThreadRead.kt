// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/** Bounded read-only framework lookup; a timed-out queued read cannot run later. */
internal object NativeMainThreadRead {
    fun <T> read(isMainThread: () -> Boolean, post: (() -> Unit) -> Boolean,
        timeoutMs: Long = 2_000, value: () -> T): T {
        require(timeoutMs in 1..2_000) { "Invalid main-thread read deadline" }
        if (isMainThread()) return value()
        val pending = FutureTask { value() }
        try {
            check(post { pending.run() }) { "Main-thread read could not be scheduled" }
            return pending.get(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (error: ExecutionException) {
            throw (error.cause ?: error)
        } finally {
            if (!pending.isDone) pending.cancel(false)
        }
    }
}

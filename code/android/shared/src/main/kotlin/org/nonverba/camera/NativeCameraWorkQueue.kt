// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** At most one finalizer and one retained pending JPEG, even if a platform call stalls. */
internal object NativeCameraWorkQueue {
    fun create() = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(1), ThreadPoolExecutor.AbortPolicy())
}

// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** A required lens never falls back to a different physical camera facing. */
internal object NativeCameraLensPolicy {
    fun allows(required: String?, actual: String): Boolean {
        require(required == null || required in setOf("back", "front"))
        return required == null || required == actual
    }
}

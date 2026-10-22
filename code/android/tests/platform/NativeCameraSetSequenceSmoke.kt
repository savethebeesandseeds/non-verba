// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

fun main() {
    var checks=0
    fun verify(value:Boolean) {check(value);checks++}
    for(count in listOf(2,4)) {
        val sequence=NativeCameraSetSequence(count)
        verify(sequence.advanceIfReleased(0,true,true)==null)
        for(index in 0 until count) {
            verify(sequence.index==index)
            sequence.memberAcquired(index)
            verify(sequence.advanceIfReleased(index,true,false)==null)
            verify(sequence.advanceIfReleased(index,false,true)==null)
            verify(sequence.advanceIfReleased(index+1,true,true)==null)
            verify(sequence.advanceIfReleased(index,true,true)==(index+1).takeIf {it<count})
            verify(sequence.advanceIfReleased(index,true,true)==null)
        }
    }
    val revoked=NativeCameraSetSequence(2)
    revoked.memberAcquired(0);revoked.cancel()
    verify(revoked.advanceIfReleased(0,true,true)==null)
    verify(runCatching {revoked.memberAcquired(0)}.isFailure)
    val invalid=NativeCameraSetSequence(2)
    verify(runCatching {invalid.memberAcquired(1)}.isFailure)
    invalid.memberAcquired(0)
    verify(runCatching {invalid.memberAcquired(0)}.isFailure)
    for(count in listOf(0,1,5))verify(runCatching {NativeCameraSetSequence(count)}.isFailure)
    println("$checks camera-set sequential handoff checks passed; no Android cameras exercised")
}

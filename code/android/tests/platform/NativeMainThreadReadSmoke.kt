// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger

fun main() {
    var checks = 0
    fun pass(value: Boolean) { check(value); checks++ }
    val caller = Thread.currentThread()
    pass(NativeMainThreadRead.read({true},{error("Must not post from main")}) {Thread.currentThread()===caller})
    val executor = Executors.newSingleThreadExecutor()
    try {
        val thread = NativeMainThreadRead.read({false},{action->executor.execute(action);true}) {Thread.currentThread()}
        pass(thread!==caller)
        pass(NativeMainThreadRead.read({false},{action->executor.execute(action);true}) {false} == false)
        val problem = IllegalStateException("read failed")
        try { NativeMainThreadRead.read({false},{action->executor.execute(action);true}) {throw problem};error("Accepted failed read") }
        catch (e:IllegalStateException) {pass(e===problem)}
    } finally {executor.shutdown();check(executor.awaitTermination(2,TimeUnit.SECONDS))}
    val calls=AtomicInteger()
    var queued:(()->Unit)?=null
    try {NativeMainThreadRead.read({false},{action->queued=action;true},10) {calls.incrementAndGet()};error("Accepted missing UI thread")}
    catch (_:TimeoutException) {pass(true)}
    requireNotNull(queued).invoke();pass(calls.get()==0)
    queued=null
    try {NativeMainThreadRead.read({false},{action->queued=action;false}) {calls.incrementAndGet()};error("Accepted refused post")}
    catch (_:IllegalStateException) {pass(true)}
    requireNotNull(queued).invoke();pass(calls.get()==0)
    for (deadline in listOf(0L,2_001L)) {
        try {NativeMainThreadRead.read({true},{false},deadline) {error("Invalid deadline ran")};error("Invalid deadline accepted")}
        catch (_:IllegalArgumentException) {pass(true)}
    }
    println("Native main-thread read: $checks checks passed (synthetic dispatcher; no WebView or phone).")
}

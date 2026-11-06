package id.my.tenun.embedder

import org.junit.Assert.*
import org.junit.Test

/**
 * Requester-bound scheduling semantics against the REAL OTA/hot-reload
 * ordering: candidates restore (and re-arm countdown timers) BEFORE
 * publication. Candidate wake-ups must survive the swap; the old engine's
 * pending wake-ups must die with it.
 */
class RequesterBoundSchedulerTest {
    private class Queue {
        val pending = ArrayList<() -> Unit>()
        val post: (action: () -> Unit, delayMs: Long) -> Unit = { action, _ -> pending.add(action) }
        fun fire() {
            val due = pending.toList()
            pending.clear()
            due.forEach { it() }
        }
    }

    @Test
    fun candidateTimerRequestedBeforePublicationSurvivesTheSwap() {
        val queue = Queue()
        val scheduler = RequesterBoundScheduler(queue.post)
        val old = Any()
        val candidate = Any()
        var live: Any = old // publication happens later
        var delivered: Any? = null
        val isLive: (Any) -> Boolean = { it === live }

        // OTA ordering: TENUN_RESTORE re-arms the countdown on the candidate
        // while the OLD engine is still the visible one.
        assertTrue(scheduler.schedule(candidate, 1000, isLive) { delivered = candidate })
        // The old engine still holds a pending wake-up of its own.
        assertTrue(scheduler.schedule(old, 1000, isLive) { delivered = old })

        live = candidate // publication: engine = candidate
        queue.fire()
        // The candidate's wake-up was delivered; the old engine's was dropped
        // (if both fired, the old engine's write would win or follow).
        assertEquals(candidate, delivered)
    }

    @Test
    fun requesterThatNeverBecomesLiveIsDropped() {
        val queue = Queue()
        val scheduler = RequesterBoundScheduler(queue.post)
        val engine = Any()
        var live: Any? = null // never published
        var fired = false
        assertTrue(scheduler.schedule(engine, 10, { it === live }) { fired = true })
        queue.fire()
        assertFalse(fired)
    }

    @Test
    fun requesterDisposedAfterSchedulingIsDropped() {
        val queue = Queue()
        val scheduler = RequesterBoundScheduler(queue.post)
        val engine = Any()
        var live: Any? = engine
        var disposed = false
        var fired = false
        assertTrue(scheduler.schedule(engine, 10, { it === live && !disposed }) { fired = true })
        disposed = true
        queue.fire()
        assertFalse(fired)
    }

    @Test
    fun nullRequesterIsRefusedWithoutScheduling() {
        val queue = Queue()
        val scheduler = RequesterBoundScheduler(queue.post)
        assertFalse(scheduler.schedule<Any>(null, 10, { true }) { })
        assertTrue(queue.pending.isEmpty())
    }

    // ---------------------------------------------------------------------
    // DeferredTimerRequests: construction-phase scheduleTimer calls (bundle
    // evaluation + bootstrap job drain finish before TenunEngine's
    // constructor returns). Refusing them dropped every bootstrap timeout.
    // ---------------------------------------------------------------------

    @Test
    fun deferredRequestsBufferInArrivalOrderAndDrainOnce() {
        val deferred = DeferredTimerRequests()
        assertTrue(deferred.offer("""{"delayMs":20}"""))
        assertTrue(deferred.offer("""{"delayMs":40}"""))
        assertEquals(listOf("""{"delayMs":20}""", """{"delayMs":40}"""), deferred.drain())
        assertTrue(deferred.drain().isEmpty())
        // Offers after a drain keep working (each engine construction owns a
        // fresh queue; the class itself must stay usable).
        assertTrue(deferred.offer("""{"delayMs":60}"""))
        assertEquals(listOf("""{"delayMs":60}"""), deferred.drain())
    }

    @Test
    fun malformedDeferredPayloadIsRefusedLikeTheBoundPath() {
        val deferred = DeferredTimerRequests()
        assertFalse(deferred.offer("not json"))
        assertFalse(deferred.offer("""{"delayMs":}"""))
        assertFalse(deferred.offer(""))
        assertTrue(deferred.drain().isEmpty())
    }
}

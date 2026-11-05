package id.my.tenun.embedder

/**
 * Requester-bound timer scheduling. A scheduled wake-up must belong to the
 * engine that REQUESTED it and fire only while that engine is still the
 * live one — OTA/hot-reload candidates restore state (re-arming countdown
 * timers) BEFORE they are published as the activity's engine, so neither
 * end may consult "the currently visible engine": at schedule time that is
 * the OLD engine, and after the swap the identity check must still pass
 * for the candidate (review fix for the frozen restored countdown).
 */
class RequesterBoundScheduler(
    private val postDelayed: (action: () -> Unit, delayMs: Long) -> Unit,
) {
    /**
     * Schedules [action] on behalf of [requesting]; the action runs only when
     * [isLive] still holds for the requester at delivery time. Returns false
     * (and schedules nothing) when the requester is null — e.g. a bundle
     * requesting a timer during its own top-level evaluation.
     */
    fun <E : Any> schedule(
        requesting: E?,
        delayMs: Long,
        isLive: (E) -> Boolean,
        action: () -> Unit,
    ): Boolean {
        if (requesting == null) return false
        val target = requesting
        postDelayed({ if (isLive(target)) action() }, delayMs)
        return true
    }
}

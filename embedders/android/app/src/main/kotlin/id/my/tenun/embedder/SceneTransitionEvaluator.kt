package id.my.tenun.embedder

/**
 * TN-169: the pure interpolation math for host-evaluated route
 * transitions. Identical to the browser host's shared curve
 * (transitionEasing, ease-in-out cubic) so the same progress produces the
 * same picture on every host. No Android dependencies — JVM-testable.
 */
object SceneTransitionEvaluator {

    /** Raw progress 0..1 for [elapsedMs] into a [durationMs] transition. */
    fun progress(elapsedMs: Long, durationMs: Long): Float =
        (elapsedMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f)

    /** Ease-in-out cubic: motion starts and ends at rest. */
    fun eased(progress: Float): Float {
        val p = progress.coerceIn(0f, 1f)
        return if (p < 0.5f) 4f * p * p * p else 1f - Math.pow((-2f * p + 2f).toDouble(), 3.0).toFloat() / 2f
    }

    /** One frame's parameters: x offsets (design units) and alphas for the
     *  outgoing and incoming scenes. */
    data class Frame(val fromDx: Float, val toDx: Float, val fromAlpha: Float, val toAlpha: Float)

    fun frame(transition: SceneTransition, rawProgress: Float, width: Float): Frame {
        val e = eased(rawProgress)
        return if (transition.kind == "slide") {
            val direction = if (transition.direction == "forward") 1f else -1f
            Frame(
                fromDx = -direction * e * width,
                toDx = direction * (1f - e) * width,
                fromAlpha = 1f,
                toAlpha = 1f
            )
        } else {
            Frame(fromDx = 0f, toDx = 0f, fromAlpha = 1f - e, toAlpha = e)
        }
    }
}

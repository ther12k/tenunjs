package id.my.tenun.embedder

/**
 * OTA trial-confirm criterion, extracted JVM-testable (the Activity and
 * SurfaceView cannot be instantiated on the JVM — same reason
 * SceneHolder exists). The Activity feeds real signals in; confirmation
 * scheduling reads [isHealthy].
 *
 * Evidence is scoped to the ENGINE SESSION (TN-134, review finding A1):
 * a trial may be confirmed only by a scene commit AND a successful
 * dispatch observed against the CURRENT engine itself. Before the fix,
 * the dispatch signal lived for the VIEW's lifetime — one tap on the
 * packaged app before an OTA apply satisfied the dispatch criterion for
 * every future trial, so a broken candidate could be confirmed after
 * the uptime delay with zero trial interactions. [onEngineSwapped]
 * clears both signals on every swap (OTA apply and hot reload alike):
 * new code must prove itself again.
 */
class TrialHealth {
    private var sceneCommittedForSession = false
    private var dispatchObservedForSession = false

    /** A different engine took over: all prior evidence belonged to it. */
    fun onEngineSwapped() {
        sceneCommittedForSession = false
        dispatchObservedForSession = false
    }

    /** The current engine committed its first scene. */
    fun onSceneCommitted() {
        sceneCommittedForSession = true
    }

    /** A dispatch succeeded against the current engine (surface hook). */
    fun onDispatchObserved() {
        dispatchObservedForSession = true
    }

    /** True only when the current session itself provided both signals. */
    fun isHealthy(): Boolean = sceneCommittedForSession && dispatchObservedForSession
}

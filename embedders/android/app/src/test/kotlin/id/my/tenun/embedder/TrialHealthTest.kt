package id.my.tenun.embedder

import org.junit.Assert.*
import org.junit.Test

/**
 * TN-134 (review finding A1): the OTA trial-confirm criterion is
 * session-scoped. The regression scenario is the review's exact one —
 * tap the packaged app once, then apply an OTA bundle: the pre-update
 * tap must NOT satisfy the dispatch criterion. Under the unfixed code
 * (view-lifetime dispatch flag, no reset on swap) the trial confirmed
 * after the uptime delay with zero trial interactions; these tests pin
 * both halves of that behavior to the extracted criterion.
 */
class TrialHealthTest {

    @Test
    fun a1Regression_preUpdateTapDoesNotConfirmATrial() {
        val health = TrialHealth()

        // Packaged engine boots and the user interacts with it once.
        health.onSceneCommitted()
        health.onDispatchObserved()
        assertTrue(health.isHealthy()) // evidence for THIS session is real

        // OTA candidate applied (engine swap) and commits its first scene.
        health.onEngineSwapped()
        health.onSceneCommitted()

        // The pre-update tap belonged to the OLD engine: the candidate has
        // scene evidence but NO dispatch evidence — not healthy. This is
        // the assertion that fails on the unfixed (view-lifetime) signal.
        assertFalse("a pre-update tap must not confirm the candidate's trial", health.isHealthy())

        // Only a dispatch observed against the candidate satisfies it.
        health.onDispatchObserved()
        assertTrue(health.isHealthy())
    }

    @Test
    fun swapClearsBothSignals() {
        val health = TrialHealth()
        health.onSceneCommitted()
        health.onDispatchObserved()
        assertTrue(health.isHealthy())

        health.onEngineSwapped()
        assertFalse("scene evidence is also session-scoped", health.isHealthy())

        // Dispatch alone is still insufficient; scene alone likewise.
        health.onDispatchObserved()
        assertFalse(health.isHealthy())
        health.onSceneCommitted()
        assertTrue(health.isHealthy())
    }

    @Test
    fun freshCriterionNeedsBothHalves() {
        val health = TrialHealth()
        assertFalse(health.isHealthy())
        health.onSceneCommitted()
        assertFalse(health.isHealthy())
        health.onDispatchObserved()
        assertTrue(health.isHealthy())
    }

    @Test
    fun repeatedSwapsNeverAccumulateStaleEvidence() {
        val health = TrialHealth()
        health.onDispatchObserved()
        for (i in 1..3) {
            health.onEngineSwapped()
            assertFalse("swap $i must clear dispatch evidence", health.isHealthy())
            health.onSceneCommitted() // candidate boots each time
            assertFalse("swap $i: still no dispatch against the candidate", health.isHealthy())
            health.onDispatchObserved()
            assertTrue(health.isHealthy())
        }
    }
}

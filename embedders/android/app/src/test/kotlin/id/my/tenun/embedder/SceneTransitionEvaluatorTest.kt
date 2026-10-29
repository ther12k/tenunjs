package id.my.tenun.embedder

import org.junit.Assert.*
import org.junit.Test

/**
 * TN-169: the shared interpolation math. The numbers mirror the browser
 * host's transitionEasing (ease-in-out cubic) so the same progress
 * produces the same picture on every host.
 */
class SceneTransitionEvaluatorTest {

    private val fade = SceneTransition("fade", 200, "forward")
    private val slideForward = SceneTransition("slide", 240, "forward")
    private val slideBackward = SceneTransition("slide", 240, "backward")

    @Test
    fun progressClampsToTheTransitionBounds() {
        assertEquals(0f, SceneTransitionEvaluator.progress(-50, 200))
        assertEquals(0.5f, SceneTransitionEvaluator.progress(100, 200))
        assertEquals(1f, SceneTransitionEvaluator.progress(999, 200))
    }

    @Test
    fun easingStartsAndEndsAtRestAndIsMonotonic() {
        assertEquals(0f, SceneTransitionEvaluator.eased(0f))
        assertEquals(1f, SceneTransitionEvaluator.eased(1f))
        assertEquals(0.5f, SceneTransitionEvaluator.eased(0.5f), 1e-6f)
        var previous = -1f
        for (i in 0..20) {
            val value = SceneTransitionEvaluator.eased(i / 20f)
            assertTrue(value >= previous)
            previous = value
        }
    }

    @Test
    fun slideForwardExitsLeftAndEntersFromTheRight() {
        val start = SceneTransitionEvaluator.frame(slideForward, 0f, width = 320f)
        assertEquals(0f, start.fromDx, 1e-6f)
        assertEquals(320f, start.toDx, 1e-6f)
        assertEquals(1f, start.fromAlpha)
        assertEquals(1f, start.toAlpha)
        val mid = SceneTransitionEvaluator.frame(slideForward, 0.5f, width = 320f)
        assertEquals(-160f, mid.fromDx, 1e-3f)
        assertEquals(160f, mid.toDx, 1e-3f)
        val end = SceneTransitionEvaluator.frame(slideForward, 1f, width = 320f)
        assertEquals(-320f, end.fromDx, 1e-6f)
        assertEquals(0f, end.toDx, 1e-6f)
    }

    @Test
    fun slideBackwardMirrorsTheDirection() {
        val start = SceneTransitionEvaluator.frame(slideBackward, 0f, width = 320f)
        assertEquals(0f, start.fromDx, 1e-6f)
        assertEquals(-320f, start.toDx, 1e-6f)
        val end = SceneTransitionEvaluator.frame(slideBackward, 1f, width = 320f)
        assertEquals(320f, end.fromDx, 1e-6f)
        assertEquals(0f, end.toDx, 1e-6f)
    }

    @Test
    fun fadeCrossFadesAlphaWithoutOffsets() {
        val start = SceneTransitionEvaluator.frame(fade, 0f, width = 320f)
        assertEquals(0f, start.fromDx)
        assertEquals(1f, start.fromAlpha, 1e-6f)
        assertEquals(0f, start.toAlpha, 1e-6f)
        val mid = SceneTransitionEvaluator.frame(fade, 0.5f, width = 320f)
        assertEquals(0.5f, mid.fromAlpha, 1e-6f)
        assertEquals(0.5f, mid.toAlpha, 1e-6f)
        val end = SceneTransitionEvaluator.frame(fade, 1f, width = 320f)
        assertEquals(0f, end.fromAlpha, 1e-6f)
        assertEquals(1f, end.toAlpha, 1e-6f)
    }

    @Test
    fun scenesParseTheOptionalTransitionBlockAndRejectMalformedOnes() {
        fun scene(transition: String?) = """{"tenun":"display-list","version":1,"designWidth":320,
            "contentHeight":480,"background":"#101014","ops":[],"taps":[]${transition?.let { ",\"transition\":$it" } ?: ""}}"""

        assertNull(DisplayListScene.parse(scene(null))!!.transition)
        val parsed = DisplayListScene.parse(scene("""{"kind":"slide","direction":"backward","durationMs":400}"""))!!
        assertEquals(SceneTransition("slide", 400, "backward"), parsed.transition)

        for (bad in listOf(
            """{"kind":"zoom","direction":"forward","durationMs":200}""",
            """{"kind":"fade","direction":"sideways","durationMs":200}""",
            """{"kind":"fade","direction":"forward","durationMs":-1}""",
            """{"kind":"fade","direction":"forward"}"""
        )) {
            try {
                DisplayListScene.parse(scene(bad))
                fail("malformed transition must reject: $bad")
            } catch (expected: SceneContractException) {
                assertTrue(expected.message!!.contains("transition"))
            }
        }
    }
}

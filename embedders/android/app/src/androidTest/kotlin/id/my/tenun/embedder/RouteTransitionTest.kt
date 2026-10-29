package id.my.tenun.embedder

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * TN-169 scheduling-separation evidence: route transition frames are
 * evaluated on the dedicated animation thread, so a BLOCKED MAIN THREAD
 * cannot freeze an in-flight transition (the JS-stall property from the
 * scrolling-and-animation architecture, exercised at the host boundary —
 * the scenes are already committed; only the animator runs).
 */
@RunWith(AndroidJUnit4::class)
class RouteTransitionTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun scene(label: String, transition: String? = null): String {
        val block = transition?.let { ",\"transition\":$it" } ?: ""
        return """{"tenun":"display-list","version":1,"designWidth":320,"contentHeight":480,
          "background":"#101014","ops":[{"op":"text","x":20,"y":60,"text":"$label",
          "size":30,"weight":700,"color":"#FFFFFF"}],"taps":[]$block}"""
    }

    @Test
    fun transitionFramesAdvanceWhileTheMainThreadIsBlockedAndThenSettle() {
        val view = TenunSurfaceView(instrumentation.targetContext)
        instrumentation.runOnMainSync {
            view.syncFromScene(scene("A-route"))
            assertNull(view.committedSceneForTest().first!!.transition)
        }
        val before = view.transitionFrameCountForTest
        instrumentation.runOnMainSync {
            view.syncFromScene(scene("B-route", """{"kind":"fade","direction":"forward","durationMs":400}"""))
        }
        assertTrue(view.transitionFrameCountForTest > before)
        // Block the main thread well past a few frame periods. The
        // animation thread must keep evaluating frames regardless.
        val atBlock = view.transitionFrameCountForTest
        instrumentation.runOnMainSync { Thread.sleep(250) }
        val afterBlock = view.transitionFrameCountForTest
        assertTrue(
            "frames advanced while main was blocked (before=$atBlock after=$afterBlock)",
            afterBlock > atBlock
        )
        // The transition settles on the committed scene.
        val deadline = System.currentTimeMillis() + 3_000
        while (System.currentTimeMillis() < deadline && view.isTransitionActiveForTest) {
            Thread.sleep(50)
        }
        assertFalse(view.isTransitionActiveForTest)
        assertEquals("B-route", labelOf(view))
    }

    @Test
    fun malformedTransitionBlocksAreContractViolations() {
        val view = TenunSurfaceView(instrumentation.targetContext)
        instrumentation.runOnMainSync {
            view.syncFromScene(scene("A-route"))
            for (bad in listOf(
                """{"kind":"zoom","direction":"forward","durationMs":200}""",
                """{"kind":"fade","direction":"sideways","durationMs":200}""",
                """{"kind":"fade","direction":"forward","durationMs":0}"""
            )) {
                try {
                    view.syncFromScene(scene("Bad", bad))
                    fail("malformed transition must reject the scene: $bad")
                } catch (expected: SceneContractException) {
                    assertTrue(expected.message!!.contains("transition"))
                }
            }
            // The previously settled scene stays authoritative.
            assertEquals("A-route", labelOf(view))
        }
    }

    private fun labelOf(view: TenunSurfaceView): String {
        val current = view.committedSceneForTest().first!!
        val text = current.ops.filterIsInstance<DisplayListScene.Op.TextOp>().first()
        return text.text.text
    }
}

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

    private fun labelOf(view: TenunSurfaceView): String {
        val current = view.committedSceneForTest().first!!
        val text = current.ops.filterIsInstance<DisplayListScene.Op.TextOp>().first()
        return text.text.text
    }

    @Test
    fun transitionFramesAdvanceWhileTheMainThreadIsBlockedAndThenSettle() {
        val view = TenunSurfaceView(instrumentation.targetContext)
        instrumentation.runOnMainSync {
            view.syncFromScene(scene("A-route"))
            assertNull(view.committedSceneForTest().first!!.transition)
        }
        instrumentation.runOnMainSync {
            view.syncFromScene(scene("B-route", """{"kind":"fade","direction":"forward","durationMs":600}"""))
        }
        // Wait until the animation thread is demonstrably running frames
        // (generous: a cold emulator may take a moment to start the thread).
        val runningDeadline = System.currentTimeMillis() + 3_000
        while (view.transitionFrameCountForTest < 3 && System.currentTimeMillis() < runningDeadline) {
            Thread.sleep(25)
        }
        assertTrue(
            "animation thread started evaluating frames (count=${view.transitionFrameCountForTest})",
            view.transitionFrameCountForTest >= 3
        )
        // Block the main thread well past several frame periods. The
        // animation thread must keep evaluating frames regardless.
        val atBlock = view.transitionFrameCountForTest
        instrumentation.runOnMainSync { Thread.sleep(300) }
        val afterBlock = view.transitionFrameCountForTest
        assertTrue(
            "frames advanced while main was blocked (before=$atBlock after=$afterBlock)",
            afterBlock > atBlock
        )
        // The transition settles on the committed scene.
        val settleDeadline = System.currentTimeMillis() + 3_000
        while (view.isTransitionActiveForTest && System.currentTimeMillis() < settleDeadline) {
            Thread.sleep(25)
        }
        assertFalse("transition settled", view.isTransitionActiveForTest)
        assertEquals("B-route", labelOf(view))
    }

    @Test
    fun transitionSnapshotsTheScrollOffsetItsLayersPaintUnder() {
        val view = TenunSurfaceView(instrumentation.targetContext)
        // Laid out (320x480) but NOT attached: the TN-183 extent rule makes
        // the scroll bounds real at commit time, so the production touch
        // clamp (scrollBy, via dragScrollForTest) can actually scroll.
        instrumentation.runOnMainSync {
            view.measure(
                android.view.View.MeasureSpec.makeMeasureSpec(320, android.view.View.MeasureSpec.EXACTLY),
                android.view.View.MeasureSpec.makeMeasureSpec(480, android.view.View.MeasureSpec.EXACTLY)
            )
            view.layout(0, 0, 320, 480)
            view.syncFromScene(scene("A-route").replace("\"contentHeight\":480", "\"contentHeight\":2000"))
        }
        // 2000 content in a 480-high viewport: scrollable to 1520. The
        // production clamp exposes the extent — a huge drag lands exactly
        // on the view's internal bound, proving it was computed at commit
        // time (TN-183), not left at zero until the first draw.
        instrumentation.runOnMainSync {
            view.dragScrollForTest(100_000f)
        }
        assertEquals("extent follows the commit, not the first draw", 1520f, view.committedSceneForTest().second)
        instrumentation.runOnMainSync {
            view.dragScrollForTest(-999_999f) // back to top…
            view.dragScrollForTest(400f) // …then to a mid-route position
        }
        assertEquals("finger scroll moved the view", 400f, view.committedSceneForTest().second)
        instrumentation.runOnMainSync {
            view.syncFromScene(scene("B-route", """{"kind":"fade","direction":"forward","durationMs":5000}"""))
        }
        // TN-183: the transition owns the offset the route was entered
        // from — its frames paint both layers under THIS scrollY (the
        // settled-renderer and browser-twin rule), never a snap to top.
        assertTrue("transition is in flight", view.isTransitionActiveForTest)
        assertEquals(
            "transition layers keep the entry scroll offset",
            400f,
            view.transitionScrollForTest
        )
        val settleDeadline = System.currentTimeMillis() + 8_000
        while (view.isTransitionActiveForTest && System.currentTimeMillis() < settleDeadline) {
            Thread.sleep(25)
        }
        assertFalse("transition settled", view.isTransitionActiveForTest)
    }

    @Test
    fun malformedTransitionBlocksAreRejectedAndTheSettledSceneStays() {
        val view = TenunSurfaceView(instrumentation.targetContext)
        instrumentation.runOnMainSync {
            view.syncFromScene(scene("A-route"))
            assertEquals("A-route", labelOf(view))
            for (bad in listOf(
                """{"kind":"zoom","direction":"forward","durationMs":200}""",
                """{"kind":"fade","direction":"sideways","durationMs":200}""",
                """{"kind":"fade","direction":"forward","durationMs":0}"""
            )) {
                // SceneHolder rejects a contract-violating candidate whole:
                // the settled scene stays authoritative — fail-visible,
                // never a partial render of the malformed route.
                view.syncFromScene(scene("Bad", bad))
                assertEquals("malformed transition kept the settled scene: $bad", "A-route", labelOf(view))
                assertNull(view.committedSceneForTest().first!!.transition)
            }
            assertFalse(view.isTransitionActiveForTest)
        }
    }
}

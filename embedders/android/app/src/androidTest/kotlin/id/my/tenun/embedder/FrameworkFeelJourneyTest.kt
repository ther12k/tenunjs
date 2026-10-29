package id.my.tenun.embedder

import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * TN-155 requirement 7, surface leg: the SAME compiled Day Plan bundle
 * the browser host and the QuickJS parity gate run, booted through the
 * production Android embedder and driven through REAL MotionEvents and
 * the InputConnection — taps, the host-evaluated route transition, the
 * runtime theme toggle, checklist scrolling, and title editing. Host
 * divergence is a bug, not a port.
 *
 * Everything touching the view runs on the MAIN thread (runOnMainSync is
 * not reentrant, so composite steps use the raw* helpers inside one
 * block) — the same discipline DisplayListTextInputTest follows.
 */
@RunWith(AndroidJUnit4::class)
class FrameworkFeelJourneyTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private val bundle: ByteArray by lazy {
        instrumentation.context.assets.open("framework_feel_app.js").use { it.readBytes() }
    }

    private lateinit var view: TenunSurfaceView
    private lateinit var engine: TenunEngine

    /** A tap region's center in VIEW pixels (the view is laid out at the
     *  app's design size, so pixels equal design units). */
    private fun tapCenter(label: String): Pair<Float, Float> {
        val scene = view.committedSceneForTest().first!!
        val text = scene.ops.filterIsInstance<DisplayListScene.Op.TextOp>()
            .firstOrNull { it.text.text == label }
            ?: throw AssertionError("missing label: $label")
        val tap = scene.taps.lastOrNull { region ->
            region.action == "tap" && text.text.x >= region.x && text.text.x <= region.x + region.w &&
                text.text.y >= region.y && text.text.y <= region.y + region.h
        } ?: throw AssertionError("missing tap for: $label")
        return (tap.x + tap.w / 2f) to (tap.y + tap.h / 2f)
    }

    private fun textOf(label: String): DisplayListScene.Op.TextOp =
        view.committedSceneForTest().first!!.ops.filterIsInstance<DisplayListScene.Op.TextOp>()
            .first { it.text.text == label }

    private fun sceneText(): String = view.committedSceneForTest().first.toString()

    private fun fieldDescriptor(): DisplayListScene.Op.TextInputOp? =
        view.committedSceneForTest().first!!.focusedEditableInput()

    /** Raw event delivery — MUST be called on the main thread. */
    private fun rawTouch(action: Int, x: Float, y: Float) {
        val now = System.currentTimeMillis()
        val event = MotionEvent.obtain(now, now, action, x, y, 0)
        try {
            view.dispatchTouchEvent(event)
        } finally {
            event.recycle()
        }
    }

    private fun rawTap(label: String) {
        val (x, y) = tapCenter(label)
        rawTouch(MotionEvent.ACTION_DOWN, x, y)
        rawTouch(MotionEvent.ACTION_UP, x, y)
    }

    private fun tap(label: String) {
        instrumentation.runOnMainSync { rawTap(label) }
    }

    private fun waitForSettle(timeoutMs: Long = 3000) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline && view.isTransitionActiveForTest) {
            Thread.sleep(25)
        }
        assertFalse("route transition settled", view.isTransitionActiveForTest)
    }

    @Test
    fun sameCodeJourneyThroughTheProductionAndroidSurface() {
        instrumentation.runOnMainSync {
            engine = TenunEngine(bundle)
            view = TenunSurfaceView(instrumentation.targetContext)
            // Lay the view out at the app's design size: pixels equal
            // design units, exactly like the browser host's canvas.
            view.measure(
                View.MeasureSpec.makeMeasureSpec(720, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(1000, View.MeasureSpec.EXACTLY)
            )
            view.layout(0, 0, 720, 1000)
            view.engine = engine
        }
        try {
            // 1. Boot: the shared bundle commits its first frame.
            val initial = view.committedSceneForTest().first!!
            assertEquals("light palette surface at boot", "#F6F7FC", initial.background)
            assertEquals("Day Plan", textOf("Day Plan").text.text)
            assertEquals("0 / 3", textOf("0 / 3").text.text)
            assertNull("boot commit carries no transition", initial.transition)

            // 2. Complete a task through a real tap.
            tap("Complete task")
            assertEquals("1 / 3", textOf("1 / 3").text.text)

            // 3. Navigate: the committed scene carries the host-evaluated
            //    transition; the animation settles on the new route.
            tap("View progress")
            val navigated = view.committedSceneForTest().first!!
            assertEquals("Progress", textOf("Progress").text.text)
            assertEquals("forward transition on the committed scene", "slide", navigated.transition?.kind)
            assertEquals("forward", navigated.transition?.direction)
            waitForSettle()

            // 4. Return: backward transition, retained Today session.
            tap("Back to today")
            assertEquals("backward", view.committedSceneForTest().first!!.transition?.direction)
            waitForSettle()
            assertEquals("Day Plan", textOf("Day Plan").text.text)
            assertEquals("retained journey state after return", "1 / 3", textOf("1 / 3").text.text)

            // 5. Runtime theme toggle: recolors the committed scene, keeps
            //    the journey state (TN-170).
            tap("Toggle theme")
            assertEquals("dark palette after toggle", "#101014", view.committedSceneForTest().first!!.background)
            assertEquals("1 / 3", textOf("1 / 3").text.text)
            tap("Toggle theme")
            assertEquals("light palette restored", "#F6F7FC", view.committedSceneForTest().first!!.background)

            // 6. Edit the plan title through the platform input path — one
            //    main-thread block (runOnMainSync is not reentrant).
            instrumentation.runOnMainSync {
                rawTap("Plan title")
                val focused = fieldDescriptor()
                assertNotNull("plan-title focused by the tap", focused)
                val before = focused!!.input.text
                val connection = view.onCreateInputConnection(EditorInfo())
                assertNotNull("focused plan-title adopts an editor", connection)
                assertTrue("commitText accepted", connection!!.commitText(" (weekend)", 1))
                val edited = fieldDescriptor()
                assertNotNull("descriptor present after edit", edited)
                assertEquals(
                    "edited title committed: ${edited!!.input.text}",
                    before + " (weekend)", edited.input.text
                )
            }

            // 7. Scroll the checklist region with a real drag, then keep
            //    tapping accurately — content-space hit-testing holds.
            instrumentation.runOnMainSync {
                val checklist = textOf("Today's checklist")
                val startX = 360f
                val startY = checklist.text.y + 60f
                rawTouch(MotionEvent.ACTION_DOWN, startX, startY)
                for (step in 1..6) rawTouch(MotionEvent.ACTION_MOVE, startX, startY - step * 40f)
                rawTouch(MotionEvent.ACTION_UP, startX, startY - 240f)
            }
            tap("Complete task")
            assertEquals("taps stay accurate after scrolling", "2 / 3", textOf("2 / 3").text.text)
        } finally {
            instrumentation.runOnMainSync {
                view.engine = null
                engine.destroy()
            }
        }
    }
}

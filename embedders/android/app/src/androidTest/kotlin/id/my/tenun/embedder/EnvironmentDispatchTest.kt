package id.my.tenun.embedder

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * TN-187: the host's ENVIRONMENT dispatch. The device's locale and font
 * scale must reach the runtime's inherited widget context (TN-068) —
 * the real Day Plan bundle (ApplicationRuntime + installHostHandoff)
 * re-lays out under the delivered textScale — while a bundle without
 * setEnvironment refuses visibly (the VIEWPORT negotiation discipline).
 */
@RunWith(AndroidJUnit4::class)
class EnvironmentDispatchTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private val dayPlanBundle: ByteArray by lazy {
        instrumentation.context.assets.open("framework_feel_app.js").use { it.readBytes() }
    }

    /** A bundle whose dispatch knows NO verbs: ENVIRONMENT must surface
     *  as a refusal (null across JNI), never a silent no-op. */
    private val legacyBundle = """
        (function () {
          function commit() {
            tenun_commit(JSON.stringify({tenun:'display-list', version:1,
              designWidth:320, contentHeight:100, background:'#101014',
              ops:[{op:'text', x:10, y:40, text:'legacy', size:17, weight:400, color:'#F2F2F7'}],
              taps:[]}));
          }
          globalThis.__tenun_dispatch_action = function (action) {
            throw new Error('unknown action ' + action);
          };
          commit();
        })();
    """.trimIndent()

    private fun firstTextSize(view: TenunSurfaceView): Double {
        val op = view.committedSceneForTest().first!!
            .ops.filterIsInstance<DisplayListScene.Op.TextOp>().first()
        return op.text.size.toDouble()
    }

    @Test
    fun environmentRescalesTheCommittedDayPlanScene() {
        instrumentation.runOnMainSync {
            val engine = TenunEngine(dayPlanBundle)
            val view = TenunSurfaceView(instrumentation.targetContext)
            try {
                view.engine = engine
                val baseSize = firstTextSize(view)

                // The bundle negotiates ENVIRONMENT (ApplicationRuntime
                // provides setEnvironment) and re-lays out under 2x.
                assertTrue(view.deliverEnvironmentForTest("id-ID", 2.0))
                assertEquals(baseSize * 2, firstTextSize(view), 0.01)

                // A partial update keeps the negotiated scale and only
                // moves the locale; identical values commit nothing new.
                val sceneBefore = view.committedSceneForTest().first
                assertTrue(view.deliverEnvironmentForTest("id-ID", 2.0))
                assertEquals(sceneBefore, view.committedSceneForTest().first)
            } finally {
                view.engine = null
                engine.destroy()
            }
        }
    }

    @Test
    fun bundlesWithoutTheVerbRefuseVisibly() {
        instrumentation.runOnMainSync {
            val engine = TenunEngine(legacyBundle.toByteArray(Charsets.UTF_8))
            val view = TenunSurfaceView(instrumentation.targetContext)
            try {
                view.engine = engine
                val before = view.committedSceneForTest().first
                assertFalse("legacy bundle refuses ENVIRONMENT", view.deliverEnvironmentForTest("en-US", 1.5))
                assertEquals("scene unchanged after refusal", before, view.committedSceneForTest().first)
            } finally {
                view.engine = null
                engine.destroy()
            }
        }
    }
}

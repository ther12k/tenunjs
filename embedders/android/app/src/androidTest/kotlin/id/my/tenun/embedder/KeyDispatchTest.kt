package id.my.tenun.embedder

import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * TN-194: generic KEY action dispatch from the host. Keys the IME path
 * does not consume reach the runtime as KEY {keyCode, phase} actions —
 * the D-pad path TV applications are built on (ADR-0028). The reply
 * protocol mirrors BACK: {handled:true} consumes the key and redraws;
 * anything else falls through to the platform. BACK never dispatches
 * (the host owns it), and a bundle that knows no KEY verb simply
 * falls through — no crash, no silent scene change.
 */
@RunWith(AndroidJUnit4::class)
class KeyDispatchTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    /** A bundle that answers KEY with {handled:true} and re-commits the
     *  last key it saw as the scene's text. */
    private val keyBundle = """
        (function () {
          var lastKey = 'none';
          function commit() {
            tenun_commit(JSON.stringify({tenun:'display-list', version:1,
              designWidth:320, contentHeight:100, background:'#101014',
              ops:[{op:'text', x:10, y:40, text:'key:' + lastKey, size:17, weight:400, color:'#F2F2F7'}],
              taps:[]}));
          }
          globalThis.__tenun_dispatch_action = function (action, payloadJson) {
            if (action === 'KEY') {
              var p = JSON.parse(payloadJson || '{}');
              lastKey = p.keyCode + ':' + p.phase;
              commit();
              return JSON.stringify({handled:true});
            }
            if (action === 'BACK') return JSON.stringify({handled:false});
            throw new Error('unknown action ' + action);
          };
          commit();
        })();
    """.trimIndent()

    /** A bundle that knows NO verbs — every dispatch must fail visibly. */
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

    private fun sceneText(view: TenunSurfaceView): String =
        view.committedSceneForTest().first!!
            .ops.filterIsInstance<DisplayListScene.Op.TextOp>().first().text.text

    private fun key(action: Int, code: Int): KeyEvent = KeyEvent(action, code)

    @Test
    fun dpadKeysReachTheRuntimeAsKeyActions() {
        instrumentation.runOnMainSync {
            val engine = TenunEngine(keyBundle.toByteArray(Charsets.UTF_8))
            val view = TenunSurfaceView(instrumentation.targetContext)
            try {
                view.engine = engine
                view.syncFromScene(engine.getLatestScene())

                // A handled down-phase consumes the event and lands in the scene.
                assertTrue(
                    "handled KEY consumes the event",
                    view.dispatchKeyEvent(key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_DOWN)),
                )
                assertTrue(sceneText(view).contains("key:${KeyEvent.KEYCODE_DPAD_DOWN}:down"))

                assertTrue(
                    view.dispatchKeyEvent(key(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER)),
                )
                assertTrue(sceneText(view).contains("key:${KeyEvent.KEYCODE_DPAD_CENTER}:up"))

                // BACK is excluded from the generic path — the host owns it —
                // so dispatch falls through unconsumed and the scene is untouched.
                val beforeBack = sceneText(view)
                assertFalse(view.dispatchKeyEvent(key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK)))
                assertEquals(beforeBack, sceneText(view))
            } finally {
                view.engine = null
                engine.destroy()
            }
        }
    }

    @Test
    fun legacyBundlesFallThroughVisibly() {
        instrumentation.runOnMainSync {
            val engine = TenunEngine(legacyBundle.toByteArray(Charsets.UTF_8))
            val view = TenunSurfaceView(instrumentation.targetContext)
            try {
                view.engine = engine
                view.syncFromScene(engine.getLatestScene())

                val before = sceneText(view)
                assertFalse(
                    "a bundle without KEY knowledge must not consume the key",
                    view.dispatchKeyEvent(key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_UP)),
                )
                assertEquals("scene unchanged after refusal", before, sceneText(view))
            } finally {
                view.engine = null
                engine.destroy()
            }
        }
    }
}

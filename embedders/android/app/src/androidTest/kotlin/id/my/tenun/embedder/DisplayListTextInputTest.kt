package id.my.tenun.embedder

import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Direct installed-adapter evidence: real Android Editable/InputConnection and
 * the production JNI/QuickJS transport. The controlled script speaks the frozen
 * descriptor/event contract; framework TSX lowering has its separate shared-
 * bundle replay. These are NOT live soft-keyboard or rendered-screen journeys.
 */
@RunWith(AndroidJUnit4::class)
class DisplayListTextInputTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun descriptor(view: TenunSurfaceView): TextInputDescriptor = view.committedSceneForTest().first!!
        .ops.filterIsInstance<DisplayListScene.Op.TextInputOp>().single().input

    private fun connection(view: TenunSurfaceView): InputConnection =
        view.onCreateInputConnection(EditorInfo()) ?: throw AssertionError("focused descriptor has no InputConnection")

    private fun command(view: TenunSurfaceView, action: String, payload: JSONObject = JSONObject()) {
        val engine = view.engine!!
        assertNotNull(engine.dispatchActionResult(action, textInputEventJson(payload)))
        view.syncFromScene(engine.getLatestScene())
    }

    private fun replace(view: TenunSurfaceView, text: String, base: Int, extent: Int = base): InputConnection {
        command(view, "TEST_VALUE", JSONObject().put("text", text)
            .put("selection", JSONObject().put("base", base).put("extent", extent)))
        return connection(view)
    }

    @Test
    fun selectionCompositionAndUtf16EditsRoundTripThroughProductionBridge() {
        instrumentation.runOnMainSync {
            val engine = TenunEngine(BUNDLE.toByteArray(Charsets.UTF_8))
            val view = TenunSurfaceView(instrumentation.targetContext)
            try {
                view.engine = engine
                var ic = connection(view)
                assertEquals("A😀", ic.getTextBeforeCursor(20, 0).toString())
                assertEquals("BC", ic.getTextAfterCursor(20, 0).toString())
                assertTrue(ic.setSelection(4, 3))
                assertEquals("B", ic.getSelectedText(0).toString())
                assertEquals(TextInputSelection(4, 3), descriptor(view).selection)
                assertTrue(ic.commitText("Q", 1))
                assertEquals("A😀QC", descriptor(view).text)
                assertEquals(TextInputSelection(4, 4), descriptor(view).selection)

                assertTrue(ic.setSelection(1, 3))
                assertTrue(ic.setComposingText("k", 1))
                assertEquals("AkQC", descriptor(view).text)
                assertTrue(ic.setComposingText("ka", 1))
                assertEquals("AkaQC", descriptor(view).text)
                assertEquals(TextInputComposition(1, 3), descriptor(view).composing)
                assertTrue(ic.commitText("か", 1))
                assertEquals("AかQC", descriptor(view).text)
                assertNull(descriptor(view).composing)
                assertTrue(ic.setComposingRegion(0, 1))
                assertEquals(TextInputComposition(0, 1), descriptor(view).composing)
                assertTrue(ic.finishComposingText())
                assertEquals("AかQC", descriptor(view).text)
                assertNull(descriptor(view).composing)

                val obsolete = ic
                ic = replace(view, "a😀bc", 3)
                assertFalse(obsolete.commitText("stale", 1))
                assertNull(obsolete.getTextBeforeCursor(20, 0))
                assertTrue(ic.deleteSurroundingText(2, 1))
                assertEquals("ac", descriptor(view).text)
                assertEquals(TextInputSelection(1, 1), descriptor(view).selection)
                ic = replace(view, "a😀bc", 3)
                assertTrue(ic.deleteSurroundingTextInCodePoints(1, 1))
                assertEquals("ac", descriptor(view).text)
                ic = replace(view, "a😀bc", 3)
                assertTrue(ic.deleteSurroundingText(1, 0))
                assertEquals("a\uD83Dbc", descriptor(view).text)
                assertEquals("a\uD83D", ic.getTextBeforeCursor(20, 0).toString())

                ic = replace(view, "", 0)
                assertTrue(ic.setComposingText("チーム😀", 1))
                assertEquals(TextInputComposition(0, 5), descriptor(view).composing)
                assertTrue(ic.commitText("チーム🎉", 1))
                assertEquals("チーム🎉", descriptor(view).text)
                assertNull(descriptor(view).composing)

                ic = replace(view, "abcd", 1, 3)
                assertTrue(ic.commitText("XY", 0))
                assertEquals("aXYd", descriptor(view).text)
                assertEquals(TextInputSelection(1, 1), descriptor(view).selection)

                ic = replace(view, "ab", 1)
                val revision = descriptor(view).revision
                assertTrue(ic.beginBatchEdit())
                assertTrue(ic.setComposingText("k", 1))
                assertTrue(ic.setComposingText("ka", 1))
                assertEquals("ab", descriptor(view).text)
                ic.endBatchEdit()
                assertEquals("akab", descriptor(view).text)
                assertEquals(revision + 1, descriptor(view).revision)
                assertEquals(TextInputComposition(1, 3), descriptor(view).composing)
                val beforeRejected = descriptor(view)
                assertFalse(ic.commitText("bad\nline", 1))
                assertEquals(beforeRejected, descriptor(view))
                assertNull(ic.getExtractedText(null, 0))
                ic = connection(view)
                assertEquals(beforeRejected.text, ic.getExtractedText(null, 0)!!.text.toString())

                assertTrue(ic.performEditorAction(EditorInfo.IME_ACTION_DONE))
                assertFalse(descriptor(view).focused)
                assertNull(descriptor(view).composing)
                assertNull(view.onCreateInputConnection(EditorInfo()))
                assertFalse(ic.commitText("after submit", 1))
            } finally {
                view.engine = null
                engine.destroy()
            }
        }
    }

    @Test
    fun controlledRewriteRetiresTheComposingConnectionBeforeItsNextEdit() {
        instrumentation.runOnMainSync {
            val engine = TenunEngine(BUNDLE.toByteArray(Charsets.UTF_8))
            val view = TenunSurfaceView(instrumentation.targetContext)
            try {
                view.engine = engine
                val ic = replace(view, "", 0)
                command(view, "TEST_TRANSFORM")
                assertTrue(ic.setComposingText("k", 1))
                assertEquals("K", descriptor(view).text)
                assertNull(descriptor(view).composing)
                assertFalse(ic.setComposingText("ka", 1))
                assertNull(ic.getTextBeforeCursor(10, 0))
                val replacement = connection(view)
                assertEquals("K", replacement.getTextBeforeCursor(10, 0).toString())
                assertTrue(replacement.setSelection(0, 1))
                assertTrue(replacement.setComposingText("か", 1))
                assertEquals("か", descriptor(view).text)
                assertEquals(TextInputComposition(0, 1), descriptor(view).composing)
            } finally {
                view.engine = null
                engine.destroy()
            }
        }
    }

    @Test
    fun connectionsCannotCrossFieldRemovalRestoreSwapOrEngineDisposal() {
        instrumentation.runOnMainSync {
            val firstEngine = TenunEngine(BUNDLE.toByteArray(Charsets.UTF_8))
            val secondEngine = TenunEngine(BUNDLE.toByteArray(Charsets.UTF_8))
            val view = TenunSurfaceView(instrumentation.targetContext)
            try {
                view.engine = firstEngine
                var old = connection(view)
                // Both engines begin at session 1: numeric equality is not ownership.
                view.engine = secondEngine
                assertFalse(old.setSelection(0, 0))
                assertNull(old.getSelectedText(0))
                old = connection(view)
                command(view, "TEST_FOCUS", JSONObject().put("id", "details"))
                assertFalse(old.setComposingText("wrong field", 1))
                assertEquals("details", descriptor(view).id)
                old = connection(view)
                command(view, "TEST_READONLY")
                assertFalse(old.commitText("readonly", 1))
                assertNull(view.onCreateInputConnection(EditorInfo()))
                command(view, "TEST_FOCUS", JSONObject().put("id", "title"))
                old = connection(view)
                command(view, "TEST_RESTORE")
                assertFalse(old.deleteSurroundingText(1, 0))
                assertNull(old.getTextAfterCursor(10, 0))
                command(view, "TEST_FOCUS", JSONObject().put("id", "title"))
                old = connection(view)
                command(view, "TEST_REMOVE")
                assertFalse(old.performEditorAction(EditorInfo.IME_ACTION_DONE))
                assertNull(view.onCreateInputConnection(EditorInfo()))
                command(view, "TEST_FOCUS", JSONObject().put("id", "title"))
                old = connection(view)
                view.onWindowFocusChanged(false)
                assertFalse(old.setComposingText("inactive window", 1))
                assertNull(old.getTextBeforeCursor(10, 0))
                assertFalse(descriptor(view).focused)
                assertNull(view.onCreateInputConnection(EditorInfo()))
                view.onWindowFocusChanged(true)
                command(view, "TEST_FOCUS", JSONObject().put("id", "title"))
                old = connection(view)
                secondEngine.destroy()
                assertTrue(secondEngine.isDisposed)
                // Deliberately retain view.engine here: the disposed guard
                // still prevents native dispatch and surrounding-text queries.
                assertFalse(old.commitText("disposed", 1))
                assertNull(old.getTextBeforeCursor(10, 0))
                assertNull(view.onCreateInputConnection(EditorInfo()))
            } finally {
                view.engine = null
                firstEngine.destroy()
                secondEngine.destroy()
            }
        }
    }

    companion object {
        private val BUNDLE = """
            (function () {
              var nextSession = 1, present = true, transformNextEdit = false;
              var input = {op:'text-input', id:'title', x:10, y:20, w:280, h:64,
                text:'A😀BC', selection:{base:3,extent:3}, composing:null,
                focused:true, sessionId:1, revision:0, keyboardType:'text',
                returnAction:'done', readOnly:false, label:'Title'};
              function commit() {
                tenun_commit(JSON.stringify({tenun:'display-list', version:1,
                  designWidth:320, contentHeight:480, background:'#101014',
                  ops:present ? [input] : [], taps:[]}));
              }
              function blur() { input.focused=false; input.sessionId=0; input.revision=0; input.composing=null; }
              globalThis.__tenun_dispatch_action = function (action, payloadJson) {
                var p=JSON.parse(payloadJson || '{}');
                if (action === 'TEXT_EDIT' || action === 'TEXT_BLUR' || action === 'TEXT_SUBMIT') {
                  if (!present || !input.focused || p.id !== input.id || p.sessionId !== input.sessionId || p.baseRevision !== input.revision)
                    throw new Error('stale text session/revision');
                  if (action === 'TEXT_EDIT') {
                    if (/[\r\n]/.test(p.text)) throw new Error('single-line input');
                    input.text=p.text; input.selection=p.selection; input.composing=p.composing; input.revision++;
                    if (transformNextEdit) {
                      input.text=input.text.toUpperCase(); input.composing=null; transformNextEdit=false;
                    }
                  } else blur();
                } else if (action === 'TEST_VALUE') {
                  input.text=p.text; input.selection=p.selection; input.composing=null; input.revision++;
                } else if (action === 'TEST_TRANSFORM') { transformNextEdit=true;
                } else if (action === 'TEST_FOCUS') {
                  present=true; input.id=p.id; input.focused=true; input.readOnly=false;
                  input.sessionId=++nextSession; input.revision=0; input.composing=null;
                } else if (action === 'TEST_READONLY') { blur(); input.readOnly=true;
                } else if (action === 'TEST_RESTORE') { blur();
                } else if (action === 'TEST_REMOVE') { blur(); present=false;
                } else if (action !== 'VIEWPORT') throw new Error('unknown action');
                commit(); return JSON.stringify({route:'adapter-test'});
              };
              commit();
            })();
        """.trimIndent()
    }
}

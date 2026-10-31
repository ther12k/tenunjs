package id.my.tenun.embedder

import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * TN-186 (TN-091 remainder): accessibility text entry. ACTION_SET_TEXT on
 * an editable textfield node must reach the revisioned TEXT_EDIT contract
 * — focusing the field through its ORDINARY tap when no session is live
 * (accessibility activation ≡ touch), committing full replacements, and
 * refusing read-only fields and contract violations fail-visibly.
 *
 * The controlled bundle speaks the frozen descriptor/event contract: the
 * focus tap bumps sessionId and resets revision exactly like the
 * ApplicationRuntime focus path, and TEXT_EDIT validates
 * id/sessionId/baseRevision like the production runtime.
 */
@RunWith(AndroidJUnit4::class)
class EngineAccessibilitySetTextTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    private val bundle = """
        (function () {
          var nextSession = 1;
          var input = {op:'text-input', id:'title', x:10, y:20, w:280, h:64,
            text:'', selection:{base:0,extent:0}, composing:null,
            focused:false, sessionId:0, revision:0, keyboardType:'text',
            returnAction:'done', readOnly:false, label:'Title'};
          var notes = {op:'text-input', id:'notes', x:10, y:100, w:280, h:64,
            text:'keep', selection:{base:4,extent:4}, composing:null,
            focused:false, sessionId:0, revision:0, keyboardType:'text',
            returnAction:'done', readOnly:true, label:'Notes'};
          function commit() {
            tenun_commit(JSON.stringify({tenun:'display-list', version:1,
              designWidth:320, contentHeight:480, background:'#101014',
              ops:[input, notes],
              taps:[{x:10,y:20,w:280,h:64,action:'tap',payload:{id:0}}],
              semantics:{semanticsVersion:1, nodes:[
                {id:'title', role:'textfield', label:'Title', value:input.text,
                 state:{focused:input.focused, readOnly:input.readOnly},
                 bounds:{x:10,y:20,w:280,h:64},
                 actions:[{name:'press', tapId:0}]},
                {id:'notes', role:'textfield', label:'Notes', value:notes.text,
                 state:{focused:false, readOnly:true},
                 bounds:{x:10,y:100,w:280,h:64}}
              ]}}));
          }
          globalThis.__tenun_dispatch_action = function (action, payloadJson) {
            var p = JSON.parse(payloadJson || '{}');
            var a = action.toLowerCase();
            if (a === 'tap' && p.id === 0) {
              if (input.readOnly) throw new Error('read-only field');
              if (!input.focused) { input.focused=true; input.sessionId=++nextSession; input.revision=0; }
            } else if (action === 'TEXT_EDIT') {
              if (!input.focused || p.id !== input.id || p.sessionId !== input.sessionId || p.baseRevision !== input.revision)
                throw new Error('stale text session/revision');
              if (/[\r\n]/.test(p.text)) throw new Error('single-line input');
              input.text=p.text; input.selection=p.selection; input.composing=p.composing; input.revision++;
            } else if (action === 'TEXT_BLUR' || action === 'TEXT_SUBMIT') {
              if (input.focused) { input.focused=false; input.sessionId=0; input.revision=0; input.composing=null; }
            } else throw new Error('unknown action ' + action);
            commit(); return JSON.stringify({route:'a11y-set-text'});
          };
          commit();
        })();
    """.trimIndent()

    private fun descriptorOf(view: TenunSurfaceView, id: String): TextInputDescriptor =
        view.committedSceneForTest().first!!
            .ops.filterIsInstance<DisplayListScene.Op.TextInputOp>()
            .single { it.input.id == id }.input

    private fun findNodeByLabel(provider: android.view.accessibility.AccessibilityNodeProvider, label: String): Pair<Int, AccessibilityNodeInfo> {
        var id = 1
        while (id < 64) {
            val info = provider.createAccessibilityNodeInfo(id) ?: continue
            if (label == info.hintText?.toString() || label == info.contentDescription?.toString()) return id to info
            id++
        }
        throw AssertionError("no semantic node with hint/contentDescription \"$label\"")
    }

    private fun setTextArguments(text: String): Bundle = Bundle().apply {
        putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
    }

    @Test
    fun setTextFocusesThenReplacesThroughTheRevisionedContract() {
        instrumentation.runOnMainSync {
            val engine = TenunEngine(bundle.toByteArray(Charsets.UTF_8))
            val view = TenunSurfaceView(instrumentation.targetContext)
            try {
                view.engine = engine
                val provider = view.accessibilityNodeProvider!!
                val (nodeId, info) = findNodeByLabel(provider, "Title")

                assertTrue("editable node exposes ACTION_SET_TEXT",
                    info.actionList.any { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT })
                assertTrue(info.isEditable)

                // Field starts UNFOCUSED: the set must first run the focus
                // tap (the same activation TalkBack's double-tap runs),
                // then commit through the freshly adopted session.
                assertTrue(provider.performAction(nodeId, AccessibilityNodeInfo.ACTION_SET_TEXT, setTextArguments("hello a11y")))
                var descriptor = descriptorOf(view, "title")
                assertTrue("focus tap adopted the session", descriptor.focused)
                assertEquals("hello a11y", descriptor.text)
                assertEquals(TextInputSelection("hello a11y".length, "hello a11y".length), descriptor.selection)

                // The semantic node's announced value follows the commit.
                assertEquals("hello a11y", provider.createAccessibilityNodeInfo(nodeId)!!.text.toString())

                // A second write rides the LIVE session without re-focusing.
                assertTrue(provider.performAction(nodeId, AccessibilityNodeInfo.ACTION_SET_TEXT, setTextArguments("second write")))
                descriptor = descriptorOf(view, "title")
                assertEquals("second write", descriptor.text)

                // Empty string is a legitimate full replacement (clear).
                assertTrue(provider.performAction(nodeId, AccessibilityNodeInfo.ACTION_SET_TEXT, setTextArguments("")))
                assertEquals("", descriptorOf(view, "title").text)
            } finally {
                view.engine = null
                engine.destroy()
            }
        }
    }

    @Test
    fun readOnlyFieldsAndContractViolationsRefuseFailVisibly() {
        instrumentation.runOnMainSync {
            val engine = TenunEngine(bundle.toByteArray(Charsets.UTF_8))
            val view = TenunSurfaceView(instrumentation.targetContext)
            try {
                view.engine = engine
                val provider = view.accessibilityNodeProvider!!

                // Read-only field: no ACTION_SET_TEXT offered, refusal on attempt.
                val (roId, roInfo) = findNodeByLabel(provider, "Notes")
                assertFalse(roInfo.isEditable)
                assertFalse("read-only node offers no set-text action",
                    roInfo.actionList.any { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT })
                assertFalse("read-only set refused", provider.performAction(roId, AccessibilityNodeInfo.ACTION_SET_TEXT, setTextArguments("nope")))
                assertEquals("keep", descriptorOf(view, "notes").text)

                // Single-line contract: the runtime rejects the multiline
                // replacement; the previous text survives unchanged.
                val (nodeId, _) = findNodeByLabel(provider, "Title")
                assertTrue(provider.performAction(nodeId, AccessibilityNodeInfo.ACTION_SET_TEXT, setTextArguments("first")))
                assertFalse("multiline text rejected by the runtime contract",
                    provider.performAction(nodeId, AccessibilityNodeInfo.ACTION_SET_TEXT, setTextArguments("bad\ntext")))
                assertEquals("first", descriptorOf(view, "title").text)
                assertNotNull(view.committedSceneForTest().first)
            } finally {
                view.engine = null
                engine.destroy()
            }
        }
    }
}

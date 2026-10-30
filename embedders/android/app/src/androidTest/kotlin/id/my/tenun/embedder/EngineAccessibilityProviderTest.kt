package id.my.tenun.embedder

import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * TN-180 (TN-091 slice 1): the accessibility node provider over the
 * production engine + view. TalksBack drives exactly this surface:
 * populated framework nodes for scene.semantics entries, ACTION_CLICK
 * dispatching the SAME tap a finger does, and focus queries.
 */
@RunWith(AndroidJUnit4::class)
class EngineAccessibilityProviderTest {

    private val instrumentation get() = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()

    private val bundle = """
        (function () {
          var count = 0;
          function commit() {
            tenun_commit(JSON.stringify({tenun:'display-list', version:1,
              designWidth:320, contentHeight:200, background:'#101014',
              ops:[
                {op:'text', x:16, y:40, text:'count '+count, size:22, weight:600, color:'#F2F2F7'},
                {op:'rect', x:16, y:64, w:96, h:64, r:32, color:'#4C8DFF'},
                {op:'text', x:28, y:104, text:'Plus', size:17, weight:600, color:'#FFFFFF'}
              ],
              taps:[{x:16, y:64, w:96, h:64, action:'tap', payload:{id:0}}],
              semantics:{semanticsVersion:1, nodes:[
                {id:'counter', role:'text', label:'count '+count,
                 bounds:{x:16, y:16, w:200, h:36}},
                {id:'plus', role:'button', label:'Plus',
                 bounds:{x:16, y:64, w:96, h:64},
                 actions:[{name:'press', tapId:0}]}
              ]}}));
          }
          globalThis.__tenun_dispatch_action = function (action, payloadJson) {
            var p = JSON.parse(payloadJson || '{}');
            if (action.toLowerCase() === 'tap' && p.id === 0) count++;
            else throw new Error('unknown action');
            commit();
            return JSON.stringify({route:'a11y-test'});
          };
          commit();
        })();
    """.trimIndent()

    private fun findButtonNode(provider: android.view.accessibility.AccessibilityNodeProvider): Pair<Int, AccessibilityNodeInfo>? {
        var id = 1
        while (id < 64) {
            val info = provider.createAccessibilityNodeInfo(id) ?: return null
            if ("android.widget.Button" == info.className.toString()) return id to info
            id++
        }
        return null
    }

    @Test
    fun providerExposesSceneSemanticsAsFrameworkNodes() {
        instrumentation.runOnMainSync {
            val engine = TenunEngine(bundle.toByteArray(Charsets.UTF_8))
            val view = TenunSurfaceView(instrumentation.targetContext)
            try {
                view.engine = engine
                val provider = view.accessibilityNodeProvider!!
                assertNotNull(provider)

                val (buttonId, button) = findButtonNode(provider)!!
                assertEquals("Plus", button.contentDescription.toString())
                assertTrue(button.isClickable)
                assertTrue(button.actionList.any { it.id == AccessibilityNodeInfo.ACTION_CLICK })
                val screenBounds = android.graphics.Rect()
                button.getBoundsInScreen(screenBounds)
                assertTrue("bounds must be populated", !screenBounds.isEmpty)

                // The static text node reads through with its label.
                var textId = 1
                var textNode: AccessibilityNodeInfo? = null
                while (textId < 64) {
                    val info = provider.createAccessibilityNodeInfo(textId)!!
                    if ("android.widget.TextView" == info.className.toString() &&
                        info.contentDescription?.toString()?.startsWith("count ") == true
                    ) {
                        textNode = info
                        break
                    }
                    textId++
                }
                assertNotNull(textNode)
                assertEquals("count 0", textNode!!.contentDescription.toString())
                assertNull("unallocated virtual id must yield no node", provider.createAccessibilityNodeInfo(9999))

                // ACTION_CLICK dispatches the same tap a finger does.
                assertTrue(provider.performAction(buttonId, AccessibilityNodeInfo.ACTION_CLICK, null))
                val after = findButtonNode(provider)!!
                // The re-committed scene re-reads through the same virtual id.
                assertEquals(buttonId, after.first)
                val updatedText = provider.createAccessibilityNodeInfo(textId)!!
                assertEquals("count 1", updatedText.contentDescription.toString())

                // Accessibility focus round trip through the provider.
                assertTrue(provider.performAction(buttonId, AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS, null))
                val focused = provider.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY)
                assertNotNull(focused)
                assertEquals("Plus", focused!!.contentDescription.toString())
                assertTrue(provider.performAction(buttonId, AccessibilityNodeInfo.ACTION_CLEAR_ACCESSIBILITY_FOCUS, null))
                assertNull(provider.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY))
            } finally {
                view.engine = null
                engine.destroy()
            }
        }
    }
}

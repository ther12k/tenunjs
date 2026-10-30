package id.my.tenun.embedder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * TN-180 (TN-091 slice 1): scene-semantics parsing and the bridge state
 * machine — virtual-id stability, commit diffing, live-region
 * announcements, and focus bookkeeping. Pure JVM; no Android types.
 */
class SceneAccessibilityBridgeTest {

    private fun scene(semanticsJson: String?): String {
        val semantics = semanticsJson?.let { """"semantics":$it,""" } ?: ""
        return """{"tenun":"display-list","version":1,"designWidth":320,"contentHeight":100,
            "background":"#101014","ops":[],"taps":[],$semantics"transition":null}"""
    }

    private fun node(
        id: String, role: String = "text", label: String? = null, value: String? = null,
        liveRegion: Boolean = false, pressTapId: Int? = null, scroll: String? = null
    ): SceneSemantics.Node = SceneSemantics.Node(
        id = id, role = role, label = label, value = value, hint = null,
        focused = false, readOnly = false, disabled = false,
        x = 0f, y = 0f, w = 10f, h = 10f,
        pressTapId = pressTapId, longPressTapId = null, scroll = scroll, liveRegion = liveRegion
    )

    @Test
    fun parsesSemanticsBlockStrictly() {
        val semantics = """{"semanticsVersion":1,"nodes":[
            {"id":"plus","role":"button","label":"Plus","bounds":{"x":0,"y":0,"w":96,"h":64},
             "actions":[{"name":"press","tapId":3}]},
            {"id":"status","role":"alert","value":"idle","liveRegion":true,
             "bounds":{"x":0,"y":64,"w":200,"h":40}},
            {"id":"item","role":"button","label":"Item","scroll":"list",
             "bounds":{"x":0,"y":0,"w":100,"h":50},"state":{"focused":false},
             "actions":[{"name":"long-press","tapId":7}]}
        ]}"""
        val parsed = DisplayListScene.parse(scene(semantics))!!.semantics!!
        assertEquals(3, parsed.nodes.size)
        val plus = parsed.nodes[0]
        assertEquals("button", plus.role)
        assertEquals("Plus", plus.label)
        assertEquals(3, plus.pressTapId)
        val status = parsed.nodes[1]
        assertTrue(status.liveRegion)
        assertEquals("idle", status.value)
        val item = parsed.nodes[2]
        assertEquals("list", item.scroll)
        assertEquals(7, item.longPressTapId)
        assertNull(item.pressTapId)
    }

    @Test
    fun absentSemanticsIsNullAndMalformedFailsVisibly() {
        assertNull(DisplayListScene.parse(scene(null))!!.semantics)
        // Unknown version: a contract violation, not a silent skip.
        assertThrows(SceneContractException::class.java) {
            DisplayListScene.parse(scene("""{"semanticsVersion":2,"nodes":[]}"""))
        }
        // Duplicate ids, missing ids, unknown actions.
        assertThrows(SceneContractException::class.java) {
            DisplayListScene.parse(scene(
                """{"semanticsVersion":1,"nodes":[
                    {"id":"a","role":"text","bounds":{"x":0,"y":0,"w":1,"h":1}},
                    {"id":"a","role":"text","bounds":{"x":0,"y":0,"w":1,"h":1}}]}"""))
        }
        assertThrows(SceneContractException::class.java) {
            DisplayListScene.parse(scene(
                """{"semanticsVersion":1,"nodes":[{"role":"text","bounds":{"x":0,"y":0,"w":1,"h":1}}]}"""))
        }
        assertThrows(SceneContractException::class.java) {
            DisplayListScene.parse(scene(
                """{"semanticsVersion":1,"nodes":[
                    {"id":"a","role":"text","bounds":{"x":0,"y":0,"w":1,"h":1},
                     "actions":[{"name":"shout","tapId":1}]}]}"""))
        }
    }

    @Test
    fun virtualIdsAreStableAcrossCommitsAndRetiredIdsNeverReuse() {
        val state = SemanticsBridgeState()
        val first = state.onSceneCommitted(SceneSemantics(listOf(node("a"), node("b"))))
        val idA1 = state.virtualIdFor("a")!!
        val idB1 = state.virtualIdFor("b")!!
        // b disappears, c arrives: a keeps its id, c does NOT inherit b's.
        state.onSceneCommitted(SceneSemantics(listOf(node("a"), node("c"))))
        assertEquals(idA1, state.virtualIdFor("a"))
        val idC = state.virtualIdFor("c")!!
        assertTrue(idC != idB1)
        assertEquals(node("c").id, state.nodeByVirtualId(idC)!!.id)
        assertNull(state.nodeByVirtualId(idB1))
        assertEquals(0, first.changedVirtualIds.size) // first commit: nothing to diff
    }

    @Test
    fun changedContentDiffsAndLiveRegionsAnnounceExplicitly() {
        val state = SemanticsBridgeState()
        state.onSceneCommitted(SceneSemantics(listOf(
            node("counter", role = "text", label = "count 0"),
            node("status", role = "alert", value = "idle", liveRegion = true)
        )))
        val diff = state.onSceneCommitted(SceneSemantics(listOf(
            node("counter", role = "text", label = "count 1"),
            node("status", role = "alert", value = "running", liveRegion = true)
        )))
        // Ordinary text change: a content-changed event, no announcement.
        assertEquals(listOf(state.virtualIdFor("counter")), diff.changedVirtualIds)
        // Live region: an explicit announcement carrying the new value.
        assertEquals(listOf("running"), diff.announcements)
        // Unchanged commit: quiet.
        val quiet = state.onSceneCommitted(SceneSemantics(listOf(
            node("counter", role = "text", label = "count 1"),
            node("status", role = "alert", value = "running", liveRegion = true)
        )))
        assertTrue(quiet.changedVirtualIds.isEmpty() && quiet.announcements.isEmpty())
    }

    @Test
    fun announcementsAreRateLimitedPerCommit() {
        val state = SemanticsBridgeState()
        state.onSceneCommitted(SceneSemantics(listOf(
            node("a", value = "1", liveRegion = true),
            node("b", value = "1", liveRegion = true),
            node("c", value = "1", liveRegion = true)
        )))
        val diff = state.onSceneCommitted(SceneSemantics(listOf(
            node("a", value = "2", liveRegion = true),
            node("b", value = "2", liveRegion = true),
            node("c", value = "2", liveRegion = true)
        )))
        assertEquals(SemanticsBridgeState.MAX_ANNOUNCEMENTS_PER_COMMIT, diff.announcements.size)
    }

    @Test
    fun focusSurvivesIdStabilityAndClearsWhenTheNodeDisappears() {
        val state = SemanticsBridgeState()
        state.onSceneCommitted(SceneSemantics(listOf(node("a", role = "button", pressTapId = 0))))
        val idA = state.virtualIdFor("a")!!
        assertTrue(state.setAccessibilityFocus(idA))
        assertEquals(idA, state.focusedVirtualId())
        // Same id on the next commit: focus persists.
        state.onSceneCommitted(SceneSemantics(listOf(node("a", role = "button", pressTapId = 0))))
        assertEquals(idA, state.focusedVirtualId())
        // The focused node leaves the scene: focus clears.
        val diff = state.onSceneCommitted(SceneSemantics(listOf(node("z"))))
        assertNull(state.focusedVirtualId())
        assertTrue(diff.focusCleared)
        // A null semantics commit (engine swap) clears everything.
        state.onSceneCommitted(SceneSemantics(listOf(node("q"))))
        state.setAccessibilityFocus(state.virtualIdFor("q"))
        state.onSceneCommitted(null)
        assertNull(state.focusedVirtualId())
        assertNull(state.virtualIdFor("q"))
    }

    private fun assertThrows(type: Class<out Throwable>, block: () -> Unit) {
        try {
            block()
        } catch (e: Throwable) {
            assertTrue("expected ${type.simpleName}, got ${e.javaClass.simpleName}", type.isInstance(e))
            return
        }
        throw AssertionError("expected ${type.simpleName} was not thrown")
    }
}

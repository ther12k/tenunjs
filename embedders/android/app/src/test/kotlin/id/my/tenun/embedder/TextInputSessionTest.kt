package id.my.tenun.embedder

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Pure parser/session tests; these do not stand in for an installed IME test. */
class TextInputSessionTest {
    private fun json(id: String = "title", focused: Boolean = true): JSONObject = JSONObject()
        .put("op", "text-input").put("id", id)
        .put("x", 10).put("y", 20).put("w", 280).put("h", 64)
        .put("text", "Note 😀")
        .put("selection", JSONObject().put("base", 7).put("extent", 0))
        .put("composing", if (focused) JSONObject().put("start", 5).put("end", 7) else JSONObject.NULL)
        .put("focused", focused).put("sessionId", if (focused) 1 else 0).put("revision", 0)
        .put("keyboardType", "text").put("returnAction", "done").put("readOnly", false)
        .put("label", "Title")

    private fun input(id: String = "title", focused: Boolean = true): TextInputDescriptor =
        TextInputDescriptor.parse(json(id, focused))

    private fun scene(vararg inputs: JSONObject): String = JSONObject()
        .put("tenun", "display-list").put("version", 1)
        .put("designWidth", 320).put("contentHeight", 480).put("background", "#101014")
        .put("ops", JSONArray(inputs.toList())).put("taps", JSONArray()).toString()

    private fun rejects(block: () -> Unit) {
        try {
            block()
            fail("Expected SceneContractException")
        } catch (_: SceneContractException) {
            // A malformed required descriptor rejects the complete scene.
        }
    }

    @Test
    fun parsesDirectionalUtf16SelectionAndCompositionWithoutSharingJsonObjects() {
        val source = json()
        val parsed = TextInputDescriptor.parse(source)
        assertEquals(7, parsed.text.length)
        assertEquals(TextInputSelection(7, 0), parsed.selection)
        assertEquals(TextInputComposition(5, 7), parsed.composing)
        source.getJSONObject("selection").put("base", 0)
        assertEquals(7, parsed.selection.base)
        // Offsets are code units, not a newly invented scalar/grapheme index.
        source.getJSONObject("selection").put("base", 6)
        assertEquals(6, TextInputDescriptor.parse(source).selection.base)
    }

    @Test
    fun rejectsMalformedRequiredFieldsAndSessionRanges() {
        val invalid = listOf<(JSONObject) -> Unit>(
            { it.remove("label") }, { it.remove("composing") }, { it.put("id", "") },
            { it.put("id", "\t \uFEFF") }, { it.put("op", "text") },
            { it.put("text", 123) }, { it.put("focused", "true") },
            { it.put("text", "line\nbreak") }, { it.put("text", "line\rbreak") },
            { it.put("readOnly", true) }, { it.put("keyboardType", "password") },
            { it.put("returnAction", "next") }, { it.put("w", -1) },
            { it.put("x", 1e100) }, { it.put("sessionId", 0) },
            { it.put("revision", -1) }, { it.put("revision", 0.5) },
            { it.put("revision", "1") }, { it.put("revision", 9007199254740992L) },
            { it.getJSONObject("selection").put("base", 8) },
            { it.getJSONObject("selection").put("extent", -1) },
            { it.getJSONObject("selection").put("extent", 0.5) },
            { it.getJSONObject("composing").put("start", 7) },
            { it.getJSONObject("composing").put("end", 4) },
            { it.getJSONObject("composing").put("end", 8) },
            { it.put("focused", false) }
        )
        invalid.forEach { change -> rejects { TextInputDescriptor.parse(json().also(change)) } }
        assertFalse(TextInputDescriptor.parse(json(focused = false).put("readOnly", true)).focused)
    }

    @Test
    fun duplicateFieldsOrMultipleFocusedFieldsRejectWholeScene() {
        val holder = SceneHolder()
        assertEquals(SceneHolder.Outcome.APPLIED, holder.apply(scene(json())))
        val before = holder.current
        assertEquals(SceneHolder.Outcome.REJECTED, holder.apply(scene(json(), json(focused = false))))
        assertSame(before, holder.current)
        assertEquals(SceneHolder.Outcome.REJECTED, holder.apply(scene(json(), json("other"))))
        assertSame(before, holder.current)
        assertEquals(SceneHolder.Outcome.REJECTED, holder.apply(scene(json().put("revision", -1))))
        assertSame(before, holder.current)
        val valid = DisplayListScene.parse(scene(json(), json("other", focused = false)))!!
        assertEquals(2, valid.ops.filterIsInstance<DisplayListScene.Op.TextInputOp>().size)
    }

    @Test
    fun requiredTextInputOpDoesNotChangeLegacySceneRouting() {
        assertNull(DisplayListScene.parse("""{"root":{"children":[]}}"""))
        assertEquals("title", (DisplayListScene.parse(scene(json()))!!.ops[0] as DisplayListScene.Op.TextInputOp).input.id)
    }

    @Test
    fun editorTextClipRetainsAbsoluteGeometryAndRejectsMalformedRectsAtomically() {
        val text = JSONObject().put("op", "text").put("text", "Wide 字😀")
            .put("x", 30).put("y", 70).put("size", 17).put("weight", 400).put("color", "#FFFFFF")
            .put("fixed", true).put("anchor", "bottom").put("anchorSize", 100)
            .put("clip", JSONObject().put("x", 24).put("y", 40).put("w", 72).put("h", 30))
        val parsed = DisplayListScene.parse(scene(json(), text))!!
        val op = (parsed.ops[1] as DisplayListScene.Op.TextOp).text
        assertEquals(DisplayListScene.Clip(24f, 40f, 72f, 30f), op.clip)
        assertEquals(30f, op.x)
        assertEquals(70f, op.y)
        assertTrue(op.fixed)
        assertEquals("bottom", op.anchor)
        val holder = SceneHolder()
        assertEquals(SceneHolder.Outcome.APPLIED, holder.apply(scene(json(), text)))
        val before = holder.current
        for (clip in listOf(
            JSONObject.NULL,
            JSONObject().put("x", 24).put("y", 40).put("w", -1).put("h", 30),
            JSONObject().put("x", 24).put("y", 40).put("w", 72),
            JSONObject().put("x", "24").put("y", 40).put("w", 72).put("h", 30)
        )) {
            text.put("clip", clip)
            assertEquals(SceneHolder.Outcome.REJECTED, holder.apply(scene(json(), text)))
            assertSame(before, holder.current)
        }
    }

    @Test
    fun geometryAndOwnAcknowledgementsPreserveConnectionButExternalChangesReplaceIt() {
        val owner = Any()
        val state = TextInputSessionState()
        val initial = input()
        assertTrue(state.adopt(owner, initial))
        val token = state.token()!!
        assertFalse(state.adopt(owner, initial.copy(w = 540f, y = 40f)))
        assertTrue(state.accepts(token))
        val edited = initial.copy(text = "かな 😀", selection = TextInputSelection(5, 5), composing = null, revision = 1)
        assertFalse(state.adopt(owner, edited, ownEdit = true))
        assertTrue(state.accepts(token))
        assertEquals(1L, state.current!!.revision)
        assertTrue(state.adopt(owner, edited.copy(text = "Controller reset", selection = TextInputSelection(16, 16), revision = 2)))
        assertFalse(state.accepts(token))
        assertEquals("Controller reset", state.current!!.text)
    }

    @Test
    fun onlyExactIdentityRevisionAndEditingValueAcknowledgeAnImeEdit() {
        val previous = input()
        val proposed = TextInputValue("か", TextInputSelection(1, 1), TextInputComposition(0, 1))
        val acknowledged = previous.copy(text = proposed.text, selection = proposed.selection,
            composing = proposed.composing, revision = previous.revision + 1)
        assertTrue(acknowledged.acknowledgesEdit(previous, proposed))
        assertTrue(acknowledged.copy(x = 50f, w = 400f).acknowledgesEdit(previous, proposed))
        for (changed in listOf(
            acknowledged.copy(id = "other"), acknowledged.copy(sessionId = 2),
            acknowledged.copy(revision = previous.revision), acknowledged.copy(revision = previous.revision + 2),
            acknowledged.copy(text = "カ"), acknowledged.copy(selection = TextInputSelection(0, 0)),
            acknowledged.copy(composing = null), acknowledged.copy(focused = false), acknowledged.copy(readOnly = true)
        )) assertFalse(changed.acknowledgesEdit(previous, proposed))
    }

    @Test
    fun rejectedOptimisticEditInvalidatesEvenWhenCommittedValueDidNotChange() {
        val owner = Any()
        val state = TextInputSessionState()
        val committed = input()
        state.adopt(owner, committed)
        val stale = state.token()!!
        assertTrue(state.adopt(owner, committed, forceRestart = true))
        assertFalse(state.accepts(stale))
        assertEquals(committed, state.current)
        assertTrue(state.accepts(state.token()!!))
    }

    @Test
    fun fieldTransferRemovalReadOnlyAndRestoreInvalidateOldConnectionTokens() {
        val owner = Any()
        val state = TextInputSessionState()
        state.adopt(owner, input())
        val old = state.token()!!
        state.adopt(owner, input("details").copy(sessionId = 2), ownEdit = true)
        assertFalse(state.accepts(old))
        val details = state.token()!!
        state.adopt(owner, null)
        assertFalse(state.accepts(details))
        assertNull(state.token())
        state.adopt(owner, input())
        val beforeRestore = state.token()!!
        state.adopt(owner, input(focused = false))
        assertFalse(state.accepts(beforeRestore))
        assertNull(state.current)
        state.adopt(owner, input())
        val beforeReadOnly = state.token()!!
        state.adopt(owner, input(focused = false).copy(readOnly = true))
        assertFalse(state.accepts(beforeReadOnly))
    }

    @Test
    fun engineSwapCannotReuseOldTokenEvenWithIdenticalNumericSessionId() {
        val state = TextInputSessionState()
        state.adopt(Any(), input())
        val old = state.token()!!
        state.adopt(Any(), input())
        assertFalse(state.accepts(old))
        val replacement = state.token()!!
        state.invalidate()
        assertFalse(state.accepts(replacement))
        assertNull(state.token())
    }

    @Test
    fun aNewSessionOfTheSameFieldAlsoInvalidatesThePreviousConnection() {
        val owner = Any()
        val state = TextInputSessionState()
        state.adopt(owner, input())
        val old = state.token()!!
        state.adopt(owner, input().copy(sessionId = 2), ownEdit = true)
        assertFalse(state.accepts(old))
        assertTrue(state.accepts(state.token()!!))
    }

    @Test
    fun jsonEventsPreserveQuotesEmojiAndUnpairedUtf16UnitsAcrossUtf8Transport() {
        val text = "quoted \" text \\ 😀 \uD83D tail \uDE00 \u0000"
        val payload = input().eventIdentity().put("text", text)
        val wire = textInputEventJson(payload)
        assertEquals(text, JSONObject(wire).getString("text"))
        assertTrue(wire.contains("\\ud83d tail \\ude00"))
        assertTrue(wire.contains("😀"))
        assertEquals(wire, String(wire.toByteArray(Charsets.UTF_8), Charsets.UTF_8))
        assertEquals(1L, JSONObject(wire).getLong("sessionId"))
        assertEquals(0L, JSONObject(wire).getLong("baseRevision"))
    }
}

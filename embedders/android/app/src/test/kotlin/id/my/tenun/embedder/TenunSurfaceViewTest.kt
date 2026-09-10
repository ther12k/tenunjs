package id.my.tenun.embedder

import org.junit.Assert.*
import org.junit.Test

class TenunSurfaceViewTest {

    @Test
    fun testCompositionReplacementNotAppend() {
        val state = EditableFieldState()

        // 1. Initial empty
        assertEquals("", state.displayText)

        // 2. Composing "k"
        state.setComposing("k")
        assertEquals("k", state.displayText)

        // 3. Composing "ka" - replaces "k", does NOT append to "kka"
        state.setComposing("ka")
        assertEquals("ka", state.displayText)

        // 4. Commit "か" - replaces composing region
        state.commit("か")
        assertEquals("か", state.displayText)
        assertEquals("", state.composingText)
        assertEquals("か", state.committedText)

        // 5. Subsequent composing "na"
        state.setComposing("na")
        assertEquals("かna", state.displayText)

        // 6. Commit "な"
        state.commit("な")
        assertEquals("かな", state.displayText)
        assertEquals("", state.composingText)
    }

    @Test
    fun testDeleteSurroundingText() {
        val state = EditableFieldState()
        state.commit("Hello")
        state.setComposing(" World")
        assertEquals("Hello World", state.displayText)

        // Deletes from composing region first
        state.deleteSurrounding(3)
        assertEquals("Hello Wo", state.displayText)

        // Deletes all composing
        state.deleteSurrounding(10)
        assertEquals("Hello", state.displayText)

        // Deletes from committed text
        state.deleteSurrounding(2)
        assertEquals("Hel", state.displayText)
    }

    @Test
    fun testSyncFromScene() {
        // Mirrors TenunSurfaceView.syncFromScene semantics (kept in sync by
        // hand; the view itself cannot be instantiated on the JVM):
        //  - non-empty scene values do NOT overwrite local field text (the JS
        //    application is the state authority; the view renders its own
        //    editing state),
        //  - an EMPTY scene value against non-empty local text resets the
        //    field (the app clears state only in ADD_ENTRY),
        //  - listItems rebuild the entries list.
        val titleField = EditableFieldState()
        val detailsField = EditableFieldState()
        val entries = mutableListOf<String>()

        fun syncFromScene(sceneJson: String) {
            val root = org.json.JSONObject(sceneJson)
            val children = root.getJSONObject("root").getJSONArray("children")
            entries.clear()
            for (i in 0 until children.length()) {
                val node = children.getJSONObject(i)
                when (node.getString("type")) {
                    "input" -> {
                        val f = node.getString("field")
                        val v = node.getString("value")
                        if (f == "title" && v.isEmpty() && titleField.displayText.isNotEmpty()) titleField.reset()
                        if (f == "details" && v.isEmpty() && detailsField.displayText.isNotEmpty()) detailsField.reset()
                    }
                    "listItem" -> {
                        val t = node.getString("title")
                        val d = node.getString("details")
                        entries.add(if (d.isNotEmpty()) "$t - $d" else t)
                    }
                }
            }
        }

        // Scene echoing non-empty values while the user is typing: local
        // editing state must be preserved, not replaced.
        titleField.commit("Buy Milk")
        detailsField.commit("2 Gallons")
        syncFromScene(
            """
            {
              "root": {
                "id": 0,
                "type": "column",
                "children": [
                  { "id": 1, "type": "input", "field": "title", "value": "Buy Milk" },
                  { "id": 2, "type": "input", "field": "details", "value": "2 Gallons" },
                  { "id": 3, "type": "button", "text": "Add Entry", "action": "ADD_ENTRY" },
                  { "id": 100, "type": "listItem", "title": "First Item", "details": "Notes" }
                ]
              },
              "entryCount": 1
            }
            """.trimIndent()
        )
        assertEquals("Buy Milk", titleField.displayText)
        assertEquals("2 Gallons", detailsField.displayText)
        assertEquals(1, entries.size)
        assertEquals("First Item - Notes", entries[0])

        // Post-ADD_ENTRY scene on the FIRST add: both values empty, first
        // listItem present, local entries list still empty before this sync.
        // Regression for the first-add clearing defect: the reset must not
        // depend on the entries list already being non-empty.
        syncFromScene(
            """
            {
              "root": {
                "id": 0,
                "type": "column",
                "children": [
                  { "id": 1, "type": "input", "field": "title", "value": "" },
                  { "id": 2, "type": "input", "field": "details", "value": "" },
                  { "id": 3, "type": "button", "text": "Add Entry", "action": "ADD_ENTRY" },
                  { "id": 100, "type": "listItem", "title": "Buy Milk", "details": "2 Gallons" }
                ]
              },
              "entryCount": 1
            }
            """.trimIndent()
        )
        assertEquals("", titleField.displayText)
        assertEquals("", detailsField.displayText)
        assertEquals(1, entries.size)
        assertEquals("Buy Milk - 2 Gallons", entries[0])
    }

    @Test
    fun testEmojiTextRoundTrip() {
        val field = EditableFieldState()
        field.commit("Note 😀")
        assertEquals("Note 😀", field.displayText)

        field.setComposing(" with チーム 🎉")
        assertEquals("Note 😀 with チーム 🎉", field.displayText)

        field.commit("")
        assertEquals("Note 😀 with チーム 🎉", field.displayText)
    }

    @Test
    fun testFocusTransferCommitsPreviousFieldWithoutBleed() {
        val titleField = EditableFieldState()
        val detailsField = EditableFieldState()

        // 1. User types in title
        titleField.commit("Project")
        titleField.setComposing(" Alpha")
        titleField.commit("")
        assertEquals("Project Alpha", titleField.displayText)

        // 2. Focus transfers to details
        detailsField.commit("Review ")
        detailsField.setComposing("Documentation")
        detailsField.commit("")

        // 3. Verify no bleed across fields
        assertEquals("Project Alpha", titleField.displayText)
        assertEquals("Review Documentation", detailsField.displayText)
    }
}

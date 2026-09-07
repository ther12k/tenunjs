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
        val titleField = EditableFieldState()
        val detailsField = EditableFieldState()
        val entries = mutableListOf<String>()

        val sceneJson = """
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

        val root = org.json.JSONObject(sceneJson)
        val children = root.getJSONObject("root").getJSONArray("children")
        for (i in 0 until children.length()) {
            val node = children.getJSONObject(i)
            when (node.getString("type")) {
                "input" -> {
                    if (node.getString("field") == "title") titleField.commit(node.getString("value"))
                    if (node.getString("field") == "details") detailsField.commit(node.getString("value"))
                }
                "listItem" -> {
                    val t = node.getString("title")
                    val d = node.getString("details")
                    entries.add("$t - $d")
                }
            }
        }

        assertEquals("Buy Milk", titleField.displayText)
        assertEquals("2 Gallons", detailsField.displayText)
        assertEquals(1, entries.size)
        assertEquals("First Item - Notes", entries[0])
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

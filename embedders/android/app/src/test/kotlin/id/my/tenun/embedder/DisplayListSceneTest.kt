package id.my.tenun.embedder

import org.junit.Assert.*
import org.junit.Test

/**
 * JVM-side tests for the display-list scene parser (gallery device bundle
 * contract). The legacy notes scene must NOT parse as a display list so the
 * TN-132 acceptance path stays authoritative.
 */
class DisplayListSceneTest {

    @Test
    fun testParsesOpsAndTaps() {
        val json = """
        {
          "tenun": "display-list",
          "version": 1,
          "designWidth": 720,
          "contentHeight": 1800,
          "background": "#101014",
          "ops": [
            { "op": "rect", "x": 0, "y": 0, "w": 720, "h": 96, "r": 0, "color": "#101014" },
            { "op": "outline", "x": 24, "y": 120, "w": 200, "h": 56, "r": 14, "color": "#4C8DFF", "width": 3 },
            { "op": "text", "x": 40, "y": 60, "text": "Tenun Gallery", "size": 30, "weight": 700, "color": "#F2F2F7" },
            { "op": "rect", "x": 0, "y": 0, "w": 720, "h": 320, "r": 28, "color": "#232330", "fixed": true, "anchor": "bottom", "anchorSize": 320 }
          ],
          "taps": [
            { "x": 24, "y": 120, "w": 200, "h": 56, "action": "tap", "payload": { "id": 0 } },
            { "x": 0, "y": 0, "w": 720, "h": 320, "action": "tap", "fixed": true, "anchor": "bottom", "anchorSize": 320, "payload": { "id": 1 } }
          ]
        }
        """.trimIndent()

        val scene = DisplayListScene.parse(json)
        assertNotNull(scene)
        assertEquals(720f, scene!!.designWidth)
        assertEquals(1800f, scene.contentHeight)
        assertEquals("#101014", scene.background)
        assertEquals(4, scene.ops.size)

        val rect = scene.ops[0] as DisplayListScene.Op.RectOp
        assertFalse(rect.rect.stroked)
        assertEquals(720f, rect.rect.w)

        val outline = scene.ops[1] as DisplayListScene.Op.RectOp
        assertTrue(outline.rect.stroked)
        assertEquals(3f, outline.rect.strokeWidth)

        val text = scene.ops[2] as DisplayListScene.Op.TextOp
        assertEquals("Tenun Gallery", text.text.text)
        assertEquals(700, text.text.weight)

        assertEquals(2, scene.taps.size)
        val tap = scene.taps[0]
        assertEquals("tap", tap.action)
        assertEquals("""{"id":0}""", tap.payloadJson)
        assertTrue(tap.contains(100f, 150f, 900f, 0f))
        assertFalse(tap.contains(500f, 500f, 900f, 0f))

        val fixed = scene.taps[1]
        assertTrue(fixed.fixed)
        assertEquals("bottom", fixed.anchor)
        assertEquals(320f, fixed.anchorSize)
        assertTrue(fixed.contains(100f, 700f, 900f, 2050f))
        assertFalse(fixed.contains(100f, 500f, 900f, 2050f))
    }

    @Test
    fun testLegacyNotesSceneIsNotADisplayList() {
        val legacy = """
        {
          "root": { "id": 0, "type": "column", "children": [
            { "id": 1, "type": "input", "field": "title", "value": "" }
          ]},
          "entryCount": 0
        }
        """.trimIndent()
        assertNull(DisplayListScene.parse(legacy))
    }

    @Test
    fun testMalformedJsonReturnsNull() {
        assertNull(DisplayListScene.parse("{not json"))
        assertNull(DisplayListScene.parse("""{"tenun":"display-list"}"""))
    }

    @Test
    fun testParsesKitOps() {
        val json = """
        {
          "tenun": "display-list",
          "ops": [
            { "op": "circle", "cx": 22, "cy": 22, "r": 22, "color": "#232F49" },
            { "op": "ring", "cx": 52, "cy": 52, "r": 42, "width": 10, "color": "#4C8DFF", "progress": 0.75, "track": "#2A2A35" },
            { "op": "line", "x1": 0, "y1": 10, "x2": 720, "y2": 10, "color": "#2E2E3A", "width": 1 },
            { "op": "gradient", "x": 24, "y": 0, "w": 672, "h": 148, "r": 22, "color": "#24345C", "colorTo": "#141A2B", "shadow": 14 }
          ]
        }
        """.trimIndent()

        val scene = DisplayListScene.parse(json)
        assertNotNull(scene)
        assertEquals(4, scene!!.ops.size)

        val circle = scene.ops[0] as DisplayListScene.Op.CircleOp
        assertEquals(22f, circle.r)

        val ring = scene.ops[1] as DisplayListScene.Op.RingOp
        assertEquals(0.75f, ring.progress)
        assertEquals("#2A2A35", ring.track)

        val line = scene.ops[2] as DisplayListScene.Op.LineOp
        assertEquals(720f, line.x2)

        val gradient = scene.ops[3] as DisplayListScene.Op.RectOp
        assertEquals("#141A2B", gradient.rect.colorTo)
        assertEquals(14f, gradient.rect.shadow)
        assertFalse(gradient.rect.stroked)
    }

    @Test
    fun testUnknownOpKindRejectsTheWholeScene() {
        // Fail-closed contract: a bundle newer than the host must fail
        // loudly, not render a partial interface with the unknown op
        // silently dropped.
        val json = """
        {
          "tenun": "display-list",
          "ops": [
            { "op": "text", "x": 0, "y": 0, "text": "ok" },
            { "op": "hologram", "x": 1 }
          ]
        }
        """.trimIndent()
        try {
            DisplayListScene.parse(json)
            fail("expected SceneContractException for unknown op kind")
        } catch (e: SceneContractException) {
            assertTrue(e.message!!.contains("hologram"))
        }
    }

    @Test
    fun testSceneVersionAboveHostSupportIsRejected() {
        val json = """
        {
          "tenun": "display-list",
          "version": 2,
          "ops": [ { "op": "text", "x": 0, "y": 0, "text": "future" } ]
        }
        """.trimIndent()
        try {
            DisplayListScene.parse(json)
            fail("expected SceneContractException for future scene version")
        } catch (e: SceneContractException) {
            assertTrue(e.message!!.contains("version 2"))
        }
        assertEquals(1, DisplayListScene.SUPPORTED_SCENE_VERSION)
    }

    @Test
    fun testPreAnchorBundleParsesWithDefaultsOff() {
        // Backward compatibility: a bundle from before the anchored-overlay
        // fields carries no fixed/anchor/anchorSize and must parse with all
        // of them defaulted off on this host.
        val json = """
        {
          "tenun": "display-list",
          "version": 1,
          "ops": [
            { "op": "rect", "x": 0, "y": 0, "w": 720, "h": 96, "r": 0, "color": "#101014" },
            { "op": "circle", "cx": 22, "cy": 22, "r": 22, "color": "#232F49" }
          ],
          "taps": [ { "x": 0, "y": 0, "w": 720, "h": 96, "action": "tap", "payload": { "id": 0 } } ]
        }
        """.trimIndent()
        val scene = DisplayListScene.parse(json)
        assertNotNull(scene)
        val rect = scene!!.ops[0] as DisplayListScene.Op.RectOp
        assertFalse(rect.rect.fixed)
        assertNull(rect.rect.anchor)
        assertNull(rect.rect.anchorSize)
        val circle = scene.ops[1] as DisplayListScene.Op.CircleOp
        assertFalse(circle.fixed)
        val tap = scene.taps[0]
        assertFalse(tap.fixed)
        assertNull(tap.anchor)
    }
}

package id.my.tenun.embedder

import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Log
import android.view.View
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.Locale

/**
 * TN-185 (ADR-0026 stage 3): the on-device parity harness. Every probe
 * scene renders through BOTH painters — the platform Canvas painter
 * (TenunSurfaceView.renderDisplayList, the production surface) and the
 * framework-owned Skia rasterizer (libtenun_skia_host.so) — and the same
 * geometric anchors must classify identically in both outputs. The view
 * is sized exactly to the scene's designWidth, so design units ARE
 * device pixels and anchor probes are unambiguous.
 *
 * Text ops paint with the device's Roboto pair injected into the Rust
 * renderer (Android has no fontconfig default inside the app process).
 *
 * The final test logs per-painter timings for the stage-2-vs-stage-1
 * measurement ADR-0026 requires before any production-surface switch.
 */
@RunWith(AndroidJUnit4::class)
class SkiaHostParityTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private lateinit var view: TenunSurfaceView

    private val w = 320
    private val h = 480

    @Before
    fun setUp() {
        assertTrue(
            "skia-host cdylib must be packaged on the device gate " +
                "(tools/skia-host/build-android.sh ran before the build)",
            SkiaHostBridge.available,
        )
        val regular = File("/system/fonts/Roboto-Regular.ttf")
        val bold = File("/system/fonts/Roboto-Bold.ttf")
        assertTrue("Roboto pair must exist on the device", regular.exists() && bold.exists())
        val rc = SkiaHostBridge.setTypefaces(regular.readBytes(), bold.readBytes())
        assertTrue("typeface injection failed: $rc", rc == 0)
        instrumentation.runOnMainSync {
            view = TenunSurfaceView(instrumentation.targetContext)
            view.measure(
                View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY),
            )
            view.layout(0, 0, w, h)
        }
    }

    /** (r, g, b, a) from an Android ARGB_8888 pixel int. */
    private fun argb(pixel: Int): IntArray = intArrayOf(
        (pixel shr 16) and 0xFF,
        (pixel shr 8) and 0xFF,
        pixel and 0xFF,
        (pixel shr 24) and 0xFF,
    )

    /** (r, g, b, a) from the Rust renderer's RGBA8888 byte buffer. */
    private fun rgba(bytes: ByteArray, x: Int, y: Int): IntArray {
        val i = (y * w + x) * 4
        return intArrayOf(
            bytes[i].toInt() and 0xFF,
            bytes[i + 1].toInt() and 0xFF,
            bytes[i + 2].toInt() and 0xFF,
            bytes[i + 3].toInt() and 0xFF,
        )
    }

    private fun sceneJson(ops: String): String =
        """{"tenun":"display-list","version":1,"designWidth":$w,"contentHeight":$h,""" +
            """"background":"#000000","ops":[$ops],"taps":[]}"""

    // ------- classifiers shared by both painters' outputs -------

    private fun isRed(p: IntArray) = p[0] > 200 && p[1] < 70 && p[2] < 70
    private fun isGreen(p: IntArray) = p[1] > 200 && p[0] < 70 && p[2] < 70
    private fun isBlue(p: IntArray) = p[2] > 200 && p[0] < 70 && p[1] < 70
    private fun isYellow(p: IntArray) = p[0] > 200 && p[1] > 200 && p[2] < 90
    private fun isMagenta(p: IntArray) = p[0] > 200 && p[2] > 200 && p[1] < 90
    private fun isOrange(p: IntArray) = p[0] > 200 && p[1] in 110..170 && p[2] < 90
    private fun isHalfWhiteOverBlack(p: IntArray) = p[0] in 100..160 && p[1] in 100..160 && p[2] in 100..160
    private fun isDark(p: IntArray) = p[0] < 80 && p[1] < 80 && p[2] < 80
    private fun isLight(p: IntArray) = p[0] > 170 && p[1] > 170 && p[2] > 170
    private fun isBackground(p: IntArray) = p[0] < 60 && p[1] < 60 && p[2] < 60
    private fun isWhiteInk(p: IntArray) = p[0] > 200 && p[1] > 200 && p[2] > 200

    /** A point whose color must satisfy [classify] in BOTH outputs. */
    private data class Anchor(val x: Int, val y: Int, val name: String, val classify: (IntArray) -> Boolean)

    /** A rectangle whose white-ink pixel count both outputs must satisfy. */
    private data class InkRegion(val name: String, val x0: Int, val y0: Int, val x1: Int, val y1: Int, val min: Int, val max: Int)

    private class Fixture(
        val name: String,
        val json: String,
        val anchors: List<Anchor> = emptyList(),
        val inkRegions: List<InkRegion> = emptyList(),
    )

    private fun dualRender(fixture: Fixture) {
        instrumentation.runOnMainSync { view.syncFromScene(fixture.json) }
        val committed = view.committedSceneForTest().first
        assertTrue("scene rejected by the Android parser: ${fixture.name}", committed != null)
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        instrumentation.runOnMainSync { view.renderDisplayListForTest(canvas, committed!!) }
        val skia = SkiaHostBridge.renderScene(fixture.json, w, h)
        assertTrue("skia-host rejected the scene: ${fixture.name}", skia != null)
        val skiaBytes = skia!!

        for (anchor in fixture.anchors) {
            val androidPx = argb(bitmap.getPixel(anchor.x, anchor.y))
            val skiaPx = rgba(skiaBytes, anchor.x, anchor.y)
            assertTrue(
                "${fixture.name}/${anchor.name}: Canvas painter pixel ${androidPx.toList()} failed",
                anchor.classify(androidPx),
            )
            assertTrue(
                "${fixture.name}/${anchor.name}: skia-host pixel ${skiaPx.toList()} failed",
                anchor.classify(skiaPx),
            )
        }
        for (region in fixture.inkRegions) {
            var androidInk = 0
            var skiaInk = 0
            var y = region.y0
            while (y <= region.y1) {
                var x = region.x0
                while (x <= region.x1) {
                    if (isWhiteInk(argb(bitmap.getPixel(x, y)))) androidInk++
                    if (isWhiteInk(rgba(skiaBytes, x, y))) skiaInk++
                    x++
                }
                y++
            }
            assertTrue(
                "${fixture.name}/${region.name}: Canvas ink $androidInk outside [${region.min}, ${region.max}]",
                androidInk in region.min..region.max,
            )
            assertTrue(
                "${fixture.name}/${region.name}: skia-host ink $skiaInk outside [${region.min}, ${region.max}]",
                skiaInk in region.min..region.max,
            )
        }
    }

    private fun fixtures(): List<Fixture> {
        val all = mutableListOf<Fixture>()

        fun scene(name: String, ops: String, vararg anchors: Anchor) {
            all.add(Fixture(name, sceneJson(ops), anchors.toList()))
        }

        scene(
            "solid rect",
            """{"op":"rect","x":40,"y":40,"w":240,"h":120,"r":0,"color":"#FF0000"}""",
            Anchor(160, 100, "fill center", ::isRed),
            Anchor(20, 100, "left of the rect", ::isBackground),
            Anchor(160, 300, "below the rect", ::isBackground),
        )
        scene(
            "rounded corners",
            """{"op":"rect","x":40,"y":40,"w":240,"h":120,"r":24,"color":"#FF0000"}""",
            Anchor(46, 46, "clipped corner", ::isBackground),
            Anchor(160, 100, "kept center", ::isRed),
        )
        scene(
            "outline stroke",
            """{"op":"outline","x":40,"y":40,"w":240,"h":120,"r":0,"color":"#00FF00","width":8}""",
            Anchor(160, 40, "on the stroke", ::isGreen),
            Anchor(160, 100, "hollow center", ::isBackground),
        )
        scene(
            "vertical gradient",
            """{"op":"gradient","x":40,"y":40,"w":240,"h":120,"r":0,"color":"#000000","colorTo":"#FFFFFF"}""",
            Anchor(160, 50, "dark stop", ::isDark),
            Anchor(160, 150, "light stop", ::isLight),
        )
        scene(
            "circle",
            """{"op":"circle","cx":160,"cy":100,"r":40,"color":"#0000FF"}""",
            Anchor(160, 100, "circle center", ::isBlue),
            Anchor(160, 130, "inside the rim", ::isBlue),
            Anchor(160, 170, "outside", ::isBackground),
        )
        scene(
            "full ring",
            """{"op":"ring","cx":160,"cy":100,"r":40,"width":8,"color":"#FFFF00","progress":1.0}""",
            Anchor(160, 60, "12 o'clock centerline", ::isYellow),
            Anchor(160, 100, "ring hole", ::isBackground),
        )
        scene(
            "half ring",
            """{"op":"ring","cx":160,"cy":100,"r":40,"width":8,"color":"#FFFF00","progress":0.5}""",
            Anchor(200, 100, "3 o'clock sweep end", ::isYellow),
            Anchor(120, 100, "9 o'clock unpainted", ::isBackground),
        )
        scene(
            "line",
            """{"op":"line","x1":20,"y1":100,"x2":300,"y2":100,"color":"#FF00FF","width":6}""",
            Anchor(160, 100, "on the line", ::isMagenta),
            Anchor(160, 90, "off the line", ::isBackground),
        )
        scene(
            "alpha blend",
            """{"op":"rect","x":40,"y":40,"w":240,"h":120,"r":0,"color":"#80FFFFFF"}""",
            Anchor(160, 100, "half-white over black", ::isHalfWhiteOverBlack),
            Anchor(160, 300, "outside stays black", ::isBackground),
        )
        scene(
            "scroll region clipping",
            """{"op":"scroll-region","id":"list","x":0,"y":0,"w":320,"h":200,"contentHeight":600,"ops":[""" +
                """{"op":"rect","x":0,"y":0,"w":320,"h":600,"r":0,"color":"#00FF00"}]}""",
            Anchor(160, 100, "inside the viewport", ::isGreen),
            Anchor(160, 300, "clipped below the viewport", ::isBackground),
        )
        scene(
            "fixed bottom overlay",
            // Authoring contract: op.y is a position INSIDE the anchored
            // region — anchorSize 60 + y 0 pins the band to
            // visibleHeight - 60 = 420..480 (the browser twin's
            // anchorOffset + my own desktop fixture agree; the first CI
            // run caught a y:420 fixture violating this).
            """{"op":"rect","x":0,"y":0,"w":320,"h":60,"r":0,"color":"#FF8800","fixed":true,"anchor":"bottom","anchorSize":60}""",
            Anchor(160, 450, "anchored band", ::isOrange),
            Anchor(160, 100, "body stays background", ::isBackground),
        )
        all.add(
            Fixture(
                "bold text ink",
                sceneJson(
                    """{"op":"text","x":20,"y":100,"text":"TENUN PARITY","size":40,"weight":700,"color":"#FFFFFF"}""",
                ),
                inkRegions = listOf(InkRegion("glyph band", 20, 55, 300, 100, min = 20, max = 100_000)),
            ),
        )
        all.add(
            Fixture(
                "clipped text hidden",
                sceneJson(
                    """{"op":"text","x":20,"y":100,"text":"TENUN PARITY","size":40,"weight":700,"color":"#FFFFFF",""" +
                        """"clip":{"x":0,"y":0,"w":320,"h":55}}""",
                ),
                // Glyphs live in y 55..100; the clip ends at 55 — no ink
                // may appear in that band in EITHER painter.
                inkRegions = listOf(InkRegion("below the clip", 20, 55, 300, 100, min = 0, max = 0)),
            ),
        )
        return all
    }

    @Test
    fun everyProbeSceneAgreesOnEveryAnchor() {
        for (fixture in fixtures()) dualRender(fixture)
    }

    /**
     * The stage-2-vs-stage-1 measurement ADR-0026 gates the production
     * switch on: average per-frame render time of BOTH painters on the
     * same rich scene (60 rects + 12 texts), logged for the evidence
     * record. The only hard bound is a pathological-regression guard.
     */
    @Test
    fun bothPaintersRenderARichSceneWithinBound() {
        val ops = buildString {
            for (i in 0 until 60) {
                append(
                    """{"op":"rect","x":${10 + (i % 6) * 50},"y":${10 + (i / 6) * 40},"w":40,"h":28,"r":8,"color":"#103040"},""",
                )
            }
            for (i in 0 until 12) {
                append(
                    """{"op":"text","x":20,"y":${60 + i * 35},"text":"row $i parity","size":18,"weight":400,"color":"#EAF3FC"},""",
                )
            }
        }.removeSuffix(",")
        val json = sceneJson(ops)

        instrumentation.runOnMainSync { view.syncFromScene(json) }
        val committed = view.committedSceneForTest().first
        assertTrue("rich scene rejected", committed != null)
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        val iterations = 30
        val canvasStart = System.nanoTime()
        repeat(iterations) { view.renderDisplayListForTest(canvas, committed!!) }
        val canvasAvgMs = (System.nanoTime() - canvasStart) / iterations / 1_000_000.0

        val probe = SkiaHostBridge.renderScene(json, w, h)
        assertTrue("skia-host must render the rich scene", probe != null)
        val skiaStart = System.nanoTime()
        repeat(iterations) { SkiaHostBridge.renderScene(json, w, h) }
        val skiaAvgMs = (System.nanoTime() - skiaStart) / iterations / 1_000_000.0

        Log.w(
            "TenunSkiaParity",
            "rich scene ${w}x$h avg/frame over $iterations: " +
                "Canvas=%.2fms skia-host=%.2fms".format(Locale.US, canvasAvgMs, skiaAvgMs),
        )
        assertTrue(
            "skia-host pathological regression: %.2fms".format(Locale.US, skiaAvgMs),
            skiaAvgMs < 100.0,
        )
    }
}

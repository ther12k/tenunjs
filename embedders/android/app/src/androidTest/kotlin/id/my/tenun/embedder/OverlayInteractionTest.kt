package id.my.tenun.embedder

import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/**
 * TN-132 installed-device acceptance, overlay scenario APK (gallery bundle
 * injected): one representative anchored-overlay interaction through the
 * production Android pointer path — the branch-specific integration case
 * the standard notes flows do not cover.
 *
 * Sequence (every tap is a real UiDevice click on the surface view):
 *  1. open the plant shop module from the gallery home hub,
 *  2. open the modal bottom sheet through its Filters button,
 *  3. assert the sheet is ANCHORED in the bottom viewport region (the
 *     committed scene's fixed/anchor metadata resolved against the live
 *     viewport — placement, not mere presence in the JSON),
 *  4. tap the scrim exactly over the covered Filters button: the sheet must
 *     dismiss and the covered control must NOT fire (if its action leaked
 *     through, the sheet would immediately reopen),
 *  5. tap the now-uncovered Filters button: the sheet opens (the control
 *     works — the previous step was interception, not a broken button),
 *  6. tap the sheet's own confirm control: it applies and closes.
 */
@RunWith(AndroidJUnit4::class)
class OverlayInteractionTest : DeviceAcceptanceBase() {

    @Test
    fun bottomSheetAnchorsAndScrimBlocksCoveredControl() {
        val scenario = launchApp()

        // 1) Gallery bundle booted; open the plant shop through real input
        //    (module cards: the Open button on the card's row).
        awaitDisplayScene(scenario, 20_000, "gallery display-list scene committed") {
            sceneTexts(it).isNotEmpty()
        }
        screencap("tenun_overlay_home.png")
        tapSceneModule(scenario, "Plant shop")
        awaitDisplayScene(scenario, 10_000, "plant shop screen after module tap") { scene ->
            sceneTexts(scene).contains("Find your plant")
        }
        screencap("tenun_overlay_plants.png")

        // 2) Open the modal bottom sheet through its real button.
        tapSceneText(scenario, "Filters")
        awaitDisplayScene(scenario, 10_000, "bottom sheet open") { scene ->
            sceneTexts(scene).contains("Filter plants")
        }
        screencap("tenun_overlay_sheet.png")

        // 3) Placement: the committed scene must carry the sheet as a
        //    bottom-ANCHORED fixed rect whose resolved bottom edge lands on
        //    the live viewport bottom, plus a full-viewport fixed scrim.
        onViewSurface(scenario) { v ->
            val (scene, _) = v.committedSceneForTest()
            assertNotNull("sheet open but no committed scene", scene)
            val scale = v.width.toFloat() / scene!!.designWidth
            val visibleDesign = v.height.toFloat() / scale
            val rects = scene.ops.filterIsInstance<DisplayListScene.Op.RectOp>().map { it.rect }
            val sheet = rects.firstOrNull {
                it.fixed && it.anchor == "bottom" && it.anchorSize != null && it.h > 200f
            } ?: throw AssertionError("no bottom-anchored sheet rect in the committed scene")
            val anchorOffset = visibleDesign - sheet.anchorSize!!
            val sheetTop = sheet.y + anchorOffset
            val sheetBottom = sheetTop + sheet.h
            assertTrue(
                "sheet must sit in the bottom viewport region (top=$sheetTop visible=$visibleDesign)",
                sheetTop > visibleDesign * 0.4f,
            )
            assertTrue(
                "sheet bottom edge must align with the viewport bottom " +
                    "(off by ${abs(sheetBottom - visibleDesign)} design units)",
                abs(sheetBottom - visibleDesign) <= 2f,
            )
            assertTrue(
                "a full-viewport fixed scrim must cover the content above the sheet",
                rects.any { it.fixed && it.h > 2000f },
            )
        }

        // 4) Resolve the Filters button's region center in the CURRENT
        //    (sheet-open) scene, then tap that exact point: the topmost
        //    region there is the scrim, so the expected outcome is
        //    dismissal with NO Filters action.
        val coveredCenter = onViewSurface(scenario) { v ->
            val (sceneNullable, scroll) = v.committedSceneForTest()
            val scene = sceneNullable ?: throw AssertionError("sheet open but no committed scene")
            val scale = v.width.toFloat() / scene.designWidth
            // The Filters button region still exists in the scene; the scrim
            // registered later wins dispatch at that point.
            val filters = scene.taps.firstOrNull { tap ->
                // A content (non-fixed) 64-unit-tall region in the caption
                // row, right-hand side — the M3 Button anatomy.
                !tap.fixed && tap.h == 64f && tap.x + tap.w > scene.designWidth - 260f
            } ?: throw AssertionError("could not resolve the Filters button region")
            val regionY = filters.y - scroll
            ((filters.x + filters.w / 2f) * scale).toInt() to ((regionY + filters.h / 2f) * scale).toInt()
        }
        assertTrue(
            "UiDevice scrim tap over the covered Filters button failed",
            device.click(coveredCenter.first, coveredCenter.second),
        )
        awaitDisplayScene(scenario, 10_000, "sheet dismissed by the scrim tap") { scene ->
            !sceneTexts(scene).contains("Filter plants")
        }
        // The covered control must NOT have fired: give a reopen a fair
        // window, then the sheet must still be closed and the Filters
        // button still present (dismissFilters, not openFilters, ran).
        SystemClock.sleep(1_000)
        awaitDisplayScene(scenario, 2_000, "sheet stays closed; Filters did not leak through") { scene ->
            val texts = sceneTexts(scene)
            !texts.contains("Filter plants") && texts.contains("Filters")
        }
        screencap("tenun_overlay_scrim_dismiss.png")

        // 5) The now-uncovered control works: tapping Filters opens the sheet.
        tapSceneText(scenario, "Filters")
        awaitDisplayScene(scenario, 10_000, "sheet reopens via the uncovered Filters button") { scene ->
            sceneTexts(scene).contains("Filter plants")
        }

        // 6) The sheet's own nested control works through the pointer path.
        tapSceneText(scenario, "Apply filters")
        awaitDisplayScene(scenario, 10_000, "confirm applies and closes the sheet") { scene ->
            !sceneTexts(scene).contains("Filter plants")
        }
        screencap("tenun_overlay_after.png")
    }
}

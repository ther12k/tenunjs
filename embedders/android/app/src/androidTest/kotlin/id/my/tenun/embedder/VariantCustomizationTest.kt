package id.my.tenun.embedder

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * TN-132 acceptance 3: a JavaScript-only customization of tenun_app.js
 * (button label "Submit Note", entry prefix "[Task] ") must be visible on
 * screen. The APK under test is the standard build with ONLY the JS asset
 * replaced and re-signed — no C/Kotlin implementation changes.
 *
 * The installed artifact's identity is enforced by the acceptance script
 * (pushed digest == digest pulled back from the device via `pm path`).
 */
@RunWith(AndroidJUnit4::class)
class VariantCustomizationTest : DeviceAcceptanceBase() {

    @Test
    fun jsOnlyCustomizationVisibleOnScreen() {
        val scenario = launchApp()
        awaitSurfaceState(scenario, 10_000, "variant initial scene with JS-provided button label") {
            it.engine != null && it.buttonLabel == "Submit Note"
        }
        dismissImeIfShown()
        screencap("tenun_variant_initial.png")
        // Screen-level proof 1: the button region no longer matches the
        // standard APK's baseline rendering.
        assertRegionDiffersFromBaseline(scenario, "tenun_variant_initial.png", { it.buttonRect }, 300, "button label")

        // INPUT METHOD: direct InputConnection adapter calls (recorded; the
        // on-screen proof here is the rendered scene, not the input path).
        commitViaInputConnection(scenario, "title", "Write Docs")
        commitViaInputConnection(scenario, "details", "Via JS only")
        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "variant entry rendered with the [Task] prefix") {
            it.entries.size == 1 && it.entries[0] == "[Task] Write Docs - Via JS only"
        }
        onViewSurface(scenario) { v ->
            assertTrue(
                "committed scene must contain the prefixed entry",
                v.engine!!.getLatestScene().contains("[Task] Write Docs")
            )
        }
        dismissImeIfShown()
        screencap("tenun_variant_after.png")
        // Screen-level proof 2: the entries region differs from the standard
        // APK baseline (prefixed single entry vs two unprefixed entries).
        assertRegionDiffersFromBaseline(scenario, "tenun_variant_after.png", { ENTRIES_REGION }, 100, "entries list")
        assertEquals(
            "variant entry text must carry the JavaScript-provided [Task] prefix",
            "[Task] Write Docs - Via JS only",
            onViewSurface(scenario) { it.entries[0] }
        )
    }
}

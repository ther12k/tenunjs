package id.my.tenun.embedder

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * TN-132 installed-device acceptance, standard APK: the two-entry application
 * loop on a booted emulator through the production Android input paths, the
 * Unicode round-trip under CheckJNI, and a real Activity recreation.
 *
 * Input methods are deliberately distinct and recorded per scenario:
 *  - imeSessionTwoEntryLoop: a real soft-IME session (LatinIME) fed by
 *    synthetic hardware-key events, i.e. key events delivered through the
 *    active InputMethodSession to the view's InputConnection.
 *  - unicodeRoundTrip / baseline / lifecycle text entry: direct
 *    InputConnection adapter calls (see [DeviceAcceptanceBase.commitViaInputConnection])
 *    — adapter-level evidence, not an IME session; no IME can type the
 *    emoji/Japanese samples on the AOSP keyboard.
 */
@RunWith(AndroidJUnit4::class)
class DeviceAcceptanceTest : DeviceAcceptanceBase() {

    @Test
    fun initialSceneDisplayed() {
        val scenario = launchApp()
        awaitSurfaceState(scenario, 10_000, "engine attached with committed initial scene") {
            it.engine != null && it.buttonLabel == "Add Entry"
        }
        awaitSurfaceState(scenario, 10_000, "initial inputs empty and no entries") {
            it.titleField.displayText.isEmpty() &&
                it.detailsField.displayText.isEmpty() &&
                it.entries.isEmpty()
        }
        onViewSurface(scenario) { v ->
            val scene = v.engine!!.getLatestScene()
            assertTrue("initial committed scene must contain the placeholder inputs", scene.contains("\"value\":\"\""))
            assertTrue("initial committed scene must contain the button", scene.contains("Add Entry"))
        }
        dismissImeIfShown()
        screencap("tenun_initial.png")
    }

    @Test
    fun imeSessionTwoEntryLoop() {
        val scenario = launchApp()
        awaitSurfaceState(scenario, 10_000, "initial scene ready") { it.engine != null }

        // -- Entry 1: real IME session typed via hardware-key events --------
        tapRect(scenario) { it.titleRect }
        awaitImeActive()
        shell("input text Note")
        awaitSurfaceState(scenario, 20_000, "title 'Note' committed through the IME session") {
            it.titleField.displayText == "Note"
        }

        tapRect(scenario) { it.detailsRect }
        awaitImeActive()
        shell("input text Plan%sthe%ssprint")
        awaitSurfaceState(scenario, 20_000, "details 'Plan the sprint' committed through the IME session") {
            it.detailsField.displayText == "Plan the sprint"
        }

        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "entry 1 visible and both inputs cleared") {
            it.entries.size == 1 &&
                it.entries[0] == "Note - Plan the sprint" &&
                it.titleField.displayText.isEmpty() &&
                it.detailsField.displayText.isEmpty()
        }
        onViewSurface(scenario) { v ->
            val scene = v.engine!!.getLatestScene()
            assertTrue("committed scene must contain entry 1 title", scene.contains("\"Note\""))
            assertTrue("committed scene must contain entry 1 details", scene.contains("Plan the sprint"))
        }
        dismissImeIfShown()
        screencap("tenun_after_entry1.png")

        // -- Entry 2: same loop again ---------------------------------------
        tapRect(scenario) { it.titleRect }
        awaitImeActive()
        shell("input text Second%ssample")
        awaitSurfaceState(scenario, 20_000, "title 'Second sample' committed through the IME session") {
            it.titleField.displayText == "Second sample"
        }

        tapRect(scenario) { it.detailsRect }
        awaitImeActive()
        shell("input text Second%stoo")
        awaitSurfaceState(scenario, 20_000, "details 'Second too' committed through the IME session") {
            it.detailsField.displayText == "Second too"
        }

        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "entry 2 visible and both inputs cleared") {
            it.entries.size == 2 &&
                it.entries[1] == "Second sample - Second too" &&
                it.titleField.displayText.isEmpty() &&
                it.detailsField.displayText.isEmpty()
        }
        dismissImeIfShown()
        screencap("tenun_two_entries.png")
    }

    @Test
    fun unicodeRoundTripThroughProductionJni() {
        val scenario = launchApp()
        awaitSurfaceState(scenario, 10_000, "initial scene ready") { it.engine != null }

        // INPUT METHOD: direct InputConnection adapter calls (not an IME
        // session). Exercises Kotlin String -> production JNI -> QuickJS ->
        // committed scene -> production JNI -> Kotlin String under CheckJNI.
        val title = commitViaInputConnection(scenario, "title", "Note \uD83D\uDE00")
        assertEquals("Note \uD83D\uDE00", title)
        val details = commitViaInputConnection(scenario, "details", "チーム \uD83C\uDF89")
        assertEquals("チーム \uD83C\uDF89", details)

        onViewSurface(scenario) { v ->
            val scene = v.engine!!.getLatestScene()
            assertTrue(
                "committed scene must round-trip the emoji title through the production JNI path",
                scene.contains("Note \uD83D\uDE00")
            )
            assertTrue(
                "committed scene must round-trip the Japanese/emoji details through the production JNI path",
                scene.contains("チーム \uD83C\uDF89")
            )
        }

        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "Unicode entry rendered with inputs cleared") {
            it.entries.size == 1 &&
                it.entries[0] == "Note \uD83D\uDE00 - チーム \uD83C\uDF89" &&
                it.titleField.displayText.isEmpty() &&
                it.detailsField.displayText.isEmpty()
        }
        dismissImeIfShown()
        screencap("tenun_unicode_entry.png")
    }

    @Test
    fun lifecycleRecreateThenInteraction() {
        val scenario = launchApp()
        awaitSurfaceState(scenario, 10_000, "initial scene ready") { it.engine != null }
        val originalSurface = findSurface(scenario)

        commitViaInputConnection(scenario, "title", "Before Restart")
        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "pre-recreation entry committed") { it.entries.size == 1 }

        // REAL recreation through the framework: onDestroy -> onCreate with
        // real surface destruction/creation. Manually calling
        // surfaceDestroyed/surfaceCreated does not satisfy TN-132 5.
        scenario.recreate()
        val recreatedSurface = findSurface(scenario)
        assertFalse("recreation must produce a new view instance", recreatedSurface === originalSurface)

        // The recreated activity builds a fresh engine, so the JS state is a
        // documented in-memory reset (allowed by TN-132). What must not happen
        // is accessing disposed state or stale callbacks.
        awaitSurfaceState(scenario, 10_000, "recreated activity serves a fresh committed scene") {
            it.engine != null && it.entries.isEmpty() && it.titleField.displayText.isEmpty()
        }

        commitViaInputConnection(scenario, "title", "After Restart")
        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "post-recreation interaction succeeds") {
            it.entries.size == 1 && it.entries[0] == "After Restart"
        }
        dismissImeIfShown()
        screencap("tenun_after_recreation.png")
    }

    /**
     * Produces the standard-APK baseline screenshot that the variant suite
     * compares against for screen-level proof of the JS-only customization.
     * Self-contained so suite order does not matter.
     */
    @Test
    fun captureVariantBaseline() {
        val scenario = launchApp()
        awaitSurfaceState(scenario, 10_000, "initial scene ready") { it.engine != null }

        commitViaInputConnection(scenario, "title", "Baseline One")
        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "baseline entry 1") { it.entries.size == 1 }

        commitViaInputConnection(scenario, "title", "Baseline Two")
        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "baseline entry 2") { it.entries.size == 2 }

        dismissImeIfShown()
        screencap("tenun_baseline.png")
    }
}

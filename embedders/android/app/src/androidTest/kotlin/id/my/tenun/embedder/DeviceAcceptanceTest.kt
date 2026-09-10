package id.my.tenun.embedder

import android.graphics.RectF
import androidx.test.core.app.ActivityScenario
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
 *  - imeSessionTwoEntryLoop: a real soft-IME session (LatinIME). Preferred
 *    path is tapping the keyboard's own soft keys (genuine user keystrokes);
 *    if key nodes are unreachable it falls back to synthetic hardware-key
 *    events delivered through the active InputMethodSession, and the mode
 *    actually used is printed and asserted (at least one field must come
 *    from real soft-key taps).
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

    /**
     * Types [text] into one field through the IME with a bounded retry
     * cycle. Delivery can stall when the IME session is mid-rebind after a
     * field switch (observed once: both soft-key taps and key-event
     * injection landed nothing for 20s while focus and the IME state looked
     * ready); a retry re-taps, forces a clean IME restart, clears any
     * partial text through the production delete path, and re-enters. The
     * final text equality is strictly enforced regardless of attempts.
     */
    private fun typeIntoFieldViaIme(
        scenario: ActivityScenario<MainActivity>,
        field: String,
        text: String,
        rectSelector: (TenunSurfaceView) -> RectF,
    ): ImeMode {
        var mode = ImeMode.KEY_EVENT_INJECTION
        for (attempt in 1..3) {
            if (attempt > 1) {
                // Force a fresh IME session and remove partial text.
                dismissImeIfShown()
                tapRect(scenario, rectSelector)
                awaitViewFocus(scenario)
                clearActiveFieldViaInputConnection(scenario)
            }
            tapRect(scenario, rectSelector)
            awaitViewFocus(scenario)
            awaitImeActive()
            mode = enterTextViaIme(scenario, field, text)
            if (pollSurfaceState(scenario, 8_000) {
                    (if (it.getActiveFieldState() === it.titleField) it.titleField else it.detailsField)
                        .displayText == text
                }
            ) {
                println("INPUT-METHOD-ATTEMPTS[$field]: attempt $attempt succeeded ($mode)")
                return mode
            }
        }
        awaitSurfaceState(
            scenario, 20_000,
            "'$text' committed through the IME session in field '$field' (3 attempts)"
        ) {
            (if (it.getActiveFieldState() === it.titleField) it.titleField else it.detailsField)
                .displayText == text
        }
        return mode
    }

    @Test
    fun imeSessionTwoEntryLoop() {
        val scenario = launchApp()
        awaitSurfaceState(scenario, 10_000, "initial scene ready") { it.engine != null }

        // -- Entry 1: real IME session (soft-key taps preferred; key-event
        //    injection recorded as fallback) ------------------------------
        val mode1 = typeIntoFieldViaIme(scenario, "title", "note") { it.titleRect }

        val mode2 = typeIntoFieldViaIme(scenario, "details", "plan the sprint") { it.detailsRect }

        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "entry 1 visible and both inputs cleared") {
            it.entries.size == 1 &&
                it.entries[0] == "note - plan the sprint" &&
                it.titleField.displayText.isEmpty() &&
                it.detailsField.displayText.isEmpty()
        }
        onViewSurface(scenario) { v ->
            val scene = v.engine!!.getLatestScene()
            assertTrue("committed scene must contain entry 1 title", scene.contains("\"note\""))
            assertTrue("committed scene must contain entry 1 details", scene.contains("plan the sprint"))
        }
        dismissImeIfShown()
        screencap("tenun_after_entry1.png")

        // -- Entry 2: same loop again ---------------------------------------
        val mode3 = typeIntoFieldViaIme(scenario, "title", "second sample") { it.titleRect }

        val mode4 = typeIntoFieldViaIme(scenario, "details", "second too") { it.detailsRect }

        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "entry 2 visible and both inputs cleared") {
            it.entries.size == 2 &&
                it.entries[1] == "second sample - second too" &&
                it.titleField.displayText.isEmpty() &&
                it.detailsField.displayText.isEmpty()
        }
        val summary = "INPUT-METHOD[imeSessionTwoEntryLoop]: title1=$mode1 details1=$mode2 title2=$mode3 details2=$mode4"
        println(summary)
        assertTrue(
            "at least one field must be typed through real LatinIME soft-key taps (modes: $summary)",
            listOf(mode1, mode2, mode3, mode4).any { it == ImeMode.SOFT_KEY_TAPS }
        )
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
        // The samples include quote characters: they must survive JSON
        // transport (an unescaped payload would silently drop the update).
        val expectedTitle = "Note \uD83D\uDE00"
        val expectedDetails = "チーム \"本番\" \uD83C\uDF89"
        val title = commitViaInputConnection(scenario, "title", expectedTitle)
        assertEquals(expectedTitle, title)
        val details = commitViaInputConnection(scenario, "details", expectedDetails)
        assertEquals(expectedDetails, details)

        onViewSurface(scenario) { v ->
            // Parse the committed scene and compare exact input values rather
            // than substrings: JSON-escaped text would defeat contains().
            val children = org.json.JSONObject(v.engine!!.getLatestScene())
                .getJSONObject("root")
                .getJSONArray("children")
            var titleValue: String? = null
            var detailsValue: String? = null
            for (i in 0 until children.length()) {
                val node = children.getJSONObject(i)
                if (node.optString("type") == "input") {
                    when (node.optString("field")) {
                        "title" -> titleValue = node.getString("value")
                        "details" -> detailsValue = node.getString("value")
                    }
                }
            }
            assertEquals(
                "emoji title must round-trip exactly through the production JNI path",
                expectedTitle, titleValue
            )
            assertEquals(
                "Japanese + quotes + emoji details must round-trip exactly through the production JNI path",
                expectedDetails, detailsValue
            )
        }

        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "Unicode entry rendered with inputs cleared") {
            it.entries.size == 1 &&
                it.entries[0] == "$expectedTitle - $expectedDetails" &&
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

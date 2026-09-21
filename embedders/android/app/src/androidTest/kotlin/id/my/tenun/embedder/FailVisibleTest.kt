package id.my.tenun.embedder

import android.os.SystemClock
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Fail-visible startup handling, driven deterministically through the
 * test-only init-failure injection (this class runs ONLY against builds
 * compiled with -Ptenun.testInjection=true — the device acceptance
 * fail-visible stage; the hook symbol is absent from every other build).
 *
 * The intermittent incident is NOT used here: every failure is forced.
 *
 * Required outcomes:
 *  - forced boot failure (pre-runtime stage) and forced evaluation failure
 *    both render the explicit host-owned error panel — never the legacy
 *    notes UI and never an engine-less interactive surface;
 *  - recreating while the failure is injected keeps the failure explicit
 *    (no stale ready scene is resurrected);
 *  - clearing the injection and launching fresh boots normally and
 *    interacts (proving the panel was a failure state, not a new normal).
 */
@RunWith(AndroidJUnit4::class)
class FailVisibleTest : DeviceAcceptanceBase() {

    private fun currentActivity(scenario: ActivityScenario<MainActivity>): MainActivity {
        var activity: MainActivity? = null
        scenario.onActivity { activity = it }
        return checkNotNull(activity) { "no current activity" }
    }

    private fun awaitStartupFailed(scenario: ActivityScenario<MainActivity>, timeoutMs: Long = 10_000) {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            if (currentActivity(scenario).startupFailed) return
            SystemClock.sleep(200)
        }
        fail("terminal startup-failure state never became visible")
    }

    private fun collectTexts(view: android.view.View, into: MutableList<String>) {
        if (view is TextView) into.add(view.text.toString())
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) collectTexts(view.getChildAt(i), into)
        }
    }

    private fun assertExplicitFailureState(scenario: ActivityScenario<MainActivity>) {
        val activity = currentActivity(scenario)
        assertTrue("activity must report terminal startup failure", activity.startupFailed)
        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        val child = content.getChildAt(0)
        assertTrue(
            "failure state must NOT be the render surface (no engine-less interactive UI)",
            child !is TenunSurfaceView,
        )
        val texts = mutableListOf<String>()
        collectTexts(child, texts)
        assertTrue("error panel headline missing: $texts", texts.any { it.contains("Unable to start this app.") })
        assertTrue("error reference missing: $texts", texts.any { it.contains("Error reference:") })
    }

    @Test
    fun forcedBootFailureIsExplicit() {
        TenunEngine.setTestInitInjection(TenunEngine.INIT_ENGINE_ALLOC)
        try {
            val scenario = launchApp()
            awaitStartupFailed(scenario)
            assertExplicitFailureState(scenario)
            screencap("tenun_failvisible_alloc.png")
        } finally {
            TenunEngine.setTestInitInjection(TenunEngine.INIT_OK)
        }
    }

    @Test
    fun forcedEvaluationFailureIsExplicit() {
        TenunEngine.setTestInitInjection(TenunEngine.INIT_SCRIPT_EVAL)
        try {
            val scenario = launchApp()
            awaitStartupFailed(scenario)
            assertExplicitFailureState(scenario)
            screencap("tenun_failvisible_eval.png")
        } finally {
            TenunEngine.setTestInitInjection(TenunEngine.INIT_OK)
        }
    }

    @Test
    fun recreationWhileInjectedStaysFailed() {
        TenunEngine.setTestInitInjection(TenunEngine.INIT_ENGINE_ALLOC)
        try {
            val scenario = launchApp()
            awaitStartupFailed(scenario)
            assertExplicitFailureState(scenario)
            scenario.recreate()
            awaitStartupFailed(scenario)
            assertExplicitFailureState(scenario)
            screencap("tenun_failvisible_recreated.png")
        } finally {
            TenunEngine.setTestInitInjection(TenunEngine.INIT_OK)
        }
    }

    @Test
    fun injectionRemovedFreshLaunchBootsNormally() {
        TenunEngine.setTestInitInjection(TenunEngine.INIT_OK)
        val scenario = launchApp()
        awaitSurfaceState(scenario, 10_000, "normal boot after clearing injection") {
            it.engine != null && it.buttonLabel == "Add Entry"
        }
        onViewSurface(scenario) { v ->
            // Pin the bundle, not just the label default: the recovery flow
            // drives the stock notes reference app, and a leaked gallery
            // overlay asset would boot a different UI entirely.
            val scene = v.engine!!.getLatestScene()
            assertTrue("fresh boot must run the stock notes reference app", scene.contains("Add Entry"))
        }
        // The stock bundle's Add Entry only commits when the input fields
        // carry text (an empty-input tap is a documented no-op), so mirror
        // the standard suite's canonical flow: commit both fields through
        // the IME, then tap the button.
        typeIntoFieldViaIme(scenario, "title", "recovered") { it.titleRect }
        typeIntoFieldViaIme(scenario, "details", "fresh boot works") { it.detailsRect }
        tapRect(scenario) { it.buttonRect }
        awaitSurfaceState(scenario, 10_000, "interaction works on the fresh boot") {
            it.entries.size == 1 &&
                it.entries[0] == "recovered - fresh boot works" &&
                it.titleField.displayText.isEmpty() &&
                it.detailsField.displayText.isEmpty()
        }
        screencap("tenun_failvisible_recovered.png")
    }
}

package id.my.tenun.embedder

import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.RectF
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import kotlin.math.abs

/**
 * Shared plumbing for the TN-132 installed-device acceptance suite. Everything
 * here runs against a real booted emulator: screenshots are captured as the
 * shell user so the acceptance script can pull them, and every activity is
 * launched through the real framework (ActivityScenario), never by calling
 * surface/engine callbacks manually.
 */
abstract class DeviceAcceptanceBase {

    protected val instrumentation = InstrumentationRegistry.getInstrumentation()
    protected val device: UiDevice by lazy { UiDevice.getInstance(instrumentation) }
    protected val imm: InputMethodManager
        get() = instrumentation.targetContext
            .getSystemService(InputMethodManager::class.java)

    private val scenarios = mutableListOf<ActivityScenario<MainActivity>>()

    @After
    fun closeScenarios() {
        scenarios.forEach { runCatching { it.close() } }
        scenarios.clear()
    }

    protected fun launchApp(): ActivityScenario<MainActivity> {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        scenarios.add(scenario)
        return scenario
    }

    /** Runs [block] on the main thread against the activity's TenunSurfaceView. */
    protected fun <T> onViewSurface(scenario: ActivityScenario<MainActivity>, block: (TenunSurfaceView) -> T): T {
        var result: T? = null
        scenario.onActivity { activity ->
            val content = activity.findViewById<ViewGroup>(android.R.id.content)
            result = block(content.getChildAt(0) as TenunSurfaceView)
        }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    protected fun findSurface(scenario: ActivityScenario<MainActivity>): TenunSurfaceView =
        onViewSurface(scenario) { it }

    protected fun launchAndFind(): Pair<ActivityScenario<MainActivity>, TenunSurfaceView> {
        val scenario = launchApp()
        return scenario to findSurface(scenario)
    }

    protected fun describeSurface(scenario: ActivityScenario<MainActivity>): String =
        onViewSurface(scenario) { v ->
            "focus=${v.hasFocus()} active=${if (v.getActiveFieldState() === v.titleField) "title" else "details"} " +
                "title='${v.titleField.displayText}' details='${v.detailsField.displayText}' " +
                "entries=${v.entries} buttonLabel='${v.buttonLabel}'"
        }

    /** Polls main-thread surface state until [predicate] holds or the timeout elapses. */
    protected fun awaitSurfaceState(
        scenario: ActivityScenario<MainActivity>,
        timeoutMs: Long,
        description: String,
        predicate: (TenunSurfaceView) -> Boolean,
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (true) {
            if (onViewSurface(scenario) { predicate(it) }) return
            val last = describeSurface(scenario)
            if (SystemClock.uptimeMillis() > deadline) {
                fail(
                    "Timed out after ${timeoutMs}ms waiting for: $description; last state: $last; " +
                        inputEnvironmentDiagnosis()
                )
            }
            SystemClock.sleep(200)
        }
    }

    private fun inputEnvironmentDiagnosis(): String = runCatching {
        val immDump = shell("dumpsys input_method 2>/dev/null | grep -E 'mInputShown|mCurMethodId|mCurClient|mHaveConnection' | head -4")
        val focus = shell("dumpsys window windows 2>/dev/null | grep mCurrentFocus | head -1")
        "input env: [$immDump] focus: [$focus]"
    }.getOrDefault("input environment diagnosis unavailable")

    /**
     * Taps the center of a scene rect through the system touch pipeline
     * (UiDevice). The fullscreen theme means view coordinates equal display
     * coordinates.
     */
    protected fun tapRect(scenario: ActivityScenario<MainActivity>, rectSelector: (TenunSurfaceView) -> RectF) {
        val (x, y) = onViewSurface(scenario) { v ->
            val r = rectSelector(v)
            ((r.left + r.right) / 2f).toInt() to ((r.top + r.bottom) / 2f).toInt()
        }
        assertTrue("UiDevice tap at ($x, $y) failed", device.click(x, y))
    }

    /**
     * DIRECT ADAPTER PATH (recorded input method): drives the view's own
     * InputConnection from the instrumentation main thread. This is NOT a
     * live IME session; it exercises the production JNI/QuickJS conversion
     * chain under CheckJNI. Used where the AOSP keyboard cannot produce the
     * required characters (emoji, Japanese).
     */
    protected fun commitViaInputConnection(
        scenario: ActivityScenario<MainActivity>,
        field: String,
        text: String,
    ): String = onViewSurface(scenario) { v ->
        v.transferFocus(field)
        val ic = v.onCreateInputConnection(EditorInfo())
        assertNotNull("onCreateInputConnection returned null for $field", ic)
        assertTrue("commitText was rejected for $field", ic!!.commitText(text, 1))
        v.getActiveFieldState().displayText
    }

    private fun imeShown(): Boolean {
        val viaImm = runCatching { imm.isAcceptingText }.getOrDefault(false)
        val viaDumpsys = shell("dumpsys input_method").contains("mInputShown=true")
        return viaImm || viaDumpsys
    }

    /** Verifies the system touch actually landed on the surface view before
     *  any IME expectations are made. */
    protected fun awaitViewFocus(scenario: ActivityScenario<MainActivity>, timeoutMs: Long = 10_000) {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            if (onViewSurface(scenario) { it.hasFocus() }) return
            SystemClock.sleep(200)
        }
        fail("surface view never gained window focus after tap; " + inputEnvironmentDiagnosis())
    }

    protected fun awaitImeActive() {
        val deadline = SystemClock.uptimeMillis() + 15_000
        while (SystemClock.uptimeMillis() < deadline) {
            if (imeShown()) return
            SystemClock.sleep(250)
        }
        fail(
            "DEVICE INPUT ENVIRONMENT: soft IME never became active after field tap. " +
                "input_method state:\n" +
                shell("dumpsys input_method 2>/dev/null | grep -E 'mInputShown|mCurMethodId|mCurClient|mHaveConnection|mSystemServiceManaged' | head -6")
        )
    }

    /** Closes the keyboard with BACK only when it is actually shown, so a
     *  screenshot reflects the full scene rather than an IME overlay. */
    protected fun dismissImeIfShown() {
        if (imeShown()) {
            shell("input keyevent 4")
            val deadline = SystemClock.uptimeMillis() + 5_000
            while (SystemClock.uptimeMillis() < deadline && imeShown()) SystemClock.sleep(200)
        }
    }

    /** Runs a shell command through UiAutomation (shell uid) and returns stdout. */
    protected fun shell(command: String): String {
        val fd: ParcelFileDescriptor = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(fd).use {
            it.readBytes().toString(Charsets.UTF_8)
        }
    }

    /** Captures a full-screen screenshot to /data/local/tmp as the shell user. */
    protected fun screencap(name: String) {
        shell("screencap -p /data/local/tmp/$name")
        shell("chmod 644 /data/local/tmp/$name")
        var exists = false
        repeat(50) {
            if (shell("ls /data/local/tmp/$name").contains(name)) {
                exists = true
                return@repeat
            }
            SystemClock.sleep(100)
        }
        assertTrue("screencap did not produce /data/local/tmp/$name", exists)
    }

    /**
     * Screen-level enforcement that a JavaScript-only change is actually
     * rendered: the cropped scene region of [currentName] must differ from the
     * standard APK's baseline screenshot by at least [minDifferingPixels].
     * Baseline layout: button region (40,340)-(360,420); entries region
     * (40,470)-(1040,1010).
     */
    protected fun assertRegionDiffersFromBaseline(
        scenario: ActivityScenario<MainActivity>,
        currentName: String,
        regionSelector: (TenunSurfaceView) -> RectF,
        minDifferingPixels: Int,
        label: String,
    ) {
        val baseline = BitmapFactory.decodeFile("/data/local/tmp/tenun_baseline.png")
        assertNotNull(
            "baseline screenshot missing on device; the standard acceptance phase must run before the variant phase",
            baseline
        )
        val current = BitmapFactory.decodeFile("/data/local/tmp/$currentName")
        assertNotNull("current screenshot $currentName missing or undecodable", current)
        assertEquals("screen size changed between phases", baseline.width, current.width)
        assertEquals("screen size changed between phases", baseline.height, current.height)

        val r = onViewSurface(scenario) { regionSelector(it) }
        val left = r.left.toInt().coerceAtLeast(0)
        val top = r.top.toInt().coerceAtLeast(0)
        val right = r.right.toInt().coerceAtMost(baseline.width)
        val bottom = r.bottom.toInt().coerceAtMost(baseline.height)

        var differing = 0
        for (y in top until bottom) {
            for (x in left until right) {
                val b = baseline.getPixel(x, y)
                val c = current.getPixel(x, y)
                if (abs(Color.red(b) - Color.red(c)) > 8 ||
                    abs(Color.green(b) - Color.green(c)) > 8 ||
                    abs(Color.blue(b) - Color.blue(c)) > 8
                ) {
                    differing++
                }
            }
        }
        assertTrue(
            "screen-level check failed: $label region had only $differing differing pixels " +
                "(required >= $minDifferingPixels); the JavaScript-only change is not visible on screen",
            differing >= minDifferingPixels
        )
    }

    companion object {
        val ENTRIES_REGION = RectF(40f, 470f, 1040f, 1010f)
    }
}

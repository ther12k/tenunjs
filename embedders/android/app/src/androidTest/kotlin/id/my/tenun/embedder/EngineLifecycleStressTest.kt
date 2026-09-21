package id.my.tenun.embedder

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Incident #191 bounded lifecycle diagnostic: twenty sequential
 * create/evaluate/destroy cycles of the STOCK packaged engine in ONE
 * process, through the production JNI/native path, with no Activity or
 * IME involvement. Question: can repeated engine lifecycle alone
 * reproduce the captured script_eval failure?
 *
 * Predeclared rules (fixed before the run):
 *  - N = 20 cycles; no restarts; PID and iteration recorded per cycle.
 *  - Any initialization failure is a RECORDED failure: the cycle is not
 *    retried and its result is never replaced by a later pass.
 *  - After a failed construction there is no engine to release; the run
 *    CONTINUES so the remaining planned cycles stay observable.
 *  - The run STOPS early on an abort or evidence of invalid memory
 *    state (an uncaught Throwable beyond the documented init exception);
 *    fewer-than-20 completed cycles is then part of the result.
 *  - Evidence per failure is captured from INSIDE the test (before any
 *    teardown can obscure it): the boundary/attribution lines are in
 *    logcat (TenunEngine tag) and point-in-time memory snapshots are
 *    taken via shell. The final assertion fails whenever any cycle
 *    failed — a red diagnostic is a valid, preserved outcome, not
 *    something to rerun away.
 *
 * Identity: the bundle is the packaged stock tenun_app.js read once; its
 * SHA-256 and length are logged once and must match the
 * TENUN_EVAL_BOUNDARY fnv/len lines for every cycle.
 */
@RunWith(AndroidJUnit4::class)
class EngineLifecycleStressTest {

    @Test
    fun twentySequentialStockEngineCycles() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val bundle = context.assets.open("tenun_app.js").use { it.readBytes() }
        val bundleSha = BundleUpdateVerifier.sha256Hex(bundle)
        Log.i(TAG, "STRESS start pid=${android.os.Process.myPid()} " +
            "thread=${Thread.currentThread().name} cycles=$CYCLES " +
            "bundleLen=${bundle.size} bundleSha256=$bundleSha")

        data class CycleResult(val index: Int, val ok: Boolean, val detail: String)
        val results = mutableListOf<CycleResult>()

        for (cycle in 1..CYCLES) {
            val engine = try {
                TenunEngine(bundle)
            } catch (e: IllegalStateException) {
                // The documented init-failure path (constructor contract:
                // nonzero native handle or throw). Record and continue.
                Log.w(TAG, "STRESS cycle=$cycle INIT_FAILURE: ${e.message}")
                captureMemoryEvidence(cycle)
                results += CycleResult(cycle, false, "init failure: ${e.message}")
                continue
            }
            try {
                val scene = engine.getLatestScene()
                if (scene.isEmpty()) {
                    Log.w(TAG, "STRESS cycle=$cycle EMPTY_SCENE")
                    results += CycleResult(cycle, false, "empty initial scene")
                } else {
                    Log.i(TAG, "STRESS cycle=$cycle ok sceneLen=${scene.length}")
                    results += CycleResult(cycle, true, "sceneLen=${scene.length}")
                }
            } finally {
                engine.destroy()
            }
        }

        val failures = results.filter { !it.ok }
        Log.i(TAG, "STRESS summary pid=${android.os.Process.myPid()} " +
            "completed=${results.size}/$CYCLES failures=${failures.size} " +
            "failedCycles=${failures.joinToString(",") { it.index.toString() }}")

        if (failures.isNotEmpty()) {
            fail(
                "Engine lifecycle diagnostic: ${failures.size}/$CYCLES cycle(s) failed " +
                    "(failed: ${failures.joinToString(", ") { "#${it.index}: ${it.detail}" }}). " +
                    "See logcat TenunEngine TENUN_EVAL_BOUNDARY / TENUN_ENGINE_INIT_FAILED lines " +
                    "for per-cycle attribution (attempt id, len, fnv1a64, js_error)."
            )
        }
        assertTrue("diagnostic completed all cycles", results.size == CYCLES)
    }

    /** Point-in-time memory snapshot from inside the failure window. */
    private fun captureMemoryEvidence(cycle: Int) {
        runCatching {
            val mem = shell("dumpsys meminfo $PACKAGE_NAME 2>/dev/null | head -30")
            Log.w(TAG, "STRESS cycle=$cycle meminfo-on-failure:\n$mem")
        }
        runCatching {
            val proc = shell("dumpsys procstats --hours 1 $PACKAGE_NAME 2>/dev/null | head -40")
            Log.w(TAG, "STRESS cycle=$cycle procstats-on-failure:\n$proc")
        }
    }

    private fun shell(cmd: String): String =
        java.util.Scanner(
            Runtime.getRuntime().exec(arrayOf("sh", "-c", cmd)).inputStream
        ).useDelimiter("\\A").use { scanner -> if (scanner.hasNext()) scanner.next() else "" }

    companion object {
        private const val TAG = "EngineStress"
        private const val CYCLES = 20
        private const val PACKAGE_NAME = "id.my.tenun.embedder"
    }
}

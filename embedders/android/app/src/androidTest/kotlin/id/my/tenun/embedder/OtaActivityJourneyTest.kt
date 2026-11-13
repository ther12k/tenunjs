package id.my.tenun.embedder

import android.content.Intent
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * TN-197: the OTA journey through the REAL MainActivity — the leg the
 * engine-level journeys (OtaEngineJourneyTest) cannot speak for: the whole
 * Activity lifecycle, the real trial-CONFIRM machinery (scene + dispatch +
 * uptime — no manual confirmTrial), real user state, and recovery from
 * background/close.
 *
 *   launch (packaged, channel injected via the debuggable-only intent seam)
 *     → user is using the app (real system taps, a real form edit, a swipe)
 *     → signed v2 (immediate) applies LIVE underneath the user and
 *       CONFIRMS itself through the real health criterion
 *     → signed v3 (idle) arrives at the foreground-return check (the real
 *       60s-throttled cadence): the check stages it, the resume
 *       activation applies it, and the live user state rides the swap
 *     → recreate: boots the re-verified stored v3
 *     → signed v4 (next-launch) stays staged across resumes; the NEXT
 *       recreate boot-activates it (trial, clean state) and it confirms
 *       itself
 *
 * Every served bundle is the SAME app as packaged plus a suffix — the
 * realistic OTA shape (an app updating itself) — and each one opens a TCP
 * session to the journey's loopback server at boot, so companion
 * connectivity is proven present across every activation path.
 */
@RunWith(AndroidJUnit4::class)
class OtaActivityJourneyTest : DeviceAcceptanceBase() {

    private val context = instrumentation.targetContext

    /** One-request-at-a-time loopback HTTP server (manifest + bundle). */
    private class HttpServer(val responses: MutableMap<String, ByteArray>) {
        private val socket = ServerSocket(0)
        private val running = AtomicBoolean(true)
        private val pool = Executors.newSingleThreadExecutor()

        val port: Int get() = socket.localPort

        init {
            pool.execute {
                while (running.get()) {
                    try {
                        val client = socket.accept()
                        serve(client.getInputStream(), client.getOutputStream())
                        client.close()
                    } catch (e: Exception) {
                        if (running.get()) return@execute
                    }
                }
            }
        }

        private fun serve(input: java.io.InputStream, output: java.io.OutputStream) {
            val reader = BufferedReader(InputStreamReader(input))
            val requestLine = reader.readLine() ?: return
            val path = requestLine.split(" ").getOrNull(1) ?: return
            while (reader.readLine()?.isNotEmpty() == true) { /* drain headers */ }
            val body = responses[path]
            if (body == null) {
                output.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
            } else {
                output.write(
                    ("HTTP/1.1 200 OK\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n").toByteArray()
                )
                output.write(body)
            }
            output.flush()
        }

        fun close() {
            running.set(false)
            socket.close()
            pool.shutdownNow()
        }
    }

    /** Holds accepted TCP sessions open; counts arrivals. */
    private class NetProbe {
        private val socket = ServerSocket(0)
        private val running = AtomicBoolean(true)
        private val pool = Executors.newSingleThreadExecutor()
        private val held = mutableListOf<java.net.Socket>()
        val accepted = AtomicInteger(0)

        val port: Int get() = socket.localPort

        init {
            pool.execute {
                while (running.get()) {
                    try {
                        val client = socket.accept()
                        synchronized(held) { held.add(client) }
                        accepted.incrementAndGet()
                    } catch (e: Exception) {
                        if (running.get()) return@execute
                    }
                }
            }
        }

        fun close() {
            running.set(false)
            socket.close()
            pool.shutdownNow()
            synchronized(held) { held.forEach { runCatching { it.close() } } }
        }
    }

    private val scenarios = mutableListOf<ActivityScenario<MainActivity>>()
    private val httpServer = HttpServer(ConcurrentHashMap())
    private val netProbe = NetProbe()

    @After
    fun tearDown() {
        scenarios.forEach { runCatching { it.close() } }
        scenarios.clear()
        httpServer.close()
        netProbe.close()
    }

    private fun ecPair(): KeyPair {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        return generator.generateKeyPair()
    }

    private fun envelopeFor(pair: KeyPair, metadata: org.json.JSONObject): String {
        val payload = metadata.toString().toByteArray(Charsets.UTF_8)
        val signature = Signature.getInstance("SHA256withECDSA").apply {
            initSign(pair.private)
            update(payload)
        }.sign()
        return org.json.JSONObject(
            mapOf(
                "payload" to Base64.getEncoder().encodeToString(payload),
                "signature" to Base64.getEncoder().encodeToString(signature)
            )
        ).toString()
    }

    private fun manifestFor(
        pair: KeyPair,
        sequence: Long,
        bundle: ByteArray,
        activation: String = "immediate"
    ): String {
        val metadata = org.json.JSONObject(
            mapOf(
                "schema" to 1,
                "appId" to context.packageName,
                "channel" to "prototype",
                "sequence" to sequence,
                "hostApiMin" to UpdateProtocol.HOST_API_VERSION,
                "hostApiMax" to UpdateProtocol.HOST_API_VERSION,
                "stateSchema" to 1L,
                "bundleFormat" to UpdateProtocol.SUPPORTED_BUNDLE_FORMAT,
                "bundleSize" to bundle.size,
                "bundleSha256" to BundleUpdateVerifier.sha256Hex(bundle),
                "bundleUrl" to "http://127.0.0.1:${httpServer.port}/update-bundle.js"
            )
        )
        if (activation != "immediate") metadata.put("activation", activation)
        return envelopeFor(pair, metadata)
    }

    /**
     * The served release: the framework-feel app (same compiled bytes the
     * browser host and the parity gate run — a REAL framework app with
     * display-list scenes, text-input descriptors, and genuine state
     * export/restore schemas), plus a marker comment and a boot-time TCP
     * session. The packaged legacy gallery app participates in no state
     * schema (its exports report -1), so the packaged→v2 swap restarts
     * clean by design and v2 onward carry state for real.
     */
    private fun updateBundle(marker: String): ByteArray {
        val base = InstrumentationRegistry.getInstrumentation().context.assets
            .open("framework_feel_app.js").use { it.readBytes() }
        val connect = "globalThis.__otaJourneyNet = tenun_host_call(" +
            "\"net\", \"connect\", JSON.stringify({host:\"127.0.0.1\",port:${netProbe.port}}));"
        return base + "\n// ota $marker\n$connect\n".toByteArray()
    }

    private fun launchOta(pair: KeyPair): ActivityScenario<MainActivity> {
        val intent = Intent(context, MainActivity::class.java).apply {
            putExtra(MainActivity.EXTRA_OTA_MANIFEST_URL, "http://127.0.0.1:${httpServer.port}/update-manifest.json")
            putExtra(MainActivity.EXTRA_OTA_PUBLIC_KEY, Base64.getEncoder().encodeToString(pair.public.encoded))
            putExtra(MainActivity.EXTRA_OTA_CHANNEL, "prototype")
        }
        val scenario = ActivityScenario.launch<MainActivity>(intent)
        scenarios.add(scenario)
        return scenario
    }

    private fun <T> withActivity(scenario: ActivityScenario<MainActivity>, block: (MainActivity) -> T): T {
        var result: T? = null
        scenario.onActivity { result = block(it) }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    /** Polls an activity-level predicate with a generous device deadline. */
    private fun awaitOta(
        scenario: ActivityScenario<MainActivity>,
        timeoutMs: Long,
        description: String,
        predicate: (MainActivity) -> Boolean
    ) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (withActivity(scenario) { predicate(it) }) return
            Thread.sleep(250)
        }
        fail("timed out waiting for: $description")
    }

    /** A real system tap on the committed scene's first tap region — the
     *  dispatch evidence the trial-health criterion needs. */
    private fun tapFirstRegion(scenario: ActivityScenario<MainActivity>) {
        val point = onViewSurface(scenario) { v ->
            val scene = v.committedSceneForTest().first ?: error("no committed scene to tap")
            val tap = scene.taps.firstOrNull() ?: error("no tap region in the committed scene")
            (tap.x + tap.w / 2f) to (tap.y + tap.h / 2f)
        }
        tapDesignPoint(scenario, point.first, point.second)
    }

    @Test
    fun otaJourneyThroughTheRealActivity() {
        // Clean slate: the activity's real store lives in filesDir and
        // survives across runs on the emulator.
        java.io.File(context.filesDir, "bundles").deleteRecursively()

        val pair = ecPair()

        // ---- v2 (immediate): applies LIVE underneath a user mid-use ----
        val bundleV2 = updateBundle("v2")
        httpServer.responses["/update-manifest.json"] = manifestFor(pair, 2, bundleV2).toByteArray()
        httpServer.responses["/update-bundle.js"] = bundleV2

        val scenario = launchOta(pair)
        scenario.moveToState(Lifecycle.State.RESUMED)

        // The packaged legacy gallery app boots first; the launch check
        // applies v2 (a framework-feel release) LIVE while the user is
        // "using" the app. v2's scene is display-list — observable.
        awaitOta(scenario, 30_000, "v2 trial after live apply") { it.otaTrialSequenceForTest == 2L }
        awaitDisplayScene(scenario, 15_000, "v2's framework scene committed") { sceneTexts(it).contains("Day Plan") }
        awaitOta(scenario, 10_000, "v2's boot TCP session") { netProbe.accepted.get() >= 1 }

        // Real usage on the LIVE v2 engine: a system tap on a real control,
        // a real scroll gesture, then a real form edit through the
        // InputConnection — the user state the v3 swap must carry.
        tapSceneText(scenario, "Complete task")
        awaitDisplayScene(scenario, 5_000, "task completed on v2") { sceneTexts(it).contains("1 / 3") }
        device.swipe(360, 800, 360, 400, 10) // real scroll gesture through the system pipeline
        tapSceneText(scenario, "Plan title")
        onViewSurface(scenario) { v ->
            assertNotNull("plan-title focused by the tap", v.committedSceneForTest().first!!.focusedEditableInput())
            val ic = v.onCreateInputConnection(android.view.inputmethod.EditorInfo())
            assertNotNull("plan-title editor connection on v2", ic)
            assertTrue("plan-title commitText on v2", ic!!.commitText(" (weekend)", 1))
        }
        awaitDisplayScene(scenario, 5_000, "title edit committed on v2") { scene ->
            sceneTexts(scene).any { it.contains("weekend") }
        }

        // The REAL confirm machinery (scene + dispatch + uptime) accepts v2.
        awaitOta(scenario, 45_000, "v2 CONFIRMED by the trial-health criterion") {
            it.otaInstalledSequenceForTest == 2L && it.otaTrialSequenceForTest == null
        }

        // ---- v3 (idle): stages at the foreground-return check and activates there ----
        val bundleV3 = updateBundle("v3")
        httpServer.responses["/update-manifest.json"] = manifestFor(pair, 3, bundleV3, activation = "idle").toByteArray()
        httpServer.responses["/update-bundle.js"] = bundleV3

        // The manager's check throttle (MIN_CHECK_GAP_MS = 60s) is part of
        // the production cadence this journey runs on: out-wait it, then
        // return to the foreground. The resume check STAGES v3 (an idle
        // release never applies from the check itself) and the resume
        // activation applies it — with the user's live state carried across
        // the swap. (Window-focus loss ends a display text session on
        // pause, so a form can never be "open" across a backgrounding —
        // the busy-deferral branch needs a pause-surviving signal; see the
        // issue write-up.)
        Thread.sleep(70_000)
        scenario.moveToState(Lifecycle.State.STARTED)
        scenario.moveToState(Lifecycle.State.RESUMED)
        awaitOta(scenario, 30_000, "v3 applied by the foreground-return activation") { it.otaTrialSequenceForTest == 3L }
        awaitOta(scenario, 10_000, "v3 boot TCP session") { netProbe.accepted.get() >= 2 }

        // Dispatch evidence for v3's own trial; the live user state rode the
        // swap (same state schema, acknowledged restore). Return to Today if
        // the restored route is the Progress screen.
        if (onViewSurface(scenario) { v -> sceneTexts(v.committedSceneForTest().first!!).none { it == "Day Plan" } }) {
            tapSceneText(scenario, "Back to today")
        }
        tapSceneText(scenario, "Complete task")
        awaitDisplayScene(scenario, 5_000, "user state carried across the v2→v3 swap") { scene ->
            val texts = sceneTexts(scene)
            texts.contains("2 / 3") && texts.any { it.contains("weekend") }
        }
        awaitOta(scenario, 45_000, "v3 CONFIRMED") { it.otaInstalledSequenceForTest == 3L && it.otaTrialSequenceForTest == null }

        // ---- recreate: boots the re-verified stored v3 ----
        scenario.recreate()
        scenario.moveToState(Lifecycle.State.RESUMED)
        awaitOta(scenario, 15_000, "recreate boots stored-v3 re-verified") { it.otaBootSourceForTest == "stored-v3" }

        // ---- v4 (next-launch): staged across resumes; boot-activates on recreate ----
        val bundleV4 = updateBundle("v4")
        httpServer.responses["/update-manifest.json"] = manifestFor(pair, 4, bundleV4, activation = "next-launch").toByteArray()
        httpServer.responses["/update-bundle.js"] = bundleV4

        scenario.recreate() // fresh manager → launch check stages v4 (next-launch never applies live)
        scenario.moveToState(Lifecycle.State.RESUMED)
        awaitOta(scenario, 30_000, "v4 staged") { it.otaPendingStagedSequenceForTest == 4L }

        // Pause→resume does NOT activate a next-launch release.
        scenario.moveToState(Lifecycle.State.STARTED)
        scenario.moveToState(Lifecycle.State.RESUMED)
        Thread.sleep(2_000)
        withActivity(scenario) { activity ->
            assertTrue(
                "next-launch release must not activate from a resume",
                activity.otaPendingStagedSequenceForTest == 4L && activity.otaTrialSequenceForTest == null
            )
        }

        // The next COLD BOOT activates it — re-verified, trial-disciplined,
        // and CLEAN-STATE by design (the old process and its session state
        // are gone; next-launch activation is a fresh boot).
        scenario.recreate()
        scenario.moveToState(Lifecycle.State.RESUMED)
        awaitOta(scenario, 15_000, "recreate boot-activates v4") { it.otaBootSourceForTest == "activated-v4" }
        awaitDisplayScene(scenario, 10_000, "v4's clean-state framework scene") { scene ->
            sceneTexts(scene).contains("Day Plan") && sceneTexts(scene).contains("0 / 3")
        }
        awaitOta(scenario, 10_000, "v4 boot TCP session") { netProbe.accepted.get() >= 3 }

        // Dispatch evidence through a real system tap, then the trial confirms itself.
        tapSceneText(scenario, "Complete task")
        awaitOta(scenario, 45_000, "v4 CONFIRMED after boot activation") {
            it.otaInstalledSequenceForTest == 4L && it.otaTrialSequenceForTest == null
        }
    }
}

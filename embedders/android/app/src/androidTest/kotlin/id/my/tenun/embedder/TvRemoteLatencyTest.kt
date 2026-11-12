package id.my.tenun.embedder

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * TN-192 device gate: measured end-to-end key-event latency through the
 * REAL seam — the compiled TvRemoteRuntime + public net adapter →
 * QuickJS → JNI → NetService → TCP → the runner-hosted byte-echo server
 * (10.0.2.2), exactly the NetBridgeTest topology with plain TCP (the
 * transport segment therefore measures the socket round trip, not TLS).
 *
 * This test asserts the HARNESS works — 100 events complete, percentiles
 * are internally consistent (min ≤ p50 ≤ p95 ≤ p99 ≤ max, every segment
 * ≥ 0) — and prints the digest for the evidence packet. It deliberately
 * asserts NO latency threshold (the issue's scope boundary).
 */
@RunWith(AndroidJUnit4::class)
class TvRemoteLatencyTest {

    @Test
    fun keyEventLatencyThroughTheRealSeam() {
        val echoPort = androidx.test.platform.app.InstrumentationRegistry.getArguments()
            .getString("tn192EchoPort")
            ?.toIntOrNull()
        assertNotNull(
            "the acceptance runner must provide -Pandroid.testInstrumentationRunnerArguments.tn192EchoPort",
            echoPort,
        )

        val fixture = TvRemoteLatencyFixture()
        try {
            val metadata = fixture.dispatch("metadata")
            assertEquals(1, metadata.getInt("contractVersion"))
            assertEquals("supported", metadata.getJSONObject("availability").getString("status"))
            for (name in listOf("Buffer", "atob", "btoa")) {
                assertEquals("QuickJS must not need $name", "undefined", metadata.getJSONObject("globals").getString(name))
            }

            // Connect the runtime's remote session to the echo server.
            fixture.dispatch(
                "connect",
                JSONObject().put("host", "10.0.2.2").put("port", echoPort!!),
            )
            val connected = fixture.awaitResult(15_000)
            assertNotNull("connect never settled", connected)
            assertTrue("connect failed: $connected", connected!!.optBoolean("ok"))

            // 100 key events through the whole pipeline.
            val events = 100
            repeat(events) { i ->
                fixture.dispatch(
                    "press",
                    JSONObject()
                        .put("keyCode", 19 + (i % 4)) // dpad up/down/left/right cycle
                        .put("direction", 3), // SHORT
                )
            }

            // Every echo must come back: poll pending until zero.
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(90)
            var pending = -1
            while (System.nanoTime() < deadline) {
                pending = fixture.dispatch("pending").getInt("pending")
                if (pending == 0) break
                Thread.sleep(50)
            }
            assertEquals("probes still pending after 90s (echoes lost)", 0, pending)

            // dispatch() already yields an org.json.JSONObject; the digest
            // rides as a STRING field inside it (android.jar's JSONObject
            // has no JSONObject copy constructor, so parse the field with
            // JSONObject(String) instead of re-wrapping).
            val digestJson = fixture.dispatch("digest").optString("digest", "")
            assertTrue("no digest (no completed events)", digestJson.isNotEmpty())
            val digest = JSONObject(digestJson)
            assertEquals("every event must complete", events, digest.getInt("eventCount"))
            val e2e = digest.getJSONObject("endToEnd")
            val min = digest.getDouble("minEndToEndMs")
            val max = digest.getDouble("maxEndToEndMs")
            val p50 = e2e.getDouble("p50")
            val p95 = e2e.getDouble("p95")
            val p99 = e2e.getDouble("p99")
            assertTrue("percentile ordering broken: min=$min p50=$p50 p95=$p95 p99=$p99 max=$max", min <= p50 && p50 <= p95 && p95 <= p99 && p99 <= max)
            for (segment in listOf("uiDispatch", "seam", "transport")) {
                val s = digest.getJSONObject(segment)
                assertTrue("segment $segment p50 must be >= 0", s.getDouble("p50") >= 0)
            }

            // Evidence line: the runner captures this from the instrumentation log.
            println("TN192_LATENCY digest=$digest")
        } finally {
            fixture.close()
        }
    }
}

/** Engine + registry + compiled public runtime fixture (NetBridgeFixture pattern). */
internal class TvRemoteLatencyFixture : AutoCloseable {
    private val engineHolder = AtomicReference<TenunEngine?>(null)
    private val eventLog = CopyOnWriteArrayList<String>()

    // QuickJS pins its stack-overflow guard to the engine-creating thread;
    // NET_EVENT pushes re-enter on the engine thread (the recorded lesson).
    private val engineThread = android.os.HandlerThread("tenun-tvremote-fixture").apply { start() }
    private val engineHandler = android.os.Handler(engineThread.looper)

    private val registry = HostServiceRegistry().apply {
        register(
            "net",
            NetService(
                onEvent = { _, payloadJson ->
                    eventLog.add(payloadJson)
                    engineHolder.get()?.let { engine ->
                        engineHandler.post { engine.dispatchActionResult("NET_EVENT", payloadJson) }
                    }
                },
            ),
        )
    }

    private val engine: TenunEngine

    init {
        val bundle = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            .context.assets.open("tvremote_latency_fixture.js").use { input ->
                val buffer = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                while (true) {
                    val read = input.read(chunk)
                    if (read < 0) break
                    buffer.write(chunk, 0, read)
                }
                buffer.toByteArray()
            }
        val created = CountDownLatch(1)
        var createdEngine: TenunEngine? = null
        engineHandler.post {
            try {
                createdEngine = TenunEngine(bundle, registry)
                engineHolder.set(createdEngine)
            } finally {
                created.countDown()
            }
        }
        check(created.await(15, TimeUnit.SECONDS)) { "fixture engine creation failed" }
        engine = createdEngine!!
    }

    fun dispatch(action: String, payload: JSONObject = JSONObject()): JSONObject {
        val done = CountDownLatch(1)
        var json: String? = null
        engineHandler.post {
            try {
                json = engine.dispatchActionResult(action, payload.toString())
            } finally {
                done.countDown()
            }
        }
        check(done.await(15, TimeUnit.SECONDS)) { "fixture dispatch '$action' never completed" }
        assertNotNull("compiled tvremote fixture must return a synchronous string for $action", json)
        return JSONObject(json!!)
    }

    fun awaitResult(timeoutMs: Long): JSONObject? {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (System.nanoTime() < deadline) {
            val result = dispatch("result")
            if (!result.optBoolean("pending")) return result
            Thread.sleep(25)
        }
        return null
    }

    override fun close() {
        val done = CountDownLatch(1)
        engineHandler.post {
            try {
                engine.destroy()
            } finally {
                done.countDown()
            }
        }
        done.await(10, TimeUnit.SECONDS)
        engineThread.quitSafely()
    }
}

package id.my.tenun.embedder

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * TN-135: the OTA pipeline is lifecycle-bound. A finishing download must
 * not boot a candidate into a destroyed host — no apply against the dead
 * surface, no trial staged a dead host can never confirm, and no
 * quarantine (host death is not a bundle defect; the release must stay
 * installable by the next launch).
 *
 * Host destruction is simulated by [OtaManager.stop] in the exact order
 * MainActivity.onDestroy performs it (stop before engine teardown). The
 * host here is the manager directly — the same boundary
 * OtaEngineJourneyTest documents; Activity-level destroy/recreate
 * evidence is the manual phone-test checklist (the channel is an
 * asset-baked install-time trust anchor, so a real Activity cannot be
 * pointed at a runtime-port loopback server).
 */
@RunWith(AndroidJUnit4::class)
class OtaStopLifecycleTest {

    /**
     * Loopback HTTP server with a per-path request counter and an
     * optional latch that holds ONE named response until the test opens
     * it — the "download finishing while the host dies" lever.
     */
    private class GatedHttpServer {
        private val socket = ServerSocket(0)
        private val pool = Executors.newSingleThreadExecutor()
        private val responses = ConcurrentHashMap<String, ByteArray>()
        private val counts = ConcurrentHashMap<String, AtomicInteger>()
        @Volatile private var gatedPath: String? = null
        @Volatile private var gate: CountDownLatch? = null

        val port: Int get() = socket.localPort

        fun respond(path: String, body: ByteArray) {
            responses[path] = body
        }

        fun gatePath(path: String) {
            gate = CountDownLatch(1)
            gatedPath = path
        }

        fun openGate() {
            gate?.countDown()
        }

        fun requestsFor(path: String): Int = counts[path]?.get() ?: 0

        init {
            pool.execute {
                while (!socket.isClosed) {
                  try {
                    val client = socket.accept()
                    serve(client.getInputStream(), client.getOutputStream())
                    client.close()
                  } catch (e: Exception) {
                    // closed or interrupted: stop serving
                  }
                }
            }
        }

        private fun serve(input: java.io.InputStream, output: java.io.OutputStream) {
            val reader = BufferedReader(InputStreamReader(input))
            val requestLine = reader.readLine() ?: return
            val path = requestLine.split(" ").getOrNull(1) ?: return
            while (reader.readLine()?.isNotEmpty() == true) { /* drain headers */ }
            counts.getOrPut(path) { AtomicInteger() }.incrementAndGet()
            if (path == gatedPath) {
              try { gate?.await(20, TimeUnit.SECONDS) } catch (e: InterruptedException) {}
            }
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
            try { socket.close() } catch (ignored: Exception) {}
            openGate()
            pool.shutdownNow()
        }
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

    private fun manifestFor(pair: KeyPair, sequence: Long, bundle: ByteArray, port: Int): String {
        val metadata = org.json.JSONObject(
            mapOf(
                "schema" to 1,
                "appId" to "id.my.tenun.embedder",
                "channel" to "prototype",
                "sequence" to sequence,
                "hostApiMin" to UpdateProtocol.HOST_API_VERSION,
                "hostApiMax" to UpdateProtocol.HOST_API_VERSION,
                "stateSchema" to 1,
                "bundleFormat" to UpdateProtocol.SUPPORTED_BUNDLE_FORMAT,
                "bundleSize" to bundle.size,
                "bundleSha256" to BundleUpdateVerifier.sha256Hex(bundle),
                "bundleUrl" to "http://127.0.0.1:$port/update-bundle.js"
            )
        )
        return envelopeFor(pair, metadata)
    }

    private fun freshStore(): UpdateStore {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val storeDir = java.io.File(context.filesDir, "ota-stop-test")
        storeDir.deleteRecursively()
        return UpdateStore(storeDir)
    }

    private fun hostIdentity() = UpdateProtocol.HostIdentity(
        appId = "id.my.tenun.embedder",
        channel = "prototype",
        hostApi = UpdateProtocol.HOST_API_VERSION
    )

    /** Waits up to 10s for [condition]. */
    private fun spinUntil(what: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(50)
        }
        assertTrue("$what not met within timeout", condition())
    }

    private companion object {
        const val MANIFEST = "/update-manifest.json"
        const val BUNDLE = "/update-bundle.js"
        const val SETTLE_MS = 1500L
    }

    @Test
    fun stopDuringManifestFetchAbandonsWithoutStageApplyOrQuarantine() {
        val server = GatedHttpServer()
        val store = freshStore()
        val pair = ecPair()
        val publicB64 = Base64.getEncoder().encodeToString(pair.public.encoded)
        val bundle = "globalThis.tenun_commit('{}');".toByteArray()
        server.respond(MANIFEST, manifestFor(pair, 2, bundle, server.port).toByteArray())
        server.respond(BUNDLE, bundle)
        server.gatePath(MANIFEST)

        val applies = AtomicInteger(0)
        val io = Executors.newSingleThreadExecutor()
        val manager = OtaManager(
            UpdateChannel("http://127.0.0.1:${server.port}$MANIFEST", "prototype", publicB64),
            hostIdentity(), store, io
        ) { _, _ ->
            applies.incrementAndGet()
            true
        }

        try {
            manager.checkNow(force = true)
            // The fetch is now blocked inside the manifest request — the
            // host dies (onDestroy order: stop before engine teardown).
            spinUntil("manifest request arrived at the server") { server.requestsFor(MANIFEST) == 1 }
            manager.stop()
            server.openGate()
            // The pipeline continues: manifest verified, bundle fetched…
            spinUntil("bundle request arrived after the gate opened") { server.requestsFor(BUNDLE) == 1 }
            Thread.sleep(SETTLE_MS) // …and must abandon before staging.

            assertEquals("no apply against the destroyed host", 0, applies.get())
            assertNull("no trial a dead host can never confirm", store.trialSequence())
            assertFalse("host death is not a bundle defect — no quarantine", store.isQuarantined(2))
        } finally {
            manager.stop()
            server.close()
            io.shutdownNow()
        }
    }

    @Test
    fun stopDuringBundleDownloadAbandonsWithoutStageApplyOrQuarantine() {
        val server = GatedHttpServer()
        val store = freshStore()
        val pair = ecPair()
        val publicB64 = Base64.getEncoder().encodeToString(pair.public.encoded)
        val bundle = "globalThis.tenun_commit('{}');".toByteArray()
        server.respond(MANIFEST, manifestFor(pair, 2, bundle, server.port).toByteArray())
        server.respond(BUNDLE, bundle)
        server.gatePath(BUNDLE)

        val applies = AtomicInteger(0)
        val io = Executors.newSingleThreadExecutor()
        val manager = OtaManager(
            UpdateChannel("http://127.0.0.1:${server.port}$MANIFEST", "prototype", publicB64),
            hostIdentity(), store, io
        ) { _, _ ->
            applies.incrementAndGet()
            true
        }

        try {
            manager.checkNow(force = true)
            // Manifest already fetched and verified; the bundle download
            // is blocked — the host dies at this exact moment.
            spinUntil("bundle download blocked at the server") { server.requestsFor(BUNDLE) == 1 }
            manager.stop()
            server.openGate()
            Thread.sleep(SETTLE_MS) // verified bytes must not stage after stop.

            assertEquals("no apply against the destroyed host", 0, applies.get())
            assertNull("no trial a dead host can never confirm", store.trialSequence())
            assertFalse("host death is not a bundle defect — no quarantine", store.isQuarantined(2))
        } finally {
            manager.stop()
            server.close()
            io.shutdownNow()
        }
    }

    @Test
    fun checkAfterStopIsANoOpOnTheChannel() {
        val server = GatedHttpServer()
        val store = freshStore()
        val pair = ecPair()
        val publicB64 = Base64.getEncoder().encodeToString(pair.public.encoded)
        val bundle = "globalThis.tenun_commit('{}');".toByteArray()
        server.respond(MANIFEST, manifestFor(pair, 2, bundle, server.port).toByteArray())
        server.respond(BUNDLE, bundle)

        val applies = AtomicInteger(0)
        val io = Executors.newSingleThreadExecutor()
        val manager = OtaManager(
            UpdateChannel("http://127.0.0.1:${server.port}$MANIFEST", "prototype", publicB64),
            hostIdentity(), store, io
        ) { _, _ ->
            applies.incrementAndGet()
            true
        }

        try {
            manager.stop()
            // force bypasses the throttle; only the stopped gate can keep
            // this off the network. A resume/launch after destroy must be
            // inert.
            manager.checkNow(force = true)
            Thread.sleep(SETTLE_MS)

            assertEquals(
                "stopped manager must not touch the channel",
                0,
                server.requestsFor(MANIFEST) + server.requestsFor(BUNDLE)
            )
            assertEquals(0, applies.get())
            assertNull(store.trialSequence())
        } finally {
            manager.stop()
            server.close()
            io.shutdownNow()
        }
    }
}

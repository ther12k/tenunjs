package id.my.tenun.embedder

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
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
import java.util.concurrent.atomic.AtomicReference

/**
 * The OTA journey on a real device with the real vendored QuickJS and real
 * ECDSA verification:
 *
 *   A (packaged) boots
 *     → serve signed v2: downloads, verifies, applies live
 *     → confirmed: restart uses v2
 *     → serve tampered v3: rejected, v2 stays
 *     → serve validly-signed v4 whose bundle fails to boot: trial rolls
 *       back, the sequence is quarantined, and it is never retried
 *
 * The host here is the engine directly (no Activity UI); UI-level evidence
 * for the same flows is the manual phone-test checklist in the provenance
 * record. Loopback HTTP stays inside the device (NSC allows 127.0.0.1).
 */
@RunWith(AndroidJUnit4::class)
class OtaEngineJourneyTest {

    private class HttpServer(private val responses: MutableMap<String, ByteArray>) {
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

    @Test
    fun otaJourney() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val packaged = context.assets.open("gallery_app.js").use { it.readBytes() }

        val storeDir = java.io.File(context.filesDir, "ota-journey-test")
        storeDir.deleteRecursively()
        val store = UpdateStore(storeDir)

        val pair = ecPair()
        val publicB64 = Base64.getEncoder().encodeToString(pair.public.encoded)
        val channel = UpdateChannel("", "prototype", publicB64)

        // A: packaged boots, commits its scene through the real engine.
        val engineA = TenunEngine(packaged)
        assertTrue(engineA.getLatestScene().contains("display-list"))

        val live = AtomicReference(engineA)
        val liveMarker = AtomicReference("A")
        val markerByBytes = ConcurrentHashMap<ByteArray, String>()
        val io = Executors.newSingleThreadExecutor()

        val responses = ConcurrentHashMap<String, ByteArray>()
        val server = HttpServer(responses)
        val channelLive = channel.copy(manifestUrl = "http://127.0.0.1:${server.port}/update-manifest.json")

        // applyBundle mirrors MainActivity.applyOtaUpdate: PARALLEL boot,
        // old engine destroyed only after the candidate initializes.
        val applyBundle: (ByteArray, UpdateProtocol.ReleaseMetadata) -> Boolean = { bytes, _ ->
            val candidate = TenunEngine(bytes)
            val previous = live.getAndSet(candidate)
            try { previous.destroy() } catch (ignored: Exception) {}
            liveMarker.set(markerByBytes[bytes] ?: "unknown")
            true
        }

        val manager = OtaManager(channelLive, hostIdentity(), store, io, applyBundle)

        // ---- v2: valid update applies ----
        val bundleB = packaged + "\n// ota v2".toByteArray()
        markerByBytes[bundleB] = "B"
        responses["/update-manifest.json"] = manifestFor(pair, 2, bundleB, server.port).toByteArray()
        responses["/update-bundle.js"] = bundleB

        manager.checkNow()
        spinUntil { liveMarker.get() == "B" }
        assertEquals(2L, store.installedVersion())

        // Host confirms the trial after its health criterion (engine-level
        // stand-in for scene + dispatch + uptime in MainActivity).
        assertTrue(store.confirmTrial(2))

        // Restart: the confirmed bundle is what boots.
        val restarted = TenunEngine(store.activeBundleBytes()!!)
        assertTrue(restarted.getLatestScene().contains("display-list"))
        restarted.destroy()

        // ---- v3: tampered download is rejected, v2 stays ----
        val bundleC = packaged + "\n// ota v3".toByteArray()
        responses["/update-manifest.json"] = manifestFor(pair, 3, bundleC, server.port).toByteArray()
        responses["/update-bundle.js"] = packaged + "\n// TAMPERED".toByteArray()

        manager.checkNow()
        Thread.sleep(SETTLE_MS) // rejected checks change nothing observable
        assertEquals("B", liveMarker.get())
        assertEquals(2L, store.installedVersion())
        assertNull(store.trialSequence())

        // ---- v4: validly signed but boot-failing bundle quarantines ----
        val bundleD = "globalThis.__tenun((((".toByteArray()
        markerByBytes[bundleD] = "D"
        responses["/update-manifest.json"] = manifestFor(pair, 4, bundleD, server.port).toByteArray()
        responses["/update-bundle.js"] = bundleD

        manager.checkNow()
        spinUntil { store.isQuarantined(4) }
        assertEquals("B", liveMarker.get()) // old engine kept running
        assertNull(store.trialSequence())

        // The failed release is never retried.
        manager.checkNow()
        Thread.sleep(SETTLE_MS)
        assertEquals("B", liveMarker.get())
        assertTrue(store.isQuarantined(4))

        manager.stop()
        server.close()
        io.shutdownNow()
        live.get().destroy()
    }

    private fun hostIdentity() = UpdateProtocol.HostIdentity(
        appId = "id.my.tenun.embedder",
        channel = "prototype",
        hostApi = UpdateProtocol.HOST_API_VERSION
    )

    /** Waits up to 10s for [condition]; the OTA apply runs on the main thread. */
    private fun spinUntil(condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(50)
        }
        assertTrue("condition not met within timeout", condition())
    }

    private companion object {
        const val SETTLE_MS = 1500L
    }
}

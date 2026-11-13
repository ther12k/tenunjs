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
 *     → serve signed v2 (requires a capability the host has): downloads,
 *       verifies, applies live
 *     → confirmed: restart uses v2, and the cached signed envelope
 *       re-verifies at the startup gate (and refuses drifted bytes)
 *     → serve tampered v3: rejected, v2 stays
 *     → serve validly-signed v4 whose bundle fails to boot: trial rolls
 *       back, the sequence is quarantined, and it is never retried
 *     → serve v5 whose body outgrows the signed size mid-stream: the
 *       streaming cap aborts the download (no stage, no quarantine)
 *     → serve v6 requiring a capability this host lacks, and v7 requiring
 *       a newer contract: both refused at the gate, before download
 *     → serve an oversized manifest: refused before parse
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

        /** Paths served as chunked (no Content-Length) — the client then reads until the terminator, exercising the streaming cap. */
        val chunkedPaths = ConcurrentHashMap<String, Boolean>()

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
            } else if (chunkedPaths.contains(path)) {
                output.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".toByteArray())
                var offset = 0
                while (offset < body.size) {
                    val length = minOf(16 * 1024, body.size - offset)
                    output.write(("%x\r\n".format(length)).toByteArray())
                    output.write(body, offset, length)
                    output.write("\r\n".toByteArray())
                    offset += length
                }
                output.write("0\r\n\r\n".toByteArray())
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

    private fun manifestFor(
        pair: KeyPair,
        sequence: Long,
        bundle: ByteArray,
        port: Int,
        requires: Map<String, Int> = emptyMap()
    ): String {
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
        if (requires.isNotEmpty()) metadata.put("requiredCapabilities", org.json.JSONObject(requires))
        return envelopeFor(pair, metadata)
    }

    /**
     * The APK's capability surface, through the REAL registry path: the
     * five MainActivity-registered service names at contract version 1
     * (the services themselves are engine-bound and irrelevant here —
     * only name + contractVersion enter compatibility judgments).
     */
    private fun apkCapabilitySnapshot(): Map<String, Int> {
        val registry = HostServiceRegistry()
        listOf("ble", "system", "keys", "net", "discovery").forEach { name ->
            registry.register(name, object : NativeService {
                override val contractVersion = 1
                override fun invoke(method: String, payloadJson: String): String? = null
            })
        }
        return registry.capabilitySnapshot()
    }

    @Test
    fun otaJourney() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        // Mirror MainActivity's boot-asset selection: gallery_app.js is a
        // generated dev artifact (gitignored); CI commits only tenun_app.js.
        val packaged = runCatching {
            context.assets.open("gallery_app.js").use { it.readBytes() }
        }.getOrElse {
            context.assets.open("tenun_app.js").use { it.readBytes() }
        }

        val storeDir = java.io.File(context.filesDir, "ota-journey-test")
        storeDir.deleteRecursively()
        val store = UpdateStore(storeDir)

        val pair = ecPair()
        val publicB64 = Base64.getEncoder().encodeToString(pair.public.encoded)
        val channel = UpdateChannel("", "prototype", publicB64)

        // A: packaged boots, commits its scene through the real engine.
        android.util.Log.i("OtaJourney", "booting A (packaged)")
        val engineA = TenunEngine(packaged)
        assertTrue(engineA.getLatestScene().isNotEmpty())

        val live = AtomicReference(engineA)
        val liveMarker = AtomicReference("A")
        // Markers are keyed by SHA-256, not by ByteArray identity: the
        // manager hands applyBundle its own downloaded copy of the bytes.
        val markerBySha = ConcurrentHashMap<String, String>()
        fun shaOf(bytes: ByteArray): String = BundleUpdateVerifier.sha256Hex(bytes)
        val io = Executors.newSingleThreadExecutor()

        val responses = ConcurrentHashMap<String, ByteArray>()
        val server = HttpServer(responses)
        val channelLive = channel.copy(manifestUrl = "http://127.0.0.1:${server.port}/update-manifest.json")

        // applyBundle mirrors MainActivity.applyOtaUpdate: PARALLEL boot,
        // old engine destroyed only after the candidate initializes.
        val applyBundle: (ByteArray, UpdateProtocol.ReleaseMetadata) -> Boolean = { bytes, _ ->
            android.util.Log.i("OtaJourney", "applying candidate ${shaOf(bytes).take(8)}")
            val candidate = TenunEngine(bytes)
            val previous = live.getAndSet(candidate)
            try { previous.destroy() } catch (ignored: Exception) {}
            liveMarker.set(markerBySha[shaOf(bytes)] ?: "unknown")
            true
        }

        val manager = OtaManager(channelLive, hostIdentity(), store, io, applyBundle)

        // ---- v2: valid update applies (declaring a capability the host has) ----
        val bundleB = packaged + "\n// ota v2".toByteArray()
        markerBySha[shaOf(bundleB)] = "B"
        responses["/update-manifest.json"] = manifestFor(pair, 2, bundleB, server.port, requires = mapOf("system" to 1)).toByteArray()
        responses["/update-bundle.js"] = bundleB

        manager.checkNow(force = true)
        spinUntil { liveMarker.get() == "B" }
        assertEquals(2L, store.trialSequence()) // applied: in TRIAL, not yet accepted

        // Host confirms the trial after its health criterion (engine-level
        // stand-in for scene + dispatch + uptime in MainActivity).
        assertTrue(store.confirmTrial(2))
        assertEquals(2L, store.installedVersion()) // CONFIRMED: active pointer moved

        // Restart: the confirmed bundle is what boots.
        android.util.Log.i("OtaJourney", "restarting from confirmed store")
        val restarted = TenunEngine(store.activeBundleBytes()!!)
        assertTrue(restarted.getLatestScene().isNotEmpty())
        restarted.destroy()

        // Startup re-verification (MainActivity.bootEngine's gate): the
        // envelope cached at stage time still proves out against the pinned
        // key, this host, and the exact stored bytes — and refuses drifted
        // bytes.
        val cachedEnvelope = store.activeEnvelope()
        assertNotNull(cachedEnvelope)
        val storedBytes = store.activeBundleBytes()!!
        val host = hostIdentity()
        assertNotNull(
            UpdateProtocol.storedBundleUsable(cachedEnvelope!!, publicB64, host, storedBytes)
        )
        assertNull(
            UpdateProtocol.storedBundleUsable(cachedEnvelope, publicB64, host, storedBytes + "!".toByteArray())
        )

        // ---- v3: tampered download is rejected, v2 stays ----
        val bundleC = packaged + "\n// ota v3".toByteArray()
        responses["/update-manifest.json"] = manifestFor(pair, 3, bundleC, server.port).toByteArray()
        responses["/update-bundle.js"] = packaged + "\n// TAMPERED".toByteArray()

        manager.checkNow(force = true)
        Thread.sleep(SETTLE_MS) // rejected checks change nothing observable
        assertEquals("B", liveMarker.get())
        assertEquals(2L, store.installedVersion())
        assertNull(store.trialSequence())

        // ---- v4: validly signed but boot-failing bundle quarantines ----
        val bundleD = "globalThis.__tenun((((".toByteArray()
        markerBySha[shaOf(bundleD)] = "D"
        responses["/update-manifest.json"] = manifestFor(pair, 4, bundleD, server.port).toByteArray()
        responses["/update-bundle.js"] = bundleD

        manager.checkNow(force = true)
        spinUntil { store.isQuarantined(4) }
        assertEquals("B", liveMarker.get()) // old engine kept running
        assertNull(store.trialSequence())

        // The failed release is never retried.
        manager.checkNow(force = true)
        Thread.sleep(SETTLE_MS)
        assertEquals("B", liveMarker.get())
        assertTrue(store.isQuarantined(4))

        // ---- v5: the body outgrows the signed size mid-stream ----
        // Chunked (no Content-Length), so the host cannot spot the lie up
        // front: the streaming cap must abort the copy. A transport-level
        // refusal is not a bundle defect — no stage, no trial, and NO
        // quarantine, so a corrected server can still serve v5 later.
        val bundleE = packaged + "\n// ota v5".toByteArray()
        responses["/update-manifest.json"] = manifestFor(pair, 5, bundleE, server.port).toByteArray()
        responses["/update-bundle.js"] = bundleE + ByteArray(64 * 1024)
        server.chunkedPaths["/update-bundle.js"] = true

        manager.checkNow(force = true)
        Thread.sleep(SETTLE_MS)
        assertEquals("B", liveMarker.get())
        assertNull(store.trialSequence())
        assertFalse(store.isQuarantined(5))

        // ---- v6: requires a capability this host does not provide ----
        // Refused at the compatibility gate, BEFORE download: no staging,
        // no quarantine (a release for a richer host is not a defect), and
        // v2 keeps running.
        val bundleF = packaged + "\n// ota v6".toByteArray()
        responses["/update-manifest.json"] = manifestFor(pair, 6, bundleF, server.port, requires = mapOf("hologram" to 1)).toByteArray()
        responses["/update-bundle.js"] = bundleF

        manager.checkNow(force = true)
        Thread.sleep(SETTLE_MS)
        assertEquals("B", liveMarker.get())
        assertNull(store.trialSequence())
        assertFalse(store.isQuarantined(6))
        assertEquals(2L, store.installedVersion())

        // ---- v7: requires a NEWER contract of a capability the host has ----
        val bundleG = packaged + "\n// ota v7".toByteArray()
        responses["/update-manifest.json"] = manifestFor(pair, 7, bundleG, server.port, requires = mapOf("net" to 2)).toByteArray()
        responses["/update-bundle.js"] = bundleG

        manager.checkNow(force = true)
        Thread.sleep(SETTLE_MS)
        assertEquals("B", liveMarker.get())
        assertNull(store.trialSequence())
        assertFalse(store.isQuarantined(7))

        // ---- oversized manifest: refused before parse ----
        responses["/update-manifest.json"] = ByteArray(UpdateProtocol.MAX_MANIFEST_BYTES.toInt() + 1)
        manager.checkNow(force = true)
        Thread.sleep(SETTLE_MS)
        assertEquals("B", liveMarker.get())
        assertEquals(2L, store.installedVersion())
        assertNull(store.trialSequence())

        manager.stop()
        server.close()
        io.shutdownNow()
        live.get().destroy()
    }

    private fun hostIdentity() = UpdateProtocol.HostIdentity(
        appId = "id.my.tenun.embedder",
        channel = "prototype",
        hostApi = UpdateProtocol.HOST_API_VERSION,
        capabilities = apkCapabilitySnapshot()
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

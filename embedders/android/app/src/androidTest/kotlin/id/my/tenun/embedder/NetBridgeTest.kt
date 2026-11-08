package id.my.tenun.embedder

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * TN-188 device gate: the compiled PUBLIC TypeScript adapter → real
 * QuickJS → JNI → NetService → real sockets, on the emulator. The same
 * contract suite the headless tiers run (net.test.ts, net-preview.test.ts,
 * NetServiceFormatTest): connect, write/receive round-trip, first-use
 * fingerprint, pin enforcement on later connects, link-lost on remote
 * close, double close is a no-op, and a cancelled connect settles
 * cancelled — plus the TLS pairing journey keys exists for: a TLS session
 * authenticated with a Keystore-held client certificate, where the private
 * key is used in place and the first-use fingerprint is a REAL certificate
 * hash the test verifies independently (JCA, not production code).
 */
@RunWith(AndroidJUnit4::class)
class NetBridgeTest {
    private val fixture = NetBridgeFixture()
    private val alias = "test.tn188.bridge.${System.nanoTime()}"

    @After
    fun cleanup() {
        fixture.keysService.invoke("removeIdentity", """{"handle":"$alias"}""")
        fixture.close()
    }

    @Test
    fun metadataContractAndQuickJsGlobals() {
        val metadata = fixture.dispatch("metadata")
        assertEquals(1, metadata.getInt("contractVersion"))
        assertEquals("supported", metadata.getJSONObject("availability").getString("status"))
        // The production host ships none of these; the adapter must not need them.
        for (name in listOf("Buffer", "atob", "btoa")) {
            assertEquals("QuickJS must not need $name", "undefined", metadata.getJSONObject("globals").getString(name))
        }
        // The android tier tables INTERNET; tables stay total.
        assertEquals("android", metadata.getJSONArray("permissions").getJSONObject(0).getString("platform"))
    }

    @Test
    fun plainTcpRoundTripLinkStatesAndIdempotentCloseOverTheRealBridge() {
        // Accept LOOP (the TLS server's proven pattern), and every
        // test-spawned thread catches Throwable: an uncaught exception in a
        // non-instrumentation thread CRASHES the whole process on Android.
        val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val echoStarted = CountDownLatch(1)
        val echoThread = Thread {
            try {
                while (true) {
                    val client = server.accept()
                    echoStarted.countDown()
                    try {
                        client.use { socket ->
                            val buffer = ByteArray(4096)
                            while (true) {
                                val read = socket.getInputStream().read(buffer)
                                if (read < 0) break
                                socket.getOutputStream().write(buffer, 0, read)
                                socket.getOutputStream().flush()
                            }
                        }
                    } catch (ignored: Exception) {
                        // a dying echo connection is not a test failure
                    }
                }
            } catch (ignored: Throwable) {
                // the server socket was closed by the test — the loop dies with it
            }
        }
        echoThread.start()
        try {
            val connected = fixture.callAsync(
                "connect",
                JSONObject().put("host", "127.0.0.1").put("port", server.localPort).put("timeoutMs", 8000),
            )
            assertTrue("$connected; events=${fixture.events()}", connected.getBoolean("ok"))

            assertTrue(
                "echo server never accepted the connection; events=${fixture.events()}",
                echoStarted.await(5, TimeUnit.SECONDS),
            )

            val written = fixture.callAsync("write", JSONObject().put("data", JSONArray(listOf(1, 2, 3, 254, 255))))
            assertTrue("$written; events=${fixture.events()}", written.getBoolean("ok"))
            val echoed = fixture.awaitEvent(8_000) { it.optString("k") == "data" }
            assertNotNull("echo data event; events=${fixture.events()}", echoed)
            assertEquals(
                listOf(1, 2, 3, 254, 255),
                echoed!!.getJSONArray("b").let { array -> (0 until array.length()).map { array.getInt(it) } },
            )

            // The session replays linked on register — one linked event, no noise.
            val linked = fixture.awaitEvent(2_000) { it.optString("k") == "link" && it.optString("s") == "linked" }
            assertNotNull("linked replay; events=${fixture.events()}", linked)

            assertTrue(fixture.callAsync("close", JSONObject()).getBoolean("ok"))
            assertTrue(fixture.callAsync("close", JSONObject()).getBoolean("ok")) // idempotent
            val offline = fixture.awaitEvent(8_000) { it.optString("k") == "link" && it.optString("s") == "offline" }
            assertNotNull("offline after close; events=${fixture.events()}", offline)
            assertEquals(
                "link-lost",
                fixture.callAsync("write", JSONObject().put("data", JSONArray())).getJSONObject("failure").getString("kind"),
            )
        } finally {
            server.close()
            echoThread.join(3_000)
        }
    }

    @Test
    fun remoteCloseDeliversOfflineThroughTheBridge() {
        val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val accepted = CountDownLatch(1)
        val serverThread = Thread {
            try {
                val client = server.accept()
                accepted.countDown()
                client.close() // the companion device powers off
            } catch (ignored: Throwable) {
                // the server socket was closed by the test
            }
        }
        serverThread.start()
        try {
            val connected = fixture.callAsync(
                "connect",
                JSONObject().put("host", "127.0.0.1").put("port", server.localPort).put("timeoutMs", 8000),
            )
            assertTrue("$connected; events=${fixture.events()}", connected.getBoolean("ok"))
            assertTrue(
                "server never accepted the connection; events=${fixture.events()}",
                accepted.await(5, TimeUnit.SECONDS),
            )
            val offline = fixture.awaitEvent(8_000) { it.optString("k") == "link" && it.optString("s") == "offline" }
            assertNotNull("offline after peer close; events=${fixture.events()}", offline)
            assertEquals(
                "link-lost",
                fixture.callAsync("write", JSONObject().put("data", JSONArray())).getJSONObject("failure").getString("kind"),
            )
        } finally {
            server.close()
            serverThread.join(3_000)
        }
    }

    @Test
    fun cancellingABlackholedConnectSettlesCancelled() {
        // TEST-NET-1: the connect cannot complete, so only the cancel signal
        // can settle it — proving the JS-side cancellation path end to end.
        val pending = fixture.dispatch(
            "connect",
            JSONObject()
                .put("host", "192.0.2.1")
                .put("port", 9)
                .put("timeoutMs", 30_000)
                .put("cancel", true),
        )
        assertTrue(pending.getBoolean("pending"))
        assertTrue(fixture.dispatch("cancel").getBoolean("ok"))
        val cancelled = fixture.awaitResult(5_000)
        assertNotNull(cancelled)
        assertFalse(cancelled!!.getBoolean("ok"))
        assertEquals("cancelled", cancelled.getJSONObject("failure").getString("kind"))
    }

    /**
     * TLS pairing journey. The server side runs on the HOST (started by
     * run_device_acceptance.sh, reachable at the emulator's 10.0.2.2 host
     * alias) because the API-30 emulator guest's SERVER-mode Conscrypt
     * handshake fails even though bytes cross the loopback (raw-byte probe,
     * 2026-11-09) — the guest only uses its proven client mode here. The
     * server presents a self-signed certificate and requests a client
     * certificate, then sends "SERVER:<fp>\nCLIENT:<fp>\n" and echoes:
     * the test asserts, self-contained:
     *  - the FIRST-USE fingerprint NetService delivered is the REAL sha256
     *    of the server certificate (matches the server's own SERVER line);
     *  - the certificate the phone PRESENTED is the Keystore identity's
     *    certificate (CLIENT line == sha256 of identity.certificatePem);
     *  - reconnecting with the seen pin is silent; a wrong pin is a loud
     *    link-lost mismatch, never a silent session.
     */
    @Test
    fun tlsPairingWithClientIdentityFirstUseFingerprintAndPinEnforcement() {
        val tlsPort = androidx.test.platform.app.InstrumentationRegistry.getArguments()
            .getString("tn188TlsPort")
            ?.toIntOrNull()
        assertNotNull(
            "the acceptance runner must provide -Pandroid.testInstrumentationRunnerArguments.tn188TlsPort",
            tlsPort,
        )

        val identity = JSONObject(
            fixture.keysService.invoke("generateIdentity", """{"alias":"$alias"}""")!!,
        ).getJSONObject("value")
        val identityCertificate = NetBridgeEvidence.certificate(identity.getString("certificatePem"))
        val identityFingerprint = NetBridgeEvidence.sha256Hex(identityCertificate.encoded)

        // 1. First-use connect WITH the client identity (no pin yet).
        val firstUse = fixture.callAsync(
            "connect",
            JSONObject()
                .put("host", "10.0.2.2")
                .put("port", tlsPort!!)
                .put("timeoutMs", 15_000)
                .put("tls", JSONObject().put("clientIdentity", alias)),
        )
        assertTrue("$firstUse; events=${fixture.events()}", firstUse.getBoolean("ok"))
        val cert = fixture.awaitEvent(8_000) { it.optString("k") == "cert" }
        assertNotNull("first-use fingerprint delivered; events=${fixture.events()}", cert)
        val deliveredFingerprint = cert!!.getString("h")

        // 2. The server answers with its own fingerprint and the peer's, then
        //    echoes; reading them proves data flows over TLS and pins the
        //    assertions to REAL certificate hashes.
        val hello = listOf(0x48, 0x49) // "HI"
        assertTrue(fixture.callAsync("write", JSONObject().put("data", JSONArray(hello))).getBoolean("ok"))
        var transcript = ""
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
        while (System.nanoTime() < deadline &&
            (!transcript.contains("SERVER:") || !transcript.contains("CLIENT:") || !transcript.contains("HI"))
        ) {
            val chunk = fixture.awaitEvent(2_000) {
                it.optString("k") == "data" && !it.optString("b").let { b -> transcript.contains(b) }
            } ?: break
            val bytes = chunk!!.getJSONArray("b").let { array -> (0 until array.length()).map { array.getInt(it) } }
            transcript += String(bytes.map { it.toByte() }.toByteArray(), Charsets.US_ASCII)
        }
        val serverLine = Regex("SERVER:([0-9a-f]{64})").find(transcript)?.groupValues?.get(1)
        val clientLine = Regex("CLIENT:([0-9a-f]{64})").find(transcript)?.groupValues?.get(1)
        assertNotNull("server fingerprint line missing: $transcript", serverLine)
        assertNotNull("client fingerprint line missing: $transcript", clientLine)
        assertEquals(
            "the delivered first-use fingerprint is the REAL server-certificate hash",
            serverLine!!,
            deliveredFingerprint,
        )
        assertEquals(
            "the phone authenticated with the Keystore identity's certificate",
            identityFingerprint,
            clientLine!!,
        )
        assertTrue(fixture.callAsync("close", JSONObject()).getBoolean("ok"))

        // 3. Pin enforcement: the seen fingerprint reconnects silently; a
        //    wrong pin is a loud link-lost mismatch.
        val pinned = fixture.callAsync(
            "connect",
            JSONObject()
                .put("host", "10.0.2.2")
                .put("port", tlsPort)
                .put("timeoutMs", 15_000)
                .put("tls", JSONObject().put("clientIdentity", alias).put("expectedServerCertSha256", deliveredFingerprint)),
        )
        assertTrue("$pinned; events=${fixture.events()}", pinned.getBoolean("ok"))
        assertTrue(fixture.callAsync("close", JSONObject()).getBoolean("ok"))

        val wrongPin = fixture.callAsync(
            "connect",
            JSONObject()
                .put("host", "10.0.2.2")
                .put("port", tlsPort)
                .put("timeoutMs", 15_000)
                .put("tls", JSONObject().put("expectedServerCertSha256", "00".repeat(32))),
        )
        assertFalse(wrongPin.toString(), wrongPin.getBoolean("ok"))
        assertEquals("link-lost", wrongPin.getJSONObject("failure").getString("kind"))
        assertTrue(wrongPin.getJSONObject("failure").optString("message").contains("mismatch"))
    }
}

/** Engine + registry + compiled public adapter, mirroring KeysBridgeFixture. */
internal class NetBridgeFixture : AutoCloseable {
    private val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
    val keysService = KeysService()
    private val engineHolder = AtomicReference<TenunEngine?>(null)
    private val eventLog = CopyOnWriteArrayList<String>()

    // QuickJS records its stack-overflow guard against the thread that
    // created the runtime; re-entry from ANY other thread trips "Maximum
    // call stack size exceeded" (reproduced on the API-30 emulator: a
    // NET_EVENT pushed from a NetService io thread never reached JS).
    // Production avoids this by driving the engine from the thread that
    // created it (MainActivity posts to mainHandler). The fixture mirrors
    // that discipline: bundle evaluation, every dispatch, and every
    // NET_EVENT re-entry run on ONE dedicated engine thread.
    private val engineThread = android.os.HandlerThread("tenun-net-fixture").apply { start() }
    private val engineHandler = android.os.Handler(engineThread.looper)

    private val registry = HostServiceRegistry().apply {
        register("keys", keysService)
        register(
            "net",
            NetService(
                onEvent = { _, payloadJson ->
                    // Socket threads never re-enter JS directly: the event is
                    // queued onto the engine thread in arrival order.
                    eventLog.add(payloadJson)
                    engineHolder.get()?.let { engine ->
                        engineHandler.post { engine.dispatchActionResult("NET_EVENT", payloadJson) }
                    }
                },
                keyResolver = keysService::identityEntry,
            ),
        )
    }

    // Explicit copy loop: InputStream.readAllBytes() is API 33+, and the
    // API-30 acceptance emulator's ART does not have it (CI-caught).
    private val engine: TenunEngine

    init {
        val bundle = instrumentation.context.assets.open("net_fixture.js").use { input ->
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
        assertNotNull("compiled net fixture must return a synchronous string for $action", json)
        return JSONObject(json!!)
    }

    /** Starts the capability Promise, then polls until it settles. */
    fun callAsync(method: String, payload: JSONObject, timeoutMs: Long = 15_000): JSONObject {
        assertTrue("dispatch starts, but does not return, the capability Promise", dispatch(method, payload).getBoolean("pending"))
        val settled = awaitResult(timeoutMs)
        assertNotNull("capability Promise did not settle within ${timeoutMs}ms (events so far: $eventLog)", settled)
        assertFalse("capability rejected instead of resolving: $settled", settled!!.has("fixtureError"))
        return settled
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

    /** Recorded adapter events ({k: data|link|cert, b/s/h payloads}). */
    fun events(): List<JSONObject> {
        val recorded = dispatch("events").getJSONArray("events")
        return (0 until recorded.length()).map { recorded.getJSONObject(it) }
    }

    fun awaitEvent(timeoutMs: Long, predicate: (JSONObject) -> Boolean): JSONObject? {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (System.nanoTime() < deadline) {
            events().firstOrNull(predicate)?.let { return it }
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

/** Independent TLS evidence: JCA verification and a deterministic single-alias server. */
internal object NetBridgeEvidence {

    fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun certificate(pem: String): X509Certificate {
        val body = pem
            .replace("-----BEGIN CERTIFICATE-----", "")
            .replace("-----END CERTIFICATE-----", "")
            .replace(Regex("\\s"), "")
        val certificate = java.security.cert.CertificateFactory.getInstance("X.509")
            .generateCertificate(ByteArrayInputStream(Base64.getDecoder().decode(body))) as X509Certificate
        certificate.checkValidity()
        return certificate
    }

}

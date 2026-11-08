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
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509ExtendedKeyManager

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
        val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
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
        val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
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

    @Test
    fun tlsPairingWithClientIdentityFirstUseFingerprintAndPinEnforcement() {
        // 1. A real Keystore identity for BOTH endpoints of the pairing
        //    journey: the phone's TLS client certificate (via the public
        //    adapter) and the test server's certificate.
        val identity = JSONObject(
            fixture.keysService.invoke("generateIdentity", """{"alias":"$alias"}""")!!,
        ).getJSONObject("value")
        val identityCertificate = NetBridgeEvidence.certificate(identity.getString("certificatePem"))
        val identityEntry = fixture.keysService.identityEntry(identity.getString("handle"))
        assertNotNull("identity resolves inside the keys namespace", identityEntry)

        val server = NetBridgeEvidence.tlsServer(identityEntry!!)
        try {
            server.start()

            // 2. First-use connect WITH the client identity: the fingerprint
            //    must be the REAL sha256 of the server certificate.
            val firstUse = fixture.callAsync(
                "connect",
                JSONObject()
                    .put("host", "127.0.0.1")
                    .put("port", server.port)
                    .put("timeoutMs", 10_000)
                    .put("tls", JSONObject().put("clientIdentity", alias)),
            )
            assertTrue(firstUse.toString(), firstUse.getBoolean("ok"))
            val cert = fixture.awaitEvent(5_000) { it.optString("k") == "cert" }
            assertNotNull("first-use fingerprint delivered", cert)
            assertEquals(NetBridgeEvidence.sha256Hex(identityCertificate.encoded), cert!!.getString("h"))

            // 3. Data flows over TLS; the SERVER independently verifies the
            //    client certificate IS the identity's certificate.
            val secret = listOf(0x54, 0x4c, 0x53)
            assertTrue(fixture.callAsync("write", JSONObject().put("data", JSONArray(secret))).getBoolean("ok"))
            val echoed = fixture.awaitEvent(8_000) { it.optString("k") == "data" }
            assertNotNull("TLS echo", echoed)
            assertEquals(secret, echoed!!.getJSONArray("b").let { array -> (0 until array.length()).map { array.getInt(it) } })
            assertTrue(fixture.callAsync("close", JSONObject()).getBoolean("ok"))
            server.awaitClientCertificate(8_000)?.let { seen ->
                assertEquals("the phone authenticated with the Keystore identity", identityCertificate, seen)
            }

            // 4. Pin enforcement: the seen fingerprint connects silently;
            //    a wrong pin is a loud link-lost, never a silent session.
            val pin = NetBridgeEvidence.sha256Hex(identityCertificate.encoded)
            val pinned = fixture.callAsync(
                "connect",
                JSONObject()
                    .put("host", "127.0.0.1")
                    .put("port", server.port)
                    .put("timeoutMs", 10_000)
                    .put("tls", JSONObject().put("clientIdentity", alias).put("expectedServerCertSha256", pin)),
            )
            assertTrue(pinned.toString(), pinned.getBoolean("ok"))
            assertTrue("pinned mode delivers no fingerprint", fixture.callAsync("close", JSONObject()).getBoolean("ok"))

            val wrongPin = fixture.callAsync(
                "connect",
                JSONObject()
                    .put("host", "127.0.0.1")
                    .put("port", server.port)
                    .put("timeoutMs", 10_000)
                    .put("tls", JSONObject().put("expectedServerCertSha256", "00".repeat(32))),
            )
            assertFalse(wrongPin.toString(), wrongPin.getBoolean("ok"))
            assertEquals("link-lost", wrongPin.getJSONObject("failure").getString("kind"))
            assertTrue(wrongPin.getJSONObject("failure").optString("message").contains("mismatch"))
        } finally {
            server.stop()
        }
    }
}

/** Engine + registry + compiled public adapter, mirroring KeysBridgeFixture. */
internal class NetBridgeFixture : AutoCloseable {
    private val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
    val keysService = KeysService()
    private val engineHolder = AtomicReference<TenunEngine?>(null)
    private val eventLog = CopyOnWriteArrayList<String>()

    private val registry = HostServiceRegistry().apply {
        register("keys", keysService)
        register(
            "net",
            NetService(
                onEvent = { _, payloadJson ->
                    // Socket threads re-enter the engine synchronously: the
                    // engine is lock-protected, and each push resolves the
                    // pending connect/settle promises inside its dispatch.
                    eventLog.add(payloadJson)
                    engineHolder.get()?.dispatchActionResult("NET_EVENT", payloadJson)
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
        engine = TenunEngine(bundle, registry).also { engineHolder.set(it) }
    }

    fun dispatch(action: String, payload: JSONObject = JSONObject()): JSONObject {
        val json = engine.dispatchActionResult(action, payload.toString())
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

    override fun close() = engine.destroy()
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

    /**
     * A TLS echo server presenting EXACTLY the given identity (a test-local
     * single-alias key manager, so the presented certificate is deterministic
     * even when the app UID's keystore holds many test identities) and
     * requesting client certificates.
     */
    class TlsServer(private val entry: KeyStore.PrivateKeyEntry) {
        private val serverSocket: SSLServerSocket
        private val clientCertificate = AtomicReference<X509Certificate?>(null)
        private val clientSeen = CountDownLatch(1)
        private val workers = CopyOnWriteArrayList<Thread>()
        @Volatile private var running = true

        init {
            val context = SSLContext.getInstance("TLS")
            context.init(arrayOf(SingleAliasKeyManager(entry)), null, null)
            serverSocket = context.serverSocketFactory.createServerSocket(0, 8, InetAddress.getLoopbackAddress()) as SSLServerSocket
            serverSocket.wantClientAuth = true
        }

        val port: Int get() = serverSocket.localPort

        fun start() {
            Thread {
                try {
                while (running) {
                    val accepted = try {
                        serverSocket.accept() as SSLSocket
                    } catch (e: Exception) {
                        return@Thread // stopped
                    }
                    val worker = Thread {
                        accepted.use { socket ->
                            try {
                                socket.startHandshake()
                                socket.session.peerCertificates.firstOrNull()?.let {
                                    clientCertificate.set(it as X509Certificate)
                                    clientSeen.countDown()
                                }
                                val buffer = ByteArray(4096)
                                while (true) {
                                    val read = socket.getInputStream().read(buffer)
                                    if (read < 0) break
                                    socket.getOutputStream().write(buffer, 0, read)
                                    socket.getOutputStream().flush()
                                }
                            } catch (ignored: Exception) {
                                // The wrong-pin connect fails here on purpose.
                            }
                        }
                    }
                    workers.add(worker)
                    worker.start()
                }
                } catch (ignored: Throwable) {
                    // stopped
                }
            }.also { workers.add(it) }.start()
        }

        fun awaitClientCertificate(timeoutMs: Long): X509Certificate? {
            clientSeen.await(timeoutMs, TimeUnit.MILLISECONDS)
            return clientCertificate.get()
        }

        fun stop() {
            running = false
            serverSocket.close()
            for (worker in workers) worker.interrupt()
        }
    }

    fun tlsServer(entry: KeyStore.PrivateKeyEntry): TlsServer = TlsServer(entry)

    /** Test-local mirror of the production namespace discipline, server-side. */
    private class SingleAliasKeyManager(private val entry: KeyStore.PrivateKeyEntry) : X509ExtendedKeyManager() {
        private val chain = entry.certificateChain.filterIsInstance<X509Certificate>().toTypedArray()

        override fun getServerAliases(keyType: String, issuers: Array<out Principal>?): Array<String>? =
            if (keyType.startsWith("EC")) arrayOf(ALIAS) else null

        override fun chooseServerAlias(keyType: String?, issuers: Array<out Principal>?, socket: java.net.Socket?): String? =
            if (keyType != null && keyType.startsWith("EC")) ALIAS else null

        override fun chooseEngineServerAlias(keyType: String?, issuers: Array<out Principal>?, engine: javax.net.ssl.SSLEngine?): String? =
            chooseServerAlias(keyType, issuers, null)

        override fun getCertificateChain(alias: String): Array<X509Certificate> =
            if (alias == ALIAS) chain else emptyArray()

        override fun getPrivateKey(alias: String): PrivateKey? = if (alias == ALIAS) entry.privateKey else null

        override fun getClientAliases(keyType: String, issuers: Array<out Principal>?): Array<String> = emptyArray()
        override fun chooseClientAlias(
            keyType: Array<out String>,
            issuers: Array<out Principal>?,
            socket: java.net.Socket?,
        ): String? = null
        override fun chooseEngineClientAlias(
            keyType: Array<out String>,
            issuers: Array<out Principal>?,
            engine: javax.net.ssl.SSLEngine?,
        ): String? = null

        private companion object {
            const val ALIAS = "tn188-test-server"
        }
    }
}

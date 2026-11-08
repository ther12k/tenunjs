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
        ServerSocket(0, 50, InetAddress.getLoopbackAddress()).use { server ->
            val echoThread = Thread {
                server.accept().use { client ->
                    val buffer = ByteArray(4096)
                    while (true) {
                        val read = client.getInputStream().read(buffer)
                        if (read < 0) break
                        client.getOutputStream().write(buffer, 0, read)
                        client.getOutputStream().flush()
                    }
                }
            }
            echoThread.start()

            val connected = fixture.callAsync(
                "connect",
                JSONObject().put("host", "127.0.0.1").put("port", server.localPort).put("timeoutMs", 8000),
            )
            assertTrue(connected.toString(), connected.getBoolean("ok"))

            val written = fixture.callAsync("write", JSONObject().put("data", JSONArray(listOf(1, 2, 3, 254, 255))))
            assertTrue(written.toString(), written.getBoolean("ok"))
            val echoed = fixture.awaitEvent(8_000) { it.optString("k") == "data" }
            assertNotNull("echo data event", echoed)
            assertEquals(
                listOf(1, 2, 3, 254, 255),
                echoed!!.getJSONArray("b").let { array -> (0 until array.length()).map { array.getInt(it) } },
            )

            // The session replays linked on register — one linked event, no noise.
            val linked = fixture.awaitEvent(2_000) { it.optString("k") == "link" && it.optString("s") == "linked" }
            assertNotNull(linked)

            assertTrue(fixture.callAsync("close", JSONObject()).getBoolean("ok"))
            assertTrue(fixture.callAsync("close", JSONObject()).getBoolean("ok")) // idempotent
            val offline = fixture.awaitEvent(8_000) { it.optString("k") == "link" && it.optString("s") == "offline" }
            assertNotNull("offline after close", offline)
            assertEquals("link-lost", fixture.callAsync("write", JSONObject().put("data", JSONArray())).getJSONObject("failure").getString("kind"))
            echoThread.join(3_000)
        }
    }

    @Test
    fun remoteCloseDeliversOfflineThroughTheBridge() {
        ServerSocket(0, 50, InetAddress.getLoopbackAddress()).use { server ->
            val accepted = CountDownLatch(1)
            Thread {
                server.accept().use { client ->
                    accepted.countDown()
                    client.close() // the companion device powers off
                }
            }.start()
            val connected = fixture.callAsync(
                "connect",
                JSONObject().put("host", "127.0.0.1").put("port", server.localPort).put("timeoutMs", 8000),
            )
            assertTrue(connected.toString(), connected.getBoolean("ok"))
            assertTrue(accepted.await(3, TimeUnit.SECONDS))
            val offline = fixture.awaitEvent(8_000) { it.optString("k") == "link" && it.optString("s") == "offline" }
            assertNotNull("offline after peer close", offline)
            assertEquals("link-lost", fixture.callAsync("write", JSONObject().put("data", JSONArray())).getJSONObject("failure").getString("kind"))
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

    private val engine = TenunEngine(
        instrumentation.context.assets.open("net_fixture.js").use { it.readAllBytes() },
        registry,
    ).also { engineHolder.set(it) }

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

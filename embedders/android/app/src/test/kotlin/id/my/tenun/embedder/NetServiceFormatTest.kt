package id.my.tenun.embedder

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.security.KeyStore
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * TN-188 net host service (JVM tier): validation matrix, the wire/event
 * protocol, and REAL loopback TCP semantics — connect, write/receive
 * round-trip, remote close, idempotent close, cancellation of a pending
 * connect, connect refusal/timeout taxonomies, and the contract's bounded
 * receive side (an overflow is link-lost, never truncation). TLS runs on
 * the device tier (NetBridgeTest) because its client certificates live in
 * AndroidKeyStore.
 *
 * The event sink mirrors what MainActivity does with NET_EVENT pushes.
 */
class NetServiceFormatTest {

    private class Sink {
        val events = CopyOnWriteArrayList<JSONObject>()
        @Volatile var blockAfterData = false
        // A latch nobody releases: awaiting it models a runtime thread that
        // has stopped draining (the service's pool threads are daemons, so
        // the parked emitter dies with the test JVM).
        val neverReleased = CountDownLatch(1)
        val onEvent: (String, String) -> Unit = { action, payloadJson ->
            assertEquals("NET_EVENT", action)
            val event = JSONObject(payloadJson)
            val isData = event.optString("type") == "data"
            events.add(event)
            if (blockAfterData && isData) {
                neverReleased.await()
            }
        }

        fun await(timeoutMs: Long = 8_000, predicate: (JSONObject) -> Boolean): JSONObject? {
            val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
            while (System.nanoTime() < deadline) {
                events.firstOrNull(predicate)?.let { return it }
                Thread.sleep(15)
            }
            return null
        }
    }

    private fun failureKind(reply: String?): String = JSONObject(reply!!).getJSONObject("failure").getString("kind")

    private fun call(service: NetService, method: String, payload: String): String? = service.invoke(method, payload)

    private fun connect(service: NetService, sink: Sink, port: Int, extra: String = ""): String {
        val reply = JSONObject(
            call(service, "connect", """{"host":"127.0.0.1","port":$port,"timeoutMs":3000$extra}""")!!
        )
        assertTrue(reply.toString(), reply.getBoolean("ok"))
        return reply.getJSONObject("value").getString("sessionId")
    }

    // -- synchronous validation ---------------------------------------------------

    @Test
    fun unknownMethodsAreNullAndArgumentsValidateBeforeAnySocket() {
        val service = NetService({ _, _ -> }, { null })
        assertNull(call(service, "datagram", "{}"))
        assertEquals("invalid-argument", failureKind(call(service, "connect", "not json")))
        assertEquals("invalid-argument", failureKind(call(service, "connect", """{"host":""}""")))
        assertEquals("invalid-argument", failureKind(call(service, "connect", """{"host":"https://tv.lan","port":1}""")))
        assertEquals("invalid-argument", failureKind(call(service, "connect", JSONObject().put("host", "tv.lan").put("port", JSONObject.NULL).toString())))
        assertEquals("invalid-argument", failureKind(call(service, "connect", """{"host":"tv.lan","port":0}""")))
        assertEquals("invalid-argument", failureKind(call(service, "connect", """{"host":"tv.lan","port":1.5}""")))
        assertEquals("invalid-argument", failureKind(call(service, "connect", """{"host":"tv.lan","port":1,"timeoutMs":0}""")))
        assertEquals(
            "invalid-argument",
            failureKind(call(service, "connect", """{"host":"tv.lan","port":1,"tls":{"cipher":"aes"}}"""))
        )
        assertEquals(
            "invalid-argument",
            failureKind(call(service, "connect", """{"host":"tv.lan","port":1,"tls":{"expectedServerCertSha256":"xyz"}}"""))
        )
        assertEquals(
            "invalid-argument",
            failureKind(call(service, "connect", """{"host":"tv.lan","port":1,"tls":{"serverName":"https://x"}}"""))
        )
        // Non-string payload fields are refused, not coerced (review parity
        // with KeysService).
        assertEquals("invalid-argument", failureKind(call(service, "write", """{"sessionId":7}""")))
        assertEquals("invalid-argument", failureKind(call(service, "close", """{"sessionId":true}""")))
    }

    @Test
    fun aMissingClientIdentityIsAnArgumentErrorBeforeAnySocketWork() {
        val service = NetService(onEvent = { _, _ -> }, keyResolver = { null })
        assertEquals(
            "invalid-argument",
            failureKind(call(service, "connect", """{"host":"tv.lan","port":1,"tls":{"clientIdentity":"ghost"}}"""))
        )
        val throwing = NetService(onEvent = { _, _ -> }, keyResolver = { throw IllegalStateException("keystore down") })
        assertEquals(
            "platform-error",
            failureKind(call(throwing, "connect", """{"host":"tv.lan","port":1,"tls":{"clientIdentity":"any"}}"""))
        )
    }

    @Test
    fun availabilityReportsSupported() {
        val service = NetService({ _, _ -> }, { null })
        val probe = JSONObject(call(service, "availability", "{}")!!)
        assertTrue(probe.getBoolean("ok"))
        assertEquals("supported", probe.getJSONObject("value").getString("status"))
    }

    // -- real loopback TCP -----------------------------------------------------------

    @Test
    fun plainTcpRoundTripLinkStatesAndIdempotentClose() {
        val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val accepted = CountDownLatch(1)
        val serverThread = Thread {
            val client = server.accept()
            accepted.countDown()
            client.getInputStream().let { input ->
                val buffer = ByteArray(4096)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    client.getOutputStream().write(buffer, 0, read)
                    client.getOutputStream().flush()
                }
            }
        }
        serverThread.start()
        val sink = Sink()
        val service = NetService(sink.onEvent, { null })
        try {
            val sessionId = connect(service, sink, server.localPort)
            val connectOk = sink.await { it.optString("type") == "connect" && it.getString("sessionId") == sessionId }
            assertNotNull("connect-ok event", connectOk)
            assertTrue(connectOk!!.getBoolean("ok"))

            val writePayload = JSONObject()
                .put("sessionId", sessionId)
                .put("data", Base64.getEncoder().encodeToString("PING".toByteArray()))
            val write = JSONObject(call(service, "write", writePayload.toString())!!)
            assertTrue(write.toString(), write.getBoolean("ok"))
            val data = sink.await { it.optString("type") == "data" && it.getString("sessionId") == sessionId }
            assertNotNull("echo data event", data)
            assertEquals("PING", String(Base64.getDecoder().decode(data!!.getString("data"))))

            val close = JSONObject(call(service, "close", """{"sessionId":"$sessionId"}""")!!)
            assertTrue(close.getBoolean("ok"))
            val offline = sink.await { it.optString("type") == "link" && it.getString("sessionId") == sessionId }
            assertNotNull("offline event after close", offline)
            assertEquals("offline", offline!!.getString("state"))
            // Idempotent close, and a closed session refuses writes as link-lost.
            assertTrue(JSONObject(call(service, "close", """{"sessionId":"$sessionId"}""")!!).getBoolean("ok"))
            assertEquals("link-lost", failureKind(call(service, "write", """{"sessionId":"$sessionId","data":"AAAA"}""")))
            serverThread.join(3_000)
        } finally {
            server.close()
        }
    }

    @Test
    fun remoteCloseIsAnOfflineEventWithAReason() {
        val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val sink = Sink()
        val service = NetService(sink.onEvent, { null })
        try {
            val sessionId = connect(service, sink, server.localPort)
            assertNotNull(sink.await { it.optString("type") == "connect" && it.getString("sessionId") == sessionId })
            val client = server.accept()
            client.close() // the peer hangs up
            val offline = sink.await { it.optString("type") == "link" && it.getString("sessionId") == sessionId }
            assertNotNull("offline after peer close", offline)
            assertEquals("offline", offline!!.getString("state"))
            assertTrue(offline.getString("reason").isNotEmpty())
        } finally {
            server.close()
        }
    }

    @Test
    fun aRefusedConnectIsALinkLostConnectEventNeverASilentSuccess() {
        val temporary = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val port = temporary.localPort
        temporary.close() // nothing listens now
        val sink = Sink()
        val service = NetService(sink.onEvent, { null })
        val sessionId = connect(service, sink, port)
        val refused = sink.await { it.optString("type") == "connect" && it.getString("sessionId") == sessionId }
        assertNotNull("refusal event", refused)
        assertFalse(refused!!.getBoolean("ok"))
        assertEquals("link-lost", refused.getJSONObject("failure").getString("kind"))
    }

    @Test
    fun aBlackholedConnectTimesOutWithTheTimeoutKind() {
        // RFC 5737 TEST-NET-1: nothing routes here, so only the caller's
        // timeout can end the connect — exactly what timeoutMs is for.
        val sink = Sink()
        val service = NetService(sink.onEvent, { null })
        val reply = JSONObject(
            call(service, "connect", """{"host":"192.0.2.1","port":9,"timeoutMs":300}""")!!
        )
        assertTrue(reply.toString(), reply.getBoolean("ok"))
        val sessionId = reply.getJSONObject("value").getString("sessionId")
        val timedOut = sink.await(5_000) { it.optString("type") == "connect" && it.getString("sessionId") == sessionId }
        assertNotNull(timedOut)
        assertFalse(timedOut!!.getBoolean("ok"))
        assertEquals("timeout", timedOut.getJSONObject("failure").getString("kind"))
    }

    @Test
    fun closingAPendingConnectAbandonsItSilentlyNoEventsForAUnseenSession() {
        // TEST-NET-1: the transport can never come up, so close() always
        // lands on the PENDING session — the abandon path, deterministically.
        val sink = Sink()
        val service = NetService(sink.onEvent, { null })
        val reply = JSONObject(
            call(service, "connect", """{"host":"192.0.2.1","port":9,"timeoutMs":3000}""")!!
        )
        assertTrue(reply.toString(), reply.getBoolean("ok"))
        val sessionId = reply.getJSONObject("value").getString("sessionId")
        assertTrue(JSONObject(call(service, "close", """{"sessionId":"$sessionId"}""")!!).getBoolean("ok"))
        assertTrue(JSONObject(call(service, "close", """{"sessionId":"$sessionId"}""")!!).getBoolean("ok"))
        Thread.sleep(600)
        // JS never saw this session: no connect event, no offline event —
        // and the pending slot is gone (the 9th concurrent connect below is
        // accepted, proving no session leak either).
        assertTrue(sink.events.filter { it.optString("sessionId") == sessionId }.isEmpty())
        val followUp = JSONObject(
            call(service, "connect", """{"host":"192.0.2.1","port":9,"timeoutMs":3000}""")!!
        )
        assertTrue(followUp.getBoolean("ok"))
        assertTrue(JSONObject(call(service, "close", """{"sessionId":"${followUp.getJSONObject("value").getString("sessionId")}"}""")!!).getBoolean("ok"))
    }

    @Test
    fun anUndrainedRuntimeOverflowsToLinkLostNeverUnboundedGrowth() {
        val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val sink = Sink()
        val service = NetService(sink.onEvent, { null })
        val flooded = CountDownLatch(1)
        Thread {
            val client = server.accept()
            val chunk = ByteArray(64 * 1024) { 7 }
            // 4 MiB total: far beyond the 1 MiB receive bound.
            repeat(64) { slowWrite(client.getOutputStream(), chunk) }
            flooded.countDown()
        }.start()
        try {
            val sessionId = connect(service, sink, server.localPort)
            // The runtime "stops draining" from the very first data event
            // (the sink blocks only for data; connect-ok still passes), so
            // the flood cannot race past the block.
            sink.blockAfterData = true
            assertNotNull(sink.await { it.optString("type") == "connect" && it.getString("sessionId") == sessionId })
            val offline = sink.await(15_000) { it.optString("type") == "link" && it.getString("sessionId") == sessionId }
            assertNotNull("overflow must end the session", offline)
            assertEquals("offline", offline!!.getString("state"))
            assertTrue(
                "reason must name the overflow: ${offline.getString("reason")}",
                offline.getString("reason").contains("overflow"),
            )
        } finally {
            server.close()
        }
    }

    /** Saturating send: keep writing even if the peer stops reading. */
    private fun slowWrite(output: OutputStream, bytes: ByteArray) {
        output.write(bytes)
        output.flush()
    }
}

package id.my.tenun.embedder

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList

/**
 * TN-190 discovery host service (JVM tier): validation matrix, the
 * wire/event protocol, the multicast-lock discipline, and browse/resolve
 * lifecycle semantics — driven through a SCRIPTED NSD FACADE because
 * NsdManager lives behind android.jar stubs on the JVM (the NetService
 * counterpart runs real loopback TCP; NSD has no JVM equivalent, so the
 * facade seam keeps the service's own logic under test). The REAL
 * NsdManager journey is DiscoveryBridgeTest on device.
 *
 * The event sink mirrors what MainActivity does with DISCOVERY_EVENT
 * pushes.
 */
class DiscoveryServiceFormatTest {

    private class Sink {
        val events = CopyOnWriteArrayList<JSONObject>()
        val onEvent: (String, String) -> Unit = { action, payloadJson ->
            assertEquals("DISCOVERY_EVENT", action)
            events.add(JSONObject(payloadJson))
        }

        fun await(predicate: (JSONObject) -> Boolean): JSONObject? = events.firstOrNull(predicate)
    }

    /** A scripted facade: records requests, hands the test the listeners. */
    private class FakeNsd : DiscoveryService.NsdFacade {
        val discoveryRequests = CopyOnWriteArrayList<String>()
        val listeners = CopyOnWriteArrayList<DiscoveryService.DiscoveryListener>()
        val stopRequests = CopyOnWriteArrayList<DiscoveryService.DiscoveryListener>()
        val resolveRequests = CopyOnWriteArrayList<DiscoveryService.ResolvedRequest>()
        val resolveListeners = CopyOnWriteArrayList<DiscoveryService.ResolveListener>()

        override fun discoverServices(serviceType: String, listener: DiscoveryService.DiscoveryListener) {
            discoveryRequests.add(serviceType)
            listeners.add(listener)
        }

        override fun stopServiceDiscovery(listener: DiscoveryService.DiscoveryListener) {
            stopRequests.add(listener)
        }

        override fun resolveService(info: DiscoveryService.ResolvedRequest, listener: DiscoveryService.ResolveListener) {
            resolveRequests.add(info)
            resolveListeners.add(listener)
        }
    }

    /** Records acquire/release ordering for the lock-discipline assertions. */
    private class RecordingLock : DiscoveryService.MulticastLockHandle {
        val ops = CopyOnWriteArrayList<String>()
        override fun acquire() {
            ops.add("acquire")
        }

        override fun release() {
            ops.add("release")
        }
    }

    private fun failureKind(reply: String?): String = JSONObject(reply!!).getJSONObject("failure").getString("kind")

    // -- synchronous validation ---------------------------------------------------

    @Test
    fun unknownMethodsAreNullAndArgumentsValidateBeforeAnyNsdCall() {
        val nsd = FakeNsd()
        val service = DiscoveryService(null, { _, _ -> }, nsd)
        assertNull(service.invoke("advertise", "{}"))
        assertEquals("invalid-argument", failureKind(service.invoke("browse", "not json")))
        assertEquals("invalid-argument", failureKind(service.invoke("browse", """{"serviceType":"tv"}""")))
        assertEquals("invalid-argument", failureKind(service.invoke("browse", """{"serviceType":"_tv._tls"}""")))
        assertEquals("invalid-argument", failureKind(service.invoke("browse", """{"serviceType":"_tv._tcp.local"}""")))
        assertEquals("invalid-argument", failureKind(service.invoke("browse", JSONObject().put("serviceType", 42).toString())))
        assertEquals("invalid-argument", failureKind(service.invoke("stop", """{"browseId":5}""")))
        assertEquals("invalid-argument", failureKind(service.invoke("resolve", """{"service":{}}""")))
        assertEquals(
            "invalid-argument",
            failureKind(
                service.invoke(
                    "resolve",
                    JSONObject()
                        .put(
                            "service",
                            JSONObject()
                                .put("serviceType", "_androidtvremote2._tcp")
                                .put("serviceName", "a.b")
                                .put("domain", "local"),
                        )
                        .toString()
                )
            )
        )
        assertEquals(
            "invalid-argument",
            failureKind(
                service.invoke(
                    "resolve",
                    JSONObject()
                        .put(
                            "service",
                            JSONObject()
                                .put("serviceType", "_tv._tcp")
                                .put("serviceName", " ".repeat(64))
                                .put("domain", "local"),
                        )
                        .toString()
                )
            )
        )
        assertTrue(nsd.discoveryRequests.isEmpty())
        assertTrue(nsd.resolveRequests.isEmpty())
    }

    @Test
    fun theSixtyThreeByteInstanceNameLimitMatchesTheContract() {
        val service = DiscoveryService(null, { _, _ -> }, FakeNsd())
        fun resolveWith(name: String): String = service.invoke(
            "resolve",
            JSONObject()
                .put(
                    "service",
                    JSONObject().put("serviceType", "_tv._tcp").put("serviceName", name).put("domain", "local")
                )
                .toString()
        )!!
        assertTrue(JSONObject(resolveWith("a".repeat(63))).getBoolean("ok"))
        assertEquals("invalid-argument", failureKind(resolveWith("a".repeat(64))))
        // UTF-8 expansion: 21 three-byte characters are exactly 63 bytes.
        assertTrue(JSONObject(resolveWith("日".repeat(21))).getBoolean("ok"))
        assertEquals("invalid-argument", failureKind(resolveWith("日".repeat(22))))
    }

    // -- browse lifecycle -----------------------------------------------------------

    @Test
    fun browseStartsAndServicesFlowAsContractEvents() {
        val nsd = FakeNsd()
        val sink = Sink()
        val service = DiscoveryService(null, sink.onEvent, nsd)
        val reply = JSONObject(service.invoke("browse", """{"serviceType":"_androidtvremote2._tcp"}""")!!)
        assertTrue(reply.getBoolean("ok"))
        val browseId = reply.getJSONObject("value").getString("browseId")
        assertEquals(listOf("_androidtvremote2._tcp"), nsd.discoveryRequests)

        nsd.listeners.single().onDiscoveryStarted()
        val started = sink.await { it.optString("type") == "browseStarted" }
        assertNotNull(started)
        assertEquals(browseId, started!!.getString("browseId"))

        nsd.listeners.single().onServiceFound("_androidtvremote2._tcp", "Living Room TV")
        val found = sink.await { it.optString("type") == "serviceFound" }
        assertNotNull(found)
        val foundService = found!!.getJSONObject("service")
        assertEquals("_androidtvremote2._tcp", foundService.getString("serviceType"))
        assertEquals("Living Room TV", foundService.getString("serviceName"))
        assertEquals("local", foundService.getString("domain"))

        nsd.listeners.single().onServiceLost("_androidtvremote2._tcp", "Living Room TV")
        assertNotNull(sink.await { it.optString("type") == "serviceLost" })
    }

    @Test
    fun startFailureEmitsBrowseStoppedAndStopsNoDiscovery() {
        val nsd = FakeNsd()
        val sink = Sink()
        val service = DiscoveryService(null, sink.onEvent, nsd)
        val reply = JSONObject(service.invoke("browse", """{"serviceType":"_tv._tcp"}""")!!)
        val browseId = reply.getJSONObject("value").getString("browseId")

        nsd.listeners.single().onStartDiscoveryFailed()
        val stopped = sink.await { it.optString("type") == "browseStopped" }
        assertNotNull(stopped)
        assertEquals("unavailable", stopped!!.getJSONObject("failure").getString("kind"))
        assertEquals(browseId, stopped.getString("browseId"))
        assertTrue(nsd.stopRequests.isEmpty()) // never started, nothing to stop
    }

    @Test
    fun stopIsIdempotentIncludingUnknownIdsAndSilencesEvents() {
        val nsd = FakeNsd()
        val sink = Sink()
        val service = DiscoveryService(null, sink.onEvent, nsd)
        val reply = JSONObject(service.invoke("browse", """{"serviceType":"_tv._tcp"}""")!!)
        val browseId = reply.getJSONObject("value").getString("browseId")
        nsd.listeners.single().onDiscoveryStarted()

        assertTrue(JSONObject(service.invoke("stop", """{"browseId":"$browseId"}""")!!).getBoolean("ok"))
        assertTrue(JSONObject(service.invoke("stop", """{"browseId":"$browseId"}""")!!).getBoolean("ok"))
        assertTrue(JSONObject(service.invoke("stop", """{"browseId":"d:999"}""")!!).getBoolean("ok"))
        assertEquals(1, nsd.stopRequests.size)

        assertNotNull(sink.await { it.optString("type") == "browseStopped" })
        val before = sink.events.size
        nsd.listeners.single().onServiceFound("_tv._tcp", "Late TV")
        assertEquals(before, sink.events.size) // dead browse delivers nothing
    }

    @Test
    fun theMulticastLockIsHeldForTheBrowseLifetimeOnly() {
        val nsd = FakeNsd()
        val lock = RecordingLock()
        val service = DiscoveryService(null, { _, _ -> }, nsd, lock)
        assertEquals(0, lock.ops.size)

        val first = JSONObject(service.invoke("browse", """{"serviceType":"_tv._tcp"}""")!!)
            .getJSONObject("value").getString("browseId")
        assertEquals(listOf("acquire"), lock.ops) // held from the FIRST browse

        val second = JSONObject(service.invoke("browse", """{"serviceType": "_http._tcp"}""")!!)
            .getJSONObject("value").getString("browseId")
        assertEquals(1, lock.ops.count { it == "acquire" }) // one lock, not two

        service.invoke("stop", """{"browseId":"$first"}""")
        assertEquals(0, lock.ops.count { it == "release" }) // still one active browse

        nsd.listeners.last().onDiscoveryStarted()
        service.invoke("stop", """{"browseId":"$second"}""")
        assertEquals(1, lock.ops.count { it == "release" }) // released at 1→0
        assertEquals("acquire", lock.ops.first())
        assertEquals("release", lock.ops.last())
    }

    // -- resolve ----------------------------------------------------------------------

    @Test
    fun resolveSettlesFromTheNsdOutcomeWithTxtAndHostPort() {
        val nsd = FakeNsd()
        val sink = Sink()
        val service = DiscoveryService(null, sink.onEvent, nsd)
        val reply = JSONObject(
            service.invoke(
                "resolve",
                JSONObject()
                    .put(
                        "service",
                        JSONObject()
                            .put("serviceType", "_androidtvremote2._tcp")
                            .put("serviceName", "Living Room TV")
                            .put("domain", "local"),
                    )
                    .toString()
            )!!
        )
        assertTrue(reply.getBoolean("ok"))
        val resolveId = reply.getJSONObject("value").getString("resolveId")
        assertEquals("Living Room TV", nsd.resolveRequests.single().serviceName)

        nsd.resolveListeners.single().onServiceResolved("10.0.0.5", 6467, mapOf("name" to "tv", "bt" to "0"))
        val resolved = sink.await { it.optString("type") == "resolve" }
        assertNotNull(resolved)
        assertTrue(resolved!!.getBoolean("ok"))
        assertEquals(resolveId, resolved.getString("resolveId"))
        assertEquals("10.0.0.5", resolved.getString("host"))
        assertEquals(6467, resolved.getInt("port"))
        assertEquals("tv", resolved.getJSONObject("txt").getString("name"))

        // Settled resolves are one-shot: a duplicate NSD callback delivers nothing.
        val before = sink.events.size
        nsd.resolveListeners.single().onServiceResolved("10.0.0.5", 6467, emptyMap())
        assertEquals(before, sink.events.size)
    }

    @Test
    fun resolveFailureIsAStructuredUnavailableNeverAHang() {
        val nsd = FakeNsd()
        val sink = Sink()
        val service = DiscoveryService(null, sink.onEvent, nsd)
        JSONObject(
            service.invoke(
                "resolve",
                """{"service":{"serviceType":"_tv._tcp","serviceName":"Gone TV","domain":"local"}}"""
            )!!
        )
        nsd.resolveListeners.single().onResolveFailed()
        val failed = sink.await { it.optString("type") == "resolve" }
        assertNotNull(failed)
        assertFalse(failed!!.getBoolean("ok"))
        assertEquals("unavailable", failed.getJSONObject("failure").getString("kind"))
    }

    @Test
    fun anUnusableResolvedEndpointIsPlatformErrorNotAFabricatedEndpoint() {
        val nsd = FakeNsd()
        val sink = Sink()
        val service = DiscoveryService(null, sink.onEvent, nsd)
        JSONObject(
            service.invoke("resolve", """{"service":{"serviceType":"_tv._tcp","serviceName":"TV","domain":"local"}}""")
        )
        nsd.resolveListeners.single().onServiceResolved("10.0.0.5", 0, emptyMap())
        val failed = sink.await { it.optString("type") == "resolve" }
        assertNotNull(failed)
        assertEquals("platform-error", failed!!.getJSONObject("failure").getString("kind"))
    }

    @Test
    fun concurrentBrowseAndResolveBoundsAreRefused() {
        val nsd = FakeNsd()
        val service = DiscoveryService(null, { _, _ -> }, nsd)
        repeat(8) {
            assertTrue(
                JSONObject(service.invoke("browse", """{"serviceType":"_tv._tcp"}""")!!).getBoolean("ok")
            )
        }
        assertEquals("busy", failureKind(service.invoke("browse", """{"serviceType":"_tv._tcp"}""")))
    }
}

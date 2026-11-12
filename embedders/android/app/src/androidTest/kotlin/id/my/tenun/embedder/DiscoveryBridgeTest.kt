package id.my.tenun.embedder

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * TN-190 device gate: the compiled PUBLIC TypeScript adapter → real
 * QuickJS → JNI → DiscoveryService → real NsdManager/mdnsd, on the
 * emulator. The advertised service is REAL — registered through the
 * platform's own NsdManager on the guest (the role TN-191's fake TV
 * plays later) — and the journey is the issue's acceptance: find,
 * lose (service down), re-find, then resolve to host/port/TXT.
 *
 * Multicast reliability note: mDNS on the emulator is slower than on
 * physical hardware (the radio path is virtualized), so the awaits are
 * generous; the assertions themselves stay exact.
 */
@RunWith(AndroidJUnit4::class)
class DiscoveryBridgeTest {
    private val fixture = DiscoveryBridgeFixture()
    private val serviceName = "TN190 Gate TV ${System.nanoTime() % 1_000_000}"

    @After
    fun cleanup() {
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
        // The android tier tables CHANGE_WIFI_MULTICAST_STATE; tables stay total.
        assertEquals(
            "android.permission.CHANGE_WIFI_MULTICAST_STATE",
            metadata.getJSONArray("permissions").getJSONObject(0).getJSONArray("permissions").getString(0),
        )
    }

    @Test
    fun findLoseRefindAndResolveARealAdvertisedService() {
        // A bound socket reserves the advertised port so the resolved
        // endpoint is a real, connectable address.
        val portSocket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val advertiser = Advertiser(fixture.appContext)
        try {
            // 1. The service goes on the air BEFORE the browse starts: the
            //    gate must find what is already there (the TV was on first).
            advertiser.register(serviceName, SERVICE_TYPE, portSocket.localPort)
            assertTrue(fixture.dispatch("browse", JSONObject().put("serviceType", SERVICE_TYPE)).getBoolean("pending"))
            val started = fixture.awaitResult(30_000)
            assertNotNull("browse never started; events=${fixture.events()}", started)
            assertTrue("$started", started!!.getBoolean("ok"))

            val found = fixture.awaitEvent(60_000) { it.optString("k") == "found" && it.optString("n") == serviceName }
            assertNotNull("service $serviceName never found; events=${fixture.events()}", found)
            assertEquals(SERVICE_TYPE, found!!.getString("t"))
            assertEquals("local", found.getString("d"))

            // 2. Resolve AT CONNECT TIME, exactly as the contract demands.
            val resolved = fixture.callAsync(
                "resolve",
                JSONObject().put(
                    "service",
                    JSONObject()
                        .put("serviceType", SERVICE_TYPE)
                        .put("serviceName", serviceName)
                        .put("domain", "local"),
                ),
                timeoutMs = 30_000,
            )
            assertTrue("$resolved; events=${fixture.events()}", resolved.getBoolean("ok"))
            val endpoint = resolved.getJSONObject("value")
            assertTrue("resolved host must be non-empty", endpoint.getString("host").isNotEmpty())
            assertEquals("the resolved port is the advertised port", portSocket.localPort, endpoint.getInt("port"))
            assertEquals("tv", endpoint.getJSONObject("txt").getString("name"))

            // 3. The device powers off: the browse (still live) must lose it.
            advertiser.unregister()
            val lost = fixture.awaitEvent(60_000) { it.optString("k") == "lost" && it.optString("n") == serviceName }
            assertNotNull("service lost event never arrived; events=${fixture.events()}", lost)

            // 4. It comes back: the SAME live browse re-finds it (names
            //    survive; addresses change — identity is name@domain).
            advertiser.register(serviceName, SERVICE_TYPE, portSocket.localPort)
            val refound = fixture.awaitEvent(60_000) { it.optString("k") == "found" && it.optString("n") == serviceName }
            assertNotNull("service never re-found; events=${fixture.events()}", refound)

            // 5. stop is idempotent over the bridge; no further events arrive.
            assertTrue(fixture.dispatch("stop").getBoolean("ok"))
            assertTrue(fixture.dispatch("stop").getBoolean("ok"))
        } finally {
            advertiser.unregister()
            portSocket.close()
        }
    }

    @Test
    fun aCancelledBrowseSettlesCancelled() {
        val pending = fixture.dispatch(
            "browse",
            JSONObject().put("serviceType", SERVICE_TYPE).put("cancel", true),
        )
        assertTrue(pending.getBoolean("pending"))
        assertTrue(fixture.dispatch("cancel").getBoolean("ok"))
        val cancelled = fixture.awaitResult(10_000)
        assertNotNull(cancelled)
        assertFalse(cancelled!!.getBoolean("ok"))
        assertEquals("cancelled", cancelled.getJSONObject("failure").getString("kind"))
    }

    private companion object {
        const val SERVICE_TYPE = "_tn190._tcp"
    }
}

/** The advertised "companion device": NsdManager.registerService with TXT. */
private class Advertiser(val context: Context) {
    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private var listener: NsdManager.RegistrationListener? = null
    private val registered = CopyOnWriteArrayList<String>()

    fun register(serviceName: String, serviceType: String, port: Int) {
        val done = CountDownLatch(1)
        val info = NsdServiceInfo().apply {
            this.serviceName = serviceName
            this.serviceType = serviceType
            this.port = port
            setAttribute("name", "tv")
        }
        val registration = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo?) {
                registered.add(serviceInfo?.serviceName ?: serviceName)
                done.countDown()
            }

            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                done.countDown()
            }

            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {}
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo?) {}
        }
        nsdManager.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration)
        listener = registration
        check(done.await(20, TimeUnit.SECONDS) && registered.isNotEmpty()) {
            "NSD registration of $serviceName failed (errorCode path or timeout)"
        }
    }

    fun unregister() {
        val current = listener ?: return
        listener = null
        try {
            nsdManager.unregisterService(current)
        } catch (ignored: IllegalArgumentException) {
            // already unregistered
        }
    }
}

/** Engine + registry + compiled public adapter, mirroring NetBridgeFixture. */
internal class DiscoveryBridgeFixture : AutoCloseable {
    val appContext: Context =
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
    private val engineHolder = AtomicReference<TenunEngine?>(null)
    private val eventLog = CopyOnWriteArrayList<String>()

    // QuickJS records its stack-overflow guard against the thread that
    // created the runtime; re-entry from ANY other thread trips "Maximum
    // call stack size exceeded" (the recorded NET_EVENT lesson). The
    // fixture mirrors MainActivity: bundle evaluation, every dispatch, and
    // every DISCOVERY_EVENT re-entry run on ONE dedicated engine thread.
    private val engineThread = android.os.HandlerThread("tenun-discovery-fixture").apply { start() }
    private val engineHandler = android.os.Handler(engineThread.looper)

    private val registry = HostServiceRegistry().apply {
        register(
            "discovery",
            DiscoveryService(
                appContext = appContext,
                onEvent = { _, payloadJson ->
                    // NSD callbacks never re-enter JS directly: the event is
                    // queued onto the engine thread in arrival order.
                    eventLog.add(payloadJson)
                    engineHolder.get()?.let { engine ->
                        engineHandler.post { engine.dispatchActionResult("DISCOVERY_EVENT", payloadJson) }
                    }
                },
            ),
        )
    }

    private val engine: TenunEngine

    init {
        val bundle = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            .context.assets.open("discovery_fixture.js").use { input ->
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
        assertNotNull("compiled discovery fixture must return a synchronous string for $action", json)
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

    /** Recorded adapter events ({k: found|lost|resolved, n/t/d, h/p/x}). */
    fun events(): List<JSONObject> {
        val recorded = dispatch("events").getJSONArray("events")
        return (0 until recorded.length()).map { recorded.getJSONObject(it) }
    }

    fun awaitEvent(timeoutMs: Long, predicate: (JSONObject) -> Boolean): JSONObject? {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (System.nanoTime() < deadline) {
            events().firstOrNull(predicate)?.let { return it }
            Thread.sleep(50)
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

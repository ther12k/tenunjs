package id.my.tenun.embedder

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import org.json.JSONException
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * TN-190: discovery host service over the TN-154 bridge — mDNS/NSD browse
 * and resolve (ADR-0027, 04-api/discovery.md).
 *
 * The bridge is SYNCHRONOUS but NSD is not, so the service mirrors the
 * wire the TS adapter (packages/platform/src/discovery-native.ts) speaks:
 *  - `browse` validates arguments synchronously (invalid-argument), then
 *    asks the NsdManager to discover ASYNCHRONOUSLY and replies
 *    `{"browseId"}` immediately; the START OUTCOME arrives as an event;
 *  - events are pushed through [onEvent] as "DISCOVERY_EVENT" dispatch
 *    actions, the same host→JS channel NetService uses for NET_EVENT:
 *      {"type":"browseStarted","browseId"}
 *      {"type":"serviceFound","browseId","service":{serviceType,serviceName,domain}}
 *      {"type":"serviceLost","browseId","service":{…}}
 *      {"type":"browseStopped","browseId","failure"?}   (host-side stop)
 *      {"type":"resolve","resolveId","ok":true,"host","port","txt":{…}}
 *      {"type":"resolve","resolveId","ok":false,"failure":{"kind","message"}}
 *  - `stop` is idempotent, including for unknown ids — idempotency across
 *    the boundary must not depend on host memory;
 *  - `resolve` runs asynchronously through the NsdManager resolver and
 *    settles through its event; a resolution failure is a structured
 *    `unavailable` (the service left), never a hang.
 *
 * MULTICAST LOCK: mDNS packets are filtered on many radios while the
 * screen-off/doze multicast filter is active, so the service holds a
 * WifiManager multicast lock for the lifetime of every ACTIVE browse and
 * releases it when the last one stops. The lock is reference-counted by
 * the service itself (one lock object, hold count), never exposed.
 *
 * DOMAIN: NsdManager does not report the browsing domain — Android
 * resolves on "local" — so found services carry domain "local", the tier
 * companions use. The resolve payload MAY name another domain; the host
 * browses/resolves through Android's resolver either way.
 *
 * The [NsdFacade] seam keeps the service testable on the JVM (where
 * android.jar stubs throw): [AndroidNsdFacade] is the production
 * implementation, tests script a fake. Bounds mirror
 * packages/platform/src/discovery-validation.ts exactly.
 */
class DiscoveryService(
    private val appContext: Context?,
    private val onEvent: (action: String, payloadJson: String) -> Unit,
    facade: NsdFacade? = null,
    multicastLock: MulticastLockHandle? = null,
) : NativeService {

    /** The multicast lock surface — the Android one plus a recording fake in tests. */
    interface MulticastLockHandle {
        fun acquire()
        fun release()
    }

    /**
     * The lock the service holds: the caller's recording fake in tests, the
     * real WifiManager lock in production, and a no-op ONLY in the scripted
     * JVM tier where no Context exists (the lock discipline is asserted by
     * the recording fake, not by the default).
     */
    private val multicastLock: MulticastLockHandle = multicastLock
        ?: if (appContext != null) AndroidMulticastLock(appContext) else NoopMulticastLock

    /** One non-reference-counted WifiManager multicast lock. */
    class AndroidMulticastLock(private val context: Context?) : MulticastLockHandle {
        private val lock: WifiManager.MulticastLock by lazy {
            val wifi = requireNotNull(context).applicationContext
                .getSystemService(Context.WIFI_SERVICE) as WifiManager
            wifi.createMulticastLock("tenun-discovery").apply { setReferenceCounted(false) }
        }

        override fun acquire() {
            if (!lock.isHeld()) lock.acquire()
        }

        override fun release() {
            if (lock.isHeld()) lock.release()
        }
    }

    private object NoopMulticastLock : MulticastLockHandle {
        override fun acquire() {}
        override fun release() {}
    }

    /** The NSD surface the service needs — implemented by NsdManager. */
    interface NsdFacade {
        fun discoverServices(
            serviceType: String,
            listener: DiscoveryListener,
        )

        fun stopServiceDiscovery(listener: DiscoveryListener)

        fun resolveService(info: ResolvedRequest, listener: ResolveListener)
    }

    interface DiscoveryListener {
        fun onDiscoveryStarted()
        fun onStartDiscoveryFailed()
        fun onServiceFound(serviceType: String, serviceName: String)
        fun onServiceLost(serviceType: String, serviceName: String)
        fun onStopDiscoveryFailed()
        fun onDiscoveryStopped()
    }

    interface ResolveListener {
        /** errorCode mirrors NsdManager's FAILURE_* constants (0 = unknown). */
        fun onResolveFailed(errorCode: Int)
        fun onServiceResolved(host: String, port: Int, txt: Map<String, String>)
    }

    /** The resolve request as the facade sees it (service identity). */
    interface ResolvedRequest {
        val serviceType: String
        val serviceName: String
    }

    override fun invoke(method: String, payloadJson: String): String? {
        return try {
            when (method) {
                "availability" -> availability()
                "browse" -> browse(payloadJson)
                "stop" -> stop(payloadJson)
                "resolve" -> resolve(payloadJson)
                else -> null
            }
        } catch (t: Throwable) {
            failure("platform-error", t.message ?: t.javaClass.simpleName)
        }
    }

    private fun availability(): String = ok(JSONObject().put("status", "supported"))

    // -- browse ------------------------------------------------------------------

    private inner class Browse(
        val id: String,
        val serviceType: String,
    ) {
        val stopped = AtomicBoolean(false)
        val started = AtomicBoolean(false)
        /** Set once the discoverServices REQUEST was accepted (stop needs this). */
        val requested = AtomicBoolean(false)
        val listener = object : DiscoveryListener {
            override fun onDiscoveryStarted() {
                if (stopped.get()) return
                started.set(true)
                emit(JSONObject().put("type", "browseStarted").put("browseId", id))
            }

            override fun onStartDiscoveryFailed() {
                // The request itself failed: nothing is registered natively,
                // so the terminal stop must not attempt a native stop.
                requested.set(false)
                stopBrowse(this@Browse, "unavailable", "NSD could not start discovery for $serviceType")
            }

            override fun onServiceFound(foundType: String, foundName: String) {
                if (stopped.get()) return
                if (!isValidServiceName(foundName)) return // host bug stays invisible, not fatal
                val type = canonicalServiceType(foundType) ?: serviceType
                emit(
                    JSONObject()
                        .put("type", "serviceFound")
                        .put("browseId", id)
                        .put(
                            "service",
                            JSONObject()
                                .put("serviceType", type)
                                .put("serviceName", foundName)
                                .put("domain", LOCAL_DOMAIN),
                        )
                )
            }

            override fun onServiceLost(lostType: String, lostName: String) {
                if (stopped.get()) return
                if (!isValidServiceName(lostName)) return
                val type = canonicalServiceType(lostType) ?: serviceType
                emit(
                    JSONObject()
                        .put("type", "serviceLost")
                        .put("browseId", id)
                        .put(
                            "service",
                            JSONObject()
                                .put("serviceType", type)
                                .put("serviceName", lostName)
                                .put("domain", LOCAL_DOMAIN),
                        )
                )
            }

            override fun onStopDiscoveryFailed() {
                // The system could not stop us — the browse is dead from JS's
                // perspective either way; silence it loudly.
                stopBrowse(this@Browse, "platform-error", "NSD could not stop discovery for $serviceType")
            }

            override fun onDiscoveryStopped() {
                stopBrowse(this@Browse, null, null)
            }
        }
    }

    /**
     * Legacy Android returns browse/resolve service types in dotted DNS
     * presentation form (`_androidtvremote2._tcp.`); the contract wire
     * carries exactly the requested pair. Strip the trailing dot so a
     * discovered identity round-trips into resolve; null means the
     * callback carried nothing usable.
     */
    private fun canonicalServiceType(platformType: String): String? {
        val trimmed = platformType.trimEnd('.')
        return if (isValidServiceType(trimmed)) trimmed else null
    }

    private fun browse(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val serviceType = stringField(payload, "serviceType")
            ?: return failure("invalid-argument", "serviceType must be a string")
        if (!isValidServiceType(serviceType)) {
            return failure("invalid-argument", "serviceType must be _name._tcp or _name._udp (label 1..63 chars)")
        }
        if (browses.size >= MAX_BROWSES) {
            return failure("busy", "too many concurrent discovery browses (${browses.size})")
        }
        val id = "d:${nextBrowseId.incrementAndGet()}"
        val browse = Browse(id, serviceType)
        browses[id] = browse
        // The lock acquisition and the NSD request are one transaction: any
        // failure rolls back the registration AND the lock accounting, and a
        // permission refusal is `denied` (naming it), not platform-error.
        try {
            holdMulticastLock()
        } catch (t: Throwable) {
            browses.remove(id)
            return if (t is SecurityException) {
                failure(
                    "denied",
                    "the multicast lock was refused: ${t.message ?: t.javaClass.simpleName}",
                )
            } else {
                failure(
                    "platform-error",
                    "multicast lock acquisition failed: ${t.message ?: t.javaClass.simpleName}",
                )
            }
        }
        try {
            nsd.discoverServices(serviceType, browse.listener)
            browse.requested.set(true)
        } catch (t: Throwable) {
            browses.remove(id)
            releaseMulticastLock()
            return failure(
                "platform-error",
                "NSD discovery request failed: ${t.message ?: t.javaClass.simpleName}",
            )
        }
        return ok(JSONObject().put("browseId", id))
    }

    /** Idempotent terminal transition: stop NSD, drop the browse, emit once. */
    private fun stopBrowse(browse: Browse, kind: String?, message: String?) {
        if (!browse.stopped.compareAndSet(false, true)) return
        browses.remove(browse.id)
        releaseMulticastLock()
        try {
            // Stop whenever the REQUEST was accepted — even before
            // onDiscoveryStarted arrives (a stop during pending start must
            // still cancel the native registration). If the request itself
            // failed, nothing is registered and stopping is skipped.
            if (browse.requested.get()) {
                nsd.stopServiceDiscovery(browse.listener)
            }
        } catch (ignored: Throwable) {
            // The browse is dead to JS either way; no event may follow.
        }
        val event = JSONObject().put("type", "browseStopped").put("browseId", browse.id)
        if (kind != null) {
            event.put("failure", JSONObject().put("kind", kind).put("message", message))
        }
        emit(event)
    }

    private fun stop(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val browseId = stringField(payload, "browseId")
            ?: return failure("invalid-argument", "browseId must be a string")
        val browse = browses.remove(browseId)
            ?: return ok(JSONObject.NULL) // idempotent across the boundary
        stopBrowse(browse, null, null)
        return ok(JSONObject.NULL)
    }

    // -- resolve -------------------------------------------------------------------

    private inner class Resolve(
        val id: String,
        val request: ResolvedRequest,
    ) {
        val settled = AtomicBoolean(false)
        val listener = object : ResolveListener {
            override fun onResolveFailed(errorCode: Int) {
                // Legacy NSD permits ONE outstanding resolve per client;
                // a second request fails ALREADY_ACTIVE — that is OUR
                // serialization problem, not the service being gone.
                val (kind, message) = if (errorCode == FAILURE_ALREADY_ACTIVE) {
                    "busy" to "another resolve is still in flight on this platform tier"
                } else {
                    "unavailable" to "the service is no longer on the network"
                }
                settle(
                    JSONObject()
                        .put("type", "resolve")
                        .put("resolveId", id)
                        .put("ok", false)
                        .put("failure", JSONObject().put("kind", kind).put("message", message))
                )
            }

            override fun onServiceResolved(host: String, port: Int, txt: Map<String, String>) {
                if (port !in 1..65535 || !isValidHost(host)) {
                    settle(
                        JSONObject()
                            .put("type", "resolve")
                            .put("resolveId", id)
                            .put("ok", false)
                            .put(
                                "failure",
                                JSONObject()
                                    .put("kind", "platform-error")
                                    .put("message", "NSD resolved an unusable endpoint"),
                            )
                    )
                    return
                }
                val txtJson = JSONObject()
                var entries = 0
                for ((key, value) in txt) {
                    if (entries >= MAX_TXT_ENTRIES) break
                    if (!isValidTxtKey(key)) continue
                    if ("$key=$value".toByteArray(Charsets.UTF_8).size > MAX_TXT_CONSTITUENT_BYTES) continue
                    txtJson.put(key, value)
                    entries += 1
                }
                settle(
                    JSONObject()
                        .put("type", "resolve")
                        .put("resolveId", id)
                        .put("ok", true)
                        .put("host", host)
                        .put("port", port)
                        .put("txt", txtJson)
                )
            }
        }

        /** Exactly-once settlement shared with the deadline timer. */
        fun settle(event: JSONObject) {
            if (!settled.compareAndSet(false, true)) return
            resolves.remove(id)
            emit(event)
        }

        /** The contract: resolution is structured, never a hang. */
        fun armDeadline() {
            timeouts.schedule({
                settle(
                    JSONObject()
                        .put("type", "resolve")
                        .put("resolveId", id)
                        .put("ok", false)
                        .put(
                            "failure",
                            JSONObject()
                                .put("kind", "timeout")
                                .put("message", "resolve did not answer within ${RESOLVE_TIMEOUT_MS}ms"),
                        )
                )
            }, RESOLVE_TIMEOUT_MS.toLong(), TimeUnit.MILLISECONDS)
        }
    }

    private fun resolve(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val service = payload.optJSONObject("service")
            ?: return failure("invalid-argument", "service must be an object with serviceType, serviceName, domain")
        val serviceType = stringField(service, "serviceType")
            ?: return failure("invalid-argument", "serviceType must be a string")
        if (!isValidServiceType(serviceType)) {
            return failure("invalid-argument", "serviceType must be _name._tcp or _name._udp (label 1..63 chars)")
        }
        val serviceName = stringField(service, "serviceName")
            ?: return failure("invalid-argument", "serviceName must be a string")
        if (!isValidServiceName(serviceName)) {
            return failure("invalid-argument", "serviceName must be 1..63 UTF-8 bytes without dots or control characters")
        }
        val domain = stringField(service, "domain")
            ?: return failure("invalid-argument", "domain must be a string")
        if (!isValidDomain(domain)) {
            return failure("invalid-argument", "domain must be 1..253 characters without control or whitespace")
        }
        if (resolves.size >= MAX_RESOLVES) {
            return failure("busy", "too many concurrent resolves (${resolves.size})")
        }
        val id = "r:${nextResolveId.incrementAndGet()}"
        val resolve = Resolve(id, object : ResolvedRequest {
            override val serviceType = serviceType
            override val serviceName = serviceName
        })
        resolves[id] = resolve
        resolve.armDeadline()
        try {
            nsd.resolveService(resolve.request, resolve.listener)
        } catch (t: Throwable) {
            resolves.remove(id)
            return failure(
                "platform-error",
                "NSD resolve request failed: ${t.message ?: t.javaClass.simpleName}",
            )
        }
        return ok(JSONObject().put("resolveId", id))
    }

    /**
     * Host-side teardown for engine/activity lifecycle: stop every live
     * browse, settle every pending resolve, and release the multicast
     * lock. Called when the owning engine is replaced or destroyed —
     * discovery is foreground-scoped and must never outlive its owner
     * (accumulated browses would wedge MAX_BROWSES and hold the lock).
     */
    fun shutdown() {
        for (browse in browses.values.toList()) {
            stopBrowse(browse, "unavailable", "the discovery host was shut down")
        }
        for (resolve in resolves.values.toList()) {
            resolve.settle(
                JSONObject()
                    .put("type", "resolve")
                    .put("resolveId", resolve.id)
                    .put("ok", false)
                    .put(
                        "failure",
                        JSONObject()
                            .put("kind", "unavailable")
                            .put("message", "the discovery host was shut down"),
                    )
            )
        }
        timeouts.shutdownNow()
    }

    // -- helpers --------------------------------------------------------------------

    private fun emit(event: JSONObject) {
        try {
            onEvent("DISCOVERY_EVENT", event.toString())
        } catch (t: Throwable) {
            // A dead event sink must not take the NSD callbacks with it;
            // the owning browse/resolve's own handling reports through results.
        }
    }

    private fun parse(payloadJson: String): JSONObject? = try {
        JSONObject(payloadJson)
    } catch (e: JSONException) {
        null
    }

    private fun malformed(): String = failure("invalid-argument", "malformed JSON payload")

    /** Strict field typing: JSON numbers/booleans/objects/null are refused. */
    private fun stringField(payload: JSONObject, name: String): String? =
        if (payload.opt(name) is String) payload.optString(name) else null

    private fun ok(value: Any): String = JSONObject().put("ok", true).put("value", value).toString()

    private fun failure(kind: String, message: String): String =
        JSONObject().put("ok", false).put("failure", JSONObject().put("kind", kind).put("message", message)).toString()

    private fun hasControl(value: String): Boolean {
        for (c in value) {
            when (c.code) {
                in 0x00..0x1f, 0x7f, in 0x80..0x9f -> return true
            }
        }
        return false
    }

    /** Mirrors validServiceType in discovery-validation.ts (DNS label ≤ 63). */
    private fun isValidServiceType(value: String): Boolean {
        if (!serviceTypePattern.matches(value)) return false
        return !value.contains("--")
    }

    /**
     * Mirrors validServiceName (RFC 6763 §4.1.1 raw labels): 1..63 UTF-8
     * bytes, no control characters. Dots and spaces are LEGAL instance
     * punctuation ("TV 1.0" is a valid advertisement).
     */
    private fun isValidServiceName(value: String): Boolean {
        if (value.isEmpty()) return false
        if (value.toByteArray(Charsets.UTF_8).size > MAX_SERVICE_NAME_BYTES) return false
        return !hasControl(value)
    }

    /** Mirrors validTxtRecord's key grammar: printable ASCII, no '='. */
    private fun isValidTxtKey(key: String): Boolean {
        if (key.isEmpty()) return false
        for (c in key) {
            if (c.code < 0x21 || c.code > 0x7e || c == '=') return false
        }
        return true
    }

    /** Mirrors validNetHost's shape rules (no URL delimiters, no whitespace). */
    private fun isValidHost(host: String): Boolean {
        if (host.isEmpty() || host.length > 253) return false
        for (c in host) {
            when (c.code) {
                in 0x00..0x20, 0x7f, in 0x80..0x9f -> return false
            }
            if (c == '/' || c == '?' || c == '#') return false
        }
        return true
    }

    private fun isValidDomain(domain: String): Boolean {
        if (domain.isEmpty() || domain.length > 253) return false
        for (c in domain) {
            when (c.code) {
                in 0x00..0x20, 0x7f, in 0x80..0x9f -> return false
            }
        }
        return true
    }

    private val nsd: NsdFacade = facade ?: AndroidNsdFacade()

    /** The production facade: NsdManager behind the injectable seam. */
    private inner class AndroidNsdFacade : NsdFacade {
        private val nsdManager: NsdManager by lazy {
            requireNotNull(appContext) { "DiscoveryService needs a Context in production" }
                .getSystemService(Context.NSD_SERVICE) as NsdManager
        }

        // NsdManager identifies a discovery registration by the LISTENER
        // OBJECT passed to discoverServices — stopping with a fresh adapter
        // throws "listener not registered" and leaks the native browse.
        // One adapted platform listener per facade listener, reused for stop.
        private val adaptedListeners = ConcurrentHashMap<DiscoveryListener, NsdManager.DiscoveryListener>()

        override fun discoverServices(serviceType: String, listener: DiscoveryListener) {
            val platform = adapt(listener)
            adaptedListeners[listener] = platform
            nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, platform)
        }

        override fun stopServiceDiscovery(listener: DiscoveryListener) {
            val platform = adaptedListeners.remove(listener)
                ?: throw IllegalArgumentException("listener not registered")
            nsdManager.stopServiceDiscovery(platform)
        }

        override fun resolveService(info: ResolvedRequest, listener: ResolveListener) {
            val nsdInfo = NsdServiceInfo().apply {
                serviceName = info.serviceName
                serviceType = info.serviceType
            }
            @Suppress("DEPRECATION") // the only resolver available across our API floor (30)
            nsdManager.resolveService(nsdInfo, object : NsdManager.ResolveListener {
                override fun onResolveFailed(info: NsdServiceInfo?, errorCode: Int) {
                    listener.onResolveFailed(errorCode)
                }

                override fun onServiceResolved(info: NsdServiceInfo?) {
                    if (info == null) {
                        listener.onResolveFailed(0)
                        return
                    }
                    val host = info.host?.hostAddress
                    if (host == null) {
                        listener.onResolveFailed(0)
                        return
                    }
                    // Key-only/empty TXT records arrive as NULL byte arrays
                    // (RFC 6763 §6.3); a decode failure must settle the
                    // resolve structurally, never crash the NSD thread.
                    val txt = try {
                        info.attributes.entries.associate { (key, value) ->
                            key to if (value == null) "" else String(value, Charsets.UTF_8)
                        }
                    } catch (t: Throwable) {
                        listener.onResolveFailed(0)
                        return
                    }
                    listener.onServiceResolved(host, info.port, txt)
                }
            })
        }

        /** The NsdManager listener shape, adapted to the facade's. */
        private fun adapt(listener: DiscoveryListener) = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String?) {
                listener.onDiscoveryStarted()
            }

            override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {
                listener.onStartDiscoveryFailed()
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo?) {
                val type = serviceInfo?.serviceType
                val name = serviceInfo?.serviceName
                if (type == null || name == null) return
                listener.onServiceFound(type, name)
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo?) {
                val type = serviceInfo?.serviceType
                val name = serviceInfo?.serviceName
                if (type == null || name == null) return
                listener.onServiceLost(type, name)
            }

            override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {
                listener.onStopDiscoveryFailed()
            }

            override fun onDiscoveryStopped(serviceType: String?) {
                listener.onDiscoveryStopped()
            }
        }
    }

    // The multicast lock is held for the lifetime of every ACTIVE browse:
    // acquired at the 0→1 transition, released at 1→0, exactly once each.
    private var lockHolds = 0

    private fun holdMulticastLock() {
        synchronized(this) {
            lockHolds += 1
            if (lockHolds == 1) multicastLock.acquire()
        }
    }

    private fun releaseMulticastLock() {
        synchronized(this) {
            if (lockHolds > 0) lockHolds -= 1
            if (lockHolds == 0) multicastLock.release()
        }
    }

    private companion object {
        const val LOCAL_DOMAIN = "local"
        const val MAX_BROWSES = 8
        const val MAX_RESOLVES = 16
        const val MAX_SERVICE_NAME_BYTES = 63
        const val MAX_TXT_ENTRIES = 64
        const val MAX_TXT_CONSTITUENT_BYTES = 255
        const val RESOLVE_TIMEOUT_MS = 15_000
        /** NsdManager.FAILURE_ALREADY_ACTIVE — mirrored for the JVM tier. */
        const val FAILURE_ALREADY_ACTIVE = 3
        val serviceTypePattern = Regex("^_[A-Za-z0-9][A-Za-z0-9-]{0,61}\\._(tcp|udp)$")
        val nextBrowseId = AtomicLong(0)
        val nextResolveId = AtomicLong(0)
    }

    private val timeouts: java.util.concurrent.ScheduledExecutorService =
        java.util.concurrent.Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "tenun-discovery-timeouts").apply { isDaemon = true }
        }

    private val browses = ConcurrentHashMap<String, Browse>()
    private val resolves = ConcurrentHashMap<String, Resolve>()
}

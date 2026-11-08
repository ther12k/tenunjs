package id.my.tenun.embedder

import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.KeyManager
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509ExtendedKeyManager
import javax.net.ssl.X509TrustManager

/**
 * TN-188: net host service over the TN-154 bridge — TCP and TLS sessions
 * to one nearby companion device (ADR-0027, 04-api/net.md).
 *
 * The bridge is SYNCHRONOUS but sockets are not, so the service mirrors the
 * wire the TS adapter (packages/platform/src/net-native.ts) speaks:
 *  - `connect` validates arguments synchronously (invalid-argument), then
 *    starts the transport on a background thread and replies
 *    `{"sessionId"}` immediately; the OUTCOME arrives as an event;
 *  - events are pushed through [onEvent] as "NET_EVENT" dispatch actions,
 *    the same host→JS channel PolytronBleService uses for BLE_LINK:
 *      {"type":"serverCertificate","sessionId","sha256"}   (first-use only)
 *      {"type":"connect","sessionId","ok":true|false,"failure"?}
 *      {"type":"data","sessionId","data":"<b64 chunk>"}
 *      {"type":"link","sessionId","state":"offline","reason"}
 *  - `write` hands bytes to a bounded transport queue (backpressure is the
 *    host's; a full queue is `busy`, a dead link is `link-lost`);
 *  - `close` is idempotent, including for unknown ids — idempotency across
 *    the boundary must not depend on host memory. Closing a PENDING
 *    connect abandons it silently: JS never saw that session, so it gets
 *    no offline event (the abandoned socket is closed).
 *
 * A `tls` object (even empty) selects TLS; its absence stays plain TCP.
 *
 * TRUST MODEL (frozen with the contract): pin-or-first-use, NOT WebPKI —
 * companion devices present self-signed certificates the app pins on first
 * sight, so the trust manager performs no chain or hostname verification
 * beyond the pin. TLS client certificates come from the keys capability's
 * AndroidKeyStore namespace via [keyResolver] (KeysService::identityEntry):
 * the private key is used IN PLACE inside an X509KeyManager that exposes
 * ONLY that entry — no other subsystem's key is ever offered, preserving
 * the TN-189 ownership boundary.
 *
 * BOUNDS (the contract's bounded receive side): the reader caps the bytes
 * buffered ahead of the runtime at [RECEIVE_BOUND_BYTES]; a runtime that
 * keeps the buffer full for [OVERFLOW_AFTER_MS] is a `link-lost` overflow —
 * never silent truncation, never unbounded growth. Per-session chunks are
 * coalesced up to [MAX_CHUNK_BYTES].
 */
class NetService(
    private val onEvent: (action: String, payloadJson: String) -> Unit,
    private val keyResolver: (handle: String) -> KeyStore.PrivateKeyEntry? = { null },
) : NativeService {

    override fun invoke(method: String, payloadJson: String): String? {
        return try {
            when (method) {
                "availability" -> availability()
                "connect" -> connect(payloadJson)
                "write" -> write(payloadJson)
                "close" -> close(payloadJson)
                else -> null
            }
        } catch (t: Throwable) {
            failure("platform-error", t.message ?: t.javaClass.simpleName)
        }
    }

    private fun availability(): String = ok(JSONObject().put("status", "supported"))

    // -- connect ---------------------------------------------------------------

    private fun connect(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val host = stringField(payload, "host")
            ?: return failure("invalid-argument", "host must be a string")
        if (!isValidHost(host)) {
            return failure("invalid-argument", "host must be 1..253 characters without control, whitespace, or URI delimiters")
        }
        val port = intField(payload, "port")
            ?: return failure("invalid-argument", "port must be an integer between 1 and 65535")
        if (port !in 1..65535) {
            return failure("invalid-argument", "port must be an integer between 1 and 65535")
        }
        val timeoutMs = when (val requested = optIntField(payload, "timeoutMs")) {
            null -> DEFAULT_TIMEOUT_MS
            !in 1..MAX_TIMEOUT_MS ->
                return failure("invalid-argument", "timeoutMs must be an integer between 1 and 120000")
            else -> requested
        }
        val tls = payload.optJSONObject("tls")
        if (tls != null) {
            for (key in tls.keys()) {
                if (key != "clientIdentity" && key != "expectedServerCertSha256" && key != "serverName") {
                    return failure("invalid-argument", "tls may carry only clientIdentity, expectedServerCertSha256, and serverName")
                }
            }
        }
        val clientIdentity = stringOptField(tls, "clientIdentity")
        if (clientIdentity != null && !isValidAlias(clientIdentity)) {
            return failure("invalid-argument", "clientIdentity must be a keys alias (1..128 code points, no control characters)")
        }
        val expectedSha = stringOptField(tls, "expectedServerCertSha256")
        if (expectedSha != null && !expectedSha.matches(Regex("^[0-9a-fA-F]{64}$"))) {
            return failure("invalid-argument", "expectedServerCertSha256 must be 64 hex characters")
        }
        val serverName = stringOptField(tls, "serverName")
        if (serverName != null && !isValidHost(serverName)) {
            return failure("invalid-argument", "serverName must be a host, not a URL or free text")
        }
        // The client identity is resolved BEFORE any socket work: a missing
        // handle is an argument problem, not a transport failure.
        val identityEntry = if (clientIdentity != null) {
            try {
                keyResolver(clientIdentity)
            } catch (t: Throwable) {
                return failure(
                    "platform-error",
                    "keystore lookup failed for the client identity: ${t.message ?: t.javaClass.simpleName}",
                )
            } ?: return failure("invalid-argument", "clientIdentity not found: $clientIdentity")
        } else {
            null
        }
        if (sessions.size >= MAX_SESSIONS) {
            return failure("busy", "too many concurrent net sessions (${sessions.size})")
        }
        val id = "n:${nextId.incrementAndGet()}"
        val pending = PendingSession(id, tls != null, host, port, timeoutMs, expectedSha, serverName, identityEntry)
        sessions[id] = pending
        io.execute { runConnect(pending) }
        return ok(JSONObject().put("sessionId", id))
    }

    private fun runConnect(pending: PendingSession) {
        val address = InetSocketAddress(pending.host, pending.port)
        var socket: Socket? = null
        try {
            val trust = PinTrustManager(pending.expectedSha256)
            val raw = Socket()
            socket = raw
            raw.connect(address, pending.timeoutMs)
            if (pending.tlsRequested) {
                val sslContext = SSLContext.getInstance("TLS")
                sslContext.init(
                    pending.identityEntry?.let { arrayOf<KeyManager>(NamespaceKeyManager(it)) },
                    arrayOf<TrustManager>(trust),
                    null,
                )
                val ssl = (sslContext.socketFactory as SSLSocketFactory)
                    .createSocket(raw, pending.host, pending.port, true) as SSLSocket
                socket = ssl
                val sni = pending.serverName
                if (sni != null) {
                    try {
                        val parameters = ssl.sslParameters
                        parameters.serverNames = listOf<javax.net.ssl.SNIServerName>(javax.net.ssl.SNIHostName(sni))
                        ssl.sslParameters = parameters
                    } catch (e: RuntimeException) {
                        // SNI is best effort: an unroutable or malformed
                        // serverName must not kill an otherwise valid
                        // pairing connection (SNIHostName throws on IPs).
                    }
                }
                // Bound the handshake by the caller's timeout, then restore
                // blocking reads without a read deadline.
                ssl.soTimeout = pending.timeoutMs
                ssl.startHandshake()
                ssl.soTimeout = 0
            }
            val live = Session(
                id = pending.id,
                socket = socket!!,
                input = socket!!.getInputStream(),
                output = socket!!.getOutputStream(),
                firstUse = pending.expectedSha256 == null,
            )
            // Event order the adapter relies on: fingerprint (first-use),
            // then connect-ok; data flows only after connect-ok.
            val seen = trust.peerSha256
            if (live.firstUse && seen != null) {
                emit(
                    JSONObject()
                        .put("type", "serverCertificate")
                        .put("sessionId", live.id)
                        .put("sha256", seen)
                )
            }
            if (!pending.handoff(live)) {
                // close() abandoned this connect while the transport was
                // coming up: JS never saw the session, so no events follow.
                closeQuietly(live.socket)
                return
            }
            // The LIVE session replaces the pending entry under the same id —
            // writes address it immediately after connect-ok.
            sessions[pending.id] = live
            emit(JSONObject().put("type", "connect").put("sessionId", live.id).put("ok", true))
            startPumps(live)
        } catch (t: Throwable) {
            closeQuietly(socket)
            sessions.remove(pending.id)
            pending.abandon()
            emit(
                JSONObject()
                    .put("type", "connect")
                    .put("sessionId", pending.id)
                    .put("ok", false)
                    .put("failure", failureJsonFor(t, pending.timeoutMs))
            )
        }
    }

    /** Failure taxonomy for connect outcomes, mirrored in the TS adapter. */
    private fun failureJsonFor(t: Throwable, timeoutMs: Int): JSONObject {
        val message = t.message ?: t.javaClass.simpleName
        return when {
            t is java.net.SocketTimeoutException ->
                JSONObject().put("kind", "timeout").put("message", "connect timed out after ${timeoutMs}ms")
            t is CertificateException || t is IOException || t is IllegalStateException ->
                JSONObject().put("kind", "link-lost").put("message", message)
            else -> JSONObject().put("kind", "platform-error").put("message", message)
        }
    }

    // -- sessions and pumps ------------------------------------------------------

    private open class SessionBase(val id: String) {
        val closed = AtomicBoolean(false)
        val offlineEmitted = AtomicBoolean(false)
    }

    private class PendingSession(
        id: String,
        val tlsRequested: Boolean,
        val host: String,
        val port: Int,
        val timeoutMs: Int,
        val expectedSha256: String?,
        val serverName: String?,
        val identityEntry: KeyStore.PrivateKeyEntry?,
    ) : SessionBase(id) {
        // The connect thread hands the live session over exactly once; a
        // concurrent close() abandons the pending state instead.
        @Volatile private var handoffResult: Session? = null
        @Volatile private var resolved = false

        @Synchronized
        fun handoff(live: Session): Boolean {
            if (resolved || closed.get()) return false
            resolved = true
            handoffResult = live
            return true
        }

        @Synchronized
        fun abandon(): Boolean {
            val wasFirst = !resolved
            resolved = true
            handoffResult = null
            return wasFirst
        }
    }

    private class Session(
        id: String,
        val socket: Socket,
        val input: InputStream,
        val output: OutputStream,
        val firstUse: Boolean,
    ) : SessionBase(id) {
        /** Chunks read but not yet delivered to the runtime, byte-capped. */
        val receiveQueue = LinkedBlockingQueue<ByteArray>()
        var bufferedBytes = 0
        /** Writes accepted but not yet on the wire, byte-capped. */
        val writeQueue = LinkedBlockingQueue<ByteArray>()
        var writeBacklog = 0
    }

    private fun startPumps(session: Session) {
        io.execute { readLoop(session) }
        io.execute { emitLoop(session) }
        io.execute { writeLoop(session) }
    }

    private fun readLoop(session: Session) {
        val buffer = ByteArray(MAX_CHUNK_BYTES)
        try {
            while (!session.closed.get()) {
                val read = session.input.read(buffer)
                if (read < 0) break
                val chunk = if (read == buffer.size) buffer.copyOf() else buffer.copyOf(read)
                var accepted = false
                val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(OVERFLOW_AFTER_MS.toLong())
                while (!accepted && !session.closed.get()) {
                    if (System.nanoTime() >= deadline) break
                    synchronized(session) {
                        if (session.bufferedBytes + chunk.size <= RECEIVE_BOUND_BYTES) {
                            session.receiveQueue.put(chunk)
                            session.bufferedBytes += chunk.size
                            accepted = true
                        }
                    }
                    if (!accepted) Thread.sleep(5)
                }
                if (!accepted) {
                    // Overflow: the runtime stopped draining a full buffer —
                    // link-lost, never truncation, never unbounded growth.
                    goOffline(session, "receive buffer overflow (${RECEIVE_BOUND_BYTES} bytes buffered ahead)")
                    return
                }
            }
        } catch (t: Throwable) {
            if (!session.closed.get()) {
                goOffline(session, "read failed: ${t.message ?: t.javaClass.simpleName}")
                return
            }
        }
        goOffline(session, "the peer closed the connection")
    }

    private fun emitLoop(session: Session) {
        try {
            while (true) {
                val chunk = session.receiveQueue.poll(250, TimeUnit.MILLISECONDS)
                if (chunk == null) {
                    if (session.closed.get() && session.receiveQueue.isEmpty()) return
                    continue
                }
                if (session.closed.get()) {
                    // Dropped, not delivered: release the accounting only
                    // once the bytes can no longer reach anyone.
                    synchronized(session) {
                        session.bufferedBytes -= chunk.size
                    }
                    return // no events after offline
                }
                emit(
                    JSONObject()
                        .put("type", "data")
                        .put("sessionId", session.id)
                        .put("data", Base64.getEncoder().encodeToString(chunk))
                )
                // Bytes stay accounted until the runtime has actually
                // received them — a blocked sink keeps the buffer full and
                // the overflow fires, instead of silently "draining".
                synchronized(session) {
                    session.bufferedBytes -= chunk.size
                }
            }
        } catch (t: Throwable) {
            if (!session.closed.get()) {
                goOffline(session, "event dispatch failed: ${t.message ?: t.javaClass.simpleName}")
            }
        }
    }

    private fun writeLoop(session: Session) {
        try {
            while (true) {
                // Poll with timeout so a close is noticed without a signal;
                // Object.wait/notify are not callable from Kotlin on Any.
                val bytes = session.writeQueue.poll(250, TimeUnit.MILLISECONDS)
                if (bytes == null) {
                    if (session.closed.get()) return
                    continue
                }
                synchronized(session) {
                    session.writeBacklog -= bytes.size
                }
                synchronized(session.output) {
                    session.output.write(bytes)
                    session.output.flush()
                }
            }
        } catch (t: Throwable) {
            if (!session.closed.get()) {
                goOffline(session, "write failed: ${t.message ?: t.javaClass.simpleName}")
            }
        }
    }

    /** Idempotent terminal transition: close the socket, unregister, emit once. */
    private fun goOffline(session: Session, reason: String) {
        if (!session.offlineEmitted.compareAndSet(false, true)) return
        session.closed.set(true)
        sessions.remove(session.id)
        closeQuietly(session.socket)
        emit(
            JSONObject()
                .put("type", "link")
                .put("sessionId", session.id)
                .put("state", "offline")
                .put("reason", reason)
        )
    }

    // -- write / close -------------------------------------------------------------

    private fun write(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val sessionId = stringField(payload, "sessionId")
            ?: return failure("invalid-argument", "sessionId must be a string")
        val dataB64 = stringField(payload, "data")
            ?: return failure("invalid-argument", "data must be a base64 string (empty is valid)")
        val session = sessions[sessionId] as? Session
            ?: return failure("link-lost", "the session link is offline")
        if (session.closed.get()) {
            return failure("link-lost", "the session link is offline")
        }
        val data = try {
            Base64.getDecoder().decode(dataB64)
        } catch (e: IllegalArgumentException) {
            return failure("invalid-argument", "data is not valid base64")
        }
        if (data.size > MAX_WRITE_BYTES) {
            return failure("invalid-argument", "data exceeds $MAX_WRITE_BYTES bytes")
        }
        val accepted = synchronized(session) {
            when {
                session.closed.get() -> false
                session.writeBacklog + data.size > WRITE_BOUND_BYTES -> null // queue full
                else -> {
                    session.writeQueue.put(data)
                    session.writeBacklog += data.size
                    true
                }
            }
        }
        when (accepted) {
            null -> return failure("busy", "transport queue full (${WRITE_BOUND_BYTES} bytes pending) — retry after the link drains")
            false -> return failure("link-lost", "the session link is offline")
            else -> Unit // the writer loop drains with its own cadence
        }
        return ok(JSONObject.NULL)
    }

    private fun close(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val sessionId = stringField(payload, "sessionId")
            ?: return failure("invalid-argument", "sessionId must be a string")
        when (val session = sessions.remove(sessionId)) {
            null -> return ok(JSONObject.NULL) // idempotent across the boundary
            is Session -> goOffline(session, "closed by the application")
            is PendingSession -> {
                session.closed.set(true)
                session.abandon()
                // The connect thread notices the abandon and closes its socket;
                // no offline event for a session JS never saw.
            }
        }
        return ok(JSONObject.NULL)
    }

    // -- trust & key managers ---------------------------------------------------------

    /**
     * Pin-or-first-use trust: no chain or hostname verification (self-signed
     * companion certificates are the norm); a pin mismatch fails the
     * handshake loudly; first-use records the peer fingerprint for the
     * pairing journey.
     */
    private class PinTrustManager(private val expectedSha256: String?) : X509TrustManager {
        @Volatile var peerSha256: String? = null

        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
            throw CertificateException("client certificates are not verified by this manager")
        }

        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
            val leaf = chain.firstOrNull() ?: throw CertificateException("the peer sent no certificate")
            val sha = MessageDigest.getInstance("SHA-256").digest(leaf.encoded)
                .joinToString("") { "%02x".format(it) }
            peerSha256 = sha
            if (expectedSha256 != null && !expectedSha256.equals(sha, ignoreCase = true)) {
                throw CertificateException("pinned server certificate mismatch: expected $expectedSha256, saw $sha")
            }
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    /**
     * Exposes EXACTLY the caller's keys identity as a TLS client certificate
     * (an X509ExtendedKeyManager so modern JSSE dispatch reaches it). The
     * private key is used in place inside AndroidKeyStore — never marshalled.
     */
    private class NamespaceKeyManager(private val entry: KeyStore.PrivateKeyEntry) : X509ExtendedKeyManager() {
        private val chain = entry.certificateChain.filterIsInstance<X509Certificate>().toTypedArray()

        override fun getClientAliases(keyType: String, issuers: Array<out Principal>?): Array<String> =
            if (keyType.startsWith("EC")) arrayOf(ALIAS) else emptyArray()

        override fun chooseClientAlias(
            keyType: Array<out String>,
            issuers: Array<out Principal>?,
            socket: java.net.Socket?,
        ): String? = if (keyType.any { it.startsWith("EC") }) ALIAS else null

        override fun getCertificateChain(alias: String): Array<X509Certificate> =
            if (alias == ALIAS) chain else emptyArray()

        override fun getPrivateKey(alias: String): PrivateKey? = if (alias == ALIAS) entry.privateKey else null

        // Server-side surfaces are deliberately inert.
        override fun getServerAliases(keyType: String, issuers: Array<out Principal>?): Array<String>? = null

        override fun chooseServerAlias(
            keyType: String?,
            issuers: Array<out Principal>?,
            socket: java.net.Socket?,
        ): String? = null

        override fun chooseEngineClientAlias(
            keyType: Array<out String>,
            issuers: Array<out Principal>?,
            engine: javax.net.ssl.SSLEngine?,
        ): String? = chooseClientAlias(keyType, issuers, null)

        override fun chooseEngineServerAlias(
            keyType: String?,
            issuers: Array<out Principal>?,
            engine: javax.net.ssl.SSLEngine?,
        ): String? = null

        private companion object {
            const val ALIAS = "tenun-net-client-identity"
        }
    }

    // -- helpers ---------------------------------------------------------------------

    private fun emit(event: JSONObject) {
        try {
            onEvent("NET_EVENT", event.toString())
        } catch (t: Throwable) {
            // A dead event sink must not take the transport threads with it;
            // the owning session's offline handling reports through results.
        }
    }

    private fun closeQuietly(socket: Socket?) {
        try {
            socket?.close()
        } catch (ignored: Exception) {
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

    private fun stringOptField(payload: JSONObject?, name: String): String? {
        val value = payload?.opt(name) ?: return null
        return value as? String
    }

    /** Integer-only numeric field (1.5 and strings are refused, not coerced). */
    private fun intField(payload: JSONObject, name: String): Int? {
        return when (val value = payload.opt(name)) {
            is Int -> value
            is Long -> if (value >= Int.MIN_VALUE && value <= Int.MAX_VALUE) value.toInt() else null
            is Double ->
                if (value % 1.0 == 0.0 && value >= Int.MIN_VALUE && value <= Int.MAX_VALUE) {
                    value.toInt()
                } else {
                    null
                }
            else -> null
        }
    }

    private fun optIntField(payload: JSONObject, name: String): Int? = when (val value = payload.opt(name)) {
        null, JSONObject.NULL -> null
        else -> intField(payload, name)
    }

    private fun ok(value: Any): String = JSONObject().put("ok", true).put("value", value).toString()

    private fun failure(kind: String, message: String): String =
        JSONObject().put("ok", false).put("failure", JSONObject().put("kind", kind).put("message", message)).toString()

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

    private fun isValidAlias(alias: String): Boolean {
        if (alias.isEmpty() || alias.length > 128) return false
        var i = 0
        while (i < alias.length) {
            val c = alias[i]
            when (c.code) {
                in 0x00..0x1f, in 0x7f..0x9f -> return false
            }
            if (c.isHighSurrogate()) {
                if (i + 1 >= alias.length || !alias[i + 1].isLowSurrogate()) return false
                i += 1
            } else if (c.isLowSurrogate()) {
                return false
            }
            i += 1
        }
        return true
    }

    private companion object {
        const val MAX_SESSIONS = 8
        const val DEFAULT_TIMEOUT_MS = 10_000
        const val MAX_TIMEOUT_MS = 120_000
        const val MAX_WRITE_BYTES = 1_048_576
        const val RECEIVE_BOUND_BYTES = 1_048_576
        const val WRITE_BOUND_BYTES = 2_097_152
        const val MAX_CHUNK_BYTES = 64 * 1024
        const val OVERFLOW_AFTER_MS = 2_000
        val nextId = AtomicLong(0)
    }

    private val sessions = ConcurrentHashMap<String, SessionBase>()

    private val io: ExecutorService = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "tenun-net-io").apply { isDaemon = true }
    }
}

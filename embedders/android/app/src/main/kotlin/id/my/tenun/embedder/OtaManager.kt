package id.my.tenun.embedder

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.atomic.AtomicBoolean

/**
 * OTA manager — the orchestration half of the prototype update channel.
 *
 * Gate order for every check (all fail-closed, all logged, none throw):
 *
 *   fetch manifest envelope
 *     → ECDSA over exact payload bytes + parse        (UpdateProtocol)
 *     → app / channel / host-API compatibility        (signed fields)
 *     → sequence strictly newer than accepted
 *     → sequence not quarantined
 *     → download bundle
 *     → size + SHA-256 match the signed metadata
 *     → stage (crash-atomic) → TRIAL → apply on main thread
 *
 * Apply is delegated to the host callback (MainActivity): it boots the new
 * engine IN PARALLEL with the live one and swaps only after the new engine
 * initializes — the running app is never destroyed on hope. On apply
 * failure the trial sequence is quarantined, so a bad release is never
 * retried; the accepted sequence moves only on CONFIRM (health criterion
 * in the host), which is what makes replays and rollbacks well-defined.
 *
 * Polling is a DEV/prototype behavior here: [startDevPolling] runs a
 * short-interval loop meant for gallery/dev builds only. Production-shaped
 * cadence is launch + foreground-resume checks ([checkNow]), throttled —
 * the platform's background minimums (WorkManager ≥15 min, Doze) apply
 * later; 30-second perpetual polling must not become an accidental
 * production contract.
 */
class OtaManager(
    private val channel: UpdateChannel,
    private val host: UpdateProtocol.HostIdentity,
    private val store: UpdateStore,
    private val ioExecutor: ExecutorService,
    /** Applies verified bytes as the live bundle; true on success. */
    private val applyBundle: (ByteArray, UpdateProtocol.ReleaseMetadata) -> Boolean
) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val lifecycleLock = Any()
    private val checkInFlight = AtomicBoolean(false)
    private val applyInFlight = AtomicBoolean(false)
    @Volatile private var lastCheckAtMs: Long = 0L
    @Volatile private var devPolling = false

    /**
     * TN-135: once the host is destroyed, this manager is dead — the
     * pipeline is lifecycle-bound. Set by [stop] and read at every point
     * a late leg could still touch the host: check entry, before
     * staging a trial, and at posted-apply run time. An abandoned leg
     * never quarantines: host death is not a bundle defect, and a good
     * release must still be installable by the next launch.
     */
    @Volatile private var stopped = false

    /** DEV builds only: short-interval perpetual loop. */
    fun startDevPolling(firstDelayMs: Long, intervalMs: Long) {
        devPolling = true
        mainHandler.postDelayed({ devTick(intervalMs) }, firstDelayMs)
    }

    private fun devTick(intervalMs: Long) {
        if (!devPolling) return
        checkNow {
            if (devPolling) mainHandler.postDelayed({ devTick(intervalMs) }, intervalMs)
        }
    }

    /**
     * Stops the manager (onDestroy): the dev loop, any posted apply, and
     * every in-flight or later-arriving check leg. After this returns,
     * [checkNow] is a no-op and no apply can run, even one posted by a
     * fetch that was mid-download when the host died.
     */
    fun stop() {
        synchronized(lifecycleLock) {
            stopped = true
            devPolling = false
            mainHandler.removeCallbacksAndMessages(null)
        }
    }

    /**
     * One update check. [onDone] runs after the check settles (used by the
     * dev loop to schedule the next tick). Throttled to [MIN_CHECK_GAP_MS]
     * so launch + resume checks cannot hammer the channel; [force] bypasses
     * the throttle for tests and explicit operator checks.
     */
    fun checkNow(force: Boolean = false, onDone: (() -> Unit)? = null) {
        if (stopped) {
            onDone?.invoke()
            return
        }
        val now = System.currentTimeMillis()
        if (!force && now - lastCheckAtMs < MIN_CHECK_GAP_MS) {
            onDone?.invoke()
            return
        }
        if (!checkInFlight.compareAndSet(false, true)) {
            onDone?.invoke()
            return
        }
        lastCheckAtMs = now
        ioExecutor.execute {
            try {
                performCheck()
            } catch (e: Exception) {
                Log.d(TAG, "update check failed (will retry): ${e.message}")
            } finally {
                checkInFlight.set(false)
            }
            onDone?.invoke()
        }
    }

    private fun performCheck() {
        val manifestJson = try {
            httpGetText(channel.manifestUrl)
        } catch (e: ResponseTooLargeException) {
            Log.w(TAG, "update manifest exceeded the ${UpdateProtocol.MAX_MANIFEST_BYTES}-byte cap; refusing")
            return
        }
        val metadata = UpdateProtocol.parseEnvelope(manifestJson, channel.publicKeyB64)
        if (metadata == null) {
            Log.d(TAG, "ignoring update manifest (malformed or bad signature)")
            return
        }
        if (!UpdateProtocol.isCompatible(metadata, host)) {
            Log.d(TAG, "update v${metadata.sequence} incompatible with this host/app/channel")
            return
        }
        if (!UpdateProtocol.isNewer(metadata, store.acceptedSequence())) {
            return // up to date, equal, or older: refuse (anti-replay floor)
        }
        if (store.isQuarantined(metadata.sequence)) {
            Log.d(TAG, "update v${metadata.sequence} is quarantined; refusing")
            return
        }

        // The signed bundleSize caps the read ITSELF, not just the check
        // afterwards: a hostile or broken server cannot balloon memory by
        // declaring one size and streaming another.
        val bytes = try {
            httpGetBytes(metadata.bundleUrl, metadata.bundleSize)
        } catch (e: ResponseTooLargeException) {
            Log.w(TAG, "update v${metadata.sequence} download exceeded the signed ${metadata.bundleSize}-byte cap; refusing")
            return
        }
        if (!UpdateProtocol.bundleMatches(metadata, bytes)) {
            Log.w(TAG, "update v${metadata.sequence} failed size/digest match; refusing")
            return
        }

        synchronized(lifecycleLock) {
            if (stopped) return
            store.stageBundle(metadata.sequence, bytes, metadata.stateSchema, manifestJson)
            // Staged downloads are safe to abandon. A trial means boot has
            // actually started, not merely that an apply was queued.
            mainHandler.post {
                synchronized(lifecycleLock) {
                    if (stopped) return@post
                    if (!applyInFlight.compareAndSet(false, true)) return@post
                    try {
                        if (!store.promoteTrial(metadata.sequence)) return@post
                        val applied = try {
                            applyBundle(bytes, metadata)
                        } catch (e: Exception) {
                            Log.w(TAG, "update v${metadata.sequence} apply threw: ${e.message}")
                            false
                        }
                        if (applied) {
                            Log.i(TAG, "update v${metadata.sequence} applied (trial, awaiting confirm)")
                        } else {
                            store.quarantine(metadata.sequence)
                            Log.w(TAG, "update v${metadata.sequence} failed to apply; quarantined")
                        }
                    } finally {
                        applyInFlight.set(false)
                    }
                }
            }
        }
    }

    private fun httpGetText(url: String): String =
        String(httpGetBytes(url, UpdateProtocol.MAX_MANIFEST_BYTES))

    /** Thrown when a response outgrows its cap mid-transfer (or up front). */
    private class ResponseTooLargeException(message: String) : java.io.IOException(message)

    /**
     * Streams the response body under a hard byte cap enforced DURING the
     * copy — the cap aborts the read instead of comparing sizes after the
     * whole body is already in memory. [maxBytes] comes from signed state
     * (bundleSize) or a protocol constant (manifest), never from headers
     * alone; an honest Content-Length larger than the cap fails early.
     */
    private fun httpGetBytes(url: String, maxBytes: Long): ByteArray {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 4000
            connection.readTimeout = 8000
            if (connection.responseCode != 200) {
                throw IllegalStateException("HTTP ${connection.responseCode} from $url")
            }
            val declaredLength = connection.contentLengthLong
            if (declaredLength > maxBytes) {
                throw ResponseTooLargeException("declared length $declaredLength exceeds the $maxBytes-byte cap: $url")
            }
            connection.inputStream.use { input ->
                val output = ByteArrayOutputStream(minOf(maxBytes, 8L * 1024 * 1024).toInt())
                val buffer = ByteArray(16 * 1024)
                var total = 0L
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    total += read
                    if (total > maxBytes) {
                        throw ResponseTooLargeException("response exceeded the $maxBytes-byte cap: $url")
                    }
                    output.write(buffer, 0, read)
                }
                return output.toByteArray()
            }
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        private const val TAG = "TenunOta"
        const val MIN_CHECK_GAP_MS = 60_000L
    }
}

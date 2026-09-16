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
    private val checkInFlight = AtomicBoolean(false)
    private val applyInFlight = AtomicBoolean(false)
    @Volatile private var lastCheckAtMs: Long = 0L
    @Volatile private var devPolling = false

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

    /** Stops the dev loop (onDestroy). */
    fun stop() {
        devPolling = false
        mainHandler.removeCallbacksAndMessages(null)
    }

    /**
     * One update check. [onDone] runs after the check settles (used by the
     * dev loop to schedule the next tick). Throttled to [MIN_CHECK_GAP_MS]
     * so launch + resume checks cannot hammer the channel; [force] bypasses
     * the throttle for tests and explicit operator checks.
     */
    fun checkNow(force: Boolean = false, onDone: (() -> Unit)? = null) {
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
        val metadata = UpdateProtocol.parseEnvelope(
            httpGetText(channel.manifestUrl), channel.publicKeyB64
        )
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

        val bytes = httpGetBytes(metadata.bundleUrl)
        if (!UpdateProtocol.bundleMatches(metadata, bytes)) {
            Log.w(TAG, "update v${metadata.sequence} failed size/digest match; refusing")
            return
        }

        store.stageBundle(metadata.sequence, bytes, metadata.stateSchema)
        store.promoteTrial(metadata.sequence)

        // Apply on the main thread (engine + view live there).
        mainHandler.post {
            val applied = if (applyInFlight.compareAndSet(false, true)) {
                try {
                    applyBundle(bytes, metadata)
                } catch (e: Exception) {
                    Log.w(TAG, "update v${metadata.sequence} apply threw: ${e.message}")
                    false
                } finally {
                    applyInFlight.set(false)
                }
            } else {
                false
            }
            if (applied) {
                // TRIAL stays unconfirmed until the host's health criterion
                // passes (first scene + minimum uptime); a process death
                // before that quarantines this sequence on next start.
                Log.i(TAG, "update v${metadata.sequence} applied (trial, awaiting confirm)")
            } else {
                store.quarantine(metadata.sequence)
                Log.w(TAG, "update v${metadata.sequence} failed to apply; quarantined")
            }
        }
    }

    private fun httpGetText(url: String): String = String(httpGetBytes(url))

    private fun httpGetBytes(url: String): ByteArray {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 4000
            connection.readTimeout = 8000
            if (connection.responseCode != 200) {
                throw IllegalStateException("HTTP ${connection.responseCode} from $url")
            }
            connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                input.copyTo(output, 16 * 1024)
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

package id.my.tenun.embedder

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * TenunJS prototype entry. Loads the application bundle from assets
 * (gallery_app.js preferred, notes reference tenun_app.js as the TN-132
 * acceptance fallback) and hosts the render surface.
 *
 * Dev hot reload: with the generated dev_server.txt asset, polls the laptop
 * dev server and applies new bundles live (Fast-Refresh semantics — new
 * code, old state, gated on state-schema match). Without it the activity
 * never touches the network.
 *
 * OTA updates (prototype): with the update_channel.json asset, OtaManager
 * fetches a SIGNED release envelope, verifies it (ECDSA + SHA-256 +
 * app/channel/host-API compatibility + monotonic sequence + quarantine),
 * then applies through a PARALLEL boot: the new engine initializes while
 * the old one keeps running; the host swaps only after the new engine
 * commits. State carry happens only when both bundles declare the same
 * state schema. A trial bundle is CONFIRMED only after first scene + first
 * successful dispatch + minimum uptime; a process death before that
 * quarantines the sequence and the app rolls back to the last confirmed
 * (or packaged) bundle on next start.
 */
class MainActivity : Activity() {
    private var engine: TenunEngine? = null
    private var surfaceView: TenunSurfaceView? = null

    private var devServerUrl: String? = null
    private var lastHash: String? = null
    private var assetBundleBytes: ByteArray? = null

    private var bundleStore: BundleStore? = null
    private var otaManager: OtaManager? = null

    // OTA trial-confirm criterion state (see scheduleTrialConfirm).
    private var trialConfirmed = false
    private var firstSceneCommitted = false
    private var firstDispatchObserved = false

    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "tenun-dev-reload").apply { isDaemon = true }
    }
    private val reloadInFlight = AtomicBoolean(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetBundleBytes = readAssetBundle()
        devServerUrl = readDevServerAsset()

        bundleStore = BundleStore(this)

        // Process-death rollback: a TRIAL found at start means the previous
        // process died before confirming it. Quarantine that sequence (it
        // is never retried) and boot the last confirmed / packaged bundle.
        val interruptedTrial = bundleStore?.trialSequence()
        if (interruptedTrial != null) {
            Log.w(TAG, "trial v$interruptedTrial was not confirmed before process death; quarantining")
            bundleStore?.quarantine(interruptedTrial)
        }

        engine = bootEngine()

        surfaceView = TenunSurfaceView(this).apply {
            engine = this@MainActivity.engine
            onFirstSuccessfulDispatch = { onTrialHealthSignal() }
        }

        setContentView(surfaceView)

        // First scene from boot is on screen (surface attach synced it).
        firstSceneCommitted = engine?.getLatestScene()?.isNotEmpty() == true

        if (devServerUrl != null) {
            Log.i(TAG, "dev hot reload enabled against $devServerUrl")
            schedulePoll(POLL_INTERVAL_MS)
        }

        val channel = UpdateChannel.fromAssets(assets)
        val store = bundleStore
        if (channel != null && store != null) {
            val host = UpdateProtocol.HostIdentity(
                appId = packageName,
                channel = channel.channel,
                hostApi = UpdateProtocol.HOST_API_VERSION
            )
            otaManager = OtaManager(
                channel = channel,
                host = host,
                store = store.delegate,
                ioExecutor = ioExecutor,
                applyBundle = { bytes, metadata -> applyOtaUpdate(bytes, metadata) }
            )
            if (devServerUrl != null) {
                // Dev build: short-interval loop is acceptable.
                Log.i(TAG, "OTA enabled (dev polling) against ${channel.manifestUrl}")
                otaManager?.startDevPolling(firstDelayMs = OTA_FIRST_CHECK_MS, intervalMs = OTA_INTERVAL_MS)
            } else {
                // Non-dev shape: launch check; onResume adds throttled checks.
                Log.i(TAG, "OTA enabled (launch + resume checks) against ${channel.manifestUrl}")
                otaManager?.checkNow()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Production-shaped cadence: foreground/resume check, throttled
        // inside OtaManager (MIN_CHECK_GAP_MS).
        if (devServerUrl == null) otaManager?.checkNow()
    }

    /** Boots stored (confirmed) OTA bundle, falling back to packaged asset. */
    private fun bootEngine(): TenunEngine? {
        val store = bundleStore
        if (store != null) {
            val stored = store.activeBundleBytes()
            if (stored != null) {
                try {
                    Log.i(TAG, "booting confirmed OTA bundle v${store.installedVersion()}")
                    return TenunEngine(stored)
                } catch (e: Exception) {
                    Log.w(TAG, "confirmed OTA bundle failed to boot; using packaged: ${e.message}")
                    // Confirmed-but-broken is treated like a failed trial.
                    store.quarantine(store.installedVersion())
                }
            }
        }
        return try {
            TenunEngine(assetBundleBytes)
        } catch (e: Exception) {
            Log.e(TAG, "packaged bundle failed to boot: ${e.message}")
            null
        }
    }

    /**
     * OTA apply with PARALLEL boot: the old engine keeps running while the
     * candidate initializes; the host swaps (and destroys the old engine)
     * only after the candidate boots. State carries across only when both
     * sides declare the same state schema — otherwise clean restart.
     */
    private fun applyOtaUpdate(bytes: ByteArray, metadata: UpdateProtocol.ReleaseMetadata): Boolean {
        val current = engine
        val exported = try {
            current?.dispatchAction("__TENUN_EXPORT", "{}")
        } catch (e: Exception) {
            null
        }
        val oldStateSchema = exported?.let { parsed ->
            try { org.json.JSONObject(parsed).optLong("stateSchema", -1L) } catch (e: Exception) { -1L }
        } ?: -1L

        val candidate = try {
            TenunEngine(bytes)
        } catch (e: Exception) {
            Log.w(TAG, "OTA bundle v${metadata.sequence} failed to initialize: ${e.message}")
            return false // old engine never touched
        }

        val newStateSchema = try {
            val response = candidate.dispatchAction("__TENUN_STATE_SCHEMA", "{}")
            org.json.JSONObject(response).optLong("stateSchema", -1L)
        } catch (e: Exception) {
            -1L
        }

        return try {
            if (UpdateProtocol.shouldRestore(oldStateSchema, newStateSchema) && exported != null && exported.length > 2) {
                candidate.dispatchAction("TENUN_RESTORE", exported)
            } else {
                Log.i(TAG, "state schema ${oldStateSchema} -> ${newStateSchema}: restarting with clean state")
            }
            // Atomic host swap, THEN destroy the old engine.
            engine = candidate
            surfaceView?.engine = candidate
            try {
                current?.destroy()
            } catch (ignored: Exception) {
            }
            firstSceneCommitted = candidate.getLatestScene()?.isNotEmpty() == true
            scheduleTrialConfirm(metadata.sequence)
            Log.i(TAG, "OTA bundle v${metadata.sequence} live (trial)")
            true
        } catch (e: Exception) {
            Log.w(TAG, "OTA bundle v${metadata.sequence} failed during restore: ${e.message}")
            try { candidate.destroy() } catch (ignored: Exception) {}
            false
        }
    }

    /**
     * Trial confirmation: first scene committed (set at apply/attach) AND
     * first successful dispatch (surface hook) AND minimum uptime. Any
     * process death before this runs quarantines the trial on next start.
     */
    private fun scheduleTrialConfirm(sequence: Long) {
        trialConfirmed = false
        mainHandler.postDelayed({
            if (trialConfirmed) return@postDelayed
            if (firstSceneCommitted && firstDispatchObserved) {
                if (bundleStore?.confirmTrial(sequence) == true) {
                    trialConfirmed = true
                    Log.i(TAG, "OTA bundle v$sequence CONFIRMED (scene + dispatch + uptime)")
                }
            } else {
                Log.i(TAG, "trial v$sequence not yet healthy; confirm retry scheduled")
                mainHandler.postDelayed({ scheduleTrialConfirm(sequence) }, CONFIRM_RETRY_MS)
            }
        }, TRIAL_MIN_UPTIME_MS)
    }

    private fun onTrialHealthSignal() {
        firstDispatchObserved = true
    }

    private fun readAssetBundle(): ByteArray? {
        return try {
            assets.open("gallery_app.js").use { it.readBytes() }
        } catch (e: Exception) {
            try {
                assets.open("tenun_app.js").use { it.readBytes() }
            } catch (e2: Exception) {
                null
            }
        }
    }

    /** One line: the dev server base URL, e.g. http://192.168.1.55:8898 */
    private fun readDevServerAsset(): String? {
        return try {
            assets.open("dev_server.txt").use { stream ->
                stream.readBytes().decodeToString().trim().ifEmpty { null }
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun schedulePoll(delayMs: Long) {
        mainHandler.postDelayed({ pollTick() }, delayMs)
    }

    private fun pollTick() {
        val url = devServerUrl ?: return
        ioExecutor.execute {
            try {
                val hash = httpGetText("$url/hash")
                val known = lastHash
                lastHash = hash
                if (known != null && hash != known && reloadInFlight.compareAndSet(false, true)) {
                    val bytes = httpGetBytes("$url/gallery_app.js")
                    runOnUiThread {
                        try {
                            applyReload(bytes)
                        } finally {
                            reloadInFlight.set(false)
                            schedulePoll(POLL_INTERVAL_MS)
                        }
                    }
                    return@execute
                }
            } catch (e: Exception) {
                // Dev server unreachable is a normal state (laptop asleep,
                // offline testing); the app keeps running its current bundle.
                Log.d(TAG, "dev server unreachable: ${e.message}")
            }
            schedulePoll(POLL_INTERVAL_MS)
        }
    }

    /**
     * Dev hot reload — same parallel-boot, schema-gated shape as the OTA
     * apply, so both paths share one semantics: the running app survives a
     * bad bundle untouched.
     */
    private fun applyReload(bytes: ByteArray) {
        val current = engine
        val exported = try {
            current?.dispatchAction("__TENUN_EXPORT", "{}")
        } catch (e: Exception) {
            null
        }
        val oldStateSchema = exported?.let { parsed ->
            try { org.json.JSONObject(parsed).optLong("stateSchema", -1L) } catch (e: Exception) { -1L }
        } ?: -1L

        val candidate = try {
            TenunEngine(bytes)
        } catch (e: Exception) {
            Log.w(TAG, "hot reload bundle failed to initialize; keeping current: ${e.message}")
            return
        }

        val newStateSchema = try {
            val response = candidate.dispatchAction("__TENUN_STATE_SCHEMA", "{}")
            org.json.JSONObject(response).optLong("stateSchema", -1L)
        } catch (e: Exception) {
            -1L
        }

        try {
            if (UpdateProtocol.shouldRestore(oldStateSchema, newStateSchema) && exported != null && exported.length > 2) {
                candidate.dispatchAction("TENUN_RESTORE", exported)
            }
            engine = candidate
            surfaceView?.engine = candidate
            try { current?.destroy() } catch (ignored: Exception) {}
            Log.i(TAG, "hot reload applied (${bytes.size} bytes)")
        } catch (e: Exception) {
            Log.w(TAG, "hot reload failed; keeping current bundle: ${e.message}")
            try { candidate.destroy() } catch (ignored: Exception) {}
        }
    }

    private fun httpGetText(url: String): String = String(httpGetBytes(url))

    private fun httpGetBytes(url: String): ByteArray {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 1500
            connection.readTimeout = 2500
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

    override fun onDestroy() {
        super.onDestroy()
        mainHandler.removeCallbacksAndMessages(null)
        ioExecutor.shutdownNow()
        engine?.destroy()
        engine = null
    }

    companion object {
        private const val TAG = "TenunMainActivity"
        private const val POLL_INTERVAL_MS = 2500L
        private const val OTA_FIRST_CHECK_MS = 4000L
        private const val OTA_INTERVAL_MS = 30_000L
        private const val TRIAL_MIN_UPTIME_MS = 10_000L
        private const val CONFIRM_RETRY_MS = 5_000L
    }
}

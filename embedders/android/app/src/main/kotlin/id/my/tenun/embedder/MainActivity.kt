package id.my.tenun.embedder

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Calendar
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

    // TN-154: Host Service Bridge registry and native BLE service
    private val hostRegistry = HostServiceRegistry()
    private var bleService: PolytronBleService? = null

    // OTA trial-confirm criterion state (see scheduleTrialConfirm).
    // Session-scoped: a swap (OTA apply, hot reload) clears the evidence
    // so only the CURRENT engine's own scene + dispatch can confirm.
    private val trialHealth = TrialHealth()
    private var trialConfirmed = false

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

        // TN-154: Prepare host service registry BEFORE boot so capabilities
        // (e.g. ble.supported()) resolve during bundle evaluation.
        ensureHostServices()
        engine = bootEngine()

        // Startup state: Starting → Ready | Failed. A null engine is a
        // TERMINAL, fail-visible state: the application is not running.
        // An explicit host-owned error panel replaces the UI — no legacy
        // fallback, no active controls, no retry, no substituted bundle.
        // (An intentionally selected legacy application still runs through
        // its own successful boot path; this only removes the null-engine
        // fallback.) Detailed stage/attempt diagnostics stay in logcat.
        if (engine == null) {
            renderStartupFailure()
            return
        }

        surfaceView = TenunSurfaceView(this).apply {
            engine = this@MainActivity.engine
            onFirstSuccessfulDispatch = { onTrialHealthSignal() }
        }

        setContentView(surfaceView)

        // First scene from boot is on screen (surface attach synced it).
        if (engine?.getLatestScene()?.isNotEmpty() == true) trialHealth.onSceneCommitted()

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

    /**
     * Terminal startup-failure panel, host-owned and QuickJS-free: plain
     * framework views only. No cause speculation (the underlying reason
     * may be unknown); the correlation reference points at the structured
     * logcat lines. No controls are exposed, so no stale action targets
     * can remain active.
     */
    private fun renderStartupFailure() {
        val correlation = lastBootCorrelation
        val pad = 48
        val panel = android.widget.ScrollView(this).apply {
            setBackgroundColor(android.graphics.Color.parseColor("#101014"))
            addView(
                android.widget.LinearLayout(this@MainActivity).apply {
                    orientation = android.widget.LinearLayout.VERTICAL
                    setPadding(pad, pad * 2, pad, pad)
                    addView(
                        android.widget.TextView(this@MainActivity).apply {
                            text = "Unable to start this app."
                            textSize = 26f
                            setTextColor(android.graphics.Color.parseColor("#F2F2F7"))
                        },
                    )
                    addView(
                        android.widget.TextView(this@MainActivity).apply {
                            text = "Error reference: $correlation"
                            textSize = 15f
                            setTextColor(android.graphics.Color.parseColor("#9AA3B2"))
                            setPadding(0, pad / 2, 0, 0)
                        },
                    )
                    addView(
                        android.widget.TextView(this@MainActivity).apply {
                            text = "Update the app and try again."
                            textSize = 15f
                            setTextColor(android.graphics.Color.parseColor("#9AA3B2"))
                            setPadding(0, pad, 0, 0)
                        },
                    )
                },
            )
        }
        startupFailed = true
        setContentView(panel)
        Log.e(TAG, "startup FAILED (terminal); error reference: $correlation")
    }

    /** Correlation id of the last boot attempt, for the failure panel and tests. */
    private var lastBootCorrelation: String = "attempt unknown"

    /** True once a terminal startup failure was rendered. */
    var startupFailed: Boolean = false
        private set

    /** Boots stored (confirmed) OTA bundle, falling back to packaged asset. */
    private fun bootEngine(): TenunEngine? {
        val store = bundleStore
        if (store != null) {
            val stored = store.activeBundleBytes()
            if (stored != null) {
                try {
                    Log.i(TAG, "booting confirmed OTA bundle v${store.installedVersion()}")
                    bootBundleSha = sha256Hex(stored)
                    return TenunEngine(stored, hostRegistry).also { lastBootCorrelation = "stored-v${store.installedVersion()}" }
                } catch (e: Exception) {
                    Log.w(TAG, "confirmed OTA bundle failed to boot; using packaged: ${e.message}")
                    // Confirmed-but-broken is treated like a failed trial.
                    store.quarantine(store.installedVersion())
                }
            }
        }
        bootBundleSha = sha256Hex(assetBundleBytes)
        return try {
            TenunEngine(assetBundleBytes, hostRegistry).also { lastBootCorrelation = "packaged" }
        } catch (e: Exception) {
            // The structured native attribution lines (stage/attempt) are
            // in logcat under TenunEngine; the panel keeps only the boot
            // source here — no cause speculation.
            lastBootCorrelation = "packaged (see logcat TenunEngine)"
            Log.e(TAG, "packaged bundle failed to boot: ${e.message}")
            null
        }
    }

    private fun sha256Hex(bytes: ByteArray?): String? {
        if (bytes == null) return null
        return try {
            MessageDigest.getInstance("SHA-256").digest(bytes)
                .joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * TN-154: Connects native Host Capability Bridge (BLE, System) to an active engine.
     */
    private fun ensureHostServices() {
        if (bleService == null) {
            bleService = PolytronBleService(this) { action, payloadJson ->
                mainHandler.post {
                    this.engine?.let { eng ->
                        eng.dispatchAction(action, payloadJson)
                        surfaceView?.syncFromScene(eng.getLatestScene())
                        surfaceView?.redraw()
                    }
                }
            }
            hostRegistry.register("ble", bleService!!)
            hostRegistry.register("system", object : NativeService {
                override fun invoke(method: String, payloadJson: String): String? {
                    return when (method) {
                        "clockNow" -> {
                            val c = Calendar.getInstance()
                            String.format("%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
                        }
                        "scheduleTimer" -> {
                            try {
                                val delay = org.json.JSONObject(payloadJson).optLong("delayMs", 0L)
                                mainHandler.postDelayed({
                                    this@MainActivity.engine?.let { eng ->
                                        eng.dispatchAction("TIMER", "{}")
                                        surfaceView?.syncFromScene(eng.getLatestScene())
                                        surfaceView?.redraw()
                                    }
                                }, Math.max(10L, delay))
                                "true"
                            } catch (e: Exception) {
                                null
                            }
                        }
                        "editProgram" -> {
                            mainHandler.post {
                                showEditProgramDialog(payloadJson)
                            }
                            "true"
                        }
                        else -> null
                    }
                }
            })
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
        // TN-150: state carry reads the handler's REPLY (dispatchActionResult),
        // not the committed scene the legacy dispatch returns — the scene
        // never carries stateSchema, so restore silently never happened.
        val exported = try {
            current?.dispatchActionResult("__TENUN_EXPORT", "{}")
        } catch (e: Exception) {
            null
        }
        val oldStateSchema = exported?.let { parsed ->
            try { org.json.JSONObject(parsed).optLong("stateSchema", -1L) } catch (e: Exception) { -1L }
        } ?: -1L

        val candidate = try {
            TenunEngine(bytes, hostRegistry)
        } catch (e: Exception) {
            Log.w(TAG, "OTA bundle v${metadata.sequence} failed to initialize: ${e.message}")
            return false // old engine never touched
        }

        val newStateSchema = try {
            val response = candidate.dispatchActionResult("__TENUN_STATE_SCHEMA", "{}") ?: ""
            org.json.JSONObject(response).optLong("stateSchema", -1L)
        } catch (e: Exception) {
            -1L
        }

        return try {
            if (UpdateProtocol.shouldRestore(oldStateSchema, newStateSchema) && exported != null && exported.length > 2) {
                // TN-163: the restore rides the RESULT channel. A thrown
                // restore (rejected snapshot) yields a NULL reply there,
                // while the legacy scene channel swallows the throw and
                // returns normally — which is how the swap used to proceed
                // on top of a failed restore. An unacknowledged restore
                // refuses the swap: the running application keeps its
                // engine and its state instead of booting empty.
                val acknowledged = candidate.dispatchActionResult("TENUN_RESTORE", exported)
                if (acknowledged.isNullOrBlank()) {
                    Log.w(TAG, "OTA bundle v${metadata.sequence} restore was not acknowledged; keeping the current app")
                    try { candidate.destroy() } catch (ignored: Exception) {}
                    return false
                }
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
            // TN-134: prior scene/dispatch evidence belonged to the OLD
            // engine — a pre-update tap must not confirm this trial.
            trialHealth.onEngineSwapped()
            if (candidate.getLatestScene()?.isNotEmpty() == true) trialHealth.onSceneCommitted()
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
            if (trialHealth.isHealthy()) {
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
        trialHealth.onDispatchObserved()
    }

    /** Which bundled asset booted — the dev hot reload fetches THIS file
     *  from the dev server, never a hardcoded demo name. */
    private var assetBundleName = "polytron_app.js"

    /** sha256(hex) of the bundle bytes that actually booted (stored OTA or
     *  packaged asset) — the baseline the FIRST dev-server poll compares
     *  against, so a deploy that landed while the app was closed is picked
     *  up on launch instead of only on the next change while running. */
    private var bootBundleSha: String? = null

    private fun readAssetBundle(): ByteArray? {
        return try {
            assets.open("polytron_app.js").use { it.readBytes() }
        } catch (e0: Exception) {
            try {
                assetBundleName = "gallery_app.js"
                assets.open("gallery_app.js").use { it.readBytes() }
            } catch (e: Exception) {
                try {
                    assetBundleName = "tenun_app.js"
                    assets.open("tenun_app.js").use { it.readBytes() }
                } catch (e2: Exception) {
                    null
                }
            }
        }
    }

    /**
     * One line: the dev server base URL, e.g. http://192.168.1.55:8898.
     *
     * TN-178: honored in DEBUGGABLE builds only. The marker is generated
     * into the debug source set, but a release package must never
     * activate unsigned network hot reload even if a dev_server.txt
     * asset is accidentally packaged — the reload path fetches and
     * evaluates arbitrary JavaScript with live host capabilities and has
     * none of the OTA envelope's signature/compatibility gates.
     */
    private fun readDevServerAsset(): String? {
        val debuggable = (applicationInfo.flags and
            android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (!debuggable) return null
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
                // The server sends the hash with a trailing newline — trim so
                // it compares equal against the locally computed boot sha.
                val hash = httpGetText("$url/hash").trim()
                val known = lastHash
                lastHash = hash
                if (reloadWanted(hash, known, bootBundleSha) && reloadInFlight.compareAndSet(false, true)) {
                    try {
                        val bytes = httpGetBytes("$url/$assetBundleName")
                        runOnUiThread {
                            try {
                                applyReload(bytes)
                            } finally {
                                reloadInFlight.set(false)
                                schedulePoll(POLL_INTERVAL_MS)
                            }
                        }
                        return@execute
                    } catch (e: Exception) {
                        // The bundle fetch died mid-reload (server hiccup,
                        // network drop). Release the in-flight flag here or
                        // every later poll CAS-fails silently and hot reload
                        // stays dead for the rest of the process.
                        reloadInFlight.set(false)
                        Log.d(TAG, "dev reload fetch failed: ${e.message}")
                    }
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
        // TN-150: handler replies, not the committed scene (see applyOtaUpdate).
        val exported = try {
            current?.dispatchActionResult("__TENUN_EXPORT", "{}")
        } catch (e: Exception) {
            null
        }
        val oldStateSchema = exported?.let { parsed ->
            try { org.json.JSONObject(parsed).optLong("stateSchema", -1L) } catch (e: Exception) { -1L }
        } ?: -1L

        val candidate = try {
            TenunEngine(bytes, hostRegistry)
        } catch (e: Exception) {
            Log.w(TAG, "hot reload bundle failed to initialize; keeping current: ${e.message}")
            return
        }

        val newStateSchema = try {
            val response = candidate.dispatchActionResult("__TENUN_STATE_SCHEMA", "{}") ?: ""
            org.json.JSONObject(response).optLong("stateSchema", -1L)
        } catch (e: Exception) {
            -1L
        }

        try {
            if (UpdateProtocol.shouldRestore(oldStateSchema, newStateSchema) && exported != null && exported.length > 2) {
                // TN-163: same acknowledgement gate as the OTA apply (see
                // applyOtaUpdate) — an unacknowledged restore refuses the
                // swap instead of activating a candidate with empty state.
                val acknowledged = candidate.dispatchActionResult("TENUN_RESTORE", exported)
                if (acknowledged.isNullOrBlank()) {
                    Log.w(TAG, "hot reload restore was not acknowledged; keeping current bundle")
                    try { candidate.destroy() } catch (ignored: Exception) {}
                    return
                }
            }
            engine = candidate
            surfaceView?.engine = candidate
            try { current?.destroy() } catch (ignored: Exception) {}
            // A pending trial must not confirm on the OLD engine's
            // evidence after a hot-reload swap either.
            trialHealth.onEngineSwapped()
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

    private fun showEditProgramDialog(payloadJson: String) {
        val (slot, current) = try {
            val obj = org.json.JSONObject(payloadJson)
            obj.optInt("slot", 0) to obj.optString("current", "")
        } catch (e: Exception) {
            0 to ""
        }
        val slotKeys = arrayOf("PROG0", "PROG1", "PROG2")
        val slotKey = slotKeys.getOrNull(slot) ?: "PROG0"
        val inputView = android.widget.EditText(this).apply {
            setText(current)
            setSelection(text.length)
        }
        android.app.AlertDialog.Builder(this)
            .setTitle("Atur Langkah Program $slotKey")
            .setMessage("Format token: WASH:600, DRAIN:30, SPIN:300")
            .setView(inputView)
            .setPositiveButton("Simpan") { _, _ ->
                val next = inputView.text.toString().trim()
                if (next.isEmpty()) return@setPositiveButton // cleared text = cancel
                // Route through the engine's runtime send path (SAVE_PROGRAM):
                // the runtime owns the optimistic cache update, the pending-ack
                // tracking, and failure feedback — a direct bleService.write
                // bypassed all three and left the Programs tab stale.
                val payload = org.json.JSONObject()
                    .put("slot", slot)
                    .put("tokens", next)
                    .toString()
                val eng = this.engine
                if (eng != null) {
                    eng.dispatchAction("SAVE_PROGRAM", payload)
                    surfaceView?.syncFromScene(eng.getLatestScene())
                    surfaceView?.redraw()
                } else {
                    bleService?.write("SET $slotKey $next")
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    // BLE runtime-permission dialog result: a granted set auto-resumes a
    // connect() that was parked behind the dialog; a denial reports guidance
    // (and opens this app's settings page when the OS marked it permanent).
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 101) return
        val granted = grantResults.isNotEmpty() &&
            grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        bleService?.onPermissionResult(granted)
    }

    override fun onDestroy() {
        super.onDestroy()
        bleService?.shutdown()
        bleService = null
        // TN-135: kill the OTA pipeline first — a fetch finishing after
        // this point must not boot a candidate into a dying surface.
        otaManager?.stop()
        mainHandler.removeCallbacksAndMessages(null)
        ioExecutor.shutdownNow()
        // Invalidate retained InputConnections before their engine is destroyed.
        surfaceView?.engine = null
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

        /**
         * Dev-reload decision, extracted for tests. Reload when the server
         * hash differs from what this device knows — the last observed hash,
         * or, on the first poll after launch, the booted bundle's own hash:
         * a deploy that landed while the app was closed must still be picked
         * up on the next launch, not only on a change seen while running.
         * A null boot sha (unreadable bytes) keeps the legacy record-only
         * first poll; a blank server hash never triggers a fetch.
         */
        internal fun reloadWanted(serverHash: String?, lastHash: String?, bootSha: String?): Boolean {
            if (serverHash.isNullOrBlank()) return false
            val known = lastHash ?: bootSha ?: return false
            return known != serverHash
        }
    }
}

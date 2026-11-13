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

    /** Pinned update channel (manifest URL + signer key); null when the asset is absent. */
    private var otaChannel: UpdateChannel? = null
    @Volatile private var otaManager: OtaManager? = null

    // TN-154: Host Service Bridge registry and native BLE service
    private val hostRegistry = HostServiceRegistry()
    private var bleService: PolytronBleService? = null
    // TN-190: discovery browses are foreground-scoped to the engine that
    // started them — the service is retired (browses stopped, resolves
    // settled, multicast lock released) whenever that engine is replaced
    // or destroyed, and recreated lazily for the next one.
    private var discoveryService: DiscoveryService? = null

    // OTA trial-confirm criterion state (see scheduleTrialConfirm).
    // Session-scoped: a swap (OTA apply, hot reload) clears the evidence
    // so only the CURRENT engine's own scene + dispatch can confirm.
    private val trialHealth = TrialHealth()
    private var trialConfirmed = false

    private val mainHandler = Handler(Looper.getMainLooper())
    /** Requester-bound TIMER wake-ups (see newEngine/scheduleEngineTimer). */
    private val timerScheduler = RequesterBoundScheduler { action, delayMs ->
        mainHandler.postDelayed({ action() }, delayMs)
    }
    private val ioExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "tenun-dev-reload").apply { isDaemon = true }
    }
    private val reloadInFlight = AtomicBoolean(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetBundleBytes = readAssetBundle()
        devServerUrl = readDevServerAsset()

        bundleStore = BundleStore(this)
        // Loaded BEFORE bootEngine: startup re-verification of a stored
        // bundle needs the pinned signer key. The test seam may override
        // the baked asset (debuggable builds only, see [testChannelFromIntent]).
        otaChannel = testChannelFromIntent() ?: UpdateChannel.fromAssets(assets)

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

        // Plan B2: Back has ONE owner. API 33+ delivers system Back through
        // the invoked-callback dispatcher (targetSdk 36 no longer routes it
        // through onBackPressed), so register there; the legacy override
        // below keeps older versions covered. A registered callback suppresses
        // the platform default, so not-handled falls back to moveTaskToBack for
        // root launcher activity or finish() — matching platform default behavior.
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                android.window.OnBackInvokedCallback {
                    val fallback: () -> Unit = {
                        if (isTaskRoot) moveTaskToBack(true) else finish()
                    }
                    val eng = engine ?: run {
                        fallback()
                        return@OnBackInvokedCallback
                    }
                    val reply = try {
                        eng.dispatchActionResult("BACK", "{}")
                    } catch (e: Exception) {
                        Log.w(TAG, "BACK dispatch failed: ${e.message}")
                        null
                    }
                    val handled = reply != null && runCatching {
                        org.json.JSONObject(reply).optBoolean("handled", false)
                    }.getOrDefault(false)
                    if (!handled) {
                        fallback()
                        return@OnBackInvokedCallback
                    }
                    surfaceView?.syncFromScene(eng.getLatestScene())
                    surfaceView?.redraw()
                },
            )
        }

        // First scene from boot is on screen (surface attach synced it).
        if (engine?.getLatestScene()?.isNotEmpty() == true) trialHealth.onSceneCommitted()

        if (devServerUrl != null) {
            Log.i(TAG, "dev hot reload enabled against $devServerUrl")
            schedulePoll(POLL_INTERVAL_MS)
        }

        val channel = otaChannel
        val store = bundleStore
        if (channel != null && store != null) {
            // TN-195: the host identity carries the capability snapshot
            // (registered services → contract versions) taken once here;
            // the transient unregister during engine swaps never affects
            // compatibility judgments.
            val host = currentHostIdentity(channel)
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
        if (devServerUrl == null) {
            otaManager?.checkNow()
            // TN-196: idle-policy releases activate when no text-input
            // session is live — the resume cadence is the same one the
            // checks use, so no extra scheduling surface exists.
            otaManager?.activatePendingNow(canApplyNow = { !hasActiveTextInput() })
        }
    }

    /** True while a text-input session is live on the surface (idle gate). */
    private fun hasActiveTextInput(): Boolean = surfaceView?.hasActiveTextInputSession() == true

    /** TN-196: activates the pending staged release (see [OtaManager.activatePendingNow]). */
    private fun activatePendingOta(force: Boolean) {
        otaManager?.activatePendingNow(force = force, canApplyNow = { !hasActiveTextInput() })
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

    /**
     * TN-197 TEST SEAM: intent extras override the baked update channel so
     * the on-device journey can point this activity's REAL OTA stack at a
     * loopback server. Honored ONLY when the APK is debuggable — a release
     * build never accepts a channel (and thereby a signer key) from another
     * app's intent.
     */
    private fun testChannelFromIntent(): UpdateChannel? {
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE == 0) return null
        val url = intent?.getStringExtra(EXTRA_OTA_MANIFEST_URL) ?: return null
        val key = intent?.getStringExtra(EXTRA_OTA_PUBLIC_KEY) ?: return null
        val name = intent?.getStringExtra(EXTRA_OTA_CHANNEL) ?: "prototype"
        return UpdateChannel(url, name, key)
    }

    // ---- TN-197 read-only OTA observability for the on-device journey ----

    /** Confirmed OTA sequence (-1 = packaged), via the real store. */
    val otaInstalledSequenceForTest: Long
        get() = bundleStore?.installedVersion() ?: -1L

    /** Sequence currently in TRIAL, or null. */
    val otaTrialSequenceForTest: Long?
        get() = bundleStore?.trialSequence()

    /** Staged-but-unactivated sequence (deferred policy), or null. */
    val otaPendingStagedSequenceForTest: Long?
        get() = bundleStore?.pendingStagedSequence()

    /** Boot-source correlation of the current engine ("packaged", "stored-vN", "activated-vN"). */
    val otaBootSourceForTest: String
        get() = lastBootCorrelation

    /** The live surface (real touches/scenes go through it). */
    val surfaceForTest: TenunSurfaceView?
        get() = surfaceView

    /** TN-195: the running host's compatibility identity for [channel]. */
    private fun currentHostIdentity(channel: UpdateChannel) = UpdateProtocol.HostIdentity(
        appId = packageName,
        channel = channel.channel,
        hostApi = UpdateProtocol.HOST_API_VERSION,
        capabilities = hostRegistry.capabilitySnapshot()
    )

    /**
     * Boot order (TN-196): a staged NEXT-LAUNCH release activates FIRST —
     * a fresh boot is its policy moment and it outranks the confirmed
     * bundle — re-verified ([UpdateProtocol.storedBundleUsable]: cached
     * signed envelope against the pinned key, the running host, and the
     * stored bytes) and promoted to TRIAL before booting, so an
     * unconfirmed death quarantines on the next start. Otherwise the
     * stored (confirmed) bundle boots after the same re-verification;
     * otherwise the packaged asset.
     *
     * Verification failure shapes, deliberately different:
     *   - Verification ran and FAILED (tampered meta, drifted bytes, host
     *     API moved on): proven defect → quarantine, like a failed trial.
     *   - Verification CANNOT run (no channel asset, legacy cache without
     *     an envelope): nothing proven, nothing destroyed — the store keeps
     *     the bundle, but packaged boots this launch.
     *   - A staged candidate that is not next-launch (idle) simply stays
     *     staged — its activation moment is a foreground-return resume.
     */
    fun bootEngine(): TenunEngine? {
        val store = bundleStore
        val channel = otaChannel
        if (store != null && channel != null) {
            val pending = store.pendingStaged()
            if (pending != null) {
                val stagedMetadata = UpdateProtocol.storedBundleUsable(
                    pending.envelope,
                    channel.publicKeyB64,
                    currentHostIdentity(channel),
                    pending.bytes
                )
                when {
                    stagedMetadata == null -> {
                        // A stale stage is not a defect: discard, re-download later.
                        Log.w(TAG, "staged OTA candidate v${store.pendingStagedSequence()} failed boot re-verification; discarding")
                        store.discard(store.pendingStagedSequence() ?: -1L)
                    }
                    stagedMetadata.activation == UpdateProtocol.ACTIVATION_NEXT_LAUNCH -> {
                        try {
                            Log.i(TAG, "activating staged OTA bundle v${stagedMetadata.sequence} (next-launch policy)")
                            if (!store.promoteTrial(stagedMetadata.sequence)) {
                                Log.w(TAG, "staged v${stagedMetadata.sequence} could not enter trial; booting the next candidate")
                            } else {
                                bootBundleSha = sha256Hex(pending.bytes)
                                return newEngine(pending.bytes).also {
                                    lastBootCorrelation = "activated-v${stagedMetadata.sequence}"
                                    scheduleTrialConfirm(stagedMetadata.sequence)
                                }
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "staged OTA bundle v${stagedMetadata.sequence} failed to boot; quarantining: ${e.message}")
                            store.quarantine(stagedMetadata.sequence)
                        }
                    }
                    else -> Unit // idle: stays staged; activates on a foreground-return resume
                }
            }
        }
        if (store != null) {
            val stored = store.activeBundleBytes()
            if (stored != null) {
                val envelope = store.activeEnvelope()
                val verified = if (channel != null && envelope != null) {
                    UpdateProtocol.storedBundleUsable(
                        envelope,
                        channel.publicKeyB64,
                        currentHostIdentity(channel),
                        stored
                    )
                } else {
                    null
                }
                if (verified != null) {
                    try {
                        Log.i(TAG, "booting re-verified OTA bundle v${verified.sequence}")
                        bootBundleSha = sha256Hex(stored)
                        return newEngine(stored).also { lastBootCorrelation = "stored-v${verified.sequence}" }
                    } catch (e: Exception) {
                        Log.w(TAG, "confirmed OTA bundle failed to boot; using packaged: ${e.message}")
                        // Confirmed-but-broken is treated like a failed trial.
                        store.quarantine(verified.sequence)
                    }
                } else if (channel == null || envelope == null) {
                    Log.w(
                        TAG,
                        "stored OTA bundle v${store.installedVersion()} cannot be re-verified " +
                            "(no pinned key or cached release); booting packaged"
                    )
                } else {
                    Log.w(TAG, "stored OTA bundle v${store.installedVersion()} failed startup re-verification; quarantining")
                    store.quarantine(store.installedVersion())
                }
            }
        }
        bootBundleSha = sha256Hex(assetBundleBytes)
        return try {
            newEngine(assetBundleBytes).also { lastBootCorrelation = "packaged" }
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
            // "system.scheduleTimer" is intercepted per-engine (newEngine):
            // the shared registry has no caller identity, and the timer's
            // owner must be the engine that REQUESTED it.
            hostRegistry.register("system", object : NativeService {
                override val contractVersion = 1

                override fun invoke(method: String, payloadJson: String): String? {
                    return when (method) {
                        "clockNow" -> {
                            val c = Calendar.getInstance()
                            String.format("%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
                        }
                        "editProgram" -> {
                            mainHandler.post {
                                showEditProgramDialog(payloadJson)
                            }
                            "true"
                        }
                        // TN-196: explicit app-requested OTA activation —
                        // the app decides the moment is right and forces
                        // the pending staged release through (bypassing
                        // the idle gate). "true" = request queued, not
                        // that an update existed.
                        "activateUpdate" -> {
                            mainHandler.post { activatePendingOta(force = true) }
                            "true"
                        }
                        else -> null
                    }
                }
            })
            // TN-189: Keystore-held identities for companion pairing (ADR-0027).
            // No context: AndroidKeyStore is process-global, and its entries
            // outlive engine swaps and app processes (the keystore daemon owns
            // them) — the persistence semantics the device gate asserts.
            // The SAME instance backs TN-188's net TLS client certificates:
            // NetService resolves identities through its namespace only.
            val keys = KeysService()
            hostRegistry.register("keys", keys)
            // TN-188: TCP/TLS sessions. NET_EVENT pushes ride the same
            // host→JS channel as BLE_LINK: dispatched into the CURRENT
            // engine, so a swapped engine never receives stale events.
            hostRegistry.register(
                "net",
                NetService(
                    onEvent = { action, payloadJson ->
                        mainHandler.post {
                            this.engine?.let { eng ->
                                eng.dispatchAction(action, payloadJson)
                                surfaceView?.syncFromScene(eng.getLatestScene())
                                surfaceView?.redraw()
                            }
                        }
                    },
                    keyResolver = keys::identityEntry,
                ),
            )
            // TN-190: mDNS/NSD browse + resolve. DISCOVERY_EVENT pushes ride
            // the same host→JS channel: dispatched into the CURRENT engine
            // on its creating thread (the BLE_LINK/NET_EVENT discipline).
            // Retired with the engine that owns its browses (retireDiscovery).
            ensureDiscoveryService()
        }
    }

    private fun ensureDiscoveryService() {
        if (discoveryService != null) return
        val service = DiscoveryService(
            appContext = this,
            onEvent = { action, payloadJson ->
                mainHandler.post {
                    this.engine?.let { eng ->
                        eng.dispatchAction(action, payloadJson)
                        surfaceView?.syncFromScene(eng.getLatestScene())
                        surfaceView?.redraw()
                    }
                }
            },
        )
        discoveryService = service
        hostRegistry.register("discovery", service)
    }

    /**
     * TN-190: discovery is foreground-scoped to the engine that started
     * its browses. On engine replacement or activity destruction the old
     * engine's operations are stopped (browses torn down, resolves
     * settled, multicast lock released) — they must never accumulate
     * into the replacement runtime or wedge MAX_BROWSES.
     */
    private fun retireDiscovery() {
        discoveryService?.let { service ->
            hostRegistry.unregister("discovery")
            try {
                service.shutdown()
            } catch (ignored: Exception) {
            }
        }
        discoveryService = null
    }

    /**
     * Engine construction with a REQUESTER-bound host handler. Each engine's
     * native handle owns the handler instance it was created with (TN-154),
     * so a per-engine wrapper supplies the caller's identity on every
     * tenun_host_call — something the shared registry cannot. Timer wake-ups
     * bind to the requesting engine: OTA/hot-reload candidates restore state
     * (re-arming countdown timers) BEFORE they are published as this.engine,
     * so binding to the visible engine would capture the OLD engine and the
     * post-swap identity guard would drop the restored countdown (review fix).
     */
    private fun newEngine(bytes: ByteArray?): TenunEngine {
        var bound: TenunEngine? = null
        // Bundle evaluation and the bootstrap job drain finish BEFORE the
        // TenunEngine constructor returns, so timer requests made during
        // startup arrive with the requester still unbound. Buffer them and
        // schedule against the requester the moment construction completes —
        // refusing them silently dropped every bootstrap timeout (review fix).
        val deferred = DeferredTimerRequests()
        val scoped = HostServiceHandler { service, method, payloadJson ->
            if (service == "system" && method == "scheduleTimer") {
                val requester = bound
                if (requester == null) {
                    if (deferred.offer(payloadJson)) "true" else null
                } else {
                    scheduleEngineTimer(requester, payloadJson)
                }
            } else {
                hostRegistry.onHostCall(service, method, payloadJson)
            }
        }
        return TenunEngine(bytes, scoped).also { engine ->
            bound = engine
            for (payloadJson in deferred.drain()) scheduleEngineTimer(engine, payloadJson)
        }
    }

    /** Timer wake-up on behalf of [requesting]; delivered only while that
     *  engine is still the live, undisposed activity engine. */
    private fun scheduleEngineTimer(requesting: TenunEngine?, payloadJson: String): String? {
        if (requesting == null) return null
        return try {
            val delay = org.json.JSONObject(payloadJson).optLong("delayMs", 0L)
            val scheduled = timerScheduler.schedule(
                requesting, Math.max(10L, delay),
                { eng -> eng === this.engine && !eng.isDisposed },
            ) {
                requesting.dispatchAction("TIMER", "{}")
                surfaceView?.syncFromScene(requesting.getLatestScene())
                surfaceView?.redraw()
            }
            if (scheduled) "true" else null
        } catch (e: Exception) {
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
            newEngine(bytes)
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
            if (UpdateProtocol.shouldRestore(oldStateSchema, newStateSchema, metadata.stateMigrationsFrom) &&
                exported != null && exported.length > 2
            ) {
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
            // Atomic host swap, THEN destroy the old engine. TN-190: the
            // old engine's discovery operations are retired first — they
            // must not leak into the replacement runtime.
            retireDiscovery()
            engine = candidate
            surfaceView?.engine = candidate
            try {
                current?.destroy()
            } catch (ignored: Exception) {
            }
            ensureDiscoveryService()
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
            newEngine(bytes)
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
            // TN-190: retire the old engine's discovery operations before
            // the swap; recreate the service for the replacement runtime.
            retireDiscovery()
            engine = candidate
            surfaceView?.engine = candidate
            try { current?.destroy() } catch (ignored: Exception) {}
            ensureDiscoveryService()
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
    override fun onBackPressed() {
        // Plan B2: Back has ONE owner — the bundle's runtime. One dispatch per
        // press; the { handled } reply decides between the runtime's pop and
        // the platform default, so a press can never commit a navigation
        // twice. A bundle without goBack answers NULL (UNKNOWN_ACTION), which
        // is also "not handled". Predictive-back animation is a follow-up.
        val eng = engine ?: return super.onBackPressed()
        val reply = try {
            eng.dispatchActionResult("BACK", "{}")
        } catch (e: Exception) {
            Log.w(TAG, "BACK dispatch failed: ${e.message}")
            null
        }
        val handled = reply != null && runCatching {
            org.json.JSONObject(reply).optBoolean("handled", false)
        }.getOrDefault(false)
        if (!handled) return super.onBackPressed()
        surfaceView?.syncFromScene(eng.getLatestScene())
        surfaceView?.redraw()
    }

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
        retireDiscovery()
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

        /** TN-197: intent extras for the on-device OTA journey (debuggable builds only). */
        const val EXTRA_OTA_MANIFEST_URL = "tenun.ota.MANIFEST_URL"
        const val EXTRA_OTA_PUBLIC_KEY = "tenun.ota.PUBLIC_KEY_B64"
        const val EXTRA_OTA_CHANNEL = "tenun.ota.CHANNEL"

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

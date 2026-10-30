package id.my.tenun.embedder

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.ArrayDeque
import java.util.Arrays
import java.util.UUID

/**
 * TN-154: Native GATT client for the Polytron Wash v4 controller BLE service.
 * Injected into TenunEngine via HostServiceRegistry under the "ble" service name.
 *
 * Write-path contract (review 2026-10-28):
 *  - a STOP is never silently dropped: it is retried on submission failure and
 *    latched across unexpected link drops until its write is confirmed on air;
 *  - every GATT session fully resets transport state (queue, in-flight,
 *    characteristic refs) so nothing leaks across disconnect/reconnect;
 *  - stale callbacks from a previous session are ignored (g === gatt guard);
 *  - a bounded watchdog recovers from a completion callback that never arrives.
 */
class PolytronBleService(
    private val context: Context,
    private val onEvent: (action: String, payloadJson: String) -> Unit
) : NativeService {

    companion object {
        private const val TAG = "PolytronBleService"
        val SVC: UUID = UUID.fromString("9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e001")
        val CMD: UUID = UUID.fromString("9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e002")
        val STAT: UUID = UUID.fromString("9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e003")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private const val WRITE_GAP_MS = 80L
        private const val WRITE_WATCHDOG_MS = 5_000L
        private const val STOP_RETRY_MS = 400L
        private const val STOP_MAX_RETRIES = 2
        private const val CONNECT_TIMEOUT_MS = 15_000L
        private const val RX_FLUSH_MS = 40L
        private const val REQ_PERMS = 101
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val queue = ArrayDeque<String>()

    @Volatile private var gatt: BluetoothGatt? = null
    private var cmdCh: BluetoothGattCharacteristic? = null
    private var statCh: BluetoothGattCharacteristic? = null
    @Volatile private var target: BluetoothDevice? = null
    private var devName: String? = null
    @Volatile private var connected = false
    @Volatile private var userStop = false
    @Volatile private var connectSession = 0
    private var retries = 0
    /** True between drain() submission and its completion callback. */
    private var writing = false
    /** The command currently submitted to the controller (main thread only). */
    @Volatile private var inFlight: String? = null
    private var stopRetries = 0
    /** Bumped per submission; a late watchdog whose seq no longer matches is a no-op. */
    private var writeSeq = 0L
    /** TN-162: attributes each completion callback to the submission that
     *  produced it — a late callback for a watchdog-abandoned write must
     *  never confirm (or clear the STOP latch for) the current command. */
    private val ledger = GattWriteLedger()
    /** Latched while a user-requested STOP has not been confirmed written —
     *  survives an unexpected drop so the STOP is delivered after reconnect.
     *  Explicit connect()/disconnect() clear it: a fresh session is fresh intent. */
    private var stopLatch = false
    /** True between a user connect() and the permission dialog result;
     *  granting auto-resumes the parked scan. */
    @Volatile private var connectAwaitingPermission = false
    /** True when a connect died on "Bluetooth off" — the radio receiver
     *  auto-resumes the scan the moment the user enables Bluetooth. */
    @Volatile private var awaitingRadioOn = false

    /** Auto-resume a connect that died because the phone radio was off:
     *  the user should only have to flip Bluetooth on, not re-tap connect. */
    private val radioReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, intent: Intent?) {
            if (intent?.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1) == BluetoothAdapter.STATE_ON &&
                awaitingRadioOn && !userStop
            ) {
                awaitingRadioOn = false
                mainHandler.post { startScan() }
            }
        }
    }

    init {
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(radioReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(radioReceiver, filter)
        }
    }

    override fun invoke(method: String, payloadJson: String): String? {
        return when (method) {
            "supported" -> isSupported().toString()
            "connect" -> {
                connect()
                "true"
            }
            "disconnect" -> {
                disconnect()
                "true"
            }
            "write" -> {
                val cmd = try {
                    JSONObject(payloadJson).optString("cmd", "")
                } catch (e: Exception) {
                    payloadJson
                }
                val ok = write(cmd)
                ok.toString()
            }
            else -> null
        }
    }

    fun isSupported(): Boolean {
        val bm = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return bm?.adapter != null
    }

    fun connect() {
        userStop = false
        retries = 0
        stopLatch = false
        connectSession++
        mainHandler.post { startScan() }
    }

    fun disconnect() {
        userStop = true
        connectSession++
        stopLatch = false
        connectAwaitingPermission = false
        awaitingRadioOn = false
        mainHandler.removeCallbacksAndMessages(null)
        stopScan()
        mainHandler.post { closeGatt() }
        notifyLink(false, null)
    }

    fun write(cmd: String): Boolean {
        if (cmd.isEmpty()) return false
        // Ordinary commands need a live session — accepted-but-never-sent
        // writes are silent failures. STOP is always accepted and latched.
        if (!connected && cmd != "STOP") return false
        synchronized(queue) {
            if (cmd == "STOP") {
                // Emergency stop always gets through: purge all pending writes
                // so a previously queued start command (WASH, SPIN, PROG, etc.)
                // cannot execute after STOP and restart the machine!
                queue.clear()
                queue.addFirst(cmd)
                stopLatch = true
                stopRetries = 0
            } else {
                if (queue.size >= 8) return false
                queue.addLast(cmd)
            }
        }
        mainHandler.post { drain() }
        return true
    }

    fun shutdown() {
        userStop = true
        connectSession++
        stopLatch = false
        connectAwaitingPermission = false
        awaitingRadioOn = false
        mainHandler.removeCallbacksAndMessages(null)
        stopScan()
        closeGatt()
        try {
            context.unregisterReceiver(radioReceiver)
        } catch (ignored: Exception) {
        }
    }

    /* ------------------------------- scanning ------------------------------- */

    @SuppressLint("MissingPermission")
    private fun stopScan() {
        try {
            val bm = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            bm?.adapter?.bluetoothLeScanner?.stopScan(scanCb)
        } catch (ignored: Exception) {
        }
    }

    private fun checkAndRequestPermissions(): Boolean {
        val needed = neededPermissions()
            .filter { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (needed.isEmpty()) return true
        val act = context as? Activity
        if (act != null) {
            // The dialog is async: remember that a user connect() is parked
            // behind it so the grant result auto-resumes the scan instead of
            // dead-ending on an error line.
            connectAwaitingPermission = true
            act.requestPermissions(needed.toTypedArray(), REQ_PERMS)
            notifyLine("IZIN — izinkan Perangkat Terdekat/Lokasi untuk menyambung")
        } else {
            notifyLine("ERR izin bluetooth belum diberikan — Pengaturan → Aplikasi → Polytron Wash → Izin")
            notifyLink(false, null)
        }
        return false
    }

    /** Runtime permissions this Android version needs for BLE scan/connect. */
    fun neededPermissions(): List<String> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        listOf(
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_CONNECT
        )
    } else {
        listOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    /** The Activity forwards the dialog result here. The hint flag is not
     *  trusted: permissions are re-read so a partially-granted dialog (one
     *  of two allowed) is classified by what is actually still missing. */
    fun onPermissionResult(granted: Boolean) {
        val missing = neededPermissions()
            .filter { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) {
            if (connectAwaitingPermission) {
                connectAwaitingPermission = false
                mainHandler.post { startScan() }
            }
            return
        }
        connectAwaitingPermission = false
        awaitingRadioOn = false
        val act = context as? Activity
        val permanentlyDenied = act != null && missing.any {
            !act.shouldShowRequestPermissionRationale(it)
        }
        if (permanentlyDenied) {
            notifyLine("ERR izin ditolak permanen — izinkan Perangkat Terdekat & Lokasi di pengaturan aplikasi")
            notifyLink(false, null)
            openAppSettings()
        } else {
            notifyLine("ERR izin ditolak — tekan sambung lagi lalu izinkan")
            notifyLink(false, null)
        }
    }

    /** Deep-link to this app's permission settings page. */
    fun openAppSettings() {
        try {
            val intent = Intent(
                android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.packageName, null)
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.w(TAG, "openAppSettings failed", e)
        }
    }

    @SuppressLint("MissingPermission")
    private fun startScan() {
        if (!checkAndRequestPermissions()) {
            // checkAndRequestPermissions already reported (dialog shown or
            // explicit guidance line) — nothing further to say here.
            return
        }
        val bm = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = bm?.adapter
        if (adapter == null || !adapter.isEnabled) {
            awaitingRadioOn = true
            notifyLine("ERR bluetooth mati — nyalakan Bluetooth; aplikasi menyambung otomatis saat aktif")
            notifyLink(false, null)
            return
        }
        val bySvc = ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(SVC.toString())).build()
        val byName = ScanFilter.Builder().setDeviceName("Polytron Wash").build()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        try {
            adapter.bluetoothLeScanner?.startScan(Arrays.asList(bySvc, byName), settings, scanCb)
        } catch (e: Exception) {
            Log.w(TAG, "scan failed", e)
            notifyLine("ERR scan gagal — cek izin lokasi/bluetooth")
            notifyLink(false, null)
            return
        }
        notifyLink(false, null, connecting = true, phase = "scanning")
        // No-result expiry: a silent 12s scan stop left the UI in
        // "connecting" forever. Report an honest terminal failure instead —
        // the user can see the machine, the phone cannot.
        val session = connectSession
        mainHandler.postDelayed({
            try {
                adapter.bluetoothLeScanner?.stopScan(scanCb)
            } catch (ignored: Exception) {
            }
            if (userStop || connected || connectSession != session || target != null) return@postDelayed
            notifyLine("ERR mesin tidak terdeteksi — pastikan mesin menyala & dekat ponsel, lalu coba lagi")
            notifyLink(false, null)
        }, 12_000)
    }

    private val scanCb = object : ScanCallback() {
        @SuppressLint("MissingPermission")
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            if (userStop) return // a result racing an explicit disconnect must not reconnect
            val bm = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            try {
                bm?.adapter?.bluetoothLeScanner?.stopScan(this)
            } catch (ignored: Exception) {
            }
            target = result.device
            devName = result.scanRecord?.deviceName ?: target?.name
            // The machine's BLE advertisement WAS seen — surface that fact so
            // the user can distinguish "ESP on & advertising" from "not found".
            notifyLink(false, devName, connecting = true, phase = "found")
            mainHandler.post { connectTarget() }
        }

        override fun onScanFailed(errorCode: Int) {
            notifyLine("ERR scan gagal ($errorCode)")
            notifyLink(false, null)
        }
    }

    /* -------------------------------- GATT ---------------------------------- */

    @SuppressLint("MissingPermission")
    private fun connectTarget() {
        val t = target ?: return
        if (userStop) return
        // New session: fully tear down any previous client first so stale
        // callbacks, in-flight writes and queued start commands cannot leak
        // across sessions. A latched STOP survives (it is user intent).
        try {
            gatt?.close()
        } catch (ignored: Exception) {
        }
        gatt = null
        connected = false
        cmdCh = null
        statCh = null
        writing = false
        inFlight = null
        ledger.reset()
        synchronized(queue) {
            queue.clear()
            if (stopLatch) queue.addLast("STOP")
        }
        notifyLink(false, devName, connecting = true, phase = "connecting")
        var pending: BluetoothGatt? = null
        try {
            pending = t.connectGatt(context, false, gattCb, BluetoothDevice.TRANSPORT_LE)
            gatt = pending
        } catch (e: Exception) {
            Log.w(TAG, "connectGatt failed", e)
            notifyLink(false, null)
            return
        }
        if (pending != null) {
            // Connect/discovery watchdog: connectGatt has no failure callback
            // of its own — without this a radio black hole leaves the UI in
            // "connecting" until the user gives up.
            mainHandler.postDelayed({
                if (gatt === pending && !connected) {
                    notifyLine("ERR sambungan timeout — mesin tidak merespons")
                    closeGatt()
                    notifyLink(false, null)
                }
            }, CONNECT_TIMEOUT_MS)
        }
    }

    private val gattCb = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (g !== gatt) return // stale callback from a previous client
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                // Negotiate a large MTU first so whole status lines fit in
                // one notification (default 23 ⇒ 20-byte chunks split every
                // ST: line). Discovery proceeds from onMtuChanged — and
                // directly if the request is rejected.
                if (!g.requestMtu(517)) g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                mainHandler.post {
                    if (g !== gatt) return@post
                    connected = false
                    cmdCh = null
                    statCh = null
                    writing = false
                    inFlight = null
                    writeSeq++
                    ledger.reset() // TN-162: the dropped link's callbacks are void
                    synchronized(queue) {
                        queue.clear()
                        if (stopLatch) queue.addLast("STOP")
                    }
                    // Link reality goes out immediately — the UI must not sit
                    // on a stale "connected" through the 2/4/6 s retry delays.
                    if (userStop) {
                        notifyLink(false, devName)
                        closeGatt()
                    } else if (retries < 3) {
                        retries++
                        notifyLink(false, devName, connecting = true, phase = "reconnecting")
                        val currentSession = connectSession
                        val delay = 2000L * retries
                        val stale = g
                        mainHandler.postDelayed({
                            try {
                                stale.close()
                            } catch (ignored: Exception) {
                            }
                            if (!userStop && connectSession == currentSession) {
                                connectTarget()
                            }
                        }, delay)
                    } else {
                        notifyLink(false, devName)
                        closeGatt()
                        notifyLine("ERR sambungan terputus — 3x percobaan ulang gagal")
                    }
                }
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            if (g !== gatt) return
            // Discovery is gated on MTU negotiation completing (either
            // outcome — a rejected MTU still means the link is ready).
            g.discoverServices()
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (g !== gatt) return
            if (status != BluetoothGatt.GATT_SUCCESS) {
                notifyLine("ERR service tidak ditemukan")
                closeGatt()
                notifyLink(false, null)
                return
            }
            val svc = g.getService(SVC)
            if (svc == null) {
                notifyLine("ERR service v4 tidak ada")
                closeGatt()
                notifyLink(false, null)
                return
            }
            cmdCh = svc.getCharacteristic(CMD)
            statCh = svc.getCharacteristic(STAT)
            if (cmdCh == null || statCh == null) {
                notifyLine("ERR characteristic tidak ada")
                closeGatt()
                notifyLink(false, null)
                return
            }
            if (!g.setCharacteristicNotification(statCh, true)) {
                notifyLine("ERR gagal aktifkan notifikasi")
                closeGatt()
                notifyLink(false, null)
                return
            }
            val cccd = statCh?.getDescriptor(CCCD)
            if (cccd != null) {
                cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                val started = g.writeDescriptor(cccd)
                if (!started) {
                    notifyLine("ERR gagal aktifkan notifikasi")
                    closeGatt()
                    notifyLink(false, null)
                }
            } else {
                onReady()
            }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            if (g !== gatt) return
            if (d.uuid == CCCD) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    onReady()
                } else {
                    notifyLine("ERR status notifikasi $status")
                    closeGatt()
                    notifyLink(false, null)
                }
            }
        }

        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            if (g !== gatt) return
            handleCharacteristicBytes(c.value)
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            if (g !== gatt) return
            mainHandler.post {
                if (g !== gatt) return@post
                when (val completion = ledger.complete()) {
                    is GattWriteLedger.Completion.Current -> {
                        // TN-177: ONLY the live submission's own callback
                        // retires its watchdog. Advancing writeSeq before
                        // classification let a LATE (abandoned) or spurious
                        // callback cancel the CURRENT submission's armed
                        // watchdog — after a stalled WASH's late completion,
                        // a retrying STOP whose callback never arrived kept
                        // writing=true forever and wedged every later write.
                        writeSeq++
                        if (status != BluetoothGatt.GATT_SUCCESS) {
                            handleWriteFailure(completion.cmd)
                            return@post
                        }
                        if (completion.cmd == "STOP") stopLatch = false // STOP confirmed on air
                        stopRetries = 0
                        writing = false
                        inFlight = null
                        mainHandler.postDelayed({ drain() }, WRITE_GAP_MS)
                    }
                    is GattWriteLedger.Completion.Abandoned ->
                        // TN-162: a late completion for a submission the
                        // watchdog already gave up on. It proves the
                        // transport responds, but it must NEVER confirm the
                        // current command — the pre-TN-162 code read the
                        // current in-flight command here and cleared the
                        // STOP latch for a STOP that was never written. The
                        // current submission settles on its own callback or
                        // its own watchdog (TN-177: and this late callback
                        // must not touch that watchdog either).
                        Log.i(TAG, "late GATT write completion ignored (${completion.cmd})")
                    GattWriteLedger.Completion.None -> Unit // spurious callback
                }
            }
        }
    }

    private fun handleCharacteristicBytes(bytes: ByteArray?) {
        if (bytes == null || bytes.isEmpty()) return
        val chunk = String(bytes, StandardCharsets.UTF_8)
        // --- Reassembly: one protocol line may arrive split across several
        // notifications (default ATT MTU 23 ⇒ ~20-byte chunks — the phone
        // showed "ST:WASH|WASH 20min|11" and never a parseable status). A
        // chunk STARTS A NEW LINE when it begins with a known protocol
        // keyword; otherwise it continues the buffer. Newlines terminate
        // immediately, and a short debounce flushes a complete final line.
        if (rxBuf.isNotEmpty()) {
            val t = chunk.trimStart()
            if (lineStarts.any { t.startsWith(it) }) flushRxLine()
        }
        rxBuf.append(chunk)
        var nl = rxBuf.indexOf("\n")
        while (nl >= 0) {
            val line = rxBuf.substring(0, nl).trim()
            rxBuf.delete(0, nl + 1)
            if (line.isNotEmpty()) notifyLine(line)
            nl = rxBuf.indexOf("\n")
        }
        if (rxBuf.isNotEmpty()) {
            if (rxBuf.length > 600) {
                flushRxLine() // garbage guard: never buffer without bound
            } else {
                mainHandler.removeCallbacks(rxFlush)
                mainHandler.postDelayed(rxFlush, RX_FLUSH_MS)
            }
        }
    }

    /** Protocol keywords that can begin a line on the status characteristic. */
    private val lineStarts = arrayOf("ST:", "OK", "ERR", "BUSY", "SET ", "CLOCK", "WATER")

    private val rxBuf = StringBuilder()

    /** Chunks of one notification land together; silence this long means
     *  the line is complete as-is (v3 notifies SET lines 150 ms apart,
     *  ST lines 1 s apart — 40 ms never splits a real gap). */
    private val rxFlush = Runnable { flushRxLine() }

    private fun flushRxLine() {
        mainHandler.removeCallbacks(rxFlush)
        val line = rxBuf.toString().trim()
        rxBuf.setLength(0)
        if (line.isNotEmpty()) notifyLine(line)
    }

    /** Fresh session, fresh stream: a half-received line from the previous
     *  link must never leak into the next one. */
    private fun resetRx() {
        mainHandler.removeCallbacks(rxFlush)
        rxBuf.setLength(0)
    }

    private fun onReady() {
        connected = true
        retries = 0
        writing = false
        stopRetries = 0
        resetRx()
        val n = if (!devName.isNullOrEmpty()) devName else "Polytron Wash"
        notifyLink(true, n)
        mainHandler.post { drain() } // flush a STOP latched during the drop
    }

    /* ------------------------- writes + notifications ------------------------ */

    @SuppressLint("MissingPermission")
    private fun drain() {
        if (!connected || writing) return
        val cmd = synchronized(queue) { queue.pollFirst() } ?: return
        writing = true
        inFlight = cmd
        ledger.begin(cmd)
        val ok = try {
            cmdCh?.value = cmd.toByteArray(StandardCharsets.UTF_8)
            cmdCh != null && gatt?.writeCharacteristic(cmdCh) == true
        } catch (e: Exception) {
            Log.w(TAG, "writeCharacteristic threw", e)
            false
        }
        if (!ok) {
            // The command never left the phone — handleWriteFailure decides
            // between bounded STOP resubmission and dropping with an ERR.
            // No completion callback can arrive for a never-submitted write.
            ledger.abandon()
            handleWriteFailure(cmd)
            return
        }
        // The completion callback for THIS submission is now owed.
        ledger.markSubmitted()
        val seq = ++writeSeq
        mainHandler.postDelayed({
            if (writeSeq != seq || !writing) return@postDelayed
            // The completion callback never arrived: recover the transport
            // instead of blocking every later command (including STOP) forever.
            // TN-162: the abandoned submission KEEPS its ledger slot — the
            // stack may still deliver its late callback, which must consume
            // the slot without confirming anything.
            writeSeq++
            ledger.abandon()
            notifyLine("ERR penulisan timeout — cek sambungan")
            handleWriteFailure(inFlight)
        }, WRITE_WATCHDOG_MS)
    }

    /** Submission failed or a completion never came. STOP gets bounded
     *  resubmission; anything else is dropped with an ERR line — the runtime's
     *  reply timeout settles the owning screen either way. Main thread only. */
    private fun handleWriteFailure(cmd: String?) {
        writing = false
        if (cmd == null) {
            inFlight = null
            return
        }
        if (cmd != "STOP") inFlight = null
        if (cmd == "STOP" && stopRetries < STOP_MAX_RETRIES) {
            stopRetries++
            synchronized(queue) { queue.addFirst(cmd) }
            mainHandler.postDelayed({ drain() }, STOP_RETRY_MS)
            return
        }
        if (cmd == "STOP") {
            // Bounded retries exhausted: the machine may still be running —
            // say THAT instead of a generic send error.
            stopLatch = false
            inFlight = null
            stopRetries = 0
            notifyLine("ERR STOP belum terkonfirmasi — periksa mesin langsung")
            mainHandler.postDelayed({ drain() }, WRITE_GAP_MS)
            return
        }
        inFlight = null
        stopRetries = 0
        notifyLine("ERR kirim gagal — cek sambungan")
        mainHandler.postDelayed({ drain() }, WRITE_GAP_MS)
    }

    @SuppressLint("MissingPermission")
    private fun closeGatt() {
        try {
            gatt?.close()
        } catch (ignored: Exception) {
        }
        gatt = null
        connected = false
        resetRx()
        // Full transport reset: a locally closed GATT does not guarantee a
        // STATE_DISCONNECTED callback, so this is the only reliable teardown.
        cmdCh = null
        statCh = null
        writing = false
        inFlight = null
        writeSeq++
        ledger.reset()
        synchronized(queue) { queue.clear() }
    }

    /**
     * Link reality for the UI. Every terminal outcome (connected, failed,
     * disconnected, cancelled) carries connecting=false — a missing
     * connecting field once left the app's "MENYAMBUNG…" lock stuck forever.
     * In-progress pushes set connecting=true with a phase the UI can show:
     * "scanning" | "found" | "connecting" | "reconnecting".
     */
    private fun notifyLink(up: Boolean, name: String?, connecting: Boolean = false, phase: String? = null) {
        val payload = JSONObject().apply {
            put("connected", up)
            put("name", name ?: JSONObject.NULL)
            put("connecting", connecting && !up)
            if (phase != null && !up) put("phase", phase)
        }.toString()
        onEvent("BLE_LINK", payload)
    }

    private fun notifyLine(line: String) {
        onEvent("BLE_LINE", line)
    }
}

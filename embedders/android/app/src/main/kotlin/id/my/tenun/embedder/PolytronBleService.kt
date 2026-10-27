package id.my.tenun.embedder

import android.annotation.SuppressLint
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
import android.content.Context
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
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val queue = ArrayDeque<String>()

    private var gatt: BluetoothGatt? = null
    private var cmdCh: BluetoothGattCharacteristic? = null
    private var statCh: BluetoothGattCharacteristic? = null
    private var target: BluetoothDevice? = null
    private var devName: String? = null
    private var writing = false
    private var userStop = false
    private var retries = 0
    private var connected = false

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

    private var connectSession = 0

    fun connect() {
        userStop = false
        retries = 0
        connectSession++
        mainHandler.post { startScan() }
    }

    fun disconnect() {
        userStop = true
        connectSession++
        mainHandler.removeCallbacksAndMessages(null)
        stopScan()
        mainHandler.post { closeGatt() }
        notifyLink(false, null)
    }

    fun write(cmd: String): Boolean {
        if (cmd.isEmpty()) return false
        synchronized(queue) {
            if (cmd == "STOP") {
                // Emergency stop always gets through: purge all pending writes
                // so a previously queued start command (WASH, SPIN, PROG, etc.)
                // cannot execute after STOP and restart the machine!
                queue.clear()
                queue.addFirst(cmd)
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
        mainHandler.removeCallbacksAndMessages(null)
        stopScan()
        closeGatt()
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

    @SuppressLint("MissingPermission")
    private fun startScan() {
        val bm = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = bm?.adapter
        if (adapter == null || !adapter.isEnabled) {
            notifyLine("ERR bluetooth mati — nyalakan Bluetooth")
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
        mainHandler.postDelayed({
            try {
                adapter.bluetoothLeScanner?.stopScan(scanCb)
            } catch (ignored: Exception) {
            }
        }, 12_000)
    }

    private val scanCb = object : ScanCallback() {
        @SuppressLint("MissingPermission")
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val bm = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            try {
                bm?.adapter?.bluetoothLeScanner?.stopScan(this)
            } catch (ignored: Exception) {
            }
            target = result.device
            devName = result.scanRecord?.deviceName ?: target?.name
            connectTarget()
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
        notifyLink(false, devName)
        try {
            gatt = t.connectGatt(context, false, gattCb, BluetoothDevice.TRANSPORT_LE)
        } catch (e: Exception) {
            Log.w(TAG, "connectGatt failed", e)
            notifyLink(false, null)
        }
    }

    private val gattCb = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connected = false
                cmdCh = null
                statCh = null
                synchronized(queue) { queue.clear() }
                writing = false
                if (userStop) {
                    closeGatt()
                    notifyLink(false, null)
                } else if (retries < 3) {
                    retries++
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
                    closeGatt()
                    notifyLine("ERR sambungan terputus")
                    notifyLink(false, null)
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
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
            g.setCharacteristicNotification(statCh, true)
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
            handleCharacteristicBytes(c.value)
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            mainHandler.postDelayed({
                writing = false
                drain()
            }, WRITE_GAP_MS)
        }
    }

    private fun handleCharacteristicBytes(bytes: ByteArray?) {
        if (bytes == null || bytes.isEmpty()) return
        val line = String(bytes, StandardCharsets.UTF_8).trim()
        if (line.isNotEmpty()) notifyLine(line)
    }

    private fun onReady() {
        connected = true
        retries = 0
        val n = if (!devName.isNullOrEmpty()) devName else "Polytron Wash"
        notifyLink(true, n)
    }

    /* ------------------------- writes + notifications ------------------------ */

    @SuppressLint("MissingPermission")
    private fun drain() {
        if (!connected || writing) return
        val cmd = synchronized(queue) { queue.pollFirst() } ?: return
        writing = true
        try {
            cmdCh?.value = cmd.toByteArray(StandardCharsets.UTF_8)
            val ok = if (cmdCh != null) gatt?.writeCharacteristic(cmdCh) ?: false else false
            if (!ok) {
                writing = false
                notifyLine("ERR kirim gagal — cek sambungan")
                mainHandler.postDelayed({ drain() }, WRITE_GAP_MS)
            }
        } catch (e: Exception) {
            writing = false
            notifyLine("ERR kirim gagal — cek sambungan")
            mainHandler.postDelayed({ drain() }, WRITE_GAP_MS)
        }
    }

    @SuppressLint("MissingPermission")
    private fun closeGatt() {
        try {
            gatt?.close()
        } catch (ignored: Exception) {
        }
        gatt = null
        connected = false
    }

    private fun notifyLink(up: Boolean, name: String?) {
        val payload = JSONObject().apply {
            put("connected", up)
            put("name", name ?: JSONObject.NULL)
        }.toString()
        onEvent("BLE_LINK", payload)
    }

    private fun notifyLine(line: String) {
        onEvent("BLE_LINE", line)
    }
}

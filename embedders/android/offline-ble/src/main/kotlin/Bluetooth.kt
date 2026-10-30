
package android.bluetooth
import android.bluetooth.le.BluetoothLeScanner
import android.content.Context
import java.nio.charset.StandardCharsets
import java.util.UUID
object BluetoothProfile { const val STATE_CONNECTED = 2; const val STATE_DISCONNECTED = 0; const val GATT_SUCCESS = 0 }
class BluetoothGattService(val uuid: UUID) {
  private val chars = HashMap<UUID, BluetoothGattCharacteristic>()
  private val descs = HashMap<UUID, BluetoothGattDescriptor>()
  fun add(c: BluetoothGattCharacteristic) { chars[c.uuid] = c }
  fun add(d: BluetoothGattDescriptor) { descs[d.uuid] = d }
  fun getCharacteristic(u: UUID): BluetoothGattCharacteristic? = chars[u]
  fun getDescriptor(u: UUID): BluetoothGattDescriptor? = descs[u]
}
class BluetoothGattDescriptor(val uuid: UUID) {
  var value: ByteArray? = null
  companion object { val ENABLE_NOTIFICATION_VALUE: ByteArray = byteArrayOf(1, 0) }
}
class BluetoothGattCharacteristic(val uuid: UUID) {
  var value: ByteArray? = null
  private val descs = HashMap<UUID, BluetoothGattDescriptor>()
  fun addDescriptor(d: BluetoothGattDescriptor) { descs[d.uuid] = d }
  fun getDescriptor(u: UUID): BluetoothGattDescriptor? = descs[u]
}
class BluetoothGatt(val device: BluetoothDevice, val service: BluetoothGattService) {
  lateinit var callback: BluetoothGattCallback
  private val main = android.os.Handler(android.os.Looper.getMainLooper())
  // "ack":  write succeeds AND the completion callback fires (async post).
  // "true": write succeeds but NO callback fires (stalled write).
  // "false": writeCharacteristic returns false (never left the phone).
  var writeMode: String = "ack"
  val accepted = mutableListOf<String>()
  val attempts = mutableListOf<String>()
  companion object { const val GATT_SUCCESS = 0 }
  fun getService(u: UUID): BluetoothGattService = service
  fun requestMtu(mtu: Int): Boolean = false
  fun discoverServices() = true
  fun close() {}
  fun setCharacteristicNotification(c: BluetoothGattCharacteristic?, enable: Boolean): Boolean = true
  fun writeDescriptor(d: BluetoothGattDescriptor): Boolean = true
  fun writeCharacteristic(c: BluetoothGattCharacteristic?): Boolean {
    if (c == null) return false
    val cmd = c.value?.toString(StandardCharsets.UTF_8) ?: return false
    attempts.add(cmd)
    if (writeMode == "false") return false
    if (writeMode == "ack") {
      accepted.add(cmd)
      main.post(object : Runnable {
        override fun run() { callback.onCharacteristicWrite(this@BluetoothGatt, c, BluetoothProfile.GATT_SUCCESS) }
      })
    }
    return true
  }
}
open class BluetoothGattCallback {
  open fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {}
  open fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) { g.discoverServices() }
  open fun onServicesDiscovered(g: BluetoothGatt, status: Int) {}
  open fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {}
  @Deprecated("Deprecated in Java")
  open fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {}
  @Deprecated("Deprecated in Java")
  open fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {}
}
class BluetoothDevice {
  val connections = mutableListOf<BluetoothGatt>()
  var name: String? = "Polytron Wash"
  fun connectGatt(context: Context, auto: Boolean, cb: BluetoothGattCallback, transport: Int): BluetoothGatt {
    val svc = BluetoothGattService(UUID.fromString("9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e001"))
    svc.add(BluetoothGattCharacteristic(UUID.fromString("9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e002")))
    val stat = BluetoothGattCharacteristic(UUID.fromString("9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e003"))
    stat.addDescriptor(BluetoothGattDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")))
    svc.add(stat)
    val g = BluetoothGatt(this, svc)
    g.callback = cb
    connections.add(g)
    return g
  }
  companion object { const val TRANSPORT_LE = 2 }
}
class BluetoothAdapter {
  companion object { const val ACTION_STATE_CHANGED = "state"; const val EXTRA_STATE = "extra"; const val STATE_ON = 12 }
  val bluetoothLeScanner = BluetoothLeScanner()
  val isEnabled: Boolean get() = true
}
class BluetoothManager { val adapter = BluetoothAdapter() }


package android.content
open class Context {
  companion object { const val BLUETOOTH_SERVICE = "bluetooth"; const val RECEIVER_NOT_EXPORTED = 4 }
  val manager = android.bluetooth.BluetoothManager()
  val packageName = "probe"
  open fun getSystemService(name: String): Any? = manager
  fun checkSelfPermission(name: String) = 0
  fun registerReceiver(r: BroadcastReceiver, f: IntentFilter) {}
  fun registerReceiver(r: BroadcastReceiver, f: IntentFilter, flags: Int) {}
  fun unregisterReceiver(r: BroadcastReceiver) {}
  fun startActivity(i: Intent) {}
}
abstract class BroadcastReceiver { abstract fun onReceive(c: Context?, intent: Intent?) }
class Intent(action: String, uri: android.net.Uri? = null) {
  companion object { const val FLAG_ACTIVITY_NEW_TASK = 1 }
  fun getIntExtra(key: String, default: Int) = default
  fun addFlags(flags: Int) = this
}
class IntentFilter(action: String)

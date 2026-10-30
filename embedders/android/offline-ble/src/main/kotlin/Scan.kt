
package android.bluetooth.le
import android.bluetooth.BluetoothDevice
class ScanResult(val device: BluetoothDevice, val scanRecord: ScanRecord? = null)
class ScanRecord(val name: String? = null) { val deviceName: String? get() = name }
open class ScanCallback {
  open fun onScanResult(callbackType: Int, result: ScanResult) {}
  open fun onScanFailed(errorCode: Int) {}
}
class ScanFilter private constructor(val serviceUuid: String?, val name: String?) {
  class Builder {
    private var uuid: String? = null; private var name: String? = null
    fun setServiceUuid(u: android.os.ParcelUuid) = apply { uuid = u.toString() }
    fun setDeviceName(n: String) = apply { name = n }
    fun build() = ScanFilter(uuid, name)
  }
}
class ScanSettings private constructor() {
  class Builder {
    fun setScanMode(mode: Int) = this
    fun build() = ScanSettings()
  }
  companion object { const val SCAN_MODE_LOW_LATENCY = 1 }
}
class BluetoothLeScanner {
  var callback: ScanCallback? = null
  fun startScan(filters: List<ScanFilter>, settings: ScanSettings, cb: ScanCallback) { callback = cb }
  fun stopScan(cb: ScanCallback) {}
}

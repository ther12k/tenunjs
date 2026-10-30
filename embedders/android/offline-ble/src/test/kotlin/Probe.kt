
// Offline BLE write-path regression (TN-159/TN-162/TN-177).
//
// This :offline-ble module compiles the PRODUCTION PolytronBleService +
// GattWriteLedger (srcDir-filtered from :app) against the hand-written
// android.* fakes in src/main/kotlin and drives them on a virtual-time
// Scheduler — the write path's watchdog/retry/attribution behavior is
// regression-tested by `./gradlew test` (and therefore run_android_test.sh
// and CI) without hardware. A plain JVM module: no android.jar on the
// classpath, so the platform-fake classes cannot collide with SDK stubs.
// The fakes' signatures mimic android.jar PLATFORM types
// (nullable-tolerant) — the strict SDK stubs break the smart casts the
// real build allows.
//
// Fake BluetoothGatt write modes:
//   "ack"   — write succeeds and the completion callback fires (async)
//   "true"  — write succeeds but NO completion callback fires (stall)
//   "false" — writeCharacteristic returns false (never left the phone)

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Scheduler
import id.my.tenun.embedder.PolytronBleService
import org.junit.Test

fun field(s: PolytronBleService, n: String): Any? =
    s.javaClass.getDeclaredField(n).apply { isAccessible = true }.get(s)

fun queue(s: PolytronBleService): List<String> =
    (field(s, "queue") as java.util.ArrayDeque<*>).toList().map { it as String }

fun latch(s: PolytronBleService) = field(s, "stopLatch") == true

fun writing(s: PolytronBleService) = field(s, "writing") == true

class Fixture {
    val context = Context()
    val events = mutableListOf<String>()
    val service = PolytronBleService(context) { a, p -> events.add("$a $p") }
    val device = BluetoothDevice()
    val scanner get() = context.manager.adapter.bluetoothLeScanner
    init { Scheduler.reset() }
    fun cmdCh(g: android.bluetooth.BluetoothGatt) =
        g.getService(PolytronBleService.SVC).getCharacteristic(PolytronBleService.CMD)!!
    fun connect(): android.bluetooth.BluetoothGatt {
        service.connect(); Scheduler.runCurrent()
        scanner.callback!!.onScanResult(0, ScanResult(device, ScanRecord("Polytron Wash"))); Scheduler.runCurrent()
        return device.connections.last().also { ready(it) }
    }
    fun ready(g: android.bluetooth.BluetoothGatt) {
        g.callback.onConnectionStateChange(g, 0, BluetoothProfile.STATE_CONNECTED)
        g.callback.onServicesDiscovered(g, 0)
        g.callback.onDescriptorWrite(
            g,
            g.getService(PolytronBleService.SVC).getCharacteristic(PolytronBleService.STAT)!!
                .getDescriptor(PolytronBleService.CCCD)!!,
            0,
        )
        Scheduler.runCurrent()
    }
    fun drop(g: android.bluetooth.BluetoothGatt) {
        g.callback.onConnectionStateChange(g, 133, BluetoothProfile.STATE_DISCONNECTED); Scheduler.runCurrent()
    }
}

class OfflineBleProbeTest {

    @Test
    fun productionWritePathAgainstFakeTransport() {
        // CONTROL 1 (TN-159): rejected STOP retried, then explicit ERR.
        run {
            val f = Fixture(); val g = f.connect(); g.writeMode = "false"
            check(f.service.write("STOP")); Scheduler.runCurrent()
            Scheduler.advance(5000)
            check(g.attempts == listOf("STOP", "STOP", "STOP")) { "attempts=${g.attempts}" }
            check(f.events.any { it.contains("STOP belum terkonfirmasi") }) { "events=${f.events}" }
            println("CONTROL PASS: rejected STOP attempted three times and reported explicit ERR")
        }
        // CONTROL 2 (TN-159): teardown isolation.
        run {
            val f = Fixture(); val old = f.connect(); f.service.write("WASH"); Scheduler.runCurrent()
            f.service.disconnect(); Scheduler.runCurrent(); val fresh = f.connect()
            old.callback.onServicesDiscovered(old, 133); f.drop(old)
            old.callback.onCharacteristicWrite(old, f.cmdCh(old), 0); Scheduler.runCurrent()
            check(field(f.service, "gatt") === fresh)
            check(field(f.service, "connected") == true)
            f.service.write("STOP"); Scheduler.runCurrent()
            check(fresh.accepted == listOf("STOP")) { "accepted=${fresh.accepted}" }
            println("CONTROL PASS: explicit teardown resets transport and old GATT callbacks cannot corrupt replacement")
        }
        // CONTROL 3 (TN-159): unconfirmed STOP survives a drop.
        run {
            val f = Fixture(); val g = f.connect()
            g.writeMode = "true"
            f.service.write("STOP"); Scheduler.runCurrent()
            f.drop(g); Scheduler.advance(2000)
            val next = f.device.connections.last(); check(next !== g)
            f.ready(next)
            check(next.accepted == listOf("STOP")) { "accepted=${next.accepted}" }
            println("CONTROL PASS: unconfirmed STOP survives unexpected drop and is sent on automatic reconnect")
        }
        // TN-162 A: the late-callback reproduction against the production service.
        run {
            val f = Fixture(); val g = f.connect()
            g.writeMode = "true"
            check(f.service.write("WASH")); Scheduler.runCurrent()
            check(f.service.write("STOP")); Scheduler.runCurrent()
            check(g.attempts == listOf("WASH")) { "attempts=${g.attempts}" }
            Scheduler.advance(5080)
            check(g.attempts.contains("STOP")) { "attempts=${g.attempts}" }
            check(latch(f.service)) { "latch must be set before the late callback" }
            g.callback.onCharacteristicWrite(g, f.cmdCh(g), BluetoothProfile.GATT_SUCCESS)
            Scheduler.runCurrent()
            check(latch(f.service)) { "late WASH callback must NOT clear the STOP latch" }
            f.drop(g); Scheduler.advance(2000)
            val next = f.device.connections.last(); check(next !== g)
            f.ready(next)
            check(next.accepted == listOf("STOP")) { "reconnect accepted=${next.accepted}" }
            check(queue(f.service).isEmpty())
            println("TN-162 PASS: late abandoned-write callback leaves the latch set; STOP delivered on reconnect")
        }
        // TN-162 B: a normally acknowledged STOP still clears the latch on air.
        run {
            val f = Fixture(); val g = f.connect()
            check(f.service.write("WASH")); Scheduler.runCurrent()
            check(f.service.write("STOP")); Scheduler.runCurrent()
            check(g.accepted == listOf("WASH", "STOP")) { "accepted=${g.accepted}" }
            check(!latch(f.service)) { "latch must clear on the STOP's own callback" }
            check(queue(f.service).isEmpty())
            println("TN-162 PASS: STOP's own completion callback still confirms on air")
        }
        // TN-177: a late ABANDONED completion must not cancel the CURRENT
        // submission's watchdog. WASH stalls and is watchdog-abandoned; STOP
        // submits and stalls; the WASH completion arrives late (Abandoned);
        // STOP's own completion NEVER arrives. The live watchdog must still
        // fire: bounded retries, explicit machine-check ERR, queue drained,
        // writing released. Pre-fix, the late callback bumped writeSeq and
        // disarmed the STOP watchdog — writing stayed true forever.
        run {
            val f = Fixture(); val g = f.connect()
            g.writeMode = "true"
            check(f.service.write("WASH")); Scheduler.runCurrent()
            check(f.service.write("STOP")); Scheduler.runCurrent()
            Scheduler.advance(5080) // WASH watchdog; STOP submits (and stalls)
            check(g.attempts == listOf("WASH", "STOP")) { "attempts=${g.attempts}" }
            // The stalled WASH completion arrives LATE, while STOP is live.
            g.callback.onCharacteristicWrite(g, f.cmdCh(g), BluetoothProfile.GATT_SUCCESS)
            Scheduler.runCurrent()
            check(latch(f.service)) { "late WASH callback must not clear the STOP latch" }
            // STOP's completion never arrives: its OWN watchdog must recover.
            Scheduler.advance(21_000)
            check(g.attempts == listOf("WASH", "STOP", "STOP", "STOP")) {
                "STOP must retry the bounded count; attempts=${g.attempts}"
            }
            check(f.events.any { it.contains("STOP belum terkonfirmasi") }) { "events=${f.events}" }
            check(!writing(f.service)) { "writing must be released after bounded retries" }
            check(queue(f.service).isEmpty()) { "queue must drain: ${queue(f.service)}" }
            println("TN-177 PASS: late abandoned completion leaves the live watchdog armed; bounded retries and explicit ERR")
        }
        println("ALL OFFLINE BLE PROBE CHECKS PASSED (production service + fake transport)")
    }
}

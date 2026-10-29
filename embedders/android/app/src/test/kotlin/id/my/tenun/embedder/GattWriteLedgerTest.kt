package id.my.tenun.embedder

import org.junit.Assert.*
import org.junit.Test

/**
 * TN-162: the GATT write-completion ledger. GATT callbacks carry no
 * submission identity, so attribution rides the Android stack's
 * in-order completion of characteristic writes. These tests pin the
 * rule the production read-path review found broken: a late completion
 * for a watchdog-abandoned submission must NEVER confirm the current
 * command (the pre-TN-162 code read the current in-flight command at
 * callback time and cleared the STOP latch for a STOP that was never
 * written).
 */
class GattWriteLedgerTest {

    @Test
    fun normalSubmissionIsConfirmedByItsOwnCallback() {
        val ledger = GattWriteLedger()
        ledger.begin("STOP")
        ledger.markSubmitted()
        assertEquals(GattWriteLedger.Completion.Current("STOP"), ledger.complete())
        assertEquals(GattWriteLedger.Completion.None, ledger.complete())
    }

    @Test
    fun lateCallbackForAnAbandonedSubmissionNeverConfirmsTheCurrentOne() {
        val ledger = GattWriteLedger()
        // WASH is submitted, then its watchdog fires (submission abandoned).
        ledger.begin("WASH")
        ledger.markSubmitted()
        ledger.abandon()
        // STOP is submitted afterwards (the bounded retry path).
        ledger.begin("STOP")
        ledger.markSubmitted()
        // The stalled WASH completion finally arrives — in submission order.
        assertEquals(GattWriteLedger.Completion.Abandoned("WASH"), ledger.complete())
        // ...and STOP still requires ITS OWN callback to confirm.
        assertEquals(GattWriteLedger.Completion.Current("STOP"), ledger.complete())
    }

    @Test
    fun abandonedFailureCallbackIsAlsoUnattributable() {
        val ledger = GattWriteLedger()
        ledger.begin("WASH")
        ledger.markSubmitted()
        ledger.abandon()
        ledger.begin("STOP")
        ledger.markSubmitted()
        // A late WASH callback carrying a failure status is just as
        // unattributable as a late success.
        assertEquals(GattWriteLedger.Completion.Abandoned("WASH"), ledger.complete())
        assertEquals(GattWriteLedger.Completion.Current("STOP"), ledger.complete())
    }

    @Test
    fun neverSubmittedWriteConsumesNoSlot() {
        val ledger = GattWriteLedger()
        ledger.begin("STOP") // writeCharacteristic returned false
        ledger.abandon()
        assertEquals(GattWriteLedger.Completion.None, ledger.complete())
    }

    @Test
    fun spuriousCallbackWithoutAnySubmissionIsNone() {
        assertEquals(GattWriteLedger.Completion.None, GattWriteLedger().complete())
    }

    @Test
    fun resetVoidsAllOwedCallbacksAndTheLedgerStaysUsable() {
        val ledger = GattWriteLedger()
        ledger.begin("WASH")
        ledger.markSubmitted()
        ledger.abandon()
        ledger.begin("STOP")
        ledger.markSubmitted()
        ledger.reset() // link drop: every owed callback belongs to a dead transport
        assertEquals(GattWriteLedger.Completion.None, ledger.complete())
        // The replacement connection starts from a clean ledger.
        ledger.begin("STOP")
        ledger.markSubmitted()
        assertEquals(GattWriteLedger.Completion.Current("STOP"), ledger.complete())
    }

    @Test
    fun consecutiveSubmissionsEachConfirmOnTheirOwnCallback() {
        // Only one submission can be awaiting-and-live at a time (drain()
        // refuses while `writing`), so the reachable sequence is
        // submit → complete → submit → complete.
        val ledger = GattWriteLedger()
        ledger.begin("WASH")
        ledger.markSubmitted()
        assertEquals(GattWriteLedger.Completion.Current("WASH"), ledger.complete())
        ledger.begin("SPIN")
        ledger.markSubmitted()
        assertEquals(GattWriteLedger.Completion.Current("SPIN"), ledger.complete())
        assertEquals(GattWriteLedger.Completion.None, ledger.complete())
    }
}

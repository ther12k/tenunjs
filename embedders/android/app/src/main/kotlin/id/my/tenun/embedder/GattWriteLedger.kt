package id.my.tenun.embedder

import java.util.ArrayDeque

/**
 * TN-162: GATT completion callbacks carry no submission identity — the
 * callback hands back the characteristic and a status, never "which
 * write". The Android stack completes characteristic writes in
 * submission order, so attribution is possible with a per-submission
 * ledger: one in-order slot per successfully submitted write.
 *
 * A submission the watchdog gave up on KEEPS its slot (its late callback
 * must still consume it to keep later callbacks aligned) but is marked
 * abandoned: that late callback is a transport-alive signal only.
 * Reading the CURRENT in-flight command at callback time instead is
 * exactly the defect this type removes — a stalled WASH's late SUCCESS
 * callback was read as the new STOP's confirmation and cleared the STOP
 * latch for a STOP that was never written.
 *
 * Main-thread only, like the rest of the write path.
 */
class GattWriteLedger {

    /** Outcome of one completion callback, in submission order. */
    sealed interface Completion {
        /** The callback belongs to the current live submission. */
        data class Current(val cmd: String) : Completion

        /** The callback belongs to a submission already given up on —
         *  transport signal only; it must not confirm anything. */
        data class Abandoned(val cmd: String) : Completion

        /** No submission was awaiting a callback. */
        object None : Completion
    }

    private data class Submission(val id: Long, val cmd: String)

    private val awaiting = ArrayDeque<Submission>()
    private val abandoned = HashSet<Long>()
    private var nextId = 0L
    private var live: Submission? = null

    /** drain() is about to attempt [cmd]. */
    fun begin(cmd: String) {
        live = Submission(++nextId, cmd)
    }

    /** writeCharacteristic returned true: the completion callback is now
     *  owed for the live submission. */
    fun markSubmitted() {
        live?.let { awaiting.addLast(it) }
    }

    /** The watchdog fired, or the submission attempt failed: the live
     *  submission is dead. A late callback for it must not confirm
     *  anything; when it arrives it still consumes its slot so later
     *  callbacks stay aligned. */
    fun abandon() {
        val submission = live ?: return
        if (awaiting.contains(submission)) abandoned.add(submission.id)
        live = null
    }

    /** A completion callback arrived (completions come in submission order). */
    fun complete(): Completion {
        val head = awaiting.pollFirst() ?: return Completion.None
        if (abandoned.remove(head.id)) return Completion.Abandoned(head.cmd)
        if (live?.id == head.id) {
            live = null
            return Completion.Current(head.cmd)
        }
        // Submitted, no longer live, never abandoned: reachable only if a
        // new begin() happened while this callback was still owed — treat
        // it as unattributable, the same safe rule as an abandoned slot.
        return Completion.Abandoned(head.cmd)
    }

    /** Teardown (link drop, fresh connect, closeGatt): every owed
     *  callback belongs to a dead transport and is void. */
    fun reset() {
        awaiting.clear()
        abandoned.clear()
        live = null
    }
}

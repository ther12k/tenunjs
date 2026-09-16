package id.my.tenun.embedder

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * Lifecycle and crash-safety tests for [UpdateStore]: staged → trial →
 * confirmed, process-death quarantine of an unconfirmed trial, persistent
 * anti-replay, and fail-closed behavior on corrupted state files.
 */
class UpdateStoreTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun newStore(): UpdateStore = UpdateStore(tmp.newFolder())

    @Test
    fun testEmptyStoreHasNoBundles() {
        val store = newStore()
        assertEquals(-1L, store.acceptedSequence())
        assertEquals(-1L, store.installedVersion())
        assertNull(store.activeBundleBytes())
        assertNull(store.trialSequence())
        assertFalse(store.isQuarantined(1))
    }

    @Test
    fun testStagedTrialConfirmLifecycle() {
        val store = newStore()
        val bundle = "console.log('v2')".toByteArray()

        store.stageBundle(2, bundle, stateSchema = 1)
        assertEquals(-1L, store.acceptedSequence()) // staged: not accepted yet
        assertNull(store.trialSequence())

        assertTrue(store.promoteTrial(2))
        assertEquals(2L, store.trialSequence())

        assertTrue(store.confirmTrial(2))
        assertNull(store.trialSequence())
        assertEquals(2L, store.acceptedSequence())
        assertTrue(store.activeBundleBytes()!!.contentEquals(bundle))
        assertEquals(1L, store.activeStateSchema())
    }

    @Test
    fun testTrialCannotSkipStagedOrDoubleConfirm() {
        val store = newStore()
        store.stageBundle(2, ByteArray(4), 1)
        assertTrue(store.promoteTrial(2))
        assertFalse(store.promoteTrial(2)) // staged → trial only once
        assertTrue(store.confirmTrial(2))
        assertFalse(store.confirmTrial(2)) // confirmed is terminal
    }

    @Test
    fun testUnconfirmedTrialAtProcessDeathQuarantines() {
        val root = tmp.newFolder()

        // Process 1: stages a trial, then "dies" before confirming.
        val first = UpdateStore(root)
        first.stageBundle(3, "console.log('v3')".toByteArray(), 1)
        first.promoteTrial(3)
        assertEquals(3L, first.trialSequence())

        // Process 2 (next launch): the leftover trial is quarantined and
        // the app rolls back — the sequence is never retried.
        val second = UpdateStore(root)
        val leftover = second.trialSequence()
        assertEquals(3L, leftover)
        second.quarantine(leftover!!)
        assertNull(second.trialSequence())
        assertTrue(second.isQuarantined(3))
        assertEquals(-1L, second.acceptedSequence()) // rolled back
    }

    @Test
    fun testQuarantineSurvivesStoreRecreation() {
        val root = tmp.newFolder()
        UpdateStore(root).quarantine(7)
        assertTrue(UpdateStore(root).isQuarantined(7)) // persistent anti-replay
        assertFalse(UpdateStore(root).isQuarantined(8))
    }

    @Test
    fun testConfirmedBundleSurvivesRecreationAndKeepsActive() {
        val root = tmp.newFolder()
        val first = UpdateStore(root)
        val bundle = "console.log('confirmed')".toByteArray()
        first.stageBundle(5, bundle, 1)
        first.promoteTrial(5)
        first.confirmTrial(5)

        val second = UpdateStore(root)
        assertEquals(5L, second.acceptedSequence())
        assertTrue(second.activeBundleBytes()!!.contentEquals(bundle))
    }

    @Test
    fun testQuarantinedConfirmedSequenceThenRollbackSemantics() {
        // A confirmed bundle later found broken: quarantining its sequence
        // removes the active pointer's backing files, so accepted falls
        // back to none (the host boots packaged) and the sequence is never
        // retried.
        val store = newStore()
        store.stageBundle(4, ByteArray(2), 1)
        store.promoteTrial(4)
        store.confirmTrial(4)
        assertEquals(4L, store.acceptedSequence())

        store.quarantine(4)
        assertTrue(store.isQuarantined(4))
        assertEquals(-1L, store.acceptedSequence())
        assertNull(store.activeBundleBytes())
    }

    @Test
    fun testCorruptMetaFilesFailClosed() {
        val root = tmp.newFolder()
        val store = UpdateStore(root)
        store.stageBundle(2, ByteArray(4), 1)
        // Corrupt the meta file: the version is invisible to the lifecycle.
        val meta = File(root, "bundles/2/meta.json")
        meta.writeText("{not json")
        assertNull(store.trialSequence())
        assertFalse(store.promoteTrial(2))
        assertFalse(store.confirmTrial(2))
    }

    @Test
    fun testCorruptQuarantineFileRepairs() {
        val root = tmp.newFolder()
        File(root, "quarantine.json").writeText("garbage")
        val store = UpdateStore(root)
        assertFalse(store.isQuarantined(3)) // fails open for reads
        store.quarantine(3) // and the next write rebuilds valid state
        assertTrue(UpdateStore(root).isQuarantined(3))
    }
}

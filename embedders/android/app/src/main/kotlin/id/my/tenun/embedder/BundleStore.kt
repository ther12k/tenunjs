package id.my.tenun.embedder

import android.content.Context
import java.io.File

/**
 * Context-bound factory for the OTA bundle store (see [UpdateStore] for
 * the crash-atomic layout and lifecycle). Kept as a thin wrapper so JVM
 * tests drive [UpdateStore] directly with a temp directory.
 */
class BundleStore(context: Context) {

    val delegate: UpdateStore = UpdateStore(File(context.filesDir, "bundles"))

    fun acceptedSequence(): Long = delegate.acceptedSequence()

    fun installedVersion(): Long = delegate.installedVersion()

    fun activeBundleBytes(): ByteArray? = delegate.activeBundleBytes()

    fun activeStateSchema(): Long = delegate.activeStateSchema()

    fun stageBundle(sequence: Long, bytes: ByteArray, stateSchema: Long) =
        delegate.stageBundle(sequence, bytes, stateSchema)

    fun promoteTrial(sequence: Long): Boolean = delegate.promoteTrial(sequence)

    fun confirmTrial(sequence: Long): Boolean = delegate.confirmTrial(sequence)

    fun trialSequence(): Long? = delegate.trialSequence()

    fun quarantine(sequence: Long) = delegate.quarantine(sequence)

    fun isQuarantined(sequence: Long): Boolean = delegate.isQuarantined(sequence)
}

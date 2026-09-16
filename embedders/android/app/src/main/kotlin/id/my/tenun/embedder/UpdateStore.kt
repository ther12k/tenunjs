package id.my.tenun.embedder

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Crash-atomic OTA bundle storage (JVM-pure; takes a root directory, so
 * JVM tests drive it with a temp dir and Android passes filesDir/bundles).
 *
 * Layout — versioned directories plus an atomic active pointer, so a
 * process death can never leave mismatched half-state:
 *
 *   <root>/bundles/<sequence>/bundle.js     the verified bundle bytes
 *   <root>/bundles/<sequence>/meta.json     {"state":"staged|trial|confirmed",
 *                                            "stateSchema":N}
 *   <root>/active                           confirmed sequence (atomic file)
 *   <root>/quarantine.json                  failed sequences, never retried
 *
 * Every write goes to a .tmp sibling followed by rename (atomic within a
 * directory). All public methods synchronize on one lock — Android's
 * AtomicFile classes do not provide locking, so it is the caller's job.
 *
 * Lifecycle: staged → trial (apply started) → confirmed (health criterion
 * met, active pointer moves). A trial that does not reach confirmed — boot
 * failure or unconfirmed process death — is quarantined: its sequence is
 * recorded and that release is never retried (the anti-replay companion to
 * the signed sequence gate).
 */
class UpdateStore(private val root: File) {

    private val lock = Any()

    private fun bundlesDir(): File = File(root, "bundles").apply { mkdirs() }
    private fun versionDir(sequence: Long): File = File(bundlesDir(), sequence.toString())
    private fun bundleFile(sequence: Long): File = File(versionDir(sequence), "bundle.js")
    private fun metaFile(sequence: Long): File = File(versionDir(sequence), "meta.json")
    private fun activeFile(): File = File(root, "active")
    private fun quarantineFile(): File = File(root, "quarantine.json")

    /**
     * The sequence of the confirmed bundle, or -1 when none. The pointer
     * counts only while its backing files exist — quarantining a confirmed
     * sequence therefore rolls the host back to the packaged bundle.
     */
    fun acceptedSequence(): Long {
        synchronized(lock) {
            val sequence = parseLongOrNull(readFile(activeFile())) ?: return -1L
            if (sequence < 0) return -1L
            val meta = metaOf(sequence) ?: return -1L
            if (meta.state != "confirmed") return -1L
            if (!bundleFile(sequence).exists()) return -1L
            return sequence
        }
    }

    /** Alias matching the previous API name: confirmed version, or -1. */
    fun installedVersion(): Long = acceptedSequence()

    fun activeBundleBytes(): ByteArray? {
        synchronized(lock) {
            val sequence = acceptedSequence()
            if (sequence < 0) return null
            return try {
                val file = bundleFile(sequence)
                if (file.exists()) file.readBytes() else null
            } catch (e: Exception) {
                null
            }
        }
    }

    fun activeStateSchema(): Long {
        synchronized(lock) {
            val sequence = acceptedSequence()
            if (sequence < 0) return -1L
            return metaOf(sequence)?.stateSchema ?: -1L
        }
    }

    /** Persists a verified download. State starts at STAGED. */
    fun stageBundle(sequence: Long, bytes: ByteArray, stateSchema: Long) {
        synchronized(lock) {
            val dir = versionDir(sequence)
            dir.mkdirs()
            atomicWrite(bundleFile(sequence), bytes)
            atomicWrite(metaFile(sequence), stateMeta("staged", stateSchema))
        }
    }

    /** STAGED → TRIAL: the apply/boot attempt is starting. */
    fun promoteTrial(sequence: Long): Boolean {
        synchronized(lock) {
            val meta = metaOf(sequence) ?: return false
            if (meta.state != "staged") return false
            atomicWrite(metaFile(sequence), stateMeta("trial", meta.stateSchema))
            return true
        }
    }

    /** TRIAL → CONFIRMED: health criterion met; the active pointer moves. */
    fun confirmTrial(sequence: Long): Boolean {
        synchronized(lock) {
            val meta = metaOf(sequence) ?: return false
            if (meta.state != "trial") return false
            atomicWrite(metaFile(sequence), stateMeta("confirmed", meta.stateSchema))
            atomicWrite(activeFile(), "$sequence\n".toByteArray())
            return true
        }
    }

    /**
     * The sequence currently in TRIAL, if any. A trial found at process
     * start means the previous process died before confirming: the caller
     * quarantines it and rolls back.
     */
    fun trialSequence(): Long? {
        synchronized(lock) {
            val dirs = bundlesDir().listFiles { file -> file.isDirectory } ?: return null
            for (dir in dirs) {
                val sequence = dir.name.toLongOrNull() ?: continue
                if (metaOf(sequence)?.state == "trial") return sequence
            }
            return null
        }
    }

    /**
     * Records a failed release: its sequence is never retried, and its
     * stored bytes are deleted.
     */
    fun quarantine(sequence: Long) {
        synchronized(lock) {
            val quarantined = quarantined().toMutableSet()
            quarantined.add(sequence)
            val array = JSONArray()
            quarantined.sorted().forEach { array.put(it) }
            atomicWrite(quarantineFile(), JSONObject().put("quarantined", array).toString().toByteArray())
            versionDir(sequence).deleteRecursively()
        }
    }

    fun isQuarantined(sequence: Long): Boolean {
        synchronized(lock) { return quarantined().contains(sequence) }
    }

    /** Drops a stored version without recording failure (e.g. cleanup). */
    fun discard(sequence: Long) {
        synchronized(lock) { versionDir(sequence).deleteRecursively() }
    }

    // ---------- internals ----------

    private data class Meta(val state: String, val stateSchema: Long)

    private fun metaOf(sequence: Long): Meta? {
        return try {
            val json = JSONObject(readFile(metaFile(sequence)) ?: return null)
            val state = json.optString("state")
            if (state != "staged" && state != "trial" && state != "confirmed") return null
            Meta(state, json.optLong("stateSchema", -1L))
        } catch (e: Exception) {
            null
        }
    }

    private fun stateMeta(state: String, stateSchema: Long): ByteArray =
        JSONObject().put("state", state).put("stateSchema", stateSchema).toString().toByteArray()

    private fun quarantined(): Set<Long> {
        return try {
            val raw = readFile(quarantineFile()) ?: return emptySet()
            val array = JSONObject(raw).optJSONArray("quarantined") ?: return emptySet()
            val result = HashSet<Long>()
            for (i in 0 until array.length()) {
                array.optLong(i, -1L).takeIf { it > 0 }?.let { result.add(it) }
            }
            result
        } catch (e: Exception) {
            emptySet() // corrupt quarantine state fails open for storage but is repaired on next write
        }
    }

    private fun readFile(file: File): String? {
        return try {
            if (file.exists()) file.readText() else null
        } catch (e: Exception) {
            null
        }
    }

    /** Atomic within a directory: write a temp sibling, then rename over. */
    private fun atomicWrite(target: File, bytes: ByteArray) {
        target.parentFile?.mkdirs()
        val tmp = File(target.parentFile, target.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(target)) {
            // Same-volume rename of an existing target can fail on some
            // filesystems; delete-then-rename is the documented fallback.
            target.delete()
            if (!tmp.renameTo(target)) {
                tmp.delete()
                throw java.io.IOException("atomic rename failed for ${target.path}")
            }
        }
    }

    private fun parseLongOrNull(text: String?): Long? {
        val trimmed = text?.trim() ?: return null
        return trimmed.toLongOrNull()
    }
}

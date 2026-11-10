package id.my.tenun.embedder

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * TN-196: the "storage" host service — the [StorageCapability] seam over
 * app-private SharedPreferences (storage.md: app-scoped sandbox, UTF-8
 * string values, no manifest permissions).
 *
 * Direct replies (no ticket): the first `getSharedPreferences` load happens
 * on a background thread at construction; after that reads are in-memory
 * hash lookups and writes are `apply()` (async flush), so no op can block
 * the engine thread long enough to need the media fetchText ticket pattern.
 */
class StorageService(context: Context) : NativeService {

    private val prefs = context.getSharedPreferences("tvplayer", Context.MODE_PRIVATE)

    override fun invoke(method: String, payloadJson: String): String? {
        val payload = try {
            JSONObject(payloadJson)
        } catch (e: Exception) {
            JSONObject()
        }
        return when (method) {
            "get" -> get(payload.optString("key", ""))
            "set" -> set(payload.optString("key", ""), payload.optString("value", ""))
            "remove" -> remove(payload.optString("key", ""))
            "keys" -> keys()
            else -> null
        }
    }

    private fun get(key: String): String {
        StorageContract.keyError(key)?.let { return StorageContract.fail("invalid-argument", it) }
        val value = prefs.getString(key, null) ?: return StorageContract.okNull()
        return StorageContract.okText(value)
    }

    private fun set(key: String, value: String): String {
        StorageContract.keyError(key)?.let { return StorageContract.fail("invalid-argument", it) }
        prefs.edit().putString(key, value).apply()
        return StorageContract.okNull()
    }

    private fun remove(key: String): String {
        StorageContract.keyError(key)?.let { return StorageContract.fail("invalid-argument", it) }
        prefs.edit().remove(key).apply()
        return StorageContract.okNull()
    }

    private fun keys(): String {
        val arr = JSONArray()
        prefs.all.keys.forEach { arr.put(it) }
        return JSONObject().put("ok", true).put("value", arr).toString()
    }
}

/**
 * The pure reply/guard vocabulary, split out for JVM tests (the
 * SharedPreferences path needs a device context and is verified by the
 * on-device journeys).
 */
internal object StorageContract {
    /** The contract mandates it: an empty key is invalid-argument (storage.ts). */
    fun keyError(key: String): String? = when {
        key.isEmpty() -> "key must not be blank"
        else -> null
    }

    fun okText(value: String): String =
        JSONObject().put("ok", true).put("value", value).toString()

    fun okNull(): String =
        JSONObject().put("ok", true).put("value", JSONObject.NULL).toString()

    fun fail(kind: String, message: String): String =
        JSONObject()
            .put("ok", false)
            .put("failure", JSONObject().put("kind", kind).put("message", message))
            .toString()
}

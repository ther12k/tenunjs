package id.my.tenun.embedder

import org.json.JSONObject

/** All text offsets are UTF-16 code-unit offsets, matching Android and JavaScript. */
data class TextInputSelection(val base: Int, val extent: Int)
data class TextInputComposition(val start: Int, val end: Int)
data class TextInputValue(
    val text: String,
    val selection: TextInputSelection,
    val composing: TextInputComposition?
)

/**
 * JSONObject escapes JSON syntax but may retain an unpaired UTF-16 surrogate.
 * Escape those code units before the JNI UTF-8 transport, as JSON.stringify
 * does, so even code-unit edits round-trip without codec normalization.
 */
fun textInputEventJson(value: JSONObject): String {
    val json = value.toString()
    val result = StringBuilder(json.length)
    var index = 0
    while (index < json.length) {
        val char = json[index]
        if (Character.isHighSurrogate(char) && index + 1 < json.length && Character.isLowSurrogate(json[index + 1])) {
            result.append(char).append(json[index + 1])
            index += 2
            continue
        }
        if (Character.isSurrogate(char)) result.append("\\u").append(char.code.toString(16).padStart(4, '0'))
        else result.append(char)
        index++
    }
    return result.toString()
}

/** Required, nonpainting display-list operation. Ordinary paint ops draw the field. */
data class TextInputDescriptor(
    val id: String,
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
    val text: String,
    val selection: TextInputSelection,
    val composing: TextInputComposition?,
    val focused: Boolean,
    val sessionId: Long,
    val revision: Long,
    val keyboardType: String,
    val returnAction: String,
    val readOnly: Boolean,
    val label: String,
    val fixed: Boolean = false,
    val anchor: String? = null,
    val anchorSize: Float? = null
) {
    fun value(): TextInputValue = TextInputValue(text, selection, composing)

    /** Only an exact acknowledgement can retain the IME's local composing state. */
    fun acknowledgesEdit(previous: TextInputDescriptor, proposed: TextInputValue): Boolean =
        focused && !readOnly && id == previous.id && sessionId == previous.sessionId &&
            revision == previous.revision + 1 && value() == proposed

    fun eventIdentity(): JSONObject = JSONObject()
        .put("id", id)
        .put("sessionId", sessionId)
        .put("baseRevision", revision)

    companion object {
        private const val MAX_SAFE_INTEGER = 9007199254740991L
        // ECMAScript trim whitespace, matching the framework identifier validator.
        private val BLANK_ID = Regex("^[\\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$")

        fun parse(json: JSONObject): TextInputDescriptor {
            fun invalid(message: String): Nothing = throw SceneContractException("text-input: $message")
            fun string(key: String): String = json.opt(key) as? String ?: invalid("$key must be a string")
            fun boolean(key: String): Boolean = json.opt(key) as? Boolean ?: invalid("$key must be a boolean")
            fun finite(key: String, nonnegative: Boolean = false): Float {
                val value = (json.opt(key) as? Number)?.toDouble() ?: invalid("$key must be a number")
                val result = value.toFloat()
                if (!value.isFinite() || !result.isFinite() || (nonnegative && value < 0)) {
                    invalid("$key must be finite${if (nonnegative) " and nonnegative" else ""}")
                }
                return result
            }
            fun integer(source: JSONObject, key: String, maximum: Long = MAX_SAFE_INTEGER): Long {
                val value = (source.opt(key) as? Number)?.toDouble() ?: invalid("$key must be an integer")
                if (!value.isFinite() || value < 0 || value > maximum.toDouble() || value % 1.0 != 0.0) {
                    invalid("$key must be an integer in [0, $maximum]")
                }
                return value.toLong()
            }

            if (string("op") != "text-input") invalid("op must be text-input")
            val id = string("id")
            if (BLANK_ID.matches(id)) invalid("id must not be empty")
            val text = string("text")
            if (text.contains('\r') || text.contains('\n')) invalid("single-line input cannot contain CR or LF")
            val selectionJson = json.opt("selection") as? JSONObject ?: invalid("selection must be an object")
            val selection = TextInputSelection(
                integer(selectionJson, "base", text.length.toLong()).toInt(),
                integer(selectionJson, "extent", text.length.toLong()).toInt()
            )
            if (!json.has("composing")) invalid("composing is required")
            val composing = if (json.isNull("composing")) null else {
                val range = json.opt("composing") as? JSONObject ?: invalid("composing must be an object or null")
                val start = integer(range, "start", text.length.toLong()).toInt()
                val end = integer(range, "end", text.length.toLong()).toInt()
                if (start >= end) invalid("composing must be a nonempty ordered range")
                TextInputComposition(start, end)
            }
            val focused = boolean("focused")
            val sessionId = integer(json, "sessionId")
            val revision = integer(json, "revision")
            val readOnly = boolean("readOnly")
            if (focused && (sessionId == 0L || readOnly)) invalid("focused input needs a writable positive session")
            if (!focused && (sessionId != 0L || revision != 0L || composing != null)) {
                invalid("unfocused input must have sessionId/revision zero and no composition")
            }
            val keyboardType = string("keyboardType")
            val returnAction = string("returnAction")
            if (keyboardType != "text" || returnAction != "done") invalid("unsupported keyboard type or return action")
            val fixed = if (json.has("fixed")) boolean("fixed") else false
            val anchor = if (json.has("anchor")) string("anchor") else null
            if (anchor != null && anchor != "bottom" && anchor != "center") invalid("unsupported anchor")
            return TextInputDescriptor(
                id, finite("x"), finite("y"), finite("w", true), finite("h", true),
                text, selection, composing, focused, sessionId, revision, keyboardType,
                returnAction, readOnly, string("label"), fixed, anchor,
                if (json.has("anchorSize")) finite("anchorSize", true) else null
            )
        }
    }
}

/**
 * Session ownership independent of Android UI classes, so lifecycle rules are
 * exercised on the JVM. A connection captures a token, never a mutable field ID.
 */
class TextInputSessionState {
    class Token internal constructor(
        internal val owner: Any,
        internal val generation: Long,
        val id: String,
        val sessionId: Long
    )

    private var owner: Any? = null
    private var generation = 0L
    var current: TextInputDescriptor? = null
        private set

    /** Returns true when previous connections must be closed and recreated. */
    fun adopt(owner: Any?, descriptor: TextInputDescriptor?, ownEdit: Boolean = false, forceRestart: Boolean = false): Boolean {
        val next = descriptor?.takeIf { owner != null && it.focused && !it.readOnly }
        val nextOwner = if (next == null) null else owner
        val old = current
        val identityChanged = this.owner !== nextOwner || old?.id != next?.id || old?.sessionId != next?.sessionId
        val editingChanged = old?.value() != next?.value() || old?.revision != next?.revision
        val restart = identityChanged || (!ownEdit && editingChanged) || (forceRestart && next != null)
        if (restart) generation++
        this.owner = nextOwner
        current = next
        return restart
    }

    fun token(): Token? {
        val active = current ?: return null
        return Token(owner ?: return null, generation, active.id, active.sessionId)
    }

    fun accepts(token: Token): Boolean = owner === token.owner && generation == token.generation &&
        current?.id == token.id && current?.sessionId == token.sessionId

    fun invalidate() {
        generation++
        owner = null
        current = null
    }
}

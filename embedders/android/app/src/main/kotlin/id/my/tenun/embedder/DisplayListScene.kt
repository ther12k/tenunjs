package id.my.tenun.embedder

import org.json.JSONObject

/**
 * Parsed display-list scene: the prototype contract used by the gallery
 * device bundle (embedders/android/tools/gallery-bundle). A scene is a flat
 * list of paint operations in design units plus tap hit regions whose
 * payloads index back into the JS callback table:
 *
 *   { "tenun": "display-list", "version": 1, "designWidth": 720,
 *     "contentHeight": 1800, "background": "#101014",
 *     "ops":  [ {op:"rect"|"outline"|"text", ...} ],
 *     "taps": [ {x,y,w,h, action:"tap", payload:{id:N}} ] }
 *
 * Compatibility contract (fail-closed): a scene whose `version` exceeds
 * [SUPPORTED_SCENE_VERSION], or that contains an unknown op kind, is a
 * contract violation and throws [SceneContractException] — the host keeps
 * its last committed scene instead of rendering a partial interface.
 * Unknown FIELDS are additive within a version (e.g. the anchored-overlay
 * metadata) and default off; a bundle using them needs a host from the
 * same tree, which is why the OTA boundary is JS application bundles only
 * (no DEX/JAR/native library updates; an APK update ships host changes).
 *
 * This is embedder-prototype glue, not the TN-034/TN-035 widget host
 * contract. Parsing returns null for anything that is not a display-list
 * scene, so the legacy notes-application path stays authoritative for
 * scenes that carry a "root" tree (TN-132 acceptance depends on it).
 */

/** A display-list scene this host cannot render whole: reject, never partially render. */
class SceneContractException(message: String) : Exception(message)

/** TN-169: a host-evaluated route transition request carried by one commit. */
data class SceneTransition(
    val kind: String,
    val durationMs: Long,
    val direction: String
)

/**
 * TN-179/ADR-0025: the accessibility semantics projection riding an
 * atomic scene commit. One node per semantically meaningful widget;
 * actions reference the SAME tap-run table touch uses (tapId → the
 * ordinary "tap"/"long-press" dispatch).
 */
data class SceneSemantics(
    val nodes: List<Node>
) {
    data class Node(
        val id: String,
        val role: String,
        val label: String?,
        val value: String?,
        val hint: String?,
        val focused: Boolean,
        val readOnly: Boolean,
        val disabled: Boolean,
        val x: Float,
        val y: Float,
        val w: Float,
        val h: Float,
        /** Action "press"/"focus" tap id (buttons, fields), if any. */
        val pressTapId: Int?,
        /** Action "long-press" tap id, if any. */
        val longPressTapId: Int?,
        /** Non-null when the node lives in this scroll region's CONTENT space. */
        val scroll: String?,
        val liveRegion: Boolean
    )
}

data class DisplayListScene(
    val designWidth: Float,
    val contentHeight: Float,
    val background: String,
    val ops: List<Op>,
    val taps: List<Tap>,
    /** TN-169: optional host-evaluated route transition; null on ordinary commits. */
    val transition: SceneTransition? = null,
    /** TN-179: optional semantics projection; null on pre-TN-179 scenes. */
    val semantics: SceneSemantics? = null
) {
    /** Absolute scene-space clipping, currently emitted for editor text only. */
    data class Clip(val x: Float, val y: Float, val w: Float, val h: Float)

    /** A filled or stroked rounded rectangle, with optional elevation. */
    data class Rect(
        val x: Float,
        val y: Float,
        val w: Float,
        val h: Float,
        val radius: Float,
        val color: String,
        val stroked: Boolean,
        val strokeWidth: Float,
        /** Gradient second stop; null means flat [color]. */
        val colorTo: String?,
        /** Elevation 0..24; 0 means no shadow. */
        val shadow: Float,
        /** Viewport-fixed operation metadata. */
        val fixed: Boolean = false,
        val anchor: String? = null,
        val anchorSize: Float? = null
    )

    /** A single line of text; [y] is the baseline. */
    data class Text(
        val x: Float,
        val y: Float,
        val text: String,
        val size: Float,
        val weight: Int,
        val color: String,
        val width: Float? = null,
        val align: String? = null,
        /** Viewport-fixed operation metadata. */
        val fixed: Boolean = false,
        val anchor: String? = null,
        val anchorSize: Float? = null,
        val clip: Clip? = null
    )

    sealed class Op {
        data class RectOp(val rect: Rect) : Op()
        data class TextOp(val text: Text) : Op()
        /** Required input-session metadata; visible content is separate paint ops. */
        data class TextInputOp(val input: TextInputDescriptor) : Op()
        data class CircleOp(
            val cx: Float,
            val cy: Float,
            val r: Float,
            val color: String,
            val fixed: Boolean = false,
            val anchor: String? = null,
            val anchorSize: Float? = null
        ) : Op()
        data class RingOp(
            val cx: Float,
            val cy: Float,
            val r: Float,
            val strokeWidth: Float,
            val color: String,
            /** 0..1 swept from 12 o'clock clockwise. */
            val progress: Float,
            val track: String?,
            val fixed: Boolean = false,
            val anchor: String? = null,
            val anchorSize: Float? = null
        ) : Op()
        data class LineOp(
            val x1: Float,
            val y1: Float,
            val x2: Float,
            val y2: Float,
            val color: String,
            val strokeWidth: Float,
            val fixed: Boolean = false,
            val anchor: String? = null,
            val anchorSize: Float? = null
        ) : Op()

        /**
         * TN-161 independent scroll region: a bounded viewport box whose
         * content laid out under an unbounded main axis. Children are in
         * the region's CONTENT space; the host scrolls by paint offset only.
         */
        data class ScrollRegionOp(
            val id: String,
            val x: Float,
            val y: Float,
            val w: Float,
            val h: Float,
            val contentHeight: Float,
            val ops: List<Op>
        ) : Op()
    }

    /**
     * TN-165: the focused, editable text-input descriptor — at the scene
     * root OR nested inside a scroll region's content ops (a TextField
     * inside a ScrollView). Root ops and nested content are walked in
     * paint order; the parser already rejects a second focused
     * descriptor anywhere in the scene, so this is discovery, not
     * arbitration. Read-only fields never adopt an editor session.
     */
    fun focusedEditableInput(): Op.TextInputOp? {
        for (op in ops) {
            when (op) {
                is Op.TextInputOp -> if (op.input.focused && !op.input.readOnly) return op
                is Op.ScrollRegionOp -> op.ops.mapNotNull { nested ->
                    if (nested is Op.TextInputOp && nested.input.focused && !nested.input.readOnly) nested else null
                }.firstOrNull()?.let { return it }
                else -> Unit
            }
        }
        return null
    }

    /** Hit region; [payloadJson] is sent back verbatim on dispatch. */
    data class Tap(
        val x: Float,
        val y: Float,
        val w: Float,
        val h: Float,
        val action: String,
        val payloadJson: String?,
        val fixed: Boolean = false,
        val anchor: String? = null,
        val anchorSize: Float? = null,
        /** TN-161: non-null when this region lives in that scroll region's CONTENT space. */
        val scroll: String? = null
    ) {
        fun contains(px: Float, py: Float, visibleHeight: Float, scrollY: Float): Boolean {
            val offset = if (!fixed || anchorSize == null) 0f else when (anchor) {
                "bottom" -> visibleHeight - anchorSize
                "center" -> (visibleHeight - anchorSize) / 2f
                else -> 0f
            }
            val targetY = if (fixed) y + offset else y - scrollY
            return px >= x && px <= x + w && py >= targetY && py <= targetY + h
        }
    }

    companion object {
        /** Scene `version` this host understands; higher versions are contract violations. */
        const val SUPPORTED_SCENE_VERSION = 1

        private fun textClip(op: JSONObject): Clip? {
            if (!op.has("clip")) return null
            val clip = op.opt("clip") as? JSONObject
                ?: throw SceneContractException("text clip must be an object")
            fun number(key: String, nonnegative: Boolean = false): Float {
                val value = (clip.opt(key) as? Number)?.toDouble()
                    ?: throw SceneContractException("text clip $key must be a number")
                val result = value.toFloat()
                if (!value.isFinite() || !result.isFinite() || (nonnegative && value < 0)) {
                    throw SceneContractException("text clip $key must be finite${if (nonnegative) " and nonnegative" else ""}")
                }
                return result
            }
            return Clip(number("x"), number("y"), number("w", true), number("h", true))
        }

        /**
         * TN-179: strict semantics parsing — once a scene DECLARES a
         * semantics block, a malformed node is a contract violation
         * (fail-visible, the ops rule); absent blocks (pre-TN-179 scenes)
         * parse to null and change nothing.
         */
        private fun parseSemantics(json: JSONObject?): SceneSemantics? {
            if (json == null) return null
            val version = json.optInt("semanticsVersion", 0)
            if (version != 1) {
                throw SceneContractException(
                    "scene semantics version $version exceeds host support (1); update the host APK"
                )
            }
            val nodesJson = json.optJSONArray("nodes")
                ?: throw SceneContractException("scene semantics is missing nodes")
            val nodes = ArrayList<SceneSemantics.Node>(nodesJson.length())
            val seenIds = HashSet<String>()
            for (i in 0 until nodesJson.length()) {
                val node = nodesJson.getJSONObject(i)
                val id = node.optString("id", "")
                if (id.isEmpty()) throw SceneContractException("semantic node ${i} is missing id")
                if (!seenIds.add(id)) {
                    throw SceneContractException("semantic node id \"$id\" appears more than once")
                }
                val role = node.optString("role", "")
                if (role.isEmpty()) throw SceneContractException("semantic node \"$id\" is missing role")
                var pressTapId: Int? = null
                var longPressTapId: Int? = null
                val actionsJson = node.optJSONArray("actions")
                if (actionsJson != null) {
                    for (a in 0 until actionsJson.length()) {
                        val action = actionsJson.getJSONObject(a)
                        val tapId = action.optInt("tapId", -1)
                        if (tapId < 0) {
                            throw SceneContractException("semantic node \"$id\" action is missing tapId")
                        }
                        when (action.optString("name")) {
                            "press", "focus" -> pressTapId = tapId
                            "long-press" -> longPressTapId = tapId
                            else -> throw SceneContractException(
                                "semantic node \"$id\" has unknown action \"${action.optString("name")}\""
                            )
                        }
                    }
                }
                val state = node.optJSONObject("state")
                val boundsJson = node.optJSONObject("bounds")
                    ?: throw SceneContractException("semantic node \"$id\" is missing bounds")
                fun geom(key: String): Float {
                    val v = boundsJson.optDouble(key, Double.NaN)
                    if (v.isNaN() || !v.isFinite()) {
                        throw SceneContractException("semantic node \"$id\" bounds.$key must be finite")
                    }
                    return v.toFloat()
                }
                nodes.add(
                    SceneSemantics.Node(
                        id = id,
                        role = role,
                        label = node.optString("label", "").ifEmpty { null },
                        value = node.optString("value", "").ifEmpty { null },
                        hint = node.optString("hint", "").ifEmpty { null },
                        focused = state?.optBoolean("focused", false) == true,
                        readOnly = state?.optBoolean("readOnly", false) == true,
                        disabled = state?.optBoolean("disabled", false) == true,
                        x = geom("x"), y = geom("y"), w = geom("w"), h = geom("h"),
                        pressTapId = pressTapId,
                        longPressTapId = longPressTapId,
                        scroll = if (node.has("scroll")) node.getString("scroll") else null,
                        liveRegion = node.optBoolean("liveRegion", false)
                    )
                )
            }
            return SceneSemantics(nodes)
        }

        fun parse(sceneJson: String): DisplayListScene? {
            // TN-140: once the scene DECLARES itself a display list, every
            // structural failure is a contract violation (thrown) — never a
            // quiet null, which made the host exit display-list mode and
            // fall back to the legacy notes screen, hiding the break. Null
            // stays reserved for scenes that are not display lists at all.
            var isDisplayList = false
            return try {
                val root = JSONObject(sceneJson)
                isDisplayList = root.optString("tenun") == "display-list"
                if (!isDisplayList) return null
                if (!root.has("ops")) {
                    throw SceneContractException("display-list scene is missing ops")
                }
                val version = root.optInt("version", 1)
                if (version > SUPPORTED_SCENE_VERSION) {
                    throw SceneContractException(
                        "scene version $version exceeds host support ($SUPPORTED_SCENE_VERSION); update the host APK"
                    )
                }
                val opsJson = root.getJSONArray("ops")
                val textInputIds = HashSet<String>()
                val hasFocused = booleanArrayOf(false)
                val ops = parseOpsArray(opsJson, textInputIds, hasFocused, "ops")
                val tapsJson = root.optJSONArray("taps")
                val taps = ArrayList<Tap>(tapsJson?.length() ?: 0)
                if (tapsJson != null) {
                    for (i in 0 until tapsJson.length()) {
                        val tap = tapsJson.getJSONObject(i)
                        val payload = tap.optJSONObject("payload")
                        taps.add(
                            Tap(
                                x = tap.optDouble("x", 0.0).toFloat(),
                                y = tap.optDouble("y", 0.0).toFloat(),
                                w = tap.optDouble("w", 0.0).toFloat(),
                                h = tap.optDouble("h", 0.0).toFloat(),
                                action = tap.optString("action", "tap"),
                                payloadJson = payload?.toString(),
                                fixed = tap.optBoolean("fixed", false),
                                anchor = if (tap.has("anchor")) tap.getString("anchor") else null,
                                anchorSize = if (tap.has("anchorSize")) tap.optDouble("anchorSize").toFloat() else null,
                                scroll = if (tap.has("scroll")) tap.getString("scroll") else null
                            )
                        )
                    }
                }
                DisplayListScene(
                    designWidth = root.optDouble("designWidth", 720.0).toFloat(),
                    contentHeight = root.optDouble("contentHeight", 0.0).toFloat(),
                    background = root.optString("background", "#101014"),
                    ops = ops,
                    taps = taps,
                    transition = parseTransition(root.optJSONObject("transition")),
                    semantics = parseSemantics(root.optJSONObject("semantics"))
                )
            } catch (e: SceneContractException) {
                // Contract violations must surface to the host, not fall
                // into the not-a-display-list null path.
                throw e
            } catch (e: Exception) {
                if (isDisplayList) {
                    // TN-140: a scene that declared itself a display list
                    // but failed mid-parse is incompatibility, not legacy.
                    throw SceneContractException(
                        "malformed display-list scene: ${e.message ?: e.javaClass.simpleName}"
                    )
                }
                null
            }
        }

        /**
         * TN-169: the optional host-evaluated route transition block.
         * Absent → null (pre-existing scenes unchanged); present-but-
         * malformed → contract violation, the same fail-visible rule as
         * every other declared field.
         */
        private fun parseTransition(block: JSONObject?): SceneTransition? {
            if (block == null) return null
            val kind = block.optString("kind")
            val direction = block.optString("direction")
            val durationMs = block.optDouble("durationMs", Double.NaN)
            if (kind != "slide" && kind != "fade") {
                throw SceneContractException("scene.transition has unknown kind \"$kind\"")
            }
            if (direction != "forward" && direction != "backward") {
                throw SceneContractException("scene.transition has unknown direction \"$direction\"")
            }
            if (durationMs.isNaN() || durationMs <= 0.0 || durationMs > 10_000.0) {
                throw SceneContractException("scene.transition durationMs must be a finite value in (0, 10000]")
            }
            return SceneTransition(kind, durationMs.toLong(), direction)
        }

        /**
         * Parses an ops array (scene root or a scroll region's children).
         * [textInputIds]/[hasFocused] accumulate across the WHOLE scene so
         * uniqueness and single-focus hold globally. Nested scroll regions
         * are a contract violation, not silently flattened.
         */
        private fun parseOpsArray(
            opsJson: org.json.JSONArray,
            textInputIds: MutableSet<String>,
            hasFocused: BooleanArray,
            at: String
        ): MutableList<Op> {
            val ops = ArrayList<Op>(opsJson.length())
            for (i in 0 until opsJson.length()) {
                val op = opsJson.getJSONObject(i)
                val where = "$at[$i]"
                when (op.optString("op")) {
                    "text-input" -> {
                        val input = TextInputDescriptor.parse(op)
                        if (!textInputIds.add(input.id)) {
                            throw SceneContractException("duplicate text-input id \"${input.id}\"")
                        }
                        if (input.focused && hasFocused[0]) {
                            throw SceneContractException("scene has more than one focused text-input")
                        }
                        hasFocused[0] = hasFocused[0] || input.focused
                        ops.add(Op.TextInputOp(input))
                    }
                    "rect", "outline", "gradient" -> ops.add(
                        Op.RectOp(
                            Rect(
                                x = op.optDouble("x", 0.0).toFloat(),
                                y = op.optDouble("y", 0.0).toFloat(),
                                w = op.optDouble("w", 0.0).toFloat(),
                                h = op.optDouble("h", 0.0).toFloat(),
                                radius = op.optDouble("r", 0.0).toFloat(),
                                color = op.optString("color", "#000000"),
                                stroked = op.optString("op") == "outline",
                                strokeWidth = op.optDouble("width", 3.0).toFloat(),
                                colorTo = if (op.has("colorTo")) op.getString("colorTo") else null,
                                shadow = op.optDouble("shadow", 0.0).toFloat(),
                                fixed = op.optBoolean("fixed", false),
                                anchor = if (op.has("anchor")) op.getString("anchor") else null,
                                anchorSize = if (op.has("anchorSize")) op.optDouble("anchorSize").toFloat() else null
                            )
                        )
                    )
                    "circle" -> ops.add(
                        Op.CircleOp(
                            cx = op.optDouble("cx", 0.0).toFloat(),
                            cy = op.optDouble("cy", 0.0).toFloat(),
                            r = op.optDouble("r", 0.0).toFloat(),
                            color = op.optString("color", "#000000"),
                            fixed = op.optBoolean("fixed", false),
                            anchor = if (op.has("anchor")) op.getString("anchor") else null,
                            anchorSize = if (op.has("anchorSize")) op.optDouble("anchorSize").toFloat() else null
                        )
                    )
                    "ring" -> ops.add(
                        Op.RingOp(
                            cx = op.optDouble("cx", 0.0).toFloat(),
                            cy = op.optDouble("cy", 0.0).toFloat(),
                            r = op.optDouble("r", 0.0).toFloat(),
                            strokeWidth = op.optDouble("width", 4.0).toFloat(),
                            color = op.optString("color", "#4C8DFF"),
                            progress = op.optDouble("progress", 0.0).toFloat(),
                            track = if (op.has("track")) op.getString("track") else null,
                            fixed = op.optBoolean("fixed", false),
                            anchor = if (op.has("anchor")) op.getString("anchor") else null,
                            anchorSize = if (op.has("anchorSize")) op.optDouble("anchorSize").toFloat() else null
                        )
                    )
                    "line" -> ops.add(
                        Op.LineOp(
                            x1 = op.optDouble("x1", 0.0).toFloat(),
                            y1 = op.optDouble("y1", 0.0).toFloat(),
                            x2 = op.optDouble("x2", 0.0).toFloat(),
                            y2 = op.optDouble("y2", 0.0).toFloat(),
                            color = op.optString("color", "#FFFFFF"),
                            strokeWidth = op.optDouble("width", 1.0).toFloat(),
                            fixed = op.optBoolean("fixed", false),
                            anchor = if (op.has("anchor")) op.getString("anchor") else null,
                            anchorSize = if (op.has("anchorSize")) op.optDouble("anchorSize").toFloat() else null
                        )
                    )
                    "text" -> ops.add(
                        Op.TextOp(
                            Text(
                                x = op.optDouble("x", 0.0).toFloat(),
                                y = op.optDouble("y", 0.0).toFloat(),
                                text = op.optString("text", ""),
                                size = op.optDouble("size", 16.0).toFloat(),
                                weight = op.optInt("weight", 400),
                                color = op.optString("color", "#FFFFFF"),
                                width = if (op.has("width")) op.optDouble("width").toFloat() else null,
                                align = if (op.has("align")) op.getString("align") else null,
                                fixed = op.optBoolean("fixed", false),
                                anchor = if (op.has("anchor")) op.getString("anchor") else null,
                                anchorSize = if (op.has("anchorSize")) op.optDouble("anchorSize").toFloat() else null,
                                clip = textClip(op)
                            )
                        )
                    )
                    "scroll-region" -> {
                        val id = op.optString("id", "")
                        if (id.isEmpty()) {
                            throw SceneContractException("scroll region at $where has no id")
                        }
                        if (at != "ops") {
                            throw SceneContractException("nested scroll regions are not supported (\"$id\" at $where)")
                        }
                        val children = op.optJSONArray("ops")
                            ?: throw SceneContractException("scroll region \"$id\" ops is not an array")
                        ops.add(
                            Op.ScrollRegionOp(
                                id = id,
                                x = op.optDouble("x", 0.0).toFloat(),
                                y = op.optDouble("y", 0.0).toFloat(),
                                w = op.optDouble("w", 0.0).toFloat(),
                                h = op.optDouble("h", 0.0).toFloat(),
                                contentHeight = op.optDouble("contentHeight", 0.0).toFloat(),
                                ops = parseOpsArray(children, textInputIds, hasFocused, "$where.scroll-region[$id]")
                            )
                        )
                    }
                    // Fail-closed: an op kind this host does not know
                    // means the bundle is newer than the host. Skipping
                    // it would render a partially functional interface,
                    // so the whole scene is rejected instead.
                    else -> throw SceneContractException(
                        "unknown op kind \"${op.optString("op")}\" at $where; update the host APK"
                    )
                }
            }
            return ops
        }
    }
}

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
data class DisplayListScene(
    val designWidth: Float,
    val contentHeight: Float,
    val background: String,
    val ops: List<Op>,
    val taps: List<Tap>
) {
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
        /** Viewport-fixed operation metadata. */
        val fixed: Boolean = false,
        val anchor: String? = null,
        val anchorSize: Float? = null
    )

    sealed class Op {
        data class RectOp(val rect: Rect) : Op()
        data class TextOp(val text: Text) : Op()
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
        val anchorSize: Float? = null
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

        fun parse(sceneJson: String): DisplayListScene? {
            return try {
                val root = JSONObject(sceneJson)
                if (root.optString("tenun") != "display-list") return null
                if (!root.has("ops")) return null
                val version = root.optInt("version", 1)
                if (version > SUPPORTED_SCENE_VERSION) {
                    throw SceneContractException(
                        "scene version $version exceeds host support ($SUPPORTED_SCENE_VERSION); update the host APK"
                    )
                }
                val opsJson = root.getJSONArray("ops")
                val ops = ArrayList<Op>(opsJson.length())
                for (i in 0 until opsJson.length()) {
                    val op = opsJson.getJSONObject(i)
                    when (op.optString("op")) {
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
                                    fixed = op.optBoolean("fixed", false),
                                    anchor = if (op.has("anchor")) op.getString("anchor") else null,
                                    anchorSize = if (op.has("anchorSize")) op.optDouble("anchorSize").toFloat() else null
                                )
                            )
                        )
                        // Fail-closed: an op kind this host does not know
                        // means the bundle is newer than the host. Skipping
                        // it would render a partially functional interface,
                        // so the whole scene is rejected instead.
                        else -> throw SceneContractException(
                            "unknown op kind \"${op.optString("op")}\" at ops[$i]; update the host APK"
                        )
                    }
                }
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
                                anchorSize = if (tap.has("anchorSize")) tap.optDouble("anchorSize").toFloat() else null
                            )
                        )
                    }
                }
                DisplayListScene(
                    designWidth = root.optDouble("designWidth", 720.0).toFloat(),
                    contentHeight = root.optDouble("contentHeight", 0.0).toFloat(),
                    background = root.optString("background", "#101014"),
                    ops = ops,
                    taps = taps
                )
            } catch (e: SceneContractException) {
                // Contract violations must surface to the host, not fall
                // into the not-a-display-list null path.
                throw e
            } catch (e: Exception) {
                null
            }
        }
    }
}

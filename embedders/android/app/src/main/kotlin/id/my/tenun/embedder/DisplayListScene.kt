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
 * This is embedder-prototype glue, not the TN-034/TN-035 widget host
 * contract. Parsing returns null for anything that is not a display-list
 * scene, so the legacy notes-application path stays authoritative for
 * scenes that carry a "root" tree (TN-132 acceptance depends on it).
 */
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
        val shadow: Float
    )

    /** A single line of text; [y] is the baseline. */
    data class Text(
        val x: Float,
        val y: Float,
        val text: String,
        val size: Float,
        val weight: Int,
        val color: String
    )

    sealed class Op {
        data class RectOp(val rect: Rect) : Op()
        data class TextOp(val text: Text) : Op()
        data class CircleOp(val cx: Float, val cy: Float, val r: Float, val color: String) : Op()
        data class RingOp(
            val cx: Float,
            val cy: Float,
            val r: Float,
            val strokeWidth: Float,
            val color: String,
            /** 0..1 swept from 12 o'clock clockwise. */
            val progress: Float,
            val track: String?
        ) : Op()
        data class LineOp(
            val x1: Float,
            val y1: Float,
            val x2: Float,
            val y2: Float,
            val color: String,
            val strokeWidth: Float
        ) : Op()
    }

    /** Hit region; [payloadJson] is sent back verbatim on dispatch. */
    data class Tap(
        val x: Float,
        val y: Float,
        val w: Float,
        val h: Float,
        val action: String,
        val payloadJson: String?
    ) {
        fun contains(px: Float, py: Float): Boolean =
            px >= x && px <= x + w && py >= y && py <= y + h
    }

    companion object {
        fun parse(sceneJson: String): DisplayListScene? {
            return try {
                val root = JSONObject(sceneJson)
                if (root.optString("tenun") != "display-list") return null
                if (!root.has("ops")) return null
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
                                    shadow = op.optDouble("shadow", 0.0).toFloat()
                                )
                            )
                        )
                        "circle" -> ops.add(
                            Op.CircleOp(
                                cx = op.optDouble("cx", 0.0).toFloat(),
                                cy = op.optDouble("cy", 0.0).toFloat(),
                                r = op.optDouble("r", 0.0).toFloat(),
                                color = op.optString("color", "#000000")
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
                                track = if (op.has("track")) op.getString("track") else null
                            )
                        )
                        "line" -> ops.add(
                            Op.LineOp(
                                x1 = op.optDouble("x1", 0.0).toFloat(),
                                y1 = op.optDouble("y1", 0.0).toFloat(),
                                x2 = op.optDouble("x2", 0.0).toFloat(),
                                y2 = op.optDouble("y2", 0.0).toFloat(),
                                color = op.optString("color", "#FFFFFF"),
                                strokeWidth = op.optDouble("width", 1.0).toFloat()
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
                                    color = op.optString("color", "#FFFFFF")
                                )
                            )
                        )
                        // Unknown op kinds are skipped, not fatal: the
                        // display list is a forward-compatible paint stream.
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
                                payloadJson = payload?.toString()
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
            } catch (e: Exception) {
                null
            }
        }
    }
}

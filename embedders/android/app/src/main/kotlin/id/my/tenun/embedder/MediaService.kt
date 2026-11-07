package id.my.tenun.embedder

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.TextureView
import android.view.ViewGroup
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * TN-193 (ADR-0028): the "media" NativeService. One Media3 ExoPlayer
 * per host with HLS support, an opaque TextureView video surface layered
 * over TenunSurfaceView (positioned by setRect in design units, hidden
 * until the first rendered frame), MEDIA_STATE event push through the
 * established native→JS event funnel, and a bounded async fetchText so
 * bundles can load playlists before the net capability (TN-188) lands.
 *
 * Wire shape: every invoke replies with the CapabilityResult JSON the
 * TS contract mirrors (`{"ok":true,"value":…}` / `{"ok":false,
 * "failure":{"kind":…,"message":…}}`). Player mutations are issued on
 * the main thread; state changes come back asynchronously as
 * MEDIA_STATE actions — the same command/event split the BLE service
 * uses. No display-list protocol op is added: the rect is opaque and
 * the scene composes AROUND it (ADR-0017-lite; full platform-view
 * composition stays with TN-094).
 *
 * fetchText is an async ticket by necessity: a blocking GET on the
 * engine's dispatch thread would blow the 5 s JS entry budget. The
 * invoke replies `{"ok":true,"value":{"ticket":N}}` and completion
 * arrives as a MEDIA_TEXT event `{ticket, ok, text|message}`; the TS
 * glue resolves the fetchText promise from it.
 */
class MediaService(
    private val context: Context,
    private val onEvent: (action: String, payloadJson: String) -> Unit,
    private val textureView: TextureView,
    /** Design-unit → pixel scale of the committed scene (TenunSurfaceView). */
    private val designScale: () -> Float,
) : NativeService {

    companion object {
        private const val TAG = "MediaService"

        /** media.md fetchText bounds — stopgap until TN-188 supersedes it. */
        const val FETCH_TIMEOUT_MS = 10_000
        const val FETCH_MAX_BYTES = 2 * 1024 * 1024

        /**
         * Derives the contract's state string. "ready" (prepared, never
         * played) vs "paused" (played, then paused) cannot be read from
         * Player alone — both look like READY + playWhenReady=false — so
         * [hasPlayed] disambiguates: the service sets it on the first
         * playing observation and clears it on prepare/stop.
         */
        fun deriveState(
            previous: String,
            playbackState: Int,
            isPlaying: Boolean,
            playWhenReady: Boolean,
            error: Boolean,
            hasPlayed: Boolean,
        ): String = when {
            error -> "error"
            isPlaying -> "playing"
            playbackState == Player.STATE_BUFFERING -> "buffering"
            playbackState == Player.STATE_ENDED -> "ended"
            playbackState == Player.STATE_IDLE -> "idle"
            // STATE_READY: playing is about to start; otherwise paused
            // only if this item actually played before, else freshly
            // prepared.
            else -> when {
                playWhenReady -> "playing"
                hasPlayed || previous == "playing" || previous == "paused" -> "paused"
                else -> "ready"
            }
        }

        /** http(s) only — the content boundary's player, not a browser. */
        fun urlError(url: String): String? = when {
            url.isBlank() -> "url must not be blank"
            !url.startsWith("http://", ignoreCase = true) &&
                !url.startsWith("https://", ignoreCase = true) -> "url must be http(s)"
            else -> null
        }

        /**
         * Textual responses only (media.md), where "textual" includes the
         * playlist MIME family — servers label .m3u8 audio/x-mpegurl far
         * more often than text/plain, and playlists are fetchText's only
         * user. Binary media types stay refused.
         */
        fun isTextualContentType(type: String?): Boolean {
            if (type.isNullOrBlank()) return true // servers omit it; bytes are bounded either way
            val t = type.substringBefore(';').trim().lowercase()
            return t.startsWith("text/") ||
                t == "application/xml" ||
                t.endsWith("mpegurl") ||
                // Playlist endpoints frequently label .m3u8 octet-stream;
                // the 2 MB bound keeps whatever arrives harmless.
                t == "application/octet-stream"
        }

        /** Positive-finite rect check for setRect (design units). */
        fun rectError(x: Double, y: Double, w: Double, h: Double): String? = when {
            w <= 0 || h <= 0 -> "rect size must be positive"
            x < 0 || y < 0 -> "rect origin must be non-negative"
            else -> null
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val fetchExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "tenun-media-fetch").apply { isDaemon = true }
    }
    private val ticketSeq = AtomicLong(0)

    /** Main-thread confined player state (ExoPlayer is same-thread); the
     *  @Volatile fields are also read cross-thread by invoke's null-checks
     *  and statusJson() from the engine's dispatch thread. */
    @Volatile private var player: ExoPlayer? = null
    @Volatile private var currentUrl: String? = null
    @Volatile private var derivedState = "idle"
    /** True once the current item has actually played (media.md's
     *  ready/paused split); main-thread confined, cleared on prepare/stop. */
    private var hasPlayed = false
    private var pendingRect: Rect4? = null

    /** Design-unit rect as last set by the app (TN-193 setRect). */
    data class Rect4(val x: Float, val y: Float, val w: Float, val h: Float)

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            val p = player ?: return
            updateState(
                deriveState(derivedState, playbackState, p.isPlaying, p.playWhenReady, error = false, hasPlayed = hasPlayed)
            )
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            val p = player ?: return
            if (isPlaying) hasPlayed = true
            updateState(
                deriveState(derivedState, p.playbackState, isPlaying, p.playWhenReady, error = false, hasPlayed = hasPlayed)
            )
        }

        override fun onPlayerError(error: PlaybackException) {
            updateState(
                deriveState(derivedState, Player.STATE_IDLE, false, false, error = true, hasPlayed = hasPlayed),
                message = error.message,
            )
        }

        override fun onRenderedFirstFrame() {
            // ADR-0028: the video surface stays GONE until real pixels
            // exist — never a black hole over the scene.
            mainHandler.post {
                if (pendingRect != null) textureView.visibility = android.view.View.VISIBLE
            }
        }
    }

    override fun invoke(method: String, payloadJson: String): String? {
        return when (method) {
            "prepare" -> prepare(payloadJson)
            "play" -> playPause(play = true)
            "pause" -> playPause(play = false)
            "stop" -> stop()
            "setRect" -> setRect(payloadJson)
            "status" -> statusJson()
            "fetchText" -> fetchText(payloadJson)
            else -> null
        }
    }

    private fun ok(value: JSONObject): String = JSONObject().put("ok", true).put("value", value).toString()

    private fun okNull(): String = JSONObject().put("ok", true).put("value", JSONObject.NULL).toString()

    private fun fail(kind: String, message: String): String =
        JSONObject()
            .put("ok", false)
            .put("failure", JSONObject().put("kind", kind).put("message", message))
            .toString()

    private fun prepare(payloadJson: String): String {
        val url = try {
            JSONObject(payloadJson).optString("url", "")
        } catch (e: Exception) {
            return fail("invalid-argument", "payload must be {url}")
        }
        urlError(url)?.let { return fail("invalid-argument", it) }
        mainHandler.post {
            // One player per host: prepare releases any previous item
            // (media.md) and hides the surface until the next first frame.
            val p = player ?: ExoPlayer.Builder(context).build().also {
                player = it
                it.addListener(listener)
                it.setVideoTextureView(textureView)
            }
            p.setMediaItem(MediaItem.fromUri(url))
            p.playWhenReady = false
            p.prepare()
            currentUrl = url
            hasPlayed = false
            textureView.visibility = android.view.View.GONE
            applyPendingRect()
            updateState("buffering")
        }
        return ok(JSONObject().put("state", "buffering").put("url", url))
    }

    private fun playPause(play: Boolean): String {
        val p = player ?: return fail("unavailable", "no media prepared")
        mainHandler.post {
            p.playWhenReady = play
        }
        return statusJson()
    }

    private fun stop(): String {
        val p = player ?: return fail("unavailable", "no media prepared")
        mainHandler.post {
            p.stop()
            p.clearMediaItems()
            currentUrl = null
            hasPlayed = false
            textureView.visibility = android.view.View.GONE
            updateState("idle")
        }
        return ok(JSONObject().put("state", "idle"))
    }

    private fun setRect(payloadJson: String): String {
        val json = try {
            JSONObject(payloadJson)
        } catch (e: Exception) {
            return fail("invalid-argument", "payload must be {x,y,w,h}")
        }
        val x = json.optDouble("x", Double.NaN)
        val y = json.optDouble("y", Double.NaN)
        val w = json.optDouble("w", Double.NaN)
        val h = json.optDouble("h", Double.NaN)
        if (x.isNaN() || y.isNaN() || w.isNaN() || h.isNaN()) {
            return fail("invalid-argument", "payload must be {x,y,w,h}")
        }
        rectError(x, y, w, h)?.let { return fail("invalid-argument", it) }
        val rect = Rect4(x.toFloat(), y.toFloat(), w.toFloat(), h.toFloat())
        pendingRect = rect
        mainHandler.post { applyPendingRect() }
        return okNull()
    }

    /** Applies the pending design-unit rect as pixel frame margins on the
     *  overlay. Takes effect on the next layout pass (media.md). */
    private fun applyPendingRect() {
        val rect = pendingRect ?: return
        val scale = designScale()
        val lp = textureView.layoutParams
        if (lp is ViewGroup.MarginLayoutParams) {
            lp.width = (rect.w * scale).toInt().coerceAtLeast(1)
            lp.height = (rect.h * scale).toInt().coerceAtLeast(1)
            lp.leftMargin = (rect.x * scale).toInt()
            lp.topMargin = (rect.y * scale).toInt()
            textureView.layoutParams = lp
        } else {
            Log.w(TAG, "textureView has no margin layout params; rect not applied")
        }
    }

    private fun statusJson(): String {
        val value = JSONObject().put("state", derivedState)
        currentUrl?.let { value.put("url", it) }
        return ok(value)
    }

    private fun updateState(state: String, message: String? = null) {
        if (state == derivedState) return
        derivedState = state
        val payload = JSONObject()
            .put("type", "MEDIA_STATE")
            .put("state", state)
        currentUrl?.let { payload.put("url", it) }
        // media.md: error detail rides the event when state === "error".
        message?.let { payload.put("message", it) }
        onEvent("MEDIA_STATE", payload.toString())
    }

    private fun fetchText(payloadJson: String): String {
        val url = try {
            JSONObject(payloadJson).optString("url", "")
        } catch (e: Exception) {
            return fail("invalid-argument", "payload must be {url}")
        }
        urlError(url)?.let { return fail("invalid-argument", it) }
        val ticket = ticketSeq.incrementAndGet()
        fetchExecutor.execute {
            val completion = try {
                fetchTextBlocking(url, ticket)
            } catch (e: Exception) {
                JSONObject().put("ticket", ticket).put("ok", false).put("message", e.message ?: "fetch failed")
            }
            onEvent("MEDIA_TEXT", completion.toString())
        }
        return ok(JSONObject().put("ticket", ticket))
    }

    /** Blocking GET — runs on the fetch executor, never the engine thread. */
    private fun fetchTextBlocking(url: String, ticket: Long): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = FETCH_TIMEOUT_MS
        connection.readTimeout = FETCH_TIMEOUT_MS
        connection.requestMethod = "GET"
        try {
            val code = connection.responseCode
            if (code !in 200..299) {
                return JSONObject().put("ticket", ticket)
                    .put("ok", false).put("message", "HTTP $code")
            }
            val contentType = connection.getHeaderField("Content-Type")
            if (!isTextualContentType(contentType)) {
                return JSONObject().put("ticket", ticket)
                    .put("ok", false).put("message", "not a text response: $contentType")
            }
            val bytes = connection.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(16 * 1024)
                var total = 0
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    total += n
                    if (total > FETCH_MAX_BYTES) {
                        return JSONObject().put("ticket", ticket)
                            .put("ok", false).put("message", "response exceeds ${FETCH_MAX_BYTES} bytes")
                    }
                    out.write(buf, 0, n)
                }
                out.toByteArray()
            }
            val text = String(bytes, Charsets.UTF_8)
            return JSONObject().put("ticket", ticket).put("ok", true).put("text", text)
        } finally {
            connection.disconnect()
        }
    }

    /** Releases the player and the fetch executor; call from onDestroy. */
    fun release() {
        mainHandler.post {
            player?.release()
            player = null
        }
        fetchExecutor.shutdownNow()
    }
}

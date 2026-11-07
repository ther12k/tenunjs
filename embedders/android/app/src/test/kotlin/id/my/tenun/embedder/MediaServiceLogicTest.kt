package id.my.tenun.embedder

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * TN-193: pure-logic coverage for the media host service's companion
 * helpers — the state machine the contract's seven-state vocabulary
 * maps onto, the fetch/URL boundaries media.md freezes, and the rect
 * validation. The ExoPlayer surface itself is device-gated
 * (MediaServicePlaybackTest, ADR-0019 evidence).
 */
class MediaServiceLogicTest {

    private fun derive(
        previous: String,
        state: Int,
        isPlaying: Boolean = false,
        playWhenReady: Boolean = false,
        error: Boolean = false,
        hasPlayed: Boolean = false,
    ): String = MediaService.deriveState(previous, state, isPlaying, playWhenReady, error, hasPlayed)

    @Test
    fun `prepare reaches ready without playing`() {
        assertEquals("buffering", derive("idle", Player.STATE_BUFFERING))
        // Freshly prepared: READY + not playing + never played = ready.
        assertEquals("ready", derive("buffering", Player.STATE_READY, playWhenReady = false, hasPlayed = false))
    }

    @Test
    fun `play and pause distinguish themselves through the previous state`() {
        assertEquals("playing", derive("ready", Player.STATE_READY, playWhenReady = true))
        assertEquals("playing", derive("playing", Player.STATE_READY, isPlaying = true, playWhenReady = true))
        assertEquals("paused", derive("playing", Player.STATE_READY, playWhenReady = false, hasPlayed = true))
        // Re-buffering while paused lands back on paused, not ready —
        // the same READY + !playWhenReady shape as a fresh prepare, so
        // hasPlayed (not `previous`) is what tells the cases apart.
        assertEquals("buffering", derive("paused", Player.STATE_BUFFERING))
        assertEquals("paused", derive("buffering", Player.STATE_READY, playWhenReady = false, hasPlayed = true))
    }

    @Test
    fun `ended, idle, and error are terminal reads`() {
        assertEquals("ended", derive("playing", Player.STATE_ENDED))
        assertEquals("idle", derive("ended", Player.STATE_IDLE))
        assertEquals("error", derive("playing", Player.STATE_READY, error = true, hasPlayed = true))
    }

    @Test
    fun `urls must be non-blank http(s)`() {
        assertNull(MediaService.urlError("https://example.invalid/live.m3u8"))
        assertNull(MediaService.urlError("http://example.invalid/list.m3u"))
        assertEquals("url must not be blank", MediaService.urlError(""))
        assertEquals("url must not be blank", MediaService.urlError("   "))
        assertEquals("url must be http(s)", MediaService.urlError("ftp://example.invalid/x"))
        assertEquals("url must be http(s)", MediaService.urlError("file:///data/local/tmp/x.m3u8"))
    }

    @Test
    fun `textual content types include the playlist MIME family, never binary media`() {
        assertTrue(MediaService.isTextualContentType("text/plain"))
        assertTrue(MediaService.isTextualContentType("text/plain; charset=utf-8"))
        assertTrue(MediaService.isTextualContentType("application/xml"))
        assertTrue(MediaService.isTextualContentType("application/vnd.apple.mpegurl"))
        assertTrue(MediaService.isTextualContentType("audio/x-mpegurl"))
        assertTrue(MediaService.isTextualContentType("APPLICATION/OCTET-STREAM"))
        assertTrue(MediaService.isTextualContentType(null))
        assertFalse(MediaService.isTextualContentType("video/mp2t"))
        assertFalse(MediaService.isTextualContentType("image/png"))
    }

    @Test
    fun `fetch bounds match the frozen contract`() {
        assertEquals(10_000, MediaService.FETCH_TIMEOUT_MS)
        assertEquals(2 * 1024 * 1024, MediaService.FETCH_MAX_BYTES)
    }

    @Test
    fun `rects must be positive-sized and non-negative-origin`() {
        assertNull(MediaService.rectError(0.0, 0.0, 320.0, 180.0))
        assertNull(MediaService.rectError(16.0, 16.0, 288.0, 162.0))
        assertEquals("rect size must be positive", MediaService.rectError(0.0, 0.0, 0.0, 180.0))
        assertEquals("rect size must be positive", MediaService.rectError(0.0, 0.0, 320.0, -1.0))
        assertEquals("rect origin must be non-negative", MediaService.rectError(-1.0, 0.0, 320.0, 180.0))
        assertEquals("rect origin must be non-negative", MediaService.rectError(0.0, -0.5, 320.0, 180.0))
    }
}

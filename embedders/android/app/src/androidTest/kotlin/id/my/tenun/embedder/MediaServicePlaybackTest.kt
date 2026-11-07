package id.my.tenun.embedder

import android.os.SystemClock
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * TN-193 (ADR-0028): the media host service against the REAL Media3
 * player stack on a booted device/emulator — prepare/play/stop through
 * the host-call seam, MEDIA_STATE events through the service's event
 * funnel, and the overlay TextureView compositing contract (GONE until
 * the first frame, positioned by setRect, released by stop). The
 * physical Mi TV evidence run (ADR-0019) replays exactly this journey.
 *
 * Stream: the public mux HLS test stream (TN-196's development stream).
 */
@RunWith(AndroidJUnit4::class)
class MediaServicePlaybackTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private val states = java.util.Collections.synchronizedList(mutableListOf<String>())

    private var scenario: ActivityScenario<MainActivity>? = null
    private var service: MediaService? = null
    private var textureView: TextureView? = null

    @After
    fun tearDown() {
        service?.release()
        service = null
        scenario?.close()
    }

    private fun awaitState(vararg expected: String, timeoutMs: Long = 30_000) {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            if (states.any { it in expected }) return
            SystemClock.sleep(200)
        }
        error("MEDIA_STATE ${expected.toList()} never arrived; saw $states")
    }

    @Test
    fun preparePlayStopJourneysThroughMediaState() {
        scenario = ActivityScenario.launch(MainActivity::class.java)

        scenario!!.onActivity { activity ->
            val tv = TextureView(activity).apply { visibility = View.GONE }
            textureView = tv
            activity.addContentView(
                tv,
                android.widget.FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
            service = MediaService(
                activity,
                { action, payloadJson ->
                    if (action == "MEDIA_STATE") {
                        states.add(JSONObject(payloadJson).optString("state"))
                    }
                },
                tv,
                { 1f },
            )
        }

        val media = service!!

        // Position the overlay first (design units; px scale 1 here).
        val rectReply = JSONObject(media.invoke("setRect", """{"x":16,"y":16,"w":288,"h":162}""")!!)
        assertTrue(rectReply.optBoolean("ok"))

        // Ops before prepare fail closed with a message, never throw.
        val earlyPlay = JSONObject(media.invoke("play", "{}")!!)
        assertEquals(false, earlyPlay.optBoolean("ok"))
        assertEquals("unavailable", earlyPlay.getJSONObject("failure").getString("kind"))

        val prepareReply = JSONObject(
            media.invoke("prepare", """{"url":"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"}""")!!
        )
        assertTrue("prepare reply: $prepareReply", prepareReply.optBoolean("ok"))
        assertEquals("buffering", prepareReply.getJSONObject("value").getString("state"))

        awaitState("ready")
        instrumentation.runOnMainSync { assertEquals("ready", JSONObject(media.invoke("status", "{}")!!).getJSONObject("value").getString("state")) }

        assertTrue(JSONObject(media.invoke("play", "{}")!!).optBoolean("ok"))
        awaitState("playing")

        // The overlay surfaces only once real pixels exist (first frame).
        instrumentation.runOnMainSync {
            assertEquals(View.VISIBLE, textureView!!.visibility)
        }

        assertTrue(JSONObject(media.invoke("stop", "{}")!!).optBoolean("ok"))
        awaitState("idle")
        instrumentation.runOnMainSync {
            assertEquals(View.GONE, textureView!!.visibility)
        }
    }
}

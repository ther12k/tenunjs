package id.my.tenun.embedder

import android.view.KeyEvent
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * TN-194: the generic KEY dispatch exclusion list and payload shape.
 * The list is policy, not accident — every excluded key has an owner
 * (BACK: the host's BACK action protocol; VOLUME_*: the system volume
 * UX), and every non-excluded key must reach the runtime as
 * {keyCode, phase} once the IME path declines it.
 */
class KeyDispatchPolicyTest {

    @Test
    fun `BACK and volume keys are excluded — their owners keep them`() {
        assertTrue(KeyDispatchPolicy.isExcluded(KeyEvent.KEYCODE_BACK))
        assertTrue(KeyDispatchPolicy.isExcluded(KeyEvent.KEYCODE_VOLUME_UP))
        assertTrue(KeyDispatchPolicy.isExcluded(KeyEvent.KEYCODE_VOLUME_DOWN))
        assertTrue(KeyDispatchPolicy.isExcluded(KeyEvent.KEYCODE_VOLUME_MUTE))
    }

    @Test
    fun `D-pad, remote, and typing keys dispatch`() {
        for (code in intArrayOf(
            KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN,
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_MENU,
            KeyEvent.KEYCODE_HOME, // system keeps HOME, but the runtime still sees it fail-open
            KeyEvent.KEYCODE_PAGE_UP,
            KeyEvent.KEYCODE_ESCAPE,
        )) {
            assertFalse("keyCode $code must dispatch", KeyDispatchPolicy.isExcluded(code))
        }
    }

    @Test
    fun `the payload carries keyCode and phase verbatim`() {
        val down = JSONObject(KeyDispatchPolicy.payload(KeyEvent.KEYCODE_DPAD_CENTER, "down"))
        assertEquals(KeyEvent.KEYCODE_DPAD_CENTER, down.getInt("keyCode"))
        assertEquals("down", down.getString("phase"))

        val up = JSONObject(KeyDispatchPolicy.payload(999, "up"))
        assertEquals(999, up.getInt("keyCode"))
        assertEquals("up", up.getString("phase"))
    }
}

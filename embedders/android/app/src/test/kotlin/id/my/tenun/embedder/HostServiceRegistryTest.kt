package id.my.tenun.embedder

import org.junit.Assert.*
import org.junit.Test

class HostServiceRegistryTest {

    @Test
    fun testHostServiceRegistryDispatch() {
        val registry = HostServiceRegistry()
        var called = false

        registry.register("ble", object : NativeService {
            override fun invoke(method: String, payloadJson: String): String {
                called = true
                assertEquals("write", method)
                assertTrue(payloadJson.contains("STOP"))
                return "{\"ok\":true}"
            }
        })

        val result = registry.onHostCall("ble", "write", "{\"cmd\":\"STOP\"}")
        assertTrue(called)
        assertEquals("{\"ok\":true}", result)

        val missing = registry.onHostCall("unknown", "method", "{}")
        assertNull(missing)

        registry.unregister("ble")
        val unregistered = registry.onHostCall("ble", "write", "{}")
        assertNull(unregistered)
    }

    @Test
    fun testHostServiceCatchesExceptionsSafely() {
        val registry = HostServiceRegistry()
        registry.register("failing", object : NativeService {
            override fun invoke(method: String, payloadJson: String): String {
                throw SecurityException("simulated permission denial")
            }
        })

        // Must catch cleanly and return null instead of letting exception escape to JNI
        val result = registry.onHostCall("failing", "any", "{}")
        assertNull(result)
    }

    @Test
    fun testBleWriteQueuePurgesOnEmergencyStop() {
        var queueRef: java.util.ArrayDeque<String>? = null
        val service = object : NativeService {
            val queue = java.util.ArrayDeque<String>()
            init { queueRef = queue }
            override fun invoke(method: String, payloadJson: String): String {
                if (method == "write") {
                    val cmd = org.json.JSONObject(payloadJson).optString("cmd", "")
                    if (cmd == "STOP") {
                        queue.clear()
                        queue.addFirst(cmd)
                    } else {
                        queue.addLast(cmd)
                    }
                    return "true"
                }
                return "false"
            }
        }
        val registry = HostServiceRegistry()
        registry.register("ble", service)

        registry.onHostCall("ble", "write", """{"cmd":"WASH"}""")
        registry.onHostCall("ble", "write", """{"cmd":"SPIN"}""")
        assertEquals(2, queueRef?.size)
        assertEquals("WASH", queueRef?.peekFirst())

        registry.onHostCall("ble", "write", """{"cmd":"STOP"}""")
        assertEquals(1, queueRef?.size)
        assertEquals("STOP", queueRef?.peekFirst())
    }
}

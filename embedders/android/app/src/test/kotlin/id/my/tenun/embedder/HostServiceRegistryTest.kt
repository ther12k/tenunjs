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
}

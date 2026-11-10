package id.my.tenun.embedder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * TN-196: the storage contract's pure vocabulary (key guard + reply JSON
 * shapes). The SharedPreferences path itself needs a device context and is
 * covered by the on-device favorites-persist journey. Replies are asserted
 * as strings — org.json is an Android stub, absent from the JVM test
 * classpath (MediaServiceLogicTest's pattern: pure helpers only).
 */
class StorageServiceLogicTest {

    @Test
    fun `blank keys are invalid-argument per the storage contract`() {
        assertEquals("key must not be blank", StorageContract.keyError(""))
        assertNull(StorageContract.keyError("favorites.v1"))
    }

    @Test
    fun `present values reply as text, absent values reply null`() {
        val present = StorageContract.okText("[]")
        assertTrue(present.startsWith("{\"ok\":true,\"value\":"))
        assertTrue(present.contains("\"[]\""))

        val absent = StorageContract.okNull()
        assertEquals("{\"ok\":true,\"value\":null}", absent)
    }

    @Test
    fun `failures carry kind and message`() {
        val failure = StorageContract.fail("invalid-argument", "key must not be blank")
        assertTrue(failure.contains("\"ok\":false"))
        assertTrue(failure.contains("\"kind\":\"invalid-argument\""))
        assertTrue(failure.contains("\"message\":\"key must not be blank\""))
    }
}

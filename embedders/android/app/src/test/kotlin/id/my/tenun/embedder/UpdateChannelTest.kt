package id.my.tenun.embedder

import org.junit.Assert.*
import org.junit.Test

/**
 * Channel-asset contract tests: the baked-in trust anchor must carry an
 * http(s) manifest URL, a channel name, and a public key — anything else
 * leaves OTA dormant.
 */
class UpdateChannelTest {

    private fun channelJson(
        manifestUrl: String = "http://192.168.1.55:8898/update-manifest.json",
        channel: String = "prototype",
        publicKeyB64: String = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtest"
    ): String =
        """{"manifestUrl":"$manifestUrl","channel":"$channel","publicKeyB64":"$publicKeyB64"}"""

    @Test
    fun testWellFormedChannelParses() {
        val channel = UpdateChannel.fromJson(channelJson())
        assertNotNull(channel)
        assertEquals("prototype", channel!!.channel)
        assertEquals("http://192.168.1.55:8898/update-manifest.json", channel.manifestUrl)
        assertTrue(channel.publicKeyB64.isNotEmpty())
    }

    @Test
    fun testHttpsChannelParses() {
        assertNotNull(UpdateChannel.fromJson(channelJson(manifestUrl = "https://updates.example.com/manifest.json")))
    }

    @Test
    fun testNonHttpManifestUrlRejected() {
        assertNull(UpdateChannel.fromJson(channelJson(manifestUrl = "file:///etc/update.json")))
        assertNull(UpdateChannel.fromJson(channelJson(manifestUrl = "ftp://host/manifest.json")))
        assertNull(UpdateChannel.fromJson(channelJson(manifestUrl = "")))
    }

    @Test
    fun testMissingChannelOrKeyRejected() {
        assertNull(UpdateChannel.fromJson(channelJson(channel = "")))
        assertNull(UpdateChannel.fromJson(channelJson(publicKeyB64 = "")))
    }

    @Test
    fun testGarbageJsonRejected() {
        assertNull(UpdateChannel.fromJson("not json"))
        assertNull(UpdateChannel.fromJson(""))
    }
}

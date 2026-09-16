package id.my.tenun.embedder

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/**
 * Tests for the signed release-metadata envelope: signature over exact
 * payload bytes, host/channel compatibility, sequence gating, state-carry
 * gate. Signatures are produced here with the same ECDSA P-256 /
 * SHA256withECDSA parameters the publisher tool uses, so tool and app are
 * pinned to one wire format.
 */
class UpdateProtocolTest {

    private fun ecPair(): KeyPair {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        return generator.generateKeyPair()
    }

    private fun signPayload(pair: KeyPair, payload: ByteArray): String {
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(pair.private)
        signature.update(payload)
        return Base64.getEncoder().encodeToString(signature.sign())
    }

    private fun metadataJson(
        schema: Int = 1,
        appId: String = "id.my.tenun.embedder",
        channel: String = "prototype",
        sequence: Long = 42,
        hostApiMin: Int = 1,
        hostApiMax: Int? = 1,
        stateSchema: Long = 1,
        bundleFormat: String = "tenun-js-bundle-v1",
        bundleSize: Long = 100,
        sha: String = "a".repeat(64),
        url: String = "http://127.0.0.1:8898/update-bundle.js"
    ): String {
        val maxField = hostApiMax?.let { "\"hostApiMax\":$it," } ?: ""
        return """{"schema":$schema,"appId":"$appId","channel":"$channel",""" +
            """"sequence":$sequence,"hostApiMin":$hostApiMin,$maxField""" +
            """"stateSchema":$stateSchema,"bundleFormat":"$bundleFormat",""" +
            """"bundleSize":$bundleSize,"bundleSha256":"$sha","bundleUrl":"$url"}"""
    }

    private fun envelopeFor(metadataJson: String, pair: KeyPair): String {
        val payload = metadataJson.toByteArray(Charsets.UTF_8)
        return """{"payload":"${Base64.getEncoder().encodeToString(payload)}",""" +
            """"signature":"${signPayload(pair, payload)}"}"""
    }

    private fun publicB64(pair: KeyPair): String =
        Base64.getEncoder().encodeToString(pair.public.encoded)

    private val host = UpdateProtocol.HostIdentity("id.my.tenun.embedder", "prototype", 1)

    @Test
    fun testWellFormedEnvelopeParses() {
        val pair = ecPair()
        val metadata = UpdateProtocol.parseEnvelope(envelopeFor(metadataJson(), pair), publicB64(pair))
        assertNotNull(metadata)
        assertEquals(42L, metadata!!.sequence)
        assertEquals("prototype", metadata.channel)
        assertEquals(1, metadata.hostApiMin)
        assertEquals(1, metadata.hostApiMax)
        assertEquals(1L, metadata.stateSchema)
        assertEquals(100L, metadata.bundleSize)
    }

    @Test
    fun testTamperedPayloadIsRejected() {
        val pair = ecPair()
        val envelopeJson = envelopeFor(metadataJson(), pair)
        val envelope = org.json.JSONObject(envelopeJson)
        val payload = String(Base64.getDecoder().decode(envelope.getString("payload")))
        val mutated = payload.replace("\"sequence\":42", "\"sequence\":43").toByteArray()
        assertTrue(!mutated.contentEquals(payload.toByteArray()))
        val mutatedEnvelope = """{"payload":"${Base64.getEncoder().encodeToString(mutated)}",""" +
            """"signature":"${envelope.getString("signature")}"}"""
        assertNull(UpdateProtocol.parseEnvelope(mutatedEnvelope, publicB64(pair)))
    }

    @Test
    fun testWrongKeyIsRejected() {
        val signer = ecPair()
        val other = ecPair()
        assertNull(UpdateProtocol.parseEnvelope(envelopeFor(metadataJson(), signer), publicB64(other)))
    }

    @Test
    fun testGarbageEnvelopeNeverThrows() {
        val pair = ecPair()
        assertNull(UpdateProtocol.parseEnvelope("not json", publicB64(pair)))
        assertNull(UpdateProtocol.parseEnvelope("""{"payload":"AAAA"}""", publicB64(pair)))
        assertNull(UpdateProtocol.parseEnvelope(envelopeFor(metadataJson(), pair), "not-base64!!"))
    }

    @Test
    fun testMalformedMetadataFieldsRejected() {
        val pair = ecPair()
        val key = publicB64(pair)
        assertNull(UpdateProtocol.parseEnvelope(envelopeFor(metadataJson(schema = 2), pair), key))
        assertNull(UpdateProtocol.parseEnvelope(envelopeFor(metadataJson(sequence = 0), pair), key))
        assertNull(UpdateProtocol.parseEnvelope(envelopeFor(metadataJson(bundleFormat = "raw-so"), pair), key))
        assertNull(UpdateProtocol.parseEnvelope(envelopeFor(metadataJson(url = "file:///x"), pair), key))
        assertNull(UpdateProtocol.parseEnvelope(envelopeFor(metadataJson(sha = "short"), pair), key))
        assertNull(
            UpdateProtocol.parseEnvelope(
                envelopeFor(metadataJson(hostApiMin = 2, hostApiMax = 1), pair), key
            )
        )
    }

    @Test
    fun testCompatibilityGate() {
        val pair = ecPair()
        val key = publicB64(pair)

        fun meta(min: Int, max: Int?, appId: String = "id.my.tenun.embedder", channel: String = "prototype") =
            UpdateProtocol.parseEnvelope(
                envelopeFor(metadataJson(hostApiMin = min, hostApiMax = max, appId = appId, channel = channel), pair),
                key
            )!!

        assertTrue(UpdateProtocol.isCompatible(meta(1, 1), host))
        assertTrue(UpdateProtocol.isCompatible(meta(1, 3), host))
        assertFalse(UpdateProtocol.isCompatible(meta(2, 3), host)) // host older than required
        assertFalse(UpdateProtocol.isCompatible(meta(1, 1, appId = "com.other"), host))
        assertFalse(UpdateProtocol.isCompatible(meta(1, 1, channel = "production"), host))
    }

    @Test
    fun testNullHostApiMaxPinsToMin() {
        val pair = ecPair()
        val metadata = UpdateProtocol.parseEnvelope(
            envelopeFor(metadataJson(hostApiMin = 1, hostApiMax = null), pair),
            publicB64(pair)
        )
        assertNotNull(metadata)
        assertNull(metadata!!.hostApiMax)
        assertTrue(UpdateProtocol.isCompatible(metadata, host))
        assertFalse(
            UpdateProtocol.isCompatible(
                metadata,
                UpdateProtocol.HostIdentity("id.my.tenun.embedder", "prototype", 2)
            )
        )
    }

    @Test
    fun testSequenceGate() {
        val pair = ecPair()
        val meta = UpdateProtocol.parseEnvelope(
            envelopeFor(metadataJson(sequence = 42), pair),
            publicB64(pair)
        )!!
        assertTrue(UpdateProtocol.isNewer(meta, 41))
        assertFalse(UpdateProtocol.isNewer(meta, 42)) // replay of accepted
        assertFalse(UpdateProtocol.isNewer(meta, 99)) // rollback attempt
    }

    @Test
    fun testBundleMatchesSizeAndDigest() {
        val pair = ecPair()
        val bytes = "bundle-bytes".toByteArray()
        val sha = BundleUpdateVerifier.sha256Hex(bytes)
        val meta = UpdateProtocol.parseEnvelope(
            envelopeFor(metadataJson(bundleSize = bytes.size.toLong(), sha = sha), pair),
            publicB64(pair)
        )!!
        assertTrue(UpdateProtocol.bundleMatches(meta, bytes))
        assertFalse(UpdateProtocol.bundleMatches(meta, "bundle-bytes!".toByteArray())) // size differs
        assertFalse(UpdateProtocol.bundleMatches(meta, "bundle-bytesX".toByteArray())) // digest differs
    }

    @Test
    fun testStateCarryGate() {
        assertTrue(UpdateProtocol.shouldRestore(1, 1))
        assertFalse(UpdateProtocol.shouldRestore(1, 2)) // schema drift: clean restart
        assertFalse(UpdateProtocol.shouldRestore(2, 1))
        assertFalse(UpdateProtocol.shouldRestore(-1, 1)) // unknown old schema
        assertFalse(UpdateProtocol.shouldRestore(0, 0))
    }
}

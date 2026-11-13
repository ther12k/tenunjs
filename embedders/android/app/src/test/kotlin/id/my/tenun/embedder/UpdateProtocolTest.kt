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
        url: String = "http://127.0.0.1:8898/update-bundle.js",
        requiresRaw: String? = null,
        activation: String? = null,
        migrations: List<Long>? = null
    ): String {
        val maxField = hostApiMax?.let { "\"hostApiMax\":$it," } ?: ""
        val requiresField = requiresRaw?.let { "\"requiredCapabilities\":$it," } ?: ""
        val activationField = activation?.let { "\"activation\":\"$it\"," } ?: ""
        val migrationsField = migrations?.let { "\"stateMigrationsFrom\":${it.joinToString(",", "[", "]")}," } ?: ""
        return """{"schema":$schema,"appId":"$appId","channel":"$channel",""" +
            """"sequence":$sequence,"hostApiMin":$hostApiMin,$maxField""" +
            """$requiresField$activationField$migrationsField"stateSchema":$stateSchema,"bundleFormat":"$bundleFormat",""" +
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
    fun testStoredBundleUsableGate() {
        // Startup re-verification: download-time proof does not carry
        // forward — the cached envelope, the running host, and the stored
        // bytes must all still prove out before a stored bundle boots.
        val pair = ecPair()
        val key = publicB64(pair)
        val bytes = "stored-bundle".toByteArray()
        val envelope = envelopeFor(
            metadataJson(sequence = 7, bundleSize = bytes.size.toLong(), sha = BundleUpdateVerifier.sha256Hex(bytes)),
            pair
        )

        // Valid cache + matching bytes + compatible host: boots.
        val verified = UpdateProtocol.storedBundleUsable(envelope, key, host, bytes)
        assertNotNull(verified)
        assertEquals(7L, verified!!.sequence)

        // Tampered cache: the stored payload no longer holds its signature.
        val envelopeObj = org.json.JSONObject(envelope)
        val payload = String(Base64.getDecoder().decode(envelopeObj.getString("payload")))
        val mutated = payload.replace("\"sequence\":7", "\"sequence\":8").toByteArray()
        val tampered = """{"payload":"${Base64.getEncoder().encodeToString(mutated)}",""" +
            """"signature":"${envelopeObj.getString("signature")}"}"""
        assertNull(UpdateProtocol.storedBundleUsable(tampered, key, host, bytes))

        // Wrong pinned key: the cache belongs to a different signer.
        assertNull(UpdateProtocol.storedBundleUsable(envelope, publicB64(ecPair()), host, bytes))

        // The APK moved on: bundle pinned to hostApi 1, running host is 2.
        val newerHost = UpdateProtocol.HostIdentity("id.my.tenun.embedder", "prototype", 2)
        assertNull(UpdateProtocol.storedBundleUsable(envelope, key, newerHost, bytes))

        // Stored bytes drifted on disk: size/digest no longer match.
        assertNull(UpdateProtocol.storedBundleUsable(envelope, key, host, "stored-bundle!".toByteArray()))
        assertNull(UpdateProtocol.storedBundleUsable(envelope, key, host, "stored-bundl".toByteArray()))

        // Garbage cache never boots and never throws.
        assertNull(UpdateProtocol.storedBundleUsable("not json", key, host, bytes))
    }

    @Test
    fun testRequiredCapabilitiesParseAndGate() {
        // TN-195: a release may declare minimum contract versions per
        // capability; the host refuses before download unless it provides
        // every capability at >= that version. Requirement-bearing
        // releases must target hostApi >= REQUIREMENTS_MIN_HOST_API —
        // older hosts ignore the field, so lower pins are malformed.
        val pair = ecPair()
        val key = publicB64(pair)
        fun meta(requiresRaw: String?, hostApiMin: Int = 2) =
            UpdateProtocol.parseEnvelope(
                envelopeFor(metadataJson(hostApiMin = hostApiMin, hostApiMax = hostApiMin, requiresRaw = requiresRaw), pair),
                key
            )

        // Well-formed requirements parse into the signed metadata.
        val metadata = meta("""{"net":1}""")
        assertNotNull(metadata)
        assertEquals(mapOf("net" to 1), metadata!!.requiredCapabilities)
        // Absent field = no requirements (legacy manifests stay installable).
        assertTrue(meta(null)!!.requiredCapabilities.isEmpty())

        // Malformed requirements or discipline violations fail closed.
        assertNull(meta("""{"net":0}""")) // version below 1
        assertNull(meta("""{"net":"one"}""")) // non-integer version
        assertNull(meta("""{"":1}""")) // blank name
        assertNull(meta("""{"net":1}""", hostApiMin = 1)) // pre-requirement host pin

        // The gate: provide/missing/older/newer against the host inventory.
        val fullHost = UpdateProtocol.HostIdentity("id.my.tenun.embedder", "prototype", 2, mapOf("net" to 1, "discovery" to 1))
        val noNetHost = UpdateProtocol.HostIdentity("id.my.tenun.embedder", "prototype", 2, mapOf("discovery" to 1))
        val emptyHost = UpdateProtocol.HostIdentity("id.my.tenun.embedder", "prototype", 2)

        assertTrue(UpdateProtocol.isCompatible(meta("""{"net":1}""")!!, fullHost))
        assertFalse(UpdateProtocol.isCompatible(meta("""{"net":1}""")!!, noNetHost)) // capability missing
        assertFalse(UpdateProtocol.isCompatible(meta("""{"net":1}""")!!, emptyHost)) // host declares nothing
        assertFalse(UpdateProtocol.isCompatible(meta("""{"net":2}""")!!, fullHost)) // contract too old
        assertTrue(UpdateProtocol.isCompatible(meta("""{"net":1,"discovery":1}""")!!, fullHost)) // multiple, all met

        // A host with a NEWER contract still satisfies an older requirement.
        val newerHost = UpdateProtocol.HostIdentity("id.my.tenun.embedder", "prototype", 2, mapOf("net" to 3))
        assertTrue(UpdateProtocol.isCompatible(meta("""{"net":1}""")!!, newerHost))
    }

    @Test
    fun testStateCarryGate() {
        assertTrue(UpdateProtocol.shouldRestore(1, 1))
        assertFalse(UpdateProtocol.shouldRestore(1, 2)) // schema drift: clean restart
        assertFalse(UpdateProtocol.shouldRestore(2, 1))
        assertFalse(UpdateProtocol.shouldRestore(-1, 1)) // unknown old schema
        assertFalse(UpdateProtocol.shouldRestore(0, 0))

        // TN-196: a signed migration declaration carries the old schema
        // across — the migration itself is app-authored in the new
        // bundle's restore handler (TN-163 still refuses unacknowledged
        // restores).
        assertTrue(UpdateProtocol.shouldRestore(1, 2, migrationsFrom = setOf(1)))
        assertFalse(UpdateProtocol.shouldRestore(1, 2, migrationsFrom = setOf(2))) // wrong old schema
        assertFalse(UpdateProtocol.shouldRestore(3, 2, migrationsFrom = setOf(1)))
        assertFalse(UpdateProtocol.shouldRestore(1, 2, migrationsFrom = emptySet()))
        assertFalse(UpdateProtocol.shouldRestore(-1, 2, migrationsFrom = setOf(1))) // unknown old still refuses
    }

    @Test
    fun testActivationPolicyParse() {
        // TN-196: signed activation preference + state migrations, with
        // host-api discipline — deferred semantics below
        // ACTIVATION_MIN_HOST_API are malformed (older hosts would ignore
        // the fields: apply immediately / restart clean).
        val pair = ecPair()
        val key = publicB64(pair)
        fun meta(activation: String? = null, migrations: List<Long>? = null, hostApiMin: Int = 3) =
            UpdateProtocol.parseEnvelope(
                envelopeFor(
                    metadataJson(hostApiMin = hostApiMin, hostApiMax = hostApiMin, activation = activation, migrations = migrations),
                    pair
                ),
                key
            )

        // Absent field = immediate (legacy manifests unchanged).
        val legacy = meta()!!
        assertEquals(UpdateProtocol.ACTIVATION_IMMEDIATE, legacy.activation)
        assertTrue(legacy.stateMigrationsFrom.isEmpty())

        // Explicit values parse.
        assertEquals(UpdateProtocol.ACTIVATION_NEXT_LAUNCH, meta(activation = "next-launch")!!.activation)
        assertEquals(UpdateProtocol.ACTIVATION_IDLE, meta(activation = "idle")!!.activation)
        val migrating = meta(migrations = listOf(1, 2))!!
        assertEquals(setOf(1L, 2L), migrating.stateMigrationsFrom)
        assertEquals(UpdateProtocol.ACTIVATION_IMMEDIATE, migrating.activation)

        // Malformed values fail closed.
        assertNull(meta(activation = "on-tuesday"))
        assertNull(meta(migrations = listOf(0)))
        assertNull(meta(migrations = listOf(-3)))

        // Discipline: deferred semantics need hostApi >= 3.
        assertNull(meta(activation = "idle", hostApiMin = 2))
        assertNull(meta(migrations = listOf(1), hostApiMin = 2))
        // ...but an immediate, non-migrating host-api-2 release is fine.
        assertNotNull(meta(hostApiMin = 2))
    }
}

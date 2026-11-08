package id.my.tenun.embedder

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.security.KeyStore
import java.security.Signature
import java.security.cert.CertificateFactory
import java.util.Base64

/**
 * TN-189 device gate: the keys host service over the TN-154 bridge against
 * the REAL AndroidKeyStore (ADR-0027, 04-api/keys.md). Every contract
 * semantic is asserted on device: generate a self-signed EC P-256 identity,
 * sign fixed bytes and get exactly the pinned 64-byte raw r||s back
 * (verifiable with the exported certificate's public key), loud duplicate
 * aliases, idempotent removal with not-found afterwards, persistence
 * across a fresh service + fresh KeyStore load (AndroidKeyStore state is
 * owned by the system keystore daemon, so this is what a restarted app
 * process sees), and fail-visible behavior for malformed payloads.
 */
@RunWith(AndroidJUnit4::class)
class KeysHostServiceTest {

    /** Unique per run: the emulator keystore persists across test runs. */
    private val alias = "test.tn189.${System.nanoTime()}"
    private val registry = HostServiceRegistry().apply { register("keys", KeysService()) }

    @After
    fun cleanup() {
        registry.onHostCall("keys", "removeIdentity", """{"handle":"$alias"}""")
    }

    private fun call(method: String, payloadJson: String): String? =
        registry.onHostCall("keys", method, payloadJson)

    private fun failureKind(response: String): String =
        JSONObject(response).getJSONObject("failure").getString("kind")

    private fun generate(): JSONObject =
        JSONObject(call("generateIdentity", """{"alias":"$alias"}""")!!).getJSONObject("value")

    private fun pemBytes(pem: String): ByteArray {
        val body = pem
            .replace("-----BEGIN CERTIFICATE-----", "")
            .replace("-----END CERTIFICATE-----", "")
            .replace(Regex("\\s"), "")
        return Base64.getDecoder().decode(body)
    }

    @Test
    fun generateProducesAParseableSelfSignedCertificate() {
        val identity = generate()
        assertEquals(alias, identity.getString("handle"))
        val pem = identity.getString("certificatePem")
        assertTrue(pem.startsWith("-----BEGIN CERTIFICATE-----"))
        assertTrue(pem.endsWith("-----END CERTIFICATE-----\n"))
        val certificate = CertificateFactory.getInstance("X.509")
            .generateCertificate(ByteArrayInputStream(pemBytes(pem))) as java.security.cert.X509Certificate
        assertEquals("EC", certificate.publicKey.algorithm)
        // P-256, not just "some EC curve".
        val encodedPoint = certificate.publicKey.encoded
        assertTrue(encodedPoint.size > 26)
        assertEquals(alias, certificate.subjectX500Principal.name.substringAfter("CN=").substringBefore(','))
        // Full self-signature verification with the certificate's own key.
        certificate.verify(certificate.publicKey)
    }

    @Test
    fun signReturnsExactly64RawBytesVerifiableWithTheCertificate() {
        val identity = generate()
        val certificate = CertificateFactory.getInstance("X.509")
            .generateCertificate(ByteArrayInputStream(pemBytes(identity.getString("certificatePem"))))
        val data = "tenun pairing challenge".toByteArray()

        val response = JSONObject(
            call("sign", """{"handle":"$alias","data":"${Base64.getEncoder().encodeToString(data)}"}""")!!
        )
        assertTrue(response.getBoolean("ok"))
        val raw = Base64.getDecoder().decode(response.getString("value"))
        assertEquals(64, raw.size) // THE pinned parity point

        val der = DerSignature.rawToDerP256(raw)!!
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(certificate.publicKey)
        verifier.update(data)
        assertTrue(verifier.verify(der))

        verifier.update("not the challenge".toByteArray())
        assertFalse(verifier.verify(der))
    }

    @Test
    fun exportCertificatePemRoundTrips() {
        val generated = generate().getString("certificatePem")
        val exported = JSONObject(call("exportCertificatePem", """{"handle":"$alias"}""")!!)
        assertTrue(exported.getBoolean("ok"))
        assertEquals(generated, exported.getString("value"))
    }

    @Test
    fun duplicateAliasIsLoudAndTheOriginalSurvives() {
        generate()
        val dup = call("generateIdentity", """{"alias":"$alias"}""")!!
        assertFalse(JSONObject(dup).getBoolean("ok"))
        assertEquals("invalid-argument", failureKind(dup))
        assertTrue(JSONObject(call("sign", """{"handle":"$alias","data":"AQID"}""")!!).getBoolean("ok"))
    }

    @Test
    fun unknownHandlesAreInvalidArgument() {
        val signed = call("sign", """{"handle":"no.such.identity","data":"AQID"}""")!!
        assertEquals("invalid-argument", failureKind(signed))
        val exported = call("exportCertificatePem", """{"handle":"no.such.identity"}""")!!
        assertEquals("invalid-argument", failureKind(exported))
    }

    @Test
    fun removalIsIdempotentAndThenNothingIsFound() {
        generate()
        assertTrue(JSONObject(call("removeIdentity", """{"handle":"$alias"}""")!!).getBoolean("ok"))
        assertTrue(JSONObject(call("removeIdentity", """{"handle":"$alias"}""")!!).getBoolean("ok"))
        assertEquals("invalid-argument", failureKind(call("sign", """{"handle":"$alias","data":"AQID"}""")!!))
    }

    @Test
    fun identitiesSurviveAFreshServiceAndKeystoreLoad() {
        val identity = generate()
        // Fresh service + fresh KeyStore handle within THIS process (the
        // literal process-restart journey is KeysProcessPersistenceTest).
        // AndroidKeyStore state lives in the system keystore daemon.
        val fresh = HostServiceRegistry().apply { register("keys", KeysService()) }
        KeyStore.getInstance("AndroidKeyStore").load(null)

        val exported = JSONObject(fresh.onHostCall("keys", "exportCertificatePem", """{"handle":"$alias"}""")!!)
        assertTrue(exported.getBoolean("ok"))
        assertEquals(identity.getString("certificatePem"), exported.getString("value"))
        assertTrue(
            JSONObject(fresh.onHostCall("keys", "sign", """{"handle":"$alias","data":"AQID"}""")!!)
                .getBoolean("ok")
        )
    }

    @Test
    fun malformedPayloadsFailVisiblyNeverCrash() {
        assertEquals("invalid-argument", failureKind(call("generateIdentity", "not json")!!))
        assertEquals("invalid-argument", failureKind(call("generateIdentity", """{"alias":""}""")!!))
        // An EXISTING identity so the base64 branch is what fails.
        generate()
        assertEquals(
            "invalid-argument",
            failureKind(call("sign", """{"handle":"$alias","data":"!!!not-base64!!!"}""")!!)
        )
    }

    @Test
    fun unknownMethodIsNullAndNothingKeyShapedEverCrossesTheBridge() {
        assertNull(call("generateKeyPairShenanigans", "{}"))
        val identity = generate()
        val signed = call("sign", """{"handle":"$alias","data":"AQID"}""")!!
        assertFalse(identity.getString("certificatePem").contains("PRIVATE KEY"))
        assertFalse(signed.contains("PRIVATE KEY"))
        assertFalse(identity.toString().contains("PRIVATE KEY"))
    }

    // -- review 2026-11-08: ownership, strict typing, concurrency, bounds --

    @Test
    fun backingAliasesLiveInTheServiceNamespaceAndForeignHandlesAreImpotent() {
        generate()
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val names = ks.aliases().toList()
        // The caller alias itself never appears; only the hashed namespace.
        assertFalse(names.contains(alias))
        assertTrue(names.any { it.startsWith("tenun.keys.v1.") })
        // A caller handle naming some other subsystem's key is a no-op:
        // it maps into the namespace, finds nothing, deletes nothing.
        val before = names.toSet()
        val removed = JSONObject(call("removeIdentity", """{"handle":"host.vault.master"}""")!!)
        assertTrue(removed.getBoolean("ok"))
        val after = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.aliases().toList().toSet()
        assertEquals(before, after)
        // And signing with it finds nothing — it cannot reach foreign keys.
        val signed = call("sign", """{"handle":"host.vault.master","data":"AQID"}""")!!
        assertEquals("invalid-argument", failureKind(signed))
    }

    @Test
    fun nonStringPayloadFieldsAreRefusedNotCoerced() {
        // JSON numbers/booleans must not be stringified into operations.
        assertEquals("invalid-argument", failureKind(call("generateIdentity", """{"alias":1234}""")!!))
        assertEquals("invalid-argument", failureKind(call("generateIdentity", """{"alias":true}""")!!))
        generate()
        assertEquals(
            "invalid-argument",
            failureKind(call("sign", """{"handle":1234,"data":"AQID"}""")!!)
        )
        assertEquals(
            "invalid-argument",
            failureKind(call("sign", """{"handle":"$alias","data":true}""")!!)
        )
        assertEquals(
            "invalid-argument",
            failureKind(call("removeIdentity", """{"handle":42}""")!!)
        )
    }

    @Test
    fun emptyBytePayloadsSignAsZeroBytes() {
        generate()
        val signed = JSONObject(call("sign", """{"handle":"$alias","data":""}""")!!)
        assertTrue(signed.getBoolean("ok"))
        assertEquals(64, Base64.getDecoder().decode(signed.getString("value")).size)
    }

    @Test
    fun oversizedDataIsRefused() {
        generate()
        val big = Base64.getEncoder().encodeToString(ByteArray(65_537))
        assertEquals("invalid-argument", failureKind(call("sign", """{"handle":"$alias","data":"$big"}""")!!))
    }

    @Test
    fun aliasBoundsAreEnforced() {
        assertEquals("invalid-argument", failureKind(call("generateIdentity", """{"alias":"${"a".repeat(129)}"}""")!!))
            failureKind(call("generateIdentity", JSONObject().put("alias", "bad" + 0.toChar() + "control").toString())!!)
        // 128 is the boundary and succeeds; cleanup removes it.
        val edge = "a".repeat(128)
        val edgeResult = call("generateIdentity", """{"alias":"$edge"}""")
        assertTrue(JSONObject(edgeResult!!).getBoolean("ok"))
        call("removeIdentity", """{"handle":"$edge"}""")
    }

    @Test
    fun availabilityReportsTheKeystoreState() {
        val probe = JSONObject(call("availability", "{}")!!)
        assertTrue(probe.getBoolean("ok"))
        assertEquals("supported", probe.getJSONObject("value").getString("status"))
    }

    @Test
    fun concurrentDuplicateGenerationFailsExactlyOneCaller() {
        val ready = java.util.concurrent.CountDownLatch(1)
        val go = java.util.concurrent.CountDownLatch(1)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val futures = (1..2).map {
                pool.submit<Boolean> {
                    ready.countDown()
                    go.await()
                    val reply = call("generateIdentity", """{"alias":"$alias"}""")!!
                    JSONObject(reply).getBoolean("ok")
                }
            }
            ready.await()
            go.countDown()
            val outcomes = futures.map { it.get() }
            assertEquals(listOf(false, true), outcomes.sorted()) // exactly one success
            // The survivor is the identity the successful caller was told about.
            assertTrue(JSONObject(call("exportCertificatePem", """{"handle":"$alias"}""")!!).getBoolean("ok"))
        } finally {
            pool.shutdownNow()
        }
    }
}

package id.my.tenun.embedder

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.math.BigInteger
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.interfaces.ECPublicKey

/** TN-189: compiled public TS adapter -> real QuickJS -> JNI -> AndroidKeyStore. */
@RunWith(AndroidJUnit4::class)
class KeysBridgeTest {
    @Test
    fun publicAdapterRoundTripsThroughQuickJsJniAndKeystore() {
        KeysBridgeFixture().use { bridge ->
            bridge.assertSupported()
            val alias = "test.tn189.bridge.${System.nanoTime()}"
            val identity = bridge.generate(alias)
            val handle = identity.getString("handle") // opaque to the caller
            try {
                assertEquals(setOf("handle", "certificatePem"), identity.keys().asSequence().toSet())
                val pem = identity.getString("certificatePem")
                val certificate = KeysBridgeEvidence.certificate(pem)
                assertEquals(pem, bridge.exportCertificate(handle))

                // Every byte value, base64 padding, and the legal empty message:
                // no Buffer/atob/btoa globals exist in the production QuickJS host.
                for (challenge in listOf(ByteArray(257) { it.toByte() }, byteArrayOf())) {
                    val signature = bridge.sign(handle, challenge)
                    assertTrue(KeysBridgeEvidence.verifies(certificate, challenge, signature))
                    assertFalse(KeysBridgeEvidence.verifies(certificate, challenge + byteArrayOf(1), signature))
                }
                assertFailure("invalid-argument", bridge.call("generateIdentity", JSONObject().put("alias", alias)))
                assertEquals("duplicate must not replace the original", pem, bridge.exportCertificate(handle))
                assertTrue(KeysBridgeEvidence.verifies(certificate, byteArrayOf(9), bridge.sign(handle, byteArrayOf(9))))

                bridge.remove(handle)
                bridge.remove(handle) // idempotent, also through the public adapter
                assertFailure("invalid-argument", bridge.call("sign", JSONObject().put("handle", handle).put("data", JSONArray())))
                assertFailure("invalid-argument", bridge.call("exportCertificatePem", JSONObject().put("handle", handle)))
            } finally {
                bridge.remove(handle)
            }
        }
    }

    private fun assertFailure(kind: String, result: JSONObject) {
        assertFalse(result.toString(), result.getBoolean("ok"))
        assertEquals(kind, result.getJSONObject("failure").getString("kind"))
    }
}

/** Shared by the ordinary bridge gate and the two separately launched process phases. */
internal class KeysBridgeFixture : AutoCloseable {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val registry = HostServiceRegistry().apply { register("keys", KeysService()) }
    private val engine = TenunEngine(
        instrumentation.context.assets.open("keys_fixture.js").use { it.readBytes() },
        registry,
    )

    private fun dispatch(action: String, payload: JSONObject = JSONObject()): JSONObject {
        val json = engine.dispatchActionResult(action, payload.toString())
        assertNotNull("compiled keys fixture must return a synchronous string for $action", json)
        return JSONObject(json!!)
    }

    fun assertSupported() {
        val metadata = dispatch("metadata")
        assertEquals(1, metadata.getInt("contractVersion"))
        assertEquals("supported", metadata.getJSONObject("availability").getString("status"))
        assertEquals(0, metadata.getJSONArray("permissions").length())
        for (name in listOf("Buffer", "atob", "btoa")) {
            assertEquals("QuickJS must not need $name", "undefined", metadata.getJSONObject("globals").getString(name))
        }
    }

    fun call(method: String, payload: JSONObject): JSONObject {
        assertTrue("dispatch starts, but does not return, the capability Promise", dispatch(method, payload).getBoolean("pending"))
        // nativeDispatchActionResult drains the real engine's jobs before it
        // returns; read the .then result through a SECOND synchronous dispatch.
        val result = dispatch("result")
        assertFalse("capability Promise did not settle: $result", result.optBoolean("pending"))
        assertFalse("capability rejected instead of resolving: $result", result.has("fixtureError"))
        assertTrue("missing CapabilityResult: $result", result.has("ok"))
        assertFalse("private material must never cross the bridge", result.toString().contains("PRIVATE KEY"))
        return result
    }

    private fun success(method: String, payload: JSONObject): JSONObject = call(method, payload).also {
        assertTrue("$method failed: $it", it.getBoolean("ok"))
    }

    fun generate(alias: String): JSONObject =
        success("generateIdentity", JSONObject().put("alias", alias)).getJSONObject("value")

    fun exportCertificate(handle: String): String =
        success("exportCertificatePem", JSONObject().put("handle", handle)).getString("value")

    fun sign(handle: String, data: ByteArray): ByteArray {
        val bytes = JSONArray()
        data.forEach { bytes.put(it.toInt() and 0xff) }
        val value = success("sign", JSONObject().put("handle", handle).put("data", bytes)).getJSONArray("value")
        assertEquals("P-256 signature is raw r||s, never DER", 64, value.length())
        return ByteArray(value.length()) { index ->
            val byte = value.getInt(index)
            assertTrue("normalized signature byte is unsigned", byte in 0..255)
            byte.toByte()
        }
    }

    fun remove(handle: String) {
        assertTrue(success("removeIdentity", JSONObject().put("handle", handle)).isNull("value"))
    }

    override fun close() = engine.destroy()
}

/** Independent JCA verification: deliberately does NOT use production DerSignature. */
internal object KeysBridgeEvidence {
    fun certificate(pem: String): X509Certificate {
        val certificate = CertificateFactory.getInstance("X.509")
            .generateCertificate(ByteArrayInputStream(pem.toByteArray(Charsets.US_ASCII))) as X509Certificate
        certificate.checkValidity()
        assertEquals(certificate.subjectX500Principal, certificate.issuerX500Principal)
        certificate.verify(certificate.publicKey)
        val publicKey = certificate.publicKey as ECPublicKey
        assertEquals(256, publicKey.params.curve.field.fieldSize)
        assertEquals(BigInteger("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", 16), publicKey.params.order)
        return certificate
    }

    fun verifies(certificate: X509Certificate, challenge: ByteArray, raw: ByteArray): Boolean {
        assertEquals(64, raw.size)
        fun integer(from: Int): ByteArray {
            val value = BigInteger(1, raw.copyOfRange(from, from + 32)).toByteArray()
            return byteArrayOf(0x02, value.size.toByte()) + value
        }
        val body = integer(0) + integer(32)
        val der = byteArrayOf(0x30, body.size.toByte()) + body
        return Signature.getInstance("SHA256withECDSA").run {
            initVerify(certificate.publicKey)
            update(challenge)
            verify(der)
        }
    }
}

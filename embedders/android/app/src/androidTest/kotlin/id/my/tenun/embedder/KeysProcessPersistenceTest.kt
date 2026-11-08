package id.my.tenun.embedder

import android.os.Bundle
import android.os.Process
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.SecureRandom

/**
 * TN-189 literal process-death gate. Excluded from the ordinary suite: the
 * acceptance runner invokes each method separately, force-stops the target
 * between them, and asserts pidof is empty. No uninstall/clear in that window.
 * A fresh service in the SAME process is intentionally not sufficient evidence.
 */
@RunWith(AndroidJUnit4::class)
class KeysProcessPersistenceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val witness = File(instrumentation.targetContext.filesDir, "tn189-keys-process-witness.json")

    @Test
    fun seed() {
        assertFalse("do not overwrite an unconsumed TN-189 public witness", witness.exists())
        KeysBridgeFixture().use { bridge ->
            bridge.assertSupported()
            val identity = bridge.generate("test.tn189.process.${System.nanoTime()}")
            val handle = identity.getString("handle")
            var retained = false
            try {
                val pem = identity.getString("certificatePem")
                KeysBridgeEvidence.certificate(pem)
                assertEquals(pem, bridge.exportCertificate(handle))
                val publicWitness = JSONObject()
                    .put("handle", handle)
                    .put("certificatePem", pem)
                    .put("pid", Process.myPid())
                witness.writeText(publicWitness.toString(), Charsets.UTF_8)
                evidence("seed", publicWitness)
                retained = true // ONLY this test-owned identity survives the phase
            } finally {
                if (!retained) {
                    try { bridge.remove(handle) } finally { witness.delete() }
                }
            }
        }
    }

    @Test
    fun verifyAfterRestart() {
        assertTrue("seed must run in a separate instrumentation invocation first", witness.isFile)
        val publicWitness = JSONObject(witness.readText(Charsets.UTF_8))
        assertEquals(setOf("handle", "certificatePem", "pid"), publicWitness.keys().asSequence().toSet())
        val handle = publicWitness.getString("handle")
        KeysBridgeFixture().use { bridge ->
            try {
                assertNotEquals("the target process MUST have died between phases", publicWitness.getInt("pid"), Process.myPid())
                bridge.assertSupported()
                val pem = publicWitness.getString("certificatePem")
                // No generateIdentity call in this phase: use ONLY the saved
                // opaque handle and compare the complete original certificate.
                assertEquals("same identity after literal process death", pem, bridge.exportCertificate(handle))
                val certificate = KeysBridgeEvidence.certificate(pem)
                val challenge = ByteArray(48).also { SecureRandom().nextBytes(it) }
                val signature = bridge.sign(handle, challenge)
                assertTrue(KeysBridgeEvidence.verifies(certificate, challenge, signature))
                assertFalse(KeysBridgeEvidence.verifies(certificate, challenge + byteArrayOf(1), signature))
                evidence("verifyAfterRestart", publicWitness)
            } finally {
                try { bridge.remove(handle) } finally {
                    assertTrue("remove only the test-owned public witness", witness.delete())
                }
            }
        }
    }

    private fun evidence(phase: String, publicWitness: JSONObject) {
        val message = "TN189_KEYS_PROCESS phase=$phase pid=${Process.myPid()} seedPid=${publicWitness.getInt("pid")}"
        Log.i("TenunKeysPersistence", message)
        instrumentation.sendStatus(2, Bundle().apply {
            putString("stream", "\n$message\n")
            // Public handle, cert, PID only; retained in the full runner log.
            putString("tn189_public_witness", publicWitness.toString())
        })
    }
}

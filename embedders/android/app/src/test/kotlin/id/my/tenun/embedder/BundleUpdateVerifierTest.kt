package id.my.tenun.embedder

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/**
 * JVM tests for the OTA trust gate. Signatures are produced here with the
 * same algorithm the publisher tool uses (ECDSA P-256 over SHA-256, base64
 * SPKI public key), so a green suite means tool and app agree on the wire
 * format.
 */
class BundleUpdateVerifierTest {

    private fun ecPair(): java.security.KeyPair {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        return generator.generateKeyPair()
    }

    private fun sign(privateKey: java.security.PrivateKey, bytes: ByteArray): String {
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(privateKey)
        signature.update(bytes)
        return Base64.getEncoder().encodeToString(signature.sign())
    }

    private fun publicB64(pair: java.security.KeyPair): String =
        Base64.getEncoder().encodeToString(pair.public.encoded)

    @Test
    fun testValidCandidatePasses() {
        val pair = ecPair()
        val bundle = "console.log('update')".toByteArray()
        val sig = sign(pair.private, bundle)
        val sha = BundleUpdateVerifier.sha256Hex(bundle)

        assertTrue(BundleUpdateVerifier.isValidCandidate(publicB64(pair), bundle, sha, sig))
    }

    @Test
    fun testTamperedBundleIsRejected() {
        val pair = ecPair()
        val bundle = "console.log('update')".toByteArray()
        val sig = sign(pair.private, bundle)
        val sha = BundleUpdateVerifier.sha256Hex(bundle)

        val tampered = "console.log('evil')".toByteArray()
        assertFalse(BundleUpdateVerifier.isValidCandidate(publicB64(pair), tampered, sha, sig))
    }

    @Test
    fun testWrongKeyIsRejected() {
        val signer = ecPair()
        val other = ecPair()
        val bundle = ByteArray(64) { it.toByte() }
        val sig = sign(signer.private, bundle)
        val sha = BundleUpdateVerifier.sha256Hex(bundle)

        assertFalse(BundleUpdateVerifier.isValidCandidate(publicB64(other), bundle, sha, sig))
    }

    @Test
    fun testDigestMismatchIsRejected() {
        val pair = ecPair()
        val bundle = "abc".toByteArray()
        val sig = sign(pair.private, bundle)
        val wrongSha = "0".repeat(64)

        assertFalse(BundleUpdateVerifier.isValidCandidate(publicB64(pair), bundle, wrongSha, sig))
    }

    @Test
    fun testUppercaseHexDigestIsAccepted() {
        val pair = ecPair()
        val bundle = "abc".toByteArray()
        val sig = sign(pair.private, bundle)
        val shaUpper = BundleUpdateVerifier.sha256Hex(bundle).uppercase()

        assertTrue(BundleUpdateVerifier.isValidCandidate(publicB64(pair), bundle, shaUpper, sig))
    }

    @Test
    fun testGarbageInputsNeverThrow() {
        assertFalse(BundleUpdateVerifier.isValidCandidate("not-base64!!", ByteArray(3), "a".repeat(64), "sig"))
        val pair = ecPair()
        assertFalse(BundleUpdateVerifier.isValidCandidate(publicB64(pair), ByteArray(3), "a".repeat(64), "not-base64!!"))
        assertNull(BundleUpdateVerifier.decodePublicKey("!!!"))
        // Signature of the wrong length must fail closed, not throw.
        assertFalse(BundleUpdateVerifier.verify(pair.public, ByteArray(3), "AAAA"))
    }
}

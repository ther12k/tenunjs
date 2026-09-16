package id.my.tenun.embedder

import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * Cryptographic verification for OTA bundles: SHA-256 digest equality plus
 * ECDSA P-256 / SHA-256 signature against the channel's public key.
 *
 * Pure java.security — JVM-unit-testable without Android. Every failure
 * mode (bad base64, wrong key, tampered bytes, malformed DER) returns
 * false; verification never throws.
 */
object BundleUpdateVerifier {

    fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }

    fun decodePublicKey(publicKeyB64: String): PublicKey? {
        return try {
            val spec = X509EncodedKeySpec(Base64.getDecoder().decode(publicKeyB64))
            KeyFactory.getInstance("EC").generatePublic(spec)
        } catch (e: Exception) {
            null
        }
    }

    fun verify(publicKey: PublicKey, bundle: ByteArray, signatureB64: String): Boolean {
        return try {
            val signature = Signature.getInstance("SHA256withECDSA")
            signature.initVerify(publicKey)
            signature.update(bundle)
            signature.verify(Base64.getDecoder().decode(signatureB64))
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Full gate for a downloaded candidate: digest must match the manifest
     * AND the signature must verify. The manifest digest is checked even
     * though ECDSA already covers the bytes — it pins the exact artifact
     * the publisher signed and rejects hash-collision substitutions.
     */
    fun isValidCandidate(
        publicKeyB64: String,
        bundle: ByteArray,
        expectedSha256Hex: String,
        signatureB64: String
    ): Boolean {
        val publicKey = decodePublicKey(publicKeyB64) ?: return false
        if (!sha256Hex(bundle).equals(expectedSha256Hex, ignoreCase = true)) return false
        return verify(publicKey, bundle, signatureB64)
    }
}

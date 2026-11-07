package id.my.tenun.embedder

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONException
import org.json.JSONObject
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import javax.security.auth.x500.X500Principal

/**
 * TN-189: keys host service over the TN-154 bridge — Keystore-held device
 * identities for companion pairing (ADR-0027, 04-api/keys.md).
 *
 * Private key material NEVER enters JS: generation, signing, and deletion
 * all happen inside AndroidKeyStore; only the opaque handle (the caller's
 * alias), the self-signed certificate PEM, and raw r||s signatures cross
 * the bridge. The handle==alias mapping is host-internal — apps treat it
 * as opaque per the contract.
 *
 * Wire contract (service "keys", synchronous, result-shaped JSON so the
 * future JS adapter maps 1:1 onto CapabilityResult):
 *   generateIdentity      {"alias"}             → {"ok":true,"value":{"handle","certificatePem"}}
 *   sign                  {"handle","data":b64} → {"ok":true,"value":"<b64 raw r||s, 64 bytes>"}
 *   exportCertificatePem  {"handle"}            → {"ok":true,"value":"<pem>"}
 *   removeIdentity        {"handle"}            → {"ok":true,"value":null}  (idempotent)
 * Failures are {"ok":false,"failure":{"kind","message"}} with the frozen
 * TN-141 alphabet — not-found handles and duplicate/empty/malformed
 * arguments are invalid-argument; unexpected Keystore failures are
 * platform-error. Unknown methods return null (bridge convention).
 *
 * AndroidKeyStore state is owned by the system keystore daemon, so
 * identities survive engine swaps AND process death; a fresh KeysService
 * (or a restarted app) reads the same entries — that is the persistence
 * semantics the device gate asserts.
 */
class KeysService : NativeService {

    override fun invoke(method: String, payloadJson: String): String? {
        return try {
            when (method) {
                "generateIdentity" -> generateIdentity(payloadJson)
                "sign" -> sign(payloadJson)
                "exportCertificatePem" -> exportCertificatePem(payloadJson)
                "removeIdentity" -> removeIdentity(payloadJson)
                else -> null
            }
        } catch (t: Throwable) {
            failure("platform-error", t.message ?: t.javaClass.simpleName)
        }
    }

    private fun keyStore(): KeyStore =
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun generateIdentity(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val alias = payload.optString("alias")
        if (alias.isEmpty()) {
            return failure("invalid-argument", "alias must be a non-empty string")
        }
        val ks = keyStore()
        if (ks.containsAlias(alias)) {
            // Identities in a pairing flow are precious — loud, never replace.
            return failure("invalid-argument", "alias already exists: $alias")
        }
        val spec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setCertificateSubject(X500Principal("CN=${dnValue(alias)}"))
            .setCertificateSerialNumber(serialFor(alias))
            .build()
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        generator.initialize(spec)
        generator.generateKeyPair()

        val certificate = ks.getCertificate(alias)
            ?: return failure("platform-error", "keystore generated no certificate for $alias")
        val identity = JSONObject()
            .put("handle", alias)
            .put("certificatePem", pem(certificate.encoded))
        return ok(identity)
    }

    private fun sign(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val handle = payload.optString("handle")
        val dataB64 = payload.optString("data")
        if (handle.isEmpty() || dataB64.isEmpty()) {
            return failure("invalid-argument", "handle and data are required")
        }
        val entry = keyStore().getEntry(handle, null) as? KeyStore.PrivateKeyEntry
            ?: return failure("invalid-argument", "identity not found: $handle")
        val data = try {
            Base64.getDecoder().decode(dataB64)
        } catch (e: IllegalArgumentException) {
            return failure("invalid-argument", "data is not valid base64")
        }
        // SHA256withECDSA signs in place inside the Keystore — the private
        // key is used where it lives and is never marshalled.
        val derSignature = Signature.getInstance("SHA256withECDSA").run {
            initSign(entry.privateKey)
            update(data)
            sign()
        }
        val raw = DerSignature.derToRawP256(derSignature)
            ?: return failure("platform-error", "provider produced an unconvertible ECDSA signature")
        return ok(Base64.getEncoder().encodeToString(raw))
    }

    private fun exportCertificatePem(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val handle = payload.optString("handle")
        if (handle.isEmpty()) return failure("invalid-argument", "handle is required")
        val certificate = keyStore().getCertificate(handle)
            ?: return failure("invalid-argument", "identity not found: $handle")
        return ok(pem(certificate.encoded))
    }

    private fun removeIdentity(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val handle = payload.optString("handle")
        if (handle.isEmpty()) return failure("invalid-argument", "handle is required")
        val ks = keyStore()
        if (ks.containsAlias(handle)) ks.deleteEntry(handle)
        return ok(JSONObject.NULL) // idempotent, matching the preview keyring
    }

    // -- helpers ------------------------------------------------------------

    private fun parse(payloadJson: String): JSONObject? =
        try {
            JSONObject(payloadJson)
        } catch (e: JSONException) {
            null
        }

    private fun malformed(): String =
        failure("invalid-argument", "malformed JSON payload")

    private fun ok(value: Any): String =
        JSONObject().put("ok", true).put("value", value).toString()

    private fun failure(kind: String, message: String): String =
        JSONObject()
            .put("ok", false)
            .put("failure", JSONObject().put("kind", kind).put("message", message))
            .toString()

    private fun pem(der: ByteArray): String {
        val body = Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(der)
        return "-----BEGIN CERTIFICATE-----\n$body\n-----END CERTIFICATE-----\n"
    }

    /** RFC 2253 escaping so any caller alias survives the DN round trip. */
    private fun dnValue(alias: String): String {
        val sb = StringBuilder()
        alias.forEachIndexed { index, c ->
            if (c in ",+\"\\;<>" || c == ' ' || (c == '#' && index == 0)) sb.append('\\')
            sb.append(c)
        }
        return sb.toString()
    }

    /** Deterministic positive serial from the alias (FNV-1a, high bit cleared). */
    private fun serialFor(alias: String): BigInteger {
        var h = 0x811c9dc5L
        for (c in alias) {
            h = (h xor c.code.toLong()) and 0xffffffffL
            h = (h * 0x01000193L) and 0xffffffffL
        }
        val bytes = byteArrayOf(
            ((h shr 24) and 0x7f).toByte(),
            ((h shr 16) and 0xff).toByte(),
            ((h shr 8) and 0xff).toByte(),
            (h and 0xff).toByte(),
        )
        return BigInteger(1, bytes)
    }
}

/**
 * DER SEQUENCE(INTEGER r, INTEGER s) ↔ fixed-width raw r||s (64 bytes) —
 * the pinned TN-189 signature wire format. Java's Signature emits DER; the
 * contract pins raw, so both directions live here, shared with the
 * preview keyring's identical TS converters (same vectors tested on both
 * tiers: KeysServiceFormatTest ↔ packages/platform/test/keys.test.ts).
 */
object DerSignature {

    fun derToRawP256(der: ByteArray): ByteArray? {
        if (der.size < 8 || der[0] != 0x30.toByte()) return null
        if ((der[1].toInt() and 0xff) >= 0x80) return null // P-256 DER sigs stay short-form
        val r = readInteger(der, 2) ?: return null
        val s = readInteger(der, r.second) ?: return null
        if (r.first.size > 32 || s.first.size > 32) return null
        val out = ByteArray(64)
        System.arraycopy(r.first, 0, out, 32 - r.first.size, r.first.size)
        System.arraycopy(s.first, 0, out, 64 - s.first.size, s.first.size)
        return out
    }

    private fun readInteger(der: ByteArray, at: Int): Pair<ByteArray, Int>? {
        if (at + 2 > der.size || der[at] != 0x02.toByte()) return null
        val len = der[at + 1].toInt() and 0xff
        if (len == 0 || at + 2 + len > der.size) return null
        var bytes = der.copyOfRange(at + 2, at + 2 + len)
        if (bytes[0] == 0.toByte() && bytes.size > 1) {
            bytes = bytes.copyOfRange(1, bytes.size) // strip the sign byte
        }
        return bytes to at + 2 + len
    }

    fun rawToDerP256(raw: ByteArray): ByteArray? {
        if (raw.size != 64) return null
        fun integer(from: Int): ByteArray {
            var start = from
            while (start < from + 31 && raw[start] == 0.toByte()) start += 1
            val trimmed = raw.copyOfRange(start, from + 32)
            val content = if (trimmed[0] < 0) byteArrayOf(0) + trimmed else trimmed
            return byteArrayOf(0x02, content.size.toByte()) + content
        }
        val body = integer(0) + integer(32)
        return byteArrayOf(0x30, body.size.toByte()) + body
    }
}

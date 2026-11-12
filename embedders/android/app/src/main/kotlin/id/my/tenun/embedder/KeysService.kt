package id.my.tenun.embedder

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONException
import org.json.JSONObject
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
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
 * the bridge.
 *
 * OWNERSHIP (review 2026-11-08): caller handles never address AndroidKeyStore
 * aliases directly. Every operation maps the handle injectively into a
 * service-owned backing namespace — `"tenun.keys.v1." + sha256(handle)` —
 * and only that namespace is read, created, or deleted, so a caller cannot
 * reach keys created by any other subsystem sharing the app UID. The
 * namespace contains only key pairs this service generates.
 *
 * Wire contract (service "keys", synchronous, result-shaped JSON so the
 * JS adapter maps 1:1 onto CapabilityResult):
 *   availability           {}                    → {"ok":true,"value":{"status":"supported"|"unavailable","reason"?}}
 *   generateIdentity      {"alias"}             → {"ok":true,"value":{"handle","certificatePem"}}
 *   sign                  {"handle","data":b64} → {"ok":true,"value":"<b64 raw r||s, 64 bytes>"}
 *   exportCertificatePem  {"handle"}            → {"ok":true,"value":"<pem>"}
 *   removeIdentity        {"handle"}            → {"ok":true,"value":null}  (idempotent)
 * Failures are {"ok":false,"failure":{"kind","message"}} with the frozen
 * TN-141 alphabet — not-found handles and duplicate/empty/malformed
 * arguments are invalid-argument; unexpected Keystore failures are
 * platform-error. Unknown methods return null (bridge convention).
 *
 * CONCURRENCY & FAIL-CLOSED semantics (review 2026-11-08): a process-wide
 * lock serializes generation and removal across service instances, because
 * Android Keystore generation rebinds an existing alias rather than
 * failing; duplicate existence inside the private-key-only namespace is
 * checked with `getKey` (non-not-found backend failures propagate instead
 * of masquerading as absence, which `containsAlias` cannot promise);
 * failed enrollment rolls the generated entry back; removal calls
 * `deleteEntry` directly, which already tolerates genuine not-found.
 * AndroidKeyStore state is owned by the system keystore daemon, so
 * identities survive engine swaps and process death.
 */
class KeysService : NativeService {

    override fun invoke(method: String, payloadJson: String): String? {
        return try {
            when (method) {
                "availability" -> availability()
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

    /**
     * TN-188: resolves a caller handle to its Keystore entry FOR THE NET
     * SERVICE's TLS client certificate — the private key is used in place
     * (an X509KeyManager hands JSContext the entry; nothing is marshalled)
     * and ONLY this service's `tenun.keys.v1.` namespace is read, so the
     * ownership boundary of review 2026-11-08 holds across capabilities.
     * Returns null for a not-found handle (the caller maps that to
     * invalid-argument); backend failures propagate as exceptions.
     */
    fun identityEntry(handle: String): KeyStore.PrivateKeyEntry? =
        keyStore().getEntry(backingAlias(handle), null) as? KeyStore.PrivateKeyEntry

    private fun availability(): String {
        return try {
            keyStore()
            ok(JSONObject().put("status", "supported"))
        } catch (t: Throwable) {
            ok(
                JSONObject()
                    .put("status", "unavailable")
                    .put("reason", "AndroidKeyStore unavailable: ${t.message ?: t.javaClass.simpleName}")
            )
        }
    }

    private fun generateIdentity(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val alias = stringField(payload, "alias")
            ?: return failure("invalid-argument", "alias must be a string")
        if (!isValidAlias(alias)) {
            return failure("invalid-argument", "alias must be 1..128 Unicode code points without control characters or lone surrogates")
        }
        // The whole check-generate-enroll sequence is atomic against other
        // KeysService instances in this process: generation rebinds aliases,
        // so a check outside the lock would allow a silent replace.
        return synchronized(LOCK) {
            val ks = keyStore()
            val backing = backingAlias(alias)
            // getKey (not containsAlias): inside this private-key-only
            // namespace, null means genuinely absent and backend failures
            // propagate as exceptions → platform-error, never a false
            // "absent" that would let generation replace an existing key.
            if (ks.getKey(backing, null) != null) {
                return failure("invalid-argument", "alias already exists: $alias")
            }
            val spec = KeyGenParameterSpec.Builder(
                backing,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                // DIGEST_SHA256 serves ordinary in-place signing; DIGEST_NONE
                // is REQUIRED for TLS client authentication, where Conscrypt
                // signs the pre-hashed CertificateVerify via NONEwithECDSA
                // (without it every handshake fails "Keystore operation
                // failed" — device-gate evidence, 2026-11-09).
                .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_NONE)
                .setCertificateSubject(X500Principal("CN=${dnValue(alias)}"))
                .setCertificateSerialNumber(serialFor(alias))
                .build()
            val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            generator.initialize(spec)
            generator.generateKeyPair()

            val certificate = try {
                ks.getCertificate(backing)
            } catch (t: Throwable) {
                rollback(ks, backing)
                return failure("platform-error", "keystore certificate lookup failed: ${t.message ?: t.javaClass.simpleName}")
            }
            if (certificate == null) {
                rollback(ks, backing)
                return failure("platform-error", "keystore generated no certificate for $alias")
            }
            val identity = JSONObject()
                .put("handle", alias)
                .put("certificatePem", pem(certificate.encoded))
            ok(identity)
        }
    }

    private fun sign(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val handle = stringField(payload, "handle")
            ?: return failure("invalid-argument", "handle must be a string")
        val dataB64 = stringField(payload, "data")
            ?: return failure("invalid-argument", "data must be a base64 string (empty is valid)")
        val entry = keyStore().getEntry(backingAlias(handle), null) as? KeyStore.PrivateKeyEntry
            ?: return failure("invalid-argument", "identity not found: $handle")
        val data = try {
            Base64.getDecoder().decode(dataB64)
        } catch (e: IllegalArgumentException) {
            return failure("invalid-argument", "data is not valid base64")
        }
        if (data.size > MAX_DATA_BYTES) {
            return failure("invalid-argument", "data exceeds $MAX_DATA_BYTES bytes")
        }
        // SHA256withECDSA signs in place inside the Keystore — the private
        // key is used where it lives and is never marshalled.
        val derSignature = Signature.getInstance("SHA256withECDSA").run {
            initSign(entry.privateKey)
            update(data)
            sign()
        }
        val raw = DerSignature.derToRawP256(derSignature)
            ?: return failure("platform-error", "provider produced a non-canonical ECDSA signature")
        return ok(Base64.getEncoder().encodeToString(raw))
    }

    private fun exportCertificatePem(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val handle = stringField(payload, "handle")
            ?: return failure("invalid-argument", "handle must be a string")
        val certificate = keyStore().getCertificate(backingAlias(handle))
            ?: return failure("invalid-argument", "identity not found: $handle")
        return ok(pem(certificate.encoded))
    }

    private fun removeIdentity(payloadJson: String): String {
        val payload = parse(payloadJson) ?: return malformed()
        val handle = stringField(payload, "handle")
            ?: return failure("invalid-argument", "handle must be a string")
        synchronized(LOCK) {
            // deleteEntry directly: it already tolerates genuine not-found,
            // so no containsAlias precheck can suppress a backend failure
            // into a false success. Only the service namespace is touched.
            keyStore().deleteEntry(backingAlias(handle))
        }
        return ok(JSONObject.NULL) // idempotent, matching the preview keyring
    }

    // -- helpers ------------------------------------------------------------

    /** Process-wide lock: generation/removal must be atomic per app process. */
    private companion object {
        const val ALIAS_PREFIX = "tenun.keys.v1."
        const val MAX_DATA_BYTES = 65_536
        val LOCK = Any()
    }

    /** Injective, charset-safe mapping of a caller handle into the namespace. */
    private fun backingAlias(handle: String): String =
        ALIAS_PREFIX + MessageDigest.getInstance("SHA-256")
            .digest(handle.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    /** Strict field typing: JSON numbers/booleans/objects/null are refused. */
    private fun stringField(payload: JSONObject, name: String): String? =
        if (payload.opt(name) is String) payload.optString(name) else null

    private fun isValidAlias(alias: String): Boolean {
        val length = alias.length
        if (length == 0 || length > 128) return false
        var i = 0
        while (i < length) {
            val c = alias[i]
            when (c.code) {
                in 0x00..0x1f, in 0x7f..0x9f -> return false
            }
            if (c.isHighSurrogate()) {
                if (i + 1 >= length || !alias[i + 1].isLowSurrogate()) return false
                i += 1
            } else if (c.isLowSurrogate()) {
                return false
            }
            i += 1
        }
        return true
    }

    private fun parse(payloadJson: String): JSONObject? =
        try {
            JSONObject(payloadJson)
        } catch (e: JSONException) {
            null
        }

    private fun malformed(): String =
        failure("invalid-argument", "malformed JSON payload")

    /** Best-effort rollback of THIS attempt's entry; failures surface, not hide. */
    private fun rollback(ks: KeyStore, backing: String) {
        try {
            ks.deleteEntry(backing)
        } catch (t: Throwable) {
            // Report through the returned platform-error; the alias stays
            // occupied only if the daemon itself refuses the delete.
        }
    }

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
 * Canonical DER SEQUENCE(INTEGER r, INTEGER s) ↔ fixed-width raw r||s
 * (64 bytes) — the pinned TN-189 signature wire format. Java's Signature
 * emits DER; the contract pins raw, so both directions live here, shared
 * with the preview keyring's identical TS converters (same vectors tested
 * on both tiers: KeysServiceFormatTest ↔ packages/platform/test/keys.test.ts).
 *
 * Canonical rules (review 2026-11-08): the SEQUENCE length must match the
 * buffer exactly (no trailing bytes, no extra elements), each INTEGER is
 * 1..33 bytes with the 0x00 sign byte present iff the magnitude's MSB is
 * set, negative integers and redundant padding are refused, and each
 * magnitude fits its 32-byte field.
 */
object DerSignature {

    fun derToRawP256(der: ByteArray): ByteArray? {
        if (der.size < 8 || der[0] != 0x30.toByte()) return null
        if ((der[1].toInt() and 0xff) >= 0x80) return null // P-256 DER sigs stay short-form
        if (2 + (der[1].toInt() and 0xff) != der.size) return null // exact boundaries only
        val r = readCanonicalInteger(der, 2) ?: return null
        val s = readCanonicalInteger(der, r.second) ?: return null
        if (s.second != der.size) return null // exactly two INTEGERs
        if (r.first.size > 32 || s.first.size > 32) return null
        val out = ByteArray(64)
        System.arraycopy(r.first, 0, out, 32 - r.first.size, r.first.size)
        System.arraycopy(s.first, 0, out, 64 - s.first.size, s.first.size)
        return out
    }

    /** Canonical nonnegative INTEGER → (magnitude, offset after element). */
    private fun readCanonicalInteger(der: ByteArray, at: Int): Pair<ByteArray, Int>? {
        if (at + 2 > der.size || der[at] != 0x02.toByte()) return null
        val len = der[at + 1].toInt() and 0xff
        if (len == 0 || len > 33 || at + 2 + len > der.size) return null
        var content = der.copyOfRange(at + 2, at + 2 + len)
        if (content[0] == 0.toByte() && content.size > 1) {
            if (content[1] >= 0) return null // redundant sign byte
            content = content.copyOfRange(1, content.size)
        } else if (content[0] < 0) {
            return null // negative integer
        }
        return content to at + 2 + len
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
